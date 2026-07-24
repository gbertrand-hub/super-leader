import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Super Leader",
  description: "Le feedback qui developpe les personnes et transforme les organisations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
