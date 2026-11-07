-- LES SITUATIONS PUBLIÉES, EN BASE (espace client, ligne 51.5, partie C, étape C4a ; MEG3-Q2, « la publication »). La
-- conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET
-- AU-DELÀ », C4 (« Les chiffres du comptable, publiés ») et MEG3-Q2 : le cabinet PUBLIE au client une situation datée —
-- recettes, dépenses par poste de la 2035, résultat, TVA due, comparaison à N−1 —, figée, marquée « provisoire » ou
-- « validée » (l'exercice validé), plutôt qu'un chiffre vivant ; le client la lit sous une case neuve de son accès,
-- « Comptes » (le revenu du dirigeant). Le patron de la case : C10 (`caisse_du_client`), la dernière case neuve.
--
-- CE QU'ELLE POSE.
--   1. La case : `memberships.droit_comptes`, booléen non nul, FAUX par défaut (règlement (UE) 2016/679, art. 25, § 2 : un
--      droit de lire le revenu du dirigeant n'arrive à aucun accès sans un geste du cabinet) ; `client_du_dossier` connaît
--      le mot « comptes » ; `droits_sur_le_dossier` rend la clé `comptes` (le cabinet du dossier, ou un accès « Comptes ») —
--      une clé de plus, sans changer la signature : les Edge Functions de la vente lisent leurs cases et ne ferment rien
--      sur une de plus. Aucune garde : « Comptes » ne suppose rien du dossier.
--   2. `changer_droits_acces` à CINQ paramètres (`p_comptes`, sans valeur par défaut), la seule écriture des droits, au
--      corps de la forme à quatre plus la case ; les formes à TROIS et à QUATRE deviennent chacune un appel DIRECT de la
--      forme à cinq, les cases qu'elles ne nomment pas nulles donc inchangées — un seul corps écrit `memberships`, aucune
--      forme n'est retirée (PostgREST distingue les trois par leurs noms de paramètres, et l'onglet Accès appelle celle à
--      quatre). C'EST AINSI QUE B1 L'ÉTENDRA : une forme à huit (« Achats », « Notes de frais », « Documents ») au corps de
--      celle-ci plus ses trois cases, et les formes à trois, quatre et cinq redirigées vers elle, chacune par un `create or
--      replace` — rien à retirer, donc l'outil. Le refus « aucun droit » nomme les cases de la forme la plus large.
--   3. `situations_publiees`, une ligne par GESTE : la « publication » d'une situation (son contenu, son statut, sa date
--      d'arrêté) ou son « retrait ». FIGÉE : aucune ligne ne se modifie ni ne se supprime — une situation se REMPLACE (une
--      publication qui cite la publication en cours de la même date, `remplace_id`) ou se RETIRE (un retrait qui la cite) ;
--      `remplace_id` est unique : chaque situation porte une CHAÎNE linéaire, et la situation en cours est la publication
--      qu'aucune ligne ne cite. Le statut se LIT de l'exercice à la publication (`exercices_valides`) : « validee » s'il est
--      validé, « provisoire » sinon — rien ne se devine, et le contenu que l'écran a composé doit dire le même (sinon
--      l'exercice a changé d'état depuis le calcul). Les montants sont des CENTIMES entiers ; la base vérifie que chaque
--      total est la somme de ses postes (la composition se fait dans src/lib/situationsPubliees.ts : la 2035 « à ce jour »
--      de lib/situationIntermediaire.ts et la CA3 de lib/declarationTva.ts, la même période de N−1 par le même calcul).
--   4. `garder_situation_publiee`, avant la RLS, aux droits de l'appelant : une ligne ne s'écrit que par sa fonction (le
--      réglage `jd.situations_publiees`) ou par la restauration (le super-administrateur), jamais ne se réécrit, et ne part
--      qu'avec son dossier ; une ligne qui en cite une autre cite une publication du même dossier et de la même date.
--   5. `publier_situation(dossier, date d'arrêté, contenu, situation remplacée)` et `retirer_situation(situation)`, aux
--      droits du propriétaire, RÉSERVÉES AU CABINET du dossier (`admin_du_dossier`) ; chacune rend la ligne écrite.
--   6. Les policies, toutes à `authenticated` : le cabinet du dossier lit toutes les lignes, retraits et situations
--      remplacées compris ; un accès « Comptes » lit les seules situations EN COURS de son dossier (une publication
--      qu'aucune ligne ne cite : `situation_publiee_en_cours`, qui ne répond vrai qu'au cabinet du dossier et à un accès
--      « Comptes »), chaque colonne ; le super-administrateur insère (la
--      restauration). Aucune policy de mise à jour ni de suppression, pour personne. Cette lecture du client se présente au
--      cabinet avant d'être appliquée (CLAUDE.md, « Trois domaines font exception »).
--
-- LES REFUS, DANS L'ORDRE (que src/lib/situationsPubliees.ts redit avant le clic, sous les mêmes mots) :
--   - `publier_situation` : l'appelant qui n'est pas le cabinet du dossier (42501) ; la date d'arrêté absente ou hors des
--     années admises (22023) ; une date à venir, au jour de Paris (22023) ; un contenu qui n'est pas de la forme connue
--     (22023, la version 1) ; un statut qui n'est pas celui de l'exercice (22023) ; une période qui n'est pas du 1er
--     janvier à la date d'arrêté (22023) ; des chiffres mal formés ou dont les totaux ne sont pas la somme des postes
--     (22023) ; la comparaison qui ne couvre pas la même période de l'exercice précédent, ou mal formée (22023) ; la
--     situation remplacée qui n'est pas la publication en cours de ce dossier à cette date (22023) ; une publication en
--     cours à cette date, que la nouvelle ne remplace pas (22023) ;
--   - `retirer_situation` : la situation inconnue, ou d'un dossier dont l'appelant n'est pas le cabinet (42501, les mêmes
--     mots : rien n'apprend qu'elle existe) ; une situation qui n'est plus en cours — remplacée, retirée, ou un retrait
--     (22023) ;
--   - `changer_droits_acces` à cinq paramètres : ceux de la forme à quatre, dans le même ordre (42501, 22023 — ses mots
--     nomment « Comptes » —, P0002) ;
--   - la garde : une écriture hors des deux fonctions et de la restauration (42501) ; une mise à jour, une suppression
--     hors de celle du dossier (23514) ; une ligne qui cite autre chose qu'une publication du même dossier et de la même
--     date (23514).
--
-- CE QU'ELLE NE CHANGE PAS : les policies de `memberships`, ses gardes (`garder_droit_ventes`, `garder_droit_caisse`) ;
-- `gere_les_ventes`, `gere_la_banque`, `gere_la_caisse` ; les quatre Edge Functions de la vente. Aucune ligne écrite
-- d'avance : aucun accès ne reçoit la case, aucune situation n'est publiée.
--
-- L'ORDRE AVEC P1-TRACE, FIXÉ LE 07/11/2026 (étape B1) : la trace des droits (`trace_des_droits`, PRÉPARÉE avant celle-ci)
-- s'applique la PREMIÈRE, et celle-ci, la seconde, l'étend à la case « Comptes » (section 1 bis) : la fonction de son
-- déclencheur, au corps de P1-trace plus la case, et la liste de ses colonnes, par des `create or replace` — la contrainte
-- du droit admet déjà le mot. La garde de tête refuse une base sans la trace, ou dont la trace n'est plus celle de P1-trace ;
-- la trace, elle, refuse une base où `memberships` porte une case qu'elle ne connaît pas (l'ordre gardé dans les deux sens,
-- depuis la relecture de sécurité du 06/11/2026). Après celle-ci, `trois_cases_de_l_acces` (B1) étend la trace de même.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `SITUATIONS_PUBLIEES_EXPORTEES` (src/lib/situationsPubliees.ts)
-- se lève alors, et la table entre au plan de sauvegarde. Les écrans (la case de l'onglet Accès, la publication par le
-- cabinet, la page du client) viendront à l'étape C4b. Le retour : supabase/preparees/retour/20261106150100.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; la trace des droits en base ; une fonction remplacée ou appelée qui ne serait plus
-- celle que cette migration suppose — à l'empreinte de son corps, les retours chariot d'un collage écartés ; et une base
-- où manquerait une colonne qu'elle lit.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.situations_publiees') is not null
     or exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and a.attname = 'droit_comptes'
                 and not a.attisdropped)
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('publier_situation', 'retirer_situation', 'garder_situation_publiee',
                                   'situation_publiee_en_cours', 'refus_des_chiffres_de_la_situation')) then
    raise exception 'La migration situations_publiees est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.trace_des_droits') is null then
    raise exception 'La trace des droits (trace_des_droits, P1-trace) manque : appliquer d''abord la migration trace_des_droits, que celle-ci étend à la case « Comptes ».';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = to_regprocedure('public.tracer_les_droits()'))
       is distinct from '0ef7ead57a5829ec8fed54fd7e561371'
     or strpos(coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                          where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit'), ''),
               '''comptes''') = 0 then
    raise exception 'La trace des droits n''est plus celle que cette migration suppose (tracer_les_droits, empreinte attendue 0ef7ead5… ; la contrainte du droit qui admet « comptes ») : la relire avant d''appliquer cette migration.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 1, 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', 1, '30e9b7246cb939741fe58f4ffc27adf4'),
      ('client_du_dossier', 'public.client_du_dossier(uuid,text)', 1, '68de0e0fd2dcfa303e7b838f9c76e351'),
      ('droits_sur_le_dossier', 'public.droits_sur_le_dossier(uuid)', 1, 'c18fd6fb7124010694841a9965d42d08'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid,boolean,boolean)', 2, '2cf20eedb2d699416b5710b471acd18d'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid,boolean,boolean,boolean)', 2, 'a0d9fbb9c865f2a33f6aefc61e37a792')
    ) as t(nom, signature, formes, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> v_attendue.formes or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if to_regprocedure('public.cle_validation(uuid)') is null then
    raise exception 'La fonction cle_validation manque : appliquer d''abord validation_des_exercices.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped
     and ((a.attrelid = 'public.memberships'::regclass
           and a.attname in ('id', 'user_id', 'dossier_id', 'droit_ventes', 'droit_banque', 'droit_caisse'))
       or (a.attrelid = 'public.exercices_valides'::regclass and a.attname in ('dossier_id', 'annee')));
  if v_nombre <> 8 then
    raise exception 'Une colonne que cette migration lit manque (% sur 8) : appliquer d''abord caisse_du_client.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. La case « Comptes » d'un accès ══════════
-- Fausse par défaut : un accès d'aujourd'hui n'en reçoit aucune, et la case ne s'ouvre que d'un geste du cabinet
-- (`changer_droits_acces`). Le client lit sa ligne (`memberships_select`), sa case comprise ; aucune policy de mise à
-- jour, pour personne.
alter table public.memberships
  add column droit_comptes boolean not null default false;

comment on column public.memberships.droit_comptes is
  'Le droit « Comptes » de cet accès : lire les situations que le cabinet publie (recettes, dépenses par poste de la 2035, résultat, TVA due, comparaison à N−1), posé par le cabinet par changer_droits_acces, faux par défaut (espace client, étape C4a ; MEG3-Q2).';

-- ══ 1 bis. La trace des droits connaît « Comptes » ══════════
-- La fonction du déclencheur de P1-trace au caractère près, plus la case ; son déclencheur nomme la colonne. Les droits
-- d'exécution de la fonction restent ceux que P1-trace a posés (aucun rôle de l'API) : `create or replace` les garde.
create or replace function public.tracer_les_droits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
  v_droits constant text[] := array['ventes', 'banque', 'caisse', 'comptes'];
  v_avant boolean[];
  v_apres boolean[];
  i integer;
