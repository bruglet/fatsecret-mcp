import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { FatSecretMcpServer } from '../src/index.js';
import { dateToDays } from '../src/food-diary.js';
import { normalizeResponse } from '../src/api-response.js';
import * as schemas from '../src/schemas.js';

const date = '2026-10-23';
const portion = { food_id: 1, serving_id: 11, number_of_units: 150, food_entry_name: 'Chicken', meal: 'lunch', date };
const nutrition = { calories: 300, protein: 30, carbohydrate: 15, fat: 7.5 };
const food = { food_id: '1', food_name: 'Chicken', food_type: 'Generic', food_url: 'https://example.test/food',
  servings: { serving: { serving_id: '11', serving_description: '100 g', number_of_units: '100', measurement_description: 'g',
    metric_serving_amount: '100', metric_serving_unit: 'g', calories: '200', protein: '20', carbohydrate: '10', fat: '5', sodium: null } } };
const entry = (id: number, overrides = {}) => ({ food_entry_id: String(id), food_entry_description: '150 g Chicken',
  date_int: String(dateToDays(date)), meal: 'Lunch', food_id: '1', serving_id: '11', number_of_units: '150',
  food_entry_name: 'Chicken', calories: '300', protein: '30', carbohydrate: '15', fat: '7.5', ...overrides });

type Handler = (url: URL, request: Request) => unknown | Promise<unknown>;
async function connect(t: TestContext, handler: Handler, options: { directory?: string; scopes?: string; profile?: boolean } = {}) {
  const directory = options.directory ?? mkdtempSync(join(tmpdir(), 'fatsecret-connector-'));
  const names = ['FATSECRET_CONFIG_DIR', 'FATSECRET_OAUTH_SCOPES', 'FATSECRET_CLIENT_ID', 'FATSECRET_CLIENT_SECRET', 'FATSECRET_CONSUMER_SECRET'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  names.forEach(name => { delete process.env[name]; });
  process.env.FATSECRET_CONFIG_DIR = directory;
  if (options.scopes) process.env.FATSECRET_OAUTH_SCOPES = options.scopes;
  writeFileSync(join(directory, 'config.json'), JSON.stringify({ clientId: 'test-client', clientSecret: 'test-secret',
    ...(options.profile === false ? {} : { consumerSecret: 'test-consumer-secret', accessToken: 'test-profile-token', accessTokenSecret: 'test-profile-secret' }) }), { mode: 0o600 });
  const requests: Request[] = [];
  const connector = new FatSecretMcpServer({ fetch: async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (url.hostname === 'oauth.fatsecret.com') return Response.json({ access_token: 'test-bearer', expires_in: 3600, scope: options.scopes ?? 'basic' });
    assert.equal(url.hostname, 'platform.fatsecret.com');
    const data = await handler(url, request);
    return data instanceof Response ? data : Response.json(data);
  } });
  const server = connector.createMcpServer();
  const client = new Client({ name: 'regression', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close(); await server.close();
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    if (!options.directory) rmSync(directory, { recursive: true, force: true });
  });
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { call, requests, directory };
}

test('Basic search uses v1 without Premier credentials and keeps pagination', async t => {
  const { call, requests } = await connect(t, url => {
    assert.equal(url.pathname, '/rest/foods/search/v1');
    assert.equal(url.searchParams.get('page_number'), '2');
    return { foods: { food: { ...food, servings: undefined, food_description: 'Per 100 g - 200 kcal' }, page_number: '2', max_results: '5', total_results: '17' } };
  }, { profile: false });
  const result = await call('search_foods', { search_expression: 'chicken', max_results: 5, page_number: 2 });
  assert.ok(!result.isError, JSON.stringify(result));
  const data = result.structuredContent!.data as any;
  assert.equal(data.search_mode, 'basic');
  assert.equal(data.foods_search.page_number, '2');
  assert.equal(data.foods_search.results.food[0].food_id, '1');
  assert.equal(data.foods_search.results.food[0].servings, undefined);
  assert.equal(requests.length, 2);
});

