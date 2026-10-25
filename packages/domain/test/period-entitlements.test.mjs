import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availablePeriodBalance,
  buildFixedEntitlementPeriodCandidate,
  canaryBusinessDate,
  canaryLocalMidnightUtc,
  derivePeriodAccess,
  mayConsumeFromPeriod,
  nextMonthlyPeriod,
  nextPeriodAccessTransition,
  proratedSessionsForPayment,
  roundHalfUp,
  sessionsForPeriod,
  splitContractIntoMonthlyEntitlementPeriods,
  validateContractQuantityRule,
  weekdaysInRange,
} from '../src/period-entitlements.ts';

const fixtures = [
  { label: 'February 28 days', start: '2027-02-01', end: '2027-02-28', weekdays: 20 },
  { label: 'February 29 days', start: '2028-02-01', end: '2028-02-29', weekdays: 21 },
  { label: '30-day month', start: '2026-04-01', end: '2026-04-30', weekdays: 22 },
  { label: '31-day month', start: '2026-03-01', end: '2026-03-31', weekdays: 22 },
  { label: 'month starting Monday', start: '2026-06-01', end: '2026-06-30', weekdays: 22 },
  { label: 'month starting midweek', start: '2026-10-01', end: '2026-10-31', weekdays: 22 },
];

test('period weekday fixtures cover short, long, and differently aligned months', () => {
  for (const fixture of fixtures) {
    assert.equal(weekdaysInRange(fixture.start, fixture.end), fixture.weekdays, fixture.label);
  }
  assert.equal(weekdaysInRange('2026-11-16', '2026-11-30'), 11, 'late-payment slice includes both endpoints');
});

test('session bags use integer ROUND_HALF_UP and validate weekly frequency', () => {
  for (const [days, frequency, expected] of [[20, 3, 12], [21, 3, 13], [22, 3, 13], [23, 3, 14], [20, 1, 4], [20, 2, 8], [20, 4, 16], [20, 5, 20], [5, 2, 2], [7, 2, 3], [1, 2, 0]]) {
    assert.equal(sessionsForPeriod(days, frequency), expected);
  }
  assert.equal(roundHalfUp(5, 2), 3);
  assert.equal(roundHalfUp(7, 2), 4);
  assert.equal(roundHalfUp(1, 2), 1);
  assert.throws(() => sessionsForPeriod(20, 0), /weeklyFrequency/);
  assert.throws(() => sessionsForPeriod(20, 6), /weeklyFrequency/);
});

test('contract terms split into contiguous inclusive natural-month entitlement periods', () => {
  const cases = [
    ['2026-11-01','2026-11-30',[['2026-11-01','2026-11-30']]],
    ['2026-10-15','2026-10-31',[['2026-10-15','2026-10-31']]],
    ['2026-10-15','2026-11-14',[['2026-10-15','2026-10-31'],['2026-11-01','2026-11-14']]],
    ['2026-10-15','2027-01-14',[['2026-10-15','2026-10-31'],['2026-11-01','2026-11-30'],['2026-12-01','2026-12-31'],['2027-01-01','2027-01-14']]],
    ['2026-10-15','2027-04-14',null],
    ['2026-10-15','2027-10-14',null],
    ['2028-02-01','2028-02-29',[['2028-02-01','2028-02-29']]],
    ['2026-12-30','2027-01-02',[['2026-12-30','2026-12-31'],['2027-01-01','2027-01-02']]],
  ];
  for (const [start,end,expected] of cases) {
    const periods = splitContractIntoMonthlyEntitlementPeriods(start,end);
    if (expected) assert.deepEqual(periods.map(item=>[item.startsOn,item.endsOn]),expected);
    if (start==='2026-10-15' && end==='2027-04-14') assert.equal(periods.length,7);
    if (start==='2026-10-15' && end==='2027-10-14') assert.equal(periods.length,13);
    assert.deepEqual(periods.map(item=>item.periodIndex),periods.map((_,index)=>index));
    for (let index=1;index<periods.length;index++) {
      const nextDay=new Date(`${periods[index-1].endsOn}T00:00:00Z`);nextDay.setUTCDate(nextDay.getUTCDate()+1);
      assert.equal(periods[index].startsOn,nextDay.toISOString().slice(0,10));
    }
    assert.equal(periods[0].startsOn,start);
    assert.equal(periods.at(-1).endsOn,end);
  }
  assert.throws(()=>splitContractIntoMonthlyEntitlementPeriods('2026-11-02','2026-11-01'),/on or after/);
  assert.throws(()=>splitContractIntoMonthlyEntitlementPeriods('2026-02-30','2026-03-01'),/valid/);
});

