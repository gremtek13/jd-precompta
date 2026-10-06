import {
  ecritureConforme, ecrituresSansPieceParMouvement,
  type LigneEcritureMouvement, type MouvementBancaire,
} from './affectationBanque'
import { ecartEnJours, libelleExploitable } from './appariementBanque'
import { refusEcritSurUnCompteDeBilan, refusPaieUneDeclarationTva } from './classementsDuMouvement'
import { COMPTE_ASSURANCE_EMPRUNT, COMPTE_BANQUE, COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT } from './comptes'
import { genererEcheancier, type Emprunt, type LigneEcheancier } from './emprunts'
import { ajouterJours, formatDate } from './format'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import type { EcritureBrouillon } from './types'

// UNE ÉCHÉANCE D'EMPRUNT S'ÉCRIT SUR SES COMPTES (ligne 26.6 de la feuille de route, étape a).
//
// Le prélèvement mensuel d'un prêt professionnel mêle ce que la comptabilité sépare : le capital
// remboursé diminue une dette (164, un compte de bilan — ni charge ni recette), les intérêts sont une
// charge financière (661, ligne 31 de la 2035-A, « Frais financiers ») et l'assurance de l'emprunteur une
// prime d'assurance (616, dans le total BH). Rien de ce prélèvement n'était écrit : ni au brouillon, ni au
// FEC, et la 2035 ne comptait aucun intérêt d'emprunt — une charge déductible oubliée, chaque mois.
//
// LE DÉCOUPAGE EST VALIDÉ PAR LE CABINET, PAS DÉDUIT. L'application le PROPOSE depuis l'échéancier
// qu'elle calcule (lib/emprunts.ts) ; la banque a son propre tableau d'amortissement, qui fait foi et
// peut différer (arrondis, différé, assurance). Ce qui est validé s'écrit ET se garde sur le mouvement
// (`emprunt_echeance`, `emprunt_interets`, `emprunt_assurance`) : la 2035 le lit là, comme l'écran du
// client, qui n'a pas accès aux écritures.
//
// UN MOUVEMENT POSITIF rattaché à un emprunt en est le DÉBLOCAGE : les fonds reçus, la banque au débit
// et le 164 au crédit, sans intérêts ni échéance.
//
// L'écriture est composée ICI (testée) ; la fonction SQL `rapprocher_echeance_emprunt` la VÉRIFIE ligne
// à ligne contre le mouvement et le découpage, puis l'écrit AVEC le rapprochement, dans une transaction
// (voir `supabase/essais/echeanceEmprunt.sql`).

// Les postes de la 2035 où tombent les intérêts et l'assurance. Des chaînes du rattachement des cases
// (cases2035.ts : BN et BH) — `echeanceEmprunt.test.ts` vérifie qu'elles y mènent toujours, pour qu'un
// renommage d'un côté ne fasse pas tomber les intérêts dans « sans case » en silence.
export const POSTE_INTERETS_EMPRUNT = 'Frais financiers'
export const POSTE_ASSURANCE_EMPRUNT = "Primes d'assurance"

// Ce qu'on dit d'un emprunt dans une part de la 2035 ou une liste : une chaîne, pas un nom d'emprunt —
// la 2035 regroupe par poste, et deux emprunts y tombent dans la même ligne.
export const LIBELLE_INTERETS_EMPRUNT = 'Intérêts d’emprunt'
export const LIBELLE_ASSURANCE_EMPRUNT = 'Assurance d’emprunt'

export interface DecoupageEcheance {
  // Le numéro de l'échéance dans l'échéancier de l'emprunt (1 à sa durée) ; nul pour un déblocage.
  echeance: number | null
  interets: number
  assurance: number
}

export function estDeblocage(ligne: Pick<MouvementBancaire, 'montant'>): boolean {
  return ligne.montant > 0
}

const centimes = (n: number) => Math.round(n * 100)
const auCentime = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

