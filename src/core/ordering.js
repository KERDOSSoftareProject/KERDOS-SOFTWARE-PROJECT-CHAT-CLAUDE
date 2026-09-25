// Industry-neutral ordering rules. UI and persistence adapters supply plain
// items/vendors; this module decides eligibility and allocation.
const money=value=>Math.round(Number(value)*100)/100;

export function orderable(option){
  return option.matchTrack==="exact"&&option.matchConfidence===100&&!!option.packSize&&
    !option.expired&&!option.brandMismatch&&!option.priceUnavailable&&!option.invoiceOnly&&!option.unverified&&
    !option.basisUnconvertible;
}

export function blockReason(option){
  if(option.expired)return "Quote expired — refresh needed";
  if(option.priceUnavailable)return "No current quoted price";
  if(option.invoiceOnly)return "Invoice charge only — quotation required";
  // A price quoted per pound, per gallon or per each can only join the
  // ranking once the pack tells KERDOS how many of that unit a case holds.
  if(option.basisUnconvertible)return `Quoted per ${option.quoteUnit||option.quoteBasis||"unit"} — pack can't convert it to a case price; correct the pack in Item Catalog`;
  if(option.unverified||option.matchTrack!=="exact"||option.matchConfidence!==100||!option.packSize)return "Product not mapped at 100% — review in Item Catalog";
  if(option.brandMismatch)return option.brand?`${option.brand} — not the locked brand`:"Brand not listed";
  return null;
}

// An agreed price belongs to one vendor and one purchasing unit. It
// participates in the ranking like a current quote; vendor choice is a
// separate explicit override.
export function priceForOffer(option,negotiation,unit="case"){
  const quoted=unit==="each"?option.eachPrice:option.casePrice;
  const agreed=negotiation?.vendorId===option.vendorId?negotiation.price:negotiation?.[option.vendorId];
  return Number.isFinite(agreed)&&agreed>0?agreed:quoted;
}

// The same ranking drives the menu, savings display and chosen vendor.
// Blocked quotations remain visible but never establish the best price.
export function rankVendorOffers(options,negotiations,unit="case"){
  const ranked=options.map(option=>({...option,unitPrice:priceForOffer(option,negotiations,unit)}))
    .sort((a,b)=>Number(!orderable(a))-Number(!orderable(b))||a.unitPrice-b.unitPrice);
  const best=ranked.find(orderable)?.unitPrice??null;
  return ranked.map(option=>({...option,difference:orderable(option)&&best!=null?money(option.unitPrice-best):null}));
}

