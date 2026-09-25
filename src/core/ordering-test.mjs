import assert from "node:assert/strict";
import {blockReason,orderable,priceForOffer,rankVendorOffers,solveOrder} from "./ordering.js";
const option=(vendorId,price,extra={})=>({vendorId,vendorName:vendorId,vendorItemId:`${vendorId}-item`,price,packSize:"1 CT",matchTrack:"exact",matchConfidence:100,...extra});
assert.equal(orderable(option("a",10)),true);
assert.equal(orderable(option("a",10,{matchTrack:"new"})),false);
assert.equal(orderable(option("a",10,{matchConfidence:99})),false);
assert.equal(orderable(option("a",10,{packSize:null})),false);
assert.equal(orderable(option("a",10,{expired:true})),false);
assert.equal(orderable(option("a",10,{basisUnconvertible:true,quoteBasis:"measure",quoteUnit:"LB"})),false);
assert.match(blockReason(option("a",10,{basisUnconvertible:true,quoteBasis:"measure",quoteUnit:"LB"})),/per LB/);
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
const quotes=[{...option("a",12),casePrice:12,eachPrice:3},{...option("b",10),casePrice:10,eachPrice:2}];
const agreement={vendorId:"a",price:8};
assert.equal(priceForOffer(quotes[0],agreement),8);
assert.equal(priceForOffer(quotes[0],{a:8,b:9}),8);
assert.equal(priceForOffer(quotes[1],{a:8,b:9}),9,"every vendor keeps its own agreed price");
assert.equal(priceForOffer(quotes[1],agreement),10,"another vendor must retain its own quote");
assert.equal(priceForOffer(quotes[0],null,"each"),3,"an each quote is unchanged without its own agreement");
const ranked=rankVendorOffers([{...option("minores",55.9),casePrice:55.9},{...option("cityline",56.9),casePrice:56.9},{...option("mina",57),casePrice:57}],null);
assert.deepEqual(ranked.map(o=>[o.vendorId,o.difference]),[["minores",0],["cityline",1],["mina",1.1]]);
const customRank=rankVendorOffers(ranked,{cityline:54.5,mina:57});
assert.deepEqual(customRank.map(o=>[o.vendorId,o.difference]),[["cityline",0],["minores",1.4],["mina",2.5]]);
const reranked=solveOrder([{catalogItemId:"cheese",quantity:1,options:quotes.map(o=>({...o,price:priceForOffer(o,agreement)}))}],[])[0];
assert.equal(reranked.assignedVendorId,"a","the agreed vendor becomes the winner when its price is lowest");
const chosen=solveOrder([{catalogItemId:"cheese",quantity:1,forcedVendorId:"b",options:quotes.map(o=>({...o,price:priceForOffer(o,agreement)}))}],[])[0];
assert.equal(chosen.assignedVendorId,"b","a deliberate replacement vendor stays selected");
console.log("KERDOS universal ordering-core tests passed");
