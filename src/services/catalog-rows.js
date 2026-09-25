import {priceBasisFor,casePriceFromQuote,parsePackSize} from "../procurement.js";

export function prepareCatalogCorrection({organizationId,vendorItem,mapping,patch}){
  if(!vendorItem?.id||!mapping?.id||vendorItem.organization_id!==organizationId||mapping.organization_id!==organizationId||mapping.vendor_item_id!==vendorItem.id)
    throw new Error("Choose a linked item from this organization.");
  const allowed=new Set(["description","brand","pack_size","price","selling_unit","category_id"]);
  if(Object.keys(patch).some(key=>!allowed.has(key)))throw new Error("Unsupported catalog field.");
  const cleaned={...patch};
  for(const key of ["description","brand","pack_size","selling_unit"])if(key in cleaned)cleaned[key]=String(cleaned[key]??"").trim();
  if("description" in cleaned&&!cleaned.description)throw new Error("Enter a product description.");
  if("price" in cleaned){
    cleaned.price=cleaned.price===""||cleaned.price==null?null:Number(cleaned.price);
    if(cleaned.price!=null&&(!Number.isFinite(cleaned.price)||cleaned.price<=0))throw new Error("Enter a positive quoted price, or leave it blank.");
  }
  const next={...vendorItem,...cleaned},basis=priceBasisFor(next.selling_unit),pack=parsePackSize(next.pack_size);
  if(next.selling_unit&&!basis)throw new Error("Select a recognized quoted unit.");
  // Any field may be saved while others are missing. Calculations wait.
  const convertible=basis&&pack?.parsed&&Number(next.price)>0&&casePriceFromQuote(Number(next.price),basis.basis,basis.unit||next.selling_unit,next.pack_size)!=null;
  return {organizationId,vendorItemId:vendorItem.id,mappingId:mapping.id,expectedRevision:vendorItem.row_revision||0,
    patch:cleaned,priceBasis:basis?.basis||null,priceAvailable:!!convertible};
}
export function createCatalogRowsService(backend){
  return {save(input){return backend.catalog.saveRow(prepareCatalogCorrection(input));}};
}
