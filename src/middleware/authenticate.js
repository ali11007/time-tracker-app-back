const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { pool } = require('../db/pool');
const { HttpError } = require('../utils/httpError');

const authenticate = async (req, _res, next) => {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication is required.'));
  }

  let payload;

  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Your session is invalid or expired.'));
  }

  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId)) {
    return next(new HttpError(401, 'Your session is invalid or expired.'));
  }

  try {
    const { rows } = await pool.query(
      `
        SELECT id, email, username, name, is_admin
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId],
    );

    if (!rows[0]) {
      return next(new HttpError(401, 'Your session is invalid or expired.'));
    }

    req.auth = {
      userId: Number(rows[0].id),
      email: rows[0].email,
      username: rows[0].username,
      name: rows[0].name,
      isAdmin: Boolean(rows[0].is_admin),
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireAdmin = (req, _res, next) => {
  if (!req.auth?.isAdmin) {
    return next(new HttpError(403, 'Admin access is required.'));
  }

  return next();
};

module.exports = {
  authenticate,
  requireAdmin,
};
