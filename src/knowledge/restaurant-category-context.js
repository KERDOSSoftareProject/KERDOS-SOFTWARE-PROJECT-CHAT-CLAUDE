// Restaurant-only product state cues. Keep industry vocabulary outside the
// procurement engine. A prepared form outweighs its raw ingredient category.
const PREPARED = new Set(["breaded", "battered", "fried", "fries", "fry", "parfried", "precooked", "cooked", "roasted", "grilled", "canned", "jarred", "marinated", "pickled"]);

export function restaurantCategoryContext(words, categories) {
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
