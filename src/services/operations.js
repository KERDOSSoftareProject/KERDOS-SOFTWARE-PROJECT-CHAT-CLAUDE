// Recorded invoices, history and purchase orders. These are business records;
// provider syntax stays behind this boundary.
async function run(promise,operation){const {data,error}=await promise;if(error)throw new Error(`${operation}: ${error.message}`);return data;}

export function createOperationsService(backend){
  const table=backend.records.query;
  return {
    updateInvoice(invoiceId,patch){return run(table("invoices").update(patch).eq("id",invoiceId),"Could not update the invoice");},
    deleteInvoice(organizationId,invoiceId){return backend.documents.deleteInvoiceRecord(organizationId,invoiceId);},
    deletePriceSheet(organizationId,documentId){return backend.documents.deletePriceSheet(organizationId,documentId);},
    olderPriceHistory(organizationId,offset,limit=2000){
      return run(table("price_history").select("*").eq("organization_id",organizationId).order("effective_date",{ascending:false}).order("id",{ascending:false}).range(offset,offset+limit-1),"Could not load earlier price sheets");
    },
    async submitOrder({organizationId,userId,basket}){
      // One database function: header and all lines land together or not
      // at all. A dropped connection can no longer leave an orphaned header.
      const lines=basket.items.map(item=>({
        catalog_item_id:item.catalogItemId.replace(/_(?:split_)?(?:case|each)$/,""),
        vendor_item_id:item.vendorItemId||null,
        vendor_item_code:item.vendorCode||null,
        description:item.description||"",
        quantity:Number(item.qty)||1,
        unit_price:Number(item.price)||0,
        line_total:Math.round((Number(item.price)||0)*(Number(item.qty)||1)*100)/100,
        pack_size:item.packSize||null,
        selling_unit:item.sellingUnit||null,
      }));
      const result=await run(
        backend.operations.submitOrder({
          p_organization_id:organizationId,p_vendor_id:basket.vendorId,
          p_created_by:userId,p_total_amount:basket.dollar,
          p_notes:basket.notes||null,p_lines:lines,
        }),"Could not submit the order");
      return result;
    },
  };
}
