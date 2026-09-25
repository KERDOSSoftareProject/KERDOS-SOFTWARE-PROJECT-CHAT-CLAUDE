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
      const order=await run(table("purchase_orders").insert({organization_id:organizationId,vendor_id:basket.vendorId,created_by:userId,status:"submitted",total_amount:basket.dollar}).select().single(),`Could not submit the ${basket.vendorName} order`);
      await run(table("purchase_order_lines").insert(basket.items.map(item=>({purchase_order_id:order.id,catalog_item_id:item.catalogItemId.replace(/_(?:split_)?(?:case|each)$/, ""),vendor_item_id:item.vendorItemId,quantity:item.quantity,unit_price:item.price,line_total:item.lineTotal}))),`Could not save the ${basket.vendorName} order lines`);
      return order;
    },
  };
}
