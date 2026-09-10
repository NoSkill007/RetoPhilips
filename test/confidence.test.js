import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const empty = { client: null, hospital: null, area: null, equipment: [
  { modality: null, quantity: null, manufacturer: null, model: null, serial: null, age: null },
] };

/** @param {any} fields @param {() => Date} now @param {(record: any) => string[]} [confirmationResolver] */
async function setup(fields, now, confirmationResolver = () => []) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-confidence-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, now, confirmationResolver,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
  await api('/api/profiles/active', { profileId: profile.id });
  return { app, directory, api };
}

test('las preguntas respetan prioridad, aparecen una por vez y terminan en tres', async () => {
  const context = await setup(empty, () => new Date('2026-09-10T13:00:00Z'));
  try {
    let draft = await context.api('/api/drafts', { text: 'Visité un sitio ficticio sin más detalles.' });
    assert.equal(draft.followUp.field, 'hospital'); assert.equal(draft.followUpProgress.answered, 0);
    draft = await context.api(`/api/drafts/${draft.id}/follow-up`, { answer: 'Hospital Manual' });
    assert.equal(draft.followUp.field, 'modality'); assert.equal(draft.followUpProgress.answered, 1);
    draft = await context.api(`/api/drafts/${draft.id}/follow-up`, { answer: 'Ultrasonido' });
    assert.equal(draft.followUp.field, 'quantity'); assert.equal(draft.followUpProgress.answered, 2);
    draft = await context.api(`/api/drafts/${draft.id}/follow-up`, { answer: 2 });
    assert.equal(draft.followUp, null); assert.equal(draft.followUpProgress.answered, 3); assert.equal(draft.followUpProgress.limit, 3);
    assert.equal(draft.assessment.confidence.score, 49); assert.equal(draft.assessment.confidence.band, 'Baja');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('No lo se conserva el campo desconocido y avanza a la pregunta siguiente', async () => {
  const context = await setup(empty, () => new Date('2026-09-10T13:00:00Z'));
  try {
    let draft = await context.api('/api/drafts', { text: 'Visité un sitio ficticio sin más detalles.' });
    draft = await context.api(`/api/drafts/${draft.id}/follow-up`, { answer: null });
    assert.equal(draft.assessment.fields.hospital.state, 'Desconocido');
    assert.equal(draft.followUp.field, 'modality');
    assert.equal(draft.followUpProgress.answered, 1);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('estados y confianza explican completitud, vigencia y confirmación', async () => {
  let clock = new Date('2026-09-10T13:00:00Z');
  const fields = { client: 'Red Horizonte', hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'tomógrafos', quantity: 'dos', manufacturer: null, model: null, serial: null, age: 'ocho años' },
  ] };
  const text = 'Visité Hospital Aurora del cliente Red Horizonte. Vi dos tomógrafos; parecen tener ocho años.';
  const context = await setup(fields, () => clock);
  try {
    const draft = await context.api('/api/drafts', { text });
    assert.equal(draft.assessment.fields.hospital.state, 'Reportado');
    assert.equal(draft.assessment.equipment[0].age.state, 'Estimado');
    assert.equal(draft.assessment.equipment[0].manufacturer.state, 'Desconocido');
    assert.equal(draft.assessment.overallState, 'Reportado');
    assert.deepEqual(draft.assessment.confidence.components, {
      completeness: { score: 30, max: 40 }, freshness: { score: 25, max: 25 }, evidence: { score: 0, max: 35 },
    });
    assert.equal(draft.assessment.confidence.score, 55); assert.equal(draft.assessment.confidence.band, 'Media');
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    clock = new Date(new Date('2026-09-10T13:00:00Z').getTime() + 73 * 86_400_000);
    let hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].assessment.confidence.score, 50);
    assert.equal(hospital.observations[0].assessment.confidence.band, 'Media');
    clock = new Date('2027-09-11T13:00:00Z');
    hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].assessment.confidence.components.freshness.score, 0);
    assert.equal(hospital.observations[0].assessment.confidence.score, 30);
    assert.equal(hospital.observations[0].assessment.confidence.band, 'Baja');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('la API publica los límites exactos de las bandas de confianza', async () => {
  const context = await setup(empty, () => new Date('2026-09-10T13:00:00Z'));
  try {
    assert.deepEqual(await context.api('/api/confidence-policy'), {
      bands: { Baja: [0, 49], Media: [50, 79], Alta: [80, 100] },
      components: { completeness: 40, freshness: 25, evidence: 35 },
    });
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('evidencia o confirmación independiente puede confirmar campos y completar sus 35 puntos', async () => {
  const captured = new Date('2026-09-10T13:00:00Z');
  let clock = captured;
  const fields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'tomógrafo', quantity: '2', manufacturer: 'DemoMed', model: 'CTX', serial: 'S1', age: '8 años' },
  ] };
  const confirmations = ['hospital', 'equipment.0.modality', 'equipment.0.quantity', 'equipment.0.manufacturer', 'equipment.0.model', 'equipment.0.age'];
  const context = await setup(fields, () => clock, () => confirmations);
  try {
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi 2 tomógrafos, fabricante DemoMed, modelo CTX, número de serie S1, antigüedad 8 años.' });
    assert.equal(draft.assessment.fields.hospital.state, 'Confirmado');
    assert.equal(draft.assessment.overallState, 'Confirmado');
    assert.equal(draft.assessment.confidence.components.evidence.score, 35);
    assert.equal(draft.assessment.confidence.score, 100); assert.equal(draft.assessment.confidence.band, 'Alta');
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    clock = new Date(captured.getTime() + 292 * 86_400_000);
    let hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].assessment.confidence.score, 80); assert.equal(hospital.observations[0].assessment.confidence.band, 'Alta');
    clock = new Date(captured.getTime() + 307 * 86_400_000);
    hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].assessment.confidence.score, 79); assert.equal(hospital.observations[0].assessment.confidence.band, 'Media');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
