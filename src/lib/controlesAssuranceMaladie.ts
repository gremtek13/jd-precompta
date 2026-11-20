// LES CONTRÔLES TIRÉS DES PAIEMENTS DE L'ASSURANCE MALADIE, ET LEUR CITATION DANS LA PISTE D'AUDIT (conception 53, § 5 « Ce
// que ça permet de contrôler » et § 10, lot NOE6 ; le récit : HISTORIQUE.md, « 20/11/2026 — NOE6 : LES CONTRÔLES DES PAIEMENTS
// DE L'ASSURANCE MALADIE ET LA PISTE D'AUDIT »). PUR : ni base, ni réseau, ni horloge — le jour vient de l'appelant.
//
// CE QUI SE CONTRÔLE (des ATTENTIONS, jamais bloquantes, hors des préalables de la validation) :
//   1. un crédit de l'assurance maladie (son libellé nomme un organisme de la liste fermée) qu'aucun paiement importé ne
//      justifie — dans la période d'un import, ou hors de toute période importée (le paiement n'est pas importé) ; et un
//      paiement importé qu'aucun crédit du relevé ne verse, quand le relevé va au-delà de la date où il devrait l'être ;
//      une association qui ne se tient plus (les paiements ne font plus le montant, ou le crédit est écarté, personnel, ou
//      classé par des encaissements de factures). Le calcul est celui du rapprochement (lib/rapprochementAssuranceMaladie.ts,
//      NOE5), jamais refait ici ;
//   2. sur chaque exercice que rien ne fige, le total des paiements associés contre les crédits de l'assurance maladie classés
//      en recette — LA FRONTIÈRE DU 31 DÉCEMBRE JUGÉE SUR LA DATE DU CRÉDIT, jamais sur la journée comptable (NOE-E2, et
//      l'expert-comptable le 17/11/2026 : la recette est à la date du crédit). Un crédit pas encore classé reste hors de la
//      confrontation (le point « lignes non rapprochées » le compte déjà) ;
//   3. le SNIR n'est PAS comparé (NOE-E1, « Ne pas comparer ») : l'écart attendu n'est pas établi.
//
// MUET SUR TOUTE LECTURE PARTIELLE : le relevé, les paiements, les associations, les imports, les ventes facturées d'un dossier
// basculé — une seule pas entière, et rien ne se dit (jamais « aucun écart » sur ce qu'on n'a pas lu). Les ventilations lues en
// partie ne taisent que la confrontation de l'exercice.
//
// OFFERTS SOUS LA RÈGLE DE LA SECTION (lib/sectionAssuranceMaladie.ts : un code NAF de santé ou de la liste fermée, ou un import
// déjà en base), le module « Paiements de l'assurance maladie » ouvert au cabinet, et les drapeaux de NOE3 et de NOE5 levés —
// derrière `CONTROLES_ASSURANCE_MALADIE_PREVUS`, que la session lève.
//
// LA PISTE D'AUDIT (NOE-Q7, NOE-E3 : « La piste d'audit seule ») : la colonne du justificatif d'une écriture d'un crédit
// associé, justifiée par le relevé, cite le paiement — « Paiement de l'assurance maladie du JJ/MM/AAAA, N factures » —, aucun
// nom, aucune référence, aucun organisme. LE FEC NE CHANGE PAS : aucun module du FEC ne lit celui-ci
// (controlesAssuranceMaladie.test.ts le relève).
//
// Aucun libellé du relevé ne sort d'ici : un libellé se lit pour reconnaître l'organisme, jamais ne se recopie dans un mot.

import { libelleExploitable } from './appariementBanque'
import { natureDuCompte } from './affectationBanque'
import { retenusParLesVentes } from './associationsAssuranceMaladieVue'
import { ACCES_SANS_OBJET } from './auteursVentes'
import { ajouterJours, formatDate } from './format'
import type { LectureComplete } from './lectureComplete'
import { ventesDuReleve, type LectureDesVentesDuReleve } from './mouvementsDesVentes'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from './paiementsAssuranceMaladie'
import { LIBELLES_DES_PARTS, montantDit } from './paiementsAssuranceMaladieVue'
import type { LignePisteAudit } from './pisteAudit'
import {
  ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES, JOURS_APRES_LA_JOURNEE, centimesDuMouvement, nommeLAssuranceMaladie,
  rapprocherLesPaiements, type AssociationDuRapprochement, type ControleDuRapprochement, type MouvementDuRapprochement,
  type PaiementDuRapprochement,
} from './rapprochementAssuranceMaladie'
import { sectionAssuranceMaladie, type ImportsDeLaSection } from './sectionAssuranceMaladie'
import type { Categorie, EcritureBrouillon, ImportAssuranceMaladie, LigneBancaire, VentilationBancaire } from './types'

