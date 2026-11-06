-- LE RETOUR ARRIÈRE DE LA MIGRATION `relances_des_factures` (espace client, étape C5 de la ligne 51.5) — PRÉPARÉ, À NE
-- COLLER QU'AVEC L'ACCORD EXPLICITE DU CABINET : il DÉTRUIT des données. À coller dans l'éditeur SQL de Supabase, dans une
-- transaction, avec sa ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une confirmation »). La migration :
-- supabase/preparees/20261106140000_relances_des_factures.sql (puis supabase/schema/, le jour de son application).
--
-- L'ORDRE : D'ABORD l'application — `RELANCES_EXPORTEES` rebaissé (src/lib/relances.ts) et mis en ligne, `send-email`
-- redéployée sa constante `RELANCES_EN_BASE` baissée —, sinon `send-email` enverrait des relances dont la base refuserait
-- la ligne APRÈS l'envoi (hors du plafond d'un accès client), PUIS ce texte. Le retour SANS rien détruire existe : les
-- deux gestes d'application seuls ; les lignes « relance_facture » déjà écrites restent, lisibles du cabinet et du client
-- « Ventes ».
--
-- CE QU'IL DÉTRUIT, sans retour : TOUTES les lignes « relance_facture » du journal des envois (`emails_envoyes`), de tous
-- les dossiers — pour chaque relance, le destinataire, l'objet, l'instant de l'envoi, l'identifiant Resend, qui l'a
-- envoyée et la facture relancée. « Relancée le … » ne se dira plus de ces factures ; le journal de Resend garde ces
-- envois selon sa propre durée, hors de l'application. La contrainte du type d'hier ne les admet pas : elles ne peuvent
-- pas rester.
-- CE QU'IL REMET : la contrainte du type à « facture », « relance_pieces » et « devis », sous son nom ; la lecture du
-- client « Ventes » aux seules lignes « facture » et « devis ».
-- CE QU'IL NE TOUCHE PAS : les autres lignes du journal ; aucune autre table, policy, fonction ni droit.
--
-- Après lui : relancesDesFactures.sql (qui se dit alors en attente), envoiDesDevis.sql et rls.sql se rejouent, puis les
-- trois contrôles de l'export.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. La migration doit être en base ══════════
do $garde$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
                  and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''relance_facture''%') then
    raise exception 'La migration relances_des_factures n''est pas en base : rien à défaire ici.';
  end if;
end
$garde$;

-- ══ 1. La lecture du client « Ventes » d'hier ══════════
alter policy emails_envoyes_lecture_ventes on public.emails_envoyes
  using (public.client_du_dossier(dossier_id, 'ventes') and type in ('facture', 'devis'));

-- ══ 2. Les lignes « relance_facture » du journal, puis le type d'hier ══════════
delete from public.emails_envoyes where type = 'relance_facture';
alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check check (type in ('facture', 'relance_pieces', 'devis'));
