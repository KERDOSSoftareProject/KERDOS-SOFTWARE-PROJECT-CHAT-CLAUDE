import {casePriceFromQuote,parsePackSize,pricePerUnit,priceBasisFor,compareProductIdentity,comparePurchasingPack} from "../procurement.js";

export const CATALOG_COLUMNS=[
  ["itemNumber","KERDOS item #"],["vendor","Vendor"],["category","Category"],
  ["product","Product"],["brand","Brand"],["pack","Pack"],
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
export function catalogRowEvidence({item,vendorItem,mapping,vendor,category}){
  const vi=vendorItem,pack=parsePackSize(vi.pack_size),basis=priceBasisFor(vi.selling_unit);
  const amount=vi.price==null||vi.price===""?null:Number(vi.price);
  const hasPrice=Number.isFinite(amount)&&amount>0;
  const quoteReview=!!vi.import_row?.reviewRequired&&!!vi.price_unavailable;
  const casePrice=hasPrice&&basis?casePriceFromQuote(amount,basis.basis,basis.unit||vi.selling_unit,vi.pack_size):null;
  const per=casePrice!=null&&pack?.parsed?pricePerUnit(casePrice,vi.pack_size):null;
  const manual=vi.field_resolutions||{};
  const resolved=(key)=>Object.hasOwn(manual,key);
  return {
    itemNumber:field(item.master_item_number,mapping?.comparison_track==="exact"?100:75,mapping?.comparison_track==="exact"?"Vendor association confirmed":"Number assigned; association needs confirmation"),
    vendor:field(vendor?.name||"",vendor?100:0,"Vendor selected at import"),
    category:field(category?.name||"Uncategorized",!category||category.is_holding_pen?0:item.category_review?75:100,item.category_reason||"Saved category"),
    product:field(vi.description,vi.description?100:0,resolved("description")?"Your saved description":"Description read from source; association checked separately"),
    brand:field(vi.brand||"",vi.brand?100:resolved("brand")?100:null,resolved("brand")?"Your saved brand choice":"Brand as printed; blank when absent"),
    pack:field(vi.pack_size||"",pack?.parsed?100:vi.pack_size?75:0,pack?.parsed?`${pack.caseQty} inner item(s); ${pack.total} ${pack.unit}${pack.catchWeight?" (estimated weight)":""}`:"Pack needs clarification"),
    price:field(hasPrice?amount:null,hasPrice?quoteReview?75:100:0,"Quoted number; quoted unit is evaluated separately"),
    sellingUnit:field(vi.selling_unit||"",basis?100:vi.selling_unit?0:null,basis?resolved("selling_unit")?"Your saved quoted unit":"Saved quoted unit":"Choose what the quoted price is per"),
    unitCost:{...field(per?.price??null,per?quoteReview?75:100:0,per?`Calculated per ${per.unit}${pack.catchWeight?"; case weight is an estimate":""}`:"Needs a readable pack and a compatible quoted unit"),unit:per?.unit||null},
  };
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
