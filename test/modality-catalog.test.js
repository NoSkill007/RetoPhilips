import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';
import { modalities } from '../src/observation-schema.js';

test('el catálogo de modalidades incluye las categorías ampliadas manteniendo Otro al final', () => {
  assert.deepEqual(modalities, ['Resonancia magnética', 'Tomografía computarizada', 'Ultrasonido', 'Monitoreo de pacientes', 'Rayos X', 'Sistema intervencionista',
    'Mamografía', 'Medicina nuclear / PET', 'Electrocardiografía', 'Ventilación mecánica', 'Desfibrilador', 'Endoscopia', 'Otro']);
});

test('una modalidad nueva se extrae, se filtra en el panorama y se agrupa en la consulta natural, sin alterar el dataset ficticio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-modality-catalog-'));
  const app = await startApplication({
    dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({
      fields: { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
        { modality: 'endoscopio', quantity: 'una', manufacturer: null, model: null, serial: null, age: null },
      ] },
      metadata: { engine: 'test', model: 'fixture', durationMs: 1 },
    }),
    interpretQuery: async () => ({ fields: { intent: 'filter', filters: { country: null, city: null, client: null, hospital: null,
      modality: 'Endoscopia', minAge: null, maxAge: null, state: null, confidence: null, freshness: null }, ambiguity: null },
      metadata: { engine: 'QVAC', model: 'fixture', durationMs: 1 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const draft = await api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un endoscopio, cantidad una.' });
    assert.equal(draft.reviewed.equipment[0].modality, 'Endoscopia');
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });

    const panorama = await api('/api/panorama');
    assert.ok(panorama.filters.modalities.includes('Endoscopia'));
    const filtered = await api('/api/panorama?modality=' + encodeURIComponent('Endoscopia'));
    assert.equal(filtered.metrics.equipment, 1);
    assert.equal(filtered.hospitals[0].id, saved.hospitalId);
    // the demo dataset was seeded before the catalog grew and must stay on the original 7 categories.
    assert.deepEqual(panorama.aggregations.modality.map(/** @param {any} entry */ entry => entry.value).sort(), ['Endoscopia', 'Otro', 'Resonancia magnética', 'Sistema intervencionista', 'Tomografía computarizada', 'Ultrasonido', 'Monitoreo de pacientes', 'Rayos X'].sort());

    const query = await api('/api/natural-query', { question: 'Show me endoscopy equipment' });
    assert.equal(query.status, 'applied');
    assert.equal(query.filters.modality, 'Endoscopia');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
