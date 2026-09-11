import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { observationApi } from './observations.js';
import { RequestError } from './request-error.js';

/** @param {{ dataDirectory: string, port: number, probeQvac: () => Promise<{state: string, message: string}>, qvacStatus?: () => {state: string, message: string}, extractText?: import('./observation-schema.js').TextExtractor, interpretQuery?: (question: string) => Promise<{fields: unknown, metadata: unknown}>, now?: () => Date, confirmationResolver?: (record: any) => string[], probeVoice?: () => Promise<{state: string, message: string}>, voiceStatus?: () => {state: string, message: string}, transcribeAudio?: (audio: Buffer, language: string) => Promise<{transcript: string, metadata: unknown}>, probePlate?: () => Promise<{state: string, message: string}>, plateStatus?: () => {state: string, message: string}, analyzeImage?: (image: Buffer) => Promise<{fields: unknown, ocrText: string, metadata: unknown}> }} options */
export async function startApplication({ dataDirectory, port, probeQvac, qvacStatus, extractText = async () => { throw new Error('QVAC no configurado'); }, interpretQuery, now = () => new Date(), confirmationResolver = () => [], probeVoice = async () => ({ state: 'unavailable', message: 'Modelo de voz no configurado.' }), voiceStatus, transcribeAudio = async () => { throw new RequestError(503, 'La transcripción de voz local no está configurada.'); }, probePlate = async () => ({ state: 'unavailable', message: 'Modelo de evidencia fotográfica no configurado.' }), plateStatus, analyzeImage = async () => { throw new RequestError(503, 'El análisis local de evidencia fotográfica no está configurado.'); } }) {
  await mkdir(dataDirectory, { recursive: true });
  const db = new DatabaseSync(join(dataDirectory, 'sitesignal.db'));
  try {
    db.exec('CREATE TABLE IF NOT EXISTS installation (id TEXT PRIMARY KEY, starts INTEGER NOT NULL)');
    db.prepare('INSERT INTO installation SELECT ?, 0 WHERE NOT EXISTS (SELECT 1 FROM installation)').run(randomUUID());
    db.exec('UPDATE installation SET starts = starts + 1');
  } catch (error) { db.close(); throw error; }
  const installation = db.prepare('SELECT id, starts FROM installation').get();
  const handleObservation = observationApi(db, extractText, now, confirmationResolver, interpretQuery, analyzeImage);
  let qvac = { state: 'degraded', message: 'Comprobando el modelo local…' };
  const probe = Promise.resolve().then(probeQvac).then(result => { qvac = result; }).catch(() => {
    qvac = { state: 'unavailable', message: 'No se pudo comprobar QVAC. Revisa la preparación y reinicia.' };
  });
  let voice = { state: 'degraded', message: 'Comprobando el modelo de voz local…' };
  const voiceProbe = Promise.resolve().then(probeVoice).then(result => { voice = result; }).catch(() => {
    voice = { state: 'unavailable', message: 'No se pudo comprobar el modelo de voz. Revisa la preparación y reinicia.' };
  });
  let plate = { state: 'degraded', message: 'Comprobando el modelo de evidencia fotográfica local…' };
  const plateProbe = Promise.resolve().then(probePlate).then(result => { plate = result; }).catch(() => {
    plate = { state: 'unavailable', message: 'No se pudo comprobar el modelo de evidencia fotográfica. Revisa la preparación y reinicia.' };
  });
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/capture.js', ['capture.js', 'text/javascript; charset=utf-8']],
    ['/panorama.js', ['panorama.js', 'text/javascript; charset=utf-8']],
    ['/voice.js', ['voice.js', 'text/javascript; charset=utf-8']],
    ['/evidence.js', ['evidence.js', 'text/javascript; charset=utf-8']],
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (request.url === '/api/status' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ api: { state: 'ready', message: 'API local disponible' }, database: {
        state: 'ready', message: 'SQLite local disponible', installationId: installation?.id, starts: installation?.starts,
      }, qvac: qvacStatus?.() ?? qvac, voice: voiceStatus?.() ?? voice, plate: plateStatus?.() ?? plate }));
      return;
    }
    if (request.url?.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json');
      try {
        const pathname = new URL(request.url, 'http://sitesignal.local').pathname;
        if (pathname === '/api/transcriptions' && request.method === 'POST') {
          const origin = request.headers.origin;
          if (origin && origin !== `http://${request.headers.host}`) throw new RequestError(403, 'Origen no permitido.');
          if (!request.headers['content-type']?.startsWith('audio/')) throw new RequestError(415, 'Se requiere audio.');
          const language = new URL(request.url, 'http://sitesignal.local').searchParams.get('language');
          if (language !== 'es' && language !== 'en') throw new RequestError(400, 'Indica el idioma: es o en.');
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 15 * 1024 * 1024) throw new RequestError(413, 'El audio es demasiado extenso.');
            chunks.push(chunk);
          }
          if (!size) throw new RequestError(400, 'No se recibió audio.');
          response.end(JSON.stringify(await transcribeAudio(Buffer.concat(chunks), language)));
          return;
        }
        if (pathname === '/api/evidence' && request.method === 'POST') {
          const origin = request.headers.origin;
          if (origin && origin !== `http://${request.headers.host}`) throw new RequestError(403, 'Origen no permitido.');
          const contentType = request.headers['content-type'] ?? '';
          if (!contentType.startsWith('image/')) throw new RequestError(415, 'Se requiere una imagen.');
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) throw new RequestError(413, 'La imagen es demasiado extensa.');
            chunks.push(chunk);
          }
          if (!size) throw new RequestError(400, 'No se recibió imagen.');
          response.end(JSON.stringify(await handleObservation('POST', '/api/evidence', { image: Buffer.concat(chunks), mimeType: contentType })));
          return;
        }
        let body;
        if (request.method === 'POST') {
          const origin = request.headers.origin;
          if (origin && origin !== `http://${request.headers.host}`) throw new RequestError(403, 'Origen no permitido.');
          if (!request.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Se requiere JSON.');
          let text = '';
          for await (const chunk of request) {
            text += chunk.toString();
            if (Buffer.byteLength(text) > 65536) throw new RequestError(413, 'La observación es demasiado extensa.');
          }
          try { body = JSON.parse(text); } catch { throw new RequestError(400, 'JSON no válido.'); }
        }
        response.end(JSON.stringify(await handleObservation(request.method ?? 'GET', request.url, body)));
      } catch (error) {
        const status = error instanceof RequestError ? error.status : error instanceof ZodError ? 400 : 500;
        response.writeHead(status).end(JSON.stringify({ error: error instanceof RequestError ? error.message : status === 400 ? 'Revisa los campos y sus valores.' : 'No se pudo completar la operación local.' }));
      }
      return;
    }
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const asset = assets.get(request.url ?? '');
    if (!asset) { response.writeHead(404).end(); return; }
    try {
      const contents = await readFile(new URL('../public/' + asset[0], import.meta.url));
      response.setHeader('Content-Type', asset[1]);
      response.end(contents);
    } catch { response.writeHead(500).end('No se pudo abrir la interfaz local. Revisa los archivos de instalación.'); }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(undefined));
    });
  } catch (error) { db.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Dirección local no disponible');
  let closed = false;
  return { url: `http://127.0.0.1:${address.port}`, async close() {
    if (closed) return;
    closed = true;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)));
    db.close();
    await probe;
    await voiceProbe;
    await plateProbe;
  } };
}
