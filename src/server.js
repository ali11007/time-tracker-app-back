const { createApp } = require('./app');
const { initializeDatabase } = require('./db/init');
const { pool } = require('./db/pool');
const { env } = require('./config/env');

const start = async () => {
  await initializeDatabase();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Time tracker API listening on http://localhost:${env.port}/api`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down.`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

start().catch(async (error) => {
  console.error('Failed to start server.');
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
