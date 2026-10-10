-- LE PLAN COMPTABLE DES DOSSIERS, ÉTAPE PC1 : LE CATALOGUE DES RÔLES ET LE PLAN D'UN DOSSIER, EN BASE (ligne 43 de la
-- feuille de route ; conception du 09/10/2026, HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION »).
--
-- « L'entité établit un plan de comptes conforme au plan de comptes figurant à l'article 1121-1 » (PCG, règlement ANC
-- n° 2014-03 consolidé au 1er janvier 2026, art. 1011-5) : le plan est celui du DOSSIER. Les vingt-six comptes que
-- l'application tient elle-même (src/lib/comptes.ts) deviennent des RÔLES — la banque, la TVA, les tiers, le compte de
-- l'exploitant… — dont chacun garde la racine que le plan comptable lui impose (« Le numéro de chaque compte
-- divisionnaire commence toujours par le numéro du compte ou sous-compte dont il constitue une subdivision »,
-- art. 1131-1) et reçoit un compte par défaut : celui d'aujourd'hui.
--
-- ÉTAPE NEUTRE. Cette migration pose le catalogue des rôles, la table où un dossier réglera les siens et les trois
-- fonctions qui disent le plan effectif d'un dossier : sa ligne, sinon le défaut du catalogue. RIEN NE LES LIT ENCORE :
-- aucune fonction existante ne change (étape PC2), aucun écran ni module (PC3). Et rien ne peut encore y écrire. Le plan
-- de chaque dossier est donc, et reste jusqu'à l'étape PC4, le plan par défaut : exactement les constantes d'aujourd'hui.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE (10/10/2026). Deux recommandations de la conception sont prises
-- comme HYPOTHÈSES, chacune rangée pour qu'une autre réponse se reprenne par `create or replace function`, sans rien
-- retirer :
--   - Q5, la longueur des numéros de compte : SIX CHIFFRES. La forme d'un compte de rôle vit dans la garde du plan
--     (`garder_plan_comptable_dossier`), non dans une contrainte de table ; une longueur par dossier la remplacerait.
--     La contrainte de la colonne ne dit que ce qui ne se règle jamais : des chiffres, trois au moins, classes 1 à 7.
--   - Q3, qui lit et règle le plan d'un dossier : COMME SON MODÈLE COMPTABLE. Tout membre du cabinet à qui le dossier
--     est ouvert (`admin_du_dossier`) le lit, et la lecture restera la même si le cabinet répond « le chef seul » : un
--     membre affecté lit le plan pour composer ses écritures. Qui le RÈGLE est l'affaire de la fonction de l'étape PC4.
-- Aucune autre question n'est tranchée ici. Q7 (le 468 permis pour le dirigeant non associé) reste ouverte : la seule
-- racine de ce rôle est le 467, comme aujourd'hui. Q6 (le préfixe des comptes auxiliaires réglable) aussi : la colonne
-- existe, rien ne la remplit.
--
-- AUCUNE POLICY D'ÉCRITURE, pas même l'insertion de restauration que portent les autres tables figées. Tant que rien ne
-- règle un plan (PC4), aucune sauvegarde n'en porte une ligne et aucune restauration n'a à en écrire : fermée à tout
-- compte connecté, la table reste vide par construction, et les étapes PC2 et PC3 lisent le plan par défaut quoi qu'il
-- arrive. L'étape PC4 ouvrira, avec la fonction qui règle le plan, l'insertion réservée au super-administrateur pour la
-- restauration : la garde en porte déjà la règle.
--
-- Données mesurées le 10/10/2026 (comptes seulement) : quatre dossiers, tous en trésorerie, leur dirigeant au 455000 ;
-- le dossier `test` n'a ni écriture, ni à-nouveau, ni solde reporté. Aucun compte de rôle n'est écrit nulle part.

