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
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response;
  }
  /** @param {string} path @param {unknown} [body] */
  async function ok(path, body) { const response = await api(path, body); assert.ok(response.ok, await response.clone().text()); return response.json(); }
  const profile = await ok('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
  await ok('/api/profiles/active', { profileId: profile.id });
  /** @param {any} nextFields @param {string} text */
  async function draftFor(nextFields, text) { fields = nextFields; return ok('/api/drafts', { text }); }
  return { app, api, ok, draftFor };
}

test('crear dos veces un hospital con el mismo nombre y cliente rechaza el segundo en vez de duplicarlo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-hospital-dup-'));
  const context = await setup(directory);
  const fields = { client: 'Red Ficticia', hospital: 'Hospital Único Ficticio', area: null, equipment: [
    { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X1', serial: 'SN-100', age: 'ocho años' },
  ] };
  try {
    const draft1 = await context.draftFor(fields, 'Visité Hospital Único Ficticio de Red Ficticia. Vi un tomógrafo DemoMed X1, número de serie SN-100, ocho años.');
    const saved1 = await context.ok('/api/observations', { draftId: draft1.id, reviewed: draft1.reviewed, hospitalId: null });
    assert.ok(saved1.hospitalId);

    const draft2 = await context.draftFor(fields, 'Otra visita: Hospital Único Ficticio de Red Ficticia. Vi un tomógrafo DemoMed X1, número de serie SN-100, ocho años.');
    const response2 = await context.api('/api/observations', { draftId: draft2.id, reviewed: draft2.reviewed, hospitalId: null });
    assert.equal(response2.status, 409);
    const error = await response2.json();
    assert.match(error.error, /ya existe un hospital/i);

    const hospitals = await context.ok('/api/hospitals');
    assert.equal(hospitals.filter(/** @param {any} h */ h => h.name === 'Hospital Único Ficticio').length, 1, 'no debe existir un segundo hospital con el mismo nombre');

    // the correct recovery: resubmit the same draft, this time selecting the existing hospital explicitly.
    const saved2 = await context.ok('/api/observations', { draftId: draft2.id, reviewed: draft2.reviewed, hospitalId: saved1.hospitalId });
    assert.equal(saved2.hospitalId, saved1.hospitalId);
    const hospital = await context.ok('/api/hospitals/' + saved1.hospitalId);
    assert.equal(hospital.observations.length, 2);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('el mismo nombre de hospital bajo un cliente distinto no se bloquea', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-hospital-dup-client-'));
  const context = await setup(directory);
  try {
    const draft1 = await context.draftFor({ client: 'Red A Ficticia', hospital: 'Hospital Genérico Ficticio', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X1', serial: 'SN-A1', age: null },
    ] }, 'Cliente Red A Ficticia. Visité Hospital Genérico Ficticio. Vi un tomógrafo DemoMed X1, número de serie SN-A1.');
    const saved1 = await context.ok('/api/observations', { draftId: draft1.id, reviewed: draft1.reviewed, hospitalId: null });
    assert.equal(saved1.reviewed.client, 'Red A Ficticia');

    const draft2 = await context.draftFor({ client: 'Red B Ficticia', hospital: 'Hospital Genérico Ficticio', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X2', serial: 'SN-B1', age: null },
    ] }, 'Cliente Red B Ficticia. Visité Hospital Genérico Ficticio. Vi un tomógrafo DemoMed X2, número de serie SN-B1.');
    assert.equal(draft2.reviewed.client, 'Red B Ficticia');
    const saved2 = await context.ok('/api/observations', { draftId: draft2.id, reviewed: draft2.reviewed, hospitalId: null });

    assert.notEqual(saved1.hospitalId, saved2.hospitalId);
    const hospitals = await context.ok('/api/hospitals');
    assert.equal(hospitals.filter(/** @param {any} h */ h => h.name === 'Hospital Genérico Ficticio').length, 2);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('el mismo nombre de hospital en una ciudad distinta no se bloquea', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-hospital-dup-city-'));
  const context = await setup(directory);
  try {
    const draft1 = await context.draftFor({ client: null, hospital: 'Hospital Central Ficticio', area: null, city: 'Ciudad Norte Ficticia', country: 'Panamá', equipment: [
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X1', serial: 'SN-N1', age: null },
    ] }, 'Visité Hospital Central Ficticio, ciudad Ciudad Norte Ficticia, país Panamá. Vi un tomógrafo DemoMed X1, número de serie SN-N1.');
    const saved1 = await context.ok('/api/observations', { draftId: draft1.id, reviewed: draft1.reviewed, hospitalId: null });
    assert.equal(saved1.reviewed.city, 'Ciudad Norte Ficticia');

    const draft2 = await context.draftFor({ client: null, hospital: 'Hospital Central Ficticio', area: null, city: 'Ciudad Sur Ficticia', country: 'Panamá', equipment: [
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X2', serial: 'SN-S1', age: null },
    ] }, 'Visité Hospital Central Ficticio, ciudad Ciudad Sur Ficticia, país Panamá. Vi un tomógrafo DemoMed X2, número de serie SN-S1.');
    assert.equal(draft2.reviewed.city, 'Ciudad Sur Ficticia');
    const saved2 = await context.ok('/api/observations', { draftId: draft2.id, reviewed: draft2.reviewed, hospitalId: null });

    assert.notEqual(saved1.hospitalId, saved2.hospitalId);
  } finally { await context.app.close(); await rm(directory, { recursive: true, force: true }); }
});
