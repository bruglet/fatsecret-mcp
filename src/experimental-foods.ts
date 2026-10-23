import { createHash, randomUUID } from 'node:crypto';
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync, renameSync, fsyncSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { FatSecretApiError } from './api-response.js';
import { resolvePortion, type FoodDetail } from './food-references.js';

interface Creation {
  food_name: string; brand_name: string; serving_size: string;
  calories: number; protein: number; carbohydrate: number; fat: number;
  serving_amount?: string; serving_amount_unit?: string;
  request_id?: string; allow_unverified_visibility?: boolean;
  region?: string; language?: string;
}
interface Api {
  account: () => string;
  create: (args: Omit<Creation, 'request_id' | 'allow_unverified_visibility'>) => Promise<string>;
  read: (id: number, options?: Record<string, string | number | boolean | undefined>) => Promise<FoodDetail>;
}
interface RecordState { fingerprint: string; status: 'pending' | 'created'; food_id?: string }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const fail = (code: string, message: string): never => { throw new FatSecretApiError(code, message); };
const validId = (id: unknown): id is string => typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

/** Isolated hypotheses: user-signed details and custom-food round trips. Disabled by default. */
export class ExperimentalFoods {
  constructor(private readonly directory: string, private readonly api: Api,
    readonly enabled = process.env.FATSECRET_ENABLE_EXPERIMENTAL_FOODS === 'true') {}

  async read(id: number, options?: Record<string, string | number | boolean | undefined>): Promise<FoodDetail> {
    if (!this.enabled) fail('PERSONAL_FOOD_UNVERIFIED', 'Signed personal-food lookup is disabled. API behavior requires disposable-profile verification.');
    const account = this.api.account();
    const food = await this.api.read(id, options);
    if (account !== this.api.account()) fail('ACCOUNT_CHANGED', 'Profile authorization changed during signed lookup. Repeat the request for the current account.');
    return food;
  }

