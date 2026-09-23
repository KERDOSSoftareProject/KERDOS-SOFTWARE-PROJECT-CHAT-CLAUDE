import {useMemo,useState} from "react";
import {backend} from "../backend/index.js";
import {createCatalogService} from "../services/catalog.js";
import {createCategoryService} from "../services/categories.js";
import {bestCatalogMatch,compareProductIdentity,comparePurchasingPack,unitsForDimension} from "../procurement.js";
import {blockReason,orderable} from "../core/ordering.js";
import {compareItems,itemMatchesSearch} from "../core/catalog-browse.js";
import {formatMoney} from "../localization.js";
import {buildCatalogExportCSV,downloadTextFile} from "../reporting.js";
import {btn,chipStyle,inp} from "../ui/styles.js";

const catalogService=createCatalogService(backend);
const categoryService=createCategoryService(backend);

const REVIEW_FILTER="__needs_review__";

// Small labeled block used by the review sections on Item Catalog, Price
// Sheets, and Invoices - each tab only ever shows the review data that's
// actually ITS OWN (mapping issues on Item Catalog, price-sheet health on
// Price Sheets, invoice-line issues on Invoices), so this is shared
// purely for the consistent look, not because any data crosses tabs.
function Section({title,count,emptyText,children}){
  return (
    <div style={{marginBottom:20}}>
      <div style={{fontWeight:800,fontSize:13,color:"#003584",marginBottom:8}}>{title} {count>0&&<span style={{color:"#E65100"}}>({count})</span>}</div>
      {count===0?(
        <div style={{fontSize:12,color:"#AAA",background:"white",borderRadius:8,padding:"10px 12px"}}>{emptyText}</div>
      ):children}
    </div>
  );
}

