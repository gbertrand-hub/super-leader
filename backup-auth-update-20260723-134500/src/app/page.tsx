export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-3xl bg-slate-950 p-10 text-white shadow-xl">
          <div className="mb-5 inline-flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
            <span className="text-amber-400">★</span>
            SUPER LEADER
          </div>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            Le feedback qui developpe les personnes et transforme les organisations.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-slate-300">
            Fondation technique Next.js + Supabase prete. La prochaine etape sera l'authentification.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full bg-emerald-500/15 px-4 py-2 text-sm text-emerald-300">Next.js 16</span>
            <span className="rounded-full bg-blue-500/15 px-4 py-2 text-sm text-blue-300">Supabase SSR</span>
            <span className="rounded-full bg-violet-500/15 px-4 py-2 text-sm text-violet-300">Port 3002</span>
          </div>
        </section>
      </div>
    </main>
  );
}