-- ══ Le catalogue des rôles ══
-- Une TABLE plutôt qu'une liste dans une contrainte : ajouter un rôle est une insertion, que la clé étrangère du plan
-- vise aussitôt. Données de référence posées par cette migration et jamais écrites ensuite, faute de policy d'écriture.
-- Le défaut d'un rôle existant ne change pas : il décide des comptes de tout dossier qui ne règle pas ce rôle
-- (épinglé par src/lib/planComptable.test.ts). Ce sont les numéros publics du plan comptable, rien d'un dossier : tout
-- compte connecté les lit, comme les cours de la BCE (`taux_change_bce`).
--   - `racines` : les racines du PCG sous lesquelles le compte du rôle se tient (art. 1131-1) ;
--   - `compte_defaut` : la constante d'aujourd'hui ;
--   - `libelle_defaut` : le libellé que l'application donne aujourd'hui à ce compte (`LIBELLES_COMPTES`, déjà au plan
--     comptable de 2026 pour le 467, le 658 et le 758) ; NUL pour le capital et les deux comptes du résultat, que
--     l'application ne nomme pas d'avance : leur libellé est celui que le report des soldes leur donne ;
--   - `prefixe_auxiliaire_defaut` : le préfixe des comptes auxiliaires des trois rôles de tiers (F, FI, C,
--     src/lib/engagement.ts), nul ailleurs ;
--   - `ordre` : l'ordre d'affichage, de dix en dix pour qu'un rôle nouveau s'insère sans rien renuméroter.
create table public.roles_comptables (
  role text primary key
    constraint roles_comptables_role check (role ~ '^[a-z][a-z_]*[a-z]$' and length(role) <= 63),
  racines text[] not null
    constraint roles_comptables_racines check (cardinality(racines) between 1 and 4
      and array_position(racines, null) is null
      and array_to_string(racines, ',') ~ '^[1-7][0-9]{1,4}(,[1-7][0-9]{1,4})*$'),
  compte_defaut text not null
    constraint roles_comptables_compte_defaut check (compte_defaut ~ '^[1-7][0-9]{5}$'),
  libelle_defaut text
    constraint roles_comptables_libelle_defaut
      check (btrim(libelle_defaut, E' \t\n\r') <> '' and length(libelle_defaut) <= 200),
  prefixe_auxiliaire_defaut text
    constraint roles_comptables_prefixe_auxiliaire_defaut check (prefixe_auxiliaire_defaut ~ '^[A-Z0-9]{1,5}$'),
  ordre integer not null,
  constraint roles_comptables_ordre_unique unique (ordre),
  constraint roles_comptables_defaut_sous_sa_racine check (
    left(compte_defaut, 2) = any (racines) or left(compte_defaut, 3) = any (racines)
    or left(compte_defaut, 4) = any (racines) or left(compte_defaut, 5) = any (racines))
);

insert into public.roles_comptables (role, racines, compte_defaut, libelle_defaut, prefixe_auxiliaire_defaut, ordre) values
  ('banque', '{512}', '512000', 'Banque', null, 10),
  ('tva_deductible', '{44566}', '445660', 'TVA déductible', null, 20),
  ('tva_immobilisations', '{44562}', '445620', 'TVA déductible sur immobilisations', null, 30),
  ('tva_collectee', '{44571}', '445710', 'TVA collectée', null, 40),
  ('tva_a_decaisser', '{44551}', '445510', 'TVA à décaisser', null, 50),
  ('credit_tva_a_reporter', '{44567}', '445670', 'Crédit de TVA à reporter', null, 60),
  ('remboursement_tva_demande', '{44583}', '445830', 'Remboursement de taxes sur le chiffre d''affaires demandé', null, 70),
  ('arrondi_charge', '{658}', '658000', 'Pénalités et autres charges', null, 80),
  ('arrondi_produit', '{758}', '758000', 'Indemnités et autres produits', null, 90),
  ('fournisseurs', '{401}', '401000', 'Fournisseurs', 'F', 100),
  ('fournisseurs_immobilisations', '{404}', '404000', 'Fournisseurs d''immobilisations', 'FI', 110),
  ('clients', '{411}', '411000', 'Clients', 'C', 120),
  ('exploitant', '{108}', '108000', 'Compte de l''exploitant', null, 130),
  ('associe', '{455}', '455000', 'Associés — comptes courants', null, 140),
  ('autres_debiteurs_crediteurs', '{467}', '467000', 'Divers comptes débiteurs et produits à recevoir', null, 150),
  ('emprunt', '{164}', '164000', 'Emprunts auprès des établissements de crédit', null, 160),
  ('interets_emprunt', '{6611}', '661100', 'Intérêts des emprunts et dettes', null, 170),
  ('assurance_emprunt', '{616}', '616800', 'Assurance des emprunts', null, 180),
  ('cotisations_exploitant', '{646}', '646000', 'Cotisations sociales personnelles de l''exploitant', null, 190),
  ('dotations_amortissements', '{6811}', '681100', 'Dotations aux amortissements des immobilisations', null, 200),
  ('indemnites_kilometriques', '{6251}', '625110', 'Indemnités kilométriques (barème)', null, 210),
  ('virements_internes', '{58}', '580000', 'Virements internes', null, 220),
  ('depots_cautionnements_verses', '{275}', '275000', 'Dépôts et cautionnements versés', null, 230),
  ('capital_individuel', '{101}', '101000', null, null, 240),
  ('resultat_benefice', '{120}', '120000', null, null, 250),
  ('resultat_perte', '{129}', '129000', null, null, 260);

