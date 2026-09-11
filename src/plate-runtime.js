import { fork } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { diagnosticsFor } from './model-diagnostics.js';

const resultSchema = z.object({
  blocks: z.array(z.object({ text: z.string(), confidence: z.number().nullable() })),
  metadata: z.object({ engine: z.string(), model: z.string(), durationMs: z.number().nonnegative(), device: z.string() }),
});

/** Local OCR via a QVAC worker, mirroring `text-runtime.js`'s process/IPC lifecycle. The model loads once
 * at worker startup (unlike voice, OCR has no per-request language reload) and stays resident.
 * @param {string | undefined} modelPath */
export function createPlateRuntime(modelPath) {
  let state = { state: 'degraded', message: 'Cargando el modelo de evidencia fotográfica local…' };
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let worker;
  /** @type {Promise<{state: string, message: string}> | undefined} */
  let startup;
  /** @type {{ resolve: (value: {blocks: {text: string, confidence: number | null}[], metadata: any}) => void, reject: (error: Error) => void, timer: NodeJS.Timeout } | undefined} */
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
      fail('Configura SITESIGNAL_PLATE_MODEL con la ruta absoluta de un modelo OCR local y reinicia.');
      return state;
    }
    try {
      await access(modelPath, constants.R_OK);
      const file = await stat(modelPath);
      if (!file.isFile() || file.size === 0) throw new Error('Modelo vacío');
    } catch { fail('No se puede leer el modelo de evidencia fotográfica local. Revisa SITESIGNAL_PLATE_MODEL y sus permisos.'); return state; }
    if (closed) return state;
    return new Promise(resolve => {
      const timer = setTimeout(() => { fail('QVAC de evidencia fotográfica superó 60 segundos al cargar. Libera memoria y reinicia.'); resolve(state); }, 60_000);
      worker = fork(new URL('./plate-worker.js', import.meta.url), [modelPath], { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      worker.on('message', message => {
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'ready') {
          clearTimeout(timer); state = { state: 'ready', message: 'Modelo de evidencia fotográfica QVAC local cargado y disponible.' }; resolve(state);
        } else if (message.type === 'result' && 'result' in message && pending) {
          const job = pending; pending = undefined; clearTimeout(job.timer);
          const result = resultSchema.safeParse(message.result);
          if (result.success) { lastInference = result.data.metadata; job.resolve(result.data); } else job.reject(new Error('Respuesta de evidencia fotográfica QVAC no válida'));
        } else if (message.type === 'error') {
          if (pending) { const job = pending; pending = undefined; clearTimeout(job.timer); job.reject(new Error('QVAC no pudo leer la imagen.')); }
          else { clearTimeout(timer); fail('QVAC no pudo cargar el modelo de evidencia fotográfica. Revisa el archivo y la memoria.'); resolve(state); }
        }
      });
      const stopped = () => {
        clearTimeout(timer);
        fail(closed ? 'QVAC de evidencia fotográfica detenido.' : 'QVAC de evidencia fotográfica se detuvo. Reinicia SiteSignal para cargar el modelo.');
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
      worker?.send(message, error => { if (error) fail('No se pudo comunicar con QVAC de evidencia fotográfica. Reinicia SiteSignal.'); });
    });
  }
  return {
    status: () => state,
    diagnostics: () => diagnosticsFor(modelPath, lastInference),
    probe() { startup ??= initialize(); return startup; },
    /** @param {Buffer} imageBuffer */
    async recognize(imageBuffer) {
      return infer({ image: imageBuffer.toString('base64') }, 'Hay un análisis de imagen en curso.', 'El análisis de imagen superó 90 segundos. Reinicia e inténtalo con una foto más liviana.');
    },
    close() { closed = true; fail('QVAC de evidencia fotográfica detenido.'); },
  };
}
