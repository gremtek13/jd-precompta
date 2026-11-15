-- LA PRÉVISION DE TRÉSORERIE PUBLIÉE AU CLIENT « BANQUE » (espace client, ligne 51.5, partie C, C8-Q2 ; la réponse du
-- cabinet du 15/11/2026, « (C) Maintenant », contre la recommandation « après le MVP ») — PRÉPARÉE le 15/11/2026, PAS
-- APPLIQUÉE. Le récit : HISTORIQUE.md, « 15/11/2026 — C8-Q2 : LA PRÉVISION DE TRÉSORERIE PUBLIÉE AU CLIENT » ; l'essai :
-- supabase/essais/previsionsPubliees.sql ; le retour : supabase/preparees/retour/20261115100100_retour_previsions_publiees.sql.
-- Le patron : les situations publiées (C4a, supabase/schema/20261107164102_situations_publiees.sql).
--
-- LA RÈGLE. Le plan de trésorerie de l'onglet Financement se calcule des écritures du compte de banque, que le client ne
-- lit jamais : « Ma trésorerie » le disait « non compté ». Le cabinet le PUBLIE désormais, d'un geste : une prévision
-- établie le jour de sa publication, FIGÉE, que l'accès « Banque » du dossier lit, la dernière en cours seulement, sous le
-- mot « prévision », à part de ce qui est connu. Ce que la base fige (le contenu, version 1), des VALEURS, jamais un texte :
--   {version: 1, etablie_le: le jour de Paris de la publication,
--    depart: {au: la date de la dernière écriture de banque comptée (ou de l'ouverture), solde: en centimes},
--    rythme: {debut, fin: les mois complets observés (AAAA-MM), mois: leur nombre, mois_observes: ceux qui portent un
--             mouvement, encaissements, decaissements: les moyennes mensuelles, en centimes},
--    mois: [{mois: AAAA-MM, solde_debut, encaissements, decaissements, solde_fin}, …], du mois qui suit celui de la
--          publication, de 1 à 24, chacun parti du solde du précédent au rythme moyen (la projection linéaire de
--          src/lib/planTresorerie.ts, « si le rythme actuel se maintient »),
--    avec_especes: les recettes en espèces de la caisse entrent-elles dans le rythme}.
-- CE QU'ELLE NE PORTE PAS : aucun libellé d'écriture, aucun nom de tiers, ni d'emprunt (le nom d'un emprunt est un texte
-- libre du cabinet), aucune échéance ; la composition se fait dans src/lib/previsionsPubliees.ts, et la base VÉRIFIE que ce
-- qui se fige ne se contredit pas : la forme, le jour, des centimes entiers, des mois qui se suivent et un solde qui
-- s'enchaîne. Une prévision qui ne repose sur aucun mouvement observé ne se publie pas.
--
-- CE QU'ELLE POSE.
--   1. `previsions_publiees`, une ligne par GESTE : la « publication » d'une prévision (son contenu) ou son « retrait ».
--      FIGÉE : aucune ligne ne se modifie ni ne se supprime — une prévision se REMPLACE (une publication qui cite celle en
--      cours, `remplace_id`) ou se RETIRE (un retrait qui la cite) ; `remplace_id` est unique : une chaîne linéaire, et la
--      prévision en cours est la publication qu'aucune ligne ne cite. Une seule en cours par dossier : publier sans citer
--      celle en cours se refuse.
--   2. `garder_prevision_publiee`, avant la RLS, aux droits de l'appelant (security invoker, comme celle des situations) :
--      une ligne ne s'écrit que par sa fonction (le réglage `jd.previsions_publiees`) ou par la restauration (le
--      super-administrateur), jamais ne se réécrit, ne part qu'avec son dossier ; une ligne qui en cite une autre cite une
--      publication du même dossier. Elle ne lit la base que sous la RLS de l'appelant : à un appelant refusé, elle ne dit que
--      la règle — elle n'appelle donc pas la porte `_acces_avant_les_gardes`, dont la règle vise une garde security
--      definer (porteDevantLesGardes.test.ts, l'étape 32 de supabase/essais/accesAvantLesGardes.sql).
--   3. `refus_de_la_prevision(contenu, jour)` : le refus, en mots, d'un contenu, ou nul ; aucun rôle de l'API ne l'exécute.
--   4. `publier_prevision(dossier, contenu, prévision remplacée)` et `retirer_prevision(prévision)`, aux droits du
--      propriétaire, RÉSERVÉES AU CABINET du dossier (`admin_du_dossier`) ; chacune rend la ligne écrite.
--   5. `prevision_publiee_en_cours(prévision)` : vraie pour une publication qu'aucune ligne ne cite, et au seul cabinet du
--      dossier ou à un accès « Banque » de ce dossier — fausse à tout autre compte connecté, qui n'apprend rien d'un
--      identifiant (le bit que la relecture de sécurité de C4a, le 06/11/2026, a refermé sur les situations).
--   6. Les policies, toutes à `authenticated` : le cabinet du dossier lit toutes les lignes, retraits et prévisions
--      remplacées compris ; un accès « Banque » lit la seule prévision EN COURS de son dossier, chaque colonne ; le
--      super-administrateur insère (la restauration). Aucune policy de mise à jour ni de suppression, pour personne. CETTE
--      LECTURE DU CLIENT SE PRÉSENTE AU CABINET AVANT D'ÊTRE APPLIQUÉE (CLAUDE.md, « Trois domaines font exception » : la vue
--      de la banque) — la fiche « C8Q2-migration » des arbitrages.
--   7. La restrictive `deux_facteurs` de la double authentification, si sa migration est déjà en base (sinon, sa boucle la
--      posera) : les deux se collent dans les deux ordres.
--
-- POURQUOI « BANQUE ». La page « Ma trésorerie » vit sous elle, et la prévision ne dit que le rythme du compte de banque
-- et son solde, que cet accès lit déjà au relevé ; « Comptes » ouvre le revenu du dirigeant, que la prévision ne montre
-- pas. Une recette en espèces de la caisse, quand elle entre dans le rythme, n'y est qu'une part d'une moyenne :
-- `avec_especes` le dit au client, et la confirmation du cabinet le nomme (la question C8Q2-Q1).
--
-- LES REFUS, DANS L'ORDRE (que src/lib/previsionsPubliees.ts redit avant le clic, sous les mêmes mots) :
--   - `publier_prevision` : l'appelant qui n'est pas le cabinet du dossier (42501) ; puis, sous le verrou du dossier, le
--     contenu (22023 : sa forme ; le jour ; le départ ; le rythme ; aucun mouvement observé ; les mois) ; la prévision
--     remplacée qui n'est pas celle en cours de ce dossier (22023) ; une prévision en cours, que la nouvelle ne remplace
--     pas (22023) ;
--   - `retirer_prevision` : la prévision inconnue, ou d'un dossier dont l'appelant n'est pas le cabinet (42501, les mêmes
--     mots : rien n'apprend qu'elle existe) ; une prévision qui n'est plus en cours — remplacée, retirée, ou un retrait
--     (22023) ;
--   - la garde : une écriture hors des deux fonctions et de la restauration (42501) ; une mise à jour, une suppression hors
--     de celle du dossier (23514) ; une ligne qui cite autre chose qu'une publication du même dossier (23514).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`client_du_dossier`, `admin_du_dossier`,
-- `is_super_admin`, `droits_sur_le_dossier` sont appelées, jamais réécrites) ; ni `memberships`, ni ses cases. Elle se colle
-- donc avant ou après `trois_cases_de_l_acces` (B1, qui réécrit `client_du_dossier` : la garde de tête n'exige de lui que
-- de lire « banque » sur `droit_banque`, ce que ses deux corps font) et `deux_facteurs_exiges`. Aucune ligne écrite d'avance.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `PREVISIONS_PUBLIEES_PREVUES` (src/lib/previsionsPubliees.ts)
-- se lève alors, et la table entre au plan de sauvegarde. Rien n'y est retiré ni supprimé : elle passe par l'outil. Ni
-- barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés ; un `client_du_dossier` qui ne lirait plus « banque »
-- sur `droit_banque` (C4a et B1, qui ajoute trois mots, le lisent l'un et l'autre) ; et une base où manquerait une colonne
-- qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.previsions_publiees') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('publier_prevision', 'retirer_prevision', 'garder_prevision_publiee',
                                   'prevision_publiee_en_cours', 'refus_de_la_prevision')) then
    raise exception 'La migration previsions_publiees est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  -- `client_du_dossier` : le corps de C4a (`situations_publiees`), ou celui de B1 (`trois_cases_de_l_acces`) — l'un et l'autre
  -- lisent « banque » sur `droit_banque`, ce que la policy du client suppose : c'est ce mot que la garde exige.
  select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'client_du_dossier';
  select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)');
  if v_nombre <> 1 or v_empreinte is null
     or strpos(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure('public.client_du_dossier(uuid,text)')), chr(13), ''),
               'when ''banque'' then m.droit_banque') = 0 then
    raise exception 'La fonction public.client_du_dossier(uuid,text) ne lit plus « banque » sur droit_banque : la relire avant d''appliquer cette migration.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.memberships'::regclass and a.attname in ('user_id', 'dossier_id', 'droit_banque'))
       or (a.attrelid = 'public.dossiers'::regclass and a.attname = 'id'));
  if v_nombre <> 4 then
    raise exception 'Une colonne que cette migration lit manque (% sur 4) : appliquer d''abord droits_des_acces_clients.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La table ══════════
