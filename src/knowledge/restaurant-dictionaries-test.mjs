import assert from "node:assert/strict";
import {configureProcurement,compareProductIdentity,commonPurchasingPack,productKnowledge,pricePerUnit,suggestCategory} from "../procurement.js";
import {industryDictionary} from "./category-profiles.js";
import {createCatalogService,mappingVerification} from "../services/catalog.js";

configureProcurement({industry:" Restaurant "});
const same=[
  ["YUKON GOLD","YUKON GOLD POTATOES"],
  ["YUKON GOLD A","YUKON GOLD POTATOES SIZE A"],
  ["CHIX BNLS SKNLS BRST","CHICKEN BONELESS SKINLESS BREAST"],
  ["CHICKEN B/S BREAST","CHICKEN BONELESS SKINLESS BREAST"],
  ["EVOO","EXTRA VIRGIN OLIVE OIL"],
  ["IQF BROCCOLI","INDIVIDUALLY QUICK FROZEN BROCCOLI"],
  ["I.Q.F. BROCCOLI","INDIVIDUALLY QUICK FROZEN BROCCOLI"],
  ["AP FLOUR","ALL PURPOSE FLOUR"],
  ["P&D SHRIMP","PEELED DEVEINED SHRIMP"],
  ["CNND ARTICHOKE HTS","CANNED ARTICHOKE HEARTS"],
  ["CHIX BASE","CHICKEN BASE"],
  ["TO GO CONTAINER","TAKEOUT CONTAINER"],
  ["BRD EGGPLANT","BREADED EGGPLANT"],
  ["AUBERGINE","EGGPLANT"],
  ["GARBANZO BEANS","CHICKPEAS"],
  ["RTE CHICKEN","READY TO EAT CHICKEN"],
  ["S/S PAN","STAINLESS STEEL PAN"],
];
for(const [a,b] of same)assert.equal(compareProductIdentity(a,b).status,"same",`${a} / ${b}`);
const distinct=[
  ["YUKON GOLD A","YUKON GOLD B"],
  ["CHICKEN BASE","CHICKEN BREAST"],
  ["CHICKEN BREAST","CHICKEN THIGH"],
  ["FROZEN CHICKEN","FRESH CHICKEN"],
  ["CANNED ARTICHOKE HEARTS","FRESH ARTICHOKE HEARTS"],
  ["TOMATO SAUCE","TOMATO PASTE"],
  ["ACTIVE DRY YEAST","INSTANT DRY YEAST"],
  ["BREADED EGGPLANT","FRESH EGGPLANT"],
  ["YUKON GOLD","RED POTATOES"],
  ["POT STAINLESS STEEL","POTATO STAINLESS STEEL"],
];
for(const [a,b] of distinct)assert.equal(compareProductIdentity(a,b).status,"different",`${a} / ${b}`);
const size=compareProductIdentity("YUKON GOLD A","YUKON GOLD POTATOES");
assert.equal(size.status,"review");
assert.equal(size.field,"potato_size");
assert.match(size.reason,/unstated/);
assert.equal(compareProductIdentity("GF PASTA","GLUTEN FREE PASTA").status,"review");
assert.equal(compareProductIdentity("FF POTATO","FRENCH FRIES POTATO").status,"review");
assert.equal(compareProductIdentity("B/S CONTAINER","BONELESS SKINLESS CONTAINER").status,"review");
assert.equal(compareProductIdentity("IQF BROCCOLI","FROZEN BROCCOLI").status,"review","freezing method is not guessed");
assert.equal(productKnowledge("YUKON GOLD SIZE A SIZE B").unresolved.length,1);
const slang=productKnowledge("86 ALL DAY ON THE FLY");
assert.ok(slang.evidence.length>=3);
assert.ok(slang.evidence.every(e=>!e.automatic),"kitchen calls never change availability or product identity");
assert.notEqual(compareProductIdentity("spuds","potato").status,"same","informal meaning is not sufficient product evidence");
assert.equal(commonPurchasingPack(["50 LB","50LB","1/50 LB"]),"50 LB");
assert.equal(commonPurchasingPack(["4/5 LB","1/20 LB"]),null,"equal total weight is not the same case configuration");
assert.equal(commonPurchasingPack(["50 LB",null]),null);
assert.equal(commonPurchasingPack(["50 LB","50 KG"]),null);
assert.equal(pricePerUnit(30,"50LB","LB").price,0.6);
const categories=[{id:"p",name:"Produce",keywords:["potato","eggplant","artichoke"]},{id:"g",name:"General",keywords:["base","canned","breaded"]}];
assert.equal(suggestCategory("YUKON GOLD",categories).category.id,"p");
assert.equal(suggestCategory("BRD EGGPLANT",categories).category.id,"g");
assert.equal(suggestCategory("CNND ARTICHOKE HTS",categories).category.id,"g");

