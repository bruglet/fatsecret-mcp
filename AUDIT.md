# FatSecret connector audit

This baseline describes the original findings. The v2 implementation status appears at the end.

Date: 2026-10-23. Repository: `bruglet/fatsecret-mcp`.
Base: `master` at `c58da8d`, after `git pull --ff-only origin`.

This audit covers environment setup, source inspection, current documentation, local tests, and selected live reads.
The integration is not ready for production food logging.
No production diary, favorite, saved meal, custom food, or authentication data changed.
The personal Skills library did not change.

## Environment changes

- The test command includes root tests and E2E tests. The previous shell pattern selected only E2E tests.
- The stress harness uses `process.execPath` instead of a missing absolute Node path.
- The stress server binds to loopback and skips gateway authentication only inside the test process.
- The stress server clears inherited FatSecret credentials and uses temporary configuration.
- Three small changes in `src/config.ts` remove four lint errors. Runtime behavior stays the same.

Build, lint, and type-checking pass. All 119 tests pass after these setup changes.
The 79 E2E tests use a separate conformance server by default.
They do not prove that the connector handles real FatSecret responses correctly.
The stress tests exercise the actual local connector with synthetic configuration.
One stress test reports a session defect without an assertion, so the green result has this limitation.

## Access limitations versus code defects

| Area | Classification | Evidence |
|---|---|---|
| Premier search, autocomplete, brands, categories, subcategories | Access and code | The handoff reports missing scopes. `getOAuth2Token` always requests only `basic`. |
| Barcode lookup | Access and code | The handoff reports missing `barcode`. The token request never requests this scope. |
| Basic public food search | Code | The generated client supports `/foods/search/v1`, but `search_foods` calls only v5. Its output schema rejects v1 responses. |
| Empty favorites, recipes, diary dates | Code | Local schema probes reject `foods: null`, `recipes: null`, and `food_entries: null`. |
| Saved meal description | Code | A local schema probe rejects `saved_meal_description: null`. |
| Single-object collections | Code | A local schema probe rejects a single favorite food object. Most collection schemas require arrays. |
| Derived serving identifiers | Code | Diary input accepts `serving_id=0`, despite the tool description and API restriction. |
| Invalid quantities | Code | Diary input accepts negative serving quantities. |
| Favorite food deletion | Code | The handler sends POST to `/food/favorite/v1`. The documented method is DELETE. |
| Duplicate protection | Missing behavior | Create and copy handlers forward requests directly. No durable request deduplication or post-write nutrition verification exists. |
| Capability status | Code | `check_auth_status` checks local credential presence and claims all tools are available. It does not inspect scopes or entitlements. |
| Food Box retrieval | Unresolved | A live public lookup of ID `123783004` still returns error 106. No user-authorized food-detail lookup exists in the connector. |
| Exercise list | Unresolved response mismatch | The live tool still fails output validation. Its response lacks the expected `exercise_types` envelope. |
| Custom food creation | Premier dependency and unresolved behavior | The documentation marks v2 as Premier-only. Privacy and retrieval require separate verification. |
| Plugin skill | Missing package component | The repository contains MCP/MCPB manifests, but no packaged workflow skill or Codex plugin skill directory. |

## OAuth and Premier Free

The public and profile clients already use OAuth 2.0 and OAuth 1.0 respectively.
The split is appropriate, but the public token scope is fixed in `src/index.ts:193`.
Premier approval alone cannot activate Premier tools with this token request.
Error 14 proves a token lacks a requested scope. It does not prove that the account lacks Premier approval.

