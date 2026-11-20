// LE RAPPROCHEMENT DES PAIEMENTS DE L'ASSURANCE MALADIE AVEC LES MOUVEMENTS DU RELEVÉ (conception 53, lot NOE5 ; le récit :
// HISTORIQUE.md, « 17/11/2026 — NOE5 : L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ »). PUR : ni
// base, ni réseau, ni horloge — le jour vient de l'appelant —, et aucune valeur du relevé ne sort d'ici sinon des dates et des
// montants (un libellé se lit pour deux signaux, jamais ne se recopie dans un mot).
//
// LA RÈGLE. Un paiement de l'assurance maladie (un agrégat par journée comptable, organisme et part, NOE3) JUSTIFIE et
// CONTRÔLE le crédit du relevé qui le verse ; il ne compte dans aucun moteur. La recette reste le crédit, classé, à sa date
// (CGI, art. 93, 1 ; l'expert-comptable, le 17/11/2026 : « date de valeur si on l'a, ou date d'encaissement ») : l'association
// ne change rien à la 2035, à la CA3 ni au FEC, et elle ne remplace pas le classement du crédit — elle vit dans sa propre table
// (`paiements_assurance_maladie_mouvements`, supabase/schema/20261120110100_association_paiements_assurance_maladie.sql),
// hors de la contrainte du seul rapprochement d'un mouvement (`lignes_bancaires_un_seul_rapprochement`).
//
// LES CANDIDATS d'un mouvement : un groupe de paiements non associés dont la somme fait son montant AU CENTIME — un paiement
// seul, ou la part obligatoire et la part complémentaire d'une même journée et d'un même organisme (ameli : le remboursement
// d'une journée est scindé en deux avis de crédit ; une banque peut n'en montrer qu'un) — et dont la journée comptable précède
// le mouvement de zéro à cinq jours (`JOURS_TOLERANCE_RAPPROCHEMENT`). Un net négatif (une régularisation plus forte que le
// paiement) se rapproche d'un débit, par la même égalité. Le troisième signal, la référence du virement (ses six derniers
// chiffres : AAMMJJ, la journée comptable — ameli, « en général »), ne fait jamais un candidat : il départage, et le lot
// l'exige.
//
// LA PROPOSITION (la fiche) : le seul candidat de plus haut rang (la référence en plus) ; à égalité, aucune (la règle de
// `FicheMouvement`). LE LOT : un mouvement qui n'a qu'un candidat, dont chaque paiement n'a que ce mouvement pour candidat, les
// trois signaux concordants (« valider automatiquement demande TROIS signaux ; un lot n'écrit que ce qui n'a qu'un candidat
// dans les DEUX sens »). RIEN NE S'ASSOCIE SANS CLIC : ce module propose, la fonction SQL écrit.
//
// HORS DE L'ASSOCIATION, comme la base le refuse : un mouvement écarté ou personnel (un remboursement du praticien comme
// assuré n'est pas une recette), un mouvement que la règle G2 retient (classé ou réservé par des encaissements de factures
// sources), un mouvement d'un exercice validé (l'association justifie le crédit : elle se fige avec son année).
//
// LES CONTRÔLES (des attentions, jamais bloquantes ; NOE6 les montrera dans la Vue d'ensemble et la Révision) : un crédit
// de l'assurance maladie — son libellé nomme un organisme de la liste fermée — sans paiement importé ; un écart, quand la
// référence d'un tel crédit désigne une journée dont les paiements ne font pas son montant ; un paiement importé sans
// crédit, par ancienneté ; une association qui ne se tient plus. MUET SUR UNE LECTURE PARTIELLE : une liste lue en partie,
// et rien ne se calcule (ni candidat, ni proposition, ni contrôle) — une proposition commanderait une écriture.

import { JOURS_TOLERANCE_RAPPROCHEMENT, libelleExploitable } from './appariementBanque'
import { formatDate } from './format'
import { LIBELLES_DES_PARTS, montantDit, organismeDit } from './paiementsAssuranceMaladieVue'
import type { LigneBancaire, PaiementAssuranceMaladie } from './types'

/** La migration de l'association (NOE5) est en production depuis le 20/11/2026 (collée, 247) : levé, le plan de sauvegarde
 *  porte la table et l'onglet Banque (NOE5b) la lit et l'écrit. Baissé (son état d'avant, que les tests jouent encore), rien
 *  ne la lisait ni ne l'écrivait. */
export const ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES = true

