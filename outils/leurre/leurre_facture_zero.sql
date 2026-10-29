-- LA FACTURE « ZÉRO » DU LEURRE (outils/leurre/banc.py ; SUR UNE RÉPLIQUE SEULEMENT), posée APRÈS le remplisseur : rien
-- ne la cite (ni transmission, ni encaissement, ni statut), comme une facture réelle que rien n'a encore réglée.
\set ON_ERROR_STOP on
begin;
-- Une seconde facture de A, validée et SANS encaissement, au plus petit identifiant de la base : un essai qui prend « la
-- première facture validée » la prend, comme il prendrait une facture réelle que rien n'a encore réglée.
insert into factures_emises (id, dossier_id, statut, date_emission, tiers_nom, tiers_adresse, montant_ht, montant_tva, montant_ttc,
                             emetteur_nom, emetteur_siret, emetteur_adresse, type, nature_operation, type_client)
values ('00000000-0000-4000-8000-00000000fac0', '00000000-0000-4000-8000-00000000a001', 'brouillon', '2025-07-01',
        'LEURRE-7Q3-A Patient facturé', 'LEURRE-7Q3-A 4 rue du Patient, 99999 Leurreville', 7357.31, 0, 7357.31,
        'LEURRE-7Q3-A EI', '99973573100013', 'LEURRE-7Q3-A 1 rue du Leurre, 99999 Leurreville', 'facture', 'services', 'non_assujetti');
insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
values ('00000000-0000-4000-8000-00000000fac0', 0, 'LEURRE-7Q3-A soins du patient', 1, 7357.31, 0);
select set_config('request.jwt.claims', '{"sub":"bd6bd047-0ef0-4c9d-a319-1b642aaf2162","role":"authenticated"}', true);
set local role authenticated;
select f.numero is not null as facture_zero from public.enregistrer_facture('00000000-0000-4000-8000-00000000a001',
  '00000000-0000-4000-8000-00000000fac0',
  jsonb_build_object('tiers_nom', 'LEURRE-7Q3-A Patient facturé', 'tiers_adresse', 'LEURRE-7Q3-A 4 rue du Patient, 99999 Leurreville',
    'type_client', 'non_assujetti', 'emetteur_nom', 'LEURRE-7Q3-A EI', 'emetteur_siret', '99973573100013',
    'emetteur_adresse', 'LEURRE-7Q3-A 1 rue du Leurre, 99999 Leurreville', 'montant_ht', 7357.31, 'montant_tva', 0, 'montant_ttc', 7357.31,
    'nature_operation', 'services', 'date_emission', '2025-07-01'),
  jsonb_build_array(jsonb_build_object('designation', 'LEURRE-7Q3-A soins du patient', 'quantite', 1, 'prix_unitaire_ht', 7357.31, 'taux_tva', 0)),
  true) f;
reset role;
select set_config('request.jwt.claims', '', true);

commit;
