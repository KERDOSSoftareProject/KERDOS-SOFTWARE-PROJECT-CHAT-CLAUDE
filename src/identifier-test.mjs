import assert from "node:assert/strict";
import {normalizeGtin,normalizeManufacturerCode,packFromDescription,abbreviationPairs,isAbbreviationOf,configureVocabulary,compareProductIdentity,parsePackSize,comparePurchasingPack,bestInvoiceMatch,assertKnownPriceBasis} from "./procurement.js";
const packTail=packFromDescription;
import {parseDocument} from "./ingestion.js";
import {identifierMatch,mappingGap,createCatalogService,engineVerifiable} from "./services/catalog.js";
import {suggestCategory} from "./procurement.js";
import {createCategoryService} from "./services/categories.js";
import {configureCategoryProfile} from "./knowledge/category-profiles.js";

let passed=0;
const test=async(name,fn)=>{try{await fn();passed++;}catch(err){console.error(`FAIL ${name}`);throw err;}};
await test("an invoice cannot pick arbitrarily between equally plausible listings",()=>{
  assert.equal(bestInvoiceMatch("American cheese",[
    {id:"v1",description:"American cheese"},{id:"v2",description:"American cheese"}]),null);
  assert.equal(bestInvoiceMatch("American cheese",[{id:"v1",description:"American cheese"}])?.vendorItem.id,"v1");
});
await test("an explicit unknown selling unit cannot become a case quote",()=>{
  assert.throws(()=>assertKnownPriceBasis("mystery unit"),/Unknown selling unit/);
  assert.equal(assertKnownPriceBasis("LB")?.basis,"measure");
  assert.equal(assertKnownPriceBasis("CASE")?.basis,"case");
  assert.equal(assertKnownPriceBasis(null),null);
});

// --- identifiers ---
await test("valid UPC-A and EAN-13 normalize to a 14-digit GTIN",()=>{
  assert.equal(normalizeGtin("012345678905"),"00012345678905");
  assert.equal(normalizeGtin("0 12345 67890 5"),"00012345678905");
  assert.equal(normalizeGtin("4006381333931"),"04006381333931");
});
await test("a wrong check digit or a phone number is not a barcode",()=>{
  assert.equal(normalizeGtin("012345678906"),null);
  assert.equal(normalizeGtin("2035551234"),null);
  assert.equal(normalizeGtin(""),null);
});
await test("manufacturer codes are trimmed, uppercased and must carry a digit",()=>{
  assert.equal(normalizeManufacturerCode(" ty-1001 "),"TY-1001");
  assert.equal(normalizeManufacturerCode("N/A"),null);
  assert.equal(normalizeManufacturerCode("ab"),null);
});

// --- pack written at the end of a description ---
await test("reads a pack from the description tail",()=>{
  assert.equal(packFromDescription("CHICKEN BREAST BNLS 4/10 LB"),"4/10 LB");
  assert.equal(packFromDescription("OIL CANOLA 35#"),"35#");
  assert.equal(packFromDescription("CHEESE AMERICAN SLICED 160 CT"),"160 CT");
  assert.equal(packFromDescription("MAYONNAISE 4/1 GAL"),"4/1 GAL");
});
await test("does not invent a pack",()=>{
  assert.equal(packFromDescription("CHICKEN BREAST"),null);
  assert.equal(packFromDescription("PEPPERS 2 CHICKEN"),null);
  assert.equal(packFromDescription("4/10 LB CHICKEN"),null);
});

// --- parsed rows carry identifiers and description packs ---
const sheet=`Item#,UPC,Mfr #,Brand,Description,Pack Size,Type,Price
1234567,012345678905,TY-1001,TYSON,CHICKEN BREAST BNLS,4/10 LB,CS,85.60
2234567,,,,OIL CANOLA 35#,,CS,42.10
3234567,2035551234,,,MAYO HEAVY,4/1 GAL,CS,39.00`;
const parsed=parseDocument(sheet,"sheet.csv").rows;
await test("price sheet rows expose GTIN and manufacturer code",()=>{
  assert.equal(parsed[0].gtin,"00012345678905");assert.equal(parsed[0].manufacturerCode,"TY-1001");
  assert.equal(parsed[2].gtin,null);
});
await test("pack column wins; description pack fills only an empty column and says so",()=>{
  assert.equal(parsed[0].packSize,"4/10 LB");assert.equal(parsed[0].packSource,"column");
  assert.equal(parsed[1].packSize,"35#");assert.equal(parsed[1].packSource,"description");
  assert.equal(parsed[1].description,"OIL CANOLA 35#");
});