-- ══ Le plan d'un dossier ══
-- Les seuls rôles qu'un dossier règle : un rôle sans ligne prend le défaut du catalogue, jamais celui d'un modèle à la
-- volée — un modèle du cabinet (étape PC5) se COPIE dans le dossier. Le plan effectif ne dépend donc que des lignes du
-- dossier et de défauts qui ne changent pas ; une sauvegarde restaurée retrouve exactement son plan.
--   - `compte` : des chiffres seulement, trois au moins, classes 1 à 7 (LPF, art. A47 A-1 : « les trois premiers
--     caractères doivent correspondre à des chiffres » ; un compte de rôle ne porte que des chiffres) ; sa longueur et
--     sa racine, la garde les juge ;
--   - `libelle` : nul, celui du catalogue ; sinon l'intitulé de la subdivision que le dossier a ouverte (A47 A-1,
--     CompteLib ; BOI-CF-IOR-60-40-20, § 150) — il peut nommer un associé, RGPD.md le dit ;
--   - `prefixe_auxiliaire` : celui des comptes auxiliaires d'un rôle de tiers (BOI-CF-IOR-60-40-20, § 160), nul : celui
--     du catalogue ;
--   - `origine` : ce qui a posé la ligne, pour l'écran — le dossier lui-même, le modèle du cabinet, la balance reprise ;
--   - `regle_par`, `regle_le` : qui et quand, repère d'audit sans clé étrangère (comme `exercices_valides.valide_par`).
create table public.plan_comptable_dossier (
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  role text not null references public.roles_comptables (role),
  compte text not null
    constraint plan_comptable_dossier_compte check (compte ~ '^[1-7][0-9]{2,}$'),
  libelle text
    constraint plan_comptable_dossier_libelle check (btrim(libelle, E' \t\n\r') <> '' and length(libelle) <= 200),
  prefixe_auxiliaire text,
  origine text not null default 'dossier'
    constraint plan_comptable_dossier_origine check (origine in ('dossier', 'modele_du_cabinet', 'balance_reprise')),
  regle_par uuid,
  regle_le timestamptz not null default now(),
  constraint plan_comptable_dossier_pkey primary key (dossier_id, role)
);
-- La clé vers le catalogue n'est couverte par aucun index (celui de la clé primaire commence par le dossier).
create index plan_comptable_dossier_role on public.plan_comptable_dossier (role);

