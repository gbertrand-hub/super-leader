-- SUPER LEADER V4.8.71 - VIP BENEFITS CATALOG & VIP MANAGER
-- Adds scoped VIP programme manager governance, editable benefit options,
-- and a starter catalogue of 20 benefits. Run after existing VIP migrations.

begin;

alter table public.vip_program_settings
  add column if not exists vip_manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists vip_manager_assigned_at timestamptz,
  add column if not exists vip_manager_assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists vip_assistant_manager_user_id uuid references auth.users(id) on delete set null,
  add column if not exists vip_assistant_manager_assigned_at timestamptz,
  add column if not exists vip_assistant_manager_assigned_by uuid references auth.users(id) on delete set null;

alter table public.vip_benefits
  add column if not exists seed_code text,
  add column if not exists guest_allowed boolean not null default false,
  add column if not exists transferable boolean not null default false;

create unique index if not exists vip_benefits_org_seed_code_uidx
  on public.vip_benefits (organization_id, seed_code)
  where seed_code is not null;

create index if not exists vip_program_settings_manager_idx
  on public.vip_program_settings (vip_manager_user_id)
  where vip_manager_user_id is not null;

create index if not exists vip_program_settings_assistant_manager_idx
  on public.vip_program_settings (vip_assistant_manager_user_id)
  where vip_assistant_manager_user_id is not null;

