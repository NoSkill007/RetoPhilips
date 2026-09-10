import { RequestError } from './request-error.js';
import { assessObservation } from './confidence.js';
import { modalities } from './observation-schema.js';

const DATASET_ID = 'sitesignal-fictional-latam-v2';
const hospitals = [
  ['Red Istmo Ficticia', 'Hospital Brisa Ficticio', 'Panamá', 'Ciudad de Panamá'],
  ['Red Istmo Ficticia', 'Hospital Canal Ficticio', 'Panamá', 'Ciudad de Panamá'],
  ['Salud Chiriquí Ficticia', 'Clínica Volcán Ficticia', 'Panamá', 'David'],
  ['Salud Caribe Ficticia', 'Hospital Faro Ficticio', 'Panamá', 'Colón'],
  ['Rede Horizonte Fictícia', 'Hospital Ipê Fictício', 'Brasil', 'São Paulo'],
  ['Rede Horizonte Fictícia', 'Clínica Pinheiro Fictícia', 'Brasil', 'Curitiba'],
  ['Saúde Atlântica Fictícia', 'Hospital Recife Sul Fictício', 'Brasil', 'Recife'],
  ['Red Andina Ficticia', 'Hospital Mirador Ficticio', 'Colombia', 'Bogotá'],
  ['Red Andina Ficticia', 'Clínica Río Ficticia', 'Colombia', 'Medellín'],
  ['Salud Pacífico Ficticia', 'Hospital Ceiba Ficticio', 'Colombia', 'Cali'],
];
const capturedDates = ['2026-08-01T12:00:00.000Z', '2026-05-15T12:00:00.000Z', '2025-02-10T12:00:00.000Z', '2026-07-20T12:00:00.000Z', '2024-11-01T12:00:00.000Z', '2026-03-01T12:00:00.000Z'];
const people = [
  ['Ana Torres Ficticia', 'Ingeniero de servicio'],
  ['Luis Prado Ficticio', 'Vendedor'],
  ['Camila Ríos Ficticia', 'Especialista'],
];

/** @param {string} prefix @param {number} number */
function uuid(prefix, number) { return `${prefix}${String(number).padStart(7, '0')}-0000-4000-8000-${String(number).padStart(12, '0')}`; }

function seedRows() {
  return hospitals.flatMap(([client, name, country, city], hospitalIndex) => {
    const hospitalId = uuid('1', hospitalIndex + 1);
    return Array.from({ length: 6 }, (_, equipmentIndex) => {
      const number = hospitalIndex * 6 + equipmentIndex + 1;
      const [person, role] = people[(hospitalIndex + equipmentIndex) % people.length];
      return {
        id: uuid('2', number), hospitalId, client, hospital: name, country, city,
        modality: modalities[(hospitalIndex + equipmentIndex) % modalities.length],
        manufacturer: `Fabricante Ficticio ${(equipmentIndex % 3) + 1}`,
        model: `Modelo Ficticio ${String.fromCharCode(65 + (hospitalIndex + equipmentIndex) % 8)}`,
        serial: `FIC-${String(number).padStart(3, '0')}`,
        age: 2 + ((hospitalIndex * 3 + equipmentIndex) % 11),
        capturedAt: capturedDates[equipmentIndex],
        confirmedFields: [],
        profile: { id: uuid('3', (hospitalIndex + equipmentIndex) % people.length + 1), name: person, role, fictional: true },
        fictional: true,
      };
    });
  });
}

/** @param {any[]} records @param {(record: any) => string} value */
function aggregate(records, value) {
  const counts = new Map();
  for (const record of records) { const key = value(record); counts.set(key, (counts.get(key) ?? 0) + 1); }
  return [...counts].map(([item, count]) => ({ value: item, count })).sort((a, b) => String(a.value).localeCompare(String(b.value), 'es'));
}

/** @param {number | null | undefined} age */
function ageBand(age) { return age === null || age === undefined ? 'Desconocida' : age <= 3 ? '0–3 años' : age <= 6 ? '4–6 años' : age <= 9 ? '7–9 años' : '10+ años'; }
/** @param {number} score */
function confidenceBand(score) { return score >= 80 ? 'Alta (80–100)' : score >= 50 ? 'Media (50–79)' : 'Baja (0–49)'; }
/** @param {any} record @param {Date} now */
function stale(record, now) { return now.getTime() - new Date(record.capturedAt).getTime() > 365 * 24 * 60 * 60 * 1000; }