begin
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, puis sa trace. Sa mise à jour et son
  -- retrait d'un accès, si.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le retrait d'un accès par la suppression de son dossier : le dossier n'est déjà plus là, sa trace part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    v_avant := array[old.droit_ventes, old.droit_banque, old.droit_caisse, old.droit_comptes];
  end if;
  if tg_op <> 'DELETE' then
    v_apres := array[new.droit_ventes, new.droit_banque, new.droit_caisse, new.droit_comptes];
  end if;
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    -- Le même accès : une ligne par case qui change.
    perform set_config('jd.trace_des_droits', new.id::text, true);
    for i in 1 .. 4 loop
      if v_avant[i] is distinct from v_apres[i] then
        insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
        values (new.dossier_id, new.id, new.user_id, v_droits[i], v_apres[i], 'changement', v_auteur);
      end if;
    end loop;
  else
    -- Un accès qui part (retiré, ou emporté vers un autre dossier ou un autre compte) : ses cases cochées, en « retrait ».
    if tg_op <> 'INSERT' then
      perform set_config('jd.trace_des_droits', old.id::text, true);
      for i in 1 .. 4 loop
        if v_avant[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (old.dossier_id, old.id, old.user_id, v_droits[i], false, 'retrait', v_auteur);
        end if;
      end loop;
    end if;
    -- Un accès qui arrive (inséré, ou emporté depuis un autre dossier ou un autre compte) : ses cases cochées, en « creation ».
    if tg_op <> 'DELETE' then
      perform set_config('jd.trace_des_droits', new.id::text, true);
      for i in 1 .. 4 loop
        if v_apres[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (new.dossier_id, new.id, new.user_id, v_droits[i], true, 'creation', v_auteur);
        end if;
      end loop;
    end if;
  end if;
  perform set_config('jd.trace_des_droits', '', true);
  return null;
end
$$;

create or replace trigger memberships_trace_des_droits
  after insert or update of droit_ventes, droit_banque, droit_caisse, droit_comptes,
    dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_droits();

comment on table public.trace_des_droits is
  'La trace des droits « Ventes », « Banque », « Caisse » et « Comptes » des accès client d''un dossier : qui a coché ou décoché quelle case, et quand (étape P1-trace). Écrite par le déclencheur tracer_les_droits seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';

-- ══ 2. Lire les droits de l'appelant : le mot « comptes » ══════════
-- Le corps de la migration `caisse_du_client`, au caractère près, plus le mot « comptes ». Tout autre mot, ou aucun, rend
-- toujours faux.
create or replace function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            when 'caisse' then m.droit_caisse
            when 'comptes' then m.droit_comptes
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », « caisse », « comptes », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';

-- Le corps de la migration `caisse_du_client`, au caractère près, plus la clé `comptes` : le cabinet du dossier, ou un
-- accès qui porte la case (le patron de `gere_la_caisse`, écrit en place : aucun autre appelant).
create or replace function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id),
    'caisse', public.gere_la_caisse(p_dossier_id),
    'comptes', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'comptes')
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque, caisse, comptes}. N''écrit rien.';

