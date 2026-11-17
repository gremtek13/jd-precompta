import { parseDateBancaire } from './csv'

// LA DATE DE VALEUR D'UN MOUVEMENT DU RELEVÉ (EXP58-Q4, décision du cabinet du 17/11/2026 ; docs/conceptions/
// 58-reponses-de-l-expert-comptable.md, § 2.2). L'expert-comptable fait foi de la date de valeur quand on l'a, sinon de la
// date d'opération, celle que l'application emploie. Ce lot la GARDE à l'import (un relevé importé sans elle ne se
// réimporte pas : le dédoublonnage le refuse) ; son EMPLOI — rattacher à l'année de sa date de valeur un mouvement à cheval
// sur le 31 décembre — vient plus tard : aucun moteur, aucun écran de calcul ne la lit. Elle n'entre pas non plus dans le
// dédoublonnage (`signatureMouvement` : la date d'opération, le libellé, le montant), pour que deux exports du même relevé,
// l'un avec elle, l'autre sans, se reconnaissent encore.
//
// Elle se lit d'une colonne d'un CSV que l'en-tête nomme (« Date de valeur », « Date valeur » : `colonneDeLaDateDeValeur`)
// ou que le cabinet choisit, et de l'élément DTAVAIL d'une opération OFX (`releveOfxQif.ts`) ; le QIF n'en porte pas, un PDF
// non plus (sa seconde date peut être une date d'achat rappelée). Jamais devinée : une cellule vide n'en donne pas, une date
// qui ne se lit pas, ou trop loin de la date d'opération, s'écarte et se COMPTE — le mouvement s'importe sans elle.

/** Le drapeau de la migration `date_de_valeur_des_mouvements` (EXP58-Q4, préparée le 17/11/2026, pas appliquée) : baissé,
 *  l'import lit, montre et écrit ce qu'il lisait hier, à l'octet, et la fiche d'un mouvement ne dit rien de plus — la colonne
 *  n'existe pas encore, et un lot qui la nommerait serait refusé en entier. Il se lève le jour de la migration. */
export const DATE_DE_VALEUR_PREVUE = false

/** L'écart le plus grand, en jours, entre la date de valeur et la date d'opération, AVANT OU APRÈS : la borne de la
 *  contrainte `lignes_bancaires_date_valeur_proche` (supabase/preparees/20261117170000_date_de_valeur_des_mouvements.sql),
 *  jugée ici avant le clic, pour que la base n'ait rien à refuser. Un trimestre : l'écart réglementaire d'un paiement est
 *  d'un jour ouvré (Code monétaire et financier, art. L. 133-14 ; L. 131-1-1 pour un chèque), un débit différé de carte
 *  d'un mois et quelques jours. */
export const ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR = 92

/** Ce qu'une cellule dit de la date de valeur d'une opération : une date gardée, une date écartée (sa raison), ou rien
 *  (`null` : la cellule est vide, le mouvement n'a pas de date de valeur). */
export type LectureDeLaDateDeValeur = { date: string } | { ecart: 'illisible' | 'eloignee' } | null

// Des dates civiles `AAAA-MM-JJ`, comparées en UTC : l'heure locale ferait varier l'écart d'un jour selon le fuseau de la
// machine (la règle d'`ecartEnJours`, lib/appariementBanque.ts).
function jour(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000
}

/** La date de valeur d'une opération datée `dateOperation` (ISO), lue de la cellule `brut` par `parseDateBancaire` — la
 *  même lecture que la date d'opération. */
export function lireDateDeValeur(brut: string, dateOperation: string): LectureDeLaDateDeValeur {
  const t = brut.trim()
  if (!t) return null
  const date = parseDateBancaire(t)
  if (!date) return { ecart: 'illisible' }
  if (Math.abs(jour(date) - jour(dateOperation)) > ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR) return { ecart: 'eloignee' }
  return { date }
}

/** Le compte des dates de valeur des OPÉRATIONS d'un fichier (une ligne de solde ne s'importe pas). */
export interface DatesDeValeurDuFichier {
  gardees: number
  sans: number
  illisibles: number
  eloignees: number
}

/** Ce que l'aperçu et l'alerte de fin d'import disent des dates de valeur, ou rien quand aucune opération n'est lue. */
export function phraseDesDatesDeValeur(d: DatesDeValeurDuFichier): string | null {
  const total = d.gardees + d.sans + d.illisibles + d.eloignees
  if (total === 0) return null
  const ecartees = d.illisibles + d.eloignees
  const parts = [`Date de valeur gardée sur ${d.gardees} opération(s)`]
  if (d.sans > 0) parts.push(`${d.sans} sans date de valeur dans le fichier`)
  if (ecartees > 0) {
    const raisons = [
      ...(d.illisibles > 0 ? [`${d.illisibles} illisible(s)`] : []),
      ...(d.eloignees > 0 ? [`${d.eloignees} à plus de ${ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR} jours de la date d’opération`] : []),
    ]
    parts.push(`${ecartees} non gardée(s) (${raisons.join(', ')}) : ces mouvements s’importent sans elle`)
  }
  return `${parts.join(' ; ')}.`
}
