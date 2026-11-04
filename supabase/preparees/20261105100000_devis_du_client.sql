-- LES DEVIS, EN BASE (espace client, étape P5 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE
-- GESTION DU CLIENT : LA CONCEPTION », §2.3, §3 et §4.3, et « LES DEVIS, EN BASE — ESPACE CLIENT, ÉTAPE P5 »). Réécrite le
-- 04/11/2026 contre le schéma de la production à 171 migrations : celle du 10/10/2026, éprouvée et accordée par le cabinet
-- le 18/10/2026, n'a jamais été commitée. Présentée au cabinet avant d'être appliquée : elle OUVRE au client qui porte la
-- case « Ventes » la lecture de deux tables et quatre fonctions (CLAUDE.md, « une policy qui lui ouvre une lecture se
-- présente au cabinet »). Pour `apply_migration` : son texte ne porte aucune instruction qui retire quoi que ce soit — le
-- mot n'y paraît que dans les clauses `on ... cascade` des clés étrangères et dans l'événement des deux déclencheurs, que
-- le détecteur de l'outil laisse passer (mesuré le 10/10/2026, HISTORIQUE.md, « LE DÉTECTEUR D'`apply_migration`,
-- MESURÉ ») ; la fonction qui supprime un brouillon vient à part, à coller (`devis_du_client_suppression`).
--
-- CE QU'UN DEVIS EST (service-public.gouv.fr, « Devis », F31144 ; code de la consommation, art. L111-1 et L214-1) : une
-- OFFRE, qui engage le professionnel une fois acceptée et le client à son acceptation ; aucune durée de validité légale :
-- elle se fixe. Il n'entre ni en comptabilité ni dans la facture électronique. Un devis est un BROUILLON, puis ÉMIS —
-- numéroté « D<année>-<0001> » dans la série du dossier et figé —, et reçoit une RÉPONSE une fois ; « expiré » et
-- « facturé » se déduisent (src/lib/devis.ts, `etatDuDevis`).
--
-- CE QU'ELLE POSE :
--   1. trois tables : `devis` (le devis entier, ses lignes en jsonb — aucune table de lignes à remplacer —, le client et
--      ses mentions sous les contraintes de `factures_emises`, recopiées, l'émetteur figé à l'émission, le numéro nul
--      jusqu'à l'émission et unique par dossier d'une contrainte TOTALE, la réponse complète ou absente, les montants au
--      centime, qui a créé, émis et répondu, sans clé vers les comptes) ; `devis_numerotation` (le repère de la série par
--      dossier et par année, SANS policy) ; `devis_factures` (le lien d'un devis accepté à la facture qui en est tirée :
--      une facture vient d'un devis au plus) ;
--   2. la porte de la restauration (`restauration_des_devis`) et deux gardes : `devis_figes` (un devis émis ne change
--      plus que sa réponse, une fois ; ne se supprime plus, sauf avec son dossier ; ne s'émet que par `enregistrer_devis`,
--      qui l'annonce par le réglage `jd.emission_devis` ; ne naît émis que par la porte de la restauration — le
--      super-administrateur, dans un dossier sans série) et `devis_factures_gardes` (un devis accepté de son dossier, une
--      facture de ce dossier, jamais un avoir ; le lien ne change pas ; il part avec la facture, le devis ou le dossier) ;
--   3. six policies, toutes `to authenticated` : la lecture du cabinet (`admin_du_dossier`), celle du client « Ventes »
--      (`client_du_dossier(…, 'ventes')`), l'insertion de la restauration (le super-administrateur) — sur `devis` et sur
--      `devis_factures` ; aucune policy de mise à jour ni de suppression ; aucune sur la série ;
--   4. trois fonctions SECURITY DEFINER, l'accès jugé AVANT toute lecture (`gere_les_ventes`, 42501), les colonnes
--      énumérées, les refus dans l'ordre que src/lib/devis.ts redit avant le clic : `enregistrer_devis`, `decider_devis`,
--      `facturer_devis` (une facture BROUILLON par `enregistrer_facture`, sous l'identité de l'appelant).
--
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : l'étape P2 (`factures_emises.valide_par`, `supprimer_brouillon_facture`),
-- les prédicats des droits, `enregistrer_facture` à cinq paramètres et `centimes_ligne_facture` à quatre (la correction de la
-- facture du 02/11/2026) ; et que les devis ne sont pas déjà en base.
-- CE QU'ELLE NE FAIT PAS : aucune table, policy ni fonction d'hier n'est modifiée ; aucune donnée d'hier n'est lue ni
-- écrite ; aucun écran (étape P6), aucune Edge Function. Tant que le cabinet ne coche pas « Ventes », rien ne s'ouvre à un
-- client (règlement (UE) 2016/679, art. 25 § 2).
-- SON RETOUR : supabase/preparees/retour/20261105100200_retour_devis_du_client.sql, DESTRUCTIF, à coller seulement sur
-- l'accord explicite du cabinet.
--
-- Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if not exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = 'factures_emises' and c.column_name = 'valide_par')
     or to_regprocedure('public.supprimer_brouillon_facture(uuid, uuid)') is null then
    raise exception 'Les migrations de l''étape P2 (ventes_du_client, ventes_du_client_facturation) ne sont pas en base : cette migration les suppose.';
  end if;
  if to_regprocedure('public.gere_les_ventes(uuid)') is null
     or to_regprocedure('public.client_du_dossier(uuid, text)') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.enregistrer_facture(uuid, uuid, jsonb, jsonb, boolean)') is null
     or to_regprocedure('public.centimes_ligne_facture(numeric, numeric, numeric, boolean)') is null then
    raise exception 'Une fonction que les devis appellent manque (gere_les_ventes, client_du_dossier, admin_du_dossier, is_super_admin, enregistrer_facture à cinq paramètres, centimes_ligne_facture à quatre) : relire la base avant d''appliquer cette migration.';
  end if;
  if to_regclass('public.devis') is not null or to_regclass('public.devis_numerotation') is not null
     or to_regclass('public.devis_factures') is not null then
    raise exception 'Les tables des devis sont déjà en base : cette migration est déjà appliquée.';
  end if;
