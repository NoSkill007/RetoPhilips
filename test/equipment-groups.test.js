import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const groupFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
  { modality: 'resonancias', quantity: 'tres', manufacturer: null, model: null, serial: null, age: null },
] };

/** @param {string} directory */
async function setup(directory) {
  let extraction = groupFields;
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: extraction, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  }
  const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
  await api('/api/profiles/active', { profileId: profile.id });
  /** @param {any} value */
  function setExtraction(value) { extraction = value; }
  return { app, api, setExtraction };
}

/** @param {ReturnType<typeof setup> extends Promise<infer T> ? T : never} context @param {string | null} hospitalId @param {string | null} splitGroupId @param {string} [serial] */
async function saveCurrent(context, hospitalId, splitGroupId, serial = 'SN-001') {
  const draft = await context.api('/api/drafts', { text: splitGroupId
    ? `Visité Hospital Aurora. Identifiqué una resonancia, cantidad una, con número de serie ${serial}.`
    : 'Visité Hospital Aurora. Vi tres resonancias.' });
  return context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId, splitGroupId });
}

test('un reporte conjunto crea un grupo sin identidades inventadas y conserva su procedencia', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-groups-'));
  const context = await setup(directory);
  try {
    const saved = await saveCurrent(context, null, null);
    const hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.equal(hospital.installedBase.items.length, 1);
    const group = hospital.installedBase.items[0];
    assert.equal(group.kind, 'group');
    assert.equal(group.quantity, 3);
    assert.equal(group.serial, null);
    assert.deepEqual(group.sourceObservationIds, [saved.id]);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('una observación posterior separa unidades, mantiene el total y elimina el grupo vacío', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-splits-'));
  let context = await setup(directory);
  try {
    const original = await saveCurrent(context, null, null);
    let hospital = await context.api('/api/hospitals/' + original.hospitalId);
    let group = hospital.installedBase.items[0];
    const individualFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'resonancia', quantity: 'una', manufacturer: null, model: null, serial: 'SN-001', age: null },
    ] };
    context.setExtraction(individualFields);

    const first = await saveCurrent(context, original.hospitalId, group.id);
    hospital = await context.api('/api/hospitals/' + original.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.deepEqual(hospital.installedBase.items.map(/** @param {any} item */ item => [item.kind, item.quantity]), [['group', 2], ['individual', 1]]);
    group = hospital.installedBase.items.find(/** @param {any} item */ item => item.kind === 'group');
    const firstIndividual = hospital.installedBase.items.find(/** @param {any} item */ item => item.kind === 'individual');
    assert.deepEqual(group.sourceObservationIds, [original.id]);
    assert.deepEqual(firstIndividual.sourceObservationIds, [original.id, first.id]);
    assert.equal(group.splitHistory[0].observationId, first.id);
    assert.equal(firstIndividual.splitHistory[0].profile.name, 'Ana Demo');

    individualFields.equipment[0].serial = 'SN-002';
    await saveCurrent(context, original.hospitalId, group.id, 'SN-002');
    hospital = await context.api('/api/hospitals/' + original.hospitalId);
    group = hospital.installedBase.items.find(/** @param {any} item */ item => item.kind === 'group');
    assert.equal(group.quantity, 1);
    assert.equal(hospital.installedBase.total, 3);

    individualFields.equipment[0].serial = 'SN-003';
    await saveCurrent(context, original.hospitalId, group.id, 'SN-003');
    hospital = await context.api('/api/hospitals/' + original.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.equal(hospital.installedBase.items.filter(/** @param {any} item */ item => item.kind === 'group').length, 0);
    assert.equal(hospital.installedBase.items.filter(/** @param {any} item */ item => item.kind === 'individual').length, 3);
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.sourceObservationIds.includes(original.id)));
    await context.app.close();
    context = await setup(directory);
    hospital = await context.api('/api/hospitals/' + original.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.equal(hospital.installedBase.items.filter(/** @param {any} item */ item => item.kind === 'group').length, 0);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});
