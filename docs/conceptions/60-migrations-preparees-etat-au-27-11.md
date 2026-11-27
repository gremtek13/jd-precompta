# Les migrations préparées : leur état au 27/11/2026, la production à 259

La répétition générale du 14/11/2026 (218 migrations) rejouée sur la base d'aujourd'hui : une copie de la réplique portée à
254 par les fichiers de l'export, chacun avec sa ligne d'historique, puis à 255 par `frontiere_de_la_tenue` (OPT6), appliquée
en production par l'outil le 27/11/2026 pendant la répétition, sous la version `20261127053521`, au texte du fichier préparé
(`122c3941…`, que l'export reçoit sous cette version) : dérive 255 `7f7b434c…`, socle 84 `e54200f4…`, inventaire 3 523
`2d71d9f1…`, égaux à la production et aux fichiers (OPT6 simulée dans l'export). Les 21 autres fichiers de
`supabase/preparees/` (hors `retour/`). Le récit : HISTORIQUE.md, « 27/11/2026 — LA RÉPÉTITION DES MIGRATIONS PRÉPARÉES
REFAITE À 254, PUIS À 255 ».

« Seule » : appliquée sur 255 après ses seules dépendances déclarées ; son essai, puis ceux des trois tables que la frontière
de la tenue garde (`frontiereDeLaTenue` 15/15, `validationExercice` 250/250, `situationsPubliees` 38/38, `ecrituresLibres`
67/0 et 6 mutations, `contrePassationDesEcrituresLibres` 50/0 et 12 mutations, justes avec chacune) ; une seconde application
(refusée par sa garde de tête, pour les 20) ; `rls.sql` entier (sans faute, pour les 20) ; son retour, puis la signature étendue
(neuf familles de `signature.sql`, le stockage, auth, les rôles, les commentaires, les données), égale à celle d'avant sauf
mention. « Mode » : ce que dit l'en-tête de la migration — « à coller » quand le texte porte un retrait (`drop`, `delete from`,
`truncate`), même dans un corps de fonction ou un commentaire ; « par l'outil », à coller si l'outil la retient quand même.
Tous les retours se collent.

**Depuis la répétition** (27/11/2026, sur l'accord du cabinet, REPET2-Q1 (A)) : les quatre premières lignes du tableau d'alors
sont en production et sorties du tableau, rangées dans `supabase/schema/` sous leur version d'historique, textes inchangés —
`compte_propre_hors_des_exercices_valides` (256, `20261127055505`, par l'outil) et `sous_dossier_dans_son_dossier` (257,
`20261127055603`, par l'outil), puis MCB5g : `ouverture_eclatee_par_compte` (258, `20261127055700`, collée par le cabinet) et
`ouverture_eclatee_a_la_validation` (259, `20261127142727`, par l'outil) ; `COMPTES_BANCAIRES_PREVUS` levé. Sur une copie de
`replique_227` portée à 259 par l'export (dérive `a540bcd9…`, inventaire 3 542 `58b4a599…`, égaux à la production ; socle 85
`585debf7…`) : les 16 autres s'appliquent encore SEULES, après leurs dépendances déclarées (e7a refuse, REPET-Q1), et EN CHAÎNE
dans l'ordre du tableau (275 migrations, les dix contraintes de paire des cinq sources neuves du brouillon posées) ; sur la
chaîne, `rls.sql` 346 lignes, 1 692 vérifications, 0 en faute, 220 mutations sur 220, aucune EN ATTENTE, et les essais
d'INV2, LIA2, AFF2, INV4, INV3, EXD2, INAL5, PC6, de la double authentification et de MCB5g justes. Les numéros d'ordre
ci-dessous restent ceux de la répétition.

| Ordre | Préparée | Chantier | Drapeau(x) | Mode | Après | Ce qu'elle attend | Seule, sur 255 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | `20261107140000_trois_cases_de_l_acces` | B1, trois cases de plus d'un accès | `TROIS_CASES_EXPORTEES` | par l'outil | — (P1-trace et C4a, en production) | B1-Q1, sans réponse | 16/16 |
| 6 | `20261111234000_documents_et_demandes` | B2, les documents et les demandes | `DOCUMENTS_ET_DEMANDES_PREVUS` | par l'outil | 5 | 5, puis l'accord | 81/0 ; la suppression 17/0 |
| 7 | `20261111237000_achats_du_client` | B4, les achats du client | `ACHATS_DU_CLIENT_PREVUS` | par l'outil | 5 | 5, puis l'accord | 63/0 |
| 8 | `20261111238000_notes_de_frais` | B7, les notes de frais | `NOTES_DE_FRAIS_PREVUES` | par l'outil | 5 | 5 ; L3-Q1 à Q3 (l'écran) | 84/0 |
| 9 | `20261112100000_lettres_du_client` | LM6, les lettres de mission au client | `DRAPEAU_DES_LETTRES_DU_CLIENT` | par l'outil | 5 (LM1, LM4 en production) | 5 ; l'acceptation en ligne reste fermée (LM-Q10) | 24/24 |
| 10 | `20261111239000_relance_des_demandes_par_email` | B3b, la relance d'une demande par e-mail | `RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE` ; `RELANCES_DE_DEMANDES_EN_BASE` (`send-email`) | à coller | 5 et 6 | 6 ; puis `send-email` déployée | 20/0, 4 sur 4 |
| 11 | `20261111191000_depart_du_client` | INAL5, le départ d'un client | `DEPART_DU_CLIENT_PREVU` | à coller (son en-tête) | — | l'accord (INAL-Q6 tranchée) | 49/0, 4 sur 4 |
| 12 | `20261106130000_identifiant_du_fichier_ereporting` | e6b, l'identifiant du fichier d'e-reporting | `IDENTIFIANT_DU_FICHIER_EXPORTE` | à coller | — | E6Q8-Q1 : avec le bouton de téléchargement | 18/0 |
| 13 | `20261112190000_operations_d_inventaire` | INV2, les opérations d'inventaire (hors BNC) | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | à coller | — | INV8 : 13, 16 et 17 avec les drapeaux, puis l'assistant | 92/0, 14 sur 14 |
| 14 | `20261112200000_stocks_de_cloture` | LIA2, les stocks de clôture (hors BNC) | `STOCKS_PREVUS` | à coller | — | l'accord (LIA-Q2, Q3 à leur recommandation) | 31/0, 5 sur 5 |
| 15 | `20261112233000_affectation_du_resultat` | AFF2, l'affectation du résultat (hors BNC) | `AFFECTATION_PREVUE`, `AFFECTATION_EXPORTEE` | à coller | — | l'accord | 58/0, 13 sur 13 |
| 16 | `20261112230000_provisions` | INV4, les provisions (hors BNC) | `INVENTAIRE_PREVU` | à coller | 13 | INV8 | 74/0, 8 sur 8 |
| 17 | `20261112235000_validation_de_l_inventaire` | INV3, la validation connaît l'inventaire (hors BNC) | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | par l'outil | 13 ; avant tout autre remplaçant de `valider_exercice` | INV8 | 71/0, 25 sur 25 |
| 18 | `20261112210000_exercices_du_dossier` | EXD2, les exercices du dossier | `EXERCICES_DECALES_PREVUS` | par l'outil (aucun retrait ; l'en-tête ne le dit pas) | — | EXD3 (à écrire), EXD-Q1 à Q8 ; hors de REPET-Q3 | 63/0 ; son retour garde `btree_gist` (voulu) |
| 19 | `20261111241000_plan_depuis_la_balance` | PC6, la reprise propose le plan | `PLAN_DEPUIS_LA_BALANCE_PREVU` | à coller | la levée de son drapeau et le déploiement | hors de REPET-Q3 | 26/0 |
| 19 bis | `20261127200000_piece_d_une_ecriture_libre_dans_son_dossier` | SECU4-Q1, la pièce qu'une écriture libre cite tenue dans son dossier (relecture de sécurité du 27/11/2026) | aucun (l'application ne déplace jamais une pièce) | par l'outil | — (EL2 et EL7, en production) | SECU4-Q1 (et SECU4-Q2, plus large) | sur 259 : 12/12, 4 mutations sur 4 ; `rls.sql` 295/1 357/0/178 |
| 20 | `20261107160000_deux_facteurs_exiges` | C7, la double authentification exigée | `DEUX_FACTEURS_EXIGES_EXPORTE` ; `DEUX_FACTEURS_EXIGES_EN_BASE` (quatorze Edge Functions) | à coller ; retour en deux temps | en dernier | SEC2-Q1 : après le MVP | 42/0, 15 sur 15 |
| — | `20261107120000_facture_internationale` | e7a, la facture à un client hors de France | `FACTURE_INTERNATIONALE_EXPORTEE` | à coller | — | REPET-Q1 (B) : rebasée à son collage, après le MVP | REFUSE (sa garde vise le corps d'`enregistrer_facture` d'`acomptes_des_devis`) |

