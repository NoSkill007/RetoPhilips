/** Best-effort description of the local inference hardware for the diagnostics panel. Queries QVAC's own
 * `getSystemResources`, which needs no model loaded; returns `null` on any failure or timeout so a
 * diagnostics query never blocks or fails startup. @returns {Promise<string | null>} */
export async function describeLocalDevice() {
  try {
    const { getSystemResources } = await import('@qvac/sdk');
    const resources = await Promise.race([
      getSystemResources(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado')), 10000)),
    ]);
    const cpu = resources?.capabilities?.cpu;
    const cpuName = cpu?.status === 'supported' && cpu.value.name.status === 'supported' ? cpu.value.name.value : null;
    if (!cpuName) return null;
    const cores = cpu.status === 'supported' && cpu.value.logicalCores.status === 'supported' ? cpu.value.logicalCores.value : null;
    const gpus = resources?.capabilities?.gpus;
    const gpuNames = gpus?.status === 'supported'
      ? gpus.value.map(/** @param {any} gpu */ gpu => gpu.name?.status === 'supported' ? gpu.name.value : null).filter(Boolean)
      : [];
    const parts = [`${cpuName} (CPU${cores ? `, ${cores} núcleos lógicos` : ''})`, .../** @type {string[]} */ (gpuNames).map(name => `GPU: ${name}`)];
    return parts.join(' · ');
  } catch { return null; }
}
