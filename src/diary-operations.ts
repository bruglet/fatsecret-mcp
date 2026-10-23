import { FatSecretApiError } from './api-response.js';
import { dateToDays } from './food-diary.js';
import { DiaryWriteJournal } from './diary-write-journal.js';

type Nutrition = { calories: number; protein: number; carbohydrate: number; fat: number };
type Meal = 'breakfast' | 'lunch' | 'dinner' | 'other';
interface Portion { food_id: string | number; serving_id: string | number; number_of_units: string | number }
export interface DiaryEntry extends Portion {
  food_entry_id: string | number; date_int: string | number; meal: string; food_entry_name: string;
  calories: string | number; protein: string | number; carbohydrate: string | number; fat: string | number;
}
interface WriteOptions { request_id?: string; allow_duplicate?: boolean }
interface CreateArgs extends WriteOptions {
  food_id: number; serving_id: number; number_of_units: number; food_entry_name: string;
  meal: Meal; date?: string; expected_nutrition?: Nutrition;
}
interface EditArgs {
  food_entry_id: number; serving_id?: number; number_of_units?: number; food_entry_name?: string;
  meal?: Meal; expected_nutrition?: Nutrition;
}
interface CopyArgs extends WriteOptions { from_date: string; to_date: string; meal?: Meal }
interface SavedArgs extends WriteOptions { saved_meal_id: number; date?: string; meal: Meal }

export interface DiaryApi {
  account(): string;
  read(date?: string, id?: number): Promise<DiaryEntry[]>;
  create(args: Omit<CreateArgs, keyof WriteOptions | 'expected_nutrition'>): Promise<DiaryEntry[]>;
  edit(args: Omit<EditArgs, 'expected_nutrition'>): Promise<void>;
  delete(id: number): Promise<void>;
  copy(args: Omit<CopyArgs, keyof WriteOptions>): Promise<void>;
  copySaved(args: Omit<SavedArgs, keyof WriteOptions>): Promise<void>;
  readSaved(id: number): Promise<Portion[]>;
}

const today = () => new Date().toISOString().slice(0, 10);
const samePortion = (left: Portion, right: Portion) => String(left.food_id) === String(right.food_id)
  && String(left.serving_id) === String(right.serving_id)
  && Math.abs(Number(left.number_of_units) - Number(right.number_of_units)) < 1e-9;
const entryData = (entries: DiaryEntry[]) => ({ food_entries: { food_entry: entries } });

function verifyNutrition(entries: DiaryEntry[], expected?: Nutrition) {
  const differences: string[] = [];
  if (expected) {
    for (const key of ['calories', 'protein', 'carbohydrate', 'fat'] as const) {
      const actual = entries.reduce((sum, entry) => sum + Number(entry[key]), 0);
      // Permit API rounding, but expose meaningful differences without changing the user's records.
      const tolerance = (key === 'calories' ? 1 : 0.05) + expected[key] * 0.005;
      if (!Number.isFinite(actual) || Math.abs(actual - expected[key]) > tolerance) differences.push(key);
    }
  }
  return {
    verification: { status: differences.length ? 'mismatch' : 'matched', nutrition_compared: !!expected, differences },
    ...(differences.length ? { warning: 'The food is recorded, but retrieved nutrition differs from the approved estimate. Inspect these entries; do not create them again.' } : {}),
  };
}

/** Serialize local diary changes. Keep retries durable when a caller supplies request_id. */
export class DiaryOperations {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly journal: DiaryWriteJournal;

  constructor(private readonly api: DiaryApi, directory: string) { this.journal = new DiaryWriteJournal(directory); }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async readRecorded(ids: string[]) {
    const entries: DiaryEntry[] = [];
    for (const id of ids) {
      const found = (await this.api.read(undefined, Number(id))).find(entry => String(entry.food_entry_id) === id);
      if (!found) throw new FatSecretApiError('RECORDED_ENTRY_UNAVAILABLE', 'A completed write references an unavailable entry. Inspect the diary before intentionally creating a replacement.');
      entries.push(found);
    }
    return entries;
  }

  create(args: CreateArgs) {
    return this.serialize(async () => {
      const { request_id, allow_duplicate, expected_nutrition, date = today(), ...portion } = args;
      const payload = { ...portion, date, allow_duplicate: !!allow_duplicate, expected_nutrition };
      const outcome = await this.journal.run(this.api.account(), request_id, 'create', payload, async () => {
        const existing = (await this.api.read(date)).find(entry => samePortion(entry, portion)
          && entry.meal.toLowerCase() === portion.meal && Number(entry.date_int) === dateToDays(date));
        if (existing && !allow_duplicate) return { entryIds: [String(existing.food_entry_id)], duplicate: true };
        const created = await this.api.create({ ...portion, date });
        if (created.length !== 1) throw new FatSecretApiError('WRITE_OUTCOME_UNKNOWN', 'The create response omitted the new entry ID. Read the diary before retrying.');
        return { entryIds: [String(created[0].food_entry_id)], duplicate: false };
      });
      const entries = await this.readRecorded(outcome.entryIds);
      if (entries.some(entry => !samePortion(entry, portion) || Number(entry.date_int) !== dateToDays(date) || entry.meal.toLowerCase() !== portion.meal)) {
        throw new FatSecretApiError('WRITE_VERIFICATION_FAILED', `The recorded entry ${outcome.entryIds.join(', ')} differs from the requested food, serving, date, meal, or quantity. Inspect it; do not log again.`);
      }
      return { ...entryData(entries), recording_status: outcome.replayed ? 'replayed' : outcome.duplicate ? 'already_exists' : 'created', ...verifyNutrition(entries, expected_nutrition) };
    });
  }

