import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FatSecretApiError } from './api-response.js';
import { text } from './tool-output.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const positive = z.number().finite().positive();
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const PartSchema = z.object({ food_id: id, serving_id: id, number_of_units: positive }).strict();
const DraftSchema = z.object({
  name: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2000).default(''),
  parts: z.array(PartSchema).min(1).max(50).refine(parts => new Set(parts.map(part => `${part.food_id}:${part.serving_id}`)).size === parts.length, 'Combine repeated food/serving pairs into one quantity.'),
}).strict();
const ReferenceSchema = DraftSchema.extend({ revision: z.string().uuid() });
export type FoodReference = z.infer<typeof ReferenceSchema>;
type Part = z.infer<typeof PartSchema>;
const CoreNutrients = ['calories', 'protein', 'carbohydrate', 'fat'] as const;
const NutritionSchema = z.object({ calories: z.number().finite().nonnegative(), protein: z.number().finite().nonnegative(), carbohydrate: z.number().finite().nonnegative(), fat: z.number().finite().nonnegative() });
export interface FoodDetail {
  food_id: string | number; food_name: string;
  servings?: { serving: { serving_id: string | number; number_of_units?: string | number | null;
    measurement_description?: string | null; serving_description?: string | null;
    calories?: string | number | null; protein?: string | number | null;
    carbohydrate?: string | number | null; fat?: string | number | null }[] } | null;
}

/** Store user-authored labels and identifiers, never downloaded food nutrition. */
export class FoodReferences {
  constructor(private readonly root: string, private readonly account: () => string) {}
  scope(): string { return hash(this.account()); }
  private directory() { return join(this.root, 'food-references', this.scope()); }
  private read(path: string): FoodReference | undefined {
    try { return ReferenceSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined;
      throw new FatSecretApiError('REFERENCE_INVALID', 'A saved reference is unreadable. Restore its file from backup before changing it.');
    }
  }
  private path(name: string) { return join(this.directory(), `${hash(normalize(name))}.json`); }
  get(name: string): FoodReference {
    const reference = this.read(this.path(name));
    if (!reference) throw new FatSecretApiError('REFERENCE_NOT_FOUND', 'No saved reference has this name in the authorized account.');
    return reference;
  }
  list(): FoodReference[] {
    // Only hashed reference files; lock and temporary files are excluded.
    return this.files().map(file => this.read(join(this.directory(), file))).filter((item): item is FoodReference => !!item);
  }
  private files(): string[] {
    try { return readdirSync(this.directory()).filter(file => /^[a-f0-9]{64}\.json$/.test(file)); } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return [];
      throw new FatSecretApiError('REFERENCE_STORAGE_UNAVAILABLE', 'Cannot read the reference directory. Check persistent storage permissions.');
    }
  }
  private change<T>(name: string, action: (path: string) => T): T {
    mkdirSync(this.directory(), { recursive: true, mode: 0o700 });
    const path = this.path(name);
    let descriptor: number;
    try { descriptor = openSync(`${path}.lock`, 'wx', 0o600); } catch {
      throw new FatSecretApiError('REFERENCE_BUSY', 'This reference is locked or storage is unavailable. Check storage and unfinished requests before retrying.');
    }
    try { return action(path); } finally { closeSync(descriptor); unlinkSync(`${path}.lock`); }
  }
  save(draft: z.input<typeof DraftSchema>, expectedRevision?: string): FoodReference {
    const value = DraftSchema.parse(draft);
    return this.change(value.name, path => {
      const previous = this.read(path);
      if (expectedRevision !== undefined && previous?.revision !== expectedRevision) this.conflict();
      if (previous && JSON.stringify(DraftSchema.parse({ name: previous.name, notes: previous.notes, parts: previous.parts })) === JSON.stringify(value)) return previous;
      if (previous && expectedRevision === undefined) this.conflict();
      const reference = { ...value, revision: randomUUID() };
      const temporary = `${path}.${randomUUID()}.tmp`;
      const descriptor = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(descriptor, JSON.stringify(reference)); fsyncSync(descriptor); } finally { closeSync(descriptor); }
      try { renameSync(temporary, path); } finally { try { unlinkSync(temporary); } catch { /* Renamed successfully. */ } }
      return reference;
    });
  }
  delete(name: string, revision: string): void {
    this.change(name, path => {
      const previous = this.read(path);
      if (!previous || previous.revision !== revision) this.conflict();
      unlinkSync(path);
    });
  }
  private conflict(): never { throw new FatSecretApiError('REFERENCE_CONFLICT', 'Read the current reference and approve the change again. Use its revision to replace or delete it.'); }
}

export function resolvePortion(part: Part, food: FoodDetail) {
  if (String(food.food_id) !== String(part.food_id)) throw new FatSecretApiError('FOOD_ID_MISMATCH', 'Food details do not match the requested food ID.');
  const serving = food.servings?.serving.find(item => String(item.serving_id) === String(part.serving_id));
  const baseline = serving?.number_of_units;
  if (!serving || baseline == null || !Number.isFinite(Number(baseline)) || Number(baseline) <= 0 || !serving.measurement_description?.trim()) {
    throw new FatSecretApiError('SERVING_UNVERIFIED', 'The selected serving lacks a valid quantity or measurement unit. Choose another verified serving.');
  }
  const factor = part.number_of_units / Number(baseline);
  const nutrition = Object.fromEntries(CoreNutrients.map(key => {
    const value = serving[key];
    if (value == null || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new FatSecretApiError('NUTRITION_UNAVAILABLE', `The selected serving has no valid ${key} value. Do not treat missing nutrition as zero.`);
    }
    return [key, Number(value) * factor];
  }));
  return { ...part, food_name: food.food_name, measurement_description: serving.measurement_description,
    serving_description: serving.serving_description ?? null, nutrition: NutritionSchema.parse(nutrition) };
}

