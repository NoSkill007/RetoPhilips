import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** @param {{ dataDirectory: string, port: number, probeQvac: () => Promise<{state: string, message: string}> }} options */
export async function startApplication({ dataDirectory, port, probeQvac }) {
  await mkdir(dataDirectory, { recursive: true });
  const db = new DatabaseSync(join(dataDirectory, 'sitesignal.db'));
  try {
    db.exec('CREATE TABLE IF NOT EXISTS installation (id TEXT PRIMARY KEY, starts INTEGER NOT NULL)');
    db.prepare('INSERT INTO installation SELECT ?, 0 WHERE NOT EXISTS (SELECT 1 FROM installation)').run(randomUUID());
    db.exec('UPDATE installation SET starts = starts + 1');
  } catch (error) { db.close(); throw error; }
  const installation = db.prepare('SELECT id, starts FROM installation').get();
  let qvac = { state: 'degraded', message: 'Comprobando el modelo local…' };
  const probe = Promise.resolve().then(probeQvac).then(result => { qvac = result; }).catch(() => {
    qvac = { state: 'unavailable', message: 'No se pudo comprobar QVAC. Revisa la preparación y reinicia.' };
  });
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/api/status') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ api: { state: 'ready', message: 'API local disponible' }, database: {
        state: 'ready', message: 'SQLite local disponible', installationId: installation?.id, starts: installation?.starts,
      }, qvac }));
      return;
    }
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
  } };
}
