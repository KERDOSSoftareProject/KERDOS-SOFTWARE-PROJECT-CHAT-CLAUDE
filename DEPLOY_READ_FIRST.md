# KERDOS — automatic import review build

This package contains the complete app source. This update requires one new database migration for safe document deletion.

1. In the existing Supabase project's SQL Editor, run only `knowledge/migration_011_document_deletion.sql` and confirm success. It installs the two document-delete operations; it does not delete any data by itself.
2. Unzip the package. Upload its contents (files and folders, not the ZIP) into the root of the existing GitHub repository on `main`.
3. Wait for `Deploy KERDOS Preview` to turn green, then refresh the app.
4. On Price Sheets, select a file. The row review opens automatically; review and save the rows deliberately. On Invoices, select a file and confirm the date and flagged lines; the original invoice is retained when the invoice saves.

This build includes the Item Catalog pack dropdown with Case / full pack and Each / individual item choices, live unit-cost preview, Apply changes, Add to Order Guide, and prior-invoice clues when importing a price sheet. Physical pack contents and the vendor's quoted-price unit are separate fields. Existing database migrations, including the Item Catalog save RPC, must already be installed for those older features to work.

Order Guide opens to Full List with category filters. Price Sheet History offers Clear current prices, Delete source, and Delete & re-import. Invoice deletion removes its invoice record and lines. The test-client reset file is separate and must not be run as part of this deployment.

The browser import flow was checked with an earlier 96-item vendor sheet. The specific sheet reported as failing in production has not been provided, so its exact parsing behavior remains unverified. An interrupted import still cannot safely resume; keep the tab open until the import completes.
