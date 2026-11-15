-- CE QUE LA PIÈCE CITÉE D'UNE FACTURE REPRISE A DÉJÀ REÇU, PLANCHER DE SON REGISTRE (ligne 51.5, A8Q5Q3-Q2 ; la migration
-- `recu_par_la_piece_citee`, en production depuis le 15/11/2026, supabase/schema/20261115075201_recu_par_la_piece_citee.sql). Le récit :
-- HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS PRÉPARÉES ». À rejouer après toute
-- migration qui touche `recu_par_la_piece`, `enregistrer_encaissement`, `reprise_de_la_facture`,
-- `citer_piece_de_facture_reprise`, `importer_factures` ou les tables des paiements d'une pièce. SANS LA MIGRATION (sa
-- dernière ligne d'historique, pas son retour), il se dit EN ATTENTE ; l'essai pieceDejaCompteeDUneReprise.sql (étape 5)
-- rend alors le double compte qu'elle ferme.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. CE QU'UNE PIÈCE A REÇU (`recu_par_la_piece`) : un mouvement rapproché d'elle, la part d'un virement groupé, un paiement
--      par la caisse non retiré — et non un mouvement à traiter qui la cite, ni une opération de caisse retirée, ni ce qu'un
--      autre dossier dirait d'elle (1b) ; et aucun rôle de session ne l'exécute ;
--   2. LE REGISTRE part du plus grand du déclaré et de ce reçu : à un taux, au total et à ce taux ; le déclaré plus grand
--      l'emporte ; à plusieurs taux, un reçu qui dépasse le déclaré refuse l'encaissement, et un déclaré qui le couvre se
--      juge taux par taux comme hier ; `reprise_de_la_facture` le rend (septième clé) ;
--   3. LA CITATION, quand le registre a déjà des encaissements : refusée quand ils dépassent avec ce reçu ce que la facture
--      porte, ou quand la facture a plusieurs taux ; acceptée quand ils tiennent, quand le déclaré couvre le reçu, et quand le
--      registre est vide.
--
-- Deux dossiers jetables du cabinet du dossier `test` (préfixe `a8520000-0000-4000-8000`) : DR, nu, et DQ, basculé, en
-- trésorerie, redevable ; sa pièce de vente P (120 € TTC, datée du 20 novembre de N), déclarée vente hors des factures et validée ; la
-- facture de l'ancien logiciel R-Q2-1 dont P est l'original, importée à chaque étape sous la forme qu'elle demande — à un
-- taux (100 € HT à 20 %, 120 € TTC), ou à deux (100 € HT à 20 % et 100 € HT à 10 %, 230 € TTC) —, et ce qu'elle déclare
-- encaissé avant la reprise. N est l'année qui précède la date de reprise (le premier jour du mois de Paris) ; les
-- paiements de P sont du 10 décembre de N, les encaissements du registre du jour de la reprise. Chaque étape se joue dans
-- sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord (un paiement que seules les
-- gardes de leurs tables refuseraient d'écrire à la main : leurs déclencheurs coupés le temps de l'insérer), ce que le chef
-- pose ensuite (l'import, un paiement, un encaissement, la citation), puis la requête ; le jeu s'annule à la fin
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.recu_par_la_piece_citee`) : le fichier se joue d'un seul appel, ne crée ni table ni fonction, ne
-- contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de son dossier. Hors de l'outil
-- d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dq constant text := 'a8520000-0000-4000-8000-0000000000d1';
  p constant text := 'a8520000-0000-4000-8000-0000000000b1';
  m1 constant text := 'a8520000-0000-4000-8000-0000000000e1';
  m2 constant text := 'a8520000-0000-4000-8000-0000000000e2';
  m3 constant text := 'a8520000-0000-4000-8000-0000000000e3';
  o1 constant text := 'a8520000-0000-4000-8000-0000000000f1';
  o2 constant text := 'a8520000-0000-4000-8000-0000000000f2';
  -- Un second dossier jetable du même cabinet, ses mouvements et sa caisse : ce qu'une pièce de DQ a reçu ne lit pas ce
  -- qu'un autre dossier dirait d'elle (étape 1b).
  dr constant text := 'a8520000-0000-4000-8000-0000000000d2';
  m4 constant text := 'a8520000-0000-4000-8000-0000000000e4';
  m5 constant text := 'a8520000-0000-4000-8000-0000000000e5';
  o3 constant text := 'a8520000-0000-4000-8000-0000000000f3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  reprise constant date := date_trunc('month', now() at time zone 'Europe/Paris')::date;
  date_p constant date := make_date(extract(year from reprise)::integer - 1, 11, 20);
  date_m constant date := make_date(extract(year from reprise)::integer - 1, 12, 10);
  -- La migration en base : sa dernière ligne d'historique est la sienne, pas celle de son retour.
  appliquee constant boolean := coalesce((select m.name = 'recu_par_la_piece_citee' from supabase_migrations.schema_migrations m
    where m.name in ('recu_par_la_piece_citee', 'retour_recu_par_la_piece_citee') order by m.version desc limit 1), false);
  -- La facture de l'ancien logiciel : à un taux, ou à deux ; ce qu'elle déclare encaissé avant la reprise, au total et par taux.
  un_taux constant text := '[{"numero": "R-Q2-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q2",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 100,
    "montant_tva": 20, "montant_ttc": 120, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E}}],
    "lignes": [{"designation": "Prestation", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20}], "transmise_par": "pdf"}]';
  deux_taux constant text := '[{"numero": "R-Q2-1", "type": "facture", "date_emission": "{DP}", "tiers_nom": "Client Q2",
    "type_client": "non_assujetti", "nature_operation": "services", "option_debits": false, "montant_ht": 200,
    "montant_tva": 30, "montant_ttc": 230, "encaisse_avant_reprise": {E}, "encaisse_par_taux": [{"taux": 20, "encaisse": {E20}}, {"taux": 10, "encaisse": {E10}}],
    "lignes": [{"designation": "Prestation A", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 20},
               {"designation": "Prestation B", "quantite": 1, "prix_unitaire_ht": 100, "taux_tva": 10}], "transmise_par": "pdf"}]';
  importer constant text := $q$select fixer_reprise_des_factures('{DQ}', '{R}'); select importer_factures('{DQ}', '{"format": "csv"}'::jsonb, '{L}'::jsonb);$q$;
  -- P payée en N par un mouvement rapproché, du montant {PAYE}.
  payee constant text := $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
    ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2 PAIEMENT', {PAYE}, 'non_rapprochee', null, false);
    update lignes_bancaires set piece_id = '{P}', statut = 'rapprochee' where id = '{M1}';$q$;
  citer constant text := $q$select citer_piece_de_facture_reprise('{DQ}', {R1}, '{P}');$q$;
  encaisser constant text := $q$select enregistrer_encaissement('{DQ}', {R1}, '{R}', {MONTANT}, 'virement', null, '[{"taux": {TAUX}, "montant": {MONTANT}}]'::jsonb)$q$;
  -- Un encaissement accepté rend sa ligne : son identifiant le dit (une ligne dont un champ est nul n'est pas « not null »).
  encaisse constant text := $q$select (enregistrer_encaissement('{DQ}', {R1}, '{R}', {MONTANT}, 'virement', null, '[{"taux": {TAUX}, "montant": {MONTANT}}]'::jsonb)).id is not null$q$;
  plafond constant text := 'L''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste {RESTE} € à encaisser.';
  plusieurs_taux constant text := 'La pièce citée par la facture reprise R-Q2-1 a reçu, avant la reprise, plus que l''import n''en déclare encaissé, et la facture porte plusieurs taux de TVA : l''application ne devine pas sur lesquels ce paiement a porté, et la facture ne reçoit pas d''encaissement : le cabinet reprend d''abord son import, en y déclarant, taux par taux, ce que sa pièce a reçu.';
  e record; v_code text; v_msg text; v_req text; v_pose text; v_super text; v_obs text; v_f record; v_texte text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.recu_par_la_piece_citee', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration recu_par_la_piece_citee (A8Q5Q3-Q2)', 'ok', true,
      'observe', 'absente : l''essai se joue dès qu''elle y est ; pieceDejaCompteeDUneReprise.sql (étape 5) rend le double compte'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures, statut_tva, siret,
                          adresse, forme_juridique, denomination_imprimee) values
      (dq::uuid, 'ESSAI A8Q5Q3Q2 DQ', cabinet, 'tresorerie', '455000', true, 'redevable', '12345678200010',
       'ESSAI A8Q5Q3Q2 ADRESSE', '5710', 'ESSAI A8Q5Q3Q2 SOCIÉTÉ');
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (dr::uuid, 'ESSAI A8Q5Q3Q2 DR', cabinet, 'tresorerie', '455000');
    insert into pieces (id, dossier_id, storage_path, nom_fichier, storage_hash, type_piece, statut, date_piece, montant_ht,
                        montant_tva, montant_ttc) values
      (p::uuid, dq::uuid, dq || '/essai-q2-p.pdf', 'essai-q2-p.pdf', repeat('b', 64), 'vente', 'a_valider', date_p, 100, 20, 120);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform declarer_vente_hors_des_factures(dq::uuid, p::uuid);
    update pieces set statut = 'validee' where id = p::uuid;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    -- Une étape : {rang, étape, ce que le propriétaire pose d'abord, ce que le chef pose ensuite, la requête, qui la joue —
    -- `chef`, ou `postgres` (le propriétaire) —, le code attendu (`OK` : acceptée) et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      (1, '1. ce qu''une pièce a reçu : un mouvement rapproché (120), la part d''un virement groupé (30), un paiement par la caisse (25) — pas un mouvement à traiter qui la cite, ni une opération de caisse retirée',
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
             ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2 RAPPROCHE', 120, 'rapprochee', '{P}', false),
             ('{M2}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2 GROUPE', 75, 'rapprochee', null, true),
             ('{M3}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2 A TRAITER', 999, 'non_rapprochee', '{P}', false);
           alter table reglements_groupes disable trigger user; alter table operations_caisse disable trigger user;
           insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DQ}', '{M2}', '{P}', 30);
           insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine) values
             ('{O1}', '{DQ}', 'paiement', '{DM}', 25, '{P}', 'cabinet'),
             ('{O2}', '{DQ}', 'paiement', '{DM}', 7, '{P}', 'cabinet');
           update operations_caisse set retire_le = now() where id = '{O2}';
           alter table reglements_groupes enable trigger user; alter table operations_caisse enable trigger user;$q$,
        null, $q$select recu_par_la_piece('{P}')::text$q$, 'postgres', 'OK', '17500'),
      (1, '1b. … de son dossier seulement : un mouvement, la part d''un virement groupé et un paiement par la caisse d''un AUTRE dossier qui la citent n''y entrent pas',
        $q$insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, reglement_groupe) values
             ('{M1}', '{DQ}', '{DM}', 'ESSAI A8Q5Q3Q2 RAPPROCHE', 120, 'rapprochee', '{P}', false),
             ('{M4}', '{DR}', '{DM}', 'ESSAI A8Q5Q3Q2 AUTRE DOSSIER', -120, 'rapprochee', '{P}', false),
             ('{M5}', '{DR}', '{DM}', 'ESSAI A8Q5Q3Q2 AUTRE GROUPE', 75, 'rapprochee', null, true);
           alter table reglements_groupes disable trigger user; alter table operations_caisse disable trigger user;
           insert into reglements_groupes (dossier_id, ligne_bancaire_id, piece_id, montant) values ('{DR}', '{M5}', '{P}', 30);
           insert into operations_caisse (id, dossier_id, genre, date, montant, piece_id, origine) values
             ('{O3}', '{DR}', 'paiement', '{DM}', 25, '{P}', 'cabinet');
           alter table reglements_groupes enable trigger user; alter table operations_caisse enable trigger user;$q$,
        null, $q$select recu_par_la_piece('{P}')::text$q$, 'postgres', 'OK', '12000'),
      (2, '2. recu_par_la_piece n''est exécutable par aucun rôle de session',
        null, null, $q$select recu_par_la_piece('{P}')::text$q$, 'chef', '42501', 'permission denied for function recu_par_la_piece'),
      (3, '3. un taux, la pièce a reçu 120, l''import déclare 0 : le registre n''encaisse pas la même vente une seconde fois',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '120') || citer,
        replace(replace(encaisser, '{MONTANT}', '120'), '{TAUX}', '20'), 'chef', '22023', replace(plafond, '{RESTE}', '0,00')),
      (4, '4. reprise_de_la_facture rend ce que la pièce a reçu (septième clé), en centimes',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50') || citer,
        $q$select reprise_de_la_facture('{DQ}', {R1}) ->> 'recu_par_sa_piece_centimes'$q$, 'chef', 'OK', '5000'),
      (5, '5. un taux, la pièce a reçu 50, l''import déclare 0 : 70 s''encaissent',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50') || citer,
        replace(replace(encaisse, '{MONTANT}', '70'), '{TAUX}', '20'), 'chef', 'OK', 'true'),
      (6, '6. … et 71 se refusent : il reste 70,00 €',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50') || citer,
        replace(replace(encaisser, '{MONTANT}', '71'), '{TAUX}', '20'), 'chef', '22023', replace(plafond, '{RESTE}', '70,00')),
      (7, '7. un taux, la pièce a reçu 50, l''import déclare 80 : le déclaré l''emporte, il reste 40,00 €',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '80') || replace(payee, '{PAYE}', '50') || citer,
        replace(replace(encaisser, '{MONTANT}', '41'), '{TAUX}', '20'), 'chef', '22023', replace(plafond, '{RESTE}', '40,00')),
      (8, '8. deux taux, la pièce a reçu 30, l''import déclare 0 : l''encaissement se refuse plutôt que deviner la répartition',
        null, replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '0'), '{E10}', '0'), '{E}', '0') || replace(payee, '{PAYE}', '30') || citer,
        replace(replace(encaisser, '{MONTANT}', '10'), '{TAUX}', '20'), 'chef', '22023', plusieurs_taux),
      (9, '9. deux taux, l''import déclare 100 (90 à 20 %, 10 à 10 %), la pièce a reçu 30 : le déclaré se juge taux par taux, 100 s''encaissent à 10 %',
        null, replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '90'), '{E10}', '10'), '{E}', '100') || replace(payee, '{PAYE}', '30') || citer,
        replace(replace(encaisse, '{MONTANT}', '100'), '{TAUX}', '10'), 'chef', 'OK', 'true'),
      (10, '10. … et 101 à 10 % se refusent, au plafond du taux : il reste 100,00 €',
        null, replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '90'), '{E10}', '10'), '{E}', '100') || replace(payee, '{PAYE}', '30') || citer,
        replace(replace(encaisser, '{MONTANT}', '101'), '{TAUX}', '10'), 'chef', '22023',
        'À 10 %, l''encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 100,00 € à encaisser à ce taux.'),
      (11, '11. la citation, un taux : le registre a reçu 100, la pièce 50 — ensemble, plus que la facture : refusée',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50')
          || replace(replace(encaisser, '{MONTANT}', '100'), '{TAUX}', '20') || ';',
        citer, 'chef', '23514',
        'La pièce « essai-q2-p.pdf » a reçu 50,00 € avant la reprise, et le registre de la facture reprise R-Q2-1 en a déjà reçu 100,00 € : ensemble, ils dépassent ce qu''elle porte (120,00 €, nette de ses avoirs), et la même vente compterait deux fois. Retirer d''abord ces encaissements, ou citer une autre pièce.'),
      (12, '12. la citation, un taux : le registre a reçu 70, la pièce 50 — ils font juste ce qu''elle porte : acceptée',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50')
          || replace(replace(encaisser, '{MONTANT}', '70'), '{TAUX}', '20') || ';',
        replace(citer, ';', '') || ' is not null', 'chef', 'OK', 'true'),
      (12, '12b. … le registre a reçu 71 : un centime de trop, refusée',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '50')
          || replace(replace(encaisser, '{MONTANT}', '71'), '{TAUX}', '20') || ';',
        citer, 'chef', '23514',
        'La pièce « essai-q2-p.pdf » a reçu 50,00 € avant la reprise, et le registre de la facture reprise R-Q2-1 en a déjà reçu 71,00 € : ensemble, ils dépassent ce qu''elle porte (120,00 €, nette de ses avoirs), et la même vente compterait deux fois. Retirer d''abord ces encaissements, ou citer une autre pièce.'),
      (13, '13. la citation, deux taux : le registre a reçu 10, la pièce 30, l''import 0 — refusée plutôt que deviner',
        null, replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '0'), '{E10}', '0'), '{E}', '0') || replace(payee, '{PAYE}', '30')
          || replace(replace(encaisser, '{MONTANT}', '10'), '{TAUX}', '20') || ';',
        citer, 'chef', '23514',
        'La pièce « essai-q2-p.pdf » a reçu, avant la reprise, plus que l''import de la facture reprise R-Q2-1 n''en déclare encaissé, et la facture porte plusieurs taux de TVA : son registre, qui a déjà reçu des encaissements, ne saurait plus sur lesquels ce paiement a porté. Retirer d''abord ces encaissements, ou reprendre l''import en y déclarant, taux par taux, ce que la pièce a reçu.'),
      (14, '14. la citation, deux taux, le registre vide : acceptée (l''encaissement, lui, se refusera)',
        null, replace(replace(replace(replace(importer, '{L}', deux_taux), '{E20}', '0'), '{E10}', '0'), '{E}', '0') || replace(payee, '{PAYE}', '30'),
        replace(citer, ';', '') || ' is not null', 'chef', 'OK', 'true'),
      (15, '15. la citation, le déclaré (80) couvre le reçu (50) : acceptée, le registre ayant reçu 30',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '80') || replace(payee, '{PAYE}', '50')
          || replace(replace(encaisser, '{MONTANT}', '30'), '{TAUX}', '20') || ';',
        replace(citer, ';', '') || ' is not null', 'chef', 'OK', 'true'),
      (16, '16. le lien retiré (la pièce n''est plus l''original) : le registre repart du déclaré, 120 s''encaissent',
        null, replace(replace(importer, '{L}', un_taux), '{E}', '0') || replace(payee, '{PAYE}', '120') || citer
          || $q$select retirer_piece_de_facture_reprise('{DQ}', {R1});$q$,
        replace(replace(encaisse, '{MONTANT}', '120'), '{TAUX}', '20'), 'chef', 'OK', 'true')
    ) as t(rang, etape, pose_super, pose, requete, profil, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null; v_pose := null; v_req := null; v_super := null;
      begin
        for v_f in select x.rang, x.texte from (values (0, e.pose_super), (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(replace(v_f.texte, '{DQ}', dq), '{P}', p), '{M1}', m1), '{M2}', m2);
          v_texte := replace(replace(replace(replace(v_texte, '{M3}', m3), '{O1}', o1), '{O2}', o2), '{R}', reprise::text);
          v_texte := replace(replace(v_texte, '{DP}', date_p::text), '{DM}', date_m::text);
          v_texte := replace(replace(replace(replace(v_texte, '{DR}', dr), '{M4}', m4), '{M5}', m5), '{O3}', o3);
          v_texte := replace(v_texte, '{R1}', '(select f.id from factures_emises f where f.dossier_id = ''' || dq || ''' and f.numero = ''R-Q2-1'')');
          if v_f.rang = 0 then v_super := v_texte; elsif v_f.rang = 1 then v_pose := v_texte; else v_req := v_texte; end if;
        end loop;
        if v_super is not null then
          execute v_super;
        end if;
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        if v_pose is not null then
          execute v_pose;
        end if;
        if e.profil = 'postgres' then
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        begin
          execute 'select (' || rtrim(v_req, ';') || ')::text' into v_obs;
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

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni la pièce, ses paiements, ses factures, ses encaissements',
    'ok', not exists (select 1 from dossiers where id in (dq::uuid, dr::uuid))
      and not exists (select 1 from pieces where id = p::uuid)
      and not exists (select 1 from lignes_bancaires where id in (m1::uuid, m2::uuid, m3::uuid, m4::uuid, m5::uuid))
      and not exists (select 1 from operations_caisse where id in (o1::uuid, o2::uuid, o3::uuid))
      and not exists (select 1 from factures_emises where dossier_id = dq::uuid)
      and not exists (select 1 from encaissements_factures where dossier_id = dq::uuid),
    'observe', 'relu');
  perform set_config('essai.recu_par_la_piece_citee', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.recu_par_la_piece_citee')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
