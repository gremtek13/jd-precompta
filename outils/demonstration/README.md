# Le dossier de démonstration

Un dossier **fictif** complet — un infirmier libéral, BNC en trésorerie, exonéré de TVA, l'année 2025 entière et 2026
jusqu'à la mi-novembre — livré comme un **fichier de sauvegarde** que le super-administrateur restaure d'un clic depuis
l'application (« Comptes master », en bas : « Restaurer une sauvegarde »). Rien ne s'écrit en production par SQL : la
restauration de l'écran est le chemin que les gardes de la base admettent. Demande du cabinet du 16/11/2026 ; récit dans
HISTORIQUE.md (« 16/11/2026 — LE DOSSIER DE DÉMONSTRATION »).

- La composition : `src/test/dossierDeDemonstration.ts` (déterministe, aucun tirage : deux compositions rendent le même
  fichier à l'octet ; les écritures sont celles des vrais moteurs, l'enchaînement de `src/test/fecFictif.ts`).
- Le test : `src/lib/dossierDeDemonstration.test.ts` (le lecteur de l'écran accepte le fichier, rien que la restauration
  refuserait, les points de la Vue d'ensemble voulus et eux seuls, la 2035 de 2025 qui concorde, 2025 validable).
- Le fichier **ne se commite pas** (l'outil refuse un dossier de sortie dans le dépôt).

## Écrire le fichier

```bash
node outils/demonstration/lancer.mjs <dossier hors du dépôt> <identifiant du cabinet>
```

L'identifiant est celui du cabinet qui recevra le dossier (`cabinets.id`) : la sauvegarde ne porte pas la ligne du
cabinet, et la restauration refuse, avant toute écriture, un cabinet absent de la base. L'outil relit le fichier par
`lireSauvegarde` avant de l'écrire, et dit son chemin, sa taille et son SHA-256.

## Ce que le dossier porte

| | |
|---|---|
| Relevés | 21 relevés mensuels contrôlés (2025 ; 2026 de janvier à octobre **sauf juillet**, volontairement absent) |
| Mouvements | 211 : 186 rapprochés, 21 virements au compte personnel ignorés, **4 à rapprocher** (octobre et septembre 2026) |
| Pièces | 35 : 31 validées (dont 2 notes d'honoraires de vente et l'appareil immobilisé), **4 à valider** (une à faible confiance, un doublon probable) |
| Cotisations | 28 échéances (Urssaf mensuelle, CARPIMKO semestrielle, une régularisation) ; 26 rapprochées — juillet et novembre 2026 non |
| Caisse | 24 opérations : 22 recettes en espèces, un achat payé en espèces, un prélèvement de l'exploitant ; 5 versements en banque |
| Inventaire | un électrocardiographe amorti sur 5 ans (dotation 2025 écrite), un véhicule au barème en 2025 (forfait écrit) et en 2026 |
| Écritures | 491 au brouillon (287 en 2025, 204 en 2026), aucune validée ; une balance reprise au 01/01/2025 (banque 6 000,00) |
| Cotisations (paramètres) | début d'activité au 01/03/2019, ACRE dite « non » pour 2025 et 2026 |

Les points de la Vue d'ensemble au 16/11/2026 : la rupture de la suite des soldes (juillet absent) et ses deux suites —
l'achat de juillet validé dont le montant n'est dans aucun mouvement (« erreur ») et dont le paiement manque —, le doublon
probable, la pièce à faible confiance, les quatre mouvements à rapprocher. 2025 est muette, sa 2035 se calcule (recettes
77 835,00, résultat 50 864,25) et concorde avec les écritures ; elle se validerait sans préalable.

Ce qu'il ne porte pas : aucun exercice validé, aucune connexion (banque, plateforme), aucun accès client, aucun compte
utilisateur, aucune facture émise (dans un dossier non basculé, une facture validée n'est pas la source de sa vente ; en
restaurer une demanderait d'imiter ses mentions figées, sa série et son exemplaire — le cabinet en crée lui-même), aucun
**fichier** de pièce : une sauvegarde porte les lignes, pas le stockage ; la fiche d'une pièce dit « Aperçu indisponible. »
et sa relecture « Impossible de récupérer le fichier existant. ». Ni la table `categories` : les catégories citées sont
cinq catégories communes de la production (les identifiants relevés le 08/11/2026), que la restauration **vérifie avant
toute écriture** comme références externes ; une catégorie inconnue de la base refuse tout, jamais une catégorie commune
créée pour tous les cabinets. Les horodatages précèdent tous l'instant du fichier (16/11/2026 08:00 UTC) : les gardes ne
laissent passer une insertion de restauration que datée d'avant `now()`.

## L'éprouver sur une réplique

Sur une copie de la réplique portée à la production du jour, les cinq catégories communes posées à leurs identifiants de
production, le fichier écrit pour le cabinet de la réplique :

```bash
node outils/demonstration/lancer.mjs replique sql <sauvegarde.json> <uid d'un super-administrateur> > restaurer.sql
psql … -f restaurer.sql                       # une instruction par lot, sous le rôle authenticated
node outils/demonstration/lancer.mjs replique relire <sauvegarde.json> <uid> > relire.sql
psql … -At -f relire.sql > relu.json
node outils/demonstration/lancer.mjs replique controler <sauvegarde.json> relu.json
```

`sql` rejoue les refus d'avant écriture, `planReinsertion` et `lotsDEcriture` de l'écran, chaque lot écrit comme
PostgREST l'écrit ; `controler` compare les lignes relues à la sauvegarde puis rejoue sur elles la Vue d'ensemble, la 2035
de 2025, sa concordance et les préalables de la validation.

## Retirer le dossier

Onglet « Informations » du dossier, carte « Zone dangereuse », « Supprimer ce dossier définitivement », puis taper le nom
`Dossier fictif de démonstration` (sans ponctuation, pour un iPhone). La base emporte tout en cascade ; aucune catégorie
commune n'est touchée. Restaurer de nouveau le fichier redonne le dossier tel qu'au premier jour.
