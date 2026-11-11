// Minimal forward-only migrator: applies src/migrations/*.sql in name order,
// each in its own transaction, recording them in schema_migrations.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, tx, type Db } from './db.ts';

const DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );
  const applied: string[] = [];
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(DIR, file), 'utf8');
    await tx(db, async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    applied.push(file);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createPool(process.env.DATABASE_URL ?? 'postgres:///pls_studio');
  migrate(db)
    .then((a) => {
      console.log(a.length ? `applied: ${a.join(', ')}` : 'up to date');
      return db.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
