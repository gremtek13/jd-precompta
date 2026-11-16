-- LE CLIENT NE RÈGLE JAMAIS EN ESPÈCES L'ORIGINAL D'UNE FACTURE REPRISE (ligne 51.5, A8Q5Q3Q2Q2-Q1 ; la migration préparée
-- `especes_du_client_hors_des_reprises`, supabase/preparees/20261116142000_especes_du_client_hors_des_reprises.sql). Le récit :
-- HISTORIQUE.md, « 16/11/2026 — A8Q5-Q4, A8Q5Q3Q2-Q3 ET A8Q5Q3Q2Q2-Q1 : TROIS MIGRATIONS PRÉPARÉES APRÈS LA GARDE DES
-- RÈGLEMENTS ». À rejouer après toute migration qui touche `garder_especes_du_client_hors_des_reprises`,
-- `pieces_hors_de_la_caisse_du_client`, les fonctions ou les gardes de la caisse, `garder_reglement_d_une_piece_reprise`,
-- `garder_recu_d_une_piece_citee` ou les liens d'une facture reprise. SANS LA MIGRATION (la garde absente du catalogue), il se
-- dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session ; son
--      déclencheur BEFORE INSERT, et son rang — après la garde de la table, avant celle des règlements d'une pièce reprise ;
--      la liste aux droits de son propriétaire, `stable`, exécutable par les connectés seuls ;
--   2. LE CLIENT « CAISSE » : une pièce que rien ne cite se paie comme hier ; l'original d'une facture reprise ne se paie
--      plus, quels que soient le montant, la date, le registre — et le refus est le même, neutre : ni montant, ni nom de
--      fichier, ni facture, ni encaissements (ni la garde des règlements d'une pièce reprise, ni la garde différée ne parlent) ;
--      sa correction non plus ; son retrait, si ; le lien retiré, le paiement revient ;
--   3. LE CABINET garde le geste : son paiement se juge comme hier (la garde différée des règlements) ;
--   4. LA RESTAURATION (l'insertion directe du super-administrateur) passe comme hier ;
--   5. LA LISTE : au client « Caisse » et au cabinet, les seuls identifiants des pièces citées ; refusée à un accès sans
--      « Caisse », à un compte sans accès au dossier, à l'anonyme.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `a8580000-0000-4000-8000`) : DC, basculé, en trésorerie, exonéré
-- de TVA — la caisse du client ne s'ouvre que là ; le compte client d'essai y reçoit un accès « Caisse », l'autre compte client
-- d'essai, selon l'étape, un accès sans elle. La pièce de vente P (l'original de la facture reprise, 120 € TTC), déclarée vente
-- hors des factures et validée ; la facture de l'ancien logiciel R-Q2Q2Q1-1, importée à l'étape qui la cite (120 € TTC, à
-- 0 %), rien de déclaré encaissé avant la reprise. N est l'année qui précède la date de reprise (le premier jour du mois de
-- Paris) ; les paiements en espèces sont du 10 décembre de N, sauf celui qui est du jour. Chaque étape se joue dans sa
-- sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose, ce que le client pose (un paiement d'avant la
-- citation), ce que le chef pose ensuite, la fin de la transaction simulée (`set constraints all immediate`), le geste, la fin
-- simulée de nouveau, puis ce qu'on relit ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le
-- relit. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.especes_du_client_hors_des_reprises`) : le fichier
-- se joue d'un seul appel, ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui
-- dépende d'une ligne hors de son dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  autre constant text := '83dfdfdd-8d8a-4cb6-a791-8443e60e1d3b';
  dc constant text := 'a8580000-0000-4000-8000-0000000000d1';
  p constant text := 'a8580000-0000-4000-8000-0000000000b1';
  restauree constant text := 'a8580000-0000-4000-8000-0000000000c1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  aujourdhui constant date := (now() at time zone 'Europe/Paris')::date;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  appliquee constant boolean := to_regprocedure('public.garder_especes_du_client_hors_des_reprises()') is not null;
  -- La facture de l'ancien logiciel, à 0 %, rien de déclaré ; P citée.
  citee constant text := $q$select fixer_reprise_des_factures('{DC}', '{R}');
    select importer_factures('{DC}', '{"format": "csv"}'::jsonb, '[{"numero": "R-Q2Q2Q1-1", "type": "facture", "date_emission": "{DP}",
      "tiers_nom": "Client Q2Q2Q1", "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false,
      "montant_ht": 120, "montant_tva": 0, "montant_ttc": 120, "encaisse_avant_reprise": 0,
      "encaisse_par_taux": [{"taux": 0, "encaisse": 0}],
      "lignes": [{"designation": "Soins", "quantite": 1, "prix_unitaire_ht": 120, "taux_tva": 0}], "transmise_par": "pdf"}]'::jsonb);
    select citer_piece_de_facture_reprise('{DC}', {R1}, '{P}');$q$;
  -- Le registre garni de 100 € par le chef.
  garni constant text := $q$ select enregistrer_encaissement('{DC}', {R1}, '{R}', 100, 'virement', null, '[{"taux": 0, "montant": 100}]'::jsonb);$q$;
  payer constant text := $q$select regler_piece_par_la_caisse('{DC}', '{P}', '{JOUR}', {X});$q$;
  neutre constant text := 'Le paiement en espèces de cette pièce ne se saisit pas depuis ton espace : ton cabinet l''enregistre.';
  e record; v_code text; v_msg text; v_obs text; v_textes text[]; v_qui text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.especes_du_client_hors_des_reprises', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration especes_du_client_hors_des_reprises (A8Q5Q3Q2Q2-Q1)', 'ok', true,
      'observe', 'absente : le client « Caisse » paie encore en espèces l''original d''une facture reprise ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva,
                          assujetti_tva, article_exoneration, siret, adresse, forme_juridique, denomination_imprimee) values
      (dc::uuid, 'ESSAI A8Q5Q3Q2Q2Q1 DC', cabinet, 'tresorerie', '455000', true, 'exonere', false, 'cgi_261_4_1',
       '12345678200010', 'ESSAI A8Q5Q3Q2Q2Q1 ADRESSE', '5710', 'ESSAI A8Q5Q3Q2Q2Q1 SOCIÉTÉ');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (p::uuid, dc::uuid, dc || '/essai-q2q2q1-p.pdf', 'essai-q2q2q1-p.pdf', repeat('6', 64), 'vente', 'a_valider', date_p, 120, 0, 120);
    insert into memberships (user_id, dossier_id, role, droit_caisse) values (client::uuid, dc::uuid, 'client', true);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(dc::uuid, p::uuid);
    update pieces set statut = 'validee' where id = p::uuid;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le chef pose, ce que le client pose ensuite, ce que le chef pose après, qui fait le geste
    -- (`client`, `chef`, `autre` — l'autre compte client —, `anon`), le geste, ce qu'on relit, le code attendu (`OK` : accepté)
    -- et ce qu'on relit, ou les mots du refus}.
    for e in select * from (values
      (1, '1. le catalogue : la garde aux droits de son propriétaire, exécutable par aucun rôle de session ; son déclencheur BEFORE INSERT et son rang ; la liste, stable, exécutable par les connectés seuls',
        null, null, null, 'proprio', null,
        $q$(select string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || array_to_string(p.proconfig, ',')
                                || ':' || has_function_privilege('authenticated', p.oid, 'execute') || ':' || has_function_privilege('anon', p.oid, 'execute')
                                || ':' || has_function_privilege('service_role', p.oid, 'execute'),
                              ',' order by p.proname collate "C")
              from pg_proc p where p.oid in ('public.garder_especes_du_client_hors_des_reprises()'::regprocedure,
                                             'public.pieces_hors_de_la_caisse_du_client(uuid)'::regprocedure))
           || ' ' || (select t.tgtype || ':' || t.tgenabled::text from pg_trigger t where t.tgname = 'operations_caisse_hors_des_reprises' and not t.tgisinternal)
           || ' ' || (select string_agg(t.tgname, ',' order by t.tgname collate "C") from pg_trigger t
                       where t.tgrelid = 'public.operations_caisse'::regclass and not t.tgisinternal and (t.tgtype & 2) = 2 and (t.tgtype & 4) = 4)$q$,
        'OK', 'garder_especes_du_client_hors_des_reprises:true:v:search_path=public:false:false:false,pieces_hors_de_la_caisse_du_client:true:s:search_path=public:true:false:true 7:O _acces_avant_les_gardes,operations_caisse_gardes,operations_caisse_hors_des_reprises,operations_caisse_piece_d_une_facture_reprise'),
      (2, '2. le client « Caisse » paie en espèces une pièce que rien ne cite : accepté, comme hier',
        null, null, null, 'client', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '50'),
        $q$(select count(*)::text from operations_caisse where piece_id = '{P}' and retire_le is null)$q$, 'OK', '1'),
      (3, '2b. l''original d''une facture reprise (citée, rien au registre), 50 € du 10 décembre : refusé, neutre',
        citee, null, null, 'client', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '50'), null, '42501', neutre),
      (4, '2c. … 120 € : le même refus (rien ne se déduit du montant)',
        citee, null, null, 'client', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '120'), null, '42501', neutre),
      (5, '2d. … du jour de la reprise ou d''après : le même refus (la garde des règlements d''une pièce reprise ne parle pas : ni nom, ni facture)',
        citee, null, null, 'client', replace(replace(payer, '{JOUR}', '{AUJ}'), '{X}', '50'), null, '42501', neutre),
      (6, '2e. le registre a reçu 100 € : 21 € refusés, neutre (la garde différée ne parle pas : rien de ses encaissements)',
        citee || garni, null, null, 'client', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '21'), null, '42501', neutre),
      (7, '2f. … et 20 € : le même refus (rien du seuil)',
        citee || garni, null, null, 'client', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '20'), null, '42501', neutre),
      (8, '2g. sa correction d''un paiement saisi avant la citation : refusée, neutre',
        null, replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '50'), citee, 'client',
        $q$select remplacer_paiement_par_la_caisse('{DC}', (select o.id from operations_caisse o where o.piece_id = '{P}' and o.retire_le is null), '{DM}', 40);$q$,
        null, '42501', neutre),
      (9, '2h. … son retrait : accepté (il ne fait que baisser ce que la pièce a reçu)',
        null, replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '50'), citee, 'client',
        $q$select retirer_operation_caisse('{DC}', (select o.id from operations_caisse o where o.piece_id = '{P}' and o.retire_le is null));$q$,
        $q$(select count(*)::text from operations_caisse where piece_id = '{P}' and retire_le is null)$q$, 'OK', '0'),
      (10, '2i. le lien retiré (retirer_piece_de_facture_reprise) : le paiement du client revient',
        citee || $q$ select retirer_piece_de_facture_reprise('{DC}', {R1});$q$, null, null, 'client',
        replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '50'),
        $q$(select count(*)::text from operations_caisse where piece_id = '{P}' and retire_le is null)$q$, 'OK', '1'),
      (11, '3. le cabinet garde le geste : 20 € en espèces de la pièce citée, 100 € au registre — accepté',
        citee || garni, null, null, 'chef', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '20'),
        $q$(select count(*)::text from operations_caisse where piece_id = '{P}' and retire_le is null)$q$, 'OK', '1'),
      (12, '3b. … 21 € : refusés par la garde différée des règlements, comme hier',
        citee || garni, null, null, 'chef', replace(replace(payer, '{JOUR}', '{DM}'), '{X}', '21'), null, '23514',
        'Cette pièce est l''original d''une facture reprise dont le registre a déjà reçu des encaissements : avec ce paiement, ce qu''elle a reçu avant la reprise et ce registre dépasseraient ensemble ce que la facture porte, nette de ses avoirs, et la même vente compterait deux fois. Le cabinet retire d''abord ces encaissements, ou ce paiement ne règle pas cette pièce.'),
      (13, '4. la restauration : l''insertion directe du super-administrateur d''un paiement du client sur la pièce citée passe, comme hier',
        citee, null, null, 'chef',
        $q$insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine, cree_par)
             values ('{OC}', '{DC}', 'paiement', '{DM}', 50, '{P}', 'client', '{CLIENT}');$q$,
        $q$(select origine from operations_caisse where id = '{OC}')$q$, 'OK', 'client'),
      (14, '5. la liste, au client « Caisse » : la pièce citée, et elle seule',
        citee, null, null, 'client', $q$select set_config('essai.liste_lue', pieces_hors_de_la_caisse_du_client('{DC}')::text, true);$q$,
        $q$current_setting('essai.liste_lue')$q$, 'OK', '["a8580000-0000-4000-8000-0000000000b1"]'),
      (15, '5b. … rien de cité : vide',
        null, null, null, 'client', $q$select set_config('essai.liste_lue', pieces_hors_de_la_caisse_du_client('{DC}')::text, true);$q$,
        $q$current_setting('essai.liste_lue')$q$, 'OK', '[]'),
      (20, '5b bis. … le lien retiré : vide',
        citee || $q$ select retirer_piece_de_facture_reprise('{DC}', {R1});$q$, null, null, 'client',
        $q$select set_config('essai.liste_lue', pieces_hors_de_la_caisse_du_client('{DC}')::text, true);$q$,
        $q$current_setting('essai.liste_lue')$q$, 'OK', '[]'),
      (16, '5c. … au cabinet : la même',
        citee, null, null, 'chef', $q$select set_config('essai.liste_lue', pieces_hors_de_la_caisse_du_client('{DC}')::text, true);$q$,
        $q$current_setting('essai.liste_lue')$q$, 'OK', '["a8580000-0000-4000-8000-0000000000b1"]'),
      (17, '5d. … à un accès client sans « Caisse » : refusée avant toute lecture',
        citee || $q$ insert into memberships (user_id, dossier_id, role, droit_caisse) values ('{AUTRE}', '{DC}', 'client', false);$q$, null, null, 'autre',
        $q$select pieces_hors_de_la_caisse_du_client('{DC}');$q$, null, '42501', 'Accès refusé à ce dossier.'),
      (18, '5e. … à un compte sans accès au dossier : refusée',
        citee, null, null, 'autre', $q$select pieces_hors_de_la_caisse_du_client('{DC}');$q$, null, '42501', 'Accès refusé à ce dossier.'),
      (19, '5f. … à l''anonyme : pas même exécutable',
        null, null, null, 'anon', $q$select pieces_hors_de_la_caisse_du_client('{DC}');$q$, null, '42501',
        'permission denied for function pieces_hors_de_la_caisse_du_client')
    ) as v(rang, etape, pose, pose_client, pose_apres, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.pose_client, e.pose_apres, e.geste, e.relu, e.attendu];
        for i in 1 .. 6 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DC}', dc), '{P}', p), '{OC}', restauree), '{CLIENT}', client);
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DP}', date_p::text), '{DM}', date_m::text), '{AUJ}', aujourdhui::text), '{AUTRE}', autre);
          v_textes[i] := replace(v_textes[i], '{R}', reprise::text);
          v_textes[i] := replace(v_textes[i], '{R1}', '(select f.id from factures_emises f where f.dossier_id = ''' || dc || ''' and f.numero = ''R-Q2Q2Q1-1'')');
        end loop;
        -- Les trois poses : le chef, le client, le chef ; chacune jugée à la fin simulée de la transaction.
        for i in 1 .. 3 loop
          if v_textes[i] is null then continue; end if;
          v_qui := case when i = 2 then client else chef end;
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', v_qui, 'role', 'authenticated')::text, true);
          execute v_textes[i];
          reset role;
          perform set_config('request.jwt.claims', '', true);
          set constraints all immediate;
          set constraints all deferred;
        end loop;
        begin
          if v_textes[4] is not null then
            if e.qui = 'anon' then
              execute 'set local role anon';
              perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
            elsif e.qui <> 'proprio' then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', case e.qui when 'client' then client when 'autre' then autre else chef end,
                                                                          'role', 'authenticated')::text, true);
            end if;
            execute v_textes[4];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[5] is not null then
            execute 'select (' || v_textes[5] || ')::text' into v_obs;
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
        'ok', v_code = e.code and v_msg = v_textes[6], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni sa pièce, ses accès, sa caisse, sa facture, ses encaissements',
    'ok', not exists (select 1 from dossiers where id = dc::uuid)
      and not exists (select 1 from pieces where id = p::uuid)
      and not exists (select 1 from memberships where dossier_id = dc::uuid)
      and not exists (select 1 from operations_caisse where dossier_id = dc::uuid)
      and not exists (select 1 from factures_emises where dossier_id = dc::uuid)
      and not exists (select 1 from encaissements_factures where dossier_id = dc::uuid),
    'observe', 'relu');
  perform set_config('essai.especes_du_client_hors_des_reprises', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.especes_du_client_hors_des_reprises')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
