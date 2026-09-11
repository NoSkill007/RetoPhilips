import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { profileSchema, activeSchema, captureSchema, saveSchema, inferenceSchema, validateExtraction, sanitizeExtraction, normalize, hospitalCoreName, modalities } from './observation-schema.js';
import { regionFor } from './region.js';
import { assessObservation, confidencePolicy, nextFollowUp } from './confidence.js';
import { installedBase } from './installed-base.js';
import { RequestError } from './request-error.js';
import { regionalPanorama } from './regional-panorama.js';
import { naturalQuery } from './natural-query.js';
import { opportunities, opportunityReviewSchema } from './opportunities.js';
import { evidenceStore } from './evidence.js';
import { coordinatesFor } from './geo.js';

const followUpAnswerSchema = z.object({ answer: z.union([z.string().trim().min(1).max(300), z.number(), z.null()]) }).strict();
const duplicateDecisionSchema = z.object({ decision: z.enum(['keep-separate', 'consolidate']) }).strict();
const correctionSchema = z.object({ field: z.enum(['modality', 'quantity', 'manufacturer', 'model', 'serial', 'age']),
  value: z.union([z.string().trim().min(1).max(300), z.number(), z.null()]), reason: z.string().trim().min(3).max(500) }).strict();
const conflictResolutionSchema = z.object({ value: z.union([z.string().trim().min(1).max(300), z.number()]),
  explanation: z.string().trim().min(3).max(500) }).strict();

