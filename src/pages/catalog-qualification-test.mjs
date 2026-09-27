import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {fileURLToPath,pathToFileURL} from "node:url";
import {join} from "node:path";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "vite";
const temporary=mkdtempSync(fileURLToPath(new URL("../../node_modules/.kerdos-qualification-",import.meta.url)));
try{
  await build({configFile:false,logLevel:"error",esbuild:{jsx:"automatic"},build:{ssr:fileURLToPath(new URL("./CatalogRows.jsx",import.meta.url)),outDir:temporary,rollupOptions:{output:{entryFileNames:"rows.mjs"}}}});
  const {CatalogRows}=await import(pathToFileURL(join(temporary,"rows.mjs")));
  const item={id:"ci",name:"Beef",category_id:"meat",master_item_number:20001};
  const row={id:"vi",vendor_id:"v",description:"Beef",pack_size:"10 LB",price:35,selling_unit:"CASE",price_basis:"case"};
  const props={orgId:"org",items:[{catalogItemId:"ci"}],catalogItems:[item],vendorItems:[row],mappings:[{id:"m",vendor_item_id:"vi",catalog_item_id:"ci",comparison_track:"review",confidence_score:70}],vendors:[{id:"v",name:"Supplier"}],categories:[{id:"meat",name:"Meat",keywords:["beef"]}],vocabulary:[],canManage:true};
  const html=renderToStaticMarkup(createElement(CatalogRows,props));
  assert.match(html,/1 of 1 vendor rows meet Order Guide requirements/);
  assert.match(html,/90%/);assert.ok(!/>100%</.test(html),"stated fields are not displayed as independently proven");
  const missing=renderToStaticMarkup(createElement(CatalogRows,{...props,vendorItems:[{...row,selling_unit:null,price_basis:null}]}));
  assert.match(missing,/0 of 1 vendor rows meet Order Guide requirements/);
  assert.match(missing,/Quoted unit missing or unresolved: 1/);
  assert.match(missing,/Apply changes/);
  assert.match(missing,/Details/);
  console.log("Catalog qualification rendering passed: consistent percentages, row counts and specific blockers.");
}finally{rmSync(temporary,{recursive:true,force:true});}
