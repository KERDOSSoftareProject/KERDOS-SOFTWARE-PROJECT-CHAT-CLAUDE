import {useState} from "react";
import {backend} from "../backend/index.js";
import {createCatalogRowsService} from "../services/catalog-rows.js";
import {CATALOG_COLUMNS,catalogRowEvidence,unitChoices} from "../core/catalog-fields.js";
import {parsePackSize} from "../procurement.js";
import {formatMoney} from "../localization.js";
import {btn,inp} from "../ui/styles.js";

const service=createCatalogRowsService(backend);
const cellStyle={padding:8,borderBottom:"1px solid #DEE7F0",verticalAlign:"top"};
const inputStyle={...inp,fontSize:12,padding:6,width:"100%",minWidth:85,boxSizing:"border-box"};
function Evidence({field}){return <small title={field.reason} style={{display:"block",marginTop:4,color:field.accuracy===100?"#38704E":"#8D5900"}}>{field.accuracy==null?"Not stated":`${field.accuracy}%`}</small>;}
function EditableRow({orgId,item,vendorItem,mapping,vendor,categories,vocabulary,packOptions,canManage,onUpdated,onDetails,onConfirm}){
  const [draft,setDraft]=useState({});
  const [base,setBase]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const [details,setDetails]=useState(false);
  const [packParts,setPackParts]=useState(null);
  const [customPack,setCustomPack]=useState(false);
  const current={...(base||vendorItem),...draft};
  const categoryId=draft.category_id??item.category_id;
  const category=categories.find(c=>c.id===categoryId);
  const evidence=catalogRowEvidence({item:{...item,category_review:'category_id' in draft?!!category?.is_holding_pen:item.category_review},vendorItem:current,mapping,vendor,category});
  const units=unitChoices(vocabulary),packUnits=unitChoices(vocabulary,true);
  const dirty=Object.keys(draft).length>0;
  const readyForGuide=!dirty&&!busy&&evidence.unitCost.value!=null&&evidence.category.accuracy===100&&
    !vendorItem.price_unavailable&&vendorItem.price_source!=="invoice";
  function edit(key,value){setBase(b=>b||vendorItem);setDraft(d=>({...d,[key]:value}));setSaved(false);setError("");}
  function openPackEditor(){
    const parsed=parsePackSize(current.pack_size);
    setCustomPack(true);setDetails(true);
    setPackParts({count:parsed?.caseQty||"",size:parsed?.unitQty||"",unit:parsed?.unit||"EA",catchWeight:!!parsed?.catchWeight});
  }
  async function save(){
    setBusy(true);setError("");
    try{await service.save({organizationId:orgId,vendorItem:base||vendorItem,mapping,patch:draft});setDraft({});setBase(null);setPackParts(null);setCustomPack(false);setSaved(true);await onUpdated();}
    catch(err){setError(err.message||String(err));}
    finally{setBusy(false);}
  }
  const fields={product:"description",brand:"brand",price:"price"};
  function packEdit(key,value){
    const parts={...packParts,[key]:value};setPackParts(parts);
    if(Number(parts.count)>0&&Number(parts.size)>0&&parts.unit)edit("pack_size",`${parts.count}/${parts.size} ${parts.unit}${parts.catchWeight?" AVG":""}`);
  }
  return <>
    <tr style={{background:dirty?"#FFFDF3":"white"}}>
      {CATALOG_COLUMNS.map(([key])=>{
        const f=evidence[key];let content;
        if(key==="itemNumber")content=<><b>#{f.value}</b><small style={{display:"block"}}>Vendor #{vendorItem.vendor_item_code||"—"}</small></>;
        else if(key==="vendor")content=f.value;
        else if(key==="category")content=<select aria-label={`Category for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:130}} disabled={!canManage||busy} value={categoryId||""} onChange={e=>edit("category_id",e.target.value)}><option value="" disabled>Choose category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>;
        else if(key==="pack")content=<><select aria-label={`Pack for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:135}} disabled={!canManage||busy} value={current.pack_size||""} onChange={e=>e.target.value==="__custom__"?openPackEditor():edit("pack_size",e.target.value)}><option value="">Select pack</option>{current.pack_size&&!packOptions.includes(current.pack_size)&&<option value={current.pack_size}>{current.pack_size}</option>}{packOptions.map(pack=><option key={pack} value={pack}>{pack}</option>)}<option value="__custom__">Enter another pack…</option></select>{canManage&&<button style={{border:0,background:"none",color:"#245785",cursor:"pointer",fontSize:11}} onClick={openPackEditor}>Set pack quantities</button>}{customPack&&<input aria-label={`Custom pack for ${vendorItem.vendor_item_code}`} style={{...inputStyle,marginTop:4}} disabled={busy} value={current.pack_size||""} placeholder="e.g. 4/10 LB" onChange={e=>edit("pack_size",e.target.value)}/>}</>;
        else if(fields[key])content=<input aria-label={`${key} for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:key==="product"?220:95}} disabled={!canManage||busy} type={key==="price"?"number":"text"} step={key==="price"?"any":undefined} min={key==="price"?"0":undefined} value={current[fields[key]]??""} placeholder={key==="brand"?"Blank if absent":""} onChange={e=>edit(fields[key],e.target.value)} />;
        else if(key==="sellingUnit")content=<select aria-label={`Quoted per for ${vendorItem.vendor_item_code}`} style={{...inputStyle,minWidth:140}} disabled={!canManage||busy} value={current.selling_unit||""} onChange={e=>edit("selling_unit",e.target.value)}><option value="">Select unit</option>{current.selling_unit&&!units.some(u=>u.value===current.selling_unit)&&<option value={current.selling_unit}>{current.selling_unit}</option>}{units.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</select>;
        else content=f.value==null?<small style={{color:"#8D5900"}}>Enter price, pack and quoted unit to calculate</small>:<><b>{formatMoney(f.value)}</b><small style={{display:"block"}}>per {f.unit}{dirty?" · preview":""}</small></>;
        const sourceKey={product:"description",pack:"packSize",sellingUnit:"sellingUnit"}[key]||key;
        const change=vendorItem.import_row?.reviewRequired&&vendorItem.import_row?.changes?.find(c=>c.field===sourceKey);
        return <td key={key} style={{...cellStyle,background:change?"#FFF3E0":undefined}}>{content}<Evidence field={f}/>{change&&<small style={{display:"block",color:"#9B4400"}} title={change.reason}>Changed on new sheet</small>}</td>;
      })}
      <td style={{...cellStyle,minWidth:115}}>
        {canManage&&<button disabled={!dirty||busy} onClick={save} style={{...btn("#003584","white",{fontSize:11,padding:6})}}>{busy?"Applying…":"Apply changes"}</button>}
        {dirty&&<button disabled={busy} onClick={()=>{setDraft({});setBase(null);setPackParts(null);setCustomPack(false);setError("");}} style={{border:0,background:"none",cursor:"pointer",fontSize:11}}>Undo edits</button>}
        {canManage&&mapping.comparison_track!=="exact"&&<button disabled={!readyForGuide} onClick={()=>onConfirm(mapping.id)} style={{...btn("#E8F5E9","#276742",{display:"block",fontSize:11,padding:6,marginTop:5})}}>Add to Order Guide</button>}
        {canManage&&mapping.comparison_track!=="exact"&&!readyForGuide&&<small style={{display:"block",color:"#8D5900"}}>Apply changes and resolve the quoted unit, pack, category and price first.</small>}
        <button onClick={()=>setDetails(!details)} style={{display:"block",marginTop:6,border:0,background:"none",cursor:"pointer",color:"#245785"}}>Details</button>
        {vendorItem.import_row?.reviewRequired&&<small style={{display:"block",color:"#9B4400"}}>New quote needs review</small>}
        {saved&&<small role="status" style={{color:"#276742"}}>Saved</small>}
        {error&&<div role="alert" style={{fontSize:11,color:"#A32B20",whiteSpace:"normal"}}>{error}</div>}
      </td>
    </tr>
    {details&&<tr><td colSpan={10} style={{...cellStyle,background:"#F2F6FA"}}>
      {packParts&&<div style={{display:"flex",gap:12,alignItems:"end",marginBottom:10}}>
        <label>Inner items per case<input type="number" min="1" aria-label="Inner items per case" style={inputStyle} value={packParts.count} onChange={e=>packEdit("count",e.target.value)} /></label>
        <label>Size of each<input type="number" min="0" step="any" aria-label="Size of each" style={inputStyle} value={packParts.size} onChange={e=>packEdit("size",e.target.value)} /></label>
        {packParts.catchWeight&&<span style={{fontSize:12,color:"#8D5900"}}>Average weight retained</span>}
        <label>Measurement<select style={inputStyle} aria-label="Pack measurement" value={packParts.unit} onChange={e=>packEdit("unit",e.target.value)}>{!packUnits.some(u=>u.value===packParts.unit)&&<option value={packParts.unit}>{packParts.unit}</option>}{packUnits.map(u=><option key={u.value} value={u.value}>{u.label}</option>)}</select></label>
      </div>}
      {vendorItem.import_row?.reviewRequired&&<div style={{background:"#FFF3E0",padding:10,fontSize:12,marginBottom:10}}>
        <b>Incoming quote: {formatMoney(vendorItem.import_row.row?.price)} · pack {vendorItem.import_row.row?.packSize||"not stated"} · per {vendorItem.import_row.row?.sellingUnit||"not stated"}</b>
        <div>{(vendorItem.import_row.conflicts||[]).join(" ")}</div>
        {canManage&&<button disabled={busy} onClick={()=>{const r=vendorItem.import_row.row;edit("price",r.price??"");if(r.description)edit("description",r.description);if(r.brand)edit("brand",r.brand);if(r.packSize)edit("pack_size",r.packSize);edit("selling_unit",r.sellingUnit||"");}} style={{...btn("#FFF","#875200",{fontSize:11,marginTop:6})}}>Review incoming values in this row</button>}
        {canManage&&<button disabled={busy} onClick={()=>{if(window.confirm("Keep the saved product, brand, pack and quoted unit, and accept this incoming amount on that basis?"))edit("price",vendorItem.import_row.row?.price??"");}} style={{...btn("#FFF","#875200",{fontSize:11,marginLeft:8,marginTop:6})}}>Keep saved fields; review new price</button>}
      </div>}
      <div style={{fontSize:12}}>Source: {vendorItem.import_row?.row?.sourceLine||"Original source is available under Price Sheets."}</div>
      <div style={{fontSize:11,marginTop:6}}>Percentages show what has been read or confirmed. They are status indicators, not a guarantee that the vendor supplied correct information.</div>
      <ul style={{fontSize:12}}>{CATALOG_COLUMNS.map(([key,label])=><li key={key}><b>{label}:</b> {evidence[key].reason}</li>)}</ul>
      <button disabled={dirty||busy} onClick={onDetails} style={{...btn("#E8F1FB","#003584",{fontSize:11})}}>Vendor comparison and association details</button>
    </td></tr>}
  </>;
}
export function CatalogRows({orgId,items,catalogItems,vendorItems,mappings,vendors,categories,vocabulary,canManage,onUpdated,onDetails,onConfirm}){
  const [sort,setSort]=useState({key:"product",direction:1});
  const packOptions=[...new Set(vendorItems.map(vi=>String(vi.pack_size||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const catalog=new Map(catalogItems.map(i=>[i.id,i])),viById=new Map(vendorItems.map(v=>[v.id,v])),vendorById=new Map(vendors.map(v=>[v.id,v]));
  const visible=new Set(items.map(i=>i.catalogItemId));
  const rows=mappings.filter(m=>visible.has(m.catalog_item_id)).flatMap(mapping=>{
    const item=catalog.get(mapping.catalog_item_id),vendorItem=viById.get(mapping.vendor_item_id);if(!item||!vendorItem)return [];
    const vendor=vendorById.get(vendorItem.vendor_id),category=categories.find(c=>c.id===item.category_id);
    return [{mapping,item,vendorItem,vendor,evidence:catalogRowEvidence({item,vendorItem,vendor,mapping,category})}];
  }).sort((a,b)=>{
    const av=a.evidence[sort.key].value,bv=b.evidence[sort.key].value;
    if(av==null)return bv==null?0:1;if(bv==null)return -1;
    return sort.direction*(typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true}));
  });
  const linked=new Set(rows.map(r=>r.item.id));
  return <div style={{overflowX:"auto",borderRadius:10,background:"white",marginBottom:16}}>
    <div style={{padding:12,fontSize:12}}>Correct any cell, then save its row. Missing fields can be completed later.</div>
    <table style={{borderCollapse:"collapse",width:"100%",minWidth:1250,fontSize:12}}><thead><tr>{CATALOG_COLUMNS.map(([key,label])=><th key={key} style={{...cellStyle,textAlign:"left",background:"#E8F0FA"}} aria-sort={sort.key===key?sort.direction===1?"ascending":"descending":"none"}><button style={{border:0,background:"none",fontWeight:700,cursor:"pointer"}} onClick={()=>setSort(s=>({key,direction:s.key===key?-s.direction:1}))}>{label}{sort.key===key?sort.direction===1?" ↑":" ↓":""}</button></th>)}<th style={cellStyle}>Actions</th></tr></thead>
      <tbody>{rows.map(row=><EditableRow key={row.vendorItem.id} {...row} orgId={orgId} categories={categories} vocabulary={vocabulary} packOptions={packOptions} canManage={canManage} onUpdated={onUpdated} onConfirm={onConfirm} onDetails={()=>onDetails(row.item.id)} />)}
      {items.filter(i=>!linked.has(i.catalogItemId)).map(i=><tr key={i.catalogItemId}><td style={cellStyle}>#{i.masterItemNumber}</td><td colSpan={8} style={cellStyle}>{i.name} · No vendor listing linked yet.</td><td><button onClick={()=>onDetails(i.catalogItemId)}>Details</button></td></tr>)}
      </tbody>
    </table>
  </div>;
}
