# Les migrations préparées : leur état au 28/11/2026, la production à 261

**Le 28/11/2026**, les trois préparées écrites pendant la répétition à 261 — `ni_piece_ni_document_ne_change_de_dossier`
(SECU4-Q2), `banque_partagee_a_la_validation` (MCBR2-Q2) et `consommations_de_l_assistant` (ASSIST-Q1) — ont été jouées seules
sur 261, ensemble dans leurs six ordres, puis en chaîne avec les 18 (avant elles, après elles, et dans l'ordre de collage
recommandé ci-dessous) : les 21 s'appliquent, une seule faute trouvée, dans un essai, corrigée (le contrôle 141 de
`validationExercice.sql`, ci-dessous). Le tableau les range sous « 19 ter a » à « 19 ter c ». Le récit : HISTORIQUE.md,
« 28/11/2026 — LES TROIS PRÉPARÉES D'APRÈS LA RÉPÉTITION, RÉPÉTÉES SEULES ET EN CHAÎNE ». Rien n'a été appliqué en
production.

La répétition générale des migrations préparées, refaite le 27/11/2026 au soir avec les quatre nées le même jour :
`piece_d_une_ecriture_libre_dans_son_dossier` (SECU4-Q1), `ouverture_suivante_a_la_validation` (MCBR-Q2),
`periode_des_imports_assurance_maladie` (NOE4R-Q1) et `remplacement_des_journees_assurance_maladie` (NOE4R-Q2) — les deux
dernières n'avaient jamais été jouées au bout de la chaîne des autres. Jouée d'abord sur la production à 259, les 20 et e7a ;
pendant ce temps, deux sont passées en production par l'outil, texte du fichier inchangé : **260**,
`piece_d_une_ecriture_libre_dans_son_dossier` (version `20261127213748`, `d64d3aa0…`, 13 604 caractères), et **261**,
`ouverture_suivante_a_la_validation` (`20261127214813`, `30ebb2cd…`, 10 667 caractères), leurs fichiers rangés dans
`supabase/schema/` par ailleurs. Rejouée alors sur 261 : les 18 qui restent, et e7a. Le récit : HISTORIQUE.md, « 27/11/2026 —
LA RÉPÉTITION DES MIGRATIONS PRÉPARÉES REFAITE À 261, AVEC LES QUATRE DU JOUR » ; celle du matin : « LA RÉPÉTITION DES
MIGRATIONS PRÉPARÉES REFAITE À 254, PUIS À 255 ». La répétition n'a rien appliqué en production.

## La production à 261 : les trois contrôles

Une copie de `replique_227` portée à 259 par les 32 fichiers de `supabase/schema/` qui suivent 227, chacun avec sa ligne
d'historique (dérive 259 `a540bcd9…`, inventaire 3 542 `58b4a599…`, socle 85 `585debf7…`, égaux aux fichiers), puis à 261 par
les deux fichiers sous leur version de production. Contre l'export à 261 (celui du dépôt et les deux fichiers rangés sous ces
versions) :

- **dérive** : 261 migrations, `84978ecbcc00e808a9953b09ce3c5dad`, égale — celle de la production si ses deux lignes
  d'historique portent le texte des fichiers (au saut de ligne final près, que la règle de la dérive écarte) ;
- **socle** : 85 instructions, `585debf740c5f74f4e2669a0d4ebcc9c`, inchangé (aucune des deux ne touche une table du socle) ;
- **inventaire** : 3 548 objets, `c69af6cf57de4a878285b732538d99f2`, égal (six de plus qu'à 259 : les deux déclencheurs et la
  garde de SECU4-Q1 ; le déclencheur de contrainte, sa contrainte et sa fonction pour MCBR-Q2).

Sur 261 : `rls.sql` 296 lignes, 1 358 vérifications, 0 en faute, 178 mutations sur 178, 14 blocs EN ATTENTE (ceux des seize et de
NOE4R-Q2) ; les 214 jeux d'essais rendent les verdicts de 259, hors des essais des deux migrations, dont l'attente se lève sur des
verdicts justes (`pieceDUneEcritureLibreDansSonDossier` 12/12, `ouvertureSuivanteALaValidation` 13/13 et 5 mutations sur 5) ;
`restauration.sql` IDENTIQUE, 110 tables.

Le 28/11/2026, sur une copie neuve de `replique_227` portée à 261 par les 34 fichiers de l'export qui suivent 227, chacun avec sa
ligne d'historique : les trois contrôles égaux aux fichiers (dérive 261 `84978ecb…`, socle 85 `585debf7…`, inventaire 3 548
`c69af6cf…`) ; `rls.sql` 297 · 1 359 · 0 · 178 sur 178, 15 EN ATTENTE (le bloc CO d'ASSIST-Q1, entré dans `rls.sql` après la
répétition d'hier, s'ajoute aux quatorze) ; 220 jeux d'essais (six de plus qu'hier : ceux des trois préparées, leurs essais de
réplique sous les deux rôles), `restauration.sql` IDENTIQUE, 110 tables.

