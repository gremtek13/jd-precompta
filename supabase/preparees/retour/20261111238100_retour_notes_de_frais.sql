-- RETOUR DE LA MIGRATION notes_de_frais (étape B7, ligne 51.5 ; supabase/preparees/20261111238000_notes_de_frais.sql).
-- DESTRUCTIF : retire la table des notes de frais (avec leurs lignes : les notes saisies par les clients, leurs passages,
-- les noms des salariés), ses deux gardes — dont celle qui retient la suppression d'une pièce justificative — et ses six
-- fonctions, puis le rôle `personnel` du catalogue des rôles comptables. Rien d'autre : les pièces citées restent, avec leurs
-- fichiers ; les tables, les policies et les gardes d'hier restent tels quels. À accorder par le cabinet, puis à COLLER dans
-- l'éditeur SQL de Supabase, dans une transaction, avec la ligne d'historique que l'outil aurait posée (CLAUDE.md, « Quand
-- apply_migration attend une confirmation qui n'arrive pas ») ; avant, une sauvegarde des dossiers dont un client a saisi
-- une note (le retour les perd). Refusé tant qu'un dossier règle le rôle `personnel` dans son plan. Le drapeau
-- `NOTES_DE_FRAIS_PREVUES` (src/lib/notesDeFrais.ts) se rebaisse AVANT ce retour : une sauvegarde lirait sinon une table
-- absente.
do $garde$
begin
  if to_regclass('public.notes_de_frais') is null
     or not exists (select 1 from public.roles_comptables r where r.role = 'personnel') then
    raise exception 'La migration notes_de_frais n''est pas (entière) en base : rien à retirer.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role = 'personnel') then
    raise exception 'Un dossier règle le rôle « personnel » dans son plan comptable : le lui retirer d''abord (regler_plan_du_dossier), puis ce retour.';
  end if;
end
$garde$;

drop function public.rembourser_note_de_frais(uuid, integer, date, text);
drop function public.refuser_note_de_frais(uuid, integer, text);
drop function public.approuver_note_de_frais(uuid, integer);
drop function public.retirer_note_de_frais(uuid, integer);
drop function public.soumettre_note_de_frais(uuid, integer);
drop function public.enregistrer_note_de_frais(uuid, uuid, integer, date, text, text, numeric, numeric, text, uuid, integer, text, integer, boolean);

drop trigger pieces_justificatif_d_une_note_de_frais on public.pieces;
drop function public.garder_piece_d_une_note_de_frais();
drop table public.notes_de_frais;
drop function public.garder_note_de_frais();

delete from public.roles_comptables where role = 'personnel';
