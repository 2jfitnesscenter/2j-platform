import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetDraft } from '../src/training-module.tsx';

test('a set draft is accepted only with whole reps, a non-negative weight and an optional RIR within the API limits', () => {
  assert.deepEqual(parseSetDraft({ reps: '8', weight: '80,5', rir: '2' }), { reps: 8, weightKg: 80.5, rir: 2 });
  assert.deepEqual(parseSetDraft({ reps: '0', weight: '0', rir: '' }), { reps: 0, weightKg: 0, rir: null });
  assert.equal(parseSetDraft({ reps: '', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8.5', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '101', weight: '80', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '-1', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '1001', rir: '' }), null);
  assert.equal(parseSetDraft({ reps: '8', weight: '80', rir: '11' }), null);
});

const { parseModeDraft, describeSet, describeTarget, routineDraftToPayload, routineToDraft } = await import('../src/training-module.tsx');

test('A81: cada modo valida sus propios campos antes de enviar', () => {
  assert.deepEqual(parseModeDraft({ reps: '8', weight: '62,5', rir: '1.5', setType: 'drop' }, 'reps'), { reps: 8, weightKg: 62.5, rir: 1.5, setType: 'drop' });
  assert.equal(parseModeDraft({ reps: '8', weight: '60', rir: '1.3' }, 'reps'), null, 'RIR solo de medio en medio');
  assert.deepEqual(parseModeDraft({ reps: '', weight: '', rir: '', seconds: '45' }, 'time'), { seconds: 45, weightKg: null, setType: 'work' });
  assert.equal(parseModeDraft({ reps: '', weight: '', rir: '', seconds: '0' }, 'time'), null);
  assert.deepEqual(parseModeDraft({ reps: '', weight: '', rir: '', minutes: '20', speed: '9,5' }, 'cardio'), { minutes: 20, speedKmh: 9.5, setType: 'work' });
  assert.equal(parseModeDraft({ reps: '', weight: '', rir: '', minutes: '' }, 'cardio'), null);
});

test('A81: series y objetivos se describen según lo que tienen', () => {
  assert.equal(describeSet({ reps: 8, weightKg: 60, rir: 2 }), '8 × 60 kg · RIR 2');
  assert.equal(describeSet({ reps: null, weightKg: null, rir: null, seconds: 45, setType: 'warmup' }), '45 s · Calentamiento');
  assert.equal(describeSet({ reps: null, weightKg: null, rir: null, minutes: 20, speedKmh: 9.5 }), '20 min a 9.5 km/h');
  assert.equal(describeTarget({ mode: 'reps', targetSets: 3, target: { goal: '8-10' } }), '3 × 8-10');
  assert.equal(describeTarget({ mode: 'time', targetSets: 3, target: { goal: '45' } }), '3 × 45 s');
  assert.equal(describeTarget({ mode: 'cardio', targetSets: 1, target: {} }), '1 bloque');
});

test('A81: el formulario de rutina produce el cuerpo de la API o dice qué falta', () => {
  const exercise = { exerciseId: 'ex-1', exerciseName: ' Sentadilla ', mode: 'reps', targetSets: '4', goal: ' 8-10 ' };
  assert.deepEqual(routineDraftToPayload({ name: ' Fuerza A ', scheduledWeekdays: [3, 1, 3], exercises: [exercise] }),
    { payload: { name: 'Fuerza A', scheduledWeekdays: [1, 3], exercises: [{ exerciseId: 'ex-1', exerciseName: 'Sentadilla', mode: 'reps', targetSets: 4, target: { goal: '8-10' } }] } });
  assert.match(routineDraftToPayload({ name: '', scheduledWeekdays: [], exercises: [exercise] }).error, /nombre/);
  assert.match(routineDraftToPayload({ name: 'A', scheduledWeekdays: [], exercises: [] }).error, /al menos un ejercicio/);
  assert.match(routineDraftToPayload({ name: 'A', scheduledWeekdays: [], exercises: [{ ...exercise, targetSets: '0' }] }).error, /entre 1 y 20/);
  const routine = { id: 'r', name: 'Fuerza A', status: 'active', scheduledWeekdays: [1], exercises: [{ position: 1, exerciseId: null, exerciseName: 'Plancha', targetSets: 3, mode: 'time', target: { goal: '45' } }] };
  assert.deepEqual(routineToDraft(routine).exercises, [{ exerciseId: null, exerciseName: 'Plancha', mode: 'time', targetSets: '3', goal: '45' }]);
});