/** Baissé : la Vue d'ensemble et la Révision ne lisent ni ne disent rien des paiements de l'assurance maladie, et la piste
 *  d'audit est celle d'hier, au caractère près. Levé par la session, avec la relecture de ce lot. */
export const CONTROLES_ASSURANCE_MALADIE_PREVUS = false

/** Les trois drapeaux ensemble : l'import (NOE3), l'association (NOE5), les contrôles (NOE6). */
export const controlesOfferts = (controles: boolean) =>
  controles && PAIEMENTS_ASSURANCE_MALADIE_PREVUS && ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES

/** Au plus, les éléments qu'un détail nomme ; le reste se compte. */
export const AU_PLUS = 6

// ── Ce que les contrôles lisent ──────────────────────────────────────────────────────────────────────────────────────────

/** La lecture des paiements (`PaiementsLus`, lib/paiementsAssuranceMaladieLecture.ts), sous la forme que ce module lit : il
 *  n'importe pas la lecture, et reste un module sans base. Nul : les drapeaux baissés, rien de lu. */
export type LectureDesControles =
  | { readonly etat: 'echec'; readonly motif: string }
  | { readonly etat: 'sans_banque' }
  | {
    readonly etat: 'lus'
    readonly imports: LectureComplete<Pick<ImportAssuranceMaladie, 'periode_du' | 'periode_au'>>
    readonly paiements: LectureComplete<PaiementDuRapprochement>
    readonly associations: LectureComplete<AssociationDuRapprochement> | null
  }

/** Ce que l'écran sait de l'offre : le code NAF lu (`undefined` tant qu'il ne l'est pas) et le module du cabinet. */
export interface OffreDeLAssuranceMaladie {
  readonly codeNaf: string | null | undefined
  readonly moduleOuvert: boolean
}

/** Un mouvement du relevé, et ce qui dit son classement. */
export type MouvementControle = MouvementDuRapprochement & Pick<LigneBancaire, 'piece_id' | 'categorie_id' | 'ventilee'
  | 'cotisation_id' | 'emprunt_id' | 'compte_bilan' | 'declaration_tva_id' | 'reglement_groupe'>

