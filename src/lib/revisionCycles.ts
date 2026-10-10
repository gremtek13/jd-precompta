import type { ModeComptable } from './types'

// LES CYCLES DE LA RÉVISION (ligne 41, étape R2 ; conception du 09/10/2026, HISTORIQUE.md, « LA RÉVISION DES COMPTES :
// LA CONCEPTION », § 2.1, 2.2 et 4.2). Un module PUR : il range ; il ne lit rien et ne décide rien.
//
// On révise par COMPTE pour les soldes de bilan et par CYCLE pour le travail et la revue (§ 3.2). Ce module dit à quel
// cycle appartient un compte, quels cycles un dossier a, et dans quel cycle se rangent les contrôles que l'application
// fait déjà — la Checklist et les préalables de la validation : l'écran de la révision (étape R3) ne les refait pas, il
// les montre dans le cycle qu'ils concernent (§ 4.2).
//
// LE RANGEMENT EST TOTAL SUR LES CLASSES 1 À 7, PAR PRÉFIXE : tout compte a un cycle, et un sous-compte que le cabinet
// ouvrirait tombe dans le cycle de son compte (ligne 43, le plan comptable personnalisable). Un compte hors de ces classes
// n'en a pas : la validation le refuse déjà (`report-hors-classes`). `revisionCycles.test.ts` éprouve la totalité sur
// tout compte de un à six chiffres, sur ceux que lib/comptes.ts nomme et sur ceux des catégories et des natures relevés
// en base.

// LES ONZE CYCLES, dans l'ordre de l'écran. Leurs codes sont ceux de la conception (§ 3.3), que l'étape R4 écrira dans
// la contrainte de `revision_conclusions.cycle` : les changer ici seulement ferait refuser une conclusion par la base.
export const CYCLES_DE_REVISION = [
  'tresorerie', 'recettes', 'depenses', 'immobilisations', 'emprunts', 'social', 'tva', 'capitaux', 'tiers', 'stocks',
  'ensemble',
] as const
export type CycleRevision = (typeof CYCLES_DE_REVISION)[number]

export interface DescriptionDuCycle {
  libelle: string
  // Pour quels dossiers le cycle existe, en une phrase (§ 2.1, colonne « Dossiers »).
  dossiers: string
  // Pourquoi la révision n'y couvre pas encore tout, quand c'est le cas (§ 2.1 et § 5.4) : le cycle s'affiche, ses
  // soldes se décident en citant des pièces, mais l'application n'en tient pas le détail.
  nonCouvert: string | null
}

export const DESCRIPTION_DES_CYCLES: Readonly<Record<CycleRevision, DescriptionDuCycle>> = {
  tresorerie: { libelle: 'Trésorerie', dossiers: 'Tous les dossiers.', nonCouvert: null },
  recettes: { libelle: 'Recettes', dossiers: 'Tous les dossiers.', nonCouvert: null },
  depenses: { libelle: 'Dépenses', dossiers: 'Tous les dossiers.', nonCouvert: null },
  immobilisations: {
    libelle: 'Immobilisations et amortissements',
    dossiers: 'Un dossier dont le registre des immobilisations n’est pas vide, ou qui porte un compte de ce cycle.',
    nonCouvert: null,
  },
  emprunts: { libelle: 'Emprunts', dossiers: 'Un dossier qui a un emprunt, ou qui porte un compte de ce cycle.', nonCouvert: null },
  social: { libelle: 'Social', dossiers: 'Tous les dossiers.', nonCouvert: null },
  tva: { libelle: 'TVA', dossiers: 'Un dossier redevable, ou qui porte un compte de ce cycle.', nonCouvert: null },
  capitaux: { libelle: 'Exploitant et capitaux', dossiers: 'Tous les dossiers.', nonCouvert: null },
  tiers: {
    libelle: 'Tiers',
    dossiers: 'Un dossier tenu en engagement, ou qui porte un compte de ce cycle.',
    nonCouvert: 'La justification par compte auxiliaire et le dénouement des comptes de tiers ne sont pas encore tenus : '
      + 'un solde de ce cycle se justifie en citant ses pièces.',
  },
  stocks: {
    libelle: 'Stocks',
    dossiers: 'Un dossier qui porte un compte de ce cycle.',
    nonCouvert: 'Les stocks ne sont pas tenus dans l’application : un solde de ce cycle se justifie en citant ses pièces.',
  },
  ensemble: { libelle: 'Ensemble', dossiers: 'Tous les dossiers.', nonCouvert: null },
}

