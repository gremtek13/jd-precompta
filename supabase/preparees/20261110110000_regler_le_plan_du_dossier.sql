-- PC4 — RÉGLER LE PLAN D'UN DOSSIER, EN BASE (ligne 43 de la feuille de route ; PRÉPARÉE, PAS APPLIQUÉE). La conception :
-- HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA CONCEPTION » (§ 3.2, § 3.4 à § 3.6, la ligne PC4 du découpage,
-- le point NON VÉRIFIÉ 10) ; le récit : « 10/11/2026 — PC4 : RÉGLER LE PLAN D'UN DOSSIER, EN BASE (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; l'essai : supabase/essais/reglerLePlanDuDossier.sql ; le retour :
-- supabase/preparees/retour/20261110110100_retour_regler_le_plan_du_dossier.sql.
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1011-5 (« L'entité
-- établit un plan de comptes »), 1131-1 (« Le numéro de chaque compte divisionnaire commence toujours par le numéro du
-- compte ou sous-compte dont il constitue une subdivision ») et 1131-2 (le zéro terminal regroupe) ; LPF, art. A47 A-1
-- (CompteNum, CompteLib, CompAuxNum) ; BOI-CF-IOR-60-40-20, § 140 à § 170 et § 350 (les subdivisions de l'entreprise
-- figurent au FEC, la codification de ses auxiliaires, aucun transcodage). PostgreSQL 17 : « CREATE TRIGGER » (les
-- déclencheurs BEFORE d'une même table s'exécutent dans l'ordre de leurs noms ; `UPDATE OF` ne se déclenche que si la
-- colonne est nommée par la mise à jour ; un déclencheur de contrainte `DEFERRABLE INITIALLY DEFERRED` se joue à la fin
-- de la transaction, et ses évènements meurent avec une sous-transaction annulée), « Advisory Lock Functions » (un verrou
-- partagé et un verrou exclusif sur la même clé s'excluent ; une transaction ne s'attend pas elle-même), « CREATE
-- POLICY » (les policies permissives d'une même commande se combinent par OU).
--
-- CE QU'ELLE FAIT. Le plan d'un dossier devient RÉGLABLE ; rien ne change pour un dossier qui n'en règle aucun.
--   1. `regler_plan_du_dossier(p_dossier_id, p_comptes)` — le cabinet à qui le dossier est ouvert (`admin_du_dossier` ;
--      Q3 : comme son modèle comptable) écrit le plan ENTIER que le dossier règle (un rôle absent revient au compte du
--      catalogue), sous le verrou EXCLUSIF de la validation du dossier et tant que le dossier ne porte rien sur ses
--      comptes (Q2) ; ses refus, dans l'ordre de la conception ; le compte du dirigeant suit son rôle (PC3-Q1).
--   2. La garde du plan (`garder_plan_comptable_dossier`) reçoit la porte de cette fonction, et rien d'autre ne change
--      dans ce qu'elle juge ; la policy d'insertion de la RESTAURATION, au super-administrateur, qu'annonçait l'étape PC1 :
--      un dossier qui règle son plan le porte dans sa sauvegarde.
--   3. `dossiers_compte_notes_de_frais_check` (455000, 108000, 467000) est RETIRÉE, remplacée par un contrôle contre le
--      plan du dossier : le compte de l'un des trois rôles du dirigeant (`associe`, `exploitant`,
--      `autres_debiteurs_crediteurs`) ; et le déclencheur différé du plan juge le même accord quand le plan change.
--   4. `lettrages_manuels_compte` (401000, 404000, 411000, 455000, 467000) est RETIRÉE, remplacée par un contrôle contre
--      le plan : le compte de l'un des cinq rôles que `lettrer_pieces` apparie (étape PC2).
--   5. `garder_comptes_des_pieces` : une ligne de PIÈCE — le seul chemin d'écriture que la base ne recompose pas — dont
--      le compte commence par la racine d'un rôle que la génération des pièces écrit (la banque, la caisse, les trois TVA,
--      les trois tiers, les trois rôles du dirigeant) porte le compte du plan pour ce rôle, sauf s'il est celui de la
--      catégorie de sa pièce.
-- POUR LE PLAN PAR DÉFAUT — tout dossier aujourd'hui —, les deux contrôles qui remplacent les contraintes acceptent
-- EXACTEMENT ce qu'acceptaient leurs listes (le défaut d'un rôle est le compte d'hier), sauf une porte : la restauration
-- d'un dossier par le super-administrateur, dont le plan arrive APRÈS lui (sa garde n'admet un plan que dans un dossier
-- déjà créé) et dont le dirigeant peut donc tenir un compte réglé ; le déclencheur différé le juge quand le plan arrive.
-- La garde des lignes de pièce refuse une ligne que l'application n'écrit jamais (un 512100 sous le plan par défaut) :
-- l'application compose avec le plan qu'elle lit (étape PC3), et chacune de ses lignes passe.
--
-- CE QUI A CHANGÉ DEPUIS LA CONCEPTION (09/10/2026), et ce que la migration en fait :
--   - le catalogue porte 32 rôles, non 26 : les six de la vente facturée (VF2), dont la `caisse` (53), que la génération
--     des pièces écrit depuis C9a (la contrepartie d'un paiement par la caisse) : elle est gardée comme la banque ;
--   - `lettrer_pieces` lit déjà, depuis PC2, les cinq rôles qui se lettrent — les trois tiers, le 455 et le 467 —, sans
--     dépendre du dirigeant : le contrôle qui remplace `lettrages_manuels_compte` suit LA MÊME liste (le dirigeant « quand
--     il est en 455, 467 ou 468 » de la conception rendrait la base plus stricte que la fonction, et que la liste d'hier) ;
--   - un lettrage fait à la main survit à ses écritures (`lettrages_manuels.piece_id` passe à nul à la suppression de
--     la pièce), et un compte de contrepartie d'un encaissement (VF4b) se choisit avant toute écriture : le verrou de la
--     conception (une écriture, un à-nouveau, un solde reporté) s'étend aux lettrages, aux mouvements classés sur un
--     compte de bilan et aux justifications de la révision, et un compte de contrepartie que le nouveau plan rendrait
--     refusé (`refus_compte_de_contrepartie`) retient le changement ;
--   - les natures d'immobilisation tiennent leur compte sous 20 ou 21 (`natures_immobilisation_compte_immobilisation_format`) :
--     aucune racine de rôle n'y tombe, et la conception les comparait aux rôles pour rien ; seules les catégories le sont ;
--   - le 468 du dirigeant non associé (43-Q7, oui le 17/10/2026) changerait le catalogue, sa copie dans l'application et
--     l'empreinte des essais : il n'est pas ici (PC4-Q2 au cabinet).
--
-- DESTRUCTIF au sens des règles du dépôt : deux `drop constraint` (43-Q4, l'accord du cabinet le 17/10/2026), et le
-- corps de `regler_plan_du_dossier` supprime les lignes du plan qu'il remplace. Aucune donnée n'est perdue : la
-- production ne porte aucune ligne du plan, ses quatre dossiers ont leur dirigeant au 455000 et aucun lettrage n'est
-- fait à la main (relevé du 10/11/2026). L'outil d'application attendrait une confirmation : elle SE COLLE dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet.

-- ══ 0. La garde de tête : l'état que cette migration remplace, entier, ou rien ══════════════════════════════════════════
do $garde$
declare
  v_corps text;
begin
  if to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is not null then
    raise exception 'La migration regler_le_plan_du_dossier est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Les deux contraintes retirées, à l'empreinte de leur définition (migrations modele_comptable_du_dossier et
  -- lettrages_manuels).
  if (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
       where c.conrelid = 'public.dossiers'::regclass and c.conname = 'dossiers_compte_notes_de_frais_check' and c.contype = 'c')
     is distinct from '400f318fd69f408e2a827f5ea92e3987' then
    raise exception 'La contrainte dossiers_compte_notes_de_frais_check n''est plus celle que cette migration remplace : relire la migration contre la base avant de l''appliquer.';
  end if;
  if (select md5(pg_get_constraintdef(c.oid)) from pg_constraint c
       where c.conrelid = 'public.lettrages_manuels'::regclass and c.conname = 'lettrages_manuels_compte' and c.contype = 'c')
     is distinct from '9cb28314e6c2f95d02a7688a98723102' then
    raise exception 'La contrainte lettrages_manuels_compte n''est plus celle que cette migration remplace : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- La garde du plan remplacée, et les fonctions que les déclencheurs neufs appellent, à l'empreinte de leur corps (fins
  -- de ligne ramenées à \n : une migration collée les y laisse).
  for v_corps in select x.f from (values
      ('garder_plan_comptable_dossier()', '11935e7eb713ef1a82f3f26f928d34a1'),
      ('compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('refus_compte_de_contrepartie(uuid, text)', '281e6cb9a386ee93c0d60f92f2cc56a8'),
      ('verrouiller_modele_comptable()', 'c5d5a1bd8c5f8213dee236fd0261d12f')) as x(f, empreinte)
    where (select md5(replace(p.prosrc, E'\r\n', E'\n')) from pg_proc p where p.oid = to_regprocedure('public.' || x.f))
          is distinct from x.empreinte
  loop
    raise exception 'La fonction % n''est plus celle que cette migration remplace ou appelle : relire la migration contre la base avant de l''appliquer.', v_corps;
  end loop;
  -- Les policies du plan : la lecture seule, à l'empreinte de son texte (la policy restrictive `deux_facteurs`, si sa
  -- migration passe avant celle-ci, n'y entre pas).
  if (select md5(string_agg(p.policyname || ':' || p.permissive || ':' || array_to_string(p.roles, ',') || ':' || p.cmd
               || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''), '|' order by p.policyname collate "C"))
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = 'plan_comptable_dossier'
         and not (p.policyname = 'deux_facteurs' and p.permissive = 'RESTRICTIVE'))
     is distinct from md5('plan_comptable_dossier_lecture:PERMISSIVE:authenticated:SELECT:admin_du_dossier(dossier_id):') then
    raise exception 'Les policies de plan_comptable_dossier ne sont plus celles d''hier : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- Le plan de chaque dossier est VIDE : aucune porte ne l'écrivait (la restauration n'avait pas de policy). C'est l'état
  -- où les contrôles qui remplacent les deux contraintes valent exactement leurs listes.
  if exists (select 1 from public.plan_comptable_dossier) then
    raise exception 'Un dossier règle déjà un rôle de son plan : cette migration suppose le plan de chaque dossier vide. La relire avant de l''appliquer.';
  end if;
  -- Les rôles que cette migration nomme, sous les racines qu'elle suppose.
  if (select count(*) from public.roles_comptables r
       where (r.role, r.racines) in (('banque', array['512']), ('caisse', array['53']), ('tva_deductible', array['44566']),
             ('tva_immobilisations', array['44562']), ('tva_collectee', array['44571']), ('fournisseurs', array['401']),
             ('fournisseurs_immobilisations', array['404']), ('clients', array['411']), ('exploitant', array['108']),
             ('associe', array['455']), ('autres_debiteurs_crediteurs', array['467']), ('indemnites_kilometriques', array['6251'])))
     <> 12
     or (select count(*) from public.roles_comptables r where r.prefixe_auxiliaire_defaut is not null) <> 3 then
    raise exception 'Le catalogue des rôles n''est plus celui que cette migration suppose : la relire avant de l''appliquer.';
  end if;
  -- Aucun objet aux noms de ceux qu'elle crée.
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('garder_compte_du_dirigeant', 'garder_compte_lettrable', 'garder_comptes_des_pieces', 'garder_dirigeant_du_plan'))
     or exists (select 1 from pg_trigger t where not t.tgisinternal
                 and t.tgname in ('dossiers_compte_du_dirigeant', 'lettrages_manuels_un_compte_qui_se_lettre',
                                  'ecritures_brouillon_comptes_des_pieces', 'plan_comptable_dossier_dirigeant')) then
    raise exception 'Un objet que cette migration crée existe déjà : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. La garde du plan : la porte de la fonction qui le règle ═════════════════════════════════════════════════════════
-- Ce qu'une ligne du plan EST ne change pas (six chiffres — Q5 —, la racine de son rôle, le préfixe des seuls tiers ; un
-- rôle inconnu bute sur la clé étrangère). Qui l'écrit : `regler_plan_du_dossier`, sous sa porte — le réglage local
-- `jd.regler_plan_du_dossier`, qu'elle pose au dossier qu'elle règle puis remet à vide, et qu'aucune requête de l'API ne
-- pose —, qui remplace les lignes du dossier (elle les retire puis les insère) ; et la restauration d'une sauvegarde par
-- le super-administrateur, comme hier. Les deux, sous le verrou EXCLUSIF de la validation du dossier, dans un dossier
-- qui ne porte encore ni écriture, ni à-nouveau, ni solde reporté. Une ligne ne se modifie toujours pas.
create or replace function public.garder_plan_comptable_dossier() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_racines text[];
  v_prefixe_defaut text;
  v_par_la_fonction boolean;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    if coalesce(current_setting('jd.regler_plan_du_dossier', true), '') = old.dossier_id::text then
      return old;
    end if;
    raise exception 'Une ligne du plan comptable d''un dossier ne se retire pas directement : elle part avec son dossier.'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Une ligne du plan comptable d''un dossier ne se modifie pas directement.' using errcode = '42501';
  end if;
  v_par_la_fonction := coalesce(current_setting('jd.regler_plan_du_dossier', true), '') = new.dossier_id::text;
  if not v_par_la_fonction and not public.is_super_admin() then
    raise exception 'Le plan comptable d''un dossier ne s''écrit pas directement : il se règle par regler_plan_du_dossier, et seule la restauration d''une sauvegarde, par l''administrateur de l''application, y insère une ligne.'
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

-- ══ 2. Régler le plan d'un dossier ════════════════════════════════════════════════════════════════════════════════════
-- `p_comptes` : le plan que le dossier règle, ENTIER — une liste d'objets {role, compte, libelle?, prefixe_auxiliaire?}
-- (libellé et préfixe nuls : ceux du catalogue) ; un rôle absent revient au compte du catalogue, une liste vide rend le
-- plan par défaut. Ses refus, dans cet ordre, que le module de l'écran redira avant le clic (un lot à part) :
--    1. l'accès (42501) ;
--    2. sous le verrou EXCLUSIF de la validation du dossier, un dossier qui porte déjà quelque chose sur ses comptes : une
--       écriture, un à-nouveau, un solde reporté (la conception, Q2), une pièce lettrée à la main, un mouvement classé
--       sur un compte de bilan, une justification de solde de la révision (23514) ;
--    3. la forme de la demande ; 4. un rôle inconnu ; 5. un rôle deux fois ; 6. un compte qui n'est pas de six chiffres
--       (Q5) ; 7. un compte hors des racines de son rôle (art. 1131-1) ; 8. deux rôles du plan effectif sur le même
--       compte à des zéros près (art. 1131-2) ; 9. un rôle du bilan (classes 1 à 5) CHANGÉ vers le compte d'une catégorie
--       que le dossier emploie, à des zéros près ; 10. les indemnités kilométriques changées vers le compte d'une
--       catégorie (le barème et les frais réels restent séparés) ; 11. le libellé ; 12. le préfixe — hors des tiers, sa
--       forme, partagé par deux rôles de tiers du plan effectif (22023) ;
--    13. le compte du dirigeant hors des racines de ses trois rôles (23514) ;
--    puis l'écriture, le dirigeant déplacé avec son rôle (PC3-Q1), et 14. un compte de contrepartie d'un encaissement
--       que le nouveau plan rendrait refusé (`refus_compte_de_contrepartie`) retient tout (23514).
-- Les vérifications 3 à 12 vont refus par refus ; dans chacune, la première ligne de la liste fautive l'emporte.
create function public.regler_plan_du_dossier(p_dossier_id uuid, p_comptes jsonb) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_porte text;
  v_rang bigint;
  v_role text;
  v_autre text;
  v_compte text;
  v_valeur text;
  v_role_du_dirigeant text;
  v_dirigeant text;
begin
  -- 1. L'accès : le cabinet à qui le dossier est ouvert, comme son modèle comptable ; jamais le client. Un dossier qui
  --    n'existe pas se refuse de même, au super-administrateur aussi (`admin_du_dossier` le lui ouvre d'emblée).
  if p_dossier_id is null or not exists (select 1 from public.dossiers d where d.id = p_dossier_id)
     or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2. Le verrou EXCLUSIF de la validation du dossier : toute fonction qui écrit ou vérifie une écriture lit le plan sous
  --    le verrou PARTAGÉ de la même clé (étape PC2), comme les déclencheurs de cette migration ; un changement du plan et
  --    une première écriture ne se croisent pas — l'un attend l'autre, et le second voit le premier. Puis ce que le
  --    dossier porte déjà sur ses comptes, qui resterait sur les anciens.
  perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));
  select concat_ws(', ',
      (select nullif(count(*), 0) || ' écriture(s) au brouillon' from public.ecritures_brouillon e where e.dossier_id = p_dossier_id),
      (select nullif(count(*), 0) || ' à-nouveau(x)' from public.a_nouveaux a where a.dossier_id = p_dossier_id),
      (select nullif(count(*), 0) || ' solde(s) reporté(s)' from public.soldes_reportes s where s.dossier_id = p_dossier_id),
      (select nullif(count(*), 0) || ' pièce(s) lettrée(s) à la main' from public.lettrages_manuels l where l.dossier_id = p_dossier_id),
      (select nullif(count(*), 0) || ' mouvement(s) du relevé classé(s) sur un compte de bilan'
         from public.lignes_bancaires b where b.dossier_id = p_dossier_id and b.compte_bilan is not null),
      (select nullif(count(*), 0) || ' justification(s) de solde de la révision' from public.revision_justifications j where j.dossier_id = p_dossier_id))
    into v_porte;
  if v_porte <> '' then
    raise exception 'Le plan comptable de ce dossier ne se change plus : il porte déjà %, qui resteraient sur les anciens comptes.', v_porte
      using errcode = '23514';
  end if;

  -- 3. La forme de la demande.
  if p_comptes is null or jsonb_typeof(p_comptes) <> 'array' then
    raise exception 'Le plan se règle par la liste des rôles que le dossier règle : [{"role": …, "compte": …, "libelle": …, "prefixe_auxiliaire": …}].'
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
    raise exception 'Le rôle n° % du plan ne se lit pas : un objet qui porte « role » et « compte » en texte, et au plus « libelle » et « prefixe_auxiliaire », en texte ou nuls.', v_rang
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
    raise exception 'Le rôle « % » paraît deux fois dans le plan : un rôle, un compte.', v_role using errcode = '22023';
  end if;
  -- 6. Six chiffres (Q5), la forme que la garde du plan exige aussi.
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
  -- 8. Deux rôles du plan EFFECTIF (la demande, et le catalogue pour les autres) sur le même compte, à des zéros près
  --    (art. 1131-2). Aucune racine du catalogue n'en commence une autre, et un compte de rôle a six chiffres : le refus
  --    ne se rencontre pas aujourd'hui ; il tient le jour où le catalogue ou la longueur changent.
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
  -- 9. Un rôle du bilan, que l'application retrouve par son numéro (la banque, la caisse, la TVA, les tiers, le
  --    dirigeant, l'emprunt, le report…), changé vers le compte d'une catégorie que le dossier emploie — la sienne ou une
  --    catégorie commune — : les lignes de la catégorie s'y confondraient. Le compte du catalogue, inchangé, est celui
  --    d'aujourd'hui pour tout dossier, et ne se refuse pas.
  select x.e ->> 'role', x.e ->> 'compte', c.compte_comptable into v_role, v_compte, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
    join public.categories c on (c.dossier_id = p_dossier_id or c.dossier_id is null)
                            and rtrim(c.compte_comptable, '0') = rtrim(x.e ->> 'compte', '0')
   where left(r.compte_defaut, 1) between '1' and '5' and x.e ->> 'compte' <> r.compte_defaut
   order by x.n, c.compte_comptable collate "C" limit 1;
  if found then
    raise exception 'Le compte « % » du rôle « % » est celui d''une catégorie que ce dossier emploie (« % »), à des zéros près : un compte de bilan que l''application écrit ne se partage pas avec une catégorie.',
      v_compte, v_role, v_valeur using errcode = '22023';
  end if;
  -- 10. Les indemnités kilométriques changées vers le compte d'une catégorie : le barème et les frais réels (la catégorie
  --     « Carburant / déplacements ») doivent rester séparables.
  select x.e ->> 'compte', c.compte_comptable into v_compte, v_valeur
    from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
    join public.roles_comptables r on r.role = x.e ->> 'role'
    join public.categories c on (c.dossier_id = p_dossier_id or c.dossier_id is null)
                            and rtrim(c.compte_comptable, '0') = rtrim(x.e ->> 'compte', '0')
   where r.role = 'indemnites_kilometriques' and x.e ->> 'compte' <> r.compte_defaut
   order by x.n, c.compte_comptable collate "C" limit 1;
  if found then
    raise exception 'Le compte des indemnités kilométriques (« % ») est celui d''une catégorie que ce dossier emploie (« % »), à des zéros près : le barème et les frais réels restent séparés.',
      v_compte, v_valeur using errcode = '22023';
  end if;
  -- 11. Le libellé (CompteLib) : nul, celui du catalogue ; sinon une ligne, d'un à deux cents caractères.
  select x.e ->> 'role' into v_role from jsonb_array_elements(p_comptes) with ordinality as x(e, n)
   where x.e ->> 'libelle' is not null
     and (btrim(x.e ->> 'libelle', E' \t\n\r') = '' or length(x.e ->> 'libelle') > 200 or (x.e ->> 'libelle') ~ '[[:cntrl:]]')
   order by x.n limit 1;
  if found then
    raise exception 'Le libellé du rôle « % » tient sur une ligne, d''un à deux cents caractères ; nul, c''est celui du catalogue.', v_role
      using errcode = '22023';
  end if;
  -- 12. Le préfixe des comptes auxiliaires : sur les trois tiers seulement, de sa forme, et jamais partagé par deux tiers
  --     du plan effectif (deux natures de tiers partageraient un auxiliaire).
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
  -- 13. Le rôle du dirigeant, lu à la RACINE de son compte (455, 108 ou 467) : sous le plan d'hier, c'est le rôle dont
  --     il est le compte.
  select r.role into v_role_du_dirigeant
    from public.dossiers d cross join public.roles_comptables r cross join unnest(r.racines) as u(racine)
   where d.id = p_dossier_id and r.role in ('associe', 'exploitant', 'autres_debiteurs_crediteurs')
     and left(d.compte_notes_de_frais, length(u.racine)) = u.racine
   order by r.ordre limit 1;
  if not found then
    raise exception 'Le compte du dirigeant de ce dossier n''est sous la racine d''aucun de ses trois rôles (associé, exploitant, autres débiteurs et créditeurs) : le corriger d''abord.'
      using errcode = '23514';
  end if;

  -- L'écriture : les lignes du dossier remplacées, sous la porte de la garde, posée pour ce dossier puis remise à vide.
  perform set_config('jd.regler_plan_du_dossier', p_dossier_id::text, true);
  delete from public.plan_comptable_dossier where dossier_id = p_dossier_id;
  insert into public.plan_comptable_dossier (dossier_id, role, compte, libelle, prefixe_auxiliaire, origine, regle_par, regle_le)
  select p_dossier_id, x.e ->> 'role', x.e ->> 'compte', x.e ->> 'libelle', x.e ->> 'prefixe_auxiliaire', 'dossier', auth.uid(), now()
    from jsonb_array_elements(p_comptes) as x(e);
  perform set_config('jd.regler_plan_du_dossier', '', true);
  -- Le compte du dirigeant suit son rôle, dans la même transaction (PC3-Q1) : le plan ne change que dans un dossier qui
  -- n'a rien écrit, rien n'est donc sur l'ancien compte.
  v_dirigeant := public.compte_du_role(p_dossier_id, v_role_du_dirigeant);
  update public.dossiers set compte_notes_de_frais = v_dirigeant
   where id = p_dossier_id and compte_notes_de_frais is distinct from v_dirigeant;
  -- 14. Un compte de contrepartie d'un encaissement, choisi sous l'ancien plan, que le nouveau rendrait refusé.
  select e.compte_contrepartie, public.refus_compte_de_contrepartie(p_dossier_id, e.compte_contrepartie) into v_compte, v_valeur
    from public.encaissements_factures e
   where e.dossier_id = p_dossier_id and e.compte_contrepartie is not null and e.retire_le is null
     and public.refus_compte_de_contrepartie(p_dossier_id, e.compte_contrepartie) is not null
   order by e.cree_le, e.id limit 1;
  if found then
    raise exception 'Sous ce plan, le compte de contrepartie « % » d''un encaissement serait refusé : % Choisir d''abord un autre compte pour cet encaissement.',
      v_compte, v_valeur using errcode = '23514';
  end if;
