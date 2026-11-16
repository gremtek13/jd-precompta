-- A8Q5Q3Q2-Q3 — LA PIÈCE CITÉE RÉGLÉE À L'ÉCART D'ALIGNEMENT PRÈS : LE PLANCHER PREND LA PIÈCE ENTIÈRE (ligne 51.5 ; décision
-- du cabinet du 16/11/2026, « (A) La pièce entière sous le seuil », à la recommandation). PRÉPARÉE le 16/11/2026, PAS
-- APPLIQUÉE. Le récit : HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES
-- APRÈS LA GARDE DES RÈGLEMENTS » ; l'essai : supabase/essais/plancherALEcartDAlignement.sql (EN ATTENTE sans elle) ; le
-- retour : supabase/preparees/retour/20261116141100_retour_plancher_a_l_ecart_d_alignement.sql ; le module qui redit la règle
-- et les refus : src/lib/plancherALEcartDAlignement.ts (`PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU`, baissé jusqu'à l'application).
--
-- SOURCES. CGI, art. 93, 1 (les recettes d'un titulaire de bénéfices non commerciaux se comptent une fois, à leur
-- encaissement) ; CGI, art. 269, 2-c (la TVA d'une prestation de services, exigible à l'encaissement, une fois) ; la règle de
-- la 2035 (src/lib/rattachement.ts, `partsDesPaiements` : une pièce dont les paiements laissent un reste sous l'écart
-- d'alignement est réglée EN ENTIER ; src/lib/alignementBanque.ts, `seuilAlignement` : 2 % du montant, 5 € au plus, décision
-- du cabinet du 23/09/2026) ; A8Q5Q3-Q2 (le registre d'une facture reprise part du plus grand du déclaré et de ce que sa pièce
-- citée a reçu) ; A8Q5Q3Q2-Q2 (la garde des règlements, différée). PostgreSQL 17, « CREATE FUNCTION » (CREATE OR REPLACE garde
-- la fonction, son propriétaire et ses droits) ; « CREATE TRIGGER » (un déclencheur de contrainte se diffère jusqu'à la fin
-- de la transaction).
--
-- LE CAS. Le plancher du registre (`recu_par_la_piece`) était ce que la pièce citée a REÇU. Sous l'écart d'alignement, la 2035
-- tient pourtant la pièce pour réglée en entier : le rapprochement de l'écran réaligne la pièce sur la banque, et les deux
-- coïncident ; mais une pièce non réalignée (une écriture d'alignement qui a échoué, un montant retouché après coup) laissait
-- le registre recevoir l'écart — 118 € reçus d'une pièce de 120 €, que la 2035 compte 120 €, et le registre qui accepte
-- encore 2 € : quelques euros comptés deux fois, au plus l'écart.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `recu_par_la_piece_au_montant(pièce, montant)`, neuve : ce que la 2035 compte d'une pièce à ce montant, en centimes —
--      la somme signée de ses paiements de son dossier, jamais négative (le corps d'hier de `recu_par_la_piece`, au
--      caractère près dans ses trois sources), ou la pièce ENTIÈRE quand cette somme la règle à l'écart d'alignement près :
--      un reçu positif, sous le montant, qui en laisse au plus 2 % et au plus 5 €, en entiers ((pièce − reçu) × 50 ≤ pièce,
--      pièce − reçu ≤ 500 centimes). Payée au-delà de son montant, ou sans paiement, rien ne change. Exécutable par aucun
--      rôle de session, comme `recu_par_la_piece`.
--   2. `recu_par_la_piece` (empreinte cfde7288…, A8Q5Q3-Q2, en production) : ce que la 2035 compte de la pièce à SON montant.
--      Ses quatre lecteurs — `enregistrer_encaissement` (le plancher du registre), `reprise_de_la_facture` (la fenêtre des
--      encaissements le lit avant le clic), `citer_piece_de_facture_reprise` (son 4 bis) et `garder_recu_d_une_piece_citee`
--      (la garde des règlements) — le lisent sans changer : le plancher suit ce que la 2035 a compté.
--   3. `garder_plancher_d_une_piece_citee` et son déclencheur différé `pieces_plancher_d_une_piece_citee`, sur la mise à jour
--      du montant d'une pièce : le plancher dépend désormais du montant, et un montant changé peut le faire MONTER sans
--      qu'aucun paiement ne bouge (120 € reçus d'une pièce de 125 € : rien ; la pièce ramenée à 121 € : 121 €). Quand il
--      monte, que la pièce est citée par une facture reprise dont le registre a déjà des encaissements, le jugement de la
--      garde des règlements, sur l'état où le geste laisse la pièce : refusé à plusieurs taux, ou quand le registre et ce
--      que la 2035 compte dépassent ensemble ce que la facture porte, nette de ses avoirs (23514). Ce qui le fait baisser
--      ou le laisse — le réalignement sur la banque, le montant d'une pièce payée au-delà — ne se refuse jamais. Les mêmes
--      verrous, dans le même ordre : la pièce, puis la facture, puis le lien relu.
--
-- LE RELEVÉ. Le plancher neuf peut révéler un double compte qu'hier cachait : après la pose de la fonction et avant celle de
-- la garde, une pièce citée qui compte déjà, avec le registre de sa facture, la même vente deux fois arrête la migration
-- (relevé de zéro ligne fautive, comme CFCS-Q1) : un tel état se relève et se corrige d'abord.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, aucune colonne, aucune donnée, aucune policy ; ni la garde des règlements
-- (`garder_recu_d_une_piece_citee`, à l'empreinte de son corps, ses cinq déclencheurs), ni la citation, ni le registre, ni
-- leurs mots : leur « ce qu'elle a reçu » se lit désormais au sens de la 2035, qui tient une pièce réglée à l'écart près pour
-- réglée en entier. La règle du cumul de la TVA part toujours du déclaré (A8Q5Q3-Q2). Une pièce payée en devise suit la même
-- règle que la 2035, qui ne distingue pas la devise ici.
--
-- COMMENT ELLE S'APPLIQUE : aucune instruction de retrait ni de vidage, aucune barre oblique inverse — PAR L'OUTIL. APRÈS
-- `reglements_de_la_piece_citee` (A8Q5Q3Q2-Q2), que sa garde de tête exige ; indépendante de
-- `piece_d_un_paiement_dans_son_dossier` et de `especes_du_client_hors_des_reprises` (aucun objet en commun). Le jour de son
-- application, `PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU` se lève et le fichier entre dans supabase/schema/ sous la version que
-- porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- La migration ne se rejoue pas ; la fonction remplacée est celle de la production, à l'empreinte de son corps ; la garde des
-- règlements (A8Q5Q3Q2-Q2), qui lit ce plancher, est en base à l'empreinte du sien, avec ses cinq déclencheurs.
do $garde$
begin
  if to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)') is not null
     or to_regprocedure('public.garder_plancher_d_une_piece_citee()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'pieces_plancher_d_une_piece_citee' and not t.tgisinternal) then
    raise exception 'A8Q5Q3Q2-Q3 : le plancher à l''écart d''alignement est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_recu_d_une_piece_citee()'), to_regprocedure('public.recu_par_la_piece(uuid)')))
     is distinct from 'garder_recu_d_une_piece_citee=8a0d30a6d400d1c578e9fc140e80d692,'
                   || 'recu_par_la_piece=cfde7288618da220dbc1b76ac6630efd' then
    raise exception 'A8Q5Q3Q2-Q3 : recu_par_la_piece n''est plus celle de la production (A8Q5Q3-Q2), ou la garde des règlements (A8Q5Q3Q2-Q2, reglements_de_la_piece_citee) n''est pas en base à son empreinte : relire la migration contre la base avant de l''appliquer.';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t where t.tgname like '%recu_d_une_piece_citee' and not t.tgisinternal) <> 5 then
    raise exception 'A8Q5Q3Q2-Q3 : les cinq déclencheurs différés de la garde des règlements (A8Q5Q3Q2-Q2) ne sont pas en base.';
  end if;
  if to_regclass('public.pieces_des_factures_reprises') is null
     or to_regprocedure('public.montants_par_taux_du_document(uuid)') is null
     or to_regprocedure('public.montants_par_taux_facture(uuid)') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (('pieces', 'montant_ttc'), ('pieces', 'dossier_id'),
                                              ('factures_importees', 'encaisse_avant_reprise'),
                                              ('encaissements_factures', 'retire_le'))) <> 4 then
    raise exception 'A8Q5Q3Q2-Q3 : la pièce d''une facture reprise (A8-Q5), les montants par taux d''un document (A8b) ou une colonne que la garde lit manquent.';
  end if;
