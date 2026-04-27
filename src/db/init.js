const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
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
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const ensureSchemaMigrationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
};

const runMigrations = async () => {
  await ensureSchemaMigrationsTable();

  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const fileName of migrationFiles) {
    const version = fileName.replace(/\.sql$/, '');

    await pool.query('BEGIN');
    try {
      const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1', [version]);

      if (!applied.rowCount) {
        const sql = await fs.readFile(path.join(migrationsDir, fileName), 'utf8');
        await pool.query(sql);
        await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      }

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
};

const ensureProjectsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT projects_normalized_name_key UNIQUE (normalized_name)
    );
  `);
};

const ensureTagsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tags_normalized_name_key UNIQUE (normalized_name)
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

const normalizeNameExpression = 'LOWER(BTRIM(name))';

const hasColumn = async (tableName, columnName) => {
  const result = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
      LIMIT 1
    `,
    [tableName, columnName],
  );

  return Boolean(result.rowCount);
};

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

  const projectsHaveUserId = await hasColumn('projects', 'user_id');
  const tagsHaveUserId = await hasColumn('tags', 'user_id');

  if (projectsHaveUserId) {
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
      WITH canonical_projects AS (
        SELECT DISTINCT ON (normalized_name) id, normalized_name
        FROM projects
        WHERE normalized_name IS NOT NULL AND normalized_name <> ''
        ORDER BY normalized_name, updated_at DESC, created_at DESC, id ASC
      )
      UPDATE time_entries te
      SET project_id = canonical_projects.id
      FROM projects p
      JOIN canonical_projects ON canonical_projects.normalized_name = p.normalized_name
      WHERE te.project_id = p.id
        AND te.project_id IS DISTINCT FROM canonical_projects.id
    `);

    await pool.query(`
      WITH canonical_projects AS (
        SELECT DISTINCT ON (normalized_name) id, normalized_name
        FROM projects
        WHERE normalized_name IS NOT NULL AND normalized_name <> ''
        ORDER BY normalized_name, updated_at DESC, created_at DESC, id ASC
      )
      DELETE FROM projects p
      USING canonical_projects
      WHERE p.normalized_name = canonical_projects.normalized_name
        AND p.id <> canonical_projects.id
    `);

    await pool.query(`ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_normalized_name_key`);
    await pool.query(`ALTER TABLE projects DROP COLUMN IF EXISTS user_id`);
  }

  if (tagsHaveUserId) {
    await pool.query(`
      INSERT INTO tags (user_id, name, normalized_name)
      SELECT DISTINCT te.user_id, tag.value, LOWER(tag.value)
      FROM time_entries te
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(te.tags, '[]'::jsonb)) AS tag(value)
      WHERE BTRIM(tag.value) <> ''
      ON CONFLICT (user_id, normalized_name) DO NOTHING
    `);

    await pool.query(`
      WITH canonical_tags AS (
        SELECT DISTINCT ON (normalized_name) id, normalized_name
        FROM tags
        WHERE normalized_name IS NOT NULL AND normalized_name <> ''
        ORDER BY normalized_name, updated_at DESC, created_at DESC, id ASC
      )
      DELETE FROM tags t
      USING canonical_tags
      WHERE t.normalized_name = canonical_tags.normalized_name
        AND t.id <> canonical_tags.id
    `);

    await pool.query(`ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_user_normalized_name_key`);
    await pool.query(`ALTER TABLE tags DROP COLUMN IF EXISTS user_id`);
  }

  await pool.query(`ALTER TABLE projects ALTER COLUMN normalized_name SET NOT NULL`);
  await pool.query(`ALTER TABLE tags ALTER COLUMN normalized_name SET NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS projects_normalized_name_key ON projects (normalized_name)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tags_normalized_name_key ON tags (normalized_name)`);

  await pool.query(`
    INSERT INTO projects (name, normalized_name)
    SELECT DISTINCT ON (LOWER(BTRIM(te.project))) BTRIM(te.project), LOWER(BTRIM(te.project))
    FROM time_entries te
    WHERE BTRIM(COALESCE(te.project, '')) <> ''
    ORDER BY LOWER(BTRIM(te.project)), te.updated_at DESC, te.created_at DESC
    ON CONFLICT (normalized_name) DO NOTHING
  `);

  await pool.query(`
    UPDATE time_entries te
    SET project_id = p.id
    FROM projects p
    WHERE te.project_id IS NULL
      AND LOWER(BTRIM(te.project)) = p.normalized_name
  `);

  await pool.query(`
    UPDATE time_entries te
    SET project = p.name, updated_at = NOW()
    FROM projects p
    WHERE te.project_id = p.id
      AND te.project IS DISTINCT FROM p.name
  `);

  await pool.query(`
    INSERT INTO tags (name, normalized_name)
    SELECT DISTINCT ON (LOWER(BTRIM(tag.value))) BTRIM(tag.value), LOWER(BTRIM(tag.value))
    FROM time_entries te
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(te.tags, '[]'::jsonb)) AS tag(value)
    WHERE BTRIM(tag.value) <> ''
    ORDER BY LOWER(BTRIM(tag.value)), te.updated_at DESC, te.created_at DESC
    ON CONFLICT (normalized_name) DO NOTHING
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
  await pool.query('CREATE INDEX IF NOT EXISTS projects_updated_idx ON projects (updated_at DESC, name ASC);');
  await pool.query('CREATE INDEX IF NOT EXISTS tags_updated_idx ON tags (updated_at DESC, name ASC);');
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
  await runMigrations();
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
