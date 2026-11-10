// Cas de référence des cotisations Urssaf d'un praticien ou auxiliaire médical conventionné, calculés
// par le moteur public de l'Urssaf — pour éprouver lib/voletSocialPamc.ts contre lui, pas contre
// nous-mêmes. À rejouer à chaque nouvelle version du moteur, et chaque fois qu'une année s'ajoute au
// barème de l'application :
//
//   npm i --no-save modele-ti@0.1.0 publicodes@1.10.3        # hors package.json : outil, pas dépendance
//   node outils/cotisations/oracle.mjs > src/lib/voletSocialPamcReference.ts
//   npx vitest run --project logique src/lib/voletSocialPamc  # nos chiffres contre les siens
//   node outils/cotisations/oracle.mjs retraite > src/lib/retraiteDesLiberauxReference.ts   # la caisse de retraite (fin du fichier)
//
// Pourquoi ce moteur. `modele-ti` est le jeu de règles des simulateurs de l'Urssaf pour les
// indépendants (mon-entreprise.urssaf.fr), publié par elle : il applique la nouvelle assiette des
// revenus 2025 (abattement de 26 %, borné) et la prise en charge des cotisations des praticiens
// conventionnés par l'Assurance maladie, chaque règle renvoyant à son texte. Son aîné `modele-social`
// calcule encore sur l'ancienne assiette (mesuré le 28/09/2026) : ne pas le prendre à sa place.
//
// Ce que les cas NE couvrent PAS, parce que l'application ne l'estime pas (relevé règle par règle le
// 07/11/2026, HISTORIQUE.md « LES COTISATIONS : CE QUE LE MOTEUR DE L'URSSAF PERMET D'ESTIMER EN PLUS ») :
// les revenus de remplacement, les exonérations (invalidité), l'outre-mer, et la retraite (appelée par
// la caisse, pas par l'Urssaf). Les médecins de secteur 1 et de secteur 2 y sont depuis le 07/11/2026 ;
// le même jour (TNS-Q1, TNS-Q4), l'activité créée dans l'année (« entreprise . date de création » : le
// plafond proratisé, pas de CURPS), l'ACRE de l'année de création et de la suivante (« exonérations .
// Acre », sa proratisation) et le chirurgien-dentiste (« assiette participation CPAM . taux dentiste »),
// HISTORIQUE.md « LES PARAMÈTRES DES COTISATIONS : LE DÉBUT D'ACTIVITÉ, L'ACRE ET LE TAUX DENTISTE ».
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
const METIERS = {
  auxiliaire_medical: { metier: 'auxiliaire médical' },
  sage_femme: { metier: 'sage-femme' },
  medecin_secteur_1: { metier: 'médecin', secteur: 'S1' },
  medecin_secteur_2: { metier: 'médecin', secteur: 'S2' },
  chirurgien_dentiste: { metier: 'chirurgien-dentiste' },
}
// Une activité ouverte avant l'année, comme les cas d'avant le 07/11/2026 : ni plafond proratisé, ni ACRE
// possible, la CURPS due.
const OUVERTE_AVANT = '2015-01-01'
// La date du moteur (JJ/MM/AAAA) d'une date civile de l'application (AAAA-MM-JJ).
const dateDuMoteur = (iso) => iso.split('-').reverse().join('/')
// Les charges ne comptent que pour faire du chiffre d'affaires un revenu brut : le moteur prend
// « chiffre d'affaires − charges », l'application le revenu brut social de la 2035.
const CHARGES = 20_000

