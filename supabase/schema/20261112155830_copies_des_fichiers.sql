-- INAL6 : LA COPIE DES FICHIERS DES DOSSIERS SUR UN SUPPORT DU CABINET (lignes 20.65 et 44) — PRÉPARÉE, PAS APPLIQUÉE.
-- Rien ne se détruit : une table et deux fonctions s'ajoutent, aucune ligne ni aucun objet ne se retire.
--
-- La décision : INAL-Q3, tranchée le 11/11/2026 — « D'abord un support du cabinet (un disque ou un espace du cabinet suffit
-- pour le premier dossier), puis un stockage européen verrouillé » (ce second temps n'est pas ici) ; la ligne 20.65 (MVP-D3) :
-- « une copie mensuelle des fichiers des pièces rangées hors de Google Drive » ; CFC-Q1 (B) « un seul ZIP », CFC-Q2 (B) « le
-- manifeste rechargé », CFC-Q3 (A) « toute l'équipe », tranchées le 12/11/2026. Le récit : HISTORIQUE.md, « 12/11/2026 — LA
-- COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (LIGNES 20.65 ET 44, INAL6) », puis « LA COPIE DES FICHIERS REPRISE : UN SEUL
-- ZIP EN FLUX ET LE MANIFESTE RECHARGÉ (CFC-Q1, CFC-Q2) ».
--
-- CE QU'ELLE FAIT. `copies_des_fichiers` : une ligne par copie que le chef du cabinet a fabriquée — lib/copieDesFichiers.ts
-- la fabrique dans le navigateur : UN SEUL ZIP pour tout le cabinet, écrit en flux, chaque fichier relu à son SHA-256 quand la
-- base en garde un, et UN manifeste (MANIFESTE.txt) qui porte l'identifiant de la copie. L'identifiant est choisi par
-- l'application (le manifeste le porte, écrit AVANT l'enregistrement). La ligne dit l'instant, l'auteur, les comptes
-- (dossiers, fichiers, vérifiés, écarts, manquants, octets) et le SHA-256 du manifeste. Elle s'écrit en deux temps, par deux
-- fonctions, au chef du cabinet seul (le super-administrateur, qu'`est_chef_du_cabinet` admet, compris) :
--   1. `enregistrer_copie_des_fichiers` : la copie FABRIQUÉE, qui doit couvrir TOUS les dossiers du cabinet au moment où elle
--      s'enregistre. Elle n'est pas encore faite : `rangee_le` est nul.
--   2. `attester_copie_des_fichiers` : le chef RECHARGE le manifeste ; la base en recalcule le SHA-256 (le texte en UTF-8) et
--      ne pose `rangee_le` et `rangee_par` que s'il est celui que la copie a produit. Un manifeste retouché, incomplet ou d'une
--      autre copie se refuse (23514), une copie déjà attestée aussi. Seule une copie attestée compte au rappel du tableau de
--      bord (« la dernière copie complète date de plus d'un mois »).
-- La lit l'équipe du cabinet (`admin_du_cabinet`, chef ou non), jamais un client. Aucune policy d'écriture (ni insertion
-- directe, ni mise à jour, ni suppression) ; elle part avec son cabinet (cascade).
--
-- CE QU'ELLE NE FAIT PAS. La base ne voit pas les fichiers : le manifeste rechargé prouve que le chef DÉTIENT le manifeste de
-- cette copie tel qu'elle l'a produit — au plus près de « rangée sur un support du cabinet », pas que le ZIP y est encore. Le
-- texte du manifeste ne se garde pas (il nomme les dossiers) : seule son empreinte, recalculée. Aucun horodatage (INAL7),
-- aucun stockage verrouillé (le second temps d'INAL-Q3).
--
-- Son retour : supabase/preparees/retour/20261112160100_retour_copies_des_fichiers.sql. Son essai :
-- supabase/essais/copiesDesFichiers.sql ; puis rls.sql (le bloc CF).
--
-- L'ORDRE. La double authentification exigée (`deux_facteurs_exiges`, préparée) pose sa policy restrictive sur chaque table
-- de public : appliquée avant celle-ci, la table neuve la reçoit ici, à l'identique (la relecture de sécurité du 12/11/2026 :
-- sans ce bloc, l'équipe la lisait sans second facteur).
--
-- SOURCES. LPF, art. L102 B (Légifrance) : les documents sur lesquels les contrôles peuvent s'exercer se conservent six ans,
-- les livres et pièces justificatives dix ans (C. com., art. L123-22) ; CNIL, guide de la sécurité des données personnelles
-- (2024), fiche « Sauvegarder » : des sauvegardes régulières, stockées dans un lieu distinct, dont la restauration s'éprouve.

do $garde$
declare
  v_corps text;
begin
  if to_regclass('public.copies_des_fichiers') is not null
     or to_regprocedure('public.enregistrer_copie_des_fichiers(uuid, uuid, integer, integer, integer, integer, integer, bigint, text)') is not null
     or to_regprocedure('public.enregistrer_copie_des_fichiers(uuid, integer, integer, integer, integer, integer, bigint, text[])') is not null
     or to_regprocedure('public.attester_copie_des_fichiers(uuid, uuid, text)') is not null then
    raise exception 'La migration copies_des_fichiers est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.cabinets') is null or to_regclass('public.dossiers') is null then
    raise exception 'copies_des_fichiers : une table dont elle dépend manque (cabinets, dossiers).';
  end if;
  -- L'empreinte du manifeste se recalcule en base.
  if to_regprocedure('pg_catalog.sha256(bytea)') is null then
    raise exception 'copies_des_fichiers : la fonction sha256(bytea) manque.';
  end if;
  -- Les prédicats qu'elle appelle, à l'empreinte de leur corps (les retours chariot écartés).
  for v_corps in select x.f from (values
      ('admin_du_cabinet(uuid)', '9e3218c1a32719441078f0c354493507'),
      ('est_chef_du_cabinet(uuid)', 'df3eeeaf2095b1c86c3bca7624243a0b')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration appelle : relire la migration contre la base avant de l''appliquer.', v_corps;
  end loop;
end
$garde$;

create table public.copies_des_fichiers (
  -- Choisi par l'application : le manifeste le porte, écrit avant l'enregistrement.
  id uuid primary key,
  cabinet_id uuid not null references public.cabinets(id) on delete cascade,
  faite_le timestamptz not null default now(),
  faite_par uuid not null,
  nb_dossiers integer not null,
  nb_fichiers integer not null,
  nb_verifies integer not null,
  nb_ecarts integer not null,
  nb_manquants integer not null,
  octets bigint not null,
  empreinte_du_manifeste text not null,
  -- La preuve : le manifeste rechargé par le chef, à l'empreinte que la copie a produite (`attester_copie_des_fichiers`).
  rangee_le timestamptz,
  rangee_par uuid,
  constraint copies_des_fichiers_comptes check (
    nb_dossiers >= 1 and nb_fichiers >= 0 and nb_verifies >= 0 and nb_ecarts >= 0 and nb_manquants >= 0 and octets >= 0
    and nb_verifies + nb_ecarts + nb_manquants <= nb_fichiers),
  constraint copies_des_fichiers_manifeste check (empreinte_du_manifeste ~ '^[0-9a-f]{64}$'),
  constraint copies_des_fichiers_rangee check (
    (rangee_le is null) = (rangee_par is null) and (rangee_le is null or rangee_le >= faite_le))
);
create index copies_des_fichiers_cabinet on public.copies_des_fichiers (cabinet_id, faite_le desc);
alter table public.copies_des_fichiers enable row level security;
comment on table public.copies_des_fichiers is
  'INAL6 : une ligne par copie des fichiers des dossiers fabriquée par le chef du cabinet (un seul ZIP, un manifeste), faite quand rangee_le est posé sur le manifeste rechargé. Écrite par enregistrer_copie_des_fichiers et attester_copie_des_fichiers seules, lue par l''équipe du cabinet.';

-- L'équipe du cabinet, chef ou non (`admin_du_cabinet` : le super-administrateur, ou un membre de `cabinet_admins`) ; jamais
-- un client, même celui d'un dossier du cabinet.
create policy copies_des_fichiers_lecture on public.copies_des_fichiers
  for select to authenticated using (public.admin_du_cabinet(cabinet_id));

create function public.enregistrer_copie_des_fichiers(
  p_copie_id uuid, p_cabinet_id uuid, p_nb_dossiers integer, p_nb_fichiers integer, p_nb_verifies integer,
  p_nb_ecarts integer, p_nb_manquants integer, p_octets bigint, p_empreinte_du_manifeste text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_dossiers integer;
begin
  -- 1. L'accès, avant toute lecture : le chef du cabinet (le super-administrateur compris).
  if p_cabinet_id is null or auth.uid() is null or not coalesce(public.est_chef_du_cabinet(p_cabinet_id), false) then
    raise exception 'Seul le chef du cabinet enregistre une copie des fichiers.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cabinets c where c.id = p_cabinet_id) then
    raise exception 'Cabinet introuvable.' using errcode = 'P0002';
  end if;
  -- 2. L'identifiant, les comptes et l'empreinte, sous les mots des contraintes.
  if p_copie_id is null then
    raise exception 'L''identifiant de la copie manque.' using errcode = '22023';
  end if;
  if p_nb_dossiers is null or p_nb_fichiers is null or p_nb_verifies is null or p_nb_ecarts is null or p_nb_manquants is null
     or p_octets is null or p_nb_dossiers < 1 or p_nb_fichiers < 0 or p_nb_verifies < 0 or p_nb_ecarts < 0
     or p_nb_manquants < 0 or p_octets < 0 or p_nb_verifies + p_nb_ecarts + p_nb_manquants > p_nb_fichiers then
    raise exception 'Les comptes de la copie sont illisibles.' using errcode = '22023';
  end if;
  if p_empreinte_du_manifeste is null or p_empreinte_du_manifeste !~ '^[0-9a-f]{64}$' then
    raise exception 'L''empreinte du manifeste de la copie est illisible.' using errcode = '22023';
  end if;
  if exists (select 1 from public.copies_des_fichiers c where c.id = p_copie_id) then
    raise exception 'Cette copie est déjà enregistrée.' using errcode = '23505';
  end if;
  -- 3. Une copie couvre TOUS les dossiers du cabinet, au moment où elle s'enregistre : un dossier créé ou supprimé pendant
  --    la fabrication la refuse (la refaire).
  select count(*) into v_dossiers from public.dossiers d where d.cabinet_id = p_cabinet_id;
  if v_dossiers <> p_nb_dossiers then
    raise exception 'La copie porte % dossier(s), le cabinet en a % : elle ne les couvre pas tous. La refaire.',
      p_nb_dossiers, v_dossiers using errcode = '23514';
  end if;
  insert into public.copies_des_fichiers (id, cabinet_id, faite_par, nb_dossiers, nb_fichiers, nb_verifies, nb_ecarts,
                                          nb_manquants, octets, empreinte_du_manifeste)
  values (p_copie_id, p_cabinet_id, auth.uid(), p_nb_dossiers, p_nb_fichiers, p_nb_verifies, p_nb_ecarts, p_nb_manquants,
          p_octets, p_empreinte_du_manifeste);
  return p_copie_id;
end
$fonction$;
revoke execute on function public.enregistrer_copie_des_fichiers(uuid, uuid, integer, integer, integer, integer, integer, bigint, text) from public, anon;
grant execute on function public.enregistrer_copie_des_fichiers(uuid, uuid, integer, integer, integer, integer, integer, bigint, text) to authenticated;

-- CFC-Q2 (B) : la copie ne compte comme faite que sur le manifeste RECHARGÉ. Le texte reçu ne se garde pas ; son SHA-256
-- (UTF-8) se recalcule ici et se compare à celui que la copie a produit. L'application confronte d'abord (l'identifiant, la
-- date, le nombre de fichiers, la ligne de fin) pour DIRE pourquoi un manifeste se refuse ; la base ne croit que l'empreinte.
create function public.attester_copie_des_fichiers(p_cabinet_id uuid, p_copie_id uuid, p_manifeste text)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public'
as $fonction$
declare
  v_copie public.copies_des_fichiers%rowtype;
  v_instant timestamptz := now();
begin
  -- 1. L'accès, avant toute lecture : le chef du cabinet (le super-administrateur compris).
  if p_cabinet_id is null or auth.uid() is null or not coalesce(public.est_chef_du_cabinet(p_cabinet_id), false) then
    raise exception 'Seul le chef du cabinet atteste une copie des fichiers.' using errcode = '42501';
  end if;
  -- 2. La copie, de CE cabinet, sous verrou (deux attestations simultanées : une seule passe).
  select * into v_copie from public.copies_des_fichiers c
   where c.id = p_copie_id and c.cabinet_id = p_cabinet_id for update;
  if not found then
    raise exception 'Copie introuvable dans ce cabinet.' using errcode = 'P0002';
  end if;
  if v_copie.rangee_le is not null then
    raise exception 'Cette copie est déjà attestée.' using errcode = '23514';
  end if;
  -- 3. Le manifeste : présent, de 20 Mio au plus, à l'empreinte que la copie a produite.
  if p_manifeste is null or octet_length(p_manifeste) = 0 or octet_length(p_manifeste) > 20971520 then
    raise exception 'Le manifeste rechargé est vide ou trop gros.' using errcode = '22023';
  end if;
  if encode(pg_catalog.sha256(pg_catalog.convert_to(p_manifeste, 'UTF8')), 'hex') <> v_copie.empreinte_du_manifeste then
    raise exception 'Ce manifeste n''est pas celui que la copie a produit (retouché, incomplet ou d''une autre copie) : la copie n''est pas attestée.'
      using errcode = '23514';
  end if;
  update public.copies_des_fichiers c set rangee_le = v_instant, rangee_par = auth.uid() where c.id = v_copie.id;
  return v_instant;
end
$fonction$;
revoke execute on function public.attester_copie_des_fichiers(uuid, uuid, text) from public, anon;
grant execute on function public.attester_copie_des_fichiers(uuid, uuid, text) to authenticated;

-- La double authentification exigée : appliquée avant celle-ci, sa policy restrictive sur la table neuve, à l'identique.
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.copies_des_fichiers as restrictive for all to authenticated '
            'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
