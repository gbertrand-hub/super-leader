"use client";

import { useEffect } from "react";

/**
 * Supabase recovery links can fall back to the configured Site URL and place
 * the recovery session in the URL hash. When that happens on the home page,
 * forward the complete hash to the password setup page.
 */
export function RecoveryHashRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.slice(1));
    const type = params.get("type");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (type === "recovery" && accessToken && refreshToken) {
      window.location.replace(`/update-password${hash}`);
    }
  }, []);

  return null;
}