test('Premier search falls back only on missing scope, and never drops requested filters silently', async t => {
  let basicCalls = 0;
  const { call } = await connect(t, url => {
    if (url.pathname.endsWith('/v5')) return { error: { code: 14, message: 'premier' } };
    basicCalls++;
    return { foods: null };
  }, { scopes: 'basic premier' });
  const result = await call('search_foods', { search_expression: 'missing' });
  assert.ok(!result.isError);
  assert.deepEqual((result.structuredContent!.data as any).foods_search.results.food, []);
  assert.equal(basicCalls, 1);
  const filtered = await call('search_foods', { search_expression: 'chicken', food_type: 'generic' });
  assert.equal(filtered.isError, true);
  assert.match(JSON.stringify(filtered.content), /PREMIER_REQUIRED/);
  assert.equal(basicCalls, 1);
});

test('authorized Premier search keeps real serving identifiers and nutrition', async t => {
  const { call } = await connect(t, url => {
    assert.equal(url.pathname, '/rest/foods/search/v5');
    return { foods_search: { max_results: '1', total_results: '1', page_number: '0', results: { food } } };
  }, { scopes: 'basic premier' });
  const result = await call('search_foods', { search_expression: 'chicken' });
  assert.ok(!result.isError, JSON.stringify(result));
  const item = (result.structuredContent!.data as any).foods_search.results.food[0];
  assert.equal(item.servings.serving[0].serving_id, '11');
  assert.equal(item.servings.serving[0].metric_serving_amount, '100');
});

test('null collections and optional nutrition do not cause output-schema failures', async t => {
  const fixtures: Record<string, unknown> = {
    '/rest/food/favorites/v2': { foods: null }, '/rest/recipe/favorites/v2': { recipes: null },
    '/rest/food-entries/v2': { food_entries: null }, '/rest/saved-meals/item/v2': { saved_meal_items: null },
    '/rest/saved-meals/v2': { saved_meals: { saved_meal: { saved_meal_id: '1', saved_meal_name: 'Lunch', saved_meal_description: null, meals: null } } },
    '/rest/food/v5': { food }, '/rest/exercises/v2': { exercises: { exercise: { exercise_id: '0', exercise_name: 'Other' } } },
  };
  const { call } = await connect(t, url => fixtures[url.pathname]);
  for (const [name, args] of [['get_favorite_foods', {}], ['get_favorite_recipes', {}], ['get_food_entries', { date }],
    ['get_saved_meals', {}], ['get_saved_meal_items', { saved_meal_id: 1 }], ['get_food', { food_id: 1 }], ['get_exercises', {}]] as const) {
    const result = await call(name, args);
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
  }
});

