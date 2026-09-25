// Catalog writes expressed in KERDOS business language. The service depends
// only on the provider's generic table capability; UI code never names or
// imports a database vendor.
import {prepareCatalogCorrection} from "./catalog-rows.js";
import {bestPurchasingMatch,bestPurchasingSuggestion,suggestCategory,nextCategoryRange,compareProductIdentity,comparePurchasingPack,brandsMatch,parsePackSize,abbreviationPairs} from "../procurement.js";

// An association is a customer's assertion about identity. Ordering eligibility
// additionally requires agreement with the existing vendor product's pack and
// description. Never turn an unverified manual association into an exact quote.
export function mappingVerification(vendorItem,catalogItem,linkedVendorItems=[]){
  if(!vendorItem||!catalogItem)throw new Error("Choose a vendor product and a catalog item.");
  const peers=linkedVendorItems.filter(peer=>peer.id!==vendorItem.id);
  const descriptions=peers.length?peers.map(peer=>peer.description):[catalogItem.name];
  const identity=descriptions.map(description=>compareProductIdentity(vendorItem.description,description));
  const packs=peers.map(peer=>comparePurchasingPack(vendorItem.pack_size,peer.pack_size));
  const brandsAgree=peers.every(peer=>!vendorItem.brand&&!peer.brand||brandsMatch(vendorItem.brand,peer.brand));
  const identifiersAgree=peers.every(peer=>(!vendorItem.gtin||!peer.gtin||vendorItem.gtin===peer.gtin)&&
    (!vendorItem.manufacturer_code||!peer.manufacturer_code||vendorItem.manufacturer_code===peer.manufacturer_code));
  const exact=!!parsePackSize(vendorItem.pack_size)?.parsed&&brandsAgree&&identifiersAgree&&identity.every(result=>result.status==="same")&&packs.every(result=>result.status==="same");
  return {comparison_track:exact?"exact":"review",confidence_score:exact?100:null,match_method:"manual"};
}
async function run(promise,operation){
  const {data,error}=await promise;
  if(error)throw new Error(`${operation}: ${error.message}`);
  return data;
}

// Single-vendor listings never auto-verify; the client confirms them. This
// finds the ones that are ready for that confirmation in one action: still
// unverified, the only vendor on their catalog item, and passing the same
// verification a one-at-a-time confirm would run (readable pack, product
// identity agrees with the catalog item). Anything else stays in review.
export function readyToConfirm({mappings=[],vendorItems=[],catalogItems=[]}){
  const viById=new Map(vendorItems.map(vi=>[vi.id,vi]));
  const ciById=new Map(catalogItems.map(ci=>[ci.id,ci]));
  const byCatalog=new Map();
  for(const m of mappings){const list=byCatalog.get(m.catalog_item_id)||[];list.push(m);byCatalog.set(m.catalog_item_id,list);}
  const ready=[];
  for(const m of mappings){
    if(m.comparison_track==="exact"&&m.confidence_score===100)continue;
    const vendorItem=viById.get(m.vendor_item_id),catalogItem=ciById.get(m.catalog_item_id);
    if(!vendorItem||!catalogItem)continue;
    const siblings=(byCatalog.get(m.catalog_item_id)||[]).filter(other=>other.id!==m.id);
    const otherVendors=siblings.map(other=>viById.get(other.vendor_item_id)?.vendor_id).filter(id=>id&&id!==vendorItem.vendor_id);
    if(otherVendors.length)continue;
    const verification=mappingVerification(vendorItem,catalogItem,[]);
    if(verification.comparison_track!=="exact")continue;
    ready.push({mappingId:m.id,vendorItemId:vendorItem.id,catalogItemId:catalogItem.id,description:vendorItem.description,packSize:vendorItem.pack_size,verification});
  }
  return ready;
}