end
$$;

-- ══ 3. Le compte du dirigeant, contre le plan du dossier (remplace dossiers_compte_notes_de_frais_check) ══════════════
-- Le compte de l'un des trois rôles du dirigeant DANS LE PLAN DU DOSSIER : sous le plan par défaut, 455000, 108000 ou
-- 467000, exactement la liste d'hier. APRÈS les déclencheurs BEFORE de la table, comme une contrainte (le modèle figé dès
-- la première écriture, `verrouiller_modele_comptable`, se dit d'abord, comme hier). Une valeur inchangée ne se rejuge
-- pas : une contrainte ne se rejuge que sur la ligne qu'on écrit, et le plan ne change que par sa fonction, qui déplace le
-- dirigeant, ou par la restauration, que le déclencheur différé du plan juge. LA PORTE DE LA RESTAURATION : le
-- super-administrateur insère un dossier dont le plan arrive après lui (la garde du plan n'en admet un que dans un
-- dossier créé) ; son dirigeant n'est alors jugé qu'à sa forme — six chiffres sous la racine de l'un des trois rôles —, et
-- le plan restauré le juge à sa fin de transaction.
create function public.garder_compte_du_dirigeant() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_associe text;
  v_exploitant text;
  v_autres text;
begin
  if tg_op = 'UPDATE' and new.compte_notes_de_frais is not distinct from old.compte_notes_de_frais then
    return null;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.id));
  v_associe := public.compte_du_role(new.id, 'associe');
  v_exploitant := public.compte_du_role(new.id, 'exploitant');
  v_autres := public.compte_du_role(new.id, 'autres_debiteurs_crediteurs');
  if new.compte_notes_de_frais in (v_associe, v_exploitant, v_autres) then
    return null;
  end if;
  if tg_op = 'INSERT' and public.is_super_admin() and new.compte_notes_de_frais ~ '^[0-9]{6}$'
     and exists (select 1 from public.roles_comptables r cross join unnest(r.racines) as u(racine)
                  where r.role in ('associe', 'exploitant', 'autres_debiteurs_crediteurs')
                    and left(new.compte_notes_de_frais, length(u.racine)) = u.racine) then
    return null;
  end if;
  raise exception 'Le compte du dirigeant (« % ») n''est, dans le plan de ce dossier, le compte d''aucun des trois rôles du dirigeant : % (associé), % (exploitant), % (autres débiteurs et créditeurs).',
    new.compte_notes_de_frais, v_associe, v_exploitant, v_autres using errcode = '23514';
