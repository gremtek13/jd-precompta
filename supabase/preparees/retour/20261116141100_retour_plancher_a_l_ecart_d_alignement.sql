-- RETOUR DE plancher_a_l_ecart_d_alignement (supabase/preparees/20261116141000_plancher_a_l_ecart_d_alignement.sql,
-- A8Q5Q3Q2-Q3) : le plancher redevient ce que la pièce citée a reçu. CE QU'IL DÉTRUIT : la fonction
-- `recu_par_la_piece_au_montant`, la garde `garder_plancher_d_une_piece_citee` et son déclencheur
-- `pieces_plancher_d_une_piece_citee` ; il rend à `recu_par_la_piece` le corps de la production d'avant (A8Q5Q3-Q2, empreinte
-- cfde7288…, au caractère près) et son commentaire. AUCUNE DONNÉE : la migration n'en pose aucune. Après lui, le registre d'une
-- facture reprise dont la pièce citée est réglée à l'écart d'alignement près, sans réalignement, peut de nouveau recevoir
-- l'écart, comme avant le 16/11/2026. `PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU` doit être baissé AVANT. DESTRUCTIF (des
-- `drop`) : il se colle dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du
-- cabinet. Il ne retire que ce que la migration a posé : la garde de tête vérifie l'empreinte des trois corps et le
-- déclencheur. Il s'applique AVANT le retour de `reglements_de_la_piece_citee`, s'il en vient un (la garde de tête de la
-- migration exigeait celle-ci).

do $garde$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_plancher_d_une_piece_citee()'),
                       to_regprocedure('public.recu_par_la_piece(uuid)'),
                       to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)')))
     is distinct from 'garder_plancher_d_une_piece_citee=b0260d769d3c354047091a9c2935a038,'
                   || 'recu_par_la_piece=e0f6c829101eecb5e45c7001246a533e,'
                   || 'recu_par_la_piece_au_montant=6fbb25a5e95fe3a18a23831403e330f5' then
    raise exception 'retour_plancher_a_l_ecart_d_alignement : les fonctions en base ne sont pas celles que la migration pose (ou la migration n''est pas en base) ; relire avant de retirer.';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger t
                  where t.tgname = 'pieces_plancher_d_une_piece_citee' and not t.tgisinternal
                    and t.tgfoid = to_regprocedure('public.garder_plancher_d_une_piece_citee()')) then
    raise exception 'retour_plancher_a_l_ecart_d_alignement : le déclencheur de la migration n''est pas en base ; relire avant de retirer.';
  end if;
end
$garde$;

drop trigger pieces_plancher_d_une_piece_citee on public.pieces;
drop function public.garder_plancher_d_une_piece_citee();

-- Le corps d'A8Q5Q3-Q2 (supabase/schema/20261115075201_recu_par_la_piece_citee.sql), au caractère près, avant de retirer la
-- fonction qu'il ne lit plus.
create or replace function public.recu_par_la_piece(p_piece_id uuid) returns bigint
language sql
stable
set search_path = public
as $$
  -- La somme signée de ses paiements, en centimes, jamais négative : un mouvement rapproché d'elle, la part d'un virement
  -- groupé (sur un mouvement rapproché et réglé en groupe), ses paiements par la caisse non retirés — de son dossier.
  select greatest((coalesce(sum(x.montant), 0) * 100)::bigint, 0)
    from public.pieces p
    cross join lateral (
          select l.montant from public.lignes_bancaires l
           where l.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee'
          union all
          select g.montant from public.reglements_groupes g
            join public.lignes_bancaires l on l.id = g.ligne_bancaire_id
           where g.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee' and l.reglement_groupe
          union all
          select o.montant from public.operations_caisse o
           where o.piece_id = p.id and o.dossier_id = p.dossier_id and o.genre = 'paiement' and o.retire_le is null) x
   where p.id = p_piece_id
$$;

comment on function public.recu_par_la_piece(uuid) is
  'Ce qu''une pièce a reçu, en centimes, jamais négatif (A8Q5Q3-Q2) : la somme signée de ses paiements de son dossier — un mouvement rapproché d''elle, la part d''un virement groupé, ses paiements par la caisse non retirés —, ceux que la 2035 compte. Le plancher du registre d''une facture reprise qui la cite (enregistrer_encaissement, citer_piece_de_facture_reprise, reprise_de_la_facture).';

drop function public.recu_par_la_piece_au_montant(uuid, numeric);

do $fin$
begin
  if to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)') is not null
     or to_regprocedure('public.garder_plancher_d_une_piece_citee()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'pieces_plancher_d_une_piece_citee' and not t.tgisinternal)
     or (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.recu_par_la_piece(uuid)')) is distinct from 'cfde7288618da220dbc1b76ac6630efd' then
    raise exception 'retour_plancher_a_l_ecart_d_alignement : un objet de la migration est encore en base, ou recu_par_la_piece n''a pas retrouvé le corps d''A8Q5Q3-Q2.';
  end if;
end
$fin$;