test('weekday calculation uses inclusive calendar arithmetic across weekends, leap day and year boundaries', () => {
  assert.equal(weekdaysInRange('2026-11-02','2026-11-06'),5);
  assert.equal(weekdaysInRange('2026-11-07','2026-11-08'),0);
  assert.equal(weekdaysInRange('2026-11-06','2026-11-06'),1);
  assert.equal(weekdaysInRange('2026-11-07','2026-11-07'),0);
  assert.equal(weekdaysInRange('2028-02-28','2028-02-29'),2);
  assert.equal(weekdaysInRange('2026-12-31','2027-01-04'),3);
  assert.equal(weekdaysInRange('2026-11-01','2026-11-30'),21);
});

test('quantity rules distinguish legacy, weekday-ratio, fixed and unlimited modalities', () => {
  const valid = input => assert.deepEqual(validateContractQuantityRule(input),{valid:true});
  const invalid = (input,error) => assert.deepEqual(validateContractQuantityRule(input),{valid:false,error});
  valid({termKind:null,rightType:'sessions_quota',quantityRule:null,quantity:10,weeklyFrequency:null});
  valid({termKind:'rolling_months',rightType:'sessions_quota',quantityRule:'weekday_ratio_v1',quantity:null,weeklyFrequency:3});
  valid({termKind:'natural_month',rightType:'sessions_quota',quantityRule:'unlimited',quantity:null,weeklyFrequency:null});
  valid({termKind:'pack',rightType:'sessions_quota',quantityRule:'fixed_v1',quantity:10,weeklyFrequency:null});
  invalid({termKind:'rolling_months',rightType:'sessions_quota',quantityRule:null,quantity:10,weeklyFrequency:3},'quantity_rule_required');
  invalid({termKind:'rolling_months',rightType:'sessions_quota',quantityRule:'weekday_ratio_v1',quantity:10,weeklyFrequency:3},'quantity_invalid');
  invalid({termKind:'one_off',rightType:'sessions_quota',quantityRule:'fixed_v1',quantity:1,weeklyFrequency:1},'weekly_frequency_invalid');
  invalid({termKind:null,rightType:'service_access',quantityRule:'unlimited',quantity:null,weeklyFrequency:null},'quantity_rule_not_allowed');
});

test('fixed period candidate counts activation day and leaves legacy addLocalDays policy untouched', () => {
  assert.deepEqual(buildFixedEntitlementPeriodCandidate('2026-10-12',8,90),{
    periodIndex:0,entitlementMode:'quota',formulaId:'fixed_v1',periodStart:'2026-10-12',periodEnd:'2027-01-09',sessionsGranted:8,
  });
  assert.equal(buildFixedEntitlementPeriodCandidate('2026-10-12',1,null).periodEnd,null);
  assert.throws(()=>buildFixedEntitlementPeriodCandidate('2026-10-12',0,90),/quantity/);
});

test('late payment grants only weekdays from effective Canary activation through period end', () => {
  assert.equal(proratedSessionsForPayment('2026-11-16', '2026-11-30', 3), 7);
  assert.equal(proratedSessionsForPayment('2026-11-16', '2026-11-30', 1), 2);
  assert.equal(proratedSessionsForPayment('2026-11-16', '2026-11-30', 5), 11);
});

