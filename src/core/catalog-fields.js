import {casePriceFromQuote,parsePackSize,pricePerUnit,priceBasisFor,compareProductIdentity,comparePurchasingPack,suggestCategory} from "../procurement.js";
import {mappingVerification} from "../services/catalog.js";

export const CATALOG_COLUMNS=[
  ["itemNumber","KERDOS item #"],["vendor","Vendor"],["category","Category"],
  ["itemName","Item name"],["product","Vendor description"],["brand","Brand"],["pack","Pack"],
  ["price","Quoted price"],["sellingUnit","Quoted per"],["unitCost","Unit cost"],
];
const BASE_UNITS=[["CASE","Case / full pack"],["EACH","Each / inner item"],["LB","Pounds (LB)"],["OZ","Ounces, weight (OZ)"],
  ["GAL","Gallons (US)"],["QT","Quarts (US)"],["PT","Pints (US)"],["FLOZ","Fluid ounces (US)"],
  ["KG","Kilograms"],["G","Grams"],["L","Liters"],["ML","Milliliters"],["DOZ","Dozen"],
  ["FT","Feet"],["IN","Inches"],["YD","Yards"],["M","Meters"],["CM","Centimeters"],["MM","Millimeters"]];
export function unitChoices(vocabulary=[],pack=false){
  const choices=pack?[["EA","Each / count"],...BASE_UNITS.filter(([code])=>!["CASE","EACH"].includes(code))]:BASE_UNITS;
  const seen=new Set();
  return [...choices,...vocabulary.filter(v=>v.kind==="unit"||(!pack&&v.kind==="packaging")).map(v=>[v.term,v.term])]
    .filter(([value])=>value&&!seen.has(value)&&(seen.add(value),true)&&!!priceBasisFor(value))
    .map(([value,label])=>({value,label}));
}
const field=(value,accuracy,reason)=>({value,accuracy,reason});

// ---- Accuracy ----------------------------------------------------------
// The percentage on a cell is how likely its value is to be RIGHT, whoever
// put it there. Missing cells have no percentage. A source statement or
// manual entry alone is 90, and an independent matching vendor can raise
// an identity field to 100. Contradictions lower confidence regardless
// of who entered the value. These are rule-based estimates, not measured
// error rates.
const STATED=90,DERIVED=90,GUESSED=70,DOUBTFUL=60;
const empty=(value)=>value==null||value==="";

