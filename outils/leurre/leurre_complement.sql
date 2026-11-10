-- LES TABLES QUE LE REMPLISSEUR DU BANC NE SAIT PAS REMPLIR, POUR LE LEURRE (outils/leurre/banc.py ; SUR UNE RÉPLIQUE
-- SEULEMENT) : une ligne marquée par dossier de leurre, écrite à la main selon les CHECK de la table, déclencheurs coupés
-- — dix tables de dossier, et deux sans `dossier_id` qui porteront des données réelles ; sur la réplique qui porte une
-- migration préparée, ses tables aussi (la caisse hier, les devis, les factures reprises, la numérotation qui continue),
-- chacune sous `to_regclass`.
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;
create temporary table lc (x text, h text, pfx text, d uuid, m text, montant numeric, chef uuid) on commit drop;
insert into lc values
  ('A', 'a', '00000000', '00000000-0000-4000-8000-00000000a001', 'LEURRE-7Q3-A', 7357.31, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'),
  ('Z', 'b', 'fffffff0', 'fffffff0-0000-4000-8000-00000000a002', 'LEURRE-7Q3-Z', 7357.32, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'),
  ('N', 'c', '7e57e000', '7e570000-0000-4000-8000-00000000a003', 'LEURRE-7Q3-N', 7357.33, '7e570000-0000-4000-8000-00000000c003');

insert into dossier_permanent (dossier_id, nature, titre, texte, auteur)
  select d, 'description', m || ' titre du dossier permanent', m || ' texte du dossier permanent', chef from lc;
insert into pieces_hors_de_france (id, dossier_id, piece_id, numero, date_facture, type_document, devise, pays, schema_identifiant,
                                   identifiant, nature, autoliquidation, cree_par)
  select (pfx || '-0000-4000-8000-0000000004' || h || '1')::uuid, d, (pfx || '-0000-4000-8000-0000000001' || h || '1')::uuid,
         'LEURRE7Q3' || x || '1', '2025-06-17', '380', 'USD', 'DE', '0223', 'DELEURRE7Q3' || x, 'services', true, chef from lc;
insert into pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte)
  select (pfx || '-0000-4000-8000-0000000004' || h || '1')::uuid, d, 'E', 0, montant, 0, 'VATEX-EU-132', m || ' motif du taux' from lc;
insert into revision_conclusions (id, dossier_id, annee, cycle, etat, travaux, conclusion, a_suivre, auteur)
  select (pfx || '-0000-4000-8000-0000000005' || h || '1')::uuid, d, 2025, 'tresorerie', 'revise',
         jsonb_build_array(m || ' travaux'), m || ' conclusion de la révision', m || ' à suivre', chef from lc;
insert into revision_preuves (dossier_id, justification_id, piece_id, empreinte, precision)
  select lc.d, (select j.id from revision_justifications j where j.dossier_id = lc.d order by 1 limit 1),
         (pfx || '-0000-4000-8000-0000000001' || h || '1')::uuid, md5(m) || md5(m || 'preuve'), m || ' précision de la preuve' from lc;
insert into revision_revues (dossier_id, annee, conclusion_id, avis, observation, revu_par)
  select d, 2025, (pfx || '-0000-4000-8000-0000000005' || h || '1')::uuid, 'a_reprendre', m || ' observation de la revue', chef from lc;
insert into soldes_reportes (dossier_id, date, compte, libelle, sens, montant, source_nom, source_empreinte)
  select d, '2026-01-01', '411000', m || ' solde reporté', 'debit', montant, m || ' balance.csv', md5(m) || md5(m || 'solde') from lc;
insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, message_id, emis_le, createur_role, date_statut,
                                    motifs, commentaire)
  select lc.d, (select f.id from factures_emises f where f.dossier_id = lc.d order by 1 limit 1), 'leurre-7q3.example.test',
         m || '-flux', '200', m || '-message', '20250617100000', 'SE', '2025-06-17', m || ' motifs du statut',
         m || ' commentaire du statut' from lc;
insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, detail, note, cree_par)
  select lc.d, e.id, e.facture_id, 'manuel', 'leurre-7q3.example.test', 'depose', m || ' détail de la déclaration',
         m || ' note de la déclaration', chef
    from lc join encaissements_factures e on e.dossier_id = lc.d;
insert into ventilations_bancaires (dossier_id, ligne_bancaire_id, categorie_id, part_personnelle, montant)
  select d, (pfx || '-0000-4000-8000-0000000002' || h || '2')::uuid, (pfx || '-0000-4000-8000-0000000003' || h || '1')::uuid,
         false, -100 from lc;
-- Deux tables sans `dossier_id` qui porteront des données réelles : un mouvement du compte courant d'associé (son
-- libellé), et un tiers appris par le cabinet (le nom d'un fournisseur réel, normalisé).
insert into mouvements_cca (compte_id, date, type, montant, libelle, created_by)
  select c.id, '2025-06-22', 'apport', lc.montant, lc.m || ' apport en compte courant', lc.chef
    from lc join comptes_courants_associes c on c.dossier_id = lc.d;
insert into tiers_categories_cabinet (tiers_normalise, categorie_id, cabinet_id)
  select lower(lc.m) || ' fournisseur appris', (pfx || '-0000-4000-8000-0000000003' || h || '1')::uuid,
         (select d.cabinet_id from dossiers d where d.id = lc.d) from lc;

-- La caisse (migration `caisse`, sur la réplique qui la porte) : une opération par leurre, sans texte libre (la table
-- n'en a pas) ; son montant est le marqueur.
do $caisse$
begin
  if to_regclass('public.operations_caisse') is not null then
    execute $i$insert into public.operations_caisse (dossier_id, genre, date, montant, origine, cree_par)
      select d, 'apport', '2025-06-19', montant, 'cabinet', chef from lc$i$;
  end if;
end $caisse$;
-- Les devis (migration `devis_du_client`, étape P5, sur la réplique qui la porte) : un devis émis et accepté par leurre,
-- chaque texte libre marqué, selon les CHECK de la table (le numéro de sa série, l'adresse électronique d'un assujetti,
-- une prestation de services sans livraison) ; et son lien à la première facture du leurre, que le remplisseur ne sait
-- pas composer (le devis lui manque).
do $devis$
begin
  if to_regclass('public.devis') is not null then
    execute $i$insert into public.devis (id, dossier_id, numero, statut, date_emission, date_validite, objet, tiers_nom,
        tiers_adresse, tiers_siret, tiers_email, type_client, tiers_siren, tiers_adresse_electronique, numero_engagement,
        nature_operation, date_prestation, lignes, montant_ht, montant_tva, montant_ttc, conditions, mentions_legales, notes,
        emetteur_nom, emetteur_siret, emetteur_adresse, cree_par, emis_par, emis_le, reponse, date_reponse, decide_par,
        decide_le)
      select (pfx || '-0000-4000-8000-0000000006' || h || '1')::uuid, d, 'D2025-0001', 'emis', '2025-06-17', '2025-07-17',
             m || ' objet du devis', m || ' client du devis', m || ' adresse du client du devis', s || '00017',
             'leurre-7q3-' || lower(x) || '@example.test', 'assujetti', s, s, m || ' engagement', 'services', '2025-06-17',
             jsonb_build_array(jsonb_build_object('designation', m || ' ligne du devis', 'quantite', 1,
                                                  'prix_unitaire_ht', montant, 'taux_tva', 20)),
             montant, round(montant * 0.2, 2), montant + round(montant * 0.2, 2), m || ' conditions du devis',
             m || ' mentions du devis', m || ' notes du devis', m || ' émetteur du devis', s || '00025',
             m || ' adresse de l''émetteur du devis', chef, chef, '2025-06-17 10:00:00+02', 'acceptee', '2025-06-20', chef,
             '2025-06-20 10:00:00+02'
        from lc cross join lateral (select case x when 'A' then '999735731' when 'Z' then '999735749' else '999735756' end) as sn(s)$i$;
    execute $i$insert into public.devis_factures (id, dossier_id, devis_id, facture_id, cree_par)
      select (pfx || '-0000-4000-8000-0000000006' || h || '2')::uuid, lc.d, (pfx || '-0000-4000-8000-0000000006' || h || '1')::uuid,
             (select f.id from factures_emises f where f.dossier_id = lc.d order by 1 limit 1), chef from lc$i$;
  end if;
end $devis$;
-- Les factures reprises (migration `factures_importees`, étape A8a, sur la réplique qui la porte) : une facture reprise par
-- leurre, son lot et sa ligne, chaque texte libre marqué, selon les CHECK des tables (un numéro de la forme de G1.05, la
-- marque de source et l'option d'une reprise, la plateforme nommée).
do $reprises$
begin
  if to_regclass('public.factures_importees') is not null then
    execute $i$insert into public.factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, tiers_adresse,
        type_client, nature_operation, option_debits, montant_ht, montant_tva, montant_ttc, source_de_la_vente, created_by)
      select (pfx || '-0000-4000-8000-0000000007' || h || '1')::uuid, d, 'LEURRE7Q3' || x || 'R', 'importee', 'facture',
             '2025-06-18', m || ' client de la facture reprise', m || ' adresse du client repris', 'non_assujetti', 'services',
             false, montant, 0, montant, true, chef from lc$i$;
    execute $i$insert into public.imports_factures (id, dossier_id, format, nombre_factures, importe_par)
      select (pfx || '-0000-4000-8000-0000000007' || h || '2')::uuid, d, 'csv', 1, chef from lc$i$;
    execute $i$insert into public.factures_importees (facture_id, dossier_id, import_id, rang, ligne_csv, encaisse_avant_reprise,
        encaisse_par_taux, encaisse_au_prorata, transmise_par, plateforme_nom)
      select (pfx || '-0000-4000-8000-0000000007' || h || '1')::uuid, d, (pfx || '-0000-4000-8000-0000000007' || h || '2')::uuid,
             1, 2, montant, jsonb_build_array(jsonb_build_object('taux', 0, 'encaisse', montant)), false, 'plateforme',
             m || ' plateforme de la facture reprise' from lc$i$;
  end if;
end $reprises$;
-- La numérotation qui continue (migration `numerotation_continue`, étape A9a, sur la réplique qui la porte, par-dessus celle
-- des factures reprises) : un modèle de numéro par leurre et la fin confirmée de sa suite reprise, le modèle et le motif
-- marqués, selon les CHECK des tables (un modèle que `refus_du_modele` reçoit, un compteur continu rangé à l'année 0, une
-- fin d'un seul numéro). Déclencheurs coupés : la garde des deux tables n'y voit pas la fonction qui les pose.
do $numerotation$
begin
  if to_regclass('public.modeles_numerotation') is not null then
    execute $i$insert into public.modeles_numerotation (id, dossier_id, nature, emetteur, modele, annuel, depuis, premier_numero,
        pose_par)
      select (pfx || '-0000-4000-8000-0000000008' || h || '1')::uuid, d, 'facture', 'client', 'LEURRE7Q3' || x || '-{N:4}', false,
             2025, 1, chef from lc$i$;
    execute $i$insert into public.continuite_des_series (id, dossier_id, modele, annuel, annee, geste, premier, dernier, motif,
        pose_par)
      select (pfx || '-0000-4000-8000-0000000008' || h || '2')::uuid, d, 'LEURRE7Q3' || x || '-{N:4}', false, 0, 'fin', 7, 7,
             m || ' motif de la fin confirmée', chef from lc$i$;
  end if;
end $numerotation$;
select 'complément', count(*) from dossier_permanent where dossier_id in (select d from lc);
commit;