-- ══ 3. Changer les droits d'un accès : la forme à cinq ══════════
-- Le corps de la forme à quatre (la migration `caisse_du_client`), plus « Comptes » : les mêmes refus dans le même ordre —
-- l'appelant qui n'est pas le cabinet du dossier de l'accès, ou un accès qui n'existe pas (42501, les mêmes mots) ; aucun
-- droit donné (22023, ses mots nommant les quatre cases) ; l'accès retiré entre la lecture et l'écriture (P0002). UN DROIT
-- NUL EST UN DROIT INCHANGÉ. Elle n'écrit que les quatre colonnes, et rend l'accès tel que l'écriture l'a laissé ; les
-- gardes parlent après elle (« Ventes » sur un dossier basculé, « Caisse » sur un dossier exclu). Écrite AVANT les formes
-- à trois et à quatre, qui l'appellent : elle reste la définition du nom que les gardes de l'export relisent la première.
create function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean,
  p_comptes boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null and p_caisse is null and p_comptes is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse » ou « Comptes ».' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse),
         droit_comptes = coalesce(p_comptes, m.droit_comptes)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean) is
  'Change les droits « Ventes », « Banque », « Caisse » et « Comptes » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces quatre colonnes ; rend l''accès tel que l''écriture l''a laissé (espace client, étape C4a).';

