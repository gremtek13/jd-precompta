-- LES HONORAIRES DU DOSSIER DU CABINET SE RESTAURENT AVANT SA DÉSIGNATION (ligne 47, LM7 et LM8 ; HR-Q1, relecture adverse
-- du 28/11/2026) — PRÉPARÉE, PAS APPLIQUÉE. Après `honoraires_factures` (LM7) et `depot_des_honoraires` (LM8), en production
-- depuis le 12/11/2026, dont elle remplace les deux gardes, et elles seules. Le récit : HISTORIQUE.md, « 28/11/2026 — LA
-- RELECTURE ADVERSE DES HONORAIRES DU CABINET ».
--
-- LE DÉFAUT, ÉTABLI À LA LECTURE ET SUR UNE RÉPLIQUE PORTÉE À 261. Une sauvegarde est par dossier ; la désignation du dossier
-- du cabinet (`cabinets.dossier_du_cabinet`, LM1) n'en est d'aucune — « un dossier du cabinet restauré revient sans sa
-- désignation, que le chef pose de nouveau » (src/lib/sauvegarde.ts) —, et la restauration ne s'ouvre que sur un dossier
-- absent de la base d'arrivée, donc jamais désigné (la clé de la désignation passe à nul quand le dossier part). Or les
-- gardes de `honoraires_factures` et de `honoraires_deposes`, « pour tout auteur, la restauration du super-administrateur
-- comprise », exigent que le dossier de la ligne SOIT le dossier désigné : la restauration du dossier du cabinet s'arrête à
-- son premier lien d'honoraires (23514, « Une facture d'honoraires se lie, dans le dossier du cabinet… »), après avoir écrit
-- le dossier, ses lettres et ses factures — et ce dossier, sans ses liens, ne se complète plus : ses périodes facturées
-- reviendraient « à facturer ». La garde de la fiche liée (LM3, `garder_fiche_liee`) avait prévu ce cas (« le
-- super-administrateur excepté, qui restaure un dossier avant de le désigner ») ; LM7 et LM8, non. `restauration.sql` ne l'a
-- pas vu : son dossier n'est pas le dossier du cabinet, ses tables d'honoraires y sont vides.
--
-- CE QU'ELLE FAIT. Les deux gardes, au corps de production à l'octet près (vérifié par son empreinte, plus bas), plus une
-- condition : la désignation se juge pour tout auteur SAUF le super-administrateur, la seule porte d'insertion de ces deux
-- tables hors de leurs fonctions (les policies `…_restauration`), la règle même de LM3. Tout le reste de chaque garde tient
-- pour lui : la lettre du même dossier et acceptée, la facture du même dossier, un seul client, la période facturée une fois,
-- le client que les honoraires désignent, la pièce d'achat du dossier du client. Les fonctions (`facturer_honoraires`,
-- `deposer_honoraires_chez_le_client`) jugent toujours la désignation elles-mêmes, avant toute lecture : rien ne s'ouvre à un
-- membre de l'équipe ni au chef. Une fois restauré, le dossier se désigne par `designer_dossier_du_cabinet`, qui refuse un
-- dossier portant un accès client (LM1) : ses honoraires ne se lisent qu'au cabinet.
--
-- ÉCARTÉS : désigner le dossier pendant la restauration (le cabinet d'arrivée peut en désigner un autre, que ses factures ou
-- ses lettres retiennent, LM1 et LM4 ; et la sauvegarde ne dit pas la désignation) ; restaurer sans les liens puis les
-- reposer à la main (les périodes facturées reviendraient « à facturer », et une facture validée se facturerait deux fois).
--
-- SOURCES. Aucune règle légale nouvelle : les honoraires restent ceux que les lettres figent (décret n° 2012-432, art. 158)
-- et les factures celles que le dossier du cabinet a émises (CGI, art. 289). PLAN_DE_REPRISE.md, § 5 : la restauration
-- « refuse tout ce qu'elle ne peut pas faire honnêtement » — elle ne s'arrête pas en chemin.
--
-- PAR L'OUTIL (`apply_migration`) : rien ne se détruit ni ne se supprime — deux fonctions se remplacent par `create or
-- replace`, leurs droits et leurs déclencheurs gardés. Son retour : supabase/preparees/retour/20261128100100_retour_
-- honoraires_restaures_avant_la_designation.sql (les deux corps d'hier). Son essai : supabase/essais/honorairesRestaures.sql
-- (réplique seulement) ; puis depotDesHonoraires.sql (son étape 47 suit la migration), honorairesFactures.sql et rls.sql (les
-- blocs HF et HD). L'application la suit par `HONORAIRES_RESTAURES_AVANT_LA_DESIGNATION_PREVUS`
-- (src/lib/honorairesALaRestauration.ts), baissé : d'ici là, la restauration REFUSE de commencer une sauvegarde qui porte des
-- liens ou des dépôts d'honoraires, au lieu de s'arrêter à eux.

-- ══ 0. La garde de tête ══════════
do $garde$
begin
  if to_regclass('public.honoraires_factures') is null or to_regclass('public.honoraires_deposes') is null
     or to_regprocedure('public.is_super_admin()') is null
     or to_regprocedure('public.garder_honoraires_factures()') is null or to_regprocedure('public.garder_honoraires_deposes()') is null then
    raise exception 'Les factures d''honoraires (LM7) et leur dépôt (LM8) ne sont pas en base : cette migration les suppose.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_honoraires_factures()'::regprocedure) = '4163f6b990755e54af3d917b52739be9'
     and (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
           where p.oid = 'public.garder_honoraires_deposes()'::regprocedure) = '1159501c7f11ba9dd1e27421b6bb1a9a' then
    raise exception 'Les gardes des honoraires acceptent déjà la restauration avant la désignation : la migration a déjà été appliquée.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_honoraires_factures()'::regprocedure) is distinct from '079ede9a4afefb5c071b3ea347289dbd'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
          where p.oid = 'public.garder_honoraires_deposes()'::regprocedure) is distinct from '8ad5dec28938943c275a154125f80e0e' then
    raise exception 'garder_honoraires_factures ou garder_honoraires_deposes a changé depuis LM7 et LM8 : refaire cette migration sur le corps en production.';
  end if;
end
$garde$;

-- ══ 1. La garde des liens d'honoraires (LM7) ══════════
create or replace function public.garder_honoraires_factures() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_lettre public.lettres_de_mission;
  v_ligne jsonb;
  v_facture public.factures_emises;
  v_racine uuid;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.factures_emises f where f.id = old.facture_id) then
      return old;
    end if;
    raise exception 'Le lien d''une facture d''honoraires ne se retire pas : il part avec son brouillon, et un avoir qui crédite la facture en entier rend sa période à facturer.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Le lien d''une facture d''honoraires ne se modifie pas.' using errcode = '23514';
  end if;

  select l.* into v_lettre from public.lettres_de_mission l where l.id = new.lettre_id;
  if not found or v_lettre.dossier_id <> new.dossier_id
     or (not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id)
         -- HR-Q1 : la restauration du super-administrateur réinsère les liens d'un dossier du cabinet que la base d'arrivée
         -- ne désigne pas encore (la désignation n'est d'aucune sauvegarde : le chef la pose après) ; tout autre auteur, non.
         and not public.is_super_admin()) then
    raise exception 'Une facture d''honoraires se lie, dans le dossier du cabinet, à une lettre de mission de ce dossier.'
      using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_factures:' || new.dossier_id::text || ':'
                                                 || coalesce(v_lettre.dossier_client_id::text, '-'), 0));
  if v_lettre.acceptee_le is null then
    raise exception 'Une lettre de mission se facture une fois acceptée.' using errcode = '23514';
  end if;
  v_ligne := v_lettre.honoraires -> (new.ligne - 1);
  if v_ligne is null or coalesce(v_ligne ->> 'forme', '') not in ('forfait', 'tache') then
    raise exception 'La ligne d''honoraires est introuvable dans la lettre, ou se facture au temps passé (LM9).' using errcode = '23514';
  end if;
  if v_ligne ->> 'forme' = 'forfait'
     and not public.periode_de_forfait_valide(v_ligne ->> 'periodicite', new.periode_debut, new.periode_fin) then
    raise exception 'Une période de forfait tient dans un mois, un trimestre ou une année civils, selon sa périodicité.' using errcode = '23514';
  end if;
  select f.* into v_facture from public.factures_emises f where f.id = new.facture_id for share;
  if not found or v_facture.dossier_id <> new.dossier_id or v_facture.type <> 'facture' or v_facture.acompte
     or v_facture.statut not in ('brouillon', 'validee', 'importee') then
    raise exception 'Une facture d''honoraires est une facture du dossier du cabinet, ni un avoir ni un acompte.' using errcode = '23514';
  end if;
  if exists (select 1 from public.honoraires_factures h join public.lettres_de_mission l on l.id = h.lettre_id
              where h.facture_id = new.facture_id and l.dossier_client_id is distinct from v_lettre.dossier_client_id) then
    raise exception 'Une facture d''honoraires s''adresse à un seul client.' using errcode = '23514';
  end if;
  if not public.facture_creditee_en_entier(new.facture_id) then
    v_racine := public.racine_de_la_lettre(new.lettre_id);
    if exists (select 1 from public.honoraires_factures h
                 join public.lettres_de_mission l on l.id = h.lettre_id
                where h.dossier_id = new.dossier_id and h.id is distinct from new.id
                  -- Un forfait : un jour ne se facture qu'une fois (deux périodes qui se recouvrent) ; une tâche : sa période.
                  and case when v_ligne ->> 'forme' = 'forfait'
                           then h.periode_debut <= new.periode_fin and new.periode_debut <= h.periode_fin
                           else h.periode_debut = new.periode_debut and h.periode_fin = new.periode_fin end
                  and l.dossier_client_id is not distinct from v_lettre.dossier_client_id
                  and ((h.lettre_id = new.lettre_id and h.ligne = new.ligne)
                       or (h.lettre_id <> new.lettre_id and public.racine_de_la_lettre(h.lettre_id) = v_racine
                           and (l.honoraires -> (h.ligne - 1)) ->> 'forme' = v_ligne ->> 'forme'
                           and case v_ligne ->> 'forme'
                                 when 'forfait' then (l.honoraires -> (h.ligne - 1)) ->> 'periodicite' = v_ligne ->> 'periodicite'
                                 else (l.honoraires -> (h.ligne - 1)) ->> 'livrable' = v_ligne ->> 'livrable'
                                      and v_ligne ->> 'livrable' <> 'autre'
                               end))
                  and not public.facture_creditee_en_entier(h.facture_id)) then
      raise exception 'Cette période est déjà facturée : une facture qui n''est pas créditée en entier la couvre.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- ══ 2. La garde des dépôts (LM8) ══════════
create or replace function public.garder_honoraires_deposes() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_facture public.factures_emises;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Le dépôt d''une facture d''honoraires ne se retire pas : retirer sa pièce du dossier du client la rend à déposer.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Le dépôt d''une facture d''honoraires ne se modifie pas.' using errcode = '23514';
  end if;

  -- HR-Q1 : la restauration du super-administrateur réinsère les dépôts d'un dossier du cabinet que la base d'arrivée ne
  -- désigne pas encore (la désignation n'est d'aucune sauvegarde : le chef la pose après) ; tout autre auteur, non.
  if not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id)
     and not public.is_super_admin() then
    raise exception 'Une facture d''honoraires se dépose depuis le dossier du cabinet.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('jd.honoraires_deposes:' || new.dossier_id::text, 0));
  select f.* into v_facture from public.factures_emises f where f.id = new.facture_id;
  if not found or v_facture.dossier_id <> new.dossier_id or v_facture.statut <> 'validee'
     or v_facture.type not in ('facture', 'avoir') then
    raise exception 'Seule une facture ou un avoir validé du dossier du cabinet se dépose chez le client.' using errcode = '23514';
  end if;
  if public.client_de_la_facture_d_honoraires(new.facture_id) is distinct from new.dossier_client_id then
    raise exception 'Une facture d''honoraires se dépose chez le client que ses honoraires désignent.' using errcode = '23514';
  end if;
  if exists (select 1 from public.pieces p where p.id = new.piece_id) then
    if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_client_id
                    and p.type_piece = 'achat') then
      raise exception 'La pièce d''un dépôt est une pièce d''achat du dossier du client.' using errcode = '23514';
    end if;
    if exists (select 1 from public.honoraires_deposes h join public.pieces p on p.id = h.piece_id
                where h.facture_id = new.facture_id and h.id is distinct from new.id) then
      raise exception 'Cette facture est déjà déposée chez le client.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- ══ 3. La garde de fin ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_honoraires_factures()'::regprocedure) is distinct from '4163f6b990755e54af3d917b52739be9'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
          where p.oid = 'public.garder_honoraires_deposes()'::regprocedure) is distinct from '1159501c7f11ba9dd1e27421b6bb1a9a'
     or (select p.prosecdef from pg_proc p where p.oid = 'public.garder_honoraires_factures()'::regprocedure)
     or (select p.prosecdef from pg_proc p where p.oid = 'public.garder_honoraires_deposes()'::regprocedure)
     or has_function_privilege('anon', 'public.garder_honoraires_factures()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_honoraires_factures()', 'execute')
     or has_function_privilege('anon', 'public.garder_honoraires_deposes()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_honoraires_deposes()', 'execute')
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.honoraires_factures'::regclass
                     and t.tgname = 'honoraires_factures_gardes' and t.tgfoid = 'public.garder_honoraires_factures()'::regprocedure)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.honoraires_deposes'::regclass
                     and t.tgname = 'honoraires_deposes_gardes' and t.tgfoid = 'public.garder_honoraires_deposes()'::regprocedure) then
    raise exception 'Garde de fin : les gardes des honoraires ne sont pas celles que la migration écrit, ou leurs droits ont changé.';
  end if;
end
$fin$;
