const { pool } = require('../db/pool');
const { createCatalogId } = require('../db/init');
const { HttpError } = require('./httpError');

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const mapRowsByNormalizedName = (rows) =>
  rows.reduce((accumulator, row) => {
    accumulator[row.normalized_name] = row;
    return accumulator;
  }, {});

const ensureTagsExist = async (tags) => {
  if (!Array.isArray(tags) || !tags.length) {
    return [];
  }

  const uniqueTags = [];
  const seen = new Set();

  for (const rawTag of tags) {
    const name = String(rawTag || '').trim();
    const normalizedName = normalizeName(name);

    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    uniqueTags.push({ id: createCatalogId(), name, normalizedName });
  }

  if (!uniqueTags.length) {
    return [];
  }

  const values = [];
  const placeholders = uniqueTags
    .map((tag, index) => {
      const offset = index * 3;
      values.push(tag.id, tag.name, tag.normalizedName);
      return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
    })
    .join(', ');

  await pool.query(
    `
      INSERT INTO tags (id, name, normalized_name)
      VALUES ${placeholders}
      ON CONFLICT (normalized_name)
      DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
    `,
    values,
  );

  return uniqueTags.map((tag) => tag.name);
};

const resolveProjectOrThrow = async (projectId) => {
  const { rows } = await pool.query(
    `
      SELECT id, name, normalized_name
      FROM projects
      WHERE id = $1
      LIMIT 1
    `,
    [projectId],
  );

  if (!rows[0]) {
    throw new HttpError(400, 'Select a valid project before saving the entry.');
  }

  return rows[0];
};

const renameTagReferences = async (previousNormalizedName, nextName) => {
  await pool.query(
    `
      UPDATE time_entries te
      SET
        tags = COALESCE(updated_tags.tags, '[]'::jsonb),
        updated_at = NOW()
      FROM (
        SELECT
          id,
          jsonb_agg(
            CASE
              WHEN LOWER(tag.value) = $1 THEN to_jsonb($2::text)
              ELSE to_jsonb(tag.value)
            END
          ) AS tags
        FROM time_entries
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag(value)
        GROUP BY id
      ) AS updated_tags
      WHERE te.id = updated_tags.id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(te.tags, '[]'::jsonb)) AS existing_tag(value)
          WHERE LOWER(existing_tag.value) = $1
        )
    `,
    [previousNormalizedName, nextName],
  );
};

const deleteTagReferences = async (normalizedName) => {
  await pool.query(
    `
      UPDATE time_entries te
      SET
        tags = COALESCE(updated_tags.tags, '[]'::jsonb),
        updated_at = NOW()
      FROM (
        SELECT
          id,
          jsonb_agg(to_jsonb(tag.value)) FILTER (WHERE LOWER(tag.value) <> $1) AS tags
        FROM time_entries
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag(value)
        GROUP BY id
      ) AS updated_tags
      WHERE te.id = updated_tags.id
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(te.tags, '[]'::jsonb)) AS existing_tag(value)
          WHERE LOWER(existing_tag.value) = $1
        )
    `,
    [normalizedName],
  );
};

const refreshProjectSnapshots = async (projectId, projectName) => {
  await pool.query(
    `
      UPDATE time_entries
      SET project = $2, updated_at = NOW()
      WHERE project_id = $1
    `,
    [projectId, projectName],
  );
};

module.exports = {
  normalizeName,
  mapRowsByNormalizedName,
  ensureTagsExist,
  resolveProjectOrThrow,
  renameTagReferences,
  deleteTagReferences,
  refreshProjectSnapshots,
};