/** La journée comptable précède le crédit de zéro à cinq jours (conception 53, § 5 : à mesurer au premier relevé réel). */
export const JOURS_APRES_LA_JOURNEE = JOURS_TOLERANCE_RAPPROCHEMENT
/** Une référence ne désigne une journée, pour l'écart, que dans le mois qui précède le crédit. */
export const JOURS_DE_L_ECART = 31
/** Au plus, par appel de la fonction d'association (le lot compris). */
export const PAIRES_PAR_ASSOCIATION_MAX = 1000

export interface AssociationAssuranceMaladie {
  id: string
  dossier_id: string
  paiement_id: string
  ligne_bancaire_id: string
  associe_par: string
  associe_le: string
}

export type MouvementDuRapprochement = Pick<LigneBancaire, 'id' | 'date' | 'libelle' | 'libelle_brut' | 'montant' | 'statut'
  | 'prelevement_personnel' | 'encaissements_de_factures'>
export type PaiementDuRapprochement = Pick<PaiementAssuranceMaladie, 'id' | 'date_journee_comptable' | 'regime' | 'caisse'
  | 'organisme_complementaire' | 'part' | 'montant_centimes' | 'nombre_de_factures'>
export type AssociationDuRapprochement = Pick<AssociationAssuranceMaladie, 'paiement_id' | 'ligne_bancaire_id'>

/** Une liste et ce qu'on sait de sa lecture (la forme de `LectureComplete`). */
export interface ListeLue<T> {
  readonly lignes: readonly T[]
  readonly complete: boolean
}

export interface EntreeDuRapprochement {
  readonly mouvements: ListeLue<MouvementDuRapprochement>
  readonly paiements: ListeLue<PaiementDuRapprochement>
  readonly associations: ListeLue<AssociationDuRapprochement>
  /** Les mouvements que la règle G2 retient (classés ou réservés par des encaissements de factures sources), lus en entier ;
   * nul : illisibles, et le calcul se tait. Un dossier qui n'a pas basculé passe un ensemble vide. */
  readonly retenusParLesVentes: ReadonlySet<string> | null
  /** Les années que le cabinet a validées, lues en entier ; nul : illisibles. */
  readonly anneesValidees: ReadonlySet<number> | null
  /** Le jour de Paris (AAAA-MM-JJ) : l'ancienneté d'un paiement sans crédit. */
  readonly jour: string
}

export interface Candidat {
  readonly mouvementId: string
  /** Les paiements du groupe, dans l'ordre de leur identifiant. */
  readonly paiementIds: readonly string[]
  readonly journee: string
  /** Les jours entre la journée comptable et le mouvement (0 à 5). */
  readonly joursApres: number
  /** La référence du virement porte la journée comptable (AAMMJJ). */
  readonly reference: boolean
  /** Le nombre d'autres mouvements dont un paiement du groupe est aussi candidat. */
  readonly ailleurs: number
}

export type RaisonHorsDeLAssociation = 'ecarte' | 'personnel' | 'ventes' | 'fige'

export type EtatDUnMouvement =
  | { readonly genre: 'associe'; readonly paiementIds: readonly string[]; readonly paiementsCentimes: number; readonly coherent: boolean; readonly fige: boolean }
  | { readonly genre: 'propose'; readonly proposition: Candidat; readonly autres: readonly Candidat[] }
  | { readonly genre: 'a_egalite'; readonly candidats: readonly Candidat[] }
  | { readonly genre: 'hors'; readonly raison: RaisonHorsDeLAssociation }

export type ControleDuRapprochement =
  | { readonly genre: 'credit_sans_paiement'; readonly mouvementId: string; readonly date: string; readonly montantCentimes: number; readonly paiementsCesJoursLa: boolean }
  | { readonly genre: 'ecart'; readonly mouvementId: string; readonly date: string; readonly montantCentimes: number; readonly journee: string; readonly paiementsCentimes: number }
  | { readonly genre: 'paiement_sans_credit'; readonly paiementId: string; readonly journee: string; readonly montantCentimes: number; readonly ancienneteJours: number; readonly releveCouvre: boolean }
  | { readonly genre: 'association_incoherente'; readonly mouvementId: string; readonly date: string; readonly montantCentimes: number; readonly paiementsCentimes: number }
  | { readonly genre: 'association_contredite'; readonly mouvementId: string; readonly date: string; readonly raison: Exclude<RaisonHorsDeLAssociation, 'fige'> }