// Pourquoi ce mouvement ne peut pas être rapproché d'un emprunt, dit AVANT d'écrire. La base refait les
// mêmes refus : l'écran les dit pour qu'on ne clique pas pour rien, la base pour qu'aucun chemin ne les
// contourne. Un mouvement déjà rapproché d'un EMPRUNT n'est pas refusé : un nouveau rapprochement
// remplace le précédent (une autre échéance, un autre découpage).
export function refusEcheanceEmprunt(ligne: MouvementBancaire): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  const surUnCompteDeBilan = refusEcritSurUnCompteDeBilan(ligne)
  if (surUnCompteDeBilan) return surUnCompteDeBilan
  const paieUneDeclaration = refusPaieUneDeclarationTva(ligne)
  if (paieUneDeclaration) return paieUneDeclaration
  if (ligne.piece_id || ligne.cotisation_id || ligne.categorie_id || ligne.ventilee || ligne.prelevement_personnel) {
    return 'Ce mouvement est rapproché d’une pièce ou d’une cotisation, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.'
  }
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  return null
}

// Les échéances de CET emprunt déjà rapprochées d'un AUTRE mouvement, avec la date de celui-ci : une
// échéance ne se paie qu'une fois (`lignes_bancaires_echeance_emprunt_unique`). Le mouvement lui-même
// est écarté — le rapprocher de nouveau à la même échéance est un remplacement, pas un doublon.
export function echeancesOccupees(
  lignes: readonly Pick<MouvementBancaire, 'id' | 'date' | 'emprunt_id' | 'emprunt_echeance'>[],
  empruntId: string,
  saufLigneId: string | null,
): Map<number, string> {
  const occupees = new Map<number, string>()
  for (const l of lignes) {
    if (l.emprunt_id !== empruntId || l.emprunt_echeance == null || l.id === saufLigneId) continue
    occupees.set(l.emprunt_echeance, l.date)
  }
  return occupees
}

// Pourquoi ce découpage ne peut pas s'écrire — les refus de la base, dans le même ordre, plus celui de
// l'échéance déjà rapprochée que la base fait après ceux-là.
export function refusDecoupage(
  ligne: Pick<MouvementBancaire, 'montant'>,
  emprunt: Pick<Emprunt, 'duree_mois'>,
  d: DecoupageEcheance,
  occupees: ReadonlyMap<number, string>,
): string | null {
  if (estDeblocage(ligne)) {
    if (d.echeance != null || d.interets !== 0 || d.assurance !== 0) {
      return 'Un encaissement rattaché à un emprunt en est le déblocage : ni échéance, ni intérêts, ni assurance.'
    }
    return null
  }
  if (d.echeance == null || !Number.isInteger(d.echeance) || d.echeance < 1 || d.echeance > emprunt.duree_mois) {
    return `L’échéance doit être comprise entre 1 et ${emprunt.duree_mois} pour cet emprunt.`
  }
  const total = Math.abs(ligne.montant)
  if (!Number.isFinite(d.interets) || !Number.isFinite(d.assurance) || d.interets < 0 || d.assurance < 0
    || !auCentime(d.interets) || !auCentime(d.assurance) || centimes(d.interets) + centimes(d.assurance) > centimes(total)) {
    return 'Découpage impossible : les intérêts et l’assurance sont positifs, au centime, et ne dépassent pas le prélèvement.'
  }
  const autre = occupees.get(d.echeance)
  if (autre) return `L’échéance n° ${d.echeance} de cet emprunt est déjà rapprochée du mouvement du ${formatDate(autre)}.`
  return null
}

// Le capital remboursé : le reste du prélèvement, calculé en centimes pour que les lignes de l'écriture
// s'équilibrent exactement — la base refuse une écriture déséquilibrée d'un centime.
export function capitalDeLEcheance(ligne: Pick<MouvementBancaire, 'montant'>, d: DecoupageEcheance): number {
  const total = centimes(Math.abs(ligne.montant))
  if (estDeblocage(ligne)) return total / 100
  return (total - centimes(d.interets) - centimes(d.assurance)) / 100
}

