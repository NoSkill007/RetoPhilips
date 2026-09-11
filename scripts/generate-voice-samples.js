// One-time, offline generation of the fixture audio bundled for the voice-capture smoke test.
// Uses QVAC's own local TTS (Supertonic, multilingual) so the fixtures are produced the same way
// the rest of the dataset is: entirely local, fictional content, no cloud service involved.
import { loadModel, textToSpeech, unloadModel, TTS_MULTILINGUAL_SUPERTONIC3_Q8_0 } from '@qvac/sdk';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44100;
const samples = [
  { language: 'es', voice: 'F1', file: 'voice-sample-es.wav',
    text: 'Visité Hospital Aurora. Vi un tomógrafo Marca Ficticia, modelo Modelo Ficticio, y ocho años.' },
  { language: 'en', voice: 'F1', file: 'voice-sample-en.wav',
    text: 'I visited Hospital Aurora. I saw an ultrasound machine made by DemoMed, model EchoDemo, about five years old.' },
];

/** @param {Int16Array} samples @param {number} sampleRate */
function createWav(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0))), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

console.log('Preparación con conexión: descarga Supertonic TTS multilingüe en la caché local de QVAC.');
// Supertonic fixes language/voice at load time (only Parler/CosyVoice3 accept per-call overrides),
// so each sample's language needs its own load/unload cycle.
for (const sample of samples) {
  const modelId = await loadModel({
    modelSrc: TTS_MULTILINGUAL_SUPERTONIC3_Q8_0,
    modelConfig: { ttsEngine: 'supertonic', language: sample.language, voice: sample.voice, ttsSpeed: 1.0, ttsNumInferenceSteps: 10 },
    onProgress: p => { if (Math.floor(p.percentage) % 20 === 0) console.log(`${Math.floor(p.percentage)}%`); },
  });
  try {
    console.log(`Generando ${sample.file}…`);
    const result = textToSpeech({ modelId, text: sample.text, inputType: 'text', stream: false });
    const audioBuffer = await result.buffer;
    const wav = createWav(audioBuffer, SAMPLE_RATE);
    const target = fileURLToPath(new URL(`../test/fixtures/${sample.file}`, import.meta.url));
    await writeFile(target, wav);
    console.log(`Guardado en ${target} (${wav.length} bytes).`);
  } finally { await unloadModel({ modelId }); }
}
console.log('Muestras de voz sintéticas generadas.');
process.exit(0);