export function catalogRowEvidence({item,vendorItem,mapping,vendor,category,peers=[],categories=[]}){
  const vi=vendorItem,pack=parsePackSize(vi.pack_size),basis=priceBasisFor(vi.selling_unit);
  const amount=vi.price==null||vi.price===""?null:Number(vi.price);
  const hasPrice=Number.isFinite(amount)&&amount>0;
  const row=vi.import_row?.row||{};
  const changes=vi.import_row?.reviewRequired?(vi.import_row?.changes||[]).map(c=>c.field):[];
  const casePrice=hasPrice&&basis?casePriceFromQuote(amount,basis.basis,basis.unit||vi.selling_unit,vi.pack_size):null;
  const per=casePrice!=null&&pack?.parsed?pricePerUnit(casePrice,vi.pack_size):null;
  const manual=vi.field_resolutions||{};
  const byClient=(key)=>Object.hasOwn(manual,key);
  const otherVendors=peers.filter(p=>p.vendor_id&&p.vendor_id!==vi.vendor_id);
  const source=(key,rawKey)=>manual[key]?.sourceValue??row[rawKey];
  // A second vendor on the same catalog item is not automatically an
  // independent witness. Require a matching trade identifier first.
  const provenPeers=otherVendors.filter(p=>
    (vi.gtin&&p.gtin&&vi.gtin===p.gtin)||
    (vi.manufacturer_code&&p.manufacturer_code&&vi.manufacturer_code===p.manufacturer_code&&vi.brand&&p.brand&&vi.brand.toLowerCase()===p.brand.toLowerCase()));

  // Pack: where it came from, then whether it agrees with the quoted unit
  // and with the other vendors on this item.
  let packAcc=null,packWhy="";
  if(!empty(vi.pack_size)){
    if(!pack?.parsed){packAcc=DOUBTFUL;packWhy="Not a complete pack KERDOS can read";}
    else{
      packAcc=byClient("pack_size")?STATED:row.packSource==="description"?DERIVED:row.packSource==="column"||!row.packSource?STATED:DERIVED;
      packWhy=byClient("pack_size")?"Set by you":row.packSource==="description"?"Read from the end of the description":row.packSource==="invoice"?"Filled from the vendor's invoice":"Read from the sheet";
      if(basis?.basis==="measure"&&pack.dimension!=="unknown"&&casePrice==null){packAcc=Math.min(packAcc,DOUBTFUL);packWhy+="; doesn't fit a price quoted per "+(basis.unit||vi.selling_unit);}
      const disagree=otherVendors.find(p=>p.pack_size&&parsePackSize(p.pack_size)?.parsed&&comparePurchasingPack(vi.pack_size,p.pack_size).status!=="same");
      if(disagree){packAcc=Math.min(packAcc,GUESSED);packWhy+=`; another vendor lists ${disagree.pack_size}`;}
      else if(provenPeers.length&&provenPeers.every(p=>comparePurchasingPack(vi.pack_size,p.pack_size).status==="same")){
        packAcc=100;packWhy+="; corroborated by another vendor";
      }
      const sourcePack=source("pack_size","packSize");
      if(byClient("pack_size")&&sourcePack&&comparePurchasingPack(vi.pack_size,sourcePack).status!=="same"){
        packAcc=Math.min(packAcc,GUESSED);packWhy+="; differs from the original source";
      }
      if(changes.includes("packSize")){packAcc=Math.min(packAcc,GUESSED);packWhy+="; changed on the newest sheet";}
    }
  }

  // Quoted unit: stated on the sheet, chosen for the whole sheet, or set here.
  let unitAcc=null,unitWhy="";
  if(!empty(vi.selling_unit)){
    if(!basis){unitAcc=DOUBTFUL;unitWhy="Not a unit KERDOS recognises";}
    else{
      unitAcc=byClient("selling_unit")?STATED:row.sellingUnitSource==="sheet"?DERIVED:STATED;
      unitWhy=byClient("selling_unit")?"Set by you":row.sellingUnitSource==="sheet"?"Applied to the whole sheet at import":"Stated on the sheet";
      if(basis.basis==="measure"&&pack?.parsed&&casePrice==null){unitAcc=Math.min(unitAcc,DOUBTFUL);unitWhy+="; the pack isn't measured in "+(basis.unit||vi.selling_unit);}
      const sourceUnit=source("selling_unit","sellingUnit");
      if(byClient("selling_unit")&&sourceUnit&&JSON.stringify(priceBasisFor(sourceUnit))!==JSON.stringify(basis)){
        unitAcc=Math.min(unitAcc,GUESSED);unitWhy+="; differs from the original source";
      }
    }
  }

  // Price: the number as quoted, checked against the vendor's own last quote.
  let priceAcc=null,priceWhy="";
  if(hasPrice){
    priceAcc=byClient("price")?STATED:STATED;priceWhy=byClient("price")?"Set by you":"As quoted on the sheet";
    if(changes.includes("price")){priceAcc=GUESSED;priceWhy+="; differs from this vendor's last quote";}
    if(byClient("price")&&row.price!=null&&Number(row.price)!==amount){
      priceAcc=Math.min(priceAcc,GUESSED);priceWhy+="; differs from the original quoted amount";
    }
    if(per&&(per.price<0.01||per.price>10000)){priceAcc=Math.min(priceAcc,DOUBTFUL);priceWhy+=`; works out to ${per.price} per ${per.unit}, which looks wrong`;}
  }

  // Category: confident placement, best guess, or set by the client.
  let catAcc=null,catWhy="";
  if(category&&!category.is_holding_pen){
    catAcc=item.category_review?GUESSED:item.category_reason?DERIVED:STATED;
    catWhy=item.category_review?(item.category_reason||"Best guess"):item.category_reason?item.category_reason:"Set or accepted";
    const independent=categories.length?suggestCategory(vi.description,categories,[]):null;
    if(independent?.confidence==="confident"&&independent.category?.id!==category.id){
      catAcc=Math.min(catAcc,GUESSED);
      catWhy+=`; description points to ${independent.category.name}; check the source and category`;
    }
  }

  // Brand: printed in a labeled column, pulled from an unlabeled cell, or typed.
  let brandAcc=null,brandWhy="";
  if(!empty(vi.brand)){
    brandAcc=byClient("brand")?STATED:row.brandSource==="details"?GUESSED:STATED;
    brandWhy=byClient("brand")?"Set by you":row.brandSource==="details"?"Taken from an unlabeled cell; it matched a brand you already carry":"Printed on the sheet";
    const clash=otherVendors.find(p=>p.brand&&p.brand.trim().toLowerCase()!==vi.brand.trim().toLowerCase());
    if(clash){brandAcc=Math.min(brandAcc,GUESSED);brandWhy+=`; another vendor lists ${clash.brand}`;}
    else if(provenPeers.length&&provenPeers.every(p=>p.brand&&p.brand.trim().toLowerCase()===vi.brand.trim().toLowerCase())){
      brandAcc=100;brandWhy+="; corroborated by another vendor";
    }
    const sourceBrand=source("brand","brand");
    if(byClient("brand")&&sourceBrand&&sourceBrand.trim().toLowerCase()!==vi.brand.trim().toLowerCase()){
      brandAcc=Math.min(brandAcc,GUESSED);brandWhy+="; differs from the original source";
    }
  }

  // Description: the vendor's own words are the vendor's own words.
  const descriptionCorroborated=provenPeers.length>0&&provenPeers.every(p=>p.description&&compareProductIdentity(vi.description,p.description).status==="same");
  const originalDescription=source("description","description");
  const descriptionConflict=byClient("description")&&originalDescription&&compareProductIdentity(vi.description,originalDescription).status!=="same";
  const descAcc=empty(vi.description)?null:descriptionConflict?GUESSED:descriptionCorroborated?100:STATED;
  const descWhy=descriptionConflict?"Edited description differs from original source; verify the product":descriptionCorroborated?"Product identity corroborated by a matching trade identifier":byClient("description")?"Cleaned up by you; verify against source":"As the vendor wrote it";

  // Item name: yours once you've typed it; until then it is only the vendor's wording.
  const named=!empty(item.name)&&item.name!==vi.description;
  const nameAcc=empty(item.name)?null:named?STATED:GUESSED;
  const nameWhy=named?"Your name for this product":"Still the vendor's wording; rename it when you like";

  // Association: proven by identifier or a second vendor, exact, or under review.
  const exact=mapping?.comparison_track==="exact"&&mapping?.confidence_score===100;
  const numAcc=item.master_item_number==null?null:exact?descriptionCorroborated&&packAcc===100?100:STATED:mapping?.confidence_score!=null?Math.max(DOUBTFUL,Math.min(GUESSED,mapping.confidence_score)):GUESSED;
  const numWhy=exact?"Association verified":"Association still being checked";

  // Unit cost only exists when pack, unit and price all hold up; it is as
  // sure as the least sure of the three.
  const costAcc=per?Math.min(packAcc??0,unitAcc??0,priceAcc??0):null;

  return {
    itemNumber:field(item.master_item_number,numAcc,numWhy),
    vendor:field(vendor?.name||"",vendor?STATED:null,"Vendor selected at import"),
    category:field(category?.name||"Uncategorized",catAcc,catWhy||"No category yet"),
    itemName:field(item.name||"",nameAcc,nameWhy),
    product:field(vi.description,descAcc,descWhy),
    brand:field(vi.brand||"",brandAcc,brandWhy||"Blank when absent"),
    pack:field(vi.pack_size||"",packAcc,packWhy||"No pack yet"),
    price:field(hasPrice?amount:null,priceAcc,priceWhy||"No price"),
    sellingUnit:field(vi.selling_unit||"",unitAcc,unitWhy||"Choose what the quoted price is per"),
    unitCost:{...field(per?.price??null,costAcc,per?`Calculated per ${per.unit}${pack?.catchWeight?"; case weight is an estimate":""}`:"Needs a readable pack and a compatible quoted unit"),unit:per?.unit||null},
  };
}

