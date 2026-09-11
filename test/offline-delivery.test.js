import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

/** @param {import('../src/observation-schema.js').TextExtractor} [extractText] */
async function fixture(extractText) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-offline-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    qvacDiagnostics: () => ({ model: 'Qwen3-4B-Q4_K_M.gguf', quantization: 'Q4_K_M', lastInference: { engine: 'QVAC', model: 'Qwen3-4B-Q4_K_M.gguf', durationMs: 1234 } }),
    device: 'AMD Ryzen 7 8845HS (CPU, 16 núcleos lógicos)',
    extractText: extractText ?? (async () => { throw new Error('no usado en estas pruebas'); }) });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  return { app, directory, api };
}

test('el estado local expone el hardware detectado y los diagnósticos por modelo', async () => {
  const context = await fixture();
  try {
    const status = await (await fetch(context.app.url + '/api/status')).json();
    assert.equal(status.device, 'AMD Ryzen 7 8845HS (CPU, 16 núcleos lógicos)');
    assert.equal(status.qvac.diagnostics.model, 'Qwen3-4B-Q4_K_M.gguf');
    assert.equal(status.qvac.diagnostics.quantization, 'Q4_K_M');
    assert.equal(status.qvac.diagnostics.lastInference.durationMs, 1234);
    assert.equal(status.voice.diagnostics.model, null);
    assert.equal(status.plate.diagnostics.model, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('sin hardware detectado, el estado declara el dispositivo como no disponible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-offline-nodevice-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }) });
  try {
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.device, null);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la exportación CSV de la base instalada refleja el mismo estado visible en la aplicación', async () => {
  const context = await fixture(async () => ({
    fields: { client: 'Red Horizonte, S.A.', hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: '1', manufacturer: 'DemoMed Ficticio', model: 'XR-3000', serial: 'FIC-000123', age: 'ocho años' },
    ] }, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 10 },
  }));
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora del cliente Red Horizonte, S.A. Vi un tomógrafo DemoMed Ficticio, modelo XR-3000, número de serie FIC-000123 y ocho años.' });
    await context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    const response = await fetch(context.app.url + '/api/export/installed-base.csv');
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type')), /text\/csv/);
    assert.match(String(response.headers.get('content-disposition')), /attachment; filename="sitesignal-base-instalada\.csv"/);
    const csv = await response.text();
    const [header, ...rows] = csv.trim().split('\r\n');
    assert.equal(header, 'hospital,cliente,ciudad,pais,tipo,modalidad,cantidad,fabricante,modelo,numero_de_serie,antiguedad_anos,estado_modalidad,estado_fabricante,estado_modelo,estado_serie,estado_antiguedad,evidencia_fotografica');
    assert.equal(rows.length, 1);
    // the client name contains a comma and must come back quoted, never split into extra columns.
    assert.match(rows[0], /^Hospital Aurora,"Red Horizonte, S\.A\.",,,individual,Tomografía computarizada,1,DemoMed Ficticio,XR-3000,FIC-000123,8,Reportado,Reportado,Reportado,Reportado,Reportado,0$/);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('la exportación JSON incluye observaciones, base instalada, oportunidades y referencias de evidencia', async () => {
  const context = await fixture(async () => ({
    fields: { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: '1', manufacturer: 'DemoMed Ficticio', model: 'XR-3000', serial: 'FIC-000123', age: 'ocho años' },
    ] }, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 10 },
  }));
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed Ficticio, modelo XR-3000, número de serie FIC-000123 y ocho años.' });
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    const response = await fetch(context.app.url + '/api/export/state.json');
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-disposition')), /attachment; filename="sitesignal-estado\.json"/);
    const data = await response.json();
    assert.ok(data.exportedAt);
    assert.equal(data.hospitals.length, 1);
    const [hospital] = data.hospitals;
    assert.equal(hospital.hospital.name, 'Hospital Aurora');
    assert.equal(hospital.observations.length, 1);
    assert.equal(hospital.observations[0].id, saved.id);
    assert.equal(hospital.installedBase.items.length, 1);
    assert.ok(Array.isArray(hospital.opportunities));
    assert.deepEqual(hospital.evidence, []);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('la exportación JSON incluye la metadata de una foto de evidencia enlazada, nunca los bytes de la imagen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-offline-evidence-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }), probePlate: async () => ({ state: 'ready', message: 'Listo' }),
    analyzeImage: async () => ({ fields: { manufacturer: 'DemoMed Ficticio', model: null, serial: 'FIC-000123', year: null },
      ocrText: 'DemoMed Ficticio numero de serie FIC-000123', metadata: { engine: 'QVAC', model: 'fixture', durationMs: 10, device: 'local' } }),
    extractText: async () => ({ fields: { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: '1', manufacturer: 'DemoMed Ficticio', model: null, serial: 'FIC-000123', age: null },
    ] }, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 10 } }) });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const draft = await api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed Ficticio, número de serie FIC-000123.' });
    const evidence = await (await fetch(app.url + '/api/evidence', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: /** @type {any} */ (Buffer.from('fake-png')) })).json();
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null, evidenceIds: [evidence.evidenceId] });
    const response = await fetch(app.url + '/api/export/state.json');
    const data = await response.json();
    assert.equal(data.hospitals[0].observations[0].id, saved.id);
    assert.equal(data.hospitals[0].evidence.length, 1);
    assert.equal(data.hospitals[0].evidence[0].id, evidence.evidenceId);
    assert.equal(data.hospitals[0].evidence[0].fields.serial, 'FIC-000123');
    assert.ok(data.hospitals[0].evidence[0].ocrText);
    assert.equal(JSON.stringify(data).includes('fake-png'), false);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
