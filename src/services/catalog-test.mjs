import assert from "node:assert/strict";
import {createCatalogService} from "./catalog.js";

const calls=[];
function query(table){
  const state={table};
  const chain={
    select(value){state.select=value;return chain;},
    update(value){state.update=value;return chain;},
    insert(value){state.insert=value;return chain;},
    delete(){state.delete=true;return chain;},
    eq(column,value){state.eq=[column,value];return chain;},
    single(){state.single=true;return chain;},
    then(resolve){calls.push({...state});resolve({data:state.insert&&state.single?{id:"created",...state.insert}:state.select?[{id:"mapping"}]:{ok:true},error:null});},
  };
  return chain;
}
const service=createCatalogService({records:{query}});
await service.confirmMapping("m1");
assert.deepEqual(calls.at(-1).update,{comparison_track:"exact",confidence_score:100,match_method:"manual"});
await service.renameItem("c1","Client Product");
assert.equal(calls.at(-1).update.name,"Client Product");
await service.assignVendorItem({organizationId:"o1",vendorItemId:"v1",catalogItemId:"c1"});
assert.equal(calls.at(-1).insert.match_method,"manual");
const created=await service.createItem({organizationId:"o1",name:"Universal Product",categoryId:"cat",catalogItems:[],categories:[{id:"cat",range_start:20000}]});
assert.equal(created.master_item_number,20000);
assert.equal(calls.at(-1).table,"catalog_items");
const established=[{id:"c1",name:"American cheese",matching_behavior:"flexible"}];
const vendorItems=[{id:"v1",description:"American cheese",pack_size:"120 CT"}];
const mappings=[{catalog_item_id:"c1",vendor_item_id:"v1"}];
const exact=await service.matchOrCreate({organizationId:"o1",description:"American cheese",packSize:"120 CT",catalogItems:[...established],categories:[],vendorItems,mappings});
assert.equal(exact.track,"exact");
assert.equal(exact.catalogItemId,"c1");
const reviewed=await service.matchOrCreate({organizationId:"o1",description:"American cheese",packSize:"160 CT",catalogItems:[...established],categories:[],vendorItems,mappings});
assert.equal(reviewed.track,"review");
assert.notEqual(reviewed.catalogItemId,"c1");
console.log("KERDOS provider-neutral catalog-service tests passed");