-- Populate a reusable starter catalogue as DRAFTS so each organisation can
-- review wording, eligibility, dates and limits before activating benefits.
with org_actor as (
  select
    o.id as organization_id,
    (
      select om.user_id
      from public.organization_members om
      where om.organization_id = o.id
        and om.is_active = true
      order by
        case om.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        om.user_id
      limit 1
    ) as actor_id
  from public.organizations o
), starter(seed_code, title, description, benefit_type, value_label, country, city, eligibility_scope, redemption_instructions, terms_and_conditions, requires_approval, usage_limit_per_member, total_usage_limit, guest_allowed, transferable) as (
  values
    ('master_coach_inner_circle', 'Cercle rapproché du Master Coach · Master Coach Inner Circle', 'Accès à des rencontres privées, échanges stratégiques et expériences réservées au cercle rapproché.', 'exclusive_access', 'Inner Circle', null, null, 'active_members', 'Soumettre une demande dans Super Leader VIP. L’équipe VIP confirme la disponibilité et les modalités.', 'Accès sur invitation ou approbation. Les dates et capacités peuvent varier.', true, null, null, false, false),
    ('vip_international_experience', 'VIP International Experience', 'Accès prioritaire à certaines expériences internationales, voyages, visites privées et rencontres iLEAD Global.', 'exclusive_access', 'International', null, null, 'active_members', 'Demander l’accès depuis Super Leader VIP et attendre la confirmation du VIP Manager.', 'Transport, visa, hébergement et frais personnels restent soumis aux conditions de chaque expérience.', true, null, null, true, false),
    ('priority_ilead_events', 'Priority Access — iLEAD Global Events', 'Accès prioritaire aux inscriptions et places disponibles pour une sélection de grands événements iLEAD Global.', 'priority', 'Priority access', null, null, 'active_members', 'Utiliser Super Leader VIP avant l’ouverture générale des inscriptions.', 'Sous réserve de capacité et des règles propres à chaque événement.', false, null, null, false, false),
    ('vip_seating_reception', 'VIP Seating & Private Reception', 'Places premium et accès à une réception privée lors de certains événements éligibles.', 'upgrade', 'Premium', null, null, 'active_members', 'Présenter la confirmation VIP à l’accueil de l’événement.', 'Disponible uniquement sur les événements désignés.', true, null, null, true, false),
    ('private_masterclass', 'Private Masterclass', 'Accès à des masterclasses privées avec experts, dirigeants ou invités spéciaux.', 'exclusive_access', 'Private session', null, null, 'active_members', 'Réserver via Super Leader VIP lorsqu’une session est publiée.', 'Places limitées. Participation nominative sauf indication contraire.', true, null, null, false, false),
    ('executive_strategy_session', 'Executive Strategy Session', 'Session stratégique individuelle avec un coach ou expert senior pour clarifier priorités, décisions et plan d’action.', 'complimentary', '1 session', null, null, 'active_members', 'Demander une session et proposer les objectifs à travailler.', 'La fréquence et la durée sont définies par le programme VIP.', true, 1, null, false, false),
    ('vip_business_advisory', 'VIP Business Advisory', 'Diagnostic ciblé et recommandations pour un projet entrepreneurial ou une problématique de gestion.', 'assistance', 'Advisory', null, null, 'active_members', 'Déposer la demande et joindre le contexte nécessaire à l’analyse.', 'Ne constitue pas un conseil juridique, fiscal ou financier réglementé.', true, null, null, false, false),
    ('business_investment_circle', 'VIP Business & Investment Circle', 'Accès à des rencontres privées entre entrepreneurs, investisseurs, experts et partenaires sélectionnés.', 'exclusive_access', 'Private network', null, null, 'active_members', 'Demander l’inscription à la rencontre depuis le catalogue VIP.', 'Participation soumise aux règles de confidentialité et d’admission de chaque session.', true, null, null, false, false),
    ('real_estate_priority_access', 'Real Estate Priority Access', 'Accès anticipé à certaines opportunités immobilières présentées à l’écosystème avant diffusion générale.', 'priority', 'Early access', null, null, 'active_members', 'Activer une alerte VIP ou demander les informations disponibles.', 'Aucune opportunité ni rendement n’est garanti. Toute décision reste sous la responsabilité du membre.', true, null, null, false, false),
    ('vip_learning_pass', 'VIP Learning Pass — iLEAD Global Institute', 'Accès offert ou préférentiel à une sélection de masterclasses, ateliers ou programmes courts de l’Institut.', 'complimentary', 'Learning pass', null, null, 'active_members', 'Sélectionner une formation éligible et demander l’utilisation du pass.', 'L’éligibilité et le nombre de places varient selon le programme.', true, null, null, false, false),
    ('leadership_growth_assessment', 'Leadership Growth Assessment', 'Évaluation structurée du leadership avec recommandations et axes de progression personnalisés.', 'complimentary', 'Assessment', null, null, 'active_members', 'Planifier l’évaluation via l’équipe VIP ou Academy.', 'Les résultats sont confidentiels et destinés au développement personnel.', true, 1, null, false, false),
    ('vip_book_club', 'VIP Book Club', 'Livre ou thème de lecture sélectionné, discussion privée et activités de réflexion avec le cercle VIP.', 'exclusive_access', 'Book club', null, null, 'active_members', 'S’inscrire à la prochaine session publiée dans Super Leader VIP.', 'Le livre physique ou numérique peut être inclus ou non selon la session.', false, null, null, true, false),
    ('private_business_dinner', 'Private Business Dinner', 'Invitation à certains dîners privés réunissant dirigeants, partenaires et invités spéciaux.', 'exclusive_access', 'Private dinner', null, null, 'active_members', 'Demander une place après publication de l’invitation VIP.', 'Capacité limitée. Tenue, horaires et politique d’invité précisés pour chaque dîner.', true, null, null, true, false),
    ('partner_benefits', 'Partner Benefits', 'Tarifs préférentiels ou privilèges négociés auprès de partenaires approuvés du programme VIP.', 'discount', 'Partner privilege', null, null, 'active_members', 'Consulter le partenaire et présenter la confirmation ou carte VIP selon les instructions.', 'Les conditions du partenaire et les périodes de validité s’appliquent.', false, null, null, true, false),
    ('birthday_milestone_recognition', 'Birthday & Milestone Recognition', 'Reconnaissance spéciale à l’occasion de certains anniversaires, réussites ou jalons importants.', 'gift', 'Recognition', null, null, 'active_members', 'L’équipe VIP contacte le membre ou enregistre la reconnaissance selon le calendrier.', 'Le contenu de la reconnaissance varie selon le pays, le niveau et l’occasion.', false, null, null, false, false),
    ('vip_concierge', 'VIP Concierge', 'Assistance prioritaire pour événements, inscriptions, voyages VIP et compréhension des privilèges disponibles.', 'assistance', 'Concierge', null, null, 'active_members', 'Contacter le VIP Manager via les canaux définis dans Super Leader VIP.', 'L’assistance est limitée aux services et partenaires couverts par le programme.', false, null, null, false, false),
    ('priority_support', 'Priority Support', 'Traitement prioritaire de certaines demandes liées au programme Super Leader VIP.', 'priority', 'Priority support', null, null, 'active_members', 'Identifier la demande comme VIP via le canal prévu.', 'Les délais dépendent de la nature et de la complexité de la demande.', false, null, null, false, false),
    ('early_access', 'Early Access', 'Accès anticipé à certaines annonces, programmes, événements, produits ou fonctionnalités sélectionnées.', 'priority', 'Early access', null, null, 'active_members', 'Consulter les publications VIP et suivre les instructions de réservation.', 'L’accès anticipé ne garantit pas la disponibilité finale.', false, null, null, false, false),
    ('guest_pass', 'VIP Guest Pass', 'Possibilité d’inviter ponctuellement un conjoint, partenaire ou invité à certains événements éligibles.', 'complimentary', 'Guest pass', null, null, 'active_members', 'Demander le Guest Pass en indiquant le nom de l’invité et l’événement.', 'Un Guest Pass n’accorde pas le statut de membre VIP. L’invité doit respecter les règles de l’événement.', true, 1, null, true, false),
    ('singapore_vip_experience', 'Singapore VIP Experience', 'Expérience internationale à Singapour destinée à un cercle restreint, avec programme privé et networking.', 'exclusive_access', 'Singapore', 'Singapore', 'Singapore', 'active_members', 'Soumettre une demande d’intérêt. Le VIP Manager confirme l’éligibilité, les dates et les conditions finales.', 'Brouillon de privilège à adapter avant activation : dates, coûts, visa, hébergement et capacité doivent être confirmés.', true, 1, null, true, false)
)
insert into public.vip_benefits (
  organization_id, seed_code, title, description, benefit_type, value_label,
  country, city, eligibility_scope, eligible_categories, redemption_instructions,
  terms_and_conditions, status, requires_approval, usage_limit_per_member,
  total_usage_limit, guest_allowed, transferable, created_by, updated_by
)
select
  oa.organization_id, s.seed_code, s.title, s.description, s.benefit_type, s.value_label,
  s.country, s.city, s.eligibility_scope, '{}'::text[], s.redemption_instructions,
  s.terms_and_conditions, 'draft', s.requires_approval, s.usage_limit_per_member,
  s.total_usage_limit::integer, s.guest_allowed, s.transferable, oa.actor_id, oa.actor_id
from org_actor oa
cross join starter s
where oa.actor_id is not null
on conflict (organization_id, seed_code) where seed_code is not null do nothing;

comment on column public.vip_program_settings.vip_manager_user_id is 'Staff user selected by Owner/Admin as the scoped operational VIP Manager.';
comment on column public.vip_program_settings.vip_assistant_manager_user_id is 'Staff user selected by Owner/Admin as the scoped operational VIP Assistant Manager.';
comment on column public.vip_benefits.seed_code is 'Stable code for starter catalogue entries; null for user-created benefits.';
comment on column public.vip_benefits.guest_allowed is 'Whether an eligible member may include a guest when the benefit terms allow it.';
comment on column public.vip_benefits.transferable is 'Whether the benefit may be transferred to another eligible person.';

notify pgrst, 'reload schema';
commit;