// L'écriture d'une échéance ou d'un déblocage, une ligne par compte NON NUL : la base ne compte pas une
// ligne à zéro euro (une échéance sans assurance, un différé qui ne rembourse aucun capital) et refuse
// l'écriture qui en porterait une. LE SENS VIENT DU SIGNE DU MOUVEMENT, comme pour une affectation : une
// sortie crédite la banque, un déblocage la débite.
export function ecritureDeLEcheance(ligne: MouvementBancaire, d: DecoupageEcheance): LigneEcritureMouvement[] {
  const libelle = libelleExploitable(ligne) || ligne.libelle
  const total = centimes(Math.abs(ligne.montant)) / 100
  if (estDeblocage(ligne)) {
    return [
      { compte: COMPTE_EMPRUNT, sens: 'credit', montant: total, libelle },
      { compte: COMPTE_BANQUE, sens: 'debit', montant: total, libelle },
    ]
  }
  const lignes: LigneEcritureMouvement[] = [
    { compte: COMPTE_EMPRUNT, sens: 'debit', montant: capitalDeLEcheance(ligne, d), libelle },
    { compte: COMPTE_INTERETS_EMPRUNT, sens: 'debit', montant: centimes(d.interets) / 100, libelle },
    { compte: COMPTE_ASSURANCE_EMPRUNT, sens: 'debit', montant: centimes(d.assurance) / 100, libelle },
    { compte: COMPTE_BANQUE, sens: 'credit', montant: total, libelle },
  ]
  return lignes.filter((l) => l.montant > 0)
}

// Le découpage GARDÉ sur un mouvement rapproché d'un emprunt — ce que la base a vérifié et écrit.
export function decoupageDuMouvement(ligne: MouvementBancaire): DecoupageEcheance | null {
  if (!ligne.emprunt_id) return null
  return {
    echeance: ligne.emprunt_echeance,
    interets: ligne.emprunt_interets ?? 0,
    assurance: ligne.emprunt_assurance ?? 0,
  }
}

export interface EcheanceProposee {
  // L'échéance de l'échéancier que le mouvement paie vraisemblablement ; nulle pour un déblocage.
  echeance: LigneEcheancier | null
  decoupage: DecoupageEcheance
  // L'écart entre la date du mouvement et celle de l'échéance proposée, que l'écran dit quand il est
  // grand : une échéance éloignée d'un mois est un indice qu'on n'a pas la bonne.
  ecartJours: number
}

// LE DÉCOUPAGE PROPOSÉ, que le cabinet corrige s'il le faut. L'échéance est la plus proche du mouvement
// parmi celles qu'aucun autre mouvement ne paie encore — à égalité, la plus ancienne. Les intérêts sont
// ceux de l'échéancier ; ce que le prélèvement porte EN PLUS de l'échéance calculée (intérêts et capital)
// est proposé en assurance, parce que c'est ce qu'une banque ajoute le plus souvent au prélèvement ; le
// capital est le reste. Sur un prélèvement plus court que prévu, les intérêts sont ramenés au prélèvement
// et l'assurance reste à zéro. Nul quand toutes les échéances sont déjà rapprochées.
export function echeanceProposee(
  emprunt: Pick<Emprunt, 'capital_initial' | 'taux_annuel' | 'duree_mois' | 'date_debut'>,
  ligne: Pick<MouvementBancaire, 'date' | 'montant'>,
  occupees: ReadonlyMap<number, string>,
): EcheanceProposee | null {
  if (estDeblocage(ligne)) {
    return { echeance: null, decoupage: { echeance: null, interets: 0, assurance: 0 }, ecartJours: ecartEnJours(ligne.date, emprunt.date_debut) }
  }
  let retenue: LigneEcheancier | null = null
  let ecartRetenu = Infinity
  for (const l of genererEcheancier(emprunt)) {
    if (occupees.has(l.numero)) continue
    const ecart = ecartEnJours(l.date, ligne.date)
    if (ecart < ecartRetenu) {
      retenue = l
      ecartRetenu = ecart
    }
  }
  if (!retenue) return null
  return { echeance: retenue, decoupage: decoupagePourEcheance(retenue, ligne), ecartJours: ecartRetenu }
}

