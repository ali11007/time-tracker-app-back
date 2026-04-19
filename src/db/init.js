const bcrypt = require('bcryptjs');
const { pool } = require('./pool');
const { env } = require('../config/env');

const createTables = async () => {
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      project TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      date DATE NOT NULL,
      duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 60),
      type TEXT NOT NULL CHECK (type IN ('manual', 'timer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_date_idx ON time_entries (user_id, date DESC, created_at DESC);',
  );
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

module.exports = {
  initializeDatabase,
};
