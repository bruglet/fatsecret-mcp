import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGetFoodEntriesQuery, dateToDays } from '../src/food-diary.ts';

test('dateToDays converts YYYY-MM-DD to FatSecret date integer', () => {
  assert.equal(dateToDays('2026-06-17'), 20621);
});

test('buildGetFoodEntriesQuery omits placeholder food_entry_id=0 for date lookups', () => {
  assert.deepEqual(buildGetFoodEntriesQuery({ date: '2026-06-17', food_entry_id: 0 }), {
    date: 20621,
    format: 'json',
  });
});

test('buildGetFoodEntriesQuery preserves real food_entry_id lookups', () => {
  assert.deepEqual(buildGetFoodEntriesQuery({ food_entry_id: 23971997734 }), {
    food_entry_id: 23971997734,
    date: undefined,
    format: 'json',
  });
});