export interface RapprochementCalcule {
  readonly etat: 'calcule'
  /** Ce que la fiche d'un mouvement dit ; absent : rien à dire. */
  readonly parMouvement: ReadonlyMap<string, EtatDUnMouvement>
  /** Ce qu'un lot « Associer les concordances » écrirait, dans l'ordre des dates. */
  readonly concordances: readonly Candidat[]
  readonly controles: readonly ControleDuRapprochement[]
  readonly mouvementsParId: ReadonlyMap<string, MouvementDuRapprochement>
  readonly paiementsParId: ReadonlyMap<string, PaiementDuRapprochement>
  readonly paiementsAssocies: ReadonlySet<string>
  readonly mouvementsAssocies: ReadonlySet<string>
  readonly retenusParLesVentes: ReadonlySet<string>
  readonly anneesValidees: ReadonlySet<number>
}

export type Rapprochement = { readonly etat: 'muet'; readonly raison: string } | RapprochementCalcule

export const MUET: Readonly<Record<'releve' | 'paiements' | 'associations' | 'ventes' | 'exercices', string>> = {
  releve: 'Le relevé n’est pas lu en entier : aucun paiement de l’assurance maladie ne se propose ni ne se contrôle.',
  paiements: 'Les paiements de l’assurance maladie ne sont pas lus en entier : aucun ne se propose ni ne se contrôle.',
  associations: 'Les associations des paiements ne sont pas lues en entier : aucun paiement ne se propose ni ne se contrôle.',
  ventes: 'Les encaissements des factures ne sont pas lus en entier : aucun paiement ne se propose ni ne se contrôle.',
  exercices: 'Les exercices validés ne sont pas lus en entier : aucun paiement ne se propose ni ne se contrôle.',
}

// ── Les refus de la base, sous ses mots, dans son ordre (la migration préparée ; le test les y relit). ──
export const REFUS_DE_L_ASSOCIATION = {
  acces: 'Accès refusé à ce dossier.',
  forme: "L'association est mal formée : autant de paiements que de mouvements, chaque paiement une fois, de 1 à 1 000.",
  mouvementInconnu: "Un mouvement de l'association n'est pas un mouvement de ce dossier.",
  paiementInconnu: "Un paiement de l'association n'est pas un paiement de l'assurance maladie de ce dossier.",
  fige: "Un mouvement de l'association tombe dans un exercice que le cabinet a validé : il ne s'associe plus.",
  ecarte: "Un mouvement écarté ou classé en virement personnel ne justifie pas un paiement de l'assurance maladie.",
  ventes: "Un mouvement classé ou réservé par des encaissements de factures ne s'associe pas à un paiement de l'assurance maladie.",
  paiementDejaAssocie: "Un paiement de l'association est déjà associé à un mouvement : défaire d'abord cette association.",
  mouvementDejaAssocie: "Un mouvement de l'association est déjà associé à des paiements de l'assurance maladie : défaire d'abord son association.",
} as const

/** Le refus de la somme nomme le mouvement par sa date (JJ/MM/AAAA), jamais par son libellé. */
export const refusDeLaSomme = (date: string) =>
  `Les paiements associés au mouvement du ${formatDate(date)} ne font pas son montant au centime.`

export const REFUS_DU_RETRAIT_D_ASSOCIATION = {
  rien: "Ce mouvement n'est associé à aucun paiement de l'assurance maladie.",
  fige: 'Ce mouvement tombe dans un exercice que le cabinet a validé : son association ne se défait plus.',
} as const

/** Le retrait d'un import dont un paiement est associé (le déclencheur que la migration pose sur les imports). */
export const REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE =
  "Un paiement de cet import est associé à un crédit du relevé : le cabinet défait d'abord cette association."

// ── Les outils ──

/** Le numéro d'un jour civil (AAAA-MM-JJ), en entiers (l'algorithme « days from civil » de H. Hinnant) : une date civile
 * n'a pas de fuseau, et ce module ne lit aucune horloge. */
function numeroDuJour(iso: string): number {
  const m = Number(iso.slice(5, 7))
  const j = Number(iso.slice(8, 10))
  const a = Number(iso.slice(0, 4)) - (m <= 2 ? 1 : 0)
  const ere = Math.floor(a / 400)
  const anDeLEre = a - ere * 400
  const jourDeLAn = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + j - 1
  return ere * 146097 + anDeLEre * 365 + Math.floor(anDeLEre / 4) - Math.floor(anDeLEre / 100) + jourDeLAn - 719468
}
const JOURS_DES_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
function estUnJourDuCalendrier(a: number, m: number, j: number): boolean {
  const bissextile = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
  return m >= 1 && m <= 12 && j >= 1 && j <= (m === 2 && bissextile ? 29 : JOURS_DES_MOIS[m - 1])
}
const estUneDateCivile = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Le montant d'un mouvement en centimes, s'il en a au plus deux décimales ; nul sinon (jamais arrondi en silence). */
export function centimesDuMouvement(montant: number): number | null {
  if (!Number.isFinite(montant)) return null
  const centimes = Math.round(montant * 100)
  if (Math.abs(montant * 100 - centimes) > 1e-6 || !Number.isSafeInteger(centimes)) return null
  return centimes
}