const ReferenceOutput = z.object({ data: ReferenceSchema });
const CandidateSchema = z.object({ kind: z.enum(['food', 'saved_meal', 'reference']), name: z.string(),
  food_id: z.string().optional(), saved_meal_id: z.string().optional(), reference_name: z.string().optional(),
  sources: z.array(z.string()) });
export type PersonalCandidate = z.infer<typeof CandidateSchema>;
export interface PersonalSource { name: string; read: () => Promise<PersonalCandidate[]> }
interface Dependencies { store: FoodReferences; food: (id: number) => Promise<FoodDetail>; sources: PersonalSource[] }

export function registerFoodReferenceTools(server: McpServer, deps: Dependencies): void {
  const resolve = async (parts: Part[]) => {
    const account = deps.store.scope();
    const details = new Map<number, Promise<FoodDetail>>();
    const portions = await Promise.all(parts.map(async part => {
      if (!details.has(part.food_id)) details.set(part.food_id, deps.food(part.food_id));
      return resolvePortion(part, await details.get(part.food_id)!);
    }));
    if (account !== deps.store.scope()) throw new FatSecretApiError('ACCOUNT_CHANGED', 'Profile authorization changed during this request. Repeat the preview for the current account.');
    return portions;
  };
  server.registerTool('search_personal_foods', {
    description: 'Search approved local references, favorites, recent foods, frequent foods, and saved-meal names before public search. Results are incomplete personal discovery, not a full custom-food listing. Fetch food details or saved-meal items before logging. Reports unavailable sources.',
    inputSchema: { query: z.string().trim().min(1).max(160), max_results: z.number().int().min(1).max(50).default(20) },
    outputSchema: z.object({ data: z.object({ matches: z.array(CandidateSchema), incomplete: z.literal(true), unavailable_sources: z.array(z.object({ source: z.string(), code: z.string() })) }) }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ query, max_results }) => {
    const account = deps.store.scope();
    const local = deps.store.list().map(item => ({ kind: 'reference' as const, name: item.name, reference_name: item.name, sources: ['local_reference'] }));
    const outcomes = await Promise.allSettled(deps.sources.map(source => source.read()));
    if (account !== deps.store.scope()) throw new FatSecretApiError('ACCOUNT_CHANGED', 'Profile authorization changed during personal discovery. Repeat the search.');
    const unavailable_sources: { source: string; code: string }[] = [];
    const candidates: PersonalCandidate[] = [...local];
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') candidates.push(...outcome.value);
      else unavailable_sources.push({ source: deps.sources[index].name, code: outcome.reason instanceof FatSecretApiError ? String(outcome.reason.code) : 'SOURCE_UNAVAILABLE' });
    });
    const terms = normalize(query).split(' ');
    const matches = new Map<string, PersonalCandidate>();
    for (const candidate of candidates) {
      if (!terms.every(term => normalize(candidate.name).includes(term))) continue;
      const key = `${candidate.kind}:${candidate.food_id ?? candidate.saved_meal_id ?? normalize(candidate.name)}`;
      const previous = matches.get(key);
      if (previous) previous.sources = [...new Set([...previous.sources, ...candidate.sources])];
      else matches.set(key, { ...candidate, sources: [...candidate.sources] });
    }
    return text({ matches: [...matches.values()].sort((a, b) => Number(normalize(b.name) === normalize(query)) - Number(normalize(a.name) === normalize(query)) || a.name.localeCompare(b.name)).slice(0, max_results), incomplete: true, unavailable_sources });
  });
  server.registerTool('save_food_reference', {
    description: 'Save an approved reusable label, notes and verified food/serving/quantity references locally for this authorized account. No custom food or diary entry is created. Existing references require expected_revision for changes. Never save speculative portions without approval.',
    inputSchema: { ...DraftSchema.shape, approved: z.literal(true), expected_revision: z.string().uuid().optional() },
    outputSchema: ReferenceOutput,
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name, notes, parts, expected_revision }) => {
    const draft = { name, notes, parts };
    await resolve(parts);
    return text(deps.store.save(draft, expected_revision));
  });
  server.registerTool('get_food_reference', {
    description: 'Retrieve an approved reference with fresh FatSecret serving nutrition and totals. Quantity uses the serving measurement unit; no downloaded nutrition is cached. Failure to resolve any part stops the estimate. Does not log food.',
    inputSchema: { name: z.string().trim().min(1).max(160) },
    outputSchema: z.object({ data: z.object({ reference: ReferenceSchema, parts: z.array(PartSchema.extend({ food_name: z.string(), measurement_description: z.string(), serving_description: z.string().nullable(), nutrition: NutritionSchema })), totals: NutritionSchema }) }),
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async ({ name }) => {
    const reference = deps.store.get(name);
    const parts = await resolve(reference.parts);
    const totals = Object.fromEntries(CoreNutrients.map(key => [key, parts.reduce((sum, part) => sum + part.nutrition[key], 0)]));
    return text({ reference, parts, totals: NutritionSchema.parse(totals) });
  });
  server.registerTool('delete_food_reference', {
    description: 'Delete only an approved local reference by name and expected revision. FatSecret foods, saved meals and diary records remain in FatSecret.',
    inputSchema: { name: z.string().trim().min(1).max(160), expected_revision: z.string().uuid(), approved: z.literal(true) },
    outputSchema: z.object({ data: z.object({ deleted: z.literal(true) }) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ name, expected_revision }) => { deps.store.delete(name, expected_revision); return text({ deleted: true }); });
}
