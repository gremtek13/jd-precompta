-- LES TABLES QUE LE REMPLISSEUR DU BANC NE SAIT PAS REMPLIR, POUR LE LEURRE (outils/leurre/banc.py ; SUR UNE RÉPLIQUE
-- SEULEMENT) : une ligne marquée par dossier de leurre, écrite à la main selon les CHECK de la table, déclencheurs coupés
-- — dix tables de dossier, et deux sans `dossier_id` qui porteront des données réelles.
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
select 'complément', count(*) from dossier_permanent where dossier_id in (select d from lc);
commit;
