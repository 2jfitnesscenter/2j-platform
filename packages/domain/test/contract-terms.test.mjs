import test from 'node:test';
import assert from 'node:assert/strict';
import { addDateDays, calculateContractEnd, isValidDateOnly, validateCustomContractRange, validateNaturalMonthContract } from '../src/contract-terms.ts';

test('calculateContractEnd matches every approved anniversary and end-of-month example', () => {
  const cases = [
    ['2026-10-15',3,'2027-01-14'], ['2026-10-01',3,'2026-12-31'], ['2027-01-31',3,'2027-04-30'],
    ['2026-11-30',3,'2027-02-28'], ['2027-11-30',3,'2028-02-29'], ['2026-08-31',6,'2027-02-28'],
    ['2027-08-31',6,'2028-02-29'], ['2026-10-15',6,'2027-04-14'], ['2026-10-15',12,'2027-10-14'],
    ['2027-02-28',12,'2028-02-29'], ['2026-11-29',3,'2027-02-27'],
  ];
  for (const [start,months,end] of cases) assert.equal(calculateContractEnd(start,months),end,`${start} + ${months} months`);
});

test('calculateContractEnd invariants hold for every date from 2026 through 2031', () => {
  for (const months of [3,6,12]) {
    let previous = '';
    for (let year=2026;year<=2031;year++) for (let month=1;month<=12;month++) for (let day=1;day<=31;day++) {
      const start=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      if (!isValidDateOnly(start)) continue;
      const end=calculateContractEnd(start,months);
      assert.ok(end>start,`${start} end must follow start`);
      assert.ok(end>=previous,`${months} month end must be non-decreasing at ${start}`);
      const nextDate=addDateDays(end,1);
      const monthAfterEnd=Number(end.slice(5,7))===12?`${Number(end.slice(0,4))+1}-01-01`:`${end.slice(0,4)}-${String(Number(end.slice(5,7))+1).padStart(2,'0')}-01`;
      const startIsEndOfMonth = Number(start.slice(8,10)) === Number(new Date(Date.UTC(year,month,0)).getUTCDate());
      if (startIsEndOfMonth) {
        assert.equal(end.slice(8,10),String(new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),0)).getUTCDate()).padStart(2,'0'));
        assert.equal(nextDate,monthAfterEnd);
      } else {
        const startMonth = Number(start.slice(5,7));
        const targetYear = year + Math.floor((startMonth - 1 + months) / 12);
        const targetMonth = (startMonth - 1 + months) % 12 + 1;
        const anniversaryDay = Math.min(Number(start.slice(8,10)), Number(new Date(Date.UTC(targetYear,targetMonth,0)).getUTCDate()));
        assert.equal(nextDate,`${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(anniversaryDay).padStart(2,'0')}`);
      }
      previous=end;
    }
  }
});

test('calculateContractEnd rejects invalid dates, unsupported terms, and results outside DATE range', () => {
  assert.throws(() => calculateContractEnd('2026-02-30',3), RangeError);
  assert.throws(() => calculateContractEnd('2026-10-15',4), RangeError);
  assert.throws(() => calculateContractEnd('9999-12-31',12), RangeError);
});

test('natural-month and custom-range validators handle assignment boundaries, leap days and year changes', () => {
  assert.deepEqual(validateNaturalMonthContract('2026-10-20','2026-11-01','2026-11-30'),{valid:true});
  assert.deepEqual(validateNaturalMonthContract('2026-11-01','2026-11-01','2026-11-30'),{valid:true});
  assert.deepEqual(validateNaturalMonthContract('2026-11-15','2026-11-01','2026-11-30'),{valid:false,error:'natural_month_already_started'});
  assert.deepEqual(validateNaturalMonthContract('2028-01-31','2028-02-01','2028-02-29'),{valid:true});
  assert.deepEqual(validateNaturalMonthContract('2026-12-31','2027-01-01','2027-01-31'),{valid:true});
  assert.deepEqual(validateCustomContractRange('2026-10-10','2026-10-10','2026-10-20',11),{valid:true,spanDays:11});
  assert.deepEqual(validateCustomContractRange('2026-10-15','2026-10-15','2026-11-02',19),{valid:true,spanDays:19});
  assert.deepEqual(validateCustomContractRange('2026-10-15','2026-10-14','2026-10-20'),{valid:false,error:'custom_range_before_assignment'});
  assert.deepEqual(validateCustomContractRange('2026-10-15','2026-10-15','2026-10-31',16),{valid:false,error:'custom_range_exceeds_max_span'});
  assert.deepEqual(validateCustomContractRange('2026-02-30','2026-03-01','2026-03-10'),{valid:false,error:'invalid_date'});
  assert.deepEqual(validateCustomContractRange('2026-12-31','2027-01-02','2027-01-01'),{valid:false,error:'custom_range_invalid'});
});
