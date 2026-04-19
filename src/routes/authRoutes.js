const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');
const { env } = require('../config/env');
const { loginSchema } = require('../utils/validators');
const { HttpError } = require('../utils/httpError');
const { mapUser } = require('../utils/serializers');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { emailOrUsername, password } = loginSchema.parse(req.body);
    const identifier = emailOrUsername.trim().toLowerCase();

    const { rows } = await pool.query(
      `
        SELECT id, email, username, password_hash, name
        FROM users
        WHERE email = $1 OR username = $1
        LIMIT 1
      `,
      [identifier],
    );

    const user = rows[0];

    if (!user) {
      throw new HttpError(401, 'Invalid email/username or password.');
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      throw new HttpError(401, 'Invalid email/username or password.');
    }

    const token = jwt.sign(
      {
        email: user.email,
        username: user.username,
        name: user.name,
      },
      env.jwtSecret,
      {
        subject: String(user.id),
        expiresIn: env.jwtExpiresIn,
      },
    );

    res.json({
      token,
      user: mapUser(user),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  authRoutes: router,
};
