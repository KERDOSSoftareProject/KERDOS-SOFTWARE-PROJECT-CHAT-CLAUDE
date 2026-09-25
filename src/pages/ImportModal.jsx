import {useEffect,useMemo,useState} from "react";
import {backend} from "../backend/index.js";
import {fileToText} from "../document-reader.js";
import {findDate,findInvoiceNumber,parseDocument} from "../ingestion.js";
import {bestInvoiceMatch,compareProductIdentity,comparePurchasingPack,MATCH_POLICY,packsEquivalent,parsePackSize,priceBasisFor,quotePriceOnBasis,brandsMatch} from "../procurement.js";
import {createCatalogService,engineVerifiable} from "../services/catalog.js";
import {createCategoryService} from "../services/categories.js";
import {createDocumentService} from "../services/documents.js";
import {createImportService} from "../services/imports.js";
import {formatMoney} from "../localization.js";
import {explainImportRow} from "../core/import-evidence.js";
import {rememberImportRow,importResolutions,unitChoices} from "../core/catalog-fields.js";
import {resolveQuoteBasis} from "../core/quote-basis.js";
import {invoiceEvidence} from "../core/invoice-evidence.js";
import {quoteContext} from "../knowledge/category-profiles.js";
import {btn,inp} from "../ui/styles.js";

const catalogService=createCatalogService(backend);
const categoryService=createCategoryService(backend);
const documents=createDocumentService(backend);
const importService=createImportService(backend);
const r2=value=>Math.round(value*100)/100;

