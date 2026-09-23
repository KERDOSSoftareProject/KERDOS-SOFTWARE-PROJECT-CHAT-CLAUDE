// Catalog writes expressed in KERDOS business language. The service depends
// only on the provider's generic table capability; UI code never names or
// imports a database vendor.
import {bestPurchasingMatch,classifyCategory,nextCategoryRange} from "../procurement.js";
async function run(promise,operation){
  const {data,error}=await promise;
  if(error)throw new Error(`${operation}: ${error.message}`);
  return data;
}

export function createCatalogService(backend){
  const table=backend.records.query;
  return {
    async matchOrCreate({organizationId,description,packSize,catalogItems,categories,vendorItems=[],mappings=[]}){
      const byId=new Map(vendorItems.map(vi=>[vi.id,vi]));
      const candidates=catalogItems.map(ci=>{
        const linked=mappings.map(m=>m.catalog_item_id===ci.id?byId.get(m.vendor_item_id):null).filter(Boolean);
        const knownPacks=[...new Set(linked.map(vi=>vi.pack_size).filter(Boolean))];
        return {...ci,pack_size:knownPacks.length===1?knownPacks[0]:null};
      });
      const match=bestPurchasingMatch(description,packSize,candidates);
      if(match?.track==="exact")return {catalogItemId:match.catalogItem.id,track:"exact",score:match.score};
      const category=classifyCategory(description,categories,catalogItems)||await this.ensureHoldingCategory(organizationId,categories);
      const created=await this.createItem({organizationId,name:description,categoryId:category?.id||null,catalogItems,categories});
      catalogItems.push(created);
      return {catalogItemId:created.id,track:match?"review":"new",score:match?.score??null,reason:match?.reason||"No verified equivalent found"};
    },
    async ensureHoldingCategory(organizationId,categories){
      const existing=categories.find(category=>category.is_holding_pen)||null;
      if(existing)return existing;
      const {range_start,range_end}=nextCategoryRange(categories);
      const created=await run(table("catalog_categories").insert({organization_id:organizationId,name:"Uncategorized",is_holding_pen:true,range_start,range_end,keywords:[]}).select().single(),"Could not create the holding category");
      categories.push(created);
      return created;
    },
    async createItem({organizationId,name,categoryId,catalogItems,categories}){
      const category=categories.find(candidate=>candidate.id===categoryId)||null;
      const itemsInCategory=catalogItems.filter(item=>item.category_id===categoryId);
      const masterItemNumber=itemsInCategory.length?Math.max(...itemsInCategory.map(item=>item.master_item_number||0))+1:(category?.range_start||1);
      return run(table("catalog_items").insert({organization_id:organizationId,category_id:categoryId||null,master_item_number:masterItemNumber,name:name.slice(0,120),matching_behavior:"flexible",canonical_unit:null,brand_locked:false}).select().single(),"Could not create the item");
    },
    async splitMapping({organizationId,mappingId,description,catalogItems,categories}){
      const category=classifyCategory(description,categories)||await this.ensureHoldingCategory(organizationId,categories);
      const created=await this.createItem({organizationId,name:description,categoryId:category?.id||null,catalogItems,categories});
      await run(table("item_mappings").update({catalog_item_id:created.id,comparison_track:"exact",confidence_score:100}).eq("id",mappingId),"Could not point the vendor item at it");
      return created;
    },
    confirmMapping(mappingId){
      return run(table("item_mappings").update({comparison_track:"exact",confidence_score:100,match_method:"manual"}).eq("id",mappingId),"Could not confirm the match");
    },
    remapToExisting(mappingId,catalogItemId){
      return run(table("item_mappings").update({catalog_item_id:catalogItemId,comparison_track:"exact",confidence_score:100,match_method:"manual"}).eq("id",mappingId),"Could not remap the item");
    },
    async mergeItems(sourceCatalogItemId,targetCatalogItemId){
      if(sourceCatalogItemId===targetCatalogItemId)return;
      const mappings=await run(table("item_mappings").select("id").eq("catalog_item_id",sourceCatalogItemId),"Could not read the item's vendor links");
      for(const mapping of mappings||[]){
        await run(table("item_mappings").update({catalog_item_id:targetCatalogItemId,comparison_track:"exact",confidence_score:100}).eq("id",mapping.id),"Could not move a vendor link");
      }
      return run(table("catalog_items").delete().eq("id",sourceCatalogItemId),"Could not remove the merged item");
    },
    renameItem(catalogItemId,name){
      return run(table("catalog_items").update({name:name.slice(0,120)}).eq("id",catalogItemId),"Could not rename the item");
    },
    updateItemSettings(catalogItemId,patch){
      return run(table("catalog_items").update(patch).eq("id",catalogItemId),"Could not save that setting");
    },
    assignVendorItem({organizationId,vendorItemId,catalogItemId,mappingId=null}){
      if(mappingId){
        return run(table("item_mappings").update({catalog_item_id:catalogItemId,comparison_track:"exact",confidence_score:100,match_method:"manual"}).eq("id",mappingId),"Could not update the link");
      }
      return run(table("item_mappings").insert({organization_id:organizationId,catalog_item_id:catalogItemId,vendor_item_id:vendorItemId,comparison_track:"exact",confidence_score:100,match_method:"manual"}),"Could not create the link");
    },
  };
}
