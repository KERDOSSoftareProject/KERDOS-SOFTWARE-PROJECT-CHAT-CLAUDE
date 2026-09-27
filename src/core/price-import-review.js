import {brandsMatch,casePriceFromQuote,compareProductIdentity,comparePurchasingPack,parsePackSize} from "../procurement.js";
import {knownItemChanges} from "./catalog-fields.js";
import {prepareImportRow} from "./import-row.js";
import {resolveQuoteBasis} from "./quote-basis.js";

const sameText=(a,b)=>String(a||"").trim().toLowerCase().replace(/\s+/g," ")===String(b||"").trim().toLowerCase().replace(/\s+/g," ");

// Called only after organization/vendor-scoped identity lookup. A changed or
// incomplete row is reviewable data, not a failed database write. The caller
// retains its listing and catalog association, and stages the incoming quote
// without overwriting the accepted quote when requiresReview is true.
export function preparePriceImport(source,prior=null,mapping=null,issues=[],invoices=[]){
  let row=source;
  const reasons=[...issues];
  let changes=[];
  if(prior&&(source.code?String(source.code)!==String(prior.vendor_item_code):!!prior.vendor_item_code))
    throw new Error("The incoming vendor item code does not belong to this saved listing.");
  try{row=prepareImportRow(source,{prior,mapping,invoices});}
  catch(error){reasons.push(error.message);changes=knownItemChanges(source,prior);}
  changes=row.changes||changes;
  reasons.push(...(row.conflicts||[]));
  if(prior&&!row.knownVendorItem){
    const change=(field,before,after,reason)=>{
      reasons.push(reason);
      if(!changes.some(c=>c.field===field))changes.push({field,before,after,reason});
    };
    if(row.description&&prior.description&&!sameText(row.description,prior.description)){
      const identity=compareProductIdentity(row.description,prior.description);
      if(identity.status!=="same")change("description",prior.description,row.description,`Product needs review: ${identity.reason}.`);
    }
    if(row.brand&&prior.brand&&!brandsMatch(row.brand,prior.brand))
      change("brand",prior.brand,row.brand,`Brand changed from “${prior.brand}” to “${row.brand}”.`);
    if(row.packSize&&prior.pack_size&&!sameText(row.packSize,prior.pack_size)){
      const comparison=comparePurchasingPack(row.packSize,prior.pack_size);
      if(comparison.status!=="same")change("packSize",prior.pack_size,row.packSize,
        comparison.status==="different"?`Pack changed from “${prior.pack_size}” to “${row.packSize}”.`:
          "The incoming and saved packs cannot yet be compared; verify the quantity and unit.");
    }
    for(const [field,saved,label] of [["gtin","gtin","Barcode"],["manufacturerCode","manufacturer_code","Manufacturer code"]]){
      if(row[field]&&prior[saved]&&String(row[field])!==String(prior[saved]))
        change(field,prior[saved],row[field],`${label} differs from the saved vendor item.`);
    }
    row={...row,description:row.description||prior.description,brand:row.brand||prior.brand||"",packSize:row.packSize||prior.pack_size};
  }
  if(!parsePackSize(row.packSize)?.parsed)reasons.push(row.packSize?
    "Pack quantity or unit is unreadable; correct the pack field.":"Pack quantity and unit are missing.");
  const resolved=resolveQuoteBasis(row,prior);
  if(!row.priceUnavailable){
    if(!resolved)reasons.push("Quoted unit is unresolved.");
    else if(parsePackSize(row.packSize)?.parsed&&casePriceFromQuote(row.price,resolved.basis.basis,resolved.basis.unit||resolved.sellingUnit,row.packSize)==null)
      reasons.push("The quoted amount, unit and pack cannot produce a valid case price.");
  }
  if(row.priceNeedsReview&&!reasons.length)reasons.push("The incoming price basis needs review.");
  return {row:{...row,changes},resolved,requiresReview:reasons.length>0,reasons:[...new Set(reasons)]};
}
