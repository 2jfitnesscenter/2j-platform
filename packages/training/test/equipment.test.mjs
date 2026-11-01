import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../dist/equipment.js';

test('dumbbell rack walks the real grid up and down, clamped at the ends', () => {
  assert.equal(E.stepWeight({}, 'dumbbell', 5, 1), 6);
  assert.equal(E.stepWeight({}, 'dumbbell', 6, 1), 8);
  assert.equal(E.stepWeight({}, 'dumbbell', 8, -1), 6);
  assert.equal(E.stepWeight({}, 'dumbbell', 40, 1), 40);
  assert.equal(E.stepWeight({}, 'dumbbell', 1, -1), 1);
});

test('machines start at the 5 kg floor and clamp at the stack limit', () => {
  assert.equal(E.stepWeight({}, 'cable', 0, 1), 5);
  assert.equal(E.stepWeight({}, 'cable', 5, -1), 5);
  assert.equal(E.stepWeight({}, 'cable', 100, 1), 100);
});

test('barbells are flat 5 kg in 2J mode and use custom increments when the room mode is off', () => {
  assert.equal(E.stepWeight({}, 'barbell', 60, 1), 65);
  assert.equal(E.stepWeight({ use2JRoomEquipment: false, customIncrements: { barbell: 2.5, dumbbell: 1, machineOther: 3 } }, 'barbell', 60, 1), 62.5);
  assert.equal(E.stepWeight({ use2JRoomEquipment: false }, 'dumbbell', 10, 1), 12);
});

test('realizableToward lands on a loadable number or reports it cannot', () => {
  assert.equal(E.realizableToward({}, 'dumbbell', 5, 7), 8);
  assert.equal(E.realizableToward({}, 'dumbbell', 40, 50), null);
  assert.equal(E.realizableToward({}, 'barbell', 60, 60), 60);
});

test('equipment class mapping', () => {
  assert.equal(E.equipmentClassOf('smith machine'), 'barbell');
  assert.equal(E.equipmentClassOf('kettlebell'), 'machine');
  assert.equal(E.equipmentClassOf(undefined), 'machine');
});
