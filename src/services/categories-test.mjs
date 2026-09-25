import assert from "node:assert/strict";
import {createCategoryService,holdingPen} from "./categories.js";
import {classifyCategory} from "../procurement.js";

const calls=[];
const fixtures={industry_templates:[{category_name:"Supplies",keywords:["paper"],sort_order:1}],industry_vocabulary:[{kind:"synonym",term:"cs",canonical:"case"}],org_vocabulary:[]};
function query(table){
  const state={table};
  const chain={
    select(value){state.select=value;return chain;}, insert(value){state.insert=value;return chain;},
    update(value){state.update=value;return chain;}, delete(){state.delete=true;return chain;},
    eq(column,value){state.eq=[column,value];return chain;}, ilike(column,value){state.ilike=[column,value];return chain;},
    order(value){state.order=value;return chain;},
    then(resolve){calls.push({...state});resolve({data:state.select?(fixtures[table]||[]):{ok:true},error:null});},
  };
  return chain;
}
const service=createCategoryService({records:{query}});
assert.equal(holdingPen([{id:"h",is_holding_pen:true}]).id,"h");
const contextual=classifyCategory("Boneless Chicken Breast 40 lb",[{id:"meat",name:"Proteins",keywords:[]},{id:"dry",name:"Dry Goods",keywords:[]}],[
  {category_id:"meat",name:"Chicken Breast Boneless 40 LB"},
  {category_id:"dry",name:"Chicken Base Powder 25 LB"},
]);
assert.equal(contextual?.id,"meat","whole-description context should classify without a keyword hit");
const ambiguous=classifyCategory("Heavy Duty Cleaner",[{id:"a",name:"A",keywords:[]},{id:"b",name:"B",keywords:[]}],[
  {category_id:"a",name:"Heavy Duty Cleaner"},{category_id:"b",name:"Heavy Duty Cleaner"},
]);
assert.equal(ambiguous,null,"competing contextual examples must require review");
const starter=await service.loadStarterPack({organizationId:"o1",industry:"Restaurant",categories:[]});
assert.deepEqual(starter,{added:1,addedVocabulary:1,found:true});
assert.equal(calls.find(call=>call.table==="catalog_categories"&&call.insert).insert[0].organization_id,"o1");
// Run the same service with construction data; the engine has no industry branch.
fixtures.industry_templates=[{category_name:"Lumber",keywords:["plywood","stud"],sort_order:1}];
fixtures.industry_vocabulary=[{kind:"unit",term:"bdft",canonical:"BF"},{kind:"synonym",term:"plywd",canonical:"plywood"}];
const construction=await service.loadStarterPack({organizationId:"builder",industry:"Construction",categories:[]});
assert.deepEqual(construction,{added:1,addedVocabulary:2,found:true});
assert.equal(calls.filter(call=>call.table==="catalog_categories"&&call.insert).at(-1).insert[0].organization_id,"builder");
assert.equal(classifyCategory("Plywood 4x8",[{id:"lumber",name:"Lumber",keywords:["plywood"]}])?.id,"lumber");
const next=await service.assignItem({catalogItemId:"i2",categoryId:"c1",catalogItems:[{id:"i1",category_id:"c1",master_item_number:1000}],categories:[{id:"c1",range_start:1000}]});
assert.equal(next,1001);
assert.deepEqual(calls.at(-1).update,{category_id:"c1",master_item_number:1001,category_review:false,category_reason:null});
const retained=await service.assignItem({catalogItemId:"i2",categoryId:"c1",catalogItems:[{id:"i2",category_id:"h",master_item_number:9001}],categories:[{id:"h",is_holding_pen:true},{id:"c1",range_start:1000}]});
assert.equal(retained,9001,"moving a row keeps its client item number");
assert.deepEqual(calls.at(-1).update,{category_id:"c1",category_review:false,category_reason:null});
const moved=await service.reclassifyUncategorized({catalogItems:[{id:"i3",name:"Paper Towels",category_id:"h"}],categories:[{id:"h",is_holding_pen:true},{id:"c1",keywords:["paper"],range_start:1000}]});
assert.equal(moved.moved,1);
assert.equal(moved.checked,1);
const retainedByEngine=await service.reclassifyUncategorized({catalogItems:[{id:"i4",name:"Paper Towels",category_id:"h",master_item_number:9002}],categories:[{id:"h",is_holding_pen:true},{id:"c1",keywords:["paper"],range_start:1000}]});
assert.equal(retainedByEngine.moved,1);
assert.equal(calls.at(-1).update.master_item_number,undefined);
console.log("KERDOS provider-neutral category-service tests passed");
