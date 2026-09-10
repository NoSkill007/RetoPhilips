import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {string} directory @param {string} nowIso */
async function start(directory, nowIso) {
  /** @type {any} */ let fields;
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    now: () => new Date(nowIso),
    extractText: async () => ({ fields, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function request(path, body) {
    return fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await request(path, body); assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  /** @param {string} name */
  async function activate(name) {
    const profile = await api('/api/profiles', { name, role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id }); return profile;
  }
  /** @param {string | null} hospitalId @param {{manufacturer?: string | null, model?: string | null, ageWords?: string, serial?: string}} [options] */
  async function save(hospitalId, { manufacturer = 'DemoMed', model = 'X100', ageWords = 'ocho', serial = 'SN-OPP-1' } = {}) {
    fields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'una', manufacturer, model, serial, age: `${ageWords} años` },
    ] };
    const text = `Visité Hospital Aurora. Vi un tomógrafo, cantidad una,`
      + `${manufacturer ? ` fabricante ${manufacturer},` : ''}`
      + `${model ? ` modelo ${model},` : ''}`
      + ` número de serie ${serial} y ${ageWords} años.`;
    const draft = await api('/api/drafts', { text });
    return api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId });
  }
  return { app, api, request, activate, save };
}

test('la antigüedad mínima es una condición independiente y su límite es siete años', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-age-'));
  const context = await start(directory, '2026-01-10T12:00:00.000Z');
  try {
    await context.activate('Ana Demo');
    const seven = await context.save(null, { ageWords: 'siete', serial: 'SN-OPP-AGE-7' });
    const six = await context.save(seven.hospitalId, { ageWords: 'seis', serial: 'SN-OPP-AGE-6' });
    const hospital = await context.api('/api/hospitals/' + seven.hospitalId);
    const opportunities = hospital.installedBase.opportunities;
    const atSeven = opportunities.find(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-AGE-7');
    const atSix = opportunities.find(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-AGE-6');
    assert.ok(atSeven && atSix);
    assert.equal(atSeven.conditions.find(/** @param {any} c */ c => c.key === 'age').met, true);
    assert.equal(atSeven.current, true);
    assert.equal(atSix.conditions.find(/** @param {any} c */ c => c.key === 'age').met, false);
    assert.equal(atSix.current, false, 'una sola condición incumplida impide una oportunidad vigente');
    assert.equal(atSix.review, null);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la confianza mínima de 60 es un límite exacto y explicable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-confidence-'));
  const context = await start(directory, '2026-01-10T12:00:00.000Z');
  try {
    await context.activate('Ana Demo');
    const atSixty = await context.save(null, { manufacturer: null, model: 'X100', ageWords: 'ocho', serial: 'SN-OPP-CONF-60' });
    const belowSixty = await context.save(atSixty.hospitalId, { manufacturer: null, model: null, ageWords: 'ocho', serial: 'SN-OPP-CONF-55' });
    const hospital = await context.api('/api/hospitals/' + atSixty.hospitalId);
    const opportunities = hospital.installedBase.opportunities;
    const boundary = opportunities.find(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-CONF-60');
    const below = opportunities.find(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-CONF-55');
    assert.ok(boundary && below);
    assert.equal(boundary.confidence, 60);
    assert.equal(boundary.conditions.find(/** @param {any} c */ c => c.key === 'confidence').met, true);
    assert.equal(boundary.current, true);
    assert.equal(below.confidence, 55);
    assert.equal(below.conditions.find(/** @param {any} c */ c => c.key === 'confidence').met, false);
    assert.equal(below.current, false);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la vigencia de doce meses distingue la alerta de desactualización de la antigüedad del equipo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-freshness-'));
  const start0 = '2026-01-10T12:00:00.000Z';
  let context = await start(directory, start0);
  let hospitalId = '';
  try {
    await context.activate('Ana Demo');
    const first = await context.save(null, { ageWords: 'ocho', serial: 'SN-OPP-FRESH' });
    hospitalId = first.hospitalId;
    await context.activate('Luis Demo');
    await context.save(hospitalId, { ageWords: 'ocho', serial: 'SN-OPP-FRESH' });
    await context.app.close();

    const day365 = new Date(new Date(start0).getTime() + 365 * DAY_MS).toISOString();
    context = await start(directory, day365);
    let hospital = await context.api('/api/hospitals/' + hospitalId);
    let signals = hospital.installedBase.opportunities.filter(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-FRESH');
    assert.ok(signals.length > 0);
    for (const signal of signals) {
      assert.equal(signal.stale, false, 'a los 365 días exactos la observación sigue vigente');
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'freshness').met, true);
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'age').met, true, 'la antigüedad del equipo no depende de la vigencia de la observación');
      assert.equal(signal.current, true);
    }
    await context.app.close();

    const day366 = new Date(new Date(start0).getTime() + 366 * DAY_MS).toISOString();
    context = await start(directory, day366);
    hospital = await context.api('/api/hospitals/' + hospitalId);
    signals = hospital.installedBase.opportunities.filter(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-FRESH');
    for (const signal of signals) {
      assert.equal(signal.stale, true, 'a los 366 días la información queda desactualizada');
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'freshness').met, false);
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'age').met, true, 'el equipo sigue siendo antiguo aunque la alerta sea de vigencia, no de antigüedad');
      assert.equal(signal.current, false, 'la desactualización por sí sola impide una oportunidad vigente');
    }
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un conflicto pendiente de identidad o antigüedad suprime la oportunidad hasta resolverse', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-conflict-'));
  const context = await start(directory, '2026-01-10T12:00:00.000Z');
  try {
    await context.activate('Ana Demo');
    const first = await context.save(null, { ageWords: 'ocho', serial: 'SN-OPP-CONFLICT' });
    await context.activate('Luis Demo');
    await context.save(first.hospitalId, { ageWords: '15', serial: 'SN-OPP-CONFLICT' });

    let hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.conflicts.length, 1);
    const conflict = hospital.installedBase.conflicts[0];
    assert.equal(conflict.field, 'age');
    let signals = hospital.installedBase.opportunities.filter(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-CONFLICT');
    assert.equal(signals.length, 2);
    for (const signal of signals) {
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'conflict').met, false);
      assert.equal(signal.current, false, 'un conflicto pendiente de antigüedad impide una oportunidad vigente');
    }

    await context.api(`/api/conflicts/${conflict.id}/resolve`, { value: 8, explanation: 'La orden de compra confirma ocho años.' });
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.conflicts.length, 0);
    signals = hospital.installedBase.opportunities.filter(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-CONFLICT');
    for (const signal of signals) {
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'conflict').met, true, 'la señal se recalcula al resolverse el conflicto');
      assert.equal(signal.age, 8);
      assert.equal(signal.current, true);
    }
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un conflicto pendiente de modalidad también suprime la oportunidad, no solo los de antigüedad', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-conflict-modality-'));
  const context = await start(directory, '2026-01-10T12:00:00.000Z');
  try {
    await context.activate('Ana Demo');
    const first = await context.save(null, { ageWords: 'ocho', serial: 'SN-OPP-MODALITY', model: 'Alpha' });
    await context.activate('Luis Demo');
    await context.save(first.hospitalId, { ageWords: 'ocho', serial: 'SN-OPP-MODALITY', model: 'Beta' });

    const hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.conflicts.length, 1);
    assert.equal(hospital.installedBase.conflicts[0].field, 'model');
    const signals = hospital.installedBase.opportunities.filter(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-MODALITY');
    assert.equal(signals.length, 2);
    for (const signal of signals) {
      assert.equal(signal.conditions.find(/** @param {any} c */ c => c.key === 'conflict').met, false, 'un conflicto sobre cualquier campo del equipo, no solo serie/antigüedad, debe suprimir la oportunidad');
      assert.equal(signal.current, false);
    }
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la revisión de una oportunidad exige perfil activo, valida la nota y conserva un historial auditable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-review-'));
  const context = await start(directory, '2026-01-10T12:00:00.000Z');
  try {
    const anonymous = await context.request('/api/opportunities/00000000-0000-4000-8000-000000000000/review', { decision: 'reviewed', note: 'Sin perfil activo.' });
    assert.equal(anonymous.status, 409);

    const collaborator = await context.activate('Ana Demo');
    const saved = await context.save(null, { ageWords: 'ocho', serial: 'SN-OPP-REVIEW' });
    let hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    const opportunity = hospital.installedBase.opportunities.find(/** @param {any} entry */ entry => entry.serial === 'SN-OPP-REVIEW');
    assert.ok(opportunity);
    assert.equal(opportunity.review, null);

    const missing = await context.request(`/api/opportunities/${opportunity.itemId}/review`, { decision: 'reviewed', note: 'no' });
    assert.equal(missing.status, 400);
    const badDecision = await context.request(`/api/opportunities/${opportunity.itemId}/review`, { decision: 'approved', note: 'Nota suficientemente larga.' });
    assert.equal(badDecision.status, 400);
    const unknown = await context.request('/api/opportunities/00000000-0000-4000-8000-000000000001/review', { decision: 'reviewed', note: 'Nota suficientemente larga.' });
    assert.equal(unknown.status, 404);

    const reviewed = await context.api(`/api/opportunities/${opportunity.itemId}/review`, { decision: 'reviewed', note: 'Seguimiento comercial programado con el cliente.' });
    assert.equal(reviewed.current.decision, 'reviewed');
    assert.equal(reviewed.current.author.name, collaborator.name);
    hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    let refreshed = hospital.installedBase.opportunities.find(/** @param {any} entry */ entry => entry.itemId === opportunity.itemId);
    assert.equal(refreshed.review.current.decision, 'reviewed');
    assert.equal(refreshed.review.history.length, 1);

    await context.activate('Luis Demo');
    const dismissed = await context.api(`/api/opportunities/${opportunity.itemId}/review`, { decision: 'dismissed', note: 'El cliente ya renovó por otra vía.' });
    assert.equal(dismissed.current.decision, 'dismissed');
    assert.equal(dismissed.current.author.name, 'Luis Demo');
    hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    refreshed = hospital.installedBase.opportunities.find(/** @param {any} entry */ entry => entry.itemId === opportunity.itemId);
    assert.equal(refreshed.review.current.decision, 'dismissed');
    assert.equal(refreshed.review.history.length, 2);
    assert.equal(refreshed.review.history[0].decision, 'dismissed');
    assert.equal(refreshed.review.history[1].decision, 'reviewed');
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('el panorama ficticio también expone señales de oportunidad explicables', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-opportunity-fictional-'));
  const context = await start(directory, '2026-09-10T12:00:00.000Z');
  try {
    const panorama = await context.api('/api/panorama');
    const hospital = await context.api('/api/hospitals/' + panorama.hospitals[0].id);
    assert.equal(hospital.installedBase.opportunities.length, 6);
    for (const signal of hospital.installedBase.opportunities) {
      assert.equal(typeof signal.current, 'boolean');
      assert.equal(signal.conditions.length, 4);
      assert.ok(signal.conditions.every(/** @param {any} c */ c => typeof c.met === 'boolean' && typeof c.detail === 'string'));
    }
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});