end
$$;

create trigger dossiers_compte_du_dirigeant
  after insert or update of compte_notes_de_frais on public.dossiers
  for each row execute function public.garder_compte_du_dirigeant();

-- Le même accord quand le PLAN change : une ligne du plan insérée ou retirée (par la fonction, qui a déplacé le
-- dirigeant ; par la restauration ; par la cascade d'un dossier, qui n'existe plus alors) se juge en fin de transaction,
-- quand toutes les lignes sont là.
create function public.garder_dirigeant_du_plan() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dossier uuid := case when tg_op = 'DELETE' then old.dossier_id else new.dossier_id end;
  v_compte text;
  v_associe text;
  v_exploitant text;
  v_autres text;
begin
  select d.compte_notes_de_frais into v_compte from public.dossiers d where d.id = v_dossier;
  if not found then
    return null;
  end if;
  v_associe := public.compte_du_role(v_dossier, 'associe');
  v_exploitant := public.compte_du_role(v_dossier, 'exploitant');
  v_autres := public.compte_du_role(v_dossier, 'autres_debiteurs_crediteurs');
  if v_compte in (v_associe, v_exploitant, v_autres) then
    return null;
  end if;
  raise exception 'Le compte du dirigeant (« % ») n''est, dans le plan de ce dossier, le compte d''aucun des trois rôles du dirigeant : % (associé), % (exploitant), % (autres débiteurs et créditeurs).',
    v_compte, v_associe, v_exploitant, v_autres using errcode = '23514';
