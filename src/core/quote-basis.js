import {compareProductIdentity,comparePurchasingPack,priceBasisFor} from "../procurement.js";

// Reuse a confirmed vendor-specific quote basis for a repeat import only.
// A null basis on an old record is legacy "case" and is not evidence that
// a new document with an omitted unit also quotes cases.
export function resolveQuoteBasis(row,prior=null){
  const explicit=priceBasisFor(row.sellingUnit);
  if(explicit)return {basis:explicit,sellingUnit:row.sellingUnit,source:row.sellingUnitSource==="remembered"?"confirmed vendor item":row.sellingUnitSource==="manual"?"manual selection":"document"};
  if(String(row.sellingUnit||"").trim())return null;
  if(!prior?.price_basis||!prior.selling_unit||!row.code||String(prior.vendor_item_code)!==String(row.code))return null;
  if(compareProductIdentity(row.description,prior.description).status!=="same"||
     comparePurchasingPack(row.packSize,prior.pack_size).status!=="same")return null;
  const learned=priceBasisFor(prior.selling_unit);
  return learned?.basis===prior.price_basis?{basis:learned,sellingUnit:prior.selling_unit,source:"confirmed vendor item"}:null;
}
