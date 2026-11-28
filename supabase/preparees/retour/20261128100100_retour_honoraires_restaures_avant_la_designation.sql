-- LE RETOUR de la migration `honoraires_restaures_avant_la_designation` (supabase/preparees/20261128100000_…, préparée le
-- 28/11/2026 ; ligne 47, HR-Q1). Il remet les deux gardes des honoraires au corps de LM7 et de LM8 : la restauration du
-- super-administrateur s'arrête de nouveau au premier lien ou dépôt d'un dossier du cabinet que la base ne désigne pas.
-- Rien ne se détruit : deux fonctions se remplacent. Par l'outil. Avant de le coller, baisser
-- `HONORAIRES_RESTAURES_AVANT_LA_DESIGNATION_PREVUS` (src/lib/honorairesALaRestauration.ts) : la restauration refuse alors de
-- commencer une sauvegarde qui en porte.
do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = to_regprocedure('public.garder_honoraires_factures()')) is distinct from '4163f6b990755e54af3d917b52739be9'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
          where p.oid = to_regprocedure('public.garder_honoraires_deposes()')) is distinct from '1159501c7f11ba9dd1e27421b6bb1a9a' then
    raise exception 'La migration honoraires_restaures_avant_la_designation n''est pas en base, ou ses gardes ont changé depuis : rien à défaire ici.';
  end if;
end
$garde$;

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
     or not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id) then
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

  if not exists (select 1 from public.cabinets c where c.dossier_du_cabinet = new.dossier_id) then
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

do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_honoraires_factures()'::regprocedure) is distinct from '079ede9a4afefb5c071b3ea347289dbd'
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
          where p.oid = 'public.garder_honoraires_deposes()'::regprocedure) is distinct from '8ad5dec28938943c275a154125f80e0e' then
    raise exception 'Garde de fin : les gardes des honoraires ne sont pas revenues au corps de LM7 et de LM8.';
  end if;
end
$fin$;
