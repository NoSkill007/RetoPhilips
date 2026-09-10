/** @param {string} id */
function element(id) {
  const result = document.getElementById(id);
  if (!result) throw new Error('Elemento ausente: ' + id);
  return result;
}
/** @type {Record<string, string>} */
const labels = { ready: 'Disponible', degraded: 'En preparación', unavailable: 'No disponible' };
async function refresh() {
  try {
    const response = await fetch('/api/status', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('API no disponible');
    const status = await response.json();
    for (const key of ['api', 'database', 'qvac']) {
      element(key + '-state').textContent = labels[status[key].state] ?? 'Desconocido';
      element(key + '-state').className = status[key].state;
      element(key + '-message').textContent = status[key].message;
    }
    element('summary').textContent = status.qvac.state === 'ready' ? 'El entorno local está disponible.' : 'La aplicación está abierta. Revisa el estado de la inteligencia local.';
    element('installation').textContent = `Instalación ${status.database.installationId} · Arranques: ${status.database.starts}`;
  } catch {
    element('summary').textContent = 'No hay conexión con la aplicación local. Ejecuta Start-SiteSignal.ps1 y vuelve a actualizar.';
    for (const key of ['api', 'database', 'qvac']) {
      element(key + '-state').textContent = key === 'api' ? 'No disponible' : 'Sin verificar';
      element(key + '-state').className = 'unavailable';
      element(key + '-message').textContent = '';
    }
    element('installation').textContent = '';
  }
}
element('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);

