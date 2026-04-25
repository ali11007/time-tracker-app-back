const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');
const { HttpError } = require('../utils/httpError');
const { mapTag } = require('../utils/serializers');
const { createTagSchema, updateTagSchema } = require('../utils/validators');
const { createCatalogId } = require('../db/init');
const { deleteTagReferences, normalizeName, renameTagReferences } = require('../utils/catalog');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, created_at, updated_at
        FROM tags
        ORDER BY LOWER(name) ASC, created_at DESC
      `,
    );

    res.json(rows.map(mapTag));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const payload = createTagSchema.parse(req.body);
    const normalizedName = normalizeName(payload.name);

    const { rows } = await pool.query(
      `
        INSERT INTO tags (id, name, normalized_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (normalized_name)
        DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = NOW()
        RETURNING id, name, created_at, updated_at
      `,
      [createCatalogId(), payload.name.trim(), normalizedName],
    );

    res.status(201).json(mapTag(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const payload = updateTagSchema.parse(req.body);
    const normalizedName = normalizeName(payload.name);

    const currentTag = await pool.query(
      `
        SELECT id, normalized_name
        FROM tags
        WHERE id = $1
        LIMIT 1
      `,
      [req.params.id],
    );

    if (!currentTag.rows[0]) {
      throw new HttpError(404, 'Tag not found.');
    }

    const existing = await pool.query(
      `
        SELECT 1
        FROM tags
        WHERE normalized_name = $1 AND id <> $2
        LIMIT 1
      `,
      [normalizedName, req.params.id],
    );

    if (existing.rowCount) {
      throw new HttpError(409, 'A tag with that name already exists.');
    }

    const { rows } = await pool.query(
      `
        UPDATE tags
        SET name = $2, normalized_name = $3, updated_at = NOW()
        WHERE id = $1
        RETURNING id, name, created_at, updated_at
      `,
      [req.params.id, payload.name.trim(), normalizedName],
    );

    await renameTagReferences(currentTag.rows[0].normalized_name, rows[0].name);
    res.json(mapTag(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await pool.query(
      `
        DELETE FROM tags
        WHERE id = $1
        RETURNING normalized_name
      `,
      [req.params.id],
    );

    if (!deleted.rows[0]) {
      throw new HttpError(404, 'Tag not found.');
    }

    await deleteTagReferences(deleted.rows[0].normalized_name);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  tagRoutes: router,
};