-- ══ La garde du plan d'un dossier ══
-- Ce qu'une ligne du plan EST, quelle que soit la porte qui l'écrit : un compte de six chiffres (HYPOTHÈSE Q5), qui
-- commence par une racine que le catalogue donne à son rôle (art. 1131-1) ; un préfixe de comptes auxiliaires sur les
-- trois rôles de tiers seulement, d'une à cinq lettres majuscules ou chiffres. Un rôle inconnu du catalogue passe ici
-- et bute sur la clé étrangère : c'est ce que rencontrerait la restauration d'une sauvegarde plus récente que la base
-- (point NON VÉRIFIÉ 7 de la conception, éprouvé par supabase/essais/planComptable.sql et restauration.sql).
-- Et qui l'écrit : personne directement — aucune policy d'écriture pour les comptes connectés, et ce refus-ci pour ceux
-- qui passent la RLS —, sauf la restauration d'une sauvegarde par le super-administrateur, dans un dossier qui ne porte
-- encore ni écriture, ni à-nouveau, ni solde reporté, sous le verrou EXCLUSIF de la validation du dossier : une
-- première écriture concurrente attend, puis trouve le plan. Une ligne ne se modifie pas, et ne part qu'avec son
-- dossier, que sa ligne ne voit déjà plus pendant la cascade. La fonction qui réglera le plan (PC4) remplacera cette
-- garde pour y ajouter sa porte.
-- DEFINER pour lire les écritures, les à-nouveaux et les soldes reportés quelle que soit la RLS de l'appelant, et
-- prendre le verrou de la validation ; elle ne rend que la ligne, ou le refus.
create function public.garder_plan_comptable_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_racines text[];
  v_prefixe_defaut text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une ligne du plan comptable d''un dossier ne se retire pas directement : elle part avec son dossier.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une ligne du plan comptable d''un dossier ne se modifie pas directement.' using errcode = '42501';
  end if;
  if not public.is_super_admin() then
    raise exception 'Le plan comptable d''un dossier ne s''écrit pas directement : seule la restauration d''une sauvegarde, par l''administrateur de l''application, y insère une ligne.'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_validation(new.dossier_id));
  if exists (select 1 from public.ecritures_brouillon e where e.dossier_id = new.dossier_id)
     or exists (select 1 from public.a_nouveaux a where a.dossier_id = new.dossier_id)
     or exists (select 1 from public.soldes_reportes s where s.dossier_id = new.dossier_id) then
    raise exception 'Ce dossier porte déjà des écritures : son plan comptable ne se restaure que dans un dossier qui n''en a encore aucune.'
      using errcode = '23514';
  end if;
  select r.racines, r.prefixe_auxiliaire_defaut into v_racines, v_prefixe_defaut
    from public.roles_comptables r where r.role = new.role;
  if not found then
    return new;
  end if;
  if new.compte !~ '^[0-9]{6}$' then
    raise exception 'Le compte du rôle « % » s''écrit en six chiffres : « % » n''en est pas un.', new.role, new.compte
      using errcode = '23514';
  end if;
  if new.compte is not null
     and not exists (select 1 from unnest(v_racines) as x(racine) where left(new.compte, length(x.racine)) = x.racine) then
    raise exception 'Le compte du rôle « % » commence par sa racine du plan comptable (%) : « % » n''en est pas un.',
      new.role, array_to_string(v_racines, ' ou '), new.compte using errcode = '23514';
  end if;
  if new.prefixe_auxiliaire is not null and v_prefixe_defaut is null then
    raise exception 'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « % ».',
      new.role using errcode = '23514';
  end if;
  if new.prefixe_auxiliaire !~ '^[A-Z0-9]{1,5}$' then
    raise exception 'Le préfixe des comptes auxiliaires du rôle « % » s''écrit d''une à cinq lettres majuscules ou chiffres : « % » n''en est pas un.',
      new.role, new.prefixe_auxiliaire using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger plan_comptable_dossier_gardes
  before insert or update or delete on public.plan_comptable_dossier
  for each row execute function public.garder_plan_comptable_dossier();

-- ══ Le compte d'un rôle dans un dossier ══
-- La ligne que le dossier règle, sinon le défaut du catalogue : sans ligne, exactement la constante d'aujourd'hui. Lève
-- sur un rôle inconnu, jamais un compte nul écrit. Les fonctions de la base le liront à l'étape PC2 à la place de leurs
-- comptes en dur ; quatre des cinq qui lisent le compte du dirigeant s'exécutent aux droits de l'appelant, d'où les
-- siens : exécutable par les comptes connectés, aux droits de l'appelant. Qui ne lit pas le plan du dossier (la RLS le
-- lui cache) en reçoit le défaut du rôle, ce que le catalogue public dit déjà, jamais le compte que le dossier règle ;
-- une fonction qui l'appelle aura vérifié l'accès au dossier avant.
create function public.compte_du_role(p_dossier_id uuid, p_role text) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_compte text;
begin
  select coalesce(p.compte, r.compte_defaut) into v_compte
    from public.roles_comptables r
    left join public.plan_comptable_dossier p on p.dossier_id = p_dossier_id and p.role = r.role
   where r.role = p_role;
  if v_compte is null then
    raise exception 'Rôle comptable inconnu : « % ».', p_role using errcode = '22023';
  end if;
  return v_compte;
end
$$;

