import type {createAdminClient} from "@/lib/supabase/admin";

type AdminClient=ReturnType<typeof createAdminClient>;
type Sale={id:string;crm_client_id:string|null;crm_contract_id:string|null;customer_email:string|null;customer_phone:string|null;product_name:string;total_amount:number|string;currency:string;payment_status:string;sale_date:string;seller_id:string;collection_owner_id:string|null};
type Client={id:string;reference:string;email:string|null;phone:string|null;whatsapp_phone:string|null;status:string};
type Contract={id:string;sale_id:string|null;client_id:string};
export type PayingProspectCandidate={clientId:string;saleIds:string[];repairSaleIds:string[];missingContractSaleIds:string[];needsActivation:boolean};

function chunks<T>(values:T[],size=300){const result:T[][]=[];for(let i=0;i<values.length;i+=size)result.push(values.slice(i,i+size));return result;}
function email(value:string|null|undefined){return String(value??"").trim().toLowerCase();}
function phone(value:string|null|undefined){return String(value??"").replace(/[^0-9]/g,"");}
function saleReference(id:string){return `SALE-${id.replaceAll("-","").slice(0,12).toUpperCase()}`;}
function contractReference(sale:Sale){return `SALE-${new Date(sale.sale_date).getUTCFullYear()}-${sale.id.replaceAll("-","").slice(0,8).toUpperCase()}`;}
function add(map:Map<string,Set<string>>,key:string,id:string){if(!key)return;const values=map.get(key)??new Set<string>();values.add(id);map.set(key,values);}

async function confirmedSales(admin:AdminClient,organizationId:string,onlySaleIds?:string[]){
  const saleIds=new Set<string>();
  if(onlySaleIds?.length){for(const ids of chunks(onlySaleIds)){const {data,error}=await admin.from("sales_payments").select("sale_id").eq("organization_id",organizationId).eq("status","confirmed").in("sale_id",ids);if(error)throw new Error(error.message);for(const row of data??[])saleIds.add(String(row.sale_id));}}
  else{for(let from=0;;from+=1000){const {data,error}=await admin.from("sales_payments").select("id,sale_id").eq("organization_id",organizationId).eq("status","confirmed").order("id").range(from,from+999);if(error)throw new Error(error.message);for(const row of data??[])saleIds.add(String(row.sale_id));if((data??[]).length<1000)break;}}
  const sales:Sale[]=[];
  for(const ids of chunks([...saleIds])){const {data,error}=await admin.from("sales_records").select("id,crm_client_id,crm_contract_id,customer_email,customer_phone,product_name,total_amount,currency,payment_status,sale_date,seller_id,collection_owner_id").eq("organization_id",organizationId).in("id",ids);if(error)throw new Error(error.message);sales.push(...((data??[])as Sale[]));}
  return sales;
}

async function organizationClients(admin:AdminClient,organizationId:string){
  const clients:Client[]=[];
  for(let from=0;;from+=1000){const {data,error}=await admin.from("crm_clients").select("id,reference,email,phone,whatsapp_phone,status").eq("organization_id",organizationId).order("id").range(from,from+999);if(error)throw new Error(error.message);clients.push(...((data??[])as Client[]));if((data??[]).length<1000)break;}
  return clients;
}

async function saleContracts(admin:AdminClient,organizationId:string,saleIds:string[]){
  const contracts:Contract[]=[];
  for(const ids of chunks(saleIds)){const {data,error}=await admin.from("crm_contracts").select("id,sale_id,client_id").eq("organization_id",organizationId).in("sale_id",ids);if(error)throw new Error(error.message);contracts.push(...((data??[])as Contract[]));}
  return contracts;
}