/** Les organismes d'assurance maladie obligatoire que le libellé d'un crédit nomme, en mots entiers (une liste FERMÉE : un
 * mot hors d'elle ne fait rien reconnaître ; une mutuelle ne se reconnaît pas). */
export const MOTS_DE_L_ASSURANCE_MALADIE: readonly string[] = [
  'CPAM', 'CGSS', 'CNMSS', 'MSA', 'CAMIEG', 'ENIM', 'CRPCEN', 'CAVIMAC', 'AMELI', 'ASSURANCE MALADIE', 'CAISSE PRIMAIRE',
]

const motsDuLibelle = (texte: string) =>
  ` ${texte.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `

export function nommeLAssuranceMaladie(libelle: string): boolean {
  const mots = motsDuLibelle(libelle)
  return MOTS_DE_L_ASSURANCE_MALADIE.some((mot) => mots.includes(` ${mot} `))
}

/** Les journées comptables (AAAA-MM-JJ) que les références d'un libellé peuvent porter : les six derniers chiffres de chaque
 * suite d'au moins six chiffres, lus AAMMJJ quand c'est une date. */
export function journeesDesReferences(libelle: string): string[] {
  const journees: string[] = []
  for (const suite of libelle.match(/\d{6,}/g) ?? []) {
    const fin = suite.slice(-6)
    const a = 2000 + Number(fin.slice(0, 2))
    const iso = `${a}-${fin.slice(2, 4)}-${fin.slice(4, 6)}`
    if (estUnJourDuCalendrier(a, Number(fin.slice(2, 4)), Number(fin.slice(4, 6))) && !journees.includes(iso)) journees.push(iso)
  }
  return journees
}

/** Pourquoi un mouvement ne s'associe pas, comme la base le refuse ; nul s'il s'associe. */
export function raisonHorsDeLAssociation(m: MouvementDuRapprochement, retenus: ReadonlySet<string>,
  annees: ReadonlySet<number>): RaisonHorsDeLAssociation | null {
  if (estUneDateCivile(m.date) && annees.has(Number(m.date.slice(0, 4)))) return 'fige'
  if (m.statut === 'ignoree') return 'ecarte'
  if (m.prelevement_personnel) return 'personnel'
  if (m.encaissements_de_factures || retenus.has(m.id)) return 'ventes'
  return null
}

const parIdentifiant = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const ajouter = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const liste = m.get(k)
  if (liste) liste.push(v)
  else m.set(k, [v])
}

interface CandidatBrut {
  mouvementId: string
  paiementIds: string[]
  journee: string
  joursApres: number
  reference: boolean
}

// ── Le calcul ──