-- Les formes à quatre et à trois : un appel direct de la forme à cinq, les cases qu'elles ne nomment pas nulles donc
-- inchangées ; leurs refus sont ceux de la forme à cinq.
create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, p_caisse, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean) is
  'La forme à quatre paramètres de changer_droits_acces : « Ventes », « Banque » et « Caisse », « Comptes » inchangé — un appel de la forme à cinq, qui seule écrit memberships (espace client, étape C4a).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'La forme à trois paramètres de changer_droits_acces : « Ventes » et « Banque », « Caisse » et « Comptes » inchangés — un appel de la forme à cinq, qui seule écrit memberships (espace client, étape C4a).';

-- ══ 4. La table ══════════
-- Une ligne par geste. Une publication porte sa date d'arrêté, son statut (lu de l'exercice), son contenu (des centimes) ;
-- un retrait ne porte que la date de ce qu'il retire. Sans clé vers le compte de l'auteur : retirer le compte d'un membre
-- parti ne doit pas effacer qui a publié (le patron de `exercices_valides.valide_par`).
create table public.situations_publiees (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  annee integer not null
    constraint situations_publiees_annee check (annee between 2000 and 2100),
  geste text not null
    constraint situations_publiees_geste check (geste in ('publication', 'retrait')),
  arretee_au date not null,
  statut text
    constraint situations_publiees_statut check (statut in ('provisoire', 'validee')),
  contenu jsonb
    constraint situations_publiees_contenu
      check (jsonb_typeof(contenu) = 'object' and octet_length(contenu::text) <= 65536),
  remplace_id uuid references public.situations_publiees (id),
  auteur uuid not null,
  publiee_le timestamptz not null default now(),
  constraint situations_publiees_arretee_dans_l_annee check (extract(year from arretee_au) = annee),
  constraint situations_publiees_remplace check (remplace_id <> id),
  constraint situations_publiees_une_suite unique (remplace_id),
  constraint situations_publiees_forme check (
    (geste = 'publication' and statut is not null and contenu is not null)
    or (geste = 'retrait' and statut is null and contenu is null and remplace_id is not null))
);

