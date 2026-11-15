-- A8Q5Q3Q2-Q2 — UN PAIEMENT D'AVANT LA REPRISE RAPPROCHÉ APRÈS LE REGISTRE (ligne 51.5 ; décision du cabinet du 15/11/2026,
-- « Le refuser dans la garde », à la recommandation). PRÉPARÉE le 15/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md,
-- « 15/11/2026 — A8Q5Q3Q2-Q2 : LA GARDE DES RÈGLEMENTS JUGE CE QUE LA PIÈCE CITÉE A REÇU (PRÉPARÉE, PAS APPLIQUÉE) » ;
-- l'essai : supabase/essais/reglementsDeLaPieceCitee.sql (EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261115130100_retour_reglements_de_la_piece_citee.sql ; le module qui redit ses refus avant le
-- clic : src/lib/reglementsDeLaPieceCitee.ts (`REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS`, baissé jusqu'à l'application).
--
-- SOURCES. CGI, art. 93, 1 (les recettes d'un titulaire de bénéfices non commerciaux se comptent une fois, à leur
-- encaissement) ; CGI, art. 269, 2-c (la TVA d'une prestation de services, exigible à l'encaissement, une fois) ; A8-Q5 (la
-- pièce citée par une facture reprise) et A8Q5Q3-Q2 (`recu_par_la_piece_citee`, en production depuis le 15/11/2026 : le
-- registre part du plus grand du déclaré et de ce que la pièce a reçu). PostgreSQL 17, « CREATE TRIGGER » (un déclencheur de
-- contrainte, AFTER et FOR EACH ROW, se diffère jusqu'à la fin de la transaction et voit alors tout ce qu'elle a écrit ;
-- « UPDATE OF » et « WHEN » bornent les évènements qu'il retient) ; « Explicit Locking », 13.3.2 (FOR NO KEY UPDATE se heurte
-- à lui-même ; FOR KEY SHARE se heurte à FOR UPDATE).
--
-- LE CAS. La garde des règlements (`garder_reglement_d_une_piece_reprise`, A8-Q5) refuse un règlement de la pièce citée daté
-- de la reprise ou d'après ; avant, elle le laisse passer — le relevé de décembre importé en janvier. La citation et le
-- registre jugent déjà ce que la pièce a reçu (A8Q5Q3-Q2) ; ce troisième chemin ne le jugeait pas : le registre encaisse
-- 100 € d'une facture reprise de 120 € dont l'import déclare 0 € encaissé avant la reprise, puis un paiement de 50 € du
-- 10 décembre est rapproché de la pièce — la 2035 de l'année d'avant compte 50 €, le registre en compte 100 € après la
-- reprise : 150 € d'une vente de 120 €. Il faut deux erreurs pour y arriver (l'import qui déclare moins que la pièce n'a
-- reçu, puis le rapprochement tardif) ; rien ne les retenait.
--
-- CE QU'ELLE POSE, rien d'autre :
--   1. `garder_recu_d_une_piece_citee`, la garde sœur de celle des règlements : quand un geste fait monter ce qu'une pièce a
--      reçu (`recu_par_la_piece`) — un mouvement rapproché d'elle, la part d'un virement groupé sur un mouvement rapproché et
--      réglé en groupe, un paiement par la caisse —, et que cette pièce est citée par une facture reprise (le lien actif)
--      dont le registre a déjà des encaissements, elle refuse ce que la citation refuserait (son 4 bis, au mot près dans
--      l'esprit) : d'une facture à plusieurs taux, le registre ne saurait plus sur lesquels ce paiement a porté ; à un taux,
--      quand le registre et ce reçu dépassent ensemble ce que la facture porte, nette de ses avoirs, la même vente
--      compterait deux fois. Le registre vide, ou le déclaré qui couvre ce reçu, rien ne change : le prochain encaissement
--      part du plus grand des deux (A8Q5Q3-Q2).
--   2. Trois déclencheurs de contrainte, DIFFÉRÉS jusqu'à la fin de la transaction, sur les trois tables d'où ce reçu se lit
--      — `lignes_bancaires` (l'insertion, ou la mise à jour de la pièce, du statut, du montant, du règlement groupé ou du
--      dossier), `reglements_groupes` (une part positive insérée, ou sa pièce, son mouvement ou son montant changés),
--      `operations_caisse` (un paiement positif inséré ; une opération ne se modifie que pour se retirer, ce qui ne fait
--      rien monter) : la garde juge l'état où le geste laisse la pièce, une fois fini. Une garde à l'écriture de chaque
--      ligne jugerait un état de passage : la correction d'un paiement en espèces (`remplacer_paiement_par_la_caisse`)
--      écrit le nouveau paiement AVANT de retirer l'ancien, et le virement groupé (`regler_pieces_par_mouvement`) marque
--      son mouvement avant d'en remplacer les parts.
--   Ce qui fait baisser ce que la pièce a reçu — un rapprochement défait, un rejet, un paiement retiré — ne se refuse
--   jamais : la garde ne juge que ce qui monte, ligne par ligne (l'image d'avant et celle d'après de la ligne).
--
-- LES VERROUS. Pour chaque pièce dont le reçu monte : la pièce en partage (FOR KEY SHARE), puis son lien actif, puis la
-- facture reprise comme `enregistrer_encaissement` et `citer_piece_de_facture_reprise` la verrouillent (FOR NO KEY UPDATE),
-- puis le lien relu. Un encaissement, une citation et ce règlement se suivent, et le dernier voit les autres : la citation
-- verrouille la pièce (FOR UPDATE) avant de poser son lien, donc tant que ce règlement tient la pièce, le lien n'existe pas
-- encore et la garde ne demande pas la facture ; deux règlements de la même pièce se suivent sur la facture. Aucun
-- ordre inverse : la garde ne tient jamais la facture avant la pièce.
--
-- CE QUE LE CLIENT EN LIT. Le client « Caisse » règle une pièce par la caisse (`regler_piece_par_la_caisse`,
-- `remplacer_paiement_par_la_caisse`) : les deux refus ne portent ni nom de fichier, ni montant, ni numéro de facture, et
-- disent le geste du cabinet, que le client ne fait pas — comme le refus d'`enregistrer_encaissement` qu'A8Q5Q3-Q2 a posé.
--
-- CE QU'ELLE NE CHANGE PAS : aucune table, aucune colonne, aucune donnée, aucune policy, aucune fonction d'hier — ni la
-- garde des règlements (la date d'abord, à l'écriture, ses mots et son rang intacts), ni `recu_par_la_piece`, ni la
-- citation, ni le registre. Les questions voisines restent ouvertes et ne s'aggravent pas : un mouvement d'un autre dossier
-- qui cite la pièce (A8Q5-Q4) ne compte pas dans son reçu, et la garde ne le juge pas non plus ; la pièce réglée sous le
-- seuil sans réalignement (A8Q5Q3Q2-Q3) se juge sur ce qu'elle a reçu, comme le plancher d'A8Q5Q3-Q2. Une écriture du
-- brouillon qui cite la pièce n'est pas un paiement que la 2035 compte : la garde des règlements la juge à sa date, celle-ci
-- ne la juge pas.
--
-- COMMENT ELLE S'APPLIQUE : aucun mot de retrait ni de vidage, aucune barre oblique inverse, aucune fonction remplacée —
-- PAR L'OUTIL. Indépendante des autres migrations préparées : aucune ne touche ces trois tables par un déclencheur de ce
-- nom ni ces fonctions. Le jour de son application, `REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS` se lève et le fichier entre dans
-- supabase/schema/ sous la version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- La migration ne se rejoue pas ; ce que la garde neuve redit est en base, à l'empreinte de son corps : ce que la pièce a
-- reçu (`recu_par_la_piece`), la citation et le registre qui verrouillent la facture (A8Q5Q3-Q2), la garde des règlements
-- qui juge la date (A8-Q5) ; ce qu'elle lit existe.
do $garde$
begin
  if to_regprocedure('public.garder_recu_d_une_piece_citee()') is not null then
    raise exception 'A8Q5Q3Q2-Q2 : garder_recu_d_une_piece_citee est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if (select string_agg(p.proname || '=' || md5(replace(p.prosrc, chr(13), '')), ',' order by p.proname collate "C")
        from pg_catalog.pg_proc p
       where p.oid in (to_regprocedure('public.citer_piece_de_facture_reprise(uuid, uuid, uuid)'),
                       to_regprocedure('public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)'),
                       to_regprocedure('public.garder_reglement_d_une_piece_reprise()'),
                       to_regprocedure('public.recu_par_la_piece(uuid)')))
     is distinct from 'citer_piece_de_facture_reprise=77a922ef4f1ab85dfe523f892debea98,'
                   || 'enregistrer_encaissement=4eac3326dfb077ade4ddade6c2efdbd1,'
                   || 'garder_reglement_d_une_piece_reprise=60d15a7bc182bd7f9422d708e617ddd7,'
                   || 'recu_par_la_piece=cfde7288618da220dbc1b76ac6630efd' then
    raise exception 'A8Q5Q3Q2-Q2 : citer_piece_de_facture_reprise, enregistrer_encaissement, garder_reglement_d_une_piece_reprise ou recu_par_la_piece n''est plus celle de la production (A8-Q5, A8Q5Q3-Q2) : relire la migration contre la base avant de l''appliquer.';
  end if;
  if to_regclass('public.pieces_des_factures_reprises') is null
     or to_regprocedure('public.montants_par_taux_du_document(uuid)') is null
     or to_regprocedure('public.montants_par_taux_facture(uuid)') is null
     or (select count(*) from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (('lignes_bancaires', 'piece_id'), ('lignes_bancaires', 'statut'),
                                              ('lignes_bancaires', 'montant'), ('lignes_bancaires', 'reglement_groupe'),
                                              ('lignes_bancaires', 'dossier_id'), ('reglements_groupes', 'piece_id'),
                                              ('reglements_groupes', 'ligne_bancaire_id'), ('reglements_groupes', 'montant'),
                                              ('operations_caisse', 'piece_id'), ('operations_caisse', 'genre'),
                                              ('operations_caisse', 'retire_le'), ('operations_caisse', 'montant'),
                                              ('encaissements_factures', 'retire_le'),
                                              ('factures_importees', 'encaisse_avant_reprise'))) <> 14 then
    raise exception 'A8Q5Q3Q2-Q2 : la pièce d''une facture reprise (A8-Q5), les montants par taux d''un document (A8b) ou une colonne que la garde lit manquent.';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t
              where t.tgrelid in ('public.lignes_bancaires'::regclass, 'public.reglements_groupes'::regclass,
                                  'public.operations_caisse'::regclass)
                and t.tgname like '%recu_d_une_piece_citee') then
    raise exception 'A8Q5Q3Q2-Q2 : un déclencheur de ce nom existe déjà sur une table des paiements.';
  end if;
  -- Aucune pièce citée n'est déjà dans l'état que la garde refuse (le relevé de zéro ligne fautive, comme CFCS-Q1) : la
  -- garde ne juge que ce qui monte, et un tel état, venu d'avant elle, se relève et se corrige d'abord.
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
    raise exception 'A8Q5Q3Q2-Q2 : une pièce citée par une facture reprise compte déjà, avec le registre de sa facture, la même vente deux fois : la relever et la corriger avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. La garde : ce qu'une pièce citée reçoit ne recompte pas ce que son registre a compté ══════════
