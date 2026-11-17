// L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ, À L'ÉCRAN (conception 53, lot NOE5b ; le récit :
// HISTORIQUE.md, « 17/11/2026 — NOE5B : L'ÉCRAN DE L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE »). PUR : ce que la
// fiche d'un crédit et la section NOEMIE de l'onglet Banque montrent, et leurs mots ; le calcul est celui de
// lib/rapprochementAssuranceMaladie.ts, la lecture celle de lib/paiementsAssuranceMaladieLecture.ts.
//
// LA RÈGLE DE L'ÉCRAN : le cabinet seul associe et défait (la base le tient : 42501 à tout autre) ; rien ne s'associe sans
// clic ; à égalité, rien n'est proposé ; une lecture partielle — le relevé, les paiements, les associations, les ventes
// facturées ou les exercices — rend le calcul muet, et l'écran le dit sans offrir aucun geste. L'association ne classe pas
// le crédit : il se classe en recette comme tout crédit, et l'écran le dit. Aucun libellé du relevé ne se recopie dans un mot.

import { libelleExploitable } from './appariementBanque'
import type { EspaceVentes } from './espaceVentes'
import { formatDate } from './format'
import type { LectureComplete } from './lectureComplete'
import type { VentesDuReleve } from './mouvementsDesVentes'
import { montantDit } from './paiementsAssuranceMaladieVue'
import {
  REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE, centimesDuMouvement, groupeDit, nommeLAssuranceMaladie, rapprocherLesPaiements,
  type AssociationAssuranceMaladie, type Candidat, type EtatDUnMouvement, type MouvementDuRapprochement,
  type PaiementDuRapprochement, type Rapprochement, type RapprochementCalcule,
} from './rapprochementAssuranceMaladie'
import type { LigneBancaire } from './types'

/** Tant que les paiements de l'assurance maladie et leurs associations ne sont pas revenus. */
export const EN_LECTURE = 'Les paiements de l’assurance maladie et leurs associations ne sont pas encore lus : aucun ne se propose.'

/** Ce que la fiche d'un crédit associé ou proposé dit de son classement (la conception 53, § 5). */
export const RESTE_CLASSABLE = 'L’association justifie ce crédit et le contrôle ; elle ne le classe pas. Il se classe en recette '
  + 'comme tout crédit, et son classement ne défait pas l’association : la recette reste le crédit, à sa date.'

export const A_EGALITE_DIT = 'Plusieurs paiements de l’assurance maladie font ce montant avec les mêmes signaux : aucun n’est '
  + 'proposé. Si l’un d’eux est bien celui que ce crédit verse, le choisir à la main.'

export const AUTRES_DIT = 'D’autres paiements font aussi ce montant, avec moins de signaux :'

export const AUCUN_CONTROLE = 'Aucun écart entre les paiements importés et le relevé.'

export const AUCUNE_CONCORDANCE = 'Aucun crédit ne concorde seul avec un paiement sur les trois signaux : rien ne s’associe en lot. '
  + 'Chaque fiche de crédit propose ce qu’elle peut.'

/** Ce que la lecture des paiements rend (`PaiementsLus`, lib/paiementsAssuranceMaladieLecture.ts), sous la forme que ce
 * module lit : il n'importe pas la lecture, et reste un module sans base. */
export type LectureDesPaiements =
  | { readonly etat: 'echec'; readonly motif: string }
  | { readonly etat: 'sans_banque' }
  | {
    readonly etat: 'lus'
    readonly paiements: LectureComplete<PaiementDuRapprochement>
    readonly associations: LectureComplete<AssociationAssuranceMaladie> | null
  }

// ── Ce que l'écran calcule ───────────────────────────────────────────────────────────────────────────────────────────────

/** L'état du relevé que l'onglet Banque passe : ses mouvements, et s'ils sont lus en entier (ni lecture en vol, ni coupée). */
export interface ReleveDeLOnglet {
  readonly lignes: readonly MouvementDuRapprochement[]
  readonly complet: boolean
}

/** Les mouvements que la règle G2 retient, d'après ce que l'onglet sait de ses ventes : un dossier qui n'a pas basculé n'en
 * retient aucun ; des ventes pas encore lues, lues en partie ou refusées : nul (le calcul se tait). */
