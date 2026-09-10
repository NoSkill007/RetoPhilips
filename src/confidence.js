import { normalize } from './observation-schema.js';

export const confidencePolicy = {
  bands: { Baja: [0, 49], Media: [50, 79], Alta: [80, 100] },
  components: { completeness: 40, freshness: 25, evidence: 35 },
};
/** @type {Record<string, number>} */
const weights = { hospital: 8, modality: 8, quantity: 8, manufacturer: 5, model: 5, age: 6 };
/** @type {Record<string, number>} */
const ranks = { Desconocido: 0, Estimado: 1, Reportado: 2, Confirmado: 3 };

/** @param {unknown} value @param {unknown} rawValue @param {string} source @param {boolean} confirmed */
function classify(value, rawValue, source, confirmed = false) {
  if (value === null || value === undefined || value === '') return { value: null, state: 'Desconocido' };
  if (confirmed) return { value, state: 'Confirmado' };
  if (typeof rawValue === 'string') {
    const normalizedSource = normalize(source);
    const position = normalizedSource.indexOf(normalize(rawValue));
    const context = position < 0 ? '' : normalizedSource.slice(Math.max(0, position - 45), position + normalize(rawValue).length);
    if (/aprox|parec|estimad|alrededor|cerca de|unos?\b|about|around|roughly|approximately|estimated/.test(context)) {
      return { value, state: 'Estimado' };
    }
  }
  return { value, state: 'Reportado' };
}

/** @param {{reviewed: any, originalText: string, extracted: any, capturedAt: string, confirmedFields?: string[]}} observation @param {Date} now */
export function assessObservation(observation, now) {
  const confirmed = new Set(observation.confirmedFields ?? []);
  const rawEquipment = Array.isArray(observation.extracted?.equipment) ? observation.extracted.equipment : [];
  const fields = {
    client: classify(observation.reviewed.client, observation.extracted?.client, observation.originalText, confirmed.has('client')),
    hospital: classify(observation.reviewed.hospital, observation.extracted?.hospital, observation.originalText, confirmed.has('hospital')),
    area: classify(observation.reviewed.area, observation.extracted?.area, observation.originalText, confirmed.has('area')),
  };
  const equipment = observation.reviewed.equipment.map(/** @param {any} item @param {number} index */ (item, index) => {
    const raw = rawEquipment[index] ?? {};
    return {
      modality: classify(item.modality, raw.modality, observation.originalText, confirmed.has(`equipment.${index}.modality`)),
      quantity: classify(item.quantity, raw.quantity, observation.originalText, confirmed.has(`equipment.${index}.quantity`)),
      manufacturer: classify(item.manufacturer, raw.manufacturer, observation.originalText, confirmed.has(`equipment.${index}.manufacturer`)),
      model: classify(item.model, raw.model, observation.originalText, confirmed.has(`equipment.${index}.model`)),
      serial: classify(item.serial, raw.serial, observation.originalText, confirmed.has(`equipment.${index}.serial`)),
      age: classify(item.age, raw.age, observation.originalText, confirmed.has(`equipment.${index}.age`)),
    };
  });
  const critical = [fields.hospital, ...equipment.flatMap(/** @param {any} item */ item => [item.modality, item.quantity])];
  const overallState = critical.reduce((weakest, field) => ranks[field.state] < ranks[weakest] ? field.state : weakest, 'Confirmado');
  const equipmentCompleteness = equipment.length
    ? equipment.reduce(/** @param {number} total @param {any} item */ (total, item) => total + (/** @type {const} */ (['modality', 'quantity', 'manufacturer', 'model', 'age'])).reduce((score, key) => score + (item[key].value === null ? 0 : weights[key]), 0), 0) / equipment.length
    : 0;
  const completeness = Math.round((fields.hospital.value === null ? 0 : weights.hospital) + equipmentCompleteness);
  const ageDays = Math.max(0, (now.getTime() - new Date(observation.capturedAt).getTime()) / 86_400_000);
  const freshness = Math.round(25 * Math.max(0, 1 - ageDays / 365));
  let confirmedWeight = fields.hospital.state === 'Confirmado' ? weights.hospital : 0;
  if (equipment.length) confirmedWeight += equipment.reduce(/** @param {number} total @param {any} item */ (total, item) => total + (/** @type {const} */ (['modality', 'quantity', 'manufacturer', 'model', 'age'])).reduce((score, key) => score + (item[key].state === 'Confirmado' ? weights[key] : 0), 0), 0) / equipment.length;
  const evidence = Math.round(35 * confirmedWeight / 40);
  const score = Math.min(100, completeness + freshness + evidence);
  const band = score < 50 ? 'Baja' : score < 80 ? 'Media' : 'Alta';
  return { fields, equipment, overallState, confidence: { score, band, components: {
    completeness: { score: completeness, max: 40 }, freshness: { score: freshness, max: 25 }, evidence: { score: evidence, max: 35 },
  } } };
}

/** @type {Record<string, string>} */
const prompts = {
  hospital: '¿En qué hospital hiciste la observación?', modality: '¿Cuál es la modalidad del equipo?',
  quantity: '¿Cuántos equipos observaste?', manufacturer: '¿Conoces el fabricante?',
  model: '¿Conoces el modelo?', age: '¿Cuál es la antigüedad aproximada en años?',
};
/** @param {any} draft */
export function nextFollowUp(draft) {
  const history = draft.followUpHistory ?? [];
  if (history.length >= 3) return null;
  const answered = new Set(history.map(/** @param {any} entry */ entry => entry.key));
  if (draft.reviewed.hospital === null && !answered.has('hospital')) return { key: 'hospital', field: 'hospital', equipmentIndex: null, kind: 'text', prompt: prompts.hospital };
  for (const field of ['modality', 'quantity', 'manufacturer', 'model', 'age']) {
    for (let index = 0; index < draft.reviewed.equipment.length; index += 1) {
      const key = `equipment.${index}.${field}`;
      if (draft.reviewed.equipment[index][field] === null && !answered.has(key)) return {
        key, field, equipmentIndex: index, kind: field === 'modality' ? 'modality' : ['quantity', 'age'].includes(field) ? 'number' : 'text',
        prompt: draft.reviewed.equipment.length > 1 ? `${prompts[field]} Equipo ${index + 1}.` : prompts[field],
      };
    }
  }
  return null;
}