end
$garde$;

-- ══ 1. Les devis ══════════
-- Le client et ses mentions prennent les contraintes de `factures_emises`, recopiées sous le préfixe `devis_` : ce qu'un
-- devis range, la facture qui en est tirée l'accepte, sans traduction. Les montants, ceux des lignes au centime : la
-- fonction les vérifie, les contraintes en gardent la forme.
create table public.devis (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  numero text,
  statut text not null default 'brouillon',
  date_emission date not null,
  date_validite date not null,
  objet text,
  tiers_nom text not null,
  tiers_adresse text,
  tiers_siret text,
  tiers_email text,
  type_client text,
  tiers_siren text,
  tiers_adresse_electronique text,
  code_service text,
  numero_engagement text,
  nature_operation text,
  date_prestation date,
  periode_debut date,
  periode_fin date,
  livraison_adresse text,
  livraison_code_postal text,
  livraison_ville text,
  livraison_pays text,
  lignes jsonb not null,
  montant_ht numeric not null,
  montant_tva numeric not null,
  montant_ttc numeric not null,
  conditions text,
  mentions_legales text,
  notes text,
  emetteur_nom text,
  emetteur_siret text,
  emetteur_adresse text,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  emis_par uuid,
  emis_le timestamptz,
  reponse text,
  date_reponse date,
  decide_par uuid,
  decide_le timestamptz,
  -- Le numéro, unique dans son dossier : une contrainte TOTALE (jamais un index partiel) ; les brouillons, sans numéro,
  -- ne se heurtent pas.
  constraint devis_numero_unique unique (dossier_id, numero),
  constraint devis_statut_check check (statut in ('brouillon', 'emis')),
  constraint devis_emission_complete check ((statut = 'emis') = (numero is not null) and (statut = 'emis') = (emis_le is not null)),
  constraint devis_emis_par_de_l_emission check (emis_par is null or statut = 'emis'),
  constraint devis_numero_de_sa_serie check (numero ~ '^D[0-9]{4}-[0-9]{4,}$'
    and substr(numero, 2, 4) = extract(year from date_emission)::integer::text),
  constraint devis_validite_apres_la_date check (date_validite >= date_emission),
  constraint devis_lignes_en_liste check (jsonb_typeof(lignes) = 'array'),
  constraint devis_montants_au_centime check (montant_ht = round(montant_ht, 2) and montant_tva = round(montant_tva, 2)
    and montant_ttc = round(montant_ttc, 2)),
  constraint devis_ttc_du_ht_et_de_la_tva check (montant_ttc = montant_ht + montant_tva),
  constraint devis_reponse_check check (reponse in ('acceptee', 'refusee')),
  constraint devis_reponse_complete check (num_nonnulls(reponse, date_reponse, decide_le) in (0, 3)
    and (decide_par is null or reponse is not null)),
  constraint devis_reponse_d_un_devis_emis check (reponse is null or statut = 'emis'),
  -- Celles de `factures_emises`, au caractère près.
  constraint devis_type_client_check check (type_client in ('assujetti', 'organisme_public', 'non_assujetti', 'etranger')),
  constraint devis_tiers_siren_check check (tiers_siren ~ '^[0-9]{9}$'),
  constraint devis_siret_du_siren check (tiers_siren is null or tiers_siret is null
    or (tiers_siret ~ '^[0-9]{14}$' and left(tiers_siret, 9) = tiers_siren)),
  constraint devis_adresse_electronique_check check (tiers_adresse_electronique
    ~ '^[0-9]{9}(_[0-9]{14}(_[-_/@a-zA-Z0-9]{1,100})?|_[-_.@a-zA-Z0-9]{1,100})?$'),
  constraint devis_adresse_electronique_routee check (tiers_adresse_electronique is null
    or coalesce(type_client in ('assujetti', 'organisme_public'), false)),
  constraint devis_code_service_check check (length(code_service) <= 100 and btrim(code_service) <> ''),
  constraint devis_organisme_public check (code_service is null or coalesce(type_client = 'organisme_public', false)),
  constraint devis_numero_engagement_check check (length(numero_engagement) <= 50 and btrim(numero_engagement) <> ''),
  constraint devis_nature_operation_check check (nature_operation in ('biens', 'services', 'mixte')),
  constraint devis_date_ou_periode check (date_prestation is null or periode_debut is null),
  constraint devis_periode_complete check ((periode_debut is null) = (periode_fin is null)),
  constraint devis_periode_ordonnee check (periode_fin >= periode_debut),
  constraint devis_livraison_complete check (num_nonnulls(livraison_adresse, livraison_code_postal, livraison_ville,
    livraison_pays) in (0, 4)),
  constraint devis_livraison_non_vide check (btrim(livraison_adresse) <> '' and btrim(livraison_code_postal) <> ''
    and btrim(livraison_ville) <> ''),
  constraint devis_livraison_pays_check check (livraison_pays ~ '^[A-Z]{2}$'),
  constraint devis_livraison_de_biens check (livraison_adresse is null or nature_operation is distinct from 'services')
);