-- Une ligne par geste. Une publication porte son contenu ; un retrait ne porte que la publication qu'il retire. Sans clé
-- vers le compte de l'auteur : retirer le compte d'un membre parti ne doit pas effacer qui a publié (le patron de
-- `situations_publiees.auteur`).
create table public.previsions_publiees (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  geste text not null
    constraint previsions_publiees_geste check (geste in ('publication', 'retrait')),
  contenu jsonb
    constraint previsions_publiees_contenu
      check (jsonb_typeof(contenu) = 'object' and octet_length(contenu::text) <= 65536),
  remplace_id uuid references public.previsions_publiees (id),
  auteur uuid not null,
  publiee_le timestamptz not null default now(),
  constraint previsions_publiees_remplace check (remplace_id <> id),
  constraint previsions_publiees_une_suite unique (remplace_id),
  constraint previsions_publiees_forme check (
    (geste = 'publication' and contenu is not null)
    or (geste = 'retrait' and contenu is null and remplace_id is not null))
);

create index previsions_publiees_dossier on public.previsions_publiees (dossier_id, publiee_le);

comment on table public.previsions_publiees is
  'Les prévisions de trésorerie que le cabinet publie à l''accès « Banque » d''un dossier (espace client, C8-Q2) : une ligne par geste, la publication ou le retrait, FIGÉE — une prévision se remplace (remplace_id) ou se retire par ses fonctions, publier_prevision et retirer_prevision ; la prévision en cours est la publication qu''aucune ligne ne cite. Montants en centimes ; aucun texte libre.';