export function rapprocherLesPaiements(entree: EntreeDuRapprochement): Rapprochement {
  if (!entree.mouvements.complete) return { etat: 'muet', raison: MUET.releve }
  if (!entree.paiements.complete) return { etat: 'muet', raison: MUET.paiements }
  if (!entree.associations.complete) return { etat: 'muet', raison: MUET.associations }
  if (entree.retenusParLesVentes === null) return { etat: 'muet', raison: MUET.ventes }
  if (entree.anneesValidees === null) return { etat: 'muet', raison: MUET.exercices }
  const retenus = entree.retenusParLesVentes
  const annees = entree.anneesValidees

  const mouvementsParId = new Map(entree.mouvements.lignes.map((m) => [m.id, m]))
  const paiementsParId = new Map(entree.paiements.lignes.map((p) => [p.id, p]))
  const associesParMouvement = new Map<string, string[]>()
  const paiementsAssocies = new Set<string>()
  for (const a of entree.associations.lignes) {
    ajouter(associesParMouvement, a.ligne_bancaire_id, a.paiement_id)
    paiementsAssocies.add(a.paiement_id)
  }

  // Les signaux bon marché d'abord : les paiements libres indexés par leur montant (seuls, puis les deux parts d'une même
  // journée et d'un même organisme) ; un mouvement ne regarde que ceux de son montant exact.
  const seuls = new Map<number, PaiementDuRapprochement[]>()
  const paires = new Map<number, [PaiementDuRapprochement, PaiementDuRapprochement][]>()
  const partsParCle = new Map<string, { obligatoire?: PaiementDuRapprochement; complementaire?: PaiementDuRapprochement; ambigu?: boolean }>()
  const journeesLibres = new Map<string, PaiementDuRapprochement[]>()
  for (const p of entree.paiements.lignes) {
    if (paiementsAssocies.has(p.id) || p.montant_centimes === 0 || !estUneDateCivile(p.date_journee_comptable)) continue
    ajouter(seuls, p.montant_centimes, p)
    ajouter(journeesLibres, p.date_journee_comptable, p)
    if (p.part === 'forfait') continue
    const cle = `${p.date_journee_comptable}|${p.regime ?? 'nul'}|${p.caisse ?? 'nul'}`
    const parts = partsParCle.get(cle) ?? {}
    // Deux parts complémentaires d'une même journée et d'une même caisse — deux organismes complémentaires dits (la migration
    // de NOE3 amendée le 19/11/2026, BOR-Q5 (B)) — : la paire n'est plus une, aucune ne se propose pour cette clé (à égalité,
    // rien de proposé) ; chaque paiement reste candidat seul.
    if (parts[p.part] !== undefined) parts.ambigu = true
    parts[p.part] = p
    partsParCle.set(cle, parts)
  }
  for (const { obligatoire, complementaire, ambigu } of partsParCle.values()) {
    if (!ambigu && obligatoire && complementaire) {
      ajouter(paires, obligatoire.montant_centimes + complementaire.montant_centimes, [obligatoire, complementaire])
    }
  }

  const candidatsDe = (m: MouvementDuRapprochement, centimes: number): CandidatBrut[] => {
    const jourDuMouvement = numeroDuJour(m.date)
    const libelle = libelleExploitable(m)
    const resultat: CandidatBrut[] = []
    const essayer = (groupe: readonly PaiementDuRapprochement[]) => {
      const journee = groupe[0].date_journee_comptable
      const joursApres = jourDuMouvement - numeroDuJour(journee)
      if (joursApres < 0 || joursApres > JOURS_APRES_LA_JOURNEE) return
      const aammjj = journee.slice(2, 4) + journee.slice(5, 7) + journee.slice(8, 10)
      resultat.push({
        mouvementId: m.id, paiementIds: groupe.map((p) => p.id).sort(parIdentifiant), journee, joursApres,
        reference: (libelle.match(/\d{6,}/g) ?? []).some((suite) => suite.endsWith(aammjj)),
      })
    }
    for (const p of seuls.get(centimes) ?? []) essayer([p])
    for (const paire of paires.get(centimes) ?? []) essayer(paire)
    return resultat
  }

  const etats = new Map<string, EtatDUnMouvement>()
  const bruts = new Map<string, CandidatBrut[]>()
  const controles: ControleDuRapprochement[] = []
  const sansCandidat: { m: MouvementDuRapprochement; centimes: number }[] = []
  let dernierJourDuReleve = Number.NEGATIVE_INFINITY

  for (const m of entree.mouvements.lignes) {
    if (!estUneDateCivile(m.date)) continue
    dernierJourDuReleve = Math.max(dernierJourDuReleve, numeroDuJour(m.date))
    const raison = raisonHorsDeLAssociation(m, retenus, annees)
    const centimes = centimesDuMouvement(m.montant)
    const lies = associesParMouvement.get(m.id)
    if (lies) {
      const paiementsCentimes = lies.reduce((s, id) => s + (paiementsParId.get(id)?.montant_centimes ?? Number.NaN), 0)
      const coherent = centimes !== null && paiementsCentimes === centimes
      etats.set(m.id, { genre: 'associe', paiementIds: [...lies].sort(parIdentifiant), paiementsCentimes, coherent, fige: raison === 'fige' })
      if (!coherent && raison !== 'fige') {
        controles.push({ genre: 'association_incoherente', mouvementId: m.id, date: m.date, montantCentimes: centimes ?? Number.NaN, paiementsCentimes })
      }
      if (raison !== null && raison !== 'fige') controles.push({ genre: 'association_contredite', mouvementId: m.id, date: m.date, raison })
      continue
    }
    if (centimes === null || centimes === 0) continue
    const candidats = candidatsDe(m, centimes)
    if (raison !== null) {
      if (candidats.length > 0 || (centimes > 0 && nommeLAssuranceMaladie(libelleExploitable(m)))) etats.set(m.id, { genre: 'hors', raison })
      continue
    }
    if (candidats.length > 0) bruts.set(m.id, candidats)
    else if (centimes > 0) sansCandidat.push({ m, centimes })
  }

  // Les deux sens : les mouvements dont chaque paiement est candidat.
  const mouvementsParPaiement = new Map<string, Set<string>>()
  for (const [mouvementId, candidats] of bruts) {
    for (const c of candidats) {
      for (const id of c.paiementIds) {
        const ensemble = mouvementsParPaiement.get(id) ?? new Set<string>()
        ensemble.add(mouvementId)
        mouvementsParPaiement.set(id, ensemble)
      }
    }
  }

  const concordances: Candidat[] = []
  for (const [mouvementId, bruts1] of bruts) {
    const candidats: Candidat[] = bruts1.map((c) => {
      const autres = new Set<string>()
      for (const id of c.paiementIds) for (const autre of mouvementsParPaiement.get(id) ?? []) if (autre !== mouvementId) autres.add(autre)
      return { ...c, ailleurs: autres.size }
    }).sort((a, b) => Number(b.reference) - Number(a.reference) || a.journee.localeCompare(b.journee)
      || parIdentifiant(a.paiementIds.join(','), b.paiementIds.join(',')))
    const enTete = candidats.filter((c) => c.reference === candidats[0].reference)
    if (enTete.length === 1) etats.set(mouvementId, { genre: 'propose', proposition: candidats[0], autres: candidats.slice(1) })
    else etats.set(mouvementId, { genre: 'a_egalite', candidats })
    const seul = candidats.length === 1 ? candidats[0] : null
    if (seul && seul.reference && seul.ailleurs === 0
        && seul.paiementIds.every((id) => mouvementsParPaiement.get(id)?.size === 1)) concordances.push(seul)
  }
  concordances.sort((a, b) => (mouvementsParId.get(a.mouvementId)?.date ?? '').localeCompare(mouvementsParId.get(b.mouvementId)?.date ?? '')
    || parIdentifiant(a.mouvementId, b.mouvementId))

  // Les crédits de l'assurance maladie sans candidat : un écart quand la référence désigne une journée qui a des paiements
  // libres dans le mois, sinon un crédit sans paiement importé.
  for (const { m, centimes } of sansCandidat) {
    const libelle = libelleExploitable(m)
    if (!nommeLAssuranceMaladie(libelle)) continue
    const jourDuMouvement = numeroDuJour(m.date)
    const designee = journeesDesReferences(libelle).find((j) => {
      const d = jourDuMouvement - numeroDuJour(j)
      return d >= 0 && d <= JOURS_DE_L_ECART && journeesLibres.has(j)
    })
    if (designee) {
      const paiementsCentimes = (journeesLibres.get(designee) ?? []).reduce((s, p) => s + p.montant_centimes, 0)
      controles.push({ genre: 'ecart', mouvementId: m.id, date: m.date, montantCentimes: centimes, journee: designee, paiementsCentimes })
      continue
    }
    const paiementsCesJoursLa = entree.paiements.lignes.some((p) => {
      if (!estUneDateCivile(p.date_journee_comptable)) return false
      const d = jourDuMouvement - numeroDuJour(p.date_journee_comptable)
      return d >= 0 && d <= JOURS_APRES_LA_JOURNEE
    })
    controles.push({ genre: 'credit_sans_paiement', mouvementId: m.id, date: m.date, montantCentimes: centimes, paiementsCesJoursLa })
  }

  // Les paiements libres qu'aucun mouvement n'a pour candidat, par ancienneté.
  const jourDuCalcul = numeroDuJour(entree.jour)
  const sansCredit: ControleDuRapprochement[] = []
  for (const liste of journeesLibres.values()) {
    for (const p of liste) {
      if (mouvementsParPaiement.has(p.id)) continue
      const journee = numeroDuJour(p.date_journee_comptable)
      sansCredit.push({
        genre: 'paiement_sans_credit', paiementId: p.id, journee: p.date_journee_comptable, montantCentimes: p.montant_centimes,
        ancienneteJours: jourDuCalcul - journee, releveCouvre: dernierJourDuReleve >= journee + JOURS_APRES_LA_JOURNEE,
      })
    }
  }
  const dateDu = (c: ControleDuRapprochement) => (c.genre === 'paiement_sans_credit' ? c.journee : c.date)
  const identifiantDu = (c: ControleDuRapprochement) => (c.genre === 'paiement_sans_credit' ? c.paiementId : c.mouvementId)
  const tous = [...controles, ...sansCredit].sort((a, b) => dateDu(a).localeCompare(dateDu(b)) || parIdentifiant(identifiantDu(a), identifiantDu(b)))

  return {
    etat: 'calcule', parMouvement: etats, concordances, controles: tous, mouvementsParId, paiementsParId, paiementsAssocies,
    mouvementsAssocies: new Set(associesParMouvement.keys()), retenusParLesVentes: retenus, anneesValidees: annees,
  }
}

