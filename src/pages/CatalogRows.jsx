import {useState,useMemo} from "react";
import {backend} from "../backend/index.js";
import {createCatalogRowsService} from "../services/catalog-rows.js";
import {CATALOG_COLUMNS,catalogRowEvidence,unitChoices,orderGuideAssessment,qualificationSummary,BLOCKER_LABELS} from "../core/catalog-fields.js";
import {parsePackSize,priceBasisFor,casePriceFromQuote} from "../procurement.js";
import {formatMoney} from "../localization.js";
import {vendorListingLabel} from "../core/vendor-listing.js";
import {btn,inp} from "../ui/styles.js";

const service=createCatalogRowsService(backend);
const cellStyle={padding:8,borderBottom:"1px solid #DEE7F0",verticalAlign:"top"};
const inputStyle={...inp,fontSize:12,padding:6,width:"100%",minWidth:85,boxSizing:"border-box"};
// A percentage only where there is a value; an empty cell is simply empty.
function Evidence({field}){
  if(field.accuracy==null||field.value==null||field.value==="")return <small style={{display:"block",marginTop:4,color:"#8D5900"}}>Empty</small>;
  const color=field.accuracy>=90?"#38704E":field.accuracy>=70?"#8D5900":"#B03A2E";
  return <small title={field.reason} style={{display:"block",marginTop:4,color}}>{field.accuracy}%</small>;
}
function EditableRow({orgId,item,vendorItem,mapping,vendor,categories,vocabulary,canManage,onUpdated,onDetails,peers=[],settings={}}){
  const [draft,setDraft]=useState({});
  const [nameDraft,setNameDraft]=useState(null);
  const [base,setBase]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [details,setDetails]=useState(false);
  const [packParts,setPackParts]=useState(null);
  const original=base||vendorItem;
  const resolutions={...original.field_resolutions};
  const sourceKeys={pack_size:"packSize",selling_unit:"sellingUnit"};
  for(const key of Object.keys(draft))if(!["category_id","item_name"].includes(key))resolutions[key]={value:draft[key],
    sourceValue:resolutions[key]?.sourceValue??original.import_row?.row?.[sourceKeys[key]||key]??original[key]};
  const current={...original,...draft,field_resolutions:resolutions};
  if(["price","pack_size","selling_unit"].some(key=>Object.hasOwn(draft,key))){
    const basis=priceBasisFor(current.selling_unit);
    current.price_basis=basis?.basis||null;
    current.price_unavailable=!(basis&&Number(current.price)>0&&parsePackSize(current.pack_size)?.parsed&&casePriceFromQuote(current.price,basis.basis,basis.unit||current.selling_unit,current.pack_size)!=null);
  }
  const categoryId=draft.category_id??item.category_id;
  const category=categories.find(c=>c.id===categoryId);
  const evidenceItem={...item,category_id:categoryId,category_review:'category_id' in draft?!!category?.is_holding_pen:item.category_review};
  const evidence=catalogRowEvidence({item:evidenceItem,vendorItem:current,mapping,vendor,category,peers,categories});
  const assessment=orderGuideAssessment({item:evidenceItem,vendorItem:current,mapping,vendor,category,peers,categories,settings});
  const units=unitChoices(vocabulary),packUnits=unitChoices(vocabulary,true);
  const nameDirty=nameDraft!=null&&nameDraft.trim()!==(item.name||"");
  const dirty=Object.keys(draft).length>0||nameDirty;
  function edit(key,value){setBase(b=>b||vendorItem);setDraft(d=>({...d,[key]:value}));setSaved(false);setError("");}
  const parsedPack=parsePackSize(current.pack_size);
  const countPack=parsedPack?.parsed&&["EA","CT"].includes(parsedPack.unit);
  const inferredCount=parsedPack?.parsed?(countPack?parsedPack.total:parsedPack.caseQty):"";
  const inferredType=parsedPack?.parsed?(inferredCount>1||String(current.pack_size).includes("/")?"case":"each"):"";
  const shownPack=packParts||{type:inferredType,count:inferredCount,size:countPack?1:parsedPack?.parsed?parsedPack.unitQty:1,unit:countPack?"EA":parsedPack?.parsed?parsedPack.unit:"EA",catchWeight:!!parsedPack?.catchWeight};
  function changePack(key,value){
    const parts={...shownPack,[key]:value};
    if(key==="type"&&value==="each")parts.count=1;
    setPackParts(parts);
    if(parts.type&&Number(parts.count)>0&&Number.isInteger(Number(parts.count))&&Number(parts.size)>0&&parts.unit)
      edit("pack_size",parts.type==="each"?`${parts.size} ${parts.unit}${parts.catchWeight?" AVG":""}`:`${parts.count}/${parts.size} ${parts.unit}${parts.catchWeight?" AVG":""}`);
    else edit("pack_size","");
  }
  async function save(){
    setBusy(true);setError("");
    try{
      // One write: the row's fields and the client's item name land
      // together or not at all.
      const patch={...draft,...(nameDirty?{item_name:nameDraft.trim()}:{})};
      await service.save({organizationId:orgId,vendorItem:base||vendorItem,mapping,patch});
      setDraft({});setNameDraft(null);setBase(null);setPackParts(null);setSaved(true);await onUpdated();
    }
    catch(err){setError(err.message||String(err));}
    finally{setBusy(false);}
  }
  const fields={product:"description",brand:"brand",price:"price"};
  return <>
    <tr style={{background:dirty?"#FFFDF3":"white"}}>
      {CATALOG_COLUMNS.map(([key])=>{
        const f=evidence[key];let content;
        if(key==="itemNumber")content=<b>#{f.value}</b>;
        else if(key==="vendor")content=<><b>{f.value}</b><small style={{display:"block"}}>{vendorItem.vendor_item_code?`Vendor #${vendorItem.vendor_item_code}`:vendorListingLabel(vendorItem)||"NVIM pending"}</small></>;
        else if(key==="category")content=<select aria-label={`Category for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:130}} disabled={!canManage||busy} value={categoryId||""} onChange={e=>edit("category_id",e.target.value)}><option value="" disabled>Choose category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>;
        else if(key==="pack")content=<>
          <select aria-label={`Pack for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:100}} disabled={!canManage||busy} value={shownPack.type} onChange={e=>changePack("type",e.target.value)}>
            <option value="" disabled>Select</option><option value="case">Case</option><option value="each">Each</option>
          </select>
          {shownPack.type&&<label style={{display:"block",marginTop:4}}>Count<input aria-label={`Count for ${vendorItem.vendor_item_code}`} type="number" min="1" step="1" style={inputStyle} disabled={!canManage||busy||shownPack.type==="each"} value={shownPack.type==="each"?1:shownPack.count} onChange={e=>changePack("count",e.target.value)}/></label>}
          {!parsedPack?.parsed&&current.pack_size&&<small style={{display:"block"}}>From sheet: {current.pack_size}</small>}
          {shownPack.unit!=="EA"&&<small style={{display:"block"}}>Each: {shownPack.size} {shownPack.unit}{shownPack.catchWeight?" (average)":""}</small>}
        </>;
        else if(key==="itemName")content=<input aria-label={`Item name for ${item.master_item_number}`} style={{...inputStyle,minWidth:180,fontWeight:700}} disabled={!canManage||busy} value={nameDraft??item.name??""} placeholder="Your name for this product" onChange={e=>setNameDraft(e.target.value)} />;
        else if(fields[key])content=<input aria-label={`${key} for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:key==="product"?220:95}} disabled={!canManage||busy} type={key==="price"?"number":"text"} step={key==="price"?"any":undefined} min={key==="price"?"0":undefined} value={current[fields[key]]??""} placeholder={key==="brand"?"Blank if absent":""} onChange={e=>edit(fields[key],e.target.value)} />;
        else if(key==="sellingUnit")content=<select aria-label={`Quoted per for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:140}} disabled={!canManage||busy} value={current.selling_unit||""} onChange={e=>edit("selling_unit",e.target.value)}><option value="">Select unit</option>{current.selling_unit&&!units.some(u=>u.value===current.selling_unit)&&<option value={current.selling_unit}>{current.selling_unit}</option>}{units.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</select>;
        else content=f.value==null?<span style={{color:"#8D5900",fontWeight:700}}>Undetermined</span>:<><b>{formatMoney(f.value)}</b><small style={{display:"block"}}>per {f.unit}{dirty?" · preview":""}</small></>;
        const sourceKey={product:"description",pack:"packSize",sellingUnit:"sellingUnit"}[key]||key;
        const change=vendorItem.import_row?.reviewRequired&&vendorItem.import_row?.changes?.find(c=>c.field===sourceKey);
        return <td key={key} style={{...cellStyle,background:change?"#FFF3E0":undefined}}>{content}<Evidence field={f}/>{change&&<small style={{display:"block",color:"#9B4400"}} title={change.reason}>Changed on new sheet</small>}</td>;
      })}
      <td style={{...cellStyle,minWidth:115}}>
        {canManage&&<button disabled={!dirty||busy} onClick={save} style={{...btn("#003584","white",{fontSize:11,padding:6})}}>{busy?"Applying…":"Apply changes"}</button>}
        {dirty&&<button disabled={busy} onClick={()=>{setDraft({});setNameDraft(null);setBase(null);setPackParts(null);setError("");}} style={{border:0,background:"none",cursor:"pointer",fontSize:11}}>Undo edits</button>}
        <button onClick={()=>setDetails(!details)} style={{display:"block",marginTop:6,border:0,background:"none",cursor:"pointer",color:"#245785"}}>Details</button>
        {vendorItem.import_row?.reviewRequired&&<small style={{display:"block",color:"#9B4400"}}>New quote needs review</small>}
        {saved&&<small role="status" style={{color:"#276742"}}>Saved</small>}
        {error&&<div role="alert" style={{fontSize:11,color:"#A32B20",whiteSpace:"normal"}}>{error}</div>}
      </td>
    </tr>
    {details&&<tr><td colSpan={11} style={{...cellStyle,background:"#F2F6FA"}}>
      <div style={{fontWeight:700,marginBottom:10}}>{assessment.ready?"Meets Order Guide field requirements":"Waiting on: "+assessment.blockers.map(code=>BLOCKER_LABELS[code]).join("; ")}{dirty?" (unsaved preview)":""}</div>
      {shownPack.type&&<div style={{display:"flex",gap:12,alignItems:"end",marginBottom:10}}>
        <label>Weight or volume of each<input type="number" min="0.001" step="any" aria-label="Size of each" style={inputStyle} disabled={!canManage||busy} value={shownPack.size} onChange={e=>changePack("size",e.target.value)}/></label>
        <label>Measurement<select style={inputStyle} aria-label="Pack measurement" disabled={!canManage||busy} value={shownPack.unit} onChange={e=>changePack("unit",e.target.value)}>{!packUnits.some(u=>u.value===shownPack.unit)&&<option value={shownPack.unit}>{shownPack.unit}</option>}{packUnits.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
        {shownPack.catchWeight&&<span>Average weight retained</span>}
      </div>}
      <small style={{display:"block",marginBottom:10}}>Case count is the number of eaches inside. Each always has count 1. Weight or volume is separate; Quoted per tells us how the vendor charges.</small>
      {vendorItem.import_row?.reviewRequired&&<div style={{background:"#FFF3E0",padding:10,fontSize:12,marginBottom:10}}>
        <b>Incoming quote: {formatMoney(vendorItem.import_row.row?.price)} · pack {vendorItem.import_row.row?.packSize||"not stated"} · per {vendorItem.import_row.row?.sellingUnit||"not stated"}</b>
        <div>{(vendorItem.import_row.conflicts||[]).join(" ")}</div>
        {canManage&&<button disabled={busy} onClick={()=>{const r=vendorItem.import_row.row;edit("price",r.price??"");if(r.description)edit("description",r.description);if(r.brand)edit("brand",r.brand);if(r.packSize)edit("pack_size",r.packSize);edit("selling_unit",r.sellingUnit||"");}} style={{...btn("#FFF","#875200",{fontSize:11,marginTop:6})}}>Review incoming values in this row</button>}
        {canManage&&<button disabled={busy} onClick={()=>{if(window.confirm("Keep the saved product, brand, pack and quoted unit, and accept this incoming amount on that basis?"))edit("price",vendorItem.import_row.row?.price??"");}} style={{...btn("#FFF","#875200",{fontSize:11,marginLeft:8,marginTop:6})}}>Keep saved fields; review new price</button>}
      </div>}
      <div style={{fontSize:12}}>Source: {vendorItem.import_row?.row?.sourceLine||"Original source is available under Price Sheets."}</div>
      <div style={{fontSize:11,marginTop:6}}>Percentages show how well each value holds up against the rest of the row, the vendor's history and your other vendors. A blank cell has no percentage; it is simply empty.</div>
      <ul style={{fontSize:12}}>{CATALOG_COLUMNS.map(([key,label])=><li key={key}><b>{label}:</b> {evidence[key].reason}</li>)}</ul>
      <button disabled={dirty||busy} onClick={onDetails} style={{...btn("#E8F1FB","#003584",{fontSize:11})}}>Vendor comparison and association details</button>
    </td></tr>}
  </>;
}
export function CatalogRows({orgId,items,catalogItems,vendorItems,mappings,vendors,categories,vocabulary,canManage,onUpdated,onDetails,settings={}}){
  const summary=useMemo(()=>qualificationSummary({catalogItems,vendorItems,mappings,vendors,categories,settings}),[catalogItems,vendorItems,mappings,vendors,categories,settings]);
  const [sort,setSort]=useState({key:"product",direction:1});
  const catalog=new Map(catalogItems.map(i=>[i.id,i])),viById=new Map(vendorItems.map(v=>[v.id,v])),vendorById=new Map(vendors.map(v=>[v.id,v]));
  const visible=new Set(items.map(i=>i.catalogItemId));
  const rows=mappings.filter(m=>visible.has(m.catalog_item_id)).flatMap(mapping=>{
    const item=catalog.get(mapping.catalog_item_id),vendorItem=viById.get(mapping.vendor_item_id);if(!item||!vendorItem)return [];
    const vendor=vendorById.get(vendorItem.vendor_id),category=categories.find(c=>c.id===item.category_id);
    // The other vendors' rows on this item, for cross-vendor checks.
    const peers=mappings.filter(o=>o.catalog_item_id===mapping.catalog_item_id&&o.id!==mapping.id).map(o=>viById.get(o.vendor_item_id)).filter(Boolean);
    return [{mapping,item,vendorItem,vendor,peers,evidence:catalogRowEvidence({item,vendorItem,vendor,mapping,category,peers,categories})}];
  }).sort((a,b)=>{
    const av=a.evidence[sort.key].value,bv=b.evidence[sort.key].value;
    if(av==null)return bv==null?0:1;if(bv==null)return -1;
    return sort.direction*(typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true}));
  });
  const linked=new Set(rows.map(r=>r.item.id));
  return <div style={{overflowX:"auto",borderRadius:10,background:"white",marginBottom:16}}>
    <div style={{padding:12,fontSize:12}}>Correct any cell, then save its row. Missing fields can be completed later.
      <details style={{marginTop:8}}><summary>{summary.ready} of {summary.total} vendor rows meet Order Guide requirements · {summary.blocked} need evidence</summary>
        <p>All required fields need at least 90%, a verified product association and a current quote. A row can have more than one blocker.</p>
        <ul>{summary.blockers.map(blocker=><li key={blocker.code}>{blocker.label}: {blocker.count}</li>)}</ul>
      </details>
    </div>
    <table style={{borderCollapse:"collapse",width:"100%",minWidth:1250,fontSize:12}}><thead><tr>{CATALOG_COLUMNS.map(([key,label])=><th key={key} style={{...cellStyle,textAlign:"left",background:"#E8F0FA"}} aria-sort={sort.key===key?sort.direction===1?"ascending":"descending":"none"}><button style={{border:0,background:"none",fontWeight:700,cursor:"pointer"}} onClick={()=>setSort(s=>({key,direction:s.key===key?-s.direction:1}))}>{label}{sort.key===key?sort.direction===1?" ↑":" ↓":""}</button></th>)}<th style={cellStyle}>Actions</th></tr></thead>
      <tbody>{rows.map(row=><EditableRow settings={settings} key={row.vendorItem.id} {...row} orgId={orgId} categories={categories} vocabulary={vocabulary} canManage={canManage} onUpdated={onUpdated} onDetails={()=>onDetails(row.item.id)} />)}
      {items.filter(i=>!linked.has(i.catalogItemId)).map(i=><tr key={i.catalogItemId}><td style={cellStyle}>#{i.masterItemNumber}</td><td colSpan={8} style={cellStyle}>{i.name} · No vendor listing linked yet.</td><td><button onClick={()=>onDetails(i.catalogItemId)}>Details</button></td></tr>)}
      </tbody>
    </table>
  </div>;
}
