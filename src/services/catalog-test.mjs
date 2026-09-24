import assert from "node:assert/strict";
import {createCatalogService,mappingVerification} from "./catalog.js";

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
const verified=mappingVerification({id:"v2",description:"American cheese",pack_size:"120 CT"},{id:"c1",name:"American cheese"},[{id:"v1",description:"American cheese",pack_size:"120 CT"}]);
assert.equal(verified.comparison_track,"exact");
assert.equal(mappingVerification({id:"v2",description:"American cheese",pack_size:"160 CT"},{id:"c1",name:"American cheese"},[{id:"v1",description:"American cheese",pack_size:"120 CT"}]).comparison_track,"review");
assert.equal(mappingVerification({id:"v2",description:"American cheese",pack_size:"120 CT",brand:"A"},{id:"c1",name:"American cheese"},[{id:"v1",description:"American cheese",pack_size:"120 CT",brand:"B"}]).comparison_track,"review");
assert.equal(mappingVerification({id:"v2",description:"American cheese sliced",pack_size:"120 CT"},{id:"c1",name:"American cheese"},[{id:"v1",description:"American cheese slab",pack_size:"120 CT"}]).comparison_track,"review");
assert.equal(mappingVerification({id:"v2",description:"American cheese",pack_size:null},{id:"c1",name:"American cheese"},[]).comparison_track,"review");
assert.equal(mappingVerification({id:"v2",description:"American cheese",pack_size:"1-40# CB"},{id:"c1",name:"American cheese"},[]).comparison_track,"review");
assert.throws(()=>service.confirmMapping("m1"),/Check this product/);
await service.confirmMapping("m1",verified);
assert.deepEqual(calls.at(-1).update,{comparison_track:"exact",confidence_score:100,match_method:"manual"});
await service.renameItem("c1","Client Product");
assert.equal(calls.at(-1).update.name,"Client Product");
await service.assignVendorItem({organizationId:"o1",vendorItemId:"v1",catalogItemId:"c1",verification:verified});
assert.equal(calls.at(-1).insert.match_method,"manual");
const created=await service.createItem({organizationId:"o1",name:"Universal Product",categoryId:"cat",catalogItems:[],categories:[{id:"cat",range_start:20000}]});
assert.equal(created.master_item_number,20000);
assert.equal(calls.at(-1).table,"catalog_items");
const established=[{id:"c1",name:"American cheese",matching_behavior:"flexible"}];
const vendorItems=[{id:"v1",vendor_id:"vendor-a",description:"American cheese",pack_size:"120 CT"}];
const mappings=[{catalog_item_id:"c1",vendor_item_id:"v1"}];
const exact=await service.matchOrCreate({organizationId:"o1",vendorId:"vendor-b",description:"American cheese",packSize:"120 CT",catalogItems:[...established],categories:[],vendorItems,mappings});
assert.equal(exact.track,"exact");
assert.equal(exact.catalogItemId,"c1");
assert.equal(exact.score,1);
const singleVendor=await service.matchOrCreate({organizationId:"o1",vendorId:"vendor-a",description:"American cheese",packSize:"120 CT",catalogItems:[...established],categories:[],vendorItems,mappings});
assert.equal(singleVendor.track,"review","another listing from the same vendor cannot prove a cross-vendor match");
const differentBrand=await service.matchOrCreate({organizationId:"o1",description:"American cheese",packSize:"120 CT",brand:"B",catalogItems:[...established],categories:[],vendorItems:[{id:"v1",description:"American cheese",pack_size:"120 CT",brand:"A"}],mappings});
assert.equal(differentBrand.track,"review");
const reviewed=await service.matchOrCreate({organizationId:"o1",description:"American cheese",packSize:"160 CT",catalogItems:[...established],categories:[],vendorItems,mappings});
assert.equal(reviewed.track,"review");
assert.notEqual(reviewed.catalogItemId,"c1");
const differingWords=await service.matchOrCreate({organizationId:"o1",description:"CHEESE AMER SLI 160 WHITE",packSize:"4/5 LB",catalogItems:[{id:"c2",name:"CHEESE AMERICAN 160CT WHITE",matching_behavior:"flexible"}],categories:[],vendorItems:[{id:"v2",description:"CHEESE AMERICAN 160CT WHITE",pack_size:"4/5 LB"}],mappings:[{catalog_item_id:"c2",vendor_item_id:"v2"}]});
assert.equal(differingWords.track,"review");
assert.notEqual(differingWords.catalogItemId,"c2");
console.log("KERDOS provider-neutral catalog-service tests passed");
