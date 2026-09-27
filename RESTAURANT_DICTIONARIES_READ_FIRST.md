# KERDOS dictionaries and import correction — 2026-09-27

This ZIP is an UPDATE ONLY, containing changed files for the local final_v4 reviewed source.
It includes the dictionary additions and the repeated-import correction together.
Keep the existing repository; do not replace it with just this ZIP.
The exact GitHub commit currently deployed has not yet been supplied or verified.
Compare this build against that commit before uploading replacements. It has not
been deployed to the user's live app.

## What this adds

Restaurant selection automatically activates six bundled dictionaries: restaurant
operations, chef terms, food, ingredients, hospitality, and restaurant slang.
There are 242 entries and 442 distinct normalized spellings, including acronyms
and abbreviations. This is an initial maintained collection, not an exhaustive
dictionary of all foods or every regional/vendor expression.

Existing database categories, starter templates, organization vocabulary, source
documents, and saved vendor associations are retained. Bundled terms work without
running a new SQL file or reloading a starter template. Existing backend migrations
through 015 are still required by the underlying v4 app.

No new external service, AI inference service, library dependency, or runtime
dictionary lookup is introduced. An industry profile supplies the knowledge;
the generic phrase and procurement code does not contain restaurant terms.
Other selected industries retain their existing vocabulary. Switching organizations
or industries configures the active profile and organization terms together.

## How it is used

- Product aliases expand for interpretation, while the stored source description
  remains as supplied. Multiword phrases take priority over shorter terms.
- Saved organization synonyms can express local/vendor wording, including phrases.
- Category suggestion, import matching, manual mapping verification, and Order
  Guide identity checks call the same product interpretation path.
- Ambiguous terms such as GF, FF, SF, RW, and PEPP carry an unresolved explanation;
  they do not prove product identity. Context is required for B/S, P&D, S/S, and
  several other abbreviations.
- Operational expressions such as 86, all day, and on the fly have reference
  meanings. They do not change stock availability, prices, or product identity.
  Slang meanings are not globally forced into exact product matches.
- Admin's Vocabulary area shows that the Restaurant dictionaries are active and
  lets a user search every entry, expansion, meaning, and context requirement.
- Import row explanations expose terminology evidence alongside the raw row.

## The potato case

YUKON GOLD and YUKON GOLD POTATOES resolve to the same variety/product description.
YUKON GOLD A and YUKON GOLD POTATOES SIZE A agree on the explicit size as well.
YUKON GOLD A versus YUKON GOLD B are different. YUKON GOLD A versus YUKON GOLD
POTATOES isolates the missing potato size instead of reporting that the word
potato is unverified. No size is inferred from an empty field.

Consequently the screenshot's exact pair still needs evidence about the unstated
size before this build will declare a fully verified cross-vendor match. A
dictionary alone cannot establish the absent supplier specification.

Pack spellings 50 LB, 50LB, and 1/50 LB compare as one purchasing configuration.
The catalog no longer loses a known pack merely because existing vendors spell
it differently. Different inner configurations (4/5 LB and 1/20 LB), different
dimensions, unknown packs, and catch-weight differences retain their checks.

This update does not merge already-created catalog IDs. An existing duplicate
repair needs a separate reviewed association/merge operation with retained IDs,
history, and references. That work remains outstanding. The existing per-field
accuracy model also remains an evidence heuristic, not a calibrated statistical
probability; this update does not certify a value because it appeared in a dictionary.

## Verification

The complete npm test suite and production build pass. Added checks cover:
17 equivalent wording pairs, 10 distinct product pairs, explicit and missing
potato sizes, ambiguous acronyms, contextual aliases, operational slang, retained
organization vocabulary, changing industries/organizations, shared mapping
verification, and a third vendor linking to a catalog with equivalent pack spellings.
The tests exercise the actual catalog service using a provider that fails if an
unnecessary new item is inserted. No live Supabase writes or production imports
were performed by the assistant.

## Source references used for terminology review

Definitions in the bundled data are short independently written descriptions.
References are development notes; the application never contacts these sources.

- Canadian Food Inspection Agency, Yukon Gold variety:
  https://inspection.canada.ca/en/plant-health/potatoes/potato-varieties/yukon-gold
- USDA potato inspection instructions, Size A designation:
  https://www.ams.usda.gov/sites/default/files/media/Potato_%28including_Seed_Potatoes%29_Inspection_Instructions%5B1%5D.pdf
- Escoffier, knife cuts:
  https://www.escoffier.edu/blog/culinary-arts/8-knife-cuts-every-professional-cook-should-know/
- Escoffier, kitchen language:
  https://www.escoffier.edu/blog/culinary-arts/slang-and-lingo-every-chef-should-learn/
- Simplot, IQF terminology on its raspberry specification:
  https://www.simplotfoods.com/products/raspberries/10071179199410/specifications

## Import correction included in this update

The pack parser accepts quantity-to-unit hyphens and known unit shorthand, such
as 18-LBS, 8/3-LB and 8/QT. These rules work without an industry selected and in
other industries. PCE is recognized as piece. Actual package structure, units,
catch-weight markers and additional unexplained text still matter.

For a vendor item found by its existing identifier, an incomplete or changed
row is saved for review instead of being discarded by the old pack guard.
Its existing catalog link, accepted fields and quotation remain stored. The
incoming amount and source fields are visible in Item Catalog with specific
reasons. Incoming quotes awaiting review do not become active ordering prices.
Document parsing issues and invoice disagreements also remain attached.

The summary no longer claims every failed row had the same cause, or labels
all review rows as a selling-unit problem. Actual database failures still
remain retryable through the existing progress records.

No client/vendor names, prices, product lists or workbook are bundled as learned
rules. Tests use synthetic cases. Restaurant knowledge stays in its industry
profile; organization corrections remain organization data.

On the supplied 157-row workbook, readable packs increased from 42 to 120.
37 packs still lacked enough interpretable information. A local replay using
unchanged source fields as the prior listing yielded 91 quotes passing the
row checks and 66 requiring review (37 pack issues and 35 quoted-unit issues,
with overlap). This is NOT an observed live update count or Order Guide count.
The actual prior database fields, invoice evidence, category and mapping checks
can change eligibility. Numeric-only packs are not assumed to be counts or
automatically decoded as dates; ambiguous quoted units are not guessed.

The full test suite, production build and GitHub Pages path checks pass.
The new behavioral tests cover generic pack variants across industries,
changed specs, retained corrections, unchanged unresolved packs, code-only
repeat rows, invoice disagreements and incompatible quote units. No new SQL
migration, dependency or data reset is needed for this correction.

## Applying the update

1. Confirm that the current repository contains the reviewed v4 baseline, or
   compare the base hashes in RESTAURANT_DICTIONARY_CHANGES.json and merge any
   later edits. The live commit has not been verified from this workspace.
2. Extract this ZIP. Upload its src folder and package.json at the repository
   root, preserving the subfolders. Do not delete existing files. This archive
   has fewer than 100 files; it excludes dependencies and built output.
3. After the deployment succeeds, refresh the application. No database clearing
   is part of this update.

## Next live test

Import a different week for an existing vendor without deleting the previous
import. Check that unchanged vendor items retain their KERDOS association, prices
update, genuinely new vendor items are added once, and meaningful changes are
flagged. The new code is not active on the live site until deployed. Retry the same
partial sheet. Completed rows should be skipped and failed rows resumed.
Rows already saved for review are completed checkpoints; finish those in Item
Catalog, or import a later sheet after resolving the fields. Do not clear the
company, vendors, catalog or saved associations for this test.