// La situation d'un cas, posée au moteur : la même pour le volet Urssaf et pour la retraite. `enRetraite` (un médecin
// qui cumule sa retraite et son activité, « CARMF . en retraite ») n'est posé que par les cas de la retraite.
function poser({
  annee, profession, remplacant, revenuBrutSocial, partConventionnee, partDepassements,
  debutActivite = OUVERTE_AVANT, acre = null, tauxDentiste = null, enRetraite = null,
}) {
  const recettesBrutes = revenuBrutSocial + CHARGES
  const honorairesConventionnes = Math.round(recettesBrutes * partConventionnee)
  const depassements = Math.round(honorairesConventionnes * partDepassements)
  moteur.setSituation({
    date: `01/01/${annee}`,
    ...(enRetraite === null ? {} : { 'indépendant . profession libérale . réglementée . CARMF . en retraite': enRetraite ? 'oui' : 'non' }),
    // Le début d'activité du dossier : l'année de la création, le plafond se proratise et la CURPS n'est pas due.
    'entreprise . date de création': dateDuMoteur(debutActivite),
    // L'ACRE de l'exercice : posée seulement quand le cas la dit (le moteur la croit absente sans elle).
    ...(acre === null ? {} : { 'indépendant . cotisations et contributions . cotisations . exonérations . Acre': acre ? 'oui' : 'non' }),
    // Le « taux dentiste » du relevé SNIR, d'un chirurgien-dentiste seul.
    ...(tauxDentiste === null ? {} : { [P + 'assiette participation CPAM . taux dentiste']: String(tauxDentiste) }),
    'entreprise . activité': "'libérale'",
    'entreprise . activité . libérale . réglementée': 'oui',
    'indépendant . profession libérale . réglementée . métier': `'santé . ${METIERS[profession].metier}'`,
    ...(METIERS[profession].secteur
      ? { 'indépendant . profession libérale . réglementée . métier . santé . médecin . secteur': `'${METIERS[profession].secteur}'` }
      : {}),
    'entreprise . imposition': "'IR'",
    'entreprise . imposition . IR . régime micro-fiscal': 'non',
    "entreprise . chiffre d'affaires": `${recettesBrutes} €/an`,
    'entreprise . charges': `${CHARGES} €/an`,
    [P + 'recettes activité conventionnée']: `${honorairesConventionnes} €/an`,
    [P + "dépassements d'honoraire"]: `${depassements} €/an`,
    [P + 'remplaçant']: remplacant ? 'oui' : 'non',
  })
  return { recettesBrutes, honorairesConventionnes, depassements }
}