export function PasteModal({vendors,orgId,orgSettings,catalogItems,categories,vocabulary=[],vendorItems=[],mappings=[],onClose,onDone,initialVendorId,initialMode}) {
  const [vendorId,setVendorId]=useState(initialVendorId||vendors[0]?.id||"");
  const mode=initialMode||"pricelist";
  const [pastedText,setPastedText]=useState("");
  const [fileGroups,setFileGroups]=useState([]); // [{id,file,name,text}] — one entry per dragged/selected file
  const [parsedGroups,setParsedGroups]=useState([]); // after Parse: fileGroups (+pasted text) each with rows/skipped attached
  const [step,setStep]=useState(1);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState(null);
  const [dragOver,setDragOver]=useState(false);
  const [fileBusy,setFileBusy]=useState(false);
  const [parsing,setParsing]=useState(false);
  const [parseError,setParseError]=useState("");
  const [acceptedIssues,setAcceptedIssues]=useState(new Set());
  const [saveReview,setSaveReview]=useState("");
  const [autoSaveStarted,setAutoSaveStarted]=useState(false);
  const [sortField,setSortField]=useState("itemNumber");
  const [sortDirection,setSortDirection]=useState(1);
  const [detailKey,setDetailKey]=useState(null);
  const [invoiceSources,setInvoiceSources]=useState([]);
  const [invoiceLoad,setInvoiceLoad]=useState("loading");
  const [acceptedInvoiceConflicts,setAcceptedInvoiceConflicts]=useState(new Set());
  const quotedUnits=unitChoices(vocabulary);

  useEffect(()=>{
    if(mode!=="pricelist"||!vendorId)return;
    let active=true;
    setInvoiceLoad("loading");setInvoiceSources([]);setAcceptedInvoiceConflicts(new Set());
    importService.invoiceSources(orgId,vendorId).then(invoices=>{
      if(!active)return;
      setInvoiceSources(invoices.flatMap(invoice=>parseDocument(invoice.raw_text||"").rows.map(row=>({
        row,number:invoice.invoice_number,date:invoice.invoice_date,
      }))));
      setInvoiceLoad("ready");
    }).catch(error=>{if(active)setInvoiceLoad(error.message||"Invoice lookup failed");});
    return ()=>{active=false;};
  },[mode,orgId,vendorId]);
  const invoiceClues=useMemo(()=>new Map(parsedGroups.flatMap(group=>group.rows.map((row,index)=>
    [`${group.id}:${index}`,invoiceEvidence(row,invoiceSources)]))),[parsedGroups,invoiceSources]);
  const invoiceConflicts=parsedGroups.flatMap(group=>group.rows.map((row,index)=>`${group.id}:${index}`))
    .filter(key=>invoiceClues.get(key)?.conflicts.length&&!acceptedInvoiceConflicts.has(key));

  async function handleDroppedFiles(files){
    const fileArr=Array.from(files||[]);
    if(!fileArr.length||fileBusy||parsing) return;
    setFileBusy(true);
    try{
      const newGroups=await Promise.all(fileArr.map(async file=>{
        const text=await fileToText(file);
        return {id:`${file.name}_${file.size}_${Date.now()}_${Math.random()}`,file,name:file.name,text};
      }));
      const combined=[...fileGroups,...newGroups];
      setFileGroups(combined);
      await parseSources(combined,pastedText);
    }catch(err){
      setParseError(`Could not read the file: ${err.message||String(err)}`);
    }
    setFileBusy(false);
  }

  function removeFileGroup(id){
    setFileGroups(prev=>prev.filter(g=>g.id!==id));
  }

  async function parseSources(files,text){
    // Every dropped/selected file is parsed on its own — never merged into
    // one blob of raw text — since two different vendor documents can use
    // completely different table structures. A pasted blob (if any) is
    // treated as one more independent document, the same way.
    setParseError("");setParsing(true);
    // Yield once so the progress message renders before a large document is read.
    await new Promise(resolve=>setTimeout(resolve,0));
    try{
      const docs=[...files];
      if(text.trim().length>0){
        docs.push({id:"pasted",file:null,name:"Pasted text",text});
      }
      const groups=[];
      for(const d of docs){
        try{
          const parsed=parseDocument(d.text);
          groups.push({...d,rows:parsed.rows,skipped:parsed.skipped,documentKind:parsed.documentKind,quoteValidUntil:parsed.quoteValidUntil,invoiceDate:findDate(d.text)||""});
        }catch(error){throw new Error(`${d.name}: ${error.message||String(error)}`);}
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(!groups.some(group=>group.rows.length)){
        setParseError(`No product rows could be read from ${docs.map(d=>d.name).join(", ")}. Check that the file contains item lines, or paste a sample of its text for review.`);
        return;
      }
      setParsedGroups(groups);
      setStep(2);
    }catch(error){setParseError(`Could not parse the document: ${error.message||String(error)}`);}
    finally{setParsing(false);}
  }

  function doParse(){void parseSources(fileGroups,pastedText);}

  const allRows=parsedGroups.flatMap(g=>g.rows.map(row=>({...row,_source:g.name})));
  const evidenceRows=parsedGroups.flatMap(g=>g.rows.map((row,index)=>({row,group:g,index,key:`${g.id}:${index}`,
    evidence:explainImportRow(row,{vendor:vendors.find(v=>v.id===vendorId),categories,catalogItems,vendorItems,mappings,documentRows:g.rows})})))
    .sort((a,b)=>{
      const av=a.evidence[sortField]?.value,bv=b.evidence[sortField]?.value;
      if(av==null&&bv==null)return a.index-b.index;
      if(av==null)return 1;if(bv==null)return -1;
      return sortDirection*(typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true}));
    });
  const allSkipped=parsedGroups.flatMap(g=>g.skipped.map(s=>({...s,_source:g.name})));
  const allIncomplete=allRows.filter(r=>r.priceUnavailable);
  const showSourceTags=parsedGroups.length>1;
  const unsafeDocuments=parsedGroups.filter(g=>g.documentKind==="mixed"||(g.documentKind!=="unknown"&&g.documentKind!==mode));
  const missingInvoiceDates=mode==="invoice"?parsedGroups.filter(g=>g.rows.length&&!/^\d{4}-\d{2}-\d{2}$/.test(g.invoiceDate||"")):[];
  const needsReview=parsedGroups.flatMap(g=>g.rows.map((row,index)=>({groupId:g.id,index,row})))
    .filter(x=>x.row.issues?.length&&!acceptedIssues.has(`${x.groupId}:${x.index}`));
  const missingPriceBasis=mode==="pricelist"?evidenceRows.filter(entry=>!entry.row.priceUnavailable&&(!entry.evidence.priceBasis.value||entry.evidence.conflicts?.length)):[];
  function updateParsedRow(groupId,index,patch){
    // Editing an ambiguous row invalidates a prior approval of its old value.
    setAcceptedIssues(prev=>{const next=new Set(prev);next.delete(`${groupId}:${index}`);return next;});
    setAcceptedInvoiceConflicts(prev=>{const next=new Set(prev);next.delete(`${groupId}:${index}`);return next;});
    setParsedGroups(groups=>groups.map(g=>g.id!==groupId?g:{...g,rows:g.rows.map((r,i)=>i===index?{...r,...patch,originalFields:r.originalFields||{description:r.description,brand:r.brand,packSize:r.packSize,sellingUnit:r.sellingUnit},manualFields:[...new Set([...(r.manualFields||[]),...Object.keys(patch)])]}:r)}));
  }
  function approveIssue(groupId,index){setAcceptedIssues(prev=>new Set([...prev,`${groupId}:${index}`]));}

  async function doSave(){
    if(mode==="pricelist"&&invoiceLoad==="loading"){setSaveReview("Checking existing invoices. Try again in a moment.");return;}
    if(mode==="pricelist"&&invoiceConflicts.length){setSaveReview(`${invoiceConflicts.length} price-sheet row(s) disagree with invoices. Open Details and review each difference before saving.`);return;}
    if(missingInvoiceDates.length){setSaveReview("Confirm the invoice date for each document before recording invoice charges.");return;}
    if(unsafeDocuments.length){setSaveReview("This file identifies itself as an invoice and/or a price update inconsistent with the selected import mode. Split mixed documents, or select the correct mode before saving.");return;}
    if(mode==="invoice"&&needsReview.length){setSaveReview(`${needsReview.length} ambiguous row(s) still need a deliberate correction or approval. No unreviewed amount will change a current vendor quote.`);return;}
    setSaveReview("");setLoading(true);
    const vendor=vendors.find(v=>v.id===vendorId);
    let updated=0,created=0,invoiceTotal=0,invoicesCreated=0,mapped=0,packsFilled=0,basisReview=0;
    const identified=[];
    let saveError=null;

    if(mode==="pricelist"){
      const workingCatalogItems=[...catalogItems];
      const workingCategories=[...categories];
      const workingVendorItems=[...vendorItems];
      const workingMappings=[...mappings];
      const importBatchTime=new Date().toISOString();
      async function applySelectedCategory(catalogItemId,categoryId){
        if(!categoryId)return;
        const current=workingCatalogItems.find(ci=>ci.id===catalogItemId);
        if(!current||current.category_id===categoryId)return;
        const number=await categoryService.assignItem({catalogItemId:current.id,categoryId,catalogItems:workingCatalogItems,categories:workingCategories});
        const index=workingCatalogItems.indexOf(current);
        workingCatalogItems[index]={...current,category_id:categoryId,master_item_number:number};
      }

      let failedRows=0;
      for(const group of parsedGroups){
        if(!group.rows.length)continue;
        let sourceFilePath=null;
        // Stable SHA-256 of the original extracted text: re-importing the
        // same vendor quotation cannot silently append duplicate history.
        const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(group.text));
        const fingerprint=Array.from(new Uint8Array(digest)).map(n=>n.toString(16).padStart(2,"0")).join("");
        let existingDoc;
        try{existingDoc=await importService.findPriceDocument({organizationId:orgId,vendorId,fingerprint});}
        catch(err){failedRows+=group.rows.length;saveError=(saveError?saveError+" ":"")+`${group.name}: ${err.message}`;continue;}
        if(existingDoc){saveError=(saveError?saveError+" ":"")+`${group.name}: previously imported (${existingDoc.status}); repeated upload blocked to avoid duplicate pricing. Review existing import before retrying.`;continue;}
        if(group.file){
          const uploaded=await documents.uploadOriginal(orgId,vendorId,group.file);
          if(uploaded.error){failedRows+=group.rows.length;saveError=(saveError?saveError+" ":"")+`Could not preserve the original ${group.name}: ${uploaded.error.message}. Prices from that file were not applied.`;continue;}
          sourceFilePath=uploaded.path;
        }
        let storedDoc;
        try{storedDoc=await importService.createPriceDocument({organization_id:orgId,vendor_id:vendorId,document_kind:"pricelist",fingerprint,original_text:group.text,file_name:group.name,file_path:sourceFilePath,status:"processing"});}
        catch(err){failedRows+=group.rows.length;saveError=(saveError?saveError+" ":"")+`${group.name}: ${err.message}`;continue;}
        const sourceDocumentId=storedDoc.id;
        const failuresBeforeGroup=failedRows;
        const basisBeforeGroup=basisReview;
      for(const sourceRow of group.rows){
        let row=sourceRow;
        const rowNeedsReview=!!sourceRow.issues?.length&&!acceptedIssues.has(`${group.id}:${group.rows.indexOf(sourceRow)}`);
        try{
        if(!rowNeedsReview&&!row.priceUnavailable&&(!Number.isFinite(Number(row.price))||Number(row.price)<=0)) throw new Error("No confirmed positive unit price");
        let ex=await importService.findVendorItem({organizationId:orgId,vendorId,code:row.code,description:row.description});
        if(!ex&&!row.code){
          const candidates=await importService.vendorItems(orgId,vendorId);
          const established=candidates.filter(vi=>compareProductIdentity(row.description,vi.description).status==="same" &&
            row.packSize&&vi.pack_size&&packsEquivalent(row.packSize,vi.pack_size));
          if(established.length===1) ex=established[0];
          else if(established.length>1) throw new Error("Multiple existing vendor products have this identity. Verify the vendor item code before updating a quote.");
        }
        const priorMapping=ex?await importService.mapping(orgId,ex.id):null;
        row=rememberImportRow(row,ex,priorMapping);
        let vendorItemId;
        if(ex&&!row.knownVendorItem){
          const identity=compareProductIdentity(row.description,ex.description);
          if(identity.status!=="same") throw new Error(`Vendor item code or description points to an unverified product (${identity.reason}). Existing price and mapping were preserved.`);
          if(row.brand&&ex.brand&&!brandsMatch(row.brand,ex.brand))
            throw new Error(`Vendor brand changed from ${ex.brand} to ${row.brand}; the established association and price were preserved for review.`);
          if(!row.packSize||!ex.pack_size||!packsEquivalent(row.packSize,ex.pack_size))
            throw new Error("The pack size is missing or changed for this vendor item; verify the package and purchasing price before updating the quote.");
        }
        // The provider persists current quote and history in one transaction.
        // It is impossible to update one and lose the other midway through.
        // Preserve an item even when the sheet omits the price unit. Its
        // quoted number remains in the source and on the vendor listing,
        // but is unavailable for ordering until the basis is resolved.
        const resolved=resolveQuoteBasis(row,ex);
        const needsBasis=rowNeedsReview||(!row.priceUnavailable&&(!resolved||row.priceNeedsReview));
        const basis=resolved?.basis||null;
        // An unresolvable incoming price must not retire a previously
        // confirmed quote. Its original value stays in the source file.
        vendorItemId=needsBasis&&ex?ex.id:await backend.pricing.applyQuote({
          vendorItemId:ex?.id||null,organizationId:orgId,vendorId,
          vendorItemCode:row.code,description:row.description,
          sellingUnit:resolved?.sellingUnit||null,priceBasis:basis?.basis||null,
          gtin:row.gtin||null,manufacturerCode:row.manufacturerCode||null,
          packSize:row.packSize||ex?.pack_size||null,price:row.price,
          priceUnavailable:!!row.priceUnavailable||needsBasis,effectiveDate:importBatchTime,
          quoteValidUntil:group.quoteValidUntil,sourceFilePath,
          sourceFileName:group.name,sourceLine:row.sourceLine||null,sourceDocumentId,
          importRow:{row:sourceRow,baseline:ex?.import_row?.baseline||ex?.import_row?.row||{...sourceRow,...sourceRow.originalFields},sourceDocumentId,sourceFileName:group.name,reviewRequired:rowNeedsReview,conflicts:rowNeedsReview?sourceRow.issues:[],changes:row.changes||[]},
          fieldResolutions:importResolutions(sourceRow,ex||{}),
        });
        if(needsBasis&&ex){
          const {error}=await backend.records.query("vendor_items").update({import_row:{row:sourceRow,baseline:ex.import_row?.baseline||ex.import_row?.row||{description:ex.description,brand:ex.brand,packSize:ex.pack_size,sellingUnit:ex.selling_unit,gtin:ex.gtin,manufacturerCode:ex.manufacturer_code},sourceDocumentId,sourceFileName:group.name,reviewRequired:true,changes:row.changes||[],conflicts:rowNeedsReview?sourceRow.issues:row.conflicts?.length?row.conflicts:["Incoming quoted unit is unresolved"]}}).eq("id",ex.id).eq("organization_id",orgId);
          if(error)throw new Error(`Could not save the incoming quote for review: ${error.message}`);
        }
        if(row.brand){
          const {error:brandError}=await backend.records.query("vendor_items").update({brand:row.brand}).eq("id",vendorItemId).eq("organization_id",orgId);
          if(brandError)throw new Error(`The quoted price was saved but its brand could not be recorded: ${brandError.message}. Review this row before linking it.`);
        }
        if(ex&&!needsBasis) updated++; else if(!ex) created++;
        if(needsBasis)basisReview++;

        // Whether this vendor item is brand new or was just updated, it
        // must be linked to a catalog item: an unlinked price is invisible
        // to ordering and to cross-vendor comparison.
        if(vendorItemId){
          const existingMapping=priorMapping||await importService.mapping(orgId,vendorItemId);
          if(!existingMapping){
            const match=await catalogService.matchOrCreate({organizationId:orgId,vendorId,description:row.description,packSize:row.packSize||ex?.pack_size,brand:row.brand||ex?.brand,gtin:row.gtin||ex?.gtin||null,manufacturerCode:row.manufacturerCode||ex?.manufacturer_code||null,categoryId:row.categoryId||null,catalogItems:workingCatalogItems,categories:workingCategories,vendorItems:workingVendorItems,mappings:workingMappings});
            if(match){
              const savedMapping=await importService.createMapping({
                organization_id:orgId, catalog_item_id:match.catalogItemId, vendor_item_id:vendorItemId,
                confidence_score:Math.round((match.score??0)*100),
                match_method:"rule_based", comparison_track:match.track,
              });
              mapped++;
              workingVendorItems.push({id:vendorItemId,vendor_id:vendorId,description:row.description,pack_size:row.packSize||ex?.pack_size||null,brand:row.brand||ex?.brand||null,gtin:row.gtin||ex?.gtin||null,manufacturer_code:row.manufacturerCode||ex?.manufacturer_code||null});
              workingMappings.push({id:savedMapping.id,catalog_item_id:match.catalogItemId,vendor_item_id:vendorItemId,comparison_track:match.track,confidence_score:Math.round((match.score??0)*100)});
              await applySelectedCategory(match.catalogItemId,row.categoryId);
              // A second vendor can prove the first listing's identity and
              // pack. Promote only mappings passing the same verification as
              // the Item Catalog's engine-review button.
              if(match.track==="exact"){
                const verified=engineVerifiable({mappings:workingMappings,vendorItems:workingVendorItems,catalogItems:workingCatalogItems})
                  .filter(entry=>entry.catalogItemId===match.catalogItemId);
                if(verified.length){
                  try{
                    await catalogService.confirmMappings(verified);
                    const ids=new Set(verified.map(entry=>entry.mappingId));
                    for(const mapping of workingMappings)if(ids.has(mapping.id)){mapping.comparison_track="exact";mapping.confidence_score=100;}
                  }catch(err){
                    // The quote and mapping have already been saved. Keep the
                    // import successful and leave verification available in
                    // Item Catalog rather than reporting a retryable row.
                    saveError=(saveError?saveError+" ":"")+`${row.description}: saved, but automatic verification could not finish (${err.message||String(err)}). Review the mapping in Item Catalog.`;
                  }
                }
              }
              identified.push({description:row.description,packSize:row.packSize||ex?.pack_size||null,price:row.price,track:match.track,confidence:match.score==null?null:Math.round(match.score*100),reason:match.reason||null});
            }
          }else if(row.categoryId){
            // An explicit category correction moves the established catalog
            // item and all its vendor rows, without changing their mapping.
            await applySelectedCategory(existingMapping.catalog_item_id,row.categoryId);
          }
        }
        }catch(err){
          // Report the first failure verbatim and count the rest; a row
          // that failed is never counted as updated or created.
          failedRows++;
          if(!saveError) saveError=`"${row.description}" — ${err.message||String(err)}`;
        }
      }
        const finalStatus=failedRows===failuresBeforeGroup&&basisReview===basisBeforeGroup?"complete":"partial";
        try{await importService.finalizeDocument(sourceDocumentId,finalStatus);}
        catch(err){saveError=(saveError?saveError+" ":"")+`${group.name}: ${err.message}`;}
      }
      if(failedRows>1) saveError+=` (and ${failedRows-1} more row${failedRows===2?"":"s"} failed the same way)`;
    } else {
      // Invoice mode: each source document is its own invoice — a dropped
      // batch of 3 invoice PDFs must become 3 separate invoice records,
      // each with its own original file and its own line items, never
      // merged into one.
      //
      // Fetch this vendor's full item list ONCE, reused for both exact and
      // fuzzy matching across every line of every invoice in this batch —
      // avoids a database round-trip per line, and gives the fuzzy fallback
      // below a full candidate pool to compare against.
      const viList=await importService.vendorItems(orgId,vendorId);
      // Same working-copy pattern as price-sheet import, so an item that
      // genuinely matches nothing on file still ends up in the catalog
      // and orderable, instead of vanishing into a permanent "no match".
      const workingCatalogItems=[...catalogItems];
      const workingCategories=[...categories];

      for(const group of parsedGroups){
        if(!group.rows.length) continue;
        const invoiceIdentified=[];
        const groupTotal=group.rows.reduce((s,row)=>s+(row.amount!=null?row.amount:row.price),0);
        const invoiceNo=findInvoiceNumber(group.text);
        let duplicate;
        try{duplicate=await importService.duplicateInvoice({organizationId:orgId,vendorId,invoiceNumber:invoiceNo,rawText:group.text});}
        catch(err){saveError=(saveError?saveError+" ":"")+err.message;continue;}
        if(duplicate){saveError=(saveError?saveError+" ":"")+`Invoice ${invoiceNo||group.name} is already recorded; duplicate skipped.`;continue;}

        let filePath=null, fileName=null;
        if(group.file){
          const upload=await documents.uploadOriginal(orgId,vendorId,group.file);
          if(upload.error){
            saveError=(saveError?saveError+" ":"")+`"${group.name}": data was extracted, but the original file couldn't be saved: `+upload.error.message;
          } else {
            filePath=upload.path;
            fileName=upload.name;
          }
        }

        const linesToInsert=[];
        for(const row of group.rows){
          // Price verification: look up what this item was actually quoted
          // at (its current vendor price) and compare to what was actually
          // paid on this invoice. A real mismatch here is exactly the kind
          // of thing worth catching — paying more than what was quoted.
          //
          // Matching order: exact item code, then exact description, then
          // — only when neither of those hits — a size-aware fuzzy
          // fallback against this vendor's item descriptions (see
          // bestInvoiceMatch above). That fallback matters most for
          // vendors with no item codes at all (their invoices and price
          // sheets are often separately-typed documents that word the
          // same product slightly differently), where exact matching
          // alone silently loses price verification.
          //
          // Every line gets a real confidence percentage and method
          // recorded — not just matched-or-not — so anything auto-matched
          // at less than full confidence, or not matched at all, can be
          // flagged and studied in Records rather than silently blending in.
          let matched=null, confidence=null, method=null,codeConflict=false,pendingCatalog=null;
          if(row.code){
            const byCode=viList.filter(vi=>vi.vendor_item_code===row.code);
            if(byCode.length>1){codeConflict=true;method="ambiguous_code";}
            matched=byCode.length===1?byCode[0]:null;
            const sameProduct=!!matched&&compareProductIdentity(row.description,matched.description).status==="same";
            // The vendor's own invoice, under the vendor's own item code,
            // states the pack that its price sheet left out. Filling it
            // here records the pack only; it never confirms a mapping.
            if(sameProduct&&!matched.pack_size&&row.packSize&&parsePackSize(row.packSize)?.parsed){
              const {error:packError}=await backend.records.query("vendor_items").update({pack_size:row.packSize}).eq("id",matched.id).eq("organization_id",orgId);
              if(!packError){matched.pack_size=row.packSize;packsFilled++;}
            }
            if(sameProduct&&comparePurchasingPack(row.packSize,matched.pack_size).status==="same"){
              confidence=100; method="code";
            }else if(matched){matched=null;codeConflict=true;method="identity_conflict";}
          }
          if(!matched&&!codeConflict&&row.description){
            const byDescription=viList.filter(vi=>vi.description===row.description&&comparePurchasingPack(row.packSize,vi.pack_size).status==="same");
            if(byDescription.length>1){codeConflict=true;method="ambiguous_description";}
            matched=byDescription.length===1?byDescription[0]:null;
            if(matched&&comparePurchasingPack(row.packSize,matched.pack_size).status==="same"){ confidence=100; method="exact_description"; }
            else matched=null;
          }
          if(!matched&&!codeConflict&&row.description&&viList.length){
            const fuzzy=bestInvoiceMatch(row.description,viList.filter(vi=>comparePurchasingPack(row.packSize,vi.pack_size).status==="same"),MATCH_POLICY.autoLink);
            if(fuzzy){ matched=fuzzy.vendorItem; confidence=Math.round(fuzzy.score*100); method="fuzzy"; }
          }
          // Nothing matched at all - rather than leave this line
          // permanently unmatched (no price ever tracked, never appears
          // in the order guide), create a vendor item from the invoice
          // itself. Clearly flagged price_source:"invoice" so it's never
          // confused with a real price-sheet-quoted price - an actual
          // vendor quote always takes over the moment one comes in,
          // since a later price-sheet import matches on description the
          // same way it always has. Erring toward "create a new entry"
          // rather than force a shaky match is the safer failure mode:
          // a duplicate is visible and fixable, a wrong price match is
          // silently misleading.
          if(!matched&&!codeConflict&&row.description){
            try{
              pendingCatalog=await catalogService.matchOrCreate({organizationId:orgId,vendorId,description:row.description,packSize:row.packSize,catalogItems:workingCatalogItems,categories:workingCategories,vendorItems,mappings});
              method="created_from_invoice"; confidence=null;
              invoiceIdentified.push({description:row.description,packSize:row.packSize||null,price:row.price,track:pendingCatalog.track,confidence:pendingCatalog.score==null?null:Math.round(pendingCatalog.score*100),reason:pendingCatalog.reason||null,invoice:true});
            }catch(err){
              method="unmatched";
              saveError=(saveError?saveError+" ":"")+`"${row.description}": ${err.message||String(err)}`;
            }
          }
          if(codeConflict)saveError=(saveError?saveError+" ":"")+`Invoice line ${row.description}: ${method?.startsWith("ambiguous")?"multiple vendor products could match":"item code conflicts with the previously identified product"}; the original invoice line was recorded without a product link.`;
          let quotedPrice=null,quote=null;
          if(matched?.id&&method!=="created_from_invoice"){
            const invoiceDate=group.invoiceDate;
            try{quote=await importService.historicalQuote({organizationId:orgId,vendorItemId:matched.id,invoiceDate});}
            catch(err){saveError=(saveError?saveError+" ":"")+`${row.description}: ${err.message}`;}
            const withinVendorTerm=!quote?.quote_valid_until||quote.quote_valid_until>=invoiceDate;
            const refreshDays=Number(orgSettings?.price_refresh_days);
            const mode=orgSettings?.price_refresh_mode==="automatic"?"automatic":"manual";
            const withinClientWindow=mode!=="automatic"||!refreshDays||
              ((new Date(`${invoiceDate}T12:00:00Z`)-new Date(quote?.effective_date||0))/86400000)<=refreshDays;
            if(quote&&withinVendorTerm&&withinClientWindow&&["price_list","manual_edit"].includes(quote.source))quotedPrice=Number(quote.price);
          }
          // Compare the quote on the basis the invoice bills in. A quote
          // that cannot be expressed on that basis produces no variance
          // rather than a false overcharge or undercharge.
          let comparableQuote=null;
          const billedBasis=priceBasisFor(row.sellingUnit);
          if(quotedPrice!=null&&String(row.sellingUnit||"").trim()&&!billedBasis)
            saveError=(saveError?saveError+" ":"")+`${row.description}: invoice selling unit "${row.sellingUnit}" is unknown; no variance calculated.`;
          if(quotedPrice!=null&&(!String(row.sellingUnit||"").trim()||billedBasis)){
            comparableQuote=quotePriceOnBasis(
              {price:quotedPrice,basis:quote?.price_basis||null,unit:quote?.price_basis==="measure"?quote?.selling_unit:null,packSize:matched?.pack_size||row.packSize||null},
              billedBasis||{basis:"case"});
            if(comparableQuote==null)saveError=(saveError?saveError+" ":"")+`${row.description}: billed per ${row.sellingUnit||"unit"} but the quote could not be expressed that way; no variance recorded.`;
          }
          const variance=comparableQuote!=null?r2(row.price-comparableQuote):null;
          linesToInsert.push({
            vendor_item_id:matched?.id||null, vendor_item_code:row.code, description:row.description,
            unit_price:row.price, line_total:(row.amount!=null?row.amount:row.price),
            price_variance:variance, match_confidence:confidence, match_method:method,
            create_vendor_item:!matched&&!codeConflict&&method==="created_from_invoice",
            pack_size:row.packSize||null,catalog_item_id:pendingCatalog?.catalogItemId||null,
            catalog_confidence:pendingCatalog?Math.round((pendingCatalog.score??0)*100):null,
            catalog_track:pendingCatalog?.track||null,
          });
        }
        try{
          await backend.invoices.record({
            organization_id:orgId,vendor_id:vendorId,total_amount:r2(groupTotal),
            raw_text:group.text,invoice_date:group.invoiceDate,invoice_number:invoiceNo,
            file_path:filePath,file_name:fileName,
          },linesToInsert);
          invoicesCreated++;
          invoiceTotal+=groupTotal;
          identified.push(...invoiceIdentified);
        }catch(error){
          if(filePath){try{await documents.remove([filePath]);}catch{}}
          saveError=(saveError?saveError+" ":"")+`"${group.name}" couldn't be recorded: ${error.message||String(error)}`;
        }
      }
    }

    setResult({mode,vendor:vendor?.name,updated,created,mapped,basisReview,invoiceTotal:r2(invoiceTotal),invoicesCreated,count:allRows.length,error:saveError,identified,packsFilled});
    await onDone();
    setStep(3);setLoading(false);
  }

  // Invoice recording retains its existing flow. A price sheet always shows
  // field evidence before changing current quotes or catalog mappings.
  useEffect(()=>{
    if(mode!=="invoice"||step!==2||autoSaveStarted||loading||!allRows.length) return;
    if(unsafeDocuments.length||missingInvoiceDates.length||needsReview.length) return;
    setAutoSaveStarted(true);
    doSave();
  },[mode,step,autoSaveStarted,loading,allRows.length,unsafeDocuments.length,missingInvoiceDates.length,needsReview.length]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:mode==="pricelist"&&step===2?1450:600,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h3 style={{margin:0,fontSize:16}}>{mode==="pricelist"?"📋 Import Price Sheet":"🧾 Record Invoice"}</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,cursor:"pointer",color:"#888"}}>×</button>
        </div>

        {step===1&&<>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#666",marginBottom:4}}>Vendor</div>
            <select style={inp} value={vendorId} onChange={e=>setVendorId(e.target.value)}>
              {vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#666",marginBottom:4}}>Drag in one or more {mode==="pricelist"?"price list":"invoice"} files</div>
            <div
              onDragOver={e=>{e.preventDefault();setDragOver(true);}}
              onDragLeave={()=>setDragOver(false)}
              onDrop={e=>{e.preventDefault();setDragOver(false);handleDroppedFiles(e.dataTransfer.files);}}
              style={{position:"relative",border:dragOver?"2px dashed #003584":"2px dashed #DDD",borderRadius:8,padding:16,textAlign:"center",background:dragOver?"#F0F6FF":"#FAFAFA"}}
            >
              <div style={{fontSize:13,color:"#888",marginBottom:8}}>Drop files here — any number at once</div>
              <input type="file" multiple accept=".csv,.txt,.tsv,.xlsx,.xls,.pdf,.eml,.html,.htm"
                onChange={e=>{handleDroppedFiles(e.target.files);e.target.value="";}}
                style={{fontSize:12}} />
              {(fileBusy||parsing)&&<div style={{position:"absolute",inset:0,background:"rgba(255,255,255,0.85)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#003584",fontWeight:700,borderRadius:8}}>{parsing?"Reading item rows…":"Reading file…"}</div>}
            </div>
            {fileGroups.length>0&&(
              <div style={{marginTop:8}}>
                {fileGroups.map(g=>(
                  <div key={g.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:"#555",padding:"6px 10px",background:"#F5F5F5",borderRadius:6,marginBottom:4}}>
                    <span>📎 {g.name} {mode==="invoice"?"— becomes its own invoice":""}</span>
                    <button onClick={()=>removeFileGroup(g.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#E65100",fontSize:14,padding:0}}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#666",marginBottom:4}}>Or paste text directly</div>
            <textarea
              style={{...inp,height:120,resize:"vertical",fontFamily:"monospace",fontSize:12}}
              value={pastedText} onChange={e=>setPastedText(e.target.value)}
              onPaste={e=>{const pasted=e.clipboardData.getData("text");if(pasted.trim().length>=10){e.preventDefault();setPastedText(pasted);void parseSources(fileGroups,pasted);}}}
              placeholder="Copy from Excel, email, PDF — paste here..." />
          </div>
          {parseError&&<div role="alert" style={{background:"#FFEBEE",color:"#B71C1C",padding:10,marginBottom:9,fontSize:12}}>{parseError}</div>}
          {pastedText.trim().length>=10&&<button onClick={doParse} disabled={fileBusy||parsing} style={{...btn("#003584"),width:"100%"}}>{parsing?"Reading item rows…":"Review pasted text"}</button>}
        </>}

        {step===2&&<>
          <div style={{background:"#E8F5E9",padding:"10px 14px",borderRadius:8,marginBottom:14,fontSize:13}}>
            Found {allRows.length} items across {parsedGroups.length} document{parsedGroups.length===1?"":"s"} — review and confirm
          </div>
          {mode==="invoice"&&parsedGroups.map(g=><label key={g.id} style={{display:"block",fontSize:12,marginBottom:7}}>
            Invoice date for {g.name}: <input type="date" value={g.invoiceDate||""} onChange={e=>setParsedGroups(groups=>groups.map(x=>x.id===g.id?{...x,invoiceDate:e.target.value}:x))} />
            {!g.invoiceDate&&<span style={{color:"#B26A00"}}> Required</span>}
          </label>)}
          {unsafeDocuments.length>0&&<div style={{background:"#FFEBEE",color:"#B71C1C",padding:10,marginBottom:10,fontSize:12}}>Document type mismatch or mixed invoice and price update: {unsafeDocuments.map(g=>g.name).join(", ")}. Separate the sections, or switch the import type. Nothing from these documents will be saved until resolved.</div>}
          {mode==="pricelist"&&<div style={{background:invoiceLoad==="ready"?"#E8F5E9":"#FFF3E0",padding:9,marginBottom:8,fontSize:12}}>{invoiceLoad==="ready"?`${invoiceSources.length} invoice line(s) available for cross-reference. Invoice amounts do not replace quoted prices.`:invoiceLoad==="loading"?"Checking this vendor's invoices before applying the price sheet…":`Invoice cross-reference unavailable: ${invoiceLoad}. Check invoice history before relying on this import.`}</div>}
          {mode==="pricelist"&&<div style={{overflowX:"auto",marginBottom:12}}>
            <table style={{borderCollapse:"collapse",width:"100%",minWidth:850,fontSize:11}}><thead><tr>
              {[["itemNumber","KERDOS item #"],["vendor","Vendor"],["category","Category"],["product","Product"],["brand","Brand"],["pack","Pack"],["price","Quoted price"],["sellingUnit","Quoted per"],["unitCost","Unit cost"]].map(([key,label])=><th key={key} style={{textAlign:"left",padding:6,borderBottom:"1px solid #ccd"}}><button onClick={()=>{setSortDirection(sortField===key?-sortDirection:1);setSortField(key);}} style={{background:"none",border:0,cursor:"pointer",fontWeight:700}}>{label} {sortField===key?(sortDirection===1?"↑":"↓"):""}</button></th>)}
              <th>Details</th></tr></thead><tbody>{evidenceRows.map(({evidence,key,row,group,index})=><tr key={key}>{["itemNumber","vendor","category","product","brand","pack","price","sellingUnit","unitCost"].map(name=>{
                const f=evidence[name];return <td key={name} title={f.reason} style={{padding:6,borderBottom:"1px solid #eee",whiteSpace:"nowrap"}}>{name==="category"?<select aria-label={`Category for ${row.description}`} value={row.categoryId||""} onChange={e=>updateParsedRow(group.id,index,{categoryId:e.target.value||null})} style={{...inp,fontSize:11,minWidth:115,padding:4}}><option value="">{f.value||"Uncategorized"}{f.accuracy===75?" (suggested)":""}</option>{categories.filter(c=>!c.is_holding_pen).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:name==="price"?<input aria-label={`Quoted price for ${row.description}`} type="number" min="0" step="any" value={row.priceUnavailable?"":row.price??""} onChange={e=>updateParsedRow(group.id,index,{price:e.target.value===""?null:Number(e.target.value),priceUnavailable:e.target.value==="",priceEdited:true})} style={{...inp,fontSize:11,width:86,padding:4}} />:name==="product"?<input aria-label={`Product for ${row.code||row.description}`} disabled={evidence.knownItem} value={evidence.knownItem?evidence.product.value:row.description||""} onChange={e=>updateParsedRow(group.id,index,{description:e.target.value})} style={{...inp,fontSize:11,width:210,padding:4}} />:name==="brand"?<input aria-label={`Brand for ${row.description}`} disabled={evidence.knownItem} value={evidence.knownItem?evidence.brand.value||"":row.brand||""} placeholder="Blank if absent" onChange={e=>updateParsedRow(group.id,index,{brand:e.target.value})} style={{...inp,fontSize:11,width:110,padding:4}} />:name==="pack"?<input aria-label={`Pack for ${row.description}`} disabled={evidence.knownItem} value={evidence.knownItem?evidence.pack.value||"":row.packSize||""} placeholder="e.g. 4/10 LB" onChange={e=>updateParsedRow(group.id,index,{packSize:e.target.value})} style={{...inp,fontSize:11,width:105,padding:4}} />:name==="sellingUnit"?<><select aria-label={`Quoted price per unit for ${row.description}`} disabled={evidence.knownItem&&!!f.value} value={evidence.knownItem?f.value||"":row.sellingUnit||""} onChange={e=>updateParsedRow(group.id,index,{sellingUnit:e.target.value,sellingUnitSource:"manual"})} style={{...inp,fontSize:11,width:105,padding:4}}><option value="">{f.value?`Likely ${f.value}`:"Select unit"}</option>{quotedUnits.map(unit=><option key={unit.value} value={unit.value}>{unit.label}</option>)}</select>{!evidence.knownItem&&!row.sellingUnit&&f.value&&<button title={f.reason} onClick={()=>updateParsedRow(group.id,index,{sellingUnit:f.value,sellingUnitSource:"manual"})} style={{border:0,background:"#FFF3E0",color:"#875200",fontSize:10,cursor:"pointer"}}>Use {f.value}</button>}</>:f.value==null?name==="itemNumber"?"New number on save":"—":name==="price"||name==="unitCost"?formatMoney(f.value):f.value}{name==="unitCost"&&f.value!=null&&evidence.pack.value&&<small style={{display:"block"}}>per {evidence.unitCost.unit||"unit"}</small>}{f.accuracy!=null&&<small style={{display:"block",color:f.accuracy<100?"#a65b00":"#45735b"}}>{f.accuracy}%</small>}</td>;
              })}<td><button onClick={()=>setDetailKey(detailKey===key?null:key)}>Details{invoiceClues.get(key)?.conflicts.length?" ⚠":""}</button></td></tr>)}</tbody></table>
            {detailKey&&(()=>{const entry=evidenceRows.find(e=>e.key===detailKey);if(!entry)return null;const clues=invoiceClues.get(detailKey);return <div style={{background:"#f4f6fa",padding:12,marginTop:8,fontSize:12}}><b>{entry.evidence.knownItem?"Known vendor item — saved KERDOS link, updating price":"New or unfinished item — resolve fields"} · {entry.group.name}</b><div style={{marginTop:4}}>Source: {entry.evidence.source}</div>{entry.evidence.conflicts?.length>0&&<div style={{color:"#9B4400"}}>New quote held for review: {entry.evidence.conflicts.join(" ")}</div>}{clues?.matches.length>0&&<div style={{marginTop:7}}>Matched {clues.matches.length} prior invoice line(s) for this vendor.</div>}{Object.entries(clues?.suggestions||{}).map(([field,suggestion])=><div key={field} style={{marginTop:5}}>Invoice {suggestion.source} says {field}: <b>{suggestion.value}</b> <button onClick={()=>updateParsedRow(entry.group.id,entry.index,{[field]:suggestion.value,[`${field}Source`]:"invoice",invoiceSources:{...entry.row.invoiceSources,[field]:suggestion.source},originalFields:entry.row.originalFields||{description:entry.row.description,brand:entry.row.brand,packSize:entry.row.packSize,sellingUnit:entry.row.sellingUnit}})}>Use invoice value</button></div>)}{clues?.conflicts.map((conflict,index)=><div key={index} style={{color:"#9B4400",marginTop:5}}>{conflict}</div>)}{!!clues?.conflicts.length&&<button onClick={()=>setAcceptedInvoiceConflicts(prev=>new Set([...prev,detailKey]))} disabled={acceptedInvoiceConflicts.has(detailKey)} style={{marginTop:6}}>{acceptedInvoiceConflicts.has(detailKey)?"Invoice difference reviewed":"Keep sheet value after review"}</button>}{["itemNumber","vendor","category","product","brand","pack","price","priceBasis","unitCost"].map(name=><div key={name} style={{marginTop:5}}><b>{name}:</b> {entry.evidence[name].value??"blank"} · {entry.evidence[name].accuracy??"not stated"}% — {entry.evidence[name].reason}</div>)}<div style={{marginTop:7}}>Percentages are rule-based evidence levels, not measured error probabilities.</div></div>;})()}
          </div>}
          {missingPriceBasis.length>0&&<div style={{background:"#FFF3E0",padding:9,fontSize:12,marginBottom:8}}>{missingPriceBasis.length} priced item(s) have no proven selling unit. They can still be imported and categorized. Their quoted amounts will stay unavailable for ordering and unit-cost calculation until each basis is resolved.</div>}
          {mode==="pricelist"&&parsedGroups.some(g=>g.rows.some(row=>quoteContext(row,g.rows)))&&<button onClick={()=>setParsedGroups(groups=>groups.map(g=>({...g,rows:g.rows.map(row=>{const suggestion=quoteContext(row,g.rows);const prior=vendorItems.find(vi=>vi.vendor_id===vendorId&&String(vi.vendor_item_code)===String(row.code));const mapped=prior&&mappings.some(m=>m.vendor_item_id===prior.id&&m.comparison_track==="exact"&&m.confidence_score===100);return suggestion&&!mapped?{...row,sellingUnit:suggestion.sellingUnit,sellingUnitSource:"manual",manualFields:[...new Set([...(row.manualFields||[]),"sellingUnit"])],originalFields:row.originalFields||{description:row.description,brand:row.brand,packSize:row.packSize,sellingUnit:row.sellingUnit}}:row;})})))} style={{...btn("#FFF3E0","#875200",{fontSize:11,marginBottom:10})}}>Apply supported price-unit suggestions after reviewing their reasons</button>}
          <div style={{maxHeight:340,overflowY:"auto",marginBottom:14}}>
            {parsedGroups.flatMap(g=>g.rows.map((row,i)=>mode==="pricelist"&&!row.issues?.length?null:(
              <div key={`${g.id}:${i}`} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #F0F0F0",fontSize:13}}>
                <div>
                  {row.code&&<span style={{color:"#888",marginRight:8,fontFamily:"monospace",fontSize:11}}>{row.code}</span>}
                  <span>{row.description}</span>
                  {mode==="invoice"&&<input aria-label="Verify or correct product description" value={row.description} onChange={e=>updateParsedRow(g.id,i,{description:e.target.value})}
                    style={{...inp,fontSize:11,padding:"4px 6px",marginTop:5}} />}
                  {row.packSize&&<span style={{color:"#AAA",marginLeft:6,fontSize:11}}>{row.packSize}</span>}
                  {showSourceTags&&<span style={{color:"#BBB",marginLeft:6,fontSize:10}}>· {g.name}</span>}
                  {!!row.issues?.length&&<div style={{color:"#B26A00",fontSize:11,marginTop:3}}>
                    ⚠ {row.issues.join("; ")}
                    <button onClick={()=>approveIssue(g.id,i)} disabled={acceptedIssues.has(`${g.id}:${i}`)} style={{marginLeft:8,border:"none",background:"#FFF3E0",color:"#9A5700",cursor:"pointer",fontWeight:700}}>{acceptedIssues.has(`${g.id}:${i}`)?"Acknowledged":"Approve as entered"}</button>
                  </div>}

                </div>
                {row.priceUnavailable?(
                  <span style={{fontWeight:700,flexShrink:0,marginLeft:8,color:"#B26A00",fontSize:11}}>no price listed</span>
                ):(
                  <span style={{fontWeight:700,flexShrink:0,marginLeft:8}}>{formatMoney(row.price)}</span>
                )}
              </div>
            )))}
          </div>
          {allIncomplete.length>0&&(
            <div style={{background:"#FFF3E0",padding:"10px 14px",borderRadius:8,marginBottom:14,fontSize:12}}>
              <div style={{fontWeight:700,color:"#B26A00"}}>{allIncomplete.length} product{allIncomplete.length>1?"s":""} listed with no price — a confirmed quote is still needed</div>
              <div style={{color:"#996600",marginTop:2}}>The last-known amount remains in history, but an unavailable quote cannot be selected for ordering.</div>
            </div>
          )}
          {allSkipped.length>0&&(
            <div style={{background:"#FFF3E0",padding:"10px 14px",borderRadius:8,marginBottom:14,fontSize:12}}>
              <div style={{fontWeight:700,color:"#E65100",marginBottom:6}}>{allSkipped.length} line{allSkipped.length>1?"s":""} weren't interpreted as product lines — retained in the original source</div>
              <div style={{maxHeight:120,overflowY:"auto"}}>
                {allSkipped.map((s,i)=>(
                  <div key={i} style={{color:"#999",marginBottom:3,fontFamily:"monospace",fontSize:11}}>
                    "{s.line.slice(0,60)}" — {s.reason}{showSourceTags?` (${s._source})`:""}
                  </div>
                ))}
              </div>
            </div>
          )}
          {saveReview&&<div style={{color:"#B71C1C",fontSize:12,marginBottom:8}}>{saveReview}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setStep(1)} style={{...btn("#EEE","#555"),flex:1}}>← Back</button>
            <button onClick={doSave} disabled={loading||!allRows.length||unsafeDocuments.length>0||(mode==="invoice"&&needsReview.length>0)||missingInvoiceDates.length>0||(mode==="pricelist"&&(invoiceLoad==="loading"||invoiceConflicts.length>0))} style={{...btn("#003584"),flex:2}}>
              {loading?"Saving...":mode==="invoice"?`Save ${parsedGroups.filter(g=>g.rows.length).length} invoice${parsedGroups.filter(g=>g.rows.length).length===1?"":"s"}`:"Save "+allRows.length+" items"}
            </button>
          </div>
        </>}

        {step===3&&result&&(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>{result.error?"⚠️":"✅"}</div>
            <h3 style={{margin:"0 0 8px"}}>{result.vendor}</h3>
            {result.mode==="pricelist"
              ?<p style={{color:"#666",fontSize:14}}>{result.updated} items updated · {result.created} new items added · {result.mapped} linked to your catalog{result.identified?.length?` · ${result.identified.filter(item=>item.track==="exact"&&item.confidence===100).length} of ${result.identified.length} verified automatically`:""}</p>
              :<p style={{color:"#666",fontSize:14}}>{result.invoicesCreated} invoice{result.invoicesCreated===1?"":"s"} recorded · {result.count} line{result.count===1?"":"s"} · {formatMoney(result.invoiceTotal)} total{result.packsFilled?` · ${result.packsFilled} missing pack size${result.packsFilled===1?"":"s"} filled from this invoice`:""}</p>}
            {result.identified?.length>0&&<div style={{textAlign:"left",background:"#F7F9FC",borderRadius:8,padding:12,maxHeight:230,overflowY:"auto"}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:7}}>{result.identified.length} vendor listing{result.identified.length===1?"":"s"} linked to your catalog</div>
              {result.identified.map((item,i)=><div key={i} style={{background:"white",border:"1px solid #E1E7F0",borderRadius:6,padding:8,marginBottom:5,fontSize:12}}>
                <b>{item.description}</b><div>Pack: {item.packSize||"Not provided"} · {formatMoney(item.price)}{item.invoice?" paid on invoice (historical)":" quoted"}</div>
                <div style={{color:item.track==="exact"&&item.confidence===100&&item.packSize?"#2E7D32":"#B26A00"}}>{item.track==="exact"&&item.confidence===100&&item.packSize?"Mapped · 100%":"Not mapped"}{item.track==="review"&&item.confidence!=null?` · ${item.confidence}% wording similarity`:""}{item.track==="review"&&item.reason?` · ${item.reason}`:""}</div>
              </div>)}
              {result.identified.some(item=>item.track!=="exact"||item.confidence!==100||!item.packSize)&&<div style={{fontSize:11,color:"#666"}}>Finish mapping these products in Item Catalog before their prices appear in the Order Guide.</div>}
            </div>}
            {result.error&&<div style={{background:"#FFF3E0",color:"#E65100",padding:"10px 12px",borderRadius:8,fontSize:13,marginTop:12,textAlign:"left"}}>{result.error}</div>}
            {result.basisReview>0&&<div style={{background:"#FFF3E0",color:"#875200",padding:"10px 12px",borderRadius:8,fontSize:13,marginTop:12,textAlign:"left"}}>{result.basisReview} item{result.basisReview===1?"":"s"} placed in your catalog with quoted amount retained, but selling unit unresolved. Their prices cannot enter the Order Guide until corrected in Item Catalog.</div>}
            <button onClick={onClose} style={{...btn("#003584"),marginTop:16}}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────