The [OAuth guide](https://platform.fatsecret.com/docs/guides/authentication/oauth2) documents multiple scopes and IP restrictions.
It also documents new client-credentials tokens after expiry.
The connector renews tokens before expiry, but does not report granted scopes or retry rejected tokens after invalidation.

[Premier Free](https://platform.fatsecret.com/api-editions) requires verification and attribution and provides the US dataset.
It includes autocomplete, barcode scanning, and advanced categorization.
Image recognition and NLP remain optional paid add-ons.
Approval, current account entitlements, and IP restrictions were not verified during this audit.

The [v1 search documentation](https://platform.fatsecret.com/docs/v1/foods.search) exposes a Basic search route.
Its result contains summary nutrition text instead of nested servings.
Its Premier-only subsection names the extra scope for optional features.
A live v1 request remains necessary to verify Basic behavior for this account.
Public detail lookup can then supply actual servings.

## Personal foods and Food Box

`get_food` always uses the public OAuth 2.0 client at `/food/v5`.
A public lookup failure does not establish that a personal food is unavailable through user authorization.
An OAuth 1.0 lookup is a hypothesis to test, not a confirmed fix.
The connected tool does not expose that path, and no local FatSecret runtime was available for a direct comparison.

[food.create v2](https://platform.fatsecret.com/docs/v2/food.create) creates a food for the user and returns its ID.
The published parameters expose no privacy switch or explicit private-visibility guarantee.
They also include `brand_type`, which the generated request schema omits.
No custom foods were created, and no private-creation claim is verified.

No dedicated personal-food list appears in the reviewed API reference.
Favorites, recent foods, frequent foods, saved meals, and diary records provide possible discovery sources.
They do not establish an exhaustive personal catalog.

The [storage guide](https://platform.fatsecret.com/docs/guides/storable-data) permits indefinite storage of food and serving IDs.
Other returned data has storage restrictions unless separate terms apply.
A durable catalog needs an account boundary and a clear distinction between identifiers, user-authored estimates, and retrieved nutrition.
The connector currently stores credentials, but has no personal-food index or custom-food deduplication.

Food Box remains unchanged, including its historical records.
Its entree and separately logged rice or sides still require separate treatment during future calibration.

## Additional reliability findings

`src/transport/streamable.ts` stores sessions in ordinary objects and accepts inherited properties during lookup.
The isolated real-server tests reproduced HTTP 500 for `toString`, `valueOf`, `constructor`, `hasOwnProperty`, and `__proto__`.
The test prints a vulnerability warning but does not assert a correct response.
This defect is unrelated to FatSecret authorization.

Most API handlers discard the HTTP error result and return only `data`.
`text(undefined)` becomes `data: null`, so some upstream failures can appear as empty successful responses.
FatSecret error envelopes also return without the MCP `isError` flag.
Error classification, safe messages, and transport failure handling remain incomplete.

The existing endpoint tests use curated success examples and do not cover the reported nullable responses.
The container publication workflow does not run lint, type-checking, or regression tests before publication.
No deployment or publication occurred during this audit.

## Verification record

The local checks were:

- `npm run build`: Passed.
- `npm run type-check -- --incremental false`: Passed.
- `npm run lint`: Passed.
- Isolated `npm test`: 119 passed, zero failed.
- Ad hoc schema probes: Reproduced the nullable, singleton, Basic-search-envelope, and diary-input gaps.
- Live `check_auth_status`: Credentials and profile tokens present. This is not an entitlement check.
- Live Food Box `get_food`: Error 106.
- Live `get_exercises`: Output validation error.

The safe test invocation removes live-server selectors and FatSecret credentials:

```bash
env -u MCP_SERVER_URL -u USE_REAL_SERVER \
  -u FATSECRET_CLIENT_ID -u FATSECRET_CLIENT_SECRET \
  -u FATSECRET_CONSUMER_SECRET -u CF_ACCESS_TEAM_DOMAIN \
  -u CF_ACCESS_AUD npm test
```

An initial unrestricted test invocation failed automatic approval review because inherited selectors can target a live server.
Source inspection established the mock route, and the explicit isolation command then passed review.
All test writes used temporary local files and synthetic values.
Production write operations, custom-food visibility, nutrition round trips, and Chat/Work skill discovery remain unverified.

## v2 implementation status

Branch: `v2`, based on the audited commit. These changes do not require a Premier application or account upgrade.

| Finding | v2 status |
|---|---|
| Basic search | Uses v1 with canonical result arrays, pagination, and explicit limitations. Unknown total counts stay unknown. |
| Premier scope handling | Defaults to Basic. Optional configured scopes permit Premier search and a controlled Basic fallback. No account entitlement changed. |
| Nullable responses | Normalizes empty collections, singleton collections, and alternate exercise envelopes. Optional nutrient fields remain absent or null. |
| Food Box lookup path | Adds a signed personal lookup after public error 106. Production retrieval remains unverified. |
| Diary input | Rejects derived serving ID 0, nonpositive quantities, and invalid calendar dates. |
| Diary writes | Adds duplicate checks, read-back verification, optional approved nutrition comparisons, and durable request IDs. |
| Diary copy | Checks destination overlaps and reads copied entries. Partial overlaps require review without deletion of existing records. |
| Favorite deletion | Uses DELETE, including the generated client and source-generation correction. |
| Barcode transport | Preserves leading zeros and requires 13 digits. Barcode entitlement remains necessary. |
| API errors | Returns controlled tool errors for missing scopes, invalid IDs, IP restrictions, network failures, and malformed responses. |
| Authentication | Preserves credential storage and OAuth signing. Public reads share token requests and renew invalid tokens once. |
| Session lookup | Uses objects without inherited properties. Regression tests assert 404 for prototype names. |
| Publication checks | Runs tests before publication. Pull requests run validation without publication. |

The regression suite includes real MCP tool calls with an injected FatSecret mock.
It covers create, update, delete, copy, saved-meal copy, nutrition mismatches, and preservation of unrelated diary entries.
Journal tests cover new process instances, account separation, conflicting intent, concurrent requests, and uncertain outcomes.
The journal stores hashed intent and entry IDs, with private file permissions.
It does not store API nutrition or profile tokens.

The default duplicate check serializes changes inside one server process.
Stable request IDs and shared persistent storage provide protection across separate processes and later sessions.
The journal namespace follows the profile authorization token, so reauthorization creates a separate namespace.
An uncertain write keeps its pending record and requires diary inspection before another approved attempt.
The connector does not promise a transaction across FatSecret and local storage.

Live write verification still requires disposable-profile access or specifically authorized records.
Premier provisioning, private custom-food visibility, an exhaustive personal catalog, and the packaged recognition skill remain outside these fixes.
Food Box values and historical entries remain unchanged.

Final local verification: 150 tests passed, with zero failures.
Build, lint, type-checking, and the Git whitespace check passed.
These results cover mocked API behavior and local transport tests, not production write verification.