export function solveOrder(cartItems,vendors){
  if(!cartItems.length)return [];
  let assignments=cartItems.map(item=>{
    const valid=item.options.filter(orderable),cheapest=[...valid].sort((a,b)=>a.price-b.price)[0]||null;
    if(!cheapest)return {...item,assignedVendorId:null,assignedVendorName:null,vendorItemId:null,price:0,packSize:null,orderUnit:item.orderUnit,lineTotal:0,cheapestPrice:0,premiumPaid:0,locked:false,unorderable:true};
    const forced=item.forcedVendorId?valid.find(option=>option.vendorId===item.forcedVendorId):null;
    if(item.forcedVendorId&&!forced)return {...item,assignedVendorId:null,assignedVendorName:null,vendorItemId:null,price:null,packSize:null,lineTotal:0,cheapestPrice:cheapest.price,premiumPaid:0,locked:true,unorderable:true};
    const best=forced||cheapest,effective=item.forcedPrice!=null?item.forcedPrice:best.price,lineTotal=money(effective*item.quantity);
    return {...item,assignedVendorId:best.vendorId,assignedVendorName:best.vendorName,vendorItemId:best.vendorItemId,price:effective,packSize:best.packSize,orderUnit:best.orderUnit,lineTotal,cheapestPrice:cheapest.price,premiumPaid:money(Math.max(0,lineTotal-cheapest.price*item.quantity)),locked:!!item.forcedVendorId||item.forcedPrice!=null,unorderable:false};
  });
  for(let iteration=0;iteration<vendors.length*4;iteration++){
    const totals=new Map();
    for(const assignment of assignments){const total=totals.get(assignment.assignedVendorId)||{dollar:0,units:0};total.dollar=money(total.dollar+assignment.lineTotal);total.units+=assignment.quantity;totals.set(assignment.assignedVendorId,total);}
    const short=vendors.filter(vendor=>{const total=totals.get(vendor.id);return total&&((vendor.delivery_minimum_dollar&&total.dollar<vendor.delivery_minimum_dollar)||(vendor.delivery_minimum_units&&total.units<vendor.delivery_minimum_units));});
    if(!short.length)break;
    let fixed=false;
    for(const required of short){
      const fills=assignments.filter(a=>a.assignedVendorId!==required.id&&!a.locked).map(assignment=>{const option=assignment.options.find(o=>o.vendorId===required.id&&orderable(o));return option?{assignment,option,premium:(option.price-assignment.price)*assignment.quantity,free:option.price<=assignment.price}:null;}).filter(Boolean).sort((a,b)=>(a.free?0:1)-(b.free?0:1)||a.premium-b.premium);
      const pathA=[...assignments];
      let dollars=assignments.filter(a=>a.assignedVendorId===required.id).reduce((sum,a)=>sum+a.lineTotal,0),units=assignments.filter(a=>a.assignedVendorId===required.id).reduce((sum,a)=>sum+a.quantity,0);
      for(const {assignment,option} of fills){const index=pathA.findIndex(candidate=>candidate.catalogItemId===assignment.catalogItemId);if(index===-1)continue;const lineTotal=money(option.price*assignment.quantity);pathA[index]={...assignment,assignedVendorId:required.id,assignedVendorName:required.name,vendorItemId:option.vendorItemId,price:option.price,packSize:option.packSize,lineTotal,premiumPaid:money(Math.max(0,lineTotal-assignment.cheapestPrice*assignment.quantity))};dollars=money(dollars+option.price*assignment.quantity);units+=assignment.quantity;if((!required.delivery_minimum_dollar||dollars>=required.delivery_minimum_dollar)&&(!required.delivery_minimum_units||units>=required.delivery_minimum_units))break;}
      const pathAItems=pathA.filter(a=>a.assignedVendorId===required.id),pathADollars=pathAItems.reduce((sum,a)=>sum+a.lineTotal,0),pathAUnits=pathAItems.reduce((sum,a)=>sum+a.quantity,0),pathAMeets=(!required.delivery_minimum_dollar||pathADollars>=required.delivery_minimum_dollar)&&(!required.delivery_minimum_units||pathAUnits>=required.delivery_minimum_units),pathASpend=pathA.reduce((sum,a)=>sum+a.lineTotal,0);
      const pathB=assignments.map(assignment=>{if(assignment.assignedVendorId!==required.id||assignment.locked)return assignment;const alternative=[...assignment.options].filter(o=>o.vendorId!==required.id&&orderable(o)).sort((a,b)=>a.price-b.price)[0];if(!alternative)return assignment;const lineTotal=money(alternative.price*assignment.quantity);return {...assignment,assignedVendorId:alternative.vendorId,assignedVendorName:alternative.vendorName,vendorItemId:alternative.vendorItemId,price:alternative.price,packSize:alternative.packSize,lineTotal,premiumPaid:money(Math.max(0,lineTotal-assignment.cheapestPrice*assignment.quantity))};}),pathBSpend=pathB.reduce((sum,a)=>sum+a.lineTotal,0);
      const chosen=pathAMeets&&pathASpend<=pathBSpend?pathA:pathB,newTotals=new Map();
      for(const assignment of chosen){const total=newTotals.get(assignment.assignedVendorId)||{dollar:0,units:0};total.dollar=money(total.dollar+assignment.lineTotal);total.units+=assignment.quantity;newTotals.set(assignment.assignedVendorId,total);}
      const total=newTotals.get(required.id);if(!total||((!required.delivery_minimum_dollar||total.dollar>=required.delivery_minimum_dollar)&&(!required.delivery_minimum_units||total.units>=required.delivery_minimum_units))){assignments=chosen;fixed=true;break;}
    }
    if(!fixed)break;
  }
  return assignments;
}
