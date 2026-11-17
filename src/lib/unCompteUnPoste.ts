// UN COMPTE, UN SEUL POSTE DE LA 2035 (conception 58, § 1.3 ; lot L1, 17/11/2026).
//
// La 2035 de l'application se calcule depuis les SOURCES (la catégorie d'une pièce, d'un mouvement, d'une part ventilée,
// d'une recette de caisse, ou le poste que le moteur donne à un rôle du plan), jamais depuis le compte. Le logiciel qui
// importe notre FEC fait l'inverse : il range chaque COMPTE sur une ligne de la 2035. Si, dans un même exercice, un compte de
// charge ou de produit reçoit des lignes de deux postes différents (deux catégories au même compte, une catégorie sur le compte
// d'un rôle que le moteur range ailleurs), la 2035 qu'il recalculera depuis notre FEC ne sera pas la nôtre.
//
// Ce module le DIT, sans rien corriger : une attention dans la Vue d'ensemble (`comptes-sur-plusieurs-postes`,
// lib/pointsDeLaChecklist.ts), jamais bloquante. Il ne juge que ce qu'il sait : une ligne dont la source n'est pas lue, dont
// la catégorie n'a pas de poste, ou dont le poste n'est d'aucune ligne du formulaire pour sa nature, n'apporte aucun poste —
// elle ne fait taire rien, elle ne crée aucun conflit. Deux postes comptent pour un s'ils disent la même LIGNE du formulaire
// (`posteDuFormulaire`, lib/cases2035.ts : « Recettes » et le poste des ventes facturées sont la ligne 1).
import { natureDuCompte } from './affectationBanque'
import { posteDuFormulaire } from './cases2035'
import {
  POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES,
} from './declaration2035'
import { POSTE_ASSURANCE_EMPRUNT, POSTE_INTERETS_EMPRUNT } from './echeanceEmprunt'
import type { PlanComptable } from './planComptable'
import type { Categorie, EcritureBrouillon, LigneBancaire, OperationCaisse, Piece, VentilationBancaire } from './types'

/** Une ligne du brouillon : son compte, sa date (l'exercice) et ce qui dit sa source. */
export type LigneDuBrouillonPostee = Pick<EcritureBrouillon,
  'compte' | 'date' | 'piece_id' | 'ligne_bancaire_id' | 'cotisation_id' | 'immobilisation_id' | 'vehicule_id'
  | 'encaissement_id' | 'facture_id'> & Pick<Partial<EcritureBrouillon>, 'operation_caisse_id'>

export interface SourcesDesPostes {
  ecritures: readonly LigneDuBrouillonPostee[]
  categories: readonly Pick<Categorie, 'id' | 'compte_comptable' | 'poste_2035'>[]
  pieces: readonly Pick<Piece, 'id' | 'categorie_id'>[]
  mouvements: readonly Pick<LigneBancaire, 'id' | 'categorie_id' | 'ventilee' | 'cotisation_id' | 'emprunt_id'>[]
  ventilations: readonly Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id'>[]
  operationsDeCaisse: readonly Pick<OperationCaisse, 'id' | 'categorie_id'>[]
  plan: Pick<PlanComptable, 'cotisations_exploitant' | 'dotations_amortissements' | 'indemnites_kilometriques'
    | 'interets_emprunt' | 'assurance_emprunt' | 'prestations_de_services' | 'ventes_de_biens'>
}

export interface CompteSurPlusieursPostes {
  annee: number
  compte: string
  /** Les lignes du formulaire que ce compte alimente, sous leur libellé imprimé, triées. Deux au moins. */
  lignesDuFormulaire: string[]
}

