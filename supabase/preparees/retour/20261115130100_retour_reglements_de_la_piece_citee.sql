-- RETOUR DE reglements_de_la_piece_citee (supabase/preparees/20261115130000_reglements_de_la_piece_citee.sql, A8Q5Q3Q2-Q2) :
-- la garde de ce qu'une pièce citée reçoit retirée, et ses trois déclencheurs différés. CE QU'IL DÉTRUIT : la fonction
-- `garder_recu_d_une_piece_citee` et les déclencheurs `lignes_bancaires_recu_d_une_piece_citee`,
-- `reglements_groupes_recu_d_une_piece_citee` et `operations_caisse_recu_d_une_piece_citee` ; AUCUNE DONNÉE : la migration n'en
-- pose aucune. La garde des règlements d'A8-Q5 (la date), la citation et le registre restent ceux de la production. Après
-- lui, un paiement d'avant la reprise rapproché de la pièce citée après des encaissements de son registre passe de
-- nouveau, comme avant le 15/11/2026. `REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS` doit être baissé AVANT (l'écran levé dirait
-- avant le clic un refus que la base ne porterait plus). DESTRUCTIF (des `drop`) : il se colle dans l'éditeur SQL de
-- Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Il ne retire que ce que la migration
-- a posé : la garde de tête vérifie l'empreinte de la fonction et le compte de ses déclencheurs.

do $garde$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_recu_d_une_piece_citee()')) is distinct from '21e47346d882128c78a35912141481c2' then
    raise exception 'retour_reglements_de_la_piece_citee : la garde en base n''est pas celle que la migration pose (ou la migration n''est pas en base) ; relire avant de retirer.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t
       where t.tgname in ('lignes_bancaires_recu_d_une_piece_citee', 'reglements_groupes_recu_d_une_piece_citee',
                          'operations_caisse_recu_d_une_piece_citee') and not t.tgisinternal) <> 3 then
    raise exception 'retour_reglements_de_la_piece_citee : les trois déclencheurs de la migration ne sont pas tous en base ; relire avant de retirer.';
  end if;
end
$garde$;

drop trigger lignes_bancaires_recu_d_une_piece_citee on public.lignes_bancaires;
drop trigger reglements_groupes_recu_d_une_piece_citee on public.reglements_groupes;
drop trigger operations_caisse_recu_d_une_piece_citee on public.operations_caisse;
drop function public.garder_recu_d_une_piece_citee();

do $fin$
begin
  if to_regprocedure('public.garder_recu_d_une_piece_citee()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname like '%recu_d_une_piece_citee' and not t.tgisinternal) then
    raise exception 'retour_reglements_de_la_piece_citee : la garde ou un de ses déclencheurs est encore en base.';
  end if;
end
$fin$;
