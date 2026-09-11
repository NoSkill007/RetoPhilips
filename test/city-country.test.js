import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startApplication } from '../src/application.js';

test('una observación captura ciudad y país, y el panorama regional los refleja en vez de los marcadores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-city-country-'));
  const app = await startApplication({
    dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({
      fields: { client: null, hospital: 'Hospital Aurora', area: null, city: 'São Paulo', country: 'Brasil', equipment: [
        { modality: 'tomógrafo', quantity: 'una', manufacturer: 'DemoMed', model: 'X100', serial: 'SN-CC-1', age: 'ocho años' },
      ] },
      metadata: { engine: 'test', model: 'fixture', durationMs: 1 },
    }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const draft = await api('/api/drafts', { text: 'Estoy en São Paulo, Brasil, en el Hospital Aurora. Vi un tomógrafo DemoMed X100, serie SN-CC-1 y ocho años.' });
    assert.equal(draft.reviewed.city, 'São Paulo');
    assert.equal(draft.reviewed.country, 'Brasil');
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });

    const panorama = await api('/api/panorama');
    const summary = panorama.hospitals.find(/** @param {any} entry */ entry => entry.id === saved.hospitalId);
    assert.equal(summary.city, 'São Paulo');
    assert.equal(summary.country, 'Brasil');

    const hospital = await api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.city, 'São Paulo');
    assert.equal(hospital.country, 'Brasil');
    // a captured hospital's region is derived automatically from its country, not asked of QVAC or the
    // collaborator — Brasil is Latin American like the rest of this prototype's dataset.
    assert.equal(hospital.region, 'América Latina');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('una base de datos existente sin columnas de ciudad/país migra sin perder el hospital ya guardado', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-legacy-schema-'));
  await mkdir(directory, { recursive: true });
  const legacyId = randomUUID();
  const legacy = new DatabaseSync(join(directory, 'sitesignal.db'));
  legacy.exec('CREATE TABLE hospitals (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT)');
  legacy.prepare('INSERT INTO hospitals VALUES (?, ?, ?)').run(legacyId, 'Hospital Legado', 'Cliente Legado');
  legacy.close();

  const app = await startApplication({
    dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => { throw new Error('no usado'); },
  });
  /** @param {string} path */
  async function get(path) { const response = await fetch(app.url + path); assert.ok(response.ok, await response.clone().text()); return response.json(); }
  try {
    const hospitals = await get('/api/hospitals');
    const legacyHospital = hospitals.find(/** @param {any} entry */ entry => entry.id === legacyId);
    assert.ok(legacyHospital, 'el hospital creado antes de la migración sigue disponible');
    assert.equal(legacyHospital.name, 'Hospital Legado');
    assert.equal(legacyHospital.city ?? null, null);
    assert.equal(legacyHospital.country ?? null, null);
    assert.equal(legacyHospital.region ?? null, null);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