export function retenusParLesVentes(ventes: VentesDuReleve): ReadonlySet<string> | null {
  if (ventes.etat === 'sans_objet') return new Set()
  if (ventes.etat === 'lue') return new Set(ventes.mouvements.keys())
  return null
}

/**
 * Le rapprochement de l'onglet Banque. Nul : le drapeau de l'association baissé — rien à dire, rien de lu. Muet : une des
 * lectures n'est pas revenue ou pas entière (le module dit laquelle).
 */
export function rapprochementDeLOnglet(drapeau: boolean, lu: LectureDesPaiements | null, releve: ReleveDeLOnglet,
  ventes: VentesDuReleve, anneesValidees: readonly number[], jour: string): Rapprochement | null {
  if (!drapeau) return null
  if (lu === null) return { etat: 'muet', raison: EN_LECTURE }
  if (lu.etat === 'echec') return { etat: 'muet', raison: `Les paiements de l’assurance maladie ne se lisent pas (${lu.motif}) : aucun ne se propose ni ne se contrôle.` }
  if (lu.etat === 'sans_banque') return { etat: 'muet', raison: EN_LECTURE }
  const associations: LectureComplete<AssociationAssuranceMaladie> = lu.associations
    ?? { lignes: [], complete: false, motif: 'les associations ne sont pas lues' }
  return rapprocherLesPaiements({
    mouvements: { lignes: releve.lignes, complete: releve.complet },
    paiements: lu.paiements,
    associations,
    retenusParLesVentes: retenusParLesVentes(ventes),
    anneesValidees: new Set(anneesValidees),
    jour,
  })
}

/**
 * Les crédits associés à un paiement de l'assurance maladie, que les candidats d'une vente facturée écartent (NOE5-Q4 (A) :
 * à l'écran). Drapeau baissé : aucun — la table n'existe pas. Levé : ceux des associations lues en entier ; sinon nul, et
 * les candidats de la vente se taisent (`candidatsDeLaVente`).
 */
export function associesPourLesVentes(drapeau: boolean, lu: LectureDesPaiements | null): ReadonlySet<string> | null {
  if (!drapeau) return new Set()
  if (lu === null || lu.etat !== 'lus' || lu.associations === null || !lu.associations.complete) return null
  return new Set(lu.associations.lignes.map((a) => a.ligne_bancaire_id))
}

/** Ce que la fiche d'un mouvement montre : rien, la lecture muette (sur un crédit que son libellé dit de l'assurance maladie
 * seulement), ou l'état du module. */
export type AssuranceMaladieDeLaFiche =
  | { readonly genre: 'rien' }
  | { readonly genre: 'muet'; readonly raison: string }
  | { readonly genre: 'etat'; readonly mouvementId: string; readonly etat: EtatDUnMouvement; readonly rapprochement: RapprochementCalcule }

export function assuranceMaladieDeLaFiche(r: Rapprochement | null,
  ligne: Pick<LigneBancaire, 'id' | 'montant' | 'libelle' | 'libelle_brut'>): AssuranceMaladieDeLaFiche {
  if (r === null) return { genre: 'rien' }
  if (r.etat === 'muet') {
    return ligne.montant > 0 && nommeLAssuranceMaladie(libelleExploitable(ligne)) ? { genre: 'muet', raison: r.raison } : { genre: 'rien' }
  }
  const etat = r.parMouvement.get(ligne.id)
  return etat ? { genre: 'etat', mouvementId: ligne.id, etat, rapprochement: r } : { genre: 'rien' }
}

// ── Les mots ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

function paiementsDe(ids: readonly string[], parId: ReadonlyMap<string, PaiementDuRapprochement>): PaiementDuRapprochement[] | null {
  const paiements = ids.map((id) => parId.get(id))
  return paiements.every((p): p is PaiementDuRapprochement => p !== undefined) && paiements.length > 0 ? paiements : null
}

