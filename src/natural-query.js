import { z } from 'zod';
import { inferenceSchema, modalities, normalize } from './observation-schema.js';
import { RequestError } from './request-error.js';

export const naturalFiltersSchema = z.object({
  country: z.string().trim().min(1).max(100).nullable(), city: z.string().trim().min(1).max(100).nullable(),
  client: z.string().trim().min(1).max(200).nullable(), hospital: z.string().trim().min(1).max(200).nullable(),
  modality: z.string().trim().min(1).max(100).nullable(), minAge: z.number().min(0).max(150).nullable(), maxAge: z.number().min(0).max(150).nullable(),
  state: z.enum(['Confirmado', 'Reportado', 'Estimado', 'Desconocido']).nullable(),
  confidence: z.enum(['Baja', 'Media', 'Alta']).nullable(), freshness: z.enum(['Vigente', 'Desactualizada']).nullable(),
}).strict();
export const naturalInterpretationSchema = z.object({ intent: z.enum(['filter', 'unsupported']), filters: naturalFiltersSchema,
  ambiguity: z.string().trim().min(1).max(300).nullable() }).strict();
export const naturalQuerySystemPrompt = `Interpret a natural-language request only as filters for a fictional hospital equipment panorama. Return JSON matching the schema. Supported intent is filter; use unsupported for deletion, mutation, prediction, diagnosis, recommendations, arbitrary analytics, or unrelated requests. Canonical countries: Panamá, Brasil, Colombia. Canonical modalities: ${modalities.join(', ')}. Canonical states: Confirmado, Reportado, Estimado, Desconocido. Confidence: Baja, Media, Alta. Freshness: Vigente, Desactualizada. Use null for absent filters. For Brazil or Brazilian return Brasil. For MR/MRI/resonador return Resonancia magnética. Extract numeric age bounds when present; the application verifies them independently. Set ambiguity only when applying a filter would require guessing a missing comparison or entity. Never produce SQL. /no_think`;
const questionSchema = z.object({ question: z.string().trim().min(3).max(1000) }).strict();

/** @param {string} question */
function ageBounds(question) {
  const words = { cero: 0, zero: 0, un: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4,
    cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
    diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13,
    catorce: 14, fourteen: 14, quince: 15, fifteen: 15, sixteen: 16, dieciseis: 16, seventeen: 17,
    diecisiete: 17, eighteen: 18, dieciocho: 18, nineteen: 19, diecinueve: 19, twenty: 20, veinte: 20 };
  let text = normalize(question);
  for (const [word, value] of Object.entries(words)) text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), String(value));
  if (!/\b(anos?|years?|age|antiguedad|older|younger)\b/.test(text)) return { minAge: null, maxAge: null };
  const range = text.match(/(?:\bentre\b|\bbetween\b)\s+(\d+(?:\.\d+)?)\s+(?:y|and)\s+(\d+(?:\.\d+)?)/);
  if (range) return { minAge: Number(range[1]), maxAge: Number(range[2]) };
  const strictMin = text.match(/(?:\bmayor(?:es)?(?:\s+(?:que|a|de))?|\bmas de|\bolder than|\bmore than)\s+(\d+(?:\.\d+)?)/);
  const inclusiveMin = text.match(/(?:\bal menos|\bminim[oa]?|\bat least)\s+(?:de\s+)?(\d+(?:\.\d+)?)/);
  const strictMax = text.match(/(?:\bmenor(?:es)?(?:\s+(?:que|a))?|\bmenos de|\byounger than|\bless than)\s+(\d+(?:\.\d+)?)/);
  const inclusiveMax = text.match(/(?:\bhasta|\bmaxim[oa]?|\bat most|\bup to)\s+(?:de\s+)?(\d+(?:\.\d+)?)/);
  return {
    minAge: strictMin ? Number(strictMin[1]) + 1 : inclusiveMin ? Number(inclusiveMin[1]) : null,
    maxAge: strictMax ? Math.max(0, Number(strictMax[1]) - 1) : inclusiveMax ? Number(inclusiveMax[1]) : null,
  };
}

