-- LA PIÈCE D'UN EXERCICE VALIDÉ, DÉJÀ COMPTÉE, PUIS L'ORIGINAL D'UNE FACTURE REPRISE (ligne 51.5, A8Q5-Q3). Le récit :
-- HISTORIQUE.md, « 11/11/2026 — A8Q5-Q3 : LA PIÈCE DÉJÀ COMPTÉE PAR UN EXERCICE VALIDÉ ». Aucune migration : l'essai joue
-- le cas de la fiche contre la base d'aujourd'hui (195 migrations). À rejouer après toute migration qui touche
-- `valider_exercice`, `enregistrer_encaissement`, `calcul_vente_facturee`, `importer_factures`,
-- `citer_piece_de_facture_reprise` ou les gardes des règlements d'une pièce reprise.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CAS DE LA FICHE NE SE FIGE PAS. En trésorerie, la pièce de vente qu'aucun paiement ne règle s'écrit au 706 et au
--      44571 à sa date, sans banque : la validation de son exercice se refuse (« Une écriture n'est pas équilibrée au
--      centime »). Un exercice validé ne peut donc pas avoir compté son reste impayé, cité ou non.
--   2. LE TÉMOIN : la même pièce SANS écriture, la base valide — elle ne juge pas la 2035, que l'application calcule et
--      envoie ; c'est la validation de l'application qui refuse alors (« ecritures-a-generer », la concordance :
--      src/lib/pieceDejaCompteeDUneReprise.test.ts). Ce qu'un exercice validé a compté d'une pièce ne se lit donc nulle part
--      pièce par pièce : l'instantané de la 2035 porte des postes, et les écritures figées ne portent que ses paiements.
--   3. LE CHEMIN DE L'APPLICATION : la pièce citée avant la validation ne compte ni ne s'écrit (A8c4), l'exercice N se
--      valide sans elle, et le paiement de N+1 par la facture reprise compte une fois, en N+1.
--   4. LA PIÈCE FIGÉE PAYÉE EN N (A8Q5-Q1) : citée après la validation, ce qu'elle a compté avant la reprise est la base des
--      encaissements (A8b) quand l'import le déclare — le registre refuse d'encaisser une seconde fois.
--   5. LE TÉMOIN DE CE QUI RESTE (A8Q5Q3-Q2) : l'import qui déclare zéro encaissé avant la reprise, la pièce figée payée en N
--      est citée, et le registre accepte d'encaisser de nouveau — la même vente compterait en N et en N+1.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `a8530000-0000-4000-8000`) : DQ, basculé, en trésorerie,
-- redevable ; sa pièce de vente P (120 € TTC, datée du 20 novembre de N) ; le mouvement M1 qui la paie le 10 décembre de N,
-- importé par les étapes 4 et 5 seules (ailleurs, il resterait à traiter et retiendrait la validation) ; N est
-- l'année qui précède la date de reprise (le premier jour du mois de Paris), l'encaissement de N+1 est daté de la reprise.
-- Chaque étape se joue dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le chef pose d'abord, puis sa
-- requête ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent
-- dans un réglage LOCAL à la transaction (`essai.piece_deja_comptee_d_une_reprise`) : le fichier se joue d'un seul appel,
-- ne crée ni table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne
-- hors de son dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dq constant text := 'a8530000-0000-4000-8000-0000000000d1';
  p constant text := 'a8530000-0000-4000-8000-0000000000b1';
  m1 constant text := 'a8530000-0000-4000-8000-0000000000e1';
  e1 constant text := 'a8530000-0000-4000-8000-0000000000c1';
  e2 constant text := 'a8530000-0000-4000-8000-0000000000c2';
  e3 constant text := 'a8530000-0000-4000-8000-0000000000c3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  n constant integer := extract(year from reprise)::integer - 1;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m1 constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  -- La facture de l'ancien logiciel dont P est l'original : 100 € HT à 20 %, ce qu'elle portait encaissé avant la reprise
  -- en `{E}`.
  lot constant text := '[{"numero": "R-Q3-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client P",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 100,
    "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E}}],
    "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]';
  importer constant text := $q$select fixer_reprise_des_factures('{DQ}', '{R}'); select importer_factures('{DQ}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  citer constant text := $q$select citer_piece_de_facture_reprise('{DQ}', {R1}, '{P}');$q$;
  -- L'écriture de P qu'aucun paiement ne règle, comme la génération l'écrit en trésorerie : le produit et sa TVA, à sa date.
  sans_paiement constant text := $q$insert into ecritures_brouillon (id, dossier_id, piece_id, date, compte, libelle, montant, sens) values
    ('{E1}', '{DQ}', '{P}', '{DP}', '706000', 'Recette du {DP}', 100, 'credit'),
    ('{E2}', '{DQ}', '{P}', '{DP}', '445710', 'Recette du {DP}', 20, 'credit');$q$;
  num_sans_paiement constant text := '[{"id": "{E1}", "journal": "VE", "numero": 1, "piece_ref": "ESSAI-Q3-P", "piece_date": "{DP}", "compte_lib": "Prestations de services", "comp_aux_num": null, "comp_aux_lib": null},
    {"id": "{E2}", "journal": "VE", "numero": 1, "piece_ref": "ESSAI-Q3-P", "piece_date": "{DP}", "compte_lib": "TVA collectée", "comp_aux_num": null, "comp_aux_lib": null}]';
  -- P payée en N par M1 : rapprochée, et son écriture au jour du paiement, face à la banque.
  payee constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
    ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3 PAIEMENT', 120, 'non_rapprochee', null, false);
    update lignes_bancaires set piece_id = '{P}', statut = 'rapprochee' where id = '{M1}';
    insert into ecritures_brouillon (id, dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens) values
    ('{E1}', '{DQ}', '{P}', null, '{DM}', '706000', 'Recette du {DP}', 100, 'credit'),
    ('{E2}', '{DQ}', '{P}', null, '{DM}', '445710', 'Recette du {DP}', 20, 'credit'),
    ('{E3}', '{DQ}', '{P}', '{M1}', '{DM}', '512000', 'Recette du {DP}', 120, 'debit');$q$;
  num_payee constant text := '[{"id": "{E1}", "journal": "BQ", "numero": 1, "piece_ref": "ESSAI-Q3-P", "piece_date": "{DP}", "compte_lib": "Prestations de services", "comp_aux_num": null, "comp_aux_lib": null},
    {"id": "{E2}", "journal": "BQ", "numero": 1, "piece_ref": "ESSAI-Q3-P", "piece_date": "{DP}", "compte_lib": "TVA collectée", "comp_aux_num": null, "comp_aux_lib": null},
    {"id": "{E3}", "journal": "BQ", "numero": 1, "piece_ref": "ESSAI-Q3-P", "piece_date": "{DP}", "compte_lib": "Banque", "comp_aux_num": null, "comp_aux_lib": null}]';
  valider constant text := $q$select valider_exercice('{DQ}', {N}, '{NUM}'::jsonb, '[]'::jsonb, '{"essai": "A8Q5-Q3"}'::jsonb);$q$;
  encaisser constant text := $q$select enregistrer_encaissement('{DQ}', {R1}, '{R}', 120, 'virement', null, '[{"taux": 20, "montant": 120}]'::jsonb)$q$;
  -- Ce que la vente compte : les recettes de P figées dans N (HT), et les parts du registre (TTC, en centimes), par date.
  compte constant text := $q$select coalesce((select sum(x.montant) from ecritures_brouillon x where x.piece_id = '{P}' and x.compte = '706000' and x.statut = 'validee'), 0)::text
    || ' en ' || {N} || ' ; ' || coalesce((select string_agg(c.date_effet::text || '=' || c.ttc_centimes, ',' order by c.date_effet)
         from calcul_vente_facturee({R1}) c where c.genre = 'part'), 'aucune part')$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_f record; v_texte text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.pieces_des_factures_reprises') is null then
    perform set_config('essai.piece_deja_comptee_d_une_reprise', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE des migrations factures_importees à piece_d_une_facture_reprise', 'ok', true,
      'observe', 'absentes : l''essai se joue dès qu''elles y sont'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dq::uuid, 'ESSAI A8Q5Q3 DQ', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5Q3 ADRESSE', '5710', 'ESSAI A8Q5Q3 SOCIÉTÉ');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (p::uuid, dq::uuid, dq || '/essai-a8q5q3-p.pdf', 'essai-a8q5q3-p.pdf', repeat('a', 64), 'vente', 'a_valider', date_p, 100, 20, 120);
    -- Née à valider (la garde d'un dossier basculé), déclarée vente hors des factures de l'application par le chef — c'est
    -- l'original d'une facture de l'ancien logiciel, qu'aucune désignation ne vise —, puis validée.
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(dq::uuid, p::uuid);
    update pieces set statut = 'validee' where id = p::uuid;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le chef pose d'abord, la requête, qui la joue — `chef`, ou `postgres`, le propriétaire
    -- (`calcul_vente_facturee` n'est exécutable par aucun rôle connecté) —, le code attendu (`OK` : acceptée) et ce qu'elle
    -- rend, ou les mots du refus}.
    for e in select * from (values
      (1, '1. la pièce de vente sans paiement, écrite à sa date sans banque : l''exercice N ne se valide pas (le cas de la fiche ne se fige pas)',
        sans_paiement, replace(valider, '{NUM}', num_sans_paiement), 'chef',
        '22023', 'Une écriture n''est pas équilibrée au centime.'),
      (2, '2. témoin : la même pièce SANS écriture, la base valide (elle ne juge pas la 2035 ; l''application refuse, « ecritures-a-generer »)',
        null, $q$select 'validé' from ($q$ || rtrim(replace(valider, '{NUM}', '[]'), ';') || $q$) x$q$, 'chef',
        'OK', 'validé'),
      (3, '3. citée AVANT la validation (A8c4) : N se valide sans elle, et le paiement de N+1 par la facture reprise compte une fois, en N+1',
        replace(replace(importer, '{L}', lot), '{E}', '0') || citer || replace(valider, '{NUM}', '[]') || encaisser || ';', compte, 'postgres',
        'OK', '0 en {N} ; {R}=12000'),
      (4, '4. payée en N, figée, puis citée (A8Q5-Q1), l''import déclarant ce paiement encaissé avant la reprise : le registre n''encaisse pas une seconde fois',
        payee || replace(valider, '{NUM}', num_payee) || replace(replace(importer, '{L}', lot), '{E}', '120') || citer, encaisser, 'chef',
        '22023', 'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 0,00 € à encaisser.'),
      (5, '5. témoin de ce qui reste (A8Q5Q3-Q2) : l''import déclare zéro encaissé avant la reprise, la pièce figée se cite, et la même vente compte en N et en N+1',
        payee || replace(valider, '{NUM}', num_payee) || replace(replace(importer, '{L}', lot), '{E}', '0') || citer || encaisser || ';', compte, 'postgres',
        'OK', '100 en {N} ; {R}=12000')
    ) as t(rang, etape, pose, requete, profil, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null; v_pose := null; v_req := null;
      begin
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete), (3, e.attendu)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(replace(v_f.texte, '{DQ}', dq), '{P}', p), '{M1}', m1), '{R}', reprise::text);
          v_texte := replace(replace(replace(replace(v_texte, '{E1}', e1), '{E2}', e2), '{E3}', e3), '{N}', n::text);
          v_texte := replace(replace(v_texte, '{DP}', date_p::text), '{DM}', date_m1::text);
          v_texte := replace(v_texte, '{R1}', '(select f.id from factures_emises f where f.dossier_id = ''' || dq || ''' and f.numero = ''R-Q3-1'')');
          if v_f.rang = 1 then v_pose := v_texte; elsif v_f.rang = 2 then v_req := v_texte; else e.attendu := v_texte; end if;
        end loop;
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        if v_pose is not null then
          execute v_pose;
        end if;
        if e.profil = 'postgres' then
          reset role;
        end if;
        begin
          execute v_req into v_obs;
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
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni sa pièce, son mouvement, ses écritures, ses factures, son exercice validé',
    'ok', not exists (select 1 from dossiers where id = dq::uuid)
      and not exists (select 1 from pieces where id = p::uuid)
      and not exists (select 1 from lignes_bancaires where id = m1::uuid)
      and not exists (select 1 from ecritures_brouillon where id in (e1::uuid, e2::uuid, e3::uuid))
      and not exists (select 1 from factures_emises where dossier_id = dq::uuid)
      and not exists (select 1 from exercices_valides where dossier_id = dq::uuid),
    'observe', 'relu');
  perform set_config('essai.piece_deja_comptee_d_une_reprise', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.piece_deja_comptee_d_une_reprise')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
