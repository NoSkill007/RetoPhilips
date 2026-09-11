import { basename, join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

try {
  const { loadModel, unloadModel, transcribe } = await import('@qvac/sdk');
  /** @type {string | undefined} */
  let modelId;
  /** @type {string | undefined} */
  let loadedLanguage;
  /** @param {string} language @returns {Promise<string>} */
  async function ensureLoaded(language) {
    if (modelId && loadedLanguage === language) return modelId;
    if (modelId) { await unloadModel({ modelId }); modelId = undefined; }
    modelId = await loadModel({ modelSrc: process.argv[2], modelType: 'whispercpp-transcription', modelConfig: {
      language, strategy: 'greedy', temperature: 0, suppress_blank: true, suppress_nst: true,
      entropy_thold: 2.4, logprob_thold: -1.0, n_threads: 4,
    } });
    loadedLanguage = language;
    return modelId;
  }
  process.send?.({ type: 'ready' });
  process.on('message', async message => {
    if (!message || typeof message !== 'object' || !('audio' in message) || typeof message.audio !== 'string' || !('language' in message)) return;
    const started = performance.now();
    const tempPath = join(tmpdir(), `sitesignal-voice-${randomUUID()}.wav`);
    try {
      await writeFile(tempPath, Buffer.from(message.audio, 'base64'));
      const loadedModelId = await ensureLoaded(String(message.language));
      const text = await transcribe({ modelId: loadedModelId, audioChunk: tempPath, metadata: false });
      const metadata = { engine: 'QVAC', model: basename(process.argv[2]), durationMs: Math.round(performance.now() - started), device: 'local' };
      process.send?.({ type: 'result', result: { transcript: text.trim(), metadata } });
    } catch (error) {
      console.error('Error de transcripción local:', error instanceof Error ? error.message : 'Error QVAC');
      process.send?.({ type: 'error' });
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });
} catch (error) {
  console.error('Error de carga QVAC (voz):', error instanceof Error ? error.message : 'Error QVAC');
  process.send?.({ type: 'error' });
}