/** Le mouvement nommé par sa date et son montant, jamais par son libellé. */
export function mouvementDit(m: Pick<MouvementDuRapprochement, 'date' | 'montant'>): string {
  const centimes = centimesDuMouvement(m.montant)
  return `${m.montant < 0 ? 'Débit' : 'Crédit'} du ${formatDate(m.date)} (${centimes === null ? 'montant illisible' : montantDit(Math.abs(centimes))})`
}

/** Ce à quoi un mouvement associé est associé, en mots. */
export function associationDite(r: RapprochementCalcule, paiementIds: readonly string[]): string {
  const paiements = paiementsDe(paiementIds, r.paiementsParId)
  return paiements === null
    ? 'Associé à un paiement de l’assurance maladie qui n’est plus lu : relire la page.'
    : `Associé au paiement de l’assurance maladie — ${groupeDit(paiements)}, ${montantDit(paiements.reduce((s, p) => s + p.montant_centimes, 0))}.`
}

/** La confirmation de « Défaire » : ce qui part, et ce qui ne change pas. */
export function confirmationDuRetraitDAssociation(r: RapprochementCalcule, mouvementId: string, paiementIds: readonly string[]): string {
  const m = r.mouvementsParId.get(mouvementId)
  const paiements = paiementsDe(paiementIds, r.paiementsParId)
  const quoi = paiements === null ? `${paiementIds.length} paiement${paiementIds.length > 1 ? 's' : ''}` : `le paiement — ${groupeDit(paiements)}`
  return `Défaire l’association ${m ? `du ${mouvementDit(m).charAt(0).toLowerCase()}${mouvementDit(m).slice(1)}` : 'de ce mouvement'} : `
    + `${quoi} redevient libre et se proposera de nouveau. Le classement du crédit et son écriture ne changent pas.`
}

/** Une ligne du lot : le crédit, et le groupe qu'il recevrait. */
export function ligneDuLot(r: RapprochementCalcule, c: Candidat): string {
  const m = r.mouvementsParId.get(c.mouvementId)
  const paiements = paiementsDe(c.paiementIds, r.paiementsParId)
  return `${m ? mouvementDit(m) : 'Mouvement'} ← ${paiements === null ? 'un paiement qui n’est plus lu' : groupeDit(paiements)}`
}

/** La confirmation du lot : combien, puis chacun. */
export function confirmationDuLot(r: RapprochementCalcule): { resume: string; lignes: string[] } {
  const n = r.concordances.length
  return {
    resume: `Associer ${n} crédit${n > 1 ? 's' : ''} du relevé ${n > 1 ? 'chacun à son' : 'à son'} paiement de l’assurance maladie : `
      + 'même montant au centime, crédité dans les cinq jours de la journée comptable, la référence du virement la portant, et '
      + `un seul candidat dans les deux sens. Aucun classement ne change. ${n > 1 ? 'Ils partent' : 'Il part'} ensemble, tout ou rien :`,
    lignes: r.concordances.map((c) => ligneDuLot(r, c)),
  }
}

/** Le bouton du lot, avec son compte. */
export const boutonDuLot = (n: number) => `Associer les concordances (${n})`

/** Les imports dont un paiement est associé : leur retrait se refuse (le déclencheur de la migration). Nul : on ne sait pas. */
export function importsAssocies(paiements: readonly { id: string; import_id: string }[],
  associations: LectureComplete<Pick<AssociationAssuranceMaladie, 'paiement_id'>> | null): ReadonlySet<string> | null {
  if (associations === null) return new Set()
  if (!associations.complete) return null
  const associes = new Set(associations.lignes.map((a) => a.paiement_id))
  return new Set(paiements.filter((p) => associes.has(p.id)).map((p) => p.import_id))
}

/** Pourquoi « Retirer » est refusé sur un import associé, dit avant le clic : les mots de la base au cabinet ; au praticien,
 * à qui s'adresser (il ne défait rien lui-même). */
export function refusDuRetraitDImportDit(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Un paiement de cet import est associé à un virement de ton relevé : ton cabinet doit d’abord défaire cette association. '
      + 'Demande-le-lui si cet import est à retirer.'
    : `${REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE} Ouvrir la fiche du crédit dans le relevé, puis « Défaire l’association ».`
}