end
$garde$;

-- ══ 1. Ce que la 2035 compte d'une pièce, à un montant donné ══════════
create function public.recu_par_la_piece_au_montant(p_piece_id uuid, p_montant_ttc numeric) returns bigint
language sql
stable
set search_path = public
as $$
  -- La somme signée de ses paiements de son dossier, en centimes, jamais négative — un mouvement rapproché d'elle, la part
  -- d'un virement groupé (sur un mouvement rapproché et réglé en groupe), ses paiements par la caisse non retirés —, et la
  -- pièce, en centimes, à ce montant. Un reçu positif, sous le montant, qui en laisse au plus 2 % et au plus 5 € : la 2035
  -- tient la pièce pour réglée en entier, et compte la pièce entière ; sinon, ce reçu.
  select case when x.recu > 0 and x.recu < x.piece and (x.piece - x.recu) * 50 <= x.piece and x.piece - x.recu <= 500
              then x.piece else x.recu end
    from (select greatest((coalesce(sum(y.montant), 0) * 100)::bigint, 0) as recu,
                 (abs(coalesce(p_montant_ttc, 0)) * 100)::bigint as piece
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
                   where o.piece_id = p.id and o.dossier_id = p.dossier_id and o.genre = 'paiement' and o.retire_le is null) y
           where p.id = p_piece_id) x
