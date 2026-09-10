/** @param {string} id */
function el(id) { const result = document.getElementById(id); if (!result) throw new Error(id); return result; }
/** @param {string} id */
function select(id) { const result = el(id); if (!(result instanceof HTMLSelectElement)) throw new Error(id); return result; }
/** @param {string} id */
function form(id) { const result = el(id); if (!(result instanceof HTMLFormElement)) throw new Error(id); return result; }
/** @param {string} text @param {boolean} [error] */
function feedback(text, error = false) { el('feedback').textContent = text; el('feedback').className = error ? 'unavailable' : 'ready'; }
/** @param {string} path @param {unknown} [body] */
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'No se pudo completar la operación.');
  return result;
}
/** @param {unknown} error */
function report(error) { feedback(error instanceof Error ? error.message : 'No se pudo conectar con SiteSignal.', true); }
/** @param {HTMLSelectElement} target @param {string} value @param {string} text */
function option(target, value, text) { const item = document.createElement('option'); item.value = value; item.textContent = text; target.append(item); }
/** @param {string} tag @param {string} text */
function node(tag, text) { const result = document.createElement(tag); result.textContent = text; return result; }
/** @type {any} */
let draft = null;
/** @type {any[]} */
let hospitals = [];
const modalities = ['Resonancia magnética', 'Tomografía computarizada', 'Ultrasonido', 'Monitoreo de pacientes', 'Rayos X', 'Sistema intervencionista', 'Otro'];
const equipmentFields = [ ['modality', 'Modalidad'], ['quantity', 'Cantidad'], ['manufacturer', 'Fabricante'], ['model', 'Modelo'], ['serial', 'Número de serie'], ['age', 'Antigüedad reportada (años)'] ];

async function loadProfiles() {
  const data = await api('/api/profiles');
  const target = select('profile'); target.replaceChildren(); option(target, '', 'Selecciona un perfil');
  for (const profile of data.profiles) option(target, profile.id, `${profile.name} · ${profile.role}`);
  target.value = data.activeProfileId ?? '';
}
form('profile-form').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form('profile-form'));
  try {
    const profile = await api('/api/profiles', { name: data.get('name'), role: data.get('role') });
    await api('/api/profiles/active', { profileId: profile.id });
    await loadProfiles(); form('profile-form').reset(); feedback('Perfil creado y seleccionado.');
  } catch (error) { report(error); }
});
select('profile').addEventListener('change', async () => {
  try { await api('/api/profiles/active', { profileId: select('profile').value }); feedback('Perfil activo actualizado. Los borradores conservan su autor original.'); }
  catch (error) { report(error); await loadProfiles(); }
});

