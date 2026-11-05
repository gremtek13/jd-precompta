-- LE RETOUR ARRIÈRE DE LA MIGRATION `envoi_des_devis` (espace client, étape P6c1) — PRÉPARÉ, À NE COLLER QU'AVEC L'ACCORD
-- EXPLICITE DU CABINET : il DÉTRUIT des données. À coller dans l'éditeur SQL de Supabase, dans une transaction, avec sa
-- ligne d'historique (CLAUDE.md, « Quand `apply_migration` attend une confirmation »). La migration :
-- supabase/schema/20261105070313_envoi_des_devis.sql ; le récit : HISTORIQUE.md, « LES DEVIS : L'ENVOI PAR E-MAIL, EN
-- BASE (P6C1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application — `send-email` ramenée à la version qui n'envoie pas de devis, `ENVOI_DES_DEVIS_PREVU`
-- (src/lib/sauvegarde.ts) rebaissé, `src/lib/types.ts` sans la colonne, le fichier de la migration sorti de
-- supabase/schema/, remise en ligne — sinon une sauvegarde lirait une colonne et une relation qui n'existent plus, et
-- `send-email` écrirait des lignes que la base refuse après l'envoi —, PUIS ce texte. Le retour SANS rien détruire existe :
-- ramener `send-email` seule ; les lignes « devis » déjà écrites restent, lisibles du cabinet et du client « Ventes ».
-- Ce retour vient AVANT celui des devis (20261105100200_retour_devis_du_client.sql) : tant que la colonne `devis_id` est
-- en base, la clé qu'elle porte retient `drop table public.devis`, qui s'arrête sur la dépendance sans rien détruire.
--
-- CE QU'IL DÉTRUIT, sans retour : TOUTES les lignes « devis » du journal des envois (`emails_envoyes`), de tous les
-- dossiers — pour chaque devis envoyé par e-mail, le destinataire, l'objet, l'instant de l'envoi, l'identifiant Resend,
-- qui l'a envoyé et le devis envoyé. Le cabinet ne pourra plus dire, depuis l'application, qui a reçu quel devis et quand ;
-- le journal de Resend le garde selon sa propre durée, hors de l'application. La contrainte du type d'hier ne les admet
-- pas : elles ne peuvent pas rester.
-- CE QU'IL RETIRE, et qu'une nouvelle application de la migration recréerait à l'identique : la colonne `devis_id`, sa
-- clé, son index et son commentaire ; la contrainte qui réserve un devis à l'envoi d'un devis ; et la contrainte du type
-- revient à « facture » et « relance_pieces », sous son nom.
-- CE QU'IL NE TOUCHE PAS : les lignes « facture » et « relance_pieces » ; les devis ; aucune autre table, policy, fonction
-- ni droit.
--
-- Après lui : envoiDesDevis.sql (qui se dit alors en attente), rls.sql, ventesClient.sql et devis.sql se rejouent, puis
-- les trois contrôles de l'export.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. La migration doit être en base ══════════
do $garde$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.emails_envoyes'::regclass and attname = 'devis_id'
                  and not attisdropped) then
    raise exception 'La migration envoi_des_devis n''est pas en base : rien à défaire ici.';
  end if;
end
$garde$;

-- ══ 1. Le devis envoyé : sa contrainte, son index, sa colonne et sa clé ══════════
alter table public.emails_envoyes drop constraint emails_envoyes_un_devis_sur_un_envoi_de_devis;
drop index public.emails_envoyes_devis_id_idx;
alter table public.emails_envoyes drop column devis_id;

-- ══ 2. Les lignes « devis » du journal, puis le type d'hier ══════════
delete from public.emails_envoyes where type = 'devis';
alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check check (type in ('facture', 'relance_pieces'));
