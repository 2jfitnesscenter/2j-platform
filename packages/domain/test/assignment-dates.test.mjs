import assert from 'node:assert/strict';
import test from 'node:test';
import { assignmentDateDefaults } from '../dist/assignment-dates.js';

test('monthly assignment dates use last day of start month and day 10 charge deadline', () => {
  const plan = { kind: 'recurring', renewalCadence: 'monthly', periodDays: null };
  assert.deepEqual(assignmentDateDefaults('2026-11-12', plan, '2026-10-31'), {
    startsOn: '2026-11-12', endsOn: '2026-11-30', dueOn: '2026-11-10',
  });
  assert.deepEqual(assignmentDateDefaults('2028-02-12', plan, '2028-01-31'), {
    startsOn: '2028-02-12', endsOn: '2028-02-29', dueOn: '2028-02-10',
  });
});

test('past day 10 falls back to start date; weekly and custom periods derive their end', () => {
  assert.equal(assignmentDateDefaults('2026-10-20', { kind:'recurring',renewalCadence:'monthly',periodDays:null }, '2026-10-31').dueOn, '2026-10-20');
  assert.equal(assignmentDateDefaults('2026-10-20', { kind:'recurring',renewalCadence:'weekly',periodDays:null }, '2026-10-01').endsOn, '2026-10-26');
  assert.equal(assignmentDateDefaults('2026-10-20', { kind:'session_pack',renewalCadence:null,periodDays:30 }, '2026-10-01').endsOn, '2026-11-18');
  assert.equal(assignmentDateDefaults('2026-10-20', { kind:'session_pack',renewalCadence:null,periodDays:null }, '2026-10-01').endsOn, null);
});

test('day 10 remains the due date on the deadline and a passed deadline moves to the chosen start date', () => {
  const plan = { kind:'recurring', renewalCadence:'monthly', periodDays:null };
  assert.equal(assignmentDateDefaults('2026-11-12', plan, '2026-11-10').dueOn, '2026-11-10');
  assert.equal(assignmentDateDefaults('2026-11-12', plan, '2026-11-11').dueOn, '2026-11-12');
  assert.equal(assignmentDateDefaults('2028-02-12', plan, '2028-02-13').endsOn, '2028-02-29');
});

test('contract dates use each modality period and payment rule', () => {
  assert.deepEqual(assignmentDateDefaults('2028-02-01',{kind:'recurring',renewalCadence:'monthly',periodDays:null,termKind:'natural_month',dueDay:10},'2028-01-31'),{startsOn:'2028-02-01',endsOn:'2028-02-29',dueOn:'2028-02-10'});
  assert.deepEqual(assignmentDateDefaults('2026-10-15',{kind:'recurring',renewalCadence:'monthly',periodDays:null,termKind:'rolling_months',termMonths:3,assignedLocalDate:'2026-10-15',graceDays:5},'2026-10-15'),{startsOn:'2026-10-15',endsOn:'2027-01-14',dueOn:'2026-10-20'});
  assert.deepEqual(assignmentDateDefaults('2026-10-15',{kind:'recurring',renewalCadence:'monthly',periodDays:null,termKind:'custom_range',maxSpanDays:20,assignedLocalDate:'2026-10-15',graceDays:5},'2026-10-15'),{startsOn:'2026-10-15',endsOn:'2026-11-03',dueOn:'2026-10-20'});
});
