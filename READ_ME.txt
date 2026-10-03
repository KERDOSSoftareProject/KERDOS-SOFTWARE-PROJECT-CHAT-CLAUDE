KERDOS — Simple Case / Each Pack Control
Based on current GitHub main: 2a43f1d (October 3, 2026).

DEPLOY
1. Unzip this file.
2. In GitHub open src, then pages.
3. Upload CatalogRows.jsx from the extracted src/pages folder into that same GitHub src/pages folder. Replace the existing file and commit.
4. Wait for Actions to turn green, then refresh KERDOS with Shift + Command + R.

Only CatalogRows.jsx is needed for deployment. The updated catalog-qualification-test.mjs is included for maintainers and can also replace the same file under src/pages.
Do not upload these files into a root-level pages folder.

RESULT
Pack dropdown: Case or Each.
Each count: 1, locked.
Case count: editable whole number.
Weight/volume remains separate under Details and existing pack measurements are retained.
Unknown imported packs stay unknown until corrected; original text remains visible.
Apply changes still saves the selected row through the existing backend.
No database migration is needed for this control change.

OPTIONAL TEST RESET
KERDOS_CLEAR_TEST_DATA.sql clears this test company's imported records and item associations. Retains company, vendors, users, categories, settings, vocabulary and NVIM counters. It does not delete uploaded Storage file bytes or browser-local saved baskets. Run the whole SQL in Supabase SQL Editor after deployment, with the app closed; then reopen the app online before importing. Its result counts should all be 0.

CHECKED
Lint, production build, catalog rendering, catalog field logic, existing atomic row-save SQL checks, and reset SQL against an isolated Postgres test database. Live deployment and the actual Supabase reset have not been run by Codex.
