import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExerciseQuery, mergeExercisePage, MUSCLE_GROUPS, PAGE_SIZE } from '../src/library-module.tsx';

test('the list query sends only the filters that are set, trimmed, with the page size and offset', () => {
  assert.equal(buildExerciseQuery({ q: '', muscleGroup: '', offset: 0 }), `limit=${PAGE_SIZE}&offset=0`);
  assert.equal(buildExerciseQuery({ q: '  sit-up ', muscleGroup: 'abs', offset: 50 }), `limit=${PAGE_SIZE}&offset=50&q=sit-up&muscleGroup=abs`);
});

test('a new search replaces the list; loading more appends the next page', () => {
  const first = [{ id: '0001', name: 'A' }];
  assert.deepEqual(mergeExercisePage([], first, 0), first);
  assert.deepEqual(mergeExercisePage([{ id: '0009', name: 'Z' }], first, 0), first);
  assert.deepEqual(mergeExercisePage(first, [{ id: '0002', name: 'B' }], PAGE_SIZE).map(e => e.id), ['0001', '0002']);
});

test('every muscle group offered in the filter exists in the catalogue data, and none is missing', () => {
  const source = readFileSync(new URL('../../api/data/exercises-catalog.js', import.meta.url), 'utf8');
  const rows = JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));
  const inData = [...new Set(rows.map(row => row.mg))].sort();
  assert.deepEqual([...MUSCLE_GROUPS].sort(), inData);
});