  edit(args: EditArgs) {
    return this.serialize(async () => {
      const { expected_nutrition, ...update } = args;
      const [before] = await this.readRecorded([String(args.food_entry_id)]);
      await this.api.edit(update);
      const [after] = await this.readRecorded([String(args.food_entry_id)]);
      const expected = { ...before, ...update };
      if (!samePortion(after, expected) || Number(after.date_int) !== Number(before.date_int)
        || after.meal.toLowerCase() !== expected.meal.toLowerCase() || after.food_entry_name !== expected.food_entry_name) {
        throw new FatSecretApiError('WRITE_VERIFICATION_FAILED', `Entry ${args.food_entry_id} differs from the requested update. Read the entry before retrying.`);
      }
      return { success: { value: '1' }, ...entryData([after]), ...verifyNutrition([after], expected_nutrition) };
    });
  }

  delete(id: number) {
    return this.serialize(async () => {
      const [before] = await this.readRecorded([String(id)]);
      await this.api.delete(id);
      const date = new Date(Number(before.date_int) * 86_400_000).toISOString().slice(0, 10);
      if ((await this.api.read(date)).some(entry => String(entry.food_entry_id) === String(id))) {
        throw new FatSecretApiError('WRITE_VERIFICATION_FAILED', `Entry ${id} is still present. Inspect it before retrying deletion.`);
      }
      return { success: { value: '1' }, deleted_food_entry_id: id };
    });
  }

  copy(args: CopyArgs) {
    return this.serialize(async () => {
      if (args.from_date === args.to_date) throw new FatSecretApiError('SAME_DATE_COPY', 'Source and destination dates must differ.');
      return this.copyEntries('copy', args, args.to_date, args.meal,
        async () => (await this.api.read(args.from_date)).filter(entry => !args.meal || entry.meal.toLowerCase() === args.meal),
        () => this.api.copy({ from_date: args.from_date, to_date: args.to_date, meal: args.meal }));
    });
  }

  copySaved(args: SavedArgs) {
    return this.serialize(() => {
      const payload = { ...args, date: args.date ?? today() };
      return this.copyEntries('copy_saved', payload, payload.date, args.meal,
        () => this.api.readSaved(args.saved_meal_id),
        () => this.api.copySaved({ saved_meal_id: args.saved_meal_id, date: payload.date, meal: args.meal }));
    });
  }

  private async copyEntries(operation: string, args: WriteOptions, date: string, meal: string | undefined,
    source: () => Promise<Portion[]>, copy: () => Promise<void>) {
    const { request_id, ...intent } = args;
    const payload = { ...intent, allow_duplicate: !!args.allow_duplicate };
    let expectedNutrition: Nutrition | undefined;
    const outcome = await this.journal.run(this.api.account(), request_id, operation, payload, async () => {
      const expected = await source();
      if (expected.some(item => !Number.isSafeInteger(Number(item.food_id)) || Number(item.food_id) <= 0
        || !Number.isSafeInteger(Number(item.serving_id)) || Number(item.serving_id) <= 0
        || !Number.isFinite(Number(item.number_of_units)) || Number(item.number_of_units) <= 0)) {
        throw new FatSecretApiError('INVALID_COPY_SOURCE', 'A source item has an invalid food ID, derived serving ID 0, or invalid quantity. Resolve a real serving with get_food before copying.');
      }
      if (expected.length && expected.every(item => ['calories', 'protein', 'carbohydrate', 'fat'].every(key => key in item))) {
        expectedNutrition = Object.fromEntries(['calories', 'protein', 'carbohydrate', 'fat'].map(key => [key, expected.reduce((sum, item) => sum + Number((item as unknown as Record<string, unknown>)[key]), 0)])) as Nutrition;
      }
      const before = await this.api.read(date);
      const select = (candidates: DiaryEntry[]) => {
        const available = [...candidates];
        const selected: DiaryEntry[] = [];
        for (const portion of expected) {
          const expectedMeal = meal ?? ('meal' in portion ? String(portion.meal).toLowerCase() : undefined);
          const index = available.findIndex(entry => samePortion(entry, portion) && entry.meal.toLowerCase() === expectedMeal && Number(entry.date_int) === dateToDays(date));
          if (index >= 0) selected.push(...available.splice(index, 1));
        }
        return selected;
      };
      const existing = select(before);
      if (!args.allow_duplicate && existing.length > 0) {
        if (existing.length !== expected.length) throw new FatSecretApiError('PARTIAL_DUPLICATE', 'Some source items already exist at the destination. Inspect the diary before copying, or explicitly allow an intentional duplicate.');
        return { entryIds: existing.map(entry => String(entry.food_entry_id)), duplicate: true };
      }
      if (!expected.length) return { entryIds: [], duplicate: false };
      await copy();
      const previousIds = new Set(before.map(entry => String(entry.food_entry_id)));
      const copied = select((await this.api.read(date)).filter(entry => !previousIds.has(String(entry.food_entry_id))));
      if (copied.length !== expected.length) throw new FatSecretApiError('WRITE_OUTCOME_UNKNOWN', 'The copy did not produce all expected entries. Read the destination diary before retrying; existing entries were not deleted.');
      return { entryIds: copied.map(entry => String(entry.food_entry_id)), duplicate: false };
    });
    const entries = await this.readRecorded(outcome.entryIds);
    return { success: { value: '1' }, ...entryData(entries), recording_status: outcome.replayed ? 'replayed' : outcome.duplicate ? 'already_exists' : 'copied', ...verifyNutrition(entries, expectedNutrition) };
  }
}
