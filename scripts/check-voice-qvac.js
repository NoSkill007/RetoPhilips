import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createVoiceRuntime } from '../src/voice-runtime.js';

const runtime = createVoiceRuntime(process.env.SITESIGNAL_VOICE_MODEL);
try {
  const status = await runtime.probe();
  console.log(status);
  if (status.state !== 'ready') throw new Error(status.message);
  for (const [file, language] of [['voice-sample-es.wav', 'es'], ['voice-sample-en.wav', 'en']]) {
    const audio = await readFile(fileURLToPath(new URL(`../test/fixtures/${file}`, import.meta.url)));
    const result = await runtime.transcribe(audio, language);
    console.log(JSON.stringify({ file, language, ...result }));
  }
} finally { runtime.close(); }
