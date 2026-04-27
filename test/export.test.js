const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCsv } = require('../src/utils/export');
const { mapTimeEntry } = require('../src/utils/serializers');
const { manualTimeEntrySchema } = require('../src/utils/validators');

test('manualTimeEntrySchema normalizes tags and enforces minimum duration', () => {
  const result = manualTimeEntrySchema.parse({
    name: 'Write API',
    projectId: '3bdc0f49-72be-4f5a-baaa-4d4f3c4c7398',
    tags: ['backend', ' backend ', '', 'api'],
    startAt: '2025-01-18T09:00:00.000Z',
    endAt: '2025-01-18T10:00:00.000Z',
    type: 'manual',
  });

  assert.deepEqual(result.tags, ['backend', 'api']);
  assert.equal(result.projectId, '3bdc0f49-72be-4f5a-baaa-4d4f3c4c7398');
});

test('mapTimeEntry returns frontend-friendly fields', () => {
  const entry = mapTimeEntry({
    id: '2d2439b7-946d-424b-bcc8-2082a3a65c09',
    name: 'Ship backend',
    project: 'Time Tracker',
    project_id: '3bdc0f49-72be-4f5a-baaa-4d4f3c4c7398',
    tags: ['backend'],
    start_at: '2025-01-18T09:00:00.000Z',
    end_at: '2025-01-18T10:30:00.000Z',
    type: 'timer',
    created_at: '2025-01-18T09:00:00.000Z',
    updated_at: '2025-01-18T10:00:00.000Z',
  });

  assert.equal(entry.id, '2d2439b7-946d-424b-bcc8-2082a3a65c09');
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

  assert.match(csv, /^name,project,tags,date,startAt,endAt,durationSeconds,type,isActive\n/);
  assert.match(csv, /"Plan, build, and ""ship"""/);
  assert.match(csv, /"backend, export"/);
});

test('buildCsv includes user columns when admin export entries include users', () => {
  const csv = buildCsv([
    {
      user: { id: '1', email: 'ada@example.com', username: 'ada', name: 'Ada Lovelace' },
      name: 'Review reports',
      project: 'Ops',
      tags: [],
      date: '2025-01-18',
      startAt: '2025-01-18T09:00:00.000Z',
      endAt: '2025-01-18T10:00:00.000Z',
      durationSeconds: 3600,
      type: 'manual',
      isActive: false,
    },
  ]);

  assert.match(csv, /^userId,userEmail,username,userName,name,project,tags,date,startAt,endAt,durationSeconds,type,isActive\n/);
  assert.match(csv, /1,ada@example.com,ada,Ada Lovelace,Review reports/);
});

test('buildCsv can include user columns for empty admin exports', () => {
  const csv = buildCsv([], { includeUsers: true });

  assert.equal(csv, 'userId,userEmail,username,userName,name,project,tags,date,startAt,endAt,durationSeconds,type,isActive');
});