test('unverified personal lookup is disabled and public errors never trigger it', async t => {
  const { call, requests } = await connect(t, () => ({ error: { code: 106, message: 'Invalid ID' } }));
  assert.equal((await call('get_food', { food_id: 123783004 })).isError, true);
  assert.equal(requests.length, 2);
  const result = await call('get_food', { food_id: 123783004, source: 'personal' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /PERSONAL_FOOD_UNVERIFIED/);
  assert.equal(requests.length, 2);
});

test('invalid public ID stays controlled without profile authorization', async t => {
  const { call, requests } = await connect(t, () => ({ error: { code: 106, message: 'secret signed URL' } }), { profile: false });
  const result = await call('get_food', { food_id: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /106/);
  assert.ok(!JSON.stringify(result).includes('secret signed URL'));
  assert.equal(requests.length, 2);
});

test('upstream HTTP, empty, malformed, and network errors never masquerade as empty success', async t => {
  const responses = [new Response('token=SECRET', { status: 403 }), null, { nonsense: 'SECRET' },
    new Response('not json SECRET', { status: 200 }), { error: { code: 14, message: 'SECRET' } }];
  const { call } = await connect(t, () => responses.shift());
  for (let i = 0; i < 5; i++) {
    const result = await call('get_food', { food_id: 1, source: 'public' });
    assert.equal(result.isError, true, JSON.stringify(result));
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.ok(!JSON.stringify(result).includes('Output validation error'));
  }
});

test('favorite deletion uses DELETE and barcode retains leading zeros', async t => {
  const { call } = await connect(t, (url, request) => {
    if (url.pathname === '/rest/food/favorite/v1') {
      assert.equal(request.method, 'DELETE');
      return { success: { value: '1' } };
    }
    assert.equal(url.searchParams.get('barcode'), '0012345678905');
    return { food };
  });
  assert.ok(!(await call('delete_favorite_food', { food_id: 1 })).isError);
  assert.ok(!(await call('find_food_by_barcode', { barcode: '0012345678905' })).isError);
});

test('auth status distinguishes stored authorization from unverified entitlements', async t => {
  const { call } = await connect(t, () => { throw new Error('No API call expected'); });
  const result = await call('check_auth_status');
  const data = result.structuredContent!.data as any;
  assert.equal(data.profile_authenticated, true);
  assert.equal(data.entitlements_verified, false);
  assert.equal(data.granted_scopes, null);
  assert.deepEqual(data.requested_scopes, ['basic']);
  assert.ok(!data.message.includes('All tools are available'));
});

test('invalid servings, quantities, dates, and barcodes are rejected before API calls', async t => {
  const { call, requests } = await connect(t, () => { throw new Error('No API request expected'); });
  for (const invalid of [{ serving_id: 0 }, { number_of_units: -1 }, { number_of_units: 0 }, { date: '2026-02-30' }]) {
    assert.equal((await call('create_food_entry', { ...portion, ...invalid })).isError, true);
  }
  assert.equal((await call('edit_food_entry', { food_entry_id: 1, serving_id: 0 })).isError, true);
  assert.equal((await call('find_food_by_barcode', { barcode: '123' })).isError, true);
  assert.equal(requests.length, 0);
});

class DiaryFixture {
  entries = [entry(90, { food_id: '2', serving_id: '22', food_entry_name: 'Rice', number_of_units: '1' })];
  writes: string[] = [];
  nextId = 100;
  handler: Handler = (url, request) => {
    const q = url.searchParams;
    if (url.pathname === '/rest/food-entries/v2') {
      const selected = q.has('food_entry_id') ? this.entries.filter(e => e.food_entry_id === q.get('food_entry_id'))
        : this.entries.filter(e => e.date_int === q.get('date'));
      return { food_entries: selected.length ? { food_entry: selected.length === 1 ? selected[0] : selected } : null };
    }
    if (url.pathname === '/rest/saved-meals/item/v2') return { saved_meal_items: { saved_meal_item: {
      saved_meal_item_id: '1', saved_meal_item_name: 'Chicken', food_id: '1', serving_id: '11', number_of_units: '150' } } };
    this.writes.push(`${request.method} ${url.pathname}`);
    if (url.pathname === '/rest/food-entries/copy/v1' || url.pathname === '/rest/food-entries/copy/saved-meal/v1') {
      const source = q.has('from_date') ? this.entries.filter(e => e.date_int === q.get('from_date') && (!q.has('meal') || e.meal.toLowerCase() === q.get('meal')))
        : [entry(0)];
      this.entries.push(...source.map(e => ({ ...e, food_entry_id: String(this.nextId++), date_int: q.get('to_date') ?? q.get('date')!, meal: q.get('meal') ?? e.meal })));
      return { success: { value: '1' } };
    }
    if (request.method === 'POST') {
      const units = Number(q.get('number_of_units'));
      const created = entry(this.nextId++, { date_int: q.get('date')!, number_of_units: String(units),
        calories: String(units * 2), protein: String(units * 0.2), carbohydrate: String(units * 0.1), fat: String(units * 0.05) });
      this.entries.push(created);
      return { food_entries: { food_entry: created } };
    }
    const found = this.entries.find(e => e.food_entry_id === q.get('food_entry_id'))!;
    if (request.method === 'PUT') {
      const ratio = q.has('number_of_units') ? Number(q.get('number_of_units')) / Number(found.number_of_units) : 1;
      for (const key of ['calories', 'protein', 'carbohydrate', 'fat'] as const) found[key] = String(Number(found[key]) * ratio);
      for (const key of ['number_of_units', 'serving_id', 'meal', 'food_entry_name'] as const) if (q.has(key)) found[key] = q.get(key)!;
    } else if (request.method === 'DELETE') this.entries = this.entries.filter(e => e !== found);
    return { success: { value: '1' } };
  };
}

test('diary create, retry, update, and deletion read back quantities and preserve other entries', async t => {
  const fixture = new DiaryFixture();
  const unrelated = structuredClone(fixture.entries[0]);
  const { call } = await connect(t, fixture.handler);
  const args = { ...portion, request_id: 'approved-lunch', expected_nutrition: nutrition };
  const created = await call('create_food_entry', args);
  assert.ok(!created.isError, JSON.stringify(created));
  const data = created.structuredContent!.data as any;
  assert.equal(data.verification.status, 'matched');
  assert.equal(data.food_entries.food_entry[0].calories, '300');
  assert.equal(data.food_entries.food_entry[0].number_of_units, '150');
  const id = Number(data.food_entries.food_entry[0].food_entry_id);
  const replay = await call('create_food_entry', args);
  assert.equal((replay.structuredContent!.data as any).recording_status, 'replayed');
  assert.equal(fixture.writes.length, 1);
  assert.equal((await call('create_food_entry', { ...args, number_of_units: 200 })).isError, true);
  const edited = await call('edit_food_entry', { food_entry_id: id, number_of_units: 75, expected_nutrition: { calories: 150, protein: 15, carbohydrate: 7.5, fat: 3.75 } });
  assert.ok(!edited.isError, JSON.stringify(edited));
  assert.equal((edited.structuredContent!.data as any).verification.status, 'matched');
  assert.ok(!(await call('delete_food_entry', { food_entry_id: id })).isError);
  assert.deepEqual(fixture.entries, [unrelated]);
});

test('concurrent identical portions are deduplicated, while explicit intentional duplicates remain possible', async t => {
  const fixture = new DiaryFixture();
  const { call } = await connect(t, fixture.handler);
  const results = await Promise.all([call('create_food_entry', portion), call('create_food_entry', portion)]);
  assert.ok(results.every(result => !result.isError), JSON.stringify(results));
  assert.equal(fixture.writes.length, 1);
  assert.equal((results[1].structuredContent!.data as any).recording_status, 'already_exists');
  assert.ok(!(await call('create_food_entry', { ...portion, allow_duplicate: true })).isError);
  assert.equal(fixture.writes.length, 2);
});

test('nutrition mismatches return the recorded entry and a warning without asking for another create', async t => {
  const fixture = new DiaryFixture();
  const { call } = await connect(t, fixture.handler);
  const result = await call('create_food_entry', { ...portion, expected_nutrition: { ...nutrition, calories: 999 } });
  assert.ok(!result.isError);
  assert.equal((result.structuredContent!.data as any).verification.status, 'mismatch');
  assert.match((result.structuredContent!.data as any).warning, /do not create/);
  assert.equal(fixture.writes.length, 1);
});

test('copy and saved-meal copy preserve unrelated foods and prevent duplicates', async t => {
  const fixture = new DiaryFixture();
  fixture.entries.push(entry(91, { date_int: String(dateToDays('2026-10-22')) }));
  const original = structuredClone(fixture.entries);
  const { call } = await connect(t, fixture.handler);
  const args = { from_date: '2026-10-22', to_date: date, request_id: 'repeat-lunch' };
  const copied = await call('copy_food_entries', args);
  assert.ok(!copied.isError, JSON.stringify(copied));
  assert.equal(fixture.writes.length, 1);
  assert.deepEqual(fixture.entries.slice(0, 2), original);
  assert.deepEqual((copied.structuredContent!.data as any).food_entries.food_entry.map((e: any) => [e.calories, e.protein, e.carbohydrate, e.fat]),
    [[original[1].calories, original[1].protein, original[1].carbohydrate, original[1].fat]]);
  assert.equal((copied.structuredContent!.data as any).verification.status, 'matched');
  assert.ok(!(await call('copy_food_entries', args)).isError);
  assert.equal(fixture.writes.length, 1);
  const saved = await call('copy_saved_meal_entries', { saved_meal_id: 1, date, meal: 'lunch', request_id: 'saved-lunch' });
  assert.ok(!saved.isError, JSON.stringify(saved));
  assert.equal((saved.structuredContent!.data as any).recording_status, 'already_exists');
  assert.equal(fixture.writes.length, 1);
  const newDate = await call('copy_saved_meal_entries', { saved_meal_id: 1, date: '2026-10-24', meal: 'lunch', request_id: 'tomorrow-lunch' });
  assert.ok(!newDate.isError, JSON.stringify(newDate));
  assert.equal(fixture.writes.length, 2);
  assert.equal((await call('copy_food_entries', { from_date: date, to_date: date })).isError, true);
});

test('partial copy overlaps return a controlled error before sending a write', async t => {
  const fixture = new DiaryFixture();
  fixture.entries.push(entry(91, { date_int: String(dateToDays('2026-10-22')) }), entry(92, { date_int: String(dateToDays('2026-10-22')), number_of_units: '75' }), entry(93));
  const { call } = await connect(t, fixture.handler);
  const result = await call('copy_food_entries', { from_date: '2026-10-22', to_date: date });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /PARTIAL_DUPLICATE/);
  assert.equal(fixture.writes.length, 0);
});

test('schema normalization retains absent nutrients instead of synthesizing zeros', () => {
  const data = normalizeResponse({ food: { ...food, servings: { serving: { ...food.servings.serving, iron: undefined, fiber: null } } } });
  const parsed = schemas.GetFoodOutputSchema.parse({ data });
  assert.equal(parsed.data.food.servings.serving[0].iron, undefined);
  assert.equal(parsed.data.food.servings.serving[0].fiber, null);
});

test('a network error never exposes a signed URL or retries a write automatically', async t => {
  let calls = 0;
  const { call } = await connect(t, () => { calls++; throw new Error('https://example.test/?oauth_token=SECRET'); });
  const result = await call('get_food', { food_id: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /NETWORK_ERROR/);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.equal(calls, 1);
});

test('a failed create with an uncertain response is not sent again with the same request ID', async t => {
  const fixture = new DiaryFixture();
  let writes = 0;
  const { call } = await connect(t, (url, request) => {
    if (request.method === 'POST') { writes++; throw new Error('The response was lost'); }
    return fixture.handler(url, request);
  });
  const args = { ...portion, request_id: 'lost-response' };
  assert.equal((await call('create_food_entry', args)).isError, true);
  const retry = await call('create_food_entry', args);
  assert.equal(retry.isError, true);
  assert.match(JSON.stringify(retry.content), /WRITE_OUTCOME_UNKNOWN/);
  assert.equal(writes, 1);
});

test('false success values are controlled tool errors', async t => {
  const { call } = await connect(t, () => ({ success: { value: '0' } }));
  const result = await call('delete_favorite_food', { food_id: 1 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /WRITE_REJECTED/);
});

test('concurrent public reads share one access-token request', async t => {
  const { call, requests } = await connect(t, () => ({ food }));
  const results = await Promise.all(Array.from({ length: 5 }, () => call('get_food', { food_id: 1 })));
  assert.ok(results.every(result => !result.isError));
  assert.equal(requests.filter(request => new URL(request.url).hostname === 'oauth.fatsecret.com').length, 1);
});

test('an invalid public token is renewed once for a safe read', async t => {
  let reads = 0;
  const { call, requests } = await connect(t, () => ++reads === 1 ? { error: { code: 13, message: 'expired' } } : { food });
  const result = await call('get_food', { food_id: 1 });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(reads, 2);
  assert.equal(requests.filter(request => new URL(request.url).hostname === 'oauth.fatsecret.com').length, 2);
});

test('non-scope Premier failures do not trigger a Basic fallback', async t => {
  let reads = 0;
  const { call } = await connect(t, url => {
    reads++; assert.equal(url.pathname, '/rest/foods/search/v5');
    return { error: { code: 21, message: 'SECRET' } };
  }, { scopes: 'basic premier' });
  const result = await call('search_foods', { search_expression: 'chicken' });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /IP/);
  assert.equal(reads, 1);
});

test('a later connector session reuses the journal and reads current nutrition', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-later-session-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = new DiaryFixture();
  const args = { ...portion, request_id: 'durable-lunch', expected_nutrition: nutrition };
  await t.test('first session', async session => {
    const { call } = await connect(session, fixture.handler, { directory });
    assert.ok(!(await call('create_food_entry', args)).isError);
  });
  fixture.entries.find(e => e.food_entry_id === '100')!.calories = '450';
  await t.test('later session', async session => {
    const { call } = await connect(session, fixture.handler, { directory });
    const replay = await call('create_food_entry', args);
    assert.ok(!replay.isError, JSON.stringify(replay));
    const data = replay.structuredContent!.data as any;
    assert.equal(data.recording_status, 'replayed');
    assert.equal(data.food_entries.food_entry[0].calories, '450');
    assert.equal(data.verification.status, 'mismatch');
    assert.equal(fixture.writes.length, 1);
  });
});

test('copy operations reject derived or invalid source portions before writing', async t => {
  const fixture = new DiaryFixture();
  fixture.entries.push(entry(91, { date_int: String(dateToDays('2026-10-22')), number_of_units: '0' }));
  const { call } = await connect(t, (url, request) => url.pathname === '/rest/saved-meals/item/v2'
    ? { saved_meal_items: { saved_meal_item: { saved_meal_item_id: '1', saved_meal_item_name: 'Invalid', food_id: '1', serving_id: '0', number_of_units: '1' } } }
    : fixture.handler(url, request));
  for (const [name, args] of [['copy_food_entries', { from_date: '2026-10-22', to_date: date }],
    ['copy_saved_meal_entries', { saved_meal_id: 1, date, meal: 'lunch' }]] as const) {
    const result = await call(name, args);
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /INVALID_COPY_SOURCE/);
  }
  assert.equal(fixture.writes.length, 0);
});