// Le découpage proposé pour UNE échéance de l'échéancier — celle que `echeanceProposee` retient, ou
// celle dont le cabinet tape le numéro : changer de numéro repropose les intérêts de CE mois-là.
export function decoupagePourEcheance(
  echeance: LigneEcheancier,
  ligne: Pick<MouvementBancaire, 'montant'>,
): DecoupageEcheance {
  const total = centimes(Math.abs(ligne.montant))
  const interets = Math.min(centimes(echeance.interets), total)
  const assurance = total > montantAttenduCentimes(echeance) ? total - montantAttenduCentimes(echeance) : 0
  return { echeance: echeance.numero, interets: interets / 100, assurance: assurance / 100 }
}

// Ce que l'échéancier prévoit pour une échéance, intérêts et capital : la mensualité, sauf à la
// dernière, qui solde le capital restant et diffère donc de quelques centimes.
function montantAttenduCentimes(echeance: Pick<LigneEcheancier, 'interets' | 'capitalRembourse'>): number {
  return centimes(echeance.interets) + centimes(echeance.capitalRembourse)
}

export function montantAttendu(echeance: Pick<LigneEcheancier, 'interets' | 'capitalRembourse'>): number {
  return montantAttenduCentimes(echeance) / 100
}

// UN MOUVEMENT QUI RESSEMBLE À UNE ÉCHÉANCE OU À UN DÉBLOCAGE. De quoi DÉPLIER le rapprochement dans la
// fiche d'un mouvement, et écarter le mouvement du lot des règles d'affectation — jamais de quoi écrire :
// le rapprochement reste un clic, découpage sous les yeux. Large exprès, parce que les deux erreurs ne
// coûtent pas la même chose : ressembler à tort coûte un clic ; ne pas ressembler, dans le lot, fait
// affecter une échéance à une catégorie de charge, et son CAPITAL compte alors en charge dans la 2035.
//
// Une échéance : l'une de celles qu'aucun autre mouvement ne paie, à `MARGE_PRELEVEMENT_JOURS` près de
// sa date, et le prélèvement entre 90 % de ce que l'échéancier prévoit (le tableau de la banque peut
// arrondir autrement) et une fois et demie (l'assurance s'ajoute). La plus proche en date si plusieurs.
// Un déblocage : un encaissement à un mois près de la date de début, d'au moins un dixième du capital,
// et qui ne dépasse pas ce qui reste à débloquer après les déblocages déjà rapprochés.
export interface EmpruntPlausible {
  emprunt: Emprunt
  // L'échéance que le mouvement semble payer ; nulle pour un déblocage.
  echeance: LigneEcheancier | null
}

export const JOURS_DEBLOCAGE_PLAUSIBLE = 31

export function empruntPlausible(
  ligne: Pick<MouvementBancaire, 'id' | 'date' | 'montant'>,
  emprunts: readonly Emprunt[],
  lignes: readonly Pick<MouvementBancaire, 'id' | 'date' | 'montant' | 'statut' | 'emprunt_id' | 'emprunt_echeance'>[],
): EmpruntPlausible | null {
  const total = centimes(Math.abs(ligne.montant))
  if (total === 0) return null
  let retenu: EmpruntPlausible | null = null
  let ecartRetenu = Infinity
  for (const emprunt of emprunts) {
    if (estDeblocage(ligne)) {
      const ecart = ecartEnJours(ligne.date, emprunt.date_debut)
      if (ecart > JOURS_DEBLOCAGE_PLAUSIBLE) continue
      const dejaDebloque = lignes
        .filter((l) => l.id !== ligne.id && l.statut === 'rapprochee' && l.emprunt_id === emprunt.id && estDeblocage(l))
        .reduce((s, l) => s + centimes(l.montant), 0)
      const capital = centimes(emprunt.capital_initial)
      if (total * 10 < capital || total > capital - dejaDebloque) continue
      if (ecart < ecartRetenu) { retenu = { emprunt, echeance: null }; ecartRetenu = ecart }
      continue
    }
    const occupees = echeancesOccupees(lignes, emprunt.id, ligne.id)
    for (const echeance of genererEcheancier(emprunt)) {
      if (occupees.has(echeance.numero)) continue
      const ecart = ecartEnJours(echeance.date, ligne.date)
      if (ecart > MARGE_PRELEVEMENT_JOURS || ecart >= ecartRetenu) continue
      const attendu = montantAttenduCentimes(echeance)
      if (total * 10 < attendu * 9 || total * 2 > attendu * 3) continue
      retenu = { emprunt, echeance }
      ecartRetenu = ecart
    }
  }
  return retenu
}

