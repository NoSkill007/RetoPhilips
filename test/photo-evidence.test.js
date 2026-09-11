import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';
import { extractPlateFields } from '../src/plate-extraction.js';

const FAKE_PNG = Buffer.from('\x89PNG\r\n\x1a\n....fake', 'binary');

/** @param {(image: Buffer) => Promise<{fields: unknown, ocrText: string, metadata: unknown}>} analyzeImage */
async function fixture(analyzeImage) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-photo-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    probePlate: async () => ({ state: 'ready', message: 'Listo' }), analyzeImage,
    extractText: async () => { throw new Error('no usado en estas pruebas'); } });
  /** @param {string} path @param {Buffer | undefined} body @param {Record<string,string>} [headers] */
  async function post(path, body, headers = { 'Content-Type': 'image/png' }) {
    return fetch(app.url + path, { method: 'POST', headers, body: /** @type {any} */ (body) });
  }
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  return { app, directory, post, api };
}

test('extractPlateFields solo confirma los campos que el OCR realmente respalda', () => {
  const blocks = [
    { text: 'DEMOMED FICTICIO', confidence: 0.99 }, { text: 'MODELO:', confidence: 0.99 }, { text: 'XR-3000', confidence: 0.66 },
    { text: 'NUMERO', confidence: 0.99 }, { text: 'DE', confidence: 0.72 }, { text: 'SERIE:', confidence: 0.64 }, { text: 'FIC-000123', confidence: 0.99 },
  ];
  const fields = extractPlateFields(blocks);
  assert.equal(fields.manufacturer, 'DEMOMED FICTICIO');
  assert.equal(fields.model, 'XR-3000');
  assert.equal(fields.serial, 'FIC-000123');
  // no year label or bare 4-digit token anywhere in this plate — must stay unknown, not guessed.
  assert.equal(fields.year, null);
});

test('una placa real fusiona la etiqueta y el valor en un solo bloque de OCR ("MODEL ; VALUE")', () => {
  // Real OCR on a photographed nameplate often detects a whole "LABEL: value" line as one region,
  // unlike our per-word synthetic fixtures above.
  const fields = extractPlateFields([
    { text: 'DEMOMED FICTICIO', confidence: 0.9 },
    { text: 'MODEL ; BRILLIANCE DEMO', confidence: 0.4 },
    { text: 'REF:', confidence: 0.3 }, { text: 'SN:', confidence: 0.3 }, { text: '000111', confidence: 0.9 }, { text: '222333', confidence: 0.9 },
  ]);
  assert.equal(fields.manufacturer, 'DEMOMED FICTICIO');
  // an explicit MODEL label takes priority over the REF/SN row fallback for the model field.
  assert.equal(fields.model, 'BRILLIANCE DEMO');
  assert.equal(fields.serial, '222333');
});

test('REF y SN en la misma fila, con sus valores en la fila siguiente, respaldan modelo y serie sin una etiqueta de modelo separada', () => {
  // Very common on real medical-device nameplates: "REF:" and "SN:" printed as two column headers,
  // with their values printed as the next two OCR blocks rather than immediately after each own label.
  const fields = extractPlateFields([
    { text: 'DEMOMED FICTICIO', confidence: 0.9 },
    { text: 'REF:', confidence: 0.3 }, { text: 'SN:', confidence: 0.3 }, { text: '453567023331', confidence: 0.95 }, { text: '896', confidence: 0.9 },
  ]);
  assert.equal(fields.model, '453567023331');
  assert.equal(fields.serial, '896');
});

test('una etiqueta reconocida seguida de un bloque de texto ilegible no se confunde con el dato', () => {
  // Regression: a recognized label immediately followed — purely by reading-order coincidence — by an
  // unrelated garbled block of certification text must stay Unknown, never be reported as the serial.
  const fields = extractPlateFields([
    { text: 'SERIAL:', confidence: 0.4 }, { text: 'Mance pea/da2iCfasucchaptea )', confidence: 0.1 }, { text: '200049', confidence: 0.9 },
  ]);
  assert.equal(fields.serial, null);
  // the same label with a clean, short, capitalized-or-numeric value right after it still works.
  const clean = extractPlateFields([{ text: 'SERIAL:', confidence: 0.9 }, { text: 'FIC-000123', confidence: 0.9 }]);
  assert.equal(clean.serial, 'FIC-000123');
});

