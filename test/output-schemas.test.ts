import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as schemas from '../src/schemas.js';
import { text } from '../src/tool-output.js';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

test('every registered tool declares an output schema', () => {
  const registrationBlocks = indexSource.split('server.registerTool(').slice(1);

  assert.equal(registrationBlocks.length, 44);
  for (const block of registrationBlocks) {
    const toolName = block.match(/^\s*'([^']+)'/)?.[1] ?? 'unknown';
    const config = block.slice(0, block.indexOf('\n      async'));
    assert.match(
      config,
      /outputSchema: schemas\.\w+OutputSchema,/,
      `${toolName} has no output schema`,
    );
  }
});

test('all 44 output schemas are exported', () => {
  const outputSchemas = Object.entries(schemas).filter(([name]) => name.endsWith('OutputSchema'));

  assert.equal(outputSchemas.length, 44);
  for (const [name, schema] of outputSchemas) {
    assert.equal(typeof (schema as { safeParse?: unknown }).safeParse, 'function', name);
  }
});

test('FatSecret output schemas accept documented JSON response shapes', () => {
  assert.equal(
    schemas.SearchFoodsOutputSchema.safeParse({
      data: {
        foods_search: {
          max_results: '1',
          total_results: '1',
          page_number: '0',
          results: {
            food: [
              {
                food_id: '1641',
                food_name: 'Chicken Breast',
                food_type: 'Generic',
                food_url: 'https://foods.fatsecret.com/example',
              },
            ],
          },
        },
      },
    }).success,
    true,
  );

  assert.equal(
    schemas.GetRecipeOutputSchema.safeParse({
      data: {
        recipe: {
          recipe_id: '91',
          recipe_name: 'Baked Lemon Snapper',
          recipe_url: 'https://foods.fatsecret.com/example',
          serving_sizes: {
            serving: {
              serving_size: '1 serving',
              calories: '177',
              carbohydrate: '2.23',
              protein: '35.10',
              fat: '2.32',
            },
          },
        },
      },
    }).success,
    true,
  );

  assert.equal(
    schemas.GetExercisesOutputSchema.safeParse({
      data: {
        exercise_types: {
          exercise: [{ exercise_id: '0', exercise_name: 'Other' }],
        },
      },
    }).success,
    true,
  );

  assert.equal(
    schemas.GetRecipeTypesOutputSchema.safeParse({
      data: { recipe_types: { recipe_types: ['Appetizers', 'Soups'] } },
    }).success,
    true,
  );
});

test('FatSecret output schemas preserve API error envelopes', () => {
  const errorOutput = { data: { error: { code: '101', message: 'Missing parameter' } } };

  assert.equal(schemas.GetFoodOutputSchema.safeParse(errorOutput).success, true);
  assert.equal(schemas.UpdateWeightOutputSchema.safeParse(errorOutput).success, true);
});

test('text output includes matching structured content', () => {
  const data = { success: { value: '1' } };
  const output = text(data);

  assert.deepEqual(output.structuredContent, { data });
  assert.deepEqual(JSON.parse(output.content[0].text), data);
  assert.deepEqual(text(undefined).structuredContent, { data: null });
});