end
$$;

create constraint trigger plan_comptable_dossier_dirigeant
  after insert or delete on public.plan_comptable_dossier
  deferrable initially deferred
  for each row execute function public.garder_dirigeant_du_plan();

-- ══ 4. Le compte d'un lettrage fait à la main, contre le plan (remplace lettrages_manuels_compte) ════════════════════
-- Les cinq rôles que `lettrer_pieces` apparie depuis l'étape PC2 : les trois tiers, l'associé et les autres débiteurs et
-- créditeurs ; sous le plan par défaut, exactement la liste d'hier. Après la garde de l'exemplaire d'une facture source
-- (`lettrages_manuels_sans_exemplaire_d_une_source`, que l'ordre des noms fait passer d'abord), avant l'unicité de la
-- pièce : la place d'une contrainte. Sous le verrou PARTAGÉ du dossier, avant de lire son plan. Seuls le compte et le
-- dossier le déclenchent : la pièce qui passe à nul (`on delete set null`) ne rejuge pas un lettrage d'hier.
create function public.garder_compte_lettrable() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comptes text[];
begin
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_comptes := array[public.compte_du_role(new.dossier_id, 'fournisseurs'),
                     public.compte_du_role(new.dossier_id, 'fournisseurs_immobilisations'),
                     public.compte_du_role(new.dossier_id, 'clients'),
                     public.compte_du_role(new.dossier_id, 'associe'),
                     public.compte_du_role(new.dossier_id, 'autres_debiteurs_crediteurs')];
  if new.compte = any (v_comptes) then
    return new;
  end if;
  raise exception 'Le compte « % » n''est pas, dans le plan de ce dossier, un compte de tiers qui se lettre : %.',
    new.compte, array_to_string(v_comptes, ', ') using errcode = '23514';
