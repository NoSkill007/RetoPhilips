import { z } from 'zod';

export const roles = ['Ingeniero de servicio', 'Vendedor', 'Especialista'];
export const modalities = ['Resonancia magnética', 'Tomografía computarizada', 'Ultrasonido', 'Monitoreo de pacientes', 'Rayos X', 'Sistema intervencionista', 'Mamografía', 'Medicina nuclear / PET', 'Electrocardiografía', 'Ventilación mecánica', 'Desfibrilador', 'Endoscopia', 'Otro'];
const field = z.string().trim().min(1).max(300).nullable();
/** City/country are optional keys (not just nullable values) so observations captured, stored, or asserted in
 * tests before this field existed keep parsing without every fixture needing to add them. */
const optionalField = field.optional();
export const rawSchema = z.object({
  client: field, hospital: field, area: field, city: optionalField, country: optionalField,
  equipment: z.array(z.object({ modality: field, quantity: field, manufacturer: field, model: field, serial: field, age: field }).strict()).min(1).max(20),
}).strict();
export const reviewedSchema = z.object({
  client: field, hospital: field, area: field, city: optionalField, country: optionalField,
  // Free-form note the collaborator adds during review — never extracted by QVAC, never validated
  // against the source text (it's their own annotation, not a claim about the equipment).
  comments: z.string().trim().max(1000).nullable().optional(),
  equipment: z.array(z.object({
    modality: z.enum(modalities).nullable(), quantity: z.number().int().min(1).max(10000).nullable(),
    manufacturer: field, model: field, serial: field, age: z.number().min(0).max(150).nullable(),
  }).strict()).min(1).max(20),
}).strict();
export const inferenceSchema = z.object({ engine: z.string(), model: z.string(), durationMs: z.number().nonnegative() }).strict();
export const profileSchema = z.object({ name: z.string().trim().min(1).max(80), role: z.enum(roles) }).strict();
export const activeSchema = z.object({ profileId: z.uuid() }).strict();
export const captureSchema = z.object({ text: z.string().max(8000).refine(value => value.trim().length >= 5),
  source: z.enum(['text', 'voice']).default('text'), manual: z.boolean().default(false) }).strict();
export const saveSchema = z.object({
  draftId: z.uuid(), reviewed: reviewedSchema, hospitalId: z.uuid().nullable(), splitGroupId: z.uuid().nullable().optional(),
  evidenceIds: z.array(z.uuid()).max(10).optional(),
}).strict();
/** @typedef {z.infer<typeof reviewedSchema>} ReviewedObservation */
/** @typedef {{fields: unknown, metadata: z.infer<typeof inferenceSchema>}} Extraction */
/** @typedef {{attempt: number, correctiveInstruction?: string}} ExtractionOptions */
/** @typedef {(text: string, options?: ExtractionOptions) => Promise<Extraction>} TextExtractor */

/** @param {string} value */
export function normalize(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
/** Generic institution-type words that a real hospital name is built around ("Hospital Santo Tom\u00e1s",
 * "Cl\u00ednica Santo Tom\u00e1s", or just "Santo Tom\u00e1s" once the type is dropped) \u2014 shared by the extraction
 * anchor below and by the hospital-name matching in observations.js, so the same word list decides
 * both "does this text mention a hospital" and "are these two hospital names actually the same site". */
export const institutionTypeWords = 'hospital|clinica|clinic|centro medico|medical center|instituto|institute|policlinica|policlinic|sanatorio|centro de salud|health center';
/** Strips a leading/trailing institution-type word so "Hospital Santo Tom\u00e1s" and "Santo Tom\u00e1s" reduce
 * to the same core name \u2014 a collaborator often narrates the same site with or without the generic word
 * between visits. Falls back to the plain normalized name whenever stripping would leave nothing
 * distinctive (a bare "Hospital" with no name of its own must never match every other bare "Hospital").
 * @param {string} value */
export function hospitalCoreName(value) {
  const stripped = normalize(value).replace(new RegExp(`\\b(?:${institutionTypeWords})\\b`, 'g'), '').replace(/\s+/g, ' ').trim();
  return stripped.length >= 2 ? stripped : normalize(value);
}
/** Convert common model placeholders for missing data into actual JSON null values before evidence validation.
 * @param {unknown} raw
 */
export function sanitizeExtraction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  /** @param {unknown} value */
  const fieldValue = value => typeof value === 'string' && /^(?:null|none|n\/?a|unknown|not specified|no specified|desconocido|no especificado)$/i.test(value.trim()) ? null : value;
  const input = /** @type {Record<string, any>} */ (raw);
  return {
    ...input, client: fieldValue(input.client), hospital: fieldValue(input.hospital), area: fieldValue(input.area),
    city: fieldValue(input.city), country: fieldValue(input.country),
    equipment: Array.isArray(input.equipment) ? input.equipment.map(item => item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, fieldValue(value)])) : item) : input.equipment,
  };
}
/** @param {string | null} value */
function numeric(value) {
  if (!value) return null;
  const normalized = normalize(value);
  const digits = normalized.match(/\b\d+(?:[.,]\d+)?\b/);
  if (digits) return Number(digits[0].replace(',', '.'));
  const words = [ ['cero', 'zero'], ['un', 'uno', 'una', 'one'], ['dos', 'two'], ['tres', 'three'], ['cuatro', 'four'], ['cinco', 'five'], ['seis', 'six'], ['siete', 'seven'], ['ocho', 'eight'], ['nueve', 'nine'], ['diez', 'ten'], ['once', 'eleven'], ['doce', 'twelve'] ];
  const index = words.findIndex(group => group.some(word => normalized.split(/\W+/).includes(word)));
  return index === -1 ? null : index;
}
/** Keyword stems for each canonical modality, shared by classification and by locating a mention in the
 * source independently of the model's own (possibly non-literal) wording — see `modality()` below.
 * @type {[RegExp, string][]} */
