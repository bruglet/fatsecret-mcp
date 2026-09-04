#!/usr/bin/env node

import express, { type Request as ExpressRequest, type Response as ExpressResponse, type NextFunction } from 'express';
import type { Server as HttpServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths as PublicPaths } from './generated/public-api.js';
import type { paths as ProfilePaths } from './generated/profile-api.js';
import { buildGetFoodEntriesQuery } from './food-diary.js';
import { buildOAuth1Params, requestToken, accessToken, type OAuth1Credentials } from './oauth1.js';
import * as schemas from './schemas.js';
import { type Config, getConfigDir, getConfigPath, loadConfigFile, saveConfigFile } from './config.js';
import { createMcpTransport } from './transport/streamable.js';
import { cloudflareAccessAuth } from './auth-middleware.js';
import { text } from './tool-output.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const BASE_URL = 'https://platform.fatsecret.com/rest';

// ── Helpers ──

function dateToDays(dateStr: string): number {
  return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / (1000 * 60 * 60 * 24));
}

function optionalDateToDays(dateStr?: string): number | undefined {
  return dateStr ? dateToDays(dateStr) : undefined;
}

// ── Server ──

class FatSecretMcpServer {
  private clientId = '';
  private clientSecret = '';

  private oauth2Token: string | null = null;
  private oauth2TokenExpiry = 0;

  private publicClient: ReturnType<typeof createClient<PublicPaths>>;
  private profileClient: ReturnType<typeof createClient<ProfilePaths>>;

  private oauth1Credentials: OAuth1Credentials;
  private pendingOAuth: { token: string; secret: string } | null = null;

  constructor() {
    this.oauth1Credentials = { consumerKey: '', consumerSecret: '' };

    // Load config: persistent file first, env vars override
    this.loadConfig();

    // Public API client with OAuth 2.0
    this.publicClient = createClient<PublicPaths>({ baseUrl: BASE_URL });
    const oauth2Middleware: Middleware = {
      onRequest: async ({ request }) => {
        const token = await this.getOAuth2Token();
        request.headers.set('Authorization', `Bearer ${token}`);
        return request;
      },
    };
    this.publicClient.use(oauth2Middleware);

    // Profile API client with OAuth 1.0 (params in query string, not Authorization header)
    this.profileClient = createClient<ProfilePaths>({ baseUrl: BASE_URL });
    const oauth1Middleware: Middleware = {
      onRequest: async ({ request }) => {
        this.ensureProfileAuth();
        const url = new URL(request.url);
        const existingParams: Record<string, string> = {};
        url.searchParams.forEach((v, k) => { existingParams[k] = v; });
        const allParams = buildOAuth1Params(request.method, `${url.origin}${url.pathname}`, this.oauth1Credentials, existingParams);
        url.search = new URLSearchParams(allParams).toString();
        return new Request(url.toString(), request);
      },
    };
    this.profileClient.use(oauth1Middleware);
  }

  public createMcpServer(): McpServer {
    const server = new McpServer(
      { name: 'fatsecret-mcp', version },
      {
        instructions: [
          'FatSecret MCP server provides two levels of access:',
          '',
          '1. SETUP: If API credentials are not configured, call check_auth_status first.',
          '   It will tell you if credentials are missing and guide through setup_credentials.',
          '   Get credentials at https://platform.fatsecret.com/ → My Account → API Keys.',
          '',
          '2. PUBLIC API (works after setup): Food search, recipes, brands, categories.',
          '   These tools use OAuth 2.0 with the configured Client ID and Client Secret.',
          '',
          '3. PROFILE API (requires user authorization): Food diary, saved meals, favorites, weight, exercises, profile.',
          '   These tools require OAuth 1.0 user authorization. Before using any profile tool,',
          '   call check_auth_status to see if the user is authenticated.',
          '   If not, guide them through: start_auth → user visits URL and authorizes → complete_auth with verifier PIN.',
          '   All credentials and tokens persist across sessions in ' + this.getConfigPath() + '.',
        ].join('\n'),
      },
    );

    this.registerTools(server);
    return server;
  }

