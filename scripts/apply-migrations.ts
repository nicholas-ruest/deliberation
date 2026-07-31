import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const migrations = (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort();
  for (const migration of migrations) {
    const sql = await readFile(`migrations/${migration}`, 'utf8');
    await pool.query(sql);
  }
  console.log(`Applied ${migrations.length} migrations.`);
} finally {
  await pool.end();
}
