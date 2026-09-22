import React from "react";
import {quoteStatus} from "../procurement.js";

const button=(background,color="white")=>({background,color,border:"none",borderRadius:6,padding:"7px 11px",fontWeight:700,cursor:"pointer"});
const card={background:"white",borderRadius:9,marginBottom:8,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",overflow:"hidden"};

function VendorFilters({vendors,value,onChange,vendorColors}){
  return <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:18}}>
    <button onClick={()=>onChange(null)} style={{...button(value?"rgba(255,255,255,0.15)":"white",value?"white":"#003584"),border:"1px solid rgba(255,255,255,0.35)"}}>All vendors</button>
    {vendors.map(v=>{const color=vendorColors.get(v.id)||{accent:"#003584",bg:"#EEF4FF"};const selected=value===v.id;return <button key={v.id} onClick={()=>onChange(selected?null:v.id)} style={{...button(selected?color.accent:color.bg,selected?"white":color.accent),border:`1px solid ${selected?color.accent:"transparent"}`}}>{v.name}</button>;})}
  </div>;
}

function PageHeader({eyebrow,title,description,actionLabel,onAction,secondaryLabel,onSecondary}){
  return <div style={{background:"white",borderRadius:12,padding:18,marginBottom:16,boxShadow:"0 2px 8px rgba(0,0,0,0.12)"}}>
    <div style={{fontSize:10,fontWeight:800,color:"#4A90D9",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>{eyebrow}</div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:21,color:"#003584"}}>{title}</h2><div style={{fontSize:12,color:"#777"}}>{description}</div></div>
      <div style={{display:"flex",gap:8}}>
        {secondaryLabel&&<button onClick={onSecondary} style={button("#E8F5E9","#2E7D32")}>{secondaryLabel}</button>}
        {actionLabel&&<button onClick={onAction} style={button("#003584")}>{actionLabel}</button>}
      </div>
    </div>
  </div>;
}