**La chaîne**, dans l'ordre du tableau (e7a hors d'elle) : 275 migrations, toutes appliquées ; `rls.sql` 346 lignes, 1 692
vérifications, 0 en faute, 220 mutations sur 220 qui mordent, aucune EN ATTENTE ; les retours, à rebours, rendent la base à 255
(`btree_gist` excepté). Un second ordre (20 d'abord, puis 15, 14, 13, 16, 17, 11, 1 à 3, 5, 9, 8, 7, 6, 10, 4, 12, 19, 18) :
la même base, à l'ordre des colonnes du brouillon et à la date de création du seau `documents-cabinet` près. Les 167 autres
essais (207 jeux, ceux de réplique seulement sous les deux rôles, chaque famille avec son semis) sur 255 puis sur chaque ordre :
identiques, hors des EN ATTENTE qui se lèvent sur des verdicts justes, une fois trois essais repris (`sousDossierDansSonDossier`,
`ecrituresLibres`, `contrePassationDesEcrituresLibres`) ; `restauration.sql` IDENTIQUE, 110 puis 127 tables ; les huit essais de
la famille « apres » et celui d'OPT6 SÛRS au banc du leurre.

**OPT6 en production** : les deux essais des écritures libres repris ici (`ecrituresLibres` EL-F1, `contrePassationDesEcrituresLibres`
CP-F2) fermaient la liste des déclencheurs d'`ecritures_libres` sans ceux de la frontière ; depuis 255, ils tombaient sur la
production elle-même, et non plus au seul collage. Repris, ils admettent ces déclencheurs quand la garde d'OPT6 est au catalogue.

**Au collage** : le socle s'est régénéré au collage de 1 (MCB5g, 258 : 85 instructions à 259, `585debf7…`) ; il se régénère
encore au collage de 13, 14 et 15 (une colonne, des contraintes et un index du brouillon) et de 20 (douze restrictives) — 100 au
bout de la chaîne ; tant qu'il ne l'est pas, l'inventaire de la base compte, sur ses seules tables, plus d'objets que les fichiers
(à 259, sans le socle régénéré : deux de plus, la colonne et la paire de 258). e7a : le candidat du 14/11/2026 (hors du dépôt) vise le corps
d'`enregistrer_facture` de LM1 (`a5e2f40e…`), toujours celui de la production ; à 254 puis à 255, il s'applique, son essai rend
44/0 et 12 mutations sur 12 (SÛR au banc, au bout de la chaîne), seize essais des factures sont inchangés (à 254), et son retour
rend la base d'avant.

**Préparée depuis** (27/11/2026, la relecture adverse de sécurité des migrations 218 à 259 ; HISTORIQUE.md, « 27/11/2026 — LA
RELECTURE ADVERSE DE SÉCURITÉ DES MIGRATIONS 218 À 259 ») : `piece_d_une_ecriture_libre_dans_son_dossier` (SECU4-Q1, ligne 19 bis),
indépendante des autres, par l'outil, son retour à coller. Sur une copie de `replique_227` portée à 259 : seule, son essai 12/12,
quatre mutations sur quatre, `rls.sql` 295 lignes, 1 357 vérifications, 0 en faute, 178 mutations sur 178, une seconde
application refusée, son retour rend la signature de 259 ; les 173 essais, avant et après elle, rendent les mêmes verdicts hors
du sien, de `signature.sql` et `inventaire.sql` (deux déclencheurs et une fonction de plus), et d'EL-F1 et CP-F2, repris pour
admettre son déclencheur ; SÛR au banc du leurre (famille « apres »). Au bout de la chaîne (les seize, elle, puis la double
authentification, 20) : son essai 12/12, `rls.sql` 346 lignes, 1 692 vérifications, 0 en faute, 220 mutations sur 220.
