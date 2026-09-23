import assert from "node:assert/strict";
import {blockReason,orderable,solveOrder} from "./ordering.js";
const option=(vendorId,price,extra={})=>({vendorId,vendorName:vendorId,vendorItemId:`${vendorId}-item`,price,packSize:"1 CT",...extra});
assert.equal(orderable(option("a",10)),true);
assert.equal(orderable(option("a",10,{expired:true})),false);
assert.equal(blockReason(option("a",10,{priceUnavailable:true})),"No current quoted price");
const cheapest=solveOrder([{catalogItemId:"item",quantity:2,orderUnit:"case",options:[option("a",10),option("b",12)]}],[])[0];
assert.equal(cheapest.assignedVendorId,"a");assert.equal(cheapest.lineTotal,20);
const forced=solveOrder([{catalogItemId:"item",quantity:1,orderUnit:"case",forcedVendorId:"b",options:[option("a",10),option("b",12)]}],[])[0];
assert.equal(forced.assignedVendorId,"b");assert.equal(forced.locked,true);
const blocked=solveOrder([{catalogItemId:"item",quantity:1,orderUnit:"case",options:[option("a",10,{expired:true})]}],[])[0];
assert.equal(blocked.unorderable,true);
const split=solveOrder([
  {catalogItemId:"item",quantity:3,orderUnit:"case",forcedVendorId:"a",options:[option("a",10),option("b",12)]},
  {catalogItemId:"item_split_case",quantity:2,orderUnit:"case",forcedVendorId:"b",options:[option("a",10),option("b",12)]},
],[]);
assert.deepEqual(split.map(line=>[line.assignedVendorId,line.quantity,line.lineTotal]),[["a",3,30],["b",2,24]],"short stock can be allocated across two vendor baskets");
console.log("KERDOS universal ordering-core tests passed");