// Why an association is not at 100%, as one fixed code per mapping. The
// codes are what makes the Not mapped list workable: grouped by code, one
// parser fix or one bulk confirm clears a whole group instead of one row.
export const GAP_LABELS={
  "pack-missing":"Pack size missing",
  "pack-unreadable":"Pack size can't be read",
  "single-vendor-ready":"Single vendor — ready to confirm",
  "single-vendor-detail":"Single vendor — wording differs from catalog item",
  "brand-conflict":"Brand differs from linked vendor",
  "pack-conflict":"Pack differs from linked vendor",
  "wording":"Wording differs from linked vendor",
};
export function mappingGap(vendorItem,catalogItem,peers=[]){
  if(!vendorItem||!catalogItem)return {code:"wording",label:GAP_LABELS.wording,detail:"Vendor product or catalog item is missing"};
  if(!vendorItem.pack_size)return {code:"pack-missing",label:GAP_LABELS["pack-missing"],detail:"No pack on the vendor listing"};
  if(!parsePackSize(vendorItem.pack_size)?.parsed)return {code:"pack-unreadable",label:GAP_LABELS["pack-unreadable"],detail:`"${vendorItem.pack_size}" is not a complete pack KERDOS can read`};
  const others=peers.filter(peer=>peer.id!==vendorItem.id);
  if(!others.length){
    const identity=compareProductIdentity(vendorItem.description,catalogItem.name);
    return identity.status==="same"
      ?{code:"single-vendor-ready",label:GAP_LABELS["single-vendor-ready"],detail:"Only one vendor lists this product; confirm to make it orderable"}
      :{code:"single-vendor-detail",label:GAP_LABELS["single-vendor-detail"],detail:identity.reason};
  }
  const brandClash=others.find(peer=>vendorItem.brand&&peer.brand&&!brandsMatch(vendorItem.brand,peer.brand));
  if(brandClash)return {code:"brand-conflict",label:GAP_LABELS["brand-conflict"],detail:`${vendorItem.brand} vs ${brandClash.brand}`};
  const packClash=others.map(peer=>({peer,result:comparePurchasingPack(vendorItem.pack_size,peer.pack_size)})).find(entry=>entry.result.status!=="same");
  if(packClash)return {code:"pack-conflict",label:GAP_LABELS["pack-conflict"],detail:`${vendorItem.pack_size} vs ${packClash.peer.pack_size||"none"}`};
  const wordClash=others.map(peer=>compareProductIdentity(vendorItem.description,peer.description)).find(result=>result.status!=="same");
  return {code:"wording",label:GAP_LABELS.wording,detail:wordClash?.reason||"Defining details need confirmation"};
}

// A barcode or a manufacturer code proves identity the way wording never
// can: the same GTIN from two vendors is the same trade item by
// definition, and the same manufacturer code under the same brand is the
// same part. Identity still says nothing about the pack, so the pack is
// checked separately: same pack → exact; different or unreadable pack →
// review, with the reason spelled out.
export function identifierMatch({gtin=null,manufacturerCode=null,brand=null,packSize=null,vendorId=null},candidates=[]){
  for(const candidate of candidates){
    const peers=(candidate.linkedVendorItems||[]).filter(vi=>!vendorId||vi.vendor_id!==vendorId);
    const byGtin=gtin?peers.find(vi=>vi.gtin&&vi.gtin===gtin):null;
    const byMfr=!byGtin&&manufacturerCode?peers.find(vi=>vi.manufacturer_code&&vi.manufacturer_code===manufacturerCode&&vi.brand&&brand&&brandsMatch(vi.brand,brand)):null;
    const witness=byGtin||byMfr;
    if(!witness)continue;
    const via=byGtin?"barcode":"manufacturer code";
    const pack=comparePurchasingPack(packSize,witness.pack_size);
    const allAgree=candidate.linkedVendorItems.every(peer=>comparePurchasingPack(packSize,peer.pack_size).status==="same"&&
      (!brand||!peer.brand||brandsMatch(brand,peer.brand))&&
      (!gtin||!peer.gtin||peer.gtin===gtin)&&
      (!manufacturerCode||!peer.manufacturer_code||!brand||!peer.brand||
        !brandsMatch(brand,peer.brand)||peer.manufacturer_code===manufacturerCode));
    if(pack.status==="same"&&allAgree)return {catalogItem:candidate,track:"exact",score:1,method:"identifier",reason:`Same ${via} as an existing vendor listing in the same pack`};
    return {catalogItem:candidate,track:"similar",score:0.9,method:"identifier",reason:`Same ${via} as an existing vendor listing, but the pack differs or is unreadable (${packSize||"none"} vs ${witness.pack_size||"none"})`};
  }
  return null;
}

