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

/** @param {(text: string, options?: {attempt: number, correctiveInstruction?: string}) => Promise<any>} extractText @param {() => Date} [now] */
async function scenario(extractText, now) {
  const directory = await mkdtemp(join(tmpdir(), 'sitesignal-validation-'));
  const app = await startApplication({ dataDirectory: directory, port: 0, extractText, now,
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
    assert.equal(calls, 1); assert.equal(draft.provenance.kind, 'qvac'); assert.equal(draft.provenance.attempts, 1); assert.deepEqual(draft.provenance.validationIssues, []);
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
    assert.equal(draft.provenance.kind, 'qvac'); assert.equal(draft.provenance.attempts, 2); assert.equal(draft.provenance.retryCorrected, true);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('dos fallos abren captura manual sin perder el relato y distinguen la procedencia', async () => {
  let calls = 0;
  const context = await scenario(async () => { calls += 1; throw new Error('JSON inválido'); });
  try {
    const draft = await context.post('/api/drafts', { text: source });
    assert.equal(calls, 2); assert.equal(draft.provenance.kind, 'manual'); assert.equal(draft.originalText, source);
    assert.equal('metadata' in draft.provenance, false); assert.equal(draft.reviewed.hospital, null);
    draft.reviewed.hospital = 'Hospital Aurora';
    const saved = await context.post('/api/observations', { draftId: draft.id, reviewed: draft.reviewed, hospitalId: null });
    assert.equal(saved.provenance.kind, 'manual'); assert.equal(saved.originalText, source);
    assert.ok(saved.provenance.validationIssues.length > 0);
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
    assert.equal(draft.provenance.kind, 'manual'); assert.equal(draft.reviewed.equipment[0].modality, null);
    assert.ok(draft.provenance.validationIssues.some(/** @param {string} issue */ issue => /modalidad/i.test(issue)));
    assert.ok(draft.provenance.validationIssues.some(/** @param {string} issue */ issue => /fabricante/i.test(issue)));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('conserva la parte segura cuando QVAC usa textos para null y repite afirmaciones inválidas', async () => {
  const sourceText = 'Estoy en Hospital DemoCare Pacific, en Ciudad de Panamá. Tienen dos resonadores magnéticos y un tomógrafo. Uno de los resonadores parece de unos ocho años, marca Siemens, pero el otro no alcancé a ver el modelo.';
  const outputs = [
    { client: 'Hospital DemoCare Pacific', hospital: 'Hospital DemoCare Pacific', area: 'Ciudad de Panamá', equipment: [
      { modality: 'resonador magnético', quantity: 'dos', manufacturer: 'Siemens', model: 'null', serial: 'null', age: 'ocho años' },
      { modality: 'resonador magnético', quantity: 'uno', manufacturer: 'null', model: 'null', serial: 'null', age: 'null' },
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'null', model: 'null', serial: 'null', age: 'null' },
    ] },
    { client: 'Hospital DemoCare Pacific', hospital: 'Hospital DemoCare Pacific', area: 'no specified', equipment: [
      { modality: 'resonador magnético', quantity: 'dos', manufacturer: 'Siemens', model: 'no specified', serial: 'no specified', age: 'ocho años' },
      { modality: 'resonador magnético', quantity: 'uno', manufacturer: 'no specified', model: 'no specified', serial: 'no specified', age: 'no specified' },
      { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'no specified', model: 'no specified', serial: 'no specified', age: 'no specified' },
    ] },
  ];
  let calls = 0;
  const context = await scenario(async (_text, options) => ({ fields: outputs[calls++], metadata: { engine: 'QVAC', model: 'fixture', durationMs: options?.attempt ?? 1 } }));
  try {
    const draft = await context.post('/api/drafts', { text: sourceText });
    assert.equal(calls, 2); assert.equal(draft.provenance.kind, 'qvac'); assert.equal(draft.provenance.retryCorrected, true); assert.equal(draft.provenance.partial, true);
    assert.equal(draft.reviewed.hospital, 'Hospital DemoCare Pacific'); assert.equal(draft.reviewed.area, null);
    assert.ok(draft.reviewed.equipment.some(/** @param {any} item */ item => item.modality === 'Tomografía computarizada' && item.quantity === 1));
    assert.ok(draft.provenance.validationIssues.length > 0);
    assert.ok(draft.extracted.equipment.every(/** @param {any} item */ item => !Object.values(item).includes('null') && !Object.values(item).includes('no specified')));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un fabricante o modelo mencionado junto al equipo se acepta sin exigir la palabra "fabricante"/"modelo"', async () => {
  const text = 'Acabo de salir de la Clínica San Fernando en Vía España, Panamá. Vi que tienen dos ecógrafos en ginecología, uno es un GE Voluson bastante nuevo, como de dos años. El otro es un Philips más viejito pero no alcancé a ver el modelo. También pasé por rayos X y tienen un tomógrafo Toshiba que se ve de más de 10 años, deberían cambiarlo pronto';
  const claims = { client: null, hospital: 'Clínica San Fernando', area: 'ginecología', equipment: [
    { modality: 'ecógrafo', quantity: 'dos', manufacturer: 'GE', model: 'Voluson', serial: null, age: 'dos años' },
    { modality: 'ecógrafo', quantity: null, manufacturer: 'Philips', model: null, serial: null, age: null },
    { modality: 'tomógrafo', quantity: 'uno', manufacturer: 'Toshiba', model: null, serial: null, age: 'más de 10 años' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.hospital, 'Clínica San Fernando');
    assert.equal(draft.reviewed.equipment[0].modality, 'Ultrasonido');
    assert.equal(draft.reviewed.equipment[0].manufacturer, 'GE');
    assert.equal(draft.reviewed.equipment[0].model, 'Voluson');
    assert.equal(draft.reviewed.equipment[0].quantity, 2);
    assert.equal(draft.reviewed.equipment[0].age, 2);
    assert.equal(draft.reviewed.equipment[2].modality, 'Tomografía computarizada');
    assert.equal(draft.reviewed.equipment[2].manufacturer, 'Toshiba');
    assert.equal(draft.reviewed.equipment[2].age, 10);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un área nombrada de forma natural (sala, unidad, servicio) se acepta sin la palabra "área"', async () => {
  const text = 'Estoy en el Hospital Santo Tomás en Ciudad de Panamá. En la sala de urgencias vi un resonador magnético cerrado de 1.5T. No estoy seguro de la marca, parecía Siemens o Philips, pero el técnico de turno me dijo que lo instalaron como en 2018. Está funcionando bien.';
  const claims = { client: null, hospital: 'Hospital Santo Tomás', area: 'sala de urgencias', equipment: [
    { modality: 'resonador magnético', quantity: 'un', manufacturer: 'Siemens', model: null, serial: null, age: '2018' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.area, 'sala de urgencias');
    // "Siemens o Philips" is stated as uncertain between two named brands — correctly stays unknown, not a guess.
    assert.equal(draft.reviewed.equipment[0].manufacturer, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un año de instalación mencionado en el relato se convierte a antigüedad usando la fecha de captura', async () => {
  const text = 'Visité Hospital Aurora. Vi un tomógrafo. El técnico me dijo que lo instalaron en 2016.';
  const claims = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'tomógrafo', quantity: null, manufacturer: null, model: null, serial: null, age: '2016' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }), () => new Date('2026-09-10T12:00:00.000Z'));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.equipment[0].age, 10);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un número de cuatro dígitos sin indicio de instalación no se confunde con antigüedad', async () => {
  const text = 'Visité Hospital Aurora. Vi un tomógrafo, número de serie 2016.';
  const claims = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'tomógrafo', quantity: null, manufacturer: null, model: null, serial: '2016', age: '2016' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.equipment[0].serial, '2016');
    assert.equal(draft.reviewed.equipment[0].age, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una modalidad parafraseada por el modelo (tomógrafo vs. tomografía computarizada) se reconoce igual', async () => {
  const text = 'Visita terminada en el Centro Médico Paitilla. Tienen tres tomógrafos computarizados. Dos son Philips Brilliance de hace unos 6 años en el primer piso. El tercero lo acaban de cambiar hace menos de un año por un Siemens Somatom de 128 cortes en la torre nueva.';
  const claims = { client: 'Centro Médico Paitilla', hospital: 'Centro Médico Paitilla', area: 'no specified', equipment: [
    { modality: 'tomografía computarizada', quantity: '2', manufacturer: 'Philips', model: 'Brilliance', serial: 'no specified', age: '6 años' },
    { modality: 'tomografía computarizada', quantity: '1', manufacturer: 'Siemens', model: 'Somatom', serial: 'no specified', age: '1 año' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    // QVAC's raw wording ("tomografía computarizada", the procedure) never appears verbatim in the source
    // ("tomógrafos computarizados", the device) — the validator must still recognize the same modality.
    assert.equal(draft.reviewed.hospital, 'Centro Médico Paitilla');
    assert.equal(draft.reviewed.equipment[0].modality, 'Tomografía computarizada');
    assert.equal(draft.reviewed.equipment[0].manufacturer, 'Philips');
    assert.equal(draft.reviewed.equipment[0].age, 6);
    assert.equal(draft.reviewed.equipment[1].modality, 'Tomografía computarizada');
    // still not a full manual fallback: hospital and at least one modality are backed.
    assert.equal(draft.provenance.kind, 'qvac');
    assert.equal(draft.provenance.partial, true);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una cantidad de subgrupo mencionada después de la modalidad y un modelo dos saltos después se aceptan', async () => {
  const text = 'Visita terminada en el Centro Médico Paitilla. Tienen tres tomógrafos computarizados. Dos son Philips Brilliance de hace unos 6 años en el primer piso. El tercero lo acaban de cambiar hace menos de un año por un Siemens Somatom de 128 cortes en la torre nueva.';
  const claims = { client: null, hospital: 'Centro Médico Paitilla', area: null, equipment: [
    { modality: 'tomografía computarizada', quantity: '2', manufacturer: 'Philips', model: 'Brilliance', serial: null, age: '6 años' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    // "Dos" (quantity) sits after the modality mention, and "Brilliance" (model) sits two hops away —
    // both were previously rejected by a before-only/modality-only proximity check.
    assert.equal(draft.reviewed.equipment[0].quantity, 2);
    assert.equal(draft.reviewed.equipment[0].manufacturer, 'Philips');
    assert.equal(draft.reviewed.equipment[0].model, 'Brilliance');
    assert.equal(draft.reviewed.equipment[0].age, 6);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un hospital de nombre largo no bloquea el país que aparece justo después de su nombre', async () => {
  const text = 'Visité Instituto Radiológico del Sur en Montevideo, Uruguay. Operan dos resonadores: uno 3T casi nuevo de 2 años y otro 1.5T más antiguo de unos 9 años.';
  const claims = { client: 'Instituto Radiológico del Sur', hospital: 'Instituto Radiológico del Sur', area: 'Montevideo', city: 'Montevideo', country: 'Uruguay', equipment: [
    { modality: 'resonador', quantity: '1', manufacturer: null, model: null, serial: null, age: 'casi nuevo de 2 años' },
    { modality: 'resonador', quantity: '1', manufacturer: null, model: null, serial: null, age: 'más antiguo de unos 9 años' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    // "Instituto" is long enough that a start-anchored distance check pushes "Uruguay" out of range —
    // distance must be measured from the nearer edge of the hospital name, not a single fixed point.
    assert.equal(draft.reviewed.hospital, 'Instituto Radiológico del Sur');
    assert.equal(draft.reviewed.city, 'Montevideo');
    assert.equal(draft.reviewed.country, 'Uruguay');
    // "resonador" (the device) must classify the same as "resonancia" (the procedure).
    assert.equal(draft.reviewed.equipment[0].modality, 'Resonancia magnética');
    assert.equal(draft.reviewed.equipment[1].modality, 'Resonancia magnética');
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('un país no mencionado en el relato no se acepta aunque el modelo lo infiera del contexto', async () => {
  const text = "I'm at Hospital Alpha in São Paulo. I saw two CT systems and three MR systems.";
  const claims = { client: 'Hospital Alpha', hospital: 'Hospital Alpha', area: null, city: 'São Paulo', country: 'Brazil', equipment: [
    { modality: 'CT', quantity: '2', manufacturer: null, model: null, serial: null, age: null },
    { modality: 'MR', quantity: '3', manufacturer: null, model: null, serial: null, age: null },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.city, 'São Paulo');
    // "Brazil" is a reasonable inference from São Paulo, but the source never states it — must stay unknown.
    assert.equal(draft.reviewed.country, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('el nombre del hospital se recupera de "cliente" cuando el modelo pone ahí el sitio y en "hospital" la ciudad', async () => {
  const text = 'Observación en Hospital San Gabriel en La Paz, Bolivia. Tienen un tomógrafo de unos 8 años y dos ecógrafos básicos de 5 años.';
  const claims = { client: 'Hospital San Gabriel', hospital: 'La Paz, Bolivia', area: null, city: 'La Paz', country: 'Bolivia', equipment: [
    { modality: 'tomógrafo', quantity: '1', manufacturer: null, model: null, serial: null, age: '8 años' },
    { modality: 'ecógrafo', quantity: '2', manufacturer: null, model: 'básico', serial: null, age: '5 años' },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    // "La Paz, Bolivia" must not be accepted as the hospital just because "Hospital" appears earlier in the
    // sentence — the real name sits between them. The correct name is recovered from the swapped "client".
    assert.equal(draft.reviewed.hospital, 'Hospital San Gabriel');
    assert.equal(draft.reviewed.city, 'La Paz');
    assert.equal(draft.reviewed.country, 'Bolivia');
    // "básico" describes the ultrasound units, not a real model name.
    assert.equal(draft.reviewed.equipment[1].model, null);
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});

test('una afirmación de fabricante ausente del relato sigue rechazándose aunque la modalidad esté cerca', async () => {
  const text = 'Visité Hospital Aurora. Vi dos teletransportadores.';
  const claims = { client: null, hospital: 'Hospital Aurora', area: null, equipment: [
    { modality: 'teletransportadores', quantity: 'dos', manufacturer: 'Inventado', model: null, serial: null, age: null },
  ] };
  const context = await scenario(async () => ({ fields: claims, metadata: { engine: 'QVAC', model: 'fixture', durationMs: 2 } }));
  try {
    const draft = await context.post('/api/drafts', { text });
    assert.equal(draft.reviewed.equipment[0].manufacturer, null);
    assert.ok(draft.provenance.validationIssues.some(/** @param {string} issue */ issue => /fabricante/i.test(issue)));
  } finally { await context.app.close(); await rm(context.directory, { recursive: true, force: true }); }
});
