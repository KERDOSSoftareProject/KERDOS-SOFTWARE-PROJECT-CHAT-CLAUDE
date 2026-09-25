import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const requiredMigrations=[
  "migration_003_vocabulary.sql","migration_004_context_and_price_lifecycle.sql",
  "migration_005_atomic_price_import.sql","migration_006_atomic_invites.sql",
  "migration_007_atomic_invoices.sql","migration_009_price_basis.sql",
  "migration_010_catalog_rows.sql",
];
for(const file of requiredMigrations) assert.ok(fs.statSync(path.join(root,"knowledge",file)).size>100,`${file} missing or empty`);

const adapter=fs.readFileSync(path.join(root,"src/backend/supabase.js"),"utf8");
const app=fs.readFileSync(path.join(root,"src/App.jsx"),"utf8");
const pageSources=fs.readdirSync(path.join(root,"src/pages")).filter(file=>file.endsWith(".jsx"))
  .map(file=>fs.readFileSync(path.join(root,"src/pages",file),"utf8")).join("\n");
const migrationSql=requiredMigrations.map(file=>fs.readFileSync(path.join(root,"knowledge",file),"utf8")).join("\n");
for(const rpc of [...adapter.matchAll(/client\.rpc\("([^"]+)"/g)].map(match=>match[1]))
  assert.match(migrationSql,new RegExp(`function\\s+(?:public\\.)?${rpc}\\b`,`i`),`adapter RPC ${rpc} has no migration`);

// Every adapter parameter of the quote RPC must exist in the migrated function signature.
for(const param of [...adapter.matchAll(/\bp_[a-z_]+(?=:)/g)].map(m=>m[0]))
  assert.match(migrationSql,new RegExp(`\\b${param}\\b`),`adapter passes ${param} but no migration declares it`);

assert.match(migrationSql,/security\s+definer[\s\S]*set\s+search_path\s*=\s*pg_catalog[\s\S]*update\s+public\.invite_codes/i,
  "invite acceptance must bypass member-only RLS with a restricted search path");
for(const guard of [
  "KERDOS base schema is missing required columns",
  "Owner or manager access is required for this organization",
  "Vendor is outside the requested organization",
  "Invoice vendor item is outside the requested organization/vendor",
  "Catalog item is outside the requested organization",
]) assert.ok(migrationSql.includes(guard),`database safety guard missing: ${guard}`);

const combined=fs.readFileSync(path.join(root,"KERDOS_DATABASE_UPDATE_CLEAN.sql"),"utf8");
assert.match(combined,/^begin;$/m,"combined database update lacks transaction start");
assert.match(combined,/^commit;$/m,"combined database update lacks transaction commit");
for(const file of requiredMigrations)
  assert.ok(combined.includes(fs.readFileSync(path.join(root,"knowledge",file),"utf8").trim()),`${file} differs from combined database update`);

for(const requiredUi of [
  "Price Sheet History","Import Price Sheet","Invoice History","Import Invoice",
  "Click to open","Remove current prices from Order Guide","Remove price from Order Guide",
  "price_refresh_mode===\"automatic\"?\"automatic\":\"manual\"",
]) assert.ok((app+pageSources).includes(requiredUi),`requested import/history behavior missing: ${requiredUi}`);
assert.match(app,/from "\.\/pages\/DocumentPages\.jsx"/,"document workflows were not extracted from App.jsx");
assert.ok(!app.includes("{/* INVOICES TAB */}"),"legacy inline invoice page remains in App.jsx");
assert.ok(app.split("\n").length<2500,"App.jsx grew past the modularity guardrail");

const ocrFiles=["worker.min.js","eng.traineddata.gz"];
for(const file of ocrFiles) assert.ok(fs.statSync(path.join(root,"public/ocr",file)).size>1000,`OCR asset ${file} missing`);
const coreFiles=new Set(fs.readdirSync(path.join(root,"public/ocr/core")));
for(const file of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) assert.ok(coreFiles.has(file),`OCR core ${file} missing`);

const envExample=fs.readFileSync(path.join(root,".env.example"),"utf8");
for(const key of ["VITE_KERDOS_BACKEND","VITE_SUPABASE_URL","VITE_SUPABASE_ANON_KEY","VITE_BASE_PATH"])
  assert.match(envExample,new RegExp(`^${key}=`,`m`),`.env.example lacks ${key}`);
assert.ok(fs.existsSync(path.join(root,"vite.config.js")),"Vite deployment configuration missing");
assert.ok(fs.existsSync(path.join(root,".github/workflows/deploy-pages.yml")),"GitHub Pages adapter missing");

console.log("KERDOS deployment assets and migration wiring passed");
