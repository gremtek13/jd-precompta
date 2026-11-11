-- RETOUR DE LA MIGRATION achats_du_client (étape B4, ligne 51.5 ; supabase/preparees/20261111237000_achats_du_client.sql).
-- DESTRUCTIF : retire les deux tables (les paiements déclarés par les clients et les pièces vues, avec leurs lignes), les
-- trois colonnes de `pieces` (les échéances lues ou fixées, et qui les a fixées), leurs gardes et leurs quatre fonctions.
-- Rien d'autre : les tables, les policies et les gardes d'hier restent tels quels. À accorder par le cabinet, puis à COLLER
-- dans l'éditeur SQL de Supabase, dans une transaction, avec la ligne d'historique que l'outil aurait posée (CLAUDE.md,
-- « Quand apply_migration attend une confirmation qui n'arrive pas ») ; avant, une sauvegarde des dossiers dont un client
-- a déclaré un paiement ou dont une pièce porte une échéance (le retour les perd). Le drapeau `ACHATS_DU_CLIENT_PREVUS`
-- (src/lib/achatsClient.ts) se rebaisse AVANT ce retour : une sauvegarde lirait sinon des tables absentes.
do $garde$
begin
  if to_regclass('public.paiements_declares') is null or to_regclass('public.pieces_vues') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.pieces'::regclass and a.attname = 'date_echeance'
                     and not a.attisdropped) then
    raise exception 'La migration achats_du_client n''est pas (entière) en base : rien à retirer.';
  end if;
end
$garde$;

drop function public.marquer_vues(uuid, uuid[]);
drop function public.retirer_paiement_declare(uuid);
drop function public.declarer_paiement_piece(uuid, date, text, numeric);
drop function public.fixer_echeance_piece(uuid, date, date);

drop table public.pieces_vues;
drop table public.paiements_declares;
drop function public.garder_piece_vue();
drop function public.garder_paiement_declare();

drop trigger pieces_echeance_gardee on public.pieces;
drop function public.garder_echeance_piece();
alter table public.pieces
  drop constraint pieces_echeance_fixee,
  drop column echeance_fixee_le,
  drop column echeance_fixee_par,
  drop column date_echeance;
