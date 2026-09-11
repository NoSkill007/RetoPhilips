import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const FAKE_WAV = Buffer.from('RIFF....WAVEfmt ', 'utf8');

/** @param {(audio: Buffer, language: string) => Promise<{transcript: string, metadata: unknown}>} transcribeAudio */
async function fixture(transcribeAudio) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-voice-'));
  const app = await startApplication({ dataDirectory: directory, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    probeVoice: async () => ({ state: 'ready', message: 'Listo' }), transcribeAudio,
    extractText: async () => { throw new Error('no usado en estas pruebas'); } });
  /** @param {string} path @param {Buffer | undefined} body @param {Record<string,string>} [headers] */
  async function post(path, body, headers = { 'Content-Type': 'audio/wav' }) {
    return fetch(app.url + path, { method: 'POST', headers, body: /** @type {any} */ (body) });
  }
  return { app, directory, post };
}

test('una transcripción exitosa devuelve el texto y la procedencia local de QVAC', async () => {
  const context = await fixture(async (audio, language) => {
    assert.ok(Buffer.isBuffer(audio)); assert.equal(audio.length, FAKE_WAV.length); assert.equal(language, 'es');
    return { transcript: 'Visité Hospital Aurora. Vi un tomógrafo de ocho años.', metadata: { engine: 'QVAC', model: 'ggml-base-q8_0.bin', durationMs: 1234, device: 'local' } };
  });
  try {
    const response = await context.post('/api/transcriptions?language=es', FAKE_WAV);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.transcript, 'Visité Hospital Aurora. Vi un tomógrafo de ocho años.');
    assert.deepEqual(body.metadata, { engine: 'QVAC', model: 'ggml-base-q8_0.bin', durationMs: 1234, device: 'local' });
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('el idioma debe ser es o en; cualquier otro valor se rechaza', async () => {
  const context = await fixture(async () => { throw new Error('no debería llamarse'); });
  try {
    const missing = await context.post('/api/transcriptions', FAKE_WAV);
    assert.equal(missing.status, 400);
    const invalid = await context.post('/api/transcriptions?language=fr', FAKE_WAV);
    assert.equal(invalid.status, 400);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('se exige un tipo de contenido de audio y bytes no vacíos', async () => {
  const context = await fixture(async () => { throw new Error('no debería llamarse'); });
  try {
    const wrongType = await context.post('/api/transcriptions?language=es', FAKE_WAV, { 'Content-Type': 'application/json' });
    assert.equal(wrongType.status, 415);
    const empty = await context.post('/api/transcriptions?language=es', Buffer.alloc(0));
    assert.equal(empty.status, 400);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un fallo de transcripción no deja el servicio inutilizable para el siguiente intento', async () => {
  let attempts = 0;
  const context = await fixture(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('QVAC no pudo transcribir el audio.');
    return { transcript: 'Reintento correcto.', metadata: { engine: 'QVAC', model: 'ggml-base-q8_0.bin', durationMs: 500, device: 'local' } };
  });
  try {
    const failed = await context.post('/api/transcriptions?language=en', FAKE_WAV);
    assert.equal(failed.status, 500);
    const retried = await context.post('/api/transcriptions?language=en', FAKE_WAV);
    assert.equal(retried.status, 200);
    assert.equal((await retried.json()).transcript, 'Reintento correcto.');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('sin transcribeAudio configurado, el endpoint informa que la voz local no está lista', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-voice-unconfigured-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }) });
  try {
    const response = await fetch(app.url + '/api/transcriptions?language=es', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: FAKE_WAV });
    assert.equal(response.status, 503);
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.voice.state, 'unavailable');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('la transcripción revisada continúa por el mismo flujo confiable de captura escrita', async () => {
  const directory2 = await mkdtemp(join(tmpdir(), 'sitesignal-voice-flow-'));
  const app = await startApplication({ dataDirectory: directory2, port: 0,
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    probeVoice: async () => ({ state: 'ready', message: 'Listo' }),
    transcribeAudio: async () => ({ transcript: 'Visité Hospital Aurora. Vi un tomógrafo Marca Ficticia, modelo Modelo Ficticio, y ocho años.', metadata: { engine: 'QVAC', model: 'ggml-base-q8_0.bin', durationMs: 900, device: 'local' } }),
    extractText: async () => ({ fields: { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'Marca Ficticia', model: 'Modelo Ficticio', serial: null, age: 'ocho años' },
    ] }, metadata: { engine: 'test', model: 'fixture', durationMs: 1 } }) });
  /** @param {string} path @param {unknown} [body] */
  async function api(path, body) {
    const response = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text()); return response.json();
  }
  try {
    const transcription = await (await fetch(app.url + '/api/transcriptions?language=es', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: FAKE_WAV })).json();
    const profile = await api('/api/profiles', { name: 'Ana Demo', role: 'Ingeniero de servicio' });
    await api('/api/profiles/active', { profileId: profile.id });
    const draft = await api('/api/drafts', { text: transcription.transcript });
    assert.equal(draft.provenance.kind, 'qvac');
    assert.equal(draft.reviewed.hospital, 'Hospital Aurora');
    assert.equal(draft.reviewed.equipment[0].modality, 'Tomografía computarizada');
    const saved = await api('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    assert.equal(saved.originalText, transcription.transcript);
  } finally { await app.close(); await rm(directory2, { recursive: true, force: true }); }
});