/** @param {import('node:sqlite').DatabaseSync} db @param {import('./observation-schema.js').TextExtractor} extractText @param {() => Date} now @param {(record: any) => string[]} confirmationResolver @param {(question: string) => Promise<{fields: unknown, metadata: unknown}>} interpretQuery @param {(image: Buffer) => Promise<{fields: unknown, ocrText: string, metadata: unknown}>} analyzeImage */
export function observationApi(db, extractText, now = () => new Date(), confirmationResolver = () => [], interpretQuery = async () => { throw new RequestError(503, 'El intérprete local de consultas no está disponible.'); }, analyzeImage = async () => { throw new RequestError(503, 'El análisis local de evidencia fotográfica no está configurado.'); }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hospitals (id TEXT PRIMARY KEY, name TEXT NOT NULL, client TEXT);
    CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, draft_id TEXT UNIQUE NOT NULL, hospital_id TEXT NOT NULL, data TEXT NOT NULL);
  `);
  const hospitalColumns = new Set(db.prepare('PRAGMA table_info(hospitals)').all().map(row => String(row.name)));
  if (!hospitalColumns.has('city')) db.exec('ALTER TABLE hospitals ADD COLUMN city TEXT');
  if (!hospitalColumns.has('country')) db.exec('ALTER TABLE hospitals ADD COLUMN country TEXT');
  if (!hospitalColumns.has('region')) db.exec('ALTER TABLE hospitals ADD COLUMN region TEXT');
  const base = installedBase(db, now);
  const regional = regionalPanorama(db, now);
  const query = naturalQuery(regional, interpretQuery);
  const opportunity = opportunities(db, now);
  const evidence = evidenceStore(db);
  /** @param {string} hospitalId @param {any[]} items @param {any[]} conflicts @param {any[]} observationRows */
  function opportunitiesForHospital(hospitalId, items, conflicts, observationRows) {
    return items.filter(item => item.kind === 'individual' || item.kind === 'consolidated').map(item => {
      const supporting = observationRows.filter(observation => item.sourceObservationIds.includes(observation.id));
      const capturedAt = supporting.reduce(/** @param {string | null} latest @param {any} observation */ (latest, observation) =>
        !latest || new Date(observation.capturedAt) > new Date(latest) ? observation.capturedAt : latest, null);
      const assessment = base.assessItem(item, capturedAt);
      const hasIdentityConflict = conflicts.some(conflict => conflict.itemIds?.includes(item.id));
      return opportunity.signal({ itemId: item.id, hospitalId, modality: item.modality, manufacturer: item.manufacturer, model: item.model,
        serial: item.serial, age: item.age, confidence: assessment.confidence.score, capturedAt, hasIdentityConflict,
        supportingObservationIds: supporting.map(observation => observation.id) });
    });
  }
  /** @param {string} value */
  function csvCell(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  const installedBaseCsvColumns = ['hospital', 'cliente', 'ciudad', 'pais', 'tipo', 'modalidad', 'cantidad', 'fabricante',
    'modelo', 'numero_de_serie', 'antiguedad_anos', 'estado_modalidad', 'estado_fabricante', 'estado_modelo', 'estado_serie',
    'estado_antiguedad', 'evidencia_fotografica'];
  /** Flattens the locally captured installed base — one row per equipment item across every hospital —
   * for the offline delivery export. The precargado fictional dataset is reproducible from `/api/panorama`
   * and "Restablecer demo", so it is intentionally left out; this file is only what this installation captured. */
  function exportInstalledBaseCsv() {
    const rows = [installedBaseCsvColumns.join(',')];
    for (const hospital of db.prepare('SELECT * FROM hospitals ORDER BY name').all()) {
      for (const item of base.present(String(hospital.id)).items) {
        rows.push([hospital.name, hospital.client, hospital.city, hospital.country, item.kind, item.modality, item.quantity,
          item.manufacturer, item.model, item.serial, item.age, item.fieldStates.modality, item.fieldStates.manufacturer,
          item.fieldStates.model, item.fieldStates.serial, item.fieldStates.age, String((item.evidenceIds ?? []).length),
        ].map(csvCell).join(','));
      }
    }
    return rows.join('\r\n') + '\r\n';
  }
  /** Full local state for the offline delivery export: every captured hospital with its observations,
   * installed-base items (states, conflicts, pending/resolved history), opportunity decisions and the
   * evidence photos referenced by them (metadata and OCR text only — never the stored image bytes). */
  function exportState() {
    const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY name').all();
    const evidenceRows = db.prepare('SELECT id, hospital_id, mime_type, ocr_text, fields, created_at FROM evidence ORDER BY rowid').all();
    const evidenceById = new Map(evidenceRows.map(row => [String(row.id), { id: row.id, mimeType: row.mime_type, ocrText: row.ocr_text, fields: JSON.parse(String(row.fields)), createdAt: row.created_at }]));
    return {
      exportedAt: now().toISOString(),
      hospitals: hospitals.map(hospital => {
        const hospitalId = String(hospital.id);
        const installedBaseData = base.present(hospitalId);
        const observationRows = db.prepare('SELECT data FROM observations WHERE hospital_id = ? ORDER BY rowid').all(hospitalId).map(row => JSON.parse(String(row.data)));
        const opportunityList = opportunitiesForHospital(hospitalId, installedBaseData.items, installedBaseData.conflicts, observationRows);
        const evidenceIds = new Set([
          ...installedBaseData.items.flatMap(item => item.evidenceIds ?? []),
          ...observationRows.flatMap(observation => observation.evidenceIds ?? []),
        ]);
        return { hospital, observations: observationRows, installedBase: installedBaseData, opportunities: opportunityList,
          evidence: [...evidenceIds].map(id => evidenceById.get(id)).filter(Boolean) };
      }),
    };
  }
  /** @param {string} id */
  function profile(id) {
    const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    if (!row) throw new RequestError(404, 'El perfil no existe. Selecciona un perfil de colaborador.');
    return row;
  }
  /** A field only counts as a mismatch when BOTH sides actually have a value and they disagree —
   * an unknown field on either side never blocks a match, the same rule the duplicate-hospital 409
   * check below already applies at save time. @param {unknown} a @param {unknown} b */
  function compatible(a, b) { return !a || !b || normalize(String(a)) === normalize(String(b)); }
  /** Finds the one existing hospital whose name, client, city and country are all compatible with the
   * reviewed draft — the same exact-match rule the save endpoint uses to refuse a second, duplicate
   * hospital record. Reused here so the review screen can pick that hospital as the destination by
   * itself instead of leaving the collaborator to notice and select it manually. Names compare by
   * their "core" (institution-type words like "Hospital"/"Clínica" stripped) so a second visit that
   * drops or adds that generic word — "Santo Tomás" vs. "Hospital Santo Tomás" — still counts as the
   * same site instead of quietly producing a second hospital record.
   * @param {{hospital: string | null, client?: string | null, city?: string | null, country?: string | null}} reviewed */
  function findExactHospitalMatch(reviewed) {
    if (!reviewed.hospital) return null;
    const coreName = hospitalCoreName(reviewed.hospital);
    return /** @type {any[]} */ (db.prepare('SELECT * FROM hospitals').all()).find(row =>
      hospitalCoreName(String(row.name)) === coreName
      && compatible(row.client, reviewed.client)
      && compatible(row.city, reviewed.city)
      && compatible(row.country, reviewed.country)) ?? null;
  }
  /** @param {any} draft */
  function presentDraft(draft) {
    const hospitals = db.prepare('SELECT * FROM hospitals ORDER BY name').all();
    const needle = normalize(draft.reviewed.hospital ?? '');
    const candidates = hospitals.filter(h => needle && (normalize(String(h.name)).includes(needle) || needle.includes(normalize(String(h.name)))));
    const exactMatch = findExactHospitalMatch(draft.reviewed);
    const followUp = nextFollowUp(draft);
    return { ...draft, candidates, exactMatchId: exactMatch?.id ?? null, followUp, followUpProgress: { answered: draft.followUpHistory.length, limit: 3 },
      assessment: assessObservation({ ...draft, confirmedFields: confirmationResolver(draft) }, now()) };
  }
  /** @param {any} observation */
  function presentObservation(observation) {
    const provenance = observation.provenance ?? (observation.inference
      ? { kind: 'qvac', metadata: observation.inference, attempts: 1, retryCorrected: false, validationIssues: [] }
      : { kind: 'manual', attempts: 2, validationIssues: [] });
    const current = { ...observation, provenance };
    const confirmedFields = [...new Set([...confirmationResolver(current), ...base.confirmedFieldsForObservation(current), ...evidence.confirmedFieldsForObservation(current)])];
    return { ...current, assessment: assessObservation({ ...current, confirmedFields }, now()) };
  }
  /** @param {string} method @param {string} path @param {unknown} body */
  return async function handle(method, path, body) {
    if (new URL(path, 'http://sitesignal.local').pathname === '/api/panorama' || path === '/api/demo/reset') return regional.handle(method, path);
    if (path === '/api/export/installed-base.csv' && method === 'GET') return exportInstalledBaseCsv();
    if (path === '/api/export/state.json' && method === 'GET') return exportState();
    if (path === '/api/natural-query' && method === 'POST') return query(body);
    if (path === '/api/evidence' && method === 'POST' && body && typeof body === 'object' && 'image' in body) {
      const { image, mimeType } = /** @type {{image: Buffer, mimeType: string}} */ (body);
      const result = await analyzeImage(image);
      const fields = /** @type {{manufacturer: string | null, model: string | null, serial: string | null, year: number | null}} */ (result.fields);
      const record = evidence.store(null, mimeType, image, fields, result.ocrText, now().toISOString());
      return { evidenceId: record.id, fields: result.fields, ocrText: result.ocrText, metadata: result.metadata };
    }
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
    const correctionMatch = path.match(/^\/api\/installed-equipment\/([0-9a-f-]+)\/corrections$/);
    if (correctionMatch && method === 'POST') {
      const itemId = z.uuid().parse(correctionMatch[1]); const input = correctionSchema.parse(body);
      let value = input.value;
      if (input.field === 'modality') value = z.enum(modalities).nullable().parse(value);
      else if (input.field === 'quantity') value = z.number().int().min(1).max(10000).nullable().parse(value);
      else if (input.field === 'age') value = z.number().min(0).max(150).nullable().parse(value);
      else value = z.string().trim().min(1).max(300).nullable().parse(value);
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Selecciona un perfil de colaborador para corregir el dato.');
      db.exec('BEGIN');
      try { const result = base.correct(itemId, input.field, value, input.reason, profile(String(active.value))); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const conflictMatch = path.match(/^\/api\/conflicts\/([0-9a-f-]+)\/resolve$/);
    if (conflictMatch && method === 'POST') {
      const conflictId = z.uuid().parse(conflictMatch[1]); const input = conflictResolutionSchema.parse(body);
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Selecciona un perfil de colaborador para resolver el conflicto.');
      db.exec('BEGIN');
      try { const result = base.resolveConflict(conflictId, input.value, input.explanation, profile(String(active.value))); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const duplicateDecisionMatch = path.match(/^\/api\/duplicate-candidates\/([0-9a-f-]+)\/decision$/);
    if (duplicateDecisionMatch && method === 'POST') {
      const candidateId = z.uuid().parse(duplicateDecisionMatch[1]);
      const { decision } = duplicateDecisionSchema.parse(body);
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Selecciona un perfil de colaborador para revisar el candidato.');
      db.exec('BEGIN');
      try {
        const result = base.decideDuplicate(candidateId, decision, profile(String(active.value)));
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const opportunityReviewMatch = path.match(/^\/api\/opportunities\/([0-9a-f-]+)\/review$/);
    if (opportunityReviewMatch && method === 'POST') {
      const itemId = z.uuid().parse(opportunityReviewMatch[1]);
      const input = opportunityReviewSchema.parse(body);
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Selecciona un perfil de colaborador para revisar la oportunidad.');
      const installedRow = db.prepare('SELECT hospital_id FROM installed_equipment WHERE id = ?').get(itemId);
      let hospitalId = installedRow ? String(installedRow.hospital_id) : null;
      if (!hospitalId) {
        const demoRow = db.prepare('SELECT data FROM regional_demo_equipment WHERE id = ?').get(itemId);
        hospitalId = demoRow ? JSON.parse(String(demoRow.data)).hospitalId : null;
      }
      if (!hospitalId) throw new RequestError(404, 'El equipo de la oportunidad no existe.');
      return opportunity.decide(itemId, hospitalId, input.decision, input.note, profile(String(active.value)));
    }
    if (path === '/api/drafts' && method === 'POST') {
      const { text, source: channel, manual: manualRequested } = captureSchema.parse(body);
      const capturedAt = now().toISOString();
      const active = db.prepare("SELECT value FROM preferences WHERE key = 'activeProfile'").get();
      if (!active) throw new RequestError(409, 'Crea y selecciona un perfil de colaborador antes de capturar.');
      const collaborator = profile(String(active.value));
      const validationIssues = [];
      let validResult;
      let bestResult;
      let attempts = 0;
      let correctiveInstruction = 'Respeta la estructura completa del schema. Devuelve null JSON real para datos ausentes, nunca textos como "null" o "no specified". Copia cada valor no nulo literalmente, sin cambiar singular o plural. No inventes una cantidad al dividir un grupo.';
      for (attempts = 1; !manualRequested && attempts <= 2; attempts += 1) {
        try {
          const extraction = await extractText(text, { attempt: attempts,
            ...(attempts === 2 ? { correctiveInstruction } : {}) });
          const inference = inferenceSchema.parse(extraction.metadata);
          const cleanedFields = sanitizeExtraction(extraction.fields);
          const validation = validateExtraction(cleanedFields, text, new Date(capturedAt));
          const score = Number(validation.reviewed.hospital !== null) * 10 + validation.reviewed.equipment.reduce((total, item) => total + Object.values(item).filter(value => value !== null).length, 0);
          const candidate = { extraction, inference, reviewed: validation.reviewed, cleanedFields, score, issues: validation.issues, attempt: attempts };
          if (!bestResult || candidate.score > bestResult.score) bestResult = candidate;
          if (validation.issues.length) {
            validationIssues.push(...validation.issues);
            correctiveInstruction = `Corrige la salida anterior. ${correctiveInstruction} Errores detectados: ${validation.issues.slice(0, 6).join(' ')}`;
            continue;
          }
          validResult = candidate;
          break;
        } catch (error) {
          console.error(`[SiteSignal] Intento ${attempts} de extracción falló:`, error);
          validationIssues.push(`Intento ${attempts}: QVAC no devolvió el schema completo y válido.`);
        }
      }
      if (!validResult && bestResult?.reviewed.hospital && bestResult.reviewed.equipment.some(item => item.modality !== null)) {
        validResult = bestResult; attempts = 2;
      }
      const manual = manualRequested || !validResult;
      const reviewed = validResult?.reviewed ?? { client: null, hospital: null, area: null, equipment: [
        { modality: null, quantity: null, manufacturer: null, model: null, serial: null, age: null },
      ] };
      const issues = [...new Set(validResult ? validResult.issues : validationIssues)];
      const provenance = validResult
        ? { kind: 'qvac', channel, metadata: validResult.inference, attempts, retryCorrected: attempts === 2, partial: validResult.issues.length > 0, validationIssues: issues }
        : { kind: 'manual', channel, attempts: manualRequested ? 0 : 2, validationIssues: issues };
      const draft = { id: randomUUID(), originalText: text, reviewed,
        extracted: validResult?.cleanedFields ?? null, profile: collaborator, provenance, capturedAt, followUpHistory: [] };
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
      if (!hospital) {
        const fictionalHospital = regional.hospital(id);
        if (fictionalHospital) return fictionalHospital;
        throw new RequestError(404, 'El hospital no existe.');
      }
      const installedBaseData = base.present(id);
      const observationRows = db.prepare('SELECT data FROM observations WHERE hospital_id = ? ORDER BY rowid DESC').all(id).map(row => JSON.parse(String(row.data)));
      const opportunityList = opportunitiesForHospital(id, installedBaseData.items, installedBaseData.conflicts, observationRows);
      return { ...hospital, coordinates: coordinatesFor(String(hospital.city ?? ''), String(hospital.country ?? '')), installedBase: { ...installedBaseData, opportunities: opportunityList }, observations: observationRows.map(observation => presentObservation(observation)) };
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
      // Creating a hospital is a separate identity decision from creating an observation: without this
      // check, saving twice with "Crear un hospital con los datos revisados" for what is really the same
      // site (a slightly different narration of the same visit, a second visit typed instead of picked
      // from the dropdown) silently produces two disconnected hospital records — each with its own
      // installed base — and the existing duplicate-equipment detection never runs across them, since it
      // is scoped per hospital. Reject an exact name match unless city/country data actually distinguishes
      // the two sites (two genuinely different hospitals can share a common generic name); require the
      // explicit choice the UI already offers, the same way equipment duplicates stay pending for a human
      // decision instead of being merged or duplicated automatically.
      if (!hospital && input.reviewed.hospital) {
        const existingMatch = findExactHospitalMatch(input.reviewed);
        if (existingMatch) throw new RequestError(409, `Ya existe un hospital llamado "${existingMatch.name}"${existingMatch.client ? ` (cliente: ${existingMatch.client})` : ''}. Selecciónalo en "Destino de la observación" en vez de crear uno nuevo, para no duplicar la base instalada.`);
      }
      db.exec('BEGIN');
      try {
        if (!hospital) {
          hospital = { id: randomUUID(), name: input.reviewed.hospital, client: input.reviewed.client, city: input.reviewed.city ?? null,
            country: input.reviewed.country ?? null, region: regionFor(input.reviewed.country ?? null) };
          db.prepare('INSERT INTO hospitals VALUES (?, ?, ?, ?, ?, ?)').run(hospital.id, hospital.name, hospital.client, hospital.city, hospital.country, hospital.region);
        }
        const observation = { id: randomUUID(), hospitalId: hospital.id, originalText: draft.originalText,
          reviewed: { ...input.reviewed, hospital: hospital.name, client: hospital.client, city: hospital.city ?? null, country: hospital.country ?? null }, extracted: draft.extracted,
          profile: draft.profile, provenance: draft.provenance, evidenceIds: input.evidenceIds ?? [],
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