  public registerTools(server: McpServer): void {
    this.registerPublicFoodTools(server);
    this.registerPublicRecipeTools(server);
    this.registerPublicReferenceTools(server);
    this.registerFoodDiaryTools(server);
    this.registerFavoriteTools(server);
    this.registerSavedMealTools(server);
    this.registerWeightTools(server);
    this.registerExerciseTools(server);
    this.registerProfileTools(server);
    this.registerAuthTools(server);
  }

  // ── Config Management ──

  public getConfigDir(): string {
    return getConfigDir();
  }

  public getConfigPath(): string {
    return getConfigPath();
  }

  private loadConfig(): void {
    // 1. Load from persistent config file
    const fileConfig = loadConfigFile(this.getConfigPath());

    // 2. Apply: env vars override config file
    this.clientId = process.env.FATSECRET_CLIENT_ID || fileConfig.clientId || '';
    this.clientSecret = process.env.FATSECRET_CLIENT_SECRET || fileConfig.clientSecret || '';
    const consumerSecret = process.env.FATSECRET_CONSUMER_SECRET || fileConfig.consumerSecret || '';

    this.oauth1Credentials = {
      consumerKey: this.clientId,
      consumerSecret,
      accessToken: fileConfig.accessToken,
      accessTokenSecret: fileConfig.accessTokenSecret,
    };

    // 3. Log credential sources
    const src = (envKey: string, fileVal?: string) => {
      if (process.env[envKey]) return `env(${envKey})`;
      if (fileVal) return 'config file';
      return 'not set';
    };
    console.error(`Credentials: clientId=${src('FATSECRET_CLIENT_ID', fileConfig.clientId)}, clientSecret=${src('FATSECRET_CLIENT_SECRET', fileConfig.clientSecret)}, consumerSecret=${src('FATSECRET_CONSUMER_SECRET', fileConfig.consumerSecret)}`);
    console.error(`OAuth 1.0 tokens: ${fileConfig.accessToken ? 'loaded from config file' : 'not set'}`);
  }

  public saveConfig(updates: Partial<Config>): Config {
    return saveConfigFile(updates, this.getConfigPath());
  }

  private hasApiCredentials(): boolean {
    return !!(this.clientId && this.clientSecret && this.oauth1Credentials.consumerSecret);
  }

  private ensureApiCredentials(): void {
    if (!this.hasApiCredentials()) {
      throw new Error(
        'API credentials not configured. Use setup_credentials tool first. ' +
        'Get your credentials at https://platform.fatsecret.com/ → My Account → API Keys.',
      );
    }
  }

  // ── OAuth 2.0 Token ──