const valeur = (nom) => {
  const v = moteur.evaluate(nom).nodeValue
  // Non applicable (la CURPS d'un remplaçant) : rien n'est dû.
  if (v === null || v === undefined || v === false) return 0
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${nom} : valeur inattendue ${v}`)
  return v
}

function evaluer(c) {
  const { annee, profession, remplacant, revenuBrutSocial, debutActivite = OUVERTE_AVANT, acre = null, tauxDentiste = null } = c
  const { recettesBrutes, honorairesConventionnes, depassements } = poser(c)
  const attendu = {
    plafond: valeur('plafond sécurité sociale . annuel'),
    // Le plafond aux jours d'activité de l'année : lui seul, l'année de la création, sous le plafond annuel.
    plafondProratise: valeur('indépendant . PASS proratisé'),
    // L'ACRE joue-t-elle sur l'année ? Dite, elle ne joue qu'à moins d'un an d'activité au 1er janvier.
    acreAppliquee: moteur.evaluate(C + 'cotisations . exonérations . Acre').nodeValue === true,
    abattement: valeur(C + 'assiette CSG-CRDS . abattement'),
    assiette: valeur(C + 'assiette sociale'),
    csgCrdsDeductible: valeur(C + 'CSG-CRDS . déductible'),
    csgCrdsNonDeductible: valeur(C + 'CSG-CRDS . non déductible'),
    maladie: valeur(C + 'cotisations . maladie-maternité . après exonérations'),
    priseEnChargeMaladie: valeur(P + 'participation CPAM . maladie'),
    priseEnChargeAllocationsFamiliales: valeur(P + 'participation CPAM . allocations familiales'),
    contributionAdditionnelle: valeur(P + 'contribution maladie additionnelle'),
    indemnitesJournalieres: valeur(C + 'cotisations . indemnités journalières'),
    // Avant la prise en charge, comme la maladie : la règle « cotisations . allocations familiales »
    // la retranche déjà pour un médecin de secteur 1, et le total la retire une fois.
    allocationsFamiliales: valeur(C + 'cotisations . allocations familiales . après exonérations'),
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
      parametres: { tenus: true, debutActivite, acre, tauxDentiste },
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
  // Les médecins : la prise en charge des allocations familiales du secteur 1 a ses propres tranches
  // (140 % et 250 % du plafond), que la grille des revenus franchit ; le secteur 2 n'a aucune prise en
  // charge, et ses dépassements sont plus lourds.
  for (const revenuBrutSocial of REVENUS) {
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1 tout conventionné`, annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial, partConventionnee: 1, partDepassements: 0 })
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1, 80 % conventionné dont 5 % de dépassements`, annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial, partConventionnee: 0.8, partDepassements: 0.05 })
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 2, 90 % conventionné dont 30 % de dépassements`, annee, profession: 'medecin_secteur_2', remplacant: false, revenuBrutSocial, partConventionnee: 0.9, partDepassements: 0.3 })
  }
  // Les bornes de 140 % et 250 % du plafond, de part et d'autre : l'assiette de la prise en charge y
  // tombe juste dessous, puis pile dessus — la borne atteinte passe à la tranche suivante.
  const BORNES = { 2025: [89_107, 89_108, 159_120, 159_122], 2026: [90_923, 90_924, 162_364, 162_365] }
  for (const revenuBrutSocial of BORNES[annee]) {
    cas.push({ nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1 à une borne de la prise en charge`, annee, profession: 'medecin_secteur_1', remplacant: false, revenuBrutSocial, partConventionnee: 1, partDepassements: 0 })
  }
  cas.push({ nom: `${annee}, 60000 €, médecin secteur 1 remplaçant`, annee, profession: 'medecin_secteur_1', remplacant: true, revenuBrutSocial: 60_000, partConventionnee: 1, partDepassements: 0 })
  cas.push({ nom: `${annee}, 130000 €, médecin secteur 2 tout conventionné`, annee, profession: 'medecin_secteur_2', remplacant: false, revenuBrutSocial: 130_000, partConventionnee: 1, partDepassements: 0 })

  // L'ANNÉE DE LA CRÉATION (TNS-Q1) : le plafond proratisé aux jours d'activité (le taux de maladie, ses trois
  // plafonds, les allocations familiales), la CURPS absente — sauf une création au 1er janvier, qui fait l'année entière.
  const base = { annee, remplacant: false, partConventionnee: 1, partDepassements: 0 }
  for (const debut of [`${annee}-01-01`, `${annee}-03-15`, `${annee}-07-01`, `${annee}-12-31`]) {
    for (const revenuBrutSocial of [8_000, 30_000, 60_000, 150_000]) {
      cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, auxiliaire médical créé le ${debut}`, profession: 'auxiliaire_medical', revenuBrutSocial, debutActivite: debut, acre: false })
    }
  }
  for (const revenuBrutSocial of [60_000, 150_000]) {
    cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1 créé le ${annee}-03-15`, profession: 'medecin_secteur_1', revenuBrutSocial, debutActivite: `${annee}-03-15`, acre: false })
  }
  // L'ACRE (TNS-Q4) : l'année de la création, puis la suivante au prorata des jours qui restent ; le quart des
  // cotisations au plus depuis les créations de 2026, toutes avant ; sous 75 % du plafond proratisé, entre 75 et
  // 100 % (dégressive), au-dessus (nulle).
  const ACRE_REVENUS = [8_000, 15_000, 20_000, 25_000, 30_000, 35_000, 45_000, 60_000]
  for (const revenuBrutSocial of ACRE_REVENUS) {
    cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, ACRE, créé le ${annee}-07-01`, profession: 'auxiliaire_medical', revenuBrutSocial, debutActivite: `${annee}-07-01`, acre: true })
    cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, ACRE, créé le ${annee - 1}-07-01`, profession: 'auxiliaire_medical', revenuBrutSocial, debutActivite: `${annee - 1}-07-01`, acre: true })
  }
  // Un an pile avant l'exercice : l'ACRE ne joue plus, même dite.
  cas.push({ ...base, nom: `${annee}, 30000 €, ACRE dite, créé un an avant`, profession: 'auxiliaire_medical', revenuBrutSocial: 30_000, debutActivite: `${annee - 1}-01-01`, acre: true })
  cas.push({ ...base, nom: `${annee}, 30000 €, ACRE dite, créé un an et un jour avant`, profession: 'auxiliaire_medical', revenuBrutSocial: 30_000, debutActivite: `${annee - 1}-01-02`, acre: true })
  for (const revenuBrutSocial of [30_000, 60_000]) {
    cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1, ACRE, créé le ${annee}-03-15`, profession: 'medecin_secteur_1', revenuBrutSocial, debutActivite: `${annee}-03-15`, acre: true })
  }
  // LE CHIRURGIEN-DENTISTE (TNS-Q1) : la prise en charge sur la part conventionnée divisée par 1 + le taux dentiste,
  // ses dépassements ignorés ; la CURPS à 0,3 %.
  for (const tauxDentiste of [0, 0.35, 1]) {
    for (const revenuBrutSocial of [0, 30_000, 80_000, 200_000]) {
      cas.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, chirurgien-dentiste au taux ${tauxDentiste}`, profession: 'chirurgien_dentiste', revenuBrutSocial, tauxDentiste })
    }
  }
  cas.push({ ...base, nom: `${annee}, 80000 €, chirurgien-dentiste, 80 % conventionné dont 20 % de dépassements`, profession: 'chirurgien_dentiste', revenuBrutSocial: 80_000, partConventionnee: 0.8, partDepassements: 0.2, tauxDentiste: 0.47 })
  cas.push({ ...base, nom: `${annee}, 80000 €, chirurgien-dentiste remplaçant`, profession: 'chirurgien_dentiste', remplacant: true, revenuBrutSocial: 80_000, tauxDentiste: 0.6 })
  cas.push({ ...base, nom: `${annee}, 80000 €, chirurgien-dentiste créé le ${annee}-07-01, ACRE`, profession: 'chirurgien_dentiste', revenuBrutSocial: 80_000, debutActivite: `${annee}-07-01`, acre: true, tauxDentiste: 0.25 })
}

// `oracle.mjs retraite` écrit les cas de la retraite (plus bas), sans évaluer ceux-ci.
const lignes = process.argv[2] === 'retraite' ? [] : cas.map(({ nom, ...c }) => `  ${JSON.stringify({ cas: nom, ...evaluer(c) })},`)
if (process.argv[2] !== 'retraite') process.stdout.write(`// GÉNÉRÉ par outils/cotisations/oracle.mjs — ne pas modifier à la main, le régénérer.
// Moteur : modele-ti ${version('modele-ti')}, publicodes ${version('publicodes')} (le moteur des simulateurs de l'Urssaf).
// Chaque cas porte ce que l'application donne au calcul (entree) et ce que le moteur de l'Urssaf
// répond (attendu), à l'euro — voir voletSocialPamc.test.ts.

export interface CasReference {
  cas: string
  entree: {
    annee: number
    profession: 'auxiliaire_medical' | 'sage_femme' | 'medecin_secteur_1' | 'medecin_secteur_2' | 'chirurgien_dentiste'
    remplacant: boolean
    revenuBrutSocial: number
    revenuProfessionnelPositif: boolean
    recettesBrutes: number
    honorairesConventionnes: number
    depassements: number
    parametres: { tenus: true; debutActivite: string; acre: boolean | null; tauxDentiste: number | null }
  }
  attendu: {
    plafond: number
    plafondProratise: number
    acreAppliquee: boolean
    abattement: number
    assiette: number
    csgCrdsDeductible: number
    csgCrdsNonDeductible: number
    maladie: number
    priseEnChargeMaladie: number
    priseEnChargeAllocationsFamiliales: number
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

// ── LA RETRAITE (ligne 27.1, 10/11/2026) ─────────────────────────────────────────────────────────────────────────
//
//   node outils/cotisations/oracle.mjs retraite > src/lib/retraiteDesLiberauxReference.ts
//   npx vitest run --project logique src/lib/retraiteDesLiberaux
//
// Ce que la caisse de retraite appelle sur les revenus de l'exercice, comme le moteur le calcule (« profession libérale .
// cotisations caisse de retraite ») : le régime de base de la CNAVPL, le complémentaire, l'invalidité-décès et les
// prestations complémentaires de vieillesse (PCV, l'ancien ASV), prise en charge par l'Assurance maladie déduite. Le
// moteur calcule tout sur l'assiette sociale de l'année : ce sont les cotisations DÉFINITIVES de l'exercice, pas
// l'échéancier que la caisse appelle pendant l'année (provisionnelles sur un revenu antérieur, puis régularisation),
// HISTORIQUE.md « LA RETRAITE DES PROFESSIONS LIBÉRALES : LA CONCEPTION ».
const R = 'indépendant . profession libérale . réglementée . '
const PCV_PRISE_EN_CHARGE = {
  auxiliaire_medical: R + 'CARPIMKO . PCV . participation CPAM',
  sage_femme: R + 'CARCDSF . sage-femme . PCV . participation CPAM',
  medecin_secteur_1: R + 'CARMF . PCV . participation CPAM',
  medecin_secteur_2: R + 'CARMF . PCV . participation CPAM',
  chirurgien_dentiste: R + 'CARCDSF . chirurgien-dentiste . PCV . participation CPAM',
}

function evaluerRetraite(c) {
  const { annee, profession, revenuBrutSocial, debutActivite = OUVERTE_AVANT, acre = null, tauxDentiste = null, enRetraite = null } = c
  const { recettesBrutes, honorairesConventionnes, depassements } = poser(c)
  // Une PCV que le moteur dit non applicable (l'exonération des faibles revenus de la CARCDSF) n'a pas de prise en charge.
  const pcvApplicable = moteur.evaluate(C + 'cotisations . PCV').nodeValue !== null
  const attendu = {
    plafond: valeur('plafond sécurité sociale . annuel'),
    plafondProratise: valeur('indépendant . PASS proratisé'),
    acreAppliquee: moteur.evaluate(C + 'cotisations . exonérations . Acre').nodeValue === true,
    assiette: valeur(C + 'assiette sociale'),
    retraiteDeBase: valeur(C + 'cotisations . retraite de base'),
    priseEnChargeRetraiteDeBase: valeur(R + 'CARMF . participation CPAM retraite'),
    retraiteComplementaire: valeur(C + 'cotisations . retraite complémentaire'),
    invaliditeDeces: valeur(C + 'cotisations . invalidité et décès'),
    pcv: valeur(C + 'cotisations . PCV'),
    priseEnChargePcv: pcvApplicable ? valeur(PCV_PRISE_EN_CHARGE[profession]) : 0,
    total: valeur('indépendant . profession libérale . cotisations caisse de retraite'),
  }
  // Le total du moteur est la somme de ses quatre parts, arrondie : s'il s'en écarte, une règle a changé.
  const somme = attendu.retraiteDeBase + attendu.retraiteComplementaire + attendu.invaliditeDeces + attendu.pcv
  if (Math.round(somme) !== attendu.total) throw new Error(`total divergent : ${somme} contre ${attendu.total}`)
  return {
    entree: {
      annee, profession, revenuBrutSocial, recettesBrutes, honorairesConventionnes, depassements,
      parametres: { tenus: true, debutActivite, acre, tauxDentiste }, enRetraite: enRetraite === true,
    },
    attendu,
  }
}

function casDeLaRetraite() {
  const liste = []
  // Les revenus franchissent le plancher de la base (450 heures au SMIC), le plancher et le plafond du complémentaire
  // de la CARPIMKO (0,5 et 3 plafonds), les classes de l'invalidité-décès de la CARMF (1 et 3 plafonds), son
  // complémentaire (3,5 plafonds), le seuil de la CARCDSF (0,85 plafond) et les cinq plafonds de la tranche 2.
  const REVENUS_R = [-5_000, 0, 2_000, 8_000, 15_000, 25_000, 33_000, 45_000, 60_000, 72_000, 100_000, 150_000, 200_000, 260_000, 400_000]
  const DENTISTE = { tauxDentiste: 0.35 }
  for (const annee of [2025, 2026]) {
    const base = { annee, remplacant: false, partConventionnee: 1, partDepassements: 0 }
    for (const revenuBrutSocial of REVENUS_R) {
      const r = `${annee}, ${revenuBrutSocial} €`
      liste.push({ ...base, nom: `${r}, auxiliaire médical tout conventionné`, profession: 'auxiliaire_medical', revenuBrutSocial })
      liste.push({ ...base, nom: `${r}, auxiliaire médical, 80 % conventionné dont 5 % de dépassements`, profession: 'auxiliaire_medical', revenuBrutSocial, partConventionnee: 0.8, partDepassements: 0.05 })
      liste.push({ ...base, nom: `${r}, sage-femme`, profession: 'sage_femme', revenuBrutSocial })
      liste.push({ ...base, nom: `${r}, médecin secteur 1`, profession: 'medecin_secteur_1', revenuBrutSocial })
      liste.push({ ...base, nom: `${r}, médecin secteur 1, 80 % conventionné dont 5 % de dépassements`, profession: 'medecin_secteur_1', revenuBrutSocial, partConventionnee: 0.8, partDepassements: 0.05 })
      liste.push({ ...base, nom: `${r}, médecin secteur 2, 90 % conventionné dont 30 % de dépassements`, profession: 'medecin_secteur_2', revenuBrutSocial, partConventionnee: 0.9, partDepassements: 0.3 })
      liste.push({ ...base, nom: `${r}, chirurgien-dentiste au taux 0,35`, profession: 'chirurgien_dentiste', revenuBrutSocial, ...DENTISTE })
    }
    // L'année de la création : le plafond proratisé des deux tranches de la base, le prorata de la CARCDSF, et sous
    // quatre-vingt-dix jours d'activité, plus de plancher à la base.
    for (const debut of [`${annee}-03-15`, `${annee}-07-01`, `${annee}-10-15`]) {
      for (const revenuBrutSocial of [3_000, 30_000, 150_000]) {
        for (const profession of ['auxiliaire_medical', 'sage_femme', 'medecin_secteur_1', 'chirurgien_dentiste']) {
          liste.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, ${profession} créé le ${debut}`, profession, revenuBrutSocial, debutActivite: debut, acre: false, ...(profession === 'chirurgien_dentiste' ? DENTISTE : {}) })
        }
      }
    }
    // Les deux premières années d'affiliation à la CARMF : pas de complémentaire, à la borne près.
    for (const debut of [`${annee - 1}-07-01`, `${annee - 2}-01-01`, `${annee - 2}-01-02`, `${annee - 2}-12-31`, `${annee - 3}-06-30`]) {
      liste.push({ ...base, nom: `${annee}, 80000 €, médecin secteur 1 installé le ${debut}`, profession: 'medecin_secteur_1', revenuBrutSocial: 80_000, debutActivite: debut, acre: false })
    }
    // L'ACRE exonère aussi la base et l'invalidité-décès.
    for (const revenuBrutSocial of [15_000, 30_000, 45_000, 60_000]) {
      for (const debut of [`${annee}-07-01`, `${annee - 1}-07-01`]) {
        for (const profession of ['auxiliaire_medical', 'medecin_secteur_1', 'chirurgien_dentiste']) {
          liste.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, ${profession}, ACRE, créé le ${debut}`, profession, revenuBrutSocial, debutActivite: debut, acre: true, ...(profession === 'chirurgien_dentiste' ? DENTISTE : {}) })
        }
      }
    }
    // Le médecin qui cumule retraite et activité : plus d'invalidité-décès.
    for (const revenuBrutSocial of [30_000, 100_000]) {
      liste.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1 en cumul emploi-retraite`, profession: 'medecin_secteur_1', revenuBrutSocial, enRetraite: true })
    }
    // Les bornes, de part et d'autre : l'assiette juste sous 1, 1,4, 2,5 et 3 plafonds, puis pile dessus — les classes
    // de l'invalidité-décès de la CARMF et les tranches de la prise en charge de sa base, une borne atteinte passant à
    // la suivante.
    const BORNES_R = {
      2025: [63_647, 63_649, 89_107, 89_108, 159_120, 159_122, 190_945, 190_946],
      2026: [64_945, 64_946, 90_923, 90_924, 162_364, 162_365, 194_837, 194_838],
    }
    for (const revenuBrutSocial of BORNES_R[annee]) {
      liste.push({ ...base, nom: `${annee}, ${revenuBrutSocial} €, médecin secteur 1 à une borne`, profession: 'medecin_secteur_1', revenuBrutSocial })
    }
  }
  return liste
}

function ecrireLaRetraite() {
  const lignesR = casDeLaRetraite().map(({ nom, ...c }) => `  ${JSON.stringify({ cas: nom, ...evaluerRetraite(c) })},`)
  process.stdout.write(`// GÉNÉRÉ par outils/cotisations/oracle.mjs retraite — ne pas modifier à la main, le régénérer.
// Moteur : modele-ti ${version('modele-ti')}, publicodes ${version('publicodes')} (le moteur des simulateurs de l'Urssaf).
// Chaque cas porte ce que l'application donne au calcul (entree) et ce que le moteur répond (attendu), en euros,
// au centime quand le moteur arrondit au centime (la CARCDSF) — voir retraiteDesLiberaux.test.ts.

import type { ProfessionPamc } from './types'

export interface CasReferenceRetraite {
  cas: string
  entree: {
    annee: number
    profession: ProfessionPamc
    revenuBrutSocial: number
    recettesBrutes: number
    honorairesConventionnes: number
    depassements: number
    parametres: { tenus: true; debutActivite: string; acre: boolean | null; tauxDentiste: number | null }
    enRetraite: boolean
  }
  attendu: {
    plafond: number
    plafondProratise: number
    acreAppliquee: boolean
    assiette: number
    retraiteDeBase: number
    priseEnChargeRetraiteDeBase: number
    retraiteComplementaire: number
    invaliditeDeces: number
    pcv: number
    priseEnChargePcv: number
    total: number
  }
}

export const MOTEUR_REFERENCE_RETRAITE = 'modele-ti ${version('modele-ti')}'

export const CAS_REFERENCE_RETRAITE: readonly CasReferenceRetraite[] = [
${lignesR.join('\n')}
]
`)
}

if (process.argv[2] === 'retraite') ecrireLaRetraite()
