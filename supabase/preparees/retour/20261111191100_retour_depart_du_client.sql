-- RETOUR DE 20261111191000_depart_du_client (INAL5, ligne 44) — À COLLER, et seulement sur l'accord du cabinet : il
-- DÉTRUIT l'historique des paquets téléchargés et celui des conservations (deux tables), en plus de retirer cinq fonctions et
-- six déclencheurs. Ce qu'il rend : la base d'avant la migration — un dossier se supprime de nouveau sans condition de
-- paquet ni de conservation, et un dossier conservé reçoit de nouveau pièces, écritures, accès et validations.
-- Avant de le coller : relever les deux tables (une sauvegarde de chaque dossier qui en porte une ligne les contient), et
-- baisser `DEPART_DU_CLIENT_PREVU` (src/lib/departDuClient.ts) dans le même déploiement.
-- Les policies des deux tables partent avec elles, la restrictive `deux_facteurs` comprise : que la migration l'ait posée
-- (la double authentification exigée déjà en base) ou que `deux_facteurs_exiges`, appliquée après elle, l'ait posée en
-- balayant les tables présentes.

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
-- La porte d'accès (acces_avant_les_gardes, ligne 43), que la migration ou la porte a posée sur `memberships` et
-- `exercices_valides` pour la garde de la conservation : elle part avec elle, sauf si une autre garde `security definer`
-- y tire encore (la base d'avant la migration, que la porte ait précédé ou suivi INAL5).
do $porte$
declare
  v_table text;
begin
  foreach v_table in array array['memberships', 'exercices_valides'] loop
    if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = ('public.' || v_table)::regclass and t.tgname = '_acces_avant_les_gardes')
       and not exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
                        where t.tgrelid = ('public.' || v_table)::regclass and not t.tgisinternal and t.tgname <> '_acces_avant_les_gardes'
                          and t.tgtype & 3 = 3 and t.tgtype & 20 <> 0 and p.prosecdef) then
      execute format('drop trigger _acces_avant_les_gardes on public.%I', v_table);
    end if;
  end loop;
end
$porte$;
drop function public.garder_depart_du_dossier();
drop function public.garder_dossier_conserve();
drop function public.lever_la_conservation(uuid);
drop function public.conserver_le_dossier(uuid);
drop table public.conservations_des_dossiers;
drop function public.garder_conservation_du_dossier();
drop function public.enregistrer_paquet_telecharge(uuid, integer, text, text, integer, integer);
drop table public.paquets_d_archive_telecharges;
