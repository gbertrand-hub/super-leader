import Link from "next/link";
export default function AssessmentsLayout({children}:{children:React.ReactNode}){return <><div className="bg-slate-950 px-5 py-3 text-right"><Link href="/dashboard/academy/quiz-builder" className="inline-flex rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-950">Constructeur de quiz →</Link></div>{children}</>}
