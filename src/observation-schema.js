import { z } from 'zod';

export const roles = ['Ingeniero de servicio', 'Vendedor', 'Especialista'];
export const modalities = ['Resonancia magnética', 'Tomografía computarizada', 'Ultrasonido', 'Monitoreo de pacientes', 'Rayos X', 'Sistema intervencionista', 'Otro'];
const field = z.string().trim().min(1).max(300).nullable();
export const rawSchema = z.object({
  client: field, hospital: field, area: field,
  equipment: z.array(z.object({ modality: field, quantity: field, manufacturer: field, model: field, serial: field, age: field }).strict()).min(1).max(20),
}).strict();
export const reviewedSchema = z.object({
  client: field, hospital: field, area: field,
  equipment: z.array(z.object({
    modality: z.enum(modalities).nullable(), quantity: z.number().int().min(1).max(10000).nullable(),
    manufacturer: field, model: field, serial: field, age: z.number().min(0).max(150).nullable(),
  }).strict()).min(1).max(20),
}).strict();
export const inferenceSchema = z.object({ engine: z.string(), model: z.string(), durationMs: z.number().nonnegative() }).strict();
export const profileSchema = z.object({ name: z.string().trim().min(1).max(80), role: z.enum(roles) }).strict();
export const activeSchema = z.object({ profileId: z.uuid() }).strict();
export const captureSchema = z.object({ text: z.string().max(8000).refine(value => value.trim().length >= 5) }).strict();
export const saveSchema = z.object({ draftId: z.uuid(), reviewed: reviewedSchema, hospitalId: z.uuid().nullable() }).strict();
/** @typedef {z.infer<typeof reviewedSchema>} ReviewedObservation */
/** @typedef {{fields: unknown, metadata: z.infer<typeof inferenceSchema>}} Extraction */
/** @typedef {(text: string) => Promise<Extraction>} TextExtractor */

/** @param {string} value */
export function normalize(value) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
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
/** @param {string | null} value @param {string} source */
function supportedNumber(value, source) {
  const candidate = numeric(value);
  if (candidate === null) return null;
  const tokens = normalize(source).match(/\d+(?:[.,]\d+)?|[a-z]+/g) ?? [];
  return tokens.some(token => numeric(token) === candidate) ? candidate : null;
}
/** @param {string | null} value */
function modality(value) {
  if (!value) return null;
  const text = normalize(value);
  const patterns = [/resonancia|\bmri?\b|magnetic/, /tomograf|\bct\b|computed tomography/, /ultra|\bus\b/, /monitor/, /rayos|x.ray/, /interven/];
  const index = patterns.findIndex(pattern => pattern.test(text));
  return modalities[index === -1 ? 6 : index];
}
/** @param {string | null} value */
function ageInYears(value) {
  return value && /\b(anos?|years?)\b/.test(normalize(value)) ? numeric(value) : null;
}
/** Retain only literal source-backed strings; semantic validation expands in #4.
 * @param {unknown} raw @param {string} source
 */
export function reviewExtraction(raw, source) {
  const fields = rawSchema.parse(raw);
  /** @param {string | null} value */
  const supported = value => value && normalize(source).includes(normalize(value)) ? value : null;
  const normalizedSource = normalize(source);
  /** @param {string | null} value @param {string} label */
  const anchored = (value, label) => {
    const accepted = supported(value);
    if (!accepted) return null;
    if (new RegExp(`\\b(?:${label})\\b`, 'i').test(normalize(accepted))) return accepted;
    const quoted = normalize(accepted).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:${label})[^.\\n]{0,35}\\b${quoted}\\b`, 'i').test(normalizedSource) ? accepted : null;
  };
  const equipment = fields.equipment.map(item => ({
      modality: modality(supported(item.modality)), quantity: supportedNumber(item.quantity, source),
      manufacturer: supported(item.manufacturer), model: supported(item.model), serial: supported(item.serial),
      age: ageInYears(supported(item.age)),
    }));
  const unique = equipment.filter((item, index) => equipment.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(item)) === index);
  return reviewedSchema.parse({
    client: anchored(fields.client, 'cliente|client|organizacion|organization|red'),
    hospital: anchored(fields.hospital, 'hospital|clinica|clinic|centro medico|medical center'),
    area: anchored(fields.area, 'area|departamento|department|edificio|building'),
    equipment: unique,
  });
}
