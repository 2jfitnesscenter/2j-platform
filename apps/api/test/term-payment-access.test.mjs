import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTermPaymentAccess } from '../src/term-payment-access.ts';

const base = (overrides = {}) => ({
  assignmentId: 'assignment-1', chargeId: 'charge-1', termKind: 'rolling_months',
  paymentRule: 'grace_from_assignment_v1', paymentBlock: 'enforce',
  deadline: { rule:'grace_from_assignment_v1', assignedLocalDate:'2026-10-15', inputs:{graceDays:5}, dueOn:'2026-10-20', accessBlockEffectiveOn:'2026-10-21', paymentBlockEffectiveOn:'2026-10-21' },
  dueOn: '2026-10-20', chargeState: 'pending', requiredAmountCents: 5000,
  netValidatedAmountCents: 0, businessNow: new Date('2026-10-21T00:00:00Z'), ...overrides,
});

test('grace deadline is inclusive and overdue starts at Canary local midnight', () => {
  assert.equal(deriveTermPaymentAccess(base({ businessNow:new Date('2026-10-20T22:59:59Z') })).state, 'payment_pending');
  assert.equal(deriveTermPaymentAccess(base({ businessNow:new Date('2026-10-20T22:59:59Z') })).outstandingAmountCents, 5000);
  assert.equal(deriveTermPaymentAccess(base({ businessNow:new Date('2026-10-20T23:00:00Z') })).state, 'payment_overdue');
  assert.equal(deriveTermPaymentAccess(base({ businessNow:new Date('2026-10-20T23:00:00Z') })).outstandingAmountCents, 5000);
});

test('natural-month day 10 remains valid through its last second and blocks from day 11', () => {
  const natural = base({ termKind:'natural_month', paymentRule:'monthly_day10_v1', dueOn:'2026-11-10',
    deadline:{rule:'monthly_day10_v1',assignedLocalDate:'2026-10-15',inputs:{dueDay:10},dueOn:'2026-11-10',accessBlockEffectiveOn:'2026-11-11',paymentBlockEffectiveOn:'2026-11-11'} });
  assert.equal(deriveTermPaymentAccess({...natural,businessNow:new Date('2026-11-10T23:59:59Z')}).state,'payment_pending');
  assert.equal(deriveTermPaymentAccess({...natural,businessNow:new Date('2026-11-11T00:00:00Z')}).state,'payment_overdue');
});

test('partial payment stays pending/overdue, full and excess settlement allow access', () => {
  assert.equal(deriveTermPaymentAccess(base({netValidatedAmountCents:4999})).state,'payment_overdue');
  assert.equal(deriveTermPaymentAccess(base({netValidatedAmountCents:4999,businessNow:new Date('2026-10-20T20:00:00Z')})).state,'payment_pending');
  assert.equal(deriveTermPaymentAccess(base({netValidatedAmountCents:5000})).state,'allowed');
  assert.equal(deriveTermPaymentAccess(base({netValidatedAmountCents:5200})).state,'allowed');
});

test('a refund below the charge total re-blocks after deadline; payment_block off never blocks', () => {
  assert.equal(deriveTermPaymentAccess(base({netValidatedAmountCents:3000})).state,'payment_overdue');
  const off=base({paymentBlock:'off',netValidatedAmountCents:0,deadline:{rule:'grace_from_assignment_v1',assignedLocalDate:'2026-10-15',inputs:{graceDays:5},dueOn:'2026-10-20',accessBlockEffectiveOn:'2026-10-21',paymentBlockEffectiveOn:null}});
  assert.equal(deriveTermPaymentAccess(off).state,'payment_pending');
  assert.equal(deriveTermPaymentAccess(off).outstandingAmountCents,5000);
});

test('exempt charges permit access; inconsistent/missing snapshots fail closed', () => {
  assert.equal(deriveTermPaymentAccess(base({chargeState:'exempt'})).state,'allowed');
  assert.equal(deriveTermPaymentAccess(base({deadline:{rule:'grace_from_assignment_v1',dueOn:'2026-10-19'}})).state,'entitlement_unavailable');
  assert.equal(deriveTermPaymentAccess(base({dueOn:'2026-02-31',deadline:{rule:'grace_from_assignment_v1',assignedLocalDate:'2026-02-25',inputs:{graceDays:5},dueOn:'2026-02-31',accessBlockEffectiveOn:'2026-03-04',paymentBlockEffectiveOn:'2026-03-04'}})).state,'entitlement_unavailable');
  assert.equal(deriveTermPaymentAccess(base({chargeState:'void'})).state,'entitlement_unavailable');
});

test('Canary local-date derivation crosses autumn DST without adding 24-hour intervals', () => {
  const autumn=base({dueOn:'2026-10-24',deadline:{rule:'grace_from_assignment_v1',assignedLocalDate:'2026-10-19',inputs:{graceDays:5},dueOn:'2026-10-24',accessBlockEffectiveOn:'2026-10-25',paymentBlockEffectiveOn:'2026-10-25'}});
  assert.equal(deriveTermPaymentAccess({...autumn,businessNow:new Date('2026-10-24T22:59:59Z')}).state,'payment_pending');
  assert.equal(deriveTermPaymentAccess({...autumn,businessNow:new Date('2026-10-24T23:00:00Z')}).state,'payment_overdue');
  assert.equal(deriveTermPaymentAccess({...autumn,businessNow:new Date('2026-10-25T23:59:59Z')}).state,'payment_overdue');
  assert.equal(deriveTermPaymentAccess({...autumn,businessNow:new Date('2026-10-26T00:00:00Z')}).state,'payment_overdue');
});