// --- identifier-proven matching ---
const linked=[{id:"v1",vendor_id:"A",description:"CHIX BRST BNLS SKNLS",pack_size:"4/10 LB",brand:"TYSON",gtin:"00012345678905",manufacturer_code:"TY-1001"}];
const candidates=[{id:"c1",name:"CHIX BRST BNLS SKNLS",linkedVendorItems:linked}];
await test("same GTIN from another vendor in the same pack is exact, whatever the wording",()=>{
  const m=identifierMatch({gtin:"00012345678905",packSize:"4 x 10 LB",vendorId:"B"},candidates);
  assert.equal(m.track,"exact");assert.equal(m.catalogItem.id,"c1");assert.match(m.reason,/barcode/);
});
await test("same GTIN with a different pack goes to review with the packs named",()=>{
  const m=identifierMatch({gtin:"00012345678905",packSize:"2/5 LB",vendorId:"B"},candidates);
  assert.equal(m.track,"similar");assert.match(m.reason,/2\/5 LB vs 4\/10 LB/);
});
await test("the same vendor's own listing is not a second witness",()=>assert.equal(identifierMatch({gtin:"00012345678905",packSize:"4/10 LB",vendorId:"A"},candidates),null));
await test("manufacturer code proves identity only with the same brand",()=>{
  assert.equal(identifierMatch({manufacturerCode:"TY-1001",brand:"TYSON",packSize:"4/10 LB",vendorId:"B"},candidates)?.track,"exact");
  assert.equal(identifierMatch({manufacturerCode:"TY-1001",brand:"PERDUE",packSize:"4/10 LB",vendorId:"B"},candidates),null);
  assert.equal(identifierMatch({manufacturerCode:"TY-1001",brand:null,packSize:"4/10 LB",vendorId:"B"},candidates),null);
});
await test("matchOrCreate links by identifier before any wording comparison",async()=>{
  const service=createCatalogService({records:{query:()=>{throw new Error("no write expected");}}});
  const result=await service.matchOrCreate({organizationId:"o",vendorId:"B",description:"BONELESS SKINLESS CHICKEN BREAST FRESH",packSize:"4/10 LB",gtin:"00012345678905",
    catalogItems:[{id:"c1",name:"CHIX BRST BNLS SKNLS"}],categories:[],vendorItems:linked,mappings:[{catalog_item_id:"c1",vendor_item_id:"v1"}]});
  assert.equal(result.track,"exact");assert.equal(result.catalogItemId,"c1");assert.equal(result.method,"identifier");
});

// --- why not 100%: one code per mapping ---
const ci={id:"c1",name:"CHICKEN BREAST"};
await test("gap codes",()=>{
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST",pack_size:null},ci,[]).code,"pack-missing");
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST",pack_size:"random wt"},ci,[]).code,"pack-unreadable");
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST",pack_size:"4/10 LB"},ci,[]).code,"single-vendor-ready");
  assert.equal(mappingGap({id:"v",description:"CHICKEN THIGH",pack_size:"4/10 LB"},ci,[]).code,"single-vendor-detail");
  const peer={id:"p",description:"CHICKEN BREAST",pack_size:"4/10 LB",brand:"TYSON"};
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST",pack_size:"4/10 LB",brand:"PERDUE"},ci,[peer]).code,"brand-conflict");
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST",pack_size:"2/5 LB",brand:"TYSON"},ci,[peer]).code,"pack-conflict");
  assert.equal(mappingGap({id:"v",description:"CHICKEN BREAST SUPER TRIMMED",pack_size:"4/10 LB",brand:"TYSON"},ci,[peer]).code,"wording");
});

