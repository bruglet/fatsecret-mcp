/** Normalize documented FatSecret collection variations without inventing nutrition. */
const collections: Record<string, string> = {
  foods: 'food', food_entries: 'food_entry', saved_meals: 'saved_meal',
  saved_meal_items: 'saved_meal_item', recipes: 'recipe', servings: 'serving',
  exercise_types: 'exercise', suggestions: 'suggestion', food_brands: 'food_brand',
  food_categories: 'food_category', food_sub_categories: 'food_sub_category',
  food_images: 'food_image', allergens: 'allergen', preferences: 'preference',
  recipe_categories: 'recipe_category', recipe_images: 'recipe_image',
  recipe_ingredients: 'ingredient', ingredients: 'ingredient', directions: 'direction',
  serving_sizes: 'serving', month: 'day', results: 'food',
};

export function normalizeResponse(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(normalizeResponse);
  if (!data || typeof data !== 'object') return data;
  const result: Record<string, unknown> = {};
  for (const [originalKey, originalValue] of Object.entries(data)) {
    // Some exercise responses use the older envelope name.
    const key = originalKey === 'exercises' ? 'exercise_types' : originalKey;
    let value = normalizeResponse(originalValue);
    const itemKey = key === 'recipe_types'
      ? (value && typeof value === 'object' && 'recipe_type' in value ? 'recipe_type' : 'recipe_types')
      : Object.hasOwn(collections, key) ? collections[key] : undefined;
    if (itemKey) {
      const container = value == null ? {} : value;
      if (typeof container === 'object' && !Array.isArray(container)) {
        const record = container as Record<string, unknown>;
        const item = record[itemKey];
        value = { ...record, [itemKey]: item == null ? [] : Array.isArray(item) ? item : [item] };
        if (key === 'recipe_types' && itemKey === 'recipe_type') {
          value = { ...value as object, recipe_types: (value as Record<string, unknown>).recipe_type };
        }
      }
    }
    Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return result;
}

const guidance: Record<string, string> = {
  '2': 'OAuth parameters are missing. Check the connector OAuth configuration.',
  '5': 'The API key is invalid. Check the configured credentials.',
  '8': 'OAuth signature verification failed. Check the consumer secret and server clock.',
  '9': 'Profile authorization is invalid. Reauthorize with start_auth and complete_auth.',
  '11': 'The application request limit was reached. Wait before retrying reads; inspect the diary before retrying writes.',
  '12': 'Too many user actions. Wait and inspect the diary before retrying a write.',
  '20': 'FatSecret is temporarily unavailable. Inspect the diary before retrying writes.',
  '21': 'This server IP is not authorized. Check the API key IP allowlist.',
  '24': 'FatSecret timed out. Inspect the diary before retrying writes.',
  '13': 'The public access token is invalid. Obtain a new token and check the API credentials.',
  '14': 'The access token lacks a required scope. Check requested scopes and account entitlements; authentication alone does not grant Premier or barcode access.',
  '101': 'A required API parameter is missing. Check the tool arguments.',
  '106': 'The ID is unavailable in this API context. Check the ID and profile authorization for personal foods.',
  '107': 'An API parameter is out of range. Check the serving, quantity, and identifiers.',
  '108': 'An API parameter has an invalid type. Check the tool arguments.',
  '211': 'No food matches this barcode. Try search_foods with the product name.',
};

export class FatSecretApiError extends Error {
  constructor(public readonly code: string | number, message?: string) {
    super(`FatSecret error ${code}: ${message ?? guidance[String(code)] ?? 'The API rejected the request. Check the arguments and permissions.'}`);
    this.name = 'FatSecretApiError';
  }
}

/** Do not expose signed URLs, credentials, upstream HTML, or raw network errors. */
export function apiFetch(fetcher: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    let response: Response;
    try {
      response = await fetcher(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
    } catch {
      throw new FatSecretApiError('NETWORK_ERROR', 'The request failed or timed out. For writes, read the diary before retrying; the outcome can be unknown.');
    }
    let data: unknown;
    try { data = await response.clone().json(); } catch {
      throw new FatSecretApiError(`HTTP_${response.status}`, 'The API returned a non-JSON response. Check service availability and IP restrictions. For writes, read the diary before retrying.');
    }
    if (data && typeof data === 'object' && 'error' in data) {
      const error = (data as { error: { code?: unknown } }).error;
      const code = error && (typeof error.code === 'string' || typeof error.code === 'number') ? error.code : 'API_ERROR';
      throw new FatSecretApiError(code);
    }
    if (!response.ok) {
      throw new FatSecretApiError(`HTTP_${response.status}`, 'The API request failed. Check credentials, permissions, IP restrictions, and service availability. For writes, read the diary before retrying.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new FatSecretApiError('INVALID_RESPONSE', 'The API returned an empty or invalid response. For writes, read the diary before retrying.');
    }
    return response;
  };
}
