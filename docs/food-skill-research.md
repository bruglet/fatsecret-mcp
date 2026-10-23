# Food workflow source review

Reviewed on 2026-10-23. These are technique references. No third-party source code, nutrient tables, or skill prose is bundled.
The packaged instructions are written for this connector. Repository activity is not evidence of nutritional accuracy.

| Source and pinned revision | License and maintenance evidence | Useful technique | Limits and decision |
| --- | --- | --- | --- |
| [wellness-nourish](https://github.com/davidmosiah/wellness-nourish/tree/96d5df066c18375820c81e632108dcfc5b065b66) | [MIT](https://github.com/davidmosiah/wellness-nourish/blob/96d5df066c18375820c81e632108dcfc5b065b66/LICENSE); latest reviewed commit 2026-10-17; fixtures and a documented food-data evaluation | Prefer label/barcode evidence over plate estimates; separate preview from approved mutation; prefer existing MCP tools | Its own local intake database conflicts with FatSecret as the intake record. No independent photo-accuracy validation was found. Reuse the decision principles only. |
| [health-coach](https://github.com/H1an1/health-coach/tree/9c2da9483eb826d0ff4b42cb96f79e1218071215) | [MIT](https://github.com/H1an1/health-coach/blob/9c2da9483eb826d0ff4b42cb96f79e1218071215/LICENSE); latest reviewed commit 2026-03-22; 16 commits at review | Decompose meals; use reference objects; state portion ranges and ask useful questions | Clinical claims lack supporting validation. Fixed hand and plate sizes are unsuitable for general use. A malformed male BMR expression appears in its reference. Exclude medical advice, tables, and fixed dimensions. |
| [nutrition-coach-skill](https://github.com/nativeName/nutrition-coach-skill/tree/680875b1e3668969f4e3b17f849123d8867cff1d) | [MIT](https://github.com/nativeName/nutrition-coach-skill/blob/680875b1e3668969f4e3b17f849123d8867cff1d/LICENSE); latest reviewed commit 2026-07-31; 4 commits at review | Calculate from ingredient quantities; distinguish raw/cooked weights; expose missing matches and brand uncertainty | Exact arithmetic cannot remove uncertain inputs. Fixed cooking conversions and broad medical guidance are excluded. No validated image-accuracy result was found. |

All three permit reuse under MIT terms. No copied material requires an additional notice in this package.
If future work copies code or prose, preserve the applicable copyright and license notices.

# Behavioral review cases

These cases guide manual review. They are not claims of measured vision accuracy or automated model evaluation.

| Input | Required behavior |
| --- | --- |
| Clear package label, generic search disagrees | Prefer the verified label; resolve product and serving disagreement before writing. |
| Chicken photo, unknown frying oil | Separate visible chicken from assumed fat; ask about preparation if it changes the estimate materially. |
| Food Box with rice already logged | Estimate entrée only; disclose uncertain sauce/oil; preserve the rice and historical records. |
| Approved reference reopened in another session | Resolve stored IDs and quantities with fresh nutrition; preserve inclusion notes. |
| Personal Food Box ID returns 106 | Report unresolved retrieval; do not infer deletion, invent serving IDs, or recreate the food automatically. |
| Two-component write times out after one succeeds | Read the diary; reuse request IDs; reconcile without logging the first component twice. |
| User requests a private unmatched food | Explain unverified API visibility; no speculative creation or experimental flag changes. |
| Three days of weight gain after salty meals | Do not force intake estimates to match weight; review longer trends only if requested. |