comment on table public.devis is
  'Les devis d''un dossier (espace client, étape P5) : un brouillon, puis émis (numéroté D<année>-<0001> dans la série du dossier, figé), qui reçoit une réponse une fois. Le cabinet et le client qui porte « Ventes » le lisent ; seules les fonctions l''écrivent (enregistrer_devis, decider_devis, facturer_devis, supprimer_brouillon_devis), et le super-administrateur qui restaure.';

-- ══ 2. La série des devis, par dossier et par année ══════════
-- Le repère du dernier numéro pris ; la fonction reprend du plus haut numéro émis quand il retarde (une base restaurée).
-- Aucune policy : personne ne la lit hors des fonctions, et une sauvegarde n'en emporte rien.
create table public.devis_numerotation (
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null,
  dernier_numero integer not null default 0,
  primary key (dossier_id, annee)
);

comment on table public.devis_numerotation is
  'Le repère de la série des devis d''un dossier, par année de la date du devis. Sans policy : enregistrer_devis seule le lit et l''écrit, sous son verrou.';

-- ══ 3. La facture tirée d'un devis accepté ══════════
create table public.devis_factures (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  devis_id uuid not null references public.devis (id) on delete cascade,
  facture_id uuid not null references public.factures_emises (id) on delete cascade,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  constraint devis_factures_une_facture_un_devis unique (facture_id)
);

create index devis_factures_devis_id on public.devis_factures (devis_id);
create index devis_factures_dossier_id on public.devis_factures (dossier_id);

comment on table public.devis_factures is
  'Le lien d''un devis accepté à la facture qui en est tirée (facturer_devis) : une facture vient d''un devis au plus. Le lien part avec le brouillon de la facture, le devis ou le dossier.';

-- ══ 4. La porte de la restauration ══════════
-- Vrai pour le super-administrateur dans un dossier sans série de devis : la restauration d'une sauvegarde, qui n'emporte
-- pas la série, pose les devis émis tels qu'ils étaient ; la série se reprend ensuite du plus haut numéro restauré.
create function public.restauration_des_devis(p_dossier_id uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    and not exists (select 1 from public.devis_numerotation n where n.dossier_id = p_dossier_id)
$$;

-- ══ 5. La garde des devis ══════════
-- DEFINER pour lire le dossier et la série quelle que soit la RLS de l'appelant ; elle ne rend rien qu'elle n'ait reçu.
-- Un devis émis ne change plus que sa réponse, une fois, et ne se supprime plus — sauf avec son dossier entier, dont la
-- suppression emporte ses devis : sa ligne ne le voit déjà plus. Un brouillon ne devient émis que par `enregistrer_devis`,
-- qui annonce CE devis par le réglage `jd.emission_devis` ; un devis ne naît émis que par la porte de la restauration.
create function public.garder_devis() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reponse constant text[] := array['reponse', 'date_reponse', 'decide_par', 'decide_le'];
begin
  if tg_op = 'INSERT' then
    if new.statut = 'emis' and not public.restauration_des_devis(new.dossier_id) then
      raise exception 'Un devis ne naît pas émis : il s''émet par enregistrer_devis, qui lui donne son numéro.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.statut = 'emis' then
      if to_jsonb(new) - v_reponse is distinct from to_jsonb(old) - v_reponse then
        raise exception 'Le devis % est émis : il ne se modifie plus — il se duplique.', old.numero using errcode = '23514';
      end if;
      if old.reponse is not null and to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception 'La réponse au devis % est enregistrée : elle ne change plus.', old.numero using errcode = '23514';
      end if;
      return new;
    end if;
    if new.statut = 'emis'
       and coalesce(current_setting('jd.emission_devis', true), '') is distinct from new.id::text then
      raise exception 'Un devis ne s''émet que par enregistrer_devis, qui lui donne son numéro.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- La suppression : avec son dossier, toujours ; un brouillon, par la fonction qui le supprime ; un devis émis, jamais.
  if not exists (select 1 from public.dossiers x where x.id = old.dossier_id) then
    return old;
  end if;
  if old.statut = 'emis' then
    raise exception 'Le devis % est émis : il ne se supprime plus.', old.numero using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger devis_figes before insert or update or delete on public.devis
  for each row execute function public.garder_devis();

-- ══ 6. La garde des liens ══════════
-- INVOKER : elle lit le devis et la facture avec les droits de qui écrit le lien — la fonction qui le pose, la
-- restauration (le super-administrateur), ou le propriétaire de la base. Le lien part avec la facture (le brouillon
-- supprimé), le devis ou le dossier : sa ligne ne voit alors plus l'un d'eux.
create function public.garder_devis_facture() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.devis d
                    where d.id = new.devis_id and d.dossier_id = new.dossier_id
                      and d.statut = 'emis' and d.reponse = 'acceptee') then
      raise exception 'Une facture se tire d''un devis accepté de son dossier.' using errcode = '23514';
    end if;
    if not exists (select 1 from public.factures_emises f
                    where f.id = new.facture_id and f.dossier_id = new.dossier_id and f.type = 'facture') then
      raise exception 'Le lien d''un devis vise une facture de son dossier, jamais un avoir.' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Le lien d''un devis à sa facture ne change pas.' using errcode = '23514';
  end if;

  if not exists (select 1 from public.factures_emises f where f.id = old.facture_id)
     or not exists (select 1 from public.devis d where d.id = old.devis_id)
     or not exists (select 1 from public.dossiers x where x.id = old.dossier_id) then
    return old;
  end if;
  raise exception 'Le lien d''un devis à sa facture ne part qu''avec la facture, le devis ou le dossier.' using errcode = '23514';
