const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const { authRoutes } = require('./routes/authRoutes');
const { timeEntryRoutes } = require('./routes/timeEntryRoutes');
const { projectRoutes } = require('./routes/projectRoutes');
const { tagRoutes } = require('./routes/tagRoutes');
const { errorHandler } = require('./middleware/errorHandler');

const createApp = () => {
  const app = express();

  app.use(
    cors({
      origin: env.corsOrigin,
    }),
  );
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/time-entries', timeEntryRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/tags', tagRoutes);

  app.use((_req, res) => {
    res.status(404).json({ message: 'Route not found.' });
  });

  app.use(errorHandler);

  return app;
};

module.exports = {
  createApp,
};
