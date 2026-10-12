// Génère, depuis donnees.json (les quatre dossiers de référence, fictifs), le document remis à l'expert-comptable :
//   - la page publiée (corps HTML, sans squelette : la publication l'ajoute) ;
//   - la même page autonome, mise en page pour l'impression (le PDF en sort) ;
//   - le classeur Excel : les données, importables, et les grilles de réponse.
// AUCUN de nos chiffres n'y figure : la comparaison n'a de valeur que si l'expert calcule sans les voir.
//
//   node outils/references/generer.mjs <donnees.json> <dossier de sortie>      (README.md de ce dossier)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import ExcelJS from 'exceljs'

const [, , fichierDonnees, sortie] = process.argv
const D = JSON.parse(readFileSync(fichierDonnees, 'utf8'))
mkdirSync(sortie, { recursive: true })

// ── Mise en forme ────────────────────────────────────────────────────────────────────────────────────────────────────
const nombre = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const montant = (n) => (n === null || n === undefined ? '' : nombre.format(n))
const date = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const insecables = (t) => String(t)
  .replace(/ ([:;!?%€»])/g, '\u00a0$1').replace(/« /g, '«\u00a0')
  .replace(/(\d) (\d{3})(?!\d)/g, '$1\u202f$2').replace(/(\d) (km|CV|ans|mois)\b/g, '$1\u00a0$2').replace(/n° /g, 'n°\u00a0')
