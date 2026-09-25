import {compareProductIdentity,comparePurchasingPack} from "../procurement.js";

// Invoices are evidence about a vendor listing, never a replacement quote.
// A code ties two documents to the same vendor listing, but conflicting
// descriptions or packs still require a person to resolve the difference.
export function invoiceEvidence(row,invoices=[]){
  const code=String(row.code||"").trim();
  const name=String(row.description||"").trim().toLowerCase();
  const matches=invoices.filter(entry=>code
    ?entry.row.code&&String(entry.row.code).trim()===code
    :!entry.row.code&&name&&String(entry.row.description||"").trim().toLowerCase()===name);
  if(!matches.length)return {matches:[],suggestions:{},conflicts:[]};
  const conflicts=[];
  const valid=matches.filter(entry=>{
    if(compareProductIdentity(row.description,entry.row.description).status==="same")return true;
    conflicts.push(`Invoice ${entry.number||entry.date||"record"} uses this vendor item number for a different product: ${entry.row.description}.`);
    return false;
  });
  const suggestions={};
  for(const field of ["packSize","brand","sellingUnit"]){
    const stated=valid.filter(entry=>String(entry.row[field]||"").trim());
    if(!stated.length)continue;
    const first=stated[0];
    const different=stated.some(entry=>field==="packSize"
      ?comparePurchasingPack(first.row.packSize,entry.row.packSize).status!=="same"
      :String(first.row[field]).trim().toLowerCase()!==String(entry.row[field]).trim().toLowerCase());
    if(different){conflicts.push(`Invoices disagree on ${field}; check the originals.`);continue;}
    const sheetValue=String(row[field]||"").trim();
    if(sheetValue){
      if(field==="packSize"?comparePurchasingPack(sheetValue,first.row.packSize).status!=="same":sheetValue.toLowerCase()!==String(first.row[field]).trim().toLowerCase())
        conflicts.push(`Price sheet ${field} (${sheetValue}) differs from invoice ${first.row[field]} (${first.number||first.date||"record"}).`);
    }else suggestions[field]={value:first.row[field],source:first.number||first.date||"invoice"};
  }
  return {matches:valid,suggestions,conflicts};
}