const modalityPatternList = [
  [/resona|\bmri?\b|magnetic/, modalities[0]],
  [/tomograf|\bct\b|computed tomography/, modalities[1]],
  [/ultra|\bus\b|ecograf|sonograph/, modalities[2]],
  [/monitor/, modalities[3]],
  [/rayos|x.ray/, modalities[4]],
  [/interven/, modalities[5]],
  [/mamograf|mammogra/, modalities[6]],
  [/medicina nuclear|nuclear medicine|\bpet\b/, modalities[7]],
  [/electrocardiograf|\becg\b|\bekg\b/, modalities[8]],
  [/ventilad|ventilator/, modalities[9]],
  [/desfibrilad|defibrillat/, modalities[10]],
  [/endoscop/, modalities[11]],
  [/\botro\b|\bother\b/, modalities[12]],
];
/** @param {string | null} value */
function modality(value) {
  if (!value) return null;
  const text = normalize(value);
  return modalityPatternList.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}
/** Converts a duration ("ocho años") or, absent one, an install year stated nearby ("instalado en 2018",
 * "desde 2018") into an age in years as of `now`. A bare year with no installation cue is left unknown,
 * since a random four-digit number in the clause is not reliably an equipment date.
 * @param {string | null} value @param {string} context @param {Date} now */
function ageInYears(value, context, now) {
  if (!value || !context.includes(normalize(value))) return null;
  const normalizedValue = normalize(value);
  if (/\b(anos?|years?)\b/.test(normalizedValue)) return numeric(value);
  const year = normalizedValue.match(/\b(19\d{2}|20\d{2})\b/);
  if (!year) return null;
  const valueIndex = context.indexOf(normalizedValue);
  const before = context.slice(Math.max(0, valueIndex - 40), valueIndex);
  if (!/instal|\bdesde\b|\bsince\b|\bfrom\b/.test(before)) return null;
  const age = now.getFullYear() - Number(year[1]);
  return age >= 0 && age <= 150 ? age : null;
}
/** Retain only literal source-backed strings; semantic validation expands in #4.
 * @param {unknown} raw @param {string} source @param {Date} [now]
 */
