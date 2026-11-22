-- LA PIÈCE D'UN PAIEMENT, TENUE DANS SON DOSSIER (ligne 51.5, A8Q5-Q4 ; la migration préparée
-- `piece_d_un_paiement_dans_son_dossier`, supabase/preparees/20261116140000_piece_d_un_paiement_dans_son_dossier.sql). Le
-- récit : HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES
-- RÈGLEMENTS ». À rejouer après toute migration qui touche `garder_piece_dans_son_dossier`, les gardes BEFORE de
-- `lignes_bancaires`, `reglements_groupes` ou `pieces`, `regler_pieces_par_mouvement` ou les fonctions de la caisse. SANS LA
-- MIGRATION (la garde absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; ses
--      trois déclencheurs BEFORE, et leur rang — sur les deux tables des paiements, la première garde après la porte d'accès ;
--   2. LE MOUVEMENT : une pièce d'un autre dossier, ou un identifiant inconnu, se refuse sous les mêmes mots (la garde tire
--      avant la clé étrangère), au chef comme au propriétaire hors de la RLS, à l'insertion comme à la mise à jour ; une pièce
--      de son dossier passe ; la pièce d'un autre dossier citée par une facture reprise ne fait plus parler la garde des
--      règlements d'une pièce reprise (son nom de fichier et sa facture) ;
--   3. LA PART d'un virement groupé : la fonction du virement groupé la tenait déjà ; hors d'elle, la pièce d'un autre dossier,
--      ou d'un dossier qui n'est pas celui du mouvement, se refuse ; le chef sous la RLS est refusé par la porte d'abord ;
--   4. LE CÔTÉ PIÈCE : une pièce qu'un mouvement ou une part cite, un mouvement dont des parts citent une pièce, ne changent
--      pas de dossier ; une pièce que rien ne cite en change. Une pièce change de dossier AVEC son chemin depuis le 17/11/2026
--      (`pieces_storage_path_dans_son_dossier`, CFCS-Q1, 238 : le premier segment du chemin est le dossier) : chaque geste
--      déplace les deux — le contrôle positif 4c passait la garde puis butait sur la contrainte (relevé le 22/11/2026), et la
--      garde seule refuse 4 et 4b ;
--   5. LA CAISSE la tenait déjà : sa fonction et la garde de la table.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a8560000-0000-4000-8000`) : DA, nu, en trésorerie ; DB,
-- basculé, redevable (pour y citer une pièce par une facture reprise). Les pièces PA (vente) et PA2 (achat) de DA, PB (vente,
-- validée) de DB ; les
-- mouvements LA (DA, du jour), LG (DA, réglé en groupe), LB (DB). Chaque étape se joue dans sa sous-transaction et s'y ANNULE
-- (`ANNULATION_ETAPE`) : ce que le chef pose d'abord, puis le geste (du chef sous la RLS, ou du propriétaire), puis la fin de
-- la transaction simulée (`set constraints all immediate`), puis ce qu'on relit ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.piece_d_un_paiement_dans_son_dossier`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne
-- contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses dossiers. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  da constant text := 'a8560000-0000-4000-8000-0000000000d1';
  db constant text := 'a8560000-0000-4000-8000-0000000000d2';
  pa constant text := 'a8560000-0000-4000-8000-0000000000b1';
  pa2 constant text := 'a8560000-0000-4000-8000-0000000000b2';
  pb constant text := 'a8560000-0000-4000-8000-0000000000b3';
  la constant text := 'a8560000-0000-4000-8000-0000000000e1';
  lg constant text := 'a8560000-0000-4000-8000-0000000000e2';
  lb constant text := 'a8560000-0000-4000-8000-0000000000e3';
  lx constant text := 'a8560000-0000-4000-8000-0000000000e4';
  oc constant text := 'a8560000-0000-4000-8000-0000000000c1';
  inconnue constant text := 'a8560000-0000-4000-8000-0000000000ff';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  aujourdhui constant date := (now() at time zone 'Europe/Paris')::date;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  appliquee constant boolean := to_regprocedure('public.garder_piece_dans_son_dossier()') is not null;
  -- La facture de l'ancien logiciel, à un taux, rien d'encaissé avant la reprise ; importée dans DB, puis PB citée.
  citee constant text := $q$select fixer_reprise_des_factures('{DB}', '{R}');
    select importer_factures('{DB}', '{"format": "csv"}'::jsonb, '[{"numero": "R-Q4-1", "type": "facture", "date_emission": "{DP}",
      "tiers_nom": "Client Q4", "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
      "montant_ht": 100, "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": 0,
      "encaisse_par_taux": [{"taux": 20, "encaisse": 0}],
      "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]'::jsonb);
    select citer_piece_de_facture_reprise('{DB}', (select f.id from factures_emises f where f.dossier_id = '{DB}' and f.numero = 'R-Q4-1'), '{PB}');$q$;
  dans_son_dossier constant text := 'La pièce d''un mouvement du relevé est une pièce de son dossier.';
  part_dans_son_dossier constant text := 'La pièce d''une part d''un virement groupé est une pièce du dossier de ce virement.';
  piece_citee constant text := 'Cette pièce est citée par un mouvement du relevé, ou par la part d''un virement groupé, de son dossier : elle ne change pas de dossier.';
  mouvement_groupe constant text := 'Ce mouvement règle en groupe des pièces de son dossier : il ne change pas de dossier.';
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.piece_d_un_paiement_dans_son_dossier', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration piece_d_un_paiement_dans_son_dossier (A8Q5-Q4)', 'ok', true,
      'observe', 'absente : un mouvement ou une part de virement groupé cite encore une pièce d''un autre dossier ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI A8Q5Q4 DA', cabinet, 'tresorerie', '455000');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (db::uuid, 'ESSAI A8Q5Q4 DB', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5Q4 ADRESSE', '5710', 'ESSAI A8Q5Q4 SOCIÉTÉ');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (pa::uuid, da::uuid, da || '/essai-q4-pa.pdf', 'essai-q4-pa.pdf', repeat('e', 64), 'vente', 'a_valider', date_p, 100, 20, 120),
      (pa2::uuid, da::uuid, da || '/essai-q4-pa2.pdf', 'essai-q4-pa2.pdf', repeat('f', 64), 'achat', 'a_valider', date_p, 100, 20, 120),
      (pb::uuid, db::uuid, db || '/essai-q4-pb.pdf', 'essai-q4-pb.pdf', repeat('9', 64), 'vente', 'a_valider', date_p, 100, 20, 120);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
      (la::uuid, da::uuid, aujourdhui, 'ESSAI A8Q5Q4 MOUVEMENT', 120, 'non_rapprochee'),
      (lg::uuid, da::uuid, date_m, 'ESSAI A8Q5Q4 GROUPE', 240, 'non_rapprochee'),
      (lb::uuid, db::uuid, date_m, 'ESSAI A8Q5Q4 MOUVEMENT DB', 120, 'non_rapprochee'),
      (lx::uuid, da::uuid, date_m, 'ESSAI A8Q5Q4 SANS PIECE', 30, 'non_rapprochee');
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(db::uuid, pb::uuid);
    update pieces set statut = 'validee' where id = pb::uuid;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le chef pose d'abord, qui fait le geste (`chef` sous la RLS, `proprio` hors d'elle), le
    -- geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; ses trois déclencheurs BEFORE',
        null, 'proprio', null,
        $q$(select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',') from pg_proc p where p.oid = 'public.garder_piece_dans_son_dossier()'::regprocedure)
           || ' ' || has_function_privilege('authenticated', 'public.garder_piece_dans_son_dossier()', 'execute')
           || ' ' || has_function_privilege('anon', 'public.garder_piece_dans_son_dossier()', 'execute')
           || ' ' || has_function_privilege('service_role', 'public.garder_piece_dans_son_dossier()', 'execute')
           || ' ' || (select string_agg(t.tgrelid::regclass::text || ':' || t.tgtype || ':' || t.tgenabled::text, ',' order by t.tgname collate "C")
                        from pg_trigger t where t.tgfoid = 'public.garder_piece_dans_son_dossier()'::regprocedure and not t.tgisinternal)$q$,
        'OK', 'true search_path=public false false false lignes_bancaires:23:O,pieces:19:O,reglements_groupes:23:O'),
      (2, '1b. leur rang : sur chacune des deux tables des paiements, la première garde BEFORE après la porte d''accès',
        null, 'proprio', null,
        $q$(select string_agg(x.tgrelid::regclass::text || ':' || x.tgname, ',' order by x.tgrelid::regclass::text collate "C")
              from (select distinct on (t.tgrelid) t.tgrelid, t.tgname from pg_trigger t
                     where t.tgrelid in ('public.lignes_bancaires'::regclass, 'public.reglements_groupes'::regclass)
                       and not t.tgisinternal and (t.tgtype & 2) = 2 and t.tgname <> '_acces_avant_les_gardes'
                     order by t.tgrelid, t.tgname collate "C") x)$q$,
        'OK', 'lignes_bancaires:lignes_bancaires_dans_son_dossier,reglements_groupes:reglements_groupes_dans_son_dossier'),
      (3, '2. le chef rapproche un mouvement de DA d''une pièce de DB : refusé',
        null, 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PB}' where id = '{LA}';$q$,
        null, '23514', dans_son_dossier),
      (4, '2b. … d''une pièce de DA : accepté',
        null, 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PA}' where id = '{LA}';$q$,
        $q$(select piece_id::text from lignes_bancaires where id = '{LA}')$q$, 'OK', 'a8560000-0000-4000-8000-0000000000b1'),
      (5, '2c. le chef insère un mouvement de DA qui cite une pièce de DB : refusé',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, piece_id) values ('{DA}', '{DM}', 'ESSAI A8Q5Q4 INSERE', 120, 'rapprochee', '{PB}');$q$,
        null, '23514', dans_son_dossier),
      (6, '2d. un identifiant de pièce inconnu : refusé sous les mêmes mots, avant la clé étrangère',
        null, 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{X}' where id = '{LA}';$q$,
        null, '23514', dans_son_dossier),
      (7, '2e. le propriétaire, hors de la RLS : refusé de même',
        null, 'proprio', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PB}' where id = '{LA}';$q$,
        null, '23514', dans_son_dossier),
      (8, '2f. la pièce de DB citée par une facture reprise, le mouvement de DA du jour de la reprise ou d''après : la garde dit ses mots, ni le nom de la pièce ni sa facture',
        citee, 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PB}' where id = '{LA}';$q$,
        null, '23514', dans_son_dossier),
      (9, '2g. un mouvement de DB rapproché d''une pièce de DB : accepté (le contrôle positif de l''autre dossier)',
        null, 'chef', $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PB}' where id = '{LB}';$q$,
        $q$(select piece_id::text from lignes_bancaires where id = '{LB}')$q$, 'OK', 'a8560000-0000-4000-8000-0000000000b3'),
      (10, '3. la part d''un virement groupé par sa fonction (regler_pieces_par_mouvement) : la fonction tenait déjà la pièce dans le dossier du mouvement',
        null, 'chef', $q$select regler_pieces_par_mouvement('{LG}', '[{"piece_id": "{PA}", "montant": 120}, {"piece_id": "{PB}", "montant": 120}]'::jsonb);$q$,
        null, '22023', 'Cette pièce n''existe pas pour ce dossier.'),
      (11, '3b. le propriétaire insère une part du mouvement de DA qui cite une pièce de DB : refusé',
        null, 'proprio', $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PB}', 120);$q$,
        null, '23514', part_dans_son_dossier),
      (12, '3c. … une part dont le dossier n''est pas celui de son mouvement (DB), qui cite une pièce de DA : refusé',
        null, 'proprio', $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DB}', '{LG}', '{PA}', 120);$q$,
        null, '23514', part_dans_son_dossier),
      (23, '3c bis. … une part de DB qui cite une pièce de DB, sur un mouvement de DA : refusé (la pièce est du dossier de la part, pas de celui du mouvement)',
        null, 'proprio', $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DB}', '{LG}', '{PB}', 120);$q$,
        null, '23514', part_dans_son_dossier),
      (13, '3d. … une part de DA qui cite une pièce de DA : acceptée',
        null, 'proprio', $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PA}', 120);$q$,
        $q$(select count(*)::text from reglements_groupes where ligne_bancaire_id = '{LG}')$q$, 'OK', '1'),
      (14, '3e. … la pièce d''une part de DA passée à une pièce de DB : refusé',
        $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PA}', 120);$q$, 'proprio',
        $q$update reglements_groupes set piece_id = '{PB}' where ligne_bancaire_id = '{LG}';$q$,
        null, '23514', part_dans_son_dossier),
      (15, '3f. le chef, sous la RLS, insère une part qui cite une pièce de DB : la porte refuse d''abord',
        null, 'chef', $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PB}', 120);$q$,
        null, '42501', 'new row violates row-level security policy for table "reglements_groupes"'),
      (16, '4. une pièce qu''un mouvement de son dossier cite ne change pas de dossier (avec son chemin : la garde seule la refuse)',
        $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PA}' where id = '{LA}';$q$, 'chef',
        $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-q4-pa.pdf' where id = '{PA}';$q$,
        null, '23514', piece_citee),
      (17, '4b. … ni une pièce qu''une part cite',
        null, 'proprio',
        $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PA2}', 120);
           update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-q4-pa2.pdf' where id = '{PA2}';$q$,
        null, '23514', piece_citee),
      (18, '4c. une pièce que rien ne cite change de dossier, avec son chemin (le contrôle positif)',
        null, 'chef', $q$update pieces set dossier_id = '{DB}', storage_path = '{DB}/essai-q4-pa2.pdf' where id = '{PA2}';$q$,
        $q$(select dossier_id::text || ' ' || storage_path from pieces where id = '{PA2}')$q$, 'OK',
        'a8560000-0000-4000-8000-0000000000d2 a8560000-0000-4000-8000-0000000000d2/essai-q4-pa2.pdf'),
      (19, '4d. un mouvement dont des parts citent une pièce ne change pas de dossier',
        null, 'proprio',
        $q$insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DA}', '{LG}', '{PA}', 120);
           update lignes_bancaires set dossier_id = '{DB}' where id = '{LG}';$q$,
        null, '23514', mouvement_groupe),
      (20, '4e. un mouvement rapproché d''une pièce de DA ne passe pas à DB',
        $q$update lignes_bancaires set statut = 'rapprochee', piece_id = '{PA}' where id = '{LA}';$q$, 'chef',
        $q$update lignes_bancaires set dossier_id = '{DB}' where id = '{LA}';$q$,
        null, '23514', dans_son_dossier),
      (21, '5. la caisse tenait déjà sa pièce dans son dossier : sa fonction',
        null, 'chef', $q$select regler_piece_par_la_caisse('{DA}', '{PB}', '{DM}', 120);$q$,
        null, 'P0002', 'Cette pièce n''est pas une pièce de ce dossier : relis ses pièces.'),
      (22, '5b. … et la garde de la table, sous le réglage d''une fonction',
        null, 'proprio', $q$select set_config('jd.caisse', '{OC}', true);
           insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine) values ('{OC}', '{DA}', 'paiement', '{DM}', 120, '{PB}', 'cabinet');$q$,
        null, '23514', 'La pièce d''un paiement par la caisse est une pièce de son dossier.')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(replace(v_textes[i], '{DA}', da), '{DB}', db), '{PA2}', pa2), '{PA}', pa), '{PB}', pb);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{LA}', la), '{LG}', lg), '{LB}', lb), '{X}', inconnue);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DP}', date_p::text), '{DM}', date_m::text), '{R}', reprise::text), '{OC}', oc);
        end loop;
        if v_textes[1] is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_textes[1];
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui = 'chef' then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
          end if;
          v_msg := coalesce(v_obs, '');
        exception when others then
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni leurs pièces, mouvements, parts, factures, opérations de caisse',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from pieces where id in (pa::uuid, pa2::uuid, pb::uuid))
      and not exists (select 1 from lignes_bancaires where id in (la::uuid, lg::uuid, lb::uuid, lx::uuid))
      and not exists (select 1 from reglements_groupes where ligne_bancaire_id in (la::uuid, lg::uuid, lb::uuid))
      and not exists (select 1 from factures_emises where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from operations_caisse where dossier_id in (da::uuid, db::uuid)),
    'observe', 'relu');
  perform set_config('essai.piece_d_un_paiement_dans_son_dossier', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.piece_d_un_paiement_dans_son_dossier')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
