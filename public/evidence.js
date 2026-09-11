/** Uploads one photographed equipment plate for local OCR analysis. Never sends it anywhere but this
 * app's own local API; the server-side model runs entirely on this machine.
 * @param {File} file */
export async function uploadEvidence(file) {
  const response = await fetch('/api/evidence', { method: 'POST', headers: { 'Content-Type': file.type || 'image/png' }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'No se pudo analizar la imagen.');
  return result;
}
