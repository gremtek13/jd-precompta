import { ACCES_SANS_OBJET } from './auteursVentes'
import { formatDate, formatMoney } from './format'
import { MOYENS_ENCAISSEMENT } from './encaissementsFactures'
import {
  encaissementsEnregistresSansMouvement, ventesDuReleve,
  type EncaissementDuMouvementLu, type LectureDesVentesDuReleve, type MouvementDeVente,
} from './mouvementsDesVentes'
import type { MoyenEncaissement } from './types'
import { estFigee } from './validationExercice'

// CE QUE LA VUE D'ENSEMBLE ET LA RÉVISION DISENT DES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (ligne 28.65, chantier
// EC-Q3, étape VF5f ; conception : HISTORIQUE.md, « VF5, LA BANQUE : LA CONCEPTION », § 5, et la conception d'EC-Q3, § 11).
// Un module PUR, que lib/pointsDeLaChecklist.ts appelle pour deux points :
//   - `mouvements-reserves` : les mouvements qu'un encaissement de facture source réserve (la garde G2) et que personne n'a
//     encore classés par leurs encaissements — l'état que l'onglet Banque leur donne (`ventesDuReleve`, étape VF5a1), jamais
//     une règle recopiée ;
//   - `encaissements-sans-mouvement` : les encaissements de factures sources enregistrés sans mouvement — la liste même des
//     candidats de l'onglet Banque (`encaissementsEnregistresSansMouvement`, étape VF5e) —, réduite aux moyens qui passent
//     par le relevé : virement, prélèvement, chèque, carte, effet. Les espèces, la compensation et « autre » n'ont pas de
//     mouvement à attendre ; une contre-passation non plus (elle ne se compte pas parmi les ENCAISSEMENTS, et sans mouvement
//     elle dit, pour la base, que l'encaissement n'a pas eu lieu).
// Un mouvement daté d'un exercice que la validation fige ne se compte plus : rien ne le classe plus (les refus de la base).
// Un encaissement qui en est daté, si : depuis l'étape VF7a (migration `frontiere_des_encaissements`), il se rattache encore
// au mouvement d'après qui le paie — le chèque remis le 30 décembre, crédité en janvier —, son écriture inchangée ; la
// compensation et « autre », qui s'écrivent sur leur compte de contrepartie et ne se rattachent plus, ne sont pas des
// moyens du relevé. VF7 rendra les deux points préalables à la validation — d'ici là, ils sont en « attention ».
//
// LE TOUT OU RIEN : la lecture est celle de l'onglet Banque (lib/ecrituresVentesFactureesLecture.ts), lue en entier ou
// « incomplète ». Incomplète, les deux points se TAISENT — un silence que l'écran dit par son bandeau — et rien n'est retiré
// des lignes non rapprochées. Un dossier qui n'a pas basculé ne lit rien de plus et ne change en rien.

/** Les moyens d'un encaissement dont le relevé porte le mouvement. */
export const MOYENS_DU_RELEVE: readonly MoyenEncaissement[] = ['virement', 'prelevement', 'cheque', 'carte', 'effet']

export type VentesDeLaChecklist =
  // Le dossier n'a pas basculé : rien n'est lu de plus, rien ne change.
  | { etat: 'sans_objet' }
  // Basculé, lues en partie ou refusées : les deux points se taisent.
  | { etat: 'incomplete'; motif: string }
  // Basculé, lues en entier.
  | {
    etat: 'lue'
    /** Les mouvements réservés, hors des exercices figés, dans l'ordre du relevé lu. */
    reserves: readonly MouvementDeVente[]
    /** Les encaissements qui attendent leur mouvement, figés ou non (étape VF7a), dans l'ordre du registre lu. */
    sansMouvement: readonly EncaissementDuMouvementLu[]
    /** Le numéro de chaque facture du dossier, par identifiant : le détail du point les nomme. */
    numeros: ReadonlyMap<string, string>
  }

/**
 * Les ventes facturées telles que la Vue d'ensemble les dit. `lecture` : nulle pour un dossier qui n'a pas basculé ;
 * `frontiere` : celle des exercices validés (lib/validationExercice.ts).
 */
export function ventesDeLaChecklist(lecture: LectureDesVentesDuReleve | null, frontiere: string | null): VentesDeLaChecklist {
  if (lecture === null) return { etat: 'sans_objet' }
  if (lecture.etat === 'incomplete') return { etat: 'incomplete', motif: lecture.motif }
  const ventes = ventesDuReleve(true, lecture.dossierId, lecture, ACCES_SANS_OBJET)
  // Une lecture d'un autre dossier que celui qu'elle dit : rien ne s'en décide.
  if (ventes.etat !== 'lue') return { etat: 'incomplete', motif: 'la lecture rendue n’est pas celle de ce dossier' }
  const s = lecture.sources
  return {
    etat: 'lue',
    // Dans l'ordre du relevé lu, chacun jugé à SA date.
    reserves: s.mouvements.flatMap((m) => {
      const vente = ventes.mouvements.get(m.id)
      return vente?.etat === 'reserve' && !estFigee(m.date, frontiere) ? [vente] : []
    }),
    // Figés ou non : celui qu'un exercice validé fige se rattache encore au mouvement d'après (étape VF7a).
    sansMouvement: encaissementsEnregistresSansMouvement(s)
      .filter((e) => e.annule_id == null && (MOYENS_DU_RELEVE as readonly string[]).includes(e.moyen)),
    numeros: new Map(s.factures.map((f) => [f.id, f.numero ?? 'sans numéro'])),
  }
}

const AU_PLUS = 6

function libelleDuMoyen(moyen: string): string {
  return (MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen).toLowerCase()
}

/** Où trouver les encaissements que le point compte, et lesquels : la cible ne les liste pas d'elle-même. */
export function detailDesEncaissementsSansMouvement(v: Extract<VentesDeLaChecklist, { etat: 'lue' }>): string {
  const cites = v.sansMouvement.slice(0, AU_PLUS)
    .map((e) => `${v.numeros.get(e.facture_id) ?? 'sans numéro'} (${libelleDuMoyen(e.moyen)} du ${formatDate(e.date_encaissement)}, ${formatMoney(e.montant)})`)
  const reste = v.sansMouvement.length - cites.length
  const liste = cites.length === 0 ? '.' : ` : ${cites.join(', ')}${reste > 0 ? ` et ${reste} autre(s)` : ''}.`
  return `Dans Factures, vue « Règlements », leur colonne « Mouvement » porte « — »${liste} Le crédit qui en porte un se `
    + 'rattache depuis sa fiche, dans Banque — remis d’abord à traiter s’il a été ignoré —, même quand l’encaissement est '
    + 'daté d’un exercice validé : son écriture n’en change pas. Un chèque remis et pas encore crédité attend son mouvement '
    + 'à bon droit.'
}
