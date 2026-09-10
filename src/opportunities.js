import { z } from 'zod';

export const STALE_MS = 365 * 24 * 60 * 60 * 1000;
export const opportunityPolicy = { minAge: 7, minConfidence: 60, staleAfterDays: 365 };
/** @param {string | null} capturedAt @param {Date} now */
export function isStale(capturedAt, now) { return capturedAt === null || now.getTime() - new Date(capturedAt).getTime() > STALE_MS; }
export const opportunityReviewSchema = z.object({
  decision: z.enum(['reviewed', 'dismissed']), note: z.string().trim().min(3).max(500),
}).strict();

/** @param {import('node:sqlite').DatabaseSync} db @param {() => Date} now */
export function opportunities(db, now) {
  db.exec('CREATE TABLE IF NOT EXISTS opportunity_reviews (item_id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, data TEXT NOT NULL)');

  /** @param {string} itemId */
  function reviewFor(itemId) {
    const row = db.prepare('SELECT data FROM opportunity_reviews WHERE item_id = ?').get(itemId);
    return row ? JSON.parse(String(row.data)) : null;
  }

  /** @param {string | null} capturedAt */
  function stale(capturedAt) { return isStale(capturedAt, now()); }

  /**
   * Builds the explainable renewal-opportunity signal for one installed-base equipment item.
   * @param {{ itemId: string, hospitalId: string, modality: unknown, manufacturer: unknown, model: unknown, serial: unknown,
   *  age: number | null, confidence: number, capturedAt: string | null, hasIdentityConflict: boolean, supportingObservationIds: string[] }} input
   */
  function signal(input) {
    const isStale = stale(input.capturedAt);
    const conditions = [
      { key: 'age', label: `Antigüedad de al menos ${opportunityPolicy.minAge} años`,
        met: typeof input.age === 'number' && input.age >= opportunityPolicy.minAge,
        detail: input.age === null || input.age === undefined ? 'La antigüedad del equipo es desconocida.' : `Antigüedad reportada: ${input.age} años.` },
      { key: 'confidence', label: `Confianza mínima de ${opportunityPolicy.minConfidence}`,
        met: input.confidence >= opportunityPolicy.minConfidence, detail: `Confianza actual del dato: ${input.confidence}.` },
      { key: 'freshness', label: 'Observación de menos de doce meses', met: input.capturedAt !== null && !isStale,
        detail: input.capturedAt === null ? 'No hay una observación que respalde este equipo.'
          : isStale ? 'La última observación que respalda este equipo tiene más de doce meses.' : 'La última observación que respalda este equipo tiene menos de doce meses.' },
      { key: 'conflict', label: 'Sin conflicto pendiente de identidad o antigüedad', met: !input.hasIdentityConflict,
        detail: input.hasIdentityConflict ? 'Hay un conflicto pendiente sobre el número de serie o la antigüedad de este equipo.'
          : 'No hay conflictos pendientes sobre el número de serie o la antigüedad de este equipo.' },
    ];
    const current = conditions.every(condition => condition.met);
    return {
      itemId: input.itemId, hospitalId: input.hospitalId, modality: input.modality, manufacturer: input.manufacturer,
      model: input.model, serial: input.serial, age: input.age, confidence: input.confidence, capturedAt: input.capturedAt,
      stale: isStale, current, conditions, supportingObservationIds: input.supportingObservationIds, review: reviewFor(input.itemId),
    };
  }

  /** @param {string} itemId @param {string} hospitalId @param {'reviewed' | 'dismissed'} decision @param {string} note @param {any} collaborator */
  function decide(itemId, hospitalId, decision, note, collaborator) {
    const existing = reviewFor(itemId);
    const entry = { decision, note, author: collaborator, at: now().toISOString() };
    const record = { itemId, hospitalId, history: existing ? [entry, ...existing.history] : [entry], current: entry };
    db.prepare(`INSERT INTO opportunity_reviews VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET hospital_id = excluded.hospital_id, data = excluded.data`)
      .run(itemId, hospitalId, JSON.stringify(record));
    return record;
  }

  return { signal, decide, reviewFor };
}
