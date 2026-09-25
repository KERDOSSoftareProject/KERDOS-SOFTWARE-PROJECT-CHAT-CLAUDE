// Persistence helpers for the import workflow. Parsing and matching remain
// pure/core concerns; provider queries are contained here.
async function run(promise,operation){const {data,error}=await promise;if(error)throw new Error(`${operation}: ${error.message}`);return data;}

export function createImportService(backend){
  const table=backend.records.query;
  return {
    findPriceDocument({organizationId,vendorId,fingerprint}){return run(table("import_documents").select("id,status").eq("organization_id",organizationId).eq("vendor_id",vendorId).eq("document_kind","pricelist").eq("fingerprint",fingerprint).maybeSingle(),"Could not verify whether the file was already imported");},
    createPriceDocument(row){return run(table("import_documents").insert(row).select("id").single(),"Could not preserve the source document");},
    finalizeDocument(documentId,status){return run(table("import_documents").update({status}).eq("id",documentId),"Could not finalize the source record");},
    findVendorItem({organizationId,vendorId,code,description}){
      let query=table("vendor_items").select("*").eq("organization_id",organizationId).eq("vendor_id",vendorId);
      query=code?query.eq("vendor_item_code",code):query.eq("description",description);
      return run(query.maybeSingle(),"Could not look up the item");
    },
    vendorItems(organizationId,vendorId){return run(table("vendor_items").select("*").eq("organization_id",organizationId).eq("vendor_id",vendorId),"Could not inspect existing vendor products");},
    mapping(organizationId,vendorItemId){return run(table("item_mappings").select("*").eq("organization_id",organizationId).eq("vendor_item_id",vendorItemId).maybeSingle(),"Could not check the catalog link");},
    createMapping(row){return run(table("item_mappings").insert(row).select("id").single(),"Could not link the item to your catalog");},
    async invoiceSources(organizationId,vendorId){
      const invoices=[];
      for(let start=0;;start+=100){
        const batch=await run(table("invoices").select("id,invoice_number,invoice_date,raw_text")
          .eq("organization_id",organizationId).eq("vendor_id",vendorId)
          .order("invoice_date",{ascending:false}).range(start,start+99),"Could not load prior invoices for comparison");
        invoices.push(...batch);
        if(batch.length<100)break;
      }
      return invoices;
    },
    async duplicateInvoice({organizationId,vendorId,invoiceNumber,rawText}){
      let query=table("invoices").select("id").eq("organization_id",organizationId).eq("vendor_id",vendorId);
      query=invoiceNumber?query.eq("invoice_number",invoiceNumber):query.eq("raw_text",rawText);
      const rows=await run(query.limit(1),"Could not check existing invoice");
      return !!rows?.length;
    },
    async historicalQuote({organizationId,vendorItemId,invoiceDate}){
      const rows=await run(table("price_history").select("price,effective_date,quote_valid_until,source,price_basis,selling_unit").eq("organization_id",organizationId).eq("vendor_item_id",vendorItemId).lte("effective_date",`${invoiceDate}T23:59:59.999Z`).order("effective_date",{ascending:false}).limit(1),"Unable to verify historic quote");
      return rows?.[0]||null;
    },
  };
}
