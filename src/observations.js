import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileSchema, activeSchema, captureSchema, saveSchema, inferenceSchema, validateExtraction, normalize } from './observation-schema.js';

export class RequestError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) { super(message); this.status = status; }
}

/** @param {import('node:sqlite').DatabaseSync} db @param {import('./observation-schema.js').TextExtractor} extractText */
export function observationApi(db, extractText) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hospitals (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, draft_id TEXT UNIQUE NOT NULL, hospital_id TEXT NOT NULL, data TEXT NOT NULL);
  `);
  /** @param {string} id */
  function profile(id) {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) throw new RequestError(404, 'El perfil no existe. Selecciona un perfil de colaborador.');
    return row;
  }
  /** @param {string} method @param {string} path @param {unknown} body */
  return async function handle(method, path, body) {
    if (path === '/api/profiles' && method === 'GET') return {
      profiles: db.prepare('SELECT * FROM profiles ORDER BY name').all(),
      activeProfileId: db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get()?.value ?? null,
    };
    if (path === '/api/profiles' && method === 'POST') {
      const input = profileSchema.parse(body);
      const id = randomUUID();
      db.prepare('INSERT INTO profiles VALUES (?, ?, ?)').run(id, input.name, input.role);
      return { id, ...input };
    }
    if (path === '/api/profiles/active' && method === 'POST') {
      const { profileId } = activeSchema.parse(body);
      profile(profileId);
      db.prepare("INSERT INTO preferences VALUES ('activeProfile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(profileId);
      return { activeProfileId: profileId };
    }
    if (path === '/api/drafts' && method === 'POST') {
      const { text } = captureSchema.parse(body);
      const capturedAt = new Date().toISOString();
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Crea y selecciona un perfil de colaborador antes de capturar.');
      const collaborator = profile(String(active.value));
      const validationIssues = [];
      let validResult;
      let attempts = 0;
      for (attempts = 1; attempts <= 2; attempts += 1) {
        try {
          const extraction = await extractText(text, { attempt: attempts,
            ...(attempts === 2 ? { correctiveInstruction: 'Corrige la salida anterior: respeta el schema completo, copia solo afirmaciones respaldadas por su cláusula y usa únicamente modalidades permitidas.' } : {}) });
          const inference = inferenceSchema.parse(extraction.metadata);
          const validation = validateExtraction(extraction.fields, text);
          if (validation.issues.length) {
            validationIssues.push(...validation.issues);
            continue;
          }
          validResult = { extraction, inference, reviewed: validation.reviewed };
          break;
        } catch {
          validationIssues.push(`Intento ${attempts}: QVAC no devolvió el schema completo y válido.`);
        }
      }
      const manual = !validResult;
      const reviewed = validResult?.reviewed ?? { client: null, hospital: null, area: null, equipment: [
        { modality: null, quantity: null, manufacturer: null, model: null, serial: null, age: null },
      ] };
      const draft = { id: randomUUID(), mode: manual ? 'manual' : 'qvac', originalText: text, reviewed,
        extracted: validResult?.extraction.fields ?? null, profile: collaborator,
        inference: validResult?.inference ?? { engine: 'Manual', model: 'No aplicado', durationMs: 0 },
        capturedAt, attempts: Math.min(attempts, 2), retryCorrected: Boolean(validResult && attempts === 2), validationIssues: [...new Set(validationIssues)] };
      db.prepare('INSERT INTO drafts VALUES (?, ?)').run(draft.id, JSON.stringify(draft));
      const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY name').all();
      const needle = normalize(reviewed.hospital ?? '');
      const candidates = hospitals.filter(h => needle && (normalize(String(h.name)).includes(needle) || needle.includes(normalize(String(h.name)))));
      return { ...draft, candidates };
    }
    if (path === '/api/hospitals' && method === 'GET') return db.prepare('SELECT * FROM hospitals ORDER BY name').all();
    if (path.startsWith('/api/hospitals/') && method === 'GET') {
      const id = z.uuid().parse(path.slice('/api/hospitals/'.length));
      const hospital = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(id);
      if (!hospital) throw new RequestError(404, 'El hospital no existe.');
      return { ...hospital, observations: db.prepare('SELECT data FROM observations WHERE hospital_id = ? ORDER BY rowid DESC').all(id).map(row => JSON.parse(String(row.data))) };
    }
    if (path === '/api/observations' && method === 'POST') {
      const input = saveSchema.parse(body);
      const existing = db.prepare('SELECT data FROM observations WHERE draft_id = ?').get(input.draftId);
      if (existing) return JSON.parse(String(existing.data));
      const row = db.prepare('SELECT data FROM drafts WHERE id = ?').get(input.draftId);
      if (!row) throw new RequestError(404, 'El borrador no existe. Vuelve a extraer la observación.');
      const draft = JSON.parse(String(row.data));
      let hospital = input.hospitalId ? db.prepare('SELECT * FROM hospitals WHERE id = ?').get(input.hospitalId) : undefined;
      if (input.hospitalId && !hospital) throw new RequestError(404, 'Selecciona un hospital existente.');
      if (!hospital && !input.reviewed.hospital) throw new RequestError(400, 'Indica el nombre del hospital o selecciona uno existente.');
      db.exec('BEGIN');
      try {
        if (!hospital) {
          hospital = { id: randomUUID(), name: input.reviewed.hospital, client: input.reviewed.client };
          db.prepare('INSERT INTO hospitals VALUES (?, ?, ?)').run(hospital.id, hospital.name, hospital.client);
        }
        const observation = { id: randomUUID(), hospitalId: hospital.id, originalText: draft.originalText,
          reviewed: { ...input.reviewed, hospital: hospital.name, client: hospital.client }, extracted: draft.extracted,
          profile: draft.profile, inference: draft.inference, mode: draft.mode, attempts: draft.attempts,
          retryCorrected: draft.retryCorrected, validationIssues: draft.validationIssues,
          capturedAt: draft.capturedAt, createdAt: new Date().toISOString() };
        db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?)').run(observation.id, input.draftId, observation.hospitalId, JSON.stringify(observation));
        db.exec('COMMIT');
        return observation;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    throw new RequestError(404, 'Ruta no disponible.');
  };
}
