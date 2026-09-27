import {restaurantCategoryContext} from "./restaurant-category-context.js";
import {restaurantQuoteContext} from "./restaurant-quote-context.js";
import {restaurantProductContext} from "./restaurant-product-context.js";
import {restaurantDictionaries,restaurantUnitVocabulary,RESTAURANT_DICTIONARY_VERSION} from "./restaurant-dictionaries.js";

// Profiles supply industry-specific interpretation; procurement stays generic.
const profiles=new Map([["restaurant",{
  category:restaurantCategoryContext,quote:restaurantQuoteContext,product:restaurantProductContext,
  dictionaries:restaurantDictionaries,vocabulary:restaurantUnitVocabulary,version:RESTAURANT_DICTIONARY_VERSION,
}]]);
let activeProfile=null;

export function configureCategoryProfile(industry){
  activeProfile=profiles.get(String(industry||"").trim().toLowerCase())||null;
}

export function categoryContext(words,categories){
  return activeProfile?.category?.(words,categories)||null;
}

export function quoteContext(row,rows){
  return activeProfile?.quote?.(row,rows)||null;
}

export function industryProductContext(text){
  return activeProfile?.product?.(text)||{text:String(text||""),attributes:{},evidence:[],unresolved:[]};
}

export function industryVocabulary(){return activeProfile?.vocabulary||[];}

// Explicit industry lookup also makes the bundled knowledge inspectable in Admin.
export function industryDictionary(industry){
  const profile=profiles.get(String(industry||"").trim().toLowerCase());
  return {version:profile?.version||null,groups:profile?.dictionaries||{}};
}
