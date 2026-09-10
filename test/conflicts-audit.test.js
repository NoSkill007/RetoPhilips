import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

/** @param {string} directory */
async function start(directory) {
  /** @type {any} */ let fields;
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function request(path, body) {
    return fetch(app.url + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await request(path, body); assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  /** @param {string} name */
  async function activate(name) {
    const profile = await api('/api/profiles', { name, role: name === 'Ana Demo' ? 'Ingeniero de servicio' : 'Vendedor' });
    await api('/api/profiles/active', { profileId: profile.id }); return profile;
  }
  /** @param {string | null} hospitalId @param {string} model @param {string} manufacturer */
  async function save(hospitalId, model, manufacturer = 'DemoMed') {
    fields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'una', manufacturer, model, serial: 'SN-700', age: 'cinco años' },
    ] };
    const text = `Visité Hospital Aurora. Vi un tomógrafo, cantidad una, fabricante ${manufacturer}, modelo ${model}, número de serie SN-700 y cinco años.`;
    const draft = await api('/api/drafts', { text });
    return api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId });
  }
  return { app, api, request, activate, save };
}

test('un conflicto conserva ambos valores y solo se resuelve con una explicación respaldada', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-conflict-'));
  let context = await start(directory);
  try {
    await context.activate('Ana Demo');
    const first = await context.save(null, 'Alpha');
    await context.activate('Luis Demo');
    const second = await context.save(first.hospitalId, 'Beta');
    let hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.deepEqual(new Set(hospital.installedBase.items.map(/** @param {any} item */ item => item.model)), new Set(['Alpha', 'Beta']));
    assert.equal(hospital.installedBase.conflicts.length, 1);
    const conflict = hospital.installedBase.conflicts[0];
    assert.equal(conflict.field, 'model'); assert.deepEqual(conflict.values, ['Alpha', 'Beta']);
    assert.deepEqual(new Set(conflict.sourceObservationIds), new Set([first.id, second.id]));

    const invalid = await context.request(`/api/conflicts/${conflict.id}/resolve`, { value: 'Alpha', explanation: '' });
    assert.equal(invalid.status, 400);
    const unsupported = await context.request(`/api/conflicts/${conflict.id}/resolve`, { value: 'Gamma', explanation: 'No corresponde a una fuente.' });
    assert.equal(unsupported.status, 400);
    await context.api(`/api/conflicts/${conflict.id}/resolve`, { value: 'Alpha', explanation: 'La visita de servicio verificó el modelo visible.' });
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.conflicts.length, 0);
    assert.equal(hospital.installedBase.conflictHistory[0].status, 'resolved');
    assert.equal(hospital.installedBase.conflictHistory[0].resolution.explanation, 'La visita de servicio verificó el modelo visible.');
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.model === 'Alpha'));
    assert.equal(hospital.installedBase.changeHistory.length, 1);
    assert.deepEqual({ oldValue: hospital.installedBase.changeHistory[0].oldValue, newValue: hospital.installedBase.changeHistory[0].newValue }, { oldValue: 'Beta', newValue: 'Alpha' });
    assert.equal(hospital.installedBase.changeHistory[0].author.name, 'Luis Demo');
    assert.equal(hospital.installedBase.changeHistory[0].reason, 'La visita de servicio verificó el modelo visible.');

    await context.app.close(); context = await start(directory);
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.conflicts.length, 0);
    assert.equal(hospital.installedBase.changeHistory.length, 1);
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.model === 'Alpha'));
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('una corrección sigue reportada y solo otro perfil puede confirmar el mismo dato', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-correction-'));
  const context = await start(directory);
  try {
    await context.activate('Ana Demo');
    const first = await context.save(null, 'Alpha');
    let hospital = await context.api('/api/hospitals/' + first.hospitalId);
    const firstItem = hospital.installedBase.items[0];
    await context.api(`/api/installed-equipment/${firstItem.id}/corrections`, { field: 'manufacturer', value: 'Acme', reason: 'Corrección tras revisar mis notas.' });
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.items[0].manufacturer, 'Acme');
    assert.equal(hospital.installedBase.items[0].fieldStates.manufacturer, 'Reportado');
    assert.equal(hospital.installedBase.changeHistory[0].kind, 'correction');

    await context.save(first.hospitalId, 'Alpha', 'Acme');
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.fieldStates.manufacturer === 'Reportado'));
    assert.ok(hospital.observations.every(/** @param {any} observation */ observation => observation.assessment.equipment[0].manufacturer.state === 'Reportado'));

    await context.activate('Luis Demo');
    await context.save(first.hospitalId, 'Alpha', 'Acme');
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.fieldStates.manufacturer === 'Confirmado'));
    assert.ok(hospital.installedBase.items.every(/** @param {any} item */ item => item.confirmations.manufacturer.some(/** @param {any} confirmation */ confirmation => confirmation.profileIds.length === 2)));
    assert.ok(hospital.observations.filter(/** @param {any} observation */ observation => observation.reviewed.equipment[0].manufacturer === 'Acme')
      .every(/** @param {any} observation */ observation => observation.assessment.equipment[0].manufacturer.state === 'Confirmado'));
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});
