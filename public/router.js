/** @param {string} id */
function el(id) { const value = document.getElementById(id); if (!value) throw new Error(id); return value; }
/** @param {string} message @param {boolean} [error] */
function toast(message, error = false) {
  if (!message.trim()) return;
  const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.textContent = message;
  el('toasts').append(item); setTimeout(() => item.remove(), 4200);
}

const feedback = el('feedback');
new MutationObserver(() => toast(feedback.textContent ?? '', feedback.classList.contains('unavailable'))).observe(feedback, { childList: true, characterData: true, subtree: true });

/** @type {any[]} */
let directory = [];
let originFilter = 'all';
async function loadDirectory() {
  try {
    const response = await fetch('/api/panorama');
    if (!response.ok) throw new Error('No se pudo cargar el directorio.');
    directory = (await response.json()).hospitals;
    renderDirectory();
  } catch (error) { toast(error instanceof Error ? error.message : 'No se pudo cargar el directorio.', true); }
}
function renderDirectory() {
  const query = /** @type {HTMLInputElement} */ (el('hospital-search')).value.trim().toLocaleLowerCase('es');
  const target = el('hospital-list'); target.replaceChildren();
  const visible = directory.filter(hospital => (originFilter === 'all' || (originFilter === 'fictional') === Boolean(hospital.fictional)) &&
    [hospital.name, hospital.client, hospital.city, hospital.country].some(value => String(value ?? '').toLocaleLowerCase('es').includes(query)));
  for (const hospital of visible) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'directory-card';
    const top = document.createElement('span'); top.className = 'directory-card-top';
    const badge = document.createElement('small'); badge.textContent = hospital.fictional ? 'FICTICIO' : 'CAPTURADO'; badge.className = hospital.fictional ? 'badge neutral' : 'badge success';
    const confidence = document.createElement('b'); confidence.textContent = `${hospital.averageConfidence}%`;
    top.append(badge, confidence);
    const name = document.createElement('strong'); name.textContent = hospital.name;
    const client = document.createElement('span'); client.textContent = hospital.client;
    const place = document.createElement('small'); place.textContent = `${hospital.city}, ${hospital.country}`;
    const facts = document.createElement('span'); facts.className = 'directory-facts'; facts.textContent = `${hospital.equipmentCount} equipos · ${hospital.pendingCount ?? 0} pendientes · ${hospital.potentialOpportunities} oportunidades`;
    card.append(top, name, client, place, facts); card.addEventListener('click', () => { location.hash = `#/hospitales/${hospital.id}`; }); target.append(card);
  }
  if (!visible.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No encontramos hospitales con estos criterios.'; target.append(empty); }
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let screen = parts[0] || 'panorama';
  if (!['panorama', 'capturar', 'hospitales', 'entorno'].includes(screen)) { location.hash = '#/panorama'; return; }
  for (const section of document.querySelectorAll('[data-screen]')) if (section instanceof HTMLElement) section.hidden = section.getAttribute('data-screen') !== screen;
  for (const link of document.querySelectorAll('[data-nav]')) link.classList.toggle('active', link.getAttribute('data-nav') === screen);
  if (screen === 'hospitales') {
    const id = parts[1]; el('hospital-directory').hidden = Boolean(id); el('hospital-detail').hidden = !id;
    if (id) setTimeout(() => window.dispatchEvent(new CustomEvent('sitesignal:hospital', { detail: id })), 0); else loadDirectory();
  }
  window.scrollTo({ top: 0 });
  window.dispatchEvent(new CustomEvent('sitesignal:route', { detail: screen }));
}
window.addEventListener('hashchange', route);
window.addEventListener('sitesignal:directory-refresh', loadDirectory);
let wizardStep = 1;
/** @param {number} step */
function showWizardStep(step) {
  if (step === 2 && !/** @type {HTMLSelectElement} */ (el('profile')).value) { toast('Selecciona un perfil para continuar.', true); return; }
  wizardStep = step; el('capture').hidden = false; el('review').hidden = true; el('capture-success').hidden = true;
  for (const panel of document.querySelectorAll('[data-wizard-step]')) if (panel instanceof HTMLElement) panel.hidden = Number(panel.dataset.wizardStep) !== step;
  for (const item of document.querySelectorAll('[data-step-link]')) { const number = Number(item.getAttribute('data-step-link')); item.classList.toggle('active', number === step); item.classList.toggle('complete', number < step); }
  if (step === 2) /** @type {HTMLTextAreaElement} */ (el('observation')).focus();
}
window.addEventListener('sitesignal:profile-ready', event => {
  const hasProfile = event instanceof CustomEvent && Boolean(event.detail);
  const next = /** @type {HTMLButtonElement} */ (el('profile-next')); next.disabled = !hasProfile;
  const profile = /** @type {HTMLSelectElement} */ (el('profile')); el('selected-profile-name').textContent = profile.selectedOptions[0]?.textContent ?? 'Perfil seleccionado';
  if (hasProfile && wizardStep === 1) showWizardStep(2);
});
el('profile-next').addEventListener('click', () => showWizardStep(2));
el('change-profile').addEventListener('click', () => showWizardStep(1));
for (const item of document.querySelectorAll('[data-step-link]')) item.addEventListener('click', () => { const target = Number(item.getAttribute('data-step-link')); if (target === 1 || (target === 2 && wizardStep >= 2)) showWizardStep(target); });

