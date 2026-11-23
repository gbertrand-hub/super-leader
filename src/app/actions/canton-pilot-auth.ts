"use server";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {cantonAuthTestEnabled} from "@/lib/canton/feature-gate";
export async function cantonPilotSignIn(formData:FormData){
 if(!cantonAuthTestEnabled())redirect("/canton-pilot?error=disabled");
 const email=String(formData.get("email")||"").trim().toLowerCase().slice(0,200);
 const password=String(formData.get("password")||"");
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!password||password.length>500)redirect("/canton-pilot/login?error=invalid");
 if(!["canton-admin@qa.example.invalid","canton-manager@qa.example.invalid","canton-commercial@qa.example.invalid","canton-reception@qa.example.invalid"].includes(email))redirect("/canton-pilot/login?error=invalid");
 const db=await createClient();
 const {data,error}=await db.auth.signInWithPassword({email,password});
 if(error||!data.user)redirect("/canton-pilot/login?error=invalid");
 redirect("/canton-pilot");
}
export async function cantonPilotSignOut(){
 const db=await createClient();
 await db.auth.signOut();
 redirect("/canton-pilot/login");
}