create index situations_publiees_dossier on public.situations_publiees (dossier_id, annee, arretee_au);

comment on table public.situations_publiees is
  'Les situations que le cabinet publie à un accès « Comptes » (espace client, étape C4a ; MEG3-Q2) : une ligne par geste, la publication ou le retrait, FIGÉE — une situation se remplace (remplace_id) ou se retire par ses fonctions, publier_situation et retirer_situation ; la situation en cours est la publication qu''aucune ligne ne cite. Montants en centimes.';
comment on column public.situations_publiees.arretee_au is
  'La date à laquelle la situation est arrêtée : ses chiffres couvrent l''exercice du 1er janvier à cette date ; un retrait porte celle de ce qu''il retire.';
comment on column public.situations_publiees.statut is
  '« validee » si l''exercice était validé à la publication (exercices_valides), « provisoire » sinon — lu par publier_situation, jamais donné par l''appelant ; nul pour un retrait.';
comment on column public.situations_publiees.contenu is
  'Les chiffres publiés, version 1 : {version, statut, periode {debut, fin}, postes [{poste, montant}], recettes, depenses, resultat, tva {assujetti, nette?}, n_moins_1 (les mêmes chiffres sur la même période de N−1, ou null)} ; des centimes entiers, chaque total la somme de ses postes (src/lib/situationsPubliees.ts). Nul pour un retrait.';
comment on column public.situations_publiees.remplace_id is
  'La publication en cours que cette ligne remplace (une publication) ou retire (un retrait) : du même dossier et de la même date ; unique — une chaîne linéaire.';
comment on column public.situations_publiees.auteur is
  'Le compte qui a publié ou retiré (auth.uid()), sans clé étrangère : il survit au retrait du compte.';

-- ══ 5. La garde ══════════
-- Avant la RLS, aux droits de l'appelant : qui ne voit pas une situation est refusé sans apprendre si elle existe. Une
-- ligne ne s'écrit que par sa fonction — `jd.situations_publiees` porte l'identifiant de la ligne qu'elle insère, le temps
-- de la transaction — ou par la restauration (le super-administrateur, qui réinsère l'historique tel qu'il a été). Le
-- retrait d'une ligne n'est admis qu'avec son dossier (la cascade : le dossier n'est déjà plus là).
create function public.garder_situation_publiee() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une situation publiée ne part qu''avec son dossier : elle se retire, et l''historique reste.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une situation publiée ne se modifie pas : elle se remplace ou se retire, et l''historique reste.'
      using errcode = '23514';
  end if;
  if coalesce(current_setting('jd.situations_publiees', true), '') <> new.id::text and not public.is_super_admin() then
    raise exception 'Une situation ne s''écrit que par sa publication ou son retrait.' using errcode = '42501';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.situations_publiees s
        where s.id = new.remplace_id and s.dossier_id = new.dossier_id and s.annee = new.annee
          and s.arretee_au = new.arretee_au and s.geste = 'publication') then
    raise exception 'Une situation en remplace ou en retire une publiée pour le même dossier, à la même date.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_situation_publiee() is
  'La garde de situations_publiees (étape C4a) : une ligne ne s''écrit que par publier_situation ou retirer_situation (jd.situations_publiees) ou par la restauration du super-administrateur (42501), jamais ne se réécrit (23514), ne part qu''avec son dossier (23514) ; une ligne qui en cite une autre cite une publication du même dossier et de la même date (23514).';

create trigger situations_publiees_garde
  before insert or update or delete on public.situations_publiees
  for each row execute function public.garder_situation_publiee();