// --- learning from confirmations: spelling only ---
await test("abbreviations pair with their expansions",()=>{
  assert.ok(isAbbreviationOf("brst","breast"));assert.ok(isAbbreviationOf("bnls","boneless"));assert.ok(isAbbreviationOf("mayo","mayonnaise"));
  assert.ok(!isAbbreviationOf("breast","thigh"));assert.ok(!isAbbreviationOf("sauce","paste"));assert.ok(!isAbbreviationOf("breast","breast"));
});
await test("a confirmation yields spelling pairs and never product pairs",()=>{
  assert.deepEqual(abbreviationPairs("CHIX BRST BNLS 4/10 LB",["CHICKEN BREAST BONELESS 4/10 LB"]).map(p=>`${p.term}>${p.canonical}`),["brst>breast","bnl>boneless"]);
  assert.deepEqual(abbreviationPairs("CHICKEN BREAST",["CHICKEN THIGH"]),[]);
  assert.deepEqual(abbreviationPairs("TOMATO SAUCE",["TOMATO PASTE"]),[]);
});
await test("learned pairs make the next comparison agree",()=>{
  assert.notEqual(compareProductIdentity("CHICKEN BRST BNLS","CHICKEN BREAST BONELESS").status,"same");
  configureVocabulary([{kind:"synonym",term:"brst",canonical:"breast"},{kind:"synonym",term:"bnl",canonical:"boneless"}]);
  assert.equal(compareProductIdentity("CHICKEN BRST BNLS","CHICKEN BREAST BONELESS").status,"same");
  configureVocabulary([]);
});
await test("learnAbbreviations saves only new synonym rows",async()=>{
  const inserted=[];
  const query=()=>({insert:rows=>{inserted.push(...rows);return Promise.resolve({data:null,error:null});}});
  const service=createCatalogService({records:{query}});
  const pairs=await service.learnAbbreviations({organizationId:"o",description:"CHIX BRST BNLS",references:["CHICKEN BREAST BONELESS"],vocabulary:[{kind:"synonym",term:"brst",canonical:"breast"}]});
  assert.deepEqual(pairs,[{term:"bnl",canonical:"boneless"}]);
  assert.deepEqual(inserted,[{organization_id:"o",kind:"synonym",term:"bnl",canonical:"boneless"}]);
});

// --- catch weight and can sizes in packs ---
await test("catch-weight markers parse and are kept apart from fixed weight",()=>{
  for(const raw of ["4/10 LBAV","4/10 LB AVG","2/10# AVG","30 LB AVG","10 LB RW"]){const p=parsePackSize(raw);assert.ok(p?.parsed&&p.catchWeight,raw);assert.equal(p.dimension,"mass",raw);}
  assert.equal(comparePurchasingPack("4/10 LB","4/10 LBAV").status,"review");
  assert.equal(comparePurchasingPack("4/10 LBAV","4/10 LB AVG").status,"same");
  assert.equal(comparePurchasingPack("4/10 LB","4 x 10 LB").status,"same");
});
await test("#10 cans are a count of cans, not ten pounds; # elsewhere is pounds",()=>{
  assert.equal(parsePackSize("6/#10 CN").caseStr,"6/1 #10 CAN");
  assert.equal(comparePurchasingPack("6/#10 CN","6/#10").status,"same");
  assert.equal(parsePackSize("50#BAG").caseStr,"50 LB");
  assert.equal(packTail("CHICKEN BREAST 4/10 LB AVG"),"4/10 LB AVG");
});

// --- engine-verifiable: two vendors, every check passes now ---
await test("a review mapping becomes engine-verifiable once wording is learned",()=>{
  const items=[{id:"c1",name:"CHICKEN BREAST BONELESS"}];
  const vis=[{id:"a",vendor_id:"A",description:"CHICKEN BREAST BONELESS",pack_size:"4/10 LB",brand:"TYSON"},{id:"b",vendor_id:"B",description:"CHICKEN BRST BNLS",pack_size:"4 x 10 LB",brand:"TYSON"}];
  const maps=[{id:"m1",catalog_item_id:"c1",vendor_item_id:"a",comparison_track:"exact",confidence_score:100},{id:"m2",catalog_item_id:"c1",vendor_item_id:"b",comparison_track:"similar",confidence_score:80}];
  assert.deepEqual(engineVerifiable({mappings:maps,vendorItems:vis,catalogItems:items}),[]);
  configureVocabulary([{kind:"synonym",term:"brst",canonical:"breast"},{kind:"synonym",term:"bnl",canonical:"boneless"}]);
  const ready=engineVerifiable({mappings:maps,vendorItems:vis,catalogItems:items});
  assert.deepEqual(ready.map(r=>r.mappingId),["m2"]);assert.equal(ready[0].verification.match_method,"rule_based");assert.equal(ready[0].verification.confidence_score,100);
  configureVocabulary([]);
});
await test("a single-vendor mapping is never engine-verifiable",()=>{
  const ready=engineVerifiable({mappings:[{id:"m",catalog_item_id:"c",vendor_item_id:"v",comparison_track:"review",confidence_score:90}],vendorItems:[{id:"v",vendor_id:"A",description:"X",pack_size:"1 CS"}],catalogItems:[{id:"c",name:"X"}]});
  assert.deepEqual(ready,[]);
});