// Order Guide worthy: every field of the row is solved. Category placed
// (holding pen doesn't count; a best-guess placement does — the client can
// still move it), description present, readable pack, a quoted unit that
// converts to a full-pack price, a current price, and the association
// itself either exact already or pointing at an item whose name agrees
// with the vendor wording. Rows like that are placed without a click.
export function orderGuideReady({item,vendorItem,mapping,vendor,category,peers=[],categories=[]}){
  if(!item||!vendorItem||!mapping||!category||category.is_holding_pen)return false;
  if(vendorItem.price_unavailable||vendorItem.price_source==="invoice")return false;
  if(vendorItem.import_row?.reviewRequired)return false;
  const evidence=catalogRowEvidence({item,vendorItem,mapping,vendor,category,peers,categories});
  if(evidence.unitCost.value==null)return false;
  // Every required cell must be at least "worked out from strong evidence".
  for(const key of ["category","product","pack","sellingUnit","price"])if((evidence[key].accuracy??0)<DERIVED)return false;
  return true;
}

// Rows the app can place in the Order Guide on its own: ready by the rule
// above and not yet an exact association. Multi-vendor items also need
// the other vendor's row to agree on identity, brand and pack; single-
// vendor items only need the row to agree with its own catalog item.
export function autoPlaceable({catalogItems=[],vendorItems=[],mappings=[],vendors=[],categories=[]}){
  const ciById=new Map(catalogItems.map(ci=>[ci.id,ci]));
  const viById=new Map(vendorItems.map(vi=>[vi.id,vi]));
  const vById=new Map(vendors.map(v=>[v.id,v]));
  const cById=new Map(categories.map(c=>[c.id,c]));
  const byCatalog=new Map();
  for(const m of mappings){const list=byCatalog.get(m.catalog_item_id)||[];list.push(m);byCatalog.set(m.catalog_item_id,list);}
  const out=[];
  for(const m of mappings){
    if(m.comparison_track==="exact"&&m.confidence_score===100)continue;
    const vi=viById.get(m.vendor_item_id),ci=ciById.get(m.catalog_item_id);
    if(!vi||!ci)continue;
    const category=cById.get(ci.category_id);
    const peers=(byCatalog.get(m.catalog_item_id)||[]).filter(o=>o.id!==m.id).map(o=>viById.get(o.vendor_item_id)).filter(Boolean);
    if(!orderGuideReady({item:ci,vendorItem:vi,mapping:m,vendor:vById.get(vi.vendor_id),category,peers,categories}))continue;
    const verification=mappingVerification(vi,ci,peers);
    if(verification.comparison_track!=="exact")continue;
    out.push({mappingId:m.id,vendorItemId:vi.id,catalogItemId:ci.id,description:vi.description,packSize:vi.pack_size,
      verification:{...verification,match_method:peers.length?"rule_based":"manual"},clearCategoryReview:!!ci.category_review});
  }
  return out;
}

