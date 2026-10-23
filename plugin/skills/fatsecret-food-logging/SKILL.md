---
name: fatsecret-food-logging
description: Identify photographed or described meals, estimate portions, match FatSecret foods, and record approved intake. Use for food logging and reusable meal calibration, including Food Box. Does not provide medical treatment or write body-weight records.
---

Use the FatSecret app in this plugin. FatSecret holds the intake record. Use available tools by their function names below; discover their actual names first.
Check `check_auth_status` before profile operations. Stored authorization does not prove Premier, barcode, or custom-food access.
If this server lacks a named tool, use its existing discovery and diary tools. Explain any missing capability that blocks the request.

## Identify and estimate

Prefer a verified package label, then exact restaurant nutrition, then ingredient-based estimates with matching preparation methods.
For an identifiable product, request its label or official restaurant data when this materially improves the estimate.
Treat readable package nutrition as stronger evidence than a generic database match. Investigate material disagreements before recording.

Separate three types of evidence: visible or user-reported facts, retrieved nutrition, and assumptions.
Identify components and cooking methods. Keep raw and cooked weights distinct. Account for edible portions, bones, skin, leftovers, and shared dishes.
Use known weights or volumes before visual estimates. Use visual references only when their dimensions are known.
A single photo cannot establish exact mass, ingredients, or depth. Never infer that oil or sauce is absent because it is invisible.

Include plausible cooking oil, butter, dressing, sauce, marinade, and breading. Avoid adding them twice when included in a prepared-food entry.
Ask concise questions only when the answer materially changes the estimate: portion size, cooking fat, sauce, or whether sides were eaten.
Use ranges for uncertain portions or hidden ingredients. Keep stated uncertainty consistent with the evidence; avoid precise decimals in the user preview.

## Match and calculate

Search `search_personal_foods` first. If unavailable, check favorites, recent foods, frequent foods, and saved meals.
The personal search is incomplete. An empty result does not prove that a custom food is absent.
Use `get_food_reference` for an approved reusable reference. Use `get_saved_meal_items` for a saved meal.
Then use `search_foods` for unmatched components. Basic search returns summaries; use `get_food` for full serving nutrition.
Never replace an exact label with a loosely related database result solely to obtain a food ID.

Rank candidates by identity, preparation, brand, serving correspondence, and nutritional plausibility.
An exact brand with an incompatible product or serving is not an exact match. Resolve food and serving IDs from returned records.
Never invent IDs or use derived `serving_id=0`. A diary record alone does not prove current serving nutrition.
If a personal ID fails lookup, report the limitation. Use a verified alternative or an existing saved meal only after user approval.

Calculate each nutrient as `requested number_of_units / serving.number_of_units × nutrient in that serving`.
Use the returned measurement unit. For example, a 100 g serving with `number_of_units=100` uses 150 units for 150 g.
For a serving with `number_of_units=1`, 1.5 units means 1.5 such servings. Do not substitute metric grams for serving units.
Stop if units, baseline quantity, or required nutrients are missing. Missing nutrition is unknown, not zero.
For a homemade batch, total ingredients first, then divide by actual yield or the fraction eaten.
Combine identical food/serving pairs before recording. Sum components, including approved additions.
Compare calories with `4 × protein + 4 × carbohydrate + 9 × fat` as a plausibility check.
Investigate large differences. Allow for fiber, alcohol, labeling rules, and rounding; do not force reported calories to match this formula.

## Preview, approve, and record

Show components, portions, calories, protein, carbohydrate, fat, important assumptions, and any useful range.
State which sides are included. Distinguish matched nutrition from unresolved estimates.
Obtain approval for the specific meal and quantities before diary writes. Approval to log does not authorize speculative custom-food creation.
If no reliable match exists, explain the gap. Offer an approved equivalent or defer that component.
Custom-food privacy remains unverified. Do not claim a new item is private or enable experimental server settings during normal logging.

After approval, use explicit dates and the intended meal bucket. Resolve relative dates in the user's timezone.
Check existing entries before recording. Use `create_food_entry` with a stable, distinct `request_id` for each approved component.
Include `expected_nutrition` for the full requested quantity. Reuse the same request ID and arguments after a timeout or later-session retry.
Use `allow_duplicate=true` only for an explicitly intended additional identical portion.
Read the result and subsequent diary entries. Report any quantity or nutrient mismatch. Do not log again to correct a verification warning.
After a partial meal failure, inspect existing entries and reconcile the missing components. Never clear or replace unrelated diary data.
Require explicit approval for edits, deletions, copies, or historical changes beyond the approved logging request.

## Reuse and calibration

Offer `save_food_reference` after the user approves a reusable composition. It stores labels, notes, IDs, and quantities in this account's local index.
It creates no FatSecret custom food. Use `expected_revision` from the current reference for approved replacements or deletions.
Fetch fresh nutrition with `get_food_reference` in later sessions. Confirm material changes in portion, recipe, or preparation before reuse.
If reference tools are unavailable, use existing saved meals with verified items. Do not write to a separate personal Skills library.

For repeated meals and Food Box, read [calibration.md](references/calibration.md).
