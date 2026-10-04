import {useState} from "react";
import {backend} from "../backend/index.js";
import {calculatedUnitCost} from "../core/quote-controls.js";
import {unitLabel} from "../core/unit-labels.js";
import {formatMoney} from "../localization.js";
import {btn,inp} from "../ui/styles.js";
export function AssociateAlternatives({orgId,selectedVendorIds,vendorItems,catalogItems,mappings,vendors,onUpdated,onClear}){
 const [open,setOpen]=useState(false),[target,setTarget]=useState(""),[name,setName]=useState(""),[preferred,setPreferred]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const selected=vendorItems.filter(v=>selectedVendorIds.includes(v.id));
 const ids=new Set(mappings.filter(m=>selectedVendorIds.includes(m.vendor_item_id)).map(m=>m.catalog_item_id));
 const choices=catalogItems.filter(i=>ids.has(i.id));
 const brands=[...new Set(selected.map(v=>v.brand).filter(Boolean))];
 async function apply(){setBusy(true);setError("");try{
  if(!backend.catalog.associateAlternatives)throw new Error("This data provider does not support grouping alternatives yet.");
  await backend.catalog.associateAlternatives({organizationId:orgId,vendorItemIds:selected.map(v=>v.id),targetCatalogItemId:target,name,preferredBrand:preferred,revisions:Object.fromEntries(selected.map(v=>[v.id,v.row_revision||0]))});
  setOpen(false);onClear();await onUpdated();
 }catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><button disabled={selected.length<2} onClick={()=>{const first=choices[0];setTarget(first?.id||"");setName(first?.name||"");setPreferred("");setError("");setOpen(true);}} style={btn("#E8F1FB","#003584",{fontSize:12,margin:6})}>Associate selected ({selected.length})</button>
 {selected.length>0&&<button onClick={onClear} style={{fontSize:12}}>Clear selection</button>}
 {open&&<div role="dialog" aria-modal="true" aria-label="Associate alternatives" style={{position:"fixed",inset:0,background:"#0006",zIndex:1100,display:"grid",placeItems:"center"}}><div style={{background:"white",padding:24,borderRadius:10,maxWidth:680,width:"90vw",maxHeight:"85vh",overflowY:"auto"}}>
 <p>Approve these products as acceptable alternatives. They will share the selected KERDOS number and keep each vendor's brand, description and pack. Missing pricing details still need completion.</p>
 {selected.map(v=>{const cost=calculatedUnitCost(v);return <div key={v.id} style={{padding:7,borderBottom:"1px solid #ddd"}}>{vendors.find(x=>x.id===v.vendor_id)?.name} · {v.description} · {v.brand||"Brand not stated"} · {v.pack_size||"Pack missing"} · {cost?`${formatMoney(cost.price)} / ${unitLabel(cost.unit)}`:"Unit cost incomplete"}</div>;})}
 <label style={{display:"block",marginTop:12}}>Shared KERDOS item<select style={inp} value={target} onChange={e=>setTarget(e.target.value)}>{choices.map(i=><option key={i.id} value={i.id}>#{i.master_item_number} {i.name}</option>)}</select></label>
 <label style={{display:"block",marginTop:12}}>Item type<input style={inp} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label style={{display:"block",marginTop:12}}>Preferred brand (optional)<select style={inp} value={preferred} onChange={e=>setPreferred(e.target.value)}><option value="">No preference</option>{brands.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
 {error&&<p role="alert" style={{color:"#B42318"}}>{error}</p>}
 <button disabled={busy} onClick={apply} style={btn("#003584","white",{marginTop:16})}>{busy?"Associating…":"Approve alternatives"}</button><button disabled={busy} onClick={()=>setOpen(false)} style={{marginLeft:12}}>Cancel</button>
 </div></div>}</>;
}