  private async getOAuth2Token(): Promise<string> {
    this.ensureApiCredentials();

    if (this.oauth2Token && Date.now() < this.oauth2TokenExpiry) {
      return this.oauth2Token;
    }

    const response = await fetch('https://oauth.fatsecret.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'basic',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OAuth2 token request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.oauth2Token = data.access_token;
    this.oauth2TokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return this.oauth2Token;
  }

  private ensureProfileAuth(): void {
    this.ensureApiCredentials();
    if (!this.oauth1Credentials.accessToken || !this.oauth1Credentials.accessTokenSecret) {
      throw new Error(
        'Not authenticated for profile access. Use check_auth_status to check, then start_auth and complete_auth to authorize.',
      );
    }
  }

  // ── Public API – Foods ──

  private registerPublicFoodTools(server: McpServer): void {
    server.registerTool(
      'search_foods',
      {
        description: 'Returns paginated food matches with IDs, serving options, nutrition, and any requested images, subcategories, or dietary attributes. Use when the user wants to find foods by name or needs a food_id before get_food, create_food_entry, or add_saved_meal_item; use autocomplete_foods only for lightweight query suggestions. Premier only.',
        inputSchema: schemas.SearchFoodsInputSchema,
        outputSchema: schemas.SearchFoodsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/foods/search/v5', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_food',
      {
        description: 'Returns full food details and nutrition for each available serving. Use after search_foods, find_food_by_barcode, or a profile food-list tool when the user needs serving-level nutrition or a serving_id; do not use it for name discovery, and do not use derived serving_id 0 with create_food_entry.',
        inputSchema: schemas.GetFoodInputSchema,
        outputSchema: schemas.GetFoodOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/food/v5', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'find_food_by_barcode',
      {
        description: 'Returns the food matching a barcode, including servings and nutrition. Use when the user provides a UPC-A, EAN-13, or EAN-8 barcode; pass it as 13-digit GTIN-13 and use search_foods instead for name-based lookup. Premier only; an unmatched barcode returns FatSecret error 211.',
        inputSchema: schemas.FindFoodByBarcodeInputSchema,
        outputSchema: schemas.FindFoodByBarcodeOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ barcode, ...rest }) => {
        const { data } = await this.publicClient.GET('/food/barcode/find-by-id/v2', {
          params: { query: { barcode: Number(barcode), ...rest, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'autocomplete_foods',
      {
        description: 'Returns short food-query suggestions for incomplete text, without food IDs or nutrition. Use when the user needs search-term completion, then pass a selected suggestion to search_foods; do not use this instead of a food search. Premier only and documented for the default region/language combination.',
        inputSchema: schemas.AutocompleteFoodsInputSchema,
        outputSchema: schemas.AutocompleteFoodsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/food/autocomplete/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Public API – Recipes ──

  private registerPublicRecipeTools(server: McpServer): void {
    server.registerTool(
      'search_recipes',
      {
        description: 'Returns paginated recipe summaries with IDs, names, nutrition, ingredients, types, and available images. Use when the user wants recipe ideas or filtered recipe discovery; use get_recipe for full directions and get_recipe_types before applying type filters.',
        inputSchema: schemas.SearchRecipesInputSchema,
        outputSchema: schemas.SearchRecipesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/recipes/search/v3', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_recipe',
      {
        description: 'Returns a recipe\'s full ingredients, directions, timing, serving information, images, and nutrition. Use after search_recipes or get_favorite_recipes when the user selected a recipe_id; do not use it to discover recipes.',
        inputSchema: schemas.GetRecipeInputSchema,
        outputSchema: schemas.GetRecipeOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/recipe/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Public API – Reference Data ──

  private registerPublicReferenceTools(server: McpServer): void {
    server.registerTool(
      'get_food_categories',
      {
        description: 'Returns food category IDs, names, and descriptions. Use when the user asks to browse FatSecret\'s category taxonomy or when get_food_sub_categories needs a food_category_id; do not use it to search for foods. Premier only.',
        inputSchema: schemas.GetFoodCategoriesInputSchema,
        outputSchema: schemas.GetFoodCategoriesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/food-categories/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_food_sub_categories',
      {
        description: 'Returns the subcategory names under one food category. Use after get_food_categories when the user wants to browse that taxonomy; it does not return foods or subcategory IDs. Premier only.',
        inputSchema: schemas.GetFoodSubCategoriesInputSchema,
        outputSchema: schemas.GetFoodSubCategoriesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/food-sub-categories/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_brands',
      {
        description: 'Returns food brand names, optionally filtered by initial character and manufacturer, restaurant, or supermarket type. Use for brand-directory requests; use search_foods to find actual branded foods because this tool returns no food IDs or nutrition. Premier only.',
        inputSchema: schemas.GetBrandsInputSchema,
        outputSchema: schemas.GetBrandsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.publicClient.GET('/brands/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_recipe_types',
      {
        description: 'Returns the supported recipe type names. Use when the user wants to browse recipe categories or before search_recipes needs an exact, comma-separated recipe_types filter; it does not return recipes.',
        inputSchema: schemas.GetRecipeTypesInputSchema,
        outputSchema: schemas.GetRecipeTypesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const { data } = await this.publicClient.GET('/recipe-types/v2', {
          params: { query: { format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Food Diary ──

  private registerFoodDiaryTools(server: McpServer): void {
    server.registerTool(
      'get_food_entries',
      {
        description: 'Returns individual food diary entries and their nutrition for a date, or one entry by food_entry_id. Use when the user asks what they logged or when an edit/delete needs an entry ID; use get_food_entries_month for daily monthly totals instead. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetFoodEntriesInputSchema,
        outputSchema: schemas.GetFoodEntriesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.GET('/food-entries/v2', {
          params: { query: buildGetFoodEntriesQuery({ ...rest, date }) },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_food_entries_month',
      {
        description: 'Returns daily calorie and macro totals for a month; days without diary entries are omitted. Use for monthly intake summaries or trends, not for individual foods or entry IDs—use get_food_entries for those. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetFoodEntriesMonthInputSchema,
        outputSchema: schemas.GetFoodEntriesMonthOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ date }) => {
        const { data } = await this.profileClient.GET('/food-entries/month/v2', {
          params: { query: { date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'create_food_entry',
      {
        description: 'Creates a food diary entry and returns the recorded entry with its ID and nutrition. Use when the user asks to log food; first use search_foods and get_food to obtain food_id and a real serving_id, because derived serving_id 0 cannot be logged. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.CreateFoodEntryInputSchema,
        outputSchema: schemas.CreateFoodEntryOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.POST('/food-entries/v1', {
          params: { query: { ...rest, date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'edit_food_entry',
      {
        description: 'Updates an existing diary entry\'s label, serving, quantity, or meal. Use get_food_entries to obtain food_entry_id; this cannot change the entry date, so delete and recreate the entry to move it to another date. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.EditFoodEntryInputSchema,
        outputSchema: schemas.EditFoodEntryOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.PUT('/food-entries/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'delete_food_entry',
      {
        description: 'Permanently removes one food diary entry. Use when the user asks to delete a logged item, after get_food_entries provides its food_entry_id; do not use this to remove a favorite or saved-meal item. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.DeleteFoodEntryInputSchema,
        outputSchema: schemas.DeleteFoodEntryOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.DELETE('/food-entries/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'copy_food_entries',
      {
        description: 'Copies diary entries from one calendar date to another, optionally for only one meal bucket. Use when the user wants to repeat food they already logged on another date; use copy_saved_meal_entries instead when the source is a saved meal. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.CopyFoodEntriesInputSchema,
        outputSchema: schemas.CopyFoodEntriesOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ from_date, to_date, ...rest }) => {
        const { data } = await this.profileClient.POST('/food-entries/copy/v1', {
          params: {
            query: {
              ...rest,
              from_date: dateToDays(from_date),
              to_date: dateToDays(to_date),
              format: 'json',
            },
          },
        });
        return text(data);
      },
    );

    server.registerTool(
      'copy_saved_meal_entries',
      {
        description: 'Copies every item in a saved meal into a selected diary meal and date. Use when the user wants to log a saved meal; obtain saved_meal_id from get_saved_meals, and use copy_food_entries instead to copy an existing diary date. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.CopySavedMealEntriesInputSchema,
        outputSchema: schemas.CopySavedMealEntriesOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.POST('/food-entries/copy/saved-meal/v1', {
          params: { query: { ...rest, date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Favorites ──

  private registerFavoriteTools(server: McpServer): void {
    server.registerTool(
      'get_favorite_foods',
      {
        description: 'Returns the user\'s favorite foods with food IDs and saved serving details. Use when the user asks for favorites or when delete_favorite_food needs an exact favorite; use search_foods for the broader catalog. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetFavoriteFoodsInputSchema,
        outputSchema: schemas.GetFavoriteFoodsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const { data } = await this.profileClient.GET('/food/favorites/v2', {
          params: { query: { format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'delete_favorite_food',
      {
        description: 'Removes a food or serving-specific selection from the user\'s favorites and returns success status. Use get_favorite_foods first to obtain the stored food_id and any serving details; this does not delete diary entries. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.DeleteFavoriteFoodInputSchema,
        outputSchema: schemas.DeleteFavoriteFoodOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.POST('/food/favorite/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_most_eaten_foods',
      {
        description: 'Returns foods the user eats most often, including food and serving IDs, optionally for one meal bucket. Use for frequency-based suggestions; use get_recently_eaten_foods for recency, get_favorite_foods for explicit favorites, or search_foods for catalog search. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetMostEatenFoodsInputSchema,
        outputSchema: schemas.GetMostEatenFoodsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.GET('/food/most-eaten/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_recently_eaten_foods',
      {
        description: 'Returns foods the user ate recently, including food and serving IDs, optionally for one meal bucket. Use for quick repeat-entry suggestions; use get_most_eaten_foods for frequency or get_food_entries for the actual dated diary record. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetRecentlyEatenFoodsInputSchema,
        outputSchema: schemas.GetRecentlyEatenFoodsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.GET('/food/recently-eaten/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_favorite_recipes',
      {
        description: 'Returns the user\'s favorite recipes with recipe IDs and summary details. Use when the user asks for saved recipe favorites or when get_recipe/delete_favorite_recipe needs a recipe_id; use search_recipes to discover recipes outside favorites. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetFavoriteRecipesInputSchema,
        outputSchema: schemas.GetFavoriteRecipesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const { data } = await this.profileClient.GET('/recipe/favorites/v2', {
          params: { query: { format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'add_favorite_recipe',
      {
        description: 'Adds an existing FatSecret recipe to the user\'s favorites and returns success status. Use after search_recipes or get_recipe provides recipe_id; this does not create a recipe or saved meal. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.AddFavoriteRecipeInputSchema,
        outputSchema: schemas.AddFavoriteRecipeOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.POST('/recipe/favorites/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'delete_favorite_recipe',
      {
        description: 'Removes an existing recipe from the user\'s favorites and returns success status. Use get_favorite_recipes to obtain recipe_id; this does not delete the recipe itself or a saved meal. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.DeleteFavoriteRecipeInputSchema,
        outputSchema: schemas.DeleteFavoriteRecipeOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.DELETE('/recipe/favorites/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Saved Meals ──

  private registerSavedMealTools(server: McpServer): void {
    server.registerTool(
      'get_saved_meals',
      {
        description: 'Returns saved-meal IDs, names, descriptions, and suitable meal buckets, optionally filtered by meal. Use to browse saved-meal containers or obtain saved_meal_id; use get_saved_meal_items for the foods inside one. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetSavedMealsInputSchema,
        outputSchema: schemas.GetSavedMealsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.GET('/saved-meals/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'create_saved_meal',
      {
        description: 'Creates an empty saved-meal container and returns its new saved_meal_id. Use when the user wants a reusable meal, then call add_saved_meal_item for each food; use create_food_entry instead to log food directly to the diary. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.CreateSavedMealInputSchema,
        outputSchema: schemas.CreateSavedMealOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async (args) => {
        const { data } = await this.profileClient.POST('/saved-meals/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'edit_saved_meal',
      {
        description: 'Updates a saved meal\'s name, description, or suitable meal buckets. Use get_saved_meals to obtain saved_meal_id; this does not change the foods inside, which require the saved-meal item tools. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.EditSavedMealInputSchema,
        outputSchema: schemas.EditSavedMealOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.PUT('/saved-meals/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'delete_saved_meal',
      {
        description: 'Permanently deletes a saved-meal container. Use after get_saved_meals identifies saved_meal_id; use delete_saved_meal_item when only one food should be removed. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.DeleteSavedMealInputSchema,
        outputSchema: schemas.DeleteSavedMealOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.DELETE('/saved-meals/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_saved_meal_items',
      {
        description: 'Returns every item in one saved meal, including saved-meal item IDs, food and serving IDs, quantities, and nutrition. Use after get_saved_meals provides saved_meal_id, or before editing/deleting an item; this does not read dated diary entries. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetSavedMealItemsInputSchema,
        outputSchema: schemas.GetSavedMealItemsOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.GET('/saved-meals/item/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'add_saved_meal_item',
      {
        description: 'Adds a food and serving to a saved meal and returns the new saved_meal_item_id. Use get_saved_meals for saved_meal_id and search_foods/get_food for food_id and serving_id; use create_food_entry instead to log food directly. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.AddSavedMealItemInputSchema,
        outputSchema: schemas.AddSavedMealItemOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async (args) => {
        const { data } = await this.profileClient.POST('/saved-meals/item/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'edit_saved_meal_item',
      {
        description: 'Updates a saved-meal item\'s label or serving quantity. Use get_saved_meal_items to obtain saved_meal_item_id; serving_id cannot be changed, so delete and re-add the item to select another serving. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.EditSavedMealItemInputSchema,
        outputSchema: schemas.EditSavedMealItemOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.PUT('/saved-meals/item/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'delete_saved_meal_item',
      {
        description: 'Permanently removes one food item from a saved meal. Use get_saved_meal_items to obtain saved_meal_item_id; use delete_saved_meal only when the entire meal should be removed. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.DeleteSavedMealItemInputSchema,
        outputSchema: schemas.DeleteSavedMealItemOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      },
      async (args) => {
        const { data } = await this.profileClient.DELETE('/saved-meals/item/v1', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Weight ──

  private registerWeightTools(server: McpServer): void {
    server.registerTool(
      'update_weight',
      {
        description: 'Records or replaces the user\'s weight for a date and returns success status. Use when the user asks to log a weigh-in; values are supplied in kilograms, and the first weigh-in also requires goal_weight_kg and current_height_cm. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.UpdateWeightInputSchema,
        outputSchema: schemas.UpdateWeightOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.POST('/weight/v1', {
          params: { query: { ...rest, date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_weight_month',
      {
        description: 'Returns recorded weigh-ins for a month with dates, kilogram values, and comments; days without weigh-ins are omitted. Use for a weight log or trend, not to record a value—use update_weight for that. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetWeightMonthInputSchema,
        outputSchema: schemas.GetWeightMonthOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ date }) => {
        const { data } = await this.profileClient.GET('/weight/month/v2', {
          params: { query: { date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Exercise ──

  private registerExerciseTools(server: McpServer): void {
    server.registerTool(
      'get_exercises',
      {
        description: 'Returns supported exercise type names and IDs. Use before edit_exercise_entries to resolve shift_from_id and shift_to_id, or when the user asks which activities are available; ID 0 represents a custom "Other" exercise. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetExercisesInputSchema,
        outputSchema: schemas.GetExercisesOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const { data } = await this.profileClient.GET('/exercises/v2', {
          params: { query: { format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'edit_exercise_entries',
      {
        description: 'Moves a number of minutes from one exercise activity to another for a date and returns success status; it does not set an absolute duration. Use get_exercises first for both IDs; custom "Other" exercises use ID 0 and require names, plus kcal for the destination. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.EditExerciseEntriesInputSchema,
        outputSchema: schemas.EditExerciseEntriesOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.PUT('/exercise-entries/v1', {
          params: { query: { ...rest, date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'get_exercise_entries_month',
      {
        description: 'Returns estimated calories expended per day for a month; days without saved exercise entries are omitted. Use for monthly energy-expenditure summaries, not for activity-level entries or editing. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetExerciseEntriesMonthInputSchema,
        outputSchema: schemas.GetExerciseEntriesMonthOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ date }) => {
        const { data } = await this.profileClient.GET('/exercise-entries/month/v2', {
          params: { query: { date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'save_exercise_template',
      {
        description: 'Copies one date\'s exercise entries into the default template for selected weekdays and returns success status. Use when the user wants that day\'s activity pattern reused on future matching weekdays; the source date must already contain the desired exercise entries. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.SaveExerciseTemplateInputSchema,
        outputSchema: schemas.SaveExerciseTemplateOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async ({ date, ...rest }) => {
        const { data } = await this.profileClient.POST('/exercise-entries/day/v1', {
          params: { query: { ...rest, date: optionalDateToDays(date), format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Profile API – Profile & Custom Food ──

  private registerProfileTools(server: McpServer): void {
    server.registerTool(
      'get_profile',
      {
        description: 'Returns the authenticated user\'s measurement preferences, latest weight details, goal weight, and height. Use when the user asks about FatSecret profile data; use check_auth_status instead to diagnose credentials or authorization. Requires profile auth; use check_auth_status first.',
        inputSchema: schemas.GetProfileInputSchema,
        outputSchema: schemas.GetProfileOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const { data } = await this.profileClient.GET('/profile/v1', {
          params: { query: { format: 'json' } },
        });
        return text(data);
      },
    );

    server.registerTool(
      'create_food',
      {
        description: 'Creates a custom branded food from serving and nutrition data and returns its new food_id. Use when the requested food is absent from search_foods; this does not add it to the diary, so call create_food_entry afterward if needed. Premier only and requires profile auth; use check_auth_status first.',
        inputSchema: schemas.CreateFoodInputSchema,
        outputSchema: schemas.CreateFoodOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async (args) => {
        const { data } = await this.profileClient.POST('/food/v2', {
          params: { query: { ...args, format: 'json' } },
        });
        return text(data);
      },
    );
  }

  // ── Auth Tools ──

  private registerAuthTools(server: McpServer): void {
    server.registerTool(
      'check_auth_status',
      {
        description: 'Returns whether API credentials are configured, whether profile OAuth is complete, the config path, and the next setup step. Use first when a tool reports an authentication problem or before profile operations; this reports local readiness, not the user\'s FatSecret profile data.',
        inputSchema: schemas.CheckAuthStatusInputSchema,
        outputSchema: schemas.CheckAuthStatusOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async () => {
        const hasCredentials = this.hasApiCredentials();
        const hasTokens = !!(this.oauth1Credentials.accessToken && this.oauth1Credentials.accessTokenSecret);

        if (!hasCredentials) {
          return text({
            credentials_configured: false,
            profile_authenticated: false,
            config_path: this.getConfigPath(),
            message: 'API credentials are not configured. Use setup_credentials to provide your FatSecret API keys. ' +
              'Get them at https://platform.fatsecret.com/ → My Account → API Keys. ' +
              'You need: Client ID, Client Secret (OAuth 2.0), and Consumer Secret (OAuth 1.0 — different from Client Secret).',
          });
        }

        return text({
          credentials_configured: true,
          profile_authenticated: hasTokens,
          config_path: this.getConfigPath(),
          message: hasTokens
            ? 'Fully configured. API credentials and profile authentication are ready. All tools are available.'
            : 'API credentials configured (public tools work). Profile not authenticated — use start_auth to authorize profile access.',
        });
      },
    );

    server.registerTool(
      'setup_credentials',
      {
        description: 'Saves FatSecret API credentials and returns the config path. Use when check_auth_status reports missing credentials; obtain all three values from platform.fatsecret.com → My Account → API Keys, then use start_auth for profile access. Replacing credentials clears any existing profile authorization.',
        inputSchema: schemas.SetupCredentialsInputSchema,
        outputSchema: schemas.SetupCredentialsOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: true },
      },
      async (rawArgs) => {
        const args = rawArgs as {
          client_id?: string;
          client_secret?: string;
          consumer_secret?: string;
          clientId?: string;
          clientSecret?: string;
          consumerSecret?: string;
        };
        const client_id = args.client_id || args.clientId || '';
        const client_secret = args.client_secret || args.clientSecret || '';
        const consumer_secret = args.consumer_secret || args.consumerSecret || '';

        this.clientId = client_id;
        this.clientSecret = client_secret;
        this.oauth1Credentials.consumerKey = client_id;
        this.oauth1Credentials.consumerSecret = consumer_secret;

        // Reset OAuth 2.0 token (new credentials)
        this.oauth2Token = null;
        this.oauth2TokenExpiry = 0;

        // Clear stale OAuth tokens when credentials change
        this.oauth1Credentials.accessToken = undefined;
        this.oauth1Credentials.accessTokenSecret = undefined;

        this.saveConfig({
          clientId: client_id,
          clientSecret: client_secret,
          consumerSecret: consumer_secret,
          accessToken: undefined,
          accessTokenSecret: undefined,
        });

        return text({
          message: 'Credentials saved! Public API tools (food search, recipes) are now available. ' +
            'For profile tools (food diary, weight, etc.), use start_auth to authorize your FatSecret account.',
          config_path: this.getConfigPath(),
        });
      },
    );

    server.registerTool(
      'start_auth',
      {
        description: 'Starts profile OAuth and returns an authorization URL for the user to open. Use after setup_credentials when check_auth_status reports that profile access is not authorized; after the user approves access, pass the displayed verifier to complete_auth.',
        inputSchema: schemas.StartAuthInputSchema,
        outputSchema: schemas.StartAuthOutputSchema,
        annotations: { readOnlyHint: true, idempotentHint: false },
      },
      async () => {
        this.ensureApiCredentials();
        // Use only consumer key/secret for request token (no access tokens)
        const result = await requestToken({
          consumerKey: this.oauth1Credentials.consumerKey,
          consumerSecret: this.oauth1Credentials.consumerSecret,
        });
        this.pendingOAuth = { token: result.oauthToken, secret: result.oauthTokenSecret };
        return text({
          message: 'Visit the URL below to authorize the app, then use complete_auth with the verifier code.',
          authorization_url: result.authorizationUrl,
        });
      },
    );

    server.registerTool(
      'complete_auth',
      {
        description: 'Exchanges the verifier from the current start_auth flow for saved profile access and returns the config path. Use only after the user opens start_auth\'s authorization URL and approves access; restarting the server or starting a new flow invalidates the pending in-memory flow.',
        inputSchema: schemas.CompleteAuthInputSchema,
        outputSchema: schemas.CompleteAuthOutputSchema,
        annotations: { readOnlyHint: false, idempotentHint: false },
      },
      async ({ verifier }) => {
        if (!this.pendingOAuth) {
          throw new Error('No pending OAuth flow. Call start_auth first.');
        }
        const result = await accessToken(
          this.oauth1Credentials,
          this.pendingOAuth.token,
          this.pendingOAuth.secret,
          verifier,
        );
        this.saveConfig({ accessToken: result.accessToken, accessTokenSecret: result.accessTokenSecret });
        this.oauth1Credentials.accessToken = result.accessToken;
        this.oauth1Credentials.accessTokenSecret = result.accessTokenSecret;
        this.pendingOAuth = null;
        return text({
          message: 'Authentication successful! Profile tools are now available.',
          config_path: this.getConfigPath(),
        });
      },
    );
  }

  // ── Run ──

  async run(portOverride?: number): Promise<HttpServer> {
    const app = express();
    app.use(express.json({ limit: '4mb' }));

    // JSON parse error handling middleware
    app.use((err: unknown, _req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      if (err) {
        const status = (typeof err === 'object' && err !== null && 'status' in err && typeof (err as { status: unknown }).status === 'number')
          ? (err as { status: number }).status
          : 400;
        res.status(status).json({
          jsonrpc: '2.0',
          error: { code: status === 413 ? -32000 : -32700, message: (err as Error).message || 'Invalid JSON' },
          id: null,
        });
        return;
      }
      next();
    });

    // Feature 1: Public Health Check
    app.get('/health', (_req: ExpressRequest, res: ExpressResponse) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).json({ status: 'ok' });
    });

    app.head('/health', (_req: ExpressRequest, res: ExpressResponse) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
    });

    // Feature 2: MCP Streamable HTTP Transport
    const mcpTransport = createMcpTransport({
      createServer: () => this.createMcpServer(),
    });
    app.use('/mcp', cloudflareAccessAuth, mcpTransport.router);

    const port = portOverride || parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    return new Promise((resolve, reject) => {
      const httpServer = app.listen(port, host, () => {
        console.error(`FatSecret MCP server running at http://${host}:${port}`);
        console.error(`Health check available at http://${host}:${port}/health`);
        console.error(`MCP endpoint available at http://${host}:${port}/mcp`);
        resolve(httpServer);
      });

      httpServer.on('error', reject);

      const shutdown = async () => {
        console.error('Shutting down FatSecret MCP server...');
        await mcpTransport.closeAllSessions();
        httpServer.close(() => {
          console.error('Server stopped cleanly');
          process.exit(0);
        });
        setTimeout(() => process.exit(1), 5000).unref();
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    });
  }
}

export { FatSecretMcpServer };

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

const server = new FatSecretMcpServer();
server.run().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