test('provisional access ends at 23:59:59 Canary on day 10 and blocks at day 11 00:00', () => {
  const period = { startsOn: '2026-11-01', endsOn: '2026-11-30', recurring: true, paymentValidated: false };
  assert.equal(canaryBusinessDate(new Date('2026-11-10T23:59:59+00:00')), '2026-11-10');
  assert.equal(derivePeriodAccess({ ...period, now: new Date('2026-11-10T23:59:59+00:00') }), 'provisional');
  assert.equal(canaryBusinessDate(new Date('2026-11-11T00:00:00+00:00')), '2026-11-11');
  assert.equal(derivePeriodAccess({ ...period, now: new Date('2026-11-11T00:00:00+00:00') }), 'blocked_unpaid');
  assert.equal(derivePeriodAccess({ ...period, paymentValidated: true, now: new Date('2026-11-11T00:00:00+00:00') }), 'active');
  assert.equal(derivePeriodAccess({ ...period, now: new Date('2026-12-01T00:00:00+00:00') }), 'ended');
  assert.equal(derivePeriodAccess({ ...period, paymentValidated: true, now: new Date('2026-11-01T00:00:00+00:00') }), 'active', 'paid in-time period is active');
  assert.equal(derivePeriodAccess({ ...period, recurring: false, now: new Date('2026-11-05T12:00:00+00:00') }), 'blocked_unpaid', 'non-recurring periods have no grace access');
  assert.equal(derivePeriodAccess({ ...period, now: new Date('2026-10-31T23:00:00+00:00') }), 'blocked_unpaid', 'a future unpaid period is not active early');
  assert.equal(derivePeriodAccess({ ...period, paymentValidated:true, now: new Date('2026-10-31T23:00:00+00:00') }), 'blocked_unpaid', 'even a future prepaid period begins only on its start date');
});

test('known provisional and period-end transitions resolve to Canary midnight, including DST', () => {
  const provisional = nextPeriodAccessTransition({ startsOn: '2026-10-01', endsOn: '2026-10-31', now: new Date('2026-10-10T22:59:45.000Z'), recurring: true, paymentValidated: false });
  assert.equal(provisional?.toISOString(), '2026-10-10T23:00:00.000Z');
  assert.equal(canaryLocalMidnightUtc('2027-03-29').toISOString(), '2027-03-28T23:00:00.000Z');
  assert.equal(canaryLocalMidnightUtc('2027-10-25').toISOString(), '2027-10-24T23:00:00.000Z');
});

test('monthly recurrence creates only the next period with a deterministic idempotency key', () => {
  const current = { startsOn: '2026-11-01', endsOn: '2026-11-30' };
  assert.deepEqual(nextMonthlyPeriod('assignment-1', current, true), {
    startsOn: '2026-12-01', endsOn: '2026-12-31', idempotencyKey: 'period:assignment-1:2026-12-01',
  });
  assert.equal(nextMonthlyPeriod('assignment-1', current, false), null, 'OFF blocks future materialization');
  assert.throws(() => nextMonthlyPeriod('assignment-1', { startsOn: '2026-11-01', endsOn: '2026-11-29' }, true), /natural-month/);
  assert.throws(() => nextMonthlyPeriod('assignment-1', { startsOn: '2026-10-15', endsOn: '2026-11-14' }, true), /natural-month/);
});

test('period balance never borrows from another bag and restoration is period-local', () => {
  const bags = new Map([['2026-11', [{ quantity: -2 }, { quantity: 1 }]], ['2026-12', [{ quantity: 5 }]]]);
  const novemberBalance = availablePeriodBalance(bags.get('2026-11'));
  assert.equal(novemberBalance, -1);
  assert.equal(mayConsumeFromPeriod(novemberBalance, 1), false, 'December balance is not consulted');
  bags.get('2026-11').push({ quantity: 1 }); // cancellation restore returns to the originating period
  assert.equal(availablePeriodBalance(bags.get('2026-11')), 0);
  assert.equal(availablePeriodBalance(bags.get('2026-12')), 5);
});