// ── Les refus de la base, dits avant le clic, sur l'association TELLE QU'ELLE PART ──

export interface GroupeAAssocier {
  readonly mouvementId: string
  readonly paiementIds: readonly string[]
}

/** Le premier refus que la fonction d'association opposerait à ces groupes, dans son ordre, ou nul. Le calcul est celui
 * de lectures faites en entier (un rapprochement muet ne propose rien, donc ne se juge pas ici). */
export function refusDeLAssociation(r: RapprochementCalcule, groupes: readonly GroupeAAssocier[]): string | null {
  const paires = groupes.flatMap((g) => g.paiementIds.map((p) => ({ mouvementId: g.mouvementId, paiementId: p })))
  if (paires.length < 1 || paires.length > PAIRES_PAR_ASSOCIATION_MAX
      || new Set(paires.map((p) => p.paiementId)).size !== paires.length) return REFUS_DE_L_ASSOCIATION.forme
  const mouvements = [...new Set(paires.map((p) => p.mouvementId))]
  if (mouvements.some((id) => !r.mouvementsParId.has(id))) return REFUS_DE_L_ASSOCIATION.mouvementInconnu
  if (paires.some((p) => !r.paiementsParId.has(p.paiementId))) return REFUS_DE_L_ASSOCIATION.paiementInconnu
  const raisons = mouvements.map((id) => raisonHorsDeLAssociation(r.mouvementsParId.get(id)!, r.retenusParLesVentes, r.anneesValidees))
  if (raisons.includes('fige')) return REFUS_DE_L_ASSOCIATION.fige
  if (raisons.includes('ecarte') || raisons.includes('personnel')) return REFUS_DE_L_ASSOCIATION.ecarte
  if (raisons.includes('ventes')) return REFUS_DE_L_ASSOCIATION.ventes
  if (paires.some((p) => r.paiementsAssocies.has(p.paiementId))) return REFUS_DE_L_ASSOCIATION.paiementDejaAssocie
  if (mouvements.some((id) => r.mouvementsAssocies.has(id))) return REFUS_DE_L_ASSOCIATION.mouvementDejaAssocie
  for (const id of [...mouvements].sort((a, b) => r.mouvementsParId.get(a)!.date.localeCompare(r.mouvementsParId.get(b)!.date) || parIdentifiant(a, b))) {
    const m = r.mouvementsParId.get(id)!
    const somme = paires.filter((p) => p.mouvementId === id).reduce((s, p) => s + r.paiementsParId.get(p.paiementId)!.montant_centimes, 0)
    if (somme !== centimesDuMouvement(m.montant)) return refusDeLaSomme(m.date)
  }
  return null
}

