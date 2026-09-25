# KERDOS catalog workflow build

See `WORKFLOW_2026_09_25.md` for the agreed behavior, changes, retained features, verification, and deployment boundary.

The current build includes both the saved Item Catalog row editor and its database save operation, not only an import preview. It separates new-item discovery from item-number-based updates and adds oversight against the last accepted source. All defining product fields must agree before vendor listings compete under one KERDOS identity.

The full source and generated SQL belong to one release. No live database changes, data clearing, repository upload or deployment were performed from this workspace.
