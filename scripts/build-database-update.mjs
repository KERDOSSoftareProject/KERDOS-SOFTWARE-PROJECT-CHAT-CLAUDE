import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const migrations=[
  "migration_003_vocabulary.sql",
  "migration_004_context_and_price_lifecycle.sql",
  "migration_005_atomic_price_import.sql",
  "migration_006_atomic_invites.sql",
  "migration_007_atomic_invoices.sql",
  "migration_009_price_basis.sql",
  "migration_010_catalog_rows.sql",
  "migration_011_document_deletion.sql",
  "migration_012_vendor_nvim.sql",
];
const sections=migrations.map(file=>[
  "-- ============================================================",
  `-- ${file}`,
  "-- ============================================================",
  "",
  fs.readFileSync(path.join(root,"knowledge",file),"utf8").trim(),
].join("\n"));
const output=[
  "-- KERDOS DATABASE UPDATE",
  "-- Generated from knowledge/migration_003 through migration_012 (008 is unused and intentionally excluded).",
  "-- Do not hand-edit this combined file; update the individual migration and regenerate.",
  "",
  "begin;",
  "",
  sections.join("\n\n"),
  "",
  "commit;",
  "",
].join("\n");
fs.writeFileSync(path.join(root,"KERDOS_DATABASE_UPDATE_CLEAN.sql"),output);
