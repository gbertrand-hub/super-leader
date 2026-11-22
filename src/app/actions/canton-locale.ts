"use server";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {localeCookieName,normalizeLocale} from "@/i18n/config";

/** Canton is part of Super Leader: reuse its existing FR/EN language cookie. */
export async function setCantonLocale(f:FormData){
 const requested=String(f.get("locale")||"fr");
 const locale=normalizeLocale(requested);
 const path=String(f.get("returnPath")||"/canton-pilot");
 const allowed=["/dashboard/canton-visitors","/canton-pilot","/canton-pilot/login","/canton-checkin","/canton-feedback-qr","/canton-feedback"];
 const dest=allowed.some(p=>path===p||path.startsWith(p+"?"))?path:"/dashboard/canton-visitors";
 (await cookies()).set(localeCookieName,locale,{path:"/",sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:365*24*3600});
 redirect(dest);
}
