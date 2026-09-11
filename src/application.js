import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { observationApi } from './observations.js';
import { RequestError } from './request-error.js';

/** @param {{ dataDirectory: string, port: number, probeQvac: () => Promise<{state: string, message: string}>, qvacStatus?: () => {state: string, message: string}, qvacDiagnostics?: () => {model: string | null, quantization: string | null, lastInference: any}, extractText?: import('./observation-schema.js').TextExtractor, interpretQuery?: (question: string) => Promise<{fields: unknown, metadata: unknown}>, now?: () => Date, confirmationResolver?: (record: any) => string[], probeVoice?: () => Promise<{state: string, message: string}>, voiceStatus?: () => {state: string, message: string}, voiceDiagnostics?: () => {model: string | null, quantization: string | null, lastInference: any}, transcribeAudio?: (audio: Buffer, language: string) => Promise<{transcript: string, metadata: unknown}>, probePlate?: () => Promise<{state: string, message: string}>, plateStatus?: () => {state: string, message: string}, plateDiagnostics?: () => {model: string | null, quantization: string | null, lastInference: any}, analyzeImage?: (image: Buffer) => Promise<{fields: unknown, ocrText: string, metadata: unknown}>, device?: string | null }} options */
export async function startApplication({ dataDirectory, port, probeQvac, qvacStatus, qvacDiagnostics = () => ({ model: null, quantization: null, lastInference: null }), extractText = async () => { throw new Error('QVAC no configurado'); }, interpretQuery, now = () => new Date(), confirmationResolver = () => [], probeVoice = async () => ({ state: 'unavailable', message: 'Modelo de voz no configurado.' }), voiceStatus, voiceDiagnostics = () => ({ model: null, quantization: null, lastInference: null }), transcribeAudio = async () => { throw new RequestError(503, 'La transcripción de voz local no está configurada.'); }, probePlate = async () => ({ state: 'unavailable', message: 'Modelo de evidencia fotográfica no configurado.' }), plateStatus, plateDiagnostics = () => ({ model: null, quantization: null, lastInference: null }), analyzeImage = async () => { throw new RequestError(503, 'El análisis local de evidencia fotográfica no está configurado.'); }, device = null }) {
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
  const publicDirectory = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
  const leafletDirectory = resolve(fileURLToPath(new URL('../node_modules/leaflet/dist/', import.meta.url)));
  const mime = new Map(Object.entries({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' }));
  /** @param {string} root @param {string} pathname */
  function safePath(root, pathname) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return null; }
    if (decoded.includes('\0') || decoded.split(/[\\/]+/).includes('..')) return null;
    const target = resolve(root, decoded.replace(/^[/\\]+/, ''));
    return target === root || target.startsWith(root + sep) ? target : null;
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; frame-ancestors 'none'");
    if (request.url === '/api/status' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ api: { state: 'ready', message: 'API local disponible' }, database: {
        state: 'ready', message: 'SQLite local disponible', installationId: installation?.id, starts: installation?.starts,
      }, device, qvac: { ...(qvacStatus?.() ?? qvac), diagnostics: qvacDiagnostics() },
      voice: { ...(voiceStatus?.() ?? voice), diagnostics: voiceDiagnostics() },
      plate: { ...(plateStatus?.() ?? plate), diagnostics: plateDiagnostics() } }));
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
        if (pathname === '/api/export/installed-base.csv' && request.method === 'GET') {
          const csv = await handleObservation('GET', '/api/export/installed-base.csv', undefined);
          response.setHeader('Content-Type', 'text/csv; charset=utf-8');
          response.setHeader('Content-Disposition', 'attachment; filename="sitesignal-base-instalada.csv"');
          response.end(csv);
          return;
        }
        if (pathname === '/api/export/state.json' && request.method === 'GET') {
          const data = await handleObservation('GET', '/api/export/state.json', undefined);
          response.setHeader('Content-Disposition', 'attachment; filename="sitesignal-estado.json"');
          response.end(JSON.stringify(data, null, 2));
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
    const pathname = new URL(request.url ?? '/', 'http://sitesignal.local').pathname;
    const isVendor = pathname.startsWith('/vendor/leaflet/');
    const relativePath = pathname === '/' ? '/index.html' : isVendor ? pathname.slice('/vendor/leaflet'.length) : pathname;
    if (isVendor && !/^\/(leaflet\.(?:js|css)|images\/[a-z0-9@._-]+)$/i.test(relativePath)) { response.writeHead(404).end(); return; }
    const asset = safePath(isVendor ? leafletDirectory : publicDirectory, relativePath);
    if (!asset || !mime.has(extname(asset).toLowerCase())) { response.writeHead(404).end(); return; }
    try {
      const contents = await readFile(asset);
      response.setHeader('Content-Type', mime.get(extname(asset).toLowerCase()) ?? 'application/octet-stream');
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