  async create(input: Creation) {
    if (!this.enabled) fail('CUSTOM_FOOD_UNVERIFIED', 'Custom-food creation is disabled. No request was sent. API visibility and retrieval require disposable-profile verification.');
    if (!input.allow_unverified_visibility || !input.request_id?.trim()) {
      fail('EXPERIMENTAL_CONSENT_REQUIRED', 'Use an authorized disposable profile, allow_unverified_visibility=true, and a stable request_id. Privacy is not verified. No request was sent.');
    }
    if (!input.serving_amount?.trim() || !Number.isFinite(Number(input.serving_amount)) || Number(input.serving_amount) <= 0
      || !['g', 'ml'].includes(input.serving_amount_unit ?? '')) {
      fail('STANDARD_QUANTITY_REQUIRED', 'Experimental round trips require an explicit positive serving_amount and serving_amount_unit of g or ml. No request was sent.');
    }
    const account = this.api.account();
    const { request_id, allow_unverified_visibility: consent, ...payload } = input;
    void consent;
    const fingerprint = hash(JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))));
    const directory = join(this.directory, 'experimental-foods', hash(account));
    try { mkdirSync(directory, { recursive: true, mode: 0o700 }); } catch { this.storageFailure(); }
    // The request mapping prevents changed arguments; the payload key prevents identical foods across new request IDs.
    const requestPath = join(directory, `request-${hash(request_id!)}.json`);
    const request = { fingerprint };
    if (!this.reserve(requestPath, request)) {
      if (this.readRecord(requestPath).fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT', 'This request_id belongs to different food data. Inspect the previous request before proceeding.');
    }
    const path = join(directory, `food-${fingerprint}.json`);
    let record: RecordState = { fingerprint, status: 'pending' };
    const fresh = this.reserve(path, record);
    if (!fresh) {
      record = this.readRecord(path);
      if (record.fingerprint !== fingerprint || record.status !== 'created' || !validId(record.food_id)) {
        fail('FOOD_WRITE_OUTCOME_UNKNOWN', 'A previous creation can have reached FatSecret. Inspect the test profile before creating another food. This request will not repeat the POST.');
      }
    } else {
      // Persist pending before sending the write. A timeout remains pending and cannot be retried blindly.
      const food_id = await this.api.create(payload);
      if (!validId(food_id)) fail('FOOD_WRITE_OUTCOME_UNKNOWN', 'The create response has no valid food ID. Inspect the test profile before another creation attempt.');
      record = { fingerprint, status: 'created', food_id };
      this.replace(path, record);
    }
    const food_id = record.food_id!;
    if (account !== this.api.account()) fail('ACCOUNT_CHANGED', `Authorization changed after creating food ${food_id}. Inspect the original test profile; do not create it again.`);
    let food: FoodDetail;
    try { food = await this.read(Number(food_id), { region: payload.region, language: payload.language }); } catch (error) {
      const code = error instanceof FatSecretApiError ? String(error.code) : 'READ_FAILED';
      fail('FOOD_CREATED_UNVERIFIED', `Food ${food_id} exists in the creation journal, but lookup failed (${code}). Reuse this request_id to retry verification without creating it again.`);
    }
    if (String(food!.food_id) !== food_id || food!.food_name.trim().toLowerCase() !== payload.food_name.trim().toLowerCase()
      || food!.brand_name?.trim().toLowerCase() !== payload.brand_name.trim().toLowerCase()) {
      fail('FOOD_CREATED_UNVERIFIED', `Food ${food_id} did not match the requested identity. Inspect it; do not recreate it.`);
    }
    // Require the originally submitted standardized quantity; derived serving 0 is never a candidate.
    const serving = food!.servings?.serving.find(item => Number(item.serving_id) > 0 && Number.isSafeInteger(Number(item.serving_id))
      && item.metric_serving_unit === payload.serving_amount_unit && item.metric_serving_amount != null
      && Math.abs(Number(item.metric_serving_amount) - Number(payload.serving_amount)) <= 1e-6);
    if (!serving) fail('FOOD_CREATED_UNVERIFIED', `Food ${food_id} has no verified real serving for the submitted standardized quantity. Inspect it; do not recreate it.`);
    let portion;
    try {
      portion = resolvePortion({ food_id: Number(food_id), serving_id: Number(serving!.serving_id), number_of_units: Number(serving!.number_of_units) }, food!);
    } catch { fail('FOOD_CREATED_UNVERIFIED', `Food ${food_id} has incomplete serving nutrition. Reuse this request_id to retry lookup without creating another food.`); }
    const differences = Object.fromEntries((['calories', 'protein', 'carbohydrate', 'fat'] as const).map(key => [key, portion!.nutrition[key] - payload[key]]));
    const matched = Math.abs(differences.calories) <= 1 + 1e-9 && ['protein', 'carbohydrate', 'fat'].every(key => Math.abs(differences[key]) <= 0.1 + 1e-9);
    if (!matched) fail('FOOD_NUTRITION_MISMATCH', `Food ${food_id} was created, but retrieved nutrition differs from the request beyond rounding tolerance. Inspect it; do not create it again.`);
    return { food_id: { value: food_id }, serving_id: { value: String(serving!.serving_id) }, number_of_units: portion!.number_of_units,
      visibility: 'unverified' as const, replayed: !fresh,
      verification: { nutrition: portion!.nutrition, differences, tolerance: { calories: 1, grams: 0.1 }, matched: true } };
  }

  private reserve(path: string, value: unknown): boolean {
    let descriptor: number;
    try { descriptor = openSync(path, 'wx', 0o600); } catch (error) {
      if ((error as { code?: string }).code === 'EEXIST') return false;
      return this.storageFailure();
    }
    try { writeFileSync(descriptor, JSON.stringify(value)); fsyncSync(descriptor); } catch { this.storageFailure(); }
    finally { closeSync(descriptor); }
    return true;
  }
  private readRecord(path: string): RecordState {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (!value || typeof value !== 'object' || typeof value.fingerprint !== 'string') throw new Error();
      return value;
    } catch { return fail('FOOD_JOURNAL_INVALID', 'A creation journal record is unreadable. Inspect the test profile before retrying.'); }
  }
  private replace(path: string, value: RecordState): void {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      this.reserve(temporary, value);
      renameSync(temporary, path);
    } catch { this.storageFailure(); }
    finally { try { unlinkSync(temporary); } catch { /* Renamed or never created. */ } }
  }
  private storageFailure(): never { return fail('FOOD_JOURNAL_UNAVAILABLE', 'Cannot persist the creation journal. Inspect the test profile before retrying a creation.'); }
}