comment on column public.previsions_publiees.contenu is
  'La prévision publiée, version 1 : {version, etablie_le (le jour de Paris de la publication), depart {au, solde}, rythme {debut, fin, mois, mois_observes, encaissements, decaissements}, mois [{mois, solde_debut, encaissements, decaissements, solde_fin}], avec_especes} ; des centimes entiers, des mois qui se suivent depuis celui qui suit la publication, chacun parti du solde du précédent au rythme moyen (src/lib/previsionsPubliees.ts). Nul pour un retrait.';
comment on column public.previsions_publiees.remplace_id is
  'La publication en cours que cette ligne remplace (une publication) ou retire (un retrait) : du même dossier ; unique — une chaîne linéaire.';
comment on column public.previsions_publiees.auteur is
  'Le compte qui a publié ou retiré (auth.uid()), sans clé étrangère : il survit au retrait du compte.';

-- ══ 2. La garde ══════════
-- Avant la RLS, aux droits de l'appelant : elle ne lit la base que sous sa RLS. Une ligne ne s'écrit que par sa fonction —
-- `jd.previsions_publiees` porte l'identifiant de la ligne qu'elle insère, le temps de la transaction — ou par la
-- restauration (le super-administrateur, qui réinsère l'historique tel qu'il a été). Le retrait d'une ligne n'est admis
-- qu'avec son dossier (la cascade : le dossier n'est déjà plus là).
create function public.garder_prevision_publiee() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une prévision publiée ne part qu''avec son dossier : elle se retire, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une prévision publiée ne se modifie pas : elle se remplace ou se retire, et l''historique reste.'
      using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.previsions_publiees', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Une prévision ne s''écrit que par sa publication ou son retrait.' using errcode = '42501';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.previsions_publiees s
        where s.id = new.remplace_id and s.dossier_id = new.dossier_id and s.geste = 'publication') then
    raise exception 'Une prévision en remplace ou en retire une publiée pour le même dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_prevision_publiee() is
  'La garde de previsions_publiees (C8-Q2) : une ligne ne s''écrit que par publier_prevision ou retirer_prevision (jd.previsions_publiees) ou par la restauration du super-administrateur (42501), jamais ne se réécrit (23514), ne part qu''avec son dossier (23514) ; une ligne qui en cite une autre cite une publication du même dossier (23514).';