$$;

comment on function public.recu_par_la_piece_au_montant(uuid, numeric) is
  'Ce que la 2035 compte d''une pièce à ce montant, en centimes (A8Q5Q3Q2-Q3) : la somme signée de ses paiements de son dossier, jamais négative — ou la pièce entière quand cette somme la règle à l''écart d''alignement près (un reçu positif sous le montant, qui en laisse au plus 2 % et 5 €). Lue par recu_par_la_piece (à son montant) et par la garde du montant d''une pièce citée (à l''ancien et au nouveau).';

revoke all on function public.recu_par_la_piece_au_montant(uuid, numeric) from public, anon, authenticated;

-- ══ 2. Le plancher : ce que la 2035 compte de la pièce, à son montant ══════════
-- Celle d'A8Q5Q3-Q2 (en production) : ses trois sources passent dans `recu_par_la_piece_au_montant`, au caractère près.
create or replace function public.recu_par_la_piece(p_piece_id uuid) returns bigint
language sql
stable
set search_path = public
as $$
  -- Ce que la pièce a reçu de son dossier, ou la pièce entière quand ce reçu la règle à l'écart d'alignement près : ce que la
  -- 2035 compte d'elle, à son montant (A8Q5Q3Q2-Q3). Une pièce inconnue : zéro.
  select public.recu_par_la_piece_au_montant(p_piece_id, (select p.montant_ttc from public.pieces p where p.id = p_piece_id))
$$;

comment on function public.recu_par_la_piece(uuid) is
  'Ce que la 2035 compte d''une pièce, en centimes, jamais négatif (A8Q5Q3-Q2, A8Q5Q3Q2-Q3) : la somme signée de ses paiements de son dossier — un mouvement rapproché d''elle, la part d''un virement groupé, ses paiements par la caisse non retirés —, ou la pièce entière quand ils la règlent à l''écart d''alignement près. Le plancher du registre d''une facture reprise qui la cite (enregistrer_encaissement, citer_piece_de_facture_reprise, reprise_de_la_facture, garder_recu_d_une_piece_citee).';

