# Experimental food API assumptions

This document belongs to the experimental commit after `4093bc1`.
Revert that commit to remove its adapter, creation journal, input additions, and experimental tests.
The reference tools and plugin skill remain in `4093bc1`. They use public food details after the revert.
The experimental journal files remain on disk after a revert. Preserve them for reconciliation; they contain hashes and created IDs only.

# Default behavior

`FATSECRET_ENABLE_EXPERIMENTAL_FOODS` is absent or false by default. Normal food logging never enables it.
Disabled mode sends no custom-food creation request and no signed personal-food lookup.
Public Basic search, public details, diary tools, and local references remain available under their existing authorization requirements.

Only an operator can enable the adapter by setting `FATSECRET_ENABLE_EXPERIMENTAL_FOODS=true` before server startup.
This flag does not grant scopes, verify privacy, or authorize testing against production records.
Use an explicitly authorized disposable profile for all creation and diary write tests.

# Hypotheses and evidence needed

| Behavior | Documentation and uncertainty | Required live evidence |
| --- | --- | --- |
| Signed `GET /food/v5` can retrieve user-created foods | [food.get v5](https://platform.fatsecret.com/docs/v5/food.get) accepts OAuth 1.0 and OAuth 2.0. This does not establish that existing custom IDs are accessible to this profile. | Read an authorized test custom food using the correct profile token. Check its identity, real serving IDs, units, and macros. Diagnose error 106 separately from missing access. |
| `POST /food/v2` creates a reusable item for the authorized user | [food.create v2](https://platform.fatsecret.com/docs/v2/food.create) is a Premier profile operation. Its parameters have no explicit privacy control. | Create one authorized test record. Retrieve it after a new connector session. Inspect visibility in the owner account and another authorized test context. Confirm current terms or obtain provider clarification. |
| The submitted standardized serving returns with a usable identifier | The create response supplies only a food ID. The adapter matches the requested g/ml quantity in a subsequent signed lookup. | Check exact quantities and macros. Verify the returned serving can be logged and read back in the disposable diary. Derived serving 0 must never be used. |

Premier approval alone does not prove these hypotheses. Verify account scopes, token renewal, profile authorization, region, and IP restrictions separately.
Do not infer privacy from a public lookup failure or the words “for the user.” The adapter always reports `visibility: "unverified"`.
These checks have not run against live records during development.

# Adapter behavior

With the flag enabled, `get_food` with `source: "personal"` uses signed profile authorization.
`source: "auto"` tries that path only after public error 106 and only when profile credentials exist.
`source: "public"` never falls back. Other errors retain their original controlled failure.
References use the same gated fallback when resolving an inaccessible public ID.

`create_food` additionally requires:

- Explicit approval for a disposable test record whose visibility is unknown.
- `allow_unverified_visibility: true` and a stable `request_id`.
- A positive `serving_amount` and an explicit `serving_amount_unit` of `g` or `ml`.

The adapter does not pass its consent or request fields to FatSecret.
It persists a pending request before the POST, then records the returned food ID before lookup.
An identical payload reuses its created ID, even with another request ID. Changed arguments under the same request ID fail.
Deduplication covers identical submitted data; it is not a fuzzy catalog match or a promise about foods created outside this connector.
The journal is account-scoped using the same token-based namespace as local references. A new authorization token creates another namespace.

A timeout or unknown POST outcome blocks automatic retries. Inspect the disposable profile before reconciling the journal.
After a successful creation response, failed lookup or mismatched nutrition retains the ID. Retrying performs lookup only.
The adapter does not delete a created food, change diary entries, or automatically save a reference.

Verification requires the requested identity and brand, a real serving, matching standardized quantity, and all four core nutrients.
It returns the serving quantity, retrieved nutrients, differences, and rounding tolerance: 1 kcal and 0.1 g per macro.
Differences beyond those tolerances fail with the created food ID. A matching result still does not verify privacy.
Only g/ml round trips are supported here. An ounce conversion requires additional verified behavior before enabling that input.

After verification and approval, `save_food_reference` can register the returned IDs and quantity for future name-based discovery.
Use a later approved production implementation once visibility and retrieval are established. Do not promote this flag into normal skill instructions.
