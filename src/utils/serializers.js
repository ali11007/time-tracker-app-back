const calculateDurationSeconds = (row) => {
  const startAt = row.start_at ? new Date(row.start_at).getTime() : NaN;
  const endAt = row.end_at ? new Date(row.end_at).getTime() : NaN;

  if (!Number.isFinite(startAt)) {
    return 0;
  }

  if (Number.isFinite(endAt)) {
    return Math.max(0, Math.floor((endAt - startAt) / 1000));
  }

  return Math.max(0, Math.floor((Date.now() - startAt) / 1000));
};

const mapUser = (row) => ({
  id: String(row.id),
  email: row.email,
  username: row.username,
  name: row.name,
  isAdmin: Boolean(row.is_admin),
});

const mapTimeEntry = (row) => {
  const startAt = row.start_at ? new Date(row.start_at) : null;
  const endAt = row.end_at ? new Date(row.end_at) : null;

  return {
    id: String(row.id),
    name: row.name,
    projectId: row.project_id,
    project: row.project_name || row.project,
    tags: Array.isArray(row.tags) ? row.tags : [],
    date: startAt ? startAt.toISOString().slice(0, 10) : null,
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    durationSeconds: calculateDurationSeconds(row),
    type: row.type,
    isActive: !endAt,
    user: row.include_user && row.user_id
      ? {
          id: String(row.user_id),
          email: row.user_email || null,
          username: row.user_username || null,
          name: row.user_name || null,
        }
      : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
};

const mapProject = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const mapTag = (row) => ({
  id: row.id,
  name: row.name,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

module.exports = {
  mapUser,
  mapTimeEntry,
  mapProject,
  mapTag,
};
