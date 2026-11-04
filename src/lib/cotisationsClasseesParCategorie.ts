import { mouvementsAffectes, type MouvementBancaire } from './affectationBanque'
import { estLePosteDesCotisations } from './cases2035'
import { formatDate, formatMoney } from './format'
import type { Categorie, VentilationBancaire } from './types'
import { estFigee } from './validationExercice'
import { partsDesVentilations } from './ventilationBanque'

// UN PRÉLÈVEMENT DE COTISATIONS CLASSÉ PAR UNE CATÉGORIE (relecture du 03/11/2026, D2 ; COT-Q2, écrite sur la recommandation
// le 04/11/2026 : en ERREUR).
//
// Une règle d'affectation range les prélèvements de l'Urssaf en un clic dans une catégorie dont le poste est « Cotisations
// sociales personnelles » — le poste même des échéances de l'onglet Cotisations. La 2035 les compte alors en BK pour leur
// montant ENTIER : leur CSG-CRDS reste dans la ligne 25, sa part non déductible déduite, contre la notice de la 2035
// (ligne 14, renvoi (13) : les cotisations « à l'exclusion de la part déductible de la CSG ») et l'article 154 quinquies du
// CGI (6,8 points déductibles) ; BV n'en reçoit rien, BT non plus, et l'avertissement « CSG-CRDS non saisie », qui ne lit
// que les échéances, se tait. Le chemin juste : annuler ce classement dans Banque, puis rapprocher le mouvement d'une
// échéance de l'onglet Cotisations, où la CSG-CRDS se saisit.
//
// CE QUI EST NOMMÉ : un mouvement AFFECTÉ à une telle catégorie, ou VENTILÉ avec une part sur l'une d'elles — un par
// mouvement, dans les deux sens (un remboursement de cotisations classé ainsi laisse sa CSG-CRDS en BV, D4). Le poste se
// reconnaît à la clé du rattachement (`estLePosteDesCotisations`), comme la 2035 le range. Pas le poste générique
// « Charges sociales personnelles » : sa part de BK « sans nature dite » est une autre question, tranchée (2035S-Q2, (A)), que
// Clôture dit sans retenir la validation. Pas une pièce non plus : ce sont les prélèvements que la question vise ; une pièce
// (l'avis d'un organisme) rangée sous ce poste et payée par le relevé a le même défaut, et n'est pas nommée ici — une suite à
// trancher (HISTORIQUE.md, entrée du 04/11/2026).
//
// UN SEUL CALCUL pour la Checklist (le dossier, hors exercices figés) et la validation (l'exercice à valider, par la date du
// mouvement — celle où la 2035 le compte) : ils nomment les mêmes mouvements.

export interface CotisationClasseeParCategorie {
  ligne: MouvementBancaire
  // Le libellé de la catégorie (la première, pour un mouvement ventilé sur plusieurs).
  categorie: string
  origine: 'affectation' | 'ventilation'
}

export function cotisationsClasseesParCategorie(
  lignes: readonly MouvementBancaire[],
  categories: readonly Categorie[],
  ventilations: readonly VentilationBancaire[],
  // L'assujettissement ne décide ici de rien (seul le poste compte) ; il est passé aux fonctions des parts, qui l'exigent.
  assujettiTva: boolean,
  // La frontière des exercices validés : un mouvement figé ne se reclasse plus, et le nommer réclamerait un geste refusé.
  frontiere: string | null,
): CotisationClasseeParCategorie[] {
  const vus = new Map<string, CotisationClasseeParCategorie>()
  const parts = [
    ...mouvementsAffectes(lignes, categories, assujettiTva).map((m) => ({ ligne: m.ligne, categorie: m.categorie, origine: 'affectation' as const })),
    ...partsDesVentilations(lignes, ventilations, categories, assujettiTva).map((p) => ({ ligne: p.ligne, categorie: p.categorie, origine: 'ventilation' as const })),
  ]
  for (const p of parts) {
    if (!estLePosteDesCotisations(p.categorie.poste_2035) || estFigee(p.ligne.date, frontiere) || vus.has(p.ligne.id)) continue
    vus.set(p.ligne.id, { ligne: p.ligne, categorie: p.categorie.libelle, origine: p.origine })
  }
  return [...vus.values()].sort((a, b) => (a.ligne.date < b.ligne.date ? -1 : a.ligne.date > b.ligne.date ? 1 : a.ligne.id < b.ligne.id ? -1 : 1))
}

const AU_PLUS = 6

/** Les mouvements nommés, date et montant, pour le détail d'un préalable ou d'un point. */
export function detailDesCotisationsClassees(liste: readonly CotisationClasseeParCategorie[]): string {
  const noms = liste.slice(0, AU_PLUS).map((c) =>
    `${c.ligne.montant > 0 ? 'le remboursement' : 'le prélèvement'} du ${formatDate(c.ligne.date)} (${formatMoney(Math.abs(c.ligne.montant))}, `
    + `${c.origine === 'ventilation' ? 'ventilé dans' : 'catégorie'} « ${c.categorie} »)`)
  const reste = liste.length - noms.length
  const texte = noms.join(' ; ') + (reste > 0 ? ` ; et ${reste} autre${reste > 1 ? 's' : ''}` : '')
  return `${texte.charAt(0).toUpperCase()}${texte.slice(1)}.`
}