create trigger previsions_publiees_garde
  before insert or update or delete on public.previsions_publiees
  for each row execute function public.garder_prevision_publiee();

-- ══ 3. Qui lit ══════════
-- La prévision EN COURS : une publication qu'aucune ligne ne cite. Aux droits du propriétaire (la policy du client la lit
-- sur la table qu'elle garde, sans s'y rappeler) ; elle ne rend qu'un booléen sur un identifiant donné, et ne le rend vrai
-- qu'au cabinet du dossier ou à un accès « Banque » de ce dossier : à tout autre compte connecté, faux. Faux plutôt qu'un
-- refus : la policy du client l'appelle, et l'ordre de ses termes n'est pas garanti.
create function public.prevision_publiee_en_cours(p_prevision_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.previsions_publiees s where s.id = p_prevision_id and s.geste = 'publication'
                   and (public.admin_du_dossier(s.dossier_id) or public.client_du_dossier(s.dossier_id, 'banque')))
     and not exists (select 1 from public.previsions_publiees s where s.remplace_id = p_prevision_id)
$$;

comment on function public.prevision_publiee_en_cours(uuid) is
  'Vrai si cette ligne de previsions_publiees est une publication qu''aucune ligne ne remplace ni ne retire : la prévision en cours (C8-Q2). Faux pour qui n''est ni du cabinet du dossier ni un accès « Banque » de ce dossier.';

alter table public.previsions_publiees enable row level security;

create policy previsions_publiees_lecture on public.previsions_publiees
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy previsions_publiees_lecture_banque on public.previsions_publiees
  for select to authenticated
  using (client_du_dossier(dossier_id, 'banque') and geste = 'publication' and prevision_publiee_en_cours(id));
create policy previsions_publiees_restauration on public.previsions_publiees
  for insert to authenticated with check (is_super_admin());

-- ══ 4. Le contenu : sa forme ══════════
-- Le refus, en mots, d'un contenu, ou nul s'il est bien formé pour ce jour. Chaque test lit ce qu'un test d'avant a établi :
-- un IF par étape, jamais un OR qui supposerait un ordre d'évaluation pour une conversion. Les dates se lisent au format
-- ISO 8601 (indépendant du réglage DateStyle), les mois par l'arithmétique des entiers (AAAA-MM). La composition (le
-- TypeScript) n'est pas réécrite ici : la base VÉRIFIE que ce qui se fige ne se contredit pas.
create function public.refus_de_la_prevision(p_contenu jsonb, p_jour date) returns text
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  c_forme constant text := 'La prévision n''est pas dans la forme que la base connaît (version 1).';
  c_jour constant text := 'Une prévision se publie le jour où elle est établie : recalcule-la.';
  c_depart constant text := 'Le départ de la prévision est mal formé : un solde en centimes entiers, à une date qui n''est pas à venir.';
  c_rythme constant text := 'Le rythme de la prévision est mal formé : de 1 à 24 mois complets, jusqu''au mois qui précède celui où elle est établie, et des moyennes en centimes entiers, positives.';
  c_sans_mouvement constant text := 'La prévision ne repose sur aucun mouvement observé : elle ne se publie pas.';
  c_mois constant text := 'Les mois de la prévision ne se suivent pas : de 1 à 24, du mois qui suit celui où elle est établie, chacun parti du solde du précédent, au rythme moyen.';
  c_plafond constant numeric := 100000000000000;
  v_index integer;
  v_texte text;
  v_date date;
  v_depart jsonb;
  v_rythme jsonb;
  v_mois jsonb;
  v_ligne jsonb;
  v_n numeric;
  v_nombre integer;
  v_observes numeric;
  v_encaissements numeric;
  v_decaissements numeric;
  v_solde numeric;
  v_valeur numeric;
  i integer;