/** @param {string | null} requested @param {string[]} allowed @param {string} label */
function canonical(requested, allowed, label) {
  if (requested === null) return null;
  /** @type {Record<string, string>} */
  const aliases = { brazil: 'brasil', panama: 'panama', mri: 'resonancia magnetica', mr: 'resonancia magnetica', 'magnetic resonance': 'resonancia magnetica' };
  const requestedKey = aliases[normalize(requested)] ?? normalize(requested);
  const found = allowed.find(value => normalize(value) === requestedKey);
  if (!found) throw new RequestError(400, `${label} no coincide con una opción disponible.`);
  return found;
}

/** Keep only model filters that the question itself supports. @param {string} question @param {z.infer<typeof naturalFiltersSchema>} filters */
function ground(question, filters) {
  const text = normalize(question);
  const ages = ageBounds(question);
  /** @param {string | null} value */
  const quoted = value => value !== null && value.length > 3 && text.includes(normalize(value));
  /** @param {string | null} value @param {RegExp} generic */
  const specificQuoted = (value, generic) => quoted(value) && !generic.test(normalize(value ?? ''));
  /** @type {Record<string, RegExp>} */
  const countryPatterns = { 'Panamá': /\bpanama/, Brasil: /\bbrasil|\bbrazil|brasilen|brasileir|brazilian/, Colombia: /\bcolombia|colombian/ };
  /** @type {Record<string, RegExp>} */
  const modalityPatterns = { 'Resonancia magnética': /resonancia|resonador|magnetic resonance|\bmri?\b/, 'Tomografía computarizada': /tomograf|computed tomography|\bct\b/, Ultrasonido: /ultrason|ultrasound/, 'Monitoreo de pacientes': /monitor/, 'Rayos X': /rayos|x.?ray/, 'Sistema intervencionista': /interven/,
    'Mamografía': /mamograf|mammogra/, 'Medicina nuclear / PET': /medicina nuclear|nuclear medicine|\bpet\b/, 'Electrocardiografía': /electrocardiograf|\becg\b|\bekg\b/, 'Ventilación mecánica': /ventilad|ventilator/, 'Desfibrilador': /desfibrilad|defibrillat/, 'Endoscopia': /endoscop/, Otro: /\botro\b|\bother\b/ };
  const statePatterns = { Confirmado: /confirmad|confirmed/, Reportado: /reportad|reported/, Estimado: /estimad|estimated/, Desconocido: /desconoc|unknown/ };
  const confidencePatterns = { Alta: /confianza alta|high confidence/, Media: /confianza media|medium confidence/, Baja: /confianza baja|low confidence/ };
  const freshnessPatterns = { Vigente: /vigent|recient|fresh|current/, Desactualizada: /desactual|stale|outdated/ };
  return {
    country: filters.country && (quoted(filters.country) || countryPatterns[filters.country]?.test(text)) ? filters.country : null,
    city: specificQuoted(filters.city, /^(ciudad|city|ubicacion|location)$/) ? filters.city : null,
    client: specificQuoted(filters.client, /^(clientes?|customers?)$/) ? filters.client : null,
    hospital: specificQuoted(filters.hospital, /^(hospital|hospitales|hospitals?)$/) ? filters.hospital : null,
    modality: filters.modality && (quoted(filters.modality) || modalityPatterns[filters.modality]?.test(text)) ? filters.modality : null,
    minAge: ages.minAge, maxAge: ages.maxAge,
    state: filters.state && statePatterns[filters.state].test(text) ? filters.state : null,
    confidence: filters.confidence && confidencePatterns[filters.confidence].test(text) ? filters.confidence : null,
    freshness: filters.freshness && freshnessPatterns[filters.freshness].test(text) ? filters.freshness : null,
  };
}

