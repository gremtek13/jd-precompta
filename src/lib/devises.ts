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

// Le taux réellement subi, déduit d'un rapprochement bancaire — et non demandé à la BCE.
//
// C'est la meilleure source possible, et pas seulement la plus pratique : en BNC, la dépense
// déductible est ce qui a RÉELLEMENT quitté le compte. Le relevé porte ce montant en euros, spread de
// la banque et frais de change compris, là où le taux BCE n'en est qu'une approximation à quelques
// pourcents près. Le cours du jour cesse donc d'être nécessaire au chiffre définitif ; il ne sert plus
// qu'à donner une valeur provisoire en attendant le relevé.
export function tauxDepuisBanque(montantDevise: number, montantEuros: number): number | null {
  if (montantEuros === 0) return null
  return Math.abs(montantDevise) / Math.abs(montantEuros)
}

export interface MontantsRegles extends MontantsPiece {
  taux_change: number
}

// Réécrit les trois montants d'une pièce en devise à partir du montant réellement débité.
//
// La PROPORTION de TVA est conservée telle que le document l'écrit — c'est elle qui est juste, et
// elle ne dépend d'aucun taux de change. Seule l'échelle change. Le HT est ensuite déduit par
// soustraction plutôt que mis à l'échelle lui aussi : deux arrondis indépendants laisseraient
// HT + TVA ≠ TTC, et la pièce serait signalée comme une TVA impossible (voir lib/controles.ts) alors
// que seul le rapprochement a bougé.
//
// Sans TVA lue sur le document, il n'y a rien à répartir : le TTC prend le montant réel et les deux
// autres restent ce qu'ils sont. Inventer une ventilation à partir d'un taux supposé serait écrire un
// chiffre que le document ne porte pas.
export function reglerSurMontantReel(
  montants: MontantsPiece,
  montantDevise: number,
  montantEuros: number,
): MontantsRegles | null {
  const taux = tauxDepuisBanque(montantDevise, montantEuros)
  if (taux == null) return null

  // Le sens reste celui de la pièce, pas celui de la ligne bancaire : un achat est positif sur la
  // pièce et négatif au relevé, et un avoir l'inverse. Le rapprochement a déjà vérifié la cohérence
  // des sens (voir appariementBanque.ts) ; la reprendre ici retournerait chaque montant.
  const signe = Math.sign(montants.montant_ttc ?? montantDevise) || 1
  const ttc = Math.round(Math.abs(montantEuros) * 100) / 100 * signe

  const proportionTva = montants.montant_tva != null && montants.montant_ttc
    ? montants.montant_tva / montants.montant_ttc
    : null
  if (proportionTva == null) {
    return { montant_ht: montants.montant_ht, montant_tva: montants.montant_tva, montant_ttc: ttc, taux_change: taux }
  }

  const tva = Math.round(ttc * proportionTva * 100) / 100
  return { montant_ht: Math.round((ttc - tva) * 100) / 100, montant_tva: tva, montant_ttc: ttc, taux_change: taux }
}

// Écart toléré entre le montant réellement débité et la conversion provisoire, quand on cherche à
// savoir si un mouvement bancaire peut être CELUI de cette facture.
//
// Cinq pour cent : le spread d'une carte sur une opération en devise va couramment jusqu'à 3 %, et le
// cours bouge encore de un ou deux points entre la date de la facture et celle du débit. C'est un
// garde-fou de VRAISEMBLANCE, pas une mesure — il écarte un mouvement sans rapport avec la facture,
// il ne prétend pas confirmer celui-ci. Ce sont la date et le libellé qui identifient le mouvement
// (voir appariementBanque.ts) ; cette borne ne fait que remplacer l'égalité des montants, impossible
// à exiger d'une pièce en devise.
export const ECART_CHANGE_TOLERE = 0.05

export function montantPlausiblePourDevise(ttcConverti: number, montantBanque: number): boolean {
  if (ttcConverti === 0) return false
  const ecart = Math.abs(Math.abs(montantBanque) - Math.abs(ttcConverti)) / Math.abs(ttcConverti)
  return ecart <= ECART_CHANGE_TOLERE
}
