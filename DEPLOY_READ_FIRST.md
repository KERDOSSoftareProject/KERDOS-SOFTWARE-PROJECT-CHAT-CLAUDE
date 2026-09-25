# KERDOS — automatic import review build

This package contains the complete app source. No new database migration is required for this update.

1. Unzip the package. Upload its contents (files and folders, not the ZIP) into the root of the existing GitHub repository on `main`.
2. Wait for `Deploy KERDOS Preview` to turn green, then refresh the app.
3. On Price Sheets, select a file. The row review opens automatically; review and save the rows deliberately. On Invoices, select a file and confirm the date and flagged lines; the original invoice is retained when the invoice saves.

This build includes the Item Catalog pack dropdown, live unit-cost preview, Apply changes, Add to Order Guide, and prior-invoice clues when importing a price sheet. Existing database migrations, including the Item Catalog save RPC, must already be installed for those older features to work.

The browser import flow was checked with an earlier 96-item vendor sheet. The specific sheet reported as failing in production has not been provided, so its exact parsing behavior remains unverified. An interrupted import still cannot safely resume; keep the tab open until the import completes.
