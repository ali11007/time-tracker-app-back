const mapUser = (row) => ({
  id: String(row.id),
  email: row.email,
  username: row.username,
  name: row.name,
});

const mapTimeEntry = (row) => ({
  id: String(row.id),
  name: row.name,
  project: row.project,
  tags: Array.isArray(row.tags) ? row.tags : [],
  date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
  durationSeconds: Number(row.duration_seconds),
  type: row.type,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

module.exports = {
  mapUser,
  mapTimeEntry,
};