create function public.garder_recu_d_une_piece_citee() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pieces uuid[] := '{}';
  v_piece uuid;
  v_dossier uuid;
  v_avant_ligne numeric;
  v_apres_ligne numeric;
  v_facture uuid;
  v_recu bigint;
  v_avant numeric;
  v_deja numeric;
  v_net bigint;
begin
  -- 1. Les pièces dont ce geste fait MONTER ce qu'elles ont reçu, ligne par ligne : ce que la ligne apporte à la pièce
  --    après le geste, plus que ce qu'elle lui apportait avant — les trois sources de `recu_par_la_piece`, de son dossier.
  if tg_table_name = 'operations_caisse' then
    -- L'insertion d'un paiement positif non retiré (la clause WHEN) ; la garde de la table tient sa pièce dans son dossier.
    if exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
      v_pieces := array[new.piece_id];
    end if;
  elsif tg_table_name = 'reglements_groupes' then
    -- Une part compte sur un mouvement rapproché et réglé en groupe, du dossier de sa pièce.
    select coalesce(sum(new.montant), 0) into v_apres_ligne
      from public.lignes_bancaires l join public.pieces p on p.id = new.piece_id
     where l.id = new.ligne_bancaire_id and l.statut = 'rapprochee' and l.reglement_groupe and l.dossier_id = p.dossier_id;
    v_avant_ligne := 0;
    if tg_op = 'UPDATE' and old.piece_id is not distinct from new.piece_id then
      select coalesce(sum(old.montant), 0) into v_avant_ligne
        from public.lignes_bancaires l join public.pieces p on p.id = old.piece_id
       where l.id = old.ligne_bancaire_id and l.statut = 'rapprochee' and l.reglement_groupe and l.dossier_id = p.dossier_id;
    end if;
    if v_apres_ligne > v_avant_ligne then
      v_pieces := array[new.piece_id];
    end if;
  else
    -- `lignes_bancaires`. Un mouvement rapproché d'une pièce compte pour elle, de son dossier.
    if new.piece_id is not null then
      select p.dossier_id into v_dossier from public.pieces p where p.id = new.piece_id;
      v_apres_ligne := case when new.statut = 'rapprochee' and new.dossier_id = v_dossier then new.montant else 0 end;
      v_avant_ligne := case when tg_op = 'UPDATE' and old.piece_id = new.piece_id and old.statut = 'rapprochee'
                                 and old.dossier_id = v_dossier then old.montant else 0 end;
      if v_apres_ligne > v_avant_ligne then
        v_pieces := v_pieces || new.piece_id;
      end if;
    end if;
    -- Marqué réglé en groupe (et rapproché), le mouvement fait compter ses parts positives, chacune pour sa pièce de son
    -- dossier — sauf celles qu'il faisait déjà compter avant le geste.
    if new.reglement_groupe then
      v_pieces := v_pieces || array(
        select g.piece_id
          from public.reglements_groupes g join public.pieces p on p.id = g.piece_id
         where g.ligne_bancaire_id = new.id and g.montant > 0
           and new.statut = 'rapprochee' and new.dossier_id = p.dossier_id
           and not (tg_op = 'UPDATE' and coalesce(old.statut = 'rapprochee' and old.reglement_groupe and old.dossier_id = p.dossier_id, false))
         order by g.piece_id);
    end if;
  end if;

  -- 2. Chaque pièce citée par une facture reprise : son reçu et le registre de la facture ne comptent pas la même vente deux
  --    fois — ce que la citation refuse (son 4 bis), sur l'état où le geste laisse la pièce.
  foreach v_piece in array v_pieces loop
    -- La pièce en partage avant son lien : une citation qui se pose en même temps (elle verrouille la pièce avant de poser
    -- son lien) attend ce règlement et le voit dans ce que la pièce a reçu ; ou ce règlement l'attend, et voit le lien.
    perform 1 from public.pieces p where p.id = v_piece for key share;
    select r.facture_id into v_facture
      from public.pieces_des_factures_reprises r where r.piece_id = v_piece and r.retire_le is null;
    if not found then
      continue;
    end if;
    -- La facture, verrouillée comme `enregistrer_encaissement` et `citer_piece_de_facture_reprise` la verrouillent : un
    -- encaissement, une citation et ce règlement se suivent, et le dernier voit les autres. Puis le lien relu : retiré
    -- entre-temps, il n'y a plus rien à juger.
    perform 1 from public.factures_emises f where f.id = v_facture for no key update;
    if not exists (select 1 from public.pieces_des_factures_reprises r
                    where r.piece_id = v_piece and r.facture_id = v_facture and r.retire_le is null) then
      continue;
    end if;
    v_recu := public.recu_par_la_piece(v_piece);
    select coalesce(sum(fi.encaisse_avant_reprise), 0) into v_avant
      from public.factures_importees fi where fi.facture_id = v_facture;
    select coalesce(sum(e.montant), 0) into v_deja
      from public.encaissements_factures e where e.facture_id = v_facture and e.retire_le is null;
    if v_recu > v_avant * 100 and v_deja <> 0 then
      if (select count(*) from public.montants_par_taux_du_document(v_facture)) > 1 then
        raise exception 'Cette pièce est l''original d''une facture reprise qui porte plusieurs taux de TVA et dont le registre a déjà reçu des encaissements : avec ce paiement, elle aurait reçu avant la reprise plus que l''import n''en déclare encaissé, et le registre ne saurait plus sur lesquels il a porté. Le cabinet retire d''abord ces encaissements, ou reprend l''import en y déclarant, taux par taux, ce que la pièce a reçu.'
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
        raise exception 'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : avec ce paiement, ce qu''elle a reçu avant la reprise et ce registre dépasseraient ensemble ce que la facture porte, nette de ses avoirs, et la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou ce paiement ne règle pas cette pièce.'
          using errcode = '23514';
      end if;
    end if;
  end loop;
  return null;
