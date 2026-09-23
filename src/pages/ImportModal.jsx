import {useEffect,useState} from "react";
import {backend} from "../backend/index.js";
import {fileToText} from "../document-reader.js";
import {findDate,findInvoiceNumber,parseDocument} from "../ingestion.js";
import {bestInvoiceMatch,compareProductIdentity,comparePurchasingPack,MATCH_POLICY,packsEquivalent} from "../procurement.js";
import {createCatalogService} from "../services/catalog.js";
import {createDocumentService} from "../services/documents.js";
import {createImportService} from "../services/imports.js";
import {formatMoney} from "../localization.js";
import {btn,inp} from "../ui/styles.js";

const catalogService=createCatalogService(backend);
const documents=createDocumentService(backend);
const importService=createImportService(backend);
const r2=value=>Math.round(value*100)/100;

export function PasteModal({vendors,orgId,orgSettings,catalogItems,categories,vendorItems=[],mappings=[],onClose,onDone,initialVendorId,initialMode}) {
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
  const [acceptedIssues,setAcceptedIssues]=useState(new Set());
  const [saveReview,setSaveReview]=useState("");
  const [autoSaveStarted,setAutoSaveStarted]=useState(false);

  async function handleDroppedFiles(files){
    const fileArr=Array.from(files||[]);
    if(!fileArr.length) return;
    setFileBusy(true);
    try{
      const newGroups=await Promise.all(fileArr.map(async file=>{
        const text=await fileToText(file);
        return {id:`${file.name}_${file.size}_${Date.now()}_${Math.random()}`,file,name:file.name,text};
      }));
      setFileGroups(prev=>[...prev,...newGroups]);
    }catch(err){
      alert(err.message);
    }
    setFileBusy(false);
  }

  function removeFileGroup(id){
    setFileGroups(prev=>prev.filter(g=>g.id!==id));
  }

  function doParse(){
    // Every dropped/selected file is parsed on its own — never merged into
    // one blob of raw text — since two different vendor documents can use
    // completely different table structures. A pasted blob (if any) is
    // treated as one more independent document, the same way.
    const docs=[...fileGroups];
    if(pastedText.trim().length>0){
      docs.push({id:"pasted",file:null,name:"Pasted text",text:pastedText});
    }
    const groups=docs.map(d=>{
      const parsed=parseDocument(d.text);
      return {...d,rows:parsed.rows,skipped:parsed.skipped,documentKind:parsed.documentKind,quoteValidUntil:parsed.quoteValidUntil,invoiceDate:findDate(d.text)||""};
    });
    setParsedGroups(groups);
    setStep(2);
  }

  const allRows=parsedGroups.flatMap(g=>g.rows.map(row=>({...row,_source:g.name})));
  const allSkipped=parsedGroups.flatMap(g=>g.skipped.map(s=>({...s,_source:g.name})));
  const allIncomplete=allRows.filter(r=>r.priceUnavailable);
  const showSourceTags=parsedGroups.length>1;
  const unsafeDocuments=parsedGroups.filter(g=>g.documentKind==="mixed"||(g.documentKind!=="unknown"&&g.documentKind!==mode));
  const missingInvoiceDates=mode==="invoice"?parsedGroups.filter(g=>g.rows.length&&!/^\d{4}-\d{2}-\d{2}$/.test(g.invoiceDate||"")):[];
  const needsReview=parsedGroups.flatMap(g=>g.rows.map((row,index)=>({groupId:g.id,index,row})))
    .filter(x=>x.row.issues?.length&&!acceptedIssues.has(`${x.groupId}:${x.index}`));
  function updateParsedRow(groupId,index,patch){
    // Editing an ambiguous row invalidates a prior approval of its old value.
    setAcceptedIssues(prev=>{const next=new Set(prev);next.delete(`${groupId}:${index}`);return next;});
    setParsedGroups(groups=>groups.map(g=>g.id!==groupId?g:{...g,rows:g.rows.map((r,i)=>i===index?{...r,...patch}:r)}));
  }
  function approveIssue(groupId,index){setAcceptedIssues(prev=>new Set([...prev,`${groupId}:${index}`]));}

  async function doSave(){
    if(missingInvoiceDates.length){setSaveReview("Confirm the invoice date for each document before recording invoice charges.");return;}
    if(unsafeDocuments.length){setSaveReview("This file identifies itself as an invoice and/or a price update inconsistent with the selected import mode. Split mixed documents, or select the correct mode before saving.");return;}
    if(needsReview.length){setSaveReview(`${needsReview.length} ambiguous row(s) still need a deliberate correction or approval. No unreviewed amount will change a current vendor quote.`);return;}
    setSaveReview("");setLoading(true);
    const vendor=vendors.find(v=>v.id===vendorId);
    let updated=0,created=0,invoiceTotal=0,invoicesCreated=0,mapped=0;
    const identified=[];
    let saveError=null;

    if(mode==="pricelist"){
      const workingCatalogItems=[...catalogItems];
      const workingCategories=[...categories];
      const workingVendorItems=[...vendorItems];
      const workingMappings=[...mappings];
      const importBatchTime=new Date().toISOString();

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
      for(const row of group.rows){
        try{
        if(!row.priceUnavailable&&(!Number.isFinite(Number(row.price))||Number(row.price)<=0)) throw new Error("No confirmed positive unit price");
        let ex=await importService.findVendorItem({organizationId:orgId,vendorId,code:row.code,description:row.description});
        if(!ex&&!row.code){
          const candidates=await importService.vendorItems(orgId,vendorId);
          const established=candidates.filter(vi=>compareProductIdentity(row.description,vi.description).status==="same" &&
            (!row.packSize||!vi.pack_size||packsEquivalent(row.packSize,vi.pack_size)));
          if(established.length===1) ex=established[0];
          else if(established.length>1) throw new Error("Multiple existing vendor products have this identity. Verify the vendor item code before updating a quote.");
        }
        let vendorItemId;
        if(ex){
          const identity=compareProductIdentity(row.description,ex.description);
          if(identity.status!=="same") throw new Error(`Vendor item code or description points to an unverified product (${identity.reason}). Existing price and mapping were preserved.`);
          if(row.packSize&&ex.pack_size&&!packsEquivalent(row.packSize,ex.pack_size))
            throw new Error("The pack size changed for the same vendor item; verify the package and purchasing price before updating the quote.");
        }
        // The provider persists current quote and history in one transaction.
        // It is impossible to update one and lose the other midway through.
        vendorItemId=await backend.pricing.applyQuote({
          vendorItemId:ex?.id||null,organizationId:orgId,vendorId,
          vendorItemCode:row.code,description:row.description,
          packSize:row.packSize||ex?.pack_size||null,price:row.price,
          priceUnavailable:!!row.priceUnavailable,effectiveDate:importBatchTime,
          quoteValidUntil:group.quoteValidUntil,sourceFilePath,
          sourceFileName:group.name,sourceLine:row.sourceLine||null,sourceDocumentId,
        });
        if(ex) updated++; else created++;

        // Whether this vendor item is brand new or was just updated, it
        // must be linked to a catalog item: an unlinked price is invisible
        // to ordering and to cross-vendor comparison.
        if(vendorItemId){
          const existingMapping=await importService.mapping(orgId,vendorItemId);
          if(!existingMapping){
            const match=await catalogService.matchOrCreate({organizationId:orgId,description:row.description,packSize:row.packSize||ex?.pack_size,catalogItems:workingCatalogItems,categories:workingCategories,vendorItems:workingVendorItems,mappings:workingMappings});
            if(match){
              await importService.createMapping({
                organization_id:orgId, catalog_item_id:match.catalogItemId, vendor_item_id:vendorItemId,
                confidence_score:Math.round((match.score??0)*100),
                match_method:"rule_based", comparison_track:match.track,
              });
              mapped++;
              workingVendorItems.push({id:vendorItemId,description:row.description,pack_size:row.packSize||ex?.pack_size||null});
              workingMappings.push({catalog_item_id:match.catalogItemId,vendor_item_id:vendorItemId});
              identified.push({description:row.description,packSize:row.packSize||ex?.pack_size||null,price:row.price,track:match.track,confidence:match.score==null?null:Math.round(match.score*100),reason:match.reason||null});
            }
          }
        }
        }catch(err){
          // Report the first failure verbatim and count the rest; a row
          // that failed is never counted as updated or created.
          failedRows++;
          if(!saveError) saveError=`"${row.description}" — ${err.message||String(err)}`;
        }
      }
        const finalStatus=failedRows===failuresBeforeGroup?"complete":"partial";
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
            matched=viList.find(vi=>vi.vendor_item_code===row.code)||null;
            if(matched&&compareProductIdentity(row.description,matched.description).status==="same"&&comparePurchasingPack(row.packSize,matched.pack_size).status==="same"){
              confidence=100; method="code";
            }else if(matched){matched=null;codeConflict=true;method="identity_conflict";}
          }
          if(!matched&&!codeConflict&&row.description){
            matched=viList.find(vi=>vi.description===row.description)||null;
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
              pendingCatalog=await catalogService.matchOrCreate({organizationId:orgId,description:row.description,packSize:row.packSize,catalogItems:workingCatalogItems,categories:workingCategories,vendorItems,mappings});
              method="created_from_invoice"; confidence=null;
              invoiceIdentified.push({description:row.description,packSize:row.packSize||null,price:row.price,track:pendingCatalog.track,confidence:pendingCatalog.score==null?null:Math.round(pendingCatalog.score*100),reason:pendingCatalog.reason||null,invoice:true});
            }catch(err){
              method="unmatched";
              saveError=(saveError?saveError+" ":"")+`"${row.description}": ${err.message||String(err)}`;
            }
          }
          if(codeConflict)saveError=(saveError?saveError+" ":"")+`Invoice line ${row.description}: item code conflicts with the previously identified product, so the original invoice line was recorded without a product link.`;
          let quotedPrice=null;
          if(matched?.id&&method!=="created_from_invoice"){
            const invoiceDate=group.invoiceDate;
            let quote=null;
            try{quote=await importService.historicalQuote({organizationId:orgId,vendorItemId:matched.id,invoiceDate});}
            catch(err){saveError=(saveError?saveError+" ":"")+`${row.description}: ${err.message}`;}
            const withinVendorTerm=!quote?.quote_valid_until||quote.quote_valid_until>=invoiceDate;
            const refreshDays=Number(orgSettings?.price_refresh_days);
            const mode=orgSettings?.price_refresh_mode==="automatic"?"automatic":"manual";
            const withinClientWindow=mode!=="automatic"||!refreshDays||
              ((new Date(`${invoiceDate}T12:00:00Z`)-new Date(quote?.effective_date||0))/86400000)<=refreshDays;
            if(quote&&withinVendorTerm&&withinClientWindow&&["price_list","manual_edit"].includes(quote.source))quotedPrice=Number(quote.price);
          }
          const variance=quotedPrice!=null?r2(row.price-quotedPrice):null;
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

    setResult({mode,vendor:vendor?.name,updated,created,mapped,invoiceTotal:r2(invoiceTotal),invoicesCreated,count:allRows.length,error:saveError,identified});
    await onDone();
    setStep(3);setLoading(false);
  }

  // Clean imports need no client-facing inspection screen. Only documents
  // with a type conflict, missing invoice date, or ambiguous parsed row stop
  // at review. Everything else proceeds directly to the concise result.
  useEffect(()=>{
    if(step!==2||autoSaveStarted||loading||!allRows.length) return;
    if(unsafeDocuments.length||missingInvoiceDates.length||needsReview.length) return;
    setAutoSaveStarted(true);
    doSave();
  },[step,autoSaveStarted,loading,allRows.length,unsafeDocuments.length,missingInvoiceDates.length,needsReview.length]);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:"16px 16px 0 0",padding:20,width:"100%",maxWidth:600,maxHeight:"90vh",overflowY:"auto"}}>
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
              {fileBusy&&<div style={{position:"absolute",inset:0,background:"rgba(255,255,255,0.85)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#003584",fontWeight:700,borderRadius:8}}>Reading file...</div>}
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
              placeholder="Copy from Excel, email, PDF — paste here..." />
          </div>
          <button onClick={doParse} disabled={fileGroups.length===0 && pastedText.trim().length<10} style={{...btn("#003584"),width:"100%"}}>
            Parse {fileGroups.length>0?`${fileGroups.length} file${fileGroups.length>1?"s":""}`+(pastedText.trim()?" + pasted text":""):"pasted text"}
          </button>
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
          <div style={{maxHeight:340,overflowY:"auto",marginBottom:14}}>
            {parsedGroups.flatMap(g=>g.rows.map((row,i)=>(
              <div key={`${g.id}:${i}`} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #F0F0F0",fontSize:13}}>
                <div>
                  {row.code&&<span style={{color:"#888",marginRight:8,fontFamily:"monospace",fontSize:11}}>{row.code}</span>}
                  <span>{row.description}</span>
                  <input aria-label="Verify or correct product description" value={row.description} onChange={e=>updateParsedRow(g.id,i,{description:e.target.value})}
                    style={{...inp,fontSize:11,padding:"4px 6px",marginTop:5}} />
                  {row.packSize&&<span style={{color:"#AAA",marginLeft:6,fontSize:11}}>{row.packSize}</span>}
                  {showSourceTags&&<span style={{color:"#BBB",marginLeft:6,fontSize:10}}>· {g.name}</span>}
                  {!!row.issues?.length&&<div style={{color:"#B26A00",fontSize:11,marginTop:3}}>
                    ⚠ {row.issues.join("; ")}
                    <button onClick={()=>approveIssue(g.id,i)} disabled={acceptedIssues.has(`${g.id}:${i}`)} style={{marginLeft:8,border:"none",background:"#FFF3E0",color:"#9A5700",cursor:"pointer",fontWeight:700}}>{acceptedIssues.has(`${g.id}:${i}`)?"Acknowledged":"Approve as entered"}</button>
                  </div>}
                  {mode==="pricelist"&&!row.packSize&&<input aria-label="Confirm the purchasing pack" placeholder="Confirm pack: e.g. 40 LB" value={row.packSize||""} onChange={e=>updateParsedRow(g.id,i,{packSize:e.target.value})} style={{...inp,fontSize:11,padding:"4px 6px",marginTop:5}} />}
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
            <button onClick={doSave} disabled={loading||!allRows.length||unsafeDocuments.length>0||needsReview.length>0||missingInvoiceDates.length>0} style={{...btn("#003584"),flex:2}}>
              {loading?"Saving...":mode==="invoice"?`Save ${parsedGroups.filter(g=>g.rows.length).length} invoice${parsedGroups.filter(g=>g.rows.length).length===1?"":"s"}`:"Save "+allRows.length+" items"}
            </button>
          </div>
        </>}

        {step===3&&result&&(
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>{result.error?"⚠️":"✅"}</div>
            <h3 style={{margin:"0 0 8px"}}>{result.vendor}</h3>
            {result.mode==="pricelist"
              ?<p style={{color:"#666",fontSize:14}}>{result.updated} items updated · {result.created} new items added · {result.mapped} linked to your catalog for ordering</p>
              :<p style={{color:"#666",fontSize:14}}>{result.invoicesCreated} invoice{result.invoicesCreated===1?"":"s"} recorded · {result.count} line{result.count===1?"":"s"} · {formatMoney(result.invoiceTotal)} total</p>}
            {result.identified?.length>0&&<div style={{textAlign:"left",background:"#F7F9FC",borderRadius:8,padding:12,maxHeight:230,overflowY:"auto"}}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:7}}>{result.identified.length} newly identified vendor product{result.identified.length===1?"":"s"}</div>
              {result.identified.map((item,i)=><div key={i} style={{background:"white",border:"1px solid #E1E7F0",borderRadius:6,padding:8,marginBottom:5,fontSize:12}}>
                <b>{item.description}</b><div>Pack: {item.packSize||"Not provided"} · {formatMoney(item.price)}{item.invoice?" paid on invoice (historical)":" quoted"}</div>
                <div style={{color:item.track==="exact"?"#2E7D32":"#B26A00"}}>{item.track==="new"?"New catalog product":item.track==="review"?"Needs product review":"Verified match"}{item.confidence!=null?` · Description ${item.confidence}% similar`:""}{item.reason?` · ${item.reason}`:""}</div>
              </div>)}
              <div style={{fontSize:11,color:"#666"}}>Review uncertain products in Item Catalog before their prices are used for ordering.</div>
            </div>}
            {result.error&&<div style={{background:"#FFF3E0",color:"#E65100",padding:"10px 12px",borderRadius:8,fontSize:13,marginTop:12,textAlign:"left"}}>{result.error}</div>}
            <button onClick={onClose} style={{...btn("#003584"),marginTop:16}}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────
