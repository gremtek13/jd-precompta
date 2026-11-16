-- RETOUR DE piece_d_un_paiement_dans_son_dossier (supabase/preparees/20261116140000_piece_d_un_paiement_dans_son_dossier.sql,
-- A8Q5-Q4) : la garde de la pièce d'un paiement dans son dossier retirée, et ses trois déclencheurs. CE QU'IL DÉTRUIT : la
-- fonction `garder_piece_dans_son_dossier` et les déclencheurs `lignes_bancaires_dans_son_dossier`,
-- `reglements_groupes_dans_son_dossier` et `pieces_reglees_dans_leur_dossier` ; AUCUNE DONNÉE : la migration n'en pose
-- aucune. Après lui, un mouvement du relevé ou une part de virement groupé peut de nouveau citer une pièce d'un autre
-- dossier, comme avant le 16/11/2026 (la fonction du virement groupé et la caisse la tiennent encore dans le leur).
-- `PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE` doit être baissé AVANT. DESTRUCTIF (des `drop`) : il se colle dans
-- l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Il ne retire que ce
-- que la migration a posé : la garde de tête vérifie l'empreinte de la fonction et ses trois déclencheurs.

do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_piece_dans_son_dossier()')) is distinct from '0bcb5bae44df374dbbaf1f78128b6752' then
    raise exception 'retour_piece_d_un_paiement_dans_son_dossier : la garde en base n''est pas celle que la migration pose (ou la migration n''est pas en base) ; relire avant de retirer.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_piece_dans_son_dossier()') and not t.tgisinternal
         and t.tgname in ('lignes_bancaires_dans_son_dossier', 'reglements_groupes_dans_son_dossier',
                          'pieces_reglees_dans_leur_dossier')) <> 3 then
    raise exception 'retour_piece_d_un_paiement_dans_son_dossier : les trois déclencheurs de la migration ne sont pas tous en base ; relire avant de retirer.';
  end if;
end
$garde$;

drop trigger lignes_bancaires_dans_son_dossier on public.lignes_bancaires;
drop trigger reglements_groupes_dans_son_dossier on public.reglements_groupes;
drop trigger pieces_reglees_dans_leur_dossier on public.pieces;
drop function public.garder_piece_dans_son_dossier();

do $fin$
begin
  if to_regprocedure('public.garder_piece_dans_son_dossier()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t
                 where t.tgname in ('lignes_bancaires_dans_son_dossier', 'reglements_groupes_dans_son_dossier',
                                    'pieces_reglees_dans_leur_dossier') and not t.tgisinternal) then
    raise exception 'retour_piece_d_un_paiement_dans_son_dossier : la garde ou un de ses déclencheurs est encore en base.';
  end if;
end
$fin$;
