/** @param {string} id */
function element(id) {
  const result = document.getElementById(id);
  if (!result) throw new Error('Elemento ausente: ' + id);
  return result;
}
/** @type {Record<string, string>} */
const labels = { ready: 'Disponible', degraded: 'En preparación', unavailable: 'No disponible' };
/** @param {{model: string | null, quantization: string | null, lastInference: {engine: string, model: string, durationMs: number} | null} | undefined} diagnostics */
function diagnosticsText(diagnostics) {
  if (!diagnostics || !diagnostics.model) return '';
  const parts = [`Modelo: ${diagnostics.model}`];
  if (diagnostics.quantization) parts.push(`Cuantización: ${diagnostics.quantization}`);
  parts.push(diagnostics.lastInference ? `Última inferencia: ${diagnostics.lastInference.durationMs} ms` : 'Sin inferencias todavía.');
  return parts.join(' · ');
}
async function refresh() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('API no disponible');
    const status = await response.json();
    window.dispatchEvent(new CustomEvent('sitesignal:status', { detail: status }));
    for (const key of ['api', 'database', 'qvac', 'voice', 'plate']) {
      element(key + '-state').textContent = labels[status[key].state] ?? 'Desconocido';
      element(key + '-state').className = status[key].state;
      element(key + '-message').textContent = status[key].message;
    }
    for (const key of ['qvac', 'voice', 'plate']) element(key + '-diagnostics').textContent = diagnosticsText(status[key].diagnostics);
    element('device-info').textContent = status.device ? `Hardware local: ${status.device}` : '';
    element('summary').textContent = status.qvac.state === 'ready' ? 'El entorno local está disponible.' : 'La aplicación está abierta. Revisa el estado de la inteligencia local.';
    element('installation').textContent = `Instalación ${status.database.installationId} · Arranques: ${status.database.starts}`;
  } catch {
    window.dispatchEvent(new CustomEvent('sitesignal:status', { detail: { qvac: { state: 'unavailable', message: 'QVAC de texto no está disponible.' }, voice: { state: 'unavailable', message: 'QVAC de voz no está disponible.' }, plate: { state: 'unavailable', message: 'QVAC de imagen no está disponible.' } } }));
    element('summary').textContent = 'No hay conexión con la aplicación local. Ejecuta Start-SiteSignal.ps1 y vuelve a actualizar.';
    for (const key of ['api', 'database', 'qvac', 'voice', 'plate']) {
      element(key + '-state').textContent = key === 'api' ? 'No disponible' : 'Sin verificar';
      element(key + '-state').className = 'unavailable';
      element(key + '-message').textContent = '';
    }
    for (const key of ['qvac', 'voice', 'plate']) element(key + '-diagnostics').textContent = '';
    element('device-info').textContent = '';
    element('installation').textContent = '';
  }
}
element('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