export function ItemCatalogPanel({orgId,role,productList,vendors,catalogItems,mappings,vendorItems,categories,onOpenVendor,onUpdated}) {
  const canManage=role==="owner"||role==="manager";
  const [search,setSearch]=useState("");
  const [categoryFilter,setCategoryFilter]=useState("");
  const [remapOpenFor,setRemapOpenFor]=useState(null);
  const [remapSearch,setRemapSearch]=useState("");
  const [busyMappingId,setBusyMappingId]=useState(null);
  const [draggedItemId,setDraggedItemId]=useState(null);
  const [dragOverItemId,setDragOverItemId]=useState(null);
  const [merging,setMerging]=useState(false);
  const [renamingId,setRenamingId]=useState(null);
  const [renameValue,setRenameValue]=useState("");
  const [categoryEditId,setCategoryEditId]=useState(null);
  const [categoryEditBusy,setCategoryEditBusy]=useState(false);
  // Which catalog item's "map this item's vendors" panel is open. This
  // is separate from remapOpenFor (which mapping's remap-search box is
  // open, below) - a person opens the item's panel first, then may open
  // remap-search on one specific vendor line inside it. Available for
  // EVERY item, not just ones flagged for review - re-pointing a vendor's
  // price to a different catalog item shouldn't require waiting for the
  // system to flag it first.
  const [mapPanelOpenFor,setMapPanelOpenFor]=useState(null);
  // Bulk allocation of unclassified items. One-at-a-time reassignment is
  // fine for a stray item, but an import that leaves dozens unmatched
  // needs to be workable in one pass, not dozens of separate dropdowns.
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [bulkBusy,setBulkBusy]=useState(false);
  // After a manual allocation, the words that would have matched are
  // offered back to the destination category so the SAME correction is
  // never needed twice. This is the dictionary learning from real use
  // rather than waiting on someone to hand-edit keywords.
  const [teach,setTeach]=useState(null); // {categoryId, categoryName, words:[], chosen:Set}
  const [teachBusy,setTeachBusy]=useState(false);
  const [addingItem,setAddingItem]=useState(false);
  const [newItemName,setNewItemName]=useState("");
  const [newItemCategoryId,setNewItemCategoryId]=useState("");
  const [addingBusy,setAddingBusy]=useState(false);
  const [error,setError]=useState("");

  const vMap=useMemo(()=>new Map(vendors.map(v=>[v.id,v])),[vendors]);
  const viMap=useMemo(()=>new Map(vendorItems.map(vi=>[vi.id,vi])),[vendorItems]);
  const ciMap=useMemo(()=>new Map(catalogItems.map(ci=>[ci.id,ci])),[catalogItems]);

  // Categories are ordered alphabetically - same as Order Guide, so both screens'
  // category chips read the same way. Internal KERDOS item identifiers
  // are retained in the data but never shown to customers.
  const categoryList=useMemo(()=>{
    const set=new Set(productList.map(p=>p.category));
    return [...set].sort((a,b)=>a.localeCompare(b));
  },[productList]);

  // A dedicated hot button for "show me only what needs review" -
  // reuses the categoryFilter slot with a sentinel value rather than a
  // second piece of state, so category chips and this button stay
  // mutually exclusive the same simple way.
  const needsReviewItems=useMemo(()=>
    new Set(productList.filter(item=>item.options.some(o=>["similar","review"].includes(o.matchTrack))).map(item=>item.catalogItemId)),
  [productList]);

  // Full List is one alphabetical client catalog. Selecting a product type
  // narrows that same alphabetized list without changing item identity or
  // client master numbers. Vendor codes remain mappings beneath each item.
  const groupedItems=useMemo(()=>{
    const items=productList.filter(item=>{
      if(categoryFilter===REVIEW_FILTER){ if(!needsReviewItems.has(item.catalogItemId)) return false; }
      else if(categoryFilter&&item.category!==categoryFilter) return false;
      return itemMatchesSearch(item,search);
    });
    const alphabetized=[...items].sort((a,b)=>compareItems(a,b,"alpha"));
    const label=categoryFilter===REVIEW_FILTER?"Needs Review":categoryFilter||"Full List";
    return alphabetized.length?[{category:label,items:alphabetized}]:[];
  },[productList,search,categoryFilter,needsReviewItems]);

  // A single-vendor "new" item has nothing to compare against, so it's
  // a clean 100% match by definition - only "similar" is a real fuzzy
  // merge worth reviewing.
  function statusFor(item){
    const usable=item.options.filter(orderable);
    const cheapest=usable[0]||item.options[0]||null;
    if(!cheapest) return {label:"No price on file",color:"#999",bg:"#F5F5F5"};
    if(!orderable(cheapest)) return {label:blockReason(cheapest),color:"#B26A00",bg:"#FFF3E0"};
    if(["similar","review"].includes(cheapest.matchTrack)) return {label:`Needs review — ${cheapest.matchConfidence}%`,color:"#B26A00",bg:"#FFF3E0"};
    return {label:cheapest.matchTrack==="new"?"New vendor product":"✓ Product linked",color:"#2E7D32",bg:"#E8F5E9"};
  }

  // One wrapper for every catalog action: show the failure where the
  // person is looking, and only refresh when the write actually landed.
  async function act(fn){
    if(!canManage) { setError("Only owners and managers can edit the catalog."); return false; }
    setError("");
    try{ await fn(); onUpdated(); return true; }
    catch(err){ setError(err.message||String(err)); return false; }
  }
  async function handleConfirm(mappingId){
    setBusyMappingId(mappingId);
    await act(()=>catalogService.confirmMapping(mappingId));
    setBusyMappingId(null);
  }
  async function handleRemapExisting(mappingId,newCatalogItemId){
    setBusyMappingId(mappingId);
    if(await act(()=>catalogService.remapToExisting(mappingId,newCatalogItemId))){ setRemapOpenFor(null); setRemapSearch(""); }
    setBusyMappingId(null);
  }
  async function handleRemapNew(mappingId,description){
    setBusyMappingId(mappingId);
    if(await act(()=>catalogService.splitMapping({organizationId:orgId,mappingId,description,catalogItems,categories}))){ setRemapOpenFor(null); setRemapSearch(""); }
    setBusyMappingId(null);
  }

  function handleDrop(targetItem){
    const sourceId=draggedItemId;
    setDraggedItemId(null); setDragOverItemId(null);
    if(!sourceId||sourceId===targetItem.catalogItemId) return;
    const sourceItem=productList.find(p=>p.catalogItemId===sourceId);
    if(!sourceItem) return;
    if(!window.confirm(`Merge "${sourceItem.name}" into "${targetItem.name}"?\n\nAll of "${sourceItem.name}"'s vendor prices will move under "${targetItem.name}", and "${sourceItem.name}" will be removed as its own item. This can't be undone automatically.`)) return;
    setMerging(true);
    act(()=>catalogService.mergeItems(sourceId,targetItem.catalogItemId)).finally(()=>setMerging(false));
  }

  async function saveRename(catalogItemId){
    const trimmed=renameValue.trim();
    setRenamingId(null);
    if(!trimmed) return;
    await act(()=>catalogService.renameItem(catalogItemId,trimmed));
  }

  // Words shared by the just-allocated items that the destination
  // category does not already match. These are exactly the words whose
  // absence caused the miss, so offering them back closes the gap at its
  // source. Deterministic word frequency - no model, no guessing.
  function suggestKeywords(items,targetCategory){
    const existing=(targetCategory?.keywords||[]).map(k=>String(k).toLowerCase());
    const freq=new Map();
    for(const it of items){
      const seen=new Set();
      for(const w of String(it.name||"").toLowerCase().split(/[^a-z0-9]+/)){
        if(w.length<3||seen.has(w)) continue;
        seen.add(w);
        freq.set(w,(freq.get(w)||0)+1);
      }
    }
    // Drop anything the category already covers, and anything that is
    // just a number or a size token.
    return [...freq.entries()]
      .filter(([w])=>!existing.some(k=>k===w||k.includes(w)||w.includes(k)))
      .filter(([w])=>!/^\d/.test(w))
      .sort((a,b)=>b[1]-a[1])
      .slice(0,8)
      .map(([w,n])=>({word:w,count:n}));
  }

  async function handleBulkAssign(newCategoryId){
    if(!newCategoryId||selectedIds.size===0) return;
    setBulkBusy(true);
    setError("");
    const target=categories.find(c=>c.id===newCategoryId);
    const chosenItems=productList.filter(p=>selectedIds.has(p.catalogItemId));
    try{
      // Numbering must stay collision-free, so assignments run in sequence
      // against a working copy, using the same rule as reclassification.
      const working=[...catalogItems];
      for(const item of chosenItems){
        const n=await categoryService.assignItem({catalogItemId:item.catalogItemId,categoryId:newCategoryId,catalogItems:working,categories});
        const i=working.findIndex(ci=>ci.id===item.catalogItemId);
        if(i>=0) working[i]={...working[i],category_id:newCategoryId,master_item_number:n};
      }
      const words=suggestKeywords(chosenItems,target);
      setSelectedIds(new Set());
      if(words.length) setTeach({categoryId:newCategoryId,categoryName:target?.name||"",words,chosen:new Set()});
      onUpdated();
    }catch(err){
      setError(`Could not move those items: ${err.message||String(err)}`);
    }finally{
      setBulkBusy(false);
    }
  }

  async function saveTeachedKeywords(){
    if(!teach||teach.chosen.size===0){ setTeach(null); return; }
    setTeachBusy(true);
    try{
      const cat=categories.find(c=>c.id===teach.categoryId);
      const merged=[...(cat?.keywords||[]),...[...teach.chosen]];
      await categoryService.updateKeywords(teach.categoryId,merged);
      setTeach(null);
      onUpdated();
    }finally{
      setTeachBusy(false);
    }
  }

  // Per-item rules (brand lock, strict matching, per-unit display unit).
  // A small write, then the same reload every other edit uses.
  async function handleItemSetting(catalogItemId,patch){
    await act(()=>catalogService.updateItemSettings(catalogItemId,patch));
  }

  async function handleAssignCategory(catalogItemId,newCategoryId){
    setCategoryEditId(null);
    if(!newCategoryId) return;
    setCategoryEditBusy(true);
    await act(()=>categoryService.assignItem({catalogItemId,categoryId:newCategoryId,catalogItems,categories}));
    setCategoryEditBusy(false);
  }

  async function handleAddItem(){
    if(!newItemName.trim()) return;
    setAddingBusy(true);
    if(await act(()=>catalogService.createItem({organizationId:orgId,name:newItemName.trim(),categoryId:newItemCategoryId||null,catalogItems,categories}))){
      setNewItemName(""); setNewItemCategoryId(""); setAddingItem(false);
    }
    setAddingBusy(false);
  }

  const lowConfidenceMatches=useMemo(()=>
    mappings.filter(m=>["similar","review"].includes(m.comparison_track)).map(m=>{
      const vi=viMap.get(m.vendor_item_id); const ci=ciMap.get(m.catalog_item_id);
      const v=vi?vMap.get(vi.vendor_id):null;
      const others=catalogItems.filter(c=>c.id!==m.catalog_item_id);
      const suggestion=vi?bestCatalogMatch(vi.description,others):null;
      const suggestedVendor=mappings.filter(link=>link.catalog_item_id===suggestion?.catalogItem?.id).map(link=>viMap.get(link.vendor_item_id)).find(link=>link?.pack_size);
      const detail=vi&&ci?compareProductIdentity(vi.description,ci.name):null;
      const packCheck=vi?comparePurchasingPack(vi.pack_size,suggestedVendor?.pack_size):null;
      return {mappingId:m.id, catalogItemId:m.catalog_item_id, catalogName:ci?.name||"(deleted item)", vendorName:v?.name||"—",
        vendorDescription:vi?.description||"—",packSize:vi?.pack_size||null,brand:vi?.brand||null, confidence:m.confidence_score, track:m.comparison_track,
        reason:detail?.status==="review"?detail.reason:packCheck?.reason||"Check the full product specifications",
        suggestion:suggestion?{catalogItemId:suggestion.catalogItem.id,name:suggestion.catalogItem.name,score:Math.round(suggestion.score*100)}:null};
    }).sort((a,b)=>(a.confidence??0)-(b.confidence??0)),
  [mappings,viMap,ciMap,vMap,catalogItems]);

  // Item Catalog's review badge is scoped to CATALOG MAPPING issues only
  // (fuzzy vendor-item matches) - invoice-line issues live on Invoices,
  // price-sheet health (unavailable/stale prices) lives on Price Sheets.
  // Each tab shows only what's actually its own job to review.
  const totalCount=lowConfidenceMatches.length;

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h3 style={{margin:0,fontSize:16,color:"white"}}>Item Catalog</h3>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {totalCount>0&&<span style={{background:"#E65100",color:"white",fontSize:12,fontWeight:700,padding:"3px 10px",borderRadius:12}}>{totalCount} to review</span>}
          {canManage&&<button onClick={()=>setAddingItem(true)} style={{...btn("#003584","white",{fontSize:12,padding:"8px 14px"})}}>+ Add Item</button>}
          <button onClick={()=>downloadTextFile(`catalog-export-${new Date().toISOString().split("T")[0]}.csv`,buildCatalogExportCSV(productList,vendors),"text/csv")}
            disabled={!productList.length} style={{...btn("#2E7D32","white",{fontSize:12,padding:"8px 14px"})}}>
            📄 Export (CSV)
          </button>
        </div>
      </div>

      {error&&<div style={{background:"#FFF3E0",color:"#E65100",padding:"10px 12px",borderRadius:8,fontSize:13,marginBottom:14}}>{error}</div>}

      {canManage&&addingItem&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"white",borderRadius:12,padding:24,width:"100%",maxWidth:380}}>
            <h3 style={{margin:"0 0 4px",fontSize:16}}>Add a catalog item</h3>
            <p style={{margin:"0 0 14px",fontSize:12,color:"#888"}}>This is your item — name it however makes sense to you. Vendor prices get matched into it as they come in.</p>
            <input style={{...inp,width:"100%",marginBottom:10,boxSizing:"border-box"}} placeholder="Item name" value={newItemName} onChange={e=>setNewItemName(e.target.value)} autoFocus />
            <select style={{...inp,width:"100%",marginBottom:14,boxSizing:"border-box"}} value={newItemCategoryId} onChange={e=>setNewItemCategoryId(e.target.value)}>
              <option value="">No category (Uncategorized)</option>
              {categories.filter(c=>!c.is_holding_pen).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setAddingItem(false);setNewItemName("");setNewItemCategoryId("");}} style={{...btn("#EEE","#555"),flex:1}}>Cancel</button>
              <button onClick={handleAddItem} disabled={addingBusy||!newItemName.trim()} style={{...btn("#003584"),flex:2}}>{addingBusy?"Adding...":"Add Item"}</button>
            </div>
          </div>
        </div>
      )}

      {canManage&&totalCount>0&&(
        <div style={{marginBottom:24,paddingBottom:4}}>
          <Section title="Vendor products to check" count={lowConfidenceMatches.length} emptyText="All vendor products are linked to the right catalog items.">
            <p style={{fontSize:12,color:"rgba(255,255,255,0.85)",margin:"0 0 10px"}}>Check where each vendor product belongs. Moving a vendor price here changes only that vendor product.</p>
            {lowConfidenceMatches.map(m=>(
              <div key={m.mappingId} style={{background:"white",borderRadius:8,padding:"10px 12px",marginBottom:6,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
                <div style={{fontSize:11,color:"#666",marginBottom:3}}>Vendor product · {m.vendorName}</div>
                <div style={{fontWeight:700,fontSize:13}}>{m.vendorDescription}</div>
                <div style={{fontSize:11,color:"#555",marginTop:3}}>Pack: <b>{m.packSize||"Not provided"}</b>{m.brand?` · Brand: ${m.brand}`:""}</div>
                <div style={{fontSize:12,color:"#555",marginTop:5,marginBottom:8}}>Currently under <b>{m.catalogName}</b> <span style={{color:"#B26A00"}}>· Suggested match {m.confidence??"—"}%</span></div>
                <div style={{fontSize:11,color:"#B26A00",marginBottom:8}}>Check: {m.reason}. Similar wording is not proof of the same product.</div>
                {m.suggestion&&(
                  <div style={{fontSize:11,color:"#555",marginBottom:8}}>
                    Another possible item: <b>{m.suggestion.name}</b> <span style={{color:"#999"}}>({m.suggestion.score}% suggested match)</span>
                  </div>
                )}
                {remapOpenFor===m.mappingId?(
                  <div style={{background:"#F7F9FC",borderRadius:6,padding:8}}>
                    <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Choose the catalog item for this vendor product</div>
                    <input style={{...inp,marginBottom:6,fontSize:12,padding:"7px 9px"}} placeholder="Search for a product..." value={remapSearch} onChange={e=>setRemapSearch(e.target.value)} autoFocus />
                    <div style={{maxHeight:140,overflowY:"auto"}}>
                      {catalogItems.filter(ci=>{
                        if(ci.id===m.catalogItemId) return false;
                        const q=remapSearch.trim().toLowerCase();
                        if(!q) return true;
                        return ci.name.toLowerCase().includes(q);
                      }).slice(0,8).map(ci=>(
                        <button key={ci.id} disabled={busyMappingId===m.mappingId} onClick={()=>handleRemapExisting(m.mappingId,ci.id)}
                          style={{display:"block",width:"100%",textAlign:"left",background:"white",border:"1px solid #EEE",borderRadius:5,padding:"6px 8px",marginBottom:4,fontSize:12,cursor:"pointer"}}>
                          {ci.name}
                        </button>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:6}}>
                      {m.track!=="review"&&<button disabled={busyMappingId===m.mappingId} onClick={()=>handleRemapNew(m.mappingId,m.vendorDescription)}
                        style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 10px",flex:1})}}>Create a new item for this vendor product</button>}
                      <button onClick={()=>{setRemapOpenFor(null);setRemapSearch("");}} style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 10px"})}}>Cancel</button>
                    </div>
                  </div>
                ):(
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button disabled={busyMappingId===m.mappingId} onClick={()=>handleConfirm(m.mappingId)}
                      style={{...btn("#2E7D32","white",{fontSize:11,padding:"6px 12px"})}}>{busyMappingId===m.mappingId?"Saving...":m.track==="review"?"Keep under this item":"Yes, this is the right item"}</button>
                    {m.suggestion&&(
                      <button disabled={busyMappingId===m.mappingId} onClick={()=>handleRemapExisting(m.mappingId,m.suggestion.catalogItemId)}
                        style={{...btn("#1565C0","white",{fontSize:11,padding:"6px 12px"})}}>Move to {m.suggestion.name}</button>
                    )}
                    <button disabled={busyMappingId===m.mappingId} onClick={()=>{setRemapOpenFor(m.mappingId);setRemapSearch("");}}
                      style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 12px"})}}>Choose another item{m.track!=="review"?" or create new":""}</button>
                  </div>
                )}
              </div>
            ))}
          </Section>

          <div style={{fontSize:10,fontWeight:700,color:"#AAA",letterSpacing:"0.06em",textTransform:"uppercase",margin:"18px 0 10px"}}>Full catalog</div>
        </div>
      )}

      <input style={{...inp,marginBottom:10}} placeholder="Search by name, vendor wording, or item code..." value={search} onChange={e=>setSearch(e.target.value)} />

      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
        <button onClick={()=>setCategoryFilter("")} style={chipStyle(!categoryFilter)}>
          Full List
        </button>
        {needsReviewItems.size>0&&(
          <button onClick={()=>setCategoryFilter(categoryFilter===REVIEW_FILTER?"":REVIEW_FILTER)}
            style={{fontSize:12,fontWeight:700,padding:"6px 14px",borderRadius:20,cursor:"pointer",
              background:categoryFilter===REVIEW_FILTER?"#E65100":"#FFF3E0",color:categoryFilter===REVIEW_FILTER?"white":"#B26A00",
              border:categoryFilter===REVIEW_FILTER?"2px solid #E65100":"2px solid transparent"}}>
            ⚠ Needs Review ({needsReviewItems.size})
          </button>
        )}
        {categoryList.map(c=>{
          const isSelected=categoryFilter===c;
          return (
            <button key={c} onClick={()=>setCategoryFilter(isSelected?"":c)} style={chipStyle(isSelected)}>
              {c}
            </button>
          );
        })}
      </div>

      {canManage&&teach&&(
        <div style={{background:"#E8F5E9",border:"2px solid #2E7D32",borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1B5E20",marginBottom:4}}>Teach the catalog so this doesn't happen again</div>
          <div style={{fontSize:12,color:"#33691E",marginBottom:8}}>
            Add any of these words to <b>{teach.categoryName}</b> and items like these will classify automatically from now on, on every future import.
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
            {teach.words.map(({word,count})=>{
              const on=teach.chosen.has(word);
              return (
                <button key={word} onClick={()=>setTeach(t=>{const c=new Set(t.chosen);on?c.delete(word):c.add(word);return {...t,chosen:c};})}
                  style={{fontSize:12,fontWeight:700,padding:"5px 11px",borderRadius:14,cursor:"pointer",
                    background:on?"#2E7D32":"white",color:on?"white":"#33691E",
                    border:on?"2px solid #2E7D32":"2px solid #A5D6A7"}}>
                  {on?"✓ ":""}{word}{count>1?` (${count})`:""}
                </button>
              );
            })}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={saveTeachedKeywords} disabled={teachBusy||teach.chosen.size===0}
              style={{...btn("#2E7D32","white",{fontSize:12,padding:"8px 14px",opacity:teach.chosen.size===0?0.5:1})}}>
              {teachBusy?"Saving...":`Add ${teach.chosen.size||""} word${teach.chosen.size===1?"":"s"} to ${teach.categoryName}`}
            </button>
            <button onClick={()=>setTeach(null)} style={{...btn("#EEE","#555",{fontSize:12,padding:"8px 14px"})}}>Not now</button>
          </div>
        </div>
      )}

      {canManage&&selectedIds.size>0&&(
        <div style={{background:"white",borderRadius:10,padding:12,marginBottom:12,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",
          display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",position:"sticky",top:8,zIndex:5}}>
          <span style={{fontSize:13,fontWeight:700,color:"#003584"}}>{selectedIds.size} selected</span>
          <select defaultValue="" disabled={bulkBusy} onChange={e=>{handleBulkAssign(e.target.value);e.target.value="";}}
            style={{...inp,fontSize:12,padding:"7px 9px",width:"auto",flex:"0 1 220px"}}>
            <option value="" disabled>{bulkBusy?"Moving...":"Move all to..."}</option>
            {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={()=>setSelectedIds(new Set())} style={{...btn("#EEE","#555",{fontSize:12,padding:"7px 12px"})}}>Clear</button>
        </div>
      )}

      {productList.length===0?(
        <div style={{background:"white",borderRadius:10,padding:20,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <p style={{color:"#888",fontSize:13,margin:0}}>Nothing in the catalog yet — import a price list to get started.</p>
        </div>
      ):groupedItems.length===0?(
        <div style={{background:"white",borderRadius:10,padding:20,textAlign:"center",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <p style={{color:"#888",fontSize:13,margin:0}}>No items match that search.</p>
        </div>
      ):groupedItems.map(group=>(
        <div key={group.category} style={{marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,paddingLeft:2}}>
            {canManage&&<input type="checkbox"
              checked={group.items.length>0&&group.items.every(i=>selectedIds.has(i.catalogItemId))}
              onChange={e=>{
                const all=e.target.checked;
                setSelectedIds(prev=>{
                  const next=new Set(prev);
                  group.items.forEach(i=>all?next.add(i.catalogItemId):next.delete(i.catalogItemId));
                  return next;
                });
              }}
              title={`Select every item shown under ${group.category}`} />}
            <span style={{fontWeight:800,fontSize:13,color:"rgba(255,255,255,0.85)"}}>{group.category}</span>
            <span style={{fontSize:11,color:"rgba(255,255,255,0.5)"}}>({group.items.length})</span>
          </div>
          {group.items.map(item=>{
            const status=statusFor(item);
            const isDragOver=dragOverItemId===item.catalogItemId;
            return (
              <div key={item.catalogItemId}
                draggable={canManage}
                onDragStart={()=>setDraggedItemId(item.catalogItemId)}
                onDragEnd={()=>{setDraggedItemId(null);setDragOverItemId(null);}}
                onDragOver={(e)=>{e.preventDefault();if(draggedItemId&&draggedItemId!==item.catalogItemId) setDragOverItemId(item.catalogItemId);}}
                onDragLeave={()=>{if(dragOverItemId===item.catalogItemId) setDragOverItemId(null);}}
                onDrop={(e)=>{e.preventDefault();if(canManage)handleDrop(item);}}
                title="Drag onto another item to merge them as the same product"
                style={{background:isDragOver?"#E8F5E9":"white",borderRadius:8,padding:"12px 14px",marginBottom:8,
                  boxShadow:isDragOver?"0 0 0 2px #2E7D32":"0 1px 3px rgba(0,0,0,0.06)",cursor:"grab",
                  opacity:draggedItemId===item.catalogItemId?0.4:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  {canManage&&<input type="checkbox" checked={selectedIds.has(item.catalogItemId)}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>setSelectedIds(prev=>{
                      const next=new Set(prev);
                      e.target.checked?next.add(item.catalogItemId):next.delete(item.catalogItemId);
                      return next;
                    })}
                    style={{marginRight:10,marginTop:3}} />}
                  <div style={{flex:1,minWidth:0}}>
                    {canManage&&renamingId===item.catalogItemId?(
                      <div style={{display:"flex",gap:6}} onClick={e=>e.stopPropagation()}>
                        <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter") saveRename(item.catalogItemId); if(e.key==="Escape") setRenamingId(null);}}
                          style={{...inp,fontSize:13,padding:"5px 8px",flex:1}} />
                        <button onClick={()=>saveRename(item.catalogItemId)} style={{...btn("#003584",undefined,{fontSize:11,padding:"5px 10px"})}}>Save</button>
                        <button onClick={()=>setRenamingId(null)} style={{...btn("#EEE","#555",{fontSize:11,padding:"5px 10px"})}}>✕</button>
                      </div>
                    ):(
                      <div style={{fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
                        {item.name}
                        {canManage&&<button onClick={()=>{setRenamingId(item.catalogItemId);setRenameValue(item.name);}}
                          title="Rename - this is your item, name it however makes sense to you"
                          style={{background:"none",border:"none",cursor:"pointer",color:"#BBB",fontSize:12,padding:0}}>✎</button>}
                      </div>
                    )}
                    {canManage&&categoryEditId===item.catalogItemId?(
                      <div style={{display:"flex",gap:6,alignItems:"center",marginTop:2}} onClick={e=>e.stopPropagation()}>
                        <span style={{fontSize:11,color:"#AAA"}}>{item.category} ·</span>
                        <select autoFocus defaultValue="" onChange={e=>handleAssignCategory(item.catalogItemId,e.target.value)}
                          onBlur={()=>setCategoryEditId(null)}
                          style={{...inp,fontSize:11,padding:"3px 6px",width:"auto"}}>
                          <option value="" disabled>Move to...</option>
                          {categories.filter(c=>c.name!==item.category).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </div>
                    ):(
                      <div style={{fontSize:11,color:"#AAA",marginTop:2,display:"flex",alignItems:"center",gap:4}}>
                        {item.category}
                        {canManage&&<button onClick={()=>setCategoryEditId(item.catalogItemId)} disabled={categoryEditBusy}
                          title="Move this item to a different category"
                          style={{background:"none",border:"none",cursor:"pointer",color:"#BBB",fontSize:11,padding:0}}>✎</button>}
                      </div>
                    )}
                  </div>
                  <span style={{fontSize:10,fontWeight:700,color:status.color,background:status.bg,padding:"3px 8px",borderRadius:5,whiteSpace:"nowrap"}}>{status.label}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8}}>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {item.options.map(o=>(
                      <span key={o.vendorId} title={orderable(o)?undefined:blockReason(o)} style={{fontSize:11,background:orderable(o)?"#F5F7FA":"#FFF3E0",borderRadius:5,padding:"3px 8px"}}>
                        {o.vendorName}: <b>{formatMoney(o.casePrice)}{!orderable(o)?" · "+blockReason(o):""}</b>
                        {orderable(o)&&o.perUnit&&<span style={{color:"#888",marginLeft:4}}>{formatMoney(o.perUnit.price)}/{o.perUnit.unit}</span>}
                      </span>
                    ))}
                    {!item.options.length&&<span style={{fontSize:11,color:"#CCC"}}>No vendor price linked yet</span>}
                  </div>
                  {canManage&&<button onClick={()=>setMapPanelOpenFor(mapPanelOpenFor===item.catalogItemId?null:item.catalogItemId)}
                    title="Map this item's vendor prices - link, unlink, or re-point any of them, any time"
                    style={{background:"none",border:"none",cursor:"pointer",color:"#003584",fontSize:11,fontWeight:700,padding:0,whiteSpace:"nowrap",marginLeft:8}}>
                    Vendor products {mapPanelOpenFor===item.catalogItemId?"▲":"▾"}
                  </button>}
                </div>

                {canManage&&mapPanelOpenFor===item.catalogItemId&&(
                  <div style={{marginTop:8,background:"#F7F9FC",borderRadius:6,padding:8}} onClick={e=>e.stopPropagation()}>
                    {(()=>{
                      // Brands come from this item's own vendor options - a lock can
                      // only ever name a brand some vendor actually lists.
                      const brands=[...new Set(item.options.map(o=>String(o.brand||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
                      const units=item.unitDimension?unitsForDimension(item.unitDimension):[];
                      const sel={...inp,fontSize:11,padding:"4px 6px",width:"auto"};
                      const lbl={fontSize:10,fontWeight:700,color:"#AAA",letterSpacing:"0.06em",textTransform:"uppercase"};
                      return (
                        <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"flex-end",background:"white",border:"1px solid #EEE",borderRadius:6,padding:"8px 10px",marginBottom:8}}>
                          <div>
                            <div style={lbl}>Brand lock</div>
                            {brands.length?(
                              <select style={sel} value={item.lockedBrand||""}
                                onChange={e=>handleItemSetting(item.catalogItemId,{brand_locked:!!e.target.value,locked_brand:e.target.value||null})}>
                                <option value="">Any brand</option>
                                {brands.map(b=><option key={b} value={b}>{b}</option>)}
                              </select>
                            ):(
                              <div style={{fontSize:11,color:"#AAA",paddingTop:4}}>No vendor lists a brand for this item</div>
                            )}
                          </div>
                          <div>
                            <div style={lbl}>Vendor matching</div>
                            <select style={sel} value={item.matchingBehavior}
                              onChange={e=>handleItemSetting(item.catalogItemId,{matching_behavior:e.target.value})}>
                              <option value="flexible">Flexible — close matches link, flagged for review</option>
                              <option value="strict">Strict — only exact matches link</option>
                            </select>
                          </div>
                          <div>
                            <div style={lbl}>Compare per</div>
                            {units.length?(
                              <select style={sel} value={item.canonicalUnit||""}
                                onChange={e=>handleItemSetting(item.catalogItemId,{canonical_unit:e.target.value||null})}>
                                <option value="">Auto ({item.displayUnit||"—"})</option>
                                {units.map(u=><option key={u} value={u}>{u}</option>)}
                              </select>
                            ):(
                              <div style={{fontSize:11,color:"#AAA",paddingTop:4}}>{item.displayUnit?`per ${item.displayUnit}`:"No readable pack size yet"}</div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {item.options.length===0&&<div style={{fontSize:11,color:"#AAA",marginBottom:6}}>No vendor is currently linked to this item — it'll pick one up automatically the next time a price sheet mentions it, or wait for a manual link once a vendor item exists to point at.</div>}
                    {item.options.map(o=>(
                      <div key={o.vendorItemId} style={{background:"white",borderRadius:6,padding:8,marginBottom:6,border:"1px solid #EEE"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontSize:12,fontWeight:600}}>{o.vendorName}</div>
                          <div style={{fontSize:11,fontWeight:700,color:["similar","review"].includes(o.matchTrack)?"#B26A00":"#2E7D32"}}>
                            {["similar","review"].includes(o.matchTrack)?`🔍 ${o.matchConfidence}%`:"✓ exact"}
                          </div>
                        </div>
                        <div style={{fontSize:11,color:"#999",margin:"2px 0 6px"}}>"{o.description}"{o.brand?` · ${o.brand}`:""} · Pack: {o.packSize||"Not provided"} — {formatMoney(o.casePrice)}{!orderable(o)?` · ${blockReason(o)}`:""}{orderable(o)&&o.perUnit?` (${formatMoney(o.perUnit.price)}/${o.perUnit.unit})`:""}</div>
                        {remapOpenFor===o.mappingId?(
                          <div>
                            <input style={{...inp,marginBottom:6,fontSize:12,padding:"7px 9px"}} placeholder="Search for a product..." value={remapSearch} onChange={e=>setRemapSearch(e.target.value)} autoFocus />
                            <div style={{maxHeight:140,overflowY:"auto"}}>
                              {catalogItems.filter(ci=>{
                                if(ci.id===item.catalogItemId) return false;
                                const q=remapSearch.trim().toLowerCase();
                                if(!q) return true;
                                return ci.name.toLowerCase().includes(q);
                              }).slice(0,8).map(ci=>(
                                <button key={ci.id} disabled={busyMappingId===o.mappingId} onClick={()=>handleRemapExisting(o.mappingId,ci.id)}
                                  style={{display:"block",width:"100%",textAlign:"left",background:"white",border:"1px solid #EEE",borderRadius:5,padding:"6px 8px",marginBottom:4,fontSize:12,cursor:"pointer"}}>
                                  {ci.name}
                                </button>
                              ))}
                            </div>
                            <div style={{display:"flex",gap:6,marginTop:6}}>
                              <button disabled={busyMappingId===o.mappingId} onClick={()=>handleRemapNew(o.mappingId,o.description)}
                                style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 10px",flex:1})}}>Create a new catalog item for this vendor product</button>
                              <button onClick={()=>{setRemapOpenFor(null);setRemapSearch("");}} style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 10px"})}}>Cancel</button>
                            </div>
                          </div>
                        ):(
                          <button disabled={busyMappingId===o.mappingId} onClick={()=>{setRemapOpenFor(o.mappingId);setRemapSearch("");}}
                            style={{...btn("#EEE","#555",{fontSize:11,padding:"6px 10px"})}}>Move this vendor product to another item</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {merging&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"white",borderRadius:10,padding:"14px 20px",fontSize:13,fontWeight:700}}>Merging items...</div>
        </div>
      )}
    </div>
  );
}