// Ce que le lot des règles d'affectation dit d'un mouvement qu'il écarte pour cette raison.
export function raisonEmpruntPlausible(p: EmpruntPlausible): string {
  return p.echeance
    ? `Il ressemble à l’échéance n° ${p.echeance.numero} de l’emprunt « ${p.emprunt.nom} » : à rapprocher de l’emprunt, pas à affecter — son capital compterait en charge.`
    : `Il ressemble au déblocage de l’emprunt « ${p.emprunt.nom} » : à rapprocher de l’emprunt, pas à affecter — un emprunt n’est pas une recette.`
}

// LES PARTS DU RELEVÉ D'UNE ÉCHÉANCE, pour la 2035 et les états qui la déclinent : les intérêts en frais
// financiers, l'assurance en primes d'assurance, à la date du MOUVEMENT — le jour du paiement, la règle
// de la 2035 sans supposition. Le capital n'en a pas : il rembourse une dette, il ne réduit pas le
// résultat. Un déblocage non plus : il est un emprunt, pas une recette. Seules les échéances RAPPROCHÉES
// comptent — une échéance que l'échéancier prévoit et que rien ne paie n'est pas une dépense payée ; ce
// qui manque se dit à part (`echeancesNonRapprochees`).
export interface PartEcheance {
  ligne: MouvementBancaire
  libelle: string
  poste: string
  // Le compte où l'écriture de l'échéance porte cette part : 661100 pour les intérêts, 616800 pour l'assurance.
  compte: string
  montantPoste: number
}

export function partsDesEcheances(lignes: readonly MouvementBancaire[]): PartEcheance[] {
  const parts: PartEcheance[] = []
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.emprunt_id || estDeblocage(ligne)) continue
    const interets = ligne.emprunt_interets ?? 0
    const assurance = ligne.emprunt_assurance ?? 0
    if (interets > 0) {
      parts.push({ ligne, libelle: LIBELLE_INTERETS_EMPRUNT, poste: POSTE_INTERETS_EMPRUNT, compte: COMPTE_INTERETS_EMPRUNT, montantPoste: interets })
    }
    if (assurance > 0) {
      parts.push({ ligne, libelle: LIBELLE_ASSURANCE_EMPRUNT, poste: POSTE_ASSURANCE_EMPRUNT, compte: COMPTE_ASSURANCE_EMPRUNT, montantPoste: assurance })
    }
  }
  return parts
}

// LES DÉBLOCAGES D'EMPRUNT NE SONT PAS UN RYTHME D'ACTIVITÉ. Écrits désormais au 512, ils entreraient
// dans la moyenne des encaissements du plan de trésorerie — un prêt de 50 000 € débloqué dans l'année y
// ajouterait plus de 4 000 € d'« activité » par mois, projetés sur tout le plan — et dans le taux
// d'endettement, qui s'en trouverait flatté d'autant, sur le document qu'on montre à une banque. Le
// SOLDE, lui, les compte : l'argent est bien arrivé. Les identifiants des mouvements, pour que l'écran
// écarte leurs écritures de la seule moyenne.
export function idsDeblocagesEmprunt(
  lignes: readonly Pick<MouvementBancaire, 'id' | 'montant' | 'statut' | 'emprunt_id'>[],
): ReadonlySet<string> {
  return new Set(lignes.filter((l) => l.statut === 'rapprochee' && !!l.emprunt_id && estDeblocage(l)).map((l) => l.id))
}

export interface EcheanceNonRapprochee {
  emprunt: Emprunt
  echeance: LigneEcheancier
}

