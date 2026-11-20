import {setCantonLocale} from "@/app/actions/canton-locale";
import type {Locale} from "@/i18n/config";
export function CantonLanguageSwitch({locale,returnPath}:{locale:Locale;returnPath:string}){
 return <form action={setCantonLocale} className="flex items-center gap-2 text-sm" aria-label={locale==="fr"?"Choisir la langue":"Choose language"}>
  <input type="hidden" name="returnPath" value={returnPath}/>
  <button type="submit" name="locale" value="fr" aria-current={locale==="fr"?"page":undefined} className={"rounded-lg px-3 py-2 "+(locale==="fr"?"bg-indigo-700 text-white":"bg-white text-slate-900 border")}>FR</button>
  <button type="submit" name="locale" value="en" aria-current={locale==="en"?"page":undefined} className={"rounded-lg px-3 py-2 "+(locale==="en"?"bg-indigo-700 text-white":"bg-white text-slate-900 border")}>EN</button>
 </form>;
}