// Record the evidence used for an automatic association. A match to the
// catalog label alone cannot override a conflicting linked vendor listing.
export function associationEvidence({description,packSize,brand,gtin,manufacturerCode},candidate){
  const peers=candidate.linkedVendorItems||[];
  const checks=peers.map(peer=>({
    identity:compareProductIdentity(description,peer.description).status,
    pack:comparePurchasingPack(packSize,peer.pack_size).status,
    brand:!brand||!peer.brand||brandsMatch(brand,peer.brand),
    identifier:(!gtin||!peer.gtin||gtin===peer.gtin)&&
      (!manufacturerCode||!peer.manufacturer_code||!brand||!peer.brand||
        !brandsMatch(brand,peer.brand)||manufacturerCode===peer.manufacturer_code),
  }));
  return {peers:checks.length,checks,exact:checks.length>0&&checks.every((c,i)=>
    (c.identity==="same"||!!gtin&&peers[i].gtin===gtin||
      !!manufacturerCode&&!!brand&&brandsMatch(brand,peers[i].brand)&&peers[i].manufacturer_code===manufacturerCode)&&
    c.pack==="same"&&c.brand&&c.identifier)};
}

// Mappings the engine is allowed to verify on its own under the agreed
// rule: a second vendor already carries the same exact product in the
// same pack, brands agree, and the pack is readable. These typically
// appear after the vocabulary learns a spelling or a pack is corrected,
// when an earlier "review" decision would now come out "exact".
export function engineVerifiable({mappings=[],vendorItems=[],catalogItems=[]}){
  const viById=new Map(vendorItems.map(vi=>[vi.id,vi]));
  const ciById=new Map(catalogItems.map(ci=>[ci.id,ci]));
  const byCatalog=new Map();
  for(const m of mappings){const list=byCatalog.get(m.catalog_item_id)||[];list.push(m);byCatalog.set(m.catalog_item_id,list);}
  const ready=[];
  for(const m of mappings){
    if(m.comparison_track==="exact"&&m.confidence_score===100)continue;
    const vendorItem=viById.get(m.vendor_item_id),catalogItem=ciById.get(m.catalog_item_id);
    if(!vendorItem||!catalogItem)continue;
    const peers=(byCatalog.get(m.catalog_item_id)||[]).filter(other=>other.id!==m.id).map(other=>viById.get(other.vendor_item_id)).filter(Boolean);
    const witnesses=peers.filter(peer=>peer.vendor_id&&peer.vendor_id!==vendorItem.vendor_id&&peer.pack_size);
    if(!witnesses.length)continue;
    const verification=mappingVerification(vendorItem,catalogItem,peers);
    if(verification.comparison_track!=="exact")continue;
    ready.push({mappingId:m.id,vendorItemId:vendorItem.id,catalogItemId:catalogItem.id,description:vendorItem.description,packSize:vendorItem.pack_size,
      verification:{...verification,match_method:"rule_based"}});
  }
  return ready;
}

