import { basename } from 'node:path';

/** Best-effort quantization label parsed from a local model's file name (e.g. "Q4_K_M", "Q8_0"); `null`
 * when the file name carries no such marker (e.g. an OCR recognizer/detector pair).
 * @param {string} modelPath */
export function parseQuantization(modelPath) {
  const match = /(?:^|[-_])((?:i?q)\d[a-z0-9_]*|f16|bf16|f32)(?:[-_.]|$)/i.exec(basename(modelPath));
  return match ? match[1].toUpperCase() : null;
}

/** Diagnostics shared by every local runtime: the model file, its parsed quantization, and metadata from
 * the most recent successful inference (`null` until the first call completes).
 * @param {string | undefined} modelPath @param {{engine: string, model: string, durationMs: number} | null} lastInference */
export function diagnosticsFor(modelPath, lastInference) {
  return { model: modelPath ? basename(modelPath) : null, quantization: modelPath ? parseQuantization(modelPath) : null, lastInference };
}