export interface EntreeDesControles {
  readonly drapeau: boolean
  readonly offre: OffreDeLAssuranceMaladie
  readonly lu: LectureDesControles | null
  readonly releve: { readonly lignes: readonly MouvementControle[]; readonly complete: boolean }
  /** Les mouvements que la règle G2 retient (`retenusDeLaChecklist`) ; nul : illisibles. */
  readonly retenusParLesVentes: ReadonlySet<string> | null
  readonly categories: readonly Pick<Categorie, 'id' | 'compte_comptable'>[]
  readonly ventilations: { readonly lignes: readonly Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id' | 'part_personnelle'>[]; readonly complete: boolean }
  readonly anneesValidees: readonly number[]
  /** Le jour de Paris (AAAA-MM-JJ). */
  readonly jour: string
}

/** Les mouvements que la règle G2 retient, depuis la lecture des ventes facturées de la Vue d'ensemble : un dossier qui n'a
 *  pas basculé n'en retient aucun ; lue en partie, ou d'un autre dossier, nul. */
export function retenusDeLaChecklist(lecture: LectureDesVentesDuReleve | null): ReadonlySet<string> | null {
  if (lecture === null) return new Set()
  if (lecture.etat === 'incomplete') return null
  return retenusParLesVentes(ventesDuReleve(true, lecture.dossierId, lecture, ACCES_SANS_OBJET))
}

// ── Ce que les contrôles rendent ─────────────────────────────────────────────────────────────────────────────────────────

/** Un crédit nommé par sa date et son montant, jamais par son libellé. */
export interface CreditDit { readonly mouvementId: string; readonly date: string; readonly montantCentimes: number }

/** La confrontation d'un exercice (le contrôle 2) : ses deux totaux, et ce qui les sépare. */
export interface ConfrontationDeLExercice {
  readonly annee: number
  readonly paiementsAssociesCentimes: number
  readonly creditsEnRecetteCentimes: number
  /** Des crédits associés classés hors des recettes. */
  readonly associesHorsRecette: readonly CreditDit[]
  /** Des crédits de l'assurance maladie classés en recette sans paiement associé. */
  readonly enRecetteSansPaiement: readonly CreditDit[]
  /** Des crédits associés dont les paiements ne font pas le montant. */
  readonly associesEnEcart: readonly CreditDit[]
  /** Des crédits associés pas encore classés, hors de la confrontation. */
  readonly associesAClasser: number
}

export interface ControlesCalcules {
  readonly etat: 'calcules'
  /** Dans la période d'un import, ou désignant une journée importée : aucun paiement ne fait leur montant. */
  readonly creditsSansPaiement: readonly Extract<ControleDuRapprochement, { genre: 'credit_sans_paiement' | 'ecart' }>[]
  /** Hors de toute période importée : leur paiement n'est pas importé. */
  readonly creditsHorsDesImports: readonly Extract<ControleDuRapprochement, { genre: 'credit_sans_paiement' }>[]
  readonly paiementsSansCredit: readonly Extract<ControleDuRapprochement, { genre: 'paiement_sans_credit' }>[]
  readonly associationsARevoir: readonly Extract<ControleDuRapprochement, { genre: 'association_incoherente' | 'association_contredite' }>[]
  /** Nul : les ventilations lues en partie, la confrontation se tait. */
  readonly exercicesEnEcart: readonly ConfrontationDeLExercice[] | null
}

export type ControlesDeLAssuranceMaladie =
  | { readonly etat: 'sans_objet' }
  | { readonly etat: 'muet'; readonly raison: string }
  | ControlesCalcules

const SANS_OBJET = { etat: 'sans_objet' } as const

/** L'état des imports, pour la règle de la section : une ligne lue en prouve un ; une liste vide ne dit « aucun » qu'entière. */
function importsDe(lu: LectureDesControles | null): ImportsDeLaSection {
  if (lu === null || lu.etat !== 'lus') return 'inconnu'
  if (lu.imports.lignes.length > 0) return 'au-moins-un'
  return lu.imports.complete ? 'aucun' : 'inconnu'
}

/** Le classement d'un crédit, pour la confrontation : `recette`, `hors_recette`, `a_classer` (pas encore rapproché), ou
 *  `non_juge` — rapproché d'une pièce (la pièce décide), écarté, personnel, classé par des encaissements (le point des
 *  associations à revoir le dit), ou une catégorie ou une ventilation qu'on n'a pas lue. */
export type ClassementDuCredit = 'recette' | 'hors_recette' | 'a_classer' | 'non_juge'

export function classementDuCredit(m: MouvementControle,
  categories: ReadonlyMap<string, Pick<Categorie, 'compte_comptable'>>,
  ventilations: ReadonlyMap<string, readonly Pick<VentilationBancaire, 'categorie_id' | 'part_personnelle'>[]>): ClassementDuCredit {
  if (m.statut === 'ignoree' || m.prelevement_personnel || m.encaissements_de_factures) return 'non_juge'
  if (m.statut !== 'rapprochee') return 'a_classer'
  if (m.piece_id) return 'non_juge'
  if (m.categorie_id) {
    const c = categories.get(m.categorie_id)
    if (!c) return 'non_juge'
    return natureDuCompte(c.compte_comptable) === 'recette' ? 'recette' : 'hors_recette'
  }
  if (m.ventilee) {
    const parts = ventilations.get(m.id) ?? []
    if (parts.length === 0) return 'non_juge'
    let toutesRecettes = true
    for (const p of parts) {
      if (p.part_personnelle || !p.categorie_id) { toutesRecettes = false; continue }
      const c = categories.get(p.categorie_id)
      if (!c) return 'non_juge'
      if (natureDuCompte(c.compte_comptable) !== 'recette') toutesRecettes = false
    }
    return toutesRecettes ? 'recette' : 'hors_recette'
  }
  if (m.cotisation_id || m.emprunt_id || m.compte_bilan || m.declaration_tva_id || m.reglement_groupe) return 'hors_recette'
  return 'non_juge'
}

const anneeDe = (date: string) => Number(date.slice(0, 4))

export function controlesDeLAssuranceMaladie(e: EntreeDesControles): ControlesDeLAssuranceMaladie {
  if (!controlesOfferts(e.drapeau) || e.lu === null || !e.offre.moduleOuvert) return SANS_OBJET
  if (!sectionAssuranceMaladie(e.offre.codeNaf, importsDe(e.lu)).offerte) return SANS_OBJET
  const lu = e.lu
  if (lu.etat === 'echec') return { etat: 'muet', raison: `Les paiements de l’assurance maladie ne se lisent pas (${lu.motif}) : aucun ne se contrôle.` }
  if (lu.etat === 'sans_banque') return SANS_OBJET
  if (!lu.imports.complete) return { etat: 'muet', raison: 'Les imports des paiements de l’assurance maladie ne sont pas lus en entier : aucun ne se contrôle.' }
  const r = rapprocherLesPaiements({
    mouvements: { lignes: e.releve.lignes, complete: e.releve.complete },
    paiements: lu.paiements,
    associations: lu.associations ?? { lignes: [], complete: false },
    retenusParLesVentes: e.retenusParLesVentes,
    anneesValidees: new Set(e.anneesValidees),
    jour: e.jour,
  })
  if (r.etat === 'muet') return r
  const validees = new Set(e.anneesValidees)

  // Le contrôle 1 : le crédit sans paiement, dans la période d'un import ou hors de toute ; le paiement sans crédit quand le
  // relevé va au-delà de sa date, hors des exercices que rien ne rouvre (tous ses crédits possibles y tombent).
  const periodes = lu.imports.lignes.map((i) => ({ du: i.periode_du, au: ajouterJours(i.periode_au, JOURS_APRES_LA_JOURNEE) }))
  const dansUnImport = (date: string) => periodes.some((p) => p.du <= date && date <= p.au)
  const creditsSansPaiement: ControlesCalcules['creditsSansPaiement'][number][] = []
  const creditsHorsDesImports: ControlesCalcules['creditsHorsDesImports'][number][] = []
  const paiementsSansCredit: ControlesCalcules['paiementsSansCredit'][number][] = []
  const associationsARevoir: ControlesCalcules['associationsARevoir'][number][] = []
  for (const c of r.controles) {
    switch (c.genre) {
      case 'credit_sans_paiement':
        if (dansUnImport(c.date)) creditsSansPaiement.push(c)
        else creditsHorsDesImports.push(c)
        break
      case 'ecart':
        creditsSansPaiement.push(c)
        break
      case 'paiement_sans_credit':
        if (c.releveCouvre && !(validees.has(anneeDe(c.journee)) && validees.has(anneeDe(ajouterJours(c.journee, JOURS_APRES_LA_JOURNEE))))) {
          paiementsSansCredit.push(c)
        }
        break
      case 'association_incoherente':
      case 'association_contredite':
        associationsARevoir.push(c)
        break
    }
  }

  // Le contrôle 2 : exercice par exercice (l'année du CRÉDIT), hors des exercices validés.
  let exercicesEnEcart: ConfrontationDeLExercice[] | null = null
  if (e.ventilations.complete) {
    const categories = new Map(e.categories.map((c) => [c.id, c]))
    const ventilations = new Map<string, Pick<VentilationBancaire, 'categorie_id' | 'part_personnelle'>[]>()
    for (const v of e.ventilations.lignes) ventilations.set(v.ligne_bancaire_id, [...(ventilations.get(v.ligne_bancaire_id) ?? []), v])
    type Cumul = { a: number; b: number; horsRecette: CreditDit[]; sansPaiement: CreditDit[]; enEcart: CreditDit[]; aClasser: number; illisible: boolean }
    const parAnnee = new Map<number, Cumul>()
    const cumulDe = (annee: number) => {
      let c = parAnnee.get(annee)
      if (!c) { c = { a: 0, b: 0, horsRecette: [], sansPaiement: [], enEcart: [], aClasser: 0, illisible: false }; parAnnee.set(annee, c) }
      return c
    }
    for (const m of e.releve.lignes) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || validees.has(anneeDe(m.date))) continue
      const centimes = centimesDuMouvement(m.montant)
      if (centimes === null || centimes <= 0) continue
      const etat = r.parMouvement.get(m.id)
      const associe = etat?.genre === 'associe' ? etat : null
      if (associe === null && !nommeLAssuranceMaladie(libelleExploitable(m))) continue
      const classement = classementDuCredit(m, categories, ventilations)
      if (classement === 'non_juge') continue
      const dit: CreditDit = { mouvementId: m.id, date: m.date, montantCentimes: centimes }
      if (classement === 'a_classer') {
        if (associe) cumulDe(anneeDe(m.date)).aClasser += 1
        continue
      }
      const cumul = cumulDe(anneeDe(m.date))
      if (associe) {
        if (!Number.isFinite(associe.paiementsCentimes)) { cumul.illisible = true; continue }
        cumul.a += associe.paiementsCentimes
        if (!associe.coherent) cumul.enEcart.push(dit)
        if (classement === 'hors_recette') cumul.horsRecette.push(dit)
      } else if (classement === 'recette') {
        cumul.sansPaiement.push(dit)
      }
      if (classement === 'recette') cumul.b += centimes
    }
    exercicesEnEcart = [...parAnnee.entries()]
      .filter(([, c]) => !c.illisible && c.a !== c.b)
      .sort(([a], [b]) => a - b)
      .map(([annee, c]) => ({
        annee, paiementsAssociesCentimes: c.a, creditsEnRecetteCentimes: c.b, associesHorsRecette: c.horsRecette,
        enRecetteSansPaiement: c.sansPaiement, associesEnEcart: c.enEcart, associesAClasser: c.aClasser,
      }))
  }

  return { etat: 'calcules', creditsSansPaiement, creditsHorsDesImports, paiementsSansCredit, associationsARevoir, exercicesEnEcart }
}