/** @param {string} key @param {string} label @param {string | number | null} value */
function inputField(key, label, value) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement('input'); input.name = key; input.value = value === null ? '' : String(value);
  input.placeholder = 'Desconocido'; input.maxLength = 300;
  if (key === 'quantity' || key === 'age') { input.type = 'number'; input.min = key === 'quantity' ? '1' : '0'; input.max = key === 'quantity' ? '10000' : '150'; input.step = key === 'quantity' ? '1' : '0.1'; }
  wrapper.append(input); return wrapper;
}
/** @param {Record<string, string | number | null>} equipment */
function addCard(equipment) {
  const card = document.createElement('fieldset');
  card.append(node('legend', 'Equipo o grupo reportado'));
  for (const [key, label] of equipmentFields) {
    if (key === 'modality') {
      const wrapper = document.createElement('label'); wrapper.textContent = label;
      const input = document.createElement('select'); input.name = key; option(input, '', 'Desconocido');
      for (const value of modalities) option(input, value, value);
      input.value = String(equipment[key] ?? ''); wrapper.append(input); card.append(wrapper);
    } else card.append(inputField(key, label, equipment[key] ?? null));
  }
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Quitar tarjeta';
  remove.addEventListener('click', () => card.remove()); card.append(remove);
  el('equipment-cards').append(card);
}
function renderReview() {
  el('draft-author').textContent = `Observación de ${draft.profile.name} · ${draft.profile.role}`;
  el('location-fields').replaceChildren(); el('equipment-cards').replaceChildren();
  for (const [key, label] of [['client', 'Cliente'], ['hospital', 'Hospital'], ['area', 'Área o edificio']]) el('location-fields').append(inputField(key, label, draft.reviewed[key]));
  for (const equipment of draft.reviewed.equipment) addCard(equipment);
  const target = select('hospital-choice'); target.replaceChildren(); option(target, '', 'Selecciona un destino');
  option(target, 'new', 'Crear un hospital con los datos revisados');
  for (const hospital of hospitals) option(target, hospital.id, `${draft.candidates.some(/** @param {{id: string}} c */ c => c.id === hospital.id) ? 'Posible coincidencia · ' : ''}${hospital.name} · ${hospital.client ?? 'Cliente desconocido'}`);
  target.value = draft.candidates.length ? '' : 'new';
  const notice = el('validation-notice'); notice.replaceChildren();
  if (draft.provenance.kind === 'manual') {
    notice.hidden = false; notice.append(node('h3', 'Captura manual activada'), node('p', 'QVAC falló dos veces. El relato original está intacto; completa solo los datos que puedas revisar.'));
  } else if (draft.provenance.retryCorrected) {
    notice.hidden = false; notice.append(node('h3', 'Extracción corregida'), node('p', 'La primera salida no fue válida. QVAC corrigió la extracción en el segundo y último intento.'));
  } else notice.hidden = true;
  if (!notice.hidden && draft.provenance.validationIssues.length) {
    const list = document.createElement('ul');
    for (const issue of draft.provenance.validationIssues) list.append(node('li', issue));
    notice.append(list);
  }
  el('inference-info').textContent = draft.provenance.kind === 'manual' ? 'Procedencia: captura manual · La IA no produjo el resultado guardado.' : `${draft.provenance.metadata.engine} · ${draft.provenance.metadata.model} · ${(draft.provenance.metadata.durationMs / 1000).toFixed(1)} s de inferencia · ${draft.provenance.attempts} intento${draft.provenance.attempts === 1 ? '' : 's'}`;
  el('review').hidden = false; el('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
select('hospital-choice').addEventListener('change', () => {
  const hospital = hospitals.find(h => h.id === select('hospital-choice').value);
  for (const key of ['hospital', 'client']) {
    const input = form('review-form').elements.namedItem(key);
    if (input instanceof HTMLInputElement) {
      input.readOnly = Boolean(hospital);
      input.value = hospital ? String((key === 'hospital' ? hospital.name : hospital.client) ?? '') : String(draft.reviewed[key] ?? '');
    }
  }
});
form('capture-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = el('observation'); if (!(input instanceof HTMLTextAreaElement)) return;
  if (!select('profile').value) { feedback('Crea y selecciona un perfil de colaborador.', true); return; }
  const button = el('extract'); if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = true; input.readOnly = true; el('review').hidden = true; draft = null;
  feedback('QVAC está leyendo tu observación en esta computadora…');
  try {
    draft = await api('/api/drafts', { text: input.value });
    hospitals = await api('/api/hospitals'); renderReview();
    feedback(draft.provenance.kind === 'manual' ? 'QVAC falló dos veces. Completa la captura manual sin perder tu relato.' : 'Extracción lista. Revisa los datos antes de guardarlos.', draft.provenance.kind === 'manual');
  } catch (error) { report(error); }
  finally { button.disabled = false; input.readOnly = false; }
});
el('observation').addEventListener('input', () => { if (draft) { draft = null; el('review').hidden = true; feedback('El texto cambió. Vuelve a extraer para revisar la nueva versión.'); } });
el('add-equipment').addEventListener('click', () => { if (el('equipment-cards').children.length < 20) addCard({}); });
form('review-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!draft) return;
  const button = el('save'); if (!(button instanceof HTMLButtonElement)) return;
  const data = new FormData(form('review-form'));
  const reviewed = { client: data.get('client') || null, hospital: data.get('hospital') || null, area: data.get('area') || null,
    equipment: [...el('equipment-cards').querySelectorAll('fieldset')].map(card => {
      /** @type {Record<string, string | number | null>} */
      const equipment = {};
      for (const input of card.querySelectorAll('input, select')) {
        if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement) equipment[input.name] = input.value.trim() === '' ? null : ['quantity', 'age'].includes(input.name) ? Number(input.value) : input.value.trim();
      }
      return equipment;
    }) };
  button.disabled = true;
  try {
    const saved = await api('/api/observations', { draftId: draft.id, reviewed, hospitalId: select('hospital-choice').value === 'new' ? null : select('hospital-choice').value });
    draft = null; el('review').hidden = true; form('capture-form').reset();
    await loadHospitals(); await showHospital(saved.hospitalId); feedback('Observación guardada con su texto original y procedencia.');
    el('hospital-view').scrollIntoView({ behavior: 'smooth' });
  } catch (error) { report(error); }
  finally { button.disabled = false; }
});

async function loadHospitals() {
  hospitals = await api('/api/hospitals'); el('hospital-list').replaceChildren();
  if (!hospitals.length) el('hospital-list').append(node('p', 'Todavía no hay hospitales. Guarda tu primera observación para comenzar.'));
  for (const hospital of hospitals) {
    const button = document.createElement('button'); button.textContent = `${hospital.name} · ${hospital.client ?? 'Cliente desconocido'}`;
    button.addEventListener('click', () => showHospital(hospital.id).catch(report)); el('hospital-list').append(button);
  }
}
/** @param {string} id */
async function showHospital(id) {
  const hospital = await api('/api/hospitals/' + id); const target = el('hospital-view'); target.replaceChildren();
  target.append(node('h2', `Perfil 360 · ${hospital.name}`), node('p', `Cliente: ${hospital.client ?? 'Desconocido'}`));
  target.append(node('p', 'Observaciones reportadas. La consolidación de equipos y evaluación de confianza se incorporarán en próximas entregas.'));
  for (const observation of hospital.observations) {
    const article = document.createElement('article');
    article.append(node('h3', `${observation.profile.name} · ${observation.profile.role}`), node('p', new Date(observation.createdAt).toLocaleString('es')));
    article.append(node('p', `Área: ${observation.reviewed.area ?? 'Desconocido'}`));
    for (const item of observation.reviewed.equipment) {
      const list = document.createElement('dl'); list.className = 'equipment-summary';
      for (const [key, label] of equipmentFields) list.append(node('dt', label), node('dd', item[key] === null ? 'Desconocido' : String(item[key])));
      article.append(list);
    }
    const details = document.createElement('details'); details.append(node('summary', 'Texto original y procedencia'));
    const original = node('blockquote', observation.originalText); original.className = 'original';
    const provenance = observation.provenance.kind === 'manual'
      ? `Captura manual tras ${observation.provenance.attempts} fallos de QVAC`
      : `${observation.provenance.metadata.engine} · ${observation.provenance.metadata.model} · ${observation.provenance.metadata.durationMs} ms`;
    details.append(original, node('p', `Capturada: ${new Date(observation.capturedAt).toLocaleString('es')} · ${provenance}`));
    article.append(details); target.append(article);
  }
}
Promise.all([loadProfiles(), loadHospitals()]).catch(report);
