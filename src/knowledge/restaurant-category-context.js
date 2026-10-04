// Restaurant-only product state cues. Keep industry vocabulary outside the
// procurement engine. A prepared form outweighs its raw ingredient category.
const PREPARED = new Set(["prepared", "breaded", "battered", "fried", "fries", "fry", "parfried", "precooked", "cooked", "roasted", "grilled", "canned", "jarred", "marinated", "pickled"]);

export function restaurantCategoryContext(words, categories) {
  const usable=categories.filter(category=>!category.is_holding_pen);
  const choose=(names,reason)=>{
    const category=names.map(name=>usable.find(c=>name.test(c.name||""))).find(Boolean);
    return category?{category,confidence:"confident",reason}:null;
  };
  const has=(...terms)=>terms.some(term=>words.includes(term));
  if(has("canned","jarred","marinated","pickled","preserved")||words.some(w=>PREPARED.has(w))) {
    const general=choose([/^general$/i],"Prepared or preserved product belongs in General");
    if(general)return general;
  }
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
  const produce=usable.find(c=>/^produce$/i.test(c.name||""));
  if(!produce)return null;
  const produceTerms=new Set((Array.isArray(produce.keywords)?produce.keywords:[])
    .flatMap(term=>String(term).toLowerCase().split(/[^a-z]+/)).filter(Boolean));
  const vegetables=["garlic","tomato","tomatoes","onion","potato","eggplant","artichoke","pepper","carrot","lettuce","broccoli","spinach"];
  const hasIngredient=words.some(w=>produceTerms.has(w)||produceTerms.has(`${w}s`)||vegetables.includes(w));
  if(!hasIngredient)return null;
  const chooseForm=(names,reason)=>choose(names,reason)||{excludedCategoryIds:[produce.id],reason};
  // Fresh Produce excludes preserved, dried, frozen and prepared forms.
  // Specific preparation words outweigh the raw ingredient's keyword.
  if(has("granulated","powder","powdered","dehydrated","dried","sundried","dry"))
    return chooseForm([/^(dry goods|grocery|pantry|spices|seasonings)$/i,/^general$/i],"Prepared product form: dried or powdered ingredient is not fresh produce");
  if(has("canned","jarred","marinated","pickled","preserved"))
    return chooseForm([/^(canned goods|canned|preserved foods|grocery|dry goods|pantry)$/i,/^general$/i],"Prepared product form: preserved ingredient is not fresh produce");
  if(has("frozen"))
    return chooseForm([/^(frozen foods|frozen|frozen prepared foods)$/i,/^general$/i],"Prepared product form: frozen ingredient is not fresh produce");
  if(words.some(w=>PREPARED.has(w))){
    const placement=chooseForm([/^(prepared foods|prepared|frozen prepared foods)$/i,/^general$/i],"Prepared product form: prepared ingredient is not fresh produce");
    return {...placement,confidence:"guess"};
  }
  return null;
}
