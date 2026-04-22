const express = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');
const { HttpError } = require('../utils/httpError');
const { mapProject } = require('../utils/serializers');
const { createProjectSchema, updateProjectSchema } = require('../utils/validators');
const { createCatalogId } = require('../db/init');
const { normalizeName, refreshProjectSnapshots } = require('../utils/catalog');

const router = express.Router();

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
        SELECT id, name, created_at, updated_at
        FROM projects
        WHERE user_id = $1
        ORDER BY LOWER(name) ASC, created_at DESC
      `,
      [req.auth.userId],
    );

    res.json(rows.map(mapProject));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const payload = createProjectSchema.parse(req.body);
    const normalizedName = normalizeName(payload.name);

    const { rows } = await pool.query(
      `
        INSERT INTO projects (id, user_id, name, normalized_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, normalized_name)
        DO UPDATE SET
          name = EXCLUDED.name,
          updated_at = NOW()
        RETURNING id, name, created_at, updated_at
      `,
      [createCatalogId(), req.auth.userId, payload.name.trim(), normalizedName],
    );

    await refreshProjectSnapshots(req.auth.userId, rows[0].id, rows[0].name);
    res.status(201).json(mapProject(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const payload = updateProjectSchema.parse(req.body);
    const normalizedName = normalizeName(payload.name);

    const existing = await pool.query(
      `
        SELECT id
        FROM projects
        WHERE user_id = $1 AND normalized_name = $2 AND id <> $3
        LIMIT 1
      `,
      [req.auth.userId, normalizedName, req.params.id],
    );

    if (existing.rowCount) {
      throw new HttpError(409, 'A project with that name already exists.');
    }

    const { rows } = await pool.query(
      `
        UPDATE projects
        SET name = $3, normalized_name = $4, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, name, created_at, updated_at
      `,
      [req.params.id, req.auth.userId, payload.name.trim(), normalizedName],
    );

    if (!rows[0]) {
      throw new HttpError(404, 'Project not found.');
    }

    await refreshProjectSnapshots(req.auth.userId, rows[0].id, rows[0].name);
    res.json(mapProject(rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const usage = await pool.query(
      'SELECT 1 FROM time_entries WHERE user_id = $1 AND project_id = $2 LIMIT 1',
      [req.auth.userId, req.params.id],
    );

    if (usage.rowCount) {
      throw new HttpError(409, 'This project is still used by existing time entries.');
    }

    const { rowCount } = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND user_id = $2',
      [req.params.id, req.auth.userId],
    );

    if (!rowCount) {
      throw new HttpError(404, 'Project not found.');
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  projectRoutes: router,
};
