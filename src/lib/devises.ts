// Conversion d'une pièce libellée en devise étrangère vers l'euro.
//
// Règle qui commande tout le reste : les colonnes montant_ht / montant_tva / montant_ttc d'une pièce
// sont TOUJOURS en euros. Tout l'aval en dépend — écritures, rapprochement bancaire, export FEC,
// totaux de clôture, 2035. La devise d'origine et le montant tel qu'écrit sur le document sont
// conservés à côté (`devise`, `montant_devise`, `taux_change`), pour pouvoir justifier la conversion
// sans rouvrir le justificatif.
//
// Le taux vient de la Banque centrale européenne (voir supabase/functions/taux-change-bce). Il est
// FIGÉ sur la pièce au moment de la conversion, jamais recalculé à l'affichage : un montant comptable
// ne doit pas changer parce qu'on rouvre l'écran six mois plus tard.

export const DEVISE_PIVOT = 'EUR'

// Les devises que la BCE cote et qu'on peut rencontrer sur une facture de fournisseur courant. La
// liste sert à reconnaître un symbole, pas à restreindre : une devise absente d'ici reste saisissable
// à la main, elle ne sera simplement pas devinée toute seule.
const SYMBOLES: [RegExp, string][] = [
  [/\bUSD\b|\$(?=\s?\d)|\bUS\$/, 'USD'],
  [/\bGBP\b|£/, 'GBP'],
  [/\bCHF\b/, 'CHF'],
  [/\bJPY\b|¥/, 'JPY'],
  [/\bCAD\b|\bCA\$/, 'CAD'],
  [/\bAUD\b|\bAU\$/, 'AUD'],
  [/\bSEK\b/, 'SEK'],
  [/\bNOK\b/, 'NOK'],
  [/\bDKK\b/, 'DKK'],
  [/\bPLN\b/, 'PLN'],
]

// L'euro l'emporte dès qu'il est présent, même si un autre symbole traîne ailleurs sur le document.
// Le cas courant est la facture d'un prestataire étranger libellée en euros qui rappelle ses tarifs
// en dollars, ou qui porte une adresse américaine : y lire « USD » convertirait une facture déjà en
// euros, et retrancherait un sixième du montant sans que rien ne le signale.
const MARQUEURS_EURO = /€|\bEUR\b/

export function deviseDuTexte(texte: string | null | undefined): string | null {
  if (!texte) return null
  const majuscules = texte.toUpperCase()
  if (MARQUEURS_EURO.test(majuscules)) return DEVISE_PIVOT
  for (const [motif, code] of SYMBOLES) {
    if (motif.test(majuscules)) return code
  }
  return null
}

export interface Cotation {
  date: string
  taux: number
}

// Le dernier taux publié À LA DATE DEMANDÉE OU AVANT, jamais après.
//
// La BCE ne cote ni les week-ends ni les jours fériés TARGET, et le taux du jour ne paraît que vers
// 16h : une facture datée d'un samedi n'a pas de taux à sa date, et l'usage comptable est de retenir
// la dernière cotation qui la précède. Prendre la suivante convertirait une facture avec un cours qui
// n'existait pas encore le jour où elle a été émise.
export function tauxApplicable(cotations: Cotation[], date: string): Cotation | null {
  let retenue: Cotation | null = null
  for (const cotation of cotations) {
    if (cotation.date > date) continue
    if (!retenue || cotation.date > retenue.date) retenue = cotation
  }
  return retenue
}

// Convention BCE : `taux` est le nombre d'unités de devise pour 1 EUR (USD 1,1698 = 1 EUR vaut
// 1,1698 $). On DIVISE donc pour aller vers l'euro. L'inverser est l'erreur qui ne se voit pas — sur
// un dollar à 1,17 elle donne un montant plausible, seulement faux de 37 %.
export function enEuros(montant: number, taux: number): number {
  return Math.round((montant / taux) * 100) / 100
}

export interface MontantsPiece {
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
}

// Convertit les trois montants d'une pièce.
//
// Le TTC est DÉDUIT de la somme des deux autres, il n'est pas converti pour lui-même. Converti
// séparément, chacun des trois est arrondi au centime de son côté et la somme peut tomber à côté :
// HT 0,05 + TVA 0,05 = TTC 0,10 à un taux de 3 donne 0,02 + 0,02 = 0,04 d'un côté, 0,03 de l'autre.
// La pièce serait alors signalée par le contrôle de TVA impossible (voir lib/controles.ts) alors que
// la seule fautive est la conversion. L'écart avec une conversion directe du TTC ne dépasse jamais un
// centime, et l'identité HT + TVA = TTC, elle, ne souffre aucun écart.
//
// Quand le HT ou la TVA manque, le TTC est converti directement : il n'y a rien à additionner, et
// refuser de convertir laisserait la pièce en devise étrangère dans une comptabilité en euros.
export function convertirMontants(montants: MontantsPiece, taux: number): MontantsPiece {
  const ht = montants.montant_ht == null ? null : enEuros(montants.montant_ht, taux)
  const tva = montants.montant_tva == null ? null : enEuros(montants.montant_tva, taux)
  const ttc = ht != null && tva != null
    ? Math.round((ht + tva) * 100) / 100
    : montants.montant_ttc == null ? null : enEuros(montants.montant_ttc, taux)
  return { montant_ht: ht, montant_tva: tva, montant_ttc: ttc }
}

// « 24,00 USD au taux du 08/07/2025 (1 EUR = 1,1698 USD) » — la phrase qui permet de refaire le
// calcul sans rouvrir quoi que ce soit, et de le justifier devant un contrôle des années plus tard.
export function libelleConversion(montantDevise: number, devise: string, taux: number, dateTaux: string): string {
  const [annee, mois, jour] = dateTaux.split('-')
  const montant = montantDevise.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cours = taux.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
  return `${montant} ${devise} au taux BCE du ${jour}/${mois}/${annee} (1 EUR = ${cours} ${devise})`
}
