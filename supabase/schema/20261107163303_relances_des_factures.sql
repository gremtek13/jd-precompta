-- LA RELANCE D'UNE FACTURE EN RETARD, JOURNALISÉE (espace client, étape C5 de la ligne 51.5 ; MEG3-Q3, « oui » du
-- cabinet) — PRÉPARÉE, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 06/11/2026 — RELANCER SES CLIENTS (C5) (PRÉPARÉE, PAS
-- APPLIQUÉE) ».
--
-- POURQUOI. « Relancer » envoie un e-mail qui rappelle une facture en retard (`send-email`, le modèle « relance_facture »),
-- sur un clic, plafonné comme les autres envois d'un accès client, et TRACÉ : chaque e-mail laisse une ligne dans
-- `emails_envoyes`, que `send-email` écrit APRÈS l'envoi, sous la clé de service, en citant la facture (`facture_id`).
-- « Relancée le … » s'en DÉDUIT : rien d'autre ne se stocke. Jusqu'ici, la contrainte du type refusait toute ligne
-- « relance_facture » — et un e-mail parti dont la ligne est refusée ne compterait pas dans le plafond.
--
-- CE QU'ELLE POSE, sur `emails_envoyes` seule :
--   1. la contrainte du type admet aussi « relance_facture » — elle REMPLACE celle d'hier dans la même instruction, sous
--      le même nom, et admet tout ce qu'elle admettait ;
--   2. la lecture du client « Ventes » (`emails_envoyes_lecture_ventes`) s'ÉTEND aux lignes « relance_facture » de SES
--      dossiers : une POLICY ÉLARGIE, qui se présente au cabinet avant d'être appliquée (CLAUDE.md, « Trois domaines font
--      exception ») — sans elle, le client relancerait sans jamais lire qu'il l'a fait. Elle ne s'étend qu'à ce type :
--      jamais la relance de pièces, que le cabinet adresse à son client.
--
-- CE QU'ELLE NE FAIT PAS : aucune colonne, aucune fonction, aucun déclencheur, aucun droit ; aucune donnée d'hier n'est
-- réécrite (la contrainte neuve se vérifie sur les lignes d'hier, toutes « facture », « relance_pieces » ou « devis »).
-- Aucune contrainte n'exige qu'une ligne « relance_facture » cite sa facture : la clé `facture_id` met à NUL à la
-- suppression de la facture, et une telle contrainte ferait échouer la suppression d'un dossier qui en porte (la mise à
-- nul rencontrerait la contrainte) ; `send-email` cite toujours la facture qu'elle relance.
-- CE QUE LE TEXTE RETIRE : la contrainte du type d'hier, dans l'instruction qui la remplace ; aucune ligne. La policy se
-- MODIFIE (`alter policy`), sans être retirée.
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : la migration `envoi_des_devis` (le type « devis ») en base, et
-- celle-ci pas encore.
-- SON RETOUR : supabase/preparees/retour/20261106140100_retour_relances_des_factures.sql, DESTRUCTIF (il efface les
-- lignes « relance_facture » du journal), à coller seulement sur l'accord explicite du cabinet. SON ESSAI :
-- supabase/essais/relancesDesFactures.sql.
-- L'ORDRE DE MISE EN PRODUCTION : cette migration ; puis `send-email`, sa constante `RELANCES_EN_BASE` levée, redéployée ;
-- puis `RELANCES_EXPORTEES` (src/lib/relances.ts) levé, qui offre le bouton.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
                  and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''devis''%') then
    raise exception 'La migration envoi_des_devis n''est pas en base : la contrainte du type n''admet pas encore « devis ».';
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.emails_envoyes'::regclass
              and conname = 'emails_envoyes_type_check' and pg_get_constraintdef(oid) like '%''relance_facture''%') then
    raise exception 'La migration relances_des_factures est déjà en base.';
  end if;
end
$garde$;

-- ══ 1. Le type « relance_facture » ══════════
-- Même nom que la contrainte d'hier : un export, une restauration ou un essai qui la nomment la retrouvent.
alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check check (type in ('facture', 'relance_pieces', 'devis', 'relance_facture'));

-- ══ 2. La lecture du client « Ventes » : ses relances de factures aussi ══════════
alter policy emails_envoyes_lecture_ventes on public.emails_envoyes
  using (public.client_du_dossier(dossier_id, 'ventes') and type in ('facture', 'devis', 'relance_facture'));
