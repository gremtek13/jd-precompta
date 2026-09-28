// Cas de référence des cotisations Urssaf d'un praticien ou auxiliaire médical conventionné, calculés
// par le moteur public de l'Urssaf — pour éprouver lib/voletSocialPamc.ts contre lui, pas contre
// nous-mêmes. À rejouer à chaque nouvelle version du moteur, et chaque fois qu'une année s'ajoute au
// barème de l'application :
//
//   npm i --no-save modele-ti@0.1.0 publicodes@1.10.3        # hors package.json : outil, pas dépendance
//   node outils/cotisations/oracle.mjs > src/lib/voletSocialPamcReference.ts
//   npx vitest run --project logique src/lib/voletSocialPamc  # nos chiffres contre les siens
//
// Pourquoi ce moteur. `modele-ti` est le jeu de règles des simulateurs de l'Urssaf pour les
// indépendants (mon-entreprise.urssaf.fr), publié par elle : il applique la nouvelle assiette des
// revenus 2025 (abattement de 26 %, borné) et la prise en charge des cotisations des praticiens
// conventionnés par l'Assurance maladie, chaque règle renvoyant à son texte. Son aîné `modele-social`
// calcule encore sur l'ancienne assiette (mesuré le 28/09/2026) : ne pas le prendre à sa place.
//
// Ce que les cas NE couvrent PAS, parce que l'application ne l'estime pas : les médecins et les
// chirurgiens-dentistes (prise en charge et CURPS différentes), les revenus de remplacement, l'ACRE,
// l'outre-mer et la retraite (appelée par la CARPIMKO, pas par l'Urssaf).
import Engine from 'publicodes'
import regles from 'modele-ti'
import { readFileSync } from 'node:fs'

// `publicodes` n'exporte pas son package.json : on le lit là où `npm i` l'a posé.
const version = (paquet) =>
  JSON.parse(readFileSync(new URL(`../../node_modules/${paquet}/package.json`, import.meta.url), 'utf8')).version

const moteur = new Engine(regles, {
  logger: {
    log() {},
    warn() {},
    error(message) {
      throw new Error(`modele-ti : ${message}`)
    },
  },
})

const P = 'indépendant . profession libérale . réglementée . PAMC . '
const C = 'indépendant . cotisations et contributions . '
const METIERS = { auxiliaire_medical: 'auxiliaire médical', sage_femme: 'sage-femme' }
// Les charges ne comptent que pour faire du chiffre d'affaires un revenu brut : le moteur prend
// « chiffre d'affaires − charges », l'application le revenu brut social de la 2035.
const CHARGES = 20_000

