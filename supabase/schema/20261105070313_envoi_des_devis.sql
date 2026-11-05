-- L'ENVOI D'UN DEVIS PAR E-MAIL, JOURNALISÉ (espace client, étape P6c1) — PRÉPARÉE, PAS APPLIQUÉE. Le récit : HISTORIQUE.md,
-- « LES DEVIS : L'ENVOI PAR E-MAIL, EN BASE (P6C1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- POURQUOI. Un cabinet doit toujours retrouver qui a reçu quoi, et quand : chaque e-mail que l'application envoie laisse
-- une ligne dans `emails_envoyes` (migration 20260909111344_envoi_emails_clients), que l'Edge Function `send-email` écrit
-- APRÈS l'envoi, sous la clé de service. Le devis s'enverra comme la facture (un lot suivant apprend le type « devis » à
-- `send-email`) : son envoi doit pouvoir s'y journaliser, et nommer le devis envoyé, comme une ligne « facture » nomme sa
-- facture. La lecture du client « Ventes » attendait déjà ces lignes : la policy `emails_envoyes_lecture_ventes` lit
-- `type in ('facture', 'devis')` ; jusqu'ici, la contrainte du type refusait toute ligne « devis ».
--
-- CE QU'ELLE POSE, sur `emails_envoyes` seule :
--   1. la contrainte du type admet aussi « devis » — elle REMPLACE celle d'hier dans la même instruction, sous le même
--      nom, et admet tout ce qu'elle admettait ;
--   2. la colonne `devis_id`, qui nomme le devis envoyé : sa clé vers `devis` met à NUL à la suppression du devis, sans
--      cascade — le journal d'un envoi survit à ce qu'il a envoyé, comme `facture_id` survit à sa facture (un brouillon
--      supprimé, et demain un devis refusé ou expiré effacé après trois ans, étape P5c) ;
--   3. une contrainte qui refuse un devis cité par une ligne qui n'est pas l'envoi d'un devis, DANS CE SENS SEULEMENT :
--      une ligne « devis » sans devis reste admise, parce que la mise à nul d'une suppression la laisse ainsi — la
--      contrainte inverse ferait échouer la suppression du devis qu'elle cite ;
--   4. l'index de la clé : la mise à nul cherche les lignes d'un devis supprimé, et la lecture d'un devis ses envois.
--
-- CE QU'ELLE NE FAIT PAS : aucune policy n'est touchée (la lecture du client « Ventes » était écrite pour les devis ; le
-- client ne lit une ligne « devis » que de SES dossiers, s'il porte « Ventes », comme une ligne « facture ») ; aucune
-- fonction, aucun déclencheur, aucun droit ; aucune donnée d'hier n'est réécrite — les deux contraintes neuves se
-- vérifient sur les lignes d'hier, toutes « facture » ou « relance_pieces », sans devis. Ni écran ni Edge Function.
-- CE QUE LE TEXTE RETIRE : la contrainte du type d'hier, un `drop constraint` dans la même instruction que celle qui la
-- remplace ; aucune donnée. Le détecteur d'`apply_migration` n'a retenu ni un `drop constraint` ni un `drop not null` le
-- 13/10/2026 (HISTORIQUE.md, « UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL SE DIT AU CABINET ») ; aucun retrait de
-- ligne n'y paraît, et le mot anglais du retrait ne s'y lit que dans la clause `on … set null` de la clé, de la forme des
-- clauses `on … cascade` des devis, que le détecteur a laissées passer (mesuré le 10/10/2026).
-- CE QU'ELLE SUPPOSE, que son premier bloc vérifie : la migration des devis (`devis_du_client`, la table `devis`), et que
-- celle-ci ne soit pas déjà en base.
-- SON RETOUR : supabase/preparees/retour/20261105100300_retour_envoi_des_devis.sql, DESTRUCTIF (il efface les lignes
-- « devis » du journal), à coller seulement sur l'accord explicite du cabinet. SON ESSAI : supabase/essais/envoiDesDevis.sql
-- (et le bloc 3bis de rls.sql, pour la lecture du client). LE PLAN DE SAUVEGARDE : la relation est déclarée derrière
-- `ENVOI_DES_DEVIS_PREVU` (src/lib/sauvegarde.ts), à lever le jour où l'export porte ce fichier ; `src/lib/types.ts` reçoit
-- la colonne le même jour.
--
-- Ni barre oblique inverse, ni retour chariot. VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne
-- d'historique.

-- ══ 0. Ce qu'elle suppose ══════════
do $garde$
begin
  if to_regclass('public.devis') is null then
    raise exception 'La migration devis_du_client n''est pas en base : l''envoi d''un devis n''a rien à citer.';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.emails_envoyes'::regclass and attname = 'devis_id'
              and not attisdropped) then
    raise exception 'La migration envoi_des_devis est déjà en base.';
  end if;
end
$garde$;

-- ══ 1. Le type « devis » ══════════
-- Même nom que la contrainte d'hier : un export, une restauration ou un essai qui la nomment la retrouvent.
alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check check (type in ('facture', 'relance_pieces', 'devis'));

-- ══ 2. Le devis envoyé ══════════
-- À nul, jamais en cascade : le journal d'un envoi ne part qu'avec son dossier.
alter table public.emails_envoyes
  add column devis_id uuid references public.devis (id) on delete set null;

-- ══ 3. Un devis cité, seulement par l'envoi d'un devis ══════════
-- Dans ce sens seulement : la mise à nul d'une suppression laisse une ligne « devis » sans devis, que la contrainte admet.
alter table public.emails_envoyes
  add constraint emails_envoyes_un_devis_sur_un_envoi_de_devis check (devis_id is null or type = 'devis');

-- ══ 4. L'index de la clé ══════════
create index emails_envoyes_devis_id_idx on public.emails_envoyes (devis_id);

comment on column public.emails_envoyes.devis_id is
  'Le devis envoyé, pour une ligne « devis » seulement ; mis à nul si le devis est supprimé : le journal de l''envoi reste.';
