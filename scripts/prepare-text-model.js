import { loadModel, unloadModel, QWEN3_4B_INST_Q4_K_M } from '@qvac/sdk';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
console.log('Preparación con conexión: descarga Qwen3 4B Q4_K_M en la caché local de QVAC.');
let last = -1;
const modelId = await loadModel({ modelSrc: QWEN3_4B_INST_Q4_K_M, modelConfig: { ctx_size: 4096 }, onProgress(progress) {
  const percent = Math.floor(progress.percentage / 10) * 10;
  if (percent !== last) { last = percent; console.log(`${percent}%`); }
} });
await unloadModel({ modelId });
const directory = join(homedir(), '.qvac', 'models');
const file = (await readdir(directory)).find(name => name.endsWith('_Qwen3-4B-Q4_K_M.gguf'));
if (!file) throw new Error('La descarga terminó, pero no se encontró el archivo en la caché local.');
console.log('Modelo preparado. Configura esta ruta en SITESIGNAL_MODEL:');
console.log(join(directory, file));
process.exit(0);