end
$$;

comment on function public.garder_recu_d_une_piece_citee() is
  'A8Q5Q3Q2-Q2 : la garde sœur de garder_reglement_d_une_piece_reprise, différée jusqu''à la fin de la transaction, sur lignes_bancaires, reglements_groupes et operations_caisse. Quand un geste fait monter ce qu''une pièce a reçu (recu_par_la_piece) et que cette pièce est citée par une facture reprise dont le registre a déjà des encaissements : refusé à plusieurs taux, ou quand le registre et ce reçu dépassent ensemble ce que la facture porte, nette de ses avoirs (23514). Ce qui fait baisser le reçu ne se refuse jamais.';

revoke all on function public.garder_recu_d_une_piece_citee() from public, anon, authenticated, service_role;

-- ══ 2. Les trois déclencheurs, différés : la garde juge le geste une fois fini ══════════
create constraint trigger lignes_bancaires_recu_d_une_piece_citee
  after insert or update of piece_id, statut, montant, reglement_groupe, dossier_id on public.lignes_bancaires
  deferrable initially deferred
  for each row when (new.piece_id is not null or new.reglement_groupe)
  execute function public.garder_recu_d_une_piece_citee();
create constraint trigger reglements_groupes_recu_d_une_piece_citee
  after insert or update of piece_id, ligne_bancaire_id, montant on public.reglements_groupes
  deferrable initially deferred
  for each row when (new.piece_id is not null and new.montant > 0)
  execute function public.garder_recu_d_une_piece_citee();