## La méthode

Chaque passe sur une base tirée de la copie (`create database … template`), une seule grappe : la double authentification
reçoit d'abord le talon de la réplique (`auth.mfa_factors`, `auth.sessions`, le rôle `authenticator`), et sa pré-requête, qui
vit dans la grappe, se pose ou se remet à zéro selon la base que l'on juge.

- **Seule** : après ses seules dépendances déclarées ; elle s'applique ; une seconde application se refuse (sa garde de tête) ;
  son essai, puis ceux des tables partagées (`validationExercice`, `ouvertureEclatee`, `paiementsAssuranceMaladie`,
  `ecrituresLibres`, `comptesBancaires`) ; `rls.sql` entier ; son retour, puis la signature étendue (les neuf familles de
  `signature.sql`, le stockage, auth, les rôles, les commentaires, les données), égale à celle d'avant elle.
- **En chaîne** : toutes, dans un ordre ; `rls.sql` entier ; les essais des préparées et des tables partagées ; puis tous les jeux
  d'essais de `supabase/essais/` (214 le 27/11, 220 le 28/11 ; ceux de réplique seulement sous les deux rôles, chaque famille
  avec son semis), comparés jeu par jeu ; les trois contrôles de l'export contre les fichiers SIMULÉS rangés (l'export à 261,
  chaque préparée sous la version de sa ligne d'historique, le socle régénéré du catalogue comme au collage) ; les retours à
  rebours.
- **Mode** : ce que dit l'en-tête — « à coller » quand le texte porte un retrait (`drop`, `delete from`, `truncate`), même dans
  un corps de fonction ou un commentaire ; « par l'outil » sinon, à coller si l'outil la retient quand même. Tous les retours
  se collent. Le md5 et la longueur sont ceux du texte sans son saut de ligne final : ceux de la ligne d'historique.

## Le tableau

