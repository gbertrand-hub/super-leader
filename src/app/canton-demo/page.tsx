import {notFound} from "next/navigation";
import CantonDemoClient from "./simulator";
export const dynamic="force-dynamic";
export default function CantonDemoPage(){
 if(process.env.VERCEL_ENV!=="preview" && process.env.NODE_ENV!=="development") notFound();
 return <CantonDemoClient/>;
}