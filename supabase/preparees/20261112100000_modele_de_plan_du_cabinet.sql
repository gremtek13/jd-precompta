-- PC5 — LE MODÈLE DE PLAN DU CABINET, EN BASE (ligne 43 de la feuille de route ; PRÉPARÉE, PAS APPLIQUÉE). La conception :
-- HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION » (§ 3.1, § 3.2 « Le modèle s'hérite ou se copie ? »,
-- § 3.4 `plan_comptable_cabinet` et `appliquer_modele_du_cabinet`, § 3.10, § 4.2, la ligne PC5 du découpage ; 43-Q1 et
-- 43-Q3, « oui » le 17/10/2026) ; le récit : « 12/11/2026 — PC5 : LE MODÈLE DE PLAN DU CABINET (PRÉPARÉ, PAS APPLIQUÉ) » ;
-- l'essai : supabase/essais/modeleDuCabinet.sql (et modeleDuCabinetSuppression.sql, sur une réplique seulement) ; le
-- retour : supabase/preparees/retour/20261112100100_retour_modele_de_plan_du_cabinet.sql.
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1011-5 (« L'entité
-- établit un plan de comptes ») et 1131-1 (subdivision « en tant que de besoin », sous le numéro du compte qu'elle divise) :
-- le plan est celui de l'ENTITÉ, le dossier ; le modèle n'est qu'une habitude du cabinet, qu'il COPIE dans un dossier neuf
-- (43-Q1 : « le modèle ne fait que semer »). PostgreSQL 17 : « INSERT … ON CONFLICT DO UPDATE » (la ligne en conflit se
-- verrouille et se met à jour, sa clause WHERE la laisse telle qu'elle est), « Advisory Lock Functions », « CREATE TRIGGER »
-- (les déclencheurs BEFORE d'une même table s'exécutent dans l'ordre de leurs noms), « set_config » (un réglage posé avec
-- is_local vaut jusqu'à la fin de la transaction, à travers les fonctions appelées).
--
-- CE QU'ELLE FAIT. Rien ne change pour un cabinet qui ne règle aucun modèle, ni pour aucun dossier existant.
--   1. `plan_comptable_cabinet` — le modèle : une ligne par cabinet et par rôle du catalogue, les colonnes et les contrôles
--      de `plan_comptable_dossier` (le compte, le libellé, le préfixe des seuls tiers, l'auteur et l'instant) ; sans
--      `origine` : le modèle n'a qu'un auteur possible, le chef du cabinet. Lu par toute l'équipe du cabinet
--      (`admin_du_cabinet`, § 3.10), écrit par sa fonction seule (aucune policy d'écriture, une garde), jamais par le client.
--   2. `regler_modele_du_cabinet(p_cabinet_id, p_comptes)` — le chef du cabinet (43-Q3) règle le modèle ENTIER, avec les
--      refus de `regler_plan_du_dossier` qui ont un sens hors d'un dossier, dans le même ordre et sous les mêmes mots ;
--      aucun verrou de dossier : le modèle ne touche aucun dossier. Il se sérialise sur un verrou du cabinet.
--   3. `modele_du_cabinet(p_cabinet_id)` — le modèle effectif, rôle par rôle, comme `plan_du_dossier` le rend d'un dossier :
--      l'origine dit « modele_du_cabinet » pour un rôle que le modèle règle, « application » pour les autres.
--   4. `appliquer_modele_du_cabinet(p_dossier_id)` — COPIE le modèle du cabinet du dossier dans son plan, en APPELANT
--      `regler_plan_du_dossier` (PC4, en production depuis le 10/11/2026) : le même accès, le même verrou EXCLUSIF de la
--      validation du dossier, le même refus d'un dossier qui porte déjà quelque chose sur ses comptes, tous ses refus et le
--      dirigeant qui suit son rôle — sa logique n'est pas recopiée. Rend le nombre de rôles copiés.
--   5. Un déclencheur BEFORE INSERT sur `plan_comptable_dossier`, après sa garde (`plan_comptable_dossier_gardes` <
--      `plan_comptable_dossier_origine`) : une ligne posée par l'application du modèle porte l'origine
--      « modele_du_cabinet », que la contrainte `plan_comptable_dossier_origine` admet depuis PC1. Rien d'autre ne change
--      à ce que la garde du plan ou `regler_plan_du_dossier` jugent ; leur texte n'est pas touché.
--
-- LE MODÈLE SE STOCKE ENTIER (le choix, et pourquoi). `regler_modele_du_cabinet` écrit une ligne pour CHAQUE rôle du
-- catalogue : le compte réglé, sinon celui du catalogue avec un libellé et un préfixe nuls. Un rôle qui revient au catalogue
-- garde donc sa ligne, aux valeurs du catalogue — rien ne se retire, une ligne se met à jour. Écarté : retirer les lignes
-- du modèle puis insérer les nouvelles, comme `regler_plan_du_dossier` le fait du plan d'un dossier — même effet, mais un
-- retrait de lignes dans un corps, que l'outil d'application retient (PC4 et PC6 ont dû se coller). Un rôle est « réglé »
-- par le modèle quand sa ligne n'est pas celle du catalogue (un compte autre, ou un libellé, ou un préfixe posés) :
-- `modele_du_cabinet` et `appliquer_modele_du_cabinet` le lisent ainsi, et seuls ces rôles se copient dans un dossier.
--
-- PAR L'OUTIL. Aucune instruction ne retire une table, une colonne, une contrainte, une fonction ni une ligne ; le mot du
-- retrait n'y paraît que dans `on delete cascade`, l'évènement d'un déclencheur et `tg_op = 'DELETE'`, les formes que
-- `trace_des_droits` et `adresse_des_acces_retires` ont passées sans confirmation. Elle se pose par `apply_migration`,
-- sous le nom `modele_de_plan_du_cabinet`, le texte de ce fichier tel quel (aucune barre oblique inverse : rien que l'outil
-- décode). Si l'outil la retenait quand même, elle se collerait, sans rien changer à la suite.
--
-- L'ORDRE. Aucun prérequis parmi les préparées. Les écrans attendent `MODELE_DU_CABINET_PREVU` (src/lib/modeleDuCabinet.ts),
-- baissé : appliquer la migration, rejouer ses essais et les trois contrôles de l'export, PUIS lever le drapeau — ce qui
-- s'ajoute, puis la bascule de l'application. La double authentification exigée (`deux_facteurs_exiges`, préparée) pose sa
-- policy restrictive sur chaque table : appliquée avant celle-ci, la table neuve la reçoit ici (§ 7).

-- ══ 0. La garde de tête : l'état que cette migration suppose, ou rien ══════════════════════════════════════════════════
do $garde$
declare
  v_corps text;
begin
  if to_regclass('public.plan_comptable_cabinet') is not null
     or to_regprocedure('public.regler_modele_du_cabinet(uuid, jsonb)') is not null then
    raise exception 'La migration modele_de_plan_du_cabinet est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Les fonctions que celle-ci appelle, à l'empreinte de leur corps (les retours chariot écartés : une migration collée les
  -- y laisse) : `regler_plan_du_dossier` telle que PC4 l'a posée (sa porte, son insertion d'origine « dossier », son
  -- verrou), et les prédicats d'accès.
  for v_corps in select x.f from (values
      ('regler_plan_du_dossier(uuid, jsonb)', '3e65218a0f3c27736a8fad5d8c8680c8'),
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('admin_du_cabinet(uuid)', '9e3218c1a32719441078f0c354493507'),
      ('est_chef_du_cabinet(uuid)', 'df3eeeaf2095b1c86c3bca7624243a0b'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_corps;
  end loop;
  -- L'origine « modele_du_cabinet », admise par la contrainte du plan d'un dossier depuis PC1.
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.plan_comptable_dossier'::regclass and c.conname = 'plan_comptable_dossier_origine')
     is distinct from 'CHECK ((origine = ANY (ARRAY[''dossier''::text, ''modele_du_cabinet''::text, ''balance_reprise''::text])))' then
    raise exception 'La contrainte plan_comptable_dossier_origine n''est plus celle que cette migration suppose : la relire avant de l''appliquer.';
  end if;
  -- Aucun objet aux noms de ceux qu'elle crée.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('garder_plan_comptable_cabinet', 'modele_du_cabinet', 'appliquer_modele_du_cabinet',
                                'origine_du_modele_applique'))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('plan_comptable_cabinet_gardes', 'plan_comptable_dossier_origine')) then
    raise exception 'Un objet que cette migration crée existe déjà : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Le modèle ═══════════════════════════════════════════════════════════════════════════════════════════════════════
-- Les colonnes et les contraintes de `plan_comptable_dossier` (PC1), au cabinet : la clé (cabinet, rôle), le rôle connu du
-- catalogue, la forme large du compte (la garde exige les six chiffres de Q5), le libellé d'une ligne d'un à deux cents
-- caractères. Le cabinet supprimé emporte son modèle.
create table public.plan_comptable_cabinet (
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  role text not null references public.roles_comptables(role),
  compte text not null,
  libelle text,
  prefixe_auxiliaire text,
  regle_par uuid,
  regle_le timestamptz not null default now(),
  constraint plan_comptable_cabinet_pkey primary key (cabinet_id, role),
  constraint plan_comptable_cabinet_compte check (compte ~ '^[1-7][0-9]{2,}$'),
  constraint plan_comptable_cabinet_libelle check (btrim(libelle, ' ' || chr(9) || chr(10) || chr(13)) <> '' and length(libelle) <= 200)
);

comment on table public.plan_comptable_cabinet is
  'Le modèle de plan du cabinet (ligne 43, PC5) : une ligne par rôle du catalogue, réglée par le chef du cabinet (regler_modele_du_cabinet), copiée dans un dossier neuf (appliquer_modele_du_cabinet). Elle ne s''hérite jamais : un dossier ne lit que son propre plan.';

-- ══ 2. La garde du modèle ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Qui l'écrit : `regler_modele_du_cabinet`, sous sa porte — le réglage local `jd.regler_modele_du_cabinet`, qu'elle pose au
-- cabinet qu'elle règle puis remet à vide, et qu'aucune requête de l'API ne pose. Personne d'autre, pas même le
-- super-administrateur ni une fonction aux droits du propriétaire. Une ligne ne change ni de cabinet ni de rôle, et ne se
-- retire qu'avec son cabinet. Ce qu'une ligne EST, comme une ligne du plan d'un dossier : six chiffres (Q5), sous une racine
-- de son rôle, un préfixe sur les seuls tiers, de sa forme.
create function public.garder_plan_comptable_cabinet() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_racines text[];
  v_prefixe_defaut text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.cabinets c where c.id = old.cabinet_id) then
      return old;
    end if;
    raise exception 'Une ligne du modèle de plan d''un cabinet ne se retire pas : un rôle revient au catalogue par regler_modele_du_cabinet, et le modèle part avec son cabinet.'
      using errcode = '42501';
  end if;
  if coalesce(current_setting('jd.regler_modele_du_cabinet', true), '') <> new.cabinet_id::text then
    raise exception 'Le modèle de plan d''un cabinet ne s''écrit pas directement : il se règle par regler_modele_du_cabinet, par le chef du cabinet.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.cabinet_id, new.role) is distinct from (old.cabinet_id, old.role) then
    raise exception 'Une ligne du modèle de plan d''un cabinet ne change ni de cabinet ni de rôle.' using errcode = '42501';
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
  if not exists (select 1 from unnest(v_racines) as x(racine) where left(new.compte, length(x.racine)) = x.racine) then
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

create trigger plan_comptable_cabinet_gardes
  before insert or update or delete on public.plan_comptable_cabinet
  for each row execute function public.garder_plan_comptable_cabinet();

-- ══ 3. Les droits : la lecture par l'équipe du cabinet, aucune écriture directe ═══════════════════════════════════════
-- `admin_du_cabinet` : le super-administrateur, ou un membre de l'équipe du cabinet (`mon_cabinet_id`), chef ou non ; un
-- client n'est membre d'aucune équipe. Aucune policy d'écriture : la RLS refuse toute écriture d'une session, la garde
-- celle d'une fonction aux droits du propriétaire ou de la clé secrète.
alter table public.plan_comptable_cabinet enable row level security;

create policy plan_comptable_cabinet_lecture on public.plan_comptable_cabinet
  for select to authenticated using (public.admin_du_cabinet(cabinet_id));

-- ══ 4. Régler le modèle ═════════════════════════════════════════════════════════════════════════════════════════════════
-- `p_comptes` : le modèle que le cabinet règle, ENTIER — une liste d'objets {role, compte, libelle?, prefixe_auxiliaire?}
-- (libellé et préfixe nuls : ceux du catalogue) ; un rôle absent revient au compte du catalogue, une liste vide rend le
-- modèle au catalogue. Ses refus, dans l'ordre de ceux de `regler_plan_du_dossier` et sous leurs mots (le module de l'écran,
-- src/lib/modeleDuCabinet.ts, les redit avant le clic), sauf ce qui n'a de sens que dans un dossier — un dossier déjà écrit
-- (2), le dirigeant (13), le compte de contrepartie d'un encaissement (14) — : `appliquer_modele_du_cabinet` les
-- rencontre, dossier par dossier, par `regler_plan_du_dossier` elle-même.
--    1. l'accès : le chef du cabinet (43-Q3), d'un cabinet qui existe (42501) ;
--    3. la forme de la demande ; 4. un rôle inconnu ; 5. un rôle deux fois ; 6. un compte qui n'est pas de six chiffres ;
--    7. un compte hors des racines de son rôle ; 8. deux rôles du modèle effectif sur le même compte à des zéros près ;
--    9. un rôle du bilan changé vers le compte d'une catégorie COMMUNE à tous les dossiers (celles d'un dossier, ce dossier
--       les oppose à l'application) ; 10. les indemnités kilométriques changées vers le compte d'une catégorie commune ;
--    11. le libellé ; 12. le préfixe — hors des tiers, sa forme, partagé par deux rôles de tiers du modèle effectif (22023).
-- Les vérifications 3 à 12 vont refus par refus ; dans chacune, la première ligne de la liste fautive l'emporte.
create function public.regler_modele_du_cabinet(p_cabinet_id uuid, p_comptes jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rang bigint;
  v_role text;
  v_autre text;
  v_compte text;
  v_valeur text;
begin
  -- 1. L'accès : le chef du cabinet, d'un cabinet qui existe (le super-administrateur, qu'`est_chef_du_cabinet` admet
  --    d'emblée, ne règle pas le modèle d'un cabinet qui n'existe pas). Ni un membre de l'équipe qui n'est pas son chef, ni
  --    le chef d'un autre cabinet, ni un client.
  if p_cabinet_id is null or not exists (select 1 from public.cabinets c where c.id = p_cabinet_id)
     or not public.est_chef_du_cabinet(p_cabinet_id) then
    raise exception 'Le modèle de plan de ce cabinet ne se règle que par son chef.' using errcode = '42501';
  end if;
  -- Deux réglages du même modèle ne se croisent pas : le second attend le premier, puis l'emporte ENTIER.
  perform pg_advisory_xact_lock(hashtextextended('jd.modele_du_cabinet:' || p_cabinet_id::text, 0));
  -- 3. La forme de la demande.
  if p_comptes is null or jsonb_typeof(p_comptes) <> 'array' then
    raise exception 'Le modèle se règle par la liste des rôles que le cabinet règle : [{"role": …, "compte": …, "libelle": …, "prefixe_auxiliaire": …}].'
      using errcode = '22023';
  end if;
  select x.n into v_rang from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where case when jsonb_typeof(x.e) <> 'object' then true
              else exists (select 1 from jsonb_object_keys(x.e) as k(cle) where k.cle not in ('role', 'compte', 'libelle', 'prefixe_auxiliaire'))
                   or jsonb_typeof(x.e -> 'role') is distinct from 'string'
                   or jsonb_typeof(x.e -> 'compte') is distinct from 'string'
                   or coalesce(jsonb_typeof(x.e -> 'libelle'), 'null') not in ('string', 'null')
                   or coalesce(jsonb_typeof(x.e -> 'prefixe_auxiliaire'), 'null') not in ('string', 'null') end
   order by x.n limit 1;
  if found then
    raise exception 'Le rôle n° % du modèle ne se lit pas : un objet qui porte « role » et « compte » en texte, et au plus « libelle » et « prefixe_auxiliaire », en texte ou nuls.', v_rang
      using errcode = '22023';
  end if;
  -- 4. Un rôle que le catalogue ne connaît pas.
  select x.e ->> 'role' into v_role from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where not exists (select 1 from public.roles_comptables r where r.role = x.e ->> 'role')
   order by x.n limit 1;
  if found then
    raise exception 'Rôle comptable inconnu : « % ».', v_role using errcode = '22023';
  end if;
  -- 5. Un rôle deux fois.
  select x.e ->> 'role' into v_role from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where exists (select 1 from jsonb_array_elements(p_comptes) with ordinality as y(e, n)
                  where y.e ->> 'role' = x.e ->> 'role' and y.n < x.n)
   order by x.n limit 1;
  if found then
    raise exception 'Le rôle « % » paraît deux fois dans le modèle : un rôle, un compte.', v_role using errcode = '22023';
  end if;
  -- 6. Six chiffres (Q5), la forme que la garde exige aussi.
  select x.e ->> 'role', x.e ->> 'compte' into v_role, v_compte from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where (x.e ->> 'compte') !~ '^[0-9]{6}$'
   order by x.n limit 1;
  if found then
    raise exception 'Le compte du rôle « % » s''écrit en six chiffres : « % » n''en est pas un.', v_role, v_compte using errcode = '22023';
  end if;
  -- 7. La racine du rôle, en tête (art. 1131-1).
  select x.e ->> 'role', x.e ->> 'compte', array_to_string(r.racines, ' ou ') into v_role, v_compte, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
   where not exists (select 1 from unnest(r.racines) as u(racine) where left(x.e ->> 'compte', length(u.racine)) = u.racine)
   order by x.n limit 1;
  if found then
    raise exception 'Le compte du rôle « % » commence par sa racine du plan comptable (%) : « % » n''en est pas un.', v_role, v_valeur, v_compte
      using errcode = '22023';
  end if;
  -- 8. Deux rôles du modèle EFFECTIF (la demande, et le catalogue pour les autres) sur le même compte, à des zéros près
  --    (art. 1131-2).
  with effectif as (
    select r.role, r.ordre, coalesce(x.e ->> 'compte', r.compte_defaut) as compte
      from public.roles_comptables r left join jsonb_array_elements(p_comptes) as x(e) on x.e ->> 'role' = r.role)
  select a.role, b.role, a.compte into v_role, v_autre, v_compte
    from effectif a join effectif b on b.ordre > a.ordre and rtrim(b.compte, '0') = rtrim(a.compte, '0')
   order by a.ordre, b.ordre limit 1;
  if found then
    raise exception 'Les rôles « % » et « % » se tiendraient sur le même compte (« % »), à des zéros près : un compte ne tient qu''un rôle.',
      v_role, v_autre, v_compte using errcode = '22023';
  end if;
  -- 9. Un rôle du bilan changé vers le compte d'une catégorie commune à tous les dossiers, à des zéros près : dans tout
  --    dossier où le modèle s'appliquerait, les lignes de la catégorie s'y confondraient. Le compte du catalogue, inchangé,
  --    ne se refuse pas.
  select x.e ->> 'role', x.e ->> 'compte', c.compte_comptable into v_role, v_compte, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
    join public.categories c on c.dossier_id is null and rtrim(c.compte_comptable, '0') = rtrim(x.e ->> 'compte', '0')
   where left(r.compte_defaut, 1) between '1' and '5' and x.e ->> 'compte' <> r.compte_defaut
   order by x.n, c.compte_comptable collate "C" limit 1;
  if found then
    raise exception 'Le compte « % » du rôle « % » est celui d''une catégorie commune à tous les dossiers (« % »), à des zéros près : un compte de bilan que l''application écrit ne se partage pas avec une catégorie.',
      v_compte, v_role, v_valeur using errcode = '22023';
  end if;
  -- 10. Les indemnités kilométriques changées vers le compte d'une catégorie commune : le barème et les frais réels (la
  --     catégorie « Carburant / déplacements ») doivent rester séparables.
  select x.e ->> 'compte', c.compte_comptable into v_compte, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
    join public.categories c on c.dossier_id is null and rtrim(c.compte_comptable, '0') = rtrim(x.e ->> 'compte', '0')
   where r.role = 'indemnites_kilometriques' and x.e ->> 'compte' <> r.compte_defaut
   order by x.n, c.compte_comptable collate "C" limit 1;
  if found then
    raise exception 'Le compte des indemnités kilométriques (« % ») est celui d''une catégorie commune à tous les dossiers (« % »), à des zéros près : le barème et les frais réels restent séparés.',
      v_compte, v_valeur using errcode = '22023';
  end if;
  -- 11. Le libellé (CompteLib) : nul, celui du catalogue ; sinon une ligne, d'un à deux cents caractères.
  select x.e ->> 'role' into v_role from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where x.e ->> 'libelle' is not null
     and (btrim(x.e ->> 'libelle', ' ' || chr(9) || chr(10) || chr(13)) = '' or length(x.e ->> 'libelle') > 200 or (x.e ->> 'libelle') ~ '[[:cntrl:]]')
   order by x.n limit 1;
  if found then
    raise exception 'Le libellé du rôle « % » tient sur une ligne, d''un à deux cents caractères ; nul, c''est celui du catalogue.', v_role
      using errcode = '22023';
  end if;
  -- 12. Le préfixe des comptes auxiliaires : sur les trois tiers seulement, de sa forme, et jamais partagé par deux tiers
  --     du modèle effectif.
  select x.e ->> 'role' into v_role
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
   where x.e ->> 'prefixe_auxiliaire' is not null and r.prefixe_auxiliaire_defaut is null
   order by x.n limit 1;
  if found then
    raise exception 'Seuls les comptes de tiers (fournisseurs, fournisseurs d''immobilisations, clients) portent un préfixe de comptes auxiliaires : pas le rôle « % ».', v_role
      using errcode = '22023';
  end if;
  select x.e ->> 'role', x.e ->> 'prefixe_auxiliaire' into v_role, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where (x.e ->> 'prefixe_auxiliaire') !~ '^[A-Z0-9]{1,5}$'
   order by x.n limit 1;
  if found then
    raise exception 'Le préfixe des comptes auxiliaires du rôle « % » s''écrit d''une à cinq lettres majuscules ou chiffres : « % » n''en est pas un.', v_role, v_valeur
      using errcode = '22023';
  end if;
  with effectif as (
    select r.role, r.ordre, coalesce(x.e ->> 'prefixe_auxiliaire', r.prefixe_auxiliaire_defaut) as prefixe
      from public.roles_comptables r left join jsonb_array_elements(p_comptes) as x(e) on x.e ->> 'role' = r.role
     where r.prefixe_auxiliaire_defaut is not null)
  select a.role, b.role, a.prefixe into v_role, v_autre, v_valeur
    from effectif a join effectif b on b.ordre > a.ordre and b.prefixe = a.prefixe
   order by a.ordre, b.ordre limit 1;
  if found then
    raise exception 'Les rôles « % » et « % » partageraient le préfixe de comptes auxiliaires « % » : deux natures de tiers ne partagent pas un compte auxiliaire.',
      v_role, v_autre, v_valeur using errcode = '22023';
  end if;

  -- L'écriture : une ligne pour CHAQUE rôle du catalogue, la demande sinon le catalogue, sous la porte de la garde, posée
  -- pour ce cabinet puis remise à vide. Une ligne inchangée garde son auteur et son instant.
  perform set_config('jd.regler_modele_du_cabinet', p_cabinet_id::text, true);
  insert into public.plan_comptable_cabinet as m (cabinet_id, role, compte, libelle, prefixe_auxiliaire, regle_par, regle_le)
  select p_cabinet_id, r.role, coalesce(x.e ->> 'compte', r.compte_defaut), x.e ->> 'libelle', x.e ->> 'prefixe_auxiliaire',
         auth.uid(), now()
    from public.roles_comptables r
    left join jsonb_array_elements(p_comptes) as x(e) on x.e ->> 'role' = r.role
   order by r.ordre
  on conflict (cabinet_id, role) do update
     set compte = excluded.compte, libelle = excluded.libelle, prefixe_auxiliaire = excluded.prefixe_auxiliaire,
         regle_par = excluded.regle_par, regle_le = excluded.regle_le
   where (m.compte, m.libelle, m.prefixe_auxiliaire) is distinct from (excluded.compte, excluded.libelle, excluded.prefixe_auxiliaire);
  perform set_config('jd.regler_modele_du_cabinet', '', true);
end
$$;

-- ══ 5. Lire le modèle ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Le modèle effectif, rôle par rôle, dans l'ordre du catalogue, sous la forme de `plan_du_dossier` (l'application le lit par
-- le même examen) : la ligne du modèle, sinon le catalogue ; l'origine « modele_du_cabinet » pour un rôle que le modèle
-- règle (sa ligne n'est pas celle du catalogue), « application » pour les autres. Aux droits de l'appelant : la RLS de la
-- table s'ajoute au contrôle. `admin_du_cabinet` rend NUL, non faux, pour un compte rattaché à aucun cabinet
-- (`p_cabinet_id = mon_cabinet_id()`, nul) : un « if not … » le laisserait passer, d'où le `coalesce` (l'essai l'a vu ;
-- une policy, où nul vaut faux, n'en souffre pas).
create function public.modele_du_cabinet(p_cabinet_id uuid)
returns table (role text, compte text, libelle text, prefixe_auxiliaire text, origine text)
language plpgsql
stable
set search_path = public
as $$
begin
  if p_cabinet_id is null or not coalesce(public.admin_du_cabinet(p_cabinet_id), false) then
    raise exception 'Accès refusé à ce cabinet.' using errcode = '42501';
  end if;
  return query
    select r.role, coalesce(m.compte, r.compte_defaut), coalesce(m.libelle, r.libelle_defaut),
           coalesce(m.prefixe_auxiliaire, r.prefixe_auxiliaire_defaut),
           case when m.role is not null
                 and not (m.compte = r.compte_defaut and m.libelle is null and m.prefixe_auxiliaire is null)
                then 'modele_du_cabinet' else 'application' end
      from public.roles_comptables r
      left join public.plan_comptable_cabinet m on m.cabinet_id = p_cabinet_id and m.role = r.role
     order by r.ordre;
end
$$;

-- ══ 6. Appliquer le modèle à un dossier ═════════════════════════════════════════════════════════════════════════════════
-- Les rôles que le modèle du cabinet du dossier règle, copiés dans le plan du dossier par `regler_plan_du_dossier` — le plan
-- ENTIER : un rôle que le modèle ne règle pas revient au catalogue dans le dossier aussi. Ses refus sont ceux de
-- `regler_plan_du_dossier`, dans son ordre et sous ses mots : l'accès (`admin_du_dossier` : 43-Q3, comme le modèle
-- comptable), un dossier qui porte déjà quelque chose sur ses comptes, sous le verrou EXCLUSIF de sa validation, puis ceux
-- du plan au dossier (une catégorie du dossier, le dirigeant, un compte de contrepartie). L'accès se juge ICI d'abord,
-- avant toute lecture du modèle. Le réglage `jd.appliquer_modele_du_cabinet`, posé au dossier le temps de l'appel, fait
-- porter aux lignes copiées l'origine « modele_du_cabinet » (§ 7). Rend le nombre de rôles copiés.
create function public.appliquer_modele_du_cabinet(p_dossier_id uuid) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comptes jsonb;
  v_nombre integer;
