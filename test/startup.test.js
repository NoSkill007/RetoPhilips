import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';
import { probeQvac } from '../src/qvac.js';

test('la API inicia en loopback y conserva la instalación al reiniciar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-'));
  const options = { dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Modelo local cargado' }) };
  let app;
  try {
    app = await startApplication(options);
    const first = await (await fetch(app.url + '/api/status')).json();
    assert.equal(first.api.state, 'ready');
    assert.equal(first.database.state, 'ready');
    assert.match(app.url, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(first.database.starts, 1);
    await app.close();
    app = await startApplication(options);
    const second = await (await fetch(app.url + '/api/status')).json();
    assert.equal(second.database.installationId, first.database.installationId);
    assert.equal(second.database.starts, 2);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('modelo ausente mantiene interfaz y API con instrucciones de recuperación', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: () => probeQvac(undefined) });
  try {
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.qvac.state, 'unavailable');
    assert.match(status.qvac.message, /SITESIGNAL_MODEL/);
    assert.equal(status.database.state, 'ready');
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /SiteSignal/);
    assert.equal((await fetch(app.url + '/styles/tokens.css')).status, 200);
    assert.equal((await fetch(app.url + '/app.js')).status, 200);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('sirve la interfaz multipantalla y Leaflet sin exponer rutas fuera de sus directorios', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => ({ state: 'ready', message: 'Listo' }) });
  try {
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /https:\/\/\*\.tile\.openstreetmap\.org/);
    assert.equal((await fetch(app.url + '/styles/tokens.css')).status, 200);
    assert.equal((await fetch(app.url + '/vendor/leaflet/leaflet.js')).status, 200);
    assert.equal((await fetch(app.url + '/%2e%2e%2fpackage.json')).status, 404);
    assert.equal((await fetch(app.url + '/vendor/leaflet/%2e%2e%2fpackage.json')).status, 404);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('un fallo del runtime se informa sin interrumpir la API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, probeQvac: async () => { throw new Error('Runtime failure'); } });
  try {
    const status = await (await fetch(app.url + '/api/status')).json();
    assert.equal(status.qvac.state, 'unavailable');
    assert.match(status.qvac.message, /reinicia/);
    assert.equal(status.api.state, 'ready');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