function resolveClient(sale:Sale,clientsById:Map<string,Client>,referenceMap:Map<string,Set<string>>,emailMap:Map<string,Set<string>>,phoneMap:Map<string,Set<string>>){
  if(sale.crm_client_id&&clientsById.has(sale.crm_client_id))return sale.crm_client_id;
  const byReference=[...(referenceMap.get(saleReference(sale.id))??[])];if(byReference.length===1)return byReference[0];
  const contactIds=new Set<string>(),saleEmail=email(sale.customer_email),salePhone=phone(sale.customer_phone);
  if(saleEmail)for(const id of emailMap.get(saleEmail)??[])contactIds.add(id);if(salePhone)for(const id of phoneMap.get(salePhone)??[])contactIds.add(id);
  return contactIds.size===1?[...contactIds][0]:null;
}

async function reconciliationContext(admin:AdminClient,organizationId:string,onlySaleIds?:string[]){
  const [sales,clients]=await Promise.all([confirmedSales(admin,organizationId,onlySaleIds),organizationClients(admin,organizationId)]),contracts=await saleContracts(admin,organizationId,sales.map(sale=>sale.id));
  const clientsById=new Map(clients.map(client=>[client.id,client])),contractsBySaleId=new Map(contracts.filter(contract=>contract.sale_id).map(contract=>[String(contract.sale_id),contract]));
  const referenceMap=new Map<string,Set<string>>(),emailMap=new Map<string,Set<string>>(),phoneMap=new Map<string,Set<string>>();
  for(const client of clients){add(referenceMap,client.reference.trim().toUpperCase(),client.id);add(emailMap,email(client.email),client.id);add(phoneMap,phone(client.phone),client.id);add(phoneMap,phone(client.whatsapp_phone),client.id);}
  return {sales,clientsById,contractsBySaleId,referenceMap,emailMap,phoneMap};
}

export async function findPayingProspectCandidates(admin:AdminClient,organizationId:string,onlySaleIds?:string[]){
  const ctx=await reconciliationContext(admin,organizationId,onlySaleIds),candidates=new Map<string,PayingProspectCandidate>();
  for(const sale of ctx.sales){const clientId=resolveClient(sale,ctx.clientsById,ctx.referenceMap,ctx.emailMap,ctx.phoneMap);if(!clientId)continue;const client=ctx.clientsById.get(clientId),contract=ctx.contractsBySaleId.get(sale.id);if(!client)continue;const needsActivation=client.status==="prospect",needsLink=sale.crm_client_id!==clientId,needsContract=!contract;if(!needsActivation&&!needsLink&&!needsContract)continue;const item=candidates.get(clientId)??{clientId,saleIds:[],repairSaleIds:[],missingContractSaleIds:[],needsActivation:false};item.saleIds.push(sale.id);if(needsLink)item.repairSaleIds.push(sale.id);if(needsContract)item.missingContractSaleIds.push(sale.id);item.needsActivation=item.needsActivation||needsActivation;candidates.set(clientId,item);}
  return [...candidates.values()];
}

async function ensureContract(input:{admin:AdminClient;organizationId:string;actorId:string;clientId:string;sale:Sale;existing?:Contract}){
  let contract=input.existing,created=false;
  if(!contract){const {data,error}=await input.admin.from("crm_contracts").insert({organization_id:input.organizationId,client_id:input.clientId,sale_id:input.sale.id,contract_number:contractReference(input.sale),title:input.sale.product_name,product_name:input.sale.product_name,total_amount:input.sale.total_amount,currency:input.sale.currency,status:input.sale.payment_status==="paid"?"paid":"payment_in_progress",start_date:input.sale.sale_date,seller_id:input.sale.seller_id,collection_owner_id:input.sale.collection_owner_id,created_by:input.actorId}).select("id,sale_id,client_id").single<Contract>();if(error){const {data:concurrent,error:lookupError}=await input.admin.from("crm_contracts").select("id,sale_id,client_id").eq("organization_id",input.organizationId).eq("sale_id",input.sale.id).maybeSingle<Contract>();if(lookupError||!concurrent)throw new Error(error.message);contract=concurrent;}else{contract=data;created=true;}}
  if(!contract)return {contractId:null,created:false};
  const {error:linkError}=await input.admin.from("sales_records").update({crm_client_id:input.clientId,crm_contract_id:contract.id}).eq("organization_id",input.organizationId).eq("id",input.sale.id);if(linkError)throw new Error(linkError.message);
  return {contractId:contract.id,created};
}