/** Le refus du retrait d'une association, dit avant le clic, ou nul. */
export function refusDuRetraitDAssociation(r: RapprochementCalcule, mouvementId: string): string | null {
  const m = r.mouvementsParId.get(mouvementId)
  if (!m) return REFUS_DE_L_ASSOCIATION.mouvementInconnu
  if (!r.mouvementsAssocies.has(mouvementId)) return REFUS_DU_RETRAIT_D_ASSOCIATION.rien
  if (estUneDateCivile(m.date) && r.anneesValidees.has(Number(m.date.slice(0, 4)))) return REFUS_DU_RETRAIT_D_ASSOCIATION.fige
  return null
}

// ── Les mots : des dates, des montants, des codes d'organisme ; jamais un libellé, jamais un nom ──

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/** Un groupe de paiements en mots : la journée comptable, l'organisme, les parts et le nombre de factures — jamais un nom. */
export function groupeDit(paiements: readonly PaiementDuRapprochement[]): string {
  const premier = paiements[0]
  const parts = paiements.map((p) => LIBELLES_DES_PARTS[p.part].toLowerCase()).join(' et ')
  const factures = paiements.reduce((s, p) => s + p.nombre_de_factures, 0)
  const complementaire = paiements.find((p) => p.organisme_complementaire !== null)?.organisme_complementaire
  return `journée comptable du ${formatDate(premier.date_journee_comptable)}, organisme ${organismeDit(premier.regime, premier.caisse)}`
    + `${complementaire === undefined ? '' : `, organisme complémentaire ${complementaire}`}, `
    + `${parts}${factures > 0 ? `, ${pluriel(factures, 'facture')}` : ''}`
}