/** Les postes BRUTS d'une ligne (un seul d'ordinaire ; plusieurs pour un mouvement ventilé dont deux parts portent ce compte). */
function postesDeLaLigne(l: LigneDuBrouillonPostee, s: SourcesDesPostes, index: Index): string[] {
  const { plan } = s
  const posteDeCategorie = (id: string | null | undefined): string[] => {
    const poste = id ? index.categories.get(id)?.poste_2035 ?? null : null
    return poste === null ? [] : [poste]
  }
  if (l.piece_id) return posteDeCategorie(index.pieces.get(l.piece_id)?.categorie_id)
  if (l.operation_caisse_id) return posteDeCategorie(index.operations.get(l.operation_caisse_id)?.categorie_id)
  if (l.immobilisation_id) return l.compte === plan.dotations_amortissements ? [POSTE_AMORTISSEMENTS] : []
  if (l.vehicule_id) return l.compte === plan.indemnites_kilometriques ? [POSTE_INDEMNITES_KM] : []
  if (l.encaissement_id || l.facture_id) {
    return l.compte === plan.prestations_de_services || l.compte === plan.ventes_de_biens ? [POSTE_VENTES_FACTUREES] : []
  }
  if (l.ligne_bancaire_id) {
    const m = index.mouvements.get(l.ligne_bancaire_id)
    if (!m) return []
    if (m.emprunt_id) {
      return l.compte === plan.interets_emprunt ? [POSTE_INTERETS_EMPRUNT]
        : l.compte === plan.assurance_emprunt ? [POSTE_ASSURANCE_EMPRUNT] : []
    }
    if (m.cotisation_id) return l.compte === plan.cotisations_exploitant ? [POSTE_COTISATIONS] : []
    if (m.ventilee) {
      // Chaque part dont la catégorie porte le compte de la ligne : deux parts de deux postes sur un même compte sont
      // précisément ce que ce contrôle cherche.
      return (index.ventilations.get(m.id) ?? [])
        .map((v) => (v.categorie_id ? index.categories.get(v.categorie_id) : undefined))
        .flatMap((c) => (c && c.compte_comptable === l.compte && c.poste_2035 !== null ? [c.poste_2035] : []))
    }
    return posteDeCategorie(m.categorie_id)
  }
  // Une échéance payée depuis le compte personnel (ni pièce ni mouvement, sa cotisation seule).
  if (l.cotisation_id) return l.compte === plan.cotisations_exploitant ? [POSTE_COTISATIONS] : []
  return []
}

interface Index {
  categories: Map<string, Pick<Categorie, 'id' | 'compte_comptable' | 'poste_2035'>>
  pieces: Map<string, Pick<Piece, 'id' | 'categorie_id'>>
  mouvements: Map<string, Pick<LigneBancaire, 'id' | 'categorie_id' | 'ventilee' | 'cotisation_id' | 'emprunt_id'>>
  operations: Map<string, Pick<OperationCaisse, 'id' | 'categorie_id'>>
  ventilations: Map<string, Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id'>[]>
}

/**
 * Les comptes de charge ou de produit qui, dans un même exercice (l'année civile de la ligne), alimentent plusieurs lignes du
 * formulaire de la 2035 — triés par exercice puis par compte. Vide quand chaque compte n'en alimente qu'une.
 */
export function comptesSurPlusieursPostes(s: SourcesDesPostes): CompteSurPlusieursPostes[] {
  const ventilations = new Map<string, Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id'>[]>()
  for (const v of s.ventilations) ventilations.set(v.ligne_bancaire_id, [...(ventilations.get(v.ligne_bancaire_id) ?? []), v])
  const index: Index = {
    categories: new Map(s.categories.map((c) => [c.id, c])),
    pieces: new Map(s.pieces.map((p) => [p.id, p])),
    mouvements: new Map(s.mouvements.map((m) => [m.id, m])),
    operations: new Map(s.operationsDeCaisse.map((o) => [o.id, o])),
    ventilations,
  }
  const parCompte = new Map<string, { annee: number; compte: string; lignes: Set<string> }>()
  for (const l of s.ecritures) {
    const nature = natureDuCompte(l.compte)
    const annee = Number(l.date.slice(0, 4))
    if (nature === null || !Number.isInteger(annee)) continue
    for (const poste of postesDeLaLigne(l, s, index)) {
      const ligne = posteDuFormulaire(poste, nature)
      if (ligne === null) continue
      const cle = `${annee}|${l.compte}`
      const entree = parCompte.get(cle) ?? { annee, compte: l.compte, lignes: new Set<string>() }
      entree.lignes.add(ligne)
      parCompte.set(cle, entree)
    }
  }
  return [...parCompte.values()]
    .filter((e) => e.lignes.size > 1)
    .map((e) => ({ annee: e.annee, compte: e.compte, lignesDuFormulaire: [...e.lignes].sort((a, b) => a.localeCompare(b, 'fr')) }))
    .sort((a, b) => a.annee - b.annee || a.compte.localeCompare(b.compte))
}

export const LIBELLE_COMPTES_SUR_PLUSIEURS_POSTES = 'compte(s) de charge ou de produit qui alimente(nt) plusieurs lignes de la 2035 '
  + 'dans un même exercice — un logiciel qui range chaque compte sur une seule ligne ne retrouverait pas cette 2035'

/** Le détail du point : chaque compte, son exercice et ses lignes du formulaire, cinq au plus, puis ce qu'on peut y faire. */
export function detailDesComptesSurPlusieursPostes(comptes: readonly CompteSurPlusieursPostes[]): string | undefined {
  if (comptes.length === 0) return undefined
  const lignes = comptes.slice(0, 5).map((c) => `${c.compte} (${c.annee}) : ${c.lignesDuFormulaire.join(' / ')}`)
  return `${lignes.join(' ; ')}${comptes.length > 5 ? ` ; et ${comptes.length - 5} autre(s)` : ''}. Donner à chaque catégorie `
    + 'de ces comptes le même poste, ou un compte à elle.'
}