// Product verification and the automatic importer use the same dictionary.
const peers=[{id:"a",vendor_id:"vendor-a",description:"YUKON GOLD",pack_size:"50 LB"},
  {id:"b",vendor_id:"vendor-b",description:"YUKON GOLD POTATOES",pack_size:"50LB"}];
const catalog=[{id:"c",name:"YUKON GOLD POTATOES",matching_behavior:"flexible",master_item_number:1000}];
const mappings=peers.map(p=>({vendor_item_id:p.id,catalog_item_id:"c"}));
const service=createCatalogService({records:{query(){throw new Error("Equivalent products should reuse the existing item, not write a new one");}}});
const result=await service.matchOrCreate({organizationId:"org",vendorId:"vendor-c",description:"YUKON GOLD",packSize:"50 LB",catalogItems:catalog,categories,vendorItems:peers,mappings});
assert.equal(result.catalogItemId,"c");
assert.equal(result.track,"exact");
assert.equal(mappingVerification({id:"c",description:"YUKON GOLD",pack_size:"50 LB"},catalog[0],peers).comparison_track,"exact");
assert.equal(mappingVerification({id:"c",description:"YUKON GOLD A",pack_size:"50 LB"},catalog[0],peers).comparison_track,"review");

// Existing organization additions remain active and reset when the org changes.
configureProcurement({industry:"Restaurant",vocabulary:[{kind:"synonym",term:"house spuds",canonical:"yukon gold potato"},
  {kind:"synonym",term:"GF",canonical:"gluten free"}]});
assert.equal(compareProductIdentity("HOUSE SPUDS","YUKON GOLD POTATOES").status,"same");
assert.equal(compareProductIdentity("GF PASTA","GLUTEN FREE PASTA").status,"same");
configureProcurement({industry:"Restaurant"});
assert.equal(compareProductIdentity("GF PASTA","GLUTEN FREE PASTA").status,"review","another restaurant does not inherit an org's resolution");
configureProcurement({industry:"Building Supply",vocabulary:[{kind:"synonym",term:"plywd",canonical:"plywood"}]});
assert.equal(compareProductIdentity("PLYWD PANEL","PLYWOOD PANEL").status,"same");
assert.notEqual(compareProductIdentity("CHIX BREAST","CHICKEN BREAST").status,"same");
assert.equal(productKnowledge("YUKON GOLD A").evidence.length,0);
assert.equal(Object.keys(industryDictionary("Building Supply").groups).length,0);
configureProcurement({industry:"Restaurant"});
assert.equal(compareProductIdentity("EVOO","EXTRA VIRGIN OLIVE OIL").status,"same");
assert.equal(Object.keys(industryDictionary("Restaurant").groups).length,6);
configureProcurement();
console.log(`Restaurant dictionaries: ${same.length} positive and ${distinct.length} negative product cases; context, slang, pack, shared matcher, and industry isolation checks passed.`);