// LE RANGEMENT D'UN COMPTE, par le plus long préfixe connu (§ 2.1). Les exceptions d'abord, plus longues que la règle
// de leur classe :
//   - 661100 et 616800, les intérêts et l'assurance d'un emprunt, vont avec l'emprunt (le 164) ;
//   - 658000 et 758000, les arrondis de la CA3 (lib/liquidationTva.ts), vont à la TVA. Un compte ne dit pas QUI l'a
//     écrit : la catégorie commune qui écrit au 758000 (relevé en base le 09/10/2026) y va aussi. Seule la revue
//     analytique (étape R5) lit les comptes de résultat ; elle séparera l'arrondi par sa SOURCE — l'écriture de
//     liquidation porte sa déclaration —, pas par son compte ;
//   - 404, la dette d'un bien immobilisé, va au registre ; 467, le compte du dirigeant en engagement, à l'exploitant ;
//   - 64, les charges de personnel et les cotisations personnelles de l'exploitant (646), au social, avec 42 et 43 : la
//     conception y range le personnel « plus tard, phase 5 », et un rangement total ne peut pas attendre ;
//   - 681, 675 et 775 — dotations, valeur des éléments cédés, produits des cessions — au registre ;
//   - 603 et 713, les variations de stocks, aux stocks.
// Puis les comptes à deux chiffres des classes 1 et 4, puis la classe. Les classes 6 et 7 vont aux dépenses et aux
// recettes, 68 et 69 compris hors 681 : le tableau de la conception ne les nomme pas, et un rangement total ne laisse
// aucun compte sans cycle.
// Une `Map`, pas un objet : on y cherche une tranche de n'importe quel compte, et un objet répondrait aussi de ce qu'il
// hérite.
const CYCLE_PAR_PREFIXE: ReadonlyMap<string, CycleRevision> = new Map(Object.entries<CycleRevision>({
  '661100': 'emprunts', '616800': 'emprunts', '658000': 'tva', '758000': 'tva',
  '404': 'immobilisations', '467': 'capitaux', '681': 'immobilisations', '675': 'immobilisations',
  '775': 'immobilisations', '603': 'stocks', '713': 'stocks',
  '16': 'emprunts', '17': 'emprunts',
  '40': 'tiers', '41': 'tiers', '42': 'social', '43': 'social', '44': 'tva', '45': 'capitaux', '46': 'tiers',
  '47': 'tiers', '48': 'tiers', '49': 'tiers', '64': 'social',
  '1': 'capitaux', '2': 'immobilisations', '3': 'stocks', '4': 'tiers', '5': 'tresorerie', '6': 'depenses',
  '7': 'recettes',
}))
const LONGUEURS_DES_PREFIXES = [...new Set([...CYCLE_PAR_PREFIXE.keys()].map((p) => p.length))].sort((a, b) => b - a)

/** Le cycle d'un compte, nul hors des classes 1 à 7. */
export function cycleDuCompte(compte: string): CycleRevision | null {
  // Le plus long préfixe d'abord. Un compte plus court qu'un préfixe s'y tranche tout entier, et n'y trouve que lui-même,
  // comme à sa propre longueur ; hors des classes 1 à 7, aucun préfixe ne se trouve.
  for (const longueur of LONGUEURS_DES_PREFIXES) {
    const cycle = CYCLE_PAR_PREFIXE.get(compte.slice(0, longueur))
    if (cycle !== undefined) return cycle
  }
  return null
}

// LES CYCLES D'UN DOSSIER (§ 2.1, colonne « Dossiers »), dans l'ordre de l'écran. Un cycle existe quand le dossier le
// demande — un registre, un emprunt, la TVA d'un redevable, l'engagement —, QUAND L'EXERCICE PORTE UN COMPTE DE BILAN
// QUI S'Y RANGE — un solde ne doit jamais se trouver dans une carte que l'écran ne montre pas —, OU QUAND UN CONTRÔLE
// EXISTANT S'Y RANGE ET A QUELQUE CHOSE À DIRE : « statut de TVA à préciser » concerne justement un dossier que rien ne
// dit redevable, et la facture du véhicule de société, un registre encore vide. Les comptes de RÉSULTAT n'ouvrent rien :
// la révision par compte ne porte que sur les soldes de bilan (§ 3.2), et le 758000 d'une catégorie ouvrirait sinon une
// carte TVA vide sur un dossier non redevable. Les stocks n'existent que par leurs comptes.
export interface DossierPourLesCycles {
  mode: ModeComptable
  assujettiTva: boolean
  nbBiens: number
  nbEmprunts: number
  // Les comptes de bilan que l'exercice porte : ceux de ses soldes, et ceux de ses décisions.
  comptesDeBilan: readonly string[]
  // Les cycles des contrôles qui ont quelque chose à dire (`controlesParCycle`).
  cyclesDesControles: readonly CycleRevision[]
}

