-- LE RETOUR ARRIÈRE DE LA MIGRATION `regularisation_des_cotisations` (ligne 27, TNS-Q2) — PRÉPARÉ, À NE COLLER QU'AVEC
-- L'ACCORD EXPLICITE DU CABINET : il DÉTRUIT des données. À coller dans l'éditeur SQL de Supabase, dans une transaction,
-- avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une confirmation »). La migration :
-- supabase/preparees/20261107170000_regularisation_des_cotisations.sql (puis supabase/schema/, le jour de son application).
--
-- L'ORDRE : D'ABORD l'application — `REGULARISATION_DES_COTISATIONS_EXPORTEE` rebaissé (src/lib/regularisationDesCotisations.ts),
-- `types.ts` remis, et mis en ligne : sinon l'onglet Cotisations écrirait des colonnes absentes et chaque saisie se refuserait —,
-- PUIS ce texte. Le retour SANS rien détruire existe : le drapeau rebaissé seul ; les trois colonnes restent, ce qui y est
-- saisi aussi, que plus rien ne lit ni n'écrit.
--
-- CE QU'IL DÉTRUIT, sans retour : pour CHAQUE échéance de cotisation de tous les dossiers, son organisme, l'année qu'elle paie
-- et sa nature — y compris sur les échéances d'un exercice validé, que le gel protège d'une mise à jour mais pas d'une
-- colonne retirée. La régularisation estimée ne se calculera plus. Une sauvegarde faite avant lui porte ces colonnes : elle
-- ne se restaure plus sur une base qui ne les a pas sans les en retirer d'abord.
-- CE QU'IL REMET : la table telle qu'avant la migration (les quatre contraintes partent avec leurs colonnes).
-- CE QU'IL NE TOUCHE PAS : les montants, les dates, les marqueurs, les paiements, leurs écritures ; aucune autre table,
-- fonction, policy ni droit.
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
         and a.attname in ('organisme', 'annee_payee', 'nature')) <> 3 then
    raise exception 'La migration regularisation_des_cotisations n''est pas en base : rien à défaire ici.';
  end if;
end
$garde$;

-- ══ 1. Les trois colonnes, et avec elles leurs contraintes ══════════
alter table public.cotisations_declarees
  drop column organisme,
  drop column annee_payee,
  drop column nature;