/** @param {{panorama: (params: URLSearchParams) => any}} regional @param {(question: string) => Promise<{fields: unknown, metadata: unknown}>} interpret */
export function naturalQuery(regional, interpret) {
  /** @param {unknown} body */
  return async function run(body) {
    const { question } = questionSchema.parse(body);
    const inference = await interpret(question);
    const metadata = inferenceSchema.parse(inference.metadata);
    const interpretation = naturalInterpretationSchema.parse(inference.fields);
    const limitations = 'La consulta usa solo filtros permitidos sobre la base local; no ejecuta SQL ni realiza predicciones.';
    if (interpretation.intent === 'unsupported') return { status: 'unsupported', question, filters: {}, result: null, provenance: metadata,
      explanation: 'Puedo filtrar el panorama por ubicación, cliente, hospital, modalidad, antigüedad, estado, confianza o vigencia.', limitations };
    const ambiguity = normalize(interpretation.ambiguity ?? '');
    const meaningfulAmbiguity = ambiguity && !/^(baja|media|alta|ninguna?|none|null|n\/a)$/.test(ambiguity);
    if (meaningfulAmbiguity) return { status: 'ambiguous', question, filters: {}, result: null, provenance: metadata,
      explanation: interpretation.ambiguity, limitations };
    const grounded = ground(question, interpretation.filters);
    const catalog = regional.panorama(new URLSearchParams()).filters;
    const filters = {
      country: canonical(grounded.country, catalog.countries, 'El país'),
      city: canonical(grounded.city, catalog.cities, 'La ciudad'),
      client: canonical(grounded.client, catalog.clients, 'El cliente'),
      hospital: grounded.hospital === null ? null : canonical(grounded.hospital,
        catalog.hospitals.flatMap(/** @param {{id:string,name:string}} hospital */ hospital => [hospital.id, hospital.name]), 'El hospital'),
      modality: canonical(grounded.modality, modalities, 'La modalidad'), minAge: grounded.minAge,
      maxAge: grounded.maxAge, state: grounded.state, confidence: grounded.confidence,
      freshness: grounded.freshness,
    };
    if (filters.minAge !== null && filters.maxAge !== null && filters.minAge > filters.maxAge) throw new RequestError(400, 'La antigüedad mínima no puede superar la máxima.');
    if (filters.hospital && !catalog.hospitals.some(/** @param {{id:string,name:string}} hospital */ hospital => hospital.id === filters.hospital)) {
      filters.hospital = catalog.hospitals.find(/** @param {{id:string,name:string}} hospital */ hospital => normalize(hospital.name) === normalize(filters.hospital ?? ''))?.id ?? null;
    }
    const compact = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null));
    if (!Object.keys(compact).length) return { status: 'ambiguous', question, filters: {}, result: null, provenance: metadata,
      explanation: 'No pude identificar un filtro concreto. Indica una ubicación, modalidad, antigüedad, estado, confianza o vigencia.', limitations };
    const params = new URLSearchParams(Object.entries(compact).map(([key, value]) => [key, String(value)]));
    const panorama = regional.panorama(params);
    /** @type {Record<string, string>} */
    const filterLabels = { country: 'país', city: 'ciudad', client: 'cliente', hospital: 'hospital', modality: 'modalidad', minAge: 'antigüedad mínima', maxAge: 'antigüedad máxima', state: 'estado', confidence: 'confianza', freshness: 'vigencia' };
    const labels = Object.entries(compact).map(([key, value]) => `${filterLabels[key]}: ${key === 'hospital' ? catalog.hospitals.find(/** @param {{id:string,name:string}} hospital */ hospital => hospital.id === value)?.name ?? value : value}`);
    return { status: 'applied', question, filters: compact, result: { hospitals: panorama.metrics.hospitals, equipment: panorama.metrics.equipment, averageConfidence: panorama.metrics.averageConfidence }, provenance: metadata,
      explanation: `Interpreté ${labels.join(' · ')}. Encontré ${panorama.metrics.equipment} equipos en ${panorama.metrics.hospitals} hospitales.`, limitations };
  };
}
