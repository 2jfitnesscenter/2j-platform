import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SCHEDULES_PER_OPERATION, blockGeometry, buildBatchPayload, canSelectWeekday, counterLabel, draftCount, duplicateDraft, endTime, findConflicts,
  gridExtent, groupExisting, laneBox, layoutDay, limitMessage, overflowChips, remainingSchedules, slotCount, timeOptions, timeOptionsFor, timeRangeLabel,
  toMinutes, totalCount, upsertDraft, validateDraft, weekdaysLabel, weekdaysShort,
} from '../src/schedule-logic.ts';

const draft = (overrides = {}) => ({ id: 'd1', serviceId: 'svc-1', professionalId: 'pro-1', weekdays: [1, 3, 5], startTime: '08:00', durationMinutes: 60, capacity: 12, startsOn: '2026-10-19', endsOn: '', ...overrides });
const block = (key, weekday, start, duration) => ({ key, weekday, startMinute: toMinutes(start), endMinute: toMinutes(start) + duration });

test('A: 08:00 and 08:30 are different slots, one full hour and one half hour, in the selector and in the grid', () => {
  const options = timeOptions();
  assert.ok(options.includes('08:00') && options.includes('08:30'));
  assert.equal(options.indexOf('08:30') - options.indexOf('08:00'), 1, 'consecutive 30-minute options');
  assert.equal(options[0], '06:00'); assert.equal(options.at(-1), '21:30');
  const extent = gridExtent([]);
  assert.equal(blockGeometry(block('a', 1, '08:00', 60), extent).top, 4, '08:00 is row 4 after 06:00');
  assert.equal(blockGeometry(block('b', 1, '08:30', 60), extent).top, 5, '08:30 is the very next 30-minute row');
  assert.notEqual(blockGeometry(block('a', 1, '08:00', 60), extent).top, blockGeometry(block('b', 1, '08:30', 60), extent).top);
  assert.deepEqual(timeOptionsFor('08:15').filter((time) => time.startsWith('08')), ['08:00', '08:15', '08:30'], 'an existing off-grid start time is still selectable');
});

test('B: 06:30 + 60 min ends at 07:30 and 07:00 + 60 ends at 08:00; durations add up exactly', () => {
  assert.equal(endTime('06:30', 60), '07:30');
  assert.equal(timeRangeLabel('06:30', 60), '06:30–07:30');
  assert.equal(timeRangeLabel('07:00', 60), '07:00–08:00');
  assert.equal(timeRangeLabel('08:30', 60), '08:30–09:30');
  assert.equal(timeRangeLabel('08:00', 45), '08:00–08:45');
  assert.equal(timeRangeLabel('08:00', 75), '08:00–09:15');
  assert.equal(timeRangeLabel('08:00', 90), '08:00–09:30');
  const extent = gridExtent([]);
  const a = blockGeometry(block('a', 1, '06:30', 60), extent);
  const b = blockGeometry(block('b', 1, '07:00', 60), extent);
  assert.deepEqual([a.top, a.height, a.bottom], [1, 2, 3], '06:30 → 07:30 occupies rows 1 and 2 (06:30–07:30)');
  assert.deepEqual([b.top, b.height, b.bottom], [2, 2, 4], '07:00 → 08:00 starts one row later, so the two blocks do not start on the same line');
  assert.notEqual(a.top, b.top);
  assert.equal(blockGeometry(block('c', 1, '08:00', 45), extent).height, 1.5, 'a 45 minute block is 1.5 rows, never rounded up into the next slot');
});

test('the grid has real 30-minute rows and grows only when a template falls outside 06:00-22:00', () => {
  assert.equal(slotCount(gridExtent([])), 32);
  const wide = gridExtent([block('x', 1, '05:30', 60), block('y', 1, '21:30', 90)]);
  assert.deepEqual(wide, { start: 300, end: 1380 });
  assert.equal(blockGeometry(block('x', 1, '05:30', 60), wide).top, 1);
});

