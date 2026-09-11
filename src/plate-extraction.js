import { normalize } from './observation-schema.js';

/** Label word sequences recognized before each field's value. Longer sequences are tried in the order
 * listed so "numero de serie" is matched before the bare "serial" fallback consumes the wrong token.
 * `ref/model` covers the catalog-number label used on real medical-device nameplates (e.g. Philips
 * equipment), not just the "modelo"/"model" wording used by our synthetic fixtures. Deliberately
 * excludes bare "SN"/"S/N": on a real nameplate that prints "REF" and "SN" as two column headers with
 * their values on the next row (see `pairRefAndSerialRow`), a direct "SN" match here would grab
 * whatever token happens to sit next to it in reading order — which is REF's value, not SN's — before
 * the row-aware logic below gets a chance to pair them correctly.
 * @type {Record<'model' | 'serial' | 'year' | 'manufacturer', string[][]>} */
const LABEL_SEQUENCES = {
  model: [['modelo'], ['model'], ['ref/model']],
  serial: [['numero', 'de', 'serie'], ['numero', 'serie'], ['serial', 'number'], ['serial']],
  year: [['fecha', 'de', 'fabricacion'], ['fabricado', 'por'], ['fabricado'], ['manufactured'], ['instalado'], ['installed'], ['fecha'], ['date']],
  manufacturer: [['fabricante'], ['marca'], ['manufacturer'], ['brand'], ['made', 'by']],
};
/** Recognizes a bare "REF" label, used as a fallback source for `model` only when no explicit
 * model/ref-model label was found directly — see `pairRefAndSerialRow`. @type {string[][]} */
const REF_SEQUENCES = [['ref'], ['ref/model']];
/** Recognizes a bare "SN"/"S/N" label — only used immediately after a `REF` match in
 * `pairRefAndSerialRow`, never as a general standalone serial indicator (see note above). */
const SN_SEQUENCES = [['sn'], ['s/n']];
const YEAR_PATTERN = /^(19[5-9]\d|20\d{2})$/;
const PUNCTUATION_ONLY = /^[:;,.\-|/]+$/;
/** A real identifier or product name is short. When OCR line-grouping goes wrong on a busy real photo,
 * "the next token(s) after a label" can turn out to be an unrelated block of certification text picked
 * up purely because it happened to follow the label in reading order — confidently returning that as a
 * value would be a worse failure than returning null, since it would look verified when it never was. */
const MAX_VALUE_LENGTH = 32;
const MAX_VALUE_WORDS = 4;
/** @param {string} value */
function isPlausibleValue(value) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH || words.length > MAX_VALUE_WORDS) return false;
  // Real model/serial text on a nameplate is printed in capitals (or is purely numeric); a run of
  // mostly-lowercase letters is a strong signal that OCR line-grouping swept in an unrelated fragment
  // of body/regulatory text rather than an actual identifier — reject it rather than report it as read.
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return true;
  const uppercaseRatio = (letters.match(/[A-Z]/g) ?? []).length / letters.length;
  return uppercaseRatio >= 0.5;
}

/** @param {string} text */
function tokenNormalize(text) { return normalize(text).replace(/[:.,;]+$/g, ''); }

/** Splits OCR blocks into word-level tokens, remembering each word's parent block index. Our synthetic
 * test fixtures emit one word per block, but real OCR on a photographed nameplate often merges a whole
 * label phrase — or an entire "LABEL: value" line — into a single detected block; splitting lets the
 * label search work at word grain everywhere while `blockIndex` still lets us tell whether a label and
 * its candidate value came from the same original OCR detection (see `takeValue`).
 * @param {{text: string}[]} blocks */
function toWords(blocks) {
  /** @type {string[]} */
  const tokens = [];
  /** @type {number[]} */
  const blockIndices = [];
  blocks.forEach((block, blockIndex) => {
    for (const word of block.text.split(/\s+/).filter(Boolean)) { tokens.push(word); blockIndices.push(blockIndex); }
  });
  return { tokens, blockIndices };
}

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
 * Every returned value is either a literal OCR word or a join of consecutive literal OCR words in
 * their detected order — never a guess independent of what the image actually shows. A field a label
 * search can't ground stays `null`, matching "unsupported or unreadable fields remain Unknown".
 * @param {{text: string, confidence?: number | null}[]} blocks */