test('personal discovery merges IDs, handles empty sources, and reports failed sources', async t => {
  const { call } = await connect(t, url => {
    if (url.pathname === '/rest/food/most-eaten/v2') return { error: { code: 14, message: 'unavailable' } };
    if (url.pathname === '/rest/saved-meals/v2') return { saved_meals: null };
    return { foods: { food: { food_id: '1', food_name: 'Chicken', food_type: 'Generic', food_url: 'https://example.test/food' } } };
  });
  const result = await call('search_personal_foods', { query: 'chicken' });
  assert.ok(!result.isError, JSON.stringify(result));
  const data = result.structuredContent!.data as any;
  assert.equal(data.matches.length, 1);
  assert.deepEqual(data.matches[0].sources, ['favorites', 'recent']);
  assert.deepEqual(data.unavailable_sources, [{ source: 'frequent', code: '14' }]);
  assert.equal(data.incomplete, true);
});

test('references validate serving IDs and get fresh nutrition through the actual MCP server', async t => {
  let calories = '200';
  const { call } = await connect(t, url => {
    assert.equal(url.pathname, '/rest/food/v5');
    return { food: { ...food, servings: { serving: { ...food.servings.serving, calories } } } };
  });
  const args = { name: 'Food Box entrée', notes: 'Excludes separately logged rice.', approved: true,
    parts: [{ food_id: 1, serving_id: 11, number_of_units: 150 }] };
  assert.equal((await call('save_food_reference', { ...args, approved: false })).isError, true);
  assert.equal((await call('save_food_reference', { ...args, parts: [{ food_id: 1, serving_id: 999, number_of_units: 150 }] })).isError, true);
  assert.ok(!(await call('save_food_reference', args)).isError);
  calories = '240';
  const result = await call('get_food_reference', { name: 'food box entrée' });
  assert.ok(!result.isError, JSON.stringify(result));
  const data = result.structuredContent!.data as any;
  assert.equal(data.totals.calories, 360);
  assert.equal(data.parts[0].measurement_description, 'g');
});

test('custom creation sends no request while visibility is unverified', async t => {
  const { call, requests } = await connect(t, () => { throw new Error('No API request expected'); });
  const result = await call('create_food', { food_name: 'Test', brand_name: 'Test', serving_size: '1 serving', calories: 10, protein: 1, carbohydrate: 1, fat: 0.2 });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /CUSTOM_FOOD_UNVERIFIED/);
  assert.equal(requests.length, 0);
});


test('food detail options survive connector routing', async t => {
  const { call } = await connect(t, url => {
    assert.equal(url.searchParams.get('region'), 'FR');
    assert.equal(url.searchParams.get('include_food_images'), 'true');
    return { food };
  });
  assert.ok(!(await call('get_food', { food_id: 1, region: 'FR', include_food_images: true })).isError);
});
