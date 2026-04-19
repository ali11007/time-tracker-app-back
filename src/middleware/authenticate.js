const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { HttpError } = require('../utils/httpError');

const authenticate = (req, _res, next) => {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication is required.'));
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.auth = {
      userId: Number(payload.sub),
      email: payload.email,
      username: payload.username,
      name: payload.name,
    };
    return next();
  } catch {
    return next(new HttpError(401, 'Your session is invalid or expired.'));
  }
};

module.exports = {
  authenticate,
};