// A correction belongs to this vendor's item code. Remember the original
// field too: repeat vendor shorthand must not erase a client's clean wording.
const FIELDS={description:"description",brand:"brand",packSize:"pack_size"};
export function rememberImportRow(row,prior,mapping=null){
  if(!prior||(row.code?String(row.code)!==String(prior.vendor_item_code):!!prior.vendor_item_code))return row;
  if(mapping?.vendor_item_id===prior.id&&mapping.comparison_track==="exact"&&mapping.confidence_score===100){
    // The import resolved this vendor listing first. The saved association
    // and field corrections survive changes in document row order.
    const changes=knownItemChanges(row,prior);
    const conflicts=changes.map(change=>change.reason);
    return {...row,description:prior.description,brand:prior.brand||"",packSize:prior.pack_size,
      sellingUnit:prior.selling_unit||row.sellingUnit||"",sellingUnitSource:prior.selling_unit?"remembered":row.sellingUnitSource,
      knownVendorItem:true,priceNeedsReview:conflicts.length>0,conflicts,changes};
  }
  const result={...row};
  const raw=prior.import_row?.row||{};
  for(const [input,saved] of Object.entries(FIELDS)){
    const remembered=prior.field_resolutions?.[saved];
    if(!remembered||row.manualFields?.includes(input))continue;
    const incoming=String(row[input]||"").trim();
    const original=String(remembered.sourceValue??raw[input]??"").trim();
    const corrected=String(remembered.value??"").trim();
    const same=incoming===original||incoming===corrected||!incoming||
      (input==="description"&&[original,corrected].filter(Boolean).some(d=>compareProductIdentity(incoming,d).status==="same"))||
      (input==="packSize"&&[original,corrected].filter(Boolean).some(p=>comparePurchasingPack(incoming,p).status==="same"));
    if(!same)throw new Error(`Vendor item ${row.code||`NVIM-${prior.nvim_number}`}: ${input} changed from the known source. The saved correction and association were kept; review this field.`);
    result[input]=remembered.value??"";
  }
  return result;
}
export function importResolutions(row,prior={},date=new Date().toISOString()){
  const fields={...prior.field_resolutions};
  for(const input of row.manualFields||[]){
    const key=FIELDS[input]||(input==="sellingUnit"?"selling_unit":null);
    if(key)fields[key]={value:row[input]??"",sourceValue:row.originalFields?.[input]??prior.import_row?.row?.[input]??row[input]??"",confirmedAt:date};
  }
  return fields;
}

