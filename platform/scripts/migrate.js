'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {Client} = require('pg');

async function migrate({databaseUrl = process.env.QSESSION_DATABASE_URL || '', directory = path.join(__dirname, '..', 'db')} = {}) {
  if (!databaseUrl) {
    console.log('QSESSION_DATABASE_URL no está configurada; se omiten migraciones PostgreSQL.');
    return [];
  }
  const client = new Client({connectionString: databaseUrl});
  await client.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('qsession_schema_migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS qsession_schema_migrations (
        name TEXT PRIMARY KEY,
        sha256 CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const files = fs.readdirSync(directory).filter(name => /^\d+-.+\.sql$/.test(name)).sort();
    for (const name of files) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8');
      const sha256 = crypto.createHash('sha256').update(sql).digest('hex');
      const existing = await client.query('SELECT sha256 FROM qsession_schema_migrations WHERE name = $1', [name]);
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== sha256) throw new Error(`La migración aplicada ${name} cambió; crea una migración nueva`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO qsession_schema_migrations (name, sha256) VALUES ($1, $2)', [name, sha256]);
      applied.push(name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('qsession_schema_migrations'))").catch(() => undefined);
    await client.end();
  }
  if (applied.length) console.log(`Migraciones aplicadas: ${applied.join(', ')}`);
  else console.log('PostgreSQL ya está actualizado.');
  return applied;
}

if (require.main === module) {
  migrate().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {migrate};