-- ══ 6. Qui lit, qui écrit ══════════
-- Une situation EN COURS : une publication qu'aucune ligne ne cite. Aux droits du propriétaire (la policy du client la
-- lit sur la table qu'elle garde, sans s'y rappeler) ; elle ne rend qu'un booléen sur un identifiant donné, et ne le rend
-- vrai qu'au cabinet du dossier ou à un accès « Comptes » de ce dossier : à tout autre compte connecté, faux — sans quoi
-- il apprendrait, pour un identifiant connu, si la situation est encore en cours (la relecture de sécurité du 06/11/2026).
-- Faux plutôt qu'un refus : la policy du client l'appelle, et l'ordre de ses termes n'est pas garanti.
create function public.situation_publiee_en_cours(p_situation_id uuid) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (select 1 from public.situations_publiees s where s.id = p_situation_id and s.geste = 'publication'
                   and (public.admin_du_dossier(s.dossier_id) or public.client_du_dossier(s.dossier_id, 'comptes')))
     and not exists (select 1 from public.situations_publiees s where s.remplace_id = p_situation_id)
$$;

comment on function public.situation_publiee_en_cours(uuid) is
  'Vrai si cette ligne de situations_publiees est une publication qu''aucune ligne ne remplace ni ne retire : la situation en cours (étape C4a). Faux pour qui n''est ni du cabinet du dossier ni un accès « Comptes » de ce dossier.';

alter table public.situations_publiees enable row level security;

create policy situations_publiees_lecture on public.situations_publiees
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy situations_publiees_lecture_comptes on public.situations_publiees
  for select to authenticated
  using (client_du_dossier(dossier_id, 'comptes') and geste = 'publication' and situation_publiee_en_cours(id));
create policy situations_publiees_restauration on public.situations_publiees
  for insert to authenticated with check (is_super_admin());

-- ══ 7. Les chiffres d'une situation : leur forme ══════════
-- Le refus, en mots, d'un bloc de chiffres (la situation de N, ou sa comparaison à N−1), ou nul s'il est bien formé : ses
-- six clés, sa période, des centimes entiers, des postes nommés une fois chacun, chaque total la somme de ses postes, la
-- TVA d'un assujetti nette (un crédit négatif), celle d'un non-assujetti sans montant. La composition (le TypeScript)
-- n'est pas réécrite ici : la base VÉRIFIE que ce qui se fige ne se contredit pas.
create function public.refus_des_chiffres_de_la_situation(p_chiffres jsonb, p_debut date, p_fin date) returns text
  language plpgsql
  immutable
  set search_path = public
as $$
declare
  v_poste jsonb;
  v_recettes numeric := 0;
  v_depenses numeric := 0;
  v_noms text[] := '{}';
  v_nom text;
  v_tva jsonb;
