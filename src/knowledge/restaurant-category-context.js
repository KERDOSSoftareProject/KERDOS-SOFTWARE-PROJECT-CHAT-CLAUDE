// Restaurant-only product state cues. Keep industry vocabulary outside the
// procurement engine. A prepared form outweighs its raw ingredient category.
const PREPARED = new Set(["breaded", "battered", "fried", "fries", "fry", "parfried", "precooked", "cooked", "roasted", "grilled", "canned", "jarred", "marinated", "pickled"]);

export function restaurantCategoryContext(words, categories) {
  const usable=categories.filter(category=>!category.is_holding_pen);
  const choose=(names,reason)=>{
    const category=names.map(name=>usable.find(c=>name.test(c.name||""))).find(Boolean);
    return category?{category,confidence:"confident",reason}:null;
  };
  const has=(...terms)=>terms.some(term=>words.includes(term));
  // Product form takes precedence over an ingredient word. The fallback
  // names are the bundled Restaurant template; no categories are created.
  if(has("jam","jelly","jellies","preserves","marmalade"))
    return choose([/^(preserves|condiments|dry goods|grocery)$/i,/^general$/i],"Preserved spread, not fresh produce");
  if(has("wrap","wraps")&&has("wheat","white","spinach","tortilla","tortillas")&&!has("plastic","film","paper","foil"))
    return choose([/^(bakery|bread|breads|bread and bakery)$/i,/^general$/i],"Edible bread wrap");
  if(has("base","bouillon","stock")&&has("beef","chicken","clam","lobster","vegetable"))
    return choose([/^(dry goods|grocery|soup bases|pantry)$/i,/^general$/i],"Prepared soup base or stock");
  if(has("swiss","provolone","cheddar","mozzarella")&&!has("chard","dressing","sauce","bread","cracker","crackers","powder","sandwich","flavored"))
    return choose([/^dairy$/i,/^cheese$/i],"Recognized cheese variety");
  const produce = categories.find(c => String(c.name || "").toLowerCase() === "produce");
  const prepared = categories.find(c => /^(prepared foods|frozen foods|frozen prepared foods)$/i.test(c.name || ""));
  const general = categories.find(c => String(c.name || "").toLowerCase() === "general");
  // The legacy Restaurant template has Produce and General. Only activate
  // this profile with that vocabulary, never for an unrelated industry.
  if (!produce || (!prepared && !general)) return null;
  const produceTerms = new Set((Array.isArray(produce.keywords) ? produce.keywords : [])
    .flatMap(term => String(term).toLowerCase().split(/[^a-z]+/)).filter(Boolean));
  if (!words.some(w => produceTerms.has(w) || produceTerms.has(`${w}s`)) || !words.some(w => PREPARED.has(w))) return null;
  return {category:prepared || general, confidence:"guess", reason:"Prepared product form overrides raw produce ingredient; review placement"};
}
