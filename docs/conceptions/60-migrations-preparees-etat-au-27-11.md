# Les migrations préparées : leur état au 27/11/2026

La répétition générale du 14/11/2026 (218 migrations) rejouée sur la base d'aujourd'hui : une copie de la réplique portée à
254 par les fichiers de l'export, chacun avec sa ligne d'historique (dérive 254 `8727d024…`, socle 84 `e54200f4…`, inventaire
3 518 `a6475fb0…`, égaux aux fichiers). Les 22 fichiers de `supabase/preparees/` (hors `retour/`). Le récit : HISTORIQUE.md,
« 27/11/2026 — LA RÉPÉTITION DES MIGRATIONS PRÉPARÉES REFAITE À 254 ».

« Seule » : appliquée sur 254 après ses seules dépendances déclarées ; son essai ; une seconde application (refusée par sa
garde de tête, pour les 21) ; `rls.sql` entier (sans faute, pour les 21) ; son retour, puis la signature étendue (neuf familles
de `signature.sql`, le stockage, auth, les rôles, les commentaires, les données), égale à celle d'avant sauf mention.
« Mode » : ce que dit l'en-tête de la migration — « à coller » quand le texte porte un retrait (`drop`, `delete from`,
`truncate`), même dans un corps de fonction ou un commentaire ; « par l'outil », à coller si l'outil la retient quand même.
Tous les retours se collent.

| Ordre | Préparée | Chantier | Drapeau(x) | Mode | Après | Ce qu'elle attend | Seule, sur 254 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `20261111235000_ouverture_eclatee_par_compte` | MCB5g, l'ouverture éclatée par compte (ligne 26.6, MVP) | `COMPTES_BANCAIRES_PREVUS` (levé après 1 à 3) | à coller | MCB1 à MCB5 (en production) | l'accord | `ouvertureEclatee` 30/0, 1 EN ATTENTE (la 2) |
| 2 | `20261111235500_ouverture_eclatee_a_la_validation` | MCB5g-Q2, le filet de la validation | le même | par l'outil | 1 | l'accord | 41/0 |
| 3 | `20261111235700_compte_propre_hors_des_exercices_valides` | MCB6Q2-Q1, le 512 propre hors d'une année validée | le même | par l'outil | — (avec 1 et 2) | l'accord | 20/0, 7 mutations sur 7 |
| 4 | `20261117150000_sous_dossier_dans_son_dossier` | DOCF-Q1-B, le sous-dossier dans son dossier | `DRAPEAU_DU_SOUS_DOSSIER` | par l'outil | — | l'accord | 27/27 (essai repris le 27/11) |
| 5 | `20261126120000_frontiere_de_la_tenue` | OPT6, la frontière de la tenue | `FRONTIERE_DE_LA_TENUE_PREVUE` | par l'outil | — (OPT1 en production) | OPT6-Q1, puis l'accord | 15/15 (deux essais d'EL2 et EL7 repris) |
| 6 | `20261107140000_trois_cases_de_l_acces` | B1, trois cases de plus d'un accès | `TROIS_CASES_EXPORTEES` | par l'outil | — (P1-trace et C4a, en production) | B1-Q1, sans réponse | 16/16 |
| 7 | `20261111234000_documents_et_demandes` | B2, les documents et les demandes | `DOCUMENTS_ET_DEMANDES_PREVUS` | par l'outil | 6 | 6, puis l'accord | 81/0 ; la suppression 17/0 |
| 8 | `20261111237000_achats_du_client` | B4, les achats du client | `ACHATS_DU_CLIENT_PREVUS` | par l'outil | 6 | 6, puis l'accord | 63/0 |
| 9 | `20261111238000_notes_de_frais` | B7, les notes de frais | `NOTES_DE_FRAIS_PREVUES` | par l'outil | 6 | 6 ; L3-Q1 à Q3 (l'écran) | 84/0 |
| 10 | `20261112100000_lettres_du_client` | LM6, les lettres de mission au client | `DRAPEAU_DES_LETTRES_DU_CLIENT` | par l'outil | 6 (LM1, LM4 en production) | 6 ; l'acceptation en ligne reste fermée (LM-Q10) | 24/24 |
| 11 | `20261111239000_relance_des_demandes_par_email` | B3b, la relance d'une demande par e-mail | `RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE` ; `RELANCES_DE_DEMANDES_EN_BASE` (`send-email`) | à coller | 6 et 7 | 7 ; puis `send-email` déployée | 20/0, 4 sur 4 |
| 12 | `20261111191000_depart_du_client` | INAL5, le départ d'un client | `DEPART_DU_CLIENT_PREVU` | à coller (son en-tête) | — | l'accord (INAL-Q6 tranchée) | 49/0, 4 sur 4 |
| 13 | `20261106130000_identifiant_du_fichier_ereporting` | e6b, l'identifiant du fichier d'e-reporting | `IDENTIFIANT_DU_FICHIER_EXPORTE` | à coller | — | E6Q8-Q1 : avec le bouton de téléchargement | 18/0 |
| 14 | `20261112190000_operations_d_inventaire` | INV2, les opérations d'inventaire (hors BNC) | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | à coller | — | INV8 : 14, 17 et 18 avec les drapeaux, puis l'assistant | 92/0, 14 sur 14 |
| 15 | `20261112200000_stocks_de_cloture` | LIA2, les stocks de clôture (hors BNC) | `STOCKS_PREVUS` | à coller | — | l'accord (LIA-Q2, Q3 à leur recommandation) | 31/0, 5 sur 5 |
| 16 | `20261112233000_affectation_du_resultat` | AFF2, l'affectation du résultat (hors BNC) | `AFFECTATION_PREVUE`, `AFFECTATION_EXPORTEE` | à coller | — | l'accord | 58/0, 13 sur 13 |
| 17 | `20261112230000_provisions` | INV4, les provisions (hors BNC) | `INVENTAIRE_PREVU` | à coller | 14 | INV8 | 74/0, 8 sur 8 |
| 18 | `20261112235000_validation_de_l_inventaire` | INV3, la validation connaît l'inventaire (hors BNC) | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | par l'outil | 14 ; avant tout autre remplaçant de `valider_exercice` | INV8 | 71/0, 25 sur 25 |
| 19 | `20261112210000_exercices_du_dossier` | EXD2, les exercices du dossier | `EXERCICES_DECALES_PREVUS` | par l'outil (aucun retrait ; l'en-tête ne le dit pas) | — | EXD3 (à écrire), EXD-Q1 à Q8 ; hors de REPET-Q3 | 63/0 ; son retour garde `btree_gist` (voulu) |
| 20 | `20261111241000_plan_depuis_la_balance` | PC6, la reprise propose le plan | `PLAN_DEPUIS_LA_BALANCE_PREVU` | à coller | la levée de son drapeau et le déploiement | hors de REPET-Q3 | 26/0 |
| 21 | `20261107160000_deux_facteurs_exiges` | C7, la double authentification exigée | `DEUX_FACTEURS_EXIGES_EXPORTE` ; `DEUX_FACTEURS_EXIGES_EN_BASE` (quatorze Edge Functions) | à coller ; retour en deux temps | en dernier | SEC2-Q1 : après le MVP | 42/0, 15 sur 15 |
| — | `20261107120000_facture_internationale` | e7a, la facture à un client hors de France | `FACTURE_INTERNATIONALE_EXPORTEE` | à coller | — | REPET-Q1 (B) : rebasée à son collage, après le MVP | REFUSE (sa garde vise le corps d'`enregistrer_facture` d'`acomptes_des_devis`) |

