import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

/** @param {string} directory */
async function setup(directory) {
  /** @type {any} */
  let fields;
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
  await api('/api/profiles/active', { profileId: profile.id });
  /** @param {any} nextFields @param {string} text @param {string | null} hospitalId */
  async function save(nextFields, text, hospitalId) {
    fields = nextFields;
    const draft = await api('/api/drafts', { text });
    return api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId });
  }
  return { app, api, save };
}

test('una serie idéntica crea un candidato fuerte y conservar separados no cambia la base instalada', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-serial-duplicate-'));
  const context = await setup(directory);
  try {
    const fields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'una', manufacturer: 'DemoMed', model: 'CTX', serial: 'SN-900', age: 'cinco años' },
    ] };
    const text = 'Visité Hospital Aurora. Vi un tomógrafo, cantidad una, fabricante DemoMed, modelo CTX, número de serie SN-900 y cinco años.';
    const first = await context.save(fields, text, null);
    await context.save(fields, text, first.hospitalId);
    let hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.total, 2);
    assert.equal(hospital.installedBase.items.length, 2);
    assert.equal(hospital.installedBase.duplicateCandidates.length, 1);
    const candidate = hospital.installedBase.duplicateCandidates[0];
    assert.equal(candidate.kind, 'serial');
    assert.ok(candidate.matchingFields.some(/** @param {any} match */ match => match.field === 'serial'));

    const decision = await context.api(`/api/duplicate-candidates/${candidate.id}/decision`, { decision: 'keep-separate' });
    assert.equal(decision.status, 'kept-separate');
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.total, 2);
    assert.equal(hospital.installedBase.items.length, 2);
    assert.equal(hospital.installedBase.duplicateCandidates.length, 0);
    const differentSerial = structuredClone(fields); differentSerial.equipment[0].serial = 'SN-901';
    await context.save(differentSerial, text.replaceAll('SN-900', 'SN-901'), first.hospitalId);
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.equal(hospital.installedBase.duplicateCandidates.length, 0);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('una coincidencia aproximada explica diferencias y solo consolida por decisión humana', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-approximate-duplicate-'));
  const context = await setup(directory);
  try {
    const firstFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'resonancias', quantity: 'tres', manufacturer: 'DemoMed', model: 'Alpha', serial: null, age: 'ocho años' },
    ] };
    const firstText = 'Visité Hospital Aurora. Vi tres resonancias, fabricante DemoMed, modelo Alpha, con ocho años.';
    const first = await context.save(firstFields, firstText, null);
    const secondFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'resonancias', quantity: 'tres', manufacturer: 'DemoMed', model: 'Beta', serial: null, age: 'nueve años' },
    ] };
    const secondText = 'Visité Hospital Aurora. Vi tres resonancias, fabricante DemoMed, modelo Beta, con nueve años.';
    const second = await context.save(secondFields, secondText, first.hospitalId);
    let hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.total, 6);
    const candidate = hospital.installedBase.duplicateCandidates[0];
    assert.equal(candidate.kind, 'approximate');
    assert.ok(candidate.matchingFields.some(/** @param {any} match */ match => match.field === 'quantity'));
    assert.ok(candidate.matchingFields.some(/** @param {any} match */ match => match.field === 'age'));
    assert.ok(candidate.conflictingFields.some(/** @param {any} conflict */ conflict => conflict.field === 'model'));

    const decision = await context.api(`/api/duplicate-candidates/${candidate.id}/decision`, { decision: 'consolidate' });
    assert.equal(decision.status, 'consolidated');
    hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.total, 3);
    assert.equal(hospital.installedBase.items.length, 1);
    const consolidated = hospital.installedBase.items[0];
    assert.equal(consolidated.kind, 'consolidated');
    assert.deepEqual(new Set(consolidated.sourceObservationIds), new Set([first.id, second.id]));
    assert.equal(consolidated.consolidation.originals.length, 2);
    assert.equal(consolidated.consolidation.decision.profile.name, 'Ana Demo');
    assert.equal(hospital.installedBase.conflicts.length, 1);
    assert.equal(hospital.installedBase.conflicts[0].field, 'model');
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('dos reportes escasos del mismo hospital y modalidad, con cantidades distintas, se marcan como candidato en vez de duplicarse en silencio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-sparse-duplicate-'));
  const context = await setup(directory);
  try {
    // Neither report names a manufacturer, model or age — the least detailed, most duplicate-prone case,
    // and previously the one the system was least able to flag (see HANDOFF.md for the full story).
    const firstFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafos', quantity: 'dos', manufacturer: null, model: null, serial: null, age: null },
    ] };
    const first = await context.save(firstFields, 'Visité Hospital Aurora. Vi dos tomógrafos.', null);
    const secondFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafos', quantity: 'cinco', manufacturer: null, model: null, serial: null, age: null },
    ] };
    const second = await context.save(secondFields, 'Visité Hospital Aurora. Vi cinco tomógrafos.', first.hospitalId);
    const hospital = await context.api('/api/hospitals/' + first.hospitalId);
    // both group records still exist — nothing merges or drops without a human decision — but now there is
    // exactly one pending candidate explaining the ambiguity, instead of a silent, uncommented 2+5=7 total.
    assert.equal(hospital.installedBase.items.length, 2);
    assert.equal(hospital.installedBase.duplicateCandidates.length, 1);
    const candidate = hospital.installedBase.duplicateCandidates[0];
    assert.equal(candidate.kind, 'approximate');
    assert.ok(candidate.matchingFields.some(/** @param {any} match */ match => match.field === 'modality'));
    assert.ok(candidate.conflictingFields.some(/** @param {any} match */ match => match.field === 'quantity' && match.left === 2 && match.right === 5));
    assert.deepEqual(new Set(candidate.itemIds), new Set(hospital.installedBase.items.map(/** @param {any} item */ item => item.id)));

    const decision = await context.api(`/api/duplicate-candidates/${candidate.id}/decision`, { decision: 'consolidate' });
    assert.equal(decision.status, 'consolidated');
    const resolved = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(resolved.installedBase.items.length, 1);
    // consolidation takes the larger reported count rather than adding them — a recount, not two groups.
    assert.equal(resolved.installedBase.items[0].quantity, 5);
    assert.equal(resolved.installedBase.total, 5);
    assert.deepEqual(new Set(resolved.installedBase.items[0].sourceObservationIds), new Set([first.id, second.id]));
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un fabricante y modelo genuinamente distintos para la misma modalidad no se marcan como candidato', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-distinct-equipment-'));
  const context = await setup(directory);
  try {
    const firstFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'ecógrafos', quantity: 'dos', manufacturer: 'DemoMed', model: 'Alpha', serial: null, age: null },
    ] };
    const first = await context.save(firstFields, 'Visité Hospital Aurora. Vi dos ecógrafos DemoMed Alpha.', null);
    const secondFields = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'ecógrafos', quantity: 'tres', manufacturer: 'OtraMarca', model: 'Zeta', serial: null, age: null },
    ] };
    await context.save(secondFields, 'Visité Hospital Aurora. Vi tres ecógrafos OtraMarca Zeta.', first.hospitalId);
    const hospital = await context.api('/api/hospitals/' + first.hospitalId);
    assert.equal(hospital.installedBase.items.length, 2);
    assert.equal(hospital.installedBase.duplicateCandidates.length, 0);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});
