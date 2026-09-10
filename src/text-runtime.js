import { fork } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { inferenceSchema } from './observation-schema.js';

const resultSchema = z.object({ fields: z.unknown(), metadata: inferenceSchema });
/** @param {string | undefined} modelPath */
export function createTextRuntime(modelPath) {
  let state = { state: 'degraded', message: 'Cargando el modelo textual local…' };
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let worker;
  /** @type {Promise<{state: string, message: string}> | undefined} */
  let startup;
  /** @type {{ resolve: (value: import('./observation-schema.js').Extraction) => void, reject: (error: Error) => void, timer: NodeJS.Timeout } | undefined} */
  let pending;
  let closed = false;
  /** @param {string} message */
  function fail(message) {
    state = { state: 'unavailable', message };
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = undefined; }
    worker?.kill();
  }
  async function initialize() {
    if (!modelPath || !isAbsolute(modelPath)) {
      fail('Configura SITESIGNAL_MODEL con la ruta absoluta de un modelo GGUF local y reinicia.');
      return state;
    }
    try {
      await access(modelPath, constants.R_OK);
      const file = await stat(modelPath);
      if (!file.isFile() || file.size === 0) throw new Error('Modelo vacío');
    } catch { fail('No se puede leer el modelo local. Revisa SITESIGNAL_MODEL y sus permisos.'); return state; }
    if (closed) return state;
    return new Promise(resolve => {
      const timer = setTimeout(() => { fail('QVAC superó 60 segundos al cargar. Libera memoria y reinicia.'); resolve(state); }, 60_000);
      worker = fork(new URL('./text-worker.js', import.meta.url), [modelPath], { execArgv: [], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      worker.on('message', message => {
        if (!message || typeof message !== 'object' || !('type' in message)) return;
        if (message.type === 'ready') {
          clearTimeout(timer); state = { state: 'ready', message: 'Modelo QVAC local cargado y disponible para extraer.' }; resolve(state);
        } else if (message.type === 'result' && 'result' in message && pending) {
          const job = pending; pending = undefined; clearTimeout(job.timer);
          const result = resultSchema.safeParse(message.result);
          if (result.success) job.resolve(result.data); else job.reject(new Error('Respuesta QVAC no válida'));
        } else if (message.type === 'error') {
          if (pending) { const job = pending; pending = undefined; clearTimeout(job.timer); job.reject(new Error('QVAC no pudo extraer el texto.')); }
          else { clearTimeout(timer); fail('QVAC no pudo cargar el modelo. Revisa el archivo GGUF y la memoria.'); resolve(state); }
        }
      });
      const stopped = () => {
        clearTimeout(timer);
        fail(closed ? 'QVAC detenido.' : 'QVAC se detuvo. Reinicia SiteSignal para cargar el modelo.');
        resolve(state);
      };
      worker.once('error', stopped);
      worker.once('exit', stopped);
    });
  }
  return {
    status: () => state,
    probe() { startup ??= initialize(); return startup; },
    /** @param {string} text @param {import('./observation-schema.js').ExtractionOptions} [options] */
    async extract(text, options = { attempt: 1 }) {
      await this.probe();
      if (state.state !== 'ready' || !worker?.connected) throw new Error(state.message);
      if (pending) throw new Error('Hay una extracción en curso.');
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => fail('La extracción superó 90 segundos. Reinicia y prueba un texto más corto.'), 90_000) };
        worker?.send({ text, ...options }, error => { if (error) fail('No se pudo comunicar con QVAC. Reinicia SiteSignal.'); });
      });
    },
    close() { closed = true; fail('QVAC detenido.'); },
  };
}