**La chaîne**, dans l'ordre du tableau (e7a hors d'elle) : 275 migrations, toutes appliquées ; `rls.sql` 346 lignes, 1 692
vérifications, 0 en faute, 220 mutations sur 220 qui mordent, aucune EN ATTENTE ; les retours, à rebours, rendent la base à 254
(`btree_gist` excepté). Un second ordre (21 d'abord, puis 16, 15, 14, 17, 18, 5, 12, 1 à 3, 6, 10, 9, 8, 7, 11, 4, 13, 20, 19) :
la même base, à l'ordre des colonnes du brouillon et à la date de création du seau `documents-cabinet` près. Les 167 autres
essais (207 jeux, ceux de réplique seulement sous les deux rôles, chaque famille avec son semis) sur 254 puis sur chaque ordre :
identiques, hors des EN ATTENTE qui se lèvent sur des verdicts justes, une fois trois essais repris (`sousDossierDansSonDossier`,
`ecrituresLibres`, `contrePassationDesEcrituresLibres`) ; `restauration.sql` IDENTIQUE, 110 puis 127 tables ; les huit essais de
la famille « apres » SÛRS au banc du leurre.

**Au collage** : le socle se régénère au collage de 1, 14, 15 et 16 (une colonne, une contrainte et un index du brouillon) et
de 21 (douze restrictives) — 84 instructions à 254, 100 au bout de la chaîne ; tant qu'il ne l'est pas, l'inventaire de la base
compte, sur ses seules tables, 26 objets de plus que les fichiers. e7a : le candidat du 14/11/2026 (hors du dépôt) vise le corps
d'`enregistrer_facture` de LM1 (`a5e2f40e…`), toujours celui de la production ; sur 254, il s'applique, son essai rend 44/0 et 12
mutations sur 12, seize essais des factures sont inchangés, et son retour rend la base d'avant.
