import { loadModel, unloadModel, WHISPER_SMALL_Q8_0 } from '@qvac/sdk';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
console.log('Preparación con conexión: descarga Whisper small Q8_0 (multilingüe) en la caché local de QVAC.');
let last = -1;
const modelId = await loadModel({ modelSrc: WHISPER_SMALL_Q8_0, modelConfig: { language: 'en' }, onProgress(progress) {
  const percent = Math.floor(progress.percentage / 10) * 10;
  if (percent !== last) { last = percent; console.log(`${percent}%`); }
} });
await unloadModel({ modelId });
const directory = join(homedir(), '.qvac', 'models');
const file = (await readdir(directory)).find(name => name.endsWith('ggml-small-q8_0.bin'));
if (!file) throw new Error('La descarga terminó, pero no se encontró el archivo en la caché local.');
console.log('Modelo de voz preparado. Configura esta ruta en SITESIGNAL_VOICE_MODEL:');
console.log(join(directory, file));
process.exit(0);
