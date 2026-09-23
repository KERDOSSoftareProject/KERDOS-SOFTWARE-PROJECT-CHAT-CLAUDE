import {compareItems,itemMatchesSearch} from './catalog-browse.js';
const items=[
 {name:"Ham Deli",masterItemNumber:7002,createdAt:"2026-09-02",options:[{description:"BOARS HEAD HAM",vendorItemCode:"B12"}]},
 {name:"American Cheese",masterItemNumber:7001,createdAt:"2026-09-03",options:[{description:"LAND O LAKES AMER",vendorItemCode:"A9"}]},
 {name:"Bacon",masterItemNumber:null,createdAt:null,options:[{description:"SMITHFIELD BACON 15LB",vendorItemCode:"10"}]},
];
let ok=0,bad=0;const t=(n,c)=>{c?ok++:(bad++,console.log("FAIL",n));};
t("empty search matches",itemMatchesSearch(items[0],""));
t("name match",itemMatchesSearch(items[0],"ham"));
t("vendor wording match",itemMatchesSearch(items[1],"land o"));
t("vendor code exact",itemMatchesSearch(items[0],"b12"));
t("master number",itemMatchesSearch(items[1],"7001"));
t("no false match",!itemMatchesSearch(items[0],"cheese"));
const s=m=>[...items].sort((a,b)=>compareItems(a,b,m)).map(i=>i.name).join(",");
t("alpha",s("alpha")==="American Cheese,Bacon,Ham Deli");
t("itemNumber, missing sinks",s("itemNumber")==="American Cheese,Ham Deli,Bacon");
t("vendorCode numeric-aware",s("vendorCode")==="Bacon,American Cheese,Ham Deli");
t("added, missing sinks",s("added")==="Ham Deli,American Cheese,Bacon");
console.log(`${ok} passed, ${bad} failed`);
