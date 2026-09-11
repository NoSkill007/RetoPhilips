import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const extracted = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
  { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'DemoMed', model: 'X100', serial: 'SN-PROV-1', age: 'ocho años' },
] };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-provenance-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    extractText: async () => ({ fields: extracted, metadata: { engine: 'deterministic-test', model: 'fixture', durationMs: 10 } }),
  });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  return { app, directory, api };
}

test('sin indicar canal, la procedencia registra "text" por defecto', async () => {
  const context = await fixture();
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed X100, serie SN-PROV-1 y ocho años.' });
    assert.equal(draft.provenance.channel, 'text');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('con source "voice", la procedencia del borrador y de la observación guardada registran el dictado', async () => {
  const context = await fixture();
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed X100, serie SN-PROV-1 y ocho años.', source: 'voice' });
    assert.equal(draft.provenance.channel, 'voice');
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    assert.equal(saved.provenance.channel, 'voice');
    const hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].provenance.channel, 'voice');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un comentario adicional se guarda con la observación y no se valida contra el relato', async () => {
  const context = await fixture();
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed X100, serie SN-PROV-1 y ocho años.' });
    assert.equal(draft.reviewed.comments ?? null, null);
    const reviewed = { ...draft.reviewed, comments: 'El equipo se ve deteriorado; recomendar revisión de mantenimiento.' };
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed, hospitalId: null });
    assert.equal(saved.reviewed.comments, 'El equipo se ve deteriorado; recomendar revisión de mantenimiento.');
    const hospital = await context.api('/api/hospitals/' + saved.hospitalId);
    assert.equal(hospital.observations[0].reviewed.comments, 'El equipo se ve deteriorado; recomendar revisión de mantenimiento.');
    // an untouched comment field must never surface as a "rejected, not backed by the source" issue —
    // it is the collaborator's own note, not a claim validated against the original text.
    assert.deepEqual(saved.provenance.validationIssues.some(/** @param {string} issue */ issue => /omentario/i.test(issue)), false);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una observación sin comentario lo guarda como null, no como cadena vacía', async () => {
  const context = await fixture();
  try {
    const profile = await context.api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await context.api('/api/profiles/active', { profileId: profile.id });
    const draft = await context.api('/api/drafts', { text: 'Visité Hospital Aurora. Vi un tomógrafo DemoMed X100, serie SN-PROV-1 y ocho años.' });
    const saved = await context.api('/api/observations', { draftId: draft.id, reviewed: { ...draft.reviewed, comments: null }, hospitalId: null });
    assert.equal(saved.reviewed.comments, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
