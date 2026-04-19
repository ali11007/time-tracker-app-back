const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCsv } = require('../src/utils/export');
const { mapTimeEntry } = require('../src/utils/serializers');
const { timeEntrySchema } = require('../src/utils/validators');

test('timeEntrySchema normalizes tags and enforces minimum duration', () => {
  const result = timeEntrySchema.parse({
    name: 'Write API',
    project: 'Time Tracker',
    tags: ['backend', ' backend ', '', 'api'],
    date: '2025-01-18',
    durationSeconds: 3600,
    type: 'manual',
  });

  assert.deepEqual(result.tags, ['backend', 'api']);
  assert.equal(result.durationSeconds, 3600);
});

test('mapTimeEntry returns frontend-friendly fields', () => {
  const entry = mapTimeEntry({
    id: 7,
    name: 'Ship backend',
    project: 'Time Tracker',
    tags: ['backend'],
    date: new Date('2025-01-18T00:00:00.000Z'),
    duration_seconds: 5400,
    type: 'timer',
    created_at: '2025-01-18T09:00:00.000Z',
    updated_at: '2025-01-18T10:00:00.000Z',
  });

  assert.equal(entry.id, '7');
  assert.equal(entry.date, '2025-01-18');
  assert.equal(entry.durationSeconds, 5400);
  assert.equal(entry.createdAt, '2025-01-18T09:00:00.000Z');
});

test('buildCsv escapes commas and quotes', () => {
  const csv = buildCsv([
    {
      name: 'Plan, build, and "ship"',
      project: 'Client API',
      tags: ['backend', 'export'],
      date: '2025-01-18',
      durationSeconds: 7200,
      type: 'manual',
    },
  ]);

  assert.match(csv, /^name,project,tags,date,durationSeconds,type\n/);
  assert.match(csv, /"Plan, build, and ""ship"""/);
  assert.match(csv, /"backend, export"/);
});