begin
  if p_dossier_id is null or not exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'compte', m.compte, 'libelle', m.libelle,
                                               'prefixe_auxiliaire', m.prefixe_auxiliaire) order by r.ordre), '[]'::jsonb),
         count(*)
    into v_comptes, v_nombre
    from public.dossiers d
    join public.plan_comptable_cabinet m on m.cabinet_id = d.cabinet_id
    join public.roles_comptables r on r.role = m.role
   where d.id = p_dossier_id
     and not (m.compte = r.compte_defaut and m.libelle is null and m.prefixe_auxiliaire is null);
  perform set_config('jd.appliquer_modele_du_cabinet', p_dossier_id::text, true);
  perform public.regler_plan_du_dossier(p_dossier_id, v_comptes);
  perform set_config('jd.appliquer_modele_du_cabinet', '', true);
  return v_nombre;
end
$$;

-- ══ 7. L'origine d'une ligne copiée depuis le modèle ═══════════════════════════════════════════════════════════════════
-- Après la garde du plan (l'ordre des noms) : une ligne insérée pendant que `appliquer_modele_du_cabinet` applique le modèle
-- à CE dossier porte l'origine « modele_du_cabinet » ; toute autre garde la sienne (« dossier » de `regler_plan_du_dossier`,
-- celle que la restauration réinsère). Ne lit aucune table.
create function public.origine_du_modele_applique() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('jd.appliquer_modele_du_cabinet', true), '') = new.dossier_id::text then
    new.origine := 'modele_du_cabinet';
  end if;
  return new;
