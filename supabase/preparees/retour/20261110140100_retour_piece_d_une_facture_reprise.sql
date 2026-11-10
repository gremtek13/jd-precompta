-- LE RETOUR DE « LA PIÈCE D'UNE FACTURE REPRISE » (supabase/schema/20261110143243_piece_d_une_facture_reprise.sql, A8-Q5,
-- en production depuis le 10/11/2026), PRÉPARÉ le 10/11/2026. Il retire ce que la migration a posé — les six déclencheurs, les cinq fonctions, la table des liens et ses
-- policies — et rend la base d'avant, à la signature près (éprouvé sur la réplique : supabase/essais/signature.sql égal à
-- celle d'avant la migration). DESTRUCTIF : il supprime une table et des fonctions ; il se présente au cabinet et se colle
-- (l'outil retient ses `drop`). Il se REFUSE tant qu'une ligne vit dans la table des liens, active ou retirée : il
-- effacerait le lien d'une facture reprise à sa pièce, et la trace de qui l'a cité ou retiré. Sans le lien, la pièce se
-- rapproche de nouveau après la reprise : ses règlements d'après pourraient se compter deux fois, par elle et par le
-- registre de sa facture reprise.

do $garde$
begin
  if to_regclass('public.pieces_des_factures_reprises') is null then
    raise exception 'La pièce d''une facture reprise n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.pieces_des_factures_reprises) then
    raise exception 'Une facture reprise cite, ou a cité, une pièce : le retour effacerait ces liens et leur trace. Le présenter au cabinet d''abord.';
  end if;
end
$garde$;

drop trigger pieces_cite_par_une_facture_reprise on public.pieces;
drop trigger ecritures_brouillon_piece_d_une_facture_reprise on public.ecritures_brouillon;
drop trigger operations_caisse_piece_d_une_facture_reprise on public.operations_caisse;
drop trigger reglements_groupes_piece_d_une_facture_reprise on public.reglements_groupes;
drop trigger lignes_bancaires_piece_d_une_facture_reprise on public.lignes_bancaires;
drop function public.garder_piece_d_une_facture_reprise();
drop function public.garder_reglement_d_une_piece_reprise();
drop function public.retirer_piece_de_facture_reprise(uuid, uuid);
drop function public.citer_piece_de_facture_reprise(uuid, uuid, uuid);
drop table public.pieces_des_factures_reprises;
drop function public.garder_pieces_des_factures_reprises();