-- ══ Le compte du dirigeant d'un dossier ══
-- En engagement, le compte que le dossier a choisi pour son dirigeant (`compte_notes_de_frais`) ; en trésorerie, le
-- compte du rôle `exploitant`. C'est l'expression que cinq fonctions recopient aujourd'hui (classer_virement_personnel,
-- ventiler_mouvement_bancaire, ecrire_forfait_kilometrique, ecrire_mouvement_compte_bilan,
-- enregistrer_paiement_personnel_cotisation), le 108000 lu dans le plan ; nulle quand le dossier n'existe pas ou que
-- l'appelant ne le voit pas, comme leur `select … into`. src/lib/planComptable.test.ts et l'essai la confrontent à
-- leur texte.
create function public.compte_du_dirigeant(p_dossier_id uuid) returns text
language sql
stable
set search_path = public
as $$
  select case when d.mode_comptable = 'engagement' then d.compte_notes_de_frais
              else public.compte_du_role(d.id, 'exploitant') end
    from public.dossiers d
   where d.id = p_dossier_id
$$;

-- ══ Le plan effectif d'un dossier ══
-- Un rôle par ligne, dans l'ordre du catalogue : le compte, le libellé et le préfixe des auxiliaires que le dossier
-- règle, sinon ceux du catalogue, et d'où ils viennent (`application` pour un rôle que le dossier ne règle pas).
-- L'application et l'assistant le liront avec le dossier (PC3), après `admin_du_dossier` (HYPOTHÈSE Q3) : le client du
-- dossier n'en voit rien.
create function public.plan_du_dossier(p_dossier_id uuid)
returns table (role text, compte text, libelle text, prefixe_auxiliaire text, origine text)
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  return query
    select r.role, coalesce(p.compte, r.compte_defaut), coalesce(p.libelle, r.libelle_defaut),
           coalesce(p.prefixe_auxiliaire, r.prefixe_auxiliaire_defaut), coalesce(p.origine, 'application')
      from public.roles_comptables r
      left join public.plan_comptable_dossier p on p.dossier_id = p_dossier_id and p.role = r.role
     order by r.ordre;
end
$$;

-- ══ Qui lit, qui écrit ══
-- Le catalogue : tout compte connecté le lit. Le plan d'un dossier : le cabinet à qui le dossier est ouvert le lit ;
-- aucune policy ne nomme le client, qui n'en voit rien. Aucune policy d'écriture, pour personne (voir l'en-tête).
alter table public.roles_comptables enable row level security;
create policy roles_comptables_lecture on public.roles_comptables
  for select to authenticated using (true);

alter table public.plan_comptable_dossier enable row level security;
create policy plan_comptable_dossier_lecture on public.plan_comptable_dossier
  for select to authenticated using (admin_du_dossier(dossier_id));

revoke execute on function public.garder_plan_comptable_dossier() from public, anon, authenticated;
revoke execute on function public.compte_du_role(uuid, text) from public, anon;
revoke execute on function public.compte_du_dirigeant(uuid) from public, anon;
revoke execute on function public.plan_du_dossier(uuid) from public, anon;
grant execute on function public.compte_du_role(uuid, text) to authenticated;
grant execute on function public.compte_du_dirigeant(uuid) to authenticated;
grant execute on function public.plan_du_dossier(uuid) to authenticated;

comment on table public.roles_comptables is
  'Les rôles comptables que l''application tient elle-même (ligne 43, étape PC1) : racines du PCG, compte et libellé par défaut — les constantes de src/lib/comptes.ts —, préfixe des auxiliaires d''un rôle de tiers. Posé par migration, jamais écrit ensuite ; lu par tout compte connecté.';
comment on table public.plan_comptable_dossier is
  'Les rôles qu''un dossier règle (ligne 43) : un rôle sans ligne prend le défaut de roles_comptables. Lu par le cabinet du dossier (admin_du_dossier), jamais par le client ; aucune policy d''écriture, et la garde (garder_plan_comptable_dossier) n''admet que la restauration d''une sauvegarde par le super-administrateur dans un dossier sans écriture. Vide jusqu''à l''étape PC4.';
comment on function public.compte_du_role(uuid, text) is
  'Le compte d''un rôle dans un dossier : sa ligne de plan_comptable_dossier, sinon le défaut du catalogue ; lève sur un rôle inconnu.';
comment on function public.compte_du_dirigeant(uuid) is
  'Le compte du dirigeant d''un dossier : compte_notes_de_frais en engagement, le compte du rôle exploitant en trésorerie.';
comment on function public.plan_du_dossier(uuid) is
  'Le plan effectif d''un dossier, un rôle par ligne dans l''ordre du catalogue, après admin_du_dossier.';
