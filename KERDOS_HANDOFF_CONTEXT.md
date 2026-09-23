# KERDOS — HANDOFF CONTEXT (as of September 23, 2026)

Read this first. It replaces every older KERDOS context document. The
source code in this zip is the current, deployed, working version.

---

## 1. What KERDOS is

A universal SaaS procurement and price-comparison platform. Any business
that buys from multiple vendors imports vendor price sheets and invoices,
KERDOS maps every vendor's proprietary item to one client-owned catalog
item, normalizes price per unit, and shows the cheapest vendor for each
item in an Order Guide with plus/minus ordering.

- Owner: Spiro. Not a programmer. Treat him as the end user and the
  product owner. He makes design decisions; you write and verify code.
- Live test client: Hornet's Nest Deli, Branford CT. Vendors: Minore's
  Meats, Ferraro Foods, US Foods, Carbonella & DeSarbo, WB Mason, Mina
  Foods, Cityline Foods. Cityline and Carbonella have no vendor item codes.
- Core value: price comparison and ordering FIRST. Importing and
  record-keeping are supporting plumbing, not the product.
- Long-term: multi-industry, large client base. Nothing may be hardcoded
  for the deli, the food industry, or any specific client.

## 2. Non-negotiable decisions (do not re-raise these)

1. **No AI at runtime.** All matching and classification is deterministic
   code. An AI-fallback classifier (Supabase Edge Function calling the
   Claude API) was built and explicitly reverted. Do not propose it again.
   Classification is driven by per-industry keyword dictionaries stored in
   the database (culinary/restaurant v1 exists; other industries get built
   the same way when a client arrives).
2. **Universal-client model.** Configuration lives in the database
   (catalog_categories with keywords, industry templates), never in code.
3. **Vendor independence.** KERDOS must not depend on Supabase or GitHub
   specifically. The UI never imports Supabase; all provider access goes
   through `src/backend/contract.js` and `src/backend/supabase.js`.
4. **Verification standard.** Every code change must be actually tested
   with real runs before being presented as done. Never guess. If you
   don't know, read the code. State explicitly what was verified and what
   was not.
5. **Branding** is the plain owl mark. Coin designs were rejected.
6. **Scope discipline.** Never advertise a feature that doesn't exist.
7. **Code style.** Modular, compartmentalized, simple. One shared
   implementation over two that can drift apart. "If it needs
   explanation it is too complicated."

## 3. How Spiro works (communication and workflow)

- Short, direct communication. No step-by-step walkthroughs, no
  card-style UI, no micro-guidance. "Let me know when you're done."
- Corrects course fast and expects corrections taken at face value.
- No file downloads per intermediate step. Files only when ready to
  deploy, packaged so they can be dropped straight into the repo.
- **He works only in the GitHub web editor. No terminal.** Deploys happen
  by uploading files through "Add file > Upload files" on github.com.
  Dragging a folder (e.g. `src`) into the upload page preserves paths and
  replaces matching files in one commit.
- Known upload pitfalls (all hit today):
  - Files renamed by the Mac downloads folder (`App (2).jsx`) create
    duplicates in the repo instead of replacing.
  - Dot-files (`.env.example`) are hidden by macOS and never get uploaded.
    Create them with "Add file > Create new file" instead.
  - Uploading from the repo root puts files in the root, not `src/core`.
- GitHub Desktop was suggested as a better workflow; not adopted yet.

## 4. Stack and infrastructure

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, single-page app |
| Backend | Supabase (Postgres + auth + storage + RPCs) at antpbtorhqghrjqzftub.supabase.co |
| Document parsing | Local in the browser: pdfjs-dist, SheetJS (xlsx), tesseract.js OCR (assets bundled under `public/ocr`) |
| Hosting | GitHub Pages via GitHub Actions |
| Repo | github.com/KERDOSSoftareProject/KERDOS-SOFTWARE-PROJECT-CHAT-CLAUDE (the older `KERDOS` repo is obsolete) |
| Live URL | https://kerdossoftareproject.github.io/KERDOS-SOFTWARE-PROJECT-CHAT-CLAUDE/ |

Deploy workflow (`.github/workflows/deploy-pages.yml`): on every push to
main it runs `npm ci`, `npm test`, `npm run build`, then publishes `dist`.
A red run means nothing was deployed. Base path is derived automatically
from the repo name. Secrets required: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`.

## 5. Source layout

```
src/
  main.jsx                 entry
  App.jsx                  shell, session, data loading, Order Guide, nav
  pages/                   one file per screen or modal
    AccessPages.jsx        landing / org gate
    DocumentPages.jsx      Invoices and Price Sheets history pages
    ImportModal.jsx        paste/upload import flow
    ItemCatalogPanel.jsx   client catalog + review/mapping actions
    CatalogAdminPanel.jsx  category management
    TeamPanel.jsx          team/roles
    VendorDetail.jsx       per-vendor page
    RecordModals.jsx       invoice edit, add vendor
  services/                named KERDOS operations (catalog, categories,
                           documents, imports, operations, organization,
                           vendors); the only place provider queries live
  backend/                 contract.js (the KERDOS backend contract),
                           supabase.js (the only Supabase code), index.js
  core/
    ordering.js            basket/order solver, vendor minimums
    catalog-browse.js      shared search + sort helpers (NEW today)
  procurement.js           unit parsing, pack-size normalization, price per
                           unit, product identity, safeProductScore matching
  ingestion.js             price-sheet/invoice text extraction
  document-reader.js       file-type routing (pdf, xlsx, csv, eml, html, ocr)
  reporting.js             CSV exports (catalog export, price variance report)
  localization.js          currency/date formatting
  offline-store.js         last-synced snapshot for outages
  session.js               session controller
  ui/styles.js             palette and shared style helpers
  *-test.mjs               one test file per module, all run by `npm test`