export function cyclesDuDossier(d: DossierPourLesCycles): CycleRevision[] {
  const portes = new Set([...d.comptesDeBilan.map(cycleDuCompte), ...d.cyclesDesControles])
  return CYCLES_DE_REVISION.filter((cycle) => {
    if (portes.has(cycle)) return true
    switch (cycle) {
      case 'immobilisations': return d.nbBiens > 0
      case 'emprunts': return d.nbEmprunts > 0
      case 'tva': return d.assujettiTva
      case 'tiers': return d.mode === 'engagement'
      case 'stocks': return false
      default: return true
    }
  })
}

// ── Les contrôles existants, rangés par cycle ─────────────────────────────────────────────────────────────────────

// LE CYCLE DE CHAQUE CONTRÔLE QUE L'APPLICATION FAIT DÉJÀ : les points de la Checklist (pages/dossier/ChecklistTab.tsx,
// ses points à traiter et ses documents attendus) et les préalables de la validation (lib/prealablesValidation.ts),
// par leur identifiant. `revisionCycles.test.ts` lit les deux sources et refuse un identifiant qui ne figure ni ici ni
// dans `CONTROLES_HORS_CYCLE` — la discipline de `POINTS_DE_LA_CHECKLIST_ECARTES` : un contrôle ajouté demain doit dire
// de quel cycle il est —, et un identifiant d'ici qui n'existe plus.
//
// Un contrôle va au cycle où le cabinet le lit en révisant (§ 2.2) : ce que le relevé affirme à la trésorerie, ce qu'une
// pièce porte aux dépenses — les recettes n'ont de pièces propres que leurs ventes —, l'ordre des exercices, la
// numérotation et la concordance à l'ensemble. Deux écarts au § 2.2, tirés du code :
//   - « montant-suspect » (une pièce validée dont le montant n'est nulle part au relevé) : le § 2.2 le cite sous les
//     recettes, mais `piecesMontantIntrouvableEnBanque` lit TOUTES les pièces validées, dépenses comprises, ses deux
//     causes sont un relevé incomplet ou un montant faux, et la Checklist l'envoie à la banque : trésorerie ;
//   - « piste-rompue » réunit sous un seul nombre l'écriture sans justificatif et l'écriture de banque sans mouvement,
//     dont le § 2.2 range la seconde à la trésorerie : il reste à l'ensemble, avec la piste d'audit.
// Un seul cas dépend du modèle du dossier : « sans contrepartie » est en trésorerie une écriture qui attend son
// mouvement, en engagement une facture sans règlement, une créance ou une dette.
export const CYCLE_DES_CONTROLES: Readonly<Record<string, CycleRevision | Readonly<Record<ModeComptable, CycleRevision>>>> = {
  // La trésorerie : le relevé, ses mouvements et ce qu'ils écrivent.
  'releve-incoherent': 'tresorerie',
  'releves-inconnus': 'tresorerie',
  'mouvements-a-traiter': 'tresorerie',
  'lignes-non-rapprochees': 'tresorerie',
  'mouvements-ignores': 'tresorerie',
  'rapproches-sans-objet': 'tresorerie',
  'ventilations-incoherentes': 'tresorerie',
  'reglements-groupes-incoherents': 'tresorerie',
  'affectes-perimes': 'tresorerie',
  'ventiles-perimes': 'tresorerie',
  'comptes-de-bilan-perimes': 'tresorerie',
  'montant-suspect': 'tresorerie',
  'sans-contrepartie': { tresorerie: 'tresorerie', engagement: 'tiers' },
  // Les relevés attendus de chaque exercice (« Relevés bancaires AAAA »).
  banque: 'tresorerie',
  // Les recettes : les ventes que l'application émet, et le taux d'une recette du relevé.
  'recettes-affectees-assujetti': 'recettes',
  'ventes-en-double': 'recettes',
  'jumelles-incoherentes': 'recettes',
  // Les dépenses : les pièces, leurs écritures, leurs postes.
  'pieces-a-valider': 'depenses',
  'pieces-sans-date': 'depenses',
  'date-impossible': 'depenses',
  'sans-categorie': 'depenses',
  'comptes-manquants': 'depenses',
  'postes-manquants': 'depenses',
  'sans-tva': 'depenses',
  'tva-impossible': 'depenses',
  'devise-non-convertie': 'depenses',
  'confiance-basse': 'depenses',
  'mois-en-double': 'depenses',
  'doublon-texte': 'depenses',
  'doublons-inconnus': 'depenses',
  'ecritures-a-generer': 'depenses',
  desynchronisees: 'depenses',
  'ecritures-sans-objet': 'depenses',
  'pieces-payees-en-partie': 'depenses',
  'pieces-payees-en-trop': 'depenses',
  'frais-vehicule-en-double': 'depenses',
  'forfaits-a-ecrire': 'depenses',
  'postes-sans-case': 'depenses',
  'cases-negatives': 'depenses',
  tickets: 'depenses',
  vacances: 'depenses',
  // Les pièces attendues de chaque exercice (« Factures / pièces AAAA »).
  factures: 'depenses',
  // Le registre des immobilisations, et la facture du véhicule de société.
  'immos-sans-justificatif': 'immobilisations',
  'dotations-a-ecrire': 'immobilisations',
  'vehicule-amorti-sous-bareme': 'immobilisations',
  vehicule: 'immobilisations',
  // Les emprunts.
  'echeances-emprunt-perimees': 'emprunts',
  'echeances-emprunt-non-rapprochees': 'emprunts',
  // Le social, et les appels attendus de chaque exercice (« Appels de cotisation AAAA »).
  'cotisations-sans-ecriture': 'social',
  'cotisations-rapprochement-refuse': 'social',
  'csg-non-saisie': 'social',
  'paiements-personnels-a-reprendre': 'social',
  cotisations: 'social',
  // La TVA.
  'statut-tva': 'tva',
  'liquidations-tva-perimees': 'tva',
  'paiements-tva-perimes': 'tva',
  'periodes-tva-non-declarees': 'tva',
  // L'exploitant et les capitaux.
  'virements-sans-ecriture': 'capitaux',
  // Les tiers.
  'lettrages-qui-ne-tiennent-plus': 'tiers',
  // L'ensemble : l'ordre des exercices, la numérotation, l'ouverture qui suivra, la 2035, la piste d'audit, et les
  // informations du dossier.
  'exercice-en-cours': 'ensemble',
  'deja-valide': 'ensemble',
  ordre: 'ensemble',
  'avant-ouverture': 'ensemble',
  'ouverture-d-abord': 'ensemble',
  'ecritures-anterieures': 'ensemble',
  'exercice-anterieur-d-abord': 'ensemble',
  'ecritures-orphelines': 'ensemble',
  'ecritures-desequilibrees': 'ensemble',
  desequilibrees: 'ensemble',
  numerotation: 'ensemble',
  'report-hors-classes': 'ensemble',
  'report-desequilibre': 'ensemble',
  concordance: 'ensemble',
  'exclusions-2035': 'ensemble',
  'piste-rompue': 'ensemble',
  informations: 'ensemble',
}