export function createCatalogService(backend){
  const table=backend.records.query;
  return {
    async matchOrCreate({organizationId,vendorId,description,packSize,brand=null,gtin=null,manufacturerCode=null,categoryId=null,catalogItems,categories,vendorItems=[],mappings=[]}){
      const byId=new Map(vendorItems.map(vi=>[vi.id,vi]));
      const candidates=catalogItems.map(ci=>{
        const linked=mappings.map(m=>m.catalog_item_id===ci.id?byId.get(m.vendor_item_id):null).filter(Boolean);
        const knownPacks=[...new Set(linked.map(vi=>vi.pack_size).filter(Boolean))];
        const knownBrands=[...new Set(linked.map(vi=>vi.brand).filter(Boolean))];
        return {...ci,pack_size:knownPacks.length===1?knownPacks[0]:null,knownBrand:knownBrands.length===1?knownBrands[0]:null,
          linkedVendorItems:linked,
          otherVendorPresent:!!vendorId&&linked.some(vi=>vi.vendor_id&&vi.vendor_id!==vendorId)};
      });
      // Identifiers come first: they settle identity without wording.
      const proven=identifierMatch({gtin,manufacturerCode,brand,packSize,vendorId},candidates);
      if(proven?.track==="exact"){
        const evidence=associationEvidence({description,packSize,brand,gtin,manufacturerCode},proven.catalogItem);
        if(evidence.exact)return {catalogItemId:proven.catalogItem.id,track:"exact",score:1,method:"identifier",reason:proven.reason};
      }
      const match=proven||bestPurchasingMatch(description,packSize,candidates);
      // Brand is part of a verified identity. Unknown brand does not prove
      // equality to a named brand; differing brands can be proposed for
      // substitution, but never placed in the same exact-price comparison.
      const brandVerified=match&&(!brand&&!match.catalogItem.knownBrand||brandsMatch(brand,match.catalogItem.knownBrand));
      if(match?.track==="exact"&&brandVerified&&match.catalogItem.otherVendorPresent&&
        associationEvidence({description,packSize,brand,gtin,manufacturerCode},match.catalogItem).exact)
        return {catalogItemId:match.catalogItem.id,track:"exact",score:1};
      const suggestion=match||bestPurchasingSuggestion(description,packSize,candidates);
      const placement=await this.placeInCategory({organizationId,description,categoryId,categories,catalogItems});
      const created=await this.createItem({organizationId,name:description,categoryId:placement.category?.id||null,categoryReview:placement.review,categoryReason:placement.reason,catalogItems,categories});
      catalogItems.push(created);
      return {catalogItemId:created.id,track:suggestion?"review":"new",score:suggestion?.score??null,reason:match?.reason||"Possible product; verify defining details before linking"};
    },
    // Most likely category first, holding pen last. A guessed placement is
    // flagged for review so the client confirms or moves it, instead of
    // filing every new product from scratch.
    async placeInCategory({organizationId,description,categoryId=null,categories,catalogItems}){
      if(categoryId){
        const selected=categories.find(category=>category.id===categoryId&&!category.is_holding_pen);
        if(!selected)throw new Error("Choose an available category for this organization.");
        return {category:selected,review:false,reason:null};
      }
      const suggested=suggestCategory(description,categories,catalogItems);
      if(suggested)return {category:suggested.category,review:suggested.confidence!=="confident",reason:suggested.confidence==="confident"?null:suggested.reason};
      return {category:await this.ensureHoldingCategory(organizationId,categories),review:true,reason:"Category unknown; select a category to move this entire item and its vendor listings"};
    },
    async ensureHoldingCategory(organizationId,categories){
      const existing=categories.find(category=>category.is_holding_pen)||null;
      if(existing)return existing;
      const {range_start,range_end}=nextCategoryRange(categories);
      const created=await run(table("catalog_categories").insert({organization_id:organizationId,name:"Uncategorized",is_holding_pen:true,range_start,range_end,keywords:[]}).select().single(),"Could not create the holding category");
      categories.push(created);
      return created;
    },
    async createItem({organizationId,name,categoryId,categoryReview=false,categoryReason=null,catalogItems,categories}){
      const category=categories.find(candidate=>candidate.id===categoryId)||null;
      // Include numbers from items later moved to another category. Their
      // KERDOS numbers remain theirs and must never be recycled here.
      const itemsInCategory=catalogItems.filter(item=>item.master_item_number>=Number(category?.range_start||1)&&
        item.master_item_number<=Number(category?.range_end||Number.MAX_SAFE_INTEGER));
      const masterItemNumber=itemsInCategory.length?Math.max(...itemsInCategory.map(item=>item.master_item_number||0))+1:(category?.range_start||1);
      return run(table("catalog_items").insert({organization_id:organizationId,category_id:categoryId||null,master_item_number:masterItemNumber,name:name.slice(0,120),matching_behavior:"flexible",canonical_unit:null,brand_locked:false,category_review:!!categoryReview,category_reason:categoryReason||null}).select().single(),"Could not create the item");
    },
    // The client's word on a guessed placement: keep it where it is.
    confirmCategory(catalogItemId){
      return run(table("catalog_items").update({category_review:false,category_reason:null}).eq("id",catalogItemId),"Could not confirm the category");
    },
    async confirmCategories(catalogItemIds){
      let confirmed=0;
      for(const id of catalogItemIds){await this.confirmCategory(id);confirmed++;}
      return confirmed;
    },
    async splitMapping({organizationId,mappingId,description,catalogItems,categories}){
      const placement=await this.placeInCategory({organizationId,description,categories,catalogItems});
      const created=await this.createItem({organizationId,name:description,categoryId:placement.category?.id||null,categoryReview:placement.review,categoryReason:placement.reason,catalogItems,categories});
      const mapping=await run(table("item_mappings").select("vendor_item_id").eq("id",mappingId).single(),"Could not read the current association");
      const vendorItem=await run(table("vendor_items").select("*").eq("id",mapping.vendor_item_id).single(),"Could not read the vendor product");
      const verification=mappingVerification(vendorItem,created);
      await run(table("item_mappings").update({catalog_item_id:created.id,...verification}).eq("id",mappingId),"Could not point the vendor item at it");
      return created;
    },
    confirmMapping(mappingId,verification){
      if(!verification)throw new Error("Check this product against the catalog and its vendor packs before confirming.");
      return run(table("item_mappings").update(verification).eq("id",mappingId),"Could not confirm the match");
    },
    async correctVendorFields({organizationId,vendorItem,mappingId,description,brand,packSize}){
      const patch={description,brand,pack_size:packSize};
      const request=prepareCatalogCorrection({organizationId,vendorItem,mapping:{id:mappingId,vendor_item_id:vendorItem?.id,organization_id:organizationId},patch});
      await backend.catalog.saveRow(request);
      return true;
    },
    async confirmMappings(entries){
      let confirmed=0;
      for(const entry of entries){
        if(!entry?.verification||entry.verification.comparison_track!=="exact")throw new Error("Only fully verified associations can be confirmed in bulk.");
        await run(table("item_mappings").update(entry.verification).eq("id",entry.mappingId),"Could not confirm the match");
        confirmed++;
      }
      return confirmed;
    },
    // Save the abbreviations a confirmation revealed, so the same wording
    // never needs a second confirmation. Only spelling pairs are saved
    // (see abbreviationPairs); existing terms are left alone.
    async learnAbbreviations({organizationId,description,references=[],vocabulary=[]}){
      const known=new Set(vocabulary.filter(row=>row.kind==="synonym").map(row=>String(row.term).toLowerCase()));
      const pairs=abbreviationPairs(description,references).filter(pair=>!known.has(pair.term));
      if(!pairs.length)return [];
      await run(table("org_vocabulary").insert(pairs.map(pair=>({organization_id:organizationId,kind:"synonym",term:pair.term,canonical:pair.canonical}))),"Could not save the learned wording");
      return pairs;
    },
    remapToExisting(mappingId,catalogItemId,verification){
      if(!verification)throw new Error("Check this product against the destination and its vendor packs before moving it.");
      return run(table("item_mappings").update({catalog_item_id:catalogItemId,...verification}).eq("id",mappingId),"Could not remap the item");
    },
    renameItem(catalogItemId,name){
      return run(table("catalog_items").update({name:name.slice(0,120)}).eq("id",catalogItemId),"Could not rename the item");
    },
    updateItemSettings(catalogItemId,patch){
      return run(table("catalog_items").update(patch).eq("id",catalogItemId),"Could not save that setting");
    },
    assignVendorItem({organizationId,vendorItemId,catalogItemId,mappingId=null,verification}){
      if(!verification)throw new Error("Check the vendor product and catalog pack before assigning it.");
      if(mappingId){
        return run(table("item_mappings").update({catalog_item_id:catalogItemId,...verification}).eq("id",mappingId),"Could not update the link");
      }
      return run(table("item_mappings").insert({organization_id:organizationId,catalog_item_id:catalogItemId,vendor_item_id:vendorItemId,...verification}),"Could not create the link");
    },
  };
}
