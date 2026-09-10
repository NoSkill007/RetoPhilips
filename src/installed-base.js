import { randomUUID } from 'node:crypto';
import { RequestError } from './request-error.js';
import { normalize } from './observation-schema.js';

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
  /** @param {any} item */
  function hydrate(item) {
    const fieldStates = item.fieldStates ?? Object.fromEntries(equipmentFields.map(field => [field, item[field] === null ? 'Desconocido' : 'Reportado']));
    const confirmations = item.confirmations ?? Object.fromEntries(equipmentFields.map(field => [field, []]));
    const sourceProfileIds = item.sourceProfileIds ?? item.sourceObservationIds.flatMap(/** @param {string} observationId */ observationId => {
      const row = db.prepare('SELECT data FROM observations WHERE id = ?').get(observationId);
      return row ? [JSON.parse(String(row.data)).profile.id] : [];
    });
    return { ...item, sourceProfileIds: [...new Set(sourceProfileIds)], fieldStates, confirmations };
  }
  /** @param {any} item */
  function updateItem(item) { db.prepare('UPDATE installed_equipment SET data = ? WHERE id = ?').run(JSON.stringify(item), item.id); }
  /** @param {any} change */
  function recordChange(change) {
    db.prepare('INSERT INTO installed_base_changes VALUES (?, ?, ?, ?)').run(change.id, change.hospitalId, change.itemId, JSON.stringify(change));
  }

  /** @param {any} item */
  function detectConflicts(item) {
    if (!item.serial) return;
    const others = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ? AND id <> ?').all(item.hospitalId, item.id)
      .map(row => hydrate(JSON.parse(String(row.data))))
      .filter(other => other.serial && normalize(String(other.serial)) === normalize(String(item.serial)));
    for (const other of others) {
      for (const field of ['modality', 'quantity', 'manufacturer', 'model', 'age']) {
        if (other[field] === null || item[field] === null || normalize(String(other[field])) === normalize(String(item[field]))) continue;
        const itemIds = [other.id, item.id].sort(); const pairKey = `${itemIds.join(':')}:${field}`;
        const existing = db.prepare('SELECT id FROM installed_base_conflicts WHERE pair_key = ?').get(pairKey);
        const conflict = { id: existing?.id ?? randomUUID(), hospitalId: item.hospitalId, itemIds, field, values: [other[field], item[field]], status: 'pending',
          sourceObservationIds: [...new Set([...other.sourceObservationIds, ...item.sourceObservationIds])], items: [other, item], createdAt: now().toISOString(), resolution: null };
        db.prepare("INSERT INTO installed_base_conflicts VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(pair_key) DO UPDATE SET status = 'pending', data = excluded.data")
          .run(conflict.id, pairKey, itemIds[0], itemIds[1], item.hospitalId, field, conflict.status, JSON.stringify(conflict));
      }
    }
  }

  /** @param {any} item @param {any} observation */
  function applyCorroboration(item, observation) {
    if (!item.serial) return;
    const others = db.prepare('SELECT data FROM installed_equipment WHERE hospital_id = ? AND id <> ?').all(item.hospitalId, item.id)
      .map(row => hydrate(JSON.parse(String(row.data))))
      .filter(other => other.serial && normalize(String(other.serial)) === normalize(String(item.serial))
        && other.sourceProfileIds.some(/** @param {string} id */ id => id !== observation.profile.id));
    let current = hydrate(item);
    for (const other of others) {
      let changed = false;
      for (const field of equipmentFields) {
        if (current[field] === null || other[field] === null || normalize(String(current[field])) !== normalize(String(other[field]))) continue;
        const confirmation = { profileIds: [...new Set([...other.sourceProfileIds, observation.profile.id])],
          observationIds: [...new Set([...other.sourceObservationIds, observation.id])], at: now().toISOString() };
        current.fieldStates[field] = 'Confirmado'; other.fieldStates[field] = 'Confirmado';
        current.confirmations[field].push(confirmation); other.confirmations[field].push(confirmation); changed = true;
      }
      if (changed) updateItem(other);
    }
    updateItem(current);
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
    if (!sameSerial && (!modalityMatches || matchingFields.length < 3)) return null;
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
      });
      db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(item.id, item.hospitalId, JSON.stringify(item));
      db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(sourceKey);
      detectDuplicates(item);
      detectConflicts(item);
      applyCorroboration(item, observation);
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
    const group = JSON.parse(String(row.data));
    if (group.kind !== 'group' || group.hospitalId !== observation.hospitalId) throw new RequestError(400, 'Selecciona un grupo del mismo hospital.');
    if (!Number.isInteger(group.quantity) || group.quantity < 1) throw new RequestError(400, 'El grupo no tiene una cantidad conocida que pueda separarse.');
    if (group.modality && identifying.modality && group.modality !== identifying.modality) throw new RequestError(400, 'La modalidad de la unidad no coincide con la del grupo.');

    const at = now().toISOString();
    const split = { observationId: observation.id, profile: observation.profile, at };
    const individual = hydrate({
      id: randomUUID(), hospitalId: group.hospitalId, kind: 'individual', quantity: 1,
      modality: identifying.modality ?? group.modality, manufacturer: identifying.manufacturer ?? group.manufacturer,
      model: identifying.model ?? group.model, serial: identifying.serial, age: identifying.age ?? group.age,
      sourceObservationIds: [...new Set([...group.sourceObservationIds, observation.id])],
      sourceProfileIds: [...new Set([...(group.sourceProfileIds ?? []), observation.profile.id])],
      evidenceIds: [...new Set([...(group.evidenceIds ?? []), ...(observation.evidenceIds ?? [])])], splitHistory: [...group.splitHistory, split],
    });
    db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(`${observation.id}:0`);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(individual.id, individual.hospitalId, JSON.stringify(individual));
    detectDuplicates(individual);
    detectConflicts(individual);
    applyCorroboration(individual, observation);
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
    });
    for (const field of equipmentFields) {
      if (originals.some(/** @param {any} item */ item => item.fieldStates[field] === 'Confirmado')) consolidated.fieldStates[field] = 'Confirmado';
      consolidated.confirmations[field] = originals.flatMap(/** @param {any} item */ item => item.confirmations[field] ?? []);
    }
    db.prepare('DELETE FROM installed_equipment WHERE id IN (?, ?)').run(candidate.itemIds[0], candidate.itemIds[1]);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(consolidated.id, consolidated.hospitalId, JSON.stringify(consolidated));
    for (const difference of candidate.conflictingFields) {
      const pairKey = `${candidate.itemIds.join(':')}:${difference.field}`;
      const existingConflict = db.prepare('SELECT data FROM installed_base_conflicts WHERE pair_key = ?').get(pairKey);
      const conflict = existingConflict ? JSON.parse(String(existingConflict.data)) : {
        id: randomUUID(), hospitalId: candidate.hospitalId, field: difference.field,
        values: [difference.left, difference.right], status: 'pending', sourceObservationIds: consolidated.sourceObservationIds,
        items: originals, createdAt: now().toISOString(), resolution: null,
      };
      conflict.itemIds = [consolidated.id]; conflict.currentItemId = consolidated.id; conflict.status = 'pending'; conflict.resolution = null;
      if (existingConflict) db.prepare("UPDATE installed_base_conflicts SET item_a = ?, item_b = ?, status = 'pending', data = ? WHERE pair_key = ?")
        .run(consolidated.id, consolidated.id, JSON.stringify(conflict), pairKey);
      else db.prepare('INSERT INTO installed_base_conflicts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(conflict.id, pairKey, consolidated.id, consolidated.id, candidate.hospitalId, difference.field, conflict.status, JSON.stringify(conflict));
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
    updateItem(item); recordChange(change); detectConflicts(item);
    return { item, change };
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
    for (const itemId of conflict.itemIds) {
      const itemRow = db.prepare('SELECT data FROM installed_equipment WHERE id = ?').get(itemId);
      if (!itemRow) throw new RequestError(409, 'Uno de los equipos del conflicto ya no está disponible.');
      const item = hydrate(JSON.parse(String(itemRow.data))); const oldValue = item[conflict.field];
      if (JSON.stringify(oldValue) === JSON.stringify(selectedValue)) continue;
      item[conflict.field] = selectedValue; item.fieldStates[conflict.field] = 'Reportado'; item.confirmations[conflict.field] = [];
      const change = { id: randomUUID(), hospitalId: item.hospitalId, itemId: item.id, kind: 'conflict-resolution', conflictId,
        field: conflict.field, oldValue, newValue: selectedValue, author: collaborator, at: resolution.at, reason: explanation };
      updateItem(item); recordChange(change);
    }
    const resolved = { ...conflict, status: 'resolved', resolution };
    db.prepare('UPDATE installed_base_conflicts SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), conflictId);
    return resolved;
  }

  for (const row of db.prepare('SELECT data FROM observations ORDER BY rowid').all()) projectObservation(JSON.parse(String(row.data)));
  return { projectObservation, splitFromObservation, decideDuplicate, correct, resolveConflict, confirmedFieldsForObservation, present };
}
