import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const requiredMigrations=[
  "migration_003_vocabulary.sql","migration_004_context_and_price_lifecycle.sql",
  "migration_005_atomic_price_import.sql","migration_006_atomic_invites.sql",
  "migration_007_atomic_invoices.sql",
];
for(const file of requiredMigrations) assert.ok(fs.statSync(path.join(root,"knowledge",file)).size>100,`${file} missing or empty`);

const adapter=fs.readFileSync(path.join(root,"src/backend/supabase.js"),"utf8");
const migrationSql=requiredMigrations.map(file=>fs.readFileSync(path.join(root,"knowledge",file),"utf8")).join("\n");
for(const rpc of [...adapter.matchAll(/client\.rpc\("([^"]+)"/g)].map(match=>match[1]))
  assert.match(migrationSql,new RegExp(`function\\s+${rpc}\\b`,`i`),`adapter RPC ${rpc} has no migration`);

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
