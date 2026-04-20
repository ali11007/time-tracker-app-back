const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const { env } = require('../config/env');

const ensureUsersTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const ensureTimeEntriesTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id UUID PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      project TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      start_at TIMESTAMPTZ NOT NULL,
      end_at TIMESTAMPTZ,
      type TEXT NOT NULL CHECK (type IN ('manual', 'timer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT time_entries_end_after_start CHECK (end_at IS NULL OR end_at > start_at)
    );
  `);
};

const migrateLegacyTimeEntries = async () => {
  const hasLegacyId = await pool.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'time_entries' AND column_name = 'id' AND data_type = 'bigint'
    LIMIT 1
  `);

  if (!hasLegacyId.rowCount) {
    await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ`);
    return;
  }

  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS id_v2 UUID`);

  await pool.query(`
    UPDATE time_entries
    SET
      start_at = COALESCE(start_at, date::timestamptz),
      end_at = COALESCE(end_at, date::timestamptz + make_interval(secs => duration_seconds)),
      id_v2 = COALESCE(id_v2, gen_random_uuid())
  `);

  await pool.query(`ALTER TABLE time_entries ALTER COLUMN start_at SET NOT NULL`);

  await pool.query(`ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_pkey`);
  await pool.query(`ALTER TABLE time_entries DROP COLUMN IF EXISTS id`);
  await pool.query(`ALTER TABLE time_entries RENAME COLUMN id_v2 TO id`);
  await pool.query(`ALTER TABLE time_entries ADD PRIMARY KEY (id)`);
  await pool.query(`ALTER TABLE time_entries DROP COLUMN IF EXISTS date`);
  await pool.query(`ALTER TABLE time_entries DROP COLUMN IF EXISTS duration_seconds`);
  await pool.query(`ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_end_after_start`);
  await pool.query(
    `ALTER TABLE time_entries ADD CONSTRAINT time_entries_end_after_start CHECK (end_at IS NULL OR end_at > start_at)`,
  );
};

const ensureTimeEntryIndexes = async () => {
  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_start_idx ON time_entries (user_id, start_at DESC, created_at DESC);',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_active_idx ON time_entries (user_id, end_at) WHERE end_at IS NULL;',
  );
};

const createTables = async () => {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await ensureUsersTable();
  await ensureTimeEntriesTable();
  await migrateLegacyTimeEntries();
  await ensureTimeEntryIndexes();
};

const ensureDefaultUser = async () => {
  const { email, username, password, name } = env.defaultUser;
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(
    `
      INSERT INTO users (email, username, password_hash, name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email)
      DO UPDATE SET
        username = EXCLUDED.username,
        name = EXCLUDED.name,
        password_hash = EXCLUDED.password_hash,
        updated_at = NOW()
    `,
    [email.toLowerCase(), username.toLowerCase(), passwordHash, name],
  );
};

const initializeDatabase = async () => {
  await createTables();
  await ensureDefaultUser();
};

const createTimeEntryId = () => crypto.randomUUID();

module.exports = {
  initializeDatabase,
  createTimeEntryId,
};
