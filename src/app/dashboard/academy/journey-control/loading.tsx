export default function JourneyControlLoading() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-44 rounded-3xl bg-slate-900" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 rounded-2xl bg-white shadow-sm" />)}
        </div>
        <div className="h-72 rounded-3xl bg-white shadow-sm" />
      </div>
    </main>
  );
}
