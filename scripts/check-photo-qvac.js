import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPlateRuntime } from '../src/plate-runtime.js';
import { extractPlateFields } from '../src/plate-extraction.js';

const runtime = createPlateRuntime(process.env.SITESIGNAL_PLATE_MODEL);
try {
  const status = await runtime.probe();
  console.log(status);
  if (status.state !== 'ready') throw new Error(status.message);
  for (const file of ['plate-sample-es.png', 'plate-sample-en.png']) {
    const image = await readFile(fileURLToPath(new URL(`../test/fixtures/${file}`, import.meta.url)));
    const result = await runtime.recognize(image);
    console.log(JSON.stringify({ file, fields: extractPlateFields(result.blocks), metadata: result.metadata }));
  }
} finally { runtime.close(); }