begin
  if p_jour is null then
    return c_jour;
  end if;
  -- L'index du mois du jour (année × 12 + mois − 1) : le mois décalé de j s'écrit par la division et le reste.
  v_index := extract(year from p_jour)::integer * 12 + extract(month from p_jour)::integer - 1;

  -- 1. La forme : un objet, ses six clés, la version 1, le drapeau des espèces.
  if jsonb_typeof(p_contenu) is distinct from 'object' then
    return c_forme;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_contenu) k)
       is distinct from array['avec_especes', 'depart', 'etablie_le', 'mois', 'rythme', 'version'] then
    return c_forme;
  end if;
  if (p_contenu -> 'version') is distinct from '1'::jsonb
     or jsonb_typeof(p_contenu -> 'avec_especes') is distinct from 'boolean' then
    return c_forme;
  end if;

  -- 2. Le jour : celui où la base la reçoit.
  v_texte := p_contenu ->> 'etablie_le';
  if jsonb_typeof(p_contenu -> 'etablie_le') is distinct from 'string' or v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return c_jour;
  end if;
  begin
    v_date := v_texte::date;
  exception when others then
    return c_jour;
  end;
  if v_date is distinct from p_jour then
    return c_jour;
  end if;

  -- 3. Le départ : un solde en centimes entiers, à une date qui n'est pas à venir.
  v_depart := p_contenu -> 'depart';
  if jsonb_typeof(v_depart) is distinct from 'object' then
    return c_depart;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_depart) k) is distinct from array['au', 'solde'] then
    return c_depart;
  end if;
  if jsonb_typeof(v_depart -> 'au') is distinct from 'string' or jsonb_typeof(v_depart -> 'solde') is distinct from 'number' then
    return c_depart;
  end if;
  v_texte := v_depart ->> 'au';
  if v_texte !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return c_depart;
  end if;
  begin
    v_date := v_texte::date;
  exception when others then
    return c_depart;
  end;
  if v_date > p_jour or v_date < date '2000-01-01' then
    return c_depart;
  end if;
  v_solde := (v_depart ->> 'solde')::numeric;
  if v_solde <> trunc(v_solde) or abs(v_solde) >= c_plafond then
    return c_depart;
  end if;

  -- 4. Le rythme : les mois complets qui précèdent celui de la prévision, et deux moyennes en centimes entiers, positives.
  v_rythme := p_contenu -> 'rythme';
  if jsonb_typeof(v_rythme) is distinct from 'object' then
    return c_rythme;
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_rythme) k)
       is distinct from array['debut', 'decaissements', 'encaissements', 'fin', 'mois', 'mois_observes'] then
    return c_rythme;
  end if;
  if jsonb_typeof(v_rythme -> 'mois') is distinct from 'number' or jsonb_typeof(v_rythme -> 'mois_observes') is distinct from 'number'
     or jsonb_typeof(v_rythme -> 'encaissements') is distinct from 'number'
     or jsonb_typeof(v_rythme -> 'decaissements') is distinct from 'number' then
    return c_rythme;
  end if;
  v_n := (v_rythme ->> 'mois')::numeric;
  v_observes := (v_rythme ->> 'mois_observes')::numeric;
  v_encaissements := (v_rythme ->> 'encaissements')::numeric;
  v_decaissements := (v_rythme ->> 'decaissements')::numeric;
  if v_n <> trunc(v_n) or v_n < 1 or v_n > 24 or v_observes <> trunc(v_observes) or v_observes < 0 or v_observes > v_n
     or v_encaissements <> trunc(v_encaissements) or v_encaissements < 0 or v_encaissements >= c_plafond
     or v_decaissements <> trunc(v_decaissements) or v_decaissements < 0 or v_decaissements >= c_plafond then
    return c_rythme;
  end if;
  v_nombre := v_n::integer;
  if (v_rythme ->> 'fin') is distinct from
       lpad(((v_index - 1) / 12)::text, 4, '0') || '-' || lpad((((v_index - 1) % 12) + 1)::text, 2, '0')
     or (v_rythme ->> 'debut') is distinct from
       lpad(((v_index - v_nombre) / 12)::text, 4, '0') || '-' || lpad((((v_index - v_nombre) % 12) + 1)::text, 2, '0') then
    return c_rythme;
  end if;
  if v_observes = 0 then
    return c_sans_mouvement;
  end if;

  -- 5. Les mois : de 1 à 24, du mois qui suit celui de la prévision, chacun parti du solde du précédent, au rythme moyen.
  v_mois := p_contenu -> 'mois';
  if jsonb_typeof(v_mois) is distinct from 'array' then
    return c_mois;
  end if;
  if jsonb_array_length(v_mois) < 1 or jsonb_array_length(v_mois) > 24 then
    return c_mois;
  end if;
  for i in 0 .. jsonb_array_length(v_mois) - 1 loop
    v_ligne := v_mois -> i;
    if jsonb_typeof(v_ligne) is distinct from 'object' then
      return c_mois;
    end if;
    if (select array_agg(k order by k collate "C") from jsonb_object_keys(v_ligne) k)
         is distinct from array['decaissements', 'encaissements', 'mois', 'solde_debut', 'solde_fin'] then
      return c_mois;
    end if;
    if jsonb_typeof(v_ligne -> 'solde_debut') is distinct from 'number' or jsonb_typeof(v_ligne -> 'solde_fin') is distinct from 'number'
       or jsonb_typeof(v_ligne -> 'encaissements') is distinct from 'number'
       or jsonb_typeof(v_ligne -> 'decaissements') is distinct from 'number' then
      return c_mois;
    end if;
    if (v_ligne ->> 'mois') is distinct from
         lpad(((v_index + i + 1) / 12)::text, 4, '0') || '-' || lpad((((v_index + i + 1) % 12) + 1)::text, 2, '0') then
      return c_mois;
    end if;
    if (v_ligne ->> 'solde_debut')::numeric <> v_solde
       or (v_ligne ->> 'encaissements')::numeric <> v_encaissements
       or (v_ligne ->> 'decaissements')::numeric <> v_decaissements then
      return c_mois;
    end if;
    v_valeur := (v_ligne ->> 'solde_fin')::numeric;
    if v_valeur <> v_solde + v_encaissements - v_decaissements or abs(v_valeur) >= c_plafond then
      return c_mois;
    end if;
    v_solde := v_valeur;
  end loop;
  return null;
