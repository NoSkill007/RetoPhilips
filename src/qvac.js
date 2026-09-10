import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fork } from 'node:child_process';

/** Checks actual model loading in an isolated process, without remote model sources.
 * @param {string | undefined} modelPath
 */
export async function probeQvac(modelPath) {
  if (!modelPath || !isAbsolute(modelPath)) return {
    state: 'unavailable', message: 'Configura SITESIGNAL_MODEL con la ruta absoluta de un modelo GGUF local y reinicia.',
  };
  try {
    await access(modelPath, constants.R_OK);
    const file = await stat(modelPath);
    if (!file.isFile() || file.size === 0) throw new Error('Modelo vacío');
  } catch { return { state: 'unavailable', message: 'No se puede leer el modelo local. Comprueba SITESIGNAL_MODEL y sus permisos.' }; }
  return new Promise(resolve => {
    const child = fork(new URL('./qvac-worker.js', import.meta.url), [modelPath], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let settled = false;
    /** @param {{state: string, message: string}} result */
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    }
    const timer = setTimeout(() => finish({ state: 'unavailable', message: 'QVAC superó 60 segundos. Libera memoria o configura un modelo más pequeño y reinicia.' }), 60_000);
    child.on('message', message => {
      if (message && typeof message === 'object' && 'state' in message && 'message' in message && typeof message.state === 'string' && typeof message.message === 'string') {
        finish({ state: message.state, message: message.message });
      }
    });
    child.on('error', () => finish({ state: 'unavailable', message: 'No se pudo iniciar QVAC. Revisa Node y ejecuta npm ci durante la preparación.' }));
    child.on('exit', () => finish({ state: 'unavailable', message: 'QVAC terminó sin cargar el modelo. Revisa el SDK, el modelo y la memoria disponible.' }));
  });
}
