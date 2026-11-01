import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../dist/format.js';

const f = { t: (s, ...a) => a.reduce((acc, v, i) => acc.replaceAll(`{${i}}`, String(v)), s), locale: 'en-GB' };

test('calendar-only dates stay on their day; timestamps parse as instants', () => {
  assert.equal(F.dateValue('2026-03-02').getDate(), 2);
  assert.equal(F.dateValue('1767225600000').getTime(), 1767225600000);
  assert.equal(F.dateValue('not a date'), null);
  assert.equal(F.dateSortValue(null), 0);
});

test('durations and missing numbers are never invented', () => {
  assert.equal(F.fmtDur(45 * 60000), '45 min');
  assert.equal(F.fmtDur(125 * 60000), '2h 5m');
  assert.deepEqual(F.durPart(30000), []);
  assert.equal(F.fmtNum(NaN, f), '—');
  assert.equal(F.fmtNum(12.345, f), '12.3');
  assert.equal(F.fmtVol(1000, 'kg', f), '1,000 kg');
});

test('plural labels go through the injected translator', () => {
  assert.equal(F.exCount(1, f), '1 exercise');
  assert.equal(F.exCount(3, f), '3 exercises');
});

test('initials, age and ISO week', () => {
  assert.equal(F.initials('juan jose perez'), 'JJ');
  assert.equal(F.initials('  '), '?');
  assert.equal(F.ageFrom('1990-06-15', new Date('2026-06-14T12:00:00')), 35);
  assert.equal(F.ageFrom('1990-06-15', new Date('2026-06-15T12:00:00')), 36);
  assert.equal(F.ageFrom('nope'), null);
  assert.equal(F.weekKey('2026-01-01'), '2026-1');
  assert.equal(F.weekKey('2026-12-31'), '2026-53');
});

test('todayISO uses local calendar date', () => {
  assert.equal(F.todayISO(new Date(2026, 10, 1, 23, 0)), '2026-11-01');
});