end
$$;

create trigger lettrages_manuels_un_compte_qui_se_lettre
  before insert or update of compte, dossier_id on public.lettrages_manuels
  for each row execute function public.garder_compte_lettrable();

-- ══ 5. Les lignes de pièce, contre le plan (`garder_comptes_des_pieces`, conception § 3.4) ════════════════════════════
-- Le navigateur compose les écritures d'une pièce et les insère sans fonction (la génération, « Régénérer », la
-- contrepartie d'un rapprochement) : le seul chemin que la base ne recompose pas. Une ligne de PIÈCE dont le compte
-- commence par la racine d'un rôle que cette génération écrit — la banque et la caisse (la contrepartie d'un paiement),
-- les trois TVA, les trois tiers, les trois rôles du dirigeant — porte le compte du plan pour ce rôle, sauf s'il est
-- celui de la catégorie de sa pièce (une note rangée dans une catégorie au compte de l'exploitant y porte sa charge).
-- Elle ferme la seule fenêtre où un navigateur composerait avec un plan qui vient de changer. Elle prend elle-même le
-- verrou PARTAGÉ du dossier avant de lire le plan : celui qui le prend aujourd'hui (`ecritures_brouillon_intangibles`)
-- passe après elle dans l'ordre des noms. Seuls le compte, la pièce et le dossier la déclenchent : une ligne redatée
-- (le rapprochement) ou détachée de sa pièce supprimée (`on delete set null`) ne se rejuge pas.
create function public.garder_comptes_des_pieces() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_compte text;
begin
  select r.role into v_role
    from public.roles_comptables r cross join unnest(r.racines) as u(racine)
   where r.role in ('banque', 'caisse', 'tva_deductible', 'tva_immobilisations', 'tva_collectee', 'fournisseurs',
                    'fournisseurs_immobilisations', 'clients', 'exploitant', 'associe', 'autres_debiteurs_crediteurs')
     and left(new.compte, length(u.racine)) = u.racine
   order by r.ordre limit 1;
  if not found then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_compte := public.compte_du_role(new.dossier_id, v_role);
  if new.compte = v_compte then
    return new;
  end if;
  if exists (select 1 from public.pieces p join public.categories c on c.id = p.categorie_id
              where p.id = new.piece_id and c.compte_comptable = new.compte) then
    return new;
  end if;
  raise exception 'Une ligne de pièce au compte « % » : sous cette racine, le plan de ce dossier tient le rôle « % » au compte « % ».',
    new.compte, v_role, v_compte using errcode = '23514';
end
$$;

create trigger ecritures_brouillon_comptes_des_pieces
  before insert or update of compte, piece_id, dossier_id on public.ecritures_brouillon
  for each row when (new.piece_id is not null) execute function public.garder_comptes_des_pieces();

-- ══ 6. La restauration d'un plan, au super-administrateur (annoncée à l'étape PC1) ════════════════════════════════════
-- La garde n'admet l'insertion que du super-administrateur, dans un dossier sans écriture, sous le verrou exclusif ;
-- cette policy lui ouvre la porte de l'API, et rien à personne d'autre.
create policy plan_comptable_dossier_restauration on public.plan_comptable_dossier
  for insert to authenticated with check (is_super_admin());

