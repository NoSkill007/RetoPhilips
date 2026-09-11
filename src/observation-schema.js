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
  equipment: z.array(z.object({
    modality: z.enum(modalities).nullable(), quantity: z.number().int().min(1).max(10000).nullable(),
    manufacturer: field, model: field, serial: field, age: z.number().min(0).max(150).nullable(),
  }).strict()).min(1).max(20),
}).strict();
export const inferenceSchema = z.object({ engine: z.string(), model: z.string(), durationMs: z.number().nonnegative() }).strict();
export const profileSchema = z.object({ name: z.string().trim().min(1).max(80), role: z.enum(roles) }).strict();
export const activeSchema = z.object({ profileId: z.uuid() }).strict();
export const captureSchema = z.object({ text: z.string().max(8000).refine(value => value.trim().length >= 5) }).strict();
export const saveSchema = z.object({
  draftId: z.uuid(), reviewed: reviewedSchema, hospitalId: z.uuid().nullable(), splitGroupId: z.uuid().nullable().optional(),
}).strict();
/** @typedef {z.infer<typeof reviewedSchema>} ReviewedObservation */
/** @typedef {{fields: unknown, metadata: z.infer<typeof inferenceSchema>}} Extraction */
/** @typedef {{attempt: number, correctiveInstruction?: string}} ExtractionOptions */
/** @typedef {(text: string, options?: ExtractionOptions) => Promise<Extraction>} TextExtractor */

/** @param {string} value */
export function normalize(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
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
/** @param {string | null} value */
function modality(value) {
  if (!value) return null;
  const text = normalize(value);
  const patterns = [/resonancia|\bmri?\b|magnetic/, /tomograf|\bct\b|computed tomography/, /ultra|\bus\b|ecograf|sonograph/, /monitor/, /rayos|x.ray/, /interven/,
    /mamograf|mammogra/, /medicina nuclear|nuclear medicine|\bpet\b/, /electrocardiograf|\becg\b|\bekg\b/, /ventilad|ventilator/, /desfibrilad|defibrillat/, /endoscop/];
  const index = patterns.findIndex(pattern => pattern.test(text));
  if (index >= 0) return modalities[index];
  return /\botro\b|\bother\b/.test(text) ? modalities.at(-1) : null;
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
    if (new RegExp(`\\b(?:${label})\\b`, 'i').test(normalize(accepted))) return accepted;
    const quoted = escape(normalize(accepted));
    return new RegExp(`(?:${label})[^.\\n]{0,35}\\b${quoted}\\b`, 'i').test(normalizedSource) ? accepted : null;
  };
  /** Falls back to accepting a value stated right next to the hospital mention (e.g. "en São Paulo, Brasil,
   * en el Hospital Aurora") when no explicit "ciudad"/"país" label is present — the same natural-speech gap
   * as equipment manufacturer/model. @param {string | null} value @param {string} label @param {number} anchorIndex */
  const anchoredNearHospital = (value, label, anchorIndex) => {
    const direct = anchored(value, label);
    if (direct) return direct;
    const accepted = supported(value);
    if (!accepted || anchorIndex < 0) return null;
    const valueIndex = normalizedSource.indexOf(normalize(accepted));
    return valueIndex >= 0 && Math.abs(valueIndex - anchorIndex) <= 40 ? accepted : null;
  };
  const occurrences = new Map();
  const mentions = fields.equipment.map(item => {
    const value = normalize(supported(item.modality) ?? '');
    if (!value) return -1;
    const occurrence = occurrences.get(value) ?? 0;
    let position = -1;
    let from = 0;
    for (let index = 0; index <= occurrence; index += 1) {
      position = normalizedSource.indexOf(value, from);
      if (position === -1) break;
      from = position + value.length;
    }
    occurrences.set(value, occurrence + 1);
    return position === -1 ? normalizedSource.indexOf(value) : position;
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
    const rawModality = supported(item.modality);
    const modalityText = normalize(rawModality ?? '');
    const context = clauseFor(itemIndex);
    const modalityIndex = context.indexOf(modalityText);
    /** Accept a value either next to an explicit label (e.g. "fabricante GE") or, absent a label,
     * simply adjacent to the equipment's own modality mention (e.g. "un ecógrafo GE Voluson") —
     * natural speech usually states the brand/model right next to the equipment noun without labeling it.
     * @param {string | null} value @param {string} label @param {boolean} [allowAdjacentToModality] */
    const equipmentField = (value, label, allowAdjacentToModality = false) => {
      const accepted = value && context.includes(normalize(value)) ? value : null;
      if (!accepted) return null;
      const quoted = escape(normalize(accepted));
      if (new RegExp(`(?:${label})[^,;.\\n]{0,30}\\b${quoted}\\b`, 'i').test(context)) return accepted;
      if (!allowAdjacentToModality || modalityText.length === 0 || modalityIndex < 0) return null;
      const valueIndex = context.indexOf(normalize(accepted));
      return valueIndex >= 0 && Math.abs(valueIndex - modalityIndex) <= 40 ? accepted : null;
    };
    const quantity = numeric(item.quantity);
    const quantitySupported = quantity === null ? null : [...context.matchAll(/\d+(?:[.,]\d+)?|[a-z]+/g)].some(match => {
      const tokenIndex = match.index;
      return numeric(match[0]) === quantity && ((tokenIndex <= modalityIndex && modalityIndex - tokenIndex <= 30) || /(?:cantidad|quantity|count)[^,;.\n]{0,20}$/.test(context.slice(0, tokenIndex)));
    }) ? quantity : null;
    return {
      modality: modality(rawModality), quantity: quantitySupported,
      manufacturer: equipmentField(item.manufacturer, 'fabricante|marca|manufacturer|brand|made by', true),
      model: equipmentField(item.model, 'modelo|model', true),
      serial: equipmentField(item.serial, 'numero de serie|número de serie|serial|s[\\s./-]*n'),
      age: ageInYears(item.age, context, now),
    };
  });
  const unique = equipment.filter((item, index) => equipment.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(item)) === index);
  const hospitalAccepted = anchored(fields.hospital, 'hospital|clinica|clinic|centro medico|medical center');
  const hospitalIndex = hospitalAccepted ? normalizedSource.indexOf(normalize(hospitalAccepted)) : -1;
  const reviewed = reviewedSchema.parse({
    client: anchored(fields.client, 'cliente|client|organizacion|organization'),
    hospital: hospitalAccepted,
    area: anchored(fields.area, 'area|departamento|department|edificio|building|sala|unidad|servicio|consultorio|piso|planta|ala|pabellon|room|unit|service|ward|wing|floor'),
    city: anchoredNearHospital(fields.city ?? null, 'ciudad|city', hospitalIndex),
    country: anchoredNearHospital(fields.country ?? null, 'pais|country', hospitalIndex),
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
