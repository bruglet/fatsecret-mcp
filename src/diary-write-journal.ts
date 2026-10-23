import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { FatSecretApiError } from './api-response.js';

interface WriteOutcome { entryIds: string[]; duplicate: boolean }
interface JournalEntry extends WriteOutcome { fingerprint: string; status: 'pending' | 'complete' }

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Persist identifiers only. A pending request is never blindly retried after a crash. */
export class DiaryWriteJournal {
  constructor(private readonly directory: string) {}

  async run(account: string, requestId: string | undefined, operation: string, payload: unknown,
    write: () => Promise<WriteOutcome>): Promise<WriteOutcome & { replayed: boolean }> {
    if (!requestId) return { ...await write(), replayed: false };
    const directory = join(this.directory, 'diary-requests', hash(account));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${hash(requestId)}.json`);
    const fingerprint = hash(JSON.stringify({ operation, payload }));
    let descriptor: number;
    try {
      descriptor = openSync(path, 'wx', 0o600);
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') {
        throw new FatSecretApiError('JOURNAL_UNAVAILABLE', 'The write journal is unavailable. No new write was sent. Check persistent storage permissions.');
      }
      let previous: JournalEntry;
      try { previous = JSON.parse(readFileSync(path, 'utf8')); } catch {
        throw new FatSecretApiError('JOURNAL_INVALID', 'The previous request record is unreadable. Read the diary before attempting another write.');
      }
      if (previous.fingerprint !== fingerprint) {
        throw new FatSecretApiError('REQUEST_ID_CONFLICT', 'This request_id belongs to different arguments. Inspect the diary, then use a new ID for an intentional new operation.');
      }
      if (previous.status !== 'complete' || typeof previous.duplicate !== 'boolean' || !Array.isArray(previous.entryIds) || previous.entryIds.some(id => !/^\d+$/.test(id))) {
        throw new FatSecretApiError('WRITE_OUTCOME_UNKNOWN', 'The previous request can have reached FatSecret. Read the diary and reconcile it before using a new request_id.');
      }
      return { entryIds: previous.entryIds, duplicate: previous.duplicate, replayed: true };
    }
    try {
      writeFileSync(descriptor, JSON.stringify({ fingerprint, status: 'pending', entryIds: [], duplicate: false }));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    const outcome = await write();
    const temporary = `${path}.${randomUUID()}.tmp`;
    const completed = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(completed, JSON.stringify({ fingerprint, status: 'complete', ...outcome }));
      fsyncSync(completed);
    } finally { closeSync(completed); }
    renameSync(temporary, path);
    return { ...outcome, replayed: false };
  }
}
