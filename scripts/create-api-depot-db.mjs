#!/usr/bin/env node
/**
 * One-off: create api_depot database on the Postgres server.
 * Run with: railway run -s Postgres node scripts/create-api-depot-db.mjs
 * (Or set DATABASE_URL and run: node scripts/create-api-depot-db.mjs)
 */
import pg from 'pg';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('Set DATABASE_URL or POSTGRES_URL');
  process.exit(1);
}

// Connect to existing DB on the server (e.g. railway) to run CREATE DATABASE
const client = new pg.Client({ connectionString: url });

async function main() {
  try {
    await client.connect();
    await client.query('CREATE DATABASE api_depot');
    console.log('Created database api_depot');
  } catch (err) {
    if (err.code === '42P04') {
      console.log('Database api_depot already exists');
    } else {
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
