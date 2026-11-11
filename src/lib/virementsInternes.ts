import type { LigneEcritureMouvement, MouvementBancaire } from './affectationBanque'
import { ecartEnJours } from './appariementBanque'
import { ecritureDuCompteDeBilan, refusCompteDeBilanDuMouvement } from './compteDeBilan'
import type { ModeleComptable } from './engagement'
import { formatDate, formatMoney } from './format'
import type { LectureDesComptes } from './importParCompte'
import type { MouvementsHorsDesLots } from './mouvementsDesVentes'
import type { LigneBancaire } from './types'
import { dateFigee } from './validationExercice'

// LE RAPPROCHEMENT PAR COMPTE BANCAIRE ET LE VIREMENT ENTRE DEUX COMPTES DU DOSSIER (ligne 26.6, lot MCB3 ; MCB-Q3, tranchée
// par le cabinet le 11/11/2026 à la recommandation). Le récit : HISTORIQUE.md, « 11/11/2026 — LE RAPPROCHEMENT PAR COMPTE
// BANCAIRE ET LE VIREMENT ENTRE COMPTES (MCB3) ». Derrière `COMPTES_BANCAIRES_PREVUS` (lib/comptesBancaires.ts), baissé :
// l'écran passe la lecture des comptes `sans_objet`, et rien ne change — aucune paire, aucun mouvement de plus hors des lots,
// la fiche d'hier au caractère près.
//
// LE VIREMENT ENTRE DEUX COMPTES DU PRATICIEN laisse deux mouvements au relevé : un débit sur l'un, un crédit du même montant
// sur l'autre, à quelques jours. Chacun s'écrit au compte des virements internes du plan (580000 par défaut) face à la
// banque, par le chemin du compte de bilan qui existe (`ecrire_mouvement_compte_bilan`, lib/compteDeBilan.ts) : le 580 reçoit
// le débit de l'un et le crédit de l'autre, et revient à zéro — la preuve `virements-internes` de la Révision le juge à la
// clôture. Ni charge ni recette : la 2035 ne le voit pas. AUCUNE MIGRATION : la fonction accepte déjà ce compte, et son refus
// du 512 (`refus_compte_de_bilan`) renvoie déjà « un second compte bancaire » au 580000.
//
// LA JAMBE DE BANQUE RESTE CELLE D'AUJOURD'HUI : le compte du rôle `banque` du plan, pour les deux mouvements. Le 512 propre
// d'un compte autre que le principal (MCB-Q1, `compte_propre_depuis`) arrive au lot MCB5, qui réécrit la jambe de banque des
// fonctions du relevé (`compte_de_banque_du_mouvement`) ; d'ici là, les deux jambes de banque d'un virement interne
// s'annulent sur le même 512, comme le 580.
//
// CE QUI SE RECONNAÎT, CE QUI SE PROPOSE — un symptôme, jamais une preuve ; rien ne s'écrit seul :
//   - un mouvement LIBRE (à traiter, ni personnel, ni nul, ni réservé par les ventes, ni figé par un exercice validé, et
//     qu'un compte de bilan accepterait) a pour candidats les mouvements d'un AUTRE compte du dossier, du montant opposé au
//     centime, à `JOURS_DU_VIREMENT_INTERNE` jours au plus, libres eux aussi — ou déjà écrits au 580 SANS leur pendant (un
//     virement à moitié écrit, qu'il reste à compléter) ;
//   - la paire est PROPOSÉE quand chacun est le seul candidat de l'autre (les deux sens, comme le rapprochement automatique) ;
//     sinon la fiche les montre tous, aucun en tête ;
//   - AUCUN LOT NE PREND un mouvement libre qui a un candidat (`virementsInternesHorsDesLots`) : affecté par une règle,
//     rapproché d'une pièce de même montant ou ignoré, il manquerait au 580 et laisserait l'autre moitié seule. Il reste à
//     confirmer depuis sa fiche ;
//   - la confirmation écrit chaque mouvement libre de la paire au 580, l'un après l'autre (`ecrire_mouvement_compte_bilan`,
//     deux appels) : un échec entre les deux laisse le premier écrit, ce qui est juste, et la fiche du second propose de le
//     compléter — l'écran dit le virement « inachevé ».
//
// UN MOUVEMENT SE RAPPROCHE DANS SON COMPTE : le rejet d'un paiement (lib/rejetDuPaiement.ts) ne défait qu'un paiement de son
// compte. Une pièce, elle, se paie de n'importe quel compte du praticien : son rapprochement ne se borne pas.

/** La fenêtre d'un virement entre deux comptes : trois jours — un virement d'une banque à l'autre, parti un vendredi, arrive
 *  le lundi. Au-delà, deux mouvements de montants opposés ne se disent pas un virement interne. */
export const JOURS_DU_VIREMENT_INTERNE = 3

/** Ce que le lot écarte, et pourquoi : la raison que `ecartDuLot` (lib/mouvementsDesVentes.ts) et la fiche disent. */
export const RAISON_VIREMENT_INTERNE = 'un mouvement du montant opposé, sur un autre compte bancaire du dossier, en fait '
  + 'peut-être un virement entre comptes, à confirmer depuis sa fiche — classé autrement, il manquerait au compte des virements internes'

