/** @param {string} id */
function el(id) { const value = document.getElementById(id); if (!value) throw new Error(id); return value; }
/** @param {string} tag @param {string} text @param {string} [className] */
function node(tag, text, className = '') { const value = document.createElement(tag); value.textContent = text; value.className = className; return value; }
/** @param {string} path @param {unknown} [body] */
async function api(path, body) { const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'No se pudo cargar el panorama.'); return result; }
const form = /** @type {HTMLFormElement} */ (el('panorama-filters'));
const queryForm = /** @type {HTMLFormElement} */ (el('natural-query-form'));
/** @type {any} */ let lastQuery = null;
/** @type {any} */ let map;
/** @type {any} */ let markerLayer;

function initializeMap() {
  const L = /** @type {any} */ (window).L;
  if (!L || map) return;
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView([5, -74], 3);
  markerLayer = L.layerGroup().addTo(map);
  const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' });
  let failed = false;
  tiles.on('tileerror', () => { if (!failed) { failed = true; el('map-offline').hidden = false; } });
  tiles.on('tileload', () => { if (failed) { failed = false; el('map-offline').hidden = true; } });
  tiles.addTo(map);
}
/** @param {HTMLSelectElement} select @param {Array<string | {id:string,name:string}>} values */
function options(select, values) { const current = select.value; const first = select.options[0]; select.replaceChildren(first); for (const value of values) { const item = document.createElement('option'); item.value = typeof value === 'string' ? value : value.id; item.textContent = typeof value === 'string' ? value : value.name; select.append(item); } select.value = current; }
/** @returns {Record<string,string|number>} */
function activeFilters() { const result = /** @type {Record<string,string|number>} */ ({}); for (const [key, value] of new FormData(form)) if (String(value)) result[key] = ['minAge', 'maxAge'].includes(key) ? Number(value) : String(value); return result; }
/** @param {string} key */
function filterLabel(key) { return ({ client: 'Cliente', hospital: 'Hospital', region: 'Región', country: 'País', city: 'Ciudad', modality: 'Modalidad', minAge: 'Edad mínima', maxAge: 'Edad máxima', state: 'Estado', confidence: 'Confianza', freshness: 'Vigencia' })[key] ?? key; }
function renderActiveFilters() {
  const filters = activeFilters(); const target = el('active-filter-chips'); target.replaceChildren();
  for (const [key, value] of Object.entries(filters)) { const control = /** @type {HTMLInputElement|HTMLSelectElement} */ (form.elements.namedItem(key)); const display = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent ?? String(value) : String(value); const chip = /** @type {HTMLButtonElement} */ (node('button', `${filterLabel(key)}: ${display} ×`)); chip.type = 'button'; chip.addEventListener('click', () => { control.value = ''; load(); }); target.append(chip); }
  el('filter-count').textContent = String(Object.keys(filters).length); el('clear-filters').hidden = !Object.keys(filters).length;
}
/** @param {any} hospital @param {number} index */
function popupFor(hospital, index) {
  const content = document.createElement('div'); content.className = 'map-popup'; content.append(node('small', hospital.source.toUpperCase()), node('strong', hospital.name), node('span', hospital.client), node('span', `${hospital.city}, ${hospital.country}`), node('b', `${hospital.equipmentCount} equipos · ${hospital.averageConfidence}% confianza`));
  const link = /** @type {HTMLButtonElement} */ (node('button', 'Ver perfil →')); link.type = 'button'; link.addEventListener('click', () => { location.hash = `#/hospitales/${hospital.id}`; }); content.append(link);
  const offset = ((index % 5) - 2) * .018; return { content, lat: hospital.coordinates.lat + offset, lng: hospital.coordinates.lng + offset };
}
/** @param {any[]} hospitals */
function renderMap(hospitals) {
  initializeMap(); if (!map) return; markerLayer.clearLayers(); const L = /** @type {any} */ (window).L; const bounds = /** @type {Array<[number,number]>} */ ([]);
  hospitals.filter(item => item.coordinates).forEach((hospital, index) => { const popup = popupFor(hospital, index); const band = hospital.averageConfidence >= 80 ? 'high' : hospital.averageConfidence >= 50 ? 'medium' : 'low'; const icon = L.divIcon({ className: `site-marker ${band}`, html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }); L.marker([popup.lat, popup.lng], { icon }).bindPopup(popup.content).addTo(markerLayer); bounds.push([popup.lat, popup.lng]); });
  // Leaflet reads the container's pixel size at construction time; if that size was still 0 or stale
  // (layout not yet settled, or the map tab was hidden), fitBounds computes the wrong zoom/center. A
  // forced invalidateSize() right before fitting guarantees the projection matches the real box.
  map.invalidateSize();
  if (bounds.length) map.fitBounds(bounds, { padding: [34, 34], maxZoom: 7 }); else map.setView([5, -74], 3); el('visible-hospital-count').textContent = String(hospitals.length);
}
/** @param {any} data */
function render(data) {
  const metrics = el('panorama-metrics'); metrics.replaceChildren(); const definitions = [['Hospitales', data.metrics.hospitals, 'Sedes visibles'], ['Equipos', data.metrics.equipment, 'Base instalada'], ['Confianza media', `${data.metrics.averageConfidence}%`, 'Calidad de información'], ['Desactualizados', data.metrics.staleInformation, 'Más de 12 meses'], ['Oportunidades', data.metrics.potentialOpportunities, 'Señales potenciales']];
  for (const [label, value, detail] of definitions) { const card = document.createElement('article'); card.className = 'metric-card'; card.append(node('strong', String(value)), node('span', String(label)), node('small', String(detail))); metrics.append(card); }
  options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('client')), data.filters.clients); options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('hospital')), data.filters.hospitals); options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('region')), data.filters.regions); options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('country')), data.filters.countries); options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('city')), data.filters.cities); options(/** @type {HTMLSelectElement} */ (form.elements.namedItem('modality')), data.filters.modalities);
  renderActiveFilters(); renderMap(data.hospitals);
  const countries = el('map-legend'); countries.replaceChildren(); for (const country of data.map) { const button = /** @type {HTMLButtonElement} */ (node('button', `${country.country} · ${country.equipment}`)); button.type = 'button'; button.addEventListener('click', () => { const input = /** @type {HTMLSelectElement} */ (form.elements.namedItem('country')); input.value = country.country; load(); }); countries.append(button); }
  const list = el('regional-hospitals'); list.replaceChildren(); for (const hospital of data.hospitals) { const button = document.createElement('button'); button.type = 'button'; button.className = 'hospital-result'; const body = document.createElement('span'); body.append(node('strong', hospital.name), node('small', `${hospital.client} · ${hospital.city}, ${hospital.country}`)); button.append(body, node('b', `${hospital.averageConfidence}%`)); button.addEventListener('click', () => { location.hash = `#/hospitales/${hospital.id}`; }); list.append(button); } if (!data.hospitals.length) list.append(node('p', 'No hay hospitales para esta combinación.', 'empty-state'));
  const charts = el('panorama-charts'); charts.replaceChildren(); const names = /** @type {Record<string,string>} */ ({ region: 'Región', modality: 'Modalidad', geography: 'Geografía', age: 'Antigüedad', confidence: 'Confianza', freshness: 'Vigencia' });
  for (const [key, rawValues] of Object.entries(data.aggregations)) { const values = /** @type {Array<any>} */ (rawValues); const chart = document.createElement('article'); chart.className = 'bar-chart'; chart.append(node('h3', names[key])); const maximum = Math.max(1, ...values.map(item => item.count)); for (const item of values) { const row = document.createElement('div'); row.className = 'bar-row'; const track = document.createElement('div'); track.className = 'bar-track'; const progress = document.createElement('progress'); progress.max = maximum; progress.value = item.count; track.append(progress); row.append(node('span', item.value), track, node('b', String(item.count))); chart.append(row); } if (!values.length) chart.append(node('p', 'Sin resultados.')); charts.append(chart); }
}
async function load() { const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (String(value)) params.set(key, String(value)); try { render(await api('/api/panorama?' + params)); } catch (error) { el('feedback').textContent = error instanceof Error ? error.message : 'No se pudo cargar el panorama.'; el('feedback').className = 'sr-only unavailable'; } }
function renderQuery() { if (!lastQuery) return; if (lastQuery.status === 'applied') lastQuery.filters = activeFilters(); el('natural-query-result').hidden = false; el('query-explanation').textContent = lastQuery.explanation; el('query-limitations').textContent = lastQuery.limitations; const chips = el('query-chips'); chips.replaceChildren(); for (const [key, value] of Object.entries(lastQuery.filters)) { const control = /** @type {HTMLInputElement|HTMLSelectElement} */ (form.elements.namedItem(key)); const display = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.textContent ?? String(value) : String(value); const chip = /** @type {HTMLButtonElement} */ (node('button', `${filterLabel(key)}: ${display} ×`)); chip.type = 'button'; chip.addEventListener('click', () => { control.value = ''; load(); renderQuery(); }); chips.append(chip); } }
queryForm.addEventListener('submit', async event => { event.preventDefault(); const button = /** @type {HTMLButtonElement} */ (queryForm.querySelector('button')); button.disabled = true; try { lastQuery = await api('/api/natural-query', { question: new FormData(queryForm).get('question') }); if (lastQuery.status === 'applied') { for (const control of form.elements) if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.value = ''; for (const [key, value] of Object.entries(lastQuery.filters)) { const control = /** @type {HTMLInputElement|HTMLSelectElement} */ (form.elements.namedItem(key)); if (control) control.value = String(value); } await load(); } renderQuery(); } catch (error) { lastQuery = { filters: {}, explanation: error instanceof Error ? error.message : 'No se pudo interpretar.', limitations: 'Prueba con filtros del panorama.' }; renderQuery(); } finally { button.disabled = false; } });
form.addEventListener('change', () => { load(); if (lastQuery) renderQuery(); }); form.addEventListener('reset', () => setTimeout(() => { load(); if (lastQuery) renderQuery(); }));
el('toggle-filters').addEventListener('click', () => { form.hidden = !form.hidden; }); el('close-filters').addEventListener('click', () => { form.hidden = true; }); el('apply-filters').addEventListener('click', () => { form.hidden = true; load(); }); el('clear-filters').addEventListener('click', () => { form.reset(); });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => { const view = button.getAttribute('data-view'); for (const item of document.querySelectorAll('[data-view]')) { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', String(item === button)); } for (const panel of document.querySelectorAll('[data-view-panel]')) panel.classList.toggle('active', panel.getAttribute('data-view-panel') === view); if (view === 'map') setTimeout(() => map?.invalidateSize(), 0); });
const viewTabs = [...document.querySelectorAll('[data-view]')];
for (const [index, button] of viewTabs.entries()) button.addEventListener('keydown', event => { if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1; const next = /** @type {HTMLElement} */ (viewTabs[(index + direction + viewTabs.length) % viewTabs.length]); next.focus(); next.click(); });
for (const panel of document.querySelectorAll('[data-view-panel]')) panel.classList.toggle('active', panel.getAttribute('data-view-panel') === 'map');
el('reset-demo').addEventListener('click', async () => { if (!confirm('¿Restablecer el dataset ficticio? Las capturas locales se conservarán.')) return; await api('/api/demo/reset', {}); await load(); });
window.addEventListener('sitesignal:panorama-refresh', load); window.addEventListener('sitesignal:route', event => { if (event instanceof CustomEvent && event.detail === 'panorama') setTimeout(() => map?.invalidateSize(), 0); });
load();
