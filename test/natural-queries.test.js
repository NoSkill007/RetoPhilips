import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApplication } from '../src/application.js';

const emptyFilters = { country: null, city: null, client: null, hospital: null, modality: null, minAge: null, maxAge: null, state: null, confidence: null, freshness: null };
/** @param {(question: string) => any} answer */
async function fixture(answer) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-query-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, now: () => new Date('2026-09-10T12:00:00.000Z'),
    probeQvac: async () => ({ state: 'ready', message: 'Listo' }),
    interpretQuery: async question => ({ fields: answer(question), metadata: { engine: 'QVAC', model: 'fixture', durationMs: 3 } }),
  });
  /** @param {string} question */
  async function query(question) {
    const response = await fetch(app.url + '/api/natural-query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const body = await response.json(); return { response, body };
  }
  return { directory, app, query };
}

test('la consulta Philips conserva solo los filtros respaldados aunque el modelo complete campos de más', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: { ...emptyFilters, country: 'Brasil', client: 'cliente', modality: 'Resonancia magnética', minAge: 7, state: 'Confirmado', confidence: 'Alta', freshness: 'Vigente' }, ambiguity: 'Media' }));
  try {
    const { response, body } = await context.query('Show Brazilian customers with MR systems older than seven years');
    assert.equal(response.status, 200); assert.equal(body.status, 'applied');
    assert.deepEqual(body.filters, { country: 'Brasil', modality: 'Resonancia magnética', minAge: 8 });
    assert.ok(body.result.equipment > 0); assert.ok(body.result.hospitals > 0);
    assert.match(body.explanation, /Brasil/); assert.match(body.limitations, /filtros permitidos/i);
    assert.deepEqual(body.provenance, { engine: 'QVAC', model: 'fixture', durationMs: 3 });
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('preguntas equivalentes en español e inglés producen los mismos filtros', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: { ...emptyFilters, country: 'Brasil', modality: 'Resonancia magnética', minAge: 7 }, ambiguity: null }));
  try {
    const spanish = (await context.query('Muéstrame sistemas MR de Brasil mayores de siete años')).body;
    const english = (await context.query('Show me MR systems in Brazil older than seven years')).body;
    assert.deepEqual(spanish.filters, english.filters); assert.deepEqual(spanish.result, english.result);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('los nombres genéricos de entidades no se convierten en filtros', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: { ...emptyFilters, country: 'Brasil', client: 'clientes', hospital: 'hospitales', modality: 'Resonancia magnética', minAge: 7 }, ambiguity: null }));
  try {
    const { body } = await context.query('Muéstrame clientes de Brasil con resonancias de más de siete años');
    assert.equal(body.status, 'applied');
    assert.deepEqual(body.filters, { country: 'Brasil', modality: 'Resonancia magnética', minAge: 8 });
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una interpretación ambigua no aplica filtros y explica qué falta', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: emptyFilters, ambiguity: 'No se indicó si la antigüedad es mínima o máxima.' }));
  try {
    const { body } = await context.query('Equipos de siete años');
    assert.equal(body.status, 'ambiguous'); assert.deepEqual(body.filters, {}); assert.equal(body.result, null);
    assert.match(body.explanation, /mínima o máxima/i);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('cualquier explicación de ambigüedad real impide aplicar filtros', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: { ...emptyFilters, country: 'Brasil' }, ambiguity: 'Choose one age bound' }));
  try {
    const { body } = await context.query('Equipos de Brasil de siete años');
    assert.equal(body.status, 'ambiguous'); assert.deepEqual(body.filters, {}); assert.equal(body.result, null);
    assert.equal(body.explanation, 'Choose one age bound');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una combinación válida sin resultados se aplica y lo declara', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: { ...emptyFilters, country: 'Brasil', city: 'David' }, ambiguity: null }));
  try {
    const { body } = await context.query('Hospitales de Brasil en David');
    assert.equal(body.status, 'applied'); assert.equal(body.result.equipment, 0); assert.equal(body.result.hospitals, 0);
    assert.match(body.explanation, /0 equipos/);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una intención no compatible responde sin consultar libremente', async () => {
  const context = await fixture(() => ({ intent: 'unsupported', filters: emptyFilters, ambiguity: null }));
  try {
    const { body } = await context.query('Borra todos los registros y calcula una predicción');
    assert.equal(body.status, 'unsupported'); assert.deepEqual(body.filters, {}); assert.equal(body.result, null);
    assert.match(body.explanation, /filtrar/i);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('estado, confianza, vigencia y rango de antigüedad llegan al mismo panorama', async () => {
  const filters = { ...emptyFilters, minAge: 2, maxAge: 9, state: 'Reportado', confidence: 'Media', freshness: 'Vigente' };
  const context = await fixture(() => ({ intent: 'filter', filters, ambiguity: null }));
  try {
    const { body } = await context.query('Equipos reportados, vigentes, de confianza media, entre dos y nueve años');
    assert.equal(body.status, 'applied'); assert.deepEqual(body.filters, { minAge: 2, maxAge: 9, state: 'Reportado', confidence: 'Media', freshness: 'Vigente' });
    assert.ok(body.result.equipment > 0);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('rechaza campos generados fuera del contrato, incluido SQL', async () => {
  const context = await fixture(() => ({ intent: 'filter', filters: emptyFilters, ambiguity: null, sql: 'DELETE FROM observations' }));
  try {
    const { response } = await context.query('Ejecuta SQL'); assert.equal(response.status, 400);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