/** @param {any} record @param {Date} now */
function assessmentFor(record, now) {
  return assessObservation({
    originalText: `[DATO SINTÉTICO FICTICIO] Visita simulada a ${record.hospital}: ${record.modality}, serie ${record.serial}.`,
    reviewed: { client: record.client, hospital: record.hospital, area: 'Área ficticia de demostración', equipment: [{ modality: record.modality, quantity: 1, manufacturer: record.manufacturer, model: record.model, serial: record.serial, age: record.age }] },
    extracted: null, capturedAt: record.capturedAt, confirmedFields: record.confirmedFields,
  }, now);
}

/** @param {import('node:sqlite').DatabaseSync} db @param {() => Date} now */
export function regionalPanorama(db, now = () => new Date()) {
  db.exec(`CREATE TABLE IF NOT EXISTS regional_demo_equipment (
    id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, data TEXT NOT NULL
  )`);
  const insert = db.prepare('INSERT INTO regional_demo_equipment VALUES (?, ?, ?)');
  function reset() {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM regional_demo_equipment').run();
      for (const row of seedRows()) insert.run(row.id, DATASET_ID, JSON.stringify(row));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { datasetId: DATASET_ID, hospitals: hospitals.length, equipment: hospitals.length * 6 };
  }
  if (Number(db.prepare('SELECT COUNT(*) AS count FROM regional_demo_equipment WHERE dataset_id = ?').get(DATASET_ID)?.count) !== 60) reset();
  /** @returns {any[]} */
  function rows() { return db.prepare('SELECT data FROM regional_demo_equipment WHERE dataset_id = ? ORDER BY id').all(DATASET_ID).map(row => JSON.parse(String(row.data))); }
  /** @returns {any[]} */
  function capturedRows() {
    const hospitalById = new Map(db.prepare('SELECT * FROM hospitals').all().map(hospital => [hospital.id, hospital]));
    const observationById = new Map(db.prepare('SELECT id, data FROM observations').all().map(row => [row.id, JSON.parse(String(row.data))]));
    const conflicts = db.prepare("SELECT data FROM installed_base_conflicts WHERE status = 'pending'").all().map(row => JSON.parse(String(row.data)));
    return db.prepare('SELECT id, hospital_id, data FROM installed_equipment ORDER BY rowid').all().flatMap(row => {
      const item = JSON.parse(String(row.data)); const hospital = hospitalById.get(row.hospital_id);
      const observation = [...(item.sourceObservationIds ?? [])].reverse().map(id => observationById.get(id)).find(Boolean);
      if (!hospital || !observation) return [];
      const confirmedFields = Object.entries(item.fieldStates ?? {}).filter(([, state]) => state === 'Confirmado').map(([field]) => `equipment.0.${field}`);
      const quantity = Math.max(1, Number(item.quantity) || 1);
      return Array.from({ length: quantity }, (_, index) => ({
        id: `${row.id}:${index + 1}`, hospitalId: row.hospital_id, client: hospital.client ?? 'Cliente no informado', hospital: hospital.name,
        country: 'Ubicación no informada', city: 'Ciudad no informada', area: observation.reviewed.area ?? null, modality: item.modality ?? 'Modalidad no informada',
        manufacturer: item.manufacturer, model: item.model, serial: item.serial, age: item.age, capturedAt: observation.capturedAt,
        profile: observation.profile, confirmedFields, fictional: false,
        hasConflict: conflicts.some(conflict => conflict.itemIds?.includes(row.id) && ['modality', 'manufacturer', 'model', 'serial', 'age'].includes(conflict.field)),
      }));
    });
  }
  function dataset() { return { id: DATASET_ID, label: 'Dataset sintético ficticio para demostración', fictional: true, hospitals: 10, equipment: 60 }; }
  /** @param {URLSearchParams} params */
  function panorama(params) {
    const all = [...rows(), ...capturedRows()].map(record => ({ ...record, confidence: assessmentFor(record, now()).confidence.score }));
    const selected = Object.fromEntries(['client', 'hospital', 'country', 'city', 'modality'].map(key => [key, params.get(key) ?? '']));
    const filtered = all.filter(record => Object.entries(selected).every(([key, value]) => !value || String(record[key === 'hospital' ? 'hospitalId' : key]) === value));
    const hospitalRows = new Map();
    for (const record of filtered) {
      const current = hospitalRows.get(record.hospitalId) ?? { id: record.hospitalId, name: record.hospital, client: record.client, country: record.country, city: record.city, area: record.area ?? null, fictional: record.fictional, source: record.fictional ? 'Dataset sintético ficticio' : 'Captura local', equipmentCount: 0, confidenceTotal: 0, staleInformation: 0, potentialOpportunities: 0 };
      current.equipmentCount += 1; current.confidenceTotal += record.confidence;
      if (stale(record, now())) current.staleInformation += 1;
      if (record.age >= 7 && record.confidence >= 60 && !stale(record, now()) && !record.hasConflict) current.potentialOpportunities += 1;
      hospitalRows.set(record.hospitalId, current);
    }
    const summaries = [...hospitalRows.values()].map(item => ({ ...item, averageConfidence: Math.round(item.confidenceTotal / item.equipmentCount), confidenceTotal: undefined })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const countries = aggregate(filtered.filter(record => ['Panamá', 'Brasil', 'Colombia'].includes(record.country)), record => record.country).map(item => ({ country: item.value, equipment: item.count, hospitals: new Set(filtered.filter(record => record.country === item.value).map(record => record.hospitalId)).size }));
    return {
      dataset: dataset(), selected,
      filters: {
        clients: [...new Set(all.map(row => row.client))].sort(),
        hospitals: [...new Map(all.map(row => [row.hospitalId, { id: row.hospitalId, name: row.hospital }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
        countries: [...new Set(all.map(row => row.country))].sort(), cities: [...new Set(all.map(row => row.city))].sort(), modalities: modalities.slice(),
      },
      metrics: {
        hospitals: summaries.length, equipment: filtered.length,
        averageConfidence: filtered.length ? Math.round(filtered.reduce((sum, row) => sum + row.confidence, 0) / filtered.length) : 0,
        staleInformation: filtered.filter(row => stale(row, now())).length,
        potentialOpportunities: filtered.filter(row => row.age >= 7 && row.confidence >= 60 && !stale(row, now()) && !row.hasConflict).length,
      },
      aggregations: {
        modality: aggregate(filtered, row => row.modality), geography: aggregate(filtered, row => `${row.country} · ${row.city}`),
        age: aggregate(filtered, row => ageBand(row.age)), confidence: aggregate(filtered, row => confidenceBand(row.confidence)),
        freshness: aggregate(filtered, row => stale(row, now()) ? 'Desactualizada (>12 meses)' : 'Vigente (≤12 meses)'),
      },
      map: countries, hospitals: summaries,
    };
  }
  /** @param {string} id */
  function hospital(id) {
    const records = rows().filter(row => row.hospitalId === id).map(record => ({ ...record, assessment: assessmentFor(record, now()) }));
    if (!records.length) return null;
    const first = records[0];
    const observations = records.map(record => ({
      id: record.id, hospitalId: id, fictional: true,
      originalText: `[DATO SINTÉTICO FICTICIO] Visita simulada a ${record.hospital}: ${record.modality}, serie ${record.serial}.`,
      reviewed: { client: record.client, hospital: record.hospital, area: 'Área ficticia de demostración', equipment: [{ modality: record.modality, quantity: 1, manufacturer: record.manufacturer, model: record.model, serial: record.serial, age: record.age }] },
      extracted: null, profile: record.profile, provenance: { kind: 'seed', dataset: DATASET_ID, attempts: 0, validationIssues: [] }, capturedAt: record.capturedAt, createdAt: record.capturedAt,
      evidenceIds: [], assessment: record.assessment,
    }));
    const items = records.map(record => ({ id: record.id, hospitalId: id, kind: 'individual', quantity: 1, modality: record.modality, manufacturer: record.manufacturer, model: record.model, serial: record.serial, age: record.age, sourceObservationIds: [record.id], sourceProfileIds: [record.profile.id], evidenceIds: [], splitHistory: [], fieldStates: Object.fromEntries(Object.entries(record.assessment.equipment[0]).map(([key, field]) => [key, field.state])), confirmations: {}, fieldSources: {} }));
    return { id, name: first.hospital, client: first.client, country: first.country, city: first.city, fictional: true, dataset: dataset(), installedBase: { total: 6, items, duplicateCandidates: [], conflicts: [], conflictHistory: [], changeHistory: [] }, observations };
  }
  /** @param {string} method @param {string} path */
  async function handle(method, path) {
    const url = new URL(path, 'http://sitesignal.local');
    if (url.pathname === '/api/panorama' && method === 'GET') return panorama(url.searchParams);
    if (url.pathname === '/api/demo/reset' && method === 'POST') return reset();
    throw new RequestError(404, 'Ruta regional no disponible.');
  }
  return { handle, hospital, reset };
}
