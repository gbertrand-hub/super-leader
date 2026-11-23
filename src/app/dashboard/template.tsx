"use client";

import {Suspense,type ReactNode} from "react";
import {DashboardFormDraftProtector} from "@/components/forms/dashboard-form-draft-protector";

export default function DashboardTemplate({children}:{children:ReactNode}){
 return <><Suspense fallback={null}><DashboardFormDraftProtector/></Suspense>{children}</>;
}
