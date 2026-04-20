const escapeCsv = (value) => {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const buildCsv = (entries) => {
  const header = ['name', 'project', 'tags', 'date', 'startAt', 'endAt', 'durationSeconds', 'type', 'isActive'];
  const rows = entries.map((entry) => [
    entry.name,
    entry.project,
    Array.isArray(entry.tags) ? entry.tags.join(', ') : '',
    entry.date,
    entry.startAt,
    entry.endAt,
    entry.durationSeconds,
    entry.type,
    entry.isActive,
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
};

module.exports = {
  buildCsv,
};
