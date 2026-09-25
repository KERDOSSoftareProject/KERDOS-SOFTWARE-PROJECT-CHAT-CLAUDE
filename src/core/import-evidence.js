// Industry-neutral explanation of one extracted row. Percentages are
// deterministic evidence tiers, not empirically calibrated probabilities.
import {suggestCategory,parsePackSize,casePriceFromQuote,pricePerUnit,bestPurchasingMatch,compareProductIdentity,comparePurchasingPack} from "../procurement.js";
import {rememberImportRow} from "./catalog-fields.js";
import {resolveQuoteBasis} from "./quote-basis.js";
import {quoteContext} from "../knowledge/category-profiles.js";

const field=(value,accuracy,reason,source="document")=>({value,accuracy,reason,source});
export function explainImportRow(row,{vendor=null,categories=[],catalogItems=[],vendorItems=[],mappings=[],documentRows=[]}={}){
  const prior=vendorItems.find(vi=>vi.vendor_id===vendor?.id&&row.code&&String(vi.vendor_item_code)===String(row.code));
  const savedMapping=prior?mappings.find(m=>m.vendor_item_id===prior.id):null;
  const savedItem=savedMapping?catalogItems.find(c=>c.id===savedMapping.catalog_item_id):null;
  if(savedMapping?.comparison_track==="exact"&&savedMapping.confidence_score===100){
    row=rememberImportRow(row,prior,savedMapping);
  }
  const description=String(row.description||"").trim();
  const brand=String(row.brand||"").trim();
  const selectedCategory=row.categoryId?categories.find(c=>c.id===row.categoryId&&!c.is_holding_pen):savedItem?categories.find(c=>c.id===savedItem.category_id):null;
  const category=selectedCategory?{category:selectedCategory,confidence:"confirmed",reason:"Category selected for this row"}:description?suggestCategory(description,categories,catalogItems):null;
  const pack=parsePackSize(row.packSize);
  const resolved=resolveQuoteBasis(row,prior);
  const proposed=!resolved?quoteContext(row,documentRows):null;
  const basis=resolved?.basis||proposed?.basis||null;
  const amount=Number(row.price);
  const priced=!row.priceUnavailable&&row.price!==null&&row.price!==""&&Number.isFinite(amount)&&amount>0;
  const knownBasis=!!basis;
  const casePrice=priced&&knownBasis&&!row.priceNeedsReview?casePriceFromQuote(amount,basis.basis,basis.unit||resolved?.sellingUnit||proposed?.sellingUnit,row.packSize):null;
  const perUnit=casePrice!=null&&pack?.parsed?pricePerUnit(casePrice,row.packSize):null;
  const linkedById=new Map(vendorItems.map(v=>[v.id,v]));
  const candidates=row.knownVendorItem?[]:catalogItems.map(item=>{
    const peers=mappings.filter(m=>m.catalog_item_id===item.id).map(m=>linkedById.get(m.vendor_item_id)).filter(Boolean);
    const packs=[...new Set(peers.map(p=>p.pack_size).filter(Boolean))];
    return {...item,pack_size:packs.length===1?packs[0]:null,peers};
  });
  const suggestion=!row.knownVendorItem&&description?bestPurchasingMatch(description,row.packSize,candidates):null;
  const candidate=suggestion?.catalogItem;
  const peers=candidate?.peers||[];
  const compatible=peers.length>0&&peers.every(p=>compareProductIdentity(description,p.description).status==="same"&&
    comparePurchasingPack(row.packSize,p.pack_size).status==="same"&&(!brand||!p.brand||brand.toLowerCase()===p.brand.toLowerCase()));
  const matchAccuracy=candidate?(compatible&&suggestion.track==="exact"?100:75):0;
  const number=savedItem?.master_item_number??candidate?.master_item_number??null;
  return {
    itemNumber:field(number,savedItem?(savedMapping.comparison_track==="exact"?100:75):matchAccuracy,savedItem?"Existing vendor item number linked to this KERDOS number":number?matchAccuracy===100?"Existing item is consistent with the linked product and pack":"Possible existing item; check all defining details":"New KERDOS item number will be assigned on import","catalog"),
    vendor:field(vendor?.name||null,vendor?.name?100:0,vendor?.name?"Selected vendor":"Vendor not selected","selection"),
    category:field(category?.category?.name||null,["confident","confirmed"].includes(category?.confidence)?100:category?75:0,category?.reason||"No category evidence; place for review",selectedCategory?"manual selection":"category profile"),
    product:field(description||null,description?100:0,description?"Description extracted; product identity requires comparison with other listings":"Description missing"),
    brand:field(brand||null,brand?100:null,brand?"Brand stated on source":"Brand not provided; left blank"),
    pack:field(row.packSize||null,pack?.parsed?100:row.packSize?75:0,pack?.parsed?`Parsed ${pack.caseQty} inner unit(s), ${pack.total} ${pack.unit} per case`:row.packSize?"Pack text exists but cannot be completely parsed":"Pack not provided"),
    price:field(priced?amount:null,priced?100:0,priced?row.priceEdited?"Quoted amount corrected in this row; original source remains available":"Quoted amount extracted; its meaning depends on the selling unit":"No usable quote",row.priceEdited?"manual correction":"document"),
    sellingUnit:field(resolved?.sellingUnit||proposed?.sellingUnit||null,resolved?100:proposed?.accuracy||null,proposed?`Suggested from context: ${proposed.reason} Confirm before ordering.`:resolved?.source==="confirmed vendor item"?"Reused a confirmed unit for this vendor item and pack":row.sellingUnit?row.sellingUnitSource==="manual"?"Unit selected for this row":"Unit stated in source":"No selling unit stated",proposed?"industry inference":resolved?.source||"document"),
    unitCost:{...field(perUnit?perUnit.price:null,perUnit?proposed?.accuracy||100:priced?75:0,perUnit?proposed?`Estimated only: ${proposed.reason} Confirm the quoted unit before ordering.`:`Calculated from ${basis.basis} quote and ${pack.total} ${pack.unit} per case`:!knownBasis?"Selling unit unknown or absent; cannot calculate unit cost":!pack?.parsed?"Complete pack needed to calculate unit cost":"No usable quote", "calculation"),unit:perUnit?.unit||null},
    priceBasis:field(basis?.basis||null,basis?proposed?.accuracy||100:row.sellingUnit?0:null,proposed?`Likely ${proposed.sellingUnit}; ${proposed.reason} Confirm before ordering.`:basis?resolved.source==="document"?`Source selling unit: ${row.sellingUnit}`:`Inherited confirmed unit ${resolved.sellingUnit} from this vendor item`:row.sellingUnit?`Unrecognized selling unit: ${row.sellingUnit}`:"Selling unit not stated",proposed?"industry inference":"document"),
    knownItem:!!row.knownVendorItem,
    conflicts:row.conflicts||[],
    changes:row.changes||[],
    source:row.sourceLine||description,
  };
}