/** Ce que l'analyse lit d'un mouvement. */
export type MouvementDuVirement = MouvementBancaire & Pick<LigneBancaire, 'compte_bancaire_id'>

/** Un candidat d'un mouvement libre : l'autre mouvement, et s'il est déjà écrit au 580 (il ne reste que ce mouvement-ci). */
export interface CandidatDuVirement<L extends MouvementDuVirement> {
  autre: L
  dejaAuCompte: boolean
}

/** L'analyse du relevé : les candidats de chaque mouvement libre qui en a, par identifiant. */
export interface AnalyseDesVirementsInternes<L extends MouvementDuVirement> {
  candidats: ReadonlyMap<string, readonly CandidatDuVirement<L>[]>
}

const AUCUNE_ANALYSE: AnalyseDesVirementsInternes<never> = { candidats: new Map() }

const centimes = (euros: number) => Math.round(euros * 100)

/** Le dossier tient-il deux comptes ou plus, lus en entier ? Ce qui fait dire son compte à la fiche d'un mouvement. */
export function plusieursComptes(lecture: LectureDesComptes): boolean {
  return lecture.etat === 'lus' && lecture.comptes.length >= 2
}

/**
 * Les virements entre comptes du relevé. `lecture` : celle des comptes du dossier — `sans_objet` (le drapeau baissé) rend
 * l'analyse vide, comme avant MCB ; sinon les paires se tirent du relevé SEUL, chaque mouvement portant son compte (lu en
 * entier par l'onglet, qui retient ses lots sur une lecture partielle). `compteDesVirements` : le compte des virements
 * internes du plan du dossier. `ventes` : les mouvements que les ventes facturées classent ou réservent (G2), qui ne se
 * classent pas au 580. `anneesValidees` : un mouvement qu'elles figent ne s'écrit plus. Aucun paramètre n'a de défaut.
 */
export function virementsInternes<L extends MouvementDuVirement>(
  lignes: readonly L[],
  lecture: LectureDesComptes,
  compteDesVirements: string,
  ventes: MouvementsHorsDesLots,
  anneesValidees: readonly number[],
): AnalyseDesVirementsInternes<L> {
  if (lecture.etat === 'sans_objet') return AUCUNE_ANALYSE
  const avecCompte = lignes.filter((l) => typeof l.compte_bancaire_id === 'string' && l.montant !== 0)
  // Un seul compte au relevé : aucune paire possible, rien à parcourir.
  if (new Set(avecCompte.map((l) => l.compte_bancaire_id)).size < 2) return AUCUNE_ANALYSE
  const libre = (l: L) => l.statut === 'non_rapprochee' && !l.prelevement_personnel && !ventes.has(l.id)
    && dateFigee(l.date, anneesValidees) === null && !l.piece_id && !l.cotisation_id && !l.categorie_id && !l.emprunt_id
    && !l.ventilee && !l.reglement_groupe && !l.declaration_tva_id
  const auCompte = (l: L) => l.statut === 'rapprochee' && l.compte_bilan === compteDesVirements
  // Les mouvements par montant en centimes : chacun ne lit que le montant opposé au sien.
  const parMontant = new Map<number, L[]>()
  for (const l of avecCompte) {
    if (!libre(l) && !auCompte(l)) continue
    const cle = centimes(l.montant)
    const deja = parMontant.get(cle)
    if (deja) deja.push(l)
    else parMontant.set(cle, [l])
  }
  const enFace = (l: L) => (parMontant.get(-centimes(l.montant)) ?? [])
    .filter((k) => k.compte_bancaire_id !== l.compte_bancaire_id && ecartEnJours(k.date, l.date) <= JOURS_DU_VIREMENT_INTERNE)
  const candidats = new Map<string, CandidatDuVirement<L>[]>()
  for (const l of avecCompte) {
    if (!libre(l)) continue
    const liste = enFace(l).flatMap((k): CandidatDuVirement<L>[] => {
      if (libre(k)) return [{ autre: k, dejaAuCompte: false }]
      // Écrit au 580, il ne s'offre que s'il attend encore son pendant : aucun autre mouvement écrit au 580 en face de lui.
      if (auCompte(k) && !enFace(k).some(auCompte)) return [{ autre: k, dejaAuCompte: true }]
      return []
    })
    if (liste.length > 0) candidats.set(l.id, liste)
  }
  return { candidats }
}

/** Le candidat PROPOSÉ d'un mouvement : le seul, et dont il est lui-même le seul (un candidat déjà écrit au 580 n'a pas de
 *  candidats à lui : il suffit qu'il soit le seul de ce mouvement). À égalité, aucun : l'opérateur choisit. */
