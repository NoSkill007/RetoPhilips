import { basename, join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

try {
  const { loadModel, unloadModel, ocr, OCR_CRAFT } = await import('@qvac/sdk');
  // The recognizer (this local .gguf) needs a text-region detector; OCR_CRAFT resolves to the same
  // local QVAC model cache the recognizer itself was prepared into, so no separate env var is needed.
  const modelId = await loadModel({ modelSrc: process.argv[2], modelType: 'ggml-ocr', modelConfig: { langList: ['en'], detectorModelSrc: OCR_CRAFT } });
  process.send?.({ type: 'ready' });
  process.on('message', async message => {
    if (!message || typeof message !== 'object' || !('image' in message) || typeof message.image !== 'string') return;
    const started = performance.now();
    const tempPath = join(tmpdir(), `sitesignal-plate-${randomUUID()}.png`);
    try {
      await writeFile(tempPath, Buffer.from(message.image, 'base64'));
      const { blocks } = ocr({ modelId, image: tempPath, options: { paragraph: false } });
      const result = await blocks;
      const metadata = { engine: 'QVAC', model: basename(process.argv[2]), durationMs: Math.round(performance.now() - started), device: 'local' };
      process.send?.({ type: 'result', result: { blocks: result.map(block => ({ text: block.text, confidence: block.confidence ?? null })), metadata } });
    } catch (error) {
      console.error('Error de OCR local:', error instanceof Error ? error.message : 'Error QVAC');
      process.send?.({ type: 'error' });
    } finally {
      await unlink(tempPath).catch(() => {});
    }
  });
} catch (error) {
  console.error('Error de carga QVAC (OCR):', error instanceof Error ? error.message : 'Error QVAC');
  process.send?.({ type: 'error' });
}
