import { randomUUID } from 'node:crypto';
import { RequestError } from './request-error.js';

/** @param {import('node:sqlite').DatabaseSync} db @param {() => Date} now */
export function installedBase(db, now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS installed_equipment (id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS installed_base_sources (source_key TEXT PRIMARY KEY);
  `);

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
        sourceObservationIds: [observation.id], splitHistory: [],
      };
      db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(item.id, item.hospitalId, JSON.stringify(item));
      db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(sourceKey);
    });
  }

  /** @param {string} hospitalId */
  function present(hospitalId) {
    const items = db.prepare("SELECT data FROM installed_equipment WHERE hospital_id = ? ORDER BY CASE WHEN json_extract(data, '$.kind') = 'group' THEN 0 ELSE 1 END, rowid").all(hospitalId)
      .map(row => JSON.parse(String(row.data)));
    const total = items.reduce((sum, item) => sum + (Number.isInteger(item.quantity) ? item.quantity : 0), 0);
    return { total, items };
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
      sourceObservationIds: [...new Set([...group.sourceObservationIds, observation.id])], splitHistory: [...group.splitHistory, split],
    };
    db.prepare('INSERT INTO installed_base_sources VALUES (?)').run(`${observation.id}:0`);
    db.prepare('INSERT INTO installed_equipment VALUES (?, ?, ?)').run(individual.id, individual.hospitalId, JSON.stringify(individual));
    if (group.quantity === 1) db.prepare('DELETE FROM installed_equipment WHERE id = ?').run(group.id);
    else {
      const remainder = { ...group, quantity: group.quantity - 1, splitHistory: [...group.splitHistory, split] };
      db.prepare('UPDATE installed_equipment SET data = ? WHERE id = ?').run(JSON.stringify(remainder), group.id);
    }
  }

  for (const row of db.prepare('SELECT data FROM observations ORDER BY rowid').all()) projectObservation(JSON.parse(String(row.data)));
  return { projectObservation, splitFromObservation, present };
}
