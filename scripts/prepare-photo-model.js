import { loadModel, unloadModel, ocr, OCR_LATIN, OCR_CRAFT } from '@qvac/sdk';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
console.log('Preparación con conexión: descarga el reconocedor OCR latino y su detector CRAFT en la caché local de QVAC.');
let last = -1;
/** @param {import('@qvac/sdk').ModelProgressUpdate} progress */
function onProgress(progress) {
  const percent = Math.floor(progress.percentage / 10) * 10;
  if (percent !== last) { last = percent; console.log(`${percent}%`); }
}
const modelId = await loadModel({ modelSrc: OCR_LATIN, modelConfig: { langList: ['en'], detectorModelSrc: OCR_CRAFT }, onProgress });
// Exercise the pipeline once against the bundled fixture so both files are confirmed cached and usable.
const { blocks } = ocr({ modelId, image: fileURLToPath(new URL('../test/fixtures/plate-sample-en.png', import.meta.url)), options: { paragraph: false } });
await blocks;
await unloadModel({ modelId });
const directory = join(homedir(), '.qvac', 'models');
const file = (await readdir(directory)).find(name => name.endsWith('_latin_g2.gguf'));
if (!file) throw new Error('La descarga terminó, pero no se encontró el archivo en la caché local.');
console.log('Modelo de evidencia fotográfica preparado. Configura esta ruta en SITESIGNAL_PLATE_MODEL:');
console.log(join(directory, file));
process.exit(0);