test('C: two overlapping blocks of the same day sit side by side and never share the same box', () => {
  const placed = layoutDay([block('a', 1, '08:00', 60), block('b', 1, '08:30', 60)]);
  const a = placed.find((item) => item.key === 'a'); const b = placed.find((item) => item.key === 'b');
  assert.deepEqual([a.lanes, b.lanes], [2, 2]);
  assert.notEqual(a.lane, b.lane);
  const boxA = laneBox(a); const boxB = laneBox(b);
  assert.deepEqual([boxA.left, boxA.width, boxB.left, boxB.width], [0, 50, 50, 50]);
  assert.ok(boxA.left + boxA.width <= boxB.left, 'lane boxes do not overlap horizontally');
  const sameStart = layoutDay([block('a', 1, '08:00', 60), block('b', 1, '08:00', 60)]);
  assert.notEqual(sameStart[0].lane, sameStart[1].lane, 'two identical intervals still get different lanes');
});

test('consecutive blocks (06:30–07:30 then 07:30–08:30) reuse the full width: they are not an overlap', () => {
  const placed = layoutDay([block('a', 1, '06:30', 60), block('b', 1, '07:30', 60)]);
  assert.deepEqual(placed.map((item) => [item.lane, item.lanes]), [[0, 1], [0, 1]]);
});

test('lanes are per cluster of overlapping blocks, not per day', () => {
  const placed = layoutDay([block('a', 1, '08:00', 60), block('b', 1, '08:30', 60), block('c', 1, '12:00', 60)]);
  assert.equal(placed.find((item) => item.key === 'c').lanes, 1);
  assert.equal(placed.find((item) => item.key === 'a').lanes, 2);
});

test('too many simultaneous blocks keep a clean pattern: two lanes plus a +N chip lane, never stacked boxes', () => {
  const blocks = ['a', 'b', 'c', 'd', 'e'].map((key) => block(key, 1, '08:00', 60));
  const placed = layoutDay(blocks);
  const visible = placed.filter((item) => !item.hidden);
  const hidden = placed.filter((item) => item.hidden);
  assert.equal(visible.length, 2); assert.equal(hidden.length, 3);
  assert.ok(placed.every((item) => item.lanes === 3));
  assert.equal(new Set(visible.map((item) => item.lane)).size, 2);
  const chips = overflowChips(placed);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].hiddenKeys.length, 3);
  assert.equal(chips[0].lane, 2, 'the chip owns the last lane');
  assert.ok(visible.every((item) => item.lane < chips[0].lane), 'visible blocks never share the chip lane');
  assert.equal(overflowChips(layoutDay(blocks.slice(0, 3))).length, 0, 'three blocks still fit in three lanes');
});

test('D: a block lives in exactly one weekday column; Monday never reaches Tuesday', () => {
  const day = (weekday) => layoutDay([block(`k${weekday}`, weekday, '08:00', 60)]);
  assert.ok(day(1).every((item) => item.weekday === 1));
  const box = laneBox(day(1)[0]);
  assert.ok(box.left >= 0 && box.left + box.width <= 100, 'inside the column, 0-100%');
  for (const lanes of [1, 2, 3]) for (let lane = 0; lane < lanes; lane += 1) { const b = laneBox({ lane, lanes }); assert.ok(b.left >= 0 && b.left + b.width <= 100.000001); }
});

test('E: the 50 limit is enforced before adding; combinations that would pass 50 are rejected', () => {
  const full = Array.from({ length: 7 }, (_, index) => draft({ id: `f${index}`, weekdays: [1, 2, 3, 4, 5, 6, 0] }));
  assert.equal(totalCount(full), 49);
  assert.equal(remainingSchedules(full), 1);
  const next = upsertDraft(full, draft({ id: 'extra', weekdays: [1, 2] }));
  assert.equal(next.accepted, false);
  assert.equal(next.drafts, full, 'the list is untouched');
  assert.equal(upsertDraft(full, draft({ id: 'one', weekdays: [1] })).accepted, true);
  assert.equal(canSelectWeekday(full, null, [], 1), true);
  assert.equal(canSelectWeekday(full, null, [1], 2), false, 'a second day is no longer selectable');
  assert.equal(canSelectWeekday(full, null, [1], 1), true, 'an already selected day can always be unselected');
  const at50 = [...full, draft({ id: 'last', weekdays: [1] })];
  assert.equal(remainingSchedules(at50), 0);
  assert.equal(upsertDraft(at50, draft({ id: 'more', weekdays: [1] })).accepted, false);
  assert.match(limitMessage(), /máximo de 50 horarios por operación/);
});

