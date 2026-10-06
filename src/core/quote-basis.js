import {compareProductIdentity,comparePurchasingPack,priceBasisFor,brandsMatch} from "../procurement.js";
import {inferPricingBasis} from "./infer-pricing-basis.js";

// Reuse a confirmed vendor-specific quote basis for a repeat import only.
// A null basis on an old record is legacy "case" and is not evidence that
// a new document with an omitted unit also quotes cases.
export function resolveQuoteBasis(row,prior=null){
  const explicit=priceBasisFor(row.sellingUnit);
  if(explicit)return {basis:explicit,sellingUnit:row.sellingUnit,source:row.sellingUnitSource==="remembered"?"confirmed vendor item":row.sellingUnitSource==="manual"?"manual selection":row.sellingUnitSource==="invoice"?"invoice evidence":"document"};
  if(String(row.sellingUnit||"").trim())return null;
  if(!prior?.price_basis||!prior.selling_unit||prior.price_source==="invoice"||prior.import_row?.reviewRequired)return null;
  const coded=row.code&&String(prior.vendor_item_code)===String(row.code);
  // The caller must resolve one unique NVIM first, within this vendor.
  const uncoded=!row.code&&!prior.vendor_item_code&&!!prior.id&&row.resolvedVendorItemId===prior.id;
  if(!coded&&!uncoded)return null;
  if(row.brand&&prior.brand&&!brandsMatch(row.brand,prior.brand))return null;
  if(row.gtin&&prior.gtin&&row.gtin!==prior.gtin)return null;
  if(row.manufacturerCode&&prior.manufacturer_code&&row.manufacturerCode!==prior.manufacturer_code)return null;
  if(compareProductIdentity(row.description,prior.description).status!=="same"||
     comparePurchasingPack(row.packSize,prior.pack_size).status!=="same")return null;
  const learned=priceBasisFor(prior.selling_unit);
  return learned?.basis===prior.price_basis?{basis:learned,sellingUnit:prior.selling_unit,source:"confirmed vendor item"}:null;
}

// Infer a pricing basis from pack structure, product type and price mathematics
// when no explicit selling unit and no prior confirmed basis is available.
// Returns in the same shape as resolveQuoteBasis, with an added 'inferenceLevel'
// field so the caller knows whether to auto-populate or request confirmation.
export function inferQuoteBasis(row) {
  if (String(row.sellingUnit||'').trim()) return null; // explicit unit already present
  const result = inferPricingBasis(row);
  if (!result.basis) return null;
  return {
    basis: result.basis,
    sellingUnit: result.sellingUnit,
    source: 'inferred',
    inferenceLevel: result.level,   // 'supported'|'suggested'|'conflicting'
    inferenceReason: result.reason,
    inferenceEvidence: result.evidence,
    inferenceConflicts: result.conflicts,
  };
}