-- ══ 7. Les deux contraintes en dur, retirées : les contrôles 3 et 4 les remplacent ═══════════════════════════════════
alter table public.dossiers drop constraint dossiers_compte_notes_de_frais_check;
alter table public.lettrages_manuels drop constraint lettrages_manuels_compte;

-- ══ 8. Les droits ═════════════════════════════════════════════════════════════════════════════════════════════════════
revoke execute on function public.regler_plan_du_dossier(uuid, jsonb) from public, anon;
grant execute on function public.regler_plan_du_dossier(uuid, jsonb) to authenticated;
revoke execute on function public.garder_compte_du_dirigeant() from public, anon, authenticated;
revoke execute on function public.garder_dirigeant_du_plan() from public, anon, authenticated;
revoke execute on function public.garder_compte_lettrable() from public, anon, authenticated;
revoke execute on function public.garder_comptes_des_pieces() from public, anon, authenticated;

comment on function public.regler_plan_du_dossier(uuid, jsonb) is
  'Règle le plan comptable d''un dossier (ligne 43, étape PC4) : le plan ENTIER que le dossier règle, un rôle absent au compte du catalogue ; par le cabinet à qui le dossier est ouvert, sous le verrou exclusif de sa validation, tant que le dossier ne porte rien sur ses comptes ; le compte du dirigeant suit son rôle.';