el('hospital-search').addEventListener('input', renderDirectory);
for (const button of document.querySelectorAll('[data-hospital-filter]')) button.addEventListener('click', () => {
  originFilter = button.getAttribute('data-hospital-filter') ?? 'all';
  for (const item of document.querySelectorAll('[data-hospital-filter]')) item.classList.toggle('active', item === button);
  renderDirectory();
});
for (const button of document.querySelectorAll('[data-capture-tab]')) button.addEventListener('click', () => {
  const tab = button.getAttribute('data-capture-tab');
  for (const item of document.querySelectorAll('[data-capture-tab]')) { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', String(item === button)); item.setAttribute('tabindex', item === button ? '0' : '-1'); }
  for (const panel of document.querySelectorAll('[data-capture-panel]')) if (panel instanceof HTMLElement) panel.hidden = panel.getAttribute('data-capture-panel') !== tab;
});
const captureTabs = [...document.querySelectorAll('[data-capture-tab]')];
for (const [index, button] of captureTabs.entries()) button.addEventListener('keydown', event => { if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1; const enabled = captureTabs.filter(item => !/** @type {HTMLButtonElement} */ (item).disabled); const current = enabled.indexOf(button); const next = /** @type {HTMLElement} */ (enabled[(current + direction + enabled.length) % enabled.length]); next?.focus(); next?.click(); });
const observation = /** @type {HTMLTextAreaElement} */ (el('observation'));
const updateCount = () => { el('observation-count').textContent = `${observation.value.length} / 8000`; };
observation.addEventListener('input', updateCount); updateCount();
el('new-observation').addEventListener('click', () => {
  showWizardStep(2);
});
el('back-to-story').addEventListener('click', () => showWizardStep(2));
new MutationObserver(() => {
  if (!el('review').hidden) { wizardStep = 3; el('capture').hidden = true; for (const step of document.querySelectorAll('[data-step-link]')) { step.classList.toggle('active', step.getAttribute('data-step-link') === '3'); step.classList.toggle('complete', Number(step.getAttribute('data-step-link')) < 3); } }
}).observe(el('review'), { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('sitesignal:hospital-rendered', event => {
  const target = el('hospital-view'); const detail = event instanceof CustomEvent ? event.detail : {};
  const children = [...target.children]; const hero = document.createElement('div'); hero.className = 'hospital-hero surface';
  while (children.length && !(children[0] instanceof HTMLHeadingElement && children[0].tagName === 'H3')) { const child = children.shift(); if (child) hero.append(child); }
  const observe = document.createElement('button'); observe.type = 'button'; observe.className = 'primary'; observe.textContent = '＋ Nueva observación aquí'; observe.addEventListener('click', () => { localStorage.setItem('sitesignal:targetHospital', detail.id); location.hash = '#/capturar'; }); hero.append(observe);
  const tabs = document.createElement('div'); tabs.className = 'hospital-tabs';
  const panels = new Map(['base', 'observations', 'pending', 'opportunities', 'history'].map(key => { const panel = document.createElement('div'); panel.className = 'hospital-tab-panel'; panel.dataset.hospitalPanel = key; return [key, panel]; }));
  let current = 'base';
  for (const child of children) {
    const declared = child.getAttribute('data-hospital-section');
    if (declared) current = declared;
    panels.get(current)?.append(child);
  }
  /** @type {Record<string,string>} */ const labels = { base: 'Base instalada', observations: 'Observaciones', pending: 'Pendientes', opportunities: 'Oportunidades', history: 'Historial' };
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Secciones del hospital');
  const tabButtons = /** @type {HTMLButtonElement[]} */ ([]);
  for (const [key, panel] of panels) { const button = document.createElement('button'); tabButtons.push(button); button.type = 'button'; button.setAttribute('role', 'tab'); panel.setAttribute('role', 'tabpanel'); const count = key === 'pending' ? panel.querySelectorAll('.pending-conflict,.duplicate-candidate').length : 0; button.textContent = labels[key] + (key === 'pending' ? ` (${count})` : ''); const active = key === 'base'; button.classList.toggle('active', active); panel.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.addEventListener('click', () => { for (const item of tabs.children) { item.classList.toggle('active', item === button); item.setAttribute('aria-selected', String(item === button)); } for (const item of panels.values()) item.classList.toggle('active', item === panel); }); tabs.append(button); }
  for (const [index, button] of tabButtons.entries()) button.addEventListener('keydown', event => { if (!(event instanceof KeyboardEvent) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); const direction = event.key === 'ArrowRight' ? 1 : -1; const next = tabButtons[(index + direction + tabButtons.length) % tabButtons.length]; next.focus(); next.click(); });
  target.replaceChildren(hero, tabs, ...panels.values());
  window.scrollTo({ top: 0 });
});
route();

export { toast };
