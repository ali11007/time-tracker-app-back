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

const ensureProjectsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT projects_user_normalized_name_key UNIQUE (user_id, normalized_name)
    );
  `);
};

const ensureTagsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tags_user_normalized_name_key UNIQUE (user_id, normalized_name)
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

const normalizeNameExpression = "LOWER(BTRIM(name))";

const migrateProjectsAndTags = async () => {
  await pool.query(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS project_id UUID`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS normalized_name TEXT`);
  await pool.query(`ALTER TABLE tags ADD COLUMN IF NOT EXISTS normalized_name TEXT`);

  await pool.query(`
    UPDATE projects
    SET normalized_name = ${normalizeNameExpression}
    WHERE normalized_name IS NULL OR normalized_name = ''
  `);
  await pool.query(`
    UPDATE tags
    SET normalized_name = ${normalizeNameExpression}
    WHERE normalized_name IS NULL OR normalized_name = ''
  `);

  await pool.query(`
    INSERT INTO projects (user_id, name, normalized_name)
    SELECT DISTINCT te.user_id, BTRIM(te.project), LOWER(BTRIM(te.project))
    FROM time_entries te
    WHERE BTRIM(COALESCE(te.project, '')) <> ''
    ON CONFLICT (user_id, normalized_name) DO NOTHING
  `);

  await pool.query(`
    UPDATE time_entries te
    SET project_id = p.id
    FROM projects p
    WHERE te.user_id = p.user_id
      AND te.project_id IS NULL
      AND LOWER(BTRIM(te.project)) = p.normalized_name
  `);

  await pool.query(`
    INSERT INTO tags (user_id, name, normalized_name)
    SELECT DISTINCT te.user_id, tag.value, LOWER(tag.value)
    FROM time_entries te
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(te.tags, '[]'::jsonb)) AS tag(value)
    WHERE BTRIM(tag.value) <> ''
    ON CONFLICT (user_id, normalized_name) DO NOTHING
  `);

  await pool.query(`
    ALTER TABLE time_entries
    DROP CONSTRAINT IF EXISTS time_entries_project_id_fkey
  `);
  await pool.query(`
    ALTER TABLE time_entries
    ADD CONSTRAINT time_entries_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
  `);

  const unresolvedProjects = await pool.query(`
    SELECT 1
    FROM time_entries
    WHERE project_id IS NULL
    LIMIT 1
  `);

  if (!unresolvedProjects.rowCount) {
    await pool.query(`ALTER TABLE time_entries ALTER COLUMN project_id SET NOT NULL`);
  }
};

const ensureCatalogIndexes = async () => {
  await pool.query(
    'CREATE INDEX IF NOT EXISTS projects_user_updated_idx ON projects (user_id, updated_at DESC, name ASC);',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS tags_user_updated_idx ON tags (user_id, updated_at DESC, name ASC);',
  );
};

const ensureTimeEntryIndexes = async () => {
  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_start_idx ON time_entries (user_id, start_at DESC, created_at DESC);',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_active_idx ON time_entries (user_id, end_at) WHERE end_at IS NULL;',
  );
  await pool.query(
    'CREATE INDEX IF NOT EXISTS time_entries_user_project_idx ON time_entries (user_id, project_id, start_at DESC);',
  );
};

const createTables = async () => {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await ensureUsersTable();
  await ensureProjectsTable();
  await ensureTagsTable();
  await ensureTimeEntriesTable();
  await migrateLegacyTimeEntries();
  await migrateProjectsAndTags();
  await ensureCatalogIndexes();
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
const createCatalogId = () => crypto.randomUUID();

module.exports = {
  initializeDatabase,
  createTimeEntryId,
  createCatalogId,
};
