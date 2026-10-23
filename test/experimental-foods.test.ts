import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExperimentalFoods } from '../src/experimental-foods.js';
import { type FoodDetail } from '../src/food-references.js';

const input = { food_name: 'Test', brand_name: 'Test', serving_size: '100 g', serving_amount: '100', serving_amount_unit: 'g',
  calories: 200, protein: 20, carbohydrate: 10, fat: 5, request_id: 'authorized-test', allow_unverified_visibility: true };
const serving = { serving_id: '91', number_of_units: '1', measurement_description: 'serving', metric_serving_amount: '100', metric_serving_unit: 'g',
  calories: '200', protein: '20', carbohydrate: '10', fat: '5' };
const food: FoodDetail = { food_id: '9', food_name: 'Test', brand_name: 'Test', servings: { serving: [{ ...serving, serving_id: '0' }, serving] } };
function fixture(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-experimental-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let writes = 0;
  let account = 'account-A';
  let read: () => Promise<FoodDetail> = async () => food;
  let create: () => Promise<string> = async () => '9';
  const api = { account: () => account, create: async () => { writes++; return create(); }, read: async () => read() };
  return { directory, api, writes: () => writes, setRead: (handler: typeof read) => { read = handler; },
    setCreate: (handler: typeof create) => { create = handler; }, setAccount: (value: string) => { account = value; },
    server: (enabled = true) => new ExperimentalFoods(directory, api, enabled) };
}

test('disabled API paths never call the upstream service', async t => {
  const f = fixture(t);
  f.setRead(async () => { throw new Error('No read expected'); });
  await assert.rejects(f.server(false).create(input), /CUSTOM_FOOD_UNVERIFIED/);
  await assert.rejects(f.server(false).read(9), /PERSONAL_FOOD_UNVERIFIED/);
  assert.equal(f.writes(), 0);
});

test('experimental writes require explicit consent, request ID, and verifiable standardized quantities', async t => {
  const f = fixture(t);
  for (const change of [{ allow_unverified_visibility: false }, { request_id: undefined }, { serving_amount: '0' },
    { serving_amount: 'not-a-number' }, { serving_amount_unit: 'oz' }]) {
    await assert.rejects(f.server().create({ ...input, ...change }));
  }
  assert.equal(f.writes(), 0);
});

test('creation journals IDs across sessions, chooses real serving, and deduplicates identical payloads', async t => {
  const f = fixture(t);
  const first = await f.server().create(input);
  assert.equal(first.visibility, 'unverified');
  assert.equal(first.serving_id.value, '91');
  assert.equal(first.number_of_units, 1);
  assert.equal(first.replayed, false);
  assert.equal((await f.server().create(input)).replayed, true);
  assert.equal((await f.server().create({ ...input, request_id: 'different-request-same-food' })).replayed, true);
  await assert.rejects(f.server().create({ ...input, calories: 210 }), /REQUEST_ID_CONFLICT/);
  assert.equal(f.writes(), 1);
});

test('failed creation remains pending and cannot blindly repeat even with a new request ID', async t => {
  const f = fixture(t);
  f.setCreate(async () => { throw new Error('Simulated timeout'); });
  await assert.rejects(f.server().create(input));
  await assert.rejects(f.server().create(input), /FOOD_WRITE_OUTCOME_UNKNOWN/);
  await assert.rejects(f.server().create({ ...input, request_id: 'another-request' }), /FOOD_WRITE_OUTCOME_UNKNOWN/);
  assert.equal(f.writes(), 1);
});

test('lookup failure retains the created ID and retries verification without another creation', async t => {
  const f = fixture(t);
  f.setRead(async () => { throw new Error('Read timeout'); });
  await assert.rejects(f.server().create(input), /FOOD_CREATED_UNVERIFIED.*9/);
  f.setRead(async () => food);
  assert.equal((await f.server().create(input)).food_id.value, '9');
  assert.equal(f.writes(), 1);
});

test('mismatched nutrients and inaccessible or derived servings never pass verification', async t => {
  const f = fixture(t);
  for (const bad of [{ ...food, food_id: '10' }, { ...food, food_name: 'Wrong food' }, { ...food, brand_name: 'Wrong brand' },
    { ...food, servings: { serving: [{ ...serving, serving_id: '0' }] } },
    { ...food, servings: { serving: [{ ...serving, metric_serving_unit: 'ml' }] } },
    { ...food, servings: { serving: [{ ...serving, calories: '900' }] } },
    { ...food, servings: { serving: [{ ...serving, protein: null }] } },
  ]) {
    f.setRead(async () => bad);
    await assert.rejects(f.server().create(input), /FOOD_CREATED_UNVERIFIED|FOOD_NUTRITION_MISMATCH/);
  }
  assert.equal(f.writes(), 1);
});

test('a retry fetches fresh nutrition instead of returning a cached success', async t => {
  const f = fixture(t);
  await f.server().create(input);
  f.setRead(async () => ({ ...food, servings: { serving: [{ ...serving, calories: '500' }] } }));
  await assert.rejects(f.server().create(input), /FOOD_NUTRITION_MISMATCH/);
  assert.equal(f.writes(), 1);
});

test('account changes during signed reads never return another account response as success', async t => {
  const f = fixture(t);
  f.setRead(async () => { f.setAccount('B'); return food; });
  await assert.rejects(f.server().read(9), /ACCOUNT_CHANGED/);
});


test('rounding tolerance accepts boundary values without hiding nutrient differences', async t => {
  const f = fixture(t);
  f.setRead(async () => ({ ...food, servings: { serving: [{ ...serving, calories: '201', protein: '20.1' }] } }));
  const result = await f.server().create(input);
  assert.equal(result.verification.differences.calories, 1);
  assert.ok(Math.abs(result.verification.differences.protein - 0.1) < 1e-9);
  assert.equal(result.visibility, 'unverified');
});
