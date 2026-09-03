const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

async function run() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://ripspricex:ripspricex@127.0.0.1:5433/ripspricex_dev';
  const pool = new Pool({ connectionString: databaseUrl });
  const dir = path.resolve(__dirname, '../../migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (rows.length) {
      console.log(`skip ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`apply ${file}`);
    // One dedicated connection for the whole migration: pool.query() can hand
    // out a different client per statement, which would let the DDL commit
    // while the schema_migrations row rolls back (or the reverse).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('Migrations complete');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
