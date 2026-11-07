-- LE RETOUR ARRIÈRE DE LA MIGRATION `regularisation_des_cotisations` (ligne 27, TNS-Q2) — PRÉPARÉ, À NE COLLER QU'AVEC
-- L'ACCORD EXPLICITE DU CABINET : il DÉTRUIT des données. À coller dans l'éditeur SQL de Supabase, dans une transaction,
-- avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une confirmation »). La migration :
-- supabase/schema/20261107165415_regularisation_des_cotisations.sql (en production depuis le 07/11/2026).
--
-- L'ORDRE : D'ABORD l'application — `REGULARISATION_DES_COTISATIONS_EXPORTEE` rebaissé (src/lib/regularisationDesCotisations.ts),
-- `types.ts` remis, et mis en ligne : sinon l'onglet Cotisations écrirait des colonnes absentes et chaque saisie se refuserait —,
-- PUIS ce texte. Le drapeau rebaissé seul n'est PAS un retour sans perte : l'onglet ne montre ni n'écrit plus la
-- description et la carte du volet social n'estime plus rien, mais les quatre colonnes restent, lues par toute lecture
-- entière de la table (celle du client « membre », la sauvegarde), et « Réunir », qui suit les colonnes LUES et non le
-- drapeau (lib/gestesDesEcheances.ts), y écrit encore : l'échéance gardée n'y garde que ce que les deux disent à
-- l'identique, et perd le reste. Le gel, lui, resterait celui de la migration (les quatre champs hors de sa comparaison).
--
-- CE QU'IL DÉTRUIT, sans retour : pour CHAQUE échéance de cotisation de tous les dossiers, son organisme, l'année qu'elle paie,
-- sa nature et la part de son appel qui régularise l'année d'avant (TNS-Q2-B) — y compris sur les échéances d'un exercice validé, que le gel ne protège pas : la migration les laisse se
-- décrire après la validation. La régularisation estimée ne se calculera plus. Une sauvegarde faite avant lui porte ces
-- colonnes : elle ne se restaure plus sur une base qui ne les a pas sans les en retirer d'abord.
-- CE QU'IL REMET : la table telle qu'avant la migration (les six contraintes partent avec leurs colonnes), et le gel
-- au corps de `paiement_personnel_des_cotisations`, mot pour mot (md5 dfa6faabda81af162016e620ea6375fe) : il compare de
-- nouveau la ligne entière. `create or replace` garde l'OID, le propriétaire et les droits de la fonction.
-- CE QU'IL NE TOUCHE PAS : les montants, les dates, les marqueurs, les paiements, leurs écritures ; aucune autre table,
-- fonction, policy ni droit.
-- CE QU'IL SUPPOSE, que son premier bloc vérifie : les quatre colonnes en base, et le gel au corps de la migration (md5
-- 1b004781ac05f71798e2ebc43b5e71c3, les retours chariot d'un collage ôtés) — un autre corps l'arrête plutôt que d'être
-- écrasé.
--
-- Après lui : regularisationDesCotisations.sql (qui se dit alors en attente), cotisationPersonnelle.sql,
-- cotisationRapprochee.sql, validationExercice.sql et rls.sql se rejouent, puis les trois contrôles de l'export.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. La migration doit être en base ══════════
do $garde$
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.cotisations_declarees'::regclass and not a.attisdropped
         and a.attname in ('organisme', 'annee_payee', 'nature', 'part_regularisation')) <> 4 then
    raise exception 'La migration regularisation_des_cotisations n''est pas en base : rien à défaire ici.';
  end if;
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.garder_cotisation_valide()'::regprocedure)
     is distinct from '1b004781ac05f71798e2ebc43b5e71c3' then
    raise exception 'Le gel des échéances n''est plus celui de regularisation_des_cotisations : son corps serait écrasé.';
  end if;
end
$garde$;

-- ══ 1. Le gel compare de nouveau la ligne entière : le corps d'hier, mot pour mot ══════════
create or replace function public.garder_cotisation_valide() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_frontiere date;
  v_date date;
begin
  if tg_op <> 'INSERT' then
    if not exists (select 1 from public.dossiers where id = old.dossier_id) then
      return public.retour_declencheur(tg_op, old, new);
    end if;
    perform pg_advisory_xact_lock_shared(public.cle_validation(old.dossier_id));
    v_frontiere := public.frontiere_validation(old.dossier_id);
    v_date := coalesce((select l.date from public.lignes_bancaires l where l.cotisation_id = old.id),
                       old.paiement_personnel_le, old.echeance);
    if v_frontiere is not null and v_date <= v_frontiere then
      if tg_op = 'DELETE' then
        raise exception '% : cette échéance ne se supprime plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      if to_jsonb(new) is distinct from to_jsonb(old) then
        raise exception '% : cette échéance ne change plus.',
          public.exercice_fige(old.dossier_id, extract(year from v_date)::integer) using errcode = '23514';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));
  v_frontiere := public.frontiere_validation(new.dossier_id);
  if v_frontiere is not null and coalesce(new.paiement_personnel_le, new.echeance) <= v_frontiere
     and not exists (select 1 from public.lignes_bancaires l where l.cotisation_id = new.id) then
    raise exception '% : une échéance ne s''y ajoute plus.',
      public.exercice_fige(new.dossier_id, extract(year from coalesce(new.paiement_personnel_le, new.echeance))::integer)
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ══ 2. Les quatre colonnes, et avec elles leurs contraintes ══════════
alter table public.cotisations_declarees
  drop column part_regularisation,
  drop column organisme,
  drop column annee_payee,
  drop column nature;
