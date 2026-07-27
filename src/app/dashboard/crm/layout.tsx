import {requireAccessContext} from "@/lib/auth/access-control";

export default async function ProtectedLayout({children}: Readonly<{children: React.ReactNode}>) {
  await requireAccessContext("crm");
  return children;
}