export async function regularizePayingProspectCandidates(input:{admin:AdminClient;organizationId:string;actorId:string;source:string;saleIds?:string[]}){
  const ctx=await reconciliationContext(input.admin,input.organizationId,input.saleIds);let promoted=0,linksRepaired=0,contractsCreated=0,salesReconciled=0;
  for(const sale of ctx.sales){const clientId=resolveClient(sale,ctx.clientsById,ctx.referenceMap,ctx.emailMap,ctx.phoneMap);if(!clientId)continue;const beforeContract=ctx.contractsBySaleId.get(sale.id),needsLink=sale.crm_client_id!==clientId,needsContractLink=sale.crm_contract_id!==beforeContract?.id;const result=await ensureContract({admin:input.admin,organizationId:input.organizationId,actorId:input.actorId,clientId,sale,existing:beforeContract});if(result.created)contractsCreated+=1;if(needsLink)linksRepaired+=1;if(result.created||needsLink||needsContractLink)salesReconciled+=1;const {data:client,error}=await input.admin.from("crm_clients").update({status:"active",lead_status:"converted",updated_at:new Date().toISOString()}).eq("organization_id",input.organizationId).eq("id",clientId).eq("status","prospect").select("id").maybeSingle<{id:string}>();if(error)throw new Error(error.message);if(client)promoted+=1;if(client||result.created||needsLink){const {error:auditError}=await input.admin.from("crm_audit_log").insert({organization_id:input.organizationId,actor_id:input.actorId,entity_type:"client",entity_id:clientId,action:"paying_customer_reconciled",details:{saleIds:[sale.id],contractId:result.contractId,contractCreated:result.created,source:input.source}});if(auditError)throw new Error(auditError.message);}}
  const remaining=(await findPayingProspectCandidates(input.admin,input.organizationId,input.saleIds)).length;
  return {promoted,linksRepaired,contractsCreated,salesReconciled,remaining};
}

export async function promoteCrmClientForConfirmedSale(input:{admin:AdminClient;organizationId:string;saleId:string;actorId:string;source:string}){
  const payments=await input.admin.from("sales_payments").select("id").eq("organization_id",input.organizationId).eq("sale_id",input.saleId).eq("status","confirmed").limit(1);if(payments.error)throw new Error(payments.error.message);if(!payments.data?.length)return {promoted:false,reason:"no_confirmed_payment" as const};
  const ctx=await reconciliationContext(input.admin,input.organizationId,[input.saleId]),sale=ctx.sales[0];if(!sale)return {promoted:false,reason:"sale_not_found" as const};const clientId=resolveClient(sale,ctx.clientsById,ctx.referenceMap,ctx.emailMap,ctx.phoneMap);if(!clientId)return {promoted:false,reason:"client_not_found_or_ambiguous" as const};
  const contract=await ensureContract({admin:input.admin,organizationId:input.organizationId,actorId:input.actorId,clientId,sale,existing:ctx.contractsBySaleId.get(sale.id)}),{data:client,error}=await input.admin.from("crm_clients").update({status:"active",lead_status:"converted",updated_at:new Date().toISOString()}).eq("organization_id",input.organizationId).eq("id",clientId).eq("status","prospect").select("id").maybeSingle<{id:string}>();if(error)throw new Error(error.message);
  const {error:auditError}=await input.admin.from("crm_audit_log").insert({organization_id:input.organizationId,actor_id:input.actorId,entity_type:"client",entity_id:clientId,action:"paying_customer_reconciled",details:{saleIds:[sale.id],contractId:contract.contractId,contractCreated:contract.created,source:input.source}});if(auditError)throw new Error(auditError.message);
  return {promoted:Boolean(client),contractCreated:contract.created,reason:"reconciled" as const};
}
