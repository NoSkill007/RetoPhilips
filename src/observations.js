import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileSchema, activeSchema, captureSchema, saveSchema, inferenceSchema, validateExtraction, normalize, modalities } from './observation-schema.js';
import { assessObservation, confidencePolicy, nextFollowUp } from './confidence.js';
import { installedBase } from './installed-base.js';
import { RequestError } from './request-error.js';

const followUpAnswerSchema = z.object({ answer: z.union([z.string().trim().min(1).max(300), z.number(), z.null()]) }).strict();

/** @param {import('node:sqlite').DatabaseSync} db @param {import('./observation-schema.js').TextExtractor} extractText @param {() => Date} now @param {(record: any) => string[]} confirmationResolver */
export function observationApi(db, extractText, now = () => new Date(), confirmationResolver = () => []) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hospitals (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, draft_id TEXT UNIQUE NOT NULL, hospital_id TEXT NOT NULL, data TEXT NOT NULL);
  `);
  const base = installedBase(db, now);
  /** @param {string} id */
  function profile(id) {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) throw new RequestError(404, 'El perfil no existe. Selecciona un perfil de colaborador.');
    return row;
  }
  /** @param {any} draft */
  function presentDraft(draft) {
    const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY name').all();
    const needle = normalize(draft.reviewed.hospital ?? '');
    const candidates = hospitals.filter(h => needle && (normalize(String(h.name)).includes(needle) || needle.includes(normalize(String(h.name)))));
    const followUp = nextFollowUp(draft);
    return { ...draft, candidates, followUp, followUpProgress: { answered: draft.followUpHistory.length, limit: 3 },
      assessment: assessObservation({ ...draft, confirmedFields: confirmationResolver(draft) }, now()) };
  }
  /** @param {any} observation */
  function presentObservation(observation) {
    const provenance = observation.provenance ?? (observation.inference
      ? { kind: 'qvac', metadata: observation.inference, attempts: 1, retryCorrected: false, validationIssues: [] }
      : { kind: 'manual', attempts: 2, validationIssues: [] });
    const current = { ...observation, provenance };
    return { ...current, assessment: assessObservation({ ...current, confirmedFields: confirmationResolver(current) }, now()) };
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
    if (path === '/api/confidence-policy' && method === 'GET') return confidencePolicy;
    if (path === '/api/drafts' && method === 'POST') {
      const { text } = captureSchema.parse(body);
      const capturedAt = now().toISOString();
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
      const issues = [...new Set(validationIssues)];
      const provenance = validResult
        ? { kind: 'qvac', metadata: validResult.inference, attempts, retryCorrected: attempts === 2, validationIssues: issues }
        : { kind: 'manual', attempts: 2, validationIssues: issues };
      const draft = { id: randomUUID(), originalText: text, reviewed,
        extracted: validResult?.extraction.fields ?? null, profile: collaborator, provenance, capturedAt, followUpHistory: [] };
      db.prepare('INSERT INTO drafts VALUES (?, ?)').run(draft.id, JSON.stringify(draft));
      return presentDraft(draft);
    }
    const followUpMatch = path.match(/^\/api\/drafts\/([0-9a-f-]+)\/follow-up$/);
    if (followUpMatch && method === 'POST') {
      const draftId = z.uuid().parse(followUpMatch[1]);
      const row = db.prepare('SELECT data FROM drafts WHERE id = ?').get(draftId);
      if (!row) throw new RequestError(404, 'El borrador no existe.');
      const draft = JSON.parse(String(row.data));
      const question = nextFollowUp(draft);
      if (!question) throw new RequestError(409, 'No hay otra pregunta de seguimiento.');
      const { answer } = followUpAnswerSchema.parse(body);
      if (answer !== null) {
        if (question.field === 'hospital') {
          if (typeof answer !== 'string') throw new RequestError(400, 'El hospital debe ser texto.');
          draft.reviewed.hospital = answer;
        } else {
          const equipmentIndex = question.equipmentIndex;
          if (typeof equipmentIndex !== 'number') throw new RequestError(400, 'La pregunta no identifica un equipo.');
          const equipment = draft.reviewed.equipment[equipmentIndex];
          if (!equipment) throw new RequestError(400, 'El equipo de la pregunta ya no existe.');
          if (question.field === 'modality') equipment.modality = z.enum(modalities).parse(answer);
          else if (question.field === 'quantity') equipment.quantity = z.coerce.number().int().min(1).max(10000).parse(answer);
          else if (question.field === 'age') equipment.age = z.coerce.number().min(0).max(150).parse(answer);
          else {
            if (typeof answer !== 'string') throw new RequestError(400, 'La respuesta debe ser texto.');
            equipment[question.field] = answer;
          }
        }
      }
      draft.followUpHistory.push({ key: question.key, answered: answer !== null, at: now().toISOString() });
      db.prepare('UPDATE drafts SET data = ? WHERE id = ?').run(JSON.stringify(draft), draft.id);
      return presentDraft(draft);
    }
    if (path === '/api/hospitals' && method === 'GET') return db.prepare('SELECT * FROM hospitals ORDER BY name').all();
    if (path.startsWith('/api/hospitals/') && method === 'GET') {
      const id = z.uuid().parse(path.slice('/api/hospitals/'.length));
      const hospital = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(id);
      if (!hospital) throw new RequestError(404, 'El hospital no existe.');
      return { ...hospital, installedBase: base.present(id), observations: db.prepare('SELECT data FROM observations WHERE hospital_id = ? ORDER BY rowid DESC').all(id).map(row => presentObservation(JSON.parse(String(row.data)))) };
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
          profile: draft.profile, provenance: draft.provenance,
          capturedAt: draft.capturedAt, createdAt: now().toISOString() };
        db.prepare('INSERT INTO observations VALUES (?, ?, ?, ?)').run(observation.id, input.draftId, observation.hospitalId, JSON.stringify(observation));
        if (input.splitGroupId) base.splitFromObservation(input.splitGroupId, observation);
        else base.projectObservation(observation);
        db.exec('COMMIT');
        return presentObservation(observation);
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    throw new RequestError(404, 'Ruta no disponible.');
  };
}