test('editing a draft frees its own days from the limit', () => {
  const list = [draft({ id: 'a', weekdays: [1, 2, 3, 4, 5, 6, 0] }), ...Array.from({ length: 5 }, (_, index) => draft({ id: `b${index}`, weekdays: [1, 2, 3, 4, 5, 6, 0] })), draft({ id: 'c', weekdays: [1, 2, 3, 4, 5, 6, 0] })];
  assert.equal(totalCount(list), 49);
  assert.equal(remainingSchedules(list, 'c'), 8, 'excluding the draft being edited');
  assert.equal(upsertDraft(list, draft({ id: 'c', weekdays: [1, 2, 3, 4, 5, 6, 0] })).accepted, true, 'replacing it with the same size is fine');
});

test('F: the counter never shows more than 50', () => {
  assert.equal(counterLabel([]), '0 / 50');
  assert.equal(counterLabel([draft({ weekdays: [1, 3, 5] }), draft({ id: 'd2', weekdays: [2, 4] })]), '5 / 50');
  const over = Array.from({ length: 9 }, (_, index) => draft({ id: `o${index}`, weekdays: [1, 2, 3, 4, 5, 6, 0] }));
  assert.equal(totalCount(over), 63);
  assert.equal(counterLabel(over), '50 / 50', 'even if a bad state sneaks in, the label is capped');
  assert.equal(MAX_SCHEDULES_PER_OPERATION, 50);
  // exhaustively: no sequence of accepted additions can exceed 50
  let list = [];
  for (let step = 0; step < 40; step += 1) list = upsertDraft(list, draft({ id: `s${step}`, weekdays: [1, 2, 3, 4, 5, 6, 0].slice(0, 1 + (step % 7)) })).drafts;
  assert.ok(totalCount(list) <= 50);
  assert.equal(draftCount(draft({ weekdays: [1, 1, 3] })), 2, 'repeated days count once');
});

test('G: duplicating keeps service, professional, duration and capacity, and lets days and time change', () => {
  const source = draft({ weekdays: [1, 3, 5], startTime: '08:00', durationMinutes: 75, capacity: 9, endsOn: '2027-01-31' });
  const copy = duplicateDraft(source, 'd2');
  assert.equal(copy.id, 'd2');
  assert.deepEqual([copy.serviceId, copy.professionalId, copy.durationMinutes, copy.capacity, copy.startsOn, copy.endsOn], [source.serviceId, source.professionalId, 75, 9, source.startsOn, '2027-01-31']);
  copy.startTime = '09:00'; copy.weekdays.push(2);
  assert.equal(source.startTime, '08:00'); assert.deepEqual(source.weekdays, [1, 3, 5], 'the copy is independent');
});

test('H: a multi-day draft becomes one batch payload with the API weekdays and a single block', () => {
  const payload = buildBatchPayload(draft({ weekdays: [5, 1, 3], startTime: '06:30', durationMinutes: 60, capacity: 12, endsOn: '' }), 'area-1');
  assert.deepEqual(payload, { serviceId: 'svc-1', areaId: 'area-1', professionalId: 'pro-1', weekdays: [1, 3, 5], blocks: [{ localStartTime: '06:30', durationMinutes: 60, capacity: 12 }], startsOn: '2026-10-19', endsOn: null });
  const sunday = buildBatchPayload(draft({ weekdays: [0, 6], professionalId: '' }), 'area-1');
  assert.deepEqual(sunday.weekdays, [0, 6], 'Sunday is 0 for the API');
  assert.ok(!('professionalId' in sunday), 'no professional key when unassigned');
  assert.equal(buildBatchPayload(draft({ endsOn: '2027-12-31' }), 'a').endsOn, '2027-12-31');
});