export function extractPlateFields(blocks) {
  const { tokens, blockIndices } = toWords(blocks);
  const normalizedTokens = tokens.map(tokenNormalize);
  /** @type {Set<number>} */
  const consumed = new Set();

  /** Tested against the raw token, not the normalized one: a bare separator like ";" normalizes to an
   * empty string (its only characters are stripped as trailing punctuation), which would otherwise
   * fail this same check and never get skipped. @param {number} index */
  function skipPunctuation(index) {
    let cursor = index;
    while (cursor < tokens.length && !consumed.has(cursor) && PUNCTUATION_ONLY.test(tokens[cursor])) cursor += 1;
    return cursor;
  }

  /** @param {'model' | 'serial' | 'year' | 'manufacturer'} field */
  function takeValue(field) {
    const match = findLabel(normalizedTokens, LABEL_SEQUENCES[field], consumed);
    if (!match) return null;
    const labelEnd = match.index + match.length;
    const valueIndex = skipPunctuation(labelEnd);
    if (valueIndex >= tokens.length || consumed.has(valueIndex)) return null;
    for (let i = match.index; i < valueIndex; i += 1) consumed.add(i);
    // Collect every remaining word from the value's own original OCR block, not just its first word —
    // a single detected region can hold a whole multi-word value ("SYN - 778812", "BRILLIANCE iCT"),
    // whether or not that region also happens to include the label itself. Never spill into a
    // different block, which would start pulling in unrelated following text.
    const valueBlock = blockIndices[valueIndex];
    const words = [];
    let cursor = valueIndex;
    while (cursor < tokens.length && blockIndices[cursor] === valueBlock && !consumed.has(cursor)) { words.push(tokens[cursor]); consumed.add(cursor); cursor += 1; }
    const value = words.join(' ');
    return isPlausibleValue(value) ? { value, index: valueIndex } : null;
  }

  /** Nameplates commonly print "REF" and "SN" side by side as two column headers, with their values
   * printed as the next two tokens rather than immediately after their own label — e.g.
   * "REF: SN: 453567023331 896". Used only as a fallback source for whichever of model/serial the
   * direct label search above missed.
   * @returns {{model: {value: string, index: number} | null, serial: {value: string, index: number} | null} | null} */
  function pairRefAndSerialRow() {
    const refMatch = findLabel(normalizedTokens, REF_SEQUENCES, consumed);
    if (!refMatch) return null;
    const afterRef = skipPunctuation(refMatch.index + refMatch.length);
    if (afterRef >= tokens.length || consumed.has(afterRef)) return null;
    const serialMatch = findLabel(normalizedTokens.slice(afterRef, afterRef + 2), SN_SEQUENCES, new Set());
    if (!serialMatch || serialMatch.index !== 0) return null;
    const modelValueIndex = skipPunctuation(afterRef + serialMatch.length);
    const serialValueIndex = skipPunctuation(modelValueIndex + 1);
    if (serialValueIndex >= tokens.length || modelValueIndex >= tokens.length
      || consumed.has(modelValueIndex) || consumed.has(serialValueIndex) || modelValueIndex === serialValueIndex) return null;
    if (!isPlausibleValue(tokens[modelValueIndex]) || !isPlausibleValue(tokens[serialValueIndex])) return null;
    for (let i = refMatch.index; i < modelValueIndex; i += 1) consumed.add(i);
    consumed.add(modelValueIndex); consumed.add(serialValueIndex);
    return { model: { value: tokens[modelValueIndex], index: modelValueIndex }, serial: { value: tokens[serialValueIndex], index: serialValueIndex } };
  }

  /** A manufacture/installation year is often followed by an intervening word (a month name, in
   * "MANUFACTURED: October 2007") before the 4-digit year itself — look a few tokens ahead instead of
   * requiring the year to be the very next token. */
  function takeYearValue() {
    const match = findLabel(normalizedTokens, LABEL_SEQUENCES.year, consumed);
    if (!match) return null;
    const start = skipPunctuation(match.index + match.length);
    for (let ahead = 0; ahead < 3 && start + ahead < tokens.length; ahead += 1) {
      const candidateIndex = start + ahead;
      if (consumed.has(candidateIndex)) break;
      if (YEAR_PATTERN.test(normalizedTokens[candidateIndex])) {
        for (let i = match.index; i <= candidateIndex; i += 1) consumed.add(i);
        return { value: tokens[candidateIndex], index: candidateIndex };
      }
    }
    return null;
  }

  const modelDirect = takeValue('model');
  const serialDirect = takeValue('serial');
  const refRow = (!modelDirect || !serialDirect) ? pairRefAndSerialRow() : null;
  const model = modelDirect ?? refRow?.model ?? null;
  const serial = serialDirect ?? refRow?.serial ?? null;
  const rawYear = takeYearValue();
  const year = rawYear && YEAR_PATTERN.test(tokenNormalize(rawYear.value)) ? rawYear : null;
  let manufacturer = takeValue('manufacturer');

  // An unlabeled brand name commonly sits before the first recognized label (top of the plate) — but
  // only trust this when that prefix is short. A clean single-panel plate puts just the brand there
  // (1-6 words); a busy real photo with multiple printed panels can put a whole paragraph of unrelated
  // certification text before the first label, and returning that blob as "manufacturer" would be
  // exactly the kind of invention this pipeline exists to avoid — null is the honest answer instead.
  const UNLABELED_PREFIX_LIMIT = 6;
  if (!manufacturer) {
    const labelFields = /** @type {const} */ (['model', 'serial', 'year']);
    const firstLabelIndex = Math.min(
      ...labelFields.map(field => findLabel(normalizedTokens, LABEL_SEQUENCES[field], new Set())?.index ?? Infinity),
      findLabel(normalizedTokens, REF_SEQUENCES, new Set())?.index ?? Infinity,
    );
    if (firstLabelIndex > 0 && firstLabelIndex <= UNLABELED_PREFIX_LIMIT) manufacturer = { value: tokens.slice(0, firstLabelIndex).join(' '), index: 0 };
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