export function virementPropose<L extends MouvementDuVirement>(
  analyse: AnalyseDesVirementsInternes<L>,
  ligneId: string,
): CandidatDuVirement<L> | null {
  const liste = analyse.candidats.get(ligneId) ?? []
  if (liste.length !== 1) return null
  const [c] = liste
  if (c.dejaAuCompte) return c
  const retour = analyse.candidats.get(c.autre.id) ?? []
  return retour.length === 1 && retour[0].autre.id === ligneId ? c : null
}

/** Les mouvements qu'aucun lot ne prend : ceux d'hier, et chaque mouvement libre qui a un candidat, sous sa raison. Sans
 *  candidat, la liste d'hier, la même instance. */
export function virementsInternesHorsDesLots<L extends MouvementDuVirement>(
  hors: MouvementsHorsDesLots,
  analyse: AnalyseDesVirementsInternes<L>,
): MouvementsHorsDesLots {
  const ajouts = [...analyse.candidats.keys()].filter((id) => !hors.has(id))
  if (ajouts.length === 0) return hors
  const avec = new Map(hors)
  for (const id of ajouts) avec.set(id, RAISON_VIREMENT_INTERNE)
  return avec
}

/** Ce que la confirmation écrit : chaque mouvement libre de la paire au compte des virements internes, ce mouvement-ci
 *  d'abord, avec l'écriture que la base vérifie ; ou le premier refus, dans l'ordre de la base, nommant le mouvement. */
export type EcritureDuVirementInterne =
  | { cas: 'ecrire'; mouvements: readonly { ligne: MouvementBancaire; ecriture: LigneEcritureMouvement[] }[] }
  | { cas: 'refus'; refus: string }

export function ecritureDuVirementInterne<L extends MouvementDuVirement>(
  ligne: L,
  candidat: CandidatDuVirement<L>,
  modele: ModeleComptable,
): EcritureDuVirementInterne {
  const compte = modele.plan.virements_internes
  const aEcrire = candidat.dejaAuCompte ? [ligne] : [ligne, candidat.autre]
  for (const m of aEcrire) {
    const refus = refusCompteDeBilanDuMouvement(m, compte, modele)
    if (refus) return { cas: 'refus', refus: `Le mouvement du ${formatDate(m.date)} (${formatMoney(m.montant)}) : ${refus}` }
  }
  return { cas: 'ecrire', mouvements: aEcrire.map((m) => ({ ligne: m, ecriture: ecritureDuCompteDeBilan(m, compte, modele.plan) })) }
}

/** Le virement inachevé : le premier mouvement écrit, le second refusé par la base. */
export function messageDuVirementInacheve(ecrit: Pick<LigneBancaire, 'date' | 'montant'>, refuse: Pick<LigneBancaire, 'date' | 'montant'>, raison: string): string {
  return `Le virement entre comptes est inachevé : le mouvement du ${formatDate(ecrit.date)} (${formatMoney(ecrit.montant)}) est écrit `
    + `au compte des virements internes, celui du ${formatDate(refuse.date)} (${formatMoney(refuse.montant)}) ne l’est pas (${raison}). `
    + 'Sa fiche propose de le compléter.'
}

// ── La fiche d'un mouvement ──────────────────────────────────────────────────────────────────────────────────────────────

/** Un candidat tel que la fiche le montre : sa date, son montant, son compte bancaire (le libellé que le cabinet lui a donné). */
export interface CandidatDeLaFiche {
  ligneId: string
  date: string
  montant: number
  compte: string
  dejaAuCompte: boolean
  propose: boolean
}

/** Ce que la fiche dit du compte du mouvement et de ses virements entre comptes. `absent` : le drapeau baissé, ou un seul
 *  compte — la fiche d'hier, au caractère près. `illisible` : les comptes du dossier ne sont pas lus en entier, une ligne
 *  discrète le dit. */
export type CompteDeLaFiche =
  | { etat: 'absent' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'compte'; libelle: string; candidats: readonly CandidatDeLaFiche[] }

const COMPTE_INCONNU = 'un compte que la lecture des comptes ne rend pas'

export function compteDeLaFiche<L extends MouvementDuVirement>(
  ligne: L,
  lecture: LectureDesComptes,
  analyse: AnalyseDesVirementsInternes<L>,
): CompteDeLaFiche {
  if (lecture.etat === 'sans_objet' || lecture.etat === 'en_cours') return { etat: 'absent' }
  if (lecture.etat === 'illisible') return { etat: 'illisible', motif: lecture.motif }
  if (!plusieursComptes(lecture)) return { etat: 'absent' }
  const libelleDe = (id: string | undefined) => lecture.comptes.find((c) => c.id === id)?.libelle ?? COMPTE_INCONNU
  const propose = virementPropose(analyse, ligne.id)
  return {
    etat: 'compte',
    libelle: libelleDe(ligne.compte_bancaire_id),
    candidats: (analyse.candidats.get(ligne.id) ?? []).map((c) => ({
      ligneId: c.autre.id, date: c.autre.date, montant: c.autre.montant, compte: libelleDe(c.autre.compte_bancaire_id),
      dejaAuCompte: c.dejaAuCompte, propose: propose !== null && propose.autre.id === c.autre.id,
    })),
  }
}