-- ══ 3. Le relevé, sur le plancher neuf ══════════
-- Aucune pièce citée ne compte déjà, avec le registre de sa facture, la même vente deux fois : le jugement de la garde des
-- règlements sur chaque lien actif, ce que la 2035 compte de la pièce à la place de ce qu'elle a reçu.
do $releve$
begin
  if exists (
       select 1
         from public.pieces_des_factures_reprises r
         cross join lateral (
           select public.recu_par_la_piece(r.piece_id) as recu,
                  (select coalesce(sum(fi.encaisse_avant_reprise), 0) from public.factures_importees fi
                    where fi.facture_id = r.facture_id) as avant,
                  (select coalesce(sum(e.montant), 0) from public.encaissements_factures e
                    where e.facture_id = r.facture_id and e.retire_le is null) as deja,
                  (select (f.montant_ttc * 100)::bigint
                          - coalesce((select sum(m.ttc_centimes) from public.factures_emises a
                                       cross join lateral public.montants_par_taux_facture(a.id) m
                                       where a.facture_origine_id = r.facture_id and a.type = 'avoir' and a.statut = 'validee'), 0)::bigint
                          - coalesce((select sum(-a.montant_ttc) * 100 from public.factures_importees ai
                                       join public.factures_emises a on a.id = ai.facture_id
                                       where ai.origine_id = r.facture_id and a.type = 'avoir' and a.statut = 'importee'), 0)::bigint
                     from public.factures_emises f where f.id = r.facture_id) as net,
                  (select count(*) from public.montants_par_taux_du_document(r.facture_id)) as taux) x
        where r.retire_le is null and x.recu > x.avant * 100 and x.deja <> 0
          and (x.taux > 1 or x.deja * 100 + x.recu > x.net)) then
    raise exception 'A8Q5Q3Q2-Q3 : une pièce citée par une facture reprise, réglée à l''écart d''alignement près, compte déjà avec le registre de sa facture la même vente deux fois : la relever et la corriger avant d''appliquer cette migration.';
  end if;
end
$releve$;

-- ══ 4. La garde du montant d'une pièce citée ══════════
create function public.garder_plancher_d_une_piece_citee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_facture uuid;
  v_recu bigint;
  v_avant numeric;
  v_deja numeric;
  v_net bigint;
begin
  -- 1. Le montant a changé (la clause WHEN) : ce que la 2035 compte de la pièce monte-t-il, de l'ancien montant au nouveau,
  --    sur ce qu'elle a reçu à la fin du geste ? Ce qui baisse ou ne bouge pas ne se juge pas.
  if public.recu_par_la_piece_au_montant(new.id, new.montant_ttc)
     <= public.recu_par_la_piece_au_montant(new.id, old.montant_ttc) then
    return null;
  end if;
  -- 2. Les verrous de la garde des règlements, dans son ordre : la pièce en partage, son lien actif, la facture reprise
  --    comme `enregistrer_encaissement` et `citer_piece_de_facture_reprise` la verrouillent, puis le lien relu.
  perform 1 from public.pieces p where p.id = new.id for key share;
  select r.facture_id into v_facture
    from public.pieces_des_factures_reprises r where r.piece_id = new.id and r.retire_le is null;
  if not found then
    return null;
  end if;
  perform 1 from public.factures_emises f where f.id = v_facture for no key update;
  if not exists (select 1 from public.pieces_des_factures_reprises r
                  where r.piece_id = new.id and r.facture_id = v_facture and r.retire_le is null) then
    return null;
  end if;
  -- 3. Le jugement de la garde des règlements (le 4 bis de la citation), sur ce que la 2035 compte de la pièce à la fin du
  --    geste.
  v_recu := public.recu_par_la_piece(new.id);
  select coalesce(sum(fi.encaisse_avant_reprise), 0) into v_avant
    from public.factures_importees fi where fi.facture_id = v_facture;
  select coalesce(sum(e.montant), 0) into v_deja
    from public.encaissements_factures e where e.facture_id = v_facture and e.retire_le is null;
  if v_recu > v_avant * 100 and v_deja <> 0 then
    if (select count(*) from public.montants_par_taux_du_document(v_facture)) > 1 then
      raise exception 'Cette pièce est l''original d''une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d''avant la reprise la règlent à l''écart d''alignement près, la 2035 la compte entière, et le registre ne saurait plus sur quels taux elle a porté. Le cabinet retire d''abord ces encaissements, ou garde le montant de la pièce.'
        using errcode = '23514';
    end if;
    select (f.montant_ttc * 100)::bigint
           - coalesce((select sum(m.ttc_centimes) from public.factures_emises a
                        cross join lateral public.montants_par_taux_facture(a.id) m
                        where a.facture_origine_id = v_facture and a.type = 'avoir' and a.statut = 'validee'), 0)::bigint
           - coalesce((select sum(-a.montant_ttc) * 100 from public.factures_importees ai
                        join public.factures_emises a on a.id = ai.facture_id
                        where ai.origine_id = v_facture and a.type = 'avoir' and a.statut = 'importee'), 0)::bigint
      into v_net from public.factures_emises f where f.id = v_facture;
    if v_deja * 100 + v_recu > v_net then
      raise exception 'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : à ce montant, ses paiements d''avant la reprise la règlent à l''écart d''alignement près, la 2035 la compte entière, et avec ce registre elle dépasserait ce que la facture porte, nette de ses avoirs : la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou garde le montant de la pièce.'
        using errcode = '23514';
    end if;
  end if;
  return null;
