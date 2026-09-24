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

Morning: white window after sign-in, caused by four functions called in
files that no longer defined them after App.jsx was split. Fixed, deployed
(green run #41). Lesson: tests and build don't catch undefined names, so
ESLint `no-undef` now runs inside `npm test`.

Afternoon (ChatGPT, local, not deployed): matching tightened to the
agreed rule set (exact identity + exact pack + brand agreement; engine
auto-verifies only with a second vendor), Order Guide accepts only
100%-verified mappings, Item Catalog reworked into Mapped / Not mapped,
invoice lines become historical charges, error boundary, ESLint,
portable backend adapter, PDF layout reader.

Afternoon (Claude, local, not deployed; see READ_FIRST.md):
- Price basis completed end to end: migration 009 adds `selling_unit` and
  `price_basis` to vendor_items and price_history; imports record the
  basis from the sheet's selling unit; every quote is converted to the
  price of one full pack before ranking; a per-pound/per-each quote whose
  pack can't convert is blocked with a reason instead of ranked wrong;
  invoice variance is computed on the basis the invoice bills in.
- Bulk confirm for single-vendor listings that already pass verification,
  so day one after deploy isn't hundreds of one-at-a-time clicks.
- Engine-first matching improvements (see READ_FIRST.md §3): GTIN /
  manufacturer-code capture and identifier-proven identity, pack read
  from the description tail, pack filled from the vendor's own invoice,
  one "why not 100%" reason code per mapping with a grouped Not mapped
  view, an auto-verify rate on every import, abbreviation learning from
  confirmations (spelling only), catch-weight and #10-can pack parsing,
  a one-click "apply engine-verified matches" re-check, and best-guess
  category placement with a review flag (new products no longer land in
  Uncategorized unless they resemble nothing).

## 9. Deploy order for the pending build

1. Run `KERDOS_DATABASE_UPDATE_CLEAN.sql` in the Supabase SQL editor
   (it is idempotent; migration 009 is the only new part). The new RPC
   parameters default to null, so the currently deployed frontend keeps
   working after the migration.
2. Upload the source and let the green run deploy it.
3. In Item Catalog, press "Confirm N ready single-vendor products".

Pending cleanup (harmless): delete `src/data.js`, the three `.zip` files
and `dist/` at the repo root.

## 10. Open items

1. Per-vendor-format coverage: selling unit, UPC/GTIN and manufacturer
   columns are read by header name; formats that put them elsewhere (or
   in PDF layouts) record nothing. Extend per format with a test row each
   from the real files; the Not mapped reason counts show which gap is
   biggest.
2. Learning covers abbreviation-shaped pairs only. Irregular ones
   ("chix"→"chicken", "xl"→"extra large") still need one Admin vocabulary
   entry per organization; a per-industry starter list would cover most.
3. Sole-source rule carve-out (Spiro's decision): an engine-created
   catalog item with a vendor code and readable pack cannot be pointed
   at the wrong item; auto-verifying that narrow case would remove most
   remaining manual confirmations. Not implemented; bulk confirm is the
   workaround.
4. Shared vendor knowledge across clients at scale (codes → identity,
   never prices).
5. RLS / roles: see ACCESS_POLICY_REVIEW.md. Needs Spiro's decision and a
   staging database, not more frontend code.
6. Headless-browser smoke test (sign in, load Order Guide, Item Catalog,
   a vendor page). The undefined-name check covers the crash class we
   hit; this would cover runtime data errors.
7. Future phase: vendor API integration. Noted, not started.

## 11. Rules for any assistant working on this

- Read the actual code before answering questions about it.
- Test every change with real runs. Say exactly what you verified.
- Package deploys as files that drop straight into the repo at the right
  paths, and say which files are new vs. replaced.
- Never propose runtime AI, a Supabase- or GitHub-specific dependency, or
  anything hardcoded for one client or industry.
- Keep replies short. Spiro has no patience for walkthroughs, and he's
  right not to.
