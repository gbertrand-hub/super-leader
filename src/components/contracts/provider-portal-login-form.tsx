"use client";

import {FormEvent, useEffect, useState} from "react";
import {createClient} from "@/lib/supabase/client";

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/provider-portal";
  return value;
}

export function ProviderPortalLoginForm({initialEmail = ""}: {initialEmail?: string}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function finishEmailAuthentication() {
      const search = new URLSearchParams(window.location.search);
      const next = safeNext(search.get("next"));
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const authError = hash.get("error_description") ?? search.get("error_description");
      const code = search.get("code");

      if (authError) {
        if (!cancelled) setError(decodeURIComponent(authError.replace(/\+/g, " ")));
        return;
      }

      if (!accessToken && !refreshToken && !code) return;

      setLoading(true);
      setError("");
      setMessage("Connexion sécurisée en cours…");

      try {
        const supabase = createClient();
        if (accessToken && refreshToken) {
          const {error: sessionError} = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else if (code) {
          const {error: exchangeError} = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        window.history.replaceState({}, document.title, `/provider-login?next=${encodeURIComponent(next)}`);
        window.location.replace(next);
      } catch (callbackError) {
        console.error(callbackError);
        if (!cancelled) {
          setError("Le lien d’accès n’a pas pu être finalisé. Demande un nouveau lien sécurisé.");
          setMessage("");
          setLoading(false);
        }
      }
    }

    void finishEmailAuthentication();
    return () => {
      cancelled = true;
    };
  }, []);

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const supabase = createClient();
      const {error: authError} = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (authError) throw authError;
      window.location.replace("/provider-portal");
    } catch (loginError) {
      console.error(loginError);
      setError("Connexion impossible. Vérifie ton e-mail et ton mot de passe, ou demande un lien sécurisé.");
    } finally {
      setLoading(false);
    }
  }

  async function sendSecureLink() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Indique d’abord ton adresse e-mail autorisée.");
      return;
    }
    setLinkLoading(true);
    setMessage("");
    setError("");
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/provider-login?next=${encodeURIComponent("/provider-portal")}`;
      const {error: authError} = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {emailRedirectTo: redirectTo, shouldCreateUser: false},
      });
      if (authError) throw authError;
      setMessage("Un lien sécurisé vient d’être envoyé. Ouvre ton e-mail pour accéder à ton compte.");
    } catch (loginError) {
      console.error(loginError);
      setError("Lien impossible à envoyer. Vérifie que cette adresse est autorisée par iLEAD Global.");
    } finally {
      setLinkLoading(false);
    }
  }

  return (
    <div className="mt-7 space-y-5">
      <form onSubmit={passwordLogin} className="space-y-4">
        <div>
          <label htmlFor="provider-email" className="text-sm font-black text-slate-900">E-mail autorisé</label>
          <input
            id="provider-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="prestataire@entreprise.com"
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label htmlFor="provider-password" className="text-sm font-black text-slate-900">Mot de passe</label>
          <input
            id="provider-password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <button disabled={loading || linkLoading} className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-60">
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">ou</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <button
        type="button"
        onClick={sendSecureLink}
        disabled={loading || linkLoading}
        className="w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-800 disabled:opacity-60"
      >
        {linkLoading ? "Envoi…" : "Recevoir un lien sécurisé"}
      </button>
      <p className="text-xs leading-5 text-slate-500">
        Utilise le lien sécurisé pour ta première connexion ou si tu ne peux plus utiliser ton mot de passe.
      </p>

      {message ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
    </div>
  );
}
