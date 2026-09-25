import {restaurantCategoryContext} from "./restaurant-category-context.js";
import {restaurantQuoteContext} from "./restaurant-quote-context.js";

// Profiles supply industry-specific interpretation; procurement stays generic.
const profiles=new Map([["restaurant",restaurantCategoryContext]]);
let activeProfile=null;
let activeQuoteProfile=null;

export function configureCategoryProfile(industry){
  activeProfile=profiles.get(String(industry||"").trim().toLowerCase())||null;
  activeQuoteProfile=String(industry||"").trim().toLowerCase()==="restaurant"?restaurantQuoteContext:null;
}

export function categoryContext(words,categories){
  return activeProfile?.(words,categories)||null;
}

export function quoteContext(row,rows){
  return activeQuoteProfile?.(row,rows)||null;
}
