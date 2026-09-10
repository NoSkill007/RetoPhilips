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
  `);

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
      const item = {
        id: randomUUID(), hospitalId: observation.hospitalId, kind, quantity,
        modality: equipment.modality, manufacturer: equipment.manufacturer, model: equipment.model,
        serial: kind === 'individual' ? equipment.serial : null, age: equipment.age,
        sourceObservationIds: [observation.id], evidenceIds: observation.evidenceIds ?? [], splitHistory: [],
      };
      db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(item.id, item.hospitalId, JSON.stringify(item));
      db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(sourceKey);
      detectDuplicates(item);
    });
  }

  /** @param {string} hospitalId */
  function present(hospitalId) {
    const items = db.prepare("SELECT data FROM installed_equipment WHERE hospital_id = ? ORDER BY CASE WHEN json_extract(data, '$.kind') = 'group' THEN 0 ELSE 1 END, rowid").all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    const total = items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) ? item.quantity : 0), 0);
    const duplicateCandidates = db.prepare("SELECT data FROM duplicate_candidates WHERE hospital_id = ? AND status = 'pending' ORDER BY rowid").all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    return { total, items, duplicateCandidates };
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
    const individual = {
      id: randomUUID(), hospitalId: group.hospitalId, kind: 'individual', quantity: 1,
      modality: identifying.modality ?? group.modality, manufacturer: identifying.manufacturer ?? group.manufacturer,
      model: identifying.model ?? group.model, serial: identifying.serial, age: identifying.age ?? group.age,
      sourceObservationIds: [...new Set([...group.sourceObservationIds, observation.id])],
      evidenceIds: [...new Set([...(group.evidenceIds ?? []), ...(observation.evidenceIds ?? [])])], splitHistory: [...group.splitHistory, split],
    };
    db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(`${observation.id}:0`);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(individual.id, individual.hospitalId, JSON.stringify(individual));
    detectDuplicates(individual);
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
    const originals = records.map(/** @param {any} record */ record => JSON.parse(String(record.data)));
    const [left, right] = originals;
    /** @param {string} field */
    const value = (field) => left[field] ?? right[field] ?? null;
    const quantities = originals.map(/** @param {any} item */ item => item.quantity).filter(Number.isInteger);
    const consolidated = {
      id: randomUUID(), hospitalId: candidate.hospitalId, kind: 'consolidated', quantity: quantities.length ? Math.max(...quantities) : null,
      modality: value('modality'), manufacturer: value('manufacturer'), model: value('model'), serial: value('serial'), age: value('age'),
      sourceObservationIds: [...new Set(originals.flatMap(/** @param {any} item */ item => item.sourceObservationIds))],
      evidenceIds: [...new Set(originals.flatMap(/** @param {any} item */ item => item.evidenceIds ?? []))],
      splitHistory: originals.flatMap(/** @param {any} item */ item => item.splitHistory ?? []), consolidation: { originals, decision },
    };
    db.prepare('DELETE FROM installed_equipment WHERE id IN (?, ?)').run(candidate.itemIds[0], candidate.itemIds[1]);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(consolidated.id, consolidated.hospitalId, JSON.stringify(consolidated));
    db.prepare("UPDATE duplicate_candidates SET status = 'superseded' WHERE status = 'pending' AND (item_a IN (?, ?) OR item_b IN (?, ?))")
      .run(candidate.itemIds[0], candidate.itemIds[1], candidate.itemIds[0], candidate.itemIds[1]);
    const resolved = { ...candidate, status: 'consolidated', decision, consolidatedItemId: consolidated.id };
    db.prepare('UPDATE duplicate_candidates SET status = ?, data = ? WHERE id = ?').run(resolved.status, JSON.stringify(resolved), candidateId);
    return resolved;
  }

  for (const row of db.prepare('SELECT data FROM observations ORDER BY rowid').all()) projectObservation(JSON.parse(String(row.data)));
  return { projectObservation, splitFromObservation, decideDuplicate, present };
}
