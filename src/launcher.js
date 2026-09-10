import { fork, spawn } from 'node:child_process';
const child = fork(new URL('./start.js', import.meta.url), [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
child.once('message', message => {
  if (message && typeof message === 'object' && 'url' in message && typeof message.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(message.url)) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', message.url], { windowsHide: true });
    browser.once('error', () => console.error('Abre manualmente la dirección local indicada arriba.'));
  }
});
child.once('error', () => { console.error('No se pudo iniciar Node. Revisa la instalación.'); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