test('validation rejects incomplete or impossible drafts with a reason', () => {
  assert.deepEqual(validateDraft(draft()), []);
  assert.ok(validateDraft(draft({ serviceId: '' })).some((text) => /servicio/i.test(text)));
  assert.ok(validateDraft(draft({ weekdays: [] })).some((text) => /día/i.test(text)));
  assert.ok(validateDraft(draft({ durationMinutes: 3 })).some((text) => /entre 5 y 480/.test(text)));
  assert.ok(validateDraft(draft({ capacity: 0 })).some((text) => /plazas/i.test(text)));
  assert.ok(validateDraft(draft({ capacity: 501 })).some((text) => /plazas/i.test(text)));
  assert.ok(validateDraft(draft({ startTime: '23:30', durationMinutes: 60 })).some((text) => /día siguiente/i.test(text)));
  assert.ok(validateDraft(draft({ startsOn: '2026-10-19', endsOn: '2026-10-01' })).some((text) => /anterior/i.test(text)));
  assert.deepEqual(validateDraft(draft({ startTime: '23:00', durationMinutes: 60 })), [], 'ending exactly at midnight is allowed');
});

test('conflicts follow the API rule: same service or same professional, overlapping time and dates', () => {
  const existing = [{ id: 't1', serviceId: 'svc-1', serviceName: 'Funcional', professionalId: null, weekday: 1, localStartTime: '08:30:00', durationMinutes: 60, capacity: 12, startsOn: '2026-10-01', endsOn: null }];
  assert.equal(findConflicts([draft({ weekdays: [1] })], existing).length, 1, '08:00–09:00 overlaps 08:30–09:30 on Monday');
  assert.equal(findConflicts([draft({ weekdays: [1], startTime: '07:30' })], existing).length, 0, '07:30–08:30 only touches');
  assert.equal(findConflicts([draft({ weekdays: [2] })], existing).length, 0, 'another weekday');
  assert.equal(findConflicts([draft({ weekdays: [1], serviceId: 'svc-2', professionalId: '' })], existing).length, 0, 'different service and no shared professional');
  assert.equal(findConflicts([draft({ weekdays: [1], serviceId: 'svc-2', professionalId: 'pro-9' })], [{ ...existing[0], professionalId: 'pro-9' }]).length, 1, 'same professional');
  assert.equal(findConflicts([draft({ weekdays: [1], endsOn: '2026-09-30', startsOn: '2026-09-01' })], existing).length, 0, 'validity ranges do not meet');
  const two = [draft({ id: 'a', weekdays: [1] }), draft({ id: 'b', weekdays: [1], startTime: '08:30' })];
  const found = findConflicts(two, []);
  assert.equal(found.length, 1); assert.equal(found[0].otherId, 'b');
  assert.equal(findConflicts([draft({ id: 'a', weekdays: [1], serviceId: 's1', professionalId: '' }), draft({ id: 'b', weekdays: [1], serviceId: 's2', professionalId: '' })], []).length, 0, 'two services may run at once');
});

test('existing templates are grouped by identical details and labelled L-M-X-J-V-S-D', () => {
  const tpl = (id, weekday, extra = {}) => ({ id, serviceId: 'svc-1', serviceName: 'Funcional', professionalId: 'pro-1', professionalName: 'Irene Díaz', weekday, localStartTime: '08:00:00', durationMinutes: 60, capacity: 12, startsOn: '2026-10-01', endsOn: null, ...extra });
  const groups = groupExisting([tpl('1', 5), tpl('2', 1), tpl('3', 3), tpl('4', 0), tpl('5', 1, { localStartTime: '09:00:00' })]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].weekdays, [1, 3, 5, 0], 'Monday first, Sunday last');
  assert.equal(weekdaysShort(groups[0].weekdays), 'L-X-V-D');
  assert.equal(weekdaysLabel([5, 1, 3]), 'Lunes · Miércoles · Viernes');
  assert.equal(weekdaysLabel([1, 2, 3, 4, 5, 6, 0]), 'Todos los días');
});
