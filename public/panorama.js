/** @param {string} id */
function el(id) { const value = document.getElementById(id); if (!value) throw new Error(id); return value; }
/** @param {string} tag @param {string} text */
function node(tag, text) { const value = document.createElement(tag); value.textContent = text; return value; }
/** @param {string} path @param {unknown} [body] */
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'No se pudo cargar el panorama.'); return result;
}
const form = /** @type {HTMLFormElement} */ (el('panorama-filters'));
const queryForm = /** @type {HTMLFormElement} */ (el('natural-query-form'));
/** @type {any} */
let lastQuery = null;
/** @param {HTMLSelectElement} select @param {Array<string | {id:string,name:string}>} values */
function options(select, values) {
  const current = select.value; const first = select.options[0]; select.replaceChildren(first);
  for (const value of values) { const option = document.createElement('option'); option.value = typeof value === 'string' ? value : value.id; option.textContent = typeof value === 'string' ? value : value.name; select.append(option); }
  select.value = current;
}
/** @param {any} data */
function render(data) {
  const metrics = el('panorama-metrics'); metrics.replaceChildren();
  for (const [label, value, suffix] of [['Hospitales', data.metrics.hospitals, ''], ['Equipos', data.metrics.equipment, ''], ['Confianza media', data.metrics.averageConfidence, '%'], ['Información desactualizada', data.metrics.staleInformation, ''], ['Oportunidades potenciales', data.metrics.potentialOpportunities, '']]) {
    const card = document.createElement('article'); card.append(node('strong', `${value}${suffix}`), node('span', label)); metrics.append(card);
  }
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('client')), data.filters.clients);
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('hospital')), data.filters.hospitals);
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('country')), data.filters.countries);
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('city')), data.filters.cities);
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('modality')), data.filters.modalities);
  const mapByCountry = new Map(data.map.map(/** @param {any} item */ item => [item.country, item]));
  for (const shape of el('regional-map').querySelectorAll('[data-country]')) shape.classList.toggle('active', mapByCountry.has(shape.getAttribute('data-country')));
  const legend = el('map-legend'); legend.replaceChildren();
  for (const country of data.map) legend.append(node('span', `${country.country}: ${country.equipment} equipos · ${country.hospitals} hospitales`));
  if (!data.map.length) legend.append(node('span', 'No hay ubicaciones para estos filtros.'));
  const list = el('regional-hospitals'); list.replaceChildren();
  for (const hospital of data.hospitals) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'hospital-result';
    button.append(node('strong', hospital.name), node('span', `${hospital.client} · ${hospital.city}, ${hospital.country}`), node('small', `${hospital.source} · ${hospital.equipmentCount} equipos · ${hospital.averageConfidence}% confianza · ${hospital.staleInformation} desactualizados`));
    button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('sitesignal:hospital', { detail: hospital.id })));
    list.append(button);
  }
  if (!data.hospitals.length) list.append(node('p', 'No hay hospitales para esta combinación de filtros.'));
  const charts = el('panorama-charts'); charts.replaceChildren();
  /** @type {Record<string, string>} */
  const names = { modality: 'Modalidad', geography: 'Geografía', age: 'Antigüedad aproximada', confidence: 'Confianza', freshness: 'Vigencia' };
  for (const [key, values] of Object.entries(data.aggregations)) {
    const chart = document.createElement('article'); chart.className = 'bar-chart'; chart.append(node('h3', names[key]));
    const maximum = Math.max(1, ...values.map(/** @param {any} item */ item => item.count));
    for (const item of values) { const row = document.createElement('div'); row.className = 'bar-row'; row.append(node('span', item.value)); const bar = document.createElement('i'); bar.style.width = `${Math.max(5, item.count / maximum * 100)}%`; row.append(bar, node('b', String(item.count))); chart.append(row); }
    if (!values.length) chart.append(node('p', 'Sin resultados.')); charts.append(chart);
  }
}
async function load() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) params.set(key, String(value));
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  render(await api('/api/panorama?' + params));
}
/** @returns {Record<string, string | number>} */
function activeFilters() {
  /** @type {Record<string, string | number>} */
  const result = {};
  for (const [key, value] of new FormData(form)) if (String(value)) result[key] = ['minAge', 'maxAge'].includes(key) ? Number(value) : String(value);
  return result;
}
function renderQuery() {
  if (!lastQuery) return;
  const panel = el('natural-query-result'); panel.hidden = false; el('query-explanation').textContent = lastQuery.explanation;
  el('query-limitations').textContent = lastQuery.limitations; const chips = el('query-chips'); chips.replaceChildren();
  /** @type {Record<string, string>} */
  const labels = { country: 'País', city: 'Ciudad', client: 'Cliente', hospital: 'Hospital', modality: 'Modalidad', minAge: 'Edad mínima', maxAge: 'Edad máxima', state: 'Estado', confidence: 'Confianza', freshness: 'Vigencia' };
  for (const [key, value] of Object.entries(lastQuery.filters)) {
    const control = /** @type {HTMLInputElement | HTMLSelectElement} */ (form.elements.namedItem(key));
    const displayValue = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent ?? String(value) : String(value);
    const chip = document.createElement('button'); chip.type = 'button'; chip.textContent = `${labels[key]}: ${displayValue} ×`; chip.setAttribute('aria-label', `Quitar filtro ${labels[key]} ${displayValue}`);
    chip.addEventListener('click', () => { const control = /** @type {HTMLInputElement | HTMLSelectElement} */ (form.elements.namedItem(key)); control.value = ''; lastQuery.filters = activeFilters(); lastQuery.explanation = 'Quitaste un filtro interpretado. El panorama muestra la combinación restante.'; renderQuery(); load().catch(console.error); });
    chips.append(chip);
  }
  if (!Object.keys(lastQuery.filters).length && lastQuery.status === 'applied') chips.append(node('span', 'No quedan filtros interpretados.'));
}
queryForm.addEventListener('submit', async event => {
  event.preventDefault(); const button = /** @type {HTMLButtonElement} */ (queryForm.querySelector('button')); button.disabled = true;
  try {
    const question = String(new FormData(queryForm).get('question') ?? ''); lastQuery = await api('/api/natural-query', { question });
    if (lastQuery.status === 'applied') {
      for (const element of form.elements) if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) element.value = '';
      for (const [key, value] of Object.entries(lastQuery.filters)) { const control = /** @type {HTMLInputElement | HTMLSelectElement} */ (form.elements.namedItem(key)); if (control) control.value = String(value); }
      await load();
    }
    renderQuery();
  } catch (error) { lastQuery = { status: 'unsupported', filters: {}, explanation: error instanceof Error ? error.message : 'No se pudo interpretar la pregunta.', limitations: 'Prueba una pregunta que describa filtros del panorama.' }; renderQuery(); }
  finally { button.disabled = false; }
});
form.addEventListener('change', () => { if (lastQuery?.status === 'applied') { lastQuery.filters = activeFilters(); lastQuery.explanation = 'Ajustaste manualmente los filtros interpretados. El panorama ya refleja los cambios.'; renderQuery(); } load().catch(console.error); });
form.addEventListener('reset', () => setTimeout(() => {
  if (lastQuery?.status === 'applied') {
    lastQuery.filters = {};
    lastQuery.explanation = 'Quitaste todos los filtros interpretados. El panorama vuelve a mostrar la región completa.';
    renderQuery();
  }
  load().catch(console.error);
}));
for (const shape of el('regional-map').querySelectorAll('[data-country]')) {
  const activate = () => { const country = /** @type {HTMLSelectElement} */ (form.elements.namedItem('country')); country.value = shape.getAttribute('data-country') ?? ''; load().catch(console.error); };
  shape.addEventListener('click', activate);
  shape.addEventListener('keydown', event => { if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); activate(); } });
}
el('reset-demo').addEventListener('click', async () => { await api('/api/demo/reset', {}); await load(); });
window.addEventListener('sitesignal:panorama-refresh', () => load().catch(console.error));
load().catch(console.error);
