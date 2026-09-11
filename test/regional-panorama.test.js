import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-region-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    now: () => new Date('2026-09-10T12:00:00.000Z'),
    extractText: async () => ({ fields: { client: 'Red Campo Ficticia', hospital: 'Hospital Campo Ficticio', area: 'Área Norte Ficticia', equipment: [{ modality: 'tomógrafo', quantity: 'una', manufacturer: 'Marca Ficticia', model: 'Modelo Ficticio', serial: 'FIC-CAMPO-1', age: 'ocho años' }] }, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path */
  async function get(path) { const response = await fetch(app.url + path); assert.ok(response.ok, await response.clone().text()); return response.json(); }
  /** @param {string} path */
  async function post(path, body = {}) { const response = await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.ok(response.ok, await response.clone().text()); return response.json(); }
  return { app, directory, get, post };
}

test('carga y reinicia un dataset regional determinista y explícitamente ficticio', async () => {
  const context = await fixture();
  try {
    const first = await context.get('/api/panorama');
    assert.deepEqual({ hospitals: first.dataset.hospitals, equipment: first.dataset.equipment, fictional: first.dataset.fictional }, { hospitals: 12, equipment: 72, fictional: true });
    assert.match(first.dataset.label, /ficticio/i);
    assert.equal(first.hospitals.length, 12);
    assert.ok(first.hospitals.every(/** @param {any} hospital */ hospital => hospital.fictional && /fict.ci/i.test(`${hospital.name} ${hospital.client}`)));
    const reset = await context.post('/api/demo/reset');
    const second = await context.get('/api/panorama');
    assert.equal(reset.datasetId, first.dataset.id);
    assert.deepEqual(second, first);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('agrega equipos, confianza, vigencia, edad, modalidad y geografía', async () => {
  const context = await fixture();
  try {
    const data = await context.get('/api/panorama');
    assert.equal(data.metrics.hospitals, 12);
    assert.equal(data.metrics.equipment, 72);
    assert.ok(data.metrics.averageConfidence >= 0 && data.metrics.averageConfidence <= 100);
    assert.ok(data.metrics.staleInformation > 0);
    assert.ok(data.metrics.potentialOpportunities > 0);
    for (const values of /** @type {any[][]} */ (Object.values(data.aggregations))) assert.equal(values.reduce((sum, item) => sum + item.count, 0), 72);
    assert.ok(data.filters.modalities.includes('Otro'));
    assert.ok(data.aggregations.confidence.every(/** @param {any} item */ item => ['Baja (0–49)', 'Media (50–79)', 'Alta (80–100)'].includes(item.value)));
    assert.deepEqual(data.aggregations.region.map(/** @param {any} region */ region => region.value), ['América Latina']);
    assert.deepEqual(data.map.map(/** @param {any} country */ country => country.country).sort(), ['Brasil', 'Chile', 'Colombia', 'México', 'Panamá']);
    assert.equal(data.map.reduce(/** @param {number} sum @param {any} country */ (sum, country) => sum + country.equipment, 0), 72);
    assert.ok(data.hospitals.every(/** @param {any} hospital */ hospital => hospital.coordinates?.precision === 'city'));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('aplica filtros combinados a métricas, mapa, agregaciones y hospitales', async () => {
  const context = await fixture();
  try {
    const data = await context.get('/api/panorama?country=Panam%C3%A1&city=Ciudad%20de%20Panam%C3%A1&modality=Tomograf%C3%ADa%20computarizada');
    assert.ok(data.metrics.equipment > 0 && data.metrics.equipment < 72);
    assert.ok(data.hospitals.every(/** @param {any} hospital */ hospital => hospital.country === 'Panamá' && hospital.city === 'Ciudad de Panamá'));
    assert.deepEqual(data.map.map(/** @param {any} country */ country => country.country), ['Panamá']);
    assert.deepEqual(data.aggregations.modality, [{ value: 'Tomografía computarizada', count: data.metrics.equipment }]);
    const hospital = data.hospitals[0];
    const narrowed = await context.get(`/api/panorama?client=${encodeURIComponent(hospital.client)}&hospital=${hospital.id}`);
    assert.equal(narrowed.hospitals.length, 1);
    assert.equal(narrowed.hospitals[0].id, hospital.id);
    assert.equal(narrowed.metrics.equipment, 6);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('permite navegar desde el panorama al perfil 360 del hospital ficticio', async () => {
  const context = await fixture();
  try {
    const panorama = await context.get('/api/panorama');
    const summary = panorama.hospitals[0];
    const hospital = await context.get('/api/hospitals/' + summary.id);
    assert.equal(hospital.id, summary.id);
    assert.equal(hospital.fictional, true);
    assert.equal(hospital.installedBase.total, 6);
    assert.equal(hospital.installedBase.items.length, 6);
    assert.equal(hospital.observations.length, 6);
    assert.ok(hospital.observations.every(/** @param {any} observation */ observation => observation.fictional && observation.profile.fictional));
    assert.ok(hospital.observations.every(/** @param {any} observation */ observation => ['Confirmado', 'Reportado', 'Estimado', 'Desconocido'].includes(observation.assessment.overallState)));
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.evidenceIds.length === 0));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una observación guardada actualiza el panorama sin depender del reinicio del demo', async () => {
  const context = await fixture();
  try {
    const profile = await context.post('/api/profiles', { name: 'Elena Campo Ficticia', role: 'Especialista' });
    await context.post('/api/profiles/active', { profileId: profile.id });
    const text = 'Visité Hospital Campo Ficticio de Red Campo Ficticia en Área Norte Ficticia. Vi una tomógrafo Marca Ficticia, Modelo Ficticio, serie FIC-CAMPO-1 y ocho años.';
    const draft = await context.post('/api/drafts', { text });
    const reviewed = { client: 'Red Campo Ficticia', hospital: 'Hospital Campo Ficticio', area: 'Área Norte Ficticia', equipment: [{ modality: 'Tomografía computarizada', quantity: 1, manufacturer: 'Marca Ficticia', model: 'Modelo Ficticio', serial: 'FIC-CAMPO-1', age: null }] };
    const saved = await context.post('/api/observations', { draftId: draft.id, reviewed, hospitalId: null });
    const panorama = await context.get('/api/panorama');
    assert.equal(panorama.metrics.hospitals, 13);
    assert.equal(panorama.metrics.equipment, 73);
    assert.ok(panorama.hospitals.some(/** @param {any} hospital */ hospital => hospital.id === saved.hospitalId && hospital.country === 'Ubicación no informada' && hospital.city === 'Ciudad no informada' && hospital.area === 'Área Norte Ficticia' && hospital.fictional === false && hospital.source === 'Captura local'));
    const filtered = await context.get(`/api/panorama?hospital=${saved.hospitalId}`);
    assert.equal(filtered.metrics.equipment, 1);
    assert.deepEqual(filtered.aggregations.age, [{ value: 'Desconocida', count: 1 }]);
    await context.post('/api/demo/reset');
    assert.equal((await context.get('/api/panorama')).metrics.equipment, 73);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