export function validateExtraction(raw, source, now = new Date()) {
  const fields = rawSchema.parse(raw);
  const normalizedSource = normalize(source);
  /** @param {string} value */
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** @param {string | null} value */
  const supported = value => value && normalizedSource.includes(normalize(value)) ? value : null;
  /** @param {string | null} value @param {string} label */
  const anchored = (value, label) => {
    const accepted = supported(value);
    if (!accepted) return null;
    // Leading boundary only (no trailing \b): label stems must still start a word, but the value's own
    // inflection can run on past the stem — "Centro Clínico" (clínico) must match a "clinica" label the
    // same way "Clínica" does; a full-word match would silently miss every adjective/plural form.
    if (new RegExp(`\\b(?:${label})`, 'i').test(normalize(accepted))) return accepted;
    const quoted = escape(normalize(accepted));
    // The label must lead straight into the value (at most one short connector word) — not just appear
    // somewhere in the preceding 35 characters. "Hospital San Gabriel en La Paz, Bolivia" must not let
    // "Hospital" anchor "La Paz, Bolivia" merely because it precedes it; a real other name sits between them.
    const connector = '(?:\\s+(?:de la|del|de|la|el|los|las|the|of)\\b)?\\s*';
    return new RegExp(`\\b(?:${label})${connector}${quoted}`, 'i').test(normalizedSource) ? accepted : null;
  };
  /** Falls back to accepting a value stated right next to the hospital mention (e.g. "en São Paulo, Brasil,
   * en el Hospital Aurora", or "Instituto Radiológico del Sur en Montevideo, Uruguay") when no explicit
   * "ciudad"/"país" label is present — the same natural-speech gap as equipment manufacturer/model.
   * Distance is measured to the nearer edge of the hospital name span, not a single fixed point, since a
   * long facility name otherwise pushes anything stated right after it out of a start-anchored range.
   * @param {string | null} value @param {string} label @param {{start: number, end: number} | null} hospitalSpan */
  const anchoredNearHospital = (value, label, hospitalSpan) => {
    const direct = anchored(value, label);
    if (direct) return direct;
    const accepted = supported(value);
    if (!accepted || !hospitalSpan) return null;
    const valueIndex = normalizedSource.indexOf(normalize(accepted));
    if (valueIndex < 0) return null;
    const distance = valueIndex >= hospitalSpan.start && valueIndex <= hospitalSpan.end ? 0
      : Math.min(Math.abs(valueIndex - hospitalSpan.start), Math.abs(valueIndex - hospitalSpan.end));
    return distance <= 40 ? accepted : null;
  };
  // Classify each equipment's modality by keyword stem rather than requiring the model to quote the source
  // verbatim: a smaller model routinely paraphrases "tomógrafos" (the device) as "tomografía computarizada"
  // (the procedure) — same modality, different inflection — and a literal-substring gate would reject that.
  const categories = fields.equipment.map(item => modality(item.modality));
  const occurrences = new Map();
  const mentions = categories.map(category => {
    const entry = category ? modalityPatternList.find(([, name]) => name === category) : undefined;
    if (!entry) return -1;
    const pattern = new RegExp(entry[0].source, entry[0].flags.includes('g') ? entry[0].flags : `${entry[0].flags}g`);
    const matches = [...normalizedSource.matchAll(pattern)];
    if (!matches.length) return -1;
    const occurrence = occurrences.get(category) ?? 0;
    occurrences.set(category, occurrence + 1);
    return (matches[occurrence] ?? matches[0]).index ?? -1;
  });
  const positions = [...new Set(mentions.filter(position => position >= 0))].sort((a, b) => a - b);
  /** @param {number} itemIndex */
  function clauseFor(itemIndex) {
    const mention = mentions[itemIndex];
    if (mention < 0) return '';
    const before = [normalizedSource.lastIndexOf('.', mention - 1), normalizedSource.lastIndexOf('\n', mention - 1)];
    let start = Math.max(...before) + 1;
    // A single reported equipment has no sibling mention that later sentences could bleed into, so everything
    // stated after it (an install year, a brand named after "no estoy seguro...") stays in its context — but
    // text before it (e.g. a hospital name sentence) is left bounded, since that risk is independent of sibling count.
    const after = positions.length <= 1 ? [] : [normalizedSource.indexOf('.', mention), normalizedSource.indexOf('\n', mention)].filter(position => position >= 0);
    let end = after.length ? Math.min(...after) : normalizedSource.length;
    const previous = positions.filter(position => position < mention && position >= start).at(-1);
    const next = positions.find(position => position > mention && position <= end);
    const delimiters = /(?:\s+y\s+|\s+and\s+|;|,)/g;
    if (previous !== undefined) {
      const matches = [...normalizedSource.slice(previous, mention).matchAll(delimiters)];
      const last = matches.at(-1);
      start = last ? previous + last.index + last[0].length : mention;
    }
    if (next !== undefined) {
      const matches = [...normalizedSource.slice(mention, next).matchAll(delimiters)];
      const last = matches.at(-1);
      end = last ? mention + last.index : next;
    }
    return normalizedSource.slice(start, end);
  }
  const equipment = fields.equipment.map((item, itemIndex) => {
    const category = categories[itemIndex];
    const context = clauseFor(itemIndex);
    const categoryPattern = category ? modalityPatternList.find(([, name]) => name === category)?.[0] : undefined;
    const modalityIndex = categoryPattern ? (context.match(categoryPattern)?.index ?? -1) : -1;
    /** Descriptive adjectives a model routinely mistakes for a manufacturer/model name because they sit
     * right next to the equipment noun ("un ecógrafo básico", "a portable ultrasound") — real product
     * identifiers don't collide with this closed list, so it only ever blocks noise, never a genuine name. */
    const descriptiveNoise = /^(?:basico|basica|basic|portatil|portable|moderno|moderna|modern|nuevo|nueva|new|viejo|vieja|old|antiguo|antigua|chico|chica|small|grande|large|fijo|fija|fixed|stationary|movil|mobile|digital|analogo|analogic|analog)s?$/;
    /** Accept a value either next to an explicit label (e.g. "fabricante GE") or, absent a label, adjacent to
     * the equipment's own modality mention (e.g. "un ecógrafo GE Voluson") or to another already-accepted
     * anchor (e.g. "Philips Brilliance" — model sits next to the manufacturer, one hop further from modality) —
     * natural speech usually states the brand/model right next to the equipment noun without labeling it.
     * @param {string | null} value @param {string} label @param {boolean} [allowAdjacent] @param {number} [extraAnchorIndex] */
    const equipmentField = (value, label, allowAdjacent = false, extraAnchorIndex = -1) => {
      const accepted = value && context.includes(normalize(value)) ? value : null;
      if (!accepted) return null;
      const quoted = escape(normalize(accepted));
      if (new RegExp(`(?:${label})[^,;.\\n]{0,30}\\b${quoted}\\b`, 'i').test(context)) return accepted;
      if (!allowAdjacent || descriptiveNoise.test(normalize(accepted))) return null;
      const valueIndex = context.indexOf(normalize(accepted));
      if (valueIndex < 0) return null;
      if (modalityIndex >= 0 && Math.abs(valueIndex - modalityIndex) <= 40) return accepted;
      return extraAnchorIndex >= 0 && Math.abs(valueIndex - extraAnchorIndex) <= 40 ? accepted : null;
    };
    const quantity = numeric(item.quantity);
    const quantitySupported = quantity === null ? null : [...context.matchAll(/\d+(?:[.,]\d+)?|[a-z]+/g)].some(match => {
      const tokenIndex = match.index;
      return numeric(match[0]) === quantity && ((modalityIndex >= 0 && Math.abs(tokenIndex - modalityIndex) <= 30) || /(?:cantidad|quantity|count)[^,;.\n]{0,20}$/.test(context.slice(0, tokenIndex)));
    }) ? quantity : null;
    const manufacturer = equipmentField(item.manufacturer, 'fabricante|marca|manufacturer|brand|made by', true);
    const manufacturerIndex = manufacturer ? context.indexOf(normalize(manufacturer)) : -1;
    return {
      modality: category, quantity: quantitySupported, manufacturer,
      model: equipmentField(item.model, 'modelo|model', true, manufacturerIndex),
      serial: equipmentField(item.serial, 'numero de serie|número de serie|serial|s[\\s./-]*n'),
      age: ageInYears(item.age, context, now),
    };
  });
  const unique = equipment.filter((item, index) => equipment.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(item)) === index);
  const hospitalLabel = institutionTypeWords;
  // A single-site facility name is sometimes swapped into "client" by the model instead of "hospital" (there
  // being no separate parent organization to report) — recover it there if the hospital guess didn't pan out.
  const hospitalAccepted = anchored(fields.hospital, hospitalLabel) ?? anchored(fields.client, hospitalLabel);
  const hospitalStart = hospitalAccepted ? normalizedSource.indexOf(normalize(hospitalAccepted)) : -1;
  const hospitalSpan = hospitalStart >= 0 ? { start: hospitalStart, end: hospitalStart + normalize(hospitalAccepted ?? '').length } : null;
  const reviewed = reviewedSchema.parse({
    client: anchored(fields.client, 'cliente|client|organizacion|organization'),
    hospital: hospitalAccepted,
    area: anchored(fields.area, 'area|departamento|department|edificio|building|sala|unidad|servicio|consultorio|piso|planta|ala|pabellon|room|unit|service|ward|wing|floor'),
    city: anchoredNearHospital(fields.city ?? null, 'ciudad|city', hospitalSpan),
    country: anchoredNearHospital(fields.country ?? null, 'pais|country', hospitalSpan),
    equipment: unique,
  });
  const issues = [];
  const locationLabels = { client: 'Cliente', hospital: 'Hospital', area: 'Área', city: 'Ciudad', country: 'País' };
  for (const key of /** @type {const} */ (['client', 'hospital', 'area', 'city', 'country'])) {
    if (fields[key] != null && reviewed[key] === null) issues.push(`${locationLabels[key]} rechazado: no está respaldado en ese contexto del relato.`);
  }
  const equipmentLabels = { modality: 'Modalidad', quantity: 'Cantidad', manufacturer: 'Fabricante', model: 'Modelo', serial: 'Número de serie', age: 'Antigüedad' };
  fields.equipment.forEach((item, index) => {
    const accepted = equipment[index];
    if (!accepted) return;
    for (const key of /** @type {const} */ (['modality', 'quantity', 'manufacturer', 'model', 'serial', 'age'])) {
      if (item[key] !== null && accepted[key] === null) issues.push(`${equipmentLabels[key]} del equipo ${index + 1} rechazado: no está respaldado en su cláusula o no pertenece al catálogo permitido.`);
    }
  });
  return { reviewed, issues };
}

/** @param {unknown} raw @param {string} source */
export function reviewExtraction(raw, source) { return validateExtraction(raw, source).reviewed; }
