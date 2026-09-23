// Provider-neutral document operations used by KERDOS screens.
// Paths are KERDOS conventions; storage mechanics belong to the adapter.
export function createDocumentService(backend){
  const table=backend.records.query;
  async function run(promise,operation){const {data,error}=await promise;if(error)throw new Error(`${operation}: ${error.message}`);return data;}
  return {
    async uploadOriginal(organizationId,vendorId,file){
      const path=`${organizationId}/${vendorId}/${Date.now()}_${file.name}`;
      try{await backend.documents.upload(path,file);return {path,name:file.name,error:null};}
      catch(error){return {path:null,name:null,error};}
    },
    async uploadLogo(organizationId,file){
      const path=`${organizationId}/logo/${Date.now()}_${file.name}`;
      try{await backend.documents.upload(path,file,{upsert:true});return {path,error:null};}
      catch(error){return {path:null,error};}
    },
    async signedUrl(path,seconds=3600){
      if(!path)return null;
      return (await backend.documents.signedUrl(path,seconds)).signedUrl;
    },
    remove(paths){return backend.documents.remove(paths);},
    source(documentId){return run(table("import_documents").select("original_text,file_path,file_name").eq("id",documentId).single(),"Cannot load original document");},
  };
}
