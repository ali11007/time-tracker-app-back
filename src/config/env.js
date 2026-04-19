const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toNumber(process.env.PORT, 3000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/time_tracker_app',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  defaultUser: {
    email: process.env.DEFAULT_USER_EMAIL || 'demo@example.com',
    username: process.env.DEFAULT_USER_USERNAME || 'demo',
    password: process.env.DEFAULT_USER_PASSWORD || 'password123',
    name: process.env.DEFAULT_USER_NAME || 'Demo User',
  },
};

module.exports = {
  env,
};
