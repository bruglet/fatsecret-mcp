# Reusable food references

The connector adds four tools:

- `search_personal_foods`: Search local references, favorites, recent foods, frequent foods, and saved-meal names. It reports unavailable sources.
- `save_food_reference`: Save an approved label, notes, food IDs, real serving IDs, and quantities. It validates each portion first.
- `get_food_reference`: Retrieve a reference with fresh serving nutrition and calculated totals.
- `delete_food_reference`: Remove a local reference after checking its revision. It leaves all FatSecret records intact.

Search results are incomplete. FatSecret exposes no verified exhaustive custom-food listing in the reviewed reference.
Saved-meal results identify containers. Use `get_saved_meal_items` before estimating or logging their contents.
Discovery results do not provide verified serving IDs. Use `get_food` before logging a food match.

For a new reference, send `approved: true` with its user-approved composition.
To change an existing reference, also send its current `revision` as `expected_revision`.
Identical saves reuse the existing revision. Conflicting updates fail instead of replacing another change.
Delete requires both approval and the current revision.
Use one part per food/serving pair; combine quantities for repeated pairs before recording.

Nutrition scales by the requested units divided by the serving's `number_of_units`.
Missing quantities, units, or core nutrients stop the calculation. Unknown values are never replaced with zero.
References resolve all parts before returning totals. A failed part prevents a misleading partial total.

References persist below `FATSECRET_CONFIG_DIR/food-references/` with private file permissions and atomic replacement.
The account namespace hashes the OAuth consumer key and profile access token. No token or downloaded nutrition is stored in reference files.
User-authored names and notes are stored locally. Protect and back up this directory with the existing credential directory.
Persist this directory across container restarts. Replicas need shared storage with atomic file operations, or route an account to one instance.
A new authorization token starts a separate namespace. References require explicit migration after reauthorization; no cross-account guessing occurs.
An abandoned `.lock` file requires operator inspection before removal. It is never automatically treated as stale during a write.

The index stores identifiers rather than mirroring food nutrition. See FatSecret's [storable-data guide](https://platform.fatsecret.com/docs/guides/storable-data).
It cannot repair an inaccessible custom food. Private visibility and creation/retrieval require separate API verification.

# Plugin source

`plugin/` contains the existing Fatsecret app binding and a discoverable `fatsecret-food-logging` skill.
The plugin ID and app connection match the user's existing private plugin. The legacy package layout preserves its current metadata, including the null plugin prompt.
A portable-manifest migration is deferred because its documented prompt type cannot represent that null value without a change.
Automatic skill selection is enabled. No product restriction excludes Chat or Work where app-backed skills are supported.
The workflow uses model vision; FatSecret's paid image and NLP add-ons are unnecessary.
The [source review](food-skill-research.md) records the techniques, licenses, and review cases.

This is source preparation only. The account plugin was not updated, installed, or published during development.
Chat/Work discovery requires a later approved release and a client check. The deployed server must also receive the connector tools first.
Do not publish this package as a second plugin or replace the app binding during that release.

# Verification limits

Regression tests use mocked API responses and temporary local storage. They verify portion arithmetic, persistence, isolation, conflicts, and MCP routing.
They do not establish live private-food visibility, live nutrition round trips, Premier entitlements, or model recognition accuracy.
Use a disposable authorized profile for future write tests. No production diary or custom food was changed during this implementation.
