'use strict';

const FIELDS = ['name', 'designation', 'qualification', 'email', 'office', 'hours', 'phone', 'courses', 'link', 'bio'];

/**
 * Data layer. `pool` is anything with a pg-style `query(text, params)`.
 * Areas are stored as a JSON string so the same SQL runs on any Postgres.
 */
function createDb(pool) {
  const toRecord = (r) => {
    let areas = [];
    try { areas = JSON.parse(r.areas || '[]'); } catch (e) { areas = []; }
    const o = { id: Number(r.id), areas };
    FIELDS.forEach((f) => { o[f] = r[f] || ''; });
    return o;
  };

  return {
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS faculty (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          designation TEXT NOT NULL DEFAULT '',
          qualification TEXT NOT NULL DEFAULT '',
          areas TEXT NOT NULL DEFAULT '[]',
          email TEXT NOT NULL DEFAULT '',
          office TEXT NOT NULL DEFAULT '',
          hours TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          courses TEXT NOT NULL DEFAULT '',
          link TEXT NOT NULL DEFAULT '',
          bio TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL DEFAULT ''
        )`);
    },

    async list() {
      const { rows } = await pool.query('SELECT * FROM faculty ORDER BY name');
      return rows.map(toRecord);
    },

    async updatedAt() {
      const { rows } = await pool.query('SELECT MAX(updated_at) AS m FROM faculty');
      const m = rows[0] && rows[0].m;
      return m ? new Date(m).toISOString() : '';
    },

    async insert(o) {
      const { rows } = await pool.query(
        `INSERT INTO faculty (name, designation, qualification, areas, email, office, hours, phone, courses, link, bio)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [o.name, o.designation, o.qualification, JSON.stringify(o.areas), o.email, o.office, o.hours, o.phone, o.courses, o.link, o.bio]);
      return toRecord(rows[0]);
    },

    async update(id, o) {
      const { rows } = await pool.query(
        `UPDATE faculty SET name=$1, designation=$2, qualification=$3, areas=$4, email=$5, office=$6,
           hours=$7, phone=$8, courses=$9, link=$10, bio=$11, updated_at=now()
         WHERE id=$12 RETURNING *`,
        [o.name, o.designation, o.qualification, JSON.stringify(o.areas), o.email, o.office, o.hours, o.phone, o.courses, o.link, o.bio, id]);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async remove(id) {
      const { rows } = await pool.query('DELETE FROM faculty WHERE id=$1 RETURNING id', [id]);
      return rows.length > 0;
    },

    async getSettings() {
      const { rows } = await pool.query('SELECT key, value FROM settings');
      const s = { department: 'Department of Computer Science', institution: '' };
      rows.forEach((r) => { if (r.key in s) s[r.key] = r.value; });
      return s;
    },

    async setSetting(key, value) {
      const { rows } = await pool.query('SELECT key FROM settings WHERE key=$1', [key]);
      if (rows.length) await pool.query('UPDATE settings SET value=$1 WHERE key=$2', [value, key]);
      else await pool.query('INSERT INTO settings (key, value) VALUES ($1,$2)', [key, value]);
    },
  };
}

module.exports = { createDb, FIELDS };