knowledge/                 SQL migrations 003–007, vocabulary, restaurant
                           dictionary v1
KERDOS_DATABASE_UPDATE_CLEAN.sql   migrations 003–007 combined (generated,
                           do not hand-edit)
```

Nav: Order Guide (default after sign-in), Import, Item Catalog (badge =
review count), Records, Admin. Roles: owner / manager / employee.

## 6. Key database tables

catalog_categories; catalog_items (brand_locked, locked_brand,
matching_behavior, canonical_unit, master_item_number); invite_codes;
invoice_lines (match_confidence); invoices (file_path, file_name, status);
item_mappings (confidence_score, match_method, comparison_track);
like_product_groups; locations; organization_members; organizations
(settings jsonb incl. price_refresh_days, logo_url); price_history;
profiles; purchase_order_lines; purchase_orders; vendor_items
(vendor_item_code, price_source).

## 7. Matching system (how it works today)

- One shared size-aware scorer, `safeProductScore` in `procurement.js`,
  used for both catalog matching and invoice-line matching. Two separate
  engines were merged after they drifted and one silently merged
  "Chicken Breast 40lb" with "Chicken Thighs 40lb".
- Confidence tiers: Confirmed (exact) / High (85%+) / Needs review
  (50–84% catalog, 60–84% invoice) / No match → new item. Invoice
  matching uses the stricter floor plus a size-token conflict check
  because a wrong invoice match creates a false overcharge alert.
- comparison_track "new" = a single vendor introducing a product = clean
  100%, not flagged. Only "similar" (fuzzy merge across vendors) is real
  uncertainty and gets flagged.
- Review happens inside Item Catalog: Confirm (bump to exact) or Remap
  (point at another item, or split into a new item).
- An invoice line matching nothing auto-creates a vendor_item with
  price_source 'invoice'; it graduates to 'price_list' when a real price
  sheet confirms it. Prefer a visible duplicate over a silent wrong match.
- last_updated bumps on every price-sheet appearance; stale prices
  (past org's price_refresh_days) show $0 and are excluded from cheapest
  pick and vendor-minimum fill.
- Category keyword matching is plural-tolerant (prefix comparison).

## 8. What happened today (September 23, 2026)

**Problem:** white window after sign-in on the live site.

**Cause:** when App.jsx was split into `pages/`, four functions were left
being called in files where they no longer existed. Tests and build both
pass in that state because nothing checks for undefined names; the
crash only happens in the browser.

| Missing name | Where it was called | Effect |
|---|---|---|
| itemMatchesSearch | App.jsx Order Guide filter | white screen on load |
| compareItems | App.jsx Order Guide sort | white screen once any category has 2+ items |
| unitsForDimension | ItemCatalogPanel.jsx mapping panel | crash opening the panel |
| viewStoredFile | VendorDetail.jsx invoice View button | crash on click |

**Fix (deployed, green run #41):**
- New `src/core/catalog-browse.js` exporting `compareItems` and
  `itemMatchesSearch`; both App.jsx and ItemCatalogPanel.jsx import it.
- ItemCatalogPanel.jsx imports `unitsForDimension` from procurement.js.
- App.jsx passes `onViewOriginal={viewStoredFile}` into VendorDetail,
  which now takes it as a prop.
- New `src/core/catalog-browse-test.mjs` (10 tests) added to `npm test`.
- `.env.example` was missing from the repo (hidden dot-file never
  uploaded), which made the deployment test fail; created directly on
  GitHub.

**Verified:** full suite passes (78 regression, 19 ingestion, 10
catalog-browse, plus service/session/backend/offline/deployment tests);
TypeScript undefined-name scan reports zero across all source files;
bundle check resolves all imports. Live click-through by Spiro pending
at time of writing.

## 9. Repo cleanup still pending (harmless, low priority)

- Delete `src/data.js` (obsolete compatibility bridge, nothing imports it).
- Delete the three `.zip` files and the committed `dist/` folder at repo
  root (CI builds its own dist; the committed one is stale).

## 10. Open items and suggested next steps

1. **Add an undefined-name check to CI** so this bug class can never ship
   again (ESLint `no-undef`, or `tsc --checkJs --noEmit`). One dev
   dependency plus one workflow line. Highest value, smallest change.
2. **Add a React error boundary** so any future crash shows an error
   message instead of a blank white page.
3. Optional: headless-browser smoke test that signs in and loads the
   Order Guide, Item Catalog, and a vendor page.
4. **RLS / roles (needs Spiro's decision, not more code):** exact
   Employee-tier permissions were never fully specified beyond "no Import,
   no vendor pricing". Known DB-level issues: `user_has_role()` only
   recognizes 'owner' and 'member'; organizations SELECT and invite_codes
   SELECT/UPDATE policies are qual=true. Deliberately deferred.
5. Open design question: should invoice-only vendors (no price sheet ever
   imported) populate the catalog? Partially answered by the auto-create
   behavior in section 7; not fully decided.
6. Future phase: vendor API integration (live pricing via distributor
   logins). Noted, not started.
7. Output layer: CSV export exists (catalog export, price variance
   report). PDF/print-formatted versions are a reasonable next step if
   Spiro wants them.

## 11. Rules for any assistant working on this

- Read the actual code before answering questions about it.
- Test every change with real runs. Say exactly what you verified.
- Package deploys as files that drop straight into the repo at the right
  paths, and say which files are new vs. replaced.
- Never propose runtime AI, a Supabase- or GitHub-specific dependency, or
  anything hardcoded for one client or industry.
- Keep replies short. Spiro has no patience for walkthroughs, and he's
  right not to.