// CE QUI N'EST PAS UN CONTRÔLE D'UN CYCLE, avec sa raison.
export const CONTROLES_HORS_CYCLE: Readonly<Record<string, string>> = {
  'lecture-partielle': 'l’état de la lecture du dossier, pas un contrôle : l’écran de la révision le dit par son propre '
    + 'bandeau, et n’offre alors aucun geste',
}

// Les documents attendus d'un exercice portent son année dans leur identifiant (`banque-2025`) : on range la famille.
const FAMILLE_ANNUELLE = /^([a-z]+)-\d{4}$/

/** Le cycle d'un contrôle de la Checklist ou d'un préalable de la validation ; nul pour un contrôle hors cycle ou inconnu. */
export function cycleDuControle(id: string, mode: ModeComptable): CycleRevision | null {
  const annuelle = FAMILLE_ANNUELLE.exec(id)
  // `Object.hasOwn` : un identifiant comme `constructor` ne doit pas trouver ce que tout objet hérite.
  const cle = Object.hasOwn(CYCLE_DES_CONTROLES, id) ? id : annuelle && Object.hasOwn(CYCLE_DES_CONTROLES, annuelle[1]) ? annuelle[1] : null
  if (cle === null) return null
  const rangement = CYCLE_DES_CONTROLES[cle]
  return typeof rangement === 'string' ? rangement : rangement[mode]
}

export interface ControlesRanges<C> {
  // Chaque cycle et ses contrôles, dans l'ordre où ils viennent.
  parCycle: Map<CycleRevision, C[]>
  // Les contrôles qu'aucun cycle ne porte, par décision (`CONTROLES_HORS_CYCLE`).
  horsCycle: C[]
  // Les contrôles que ce module ne connaît pas. Jamais tus : l'écran les montre à part. `revisionCycles.test.ts`
  // garantit qu'aucun contrôle de la Checklist ni des préalables n'y tombe aujourd'hui.
  inconnus: C[]
}

/** Des contrôles rangés par cycle, dans l'ordre où ils viennent ; rien ne se perd en route. */
export function controlesParCycle<C extends { id: string }>(controles: readonly C[], mode: ModeComptable): ControlesRanges<C> {
  const rangement: ControlesRanges<C> = { parCycle: new Map(), horsCycle: [], inconnus: [] }
  for (const c of controles) {
    const cycle = cycleDuControle(c.id, mode)
    if (cycle !== null) rangement.parCycle.set(cycle, [...(rangement.parCycle.get(cycle) ?? []), c])
    else if (Object.hasOwn(CONTROLES_HORS_CYCLE, c.id)) rangement.horsCycle.push(c)
    else rangement.inconnus.push(c)
  }
  return rangement
}
