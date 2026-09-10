import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const source = 'Visité Hospital Aurora. Vi dos tomógrafos fabricante DemoMed.';
const valid = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
  { modality: 'tomógrafos', quantity: 'dos', manufacturer: 'DemoMed', model: null, serial: null, age: null },
] };

/** @param {(text: string, options?: {attempt: number, correctiveInstruction?: string}) => Promise<any>} extractText */
async function scenario(extractText) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-validation-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, extractText,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }) });
  /** @param {string} path @param {unknown} body */
  async function post(path, body) {
    const response = await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  const profile = await post('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
  await post('/api/profiles/active', { profileId: profile.id });
  return { directory, app, post };
}

test('una extracción válida queda lista para revisión sin reintentar', async () => {
  let calls = 0;
  const context = await scenario(async () => { calls += 1; return { fields: valid, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 5 } }; });
  try {
    const draft = await context.post('/api/drafts', { text: source });
    assert.equal(calls, 1); assert.equal(draft.mode, 'qvac'); assert.equal(draft.attempts, 1); assert.deepEqual(draft.validationIssues, []);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una salida inválida se corrige mediante un único reintento', async () => {
  /** @type {Array<{attempt: number, correctiveInstruction?: string} | undefined>} */
  const calls = [];
  const context = await scenario(async (_text, options) => {
    calls.push(options);
    if (calls.length === 1) return { fields: { hospital: 'Hospital Aurora' }, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 4 } };
    return { fields: valid, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 6 } };
  });
  try {
    const draft = await context.post('/api/drafts', { text: source });
    const second = calls[1];
    assert.equal(calls.length, 2); assert.ok(second); assert.equal(second.attempt, 2); assert.match(second.correctiveInstruction ?? '', /estructura|schema/i);
    assert.equal(draft.mode, 'qvac'); assert.equal(draft.attempts, 2); assert.equal(draft.retryCorrected, true);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('dos fallos abren captura manual sin perder el relato y distinguen la procedencia', async () => {
  let calls = 0;
  const context = await scenario(async () => { calls += 1; throw new Error('JSON inválido'); });
  try {
    const draft = await context.post('/api/drafts', { text: source });
    assert.equal(calls, 2); assert.equal(draft.mode, 'manual'); assert.equal(draft.originalText, source);
    assert.equal(draft.inference.engine, 'Manual'); assert.equal(draft.reviewed.hospital, null);
    draft.reviewed.hospital = 'Hospital Aurora';
    const saved = await context.post('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    assert.equal(saved.inference.engine, 'Manual'); assert.equal(saved.mode, 'manual'); assert.equal(saved.originalText, source);
    assert.ok(saved.validationIssues.length > 0);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('modalidades y afirmaciones sin respaldo se rechazan visiblemente', async () => {
  const unsupportedSource = 'Visité Hospital Aurora. Vi dos teletransportadores.';
  const claims = { client: 'Aurora', hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'teletransportadores', quantity: 'dos', manufacturer: 'Inventado', model: null, serial: null, age: null },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text: unsupportedSource });
    assert.equal(draft.mode, 'manual'); assert.equal(draft.reviewed.equipment[0].modality, null);
    assert.ok(draft.validationIssues.some(/** @param {string} issue */ issue => /modalidad/i.test(issue)));
    assert.ok(draft.validationIssues.some(/** @param {string} issue */ issue => /fabricante/i.test(issue)));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