end;
$$;

create trigger devis_factures_gardes before insert or update or delete on public.devis_factures
  for each row execute function public.garder_devis_facture();

-- ══ 7. Qui lit, qui écrit ══════════
-- Le cabinet du dossier et le client qui porte le droit « Ventes » LISENT les devis et leurs liens ; personne n'écrit
-- directement — les fonctions, et le super-administrateur qui restaure une sauvegarde. La série : aucune policy.
alter table public.devis enable row level security;
create policy devis_lecture on public.devis
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy devis_lecture_ventes on public.devis
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy devis_restauration on public.devis
  for insert to authenticated with check (public.is_super_admin());

alter table public.devis_factures enable row level security;
create policy devis_factures_lecture on public.devis_factures
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy devis_factures_lecture_ventes on public.devis_factures
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy devis_factures_restauration on public.devis_factures
  for insert to authenticated with check (public.is_super_admin());

alter table public.devis_numerotation enable row level security;

-- ══ 8. Enregistrer un devis ══════════
-- Le créer (`p_devis_id` nul) ou réécrire un brouillon EN ENTIER (une clé absente vaut nul), et l'émettre (`p_emettre`).
-- Rend le devis et son numéro (nul tant qu'il n'est pas émis).
--
-- Les refus, dans cet ordre — celui que src/lib/devis.ts (`REFUS_ENREGISTREMENT_DEVIS`) redit avant le clic, sous les
-- mêmes mots, en lisant le JSON comme ici (`->>`, `btrim` qui ne retire que les espaces, une date AAAA-MM-JJ qui existe) :
--   1. l'accès au dossier annoncé, le cabinet ou le client « Ventes », avant de rien lire (42501) ;
--   2. le devis, dans ce dossier (P0002), verrouillé ; 3. un devis émis ne se modifie plus ;
--   4. le nom du client ; 5 à 8. la date (présente, puis pas avant l'an 2000), la validité (présente, puis pas avant la
--      date) ;
--   9. de une à 500 lignes ; 10 à 15. chaque ligne dans l'ordre : sa forme, sa désignation, sa quantité (positive, quatre
--      décimales au plus), son prix (six décimales au plus), son montant (sous dix milliards d'euros), son taux (la liste
--      G1.24 des taux admis) ;
--   16. les montants de l'en-tête, des nombres, ceux des lignes au centime (`centimes_ligne_facture`, comme `calculerLigne`) ;
--   17 à 19. pour émettre : pas daté de l'avenir à Paris, un total positif, l'émetteur nommé.
-- Tous en 22023, sauf l'accès et « introuvable » ; les contraintes des mentions du client viennent après (23514). Deux
-- bornes TECHNIQUES, pas des règles de droit : 500 lignes, une ligne sous dix milliards d'euros — de quoi compter tout
-- total exactement au centime dans le navigateur.
--
-- La ligne se réécrit telle que lue, en quatre clés. Le numéro « D<année>-<0001> » se prend sous le verrou de la série de
-- l'année de la DATE du devis, repris du plus haut numéro émis quand le repère retarde.
create function public.enregistrer_devis(p_dossier_id uuid, p_devis_id uuid, p_devis jsonb, p_lignes jsonb, p_emettre boolean)
returns table (devis_id uuid, numero text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.devis;
  v_texte text;
  v_an integer;
  v_mois integer;
  v_jour integer;
  v_date date;
  v_validite date;
  v_ligne record;
  v_designation text;
  v_quantite numeric;
  v_prix numeric;
  v_taux numeric;
  v_centimes record;
  v_ht bigint := 0;
  v_tva bigint := 0;
  v_lignes jsonb := '[]'::jsonb;
  v_aujourdhui date;
  v_id uuid;
  v_prefixe text;
  v_repere integer;
  v_emis integer;
  v_sequence integer;
  v_numero text;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  if p_devis_id is not null then
    select d.* into v_existant
      from public.devis d
     where d.id = p_devis_id and d.dossier_id = p_dossier_id
       for update;
    if not found then
      raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_existant.statut = 'emis' then
      raise exception 'Le devis % est émis : il ne se modifie plus — il se duplique.', v_existant.numero using errcode = '22023';
    end if;
  end if;

  if btrim(coalesce(p_devis->>'tiers_nom', '')) = '' then
    raise exception 'Le nom du client est à renseigner.' using errcode = '22023';
  end if;

  -- Une date : une chaîne AAAA-MM-JJ qui existe au calendrier grégorien (ni l'an 0, ni le 30 février), nulle sinon — jamais
  -- l'erreur brute d'une conversion, ni « today » que Postgres lirait.
  v_texte := p_devis->>'date_emission';
  if v_texte ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_an := substr(v_texte, 1, 4)::integer;
    v_mois := substr(v_texte, 6, 2)::integer;
    v_jour := substr(v_texte, 9, 2)::integer;
    if v_an >= 1 and v_mois between 1 and 12 then
      if v_jour between 1 and extract(day from make_date(v_an, v_mois, 1) + interval '1 month' - interval '1 day') then
        v_date := make_date(v_an, v_mois, v_jour);
      end if;
    end if;
  end if;
  if v_date is null then
    raise exception 'La date du devis est à renseigner.' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' then
    raise exception 'Un devis ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;

  v_texte := p_devis->>'date_validite';
  if v_texte ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_an := substr(v_texte, 1, 4)::integer;
    v_mois := substr(v_texte, 6, 2)::integer;
    v_jour := substr(v_texte, 9, 2)::integer;
    if v_an >= 1 and v_mois between 1 and 12 then
      if v_jour between 1 and extract(day from make_date(v_an, v_mois, 1) + interval '1 month' - interval '1 day') then
        v_validite := make_date(v_an, v_mois, v_jour);
      end if;
    end if;
  end if;
  if v_validite is null then
    raise exception 'La date de validité du devis est à renseigner.' using errcode = '22023';
  end if;
  if v_validite < v_date then
    raise exception 'Un devis n''expire pas avant sa date : valable jusqu''au %, il est daté du %.',
      to_char(v_validite, 'DD/MM/YYYY'), to_char(v_date, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  if (case when jsonb_typeof(p_lignes) = 'array' then jsonb_array_length(p_lignes) else 0 end) not between 1 and 500 then
    raise exception 'Un devis porte au moins une ligne, et au plus 500.' using errcode = '22023';
  end if;

  for v_ligne in select l.valeur, l.ord from jsonb_array_elements(p_lignes) with ordinality as l(valeur, ord) order by l.ord loop
    if jsonb_typeof(v_ligne.valeur) is distinct from 'object'
       or jsonb_typeof(v_ligne.valeur->'designation') is distinct from 'string'
       or jsonb_typeof(v_ligne.valeur->'quantite') is distinct from 'number'
       or jsonb_typeof(v_ligne.valeur->'prix_unitaire_ht') is distinct from 'number'
       or jsonb_typeof(v_ligne.valeur->'taux_tva') is distinct from 'number' then
      raise exception 'La ligne % n''est pas une ligne de devis : une désignation, une quantité, un prix unitaire hors taxes et un taux de TVA.',
        v_ligne.ord using errcode = '22023';
    end if;
    v_designation := v_ligne.valeur->>'designation';
    v_quantite := (v_ligne.valeur->>'quantite')::numeric;
    v_prix := (v_ligne.valeur->>'prix_unitaire_ht')::numeric;
    v_taux := (v_ligne.valeur->>'taux_tva')::numeric;
    if btrim(v_designation) = '' then
      raise exception 'Ligne % : sa désignation manque.', v_ligne.ord using errcode = '22023';
    end if;
    -- Les décimales, comptées sur l'écriture décimale reçue.
    if v_quantite <= 0 or scale(v_quantite) > 4 then
      raise exception 'Ligne % : la quantité est positive, avec quatre décimales au plus.', v_ligne.ord using errcode = '22023';
    end if;
    if scale(v_prix) > 6 then
      raise exception 'Ligne % : le prix unitaire hors taxes s''écrit avec six décimales au plus.', v_ligne.ord using errcode = '22023';
    end if;
    if abs(v_quantite * v_prix) >= 10000000000 then
      raise exception 'Ligne % : son montant hors taxes atteint dix milliards d''euros.', v_ligne.ord using errcode = '22023';
    end if;
    if v_taux not in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6) then
      raise exception 'Ligne % : le taux de % %% n''est pas un taux de TVA admis.', v_ligne.ord,
        replace(trim_scale(v_taux)::text, '.', ',') using errcode = '22023';
    end if;
    select c.ht_centimes, c.tva_centimes into v_centimes
      from public.centimes_ligne_facture(v_quantite, v_prix, v_taux, false) c;
    v_ht := v_ht + v_centimes.ht_centimes;
    v_tva := v_tva + v_centimes.tva_centimes;
    v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('designation', v_designation, 'quantite', v_quantite,
      'prix_unitaire_ht', v_prix, 'taux_tva', v_taux));
  end loop;

  if (case when jsonb_typeof(p_devis->'montant_ht') = 'number' and jsonb_typeof(p_devis->'montant_tva') = 'number'
                and jsonb_typeof(p_devis->'montant_ttc') = 'number'
           then (p_devis->>'montant_ht')::numeric * 100 <> v_ht
             or (p_devis->>'montant_tva')::numeric * 100 <> v_tva
             or (p_devis->>'montant_ttc')::numeric * 100 <> v_ht + v_tva
           else true end) then
    raise exception 'Les montants du devis ne sont pas ceux de ses lignes : % € HT, % € de TVA, % € TTC.',
      replace(to_char(v_ht / 100.0, 'FM999999999990.00'), '.', ','),
      replace(to_char(v_tva / 100.0, 'FM999999999990.00'), '.', ','),
      replace(to_char((v_ht + v_tva) / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '22023';
  end if;

  if p_emettre then
    v_aujourdhui := (now() at time zone 'Europe/Paris')::date;
    if v_date > v_aujourdhui then
      raise exception 'Un devis ne s''émet pas daté de l''avenir : nous sommes le %.', to_char(v_aujourdhui, 'DD/MM/YYYY')
        using errcode = '22023';
    end if;
    if v_ht + v_tva <= 0 then
      raise exception 'Un devis émis porte un montant : son total TTC est positif.' using errcode = '22023';
    end if;
    if btrim(coalesce(p_devis->>'emetteur_nom', '')) = '' then
      raise exception 'Le nom de l''émetteur du devis est à renseigner.' using errcode = '22023';
    end if;
  end if;

  -- Le brouillon, écrit en entier : les contraintes des mentions du client jugent ici (23514).
  if p_devis_id is null then
    insert into public.devis (
      dossier_id, date_emission, date_validite, objet,
      tiers_nom, tiers_adresse, tiers_siret, tiers_email,
      type_client, tiers_siren, tiers_adresse_electronique, code_service, numero_engagement,
      nature_operation, date_prestation, periode_debut, periode_fin,
      livraison_adresse, livraison_code_postal, livraison_ville, livraison_pays,
      lignes, montant_ht, montant_tva, montant_ttc,
      conditions, mentions_legales, notes,
      emetteur_nom, emetteur_siret, emetteur_adresse,
      cree_par
    ) values (
      p_dossier_id, v_date, v_validite, p_devis->>'objet',
      p_devis->>'tiers_nom', p_devis->>'tiers_adresse', p_devis->>'tiers_siret', p_devis->>'tiers_email',
      nullif(p_devis->>'type_client', ''), nullif(p_devis->>'tiers_siren', ''),
      nullif(p_devis->>'tiers_adresse_electronique', ''), nullif(p_devis->>'code_service', ''),
      nullif(p_devis->>'numero_engagement', ''),
      nullif(p_devis->>'nature_operation', ''), nullif(p_devis->>'date_prestation', '')::date,
      nullif(p_devis->>'periode_debut', '')::date, nullif(p_devis->>'periode_fin', '')::date,
      nullif(p_devis->>'livraison_adresse', ''), nullif(p_devis->>'livraison_code_postal', ''),
      nullif(p_devis->>'livraison_ville', ''), nullif(p_devis->>'livraison_pays', ''),
      v_lignes, round(v_ht::numeric / 100, 2), round(v_tva::numeric / 100, 2), round((v_ht + v_tva)::numeric / 100, 2),
      p_devis->>'conditions', p_devis->>'mentions_legales', p_devis->>'notes',
      p_devis->>'emetteur_nom', p_devis->>'emetteur_siret', p_devis->>'emetteur_adresse',
      auth.uid()
    )
    returning id into v_id;
  else
    update public.devis d set
      date_emission = v_date,
      date_validite = v_validite,
      objet = p_devis->>'objet',
      tiers_nom = p_devis->>'tiers_nom',
      tiers_adresse = p_devis->>'tiers_adresse',
      tiers_siret = p_devis->>'tiers_siret',
      tiers_email = p_devis->>'tiers_email',
      type_client = nullif(p_devis->>'type_client', ''),
      tiers_siren = nullif(p_devis->>'tiers_siren', ''),
      tiers_adresse_electronique = nullif(p_devis->>'tiers_adresse_electronique', ''),
      code_service = nullif(p_devis->>'code_service', ''),
      numero_engagement = nullif(p_devis->>'numero_engagement', ''),
      nature_operation = nullif(p_devis->>'nature_operation', ''),
      date_prestation = nullif(p_devis->>'date_prestation', '')::date,
      periode_debut = nullif(p_devis->>'periode_debut', '')::date,
      periode_fin = nullif(p_devis->>'periode_fin', '')::date,
      livraison_adresse = nullif(p_devis->>'livraison_adresse', ''),
      livraison_code_postal = nullif(p_devis->>'livraison_code_postal', ''),
      livraison_ville = nullif(p_devis->>'livraison_ville', ''),
      livraison_pays = nullif(p_devis->>'livraison_pays', ''),
      lignes = v_lignes,
      montant_ht = round(v_ht::numeric / 100, 2),
      montant_tva = round(v_tva::numeric / 100, 2),
      montant_ttc = round((v_ht + v_tva)::numeric / 100, 2),
      conditions = p_devis->>'conditions',
      mentions_legales = p_devis->>'mentions_legales',
      notes = p_devis->>'notes',
      emetteur_nom = p_devis->>'emetteur_nom',
      emetteur_siret = p_devis->>'emetteur_siret',
      emetteur_adresse = p_devis->>'emetteur_adresse'
    where d.id = p_devis_id;
    v_id := p_devis_id;
  end if;

  -- L'émission : le numéro suivant de la série de l'année de la date, sous son verrou — deux émissions concurrentes se
  -- suivent, et la seconde prend le numéro suivant —, repris du plus haut numéro émis quand le repère retarde.
  if p_emettre then
    v_an := extract(year from v_date)::integer;
    insert into public.devis_numerotation (dossier_id, annee, dernier_numero)
    values (p_dossier_id, v_an, 0)
    on conflict (dossier_id, annee) do nothing;
    select n.dernier_numero into v_repere
      from public.devis_numerotation n
     where n.dossier_id = p_dossier_id and n.annee = v_an
       for update;
    v_prefixe := 'D' || v_an::text || '-';
    select coalesce(max(substr(d.numero, length(v_prefixe) + 1)::integer), 0) into v_emis
      from public.devis d
     where d.dossier_id = p_dossier_id and d.numero ~ ('^' || v_prefixe || '[0-9]+$');
    v_sequence := greatest(v_repere, v_emis) + 1;
    update public.devis_numerotation n set dernier_numero = v_sequence
     where n.dossier_id = p_dossier_id and n.annee = v_an;
    v_numero := v_prefixe || lpad(v_sequence::text, greatest(4, length(v_sequence::text)), '0');
    perform set_config('jd.emission_devis', v_id::text, true);
    update public.devis d set statut = 'emis', numero = v_numero, emis_par = auth.uid(), emis_le = now()
     where d.id = v_id;
    perform set_config('jd.emission_devis', '', true);
  end if;

  return query select v_id, v_numero;
end;
$$;

-- ══ 9. La réponse ══════════
-- Une fois, datée, ni avant le devis ni dans l'avenir à Paris ; une acceptation après la validité se CONFIRME
-- (`p_hors_validite`) : le professionnel peut encore accepter d'être engagé. Les refus, dans l'ordre que le module redit
-- (`REFUS_DECISION_DEVIS`). Rend le devis tel qu'il est écrit.
create function public.decider_devis(p_dossier_id uuid, p_devis_id uuid, p_reponse text, p_date date, p_hors_validite boolean)
returns public.devis
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis public.devis;
  v_aujourdhui date;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.* into v_devis
    from public.devis d
   where d.id = p_devis_id and d.dossier_id = p_dossier_id
     for update;
  if not found then
    raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'emis' then
    raise exception 'Le devis est un brouillon : il s''émet avant de recevoir une réponse.' using errcode = '22023';
  end if;
  if v_devis.reponse is not null then
    raise exception 'La réponse au devis % est déjà enregistrée (% le %) : elle ne change plus.', v_devis.numero,
      case v_devis.reponse when 'acceptee' then 'accepté' else 'refusé' end, to_char(v_devis.date_reponse, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if p_reponse is null or p_reponse not in ('acceptee', 'refusee') then
    raise exception 'La réponse au devis est « acceptée » ou « refusée ».' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'La date de la réponse est à renseigner.' using errcode = '22023';
  end if;
  if p_date < v_devis.date_emission then
    raise exception 'Une réponse ne précède pas le devis, daté du %.', to_char(v_devis.date_emission, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  v_aujourdhui := (now() at time zone 'Europe/Paris')::date;
  if p_date > v_aujourdhui then
    raise exception 'Une réponse ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourdhui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if p_reponse = 'acceptee' and p_date > v_devis.date_validite and not coalesce(p_hors_validite, false) then
    raise exception 'Le devis % n''était plus valable le % : il l''était jusqu''au %. Son acceptation se confirme.',
      v_devis.numero, to_char(p_date, 'DD/MM/YYYY'), to_char(v_devis.date_validite, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  update public.devis d set reponse = p_reponse, date_reponse = p_date, decide_par = auth.uid(), decide_le = now()
   where d.id = p_devis_id
  returning d.* into v_devis;
  return v_devis;
end;
$$;

-- ══ 10. La facture tirée d'un devis accepté ══════════
-- Une facture BROUILLON, par `enregistrer_facture` sous l'identité de l'appelant — ses refus et ses jugements d'aujourd'hui
-- s'appliquent tels quels —, datée du jour à Paris : le client et ses mentions, les lignes, les totaux, l'émetteur ; ni la
-- date ou la période d'exécution PRÉVUES (celles d'une facture se constatent), ni les mentions légales, ni les notes du
-- devis. Une fois : sous le verrou du devis, la première facture du lien (par date du lien, puis identifiant) se nomme dans
-- le refus. Le lien part avec le brouillon supprimé, et le devis se transforme de nouveau. Rend la facture.
create function public.facturer_devis(p_dossier_id uuid, p_devis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_devis public.devis;
  v_premiere text;
  v_facture uuid;
begin
  if not public.gere_les_ventes(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select d.* into v_devis
    from public.devis d
   where d.id = p_devis_id and d.dossier_id = p_dossier_id
     for update;
  if not found then
    raise exception 'Devis introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'emis' then
    raise exception 'Le devis est un brouillon : seul un devis accepté se transforme en facture.' using errcode = '22023';
  end if;
  if v_devis.reponse is distinct from 'acceptee' then
    raise exception 'Seul un devis accepté se transforme en facture : le devis % est %.', v_devis.numero,
      case when v_devis.reponse = 'refusee' then 'refusé' else 'en attente de réponse' end using errcode = '22023';
  end if;
  select coalesce(f.numero, 'un brouillon') into v_premiere
    from public.devis_factures l
    join public.factures_emises f on f.id = l.facture_id
   where l.devis_id = p_devis_id
   order by l.cree_le, l.id
   limit 1;
  if found then
    raise exception 'Le devis % a déjà sa facture (%) : un devis se transforme une fois.', v_devis.numero, v_premiere
      using errcode = '22023';
  end if;

  select e.facture_id into v_facture
    from public.enregistrer_facture(p_dossier_id, null, jsonb_build_object(
      'tiers_nom', v_devis.tiers_nom,
      'tiers_adresse', v_devis.tiers_adresse,
      'tiers_siret', v_devis.tiers_siret,
      'tiers_email', v_devis.tiers_email,
      'date_emission', (now() at time zone 'Europe/Paris')::date,
      'type_client', v_devis.type_client,
      'tiers_siren', v_devis.tiers_siren,
      'tiers_adresse_electronique', v_devis.tiers_adresse_electronique,
      'code_service', v_devis.code_service,
      'numero_engagement', v_devis.numero_engagement,
      'nature_operation', v_devis.nature_operation,
      'livraison_adresse', v_devis.livraison_adresse,
      'livraison_code_postal', v_devis.livraison_code_postal,
      'livraison_ville', v_devis.livraison_ville,
      'livraison_pays', v_devis.livraison_pays,
      'montant_ht', v_devis.montant_ht,
      'montant_tva', v_devis.montant_tva,
      'montant_ttc', v_devis.montant_ttc,
      'emetteur_nom', v_devis.emetteur_nom,
      'emetteur_siret', v_devis.emetteur_siret,
      'emetteur_adresse', v_devis.emetteur_adresse
    ), v_devis.lignes, false) e;

  insert into public.devis_factures (dossier_id, devis_id, facture_id, cree_par)
  values (p_dossier_id, p_devis_id, v_facture, auth.uid());
  return v_facture;
end;
$$;

-- ══ 11. Les droits ══════════
-- Les trois fonctions : le cabinet et le client « Ventes », qu'elles jugent elles-mêmes ; jamais l'anonyme ni PUBLIC. La
-- porte de la restauration et les deux gardes : aucun rôle (un déclencheur n'a pas besoin du droit d'exécuter).
revoke execute on function public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean) to authenticated;
revoke execute on function public.decider_devis(uuid, uuid, text, date, boolean) from public, anon;
grant execute on function public.decider_devis(uuid, uuid, text, date, boolean) to authenticated;
revoke execute on function public.facturer_devis(uuid, uuid) from public, anon;
grant execute on function public.facturer_devis(uuid, uuid) to authenticated;
revoke execute on function public.restauration_des_devis(uuid) from public, anon, authenticated;
revoke execute on function public.garder_devis() from public, anon, authenticated;
revoke execute on function public.garder_devis_facture() from public, anon, authenticated;

comment on function public.restauration_des_devis(uuid) is
  'Vrai pour le super-administrateur dans un dossier sans série de devis : la porte de la restauration d''une sauvegarde.';
comment on function public.garder_devis() is
  'Un devis émis ne change plus que sa réponse, une fois, et ne se supprime plus (sauf avec son dossier) ; il ne s''émet que par enregistrer_devis (réglage jd.emission_devis) et ne naît émis que par la restauration (déclencheur devis_figes).';
comment on function public.garder_devis_facture() is
  'Le lien d''un devis accepté de son dossier à une facture de ce dossier, jamais un avoir ; il ne change pas, et part avec la facture, le devis ou le dossier (déclencheur devis_factures_gardes).';
comment on function public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean) is
  'Crée ou réécrit un brouillon de devis, et l''émet (numéro D<année>-<0001>, sous le verrou de la série de l''année de sa date) : pour le cabinet du dossier ou un accès « Ventes » (42501). Dix-neuf refus dans l''ordre que src/lib/devis.ts redit ; les totaux confrontés au centime aux lignes (centimes_ligne_facture).';
comment on function public.decider_devis(uuid, uuid, text, date, boolean) is
  'Enregistre la réponse à un devis émis, une fois : acceptée ou refusée, datée ni avant le devis ni dans l''avenir à Paris ; une acceptation après la validité se confirme. Pour le cabinet du dossier ou un accès « Ventes » (42501).';
comment on function public.facturer_devis(uuid, uuid) is
  'Tire d''un devis accepté une facture brouillon, par enregistrer_facture sous l''identité de l''appelant, et pose le lien (devis_factures) : une fois. Pour le cabinet du dossier ou un accès « Ventes » (42501). Rend la facture.';