begin
  -- Chaque test lit ce qu'un test d'avant a établi : un IF par étape, jamais un OR qui supposerait un ordre d'évaluation.
  if jsonb_typeof(p_chiffres) is distinct from 'object' then
    return 'Les chiffres de la situation ne sont pas dans la forme connue (période, postes, recettes, dépenses, résultat, TVA).';
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_chiffres) k)
       is distinct from array['depenses', 'periode', 'postes', 'recettes', 'resultat', 'tva'] then
    return 'Les chiffres de la situation ne sont pas dans la forme connue (période, postes, recettes, dépenses, résultat, TVA).';
  end if;
  if jsonb_typeof(p_chiffres -> 'periode') is distinct from 'object'
     or (p_chiffres #>> '{periode,debut}') is distinct from p_debut::text
     or (p_chiffres #>> '{periode,fin}') is distinct from p_fin::text then
    return 'La période des chiffres ne va pas du 1er janvier à la date d''arrêté.';
  end if;
  if jsonb_typeof(p_chiffres -> 'postes') is distinct from 'array' then
    return 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.';
  end if;
  for v_poste in select e from jsonb_array_elements(p_chiffres -> 'postes') e loop
    if jsonb_typeof(v_poste) is distinct from 'object' then
      return 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.';
    end if;
    v_nom := v_poste ->> 'poste';
    if (select count(*) from jsonb_object_keys(v_poste)) <> 2
       or jsonb_typeof(v_poste -> 'poste') is distinct from 'string'
       or jsonb_typeof(v_poste -> 'montant') is distinct from 'number' then
      return 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.';
    end if;
    if btrim(v_nom) = '' or length(v_nom) > 200 or v_nom = any (v_noms)
       or (v_poste ->> 'montant')::numeric <> trunc((v_poste ->> 'montant')::numeric)
       or abs((v_poste ->> 'montant')::numeric) >= 100000000000000 then
      return 'Un poste de la situation est mal formé : un nom, une fois, et un montant en centimes entiers.';
    end if;
    v_noms := v_noms || v_nom;
    if (v_poste ->> 'montant')::numeric > 0 then
      v_recettes := v_recettes + (v_poste ->> 'montant')::numeric;
    else
      v_depenses := v_depenses - (v_poste ->> 'montant')::numeric;
    end if;
  end loop;
  if jsonb_typeof(p_chiffres -> 'recettes') is distinct from 'number'
     or jsonb_typeof(p_chiffres -> 'depenses') is distinct from 'number'
     or jsonb_typeof(p_chiffres -> 'resultat') is distinct from 'number' then
    return 'Les totaux de la situation ne sont pas la somme de ses postes.';
  end if;
  if (p_chiffres ->> 'recettes')::numeric <> v_recettes
     or (p_chiffres ->> 'depenses')::numeric <> v_depenses
     or (p_chiffres ->> 'resultat')::numeric <> v_recettes - v_depenses then
    return 'Les totaux de la situation ne sont pas la somme de ses postes.';
  end if;
  v_tva := p_chiffres -> 'tva';
  if jsonb_typeof(v_tva) is distinct from 'object' then
    return 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.';
  end if;
  if jsonb_typeof(v_tva -> 'assujetti') is distinct from 'boolean' then
    return 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.';
  end if;
  if not (v_tva ->> 'assujetti')::boolean then
    if (select count(*) from jsonb_object_keys(v_tva)) <> 1 then
      return 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.';
    end if;
  elsif (select count(*) from jsonb_object_keys(v_tva)) <> 2 or jsonb_typeof(v_tva -> 'nette') is distinct from 'number' then
    return 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.';
  elsif (v_tva ->> 'nette')::numeric <> trunc((v_tva ->> 'nette')::numeric)
     or abs((v_tva ->> 'nette')::numeric) >= 100000000000000 then
    return 'La TVA de la situation est mal formée : celle d''un assujetti, nette en centimes entiers ; aucun montant sinon.';
  end if;
  return null;
end
$$;

comment on function public.refus_des_chiffres_de_la_situation(jsonb, date, date) is
  'Le refus, en mots, d''un bloc de chiffres d''une situation publiée (étape C4a), ou nul s''il est bien formé : ses six clés, sa période, des centimes entiers, chaque total la somme de ses postes, la TVA. N''écrit rien ; aucun rôle de l''API ne l''exécute.';

-- ══ 8. Publier une situation ══════════
-- D'UN SEUL TENANT, sous le verrou partagé de la validation (l'état de l'exercice ne change pas pendant qu'on le lit) puis
-- un verrou des situations du dossier (deux publications à la même date ne se croisent pas). Les refus, dans l'ordre de
-- l'en-tête.
create function public.publier_situation(p_dossier_id uuid, p_arretee_au date, p_contenu jsonb, p_remplace_id uuid)
  returns public.situations_publiees
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_annee integer;
  v_statut text;
  v_refus text;
  v_id uuid := gen_random_uuid();
  v_ligne public.situations_publiees;
begin
  if p_dossier_id is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_arretee_au is null or extract(year from p_arretee_au) not between 2000 and 2100 then
    raise exception 'Une situation porte la date à laquelle elle est arrêtée.' using errcode = '22023';
  end if;
  if p_arretee_au > (now() at time zone 'Europe/Paris')::date then
    raise exception 'Une situation ne s''arrête pas à une date à venir.' using errcode = '22023';
  end if;
  v_annee := extract(year from p_arretee_au)::integer;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('situations_publiees:' || p_dossier_id::text, 0));

  if jsonb_typeof(p_contenu) is distinct from 'object' then
    raise exception 'La situation n''est pas dans la forme que la base connaît (version 1).' using errcode = '22023';
  end if;
  if (select array_agg(k order by k collate "C") from jsonb_object_keys(p_contenu) k)
       is distinct from array['depenses', 'n_moins_1', 'periode', 'postes', 'recettes', 'resultat', 'statut', 'tva', 'version']
     or (p_contenu -> 'version') is distinct from '1'::jsonb then
    raise exception 'La situation n''est pas dans la forme que la base connaît (version 1).' using errcode = '22023';
  end if;
  v_statut := case when exists (select 1 from public.exercices_valides e where e.dossier_id = p_dossier_id and e.annee = v_annee)
                   then 'validee' else 'provisoire' end;
  if (p_contenu ->> 'statut') is distinct from v_statut then
    raise exception 'L''exercice % est %, et la situation le disait autrement : elle se recalcule avant d''être publiée.',
      v_annee, case v_statut when 'validee' then 'validé' else 'ouvert' end using errcode = '22023';
  end if;
  v_refus := public.refus_des_chiffres_de_la_situation(p_contenu - 'version' - 'statut' - 'n_moins_1',
    make_date(v_annee, 1, 1), p_arretee_au);
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;
  if (p_contenu -> 'n_moins_1') <> 'null'::jsonb then
    v_refus := public.refus_des_chiffres_de_la_situation(p_contenu -> 'n_moins_1',
      make_date(v_annee - 1, 1, 1), (p_arretee_au - interval '1 year')::date);
    if v_refus is not null then
      raise exception 'La comparaison à l''exercice précédent : %', v_refus using errcode = '22023';
    end if;
  end if;

  if p_remplace_id is not null then
    if not exists (select 1 from public.situations_publiees s
                    where s.id = p_remplace_id and s.dossier_id = p_dossier_id and s.arretee_au = p_arretee_au
                      and s.geste = 'publication')
       or exists (select 1 from public.situations_publiees s where s.remplace_id = p_remplace_id) then
      raise exception 'La situation remplacée n''est pas celle publiée en cours pour ce dossier, à cette date.' using errcode = '22023';
    end if;
  elsif exists (select 1 from public.situations_publiees s
                 where s.dossier_id = p_dossier_id and s.arretee_au = p_arretee_au and s.geste = 'publication'
                   and not exists (select 1 from public.situations_publiees r where r.remplace_id = s.id)) then
    raise exception 'Une situation est déjà publiée à cette date : remplace-la.' using errcode = '22023';
  end if;

  perform set_config('jd.situations_publiees', v_id::text, true);
  insert into public.situations_publiees (id, dossier_id, annee, geste, arretee_au, statut, contenu, remplace_id, auteur)
  values (v_id, p_dossier_id, v_annee, 'publication', p_arretee_au, v_statut, p_contenu, p_remplace_id, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.situations_publiees', '', true);
  return v_ligne;
end;
$$;

comment on function public.publier_situation(uuid, date, jsonb, uuid) is
  'Publie une situation au client « Comptes » (étape C4a) : ses chiffres en centimes (version 1), arrêtée à une date passée ou du jour, son statut lu de l''exercice ; une nouvelle date, ou le remplacement de la publication en cours à cette date (p_remplace_id). Réservée au cabinet du dossier (42501) ; rend la ligne écrite.';

-- ══ 9. Retirer une situation ══════════
-- Le retrait est une ligne : il cite la publication en cours qu'il retire ; rien ne se supprime.
create function public.retirer_situation(p_situation_id uuid) returns public.situations_publiees
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_situation public.situations_publiees;
  v_id uuid := gen_random_uuid();
  v_ligne public.situations_publiees;
begin
  select s.* into v_situation from public.situations_publiees s where s.id = p_situation_id;
  if v_situation.id is null or not public.admin_du_dossier(v_situation.dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('situations_publiees:' || v_situation.dossier_id::text, 0));
  if v_situation.geste <> 'publication'
     or exists (select 1 from public.situations_publiees s where s.remplace_id = p_situation_id) then
    raise exception 'Cette situation n''est plus publiée : elle a été remplacée ou retirée.' using errcode = '22023';
  end if;
  perform set_config('jd.situations_publiees', v_id::text, true);
  insert into public.situations_publiees (id, dossier_id, annee, geste, arretee_au, remplace_id, auteur)
  values (v_id, v_situation.dossier_id, v_situation.annee, 'retrait', v_situation.arretee_au, p_situation_id, auth.uid())
  returning * into v_ligne;
  perform set_config('jd.situations_publiees', '', true);
  return v_ligne;
end;
$$;

comment on function public.retirer_situation(uuid) is
  'Retire la situation publiée en cours (étape C4a) : une ligne « retrait » qui la cite ; le client ne la lit plus, l''historique reste. Réservée au cabinet du dossier (42501, aussi pour une situation inconnue) ; rend le retrait.';

-- ══ 10. Les droits d'exécution ══════════
revoke execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean) to authenticated;
revoke execute on function public.publier_situation(uuid, date, jsonb, uuid) from public, anon;
grant execute on function public.publier_situation(uuid, date, jsonb, uuid) to authenticated;
revoke execute on function public.retirer_situation(uuid) from public, anon;
grant execute on function public.retirer_situation(uuid) to authenticated;
revoke execute on function public.situation_publiee_en_cours(uuid) from public, anon;
grant execute on function public.situation_publiee_en_cours(uuid) to authenticated;
revoke execute on function public.refus_des_chiffres_de_la_situation(jsonb, date, date) from public, anon, authenticated;
revoke execute on function public.garder_situation_publiee() from public, anon, authenticated;