| Ordre | Préparée | md5 · caractères | Ce qu'elle remplace, ce qu'elle pose | Mode | Après | Drapeau(x) | Retenue par | Seule, sur 261 | En chaîne (d1) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | `20261107140000_trois_cases_de_l_acces` (B1) | `d5edd62c` · 22 148 | remplace `changer_droits_acces`, `client_du_dossier`, `droits_sur_le_dossier`, `tracer_les_droits` (les cases « Achats », « Notes de frais », « Documents ») | par l'outil | — (P1-trace, C4a en production) | `TROIS_CASES_EXPORTEES` | **B1-Q1**, sans réponse | 16/16 | 16/16 |
| 6 | `20261111234000_documents_et_demandes` (B2) | `89e1cdb7` · 56 317 | pose cinq tables et le seau `documents-cabinet` | par l'outil | 5 | `DOCUMENTS_ET_DEMANDES_PREVUS` | B1-Q1 (par 5), puis l'accord | 81/81 ; sa suppression 17/17 | idem |
| 7 | `20261111237000_achats_du_client` (B4) | `bfd305ba` · 30 160 | pose `paiements_declares`, `pieces_vues` | par l'outil | 5 | `ACHATS_DU_CLIENT_PREVUS` | B1-Q1 (par 5), puis l'accord | 63/63 | 63/63 |
| 8 | `20261111238000_notes_de_frais` (B7) | `f43786e1` · 47 187 | pose `notes_de_frais`, le rôle `personnel` au 421000 | par l'outil | 5 | `NOTES_DE_FRAIS_PREVUES` | B1-Q1 (par 5) | 84/84 | 84/84 |
| 9 | `20261112100000_lettres_du_client` (LM6) | `74d40992` · 10 621 | les lettres de mission au client (l'acceptation en ligne reste fermée, LM-Q10) | par l'outil | 5 (LM1, LM4 en production) | `DRAPEAU_DES_LETTRES_DU_CLIENT` | B1-Q1 (par 5) | 24/24 | 24/24 |
| 10 | `20261111239000_relance_des_demandes_par_email` (B3b) | `95eb3083` · 8 732 | remplace la contrainte `emails_envoyes_type_check` | à coller | 5 et 6 | `RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE` ; `RELANCES_DE_DEMANDES_EN_BASE` (`send-email`) | B1-Q1 (par 6) ; puis `send-email` déployée | 20/20, 4 mutations sur 4 | idem |
| 11 | `20261111191000_depart_du_client` (INAL5) | `e6d4b7d9` · 25 213 | pose `conservations_des_dossiers`, `paquets_d_archive_telecharges` | à coller (son en-tête) | — | `DEPART_DU_CLIENT_PREVU` | l'accord (INAL-Q6 tranchée) | 49/49, 4 sur 4 | idem |
| 12 | `20261106130000_identifiant_du_fichier_ereporting` (e6b) | `461a0458` · 22 714 | retire et recrée `declarer_ereporting_hors_application` | à coller | — | `IDENTIFIANT_DU_FICHIER_EXPORTE` | E6Q8-Q1 : avec le bouton de téléchargement | 18/18 | 18/18 |
| 13 | `20261112190000_operations_d_inventaire` (INV2, hors BNC) | `175bfd47` · 57 153 | pose `operations_inventaire`, une colonne du brouillon et ses paires | à coller | — | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | INV8 : 13, 16 et 17 avec les drapeaux, puis l'assistant | 92/92, 14 sur 14 | idem |
| 14 | `20261112200000_stocks_de_cloture` (LIA2, hors BNC) | `936ac32c` · 38 376 | pose `stocks_de_cloture`, une colonne du brouillon et ses paires | à coller | — | `STOCKS_PREVUS` | l'accord (LIA-Q2, Q3 à leur recommandation) | 31/31, 5 sur 5 | idem |
| 15 | `20261112233000_affectation_du_resultat` (AFF2, hors BNC) | `813e441e` · 73 704 | pose `affectations_du_resultat`, `lignes_d_affectation`, une colonne du brouillon et ses paires | à coller | — | `AFFECTATION_PREVUE`, `AFFECTATION_EXPORTEE` | l'accord | 58/58, 13 sur 13 | idem |
| 16 | `20261112230000_provisions` (INV4, hors BNC) | `22ff51e4` · 53 111 | pose `provisions` | à coller | 13 | `INVENTAIRE_PREVU` | INV8 | 74/74, 8 sur 8 | idem |
| 17 | `20261112235000_validation_de_l_inventaire` (INV3, hors BNC) | `39e5c3f5` · 105 135 | remplace `valider_exercice` (65df5e35…), `empreinte_exercice_forme_2`, `fichier_fige` (5e7016c0…) ; pose `inventaires_declares` | par l'outil | 13 ; avant tout autre remplaçant de `valider_exercice` (le filet de 261 ne le remplace pas) | `INVENTAIRE_PREVU`, `INVENTAIRE_EXPORTE` | INV8 | 71/71 (2 EN ATTENTE : 16), 25 sur 25 | 77/77, 26 sur 26 |
| 18 | `20261112210000_exercices_du_dossier` (EXD2) | `8c279d73` · 32 192 | pose `exercices` et l'extension `btree_gist` | par l'outil (aucun retrait ; l'en-tête ne le dit pas) | — | `EXERCICES_DECALES_PREVUS` | EXD3 (à écrire), EXD-Q1 à Q8 ; hors de REPET-Q3 | 63/63 ; son retour garde `btree_gist` (voulu) | 63/63 |
| 19 | `20261111241000_plan_depuis_la_balance` (PC6) | `6b6ed989` · 11 765 | remplace `enregistrer_a_nouveaux` | à coller | la levée de son drapeau et le déploiement | `PLAN_DEPUIS_LA_BALANCE_PREVU` | hors de REPET-Q3 | 26/26 | 26/26 |
| 19 ter | `20261127215000_periode_des_imports_assurance_maladie` (NOE4R-Q1) | `7cc09cb0` · 13 797 | remplace `importer_paiements_assurance_maladie` (62b9f0f6…) : la période d'un import sur ses seuls paiements insérés | par l'outil | — (NOE3 en production) | aucun (l'écran ne dit rien que la règle décide) | rien : prête (NOE4R-Q1 (A)) | 11/11 | 11/11 |
| 19 ter a | `20261127230000_ni_piece_ni_document_ne_change_de_dossier` (SECU4-Q2) | `4718f04c` · 12 688 | pose `garder_dossier_de_depot` (ne lit rien, aux droits de l'appelant) et deux déclencheurs BEFORE UPDATE, `pieces_vers_un_autre_dossier` et `documents_divers_vers_un_autre_dossier`, nommés pour tirer en dernier de leur table ; ne remplace rien | par l'outil | — (indépendante : les déclencheurs que 7, 8, 11 et 17 posent sur `pieces` se rangent avant les siens) | aucun | l'accord (SECU4Q2-migration) | 16/16 ; 219 jeux sur 220 identiques à 261 | 16/16 dans a, b et m |
| 19 ter b | `20261127231000_banque_partagee_a_la_validation` (MCBR2-Q2) | `ab1d3ebb` · 13 509 | pose `garder_banque_partagee_a_la_validation` et le déclencheur de contrainte différé `exercices_valides_releves_de_la_banque_partagee`, qui tire après celui de 261 ; ne remplace pas `valider_exercice` | par l'outil | — (258 et 261 en production) ; avant ou après 17 | aucun (le préalable `banque-partagee-retenue` dit déjà le refus avant le clic) | l'accord (MCBR2Q2-migration) | 17/17, 8 sur 8, sous les deux rôles ; 218 jeux identiques | 17/17, 8 sur 8 dans a, b et m (avant et après 17) |
| 19 ter c | `20261127232000_consommations_de_l_assistant` (ASSIST-Q1) | `92731bb6` · 19 605 | pose `consommations_de_l_assistant` (sous RLS, sans policy permissive, aucun droit aux rôles de l'API), sa garde, `consommation_de_l_assistant(p_depuis)` ; la restrictive `deux_facteurs` quand 20 est déjà là | par l'outil | — ; avant ou après 20 (la restrictive posée par la boucle de 20, ou par elle) | `CONSOMMATION_TENUE_PAR_LA_FONCTION` (l'application et `agent-comptable`, levés dans le commit qui range le fichier ; la fonction déployée avant la fusion) | l'accord, avec le déploiement de `agent-comptable` ; ASSIST1-Q1 à Q3 ne changent pas son texte | 8/8 ; sa suppression 4/4 ; `validationExercice` 250/250 avec la ligne du contrôle 141 (249/250 sans) | 8/8 et 4/4 dans a, b et m |
| 19 quater | `20261127215500_remplacement_des_journees_assurance_maladie` (NOE4R-Q2) | `d578b16a` · 31 775 | pose `remplacements_assurance_maladie` (la trace), `remplacer_journees_assurance_maladie` ; épingle cinq fonctions à leur empreinte, dont celle de 19 ter | à coller (un `delete` dans le corps de sa fonction) | 19 ter (refusée sans elle) ; avant ou après 20 | `REMPLACEMENT_DES_JOURNEES_PREVU` | NOE4RQ2-Q1 à Q4 ; la lecture du client « Banque » présentée au cabinet | 35/35 ; sa suppression 7/7 | idem |
| 20 | `20261107160000_deux_facteurs_exiges` (C7) | `42141f44` · 33 327 | pose `exigences_deux_facteurs`, `retraits_deux_facteurs`, une restrictive `deux_facteurs` par table et sur le stockage, la pré-requête de PostgREST | à coller ; retour en deux temps | en dernier | `DEUX_FACTEURS_EXIGES_EXPORTE` ; `DEUX_FACTEURS_EXIGES_EN_BASE` (quatorze Edge Functions) | SEC2-Q1 : après le MVP | 42/42, 15 sur 15 | idem |
| — | `20261107120000_facture_internationale` (e7a) | `9ba1c647` · 82 246 | remplace `enregistrer_facture`, `garder_factures_validees` | à coller | — | `FACTURE_INTERNATIONALE_EXPORTEE` | **REPET-Q1 (B)** : rebasée à son collage, après le MVP | REFUSE (sa garde vise le corps d'`enregistrer_facture` d'`acomptes_des_devis`) | hors de la chaîne |

Seules, sur 261 (et déjà sur 259, les quatre du jour comprises), les 18 s'appliquent, une seconde application se refuse pour
chacune, leurs essais et ceux des tables partagées sont justes, `rls.sql` sans faute avec chacune, et chaque retour rend la
signature étendue d'avant elle (EXD2 garde `btree_gist`, voulu). NOE4R-Q2 se refuse sans NOE4R-Q1 (« appliquer d'abord
periode_des_imports_assurance_maladie »), et le retour de NOE4R-Q1 se refuse tant que NOE4R-Q2 est en base. Le candidat d'e7a du
14/11/2026 (hors du dépôt) vise encore le corps de la production : sur 261 et au bout de la chaîne d1, il s'applique, son essai
rend 44/44 et 12 mutations sur 12, seize essais des factures sont inchangés, son retour rend la signature d'avant.

Le 28/11/2026, les trois de 19 ter a à 19 ter c, seules sur 261 : chacune s'applique, une seconde application se refuse (« … déjà
en base »), son essai et ceux des tables partagées (`validationExercice`, `ouvertureEclatee`, `ouvertureSuivanteALaValidation`,
`paiementsAssuranceMaladie`, `ecrituresLibres`, `comptesBancaires`) sont justes, `rls.sql` sans faute (297 · 1 359 · 0 · 178 avec
19 ter a ou 19 ter b, qui n'y ont pas de bloc ; 300 · 1 370 · 0 · 180 avec 19 ter c, son bloc CO jugé), les 220 jeux d'essais
rendent ceux de 261 hors des attentes que leurs propres essais lèvent sur des verdicts justes (1, 2 et 3 jeux), et chaque retour
rend la signature étendue d'avant elle, `rls.sql` revenu à 297 · 1 359 · 0 · 178. Seule exception, corrigée : `validationExercice`
249/250 avec 19 ter c (ci-dessous). Ensemble, dans leurs six ordres : la même base au bout (signature étendue égale, données
comprises), `rls.sql` 300 · 1 370 · 0 · 180, leurs essais justes, leurs retours à rebours rendent 261.

## Ce que la répétition a trouvé, et corrigé

**Le 28/11/2026, le même défaut une seconde fois : le contrôle 141 n'attendait pas la garde du journal de consommation de
l'assistant.** Avec 19 ter c seule sur 261, `validationExercice.sql` rendait 249/250 : 85 gardes BEFORE … DELETE observées, 84
attendues — `consommations_de_l_assistant_garde`, préparée le même soir que le relevé de `gardesDeSuppressionAttendues.test.ts`,
sur une autre branche : le relevé était donc rouge (deux tests) une fois les deux réunies. Corrigé dans l'essai, seul, sous un
commit à part : la ligne comptée quand la table existe, sous la forme OBSERVÉE sur la réplique, `dossier` — la table a un
dossier, et la lecture que le contrôle reconnaît est celle de la mise à nul du dossier retiré ; la cascade d'un dossier qu'on
supprime passe bien (sa clé `on delete set null` en fait une mise à jour que la garde admet ; seule la cascade du cabinet
retire une ligne, admise aussi :
`consommationsDeLAssistantSuppression.sql`, étape 1) ; la table entre aussi dans le raccourci du contrôle. `validationExercice`
250/250 à 261 (84), avec 19 ter c (85), avec elle et 19 ter, 19 quater (86), et au bout de chaque chaîne ; SÛR au banc du leurre à
261 et avec 19 ter c. Gardé par `consommationDeLAssistant.test.ts` (la ligne, le raccourci, la forme de la garde) et par le relevé,
qui compte 110 gardes le 28/11/2026, dont 24 des préparées. Aucune des trois préparées n'a dérivé : aucune garde de tête qui
refuse à tort, aucun heurt de nom ni de rang, leurs empreintes inchangées.

**Un essai joué en production aurait viré au rouge au collage de NOE4R-Q2.** Le contrôle 141 de `validationExercice.sql` (« tout
déclencheur qui garde une suppression laisse passer la cascade d'un dossier qu'on supprime ») compare les gardes BEFORE … DELETE
de la base à une liste tenue à la main : la garde de la trace, `remplacements_assurance_maladie_garde`, de la forme « dossier »
(la cascade passe), n'y était pas — 85 gardes observées contre 84 attendues avec NOE4R-Q2 seule sur 259, 107 contre 106 au bout
de la chaîne. Ni la préparation de NOE4R-Q2 ni la répétition du matin ne rejouaient cet essai après elle. Corrigé dans l'essai
(une ligne comptée quand la table existe ; rien ne change sans elle) : 250/250 sur 259 et sur 261, avec NOE4R-Q1 et Q2, et au
bout de chaque chaîne ; SÛR au banc du leurre, sur 259, sur 261 et au bout de la chaîne. Gardé par
`remplacementDesJourneesAssuranceMaladie.test.ts` (la ligne et la forme de la garde), et par un relevé qui part de TOUT,
`gardesDeSuppressionAttendues.test.ts` : chaque déclencheur BEFORE … DELETE que l'export (migrations et socle) et les préparées
laissent en place — 109 le 27/11/2026, dont 23 des préparées — paraît dans l'essai sous la forme que le contrôle observe, hors
des deux gardes de la caisse que sa requête écarte ; des défauts plantés le prouvent ; il nomme la table de la trace et se range
donc parmi les lecteurs permis de `paiementsAssuranceMaladieSansSortie.test.ts`, sous sa raison. Aucune préparée n'a dérivé :
aucune garde de tête qui refuse à tort, aucun heurt de nom, aucune empreinte périmée (hors e7a, connue).

## Les ordres joués

Sur 261 (les 18 qui restent) :

| Chaîne | L'ordre | Migrations | `rls.sql` : lignes · vérifications · en faute · mutations | Essais (214 jeux) | Contrôles simulés : dérive · socle · inventaire |
| --- | --- | --- | --- | --- | --- |
| d1 | celui du tableau : 5 à 19, 19 ter, 19 quater, puis 20 | 279 | 350 · 1 708 · 0 · 222 sur 222, aucune EN ATTENTE | 180 identiques à 259 et 25 attentes levées sur des verdicts justes ; les essais de 13 à 16 et de 20 justes au lieu d'attendre leur migration | 279 `12842da3…` égale · 100 `3ccceb27…` égal · 4 329 `739a62bd…` égal |
| d2 | 19 ter et 19 quater d'abord, puis 5 à 19, puis 20 | 279 | 350 · 1 708 · 0 · 222 sur 222 | les 214 identiques à d1 | 279 `d6ee63aa…` égale · 100 · 4 329 |
| d3 | d1 sans NOE4R-Q2 (NOE4R-Q1 seule), puis NOE4R-Q2 au bout, après 20 | 278, puis 279 | 347 · 1 693 · 0 · 220 sur 220, RJ EN ATTENTE ; avec Q2 : 350 · 1 708 · 0 · 222 | identiques à d2 hors des deux essais de NOE4R-Q2, EN ATTENTE ; avec Q2 au bout : 35/35, 7/7, le contrôle 141 juste | 278 `51a8e273…` égale · 100 · 4 294 `432e1f23…` égal |
| d4 | la double authentification d'abord, puis 19 ter, 19 quater, puis 5 à 19 | 279 | 350 · 1 708 · 0 · 222 sur 222 | les 214 identiques à d2 | 279 `c290ecd1…` égale · 100 · 4 329 |
| n2 | 19 ter et 19 quater seules (la production à 263 de demain) | 263 | 299 · 1 372 · 0 · 180 sur 180, 13 EN ATTENTE (les seize) | 210 identiques à 261, 4 attentes levées | 263 `eff47f57…` égale · 85 `585debf7…` inchangé · 3 582 `ac470e3b…` égal |

Au bout de d1, d2, d4, et de d3 une fois NOE4R-Q2 posée, la base est la même : signature étendue égale, aux données de
`storage.buckets` près (la date de création du seau `documents-cabinet`). `restauration.sql` IDENTIQUE partout (110 tables à 261,
111 en n2, 127 en d3, 128 au bout des chaînes). Les retours, à rebours, rendent 261 sur chaque chaîne (`btree_gist` excepté) ;
`rls.sql` y revient à 296 · 1 358 · 0 · 178. Le banc du leurre : les neuf essais de la famille « apres » (B1, B2, B3b, B4, B7,
e6b, SECU4-Q1, NOE4R-Q1 et Q2) SÛRS sur la chaîne d1 entière ; `validationExercice` SÛR sur 261 et sur la chaîne.

Sur 259, avant les deux mises en production, les mêmes cinq ordres avec les 20 (SECU4-Q1 et MCBR-Q2 à leur place du tableau
d'alors, puis d'abord, puis seules avec NOE4R-Q1 et Q2) avaient rendu la même chose : 279 migrations, `rls.sql` 350 · 1 708 · 0 ·
222, les mêmes bases au bout, les mêmes contrôles (socle 100 `3ccceb27…`, inventaire 4 329 `739a62bd…`), et le seul défaut
ci-dessus ; MCBR-Q2 avant comme après INV3.

Sur 261, le 28/11/2026 (les 21 : les 18 et les trois d'après la répétition ; les versions des lignes d'historique suivent 261 dans
l'ordre de la chaîne, d'où des dérives propres à chaque ordre ; les deux essais qui se jouent sous les deux rôles comptent deux jeux) :

| Chaîne | L'ordre | Migrations | `rls.sql` : lignes · vérifications · en faute · mutations | Essais (220 jeux) | Contrôles simulés : dérive · socle · inventaire |
| --- | --- | --- | --- | --- | --- |
| d1 | celui d'hier, sans les trois : 5 à 19, 19 ter, 19 quater, puis 20 | 279 | 351 · 1 709 · 0 · 222 sur 222, 1 EN ATTENTE (le bloc CO) | 189 identiques à 261, 22 attentes levées sur des verdicts justes, les essais de 13 à 16 et de 20 justes au lieu de s'arrêter faute de leur migration | 279 égale · 100 `3ccceb27…` égal · 4 329 `739a62bd…` égal — ceux d'hier |
| a | les trois d'abord (19 ter a, b, c), puis d1 | 282 | 354 · 1 721 · 0 · 224 sur 224, aucune EN ATTENTE | 214 identiques à d1, 6 attentes levées (les essais des trois) | 282 égale · 100 `3ccceb27…` égal · 4 354 `fa931de8…` égal |
| b | d1, puis les trois, après 20 | 282 | 354 · 1 721 · 0 · 224 sur 224 | les 220 identiques à a | 282 égale · 100 · 4 354 `fa931de8…` |
| m | l'ordre du tableau, celui du collage recommandé : 19 ter, 19 ter a à c, 19 quater, 5 à 19, puis 20 | 282 | 354 · 1 721 · 0 · 224 sur 224 | les 220 identiques à a | 282 égale · 100 · 4 354 `fa931de8…` |
| n3 | 19 ter et les trois seules (la production à 265) | 265 | 300 · 1 370 · 0 · 180 sur 180, 14 EN ATTENTE (les seize) | 213 identiques à 261, 7 attentes levées | 265 égale · 85 `585debf7…` inchangé · 3 572 `6224d8e7…` égal |
| n4 | n3, puis 19 quater (266) | 266 | 303 · 1 384 · 0 · 182 sur 182, 13 EN ATTENTE | 210 identiques à 261, 10 attentes levées | 266 égale · 85 inchangé · 3 606 `2a7f6b1a…` égal |

Au bout de a, b et m, la base est la même : signature étendue égale, aux données de `storage.buckets` près (la date de création du
seau `documents-cabinet`) ; la restrictive `deux_facteurs` de `consommations_de_l_assistant` est la même, que la boucle de 20 l'ait
posée (a, m) ou la préparée elle-même (b). Le filet de MCBR2-Q2 juge comme seul, que 17 remplace `valider_exercice` avant lui (b)
ou après (a, m) : `banquePartageeALaValidation` 17/17 et 8 sur 8, `validationDeLInventaire` 77/77 et 26 sur 26, les filets de 258,
259 et 261 justes (`ouvertureEclatee` 41/41, `ouvertureSuivanteALaValidation` 13/13 et 5 sur 5). La règle de SECU4-Q2 reste la
dernière des gardes BEFORE de `pieces` et de `documents_divers` avec celles de 7, 8, 11 et 17 (`niPieceNiDocumentNeChangeDeDossier`
16/16), et les essais de ces quatre préparées gardent leurs mots (aucun ne déplace une pièce que rien ne cite). `restauration.sql`
IDENTIQUE partout (110 tables à 261 et en n3, 111 en n4, 128 au bout de d1, a, b et m : la table du journal est du cabinet, hors
de la sauvegarde d'un dossier). Les retours, à rebours, rendent 261 sur chaque chaîne (`btree_gist` excepté, voulu), `rls.sql` y
revient à 297 · 1 359 · 0 · 178 ; en n3 et n4, la signature d'avant entière. Le banc du leurre : `validationExercice`,
`niPieceNiDocumentNeChangeDeDossier` et `consommationsDeLAssistant` SÛRS au bout de m et de n3 (et `periodeDesImportsAssuranceMaladie`
en n3), `validationExercice` SÛR à 261 et avec 19 ter c seule.

## L'ordre de collage recommandé (la production à 261)

1. **`periode_des_imports_assurance_maladie`** (19 ter), prête, par l'outil : rien d'autre ne l'attend ni ne la retient. Après
   elle (262) : socle 85 `585debf7…` et inventaire 3 548 `c69af6cf…` inchangés (elle ne remplace qu'un corps), la dérive à
   relever sous sa version ; `paiementsAssuranceMaladie` 66/66 et son essai 11/11 à rejouer en production.
2. **Les trois de 19 ter a à c**, par l'outil, dans n'importe quel ordre entre elles (les six sont joués) et à n'importe quelle
   place de la chaîne (a, b, m) : `ni_piece_ni_document_ne_change_de_dossier` et `banque_partagee_a_la_validation` sur l'accord du
   cabinet (SECU4Q2-migration, MCBR2Q2-migration) ; `consommations_de_l_assistant` avec son commit — le fichier rangé dans l'export
   sous sa version, `CONSOMMATION_TENUE_PAR_LA_FONCTION` levé dans l'application et dans `agent-comptable` — et la fonction
   déployée depuis ce commit avant sa fusion. Après 19 ter et elles (265) : socle 85 `585debf7…` inchangé (aucune ne touche une
   table du socle : de `documents_divers`, le socle ne porte aucun déclencheur), inventaire 3 572 `6224d8e7…` (24 objets de plus :
   trois pour 19 ter a, trois pour 19 ter b, dix-huit pour 19 ter c), la dérive à relever sous leurs versions ; à rejouer en
   production : `niPieceNiDocumentNeChangeDeDossier` (16/16), `consommationsDeLAssistant` (8/8), `validationExercice` (250/250, la
   ligne du contrôle 141 comptée) et `rls.sql` (le bloc CO) ; `banquePartageeALaValidation` et
   `consommationsDeLAssistantSuppression` sur une réplique seulement. **19 ter a avant 6 et 7** : la réponse à une demande (6),
   le paiement déclaré et la pièce vue (7) vérifient le dossier de leur pièce à leur insertion seulement, et aucune garde de 6 ou
   de 7 ne retient ensuite la pièce ; sans la règle, elle changerait encore de dossier — sondé au bout de d1 : la pièce vue d'un
   dossier cite alors la pièce d'un autre ; au bout de m, le refus de 19 ter a (23514).
3. **`remplacement_des_journees_assurance_maladie`** (19 quater), à coller, après 19 ter, quand NOE4RQ2-Q1 à Q4 sont tranchées,
   avec dans le même commit `REMPLACEMENT_DES_JOURNEES_PREVU` levé et la trace au plan de sauvegarde ; avant ou après 20 (sa
   restrictive se pose sous condition, d3), avant ou après les trois de 19 ter a à c. Après 19 ter et elle (263) : socle 85,
   inventaire 3 582 `ac470e3b…` ; après les trois aussi (266) : 3 606 `2a7f6b1a…` ; `validationExercice` 250/250 grâce aux lignes
   du contrôle 141.
4. **Puis les seize**, dans l'ordre du tableau, chacune quand ce qui la retient est levé : B1 (5) d'abord, qui retient 6 à 10 ;
   13, 16 et 17 ensemble (INV8) ; 18 et 19 hors de REPET-Q3. **20 en dernier**, après le MVP (SEC2-Q1).
5. **e7a** rebasée à son collage (REPET-Q1 (B)), après le MVP.

**Au collage**, le socle se régénère au collage de 13, 14 et 15 (la ligne du brouillon, et un index chacune) et de 20 (douze
restrictives sur les tables du socle) : 85 → 100 au bout de la chaîne, `3ccceb27…` — une instruction remplacée
(`create table public.ecritures_brouillon`), seize neuves ; sans lui, l'inventaire des fichiers compte 24 objets de moins que la
base (4 305 contre 4 329 sans les trois, 4 330 contre 4 354 avec elles). Ni 19 ter, ni 19 quater, ni les trois de 19 ter a à c ne le
touchent. L'inventaire ne nomme que des objets : la version des lignes d'historique n'y change rien.

## Ce qui reste retenu par une question

- **B1-Q1**, sans réponse : retient B1 (5), donc B2, B3b, B4, B7 et LM6 (6 à 10).
- **REPET-Q1 (B)** : e7a se rebase à son collage, après le MVP.
- **NOE4RQ2-Q1 à Q4** (19 quater) ; **SEC2-Q1** (20, après le MVP) ; **INV8** (13, 16, 17) ; **E6Q8-Q1** (12) ; **EXD-Q1 à Q8** et
  EXD3 (18) ; l'accord pour 11, 14 et 15 ; 18 et 19 hors de REPET-Q3 (B).
- **REPET3-Q1** (posée par cette répétition) : 19 ter maintenant, par l'outil, avant les seize.
- **SECU4Q2-migration** et **MCBR2Q2-migration** (posées le 27/11/2026) : l'accord pour 19 ter a et 19 ter b ; pour 19 ter c,
  l'accord avec le déploiement d'`agent-comptable` (ASSIST1-Q1 à Q3 ne changent pas son texte).
- **REPET4-Q1** (posée par la répétition du 28/11/2026) : les trois de 19 ter a à c après 19 ter, avant 19 quater et les seize.

## Les répétitions d'avant (27/11/2026)

**Le matin, à 254 puis à 255** (OPT6, `frontiere_de_la_tenue`, appliquée en production pendant la répétition) : 21 des 22 d'alors
s'appliquaient seules et en chaîne (275 migrations ; `rls.sql` 346 · 1 692 · 0 · 220 sur 220), e7a refusait ; trois essais repris
(`sousDossierDansSonDossier`, et EL-F1, CP-F2 qui ignoraient les déclencheurs d'OPT6). Puis, sur l'accord du cabinet
(REPET2-Q1 (A)), les quatre premières lignes d'alors sont passées en production et sorties du tableau :
`compte_propre_hors_des_exercices_valides` (256), `sous_dossier_dans_son_dossier` (257), puis MCB5g, `ouverture_eclatee_par_compte`
(258, collée) et `ouverture_eclatee_a_la_validation` (259). **Le soir**, quatre préparées de plus, chacune éprouvée seule sur 259 —
SECU4-Q1 (la relecture adverse de sécurité des migrations 218 à 259), MCBR-Q2, NOE4R-Q1 et NOE4R-Q2 — puis la répétition
ci-dessus, pendant laquelle SECU4-Q1 (260) et MCBR-Q2 (261) sont passées en production.

## Les trois préparées d'après la répétition (27/11/2026 au soir)

Écrites pendant la répétition à 261 et jouées seules ce soir-là, elles sont entrées au tableau le 28/11/2026 (19 ter a à c), après
leur répétition seules, ensemble et en chaîne (ci-dessus). Leur récit : HISTORIQUE.md, « 27/11/2026 — SECU4-Q2 ET MCBR2-Q2 » et
« 27/11/2026 — ASSIST-Q1 : LE JOURNAL DE CONSOMMATION DE L'ASSISTANT (PRÉPARÉE, PAS APPLIQUÉE) » ; celui de leur répétition :
« 28/11/2026 — LES TROIS PRÉPARÉES D'APRÈS LA RÉPÉTITION, RÉPÉTÉES SEULES ET EN CHAÎNE ».