end
$$;

create trigger plan_comptable_dossier_origine
  before insert on public.plan_comptable_dossier
  for each row execute function public.origine_du_modele_applique();

-- ══ 8. Les droits d'exécution ═══════════════════════════════════════════════════════════════════════════════════════════
-- Les trois fonctions de l'application, aux connectés seuls ; les deux fonctions de déclencheur, à aucun rôle de session.
revoke execute on function public.regler_modele_du_cabinet(uuid, jsonb) from public, anon;
grant execute on function public.regler_modele_du_cabinet(uuid, jsonb) to authenticated;
revoke execute on function public.modele_du_cabinet(uuid) from public, anon;
grant execute on function public.modele_du_cabinet(uuid) to authenticated;
revoke execute on function public.appliquer_modele_du_cabinet(uuid) from public, anon;
grant execute on function public.appliquer_modele_du_cabinet(uuid) to authenticated;
revoke execute on function public.garder_plan_comptable_cabinet() from public, anon, authenticated;
revoke execute on function public.origine_du_modele_applique() from public, anon, authenticated;

-- ══ 9. La double authentification exigée ════════════════════════════════════════════════════════════════════════════════
-- La migration `deux_facteurs_exiges` (préparée) pose sa policy restrictive sur chaque table de public : appliquée avant
-- celle-ci, la table neuve la reçoit ici, à l'identique.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.plan_comptable_cabinet as restrictive for all to authenticated '
            'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
