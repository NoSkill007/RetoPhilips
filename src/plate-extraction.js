import { normalize } from './observation-schema.js';

/** Label word sequences recognized before each field's value. Longer sequences are tried in the order
 * listed so "numero de serie" is matched before the bare "serial" fallback consumes the wrong token.
 * @type {Record<'model' | 'serial' | 'year' | 'manufacturer', string[][]>} */
const LABEL_SEQUENCES = {
  model: [['modelo'], ['model']],
  serial: [['numero', 'de', 'serie'], ['numero', 'serie'], ['serial', 'number'], ['serial']],
  year: [['fecha', 'de', 'fabricacion'], ['fabricado', 'por'], ['fabricado'], ['manufactured'], ['instalado'], ['installed'], ['fecha'], ['date']],
  manufacturer: [['fabricante'], ['marca'], ['manufacturer'], ['brand'], ['made', 'by']],
};
const YEAR_PATTERN = /^(19[5-9]\d|20\d{2})$/;

/** @param {string} text */
function tokenNormalize(text) { return normalize(text).replace(/[:.,;]+$/g, ''); }

/** @param {string[]} normalizedTokens @param {string[][]} sequences @param {Set<number>} consumed */
function findLabel(normalizedTokens, sequences, consumed) {
  for (let index = 0; index < normalizedTokens.length; index += 1) {
    if (consumed.has(index)) continue;
    for (const sequence of sequences) {
      if (sequence.every((word, offset) => normalizedTokens[index + offset] === word)) return { index, length: sequence.length };
    }
  }
  return null;
}

/** Extracts manufacturer, model, serial and manufacture/installation year from OCR'd plate text.
 * Every returned value is either a literal OCR block or a join of consecutive literal OCR blocks in
 * their detected order — never a guess independent of what the image actually shows. A field a label
 * search can't ground stays `null`, matching "unsupported or unreadable fields remain Unknown".
 * @param {{text: string, confidence?: number | null}[]} blocks */
export function extractPlateFields(blocks) {
  const tokens = blocks.map(block => block.text);
  const normalizedTokens = tokens.map(tokenNormalize);
  /** @type {Set<number>} */
  const consumed = new Set();
  /** @param {'model' | 'serial' | 'year' | 'manufacturer'} field */
  function takeValue(field) {
    const match = findLabel(normalizedTokens, LABEL_SEQUENCES[field], consumed);
    if (!match) return null;
    const valueIndex = match.index + match.length;
    if (valueIndex >= tokens.length || consumed.has(valueIndex)) return null;
    for (let i = match.index; i <= valueIndex; i += 1) consumed.add(i);
    return { value: tokens[valueIndex], index: valueIndex };
  }

  const model = takeValue('model');
  const serial = takeValue('serial');
  const rawYear = takeValue('year');
  const year = rawYear && YEAR_PATTERN.test(tokenNormalize(rawYear.value)) ? rawYear : null;
  let manufacturer = takeValue('manufacturer');

  // An unlabeled brand name commonly sits before the first recognized label (top of the plate).
  if (!manufacturer) {
    const firstLabelIndex = Math.min(...(/** @type {const} */ (['model', 'serial', 'year'])
      .map(field => findLabel(normalizedTokens, LABEL_SEQUENCES[field], new Set())?.index ?? Infinity)));
    if (firstLabelIndex > 0 && firstLabelIndex !== Infinity) manufacturer = { value: tokens.slice(0, firstLabelIndex).join(' '), index: 0 };
  }
  // An unlabeled bare year is only trusted when it is the single 4-digit candidate on the whole plate —
  // with more than one, guessing which is the manufacture year would be exactly the kind of invention
  // this pipeline is built to avoid.
  let resolvedYear = year;
  if (!resolvedYear) {
    const candidates = normalizedTokens.map((token, index) => ({ token, index })).filter(({ token }) => YEAR_PATTERN.test(token));
    if (candidates.length === 1) resolvedYear = { value: tokens[candidates[0].index], index: candidates[0].index };
  }

  return {
    manufacturer: manufacturer?.value ?? null,
    model: model?.value ?? null,
    serial: serial?.value ?? null,
    year: resolvedYear ? Number(tokenNormalize(resolvedYear.value)) : null,
    ocrText: tokens.join(' '),
  };
}
