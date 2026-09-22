import React,{useState} from "react";
import {quoteStatus} from "../procurement.js";

const navy="#073B83",ink="#17243A",muted="#6D7A8B",line="#E4EAF1",surface="#F5F8FC";
const button=(background,color="white")=>({background,color,border:"1px solid transparent",borderRadius:9,padding:"10px 14px",fontWeight:800,cursor:"pointer",fontSize:12,boxShadow:"0 1px 2px rgba(16,35,61,.08)"});
const card={background:"white",borderRadius:12,marginBottom:8,border:`1px solid ${line}`,boxShadow:"0 3px 12px rgba(16,35,61,.05)",overflow:"hidden"};

function VendorFilter({vendors,value,onChange,label="View vendor"}){
  return <label style={{display:"flex",alignItems:"center",gap:10,fontSize:11,fontWeight:800,color:muted}}>{label}
    <select value={value||""} onChange={event=>onChange(event.target.value||null)} style={{minWidth:220,background:"white",color:ink,border:`1px solid ${line}`,borderRadius:9,padding:"9px 34px 9px 11px",fontWeight:700}}>
      <option value="">All vendors</option>{vendors.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  </label>;
}

function PageHeader({eyebrow,title,description,actionLabel,onAction,secondaryLabel,onSecondary}){
  return <div style={{background:"linear-gradient(135deg,#FFFFFF 0%,#F3F8FF 100%)",border:`1px solid ${line}`,borderRadius:16,padding:"22px 24px",marginBottom:14,boxShadow:"0 8px 28px rgba(16,35,61,.08)"}}>
    <div style={{fontSize:10,fontWeight:800,color:"#4A90D9",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:4}}>{eyebrow}</div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div><h2 style={{margin:"0 0 5px",fontSize:24,color:navy,letterSpacing:"-.02em"}}>{title}</h2><div style={{fontSize:12,color:muted,maxWidth:720,lineHeight:1.5}}>{description}</div></div>
      <div style={{display:"flex",gap:8}}>
        {secondaryLabel&&<button onClick={onSecondary} style={button("#E8F5E9","#2E7D32")}>{secondaryLabel}</button>}
        {actionLabel&&<button onClick={onAction} style={button("#003584")}>{actionLabel}</button>}
      </div>
    </div>
  </div>;
}

function MoreMenu({children,label="Vendor actions"}){
  const [open,setOpen]=useState(false);
  return <div style={{position:"relative"}}><button aria-label={label} title={label} onClick={()=>setOpen(!open)} style={{...button("white",navy),border:`1px solid ${line}`,padding:"7px 11px",fontSize:17,lineHeight:1}}>•••</button>
    {open&&<div onMouseLeave={()=>setOpen(false)} style={{position:"absolute",right:0,top:36,zIndex:5,minWidth:220,background:"white",border:`1px solid ${line}`,borderRadius:10,boxShadow:"0 12px 30px rgba(16,35,61,.18)",padding:6}}>{children}</div>}
  </div>;
}

function MenuButton({children,onClick,danger=false}){return <button onClick={onClick} style={{width:"100%",textAlign:"left",background:"transparent",color:danger?"#B53722":ink,border:0,borderRadius:7,padding:"9px 10px",fontWeight:700,cursor:"pointer"}}>{children}</button>;}

function VendorSection({name,count,accent,children,actions,defaultOpen=false}){
  const [open,setOpen]=useState(defaultOpen);
  return <section style={{...card,marginBottom:12}}>
    <div style={{height:4,background:accent||navy}}/>
    <div onClick={()=>setOpen(!open)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"15px 17px",cursor:"pointer",userSelect:"none"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{width:9,height:9,borderRadius:99,background:accent||navy}}/><div><h3 style={{margin:0,fontSize:15,color:ink}}>{name}</h3><div style={{fontSize:11,color:muted,marginTop:2}}>{count}</div></div></div>
      <div onClick={event=>event.stopPropagation()} style={{display:"flex",alignItems:"center",gap:10}}>{actions}<button onClick={()=>setOpen(!open)} aria-label={open?"Collapse vendor":"Open vendor"} style={{border:0,background:"transparent",color:muted,cursor:"pointer",fontSize:15}}>{open?"▲":"▼"}</button></div>
    </div>
    {open&&<div style={{background:surface,borderTop:`1px solid ${line}`,padding:12}}>{children}</div>}
  </section>;
}

function DocumentRow({title,meta,amount,warning,open,onToggle,children,controls}){
  return <article style={{...card,boxShadow:"none",marginBottom:8}}>
    <div onDoubleClick={onToggle} title="Double-click to open details" style={{padding:"13px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,cursor:"pointer",userSelect:"none"}}>
      <div style={{minWidth:0}}><div style={{fontWeight:800,fontSize:13,color:ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>▤ {title}</div><div style={{fontSize:11,color:muted,marginTop:3}}>{meta}</div>{warning}</div>
      <div style={{display:"flex",alignItems:"center",gap:11,flexShrink:0}}>{amount&&<b style={{fontSize:14,color:ink}}>{amount}</b>}{controls}<span style={{color:"#9AA6B5"}}>{open?"▲":"▼"}</span></div>
    </div>{open&&<div style={{borderTop:`1px solid ${line}`,padding:14,background:"#FBFCFE"}}>{children}</div>}
  </article>;
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
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"0 0 14px",padding:"10px 12px",background:"rgba(255,255,255,.10)",borderRadius:11}}><VendorFilter vendors={vendors} value={vendorFilter} onChange={setVendorFilter}/><span style={{fontSize:11,color:"rgba(255,255,255,.78)"}}>{visible.reduce((sum,group)=>sum+group.rows.length,0)} invoice file{visible.reduce((sum,group)=>sum+group.rows.length,0)===1?"":"s"}</span></div>
    {attentionCount>0&&<div style={{background:"#FFF3E0",color:"#8A5A00",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:14}}>{attentionCount} invoice line{attentionCount===1?"":"s"} need review. Open the applicable invoice for details.</div>}
    {!visible.length?<div style={{...card,padding:34,textAlign:"center",color:"#888"}}>No invoices recorded yet. Use <b>Import Invoice</b> above.</div>:visible.map(group=>{
      const color=vendorColors.get(group.vendorId)||{accent:"#003584"};
      return <VendorSection key={group.vendorId} name={group.vendorName} count={`${group.rows.length} invoice${group.rows.length===1?"":"s"}`} accent={color.accent} defaultOpen={Boolean(vendorFilter)} actions={<MoreMenu><MenuButton onClick={()=>onImport(group.vendorId)}>Import invoice for {group.vendorName}</MenuButton></MoreMenu>}>
        {group.rows.map(invoice=>{const open=expandedId===invoice.id;return <DocumentRow key={invoice.id} title={invoice.file_name||`Invoice${invoice.invoice_number?` #${invoice.invoice_number}`:""}`} meta={`${formatDate(invoice.invoice_date)||formatDate(invoice.created_at)}${invoice.invoice_number?` · Invoice #${invoice.invoice_number}`:""} · Double-click to open`} amount={formatMoney(invoice.total_amount)} open={open} onToggle={()=>setExpandedId(open?null:invoice.id)} warning={invoice._flagged.length>0&&<div style={{fontSize:11,fontWeight:700,color:invoice._totalVariance>0?"#C64A1B":"#0A7C48",marginTop:3}}>⚠ {formatMoney(Math.abs(invoice._totalVariance))} {invoice._totalVariance>0?"over":"under"} quoted</div>} controls={<><button onClick={event=>{event.stopPropagation();onEdit(invoice);}} title="Edit invoice" style={{background:"none",border:"none",cursor:"pointer",color:muted}}>✎</button><button onClick={event=>{event.stopPropagation();onDelete(invoice);}} title="Delete invoice" style={{background:"none",border:"none",color:"#C64A1B",fontSize:16,cursor:"pointer"}}>×</button></>}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}><b style={{fontSize:11,color:"#777"}}>INVOICE DETAILS</b>{invoice.file_path&&<button onClick={()=>onViewOriginal(invoice.file_path)} style={button("#003584")}>Open original file</button>}</div>
            {invoice._lines.map(line=><div key={line.id} style={{display:"flex",justifyContent:"space-between",gap:12,padding:"6px 0",borderBottom:"1px solid #EEE",fontSize:12}}><div>{line.description}{!line.vendor_item_id&&<span style={{marginLeft:6,color:"#C62828"}}>⚠ no match</span>}{line.match_method==="fuzzy"&&<span style={{marginLeft:6,color:"#B26A00"}}>🔍 {line.match_confidence}% match</span>}</div><div style={{textAlign:"right"}}><b>{formatMoney(line.unit_price)}</b>{line.price_variance!=null&&<div style={{fontSize:10,color:Math.abs(line.price_variance)<0.009?"#0A8A4B":"#E65100"}}>{Math.abs(line.price_variance)<0.009?"matches quote ✓":`${line.price_variance>0?"+":""}${formatMoney(line.price_variance)} vs quote`}</div>}</div></div>)}
        </DocumentRow>;})}
      </VendorSection>;
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
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"0 0 14px",padding:"10px 12px",background:"rgba(255,255,255,.10)",borderRadius:11}}><VendorFilter vendors={vendors} value={vendorFilter} onChange={setVendorFilter}/><span style={{fontSize:11,color:"rgba(255,255,255,.78)"}}>{visible.reduce((sum,group)=>sum+group.documents.length,0)} source file{visible.reduce((sum,group)=>sum+group.documents.length,0)===1?"":"s"}</span></div>
    {(unavailableCount+expiredCount)>0&&<div style={{background:"#FFF3E0",color:"#8A5A00",borderRadius:8,padding:"9px 12px",fontSize:12,marginBottom:14}}>{unavailableCount+expiredCount} price{unavailableCount+expiredCount===1?"":"s"} need attention. Items remain in Item Catalog; only unavailable or expired prices are blocked from ordering.</div>}
    {!visible.length?<div style={{...card,padding:34,textAlign:"center",color:"#888"}}>No price sheets imported yet. Use <b>Import Price Sheet</b> above.</div>:visible.map(group=>{const color=vendorColors.get(group.vendorId)||{accent:"#003584"};return <VendorSection key={group.vendorId} name={group.vendorName} count={`${group.documents.length} source file${group.documents.length===1?"":"s"}`} accent={color.accent} defaultOpen={Boolean(vendorFilter)} actions={role!=="employee"&&<MoreMenu><MenuButton onClick={()=>onImport(group.vendorId)}>Import price sheet</MenuButton><MenuButton danger onClick={()=>onExpireVendor(group.vendorId)}>Remove current prices from Order Guide</MenuButton></MoreMenu>}>
      {group.documents.map(doc=>{const key=String(doc.id),open=expandedId===key;return <DocumentRow key={key} title={doc.fileName} meta={`${formatDate(doc.date)} · ${doc.entries.length} price row${doc.entries.length===1?"":"s"} · ${doc.status} · Double-click to open`} open={open} onToggle={()=>setExpandedId(open?null:key)}>
        {doc.filePath&&<button onClick={()=>onViewOriginal(doc.filePath)} style={{...button("#003584"),marginBottom:8}}>Open original file</button>}{doc.entries.map(entry=>{const item=itemMap.get(entry.vendor_item_id);const current=item&&quoteStatus(item,orgSettings||{})==="current"&&Number(item.price)===Number(entry.price);return <div key={entry.id} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:12,padding:"7px 0",borderBottom:`1px solid ${line}`}}><div>{entry.description}</div><div style={{textAlign:"right"}}><b>{formatMoney(entry.price)}</b>{entry.quote_valid_until&&<div style={{fontSize:10,color:"#999"}}>Valid through {formatDate(entry.quote_valid_until)}</div>}{entry.source_document_id&&<button onClick={()=>onViewSource(entry.source_document_id)} style={{display:"block",marginLeft:"auto",background:"none",border:"none",fontSize:10,color:"#003584",cursor:"pointer"}}>Original source ↗</button>}{current&&role!=="employee"&&<button onClick={()=>onExpireOne(item)} style={{display:"block",marginLeft:"auto",background:"none",border:"none",fontSize:10,fontWeight:700,color:"#E65100",cursor:"pointer"}}>Remove price from Order Guide</button>}</div></div>;})}
      </DocumentRow>;})}
    </VendorSection>;})}
    {hasMore&&<button onClick={onLoadMore} disabled={loadingMore} style={button("white","#003584")}>{loadingMore?"Loading…":"Load earlier price-sheet history"}</button>}
  </div>;
}
