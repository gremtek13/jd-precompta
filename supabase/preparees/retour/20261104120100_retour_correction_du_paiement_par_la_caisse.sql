-- LE RETOUR ARRIÈRE DE `correction_du_paiement_par_la_caisse` (C12B-Q1 ; la caisse, ligne 26.6) — À ACCORDER PAR LE CABINET,
-- À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique : il retire un objet. La migration :
-- supabase/preparees/20261104120000_correction_du_paiement_par_la_caisse.sql ; le récit : HISTORIQUE.md, « LA CAISSE :
-- CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- L'ORDRE : D'ABORD l'application, son drapeau baissé (`CORRECTION_DU_PAIEMENT_EXPORTEE`, le fichier de la migration sorti
-- de l'export) et remise en ligne — levé, « Corriger » appellerait une fonction qui n'existerait plus —, PUIS ce texte.
--
-- CE QU'IL RETIRE : la fonction `remplacer_paiement_par_la_caisse`, et avec elle ses droits et son commentaire — rien d'autre :
-- aucune table, colonne, ligne, policy, ni aucun déclencheur ; aucune fonction d'hier à rendre, la migration n'en a changé
-- aucune. Un paiement en espèces faux se corrige de nouveau en deux gestes, « Retirer » puis « Payée en espèces ».
--
-- CE QU'IL NE PERD PAS : les corrections déjà faites restent ce qu'elles sont — un paiement retiré, et le paiement de la même
-- pièce qui le remplace (`remplace_id`), jugés par les gardes de la caisse comme tout geste ; la base les lit comme un retrait
-- suivi d'un paiement, les moteurs ne comptent que le paiement vivant, et une sauvegarde qui les porte se restaure. D'où
-- l'absence de refus sur les données : la garde de tête ne juge que la fonction.
--
-- Ni barre oblique inverse, ni retour chariot. Après lui : la signature d'avant la migration (`signature.sql`), les étapes de
-- la correction EN ATTENTE dans les essais, et les trois contrôles de l'export, le fichier de la migration sorti de l'export.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. La garde de tête ══════════
-- La fonction, une seule de ce nom, à l'empreinte de son corps (les retours chariot d'un collage écartés) : une base où elle
-- a changé depuis ne se défait pas sans être relue ; absente, ce retour est déjà fait.
do $garde$
declare
  v_empreinte text;
begin
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'remplacer_paiement_par_la_caisse') then
    raise exception 'La migration correction_du_paiement_par_la_caisse n''est pas en base (ou ce retour est déjà fait) : rien à défaire.';
  end if;
  select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
   where p.oid = to_regprocedure('public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric)');
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'remplacer_paiement_par_la_caisse') <> 1
     or v_empreinte is distinct from 'ff72f955a6793f7e9b27f2f8c77e763c' then
    raise exception 'La fonction remplacer_paiement_par_la_caisse n''est pas celle que la migration a posée (empreinte attendue ff72f955…) : ce retour arrière ne s''applique pas sans être relu.';
  end if;
end
$garde$;

-- ══ 1. La fonction de la correction ══════════
drop function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric);
