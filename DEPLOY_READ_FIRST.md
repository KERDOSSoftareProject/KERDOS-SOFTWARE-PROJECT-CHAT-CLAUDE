# KERDOS ENGINE v3 — deployment hold

Read `REVIEW_STATUS.md` first. This integrated review build is not approved for upload to the live site until the database and real-data checks there are complete.

This package keeps GitHub's current working Pages workflow and its asset-path verification script. The original v3 ZIP omitted that script and supplied a workflow without the blank-screen protection.

1. In your project's Supabase SQL Editor, run `KERDOS_DATABASE_UPDATE_CLEAN.sql` and confirm it reports success. It contains migrations 003–007 and 009; migration 008 is intentionally excluded. Do not upload the app before the SQL completes.
2. Unzip this package. Open the `kerdos` folder. In your GitHub repository's **root**, upload the contents of that folder, not the outer folder or the ZIP. Choose `Add file` → `Upload files`, drag the files and folders, commit to `main`. Leave existing GitHub files not listed here in place.
3. Wait for `Deploy KERDOS Preview` to show green on that new commit. Refresh the Pages URL, sign in, check Item Catalog and an Order Guide item.

The package was verified with `npm test`, `npm run build`, regeneration of the combined database file, and the GitHub Pages asset-path check. The SQL has not been executed against your database from this workspace, and the app has not been pushed to GitHub from this workspace.

Preserve the import history. Category suggestions and product matches still need review according to the rules in `READ_FIRST.md`.