// --- category placement: most likely category first, holding pen last ---
const cats=[{id:"meat",name:"Meat & Poultry",keywords:["chicken","beef","pork"]},{id:"dairy",name:"Dairy & Eggs",keywords:["milk","cheese","eggs"]},{id:"paper",name:"Paper Goods",keywords:["napkins","cups","lids"]},{id:"pen",name:"Uncategorized",is_holding_pen:true,keywords:[]}];
const examples=[{category_id:"dairy",name:"AMERICAN CHEESE SLICED"}];
await test("a clear vocabulary hit is confident",()=>assert.equal(suggestCategory("CHICKEN THIGH BNLS",cats,examples).confidence,"confident"));
await test("a resemblance to existing items is a guess, flagged for review",()=>{
  const s=suggestCategory("PROVOLONE SLICED 6/5 LB",cats,examples);
  assert.equal(s.category.id,"dairy");assert.equal(s.confidence,"guess");assert.match(s.reason,/existing items/);
});
await test("a tie between categories is still placed, as a guess naming both",()=>{
  const s=suggestCategory("CHICKEN CHEESE QUESADILLA",cats,[]);
  assert.equal(s.confidence,"guess");assert.match(s.reason,/Meat & Poultry and Dairy & Eggs/);
});
await test("nothing resembling anything goes to the holding pen",()=>assert.equal(suggestCategory("WIDGET XYZ",cats,examples),null));
await test("prepared vegetables are reviewed outside Produce while fresh vegetables remain Produce",()=>{
  configureCategoryProfile("Restaurant");
  const restaurant=[{id:"produce",name:"Produce",keywords:["potato","eggplant","artichoke"]},{id:"general",name:"General",keywords:["fries","frozen","canned"]}];
  assert.equal(suggestCategory("BREADED EGGPLANT",restaurant,[]).category.id,"general");
  assert.equal(suggestCategory("SWEET POTATO FRIES",restaurant,[]).category.id,"general");
  assert.equal(suggestCategory("FRESH EGGPLANT",restaurant,[]).category.id,"produce");
  assert.equal(suggestCategory("CANNED ARTICHOKE HEARTS",restaurant,[]).category.id,"general");
  assert.equal(suggestCategory("FRESH ARTICHOKE HEARTS",restaurant,[]).category.id,"produce");
  assert.equal(suggestCategory("BREADED EGGPLANT",restaurant,[]).confidence,"guess");
  const better=[...restaurant,{id:"prepared",name:"Prepared Foods",keywords:["breaded","fries"]}];
  assert.equal(suggestCategory("SWEET POTATO FRIES",better,[]).category.id,"prepared");
  configureCategoryProfile(null);
  assert.equal(suggestCategory("BREADED EGGPLANT",restaurant,[]).category.id,"produce","other industries do not inherit restaurant rules");
});
await test("matchOrCreate files a new product under its best guess with the review flag",async()=>{
  const inserted=[];
  const query=name=>({insert:row=>({select:()=>({single:()=>{inserted.push({table:name,row});return Promise.resolve({data:{id:"new",...row},error:null});}})})});
  const service=createCatalogService({records:{query}});
  const result=await service.matchOrCreate({organizationId:"o",vendorId:"A",description:"PROVOLONE SLICED 6/5 LB",packSize:"6/5 LB",catalogItems:[{id:"x",name:"AMERICAN CHEESE SLICED",category_id:"dairy"}],categories:cats,vendorItems:[],mappings:[]});
  assert.equal(result.track,"new");
  const item=inserted.find(i=>i.table==="catalog_items").row;
  assert.equal(item.category_id,"dairy");assert.equal(item.category_review,true);assert.match(item.category_reason,/guess/i);
});
await test("moving an item clears the review flag; confirming keeps it in place",async()=>{
  const updates=[];
  const query=()=>({update:v=>({eq:(col,id)=>{updates.push({id,...v});return Promise.resolve({data:null,error:null});}})});
  await createCategoryService({records:{query}}).assignItem({catalogItemId:"i1",categoryId:"meat",catalogItems:[],categories:cats});
  await createCatalogService({records:{query}}).confirmCategory("i2");
  assert.equal(updates[0].category_review,false);assert.equal(updates[0].category_id,"meat");
  assert.deepEqual(updates[1],{id:"i2",category_review:false,category_reason:null});
});
console.log(`${passed} passed, 0 failed`);
