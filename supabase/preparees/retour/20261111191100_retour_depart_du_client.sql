-- RETOUR DE 20261111191000_depart_du_client (INAL5, ligne 44) — À COLLER, et seulement sur l'accord du cabinet : il
-- DÉTRUIT l'historique des paquets téléchargés et celui des conservations (deux tables), en plus de retirer cinq fonctions et
-- neuf déclencheurs (ses six gardes et la porte de trois tables). Ce qu'il rend : la base d'avant la migration — un dossier
-- se supprime de nouveau sans condition de paquet ni de conservation, et un dossier conservé reçoit de nouveau pièces,
-- écritures, accès et validations.
-- Avant de le coller : relever les deux tables (une sauvegarde de chaque dossier qui en porte une ligne les contient), et
-- baisser `DEPART_DU_CLIENT_PREVU` (src/lib/departDuClient.ts) dans le même déploiement.
-- Les policies des deux tables partent avec elles, la restrictive `deux_facteurs` comprise : que la migration l'ait posée
-- (la double authentification exigée déjà en base) ou que `deux_facteurs_exiges`, appliquée après elle, l'ait posée en
-- balayant les tables présentes. La porte de `conservations_des_dossiers` part avec sa table.
--
-- La porte d'accès (acces_avant_les_gardes, ligne 43) que la migration a posée sur `memberships` et `exercices_valides`,
-- pour la garde de la conservation (sa garde de tête exigeait qu'elles ne la portent pas) : elle part EN CLAIR (récrit le
-- 22/11/2026, avec la migration) — retirée dans un bloc `do`, comme le retour du 11/11/2026 le faisait, l'inventaire des
-- fichiers de l'export (supabase/essais/inventaire.py ne lit pas le corps d'un bloc) l'aurait encore comptée. Si une autre
-- garde `security definer` tire AVANT l'écriture sur l'une des deux, derrière cette porte, le retour se refuse (sa garde de
-- tête) : retirer la porte la laisserait répondre avant la policy ; le relire alors contre la base.

do $garde$
begin
  if to_regclass('public.paquets_d_archive_telecharges') is null or to_regclass('public.conservations_des_dossiers') is null then
    raise exception 'retour_depart_du_client : la migration depart_du_client n''est pas en base.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgrelid in ('public.memberships'::regclass, 'public.exercices_valides'::regclass)
         and t.tgname = '_acces_avant_les_gardes') <> 2 then
    raise exception 'retour_depart_du_client : la porte d''accès que la migration a posée sur memberships et exercices_valides n''y est plus : relire la base.';
  end if;
  -- Une garde : un déclencheur de ligne BEFORE (tgtype : 1 la ligne, 2 avant) sur l'insertion ou la mise à jour (4, 16),
  -- d'une fonction `security definer`, hors de la porte et des deux gardes que ce retour retire.
  if exists (select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
              where t.tgrelid in ('public.memberships'::regclass, 'public.exercices_valides'::regclass) and not t.tgisinternal
                and t.tgname not in ('_acces_avant_les_gardes', 'memberships_dossier_conserve', 'exercices_valides_dossier_conserve')
                and t.tgtype & 3 = 3 and t.tgtype & 20 <> 0 and p.prosecdef) then
    raise exception 'retour_depart_du_client : une autre garde security definer tire avant l''écriture sur memberships ou exercices_valides, derrière la porte que la migration a posée : relire le retour contre la base avant de retirer la porte.';
  end if;
end
$garde$;

drop trigger dossiers_depart_du_client on public.dossiers;
drop trigger pieces_dossier_conserve on public.pieces;
drop trigger ecritures_brouillon_dossier_conserve on public.ecritures_brouillon;
drop trigger memberships_dossier_conserve on public.memberships;
drop trigger exercices_valides_dossier_conserve on public.exercices_valides;
drop trigger _acces_avant_les_gardes on public.memberships;
drop trigger _acces_avant_les_gardes on public.exercices_valides;
drop function public.garder_depart_du_dossier();
drop function public.garder_dossier_conserve();
drop function public.lever_la_conservation(uuid);
drop function public.conserver_le_dossier(uuid);
drop table public.conservations_des_dossiers;
drop function public.garder_conservation_du_dossier();
drop function public.enregistrer_paquet_telecharge(uuid, integer, text, text, integer, integer);
drop table public.paquets_d_archive_telecharges;