// Oversight is a comparison to accepted source fields after the item-number
// lookup. It never searches the catalog or changes the existing association.
const normalize=text=>String(text??"").trim().toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
export function knownItemChanges(row,prior){
  const baseline=prior.import_row?.baseline||prior.import_row?.row||{};
  const saved={description:prior.description,brand:prior.brand,packSize:prior.pack_size,sellingUnit:prior.selling_unit,gtin:prior.gtin,manufacturerCode:prior.manufacturer_code};
  const labels={description:"Product wording",brand:"Brand",packSize:"Pack",sellingUnit:"Quoted unit",gtin:"Barcode",manufacturerCode:"Manufacturer code"};
  const changes=[];
  for(const [field,label] of Object.entries(labels)){
    const after=row[field];
    if(after==null||String(after).trim()==="")continue; // a code-and-price sheet can omit known fields
    const before=baseline[field]||saved[field]||"";
    if(normalize(after)===normalize(before)||normalize(after)===normalize(saved[field]))continue;
    if(field==="packSize"&&[before,saved[field]].filter(Boolean).some(value=>comparePurchasingPack(after,value).status==="same"))continue;
    if(field==="sellingUnit"){
      const incoming=priceBasisFor(after),old=priceBasisFor(before);
      if(!before||incoming&&old&&incoming.basis===old.basis&&incoming.unit===old.unit)continue;
    }
    changes.push({field,before,after,reason:`${label} changed from “${before||"not stated"}” to “${after}”.`});
  }
  return changes;
}
