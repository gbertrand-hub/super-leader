import CantonVisitorPage from "@/app/dashboard/canton-visitors/page";

export const dynamic="force-dynamic";

export default async function CantonRoute({
 searchParams
}:{
 searchParams:Promise<{error?:string;success?:string;q?:string;filter?:string;site?:string}>
}){
 const params=await searchParams;
 return <CantonVisitorPage searchParams={Promise.resolve({
  error:params.error,
  success:params.success,
  q:params.q,
  filter:params.filter,
  site:params.site,
  view:"dashboard"
 })}/>;
}