end
$$;

comment on function public.refus_de_la_prevision(jsonb, date) is
  'Le refus, en mots, d''une prévision publiée (C8-Q2) pour le jour donné, ou nul si elle est bien formée : sa forme (version 1), le jour, le départ, le rythme, un mouvement observé au moins, des mois qui se suivent et s''enchaînent. N''écrit rien ; aucun rôle de l''API ne l''exécute.';

-- ══ 5. Publier une prévision ══════════
-- D'UN SEUL TENANT, sous un verrou des prévisions du dossier (deux publications ne se croisent pas). Le jour est celui de
-- Paris, lu par la base, jamais donné par l'appelant. Les refus, dans l'ordre de l'en-tête.
create function public.publier_prevision(p_dossier_id uuid, p_contenu jsonb, p_remplace_id uuid)
  returns public.previsions_publiees
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_jour date := (now() at time zone 'Europe/Paris')::date;
  v_refus text;
  v_id uuid := gen_random_uuid();
  v_ligne public.previsions_publiees;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('previsions_publiees:' || p_dossier_id::text, 0));
  v_refus := public.refus_de_la_prevision(p_contenu, v_jour);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;
  if p_remplace_id is not null then
    if not exists (select 1 from public.previsions_publiees s
                    where s.id = p_remplace_id and s.dossier_id = p_dossier_id and s.geste = 'publication')
       or exists (select 1 from public.previsions_publiees s where s.remplace_id = p_remplace_id) then
      raise exception 'La prévision remplacée n''est pas celle publiée en cours pour ce dossier.' using errcode = '22023';
    end if;
  elsif exists (select 1 from public.previsions_publiees s
                 where s.dossier_id = p_dossier_id and s.geste = 'publication'
                   and not exists (select 1 from public.previsions_publiees r where r.remplace_id = s.id)) then
    raise exception 'Une prévision est déjà publiée pour ce dossier : remplace-la.' using errcode = '22023';
  end if;

  perform set_config('jd.previsions_publiees', v_id::text, true);
  insert into public.previsions_publiees (id, dossier_id, geste, contenu, remplace_id, auteur)
  values (v_id, p_dossier_id, 'publication', p_contenu, p_remplace_id, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.previsions_publiees', '', true);
  return v_ligne;
end;
$$;

comment on function public.publier_prevision(uuid, jsonb, uuid) is
  'Publie une prévision de trésorerie à l''accès « Banque » du dossier (C8-Q2) : son contenu en centimes (version 1), établi le jour de Paris de la publication ; la première, ou le remplacement de celle en cours (p_remplace_id). Réservée au cabinet du dossier (42501) ; rend la ligne écrite.';

-- ══ 6. Retirer une prévision ══════════
-- Le retrait est une ligne : il cite la publication en cours qu'il retire ; rien ne se supprime.
create function public.retirer_prevision(p_prevision_id uuid) returns public.previsions_publiees
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_prevision public.previsions_publiees;
  v_id uuid := gen_random_uuid();
  v_ligne public.previsions_publiees;
begin
  select s.* into v_prevision from public.previsions_publiees s where s.id = p_prevision_id;
  if v_prevision.id is null or not public.admin_du_dossier(v_prevision.dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('previsions_publiees:' || v_prevision.dossier_id::text, 0));
  if v_prevision.geste <> 'publication'
     or exists (select 1 from public.previsions_publiees s where s.remplace_id = p_prevision_id) then
    raise exception 'Cette prévision n''est plus publiée : elle a été remplacée ou retirée.' using errcode = '22023';
  end if;
  perform set_config('jd.previsions_publiees', v_id::text, true);
  insert into public.previsions_publiees (id, dossier_id, geste, remplace_id, auteur)
  values (v_id, v_prevision.dossier_id, 'retrait', p_prevision_id, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.previsions_publiees', '', true);
  return v_ligne;
end;
$$;

comment on function public.retirer_prevision(uuid) is
  'Retire la prévision publiée en cours (C8-Q2) : une ligne « retrait » qui la cite ; le client ne la lit plus, l''historique reste. Réservée au cabinet du dossier (42501, aussi pour une prévision inconnue) ; rend le retrait.';

-- ══ 7. Les droits d'exécution ══════════
revoke execute on function public.publier_prevision(uuid, jsonb, uuid) from public, anon;
grant execute on function public.publier_prevision(uuid, jsonb, uuid) to authenticated;
revoke execute on function public.retirer_prevision(uuid) from public, anon;
grant execute on function public.retirer_prevision(uuid) to authenticated;
revoke execute on function public.prevision_publiee_en_cours(uuid) from public, anon;
grant execute on function public.prevision_publiee_en_cours(uuid) to authenticated;
revoke execute on function public.refus_de_la_prevision(jsonb, date) from public, anon, authenticated;
revoke execute on function public.garder_prevision_publiee() from public, anon, authenticated;

-- ══ 8. La double authentification exigée (C7, second temps), si elle est déjà en base ══════════
-- Appliquée avant `deux_facteurs_exiges`, ce bloc ne fait rien et sa boucle pose la restrictive sur la table ; après, il
-- la pose ici, à l'expression exacte (deuxFacteursDesTablesNeuves.test.ts).
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.previsions_publiees as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;

-- ══ 9. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue : la RLS active, trois policies permissives à authenticated seul, la garde
-- avant chaque écriture, les trois fonctions de l'API aux droits du propriétaire et le chemin fixé, ni l'anonyme ni PUBLIC
-- ne les exécutent ; et aucune ligne.
do $fin$
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.previsions_publiees'::regclass) then
    raise exception 'La table previsions_publiees n''a pas sa RLS.';
  end if;
  if (select count(*) from pg_policy p where p.polrelid = 'public.previsions_publiees'::regclass and p.polpermissive
        and p.polroles = array[to_regrole('authenticated')::oid]) <> 3
     or (select count(*) from pg_policy p where p.polrelid = 'public.previsions_publiees'::regclass and p.polpermissive) <> 3 then
    raise exception 'La table previsions_publiees ne porte pas ses trois policies permissives à authenticated seul.';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.previsions_publiees'::regclass
                  and t.tgname = 'previsions_publiees_garde' and not t.tgisinternal) then
    raise exception 'La garde de previsions_publiees manque.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid in ('public.publier_prevision(uuid, jsonb, uuid)'::regprocedure, 'public.retirer_prevision(uuid)'::regprocedure,
                       'public.prevision_publiee_en_cours(uuid)'::regprocedure)
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')) <> 3
     or has_function_privilege('authenticated', 'public.refus_de_la_prevision(jsonb, date)', 'execute')
     or has_function_privilege('authenticated', 'public.garder_prevision_publiee()', 'execute') then
    raise exception 'Les droits d''exécution des fonctions de la prévision publiée ne sont pas ceux que la migration pose.';
  end if;
  if exists (select 1 from public.previsions_publiees) then
    raise exception 'La table previsions_publiees porte une ligne : rien ne s''écrit d''avance.';
  end if;
end
$fin$;