comment on table public.plan_comptable_dossier is
  'Les rôles qu''un dossier règle (ligne 43) : un rôle sans ligne prend le défaut de roles_comptables. Lu par le cabinet du dossier (admin_du_dossier), jamais par le client ; écrit par regler_plan_du_dossier (étape PC4) et par la restauration d''une sauvegarde (le super-administrateur), dans un dossier qui ne porte encore rien sur ses comptes (garder_plan_comptable_dossier).';
comment on column public.dossiers.compte_notes_de_frais is
  'Le compte du dirigeant : en engagement, celui que crédite une note de frais qu''il a payée. Le compte, dans le plan du dossier, de l''un des trois rôles du dirigeant — 455 compte courant d''associé (dirigeant associé d''une société), 108 compte de l''exploitant (entreprise individuelle), 467 divers comptes débiteurs et produits à recevoir (personne non associée) ; regler_plan_du_dossier le déplace avec son rôle.';

-- ══ 9. La garde de fin : les données d'aujourd'hui passent les contrôles qui remplacent les deux contraintes ══════════
do $fin$
begin
  if exists (select 1 from public.dossiers d
              where d.compte_notes_de_frais not in (public.compte_du_role(d.id, 'associe'), public.compte_du_role(d.id, 'exploitant'),
                                                    public.compte_du_role(d.id, 'autres_debiteurs_crediteurs'))) then
    raise exception 'Un dossier a son dirigeant hors de son plan : la migration ne s''applique pas.';
  end if;
  if exists (select 1 from public.lettrages_manuels l
              where l.compte not in (public.compte_du_role(l.dossier_id, 'fournisseurs'),
                                     public.compte_du_role(l.dossier_id, 'fournisseurs_immobilisations'),
                                     public.compte_du_role(l.dossier_id, 'clients'), public.compte_du_role(l.dossier_id, 'associe'),
                                     public.compte_du_role(l.dossier_id, 'autres_debiteurs_crediteurs'))) then
    raise exception 'Un lettrage fait à la main porte un compte qui ne se lettre pas dans le plan de son dossier : la migration ne s''applique pas.';
  end if;
  if exists (select 1 from pg_constraint c where c.conname in ('dossiers_compte_notes_de_frais_check', 'lettrages_manuels_compte'))
     or (select count(*) from pg_trigger t where not t.tgisinternal
          and t.tgname in ('dossiers_compte_du_dirigeant', 'lettrages_manuels_un_compte_qui_se_lettre',
                           'ecritures_brouillon_comptes_des_pieces', 'plan_comptable_dossier_dirigeant')) <> 4 then
    raise exception 'La migration ne s''est pas écrite entière : rien n''est appliqué.';
  end if;
end
$fin$;
