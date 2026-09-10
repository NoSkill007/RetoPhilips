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
/** @param {HTMLElement} target @param {any} assessment */
function renderAssessment(target, assessment) {
  target.replaceChildren();
  const summary = document.createElement('div'); summary.className = `confidence ${assessment.confidence.band.toLowerCase()}`;
  summary.append(node('span', String(assessment.confidence.score)), node('strong', `Confianza ${assessment.confidence.band.toLowerCase()}`));
  target.append(summary, node('p', `Estado general: ${assessment.overallState}`));
  const components = document.createElement('ul'); components.className = 'components';
  /** @type {Record<string, string>} */
  const names = { completeness: 'Completitud', freshness: 'Vigencia', evidence: 'Evidencia o confirmación' };
  for (const key of ['completeness', 'freshness', 'evidence']) {
    const component = assessment.confidence.components[key]; components.append(node('li', `${names[key]}: ${component.score} de ${component.max}`));
  }
  target.append(components, node('h3', 'Estado de cada campo'));
  const states = document.createElement('dl'); states.className = 'field-states';
  for (const [key, label] of [['client', 'Cliente'], ['hospital', 'Hospital'], ['area', 'Área']]) states.append(node('dt', label), node('dd', assessment.fields[key].state));
  assessment.equipment.forEach(/** @param {any} equipment @param {number} index */ (equipment, index) => {
    for (const [key, label] of equipmentFields) states.append(node('dt', `${label} · equipo ${index + 1}`), node('dd', equipment[key].state));
  });
  target.append(states);
}
/** @param {string | number | null} answer */
async function answerFollowUp(answer) {
  if (!draft?.followUp) return;
  try {
    draft = await api(`/api/drafts/${draft.id}/follow-up`, { answer });
    renderReview(); feedback(draft.followUp ? 'Respuesta guardada. Hay otra pregunta útil.' : 'Preguntas completadas. Revisa las tarjetas antes de guardar.');
  } catch (error) { report(error); }
}
function renderFollowUp() {
  const panel = el('followup-panel'); panel.replaceChildren();
  const question = draft.followUp;
  if (!question) { panel.hidden = true; }
  else {
    panel.hidden = false;
    panel.append(node('p', `Pregunta ${draft.followUpProgress.answered + 1} de ${draft.followUpProgress.limit}`), node('h3', question.prompt));
    let answer;
    if (question.kind === 'modality') {
      answer = document.createElement('select'); option(answer, '', 'Selecciona una modalidad');
      for (const value of modalities) option(answer, value, value);
    } else {
      answer = document.createElement('input'); answer.type = question.kind === 'number' ? 'number' : 'text';
      answer.placeholder = question.kind === 'number' ? 'Escribe un número' : 'Escribe tu respuesta';
      if (question.field === 'quantity') { answer.min = '1'; answer.max = '10000'; answer.step = '1'; }
      if (question.field === 'age') { answer.min = '0'; answer.max = '150'; answer.step = '0.1'; }
    }
    answer.setAttribute('aria-label', question.prompt); panel.append(answer);
    const actions = document.createElement('div'); actions.className = 'followup-actions';
    const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = 'Guardar respuesta';
    submit.addEventListener('click', () => { if (!answer.value.trim()) feedback('Escribe una respuesta o selecciona “No lo sé”.', true); else answerFollowUp(answer.value); });
    const unknown = document.createElement('button'); unknown.type = 'button'; unknown.textContent = 'No lo sé'; unknown.addEventListener('click', () => answerFollowUp(null));
    actions.append(submit, unknown); panel.append(actions);
  }
  for (const control of form('review-form').elements) {
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) control.disabled = Boolean(question);
  }
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
  renderSplitGroups(null);
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
  renderAssessment(el('draft-assessment'), draft.assessment);
  el('inference-info').textContent = draft.provenance.kind === 'manual' ? 'Procedencia: captura manual · La IA no produjo el resultado guardado.' : `${draft.provenance.metadata.engine} · ${draft.provenance.metadata.model} · ${(draft.provenance.metadata.durationMs / 1000).toFixed(1)} s de inferencia · ${draft.provenance.attempts} intento${draft.provenance.attempts === 1 ? '' : 's'}`;
  renderFollowUp();
  el('review').hidden = false; el('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
/** @param {string | null} hospitalId */
async function renderSplitGroups(hospitalId) {
  const panel = el('split-group-panel'); const target = select('split-group-choice'); target.replaceChildren();
  option(target, '', 'No separar de ningún grupo');
  if (!hospitalId) { panel.hidden = true; return; }
  const hospital = await api('/api/hospitals/' + hospitalId);
  const groups = hospital.installedBase.items.filter(/** @param {any} item */ item => item.kind === 'group' && Number.isInteger(item.quantity));
  for (const group of groups) option(target, group.id, `${group.modality ?? 'Modalidad desconocida'} · grupo de ${group.quantity}`);
  panel.hidden = groups.length === 0;
}
select('hospital-choice').addEventListener('change', async () => {
  const hospital = hospitals.find(h => h.id === select('hospital-choice').value);
  for (const key of ['hospital', 'client']) {
    const input = form('review-form').elements.namedItem(key);
    if (input instanceof HTMLInputElement) {
      input.readOnly = Boolean(hospital);
      input.value = hospital ? String((key === 'hospital' ? hospital.name : hospital.client) ?? '') : String(draft.reviewed[key] ?? '');
    }
  }
  try { await renderSplitGroups(hospital?.id ?? null); } catch (error) { report(error); }
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
    const saved = await api('/api/observations', { draftId: draft.id, reviewed,
      hospitalId: select('hospital-choice').value === 'new' ? null : select('hospital-choice').value,
      splitGroupId: select('split-group-choice').value || null });
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
/** @param {string} hospitalId @param {string} candidateId @param {'keep-separate' | 'consolidate'} decision */
async function decideDuplicate(hospitalId, candidateId, decision) {
  try {
    await api(`/api/duplicate-candidates/${candidateId}/decision`, { decision });
    await showHospital(hospitalId);
    feedback(decision === 'consolidate' ? 'Equipos consolidados con toda su procedencia.' : 'Los equipos se conservaron separados.');
  } catch (error) { report(error); }
}
/** @param {string} hospitalId @param {string} itemId @param {string} field @param {string} rawValue @param {string} reason */
async function correctEquipment(hospitalId, itemId, field, rawValue, reason) {
  const value = rawValue.trim() === '' ? null : ['quantity', 'age'].includes(field) ? Number(rawValue) : rawValue.trim();
  try {
    await api(`/api/installed-equipment/${itemId}/corrections`, { field, value, reason });
    await showHospital(hospitalId); feedback('Corrección guardada como dato reportado en el historial.');
  } catch (error) { report(error); }
}
/** @param {string} hospitalId @param {string} conflictId @param {string} serializedValue @param {string} explanation */
async function resolveConflict(hospitalId, conflictId, serializedValue, explanation) {
  try {
    await api(`/api/conflicts/${conflictId}/resolve`, { value: JSON.parse(serializedValue), explanation });
    await showHospital(hospitalId); feedback('Conflicto resuelto con explicación y registro de cambios.');
  } catch (error) { report(error); }
}
/** @param {string} id */
async function showHospital(id) {
  const hospital = await api('/api/hospitals/' + id); const target = el('hospital-view'); target.replaceChildren();
  target.append(node('h2', `Perfil 360 · ${hospital.name}`), node('p', `Cliente: ${hospital.client ?? 'Desconocido'}`));
  target.append(node('h3', `Base instalada · ${hospital.installedBase.total} equipos reportados`));
  const base = document.createElement('div'); base.className = 'installed-base';
  if (!hospital.installedBase.items.length) base.append(node('p', 'Todavía no hay equipos representados.'));
  for (const item of hospital.installedBase.items) {
    const card = document.createElement('article'); card.className = `installed-item ${item.kind}`;
    const kindLabel = item.kind === 'group' ? `GRUPO DE EQUIPOS · ${item.quantity ?? 'cantidad desconocida'}` : item.kind === 'consolidated' ? 'EQUIPO CONSOLIDADO' : 'EQUIPO INDIVIDUAL';
    card.append(node('p', kindLabel));
    card.append(node('h4', item.modality ?? 'Modalidad desconocida'));
    const details = document.createElement('dl'); details.className = 'equipment-summary';
    for (const [key, label] of [['manufacturer', 'Fabricante'], ['model', 'Modelo'], ['serial', 'Número de serie'], ['age', 'Antigüedad']]) details.append(node('dt', label), node('dd', `${item[key] ?? 'Desconocido'} · ${item.fieldStates[key]}`));
    card.append(details, node('p', `Procedencia: ${item.sourceObservationIds.length} observación${item.sourceObservationIds.length === 1 ? '' : 'es'} · ${item.sourceObservationIds.map(/** @param {string} value */ value => value.slice(0, 8)).join(', ')}`));
    card.append(node('p', `Evidencias vinculadas: ${item.evidenceIds?.length ?? 0}`));
    if (item.splitHistory.length) card.append(node('p', `Separaciones revisadas: ${item.splitHistory.length} · última por ${item.splitHistory.at(-1).profile.name}`));
    const correction = document.createElement('details'); correction.className = 'correction-form'; correction.append(node('summary', 'Corregir un dato'));
    const correctionFields = document.createElement('select');
    for (const [key, label] of equipmentFields) option(correctionFields, key, label);
    const correctionValue = document.createElement('input'); correctionValue.placeholder = 'Nuevo valor; vacío significa desconocido'; correctionValue.maxLength = 300;
    const reason = document.createElement('textarea'); reason.placeholder = 'Motivo de la corrección'; reason.maxLength = 500; reason.rows = 2;
    const saveCorrection = document.createElement('button'); saveCorrection.type = 'button'; saveCorrection.textContent = 'Guardar corrección';
    saveCorrection.addEventListener('click', () => correctEquipment(id, item.id, correctionFields.value, correctionValue.value, reason.value));
    correction.append(correctionFields, correctionValue, reason, saveCorrection); card.append(correction);
    base.append(card);
  }
  target.append(base);
  if (hospital.installedBase.conflicts.length) {
    target.append(node('h3', 'Conflictos pendientes'));
    for (const conflict of hospital.installedBase.conflicts) {
      const conflictCard = document.createElement('article'); conflictCard.className = 'pending-conflict';
      const label = Object.fromEntries(equipmentFields)[conflict.field] ?? conflict.field;
      conflictCard.append(node('p', 'CONFLICTO PENDIENTE'), node('h4', label), node('p', `Las observaciones respaldan valores incompatibles: ${conflict.values.join(' ↔ ')}`));
      const outcome = document.createElement('select');
      for (const value of conflict.values) option(outcome, JSON.stringify(value), String(value));
      const explanation = document.createElement('textarea'); explanation.placeholder = 'Explica por qué eliges este valor'; explanation.maxLength = 500; explanation.rows = 3;
      const resolve = document.createElement('button'); resolve.type = 'button'; resolve.className = 'primary'; resolve.textContent = 'Resolver conflicto';
      resolve.addEventListener('click', () => resolveConflict(id, conflict.id, outcome.value, explanation.value));
      conflictCard.append(outcome, explanation, resolve); target.append(conflictCard);
    }
  }
  if (hospital.installedBase.duplicateCandidates.length) {
    target.append(node('h3', 'Candidatos a duplicado pendientes'));
    /** @type {Record<string, string>} */
    const labels = { hospital: 'Hospital', modality: 'Modalidad', manufacturer: 'Fabricante', model: 'Modelo', quantity: 'Cantidad', age: 'Antigüedad aproximada', serial: 'Número de serie' };
    for (const candidate of hospital.installedBase.duplicateCandidates) {
      const review = document.createElement('article'); review.className = `duplicate-candidate ${candidate.kind}`;
      review.append(node('p', candidate.kind === 'serial' ? 'COINCIDENCIA FUERTE POR SERIE' : 'COINCIDENCIA APROXIMADA'));
      review.append(node('h4', candidate.items.map(/** @param {any} item */ item => `${item.modality ?? 'Modalidad desconocida'} · ${item.serial ?? `grupo de ${item.quantity ?? '?'}`}`).join(' ↔ ')));
      const columns = document.createElement('div'); columns.className = 'candidate-comparison';
      const matches = document.createElement('div'); matches.append(node('strong', 'Coincide'));
      const matchList = document.createElement('ul');
      for (const match of candidate.matchingFields) matchList.append(node('li', `${labels[match.field]}: ${match.field === 'hospital' ? hospital.name : match.left}`));
      matches.append(matchList); columns.append(matches);
      const conflicts = document.createElement('div'); conflicts.append(node('strong', 'Difiere'));
      if (!candidate.conflictingFields.length) conflicts.append(node('p', 'Sin diferencias conocidas'));
      else {
        const conflictList = document.createElement('ul');
        for (const conflict of candidate.conflictingFields) conflictList.append(node('li', `${labels[conflict.field]}: ${conflict.left} ↔ ${conflict.right}`));
        conflicts.append(conflictList);
      }
      columns.append(conflicts); review.append(columns);
      const actions = document.createElement('div'); actions.className = 'candidate-actions';
      const separate = document.createElement('button'); separate.textContent = 'Conservar separados'; separate.addEventListener('click', () => decideDuplicate(id, candidate.id, 'keep-separate'));
      const consolidate = document.createElement('button'); consolidate.className = 'primary'; consolidate.textContent = 'Consolidar'; consolidate.addEventListener('click', () => decideDuplicate(id, candidate.id, 'consolidate'));
      actions.append(separate, consolidate); review.append(actions); target.append(review);
    }
  }
  if (hospital.installedBase.changeHistory.length || hospital.installedBase.conflictHistory.some(/** @param {any} conflict */ conflict => conflict.status === 'resolved')) {
    const history = document.createElement('details'); history.className = 'audit-history'; history.append(node('summary', 'Historial de cambios y conflictos resueltos'));
    for (const change of hospital.installedBase.changeHistory) history.append(node('p', `${new Date(change.at).toLocaleString('es')} · ${change.author.name} · ${change.field}: ${change.oldValue ?? 'Desconocido'} → ${change.newValue ?? 'Desconocido'} · ${change.reason}`));
    for (const conflict of hospital.installedBase.conflictHistory.filter(/** @param {any} entry */ entry => entry.status === 'resolved')) history.append(node('p', `Conflicto ${conflict.field} resuelto por ${conflict.resolution.author.name}: ${conflict.resolution.value} · ${conflict.resolution.explanation}`));
    target.append(history);
  }
  target.append(node('h3', 'Observaciones que sustentan la base instalada'));
  for (const observation of hospital.observations) {
    const article = document.createElement('article');
    article.append(node('h3', `${observation.profile.name} · ${observation.profile.role}`), node('p', new Date(observation.createdAt).toLocaleString('es')));
    article.append(node('p', `Área: ${observation.reviewed.area ?? 'Desconocido'} · ${observation.assessment.fields.area.state}`));
    const assessment = document.createElement('div'); assessment.className = 'assessment';
    renderAssessment(assessment, observation.assessment); article.append(assessment);
    for (const [index, item] of observation.reviewed.equipment.entries()) {
      const list = document.createElement('dl'); list.className = 'equipment-summary';
      for (const [key, label] of equipmentFields) list.append(node('dt', label), node('dd', `${item[key] === null ? 'Desconocido' : String(item[key])} · ${observation.assessment.equipment[index][key].state}`));
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
