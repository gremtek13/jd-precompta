-- RETOUR DE LM8 (`depot_des_honoraires`, 20261111230000) : rend la base d'avant, `signature.sql` égale à celle d'avant la
-- migration (neuf familles). À COLLER (il supprime une table, ses fonctions et sa garde), AVANT le retour de LM7, dont la
-- table `honoraires_factures` est lue par le contrôle d'ici.
--
-- CE QU'IL DÉTRUIT : la table `honoraires_deposes`, c'est-à-dire la trace de chaque dépôt — quelle facture d'honoraires a
-- été déposée chez quel client, quand, par qui, sous quelle empreinte. Les PIÈCES déposées restent dans les dossiers des
-- clients, avec leurs fichiers : ce sont des pièces d'achat comme les autres, et rien ne les retire ; seul le lien à la
-- facture d'origine se perd (et « Mes pièces » ne dit plus qu'elles viennent du cabinet). Il se refuse donc tant qu'un
-- dépôt existe : le cabinet décide d'abord de ce qu'il en garde (une sauvegarde du dossier du cabinet les porte).
do $garde$
begin
  if to_regclass('public.honoraires_deposes') is null then
    raise exception 'Le dépôt des honoraires n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.honoraires_deposes) then
    raise exception 'Des factures d''honoraires ont été déposées chez des clients : le retour perdrait leur lien à la facture d''origine. Sauvegarder le dossier du cabinet et décider d''abord.';
  end if;
end
$garde$;

drop function public.honoraires_deposes_au_dossier(uuid);
drop function public.depots_des_honoraires(uuid);
drop function public.deposer_honoraires_chez_le_client(uuid, uuid, text, text);
drop table public.honoraires_deposes;
drop function public.garder_honoraires_deposes();
drop function public.client_de_la_facture_d_honoraires(uuid);
