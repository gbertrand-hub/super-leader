import {CantonFeedbackContent} from "../page";

export const dynamic="force-dynamic";

export default async function CantonFeedbackTokenPage({
  params,
  searchParams,
}:{
  params:Promise<{token:string}>;
  searchParams:Promise<{success?:string;error?:string;lang?:string}>;
}){
  const {token}=await params;
  const query=await searchParams;
  return <CantonFeedbackContent
    token={token}
    success={query.success}
    error={query.error}
    lang={query.lang}
    returnPath={"/canton-feedback/"+encodeURIComponent(token)}
  />;
}
