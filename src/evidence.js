import { randomUUID } from 'node:crypto';
import { normalize } from './observation-schema.js';

/** Local storage for photographed equipment plates and the fields their OCR text visibly supports.
 * Rows are insert-only: correcting a reviewed value later never rewrites the original evidence.
 * @param {import('node:sqlite').DatabaseSync} db */
export function evidenceStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY, hospital_id TEXT, mime_type TEXT NOT NULL, image BLOB NOT NULL,
    ocr_text TEXT NOT NULL, fields TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  /** @param {string | null} hospitalId @param {string} mimeType @param {Buffer} image
   * @param {{manufacturer: string | null, model: string | null, serial: string | null, year: number | null}} fields
   * @param {string} ocrText @param {string} createdAt */
  function store(hospitalId, mimeType, image, fields, ocrText, createdAt) {
    const id = randomUUID();
    db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, hospitalId, mimeType, image, ocrText, JSON.stringify(fields), createdAt);
    return { id, hospitalId, mimeType, fields, ocrText, createdAt };
  }
  /** @param {string} id */
  function get(id) {
    const row = db.prepare('SELECT id, hospital_id, mime_type, ocr_text, fields, created_at FROM evidence WHERE id = ?').get(id);
    if (!row) return null;
    return { id: row.id, hospitalId: row.hospital_id, mimeType: row.mime_type, ocrText: row.ocr_text, fields: JSON.parse(String(row.fields)), createdAt: row.created_at };
  }
  /** Confirms only the equipment fields whose reviewed value matches what an attached photo's OCR text
   * actually supports — the "evidencia directa permitida" confirmation path from CONTEXT.md, independent
   * of (and not requiring) a second corroborating observation. An age is compared as a manufacture year
   * computed from the observation's own capture date, since the plate shows a year, not an age.
   * @param {any} observation */
  function confirmedFieldsForObservation(observation) {
    const ids = observation.evidenceIds ?? [];
    if (!ids.length) return [];
    const records = /** @type {NonNullable<ReturnType<typeof get>>[]} */ (ids.map(get).filter(Boolean));
    if (!records.length) return [];
    /** @type {string[]} */
    const confirmed = [];
    const capturedYear = new Date(observation.capturedAt).getFullYear();
    observation.reviewed.equipment.forEach(/** @param {any} equipment @param {number} index */ (equipment, index) => {
      for (const record of records) {
        if (equipment.manufacturer !== null && record.fields.manufacturer && normalize(equipment.manufacturer) === normalize(record.fields.manufacturer)) confirmed.push(`equipment.${index}.manufacturer`);
        if (equipment.model !== null && record.fields.model && normalize(equipment.model) === normalize(record.fields.model)) confirmed.push(`equipment.${index}.model`);
        if (equipment.serial !== null && record.fields.serial && normalize(equipment.serial) === normalize(record.fields.serial)) confirmed.push(`equipment.${index}.serial`);
        if (equipment.age !== null && record.fields.year !== null && Math.abs((capturedYear - equipment.age) - record.fields.year) <= 1) confirmed.push(`equipment.${index}.age`);
      }
    });
    return [...new Set(confirmed)];
  }
  return { store, get, confirmedFieldsForObservation };
}