end
$$;

comment on function public.garder_plancher_d_une_piece_citee() is
  'A8Q5Q3Q2-Q3 : différée jusqu''à la fin de la transaction, sur la mise à jour du montant d''une pièce. Quand le montant fait monter ce que la 2035 compte de la pièce (recu_par_la_piece_au_montant, de l''ancien au nouveau) et que la pièce est citée par une facture reprise dont le registre a déjà des encaissements : refusé à plusieurs taux, ou quand le registre et ce que la 2035 compte dépassent ensemble ce que la facture porte, nette de ses avoirs (23514). Ce qui le fait baisser ne se refuse jamais.';

revoke all on function public.garder_plancher_d_une_piece_citee() from public, anon, authenticated, service_role;

create constraint trigger pieces_plancher_d_une_piece_citee
  after update of montant_ttc on public.pieces
  deferrable initially deferred
  for each row when (old.montant_ttc is distinct from new.montant_ttc)
  execute function public.garder_plancher_d_une_piece_citee();

-- ══ 5. La garde de fin : les trois corps, leurs droits, le déclencheur ══════════
do $fin$
begin
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.garder_plancher_d_une_piece_citee()'),
                       to_regprocedure('public.recu_par_la_piece(uuid)'),
                       to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)')))
     is distinct from 'garder_plancher_d_une_piece_citee=b0260d769d3c354047091a9c2935a038,'
                   || 'recu_par_la_piece=e0f6c829101eecb5e45c7001246a533e,'
                   || 'recu_par_la_piece_au_montant=6fbb25a5e95fe3a18a23831403e330f5' then
    raise exception 'A8Q5Q3Q2-Q3 : un corps n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  if (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_plancher_d_une_piece_citee()'))
     or (select p.prosecdef or p.provolatile <> 's' or p.proconfig is distinct from array['search_path=public']
           from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)'))
     or (select p.prosecdef or p.provolatile <> 's' or p.proconfig is distinct from array['search_path=public']
           from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.recu_par_la_piece(uuid)'))
     or has_function_privilege('anon', 'public.garder_plancher_d_une_piece_citee()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_plancher_d_une_piece_citee()', 'execute')
     or has_function_privilege('service_role', 'public.garder_plancher_d_une_piece_citee()', 'execute')
     or has_function_privilege('anon', 'public.recu_par_la_piece_au_montant(uuid, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.recu_par_la_piece_au_montant(uuid, numeric)', 'execute')
     or has_function_privilege('anon', 'public.recu_par_la_piece(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.recu_par_la_piece(uuid)', 'execute') then
    raise exception 'A8Q5Q3Q2-Q3 : les propriétés ou les droits d''exécution ne sont pas ceux que cette migration attend : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t
       where t.tgfoid = to_regprocedure('public.garder_plancher_d_une_piece_citee()') and not t.tgisinternal)
     is distinct from 'CREATE CONSTRAINT TRIGGER pieces_plancher_d_une_piece_citee AFTER UPDATE OF montant_ttc ON public.pieces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((old.montant_ttc IS DISTINCT FROM new.montant_ttc)) EXECUTE FUNCTION garder_plancher_d_une_piece_citee() O' then
    raise exception 'A8Q5Q3Q2-Q3 : le déclencheur différé n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
end
$fin$;