test('un año de fabricación separado de su etiqueta por el nombre del mes se reconoce igual', () => {
  const fields = extractPlateFields([
    { text: 'MANUFACTURED:', confidence: 0.9 }, { text: 'October', confidence: 0.3 }, { text: '2007', confidence: 0.9 },
  ]);
  assert.equal(fields.year, 2007);
});

test('un texto sin ninguna etiqueta reconocida no inventa ningún campo', () => {
  const fields = extractPlateFields([{ text: 'Uso ficticio de demostracion', confidence: 0.9 }, { text: '220V', confidence: 0.9 }]);
  assert.deepEqual(fields, { manufacturer: null, model: null, serial: null, year: null, ocrText: 'Uso ficticio de demostracion 220V' });
});

test('una imagen se analiza, se almacena localmente y devuelve solo los campos con respaldo', async () => {
  const context = await fixture(async image => {
    assert.ok(Buffer.isBuffer(image)); assert.equal(image.length, FAKE_PNG.length);
    return { fields: { manufacturer: 'DemoMed Ficticio', model: 'XR-3000', serial: 'FIC-000123', year: 2019 }, ocrText: 'DemoMed Ficticio MODELO: XR-3000 ...', metadata: { engine: 'QVAC', model: 'latin_g2.gguf', durationMs: 500, device: 'local' } };
  });
  try {
    const response = await context.post('/api/evidence', FAKE_PNG);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.evidenceId);
    assert.deepEqual(body.fields, { manufacturer: 'DemoMed Ficticio', model: 'XR-3000', serial: 'FIC-000123', year: 2019 });
    assert.match(body.ocrText, /DemoMed Ficticio/);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('se exige un tipo de contenido de imagen y bytes no vacíos', async () => {
  const context = await fixture(async () => { throw new Error('no debería llamarse'); });
  try {
    const wrongType = await context.post('/api/evidence', FAKE_PNG, { 'Content-Type': 'application/json' });
    assert.equal(wrongType.status, 415);
    const empty = await context.post('/api/evidence', Buffer.alloc(0));
    assert.equal(empty.status, 400);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('sin analyzeImage configurado, el endpoint informa que la evidencia fotográfica no está lista', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-photo-unconfigured-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }) });
  try {
    const response = await fetch(app.url + '/api/evidence', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: /** @type {any} */ (FAKE_PNG) });
    assert.equal(response.status, 503);
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.plate.state, 'unavailable');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un plate que muestra fabricante y serie pero no antigüedad confirma solo esos dos campos', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-photo-confirm-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    probePlate: async () => ({ state: 'ready', message: 'Listo' }),
    analyzeImage: async () => ({ fields: { manufacturer: 'DemoMed Ficticio', model: null, serial: 'FIC-000123', year: null },
      ocrText: 'DemoMed Ficticio numero de serie FIC-000123', metadata: { engine: 'QVAC', model: 'latin_g2.gguf', durationMs: 500, device: 'local' } }),
    extractText: async () => ({ fields: { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'una', manufacturer: 'DemoMed Ficticio', model: null, serial: 'FIC-000123', age: 'ocho años' },
    ] }, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const evidence = await (await fetch(app.url + '/api/evidence', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: /** @type {any} */ (FAKE_PNG) })).json();
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const draft = await api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed Ficticio, número de serie FIC-000123 y ocho años.' });
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null, evidenceIds: [evidence.evidenceId] });
    const hospital = await api('/api/hospitals/' + saved.hospitalId);
    const observation = hospital.observations.find(/** @param {any} entry */ entry => entry.id === saved.id);
    assert.equal(observation.assessment.equipment[0].manufacturer.state, 'Confirmado');
    assert.equal(observation.assessment.equipment[0].serial.state, 'Confirmado');
    // the plate never showed a year/age, so age keeps whatever the narrative alone earned — never Confirmado from the photo.
    assert.notEqual(observation.assessment.equipment[0].age.state, 'Confirmado');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
