import { fileURLToPath } from 'node:url';
import { startApplication } from './application.js';
import { createTextRuntime } from './text-runtime.js';
import { createVoiceRuntime } from './voice-runtime.js';
import { createPlateRuntime } from './plate-runtime.js';
import { extractPlateFields } from './plate-extraction.js';

const port = Number(process.env.SITESIGNAL_PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('SITESIGNAL_PORT debe ser un entero entre 1 y 65535.');
  process.exit(1);
}
const runtime = createTextRuntime(process.env.SITESIGNAL_MODEL);
const voiceRuntime = createVoiceRuntime(process.env.SITESIGNAL_VOICE_MODEL);
const plateRuntime = createPlateRuntime(process.env.SITESIGNAL_PLATE_MODEL);
try {
  const app = await startApplication({
    dataDirectory: process.env.SITESIGNAL_DATA ?? fileURLToPath(new URL('../data', import.meta.url)),
    port, probeQvac: () => runtime.probe(), qvacStatus: runtime.status, extractText: (text, options) => runtime.extract(text, options),
    interpretQuery: question => runtime.interpretQuery(question),
    probeVoice: () => voiceRuntime.probe(), voiceStatus: voiceRuntime.status,
    transcribeAudio: (audio, language) => voiceRuntime.transcribe(audio, language),
    probePlate: () => plateRuntime.probe(), plateStatus: plateRuntime.status,
    analyzeImage: async image => {
      const { blocks, metadata } = await plateRuntime.recognize(image);
      const fields = extractPlateFields(blocks);
      return { fields: { manufacturer: fields.manufacturer, model: fields.model, serial: fields.serial, year: fields.year }, ocrText: fields.ocrText, metadata };
    },
  });
  console.log(`SiteSignal disponible en ${app.url}. Ctrl+C para detener.`);
  process.send?.({ url: app.url });
  const stop = async () => { runtime.close(); voiceRuntime.close(); plateRuntime.close(); await app.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  runtime.close();
  voiceRuntime.close();
  plateRuntime.close();
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  console.error(code === 'EADDRINUSE'
    ? 'El puerto está ocupado. Cierra la otra instancia o cambia SITESIGNAL_PORT.'
    : 'No se pudo iniciar SiteSignal. Comprueba los permisos de almacenamiento, SQLite y los archivos de instalación.');
  process.exitCode = 1;
}
