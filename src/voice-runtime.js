import { fork } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { diagnosticsFor } from './model-diagnostics.js';

const resultSchema = z.object({ transcript: z.string(), metadata: z.object({
  engine: z.string(), model: z.string(), durationMs: z.number().nonnegative(), device: z.string(),
}) });

/** Local speech-to-text via a QVAC Whisper worker, mirroring `text-runtime.js`'s process/IPC lifecycle.
 * @param {string | undefined} modelPath */
export function createVoiceRuntime(modelPath) {
  let state = { state: 'degraded', message: 'Cargando el modelo de voz local…' };
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let worker;
  /** @type {Promise<{state: string, message: string}> | undefined} */
  let startup;
  /** @type {{ resolve: (value: {transcript: string, metadata: any}) => void, reject: (error: Error) => void, timer: NodeJS.Timeout } | undefined} */
  let pending;
  /** @type {{engine: string, model: string, durationMs: number, device: string} | null} */
  let lastInference = null;
  let closed = false;
  /** @param {string} message */
  function fail(message) {
    state = { state: 'unavailable', message };
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = undefined; }
    worker?.kill();
  }
  async function initialize() {
    if (!modelPath || !isAbsolute(modelPath)) {
      fail('Configura SITESIGNAL_VOICE_MODEL con la ruta absoluta de un modelo Whisper local y reinicia.');
      return state;
    }
    try {
      await access(modelPath, constants.R_OK);
      const file = await stat(modelPath);
      if (!file.isFile() || file.size === 0) throw new Error('Modelo vacío');
    } catch { fail('No se puede leer el modelo de voz local. Revisa SITESIGNAL_VOICE_MODEL y sus permisos.'); return state; }
    if (closed) return state;
    return new Promise(resolve => {
      const timer = setTimeout(() => { fail('QVAC de voz superó 60 segundos al cargar. Libera memoria y reinicia.'); resolve(state); }, 60_000);
      worker = fork(new URL('./voice-worker.js', import.meta.url), [modelPath], { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      worker.on('message', message => {
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'ready') {
          clearTimeout(timer); state = { state: 'ready', message: 'Modelo de voz QVAC local cargado y disponible para transcribir.' }; resolve(state);
        } else if (message.type === 'result' && 'result' in message && pending) {
          const job = pending; pending = undefined; clearTimeout(job.timer);
          const result = resultSchema.safeParse(message.result);
          if (result.success) { lastInference = result.data.metadata; job.resolve(result.data); } else job.reject(new Error('Respuesta de voz QVAC no válida'));
        } else if (message.type === 'error') {
          if (pending) { const job = pending; pending = undefined; clearTimeout(job.timer); job.reject(new Error('QVAC no pudo transcribir el audio.')); }
          else { clearTimeout(timer); fail('QVAC no pudo cargar el modelo de voz. Revisa el archivo y la memoria.'); resolve(state); }
        }
      });
      const stopped = () => {
        clearTimeout(timer);
        fail(closed ? 'QVAC de voz detenido.' : 'QVAC de voz se detuvo. Reinicia SiteSignal para cargar el modelo.');
        resolve(state);
      };
      worker.once('error', stopped);
      worker.once('exit', stopped);
    });
  }
  /** @param {object} message @param {string} busyMessage @param {string} timeoutMessage */
  async function infer(message, busyMessage, timeoutMessage) {
    startup ??= initialize();
    await startup;
    if (state.state !== 'ready' || !worker?.connected) throw new Error(state.message);
    if (pending) throw new Error(busyMessage);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, timer: setTimeout(() => fail(timeoutMessage), 90_000) };
      worker?.send(message, error => { if (error) fail('No se pudo comunicar con QVAC de voz. Reinicia SiteSignal.'); });
    });
  }
  return {
    status: () => state,
    diagnostics: () => diagnosticsFor(modelPath, lastInference),
    probe() { startup ??= initialize(); return startup; },
    /** @param {Buffer} audioBuffer @param {string} language */
    async transcribe(audioBuffer, language) {
      return infer({ audio: audioBuffer.toString('base64'), language }, 'Hay una transcripción en curso.', 'La transcripción superó 90 segundos. Reinicia e inténtalo con un audio más corto.');
    },
    close() { closed = true; fail('QVAC de voz detenido.'); },
  };
}