// LES ÉCHÉANCES QUE L'ÉCHÉANCIER PRÉVOIT ENTRE DEUX DATES ET QU'AUCUN MOUVEMENT NE PAIE : leurs intérêts
// manquent à la 2035, et le prélèvement qui les a payées attend quelque part dans le relevé, « à traiter ».
// L'appelant choisit les bornes : la Checklist s'arrête à ce que le relevé couvre (`couvertureDuReleve`),
// Clôture regarde l'exercice. Une échéance se reconnaît à son NUMÉRO, celui que le cabinet a choisi en
// rapprochant — pas à sa date, que la banque décale de quelques jours.
export function echeancesNonRapprochees(
  emprunts: readonly Emprunt[],
  lignes: readonly Pick<MouvementBancaire, 'emprunt_id' | 'emprunt_echeance'>[],
  debut: string,
  fin: string,
): EcheanceNonRapprochee[] {
  if (fin < debut) return []
  const payees = new Set(lignes.filter((l) => l.emprunt_id && l.emprunt_echeance != null).map((l) => `${l.emprunt_id}|${l.emprunt_echeance}`))
  const manquantes: EcheanceNonRapprochee[] = []
  for (const emprunt of emprunts) {
    for (const echeance of genererEcheancier(emprunt)) {
      if (echeance.date < debut || echeance.date > fin) continue
      if (payees.has(`${emprunt.id}|${echeance.numero}`)) continue
      manquantes.push({ emprunt, echeance })
    }
  }
  return manquantes.sort((a, b) => a.echeance.date.localeCompare(b.echeance.date) || a.emprunt.nom.localeCompare(b.emprunt.nom))
}

// La marge qu'on laisse à la banque après la date d'une échéance avant de la réclamer : un prélèvement
// tombe souvent quelques jours après la date théorique (jour ouvré, date de valeur), et le relevé importé
// s'arrête où il s'arrête. Sans marge, la dernière échéance de chaque relevé serait « manquante » à tort.
export const MARGE_PRELEVEMENT_JOURS = 10

// Ce que le relevé importé COUVRE : du premier au dernier mouvement, moins la marge. Une échéance hors
// de cette fenêtre n'est pas réclamée — avant le premier relevé, elle n'a pas été importée ; après le
// dernier, son prélèvement n'est peut-être pas encore passé. Nul sans aucun mouvement.
//
// ET RIEN AU PLUS TARD À LA FRONTIÈRE DE VALIDATION (lib/validationExercice.ts) : les mouvements d'un exercice
// validé ne se rapprochent plus, donc une échéance qu'aucun ne paie ne le sera jamais — la réclamer laisserait un
// point que rien ne lève. Elle relève de l'exercice suivant. Quand rien ne reste à couvrir après la frontière, la
// fenêtre est VIDE (son début après sa fin), et `echeancesNonRapprochees` ne réclame rien — comme pour un relevé
// plus court que la marge. Sans valeur par défaut : un appelant qui l'oublie réclamerait les échéances d'un
// exercice validé.
export function couvertureDuReleve(
  lignes: readonly Pick<MouvementBancaire, 'date'>[], frontiere: string | null,
): { debut: string; fin: string } | null {
  if (lignes.length === 0) return null
  let debut = lignes[0].date
  let fin = lignes[0].date
  for (const l of lignes) {
    if (l.date < debut) debut = l.date
    if (l.date > fin) fin = l.date
  }
  if (frontiere !== null && debut <= frontiere) debut = ajouterJours(frontiere, 1)
  return { debut, fin: ajouterJours(fin, -MARGE_PRELEVEMENT_JOURS) }
}

// UN MOUVEMENT RAPPROCHÉ D'UN EMPRUNT DONT L'ÉCRITURE N'EST PAS CELLE DE SON DÉCOUPAGE : absente, d'un
// autre montant, sur un autre compte, dans un autre sens ou à une autre date. La transaction de la base
// les écrit ensemble, donc le cas ne vient pas d'un échec à mi-chemin : il est défensif, pour qu'une
// écriture retirée ou modifiée par un autre chemin ne sorte pas du FEC en silence. Rapprocher de nouveau
// le mouvement réécrit l'écriture.
export function echeancesDesynchronisees(
  ecritures: readonly EcritureBrouillon[],
  lignes: readonly MouvementBancaire[],
): MouvementBancaire[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return lignes.filter((ligne) => {
    const d = decoupageDuMouvement(ligne)
    if (!d) return false
    return !ecritureConforme(parLigne.get(ligne.id) ?? [], ecritureDeLEcheance(ligne, d), ligne.date)
  })
}
