-- LE JEU DE DÉPART DES DIX ESSAIS QUI LE CHERCHENT EN PRODUCTION (outils/leurre/banc.py, famille « jeu_de_depart » ; SUR
-- UNE RÉPLIQUE SEULEMENT, par le super-utilisateur ; écrit au lot de R1, repris tel quel) : affectation,
-- compteBilan, cotisationRapprochee, dotations, echeanceEmprunt, laBaseLitLePlan, reglementGroupe, reglesAffectation,
-- ventilation, virementPersonnel. Ce qu'ils y cherchent (leurs préconditions, « ESSAI_IMPOSSIBLE ») : le dossier `test` en
-- trésorerie, compte du dirigeant 455000 en engagement, sans écriture ni exercice validé ; ses mouvements à traiter (deux
-- sorties et une entrée d'au moins dix euros), un mouvement rapproché d'une pièce, un mouvement ignoré par une règle (pas
-- personnel), un virement personnel classé avant son écriture ; trois pièces d'achat et deux de vente ; dans le dossier du
-- client, un mouvement à traiter (une sortie d'au moins dix euros) et une pièce d'achat ; les catégories communes avec leur
-- compte ; la nature commune « Informatique (ordinateur, imprimante...) ».
--
-- TOUT EST FICTIF : les identifiants que les essais nomment (le dossier `test`, le chef, le client, le dossier du client)
-- sont ceux que le semis de la réplique a déjà posés ; les comptes des catégories, les libellés, les montants et les dates
-- sont inventés ici, rien n'est recopié de la production. Le banc le joue sur une copie de la réplique égale à la
-- production : la base qu'il rend est celle que les sessions précédentes semaient à la main (comparée table par table le
-- 29/10/2026 : identique, hors l'identifiant tiré de la nature commune).

-- Les catégories communes : un compte de charge ou de produit à chacune (l'essai de l'affectation affecte un paiement à
-- « autre »), et un poste de la 2035.
update categories set compte_comptable = v.compte, poste_2035 = v.poste
  from (values ('achats_fournisseurs', '606000', 'Achats'),
               ('loyer', '613200', 'Loyers et charges locatives'),
               ('assurance', '616000', 'Primes d''assurance'),
               ('carburant_deplacements', '625100', 'Frais de voyage et de déplacement'),
               ('notes_frais', '625700', 'Frais de réception, de représentation et de congrès'),
               ('honoraires', '622600', 'Honoraires ne constituant pas des rétrocessions'),
               ('frais_bancaires', '627000', 'Frais financiers'),
               ('ventes_prestations', '706000', 'Recettes encaissées'),
               ('autre', '628000', 'Autres frais divers de gestion')) v(code, compte, poste)
 where categories.dossier_id is null and categories.code = v.code;

-- La nature commune que l'essai des dotations cherche par son libellé, au 218300 (« Sa nature (Informatique) porte le
-- 218300 », dotations.sql).
insert into natures_immobilisation (dossier_id, libelle, duree_annees_defaut, ordre, compte_immobilisation)
values (null, 'Informatique (ordinateur, imprimante...)', 3, 20, '218300');

-- Les pièces du dossier `test` : trois achats et deux ventes en tout (une de chaque est déjà posée).
insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, date_piece, montant_ttc, tiers) values
  ('91ece000-0000-4000-8000-000000000005', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/achat-3.pdf', 'achat-3.pdf', 'achat', 'a_valider', '2026-02-02', 84, 'FOURNISSEUR FICTIF'),
  ('91ece000-0000-4000-8000-000000000006', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/achat-4.pdf', 'achat-4.pdf', 'achat', 'a_valider', '2026-02-04', 36.5, 'PAPETERIE FICTIVE'),
  ('91ece000-0000-4000-8000-000000000007', '001c7ed7-c23b-4590-901e-693489f8af24', '001c7ed7-c23b-4590-901e-693489f8af24/vente-3.pdf', 'vente-3.pdf', 'vente', 'a_valider', '2026-02-06', 150, 'PATIENT FICTIF');

-- Les mouvements du dossier `test`.
insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, piece_id, prelevement_personnel) values
  ('5e1e0000-0000-4000-8000-000000000001', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-03', 'PRLV SEPA FOURNISSEUR FICTIF', -84, 'non_rapprochee', null, false),
  ('5e1e0000-0000-4000-8000-000000000002', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-05', 'CB PAPETERIE FICTIVE', -36.5, 'non_rapprochee', null, false),
  ('5e1e0000-0000-4000-8000-000000000003', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-07', 'VIR PATIENT FICTIF', 150, 'non_rapprochee', null, false),
  ('5e1e0000-0000-4000-8000-000000000004', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-10', 'PRLV ACHAT FICTIF', -18, 'rapprochee', '91ece000-0000-4000-8000-000000000003', false),
  ('5e1e0000-0000-4000-8000-000000000005', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-12', 'FRAIS TENUE DE COMPTE FICTIFS', -12, 'ignoree', null, false),
  ('5e1e0000-0000-4000-8000-000000000006', '001c7ed7-c23b-4590-901e-693489f8af24', '2026-02-15', 'VIR VERS COMPTE PERSONNEL FICTIF', -300, 'ignoree', null, true);

-- Les mouvements du dossier du client.
insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut) values
  ('5e1e0000-0000-4000-8000-000000000011', 'ac538d93-7da3-4403-bca6-2d7836810a6f', '2026-02-04', 'PRLV CLIENT FICTIF', -45, 'non_rapprochee'),
  ('5e1e0000-0000-4000-8000-000000000012', 'ac538d93-7da3-4403-bca6-2d7836810a6f', '2026-02-08', 'VIR CLIENT FICTIF', 60, 'non_rapprochee');
