import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const text = '  Visité Hospital Aurora del cliente Red Horizonte, área Norte. Vi dos tomógrafos; parecen tener ocho años.\n';
const extracted = { client: 'Red Horizonte', hospital: 'Hospital Aurora', area: 'Norte', equipment: [
  { modality: 'tomógrafos', quantity: 'dos', manufacturer: null, model: null, serial: null, age: 'ocho años' },
] };

test('un colaborador revisa la extracción, guarda y consulta su procedencia en el perfil 360', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-observation-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: extracted, metadata: { engine: 'deterministic-test', model: 'fixture', durationMs: 10 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  try {
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const profiles = await api('/api/profiles');
    assert.equal(profiles.activeProfileId, profile.id);
    const draft = await api('/api/drafts', { text });
    assert.equal(draft.reviewed.hospital, 'Hospital Aurora');
    assert.equal(draft.reviewed.equipment[0].quantity, 2);
    assert.equal(draft.reviewed.equipment[0].manufacturer, null);
    assert.equal(draft.reviewed.equipment.length, 1);
    draft.reviewed.equipment[0].quantity = 3;
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    const hospital = await api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.name, 'Hospital Aurora');
    assert.equal(hospital.observations.length, 1);
    assert.equal(hospital.observations[0].originalText, text);
    assert.equal(hospital.observations[0].reviewed.equipment[0].quantity, 3);
    assert.equal(hospital.observations[0].reviewed.equipment[0].model, null);
    assert.equal(hospital.observations[0].profile.name, 'Ana Demo');
    assert.equal(hospital.observations[0].provenance.kind, 'qvac');
    assert.equal(hospital.observations[0].provenance.metadata.engine, 'deterministic-test');
    assert.ok(hospital.observations[0].createdAt);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('seleccionar un hospital conserva su identidad y el autor del borrador tras cambiar de perfil', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-link-'));
  const options = { dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: extracted, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) };
  let app = await startApplication(options);
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const ana = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: ana.id });
    const first = await api('/api/drafts', { text });
    const saved = await api('/api/observations', { draftId: first.id, reviewed: first.reviewed, hospitalId: null });
    const next = await api('/api/drafts', { text });
    assert.equal(next.candidates[0].id, saved.hospitalId);
    const luis = await api('/api/profiles', { name: 'Luis Demo', role: 'Vendedor' });
    await api('/api/profiles/active', { profileId: luis.id });
    const payload = { draftId: next.id, reviewed: next.reviewed, hospitalId: saved.hospitalId };
    const linked = await api('/api/observations', payload);
    const repeated = await api('/api/observations', payload);
    assert.equal(repeated.id, linked.id);
    await app.close(); app = await startApplication(options);
    const hospital = await api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations.length, 2);
    assert.equal(hospital.observations[0].profile.id, ana.id);
    assert.equal((await api('/api/profiles')).activeProfileId, luis.id);
    assert.equal((await api('/api/hospitals')).length, 1);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la extracción no convierte meses en años ni conserva valores ausentes del relato', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-unknown-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: { ...extracted, equipment: [{ ...extracted.equipment[0], age: 'ocho meses', manufacturer: 'Inventado' }] }, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} body */
  async function post(path, body) {
    const response = await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await post('/api/profiles', { name: 'Eva Demo', role: 'Especialista' });
    await post('/api/profiles/active', { profileId: profile.id });
    const draft = await post('/api/drafts', { text: text.replace('ocho años', 'ocho meses') });
    assert.equal(draft.reviewed.equipment[0].age, null);
    assert.equal(draft.reviewed.equipment[0].manufacturer, null);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un dato presente en otro contexto no se atribuye al equipo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-context-'));
  const source = 'Visité Hospital Modelo 3. Vi un tomógrafo en radiología.';
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: { client: null, hospital: 'Hospital Modelo 3', area: null, equipment: [{
      modality: 'tomógrafo', quantity: '3', manufacturer: 'Modelo', model: 'Modelo 3', serial: '3', age: null,
    }] }, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} body */
  async function post(path, body) {
    const response = await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await post('/api/profiles', { name: 'Eva Demo', role: 'Especialista' });
    await post('/api/profiles/active', { profileId: profile.id });
    const draft = await post('/api/drafts', { text: source });
    assert.equal(draft.provenance.kind, 'qvac');
    assert.deepEqual(draft.reviewed.equipment[0], { modality: 'Tomografía computarizada', quantity: null, manufacturer: null, model: null, serial: null, age: null });
    assert.ok(draft.provenance.validationIssues.length > 0);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('dos equipos en la misma oración no intercambian sus datos', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-clauses-'));
  const source = 'Visité Hospital Aurora. Vi 2 ultrasonidos fabricante Acme y 3 tomógrafos fabricante DemoMed.';
  const fields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'ultrasonidos', quantity: '3', manufacturer: 'DemoMed', model: null, serial: null, age: null },
    { modality: 'tomógrafos', quantity: '2', manufacturer: 'Acme', model: null, serial: null, age: null },
  ] };
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} body */
  async function post(path, body) {
    const response = await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await post('/api/profiles', { name: 'Eva Demo', role: 'Especialista' });
    await post('/api/profiles/active', { profileId: profile.id });
    const draft = await post('/api/drafts', { text: source });
    assert.equal(draft.provenance.kind, 'qvac');
    assert.deepEqual(draft.reviewed.equipment.map(/** @param {{quantity: number | null, manufacturer: string | null}} item */ item => ({ quantity: item.quantity, manufacturer: item.manufacturer })), [
      { quantity: null, manufacturer: null },
      { quantity: null, manufacturer: null },
    ]);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
