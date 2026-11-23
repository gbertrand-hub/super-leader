import Link from "next/link";
import { redirect } from "next/navigation";
import {
  approveAcademyStudentAgreementAction,
  saveAcademyOfficialTariffAction,
  saveAcademyCohortTariffAction,
  saveAcademyPricingCommissionAction,
  saveAcademyPricingSettingsAction,
  saveAcademyPromotionAction,
  setAcademyPromotionStatusAction,
  updateAcademyPromotionAction,
} from "@/app/actions/academy-financial-governance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const money = (n: number, c: string) => {
  try { return new Intl.NumberFormat("fr-CA", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n); }
  catch { return `${n.toFixed(2)} ${c}`; }
};

export default async function AcademyPricingPage({ searchParams }: Props) {
  const q = (await searchParams) ?? {};
  const requestedOrganizationId = first(q.organization);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  const admin = createAdminClient();

  // V4_8_73_R2_PRICING_ORG_RESOLUTION
  // Le lien du menu est statique; la page retrouve donc l'organisation active
  // sans utiliser un .limit(1) fragile pour les utilisateurs multi-organisations.
  const { data: memberships } = await admin
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", auth.user.id)
    .eq("is_active", true);
  const activeMemberships = (memberships ?? []) as Array<{organization_id: string; role: string}>;
  const requestedMembership = requestedOrganizationId
    ? activeMemberships.find((row) => row.organization_id === requestedOrganizationId)
    : null;
  const adminMemberships = activeMemberships.filter((row) => ["owner", "admin"].includes(row.role));
  const membership = requestedMembership ?? (adminMemberships.length === 1 ? adminMemberships[0] : activeMemberships.length === 1 ? activeMemberships[0] : adminMemberships[0] ?? activeMemberships[0] ?? null);
  if (!membership) redirect("/dashboard/company");
  const organizationId = membership.organization_id;

  const { data: activeCommission } = await admin
    .from("academy_pricing_commissions")
    .select("id,name")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle<{ id: string; name: string }>();
  const { data: myCommissionMembership } = activeCommission
    ? await admin
        .from("academy_pricing_commission_members")
        .select("member_role")
        .eq("commission_id", activeCommission.id)
        .eq("user_id", auth.user.id)
        .eq("is_active", true)
        .maybeSingle<{ member_role: string }>()
    : { data: null };
  const canConfigure = ["owner", "admin"].includes(membership.role);
  const canManagePricing = canConfigure || ["chair", "secretary"].includes(myCommissionMembership?.member_role ?? "");
  if (!canManagePricing) redirect(`/dashboard/academy?organization=${organizationId}`);

  const [
    { data: settings },
    { data: schools },
    { data: programs },
    { data: cohorts },
    { data: tariffs },
    { data: cohortTariffs },
    { data: promotions },
    { data: commissionMembers },
    { data: orgMembers },
    { data: pendingAgreements },
  ] = await Promise.all([
    admin.from("academy_pricing_settings").select("delegated_discount_percent,commission_required_percent,default_currency").eq("organization_id", organizationId).maybeSingle(),
    admin.from("academy_schools").select("id,name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    admin.from("academy_programs").select("id,school_id,name,status").eq("organization_id", organizationId).order("name"),
    admin.from("academy_cohorts").select("id,school_id,name,status").eq("organization_id", organizationId).neq("status", "archived").order("name"),
    admin.from("academy_program_tariffs").select("id,school_id,program_id,version,amount,currency,status,effective_from,effective_until").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    admin.from("academy_cohort_tariffs").select("id,school_id,program_id,cohort_id,version,amount,currency,status,effective_from,effective_until").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    admin.from("academy_pricing_promotions").select("id,name,scope_type,school_id,program_id,cohort_id,discount_type,discount_value,currency,valid_from,valid_until,status,notes").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    activeCommission ? admin.from("academy_pricing_commission_members").select("user_id,member_role,is_active").eq("commission_id", activeCommission.id).eq("is_active", true) : Promise.resolve({ data: [] as any[] }),
    admin.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("is_active", true),
    admin.from("academy_student_financial_agreements").select("id,enrollment_id,list_price,promotion_discount_amount,individual_adjustment_amount,agreed_amount,currency,adjustment_reason,created_at").eq("organization_id", organizationId).eq("status", "pending_approval").order("created_at", { ascending: true }).limit(100),
  ]);

  const memberIds = (orgMembers ?? []).map((x) => String(x.user_id));
  const { data: profiles } = memberIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", memberIds)
    : { data: [] as any[] };
  const profileBy = new Map((profiles ?? []).map((x) => [String(x.id), String(x.full_name || x.email || x.id)]));
  const schoolBy = new Map((schools ?? []).map((x) => [String(x.id), String(x.name)]));
  const programBy = new Map((programs ?? []).map((x) => [String(x.id), String(x.name)]));
  const cohortBy = new Map((cohorts ?? []).map((x) => [String(x.id), String(x.name)]));
  const commissionByUser = new Map((commissionMembers ?? []).map((x) => [String(x.user_id), String(x.member_role)]));

  const pendingEnrollmentIds = (pendingAgreements ?? []).map((x) => String(x.enrollment_id));
  const { data: pendingEnrollments } = pendingEnrollmentIds.length
    ? await admin.from("academy_school_enrollments").select("id,school_id,program_id,crm_client_id,user_id").in("id", pendingEnrollmentIds)
    : { data: [] as any[] };
  const pendingEnrollmentBy = new Map((pendingEnrollments ?? []).map((x) => [String(x.id), x]));
  const crmIds = (pendingEnrollments ?? []).map((x) => x.crm_client_id).filter(Boolean) as string[];
  const userIds = (pendingEnrollments ?? []).map((x) => x.user_id).filter(Boolean) as string[];
  const [{ data: crmPeople }, { data: studentProfiles }] = await Promise.all([
    crmIds.length ? admin.from("crm_clients").select("id,full_name,email").in("id", crmIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? admin.from("profiles").select("id,full_name,email").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const studentNameBy = new Map<string, string>();
  for (const x of crmPeople ?? []) studentNameBy.set(`crm:${x.id}`, String(x.full_name || x.email || x.id));
  for (const x of studentProfiles ?? []) studentNameBy.set(`user:${x.id}`, String(x.full_name || x.email || x.id));

  const delegated = Number(settings?.delegated_discount_percent ?? 15);
  const commissionRequired = Number(settings?.commission_required_percent ?? 30);
  const defaultCurrency = String(settings?.default_currency ?? "USD");

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/dashboard/academy" className="font-black text-violet-700">← Super Leader Academy</Link>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/academy/schools" className="rounded-xl border border-violet-200 bg-white px-4 py-2 font-black text-violet-800">Programmes & écoles</Link>
            <Link href="/dashboard/academy/cohorts" className="rounded-xl border border-amber-200 bg-white px-4 py-2 font-black text-amber-800">Cohortes</Link>
            <Link href={`/dashboard/academy/students?organization=${organizationId}`} className="rounded-xl bg-slate-950 px-4 py-2 font-black text-white">Comptes étudiants</Link>
          </div>
        </div>
        <header className="rounded-3xl bg-gradient-to-br from-slate-950 to-violet-950 p-8 text-white">
          <p className="text-xs font-black uppercase tracking-[.22em] text-amber-400">iLEAD Global Institute · Gouvernance financière</p>
          <h1 className="mt-2 text-4xl font-black">Tarification & homologation</h1>
          <p className="mt-3 max-w-4xl text-slate-300">La Commission fixe les tarifs officiels. Les promotions et accords individuels restent traçables sans écraser le prix homologué.</p>
        </header>
        {first(q.success) ? <Banner tone="success">{first(q.success)}</Banner> : null}
        {first(q.error) ? <Banner tone="error">{first(q.error)}</Banner> : null}

        <section className="grid gap-4 lg:grid-cols-3">
          <Kpi label="Tarifs actifs" value={(tariffs ?? []).filter((x) => x.status === "active").length + (cohortTariffs ?? []).filter((x) => x.status === "active").length} />
          <Kpi label="Promotions actives" value={(promotions ?? []).filter((x) => x.status === "active").length} />
          <Kpi label="Accords à homologuer" value={(pendingAgreements ?? []).length} />
        </section>

        {canConfigure ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <form action={saveAcademyPricingCommissionAction} className="rounded-3xl border bg-white p-6 shadow-sm">
              <input type="hidden" name="organization_id" value={organizationId} />
              <h2 className="text-2xl font-black">Commission de fixation des frais</h2>
              <p className="mt-1 text-sm text-slate-500">Président, Secrétaire et membres habilités à homologuer les prix.</p>
              <Field title="Président">
                <select name="chair_user_id" defaultValue={[...commissionByUser.entries()].find(([, r]) => r === "chair")?.[0] ?? ""} required className={input}>
                  <option value="">Choisir…</option>
                  {(profiles ?? []).map((p) => <option key={p.id} value={String(p.id)}>{profileBy.get(String(p.id))}</option>)}
                </select>
              </Field>
              <Field title="Secrétaire">
                <select name="secretary_user_id" defaultValue={[...commissionByUser.entries()].find(([, r]) => r === "secretary")?.[0] ?? ""} className={input}>
                  <option value="">Non défini</option>
                  {(profiles ?? []).map((p) => <option key={p.id} value={String(p.id)}>{profileBy.get(String(p.id))}</option>)}
                </select>
              </Field>
              <Field title="Autres membres (Ctrl/Cmd + clic)">
                <select name="member_user_ids" multiple defaultValue={[...commissionByUser.entries()].filter(([, r]) => r === "member").map(([id]) => id)} className={`${input} min-h-36`}>
                  {(profiles ?? []).map((p) => <option key={p.id} value={String(p.id)}>{profileBy.get(String(p.id))}</option>)}
                </select>
              </Field>
              <button className="mt-4 rounded-xl bg-violet-700 px-5 py-3 font-black text-white">Enregistrer la Commission</button>
            </form>

            <form action={saveAcademyPricingSettingsAction} className="rounded-3xl border bg-white p-6 shadow-sm">
              <input type="hidden" name="organization_id" value={organizationId} />
              <h2 className="text-2xl font-black">Délégation & seuils</h2>
              <p className="mt-1 text-sm text-slate-500">Les petites remises peuvent être appliquées sans ralentir l'Institut.</p>
              <Field title="Remise maximale déléguée (%)">
                <input name="delegated_discount_percent" type="number" min="0" max="100" step="0.01" defaultValue={delegated} className={input} />
              </Field>
              <Field title="Seuil de saisine de la Commission (%)">
                <input name="commission_required_percent" type="number" min="0" max="100" step="0.01" defaultValue={commissionRequired} className={input} />
              </Field>
              <Field title="Devise par défaut">
                <input name="default_currency" maxLength={3} defaultValue={defaultCurrency} className={input} />
              </Field>
              <button className="mt-4 rounded-xl bg-slate-950 px-5 py-3 font-black text-white">Enregistrer les règles</button>
            </form>
          </section>
        ) : null}

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-xs font-black uppercase tracking-[.18em] text-amber-700">Règle d'héritage tarifaire</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Cohorte &gt; Programme &gt; Exception individuelle</h2>
          <p className="mt-2 text-sm text-slate-700">Définissez le prix une seule fois. Un tarif de cohorte surcharge le tarif du programme. L'étudiant hérite automatiquement du bon prix; sa fiche ne sert plus qu'aux promotions et exceptions individuelles.</p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <form action={saveAcademyOfficialTariffAction} className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
            <input type="hidden" name="organization_id" value={organizationId} />
            <h2 className="text-2xl font-black text-amber-950">Homologuer un tarif officiel</h2>
            <Field title="Programme">
              <select name="program_id" required className={input}>
                <option value="">Choisir…</option>
                {(programs ?? []).map((p) => <option key={p.id} value={String(p.id)}>{schoolBy.get(String(p.school_id))} · {p.name}</option>)}
              </select>
            </Field>
            <Field title="Grande École">
              <select name="school_id" required className={input}>
                <option value="">Choisir…</option>
                {(schools ?? []).map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field title="Montant officiel"><input name="amount" type="number" min="0" step="0.01" required className={input} /></Field>
              <Field title="Devise"><input name="currency" maxLength={3} defaultValue={defaultCurrency} className={input} /></Field>
            </div>
            <Field title="Date d'effet"><input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={input} /></Field>
            <Field title="Note"><textarea name="notes" rows={3} className={input} /></Field>
            <button className="mt-4 rounded-xl bg-amber-400 px-5 py-3 font-black text-amber-950">Homologuer / soumettre</button>
          </form>

          <form action={saveAcademyCohortTariffAction} className="rounded-3xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <input type="hidden" name="organization_id" value={organizationId} />
            <h2 className="text-2xl font-black">Tarif homologué de cohorte</h2>
            <p className="mt-1 text-sm text-slate-600">Prioritaire sur le tarif programme. Idéal pour une rentrée, une promotion de cohorte ou un prix spécifique homologué.</p>
            <Field title="Grande École">
              <select name="school_id" required className={input}><option value="">Choisir…</option>{(schools ?? []).map((x) => <option key={x.id} value={String(x.id)}>{String(x.name)}</option>)}</select>
            </Field>
            <Field title="Programme (facultatif)">
              <select name="program_id" className={input}><option value="">Hérité / non précisé</option>{(programs ?? []).map((x) => <option key={x.id} value={String(x.id)}>{String(x.name)}</option>)}</select>
            </Field>
            <Field title="Cohorte">
              <select name="cohort_id" required className={input}><option value="">Choisir…</option>{(cohorts ?? []).map((x) => <option key={x.id} value={String(x.id)}>{String(x.name)}</option>)}</select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field title="Montant"><input name="amount" type="number" min="0" step="0.01" required className={input}/></Field><Field title="Devise"><input name="currency" defaultValue={defaultCurrency} maxLength={3} required className={input}/></Field></div>
            <Field title="Date d'effet"><input name="effective_from" type="date" defaultValue={new Date().toISOString().slice(0,10)} className={input}/></Field>
            <Field title="Note"><textarea name="notes" rows={2} className={input}/></Field>
            <button className="mt-4 rounded-xl bg-amber-400 px-5 py-3 font-black text-slate-950">Homologuer / soumettre le tarif de cohorte</button>
          </form>

          <form action={saveAcademyPromotionAction} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
            <input type="hidden" name="organization_id" value={organizationId} />
            <h2 className="text-2xl font-black text-emerald-950">Créer une promotion</h2>
            <Field title="Nom"><input name="name" required placeholder="Rentrée 2026" className={input} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field title="Portée"><select name="scope_type" defaultValue="program" className={input}><option value="organization">Institut</option><option value="school">École</option><option value="program">Programme</option><option value="cohort">Cohorte</option></select></Field>
              <Field title="Type"><select name="discount_type" defaultValue="percent" className={input}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option><option value="final_price">Prix final</option></select></Field>
            </div>
            <Field title="École"><select name="school_id" className={input}><option value="">Toutes / non précisé</option>{(schools ?? []).map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}</select></Field>
            <Field title="Programme"><select name="program_id" className={input}><option value="">Tous / non précisé</option>{(programs ?? []).map((p) => <option key={p.id} value={String(p.id)}>{schoolBy.get(String(p.school_id))} · {p.name}</option>)}</select></Field>
            <Field title="Cohorte"><select name="cohort_id" className={input}><option value="">Toutes / non précisé</option>{(cohorts ?? []).map((c) => <option key={c.id} value={String(c.id)}>{schoolBy.get(String(c.school_id))} · {c.name}</option>)}</select></Field>
            <div className="grid gap-3 sm:grid-cols-2"><Field title="Valeur"><input name="discount_value" type="number" min="0" step="0.01" required className={input} /></Field><Field title="Devise (si montant)"><input name="currency" maxLength={3} defaultValue={defaultCurrency} className={input} /></Field></div>
            <div className="grid gap-3 sm:grid-cols-2"><Field title="Du"><input name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={input} /></Field><Field title="Au"><input name="valid_until" type="date" className={input} /></Field></div>
            <button className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-black text-white">Créer la promotion</button>
          </form>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Tarifs homologués</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {(tariffs ?? []).map((t) => (
              <div key={t.id} className="rounded-2xl border bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-black">{schoolBy.get(String(t.school_id))} · {programBy.get(String(t.program_id))}</p><p className="text-sm text-slate-500">Version {t.version} · effet {t.effective_from}</p></div><Status value={String(t.status)} /></div>
                <p className="mt-3 text-xl font-black">{money(Number(t.amount ?? 0), String(t.currency))}</p>
              </div>
            ))}
            {!tariffs?.length ? <Empty>Aucun tarif homologué pour le moment.</Empty> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Tarifs homologués de cohorte</h2>
          <p className="mt-1 text-sm text-slate-500">Ces tarifs sont prioritaires sur le tarif du programme et se propagent automatiquement aux inscriptions sans exception individuelle.</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {(cohortTariffs ?? []).map((t) => (
              <div key={t.id} className="rounded-2xl border bg-amber-50 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-black">{schoolBy.get(String(t.school_id))} · {cohortBy.get(String(t.cohort_id)) ?? "Cohorte"}</p><p className="text-sm text-slate-500">{programBy.get(String(t.program_id)) ?? "Programme non précisé"} · Version {t.version} · effet {t.effective_from}</p></div><Status value={String(t.status)} /></div>
                <p className="mt-3 text-xl font-black">{money(Number(t.amount ?? 0), String(t.currency))}</p>
              </div>
            ))}
            {!cohortTariffs?.length ? <Empty>Aucun tarif de cohorte pour le moment. Le tarif programme reste la référence.</Empty> : null}
          </div>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Promotions</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {(promotions ?? []).map((p) => {
              const invalidPercent = p.discount_type === "percent" && Number(p.discount_value ?? 0) > 100;
              return (
              <div key={p.id} className={`rounded-2xl border p-4 ${invalidPercent ? "border-rose-300 bg-rose-50" : "bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="font-black">{p.name}</p><p className="text-sm text-slate-500">{p.scope_type} · {p.valid_from}{p.valid_until ? ` → ${p.valid_until}` : ""}</p></div><Status value={String(p.status)} /></div>
                <p className={`mt-2 font-black ${invalidPercent ? "text-rose-700" : ""}`}>{p.discount_type === "percent" ? `${Number(p.discount_value)}%` : money(Number(p.discount_value), String(p.currency ?? defaultCurrency))}</p>
                {invalidPercent ? <p className="mt-2 rounded-xl bg-rose-100 p-2 text-sm font-black text-rose-800">Valeur invalide : un pourcentage doit etre entre 0 et 100 %. Corrigez cette promotion avant de la reactiver.</p> : null}
                <details className="mt-3 rounded-xl border bg-white p-3">
                  <summary className="cursor-pointer text-sm font-black text-violet-800">Modifier la promotion</summary>
                  <form action={updateAcademyPromotionAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="promotion_id" value={String(p.id)}/>
                    <Field title="Nom"><input name="name" defaultValue={String(p.name)} required className={input}/></Field>
                    <Field title="Portee"><select name="scope_type" defaultValue={String(p.scope_type)} className={input}><option value="organization">Institut</option><option value="school">Ecole</option><option value="program">Programme</option><option value="cohort">Cohorte</option></select></Field>
                    <Field title="Type"><select name="discount_type" defaultValue={String(p.discount_type)} className={input}><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option><option value="final_price">Prix final</option></select></Field>
                    <Field title="Valeur"><input name="discount_value" type="number" min="0" step="0.01" defaultValue={Number(p.discount_value ?? 0)} required className={input}/></Field>
                    <Field title="Ecole"><select name="school_id" defaultValue={String(p.school_id ?? "")} className={input}><option value="">Toutes / non precise</option>{(schools ?? []).map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}</select></Field>
                    <Field title="Programme"><select name="program_id" defaultValue={String(p.program_id ?? "")} className={input}><option value="">Tous / non precise</option>{(programs ?? []).map((x) => <option key={x.id} value={String(x.id)}>{schoolBy.get(String(x.school_id))} · {x.name}</option>)}</select></Field>
                    <Field title="Cohorte"><select name="cohort_id" defaultValue={String(p.cohort_id ?? "")} className={input}><option value="">Toutes / non precise</option>{(cohorts ?? []).map((x) => <option key={x.id} value={String(x.id)}>{schoolBy.get(String(x.school_id))} · {x.name}</option>)}</select></Field>
                    <Field title="Devise"><input name="currency" maxLength={3} defaultValue={String(p.currency ?? defaultCurrency)} className={input}/></Field>
                    <Field title="Du"><input name="valid_from" type="date" defaultValue={String(p.valid_from ?? "")} className={input}/></Field>
                    <Field title="Au"><input name="valid_until" type="date" defaultValue={String(p.valid_until ?? "")} className={input}/></Field>
                    <Field title="Notes"><textarea name="notes" rows={2} defaultValue={String(p.notes ?? "")} className={input}/></Field>
                    <button className="self-end rounded-xl bg-violet-700 px-4 py-2 font-black text-white">Enregistrer les corrections</button>
                  </form>
                </details>
                <div className="mt-3 flex flex-wrap gap-2">
                  {String(p.status) !== "active" ? <form action={setAcademyPromotionStatusAction}><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="promotion_id" value={String(p.id)}/><input type="hidden" name="status" value="active"/><button className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white">Activer</button></form> : <form action={setAcademyPromotionStatusAction}><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="promotion_id" value={String(p.id)}/><input type="hidden" name="status" value="suspended"/><button className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-slate-950">Suspendre</button></form>}
                  <form action={setAcademyPromotionStatusAction}><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="promotion_id" value={String(p.id)}/><input type="hidden" name="status" value="archived"/><button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black">Archiver</button></form>
                </div>
              </div>
              );
            })}
            {!promotions?.length ? <Empty>Aucune promotion configurée.</Empty> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-2xl font-black text-rose-950">Exceptions individuelles à homologuer</h2><p className="text-sm text-rose-800">Les remises dépassant la délégation restent en attente tant que la Commission ne les approuve pas.</p></div><span className="rounded-full bg-white px-3 py-1 font-black text-rose-700">{pendingAgreements?.length ?? 0}</span></div>
          <div className="mt-4 space-y-3">
            {(pendingAgreements ?? []).map((a) => {
              const e = pendingEnrollmentBy.get(String(a.enrollment_id));
              const studentKey = e?.crm_client_id ? `crm:${e.crm_client_id}` : `user:${e?.user_id}`;
              const studentName = studentNameBy.get(studentKey) ?? "Étudiant";
              const discount = Number(a.promotion_discount_amount ?? 0) + Number(a.individual_adjustment_amount ?? 0);
              return (
                <div key={a.id} className="rounded-2xl border border-rose-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{studentName}</p><p className="text-sm text-slate-500">{schoolBy.get(String(e?.school_id))} · {programBy.get(String(e?.program_id))}</p><p className="mt-2">Tarif {money(Number(a.list_price), a.currency)} · Remises {money(discount, a.currency)} · <b>Convenu {money(Number(a.agreed_amount), a.currency)}</b></p>{a.adjustment_reason ? <p className="mt-1 text-sm text-slate-600">Motif : {a.adjustment_reason}</p> : null}</div>
                    <form action={approveAcademyStudentAgreementAction}><input type="hidden" name="organization_id" value={organizationId}/><input type="hidden" name="agreement_id" value={String(a.id)}/><input type="hidden" name="return_to" value={`/dashboard/academy/pricing?organization=${organizationId}`}/><button className="rounded-xl bg-rose-700 px-4 py-2 font-black text-white">Homologuer</button></form>
                  </div>
                </div>
              );
            })}
            {!pendingAgreements?.length ? <Empty>Aucune exception individuelle en attente.</Empty> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) { return <label className="mt-4 block text-sm font-bold text-slate-700">{title}{children}</label>; }
function Kpi({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl border bg-white p-5"><p className="text-3xl font-black">{value}</p><p className="text-sm font-bold text-slate-500">{label}</p></div>; }
function Status({ value }: { value: string }) { return <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black uppercase text-white">{value}</span>; }
function Empty({ children }: { children: React.ReactNode }) { return <p className="rounded-2xl border border-dashed bg-white p-5 text-slate-500">{children}</p>; }
function Banner({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) { return <p className={`rounded-2xl p-4 font-black ${tone === "success" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{children}</p>; }