function evaluer({ annee, profession, remplacant, revenuBrutSocial, partConventionnee, partDepassements }) {
  const recettesBrutes = revenuBrutSocial + CHARGES
  const honorairesConventionnes = Math.round(recettesBrutes * partConventionnee)
  const depassements = Math.round(honorairesConventionnes * partDepassements)
  moteur.setSituation({
    date: `01/01/${annee}`,
    // Une activité ouverte avant l'année : la CURPS n'est pas due l'année de la création.
    'entreprise . date de création': '01/01/2015',
    'entreprise . activité': "'libérale'",
    'entreprise . activité . libérale . réglementée': 'oui',
    'indépendant . profession libérale . réglementée . métier': `'santé . ${METIERS[profession]}'`,
    'entreprise . imposition': "'IR'",
    'entreprise . imposition . IR . régime micro-fiscal': 'non',
    "entreprise . chiffre d'affaires": `${recettesBrutes} €/an`,
    'entreprise . charges': `${CHARGES} €/an`,
    [P + 'recettes activité conventionnée']: `${honorairesConventionnes} €/an`,
    [P + "dépassements d'honoraire"]: `${depassements} €/an`,
    [P + 'remplaçant']: remplacant ? 'oui' : 'non',
  })
  const valeur = (nom) => {
    const v = moteur.evaluate(nom).nodeValue
    // Non applicable (la CURPS d'un remplaçant) : rien n'est dû.
    if (v === null || v === undefined || v === false) return 0
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${nom} : valeur inattendue ${v}`)
    return v
  }
  const attendu = {
    plafond: valeur('plafond sécurité sociale . annuel'),
    abattement: valeur(C + 'assiette CSG-CRDS . abattement'),
    assiette: valeur(C + 'assiette sociale'),
    csgCrdsDeductible: valeur(C + 'CSG-CRDS . déductible'),
    csgCrdsNonDeductible: valeur(C + 'CSG-CRDS . non déductible'),
    maladie: valeur(C + 'cotisations . maladie-maternité . après exonérations'),
    priseEnChargeMaladie: valeur(P + 'participation CPAM . maladie'),
    contributionAdditionnelle: valeur(P + 'contribution maladie additionnelle'),
    indemnitesJournalieres: valeur(C + 'cotisations . indemnités journalières'),
    allocationsFamiliales: valeur(C + 'cotisations . allocations familiales'),
    curps: valeur(P + 'CURPS'),
    formationProfessionnelle: valeur(C + 'formation professionnelle'),
    total: valeur(C + 'Urssaf'),
  }
  // Les deux assiettes ne se séparent qu'avec des revenus de remplacement, que ces cas n'ont pas : si
  // elles divergent ici, le moteur a changé de règle et il faut relire ce script.
  if (valeur(C + 'assiette CSG-CRDS') !== attendu.assiette) throw new Error('assiettes divergentes')
  return {
    entree: {
      annee,
      profession,
      remplacant,
      revenuBrutSocial,
      revenuProfessionnelPositif: valeur('indépendant . revenu professionnel') > 0,
      recettesBrutes,
      honorairesConventionnes,
      depassements,
    },
    attendu,
  }
}

// La grille : chaque tranche du taux de maladie (20, 40, 60, 110, 200 et 300 % du plafond), le
// plancher et le plafond de l'abattement, la zone progressive des allocations familiales (110 à
// 140 %), le plafond des indemnités journalières (3 plafonds) et celui de la CURPS — les deux années.
const REVENUS = [-5_000, 0, 2_000, 8_000, 15_000, 25_000, 30_000, 45_000, 60_000, 72_000, 80_000, 100_000, 150_000, 200_000, 300_000]
const cas = []
for (const annee of [2025, 2026]) {
  for (const revenuBrutSocial of REVENUS) {
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, tout conventionné`, annee, profession: 'auxiliaire_medical', remplacant: false, revenuBrutSocial, partConventionnee: 1, partDepassements: 0 })
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, 80 % conventionné dont 5 % de dépassements`, annee, profession: 'auxiliaire_medical', remplacant: false, revenuBrutSocial, partConventionnee: 0.8, partDepassements: 0.05 })
  }
  cas.push({ nom: `${annee}, 60000 €, rien de conventionné`, annee, profession: 'auxiliaire_medical', remplacant: false, revenuBrutSocial: 60_000, partConventionnee: 0, partDepassements: 0 })
  cas.push({ nom: `${annee}, 60000 €, remplaçant`, annee, profession: 'auxiliaire_medical', remplacant: true, revenuBrutSocial: 60_000, partConventionnee: 1, partDepassements: 0 })
  cas.push({ nom: `${annee}, 60000 €, sage-femme`, annee, profession: 'sage_femme', remplacant: false, revenuBrutSocial: 60_000, partConventionnee: 1, partDepassements: 0 })
  cas.push({ nom: `${annee}, 300000 €, sage-femme à moitié conventionnée`, annee, profession: 'sage_femme', remplacant: false, revenuBrutSocial: 300_000, partConventionnee: 0.5, partDepassements: 0 })
}

const lignes = cas.map(({ nom, ...c }) => `  ${JSON.stringify({ cas: nom, ...evaluer(c) })},`)
process.stdout.write(`// GÉNÉRÉ par outils/cotisations/oracle.mjs — ne pas modifier à la main, le régénérer.
// Moteur : modele-ti ${version('modele-ti')}, publicodes ${version('publicodes')} (le moteur des simulateurs de l'Urssaf).
// Chaque cas porte ce que l'application donne au calcul (entree) et ce que le moteur de l'Urssaf
// répond (attendu), à l'euro — voir voletSocialPamc.test.ts.

export interface CasReference {
  cas: string
  entree: {
    annee: number
    profession: 'auxiliaire_medical' | 'sage_femme'
    remplacant: boolean
    revenuBrutSocial: number
    revenuProfessionnelPositif: boolean
    recettesBrutes: number
    honorairesConventionnes: number
    depassements: number
  }
  attendu: {
    plafond: number
    abattement: number
    assiette: number
    csgCrdsDeductible: number
    csgCrdsNonDeductible: number
    maladie: number
    priseEnChargeMaladie: number
    contributionAdditionnelle: number
    indemnitesJournalieres: number
    allocationsFamiliales: number
    curps: number
    formationProfessionnelle: number
    total: number
  }
}

export const MOTEUR_REFERENCE = 'modele-ti ${version('modele-ti')}'

export const CAS_REFERENCE: readonly CasReference[] = [
${lignes.join('\n')}
]
`)