/** La justification d'un candidat, signal par signal, et ce que la banque ne confirme pas. */
export function justificationDuCandidat(c: Candidat, paiementsParId: ReadonlyMap<string, PaiementDuRapprochement>): string {
  const paiements = c.paiementIds.map((id) => paiementsParId.get(id)).filter((p): p is PaiementDuRapprochement => p !== undefined)
  if (paiements.length !== c.paiementIds.length) return 'Un paiement de ce candidat n’est plus lu : relire la page.'
  const quand = c.joursApres === 0 ? 'crédité le jour même de la journée comptable'
    : `crédité ${pluriel(c.joursApres, 'jour')} après la journée comptable`
  const reference = c.reference ? 'la référence du virement porte la journée comptable'
    : 'la référence du virement ne porte pas la journée comptable (ameli : « en général » elle la porte)'
  const ailleurs = c.ailleurs > 0
    ? ` Un de ces paiements est aussi candidat ${c.ailleurs > 1 ? `de ${c.ailleurs} autres mouvements` : 'd’un autre mouvement'}.` : ''
  return `Paiement de l’assurance maladie — ${groupeDit(paiements)} : même montant au centime ; ${quand} ; ${reference}.${ailleurs}`
}

const RAISONS_DITES: Readonly<Record<RaisonHorsDeLAssociation, string>> = {
  ecarte: 'il est écarté',
  personnel: 'il est classé en virement personnel',
  ventes: 'il est classé ou réservé par des encaissements de factures',
  fige: 'il tombe dans un exercice validé',
}

/** Pourquoi la fiche d'un mouvement ne propose rien, en mots. */
export const horsDit = (raison: RaisonHorsDeLAssociation) =>
  `Ce mouvement ne s’associe pas à un paiement de l’assurance maladie : ${RAISONS_DITES[raison]}.`

export function controleDit(c: ControleDuRapprochement, paiementsParId: ReadonlyMap<string, PaiementDuRapprochement>): string {
  switch (c.genre) {
    case 'credit_sans_paiement':
      return `Crédit de l’assurance maladie du ${formatDate(c.date)} (${montantDit(c.montantCentimes)}) : aucun paiement importé ne le justifie — `
        + (c.paiementsCesJoursLa ? 'ceux de ces jours-là ne font pas son montant.' : 'aucun paiement importé de ces jours-là.')
        + ' S’il rembourse le praticien comme assuré, c’est un virement personnel.'
    case 'ecart':
      return c.paiementsCentimes === c.montantCentimes
        ? `Crédit de l’assurance maladie du ${formatDate(c.date)} (${montantDit(c.montantCentimes)}) : la référence du virement désigne la journée comptable du ${formatDate(c.journee)}, dont les paiements importés font ensemble son montant, sous une forme que la proposition ne fait pas.`
        : `Crédit de l’assurance maladie du ${formatDate(c.date)} (${montantDit(c.montantCentimes)}) : la référence du virement désigne la journée comptable du ${formatDate(c.journee)}, dont les paiements importés font ${montantDit(c.paiementsCentimes)} — un écart de ${montantDit(c.montantCentimes - c.paiementsCentimes)}.`
    case 'paiement_sans_credit': {
      const p = paiementsParId.get(c.paiementId)
      const quoi = p ? `${groupeDit([p])}, ${montantDit(c.montantCentimes)}` : montantDit(c.montantCentimes)
      return `Paiement de l’assurance maladie (${quoi}) : `
        + (c.releveCouvre ? `aucun mouvement du relevé ne fait son montant (journée comptable vieille de ${pluriel(c.ancienneteJours, 'jour')}).`
          : 'le relevé importé ne va pas encore jusqu’à la date où il devrait être crédité.')
    }
    case 'association_incoherente':
      return `Le mouvement du ${formatDate(c.date)} est associé à des paiements qui font ${Number.isNaN(c.paiementsCentimes) ? 'une somme illisible' : montantDit(c.paiementsCentimes)}, pas son montant : défaire l’association.`
    case 'association_contredite':
      return `Le mouvement du ${formatDate(c.date)} est associé à un paiement de l’assurance maladie, mais ${RAISONS_DITES[c.raison]} : défaire l’association, ou revoir son classement.`
  }
}
