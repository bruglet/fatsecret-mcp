import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiaryWriteJournal } from '../src/diary-write-journal.js';

test('a completed write survives a new journal instance and stores only hashed intent and IDs', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const write = async () => { calls++; return { entryIds: ['123'], duplicate: false }; };
  const args = ['private-profile-token', 'approved-request', 'create', { calories: 999.73, food_name: 'Private Lunch' }, write] as const;
  await new DiaryWriteJournal(directory).run(...args);
  const replay = await new DiaryWriteJournal(directory).run(...args);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.entryIds, ['123']);
  assert.equal(calls, 1);
  const account = join(directory, 'diary-requests', readdirSync(join(directory, 'diary-requests'))[0]);
  const path = join(account, readdirSync(account)[0]);
  const contents = readFileSync(path, 'utf8');
  assert.ok(!/private-profile-token|approved-request|Private Lunch|999.73/.test(contents));
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('identical request IDs remain separate for different accounts and reject different intent', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const journal = new DiaryWriteJournal(directory);
  let calls = 0;
  const write = async () => ({ entryIds: [String(++calls)], duplicate: false });
  await journal.run('account-a', 'same-id', 'create', { quantity: 1 }, write);
  await journal.run('account-b', 'same-id', 'create', { quantity: 1 }, write);
  assert.equal(calls, 2);
  await assert.rejects(journal.run('account-a', 'same-id', 'create', { quantity: 2 }, write), /REQUEST_ID_CONFLICT/);
  assert.equal(calls, 2);
});

test('uncertain failures and concurrent processes cannot send a second write for the same ID', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fatsecret-journal-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const write = async () => { calls++; throw new Error('Unknown upstream outcome'); };
  await assert.rejects(new DiaryWriteJournal(directory).run('account', 'uncertain', 'create', {}, write));
  await assert.rejects(new DiaryWriteJournal(directory).run('account', 'uncertain', 'create', {}, write), /WRITE_OUTCOME_UNKNOWN/);
  assert.equal(calls, 1);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const pending = new DiaryWriteJournal(directory).run('account', 'concurrent', 'copy', {}, async () => {
    calls++; await gate; return { entryIds: ['321'], duplicate: false };
  });
  await assert.rejects(new DiaryWriteJournal(directory).run('account', 'concurrent', 'copy', {}, write), /WRITE_OUTCOME_UNKNOWN/);
  finish(); await pending;
  assert.equal(calls, 2);
});