const echapper = (t) => insecables(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cents = (n) => Math.round(n * 100)

function tableau(entetes, lignes, classe = '') {
  const th = entetes.map((e) => `<th scope="col" class="${e.num ? 'num' : ''}">${echapper(e.titre)}</th>`).join('')
  const classes = (e) => [e.num && 'num', e.code && 'code', e.nowrap && 'nowrap'].filter(Boolean).join(' ')
  const tr = lignes.map((l) => `<tr>${l.map((c, i) => `<td class="${classes(entetes[i])}">${c}</td>`).join('')}</tr>`).join('\n')
  return `<div class="defile"><table class="${classe}"><thead><tr>${th}</tr></thead><tbody>\n${tr}\n</tbody></table></div>`
}

const caseCode = (code) => `<span class="case">${echapper(code)}</span>`
const puces = (points) => `<ul class="situation">${points.map((p) => `<li>${echapper(p)}</li>`).join('')}</ul>`

// Le relevé, avec son solde courant : un fait du relevé, pas un résultat. Il permet de contrôler un import.
function releve(mouvements, soldeInitial) {
  let solde = cents(soldeInitial)
  let plusBas = solde
  const lignes = mouvements.map((m) => {
    solde += cents(m.montant)
    plusBas = Math.min(plusBas, solde)
    return [
      date(m.date), echapper(m.libelle),
      m.montant < 0 ? montant(-m.montant) : '', m.montant > 0 ? montant(m.montant) : '',
      montant(solde / 100), pieceDuMouvement(m), echapper(m.nature),
    ]
  })
  if (plusBas < 0) throw new Error('Le relevé passe en négatif : revoir le solde initial.')
  return { lignes, soldeFinal: solde / 100 }
}

const ENTETES_RELEVE = [
  { titre: 'Date', nowrap: true }, { titre: 'Libellé du relevé' }, { titre: 'Débit', num: true }, { titre: 'Crédit', num: true },
  { titre: 'Solde', num: true }, { titre: 'Pièce', nowrap: true }, { titre: 'Ce que c’est' },
]
const ENTETES_SANS_SOLDE = ENTETES_RELEVE.filter((e) => e.titre !== 'Solde')
const pieceDuMouvement = (m) => (m.modele.type === 'piece' ? echapper(m.modele.piece) : '')
const sansSolde = (mouvements) => mouvements.map((m) => [
  date(m.date), echapper(m.libelle), m.montant < 0 ? montant(-m.montant) : '', m.montant > 0 ? montant(m.montant) : '',
  pieceDuMouvement(m), echapper(m.nature),
])

// ── Le contenu ───────────────────────────────────────────────────────────────────────────────────────────────────────
const A = D.a
const B = D.b
const DD = D.d
const F = D.formulaires

const releveA = releve(A.releve, A.soldeInitial)
const soldeInitialB = B.soldeInitial
if (typeof soldeInitialB !== 'number') throw new Error('Le solde initial du dossier B manque aux données.')
const releveB = releve(B.releve, soldeInitialB)

const piecesA = A.pieces.map((p) => [
  echapper(p.id), date(p.date), echapper(p.tiers), echapper(p.objet),
  montant(p.ht), montant(p.tva), montant(p.ttc), p.immobilisation ? 'Immobilisation (registre, dossier C)' : '',
])
const ENTETES_PIECES = [
  { titre: 'Pièce', nowrap: true }, { titre: 'Date', nowrap: true }, { titre: 'Émetteur' }, { titre: 'Objet' },
  { titre: 'HT', num: true }, { titre: 'TVA', num: true }, { titre: 'TTC', num: true }, { titre: 'Remarque' },
]

const cotisationsA = A.cotisations.map((c) => [
  echapper(c.organisme), date(c.echeance), montant(c.montant), montant(c.montant < 0 ? -c.csgCrds : c.csgCrds), echapper(c.objet),
])

const pret2025 = A.echeancesDuPret.filter((e) => e.date.startsWith('2025-'))
const pretA = pret2025.map((e) => [
  String(e.numero), date(e.date), montant(e.capital), montant(e.interets), montant(e.assurance), montant(e.total), montant(e.restantDu),
])

const registre = A.registre.map((b) => [
  echapper(b.libelle), montant(b.valeur), date(b.dateAcquisition), date(b.dateMiseEnService), `${b.dureeAnnees} ans`,
  b.piece ? `Facture ${echapper(b.piece)} (2025)` : 'Exercice antérieur',
])

const piecesB = B.pieces.map((p) => [
  echapper(p.id), date(p.date), echapper(p.tiers), echapper(p.objet), montant(p.ht), montant(p.tva), montant(p.ttc),
  p.type === 'vente' ? 'Vente' : 'Achat',
])

const balanceD = DD.balance.map((l) => [
  echapper(l.compte), `${echapper(l.libelle)}${l.tiers ? ` — <em>${echapper(l.tiers)}</em>` : ''}`,
  l.solde > 0 ? montant(l.solde) : '', l.solde < 0 ? montant(-l.solde) : '',
])
const totalDebitD = DD.balance.filter((l) => l.solde > 0).reduce((s, l) => s + cents(l.solde), 0) / 100
const totalCreditD = DD.balance.filter((l) => l.solde < 0).reduce((s, l) => s - cents(l.solde), 0) / 100
if (totalDebitD !== totalCreditD) throw new Error('La balance du dossier D ne s’équilibre pas.')

// Les grilles de réponse : la structure des formulaires, sans aucun montant.
const grilleA = F.cases2035.map((c) => [caseCode(c.code), echapper(c.formulaire), echapper(c.ligne), c.sousCaseDe ? `<span class="sous-case">${echapper(c.libelle)}</span>` : echapper(c.libelle), '', ''])
const grilleB = F.lignesCa3.map((l) => [caseCode(l.ligne), echapper(l.code), echapper(l.libelle), l.aUneBase ? '' : '<span class="sans">—</span>', '', ''])
const grilleC = A.registre.flatMap((b) => [
  [echapper(b.libelle), 'Dotation 2025', '', ''],
  [echapper(b.libelle), 'Dotation 2026', '', ''],
  [echapper(b.libelle), 'Amortissements cumulés au 31/12/2025', '', ''],
  [echapper(b.libelle), 'Valeur nette au 31/12/2025', '', ''],
  [echapper(b.libelle), 'Dernière annuité : année et montant', '', ''],
]).concat([['<strong>Tous les biens</strong>', '<strong>Total des dotations 2025</strong>', '', '']])
const T = F.totaux2033
const enGras = (texte) => `<strong>${echapper(texte)}</strong>`
const casesActif = (c) => `${caseCode(c.brut)} ${caseCode(c.amortissements)}`
const dansLaMasse = (rubriques, masse) => rubriques.filter((r) => r.masse === masse)
const MASSES_ACTIF = ['immobilise', 'circulant']
const MASSES_PASSIF = ['capitaux-propres', 'provisions', 'dettes']
if (F.actif2033.some((r) => !MASSES_ACTIF.includes(r.masse)) || F.passif2033.some((r) => !MASSES_PASSIF.includes(r.masse))) {
  throw new Error('Une rubrique du 2033-A appartient à une masse inconnue du générateur.')
}
const grilleDActif = [
  ...dansLaMasse(F.actif2033, 'immobilise').map((r) => [echapper(r.libelle), casesActif(r.cases), '', '', '']),
  [enGras('Total de l’actif immobilisé'), casesActif(T.actifImmobilise), '', '', ''],
  ...dansLaMasse(F.actif2033, 'circulant').map((r) => [echapper(r.libelle), casesActif(r.cases), '', '', '']),
  [enGras('Total de l’actif circulant'), casesActif(T.actifCirculant), '', '', ''],
  [enGras('Total de l’actif'), casesActif(T.totalActif), '', '', ''],
]
const grilleDPassif = [
  ...dansLaMasse(F.passif2033, 'capitaux-propres').map((r) => [echapper(r.libelle), caseCode(r.case), '']),
  [enGras('Total des capitaux propres'), caseCode(T.capitauxPropres), ''],
  ...dansLaMasse(F.passif2033, 'provisions').map((r) => [echapper(r.libelle), caseCode(r.case), '']),
  ...dansLaMasse(F.passif2033, 'dettes').map((r) => [echapper(r.libelle), caseCode(r.case), '']),
  [enGras('Total des dettes'), caseCode(T.dettes), ''],
  [enGras('Total du passif'), caseCode(T.totalPassif), ''],
]

const corps = `
<header class="tete">
  <p class="surtitre">Demande de contre-calcul · données fictives</p>
  <h1>Dossiers de référence</h1>
  <p class="chapo">Quatre dossiers fictifs, à recalculer avec votre logiciel habituel, comme pour un vrai client. Vos chiffres
  serviront de référence pour vérifier ceux de l’application du cabinet.</p>
  <nav class="sommaire" aria-label="Dossiers">
    <a href="#a"><b>A</b> Déclaration 2035 · infirmière libérale</a>
    <a href="#b"><b>B</b> CA3 de mars 2026 · consultant</a>
    <a href="#c"><b>C</b> Plan d’amortissement</a>
    <a href="#d"><b>D</b> Bilan 2033-A · SELARL</a>
    <a href="#reponses"><b>✓</b> Grille de réponse</a>
  </nav>
</header>

<section class="consignes" aria-labelledby="consignes-titre">
  <h2 id="consignes-titre">Ce que nous vous demandons</h2>
  <ul>
    <li>Recalculer chaque dossier avec votre logiciel et votre jugement professionnel. Aucune réponse n’est fournie, à dessein : la comparaison n’a de valeur que si vos chiffres sont établis indépendamment des nôtres.</li>
    <li>Toutes les données sont fictives : aucune personne, aucune entreprise, aucun numéro réel.</li>
    <li>Reporter vos montants dans la grille de réponse, de préférence dans le classeur Excel joint (onglets « Réponses »). La colonne « Remarque » sert à noter une convention ou un choix qui a pesé : prorata temporis en jours exacts ou en 360, case retenue pour une dépense, arrondis, traitement d’un avoir.</li>
    <li>Si une donnée vous manque pour conclure, notez l’hypothèse que vous avez retenue.</li>
    <li>Le relevé du dossier A compte ${A.releve.length} lignes ; il est importable depuis le classeur (onglet « A – Relevé 2025 »). Les opérations répétitives peuvent être saisies en une écriture par nature si votre logiciel le permet.</li>
  </ul>
</section>

<section id="a" class="dossier" aria-labelledby="a-titre">
  <p class="lettre">A</p>
  <h2 id="a-titre">${echapper(A.situation.titre)}</h2>
  ${puces(A.situation.points)}

  <h3>Les pièces</h3>
  <p class="note">Les factures des fournisseurs portent la TVA, que l’infirmière ne récupère pas. Les montants négatifs sont des avoirs.</p>
  ${tableau(ENTETES_PIECES, piecesA)}

  <h3>Le relevé bancaire 2025</h3>
  <p class="note">Solde au 1<sup>er</sup> janvier 2025 : <span class="chiffre">${montant(A.soldeInitial)}</span> € ; solde au 31 décembre 2025 : <span class="chiffre">${montant(releveA.soldeFinal)}</span> €. Chaque ligne dit ce qu’elle paie ou encaisse ; une pièce citée est dans le tableau ci-dessus.</p>
  ${tableau(ENTETES_RELEVE, releveA.lignes, 'releve')}

  <h3>Après la clôture, pour mémoire</h3>
  <p class="note">Deux mouvements de janvier 2026 qui concernent des opérations de 2025.</p>
  ${tableau(ENTETES_SANS_SOLDE, sansSolde(A.apresCloture))}

  <h3>Les cotisations sociales personnelles</h3>
  <p class="note">Chaque échéance est prélevée à sa date ; la colonne CSG-CRDS reprend l’avis d’appel. La régularisation de novembre est un remboursement.</p>
  ${tableau([{ titre: 'Organisme' }, { titre: 'Date' }, { titre: 'Montant', num: true }, { titre: 'dont CSG-CRDS', num: true }, { titre: 'Objet' }], cotisationsA)}

  <h3>Le prêt professionnel</h3>
  <p class="note">Prêt de <span class="chiffre">${montant(A.pret.capitalInitial)}</span> € débloqué le ${date(A.pret.deblocage)}, ${A.pret.duree} au taux nominal de ${A.pret.taux}, première échéance le ${date(A.pret.premiereEcheance)}. Échéances de 2025, d’après le tableau d’amortissement de la banque :</p>
  ${tableau([{ titre: 'N°' }, { titre: 'Date' }, { titre: 'Capital', num: true }, { titre: 'Intérêts', num: true }, { titre: 'Assurance', num: true }, { titre: 'Échéance', num: true }, { titre: 'Capital restant dû', num: true }], pretA)}

  <h3>Le véhicule</h3>
  <p class="note">Voiture personnelle, thermique, ${A.vehicule.puissanceFiscale} CV fiscaux ; <span class="chiffre">${nombre.format(A.vehicule.kmProfessionnels).replace(',00', '')}</span> km parcourus à titre professionnel en 2025 (relevé des tournées). L’infirmière opte pour le barème kilométrique BNC.</p>

  <h3>Les immobilisations</h3>
  <p class="note">Le registre est celui du dossier C.</p>

  <div class="rendre"><p><strong>À rendre</strong> : la déclaration 2035 de 2025 — recettes et dépenses (lignes 1 à 33, cases AA à BR), résultat fiscal (lignes 34 à 47, cases CA à CR), le total A du cadre 7 (barème kilométrique) et le cadre 8 (revenu brut social).</p></div>
</section>

<section id="b" class="dossier" aria-labelledby="b-titre">
  <p class="lettre">B</p>
  <h2 id="b-titre">${echapper(B.situation.titre)}</h2>
  ${puces(B.situation.points)}

  <h3>Les pièces</h3>
  <p class="note">Factures émises (ventes) et reçues (achats), et deux avoirs. Les montants négatifs sont des avoirs.</p>
  ${tableau(ENTETES_PIECES.slice(0, 7).concat([{ titre: 'Sens' }]), piecesB)}

  <h3>Le relevé bancaire de mars 2026</h3>
  <p class="note">Solde au 1<sup>er</sup> mars 2026 : <span class="chiffre">${montant(soldeInitialB)}</span> € ; solde au 31 mars 2026 : <span class="chiffre">${montant(releveB.soldeFinal)}</span> €.</p>
  ${tableau(ENTETES_RELEVE, releveB.lignes, 'releve')}

  <h3>Après la période, pour mémoire</h3>
  ${tableau(ENTETES_SANS_SOLDE, sansSolde(B.apresPeriode))}

  <div class="rendre"><p><strong>À rendre</strong> : la CA3 de mars 2026, ligne par ligne (bases et taxes), jusqu’au crédit à reporter ou à la TVA nette due.</p></div>
</section>

<section id="c" class="dossier" aria-labelledby="c-titre">
  <p class="lettre">C</p>
  <h2 id="c-titre">Dossier C — plan d’amortissement du registre de l’infirmière (dossier A)</h2>
  ${puces([
    'Le registre des immobilisations de l’infirmière du dossier A. Exonérée de TVA, elle amortit les biens pour leur valeur TTC.',
    'Amortissement linéaire, à compter de la date de mise en service, sur la durée indiquée.',
    'Les biens acquis en 2025 ont été payés depuis le compte professionnel (voir le relevé du dossier A).',
  ])}
  ${tableau([{ titre: 'Bien' }, { titre: 'Valeur', num: true }, { titre: 'Acquisition' }, { titre: 'Mise en service' }, { titre: 'Durée' }, { titre: 'Origine' }], registre)}
  <div class="rendre"><p><strong>À rendre</strong> : pour chaque bien, la dotation 2025 et 2026, les amortissements cumulés et la valeur nette au 31 décembre 2025, la dernière annuité ; le total des dotations 2025. Le tableau d’amortissement édité par votre logiciel suffit, avec la convention de calcul retenue.</p></div>
</section>

<section id="d" class="dossier" aria-labelledby="d-titre">
  <p class="lettre">D</p>
  <h2 id="d-titre">${echapper(DD.situation.titre)}</h2>
  ${puces(DD.situation.points)}
  <h3>Balance générale au 31 décembre 2025, après inventaire</h3>
  ${tableau([{ titre: 'Compte' }, { titre: 'Intitulé' }, { titre: 'Solde débiteur', num: true }, { titre: 'Solde créditeur', num: true }], balanceD.concat([['', '<strong>Totaux</strong>', `<strong>${montant(totalDebitD)}</strong>`, `<strong>${montant(totalCreditD)}</strong>`]]))}
  <div class="rendre"><p><strong>À rendre</strong> : le bilan simplifié 2033-A au 31 décembre 2025, actif (brut, amortissements, net) et passif, totaux compris.</p></div>
</section>

<section id="reponses" class="dossier" aria-labelledby="reponses-titre">
  <p class="lettre">✓</p>
  <h2 id="reponses-titre">Grille de réponse</h2>
  <p class="note">La même grille est dans le classeur Excel, onglets « Réponses ». Une case sans objet se laisse vide.</p>

  <h3>A — Déclaration 2035 de 2025</h3>
  ${tableau([{ titre: 'Case', code: true }, { titre: 'Formulaire' }, { titre: 'Ligne', nowrap: true }, { titre: 'Libellé' }, { titre: 'Votre montant', num: true }, { titre: 'Remarque' }], grilleA, 'grille')}
  <p class="note">Et le total A du cadre 7 de la 2035-B (indemnités kilométriques) : <span class="blanc"></span> €.</p>

  <h3>B — CA3 de mars 2026</h3>
  ${tableau([{ titre: 'Ligne', code: true }, { titre: 'Code' }, { titre: 'Libellé' }, { titre: 'Base HT', num: true }, { titre: 'Montant', num: true }, { titre: 'Remarque' }], grilleB, 'grille')}

  <h3>C — Plan d’amortissement</h3>
  ${tableau([{ titre: 'Bien' }, { titre: 'Élément' }, { titre: 'Votre montant', num: true }, { titre: 'Remarque' }], grilleC, 'grille')}
  <p class="note">Convention de prorata temporis retenue (jours exacts, 360 jours, mois entiers…) : <span class="blanc large"></span></p>

  <h3>D — Bilan 2033-A au 31/12/2025</h3>
  ${tableau([{ titre: 'Actif' }, { titre: 'Cases (brut, amort.)', code: true }, { titre: 'Brut', num: true }, { titre: 'Amortissements', num: true }, { titre: 'Net', num: true }], grilleDActif, 'grille')}
  ${tableau([{ titre: 'Passif' }, { titre: 'Case', code: true }, { titre: 'Votre montant', num: true }], grilleDPassif, 'grille')}
  <p class="note">Les numéros de case sont ceux que l’application attribue d’après le 2033-A-SD ; si votre formulaire en porte un autre, notez-le en remarque.</p>
</section>

<footer class="pied">
  <p>Document préparé le 12 octobre 2026 pour le cabinet. Données fictives, établies pour un contre-calcul : elles ne décrivent aucune situation réelle.</p>
</footer>
`

const style = `
:root {
  /* Une page de travail sobre, à la manière d'une liasse : du papier, de l'encre, et les codes des cases encadrés comme sur un cerfa. */
  --papier: #ffffff;
  --encre: #1c2630;
  --encre-douce: #566472;
  --filet: #d6dde4;
  --zebre: #f4f7f9;
  --accent: #1d5c78;
  --accent-voile: #e3eef3;
  --a-rendre: #fff8e1;
  --a-rendre-filet: #e5c56b;
  --texte: 'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  --chiffres: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --papier: #11171c; --encre: #e2e8ee; --encre-douce: #9aa8b5; --filet: #2b3640; --zebre: #161e25;
    --accent: #84bdd6; --accent-voile: #1a2c36; --a-rendre: #2a2412; --a-rendre-filet: #7d6726; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --papier: #11171c; --encre: #e2e8ee; --encre-douce: #9aa8b5; --filet: #2b3640; --zebre: #161e25;
  --accent: #84bdd6; --accent-voile: #1a2c36; --a-rendre: #2a2412; --a-rendre-filet: #7d6726; color-scheme: dark;
}
body { background: var(--papier); color: var(--encre); font-family: var(--texte); font-size: 15px; line-height: 1.55; margin: 0; font-variant-ligatures: no-common-ligatures; }
.page { max-width: 1040px; margin: 0 auto; padding-inline: 20px; padding-block: 28px 56px; }
h1, h2, h3 { text-wrap: balance; line-height: 1.2; }
h1 { font-size: 2.1rem; margin: 0.2rem 0 0.6rem; letter-spacing: -0.01em; }
h2 { font-size: 1.35rem; margin: 0 0 0.8rem; }
h3 { font-size: 1.02rem; margin: 1.8rem 0 0.4rem; color: var(--accent); }
.surtitre { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--encre-douce); margin: 0; }
.chapo { max-width: 65ch; font-size: 1.05rem; color: var(--encre-douce); margin: 0 0 1.2rem; }
.sommaire { display: flex; flex-wrap: wrap; gap: 8px; }
.sommaire a { color: var(--encre); text-decoration: none; border: 1px solid var(--filet); border-radius: 6px; padding: 6px 10px; font-size: 0.88rem; }
.sommaire a b { color: var(--accent); margin-right: 4px; }
.sommaire a:hover, .sommaire a:focus-visible { border-color: var(--accent); outline: none; }
.consignes { border-top: 2px solid var(--encre); margin-top: 1.6rem; padding-top: 1rem; }
.consignes ul, .situation { max-width: 72ch; padding-left: 1.2rem; margin: 0; display: grid; gap: 6px; }
.dossier { border-top: 2px solid var(--encre); margin-top: 2.6rem; padding-top: 1rem; position: relative; }
.lettre { position: absolute; top: -1px; right: 0; margin: 0; background: var(--encre); color: var(--papier); font-family: var(--chiffres); font-weight: 600; padding: 2px 10px; font-size: 0.9rem; }
.note { color: var(--encre-douce); max-width: 80ch; margin: 0.3rem 0 0.6rem; font-size: 0.92rem; }
.chiffre, td.num, th.num { font-variant-numeric: tabular-nums; }
.defile { overflow-x: auto; margin: 0.4rem 0 0.8rem; border: 1px solid var(--filet); border-radius: 4px; }
table { border-collapse: collapse; width: 100%; font-size: 0.84rem; }
th { text-align: left; font-weight: 600; background: var(--accent-voile); color: var(--encre); padding: 6px 8px; border-bottom: 1px solid var(--filet); white-space: nowrap; }
td { padding: 4px 8px; border-bottom: 1px solid var(--filet); vertical-align: top; }
tbody tr:nth-child(even) td { background: var(--zebre); }
td.num, th.num { text-align: right; white-space: nowrap; }
table.releve td:nth-child(1) { white-space: nowrap; }
.case { display: inline-block; font-family: var(--chiffres); font-size: 0.78rem; border: 1px solid var(--accent); color: var(--accent); padding: 0 4px; border-radius: 2px; line-height: 1.4; }
.sous-case { display: inline-block; padding-left: 1.1em; font-style: italic; }
.nowrap { white-space: nowrap; }
.sans { color: var(--encre-douce); }
table.grille td:nth-last-child(-n+2) { min-width: 9rem; }
.rendre { background: var(--a-rendre); border-left: 3px solid var(--a-rendre-filet); padding: 8px 12px; margin-top: 1rem; max-width: 80ch; }
.rendre p { margin: 0; }
.blanc { display: inline-block; min-width: 8rem; border-bottom: 1px dotted var(--encre-douce); }
.blanc.large { min-width: 18rem; }
.pied { margin-top: 3rem; border-top: 1px solid var(--filet); padding-top: 0.8rem; color: var(--encre-douce); font-size: 0.82rem; }
@media (max-width: 520px) { h1 { font-size: 1.7rem; } .lettre { position: static; display: inline-block; margin-bottom: 6px; } }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
`

const polices = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Public+Sans:wght@400;600;700&display=swap">'

// La page publiée : sans squelette, la publication l'ajoute.
writeFileSync(`${sortie}/dossiers-de-reference.html`, `<title>Dossiers de référence</title>\n${polices}\n<style>${style}</style>\n<main class="page">${corps}</main>\n`)

// La version autonome pour l'impression : même contenu, en A4, chaque dossier sur une nouvelle page.
// Les polices de l'impression : celles que l'application installe, lues sur le disque — le PDF ne charge rien du réseau.
const POLICES = new URL('../../node_modules/@fontsource/ibm-plex-sans/files/', import.meta.url).href
const impression = `
@page { size: A4; }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 400; src: url('${POLICES}ibm-plex-sans-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 600; src: url('${POLICES}ibm-plex-sans-latin-600-normal.woff2') format('woff2'); }
@font-face { font-family: 'IBM Plex Sans'; font-weight: 700; src: url('${POLICES}ibm-plex-sans-latin-700-normal.woff2') format('woff2'); }
:root { --texte: 'IBM Plex Sans', sans-serif; --chiffres: 'IBM Plex Sans', sans-serif; }
.case, .lettre { font-family: 'DejaVu Sans Mono', monospace; }
body { font-size: 10pt; }
.page { max-width: none; padding: 0; }
.defile { overflow: visible; border: none; }
table { font-size: 8pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.dossier { break-before: page; margin-top: 0; }
.sommaire a { border: none; padding: 0 8px 0 0; }
h3 { break-after: avoid; }
`
writeFileSync(`${sortie}/impression.html`, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossiers de référence</title><style>${style}${impression}</style></head><body><main class="page">${corps}</main></body></html>`)

// ── Le classeur Excel ────────────────────────────────────────────────────────────────────────────────────────────────
const classeur = new ExcelJS.Workbook()
classeur.creator = 'jd-precompta'
classeur.created = new Date('2026-10-12T12:00:00Z')
const FORMAT_MONTANT = '#,##0.00'
const SANS_OBJET = Symbol('sans objet')
const enDate = (iso) => new Date(`${iso}T00:00:00Z`)
const ACCENT = 'FF1D5C78'
const VOILE = 'FFE3EEF3'
const A_REMPLIR = 'FFFFF8E1'

function feuille(nom, colonnes, lignes, { titre, notes = [] } = {}) {
  const f = classeur.addWorksheet(nom, { views: [{ state: 'frozen', ySplit: (titre ? 1 : 0) + notes.length + 1 }] })
  let rang = 1
  if (titre) {
    f.getCell(rang, 1).value = titre
    f.getCell(rang, 1).font = { bold: true, size: 13, color: { argb: ACCENT } }
    rang++
  }
  for (const n of notes) {
    f.getCell(rang, 1).value = n
    f.getCell(rang, 1).font = { italic: true, color: { argb: 'FF566472' } }
    rang++
  }
  colonnes.forEach((c, i) => {
    const cellule = f.getCell(rang, i + 1)
    cellule.value = c.titre
    cellule.font = { bold: true }
    cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VOILE } }
    f.getColumn(i + 1).width = c.largeur ?? 14
  })
  for (const l of lignes) {
    rang++
    l.forEach((v, i) => {
      const cellule = f.getCell(rang, i + 1)
      const c = colonnes[i]
      if (v === SANS_OBJET) {
        cellule.value = '—'
        cellule.alignment = { horizontal: 'center' }
        cellule.font = { color: { argb: 'FF9AA8B5' } }
        return
      }
      cellule.value = v
      if (c.type === 'montant') cellule.numFmt = FORMAT_MONTANT
      if (c.type === 'date') cellule.numFmt = 'dd/mm/yyyy'
      if (c.aRemplir) cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: A_REMPLIR } }
    })
  }
  return f
}

const lisezMoi = classeur.addWorksheet('Lisez-moi')
lisezMoi.getColumn(1).width = 120
;[
  ['Dossiers de référence — demande de contre-calcul (données fictives)', { bold: true, size: 14, color: { argb: ACCENT } }],
  ['Quatre dossiers fictifs à recalculer avec votre logiciel habituel, comme pour un vrai client. Vos chiffres serviront de référence pour vérifier ceux de l’application du cabinet.'],
  ['Aucune réponse n’est fournie, à dessein : la comparaison n’a de valeur que si vos chiffres sont établis indépendamment des nôtres.'],
  ['Toutes les données sont fictives : aucune personne, aucune entreprise, aucun numéro réel.'],
  [''],
  ['Onglets', { bold: true }],
  ['A – Situation, A – Pièces, A – Relevé 2025 (importable), A – Cotisations, A – Prêt : la déclaration 2035 de 2025 d’une infirmière libérale.'],
  ['B – Situation, B – Pièces, B – Relevé mars 2026 : la CA3 de mars 2026 d’un consultant redevable de la TVA.'],
  ['C – Immobilisations : le registre de l’infirmière du dossier A, à amortir.'],
  ['D – Situation, D – Balance 2025 : le bilan simplifié 2033-A d’une SELARL.'],
  ['Réponses A, Réponses B, Réponses C, Réponses D : vos montants dans les cellules jaunes, et en remarque toute convention ou tout choix qui a pesé.'],
  [''],
  ['Si une donnée vous manque pour conclure, notez l’hypothèse retenue. Une case sans objet se laisse vide.'],
].forEach(([texte, police], i) => {
  const c = lisezMoi.getCell(i + 1, 1)
  c.value = texte
  c.alignment = { wrapText: true, vertical: 'top' }
  if (police) c.font = police
})

const situation = (nom, s, extra = []) => {
  const f = classeur.addWorksheet(nom)
  f.getColumn(1).width = 120
  f.getCell(1, 1).value = s.titre
  f.getCell(1, 1).font = { bold: true, size: 13, color: { argb: ACCENT } }
  ;[...s.points, ...extra].forEach((p, i) => {
    const c = f.getCell(i + 3, 1)
    c.value = `• ${p}`
    c.alignment = { wrapText: true, vertical: 'top' }
  })
}

situation('A – Situation', A.situation, [
  `Véhicule : voiture personnelle thermique de ${A.vehicule.puissanceFiscale} CV, ${A.vehicule.kmProfessionnels} km professionnels en 2025, barème kilométrique BNC.`,
  `Prêt professionnel : ${A.pret.capitalInitial} € débloqués le ${date(A.pret.deblocage)}, ${A.pret.duree} au taux nominal de ${A.pret.taux} (échéances 2025 : onglet « A – Prêt »).`,
  'Immobilisations : onglet « C – Immobilisations ».',
])
const COL_PIECES = [
  { titre: 'Pièce', largeur: 16 }, { titre: 'Date', type: 'date', largeur: 12 }, { titre: 'Émetteur', largeur: 38 },
  { titre: 'Objet', largeur: 60 }, { titre: 'HT', type: 'montant' }, { titre: 'TVA', type: 'montant' }, { titre: 'TTC', type: 'montant' },
  { titre: 'Remarque', largeur: 36 },
]
feuille('A – Pièces', COL_PIECES, A.pieces.map((p) => [p.id, enDate(p.date), p.tiers, p.objet, p.ht, p.tva, p.ttc, p.immobilisation ? 'Immobilisation (onglet C)' : '']),
  { titre: 'Dossier A — les pièces', notes: ['Les factures portent la TVA, que l’infirmière ne récupère pas. Les montants négatifs sont des avoirs.'] })
const COL_RELEVE = [
  { titre: 'Date', type: 'date', largeur: 12 }, { titre: 'Libellé', largeur: 38 }, { titre: 'Débit', type: 'montant' },
  { titre: 'Crédit', type: 'montant' }, { titre: 'Pièce', largeur: 16 }, { titre: 'Ce que c’est', largeur: 90 },
]
const lignesReleve = (ms) => ms.map((m) => [enDate(m.date), m.libelle, m.montant < 0 ? -m.montant : null, m.montant > 0 ? m.montant : null, m.modele.type === 'piece' ? m.modele.piece : '', m.nature])
feuille('A – Relevé 2025', COL_RELEVE, lignesReleve(A.releve), {
  titre: 'Dossier A — relevé bancaire 2025',
  notes: [`Solde au 01/01/2025 : ${montant(A.soldeInitial)} € ; solde au 31/12/2025 : ${montant(releveA.soldeFinal)} €.`],
})
feuille('A – Après clôture', COL_RELEVE, lignesReleve(A.apresCloture), { titre: 'Dossier A — janvier 2026, pour mémoire' })
feuille('A – Cotisations', [
  { titre: 'Organisme', largeur: 20 }, { titre: 'Date', type: 'date', largeur: 12 }, { titre: 'Montant', type: 'montant' },
  { titre: 'dont CSG-CRDS', type: 'montant' }, { titre: 'Objet', largeur: 90 },
], A.cotisations.map((c) => [c.organisme, enDate(c.echeance), c.montant, c.montant < 0 ? -c.csgCrds : c.csgCrds, c.objet]), {
  titre: 'Dossier A — cotisations sociales personnelles 2025',
  notes: ['Chaque échéance est prélevée à sa date ; la CSG-CRDS reprend l’avis d’appel. La régularisation de novembre est un remboursement (montant négatif).'],
})
feuille('A – Prêt', [
  { titre: 'N°', largeur: 6 }, { titre: 'Date', type: 'date', largeur: 12 }, { titre: 'Capital', type: 'montant' }, { titre: 'Intérêts', type: 'montant' },
  { titre: 'Assurance', type: 'montant' }, { titre: 'Échéance', type: 'montant' }, { titre: 'Capital restant dû', type: 'montant', largeur: 18 },
], pret2025.map((e) => [e.numero, enDate(e.date), e.capital, e.interets, e.assurance, e.total, e.restantDu]), {
  titre: 'Dossier A — prêt professionnel, échéances 2025',
  notes: [`Prêt de ${montant(A.pret.capitalInitial)} € débloqué le ${date(A.pret.deblocage)}, ${A.pret.duree} au taux nominal de ${A.pret.taux}, première échéance le ${date(A.pret.premiereEcheance)}.`],
})

situation('B – Situation', B.situation)
feuille('B – Pièces', COL_PIECES.slice(0, 7).concat([{ titre: 'Sens', largeur: 10 }]), B.pieces.map((p) => [p.id, enDate(p.date), p.tiers, p.objet, p.ht, p.tva, p.ttc, p.type === 'vente' ? 'Vente' : 'Achat']),
  { titre: 'Dossier B — les pièces', notes: ['Les montants négatifs sont des avoirs.'] })
feuille('B – Relevé mars 2026', COL_RELEVE, lignesReleve(B.releve), {
  titre: 'Dossier B — relevé bancaire de mars 2026',
  notes: [`Solde au 01/03/2026 : ${montant(soldeInitialB)} € ; solde au 31/03/2026 : ${montant(releveB.soldeFinal)} €.`],
})
feuille('B – Après la période', COL_RELEVE, lignesReleve(B.apresPeriode), { titre: 'Dossier B — avril 2026, pour mémoire' })

feuille('C – Immobilisations', [
  { titre: 'Bien', largeur: 44 }, { titre: 'Valeur TTC', type: 'montant' }, { titre: 'Acquisition', type: 'date', largeur: 12 },
  { titre: 'Mise en service', type: 'date', largeur: 15 }, { titre: 'Durée (ans)', largeur: 11 }, { titre: 'Origine', largeur: 28 },
], A.registre.map((b) => [b.libelle, b.valeur, enDate(b.dateAcquisition), enDate(b.dateMiseEnService), b.dureeAnnees, b.piece ? `Facture ${b.piece} (2025)` : 'Exercice antérieur']), {
  titre: 'Dossier C — registre des immobilisations de l’infirmière (dossier A)',
  notes: ['Amortissement linéaire à compter de la mise en service, sur la durée indiquée. Exonérée de TVA : valeur TTC.'],
})

situation('D – Situation', DD.situation)
feuille('D – Balance 2025', [
  { titre: 'Compte', largeur: 10 }, { titre: 'Intitulé', largeur: 60 }, { titre: 'Tiers', largeur: 50 },
  { titre: 'Solde débiteur', type: 'montant', largeur: 16 }, { titre: 'Solde créditeur', type: 'montant', largeur: 16 },
], DD.balance.map((l) => [l.compte, l.libelle, l.tiers ?? '', l.solde > 0 ? l.solde : null, l.solde < 0 ? -l.solde : null]), {
  titre: 'Dossier D — balance générale au 31/12/2025, après inventaire',
  notes: [`Totaux : ${montant(totalDebitD)} € au débit et au crédit.`],
})

const R = { aRemplir: true, type: 'montant', largeur: 16 }
const REMARQUE = { titre: 'Remarque', aRemplir: true, largeur: 60 }
feuille('Réponses A', [
  { titre: 'Case', largeur: 7 }, { titre: 'Formulaire', largeur: 10 }, { titre: 'Ligne', largeur: 10 }, { titre: 'Libellé', largeur: 70 },
  { ...R, titre: 'Votre montant' }, REMARQUE,
], F.cases2035.map((c) => [c.code, c.formulaire, c.ligne, c.libelle, null, null]).concat([['—', '2035-B', 'cadre 7', 'Total A des indemnités kilométriques', null, null]]),
  { titre: 'Réponses — dossier A, déclaration 2035 de 2025' })
feuille('Réponses B', [
  { titre: 'Ligne', largeur: 7 }, { titre: 'Code', largeur: 8 }, { titre: 'Libellé', largeur: 70 },
  { ...R, titre: 'Base HT' }, { ...R, titre: 'Montant' }, REMARQUE,
], F.lignesCa3.map((l) => [l.ligne, l.code, l.libelle, l.aUneBase ? null : SANS_OBJET, null, null]), { titre: 'Réponses — dossier B, CA3 de mars 2026' })
feuille('Réponses C', [
  { titre: 'Bien', largeur: 44 }, { titre: 'Élément', largeur: 40 }, { ...R, titre: 'Votre montant' }, REMARQUE,
], A.registre.flatMap((b) => [
  [b.libelle, 'Dotation 2025', null, null], [b.libelle, 'Dotation 2026', null, null],
  [b.libelle, 'Amortissements cumulés au 31/12/2025', null, null], [b.libelle, 'Valeur nette au 31/12/2025', null, null],
  [b.libelle, 'Dernière annuité : année et montant', null, null],
]).concat([['Tous les biens', 'Total des dotations 2025', null, null], ['Tous les biens', 'Convention de prorata temporis retenue', null, null]]),
  { titre: 'Réponses — dossier C, plan d’amortissement' })
const actifD = (libelle, c) => [libelle, `${c.brut} / ${c.amortissements}`, null, null, null, null]
const passifD = (libelle, c) => [libelle, c, null, SANS_OBJET, SANS_OBJET, null]
feuille('Réponses D', [
  { titre: 'Rubrique', largeur: 60 }, { titre: 'Cases', largeur: 12 }, { ...R, titre: 'Brut (actif) ou montant (passif)', largeur: 22 },
  { ...R, titre: 'Amortissements' }, { ...R, titre: 'Net' }, REMARQUE,
], [
  ...dansLaMasse(F.actif2033, 'immobilise').map((r) => actifD(`Actif — ${r.libelle}`, r.cases)),
  actifD('Total de l’actif immobilisé', T.actifImmobilise),
  ...dansLaMasse(F.actif2033, 'circulant').map((r) => actifD(`Actif — ${r.libelle}`, r.cases)),
  actifD('Total de l’actif circulant', T.actifCirculant),
  actifD('Total de l’actif', T.totalActif),
  ...dansLaMasse(F.passif2033, 'capitaux-propres').map((r) => passifD(`Passif — ${r.libelle}`, r.case)),
  passifD('Total des capitaux propres', T.capitauxPropres),
  ...dansLaMasse(F.passif2033, 'provisions').map((r) => passifD(`Passif — ${r.libelle}`, r.case)),
  ...dansLaMasse(F.passif2033, 'dettes').map((r) => passifD(`Passif — ${r.libelle}`, r.case)),
  passifD('Total des dettes', T.dettes),
  passifD('Total du passif', T.totalPassif),
], { titre: 'Réponses — dossier D, bilan 2033-A au 31/12/2025', notes: ['Les numéros de case sont ceux que l’application attribue d’après le 2033-A-SD ; notez en remarque un numéro différent sur votre formulaire.'] })

await classeur.xlsx.writeFile(`${sortie}/dossiers-de-reference.xlsx`)
console.log(`relevé A : ${A.releve.length} lignes, solde final ${releveA.soldeFinal} ; relevé B : ${B.releve.length} lignes, solde final ${releveB.soldeFinal}`)
