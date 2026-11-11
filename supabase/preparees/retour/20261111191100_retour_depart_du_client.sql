-- RETOUR DE 20261111191000_depart_du_client (INAL5, ligne 44) — À COLLER, et seulement sur l'accord du cabinet : il
-- DÉTRUIT l'historique des paquets téléchargés et celui des conservations (deux tables), en plus de retirer cinq fonctions et
-- six déclencheurs. Ce qu'il rend : la base d'avant la migration — un dossier se supprime de nouveau sans condition de
-- paquet ni de conservation, et un dossier conservé reçoit de nouveau pièces, écritures, accès et validations.
-- Avant de le coller : relever les deux tables (une sauvegarde de chaque dossier qui en porte une ligne les contient), et
-- baisser `DEPART_DU_CLIENT_PREVU` (src/lib/departDuClient.ts) dans le même déploiement.

do $garde$
begin
  if to_regclass('public.paquets_d_archive_telecharges') is null or to_regclass('public.conservations_des_dossiers') is null then
    raise exception 'retour_depart_du_client : la migration depart_du_client n''est pas en base.';
  end if;
end
$garde$;

drop trigger dossiers_depart_du_client on public.dossiers;
drop trigger pieces_dossier_conserve on public.pieces;
drop trigger ecritures_brouillon_dossier_conserve on public.ecritures_brouillon;
drop trigger memberships_dossier_conserve on public.memberships;
drop trigger exercices_valides_dossier_conserve on public.exercices_valides;
drop function public.garder_depart_du_dossier();
drop function public.garder_dossier_conserve();
drop function public.lever_la_conservation(uuid);
drop function public.conserver_le_dossier(uuid);
drop table public.conservations_des_dossiers;
drop function public.garder_conservation_du_dossier();
drop function public.enregistrer_paquet_telecharge(uuid, integer, text, text, integer, integer);
drop table public.paquets_d_archive_telecharges;