export function InvoicesPage({vendors,invoices,vendorFilter,setVendorFilter,vendorColors,formatDate,formatMoney,
  attentionCount,onImport,onExport,onViewOriginal,onEdit,onDelete,expandedId,setExpandedId}){
  const groups=new Map();
  for(const invoice of invoices){
    const lines=invoice.invoice_lines||[];
    const flagged=lines.filter(line=>line.price_variance!=null&&Math.abs(line.price_variance)>0.009);
    const row={...invoice,_lines:lines,_flagged:flagged,_totalVariance:flagged.reduce((sum,line)=>sum+Number(line.price_variance||0),0)};
    const id=invoice.vendor_id||"unknown";
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  const vendorGroups=[...groups.entries()].map(([vendorId,rows])=>({vendorId,vendorName:rows[0]?.vendors?.name||vendors.find(v=>v.id===vendorId)?.name||"Unknown vendor",rows:rows.sort((a,b)=>new Date(b.invoice_date||b.created_at)-new Date(a.invoice_date||a.created_at))})).sort((a,b)=>a.vendorName.localeCompare(b.vendorName));
  const visible=vendorFilter?vendorGroups.filter(group=>group.vendorId===vendorFilter):vendorGroups;
  return <div>
    <PageHeader eyebrow="Purchasing records" title="Invoice History" description="Import invoices here. Files stay closed and organized by vendor and date until you double-click one." actionLabel="🧾 Import Invoice" onAction={()=>onImport(vendorFilter)} secondaryLabel="Export Variance Report" onSecondary={onExport}/>
    <VendorFilters vendors={vendors} value={vendorFilter} onChange={setVendorFilter} vendorColors={vendorColors}/>
    {attentionCount>0&&<div style={{background:"#FFF3E0",color:"#8A5A00",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:14}}>{attentionCount} invoice line{attentionCount===1?"":"s"} need review. Open the applicable invoice for details.</div>}
    {!visible.length?<div style={{...card,padding:34,textAlign:"center",color:"#888"}}>No invoices recorded yet. Use <b>Import Invoice</b> above.</div>:visible.map(group=>{
      const color=vendorColors.get(group.vendorId)||{accent:"#003584"};
      return <section key={group.vendorId} style={{marginBottom:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}><h3 style={{margin:0,fontSize:14,color:color.accent}}>{group.vendorName}</h3><button onClick={()=>onImport(group.vendorId)} style={button("white",color.accent)}>+ Import invoice</button></div>
        {group.rows.map(invoice=>{const open=expandedId===invoice.id;return <article key={invoice.id} style={card}>
          <div onDoubleClick={()=>setExpandedId(open?null:invoice.id)} title="Double-click to open invoice details" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,cursor:"pointer",userSelect:"none"}}>
            <div><div style={{fontWeight:800,fontSize:13}}>📄 {invoice.file_name||`Invoice${invoice.invoice_number?` #${invoice.invoice_number}`:""}`}</div><div style={{fontSize:11,color:"#888",marginTop:2}}>{formatDate(invoice.invoice_date)||formatDate(invoice.created_at)}{invoice.invoice_number?` · Invoice #${invoice.invoice_number}`:""} · Double-click to open</div>{invoice._flagged.length>0&&<div style={{fontSize:11,fontWeight:700,color:invoice._totalVariance>0?"#E65100":"#0A8A4B",marginTop:3}}>⚠ {formatMoney(Math.abs(invoice._totalVariance))} {invoice._totalVariance>0?"over":"under"} quoted</div>}</div>
            <div style={{display:"flex",alignItems:"center",gap:9}}><b>{formatMoney(invoice.total_amount)}</b><span style={{color:"#BBB"}}>{open?"▲":"▼"}</span><button onClick={event=>{event.stopPropagation();onEdit(invoice);}} style={{background:"none",border:"none",cursor:"pointer"}}>✎</button><button onClick={event=>{event.stopPropagation();onDelete(invoice);}} style={{background:"none",border:"none",color:"#E65100",fontSize:16,cursor:"pointer"}}>×</button></div>
          </div>
          {open&&<div style={{borderTop:"1px solid #EEE",padding:14,background:"#FAFAFA"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><b style={{fontSize:11,color:"#777"}}>INVOICE DETAILS</b>{invoice.file_path&&<button onClick={()=>onViewOriginal(invoice.file_path)} style={button("#003584")}>Open original file</button>}</div>
            {invoice._lines.map(line=><div key={line.id} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid #EEE",fontSize:12}}><div>{line.description}{!line.vendor_item_id&&<span style={{marginLeft:6,color:"#C62828"}}>⚠ no match</span>}{line.match_method==="fuzzy"&&<span style={{marginLeft:6,color:"#B26A00"}}>🔍 {line.match_confidence}% match</span>}</div><div style={{textAlign:"right"}}><b>{formatMoney(line.unit_price)}</b>{line.price_variance!=null&&<div style={{fontSize:10,color:Math.abs(line.price_variance)<0.009?"#0A8A4B":"#E65100"}}>{Math.abs(line.price_variance)<0.009?"matches quote ✓":`${line.price_variance>0?"+":""}${formatMoney(line.price_variance)} vs quote`}</div>}</div></div>)}
          </div>}
        </article>;})}
      </section>;
    })}
  </div>;
}

export function PriceSheetsPage({vendors,vendorItems,priceHistory,importDocuments,vendorFilter,setVendorFilter,vendorColors,
  formatDate,formatMoney,orgSettings,role,onImport,onExpireVendor,onExpireOne,onViewOriginal,onViewSource,
  expandedId,setExpandedId,unavailableCount,expiredCount,hasMore,loadingMore,onLoadMore}){
  const itemMap=new Map(vendorItems.map(item=>[item.id,item]));
  const entriesByDocument=new Map();
  const legacy=new Map();
  for(const price of priceHistory||[]){
    const item=itemMap.get(price.vendor_item_id);if(!item)continue;
    const entry={...price,description:price.source_description||item.description};
    if(price.source_document_id){if(!entriesByDocument.has(price.source_document_id))entriesByDocument.set(price.source_document_id,[]);entriesByDocument.get(price.source_document_id).push(entry);}
    else{const key=`legacy__${item.vendor_id}__${price.effective_date}__${price.source_file_name||""}`;if(!legacy.has(key))legacy.set(key,{id:key,vendorId:item.vendor_id,date:price.effective_date,fileName:price.source_file_name||"Imported price sheet",filePath:price.source_file_path,status:"complete",entries:[]});legacy.get(key).entries.push(entry);}
  }
  const documents=importDocuments.filter(doc=>doc.document_kind==="pricelist").map(doc=>({id:doc.id,vendorId:doc.vendor_id,date:doc.created_at,fileName:doc.file_name||"Imported price sheet",filePath:doc.file_path,status:doc.status,entries:entriesByDocument.get(doc.id)||[]}));
  const known=new Set(documents.map(doc=>doc.id));
  for(const [id,entries] of entriesByDocument){if(known.has(id)||!entries.length)continue;const first=entries[0],item=itemMap.get(first.vendor_item_id);documents.push({id,vendorId:item?.vendor_id,date:first.effective_date,fileName:first.source_file_name||"Imported price sheet",filePath:first.source_file_path,status:"complete",entries});}
  documents.push(...legacy.values());
  const groups=new Map();for(const doc of documents){if(!groups.has(doc.vendorId))groups.set(doc.vendorId,[]);groups.get(doc.vendorId).push(doc);}
  const vendorGroups=[...groups.entries()].map(([vendorId,docs])=>({vendorId,vendorName:vendors.find(v=>v.id===vendorId)?.name||"Unknown vendor",documents:docs.sort((a,b)=>new Date(b.date)-new Date(a.date))})).sort((a,b)=>a.vendorName.localeCompare(b.vendorName));
  const visible=vendorFilter?vendorGroups.filter(group=>group.vendorId===vendorFilter):vendorGroups;
  return <div>
    <PageHeader eyebrow="Vendor source files" title="Price Sheet History" description="Import price sheets here. History stays as closed files; products live once in Item Catalog and are not duplicated on this page." actionLabel={role!=="employee"?"📋 Import Price Sheet":null} onAction={()=>onImport(vendorFilter)}/>
    <VendorFilters vendors={vendors} value={vendorFilter} onChange={setVendorFilter} vendorColors={vendorColors}/>
    {(unavailableCount+expiredCount)>0&&<div style={{background:"#FFF3E0",color:"#8A5A00",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:14}}>{unavailableCount+expiredCount} price{unavailableCount+expiredCount===1?"":"s"} need attention. Items remain in Item Catalog; only unavailable or expired prices are blocked from ordering.</div>}
    {!visible.length?<div style={{...card,padding:34,textAlign:"center",color:"#888"}}>No price sheets imported yet. Use <b>Import Price Sheet</b> above.</div>:visible.map(group=>{const color=vendorColors.get(group.vendorId)||{accent:"#003584"};return <section key={group.vendorId} style={{marginBottom:18}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:7}}><h3 style={{margin:0,fontSize:14,color:color.accent}}>{group.vendorName}</h3>{role!=="employee"&&<div style={{display:"flex",gap:6}}><button onClick={()=>onExpireVendor(group.vendorId)} style={button("#FFF0ED","#C53D16")}>Remove current prices from Order Guide</button><button onClick={()=>onImport(group.vendorId)} style={button("white",color.accent)}>+ Import price sheet</button></div>}</div>
      {group.documents.map(doc=>{const key=String(doc.id),open=expandedId===key;return <article key={key} style={card}>
        <div onDoubleClick={()=>setExpandedId(open?null:key)} title="Double-click to open price-sheet details" style={{padding:14,display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",userSelect:"none"}}><div><div style={{fontWeight:800,fontSize:13}}>📄 {doc.fileName}</div><div style={{fontSize:11,color:"#888",marginTop:2}}>{formatDate(doc.date)} · {doc.entries.length} price row{doc.entries.length===1?"":"s"} · {doc.status} · Double-click to open</div></div><span style={{color:"#BBB"}}>{open?"▲":"▼"}</span></div>
        {open&&<div style={{borderTop:"1px solid #EEE",padding:14,background:"#FAFAFA"}}>{doc.filePath&&<button onClick={()=>onViewOriginal(doc.filePath)} style={{...button("#003584"),marginBottom:8}}>Open original file</button>}{doc.entries.map(entry=>{const item=itemMap.get(entry.vendor_item_id);const current=item&&quoteStatus(item,orgSettings||{})==="current"&&Number(item.price)===Number(entry.price);return <div key={entry.id} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:12,padding:"6px 0",borderBottom:"1px solid #EEE"}}><div>{entry.description}</div><div style={{textAlign:"right"}}><b>{formatMoney(entry.price)}</b>{entry.quote_valid_until&&<div style={{fontSize:10,color:"#999"}}>Valid through {formatDate(entry.quote_valid_until)}</div>}{entry.source_document_id&&<button onClick={()=>onViewSource(entry.source_document_id)} style={{display:"block",marginLeft:"auto",background:"none",border:"none",fontSize:10,color:"#003584",cursor:"pointer"}}>Original source ↗</button>}{current&&role!=="employee"&&<button onClick={()=>onExpireOne(item)} style={{display:"block",marginLeft:"auto",background:"none",border:"none",fontSize:10,fontWeight:700,color:"#E65100",cursor:"pointer"}}>Remove price from Order Guide</button>}</div></div>;})}</div>}
      </article>;})}
    </section>;})}
    {hasMore&&<button onClick={onLoadMore} disabled={loadingMore} style={button("white","#003584")}>{loadingMore?"Loading…":"Load earlier price-sheet history"}</button>}
  </div>;
}
