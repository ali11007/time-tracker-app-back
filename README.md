# Time Tracker App Backend

Express + PostgreSQL backend for the frontend in `../time-tracker-app-front`.

## Features

- JWT login with email or username
- Protected CRUD endpoints for time entries
- CSV and JSON export endpoints with search filtering
- Automatic table creation on startup
- Seeded demo user for local development

## Environment

Create a `.env` file in `time-tracker-app-back/` if you want to override defaults:

```bash
PORT=3000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/time_tracker_app
JWT_SECRET=super-secret-value
JWT_EXPIRES_IN=7d
DEFAULT_USER_EMAIL=demo@example.com
DEFAULT_USER_USERNAME=demo
DEFAULT_USER_PASSWORD=password123
DEFAULT_USER_NAME=Demo User
```

## API

Base URL: `http://localhost:3000/api`

- `POST /auth/login`
- `GET /time-entries`
- `POST /time-entries`
- `PUT /time-entries/:id`
- `DELETE /time-entries/:id`
- `GET /time-entries/export/json?search=...`
- `GET /time-entries/export/csv?search=...`
- `GET /health`

`POST /auth/login` expects:

```json
{
  "emailOrUsername": "demo",
  "password": "password123"
}
```

The login response returns a JWT plus a `user` object that matches the frontend session handling.

## Run

```bash
npm start
```

For local development with auto-reload:

```bash
npm run dev
```

## Notes

- The server creates `users` and `time_entries` tables automatically.
- A demo user is seeded on every start so the frontend login works immediately.
- You need a reachable PostgreSQL database for the API to boot.