// ── Les mots des points : des dates et des montants, jamais un libellé, jamais un nom ────────────────────────────────────

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`

/** Une liste nommée, au plus `AU_PLUS` éléments, le reste compté. */
function enumeres(elements: readonly string[]): string {
  const cites = elements.slice(0, AU_PLUS).join(', ')
  const reste = elements.length - AU_PLUS
  return reste > 0 ? `${cites} et ${pluriel(reste, 'autre')}` : cites
}

const creditDit = (c: { date: string; montantCentimes: number }) => `${formatDate(c.date)} (${montantDit(c.montantCentimes)})`

export const LIBELLE_CREDITS_SANS_PAIEMENT =
  'crédit(s) de l’assurance maladie, dans la période d’un import, qu’aucun paiement importé ne justifie'
export const LIBELLE_CREDITS_HORS_DES_IMPORTS =
  'crédit(s) de l’assurance maladie hors des périodes importées — leurs paiements ne sont pas importés'
export const LIBELLE_PAIEMENTS_SANS_CREDIT =
  'paiement(s) de l’assurance maladie importé(s) qu’aucun crédit du relevé ne verse — un virement manquant, ou un relevé incomplet'
export const LIBELLE_ASSOCIATIONS_A_REVOIR = 'association(s) d’un crédit à des paiements de l’assurance maladie qui ne se tiennent plus'
export const LIBELLE_EXERCICES_EN_ECART =
  'exercice(s) où les paiements de l’assurance maladie associés ne font pas les crédits de l’assurance maladie classés en recette'

export function detailDesCreditsSansPaiement(c: ControlesCalcules): string | undefined {
  if (c.creditsSansPaiement.length === 0) return undefined
  return `Les crédits du ${enumeres(c.creditsSansPaiement.map(creditDit))}. Dans Banque, la fiche du crédit dit ce que les `
    + 'paiements importés de ces jours-là font. S’il rembourse le praticien comme assuré, c’est un virement personnel.'
}

export function detailDesCreditsHorsDesImports(c: ControlesCalcules): string | undefined {
  if (c.creditsHorsDesImports.length === 0) return undefined
  return `Les crédits du ${enumeres(c.creditsHorsDesImports.map(creditDit))}. Les paiements de ces jours-là s’importent `
    + 'dans Banque, section « Paiements de l’assurance maladie ».'
}

export function detailDesPaiementsSansCredit(c: ControlesCalcules): string | undefined {
  if (c.paiementsSansCredit.length === 0) return undefined
  const dits = [...c.paiementsSansCredit].sort((a, b) => b.ancienneteJours - a.ancienneteJours)
    .map((p) => `${formatDate(p.journee)} (${montantDit(p.montantCentimes)}, il y a ${pluriel(p.ancienneteJours, 'jour')})`)
  return `Les journées comptables du ${enumeres(dits)}, les plus anciennes d’abord. Un mois du relevé manque peut-être ; `
    + 'sinon, le virement n’est pas arrivé.'
}

export function detailDesAssociationsARevoir(c: ControlesCalcules): string | undefined {
  if (c.associationsARevoir.length === 0) return undefined
  const dits = c.associationsARevoir.map((a) => a.genre === 'association_incoherente'
    ? `${formatDate(a.date)} (les paiements ne font plus son montant)`
    : `${formatDate(a.date)} (${a.raison === 'ventes' ? 'classé par des encaissements de factures' : a.raison === 'personnel' ? 'classé en virement personnel' : 'écarté'})`)
  return `Les crédits du ${enumeres(dits)}. Dans Banque, la fiche du crédit défait l’association.`
}

export function detailDesExercicesEnEcart(c: ControlesCalcules): string | undefined {
  const ecarts = c.exercicesEnEcart ?? []
  if (ecarts.length === 0) return undefined
  return ecarts.map((x) => {
    const causes = [
      x.associesHorsRecette.length > 0 ? `associés mais classés hors des recettes : ${enumeres(x.associesHorsRecette.map(creditDit))}` : null,
      x.enRecetteSansPaiement.length > 0 ? `classés en recette sans paiement associé : ${enumeres(x.enRecetteSansPaiement.map(creditDit))}` : null,
      x.associesEnEcart.length > 0 ? `associés à des paiements qui ne font pas leur montant : ${enumeres(x.associesEnEcart.map(creditDit))}` : null,
    ].filter((t): t is string => t !== null)
    const aClasser = x.associesAClasser > 0
      ? ` ${x.associesAClasser > 1 ? `${x.associesAClasser} crédits associés, pas encore classés, restent` : 'Un crédit associé, pas encore classé, reste'} hors de la confrontation.`
      : ''
    return `Exercice ${x.annee} (à la date du crédit) : paiements associés ${montantDit(x.paiementsAssociesCentimes)}, crédits de `
      + `l’assurance maladie classés en recette ${montantDit(x.creditsEnRecetteCentimes)}${causes.length > 0 ? ` — crédits ${causes.join(' ; ')}` : ''}.${aClasser}`
  }).join(' ')
}

/** Les nombres des cinq points, zéro hors d'un calcul (sans objet ou muet : la lecture partielle se dit ailleurs). */
export function nombresDesControles(c: ControlesDeLAssuranceMaladie) {
  if (c.etat !== 'calcules') return { creditsSansPaiement: 0, creditsHorsDesImports: 0, paiementsSansCredit: 0, associationsARevoir: 0, exercicesEnEcart: 0 }
  return {
    creditsSansPaiement: c.creditsSansPaiement.length, creditsHorsDesImports: c.creditsHorsDesImports.length,
    paiementsSansCredit: c.paiementsSansCredit.length, associationsARevoir: c.associationsARevoir.length,
    exercicesEnEcart: c.exercicesEnEcart?.length ?? 0,
  }
}

// ── La piste d'audit ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ce que la piste cite d'un crédit associé : la journée comptable et le nombre de factures de chaque part, rien d'autre —
 *  ni l'organisme, ni la référence du virement. */
export function citationDesPaiements(paiements: readonly Pick<PaiementDuRapprochement, 'date_journee_comptable' | 'part' | 'nombre_de_factures'>[]): string {
  const parJournee = new Map<string, typeof paiements[number][]>()
  for (const p of paiements) parJournee.set(p.date_journee_comptable, [...(parJournee.get(p.date_journee_comptable) ?? []), p])
  const journees = [...parJournee.keys()].sort()
  const dits = journees.map((j) => {
    const parts = [...parJournee.get(j)!].sort((a, b) => a.part.localeCompare(b.part))
    if (parts.length === 1) {
      const n = parts[0].nombre_de_factures
      return `du ${formatDate(j)}${n > 0 ? `, ${pluriel(n, 'facture')}` : ''}`
    }
    return `du ${formatDate(j)}, ${parts.map((p) => `${LIBELLES_DES_PARTS[p.part].toLowerCase()}${p.nombre_de_factures > 0 ? ` (${pluriel(p.nombre_de_factures, 'facture')})` : ''}`).join(' et ')}`
  })
  return `${paiements.length > 1 ? 'Paiements' : 'Paiement'} de l’assurance maladie ${dits.join(' ; ')}`
}

export type CitationsDeLaPiste =
  | { readonly etat: 'sans_objet' }
  | { readonly etat: 'refusee'; readonly motif: string }
  | { readonly etat: 'lues'; readonly parMouvement: ReadonlyMap<string, string> }

/** Les citations de chaque crédit associé, d'une lecture faite au clic de l'export. Les drapeaux baissés ou le module fermé
 *  (la base refuse de le fermer tant qu'un paiement est associé) : sans objet, la piste d'hier. Une lecture qui ne revient
 *  pas en entier : refusée — deux exports du même brouillon diraient autre chose. */
export function citationsDeLaPiste(drapeau: boolean, moduleOuvert: boolean, lu: LectureDesControles | null): CitationsDeLaPiste {
  if (!controlesOfferts(drapeau) || !moduleOuvert || lu === null) return { etat: 'sans_objet' }
  if (lu.etat === 'echec') return { etat: 'refusee', motif: lu.motif }
  if (lu.etat === 'sans_banque') return { etat: 'refusee', motif: 'l’accès à la banque n’est pas ouvert' }
  if (!lu.paiements.complete) return { etat: 'refusee', motif: lu.paiements.motif ?? 'les paiements ne sont pas lus en entier' }
  if (lu.associations === null || !lu.associations.complete) {
    return { etat: 'refusee', motif: lu.associations?.motif ?? 'les associations ne sont pas lues en entier' }
  }
  const paiements = new Map(lu.paiements.lignes.map((p) => [p.id, p]))
  const parMouvement = new Map<string, PaiementDuRapprochement[]>()
  for (const a of lu.associations.lignes) {
    const p = paiements.get(a.paiement_id)
    if (!p) return { etat: 'refusee', motif: 'une association cite un paiement qui n’est pas lu' }
    parMouvement.set(a.ligne_bancaire_id, [...(parMouvement.get(a.ligne_bancaire_id) ?? []), p])
  }
  return { etat: 'lues', parMouvement: new Map([...parMouvement].map(([id, ps]) => [id, citationDesPaiements(ps)])) }
}

/** La piste, la colonne du justificatif de chaque écriture d'un crédit associé justifiée par le RELEVÉ (sans pièce) complétée
 *  de sa citation. Rien d'autre ne change : ni une ligne, ni un montant, ni l'ordre — et le FEC ne lit pas ceci. */
export function citerLesPaiementsDansLaPiste(lignes: readonly LignePisteAudit[],
  ecritures: readonly Pick<EcritureBrouillon, 'id' | 'ligne_bancaire_id'>[], citations: CitationsDeLaPiste): LignePisteAudit[] {
  if (citations.etat !== 'lues' || citations.parMouvement.size === 0) return [...lignes]
  const mouvementDe = new Map(ecritures.map((e) => [e.id, e.ligne_bancaire_id]))
  return lignes.map((l) => {
    if (l.ecritureId === null || l.pieceId !== null || l.pieceFichier === null) return l
    const mouvement = mouvementDe.get(l.ecritureId)
    const citation = mouvement ? citations.parMouvement.get(mouvement) : undefined
    return citation ? { ...l, pieceFichier: `${l.pieceFichier} — ${citation}` } : l
  })
}
