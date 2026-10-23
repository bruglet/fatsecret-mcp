import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FoodReferences, resolvePortion, type FoodDetail } from '../src/food-references.js';

const draft = { name: 'Food Box entrée', notes: 'Rice logged separately', parts: [{ food_id: 1, serving_id: 11, number_of_units: 150 }] };
const food: FoodDetail = { food_id: 1, food_name: 'Chicken', servings: { serving: [{ serving_id: 11, number_of_units: '100',
  measurement_description: 'g', calories: '200', protein: '20', carbohydrate: '10', fat: '5' }] } };

test('portion calculation uses standardized units, not the number of described servings', () => {
  const result = resolvePortion(draft.parts[0], food);
  assert.deepEqual(result.nutrition, { calories: 300, protein: 30, carbohydrate: 15, fat: 7.5 });
  assert.equal(result.number_of_units, 150);
});

test('missing nutrients, mismatched food IDs, and unknown serving quantities fail closed', () => {
  for (const invalid of [
    { ...food, food_id: 2 }, { ...food, servings: null },
    ...[0, null, '', 'invalid'].map(number_of_units => ({ ...food, servings: { serving: [{ ...food.servings!.serving[0], number_of_units }] } })),
    ...[null, '', '-1', 'NaN'].map(calories => ({ ...food, servings: { serving: [{ ...food.servings!.serving[0], calories }] } })),
  ]) assert.throws(() => resolvePortion(draft.parts[0], invalid));
});

test('approved references persist across sessions, isolate accounts, and preserve unrelated references', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-references-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FoodReferences(directory, () => 'account-A');
  const first = store.save(draft);
  store.save({ ...draft, name: 'Rice' });
  const reopened = new FoodReferences(directory, () => 'account-A');
  assert.deepEqual(reopened.get(' FOOD  BOX entrée '), first);
  assert.equal(store.save(draft).revision, first.revision);
  assert.deepEqual(new FoodReferences(directory, () => 'account-B').list(), []);
  assert.throws(() => new FoodReferences(directory, () => 'account-B').get(draft.name), /REFERENCE_NOT_FOUND/);
  assert.throws(() => store.save({ ...draft, notes: 'Changed' }), /REFERENCE_CONFLICT/);
  const changed = store.save({ ...draft, notes: 'Changed' }, first.revision);
  assert.throws(() => store.delete(draft.name, first.revision), /REFERENCE_CONFLICT/);
  store.delete(draft.name, changed.revision);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].name, 'Rice');
  assert.throws(() => store.get(draft.name), /REFERENCE_NOT_FOUND/);
});

test('storage contains no downloaded macros or account token and rejects corruption', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-references-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FoodReferences(directory, () => 'SECRET-TOKEN');
  store.save(draft);
  const accountDirectory = join(directory, 'food-references', readdirSync(join(directory, 'food-references'))[0]);
  const file = join(accountDirectory, readdirSync(accountDirectory)[0]);
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes('SECRET-TOKEN'));
  assert.ok(!raw.includes('calories'));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(accountDirectory).mode & 0o777, 0o700);
  writeFileSync(file, '{}');
  assert.throws(() => store.save(draft), /REFERENCE_INVALID/);
  assert.equal(readFileSync(file, 'utf8'), '{}');
});

test('locked references cannot be overwritten by concurrent processes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-references-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new FoodReferences(directory, () => 'A');
  const saved = store.save(draft);
  const accountDirectory = join(directory, 'food-references', readdirSync(join(directory, 'food-references'))[0]);
  const file = join(accountDirectory, readdirSync(accountDirectory)[0]);
  writeFileSync(`${file}.lock`, '');
  assert.throws(() => store.delete(draft.name, saved.revision), /REFERENCE_BUSY/);
  assert.deepEqual(store.get(draft.name), saved);
});
