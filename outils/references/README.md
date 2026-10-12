# Les dossiers de référence

Quatre dossiers FICTIFS, remis au cabinet le 12/10/2026 pour que son expert-comptable les recalcule avec son propre
logiciel. Ses chiffres deviendront des cas de référence de la suite, comme ceux du moteur de l'Urssaf
(`outils/cotisations/oracle.mjs`) : un oracle extérieur à l'application pour des règles métier qui n'en avaient pas.
Jusque-là, seules les cotisations Urssaf et les formats de la facture électronique étaient jugés par un tiers.

| Dossier | Ce que l'expert rend | Le moteur de l'application qu'il juge |
|---|---|---|
| A | la 2035 de 2025 d'une infirmière libérale (trésorerie, exonérée de TVA) | `calculerDeclaration2035`, `valeursDesCases` |
| B | la CA3 de mars 2026 d'un consultant (réel normal, TVA sur les encaissements) | `calculerCa3` |
| C | le plan d'amortissement des six biens de A | `planAmortissement` |
| D | le bilan 2033-A d'une SELARL à l'IS, depuis une balance après inventaire | `bilanDeLExercice` |

## Les fichiers

- `donnees.ts` — les quatre dossiers, la SEULE source : le document de l'expert et le calcul de nos chiffres en partent,
  jamais d'une recopie. Aucun import : des données, pas du code de l'application.
- `nosChiffres.test.ts` — nos chiffres, par les moteurs de l'application, dans l'ordre où les écrans les appellent ; il
  écrit aussi `donnees.json`, d'où le document se tire. Il est FIGÉ sur la version `c506932` : il appelle les moteurs
  avec leurs signatures de ce jour-là, n'est ni compilé ni joué par la suite, et ne se met pas à jour quand ils
  changent — c'est ce qui le rend rejouable.
- `generer.mjs` — la page, sa version imprimable et le classeur Excel (données importables, onglets « Réponses »).
- `pdf.mjs` — le PDF, depuis la version imprimable, polices de l'application lues sur le disque.
- `fuite.mjs` — cherche chacun de nos résultats dans la page et le classeur : une valeur retrouvée doit être un fait du
  dossier (une ligne de balance, la valeur d'un bien), jamais un total ni une rubrique calculée.
- `apercu.mjs` — la page à 1 280 et 390 px, clair et sombre, et ce qui déborderait.
- `pages.mjs` — des pages du PDF en images, par le pdf.js installé. Il pose une prothèse de
  `Map.prototype.getOrInsertComputed`, que pdf.js 6 appelle pour DESSINER une page et que le Chromium 141 de
  l'environnement n'a pas. L'application ne dessine jamais de page : elle lit le texte et les pièces jointes, et ce
  Chromium les lit sans la prothèse (vérifié le 12/10/2026).
- `navigateur.mjs` — le Chromium préinstallé, trouvé comme le banc le trouve (`outils/captures/vitrine.mjs`).

## Nos chiffres sont scellés

Ils ont été calculés le 12/10/2026 sur la version `c50693216fa9c590904ec0a78eec283afd6cbd77`, et ne se commitent
JAMAIS : le dépôt est public, et la comparaison n'a de valeur que si l'expert établit les siens sans les voir. Seule leur
empreinte est ici. Elle prouve que nos chiffres étaient fixés avant que les siens arrivent :

```
SHA-256 de nos_chiffres.json : 43765e348ef7dd217bcd1b2d074e769c89c1f71090655f1806fa8f294f75f4dc
```

Pour les refaire, à la même version (le calcul est déterministe : rejoué, il redonne la même empreinte) :

```bash
git worktree add /tmp/references c50693216fa9c590904ec0a78eec283afd6cbd77
mkdir -p /tmp/references/src/refs /tmp/references-sortie
cp outils/references/donnees.ts outils/references/nosChiffres.test.ts /tmp/references/src/refs/
(cd /tmp/references && npm ci && SORTIE_REFERENCES=/tmp/references-sortie npx vitest run src/refs/nosChiffres.test.ts)
sha256sum /tmp/references-sortie/nos_chiffres.json   # doit redonner l'empreinte ci-dessus
git worktree remove --force /tmp/references
```

## Refaire le document

Depuis la racine du dépôt, sur le `donnees.json` que le calcul vient d'écrire. Le navigateur ne reçoit jamais le
mandataire de l'environnement :

```bash
SANS_MANDATAIRE="env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy"
node outils/references/generer.mjs /tmp/references-sortie/donnees.json outils/references/sortie
$SANS_MANDATAIRE node outils/references/pdf.mjs outils/references/sortie/impression.html outils/references/sortie/dossiers-de-reference.pdf
node outils/references/fuite.mjs /tmp/references-sortie/nos_chiffres.json /tmp/references-sortie/donnees.json \
  outils/references/sortie/dossiers-de-reference.html outils/references/sortie/dossiers-de-reference.xlsx
$SANS_MANDATAIRE node outils/references/apercu.mjs outils/references/sortie/dossiers-de-reference.html outils/references/sortie
$SANS_MANDATAIRE NO_PROXY=127.0.0.1 node outils/references/pages.mjs outils/references/sortie/dossiers-de-reference.pdf outils/references/sortie 1 3 17
```

`fuite.mjs` doit finir sur « trouvées SANS être dans les données : 0 ». `outils/references/sortie/` est ignoré par git :
le document, comme nos chiffres, ne se commite pas.

## La suite

Quand l'expert rend ses chiffres (onglets « Réponses » du classeur), chaque écart s'analyse : faute de l'application,
convention différente, ou donnée insuffisante. Puis ses chiffres entrent dans la suite comme cas de référence, par des
tests qui appellent les moteurs D'AUJOURD'HUI sur `donnees.ts` — c'est alors, et seulement alors, que ces données
rejoignent `src/`.
