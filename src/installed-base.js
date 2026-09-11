import { randomUUID } from 'node:crypto';
import { RequestError } from './request-error.js';
import { normalize } from './observation-schema.js';
import { assessObservation } from './confidence.js';

/** @param {import('node:sqlite').DatabaseSync} db @param {() => Date} now */
export function installedBase(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_equipment (id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installed_base_sources (source_key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS duplicate_candidates (
      id TEXT PRIMARY KEY, pair_key TEXT UNIQUE NOT NULL, item_a TEXT NOT NULL, item_b TEXT NOT NULL,
      hospital_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS installed_base_conflicts (
      id TEXT PRIMARY KEY, pair_key TEXT UNIQUE NOT NULL, item_a TEXT NOT NULL, item_b TEXT NOT NULL,
      hospital_id TEXT NOT NULL, field TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS installed_base_changes (
      id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, item_id TEXT NOT NULL, data TEXT NOT NULL
    );
  `);
  const equipmentFields = ['modality', 'quantity', 'manufacturer', 'model', 'serial', 'age'];
  /** @param {any} equipment @param {any} observation */
  function supportsFromObservation(equipment, observation) {
    return Object.fromEntries(equipmentFields.map(field => [field, equipment[field] === null ? [] : [{
      profileId: observation.profile.id, observationId: observation.id, value: equipment[field], kind: 'observation',
    }]]));
  }
  /** @param {any} item */
  function hydrate(item) {
    const fieldStates = item.fieldStates ?? Object.fromEntries(equipmentFields.map(field => [field, item[field] === null ? 'Desconocido' : 'Reportado']));
    const confirmations = item.confirmations ?? Object.fromEntries(equipmentFields.map(field => [field, []]));
    const sourceProfileIds = item.sourceProfileIds ?? item.sourceObservationIds.flatMap(/** @param {string} observationId */ observationId => {
      const row = db.prepare('SELECT data FROM observations WHERE id = ?').get(observationId);
      return row ? [JSON.parse(String(row.data)).profile.id] : [];
    });
    let fieldSources = item.fieldSources;
    if (!fieldSources) {
      fieldSources = Object.fromEntries(equipmentFields.map(field => [field, []]));
      for (const observationId of item.sourceObservationIds) {
        const row = db.prepare('SELECT data FROM observations WHERE id = ?').get(observationId);
        if (!row) continue;
        const observation = JSON.parse(String(row.data));
        for (const equipment of observation.reviewed.equipment) {
          for (const field of equipmentFields) {
            if (item[field] !== null && equipment[field] !== null && normalize(String(item[field])) === normalize(String(equipment[field]))) {
              fieldSources[field].push({ profileId: observation.profile.id, observationId, value: equipment[field], kind: 'observation' });
            }
          }
        }
      }
    }
    return { ...item, sourceProfileIds: [...new Set(sourceProfileIds)], fieldStates, confirmations, fieldSources };
  }
  /** @param {any} item */
  function updateItem(item) { db.prepare('UPDATE installed_equipment SET data = ? WHERE id = ?').run(JSON.stringify(item), item.id); }
  /** @param {any} change */
  function recordChange(change) {
    db.prepare('INSERT INTO installed_base_changes VALUES (?, ?, ?, ?)').run(change.id, change.hospitalId, change.itemId, JSON.stringify(change));
  }
  /** @param {any} item @param {string} field @param {any} change */
  function settleAlignedConflicts(item, field, change) {
    const rows = db.prepare("SELECT id, data FROM installed_base_conflicts WHERE hospital_id = ? AND field = ? AND status = 'pending'").all(item.hospitalId, field);
    for (const row of rows) {
      const conflict = JSON.parse(String(row.data));
      if (!conflict.itemIds.includes(item.id) || !conflict.values.some(/** @param {unknown} value */ value => JSON.stringify(value) === JSON.stringify(item[field]))) continue;
      const currentValues = conflict.itemIds.map(/** @param {string} id */ id => db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(id))
        .filter(Boolean).map(/** @param {any} current */ current => JSON.parse(String(current.data))[field]);
      if (!currentValues.length || !currentValues.every(/** @param {unknown} value */ value => JSON.stringify(value) === JSON.stringify(item[field]))) continue;
      const resolution = { value: item[field], explanation: change.reason, author: change.author, at: change.at, changeId: change.id };
      const resolved = { ...conflict, status: 'resolved', resolution };
      db.prepare('UPDATE installed_base_conflicts SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), row.id);
    }
  }

  /** @param {any} left @param {any} right @param {string} field @param {string[]} [targetItemIds] */
  function createConflict(left, right, field, targetItemIds = [left.id, right.id]) {
    const originItemIds = [left.id, right.id].sort();
    const pendingRows = db.prepare("SELECT data FROM installed_base_conflicts WHERE status = 'pending' AND field = ?").all(field);
    const existing = pendingRows.map(row => JSON.parse(String(row.data))).find(conflict =>
      JSON.stringify([...(conflict.originItemIds ?? conflict.itemIds)].sort()) === JSON.stringify(originItemIds));
    const conflict = existing ?? { id: randomUUID(), hospitalId: left.hospitalId, originItemIds, field,
      createdAt: now().toISOString(), resolution: null };
    Object.assign(conflict, { itemIds: targetItemIds, values: [left[field], right[field]], status: 'pending',
      sourceObservationIds: [...new Set([...left.sourceObservationIds, ...right.sourceObservationIds])], items: [left, right] });
    if (existing) db.prepare('UPDATE installed_base_conflicts SET item_a = ?, item_b = ?, data = ? WHERE id = ?')
      .run(targetItemIds[0], targetItemIds[1] ?? targetItemIds[0], JSON.stringify(conflict), conflict.id);
    else {
      const pairKey = `${originItemIds.join(':')}:${field}:${conflict.id}`;
      db.prepare('INSERT INTO installed_base_conflicts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(conflict.id, pairKey, targetItemIds[0], targetItemIds[1] ?? targetItemIds[0], left.hospitalId, field, conflict.status, JSON.stringify(conflict));
    }
  }

  /** @param {any} item */
  function detectConflicts(item) {
    if (!item.serial) return;
    const others = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ? AND id <> ?').all(item.hospitalId, item.id)
      .map(row => hydrate(JSON.parse(String(row.data))))
      .filter(other => other.serial && normalize(String(other.serial)) === normalize(String(item.serial)));
    for (const other of others) for (const field of ['modality', 'quantity', 'manufacturer', 'model', 'age']) {
      if (other[field] === null || item[field] === null) continue;
      const compatible = field === 'age' ? Math.abs(Number(other[field]) - Number(item[field])) <= 1 : normalize(String(other[field])) === normalize(String(item[field]));
      if (!compatible) createConflict(other, item, field);
    }
  }

  /** @param {any} item */
  function recalculateCorroboration(item) {
    if (!item.serial) { updateItem(hydrate(item)); return; }
    const identity = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ?').all(item.hospitalId)
      .map(row => hydrate(JSON.parse(String(row.data))))
      .filter(other => other.serial && normalize(String(other.serial)) === normalize(String(item.serial)));
    for (const target of identity) {
      for (const field of equipmentFields) {
        if (target[field] === null) { target.fieldStates[field] = 'Desconocido'; target.confirmations[field] = []; continue; }
        const supports = identity.flatMap(source => source.fieldSources[field]).filter(source => normalize(String(source.value)) === normalize(String(target[field])));
        const profileIds = [...new Set(supports.map(source => source.profileId))];
        if (profileIds.length > 1) {
          target.fieldStates[field] = 'Confirmado'; target.confirmations[field] = [{ profileIds,
            observationIds: [...new Set(supports.flatMap(source => source.observationId ? [source.observationId] : []))],
            changeIds: [...new Set(supports.flatMap(source => source.changeId ? [source.changeId] : []))], at: now().toISOString() }];
        } else {
          target.fieldStates[field] = target.fieldStates[field] === 'Estimado' ? 'Estimado' : 'Reportado'; target.confirmations[field] = [];
        }
      }
      updateItem(target);
    }
  }

  /** @param {any} left @param {any} right */
  function compare(left, right) {
    /** @type {any[]} */
    const matchingFields = [{ field: 'hospital', left: left.hospitalId, right: right.hospitalId }];
    /** @type {any[]} */
    const conflictingFields = [];
    /** @param {string} field */
    const compareText = (field) => {
      if (left[field] === null || right[field] === null) return;
      const target = normalize(String(left[field])) === normalize(String(right[field])) ? matchingFields : conflictingFields;
      target.push({ field, left: left[field], right: right[field] });
    };
    for (const field of ['modality', 'manufacturer', 'model', 'quantity']) compareText(field);
    if (left.age !== null && right.age !== null) {
      const target = Math.abs(Number(left.age) - Number(right.age)) <= 1 ? matchingFields : conflictingFields;
      target.push({ field: 'age', left: left.age, right: right.age });
    }
    const sameSerial = left.serial && right.serial && normalize(String(left.serial)) === normalize(String(right.serial));
    if (sameSerial) matchingFields.push({ field: 'serial', left: left.serial, right: right.serial });
    else if (left.serial && right.serial) return null;
    const modalityMatches = matchingFields.some(match => match.field === 'modality');
    // A field that's simply unknown on one or both sides is neither evidence for nor against a match — it
    // never appears in matchingFields or conflictingFields at all (see compareText above). Requiring a
    // fixed count of *positive* matches beyond hospital+modality silently exempted the sparsest, least
    // detailed reports — a bare "two tomógrafos" followed later by "five tomógrafos" at the same hospital,
    // with nothing else known either time — from ever being flagged, which is exactly backwards: an
    // incomplete report is the case most likely to be an unrecognized re-report of the same group, not
    // less likely. The only real disqualifier is *positive* conflicting evidence on identity itself —
    // manufacturer AND model both actively disagreeing — which two truly distinct products would show.
    const identityConflict = conflictingFields.some(match => match.field === 'manufacturer') && conflictingFields.some(match => match.field === 'model');
    if (!sameSerial && (!modalityMatches || identityConflict)) return null;
    return { kind: sameSerial ? 'serial' : 'approximate', matchingFields, conflictingFields };
  }

  /** @param {any} item */
  function detectDuplicates(item) {
    const existing = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ? AND id <> ?').all(item.hospitalId, item.id)
      .map(row => JSON.parse(String(row.data)));
    for (const other of existing) {
      if (item.sourceObservationIds.some(/** @param {string} source */ source => other.sourceObservationIds.includes(source))) continue;
      const comparison = compare(other, item);
      if (!comparison) continue;
      const itemIds = [other.id, item.id].sort(); const pairKey = itemIds.join(':');
      const candidate = { id: randomUUID(), hospitalId: item.hospitalId, itemIds, status: 'pending', ...comparison,
        items: [other, item], createdAt: now().toISOString(), decision: null };
      db.prepare('INSERT OR IGNORE INTO duplicate_candidates VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(candidate.id, pairKey, itemIds[0], itemIds[1], item.hospitalId, candidate.status, JSON.stringify(candidate));
    }
  }

  /** @param {any} observation */
  function projectObservation(observation) {
    observation.reviewed.equipment.forEach(/** @param {any} equipment @param {number} index */ (equipment, index) => {
      const sourceKey = `${observation.id}:${index}`;
      if (db.prepare('SELECT source_key FROM installed_base_sources WHERE source_key = ?').get(sourceKey)) return;
      const quantity = equipment.quantity;
      const kind = quantity === 1 && equipment.serial ? 'individual' : 'group';
      const item = hydrate({
        id: randomUUID(), hospitalId: observation.hospitalId, kind, quantity,
        modality: equipment.modality, manufacturer: equipment.manufacturer, model: equipment.model,
        serial: kind === 'individual' ? equipment.serial : null, age: equipment.age,
        sourceObservationIds: [observation.id], sourceProfileIds: [observation.profile.id], evidenceIds: observation.evidenceIds ?? [], splitHistory: [],
        fieldSources: supportsFromObservation({ ...equipment, serial: kind === 'individual' ? equipment.serial : null }, observation),
      });
      db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(item.id, item.hospitalId, JSON.stringify(item));
      db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(sourceKey);
      detectDuplicates(item);
      detectConflicts(item);
      recalculateCorroboration(item);
    });
  }

  /** @param {string} hospitalId */
  function present(hospitalId) {
    const items = db.prepare("SELECT data FROM installed_equipment WHERE hospital_id = ? ORDER BY CASE WHEN json_extract(data, '$.kind') = 'group' THEN 0 ELSE 1 END, rowid").all(hospitalId)
      .map(row => hydrate(JSON.parse(String(row.data))));
    const total = items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) ? item.quantity : 0), 0);
    const duplicateCandidates = db.prepare("SELECT data FROM duplicate_candidates WHERE hospital_id = ? AND status = 'pending' ORDER BY rowid").all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    const conflicts = db.prepare("SELECT data FROM installed_base_conflicts WHERE hospital_id = ? AND status = 'pending' ORDER BY rowid").all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    const conflictHistory = db.prepare('SELECT data FROM installed_base_conflicts WHERE hospital_id = ? ORDER BY rowid DESC').all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    const changeHistory = db.prepare('SELECT data FROM installed_base_changes WHERE hospital_id = ? ORDER BY rowid DESC').all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    return { total, items, duplicateCandidates, conflicts, conflictHistory, changeHistory };
  }

  /** @param {any} observation */
  function confirmedFieldsForObservation(observation) {
    const items = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ?').all(observation.hospitalId)
      .map(row => hydrate(JSON.parse(String(row.data))))
      .filter(item => item.sourceObservationIds.includes(observation.id));
    /** @type {string[]} */
    const confirmed = [];
    observation.reviewed.equipment.forEach(/** @param {any} equipment @param {number} index */ (equipment, index) => {
      for (const field of equipmentFields) {
        if (equipment[field] === null) continue;
        if (items.some(item => item.fieldStates[field] === 'Confirmado' && normalize(String(item[field])) === normalize(String(equipment[field])))) confirmed.push(`equipment.${index}.${field}`);
      }
    });
    return confirmed;
  }

  /** @param {string} groupId @param {any} observation */
  function splitFromObservation(groupId, observation) {
    if (observation.reviewed.equipment.length !== 1) throw new RequestError(400, 'La observación que identifica una unidad debe contener una sola tarjeta de equipo.');
    const identifying = observation.reviewed.equipment[0];
    if (identifying.quantity !== 1 || !identifying.serial) throw new RequestError(400, 'Para separar una unidad indica cantidad 1 y un número de serie revisado.');
    const row = db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(groupId);
    if (!row) throw new RequestError(404, 'El grupo de equipos no existe.');
    const group = hydrate(JSON.parse(String(row.data)));
    if (group.kind !== 'group' || group.hospitalId !== observation.hospitalId) throw new RequestError(400, 'Selecciona un grupo del mismo hospital.');
    if (!Number.isInteger(group.quantity) || group.quantity < 1) throw new RequestError(400, 'El grupo no tiene una cantidad conocida que pueda separarse.');
    if (group.modality && identifying.modality && group.modality !== identifying.modality) throw new RequestError(400, 'La modalidad de la unidad no coincide con la del grupo.');

    const at = now().toISOString();
    const split = { observationId: observation.id, profile: observation.profile, at };
    const identifyingSources = supportsFromObservation(identifying, observation);
    const fieldSources = Object.fromEntries(equipmentFields.map(field => [field, [
      ...(group.fieldSources[field] ?? []), ...(identifying[field] === null ? [] : identifyingSources[field]),
    ]]));
    const individual = hydrate({
      id: randomUUID(), hospitalId: group.hospitalId, kind: 'individual', quantity: 1,
      modality: identifying.modality ?? group.modality, manufacturer: identifying.manufacturer ?? group.manufacturer,
      model: identifying.model ?? group.model, serial: identifying.serial, age: identifying.age ?? group.age,
      sourceObservationIds: [...new Set([...group.sourceObservationIds, observation.id])],
      sourceProfileIds: [...new Set([...(group.sourceProfileIds ?? []), observation.profile.id])],
      evidenceIds: [...new Set([...(group.evidenceIds ?? []), ...(observation.evidenceIds ?? [])])], splitHistory: [...group.splitHistory, split],
      fieldSources,
    });
    db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(`${observation.id}:0`);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(individual.id, individual.hospitalId, JSON.stringify(individual));
    detectDuplicates(individual);
    detectConflicts(individual);
    recalculateCorroboration(individual);
    if (group.quantity === 1) db.prepare('DELETE FROM installed_equipment WHERE id = ?').run(group.id);
    else {
      const remainder = { ...group, quantity: group.quantity - 1, splitHistory: [...group.splitHistory, split] };
      db.prepare('UPDATE installed_equipment SET data = ? WHERE id = ?').run(JSON.stringify(remainder), group.id);
    }
  }

  /** @param {string} candidateId @param {'keep-separate' | 'consolidate'} choice @param {any} collaborator */
  function decideDuplicate(candidateId, choice, collaborator) {
    const row = db.prepare('SELECT * FROM duplicate_candidates WHERE id = ?').get(candidateId);
    if (!row) throw new RequestError(404, 'El candidato a duplicado no existe.');
    const candidate = JSON.parse(String(row.data));
    if (row.status !== 'pending') throw new RequestError(409, 'Este candidato ya fue revisado.');
    const decision = { choice, profile: collaborator, at: now().toISOString() };
    if (choice === 'keep-separate') {
      const resolved = { ...candidate, status: 'kept-separate', decision };
      db.prepare('UPDATE duplicate_candidates SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), candidateId);
      return resolved;
    }
    const records = candidate.itemIds.map(/** @param {string} id */ id => db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(id));
    if (records.some(/** @param {any} record */ record => !record)) throw new RequestError(409, 'Uno de los equipos ya no está disponible para consolidar.');
    const originals = records.map(/** @param {any} record */ record => hydrate(JSON.parse(String(record.data))));
    const [left, right] = originals;
    /** @param {string} field */
    const value = (field) => left[field] ?? right[field] ?? null;
    const quantities = originals.map(/** @param {any} item */ item => item.quantity).filter(Number.isInteger);
    const consolidated = hydrate({
      id: randomUUID(), hospitalId: candidate.hospitalId, kind: 'consolidated', quantity: quantities.length ? Math.max(...quantities) : null,
      modality: value('modality'), manufacturer: value('manufacturer'), model: value('model'), serial: value('serial'), age: value('age'),
      sourceObservationIds: [...new Set(originals.flatMap(/** @param {any} item */ item => item.sourceObservationIds))],
      sourceProfileIds: [...new Set(originals.flatMap(/** @param {any} item */ item => item.sourceProfileIds))],
      evidenceIds: [...new Set(originals.flatMap(/** @param {any} item */ item => item.evidenceIds ?? []))],
      splitHistory: originals.flatMap(/** @param {any} item */ item => item.splitHistory ?? []), consolidation: { originals, decision },
      fieldSources: Object.fromEntries(equipmentFields.map(field => [field, originals.flatMap(/** @param {any} item */ item => item.fieldSources[field] ?? [])])),
    });
    for (const field of equipmentFields) {
      if (originals.some(/** @param {any} item */ item => item.fieldStates[field] === 'Confirmado')) consolidated.fieldStates[field] = 'Confirmado';
      consolidated.confirmations[field] = originals.flatMap(/** @param {any} item */ item => item.confirmations[field] ?? []);
    }
    db.prepare('DELETE FROM installed_equipment WHERE id IN (?, ?)').run(candidate.itemIds[0], candidate.itemIds[1]);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(consolidated.id, consolidated.hospitalId, JSON.stringify(consolidated));
    for (const field of ['modality', 'quantity', 'manufacturer', 'model', 'age']) {
      if (left[field] === null || right[field] === null) continue;
      const compatible = field === 'age' ? Math.abs(Number(left[field]) - Number(right[field])) <= 1 : normalize(String(left[field])) === normalize(String(right[field]));
      if (!compatible) createConflict(left, right, field, [consolidated.id]);
    }
    db.prepare("UPDATE duplicate_candidates SET status = 'superseded' WHERE status = 'pending' AND (item_a IN (?, ?) OR item_b IN (?, ?))")
      .run(candidate.itemIds[0], candidate.itemIds[1], candidate.itemIds[0], candidate.itemIds[1]);
    const resolved = { ...candidate, status: 'consolidated', decision, consolidatedItemId: consolidated.id };
    db.prepare('UPDATE duplicate_candidates SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), candidateId);
    return resolved;
  }

  /** @param {string} itemId @param {string} field @param {unknown} newValue @param {string} reason @param {any} collaborator */
  function correct(itemId, field, newValue, reason, collaborator) {
    const row = db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(itemId);
    if (!row) throw new RequestError(404, 'El equipo de la base instalada no existe.');
    const item = hydrate(JSON.parse(String(row.data))); const oldValue = item[field];
    if (field === 'serial' && newValue !== null && item.kind === 'group' && item.quantity !== 1) throw new RequestError(400, 'Separa una unidad del grupo antes de asignarle un número de serie.');
    if (field === 'quantity' && item.kind === 'individual' && newValue !== 1) throw new RequestError(400, 'Un equipo individual conserva cantidad 1.');
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) throw new RequestError(400, 'La corrección debe cambiar el valor actual.');
    item[field] = newValue; item.fieldStates[field] = newValue === null ? 'Desconocido' : 'Reportado'; item.confirmations[field] = [];
    if (field === 'serial' && newValue !== null && item.kind === 'group' && item.quantity === 1) item.kind = 'individual';
    const change = { id: randomUUID(), hospitalId: item.hospitalId, itemId: item.id, kind: 'correction', field,
      oldValue, newValue, author: collaborator, at: now().toISOString(), reason };
    if (newValue !== null) item.fieldSources[field].push({ profileId: collaborator.id, changeId: change.id, value: newValue, kind: 'correction' });
    updateItem(item); recordChange(change); settleAlignedConflicts(item, field, change); detectConflicts(item); recalculateCorroboration(item);
    const current = db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(item.id);
    return { item: current ? hydrate(JSON.parse(String(current.data))) : item, change };
  }

  /** @param {string} conflictId @param {unknown} selectedValue @param {string} explanation @param {any} collaborator */
  function resolveConflict(conflictId, selectedValue, explanation, collaborator) {
    const row = db.prepare('SELECT * FROM installed_base_conflicts WHERE id = ?').get(conflictId);
    if (!row) throw new RequestError(404, 'El conflicto no existe.');
    const conflict = JSON.parse(String(row.data));
    if (row.status !== 'pending') throw new RequestError(409, 'Este conflicto ya fue resuelto.');
    const supported = conflict.values.some(/** @param {unknown} value */ value => JSON.stringify(value) === JSON.stringify(selectedValue));
    if (!supported) throw new RequestError(400, 'Selecciona uno de los valores respaldados por las observaciones.');
    const resolution = { value: selectedValue, explanation, author: collaborator, at: now().toISOString() };
    let identityItem;
    for (const itemId of conflict.itemIds) {
      const itemRow = db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(itemId);
      if (!itemRow) throw new RequestError(409, 'Uno de los equipos del conflicto ya no está disponible.');
      const item = hydrate(JSON.parse(String(itemRow.data))); const oldValue = item[conflict.field];
      identityItem = item;
      if (JSON.stringify(oldValue) === JSON.stringify(selectedValue)) continue;
      item[conflict.field] = selectedValue; item.fieldStates[conflict.field] = 'Reportado'; item.confirmations[conflict.field] = [];
      const change = { id: randomUUID(), hospitalId: item.hospitalId, itemId: item.id, kind: 'conflict-resolution', conflictId,
        field: conflict.field, oldValue, newValue: selectedValue, author: collaborator, at: resolution.at, reason: explanation };
      updateItem(item); recordChange(change);
    }
    const resolved = { ...conflict, status: 'resolved', resolution };
    db.prepare('UPDATE installed_base_conflicts SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), conflictId);
    if (identityItem) recalculateCorroboration(identityItem);
    return resolved;
  }

  /** Assess an item's own confidence for a given supporting-observation date, reusing the observation confidence model.
   * @param {any} item @param {string | null} capturedAt */
  function assessItem(item, capturedAt) {
    const hospitalRow = db.prepare('SELECT name, client FROM hospitals WHERE id = ?').get(item.hospitalId);
    const confirmedFields = Object.entries(item.fieldStates ?? {}).filter(([, state]) => state === 'Confirmado').map(([field]) => `equipment.0.${field}`);
    return assessObservation({
      originalText: '', reviewed: { client: hospitalRow?.client ?? null, hospital: hospitalRow?.name ?? null, area: null,
        equipment: [{ modality: item.modality, quantity: item.quantity, manufacturer: item.manufacturer, model: item.model, serial: item.serial, age: item.age }] },
      extracted: null, capturedAt: capturedAt ?? new Date(0).toISOString(), confirmedFields,
    }, now());
  }

  for (const row of db.prepare('SELECT data FROM observations ORDER BY rowid').all()) projectObservation(JSON.parse(String(row.data)));
  return { projectObservation, splitFromObservation, decideDuplicate, correct, resolveConflict, confirmedFieldsForObservation, present, assessItem };
}