create constraint trigger operations_caisse_recu_d_une_piece_citee
  after insert on public.operations_caisse
  deferrable initially deferred
  for each row when (new.piece_id is not null and new.genre = 'paiement' and new.retire_le is null and new.montant > 0)
  execute function public.garder_recu_d_une_piece_citee();

-- ══ 3. La garde de fin : le corps posé, ses droits, ses trois déclencheurs ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.garder_recu_d_une_piece_citee()')) is distinct from '21e47346d882128c78a35912141481c2'
     or (select not p.prosecdef or p.proconfig is distinct from array['search_path=public'] from pg_catalog.pg_proc p
          where p.oid = to_regprocedure('public.garder_recu_d_une_piece_citee()'))
     or has_function_privilege('anon', 'public.garder_recu_d_une_piece_citee()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_recu_d_une_piece_citee()', 'execute')
     or has_function_privilege('service_role', 'public.garder_recu_d_une_piece_citee()', 'execute') then
    raise exception 'A8Q5Q3Q2-Q2 : garder_recu_d_une_piece_citee n''a pas le corps ou les droits de cette migration : rien n''est appliqué.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname collate "C")
        from pg_catalog.pg_trigger t where t.tgname like '%recu_d_une_piece_citee' and not t.tgisinternal)
     is distinct from 'CREATE CONSTRAINT TRIGGER lignes_bancaires_recu_d_une_piece_citee AFTER INSERT OR UPDATE OF piece_id, statut, montant, reglement_groupe, dossier_id ON public.lignes_bancaires DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.piece_id IS NOT NULL) OR new.reglement_groupe)) EXECUTE FUNCTION garder_recu_d_une_piece_citee() O ; '
                   || 'CREATE CONSTRAINT TRIGGER operations_caisse_recu_d_une_piece_citee AFTER INSERT ON public.operations_caisse DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.piece_id IS NOT NULL) AND (new.genre = ''paiement''::text) AND (new.retire_le IS NULL) AND (new.montant > (0)::numeric))) EXECUTE FUNCTION garder_recu_d_une_piece_citee() O ; '
                   || 'CREATE CONSTRAINT TRIGGER reglements_groupes_recu_d_une_piece_citee AFTER INSERT OR UPDATE OF piece_id, ligne_bancaire_id, montant ON public.reglements_groupes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.piece_id IS NOT NULL) AND (new.montant > (0)::numeric))) EXECUTE FUNCTION garder_recu_d_une_piece_citee() O' then
    raise exception 'A8Q5Q3Q2-Q2 : les trois déclencheurs différés ne sont pas ceux de cette migration : rien n''est appliqué.';
  end if;
end
$fin$;
