import { classeDuCompte, type LigneBalance } from './balanceImport'
import {
  COMPTE_BANQUE, COMPTE_RESULTAT_BENEFICE, COMPTE_RESULTAT_PERTE, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE,
} from './comptes'
import { formatMoney } from './format'
import type { OuvertureBanque } from './planTresorerie'
import type { ANouveau } from './types'

// Les À-NOUVEAUX d'un dossier repris d'un autre logiciel : les soldes des comptes de bilan à la
// reprise, tirés de la balance que `balanceImport.ts` lit et contrôle. C'est ce que la balance
// reprise devient — décision du cabinet du 26/09/2026 (ligne 29 de la feuille de route), préférée à
// une comparaison ou à une simple référence affichée.
//
// CE QUE ÇA CHANGE : sans eux, un dossier repris part de ZÉRO. Le solde de la banque ne compte que
// les écritures passées dans l'application, donc la trésorerie, la situation intermédiaire et le plan
// qu'on montre à une banque partent d'un chiffre faux dès que le compte existait avant la reprise.
//
// Pur, sans accès à la base : il prépare ce qu'`enregistrer_a_nouveaux` écrira et le montre d'abord.
// Cinq règles, et chacune répare une façon de se tromper sans le voir :
//
//   - **Seuls les comptes de bilan s'ouvrent** (classes 1 à 5). Une charge ou un produit appartient à
//     l'exercice qui l'a porté ; la reporter ferait compter l'année précédente dans la suivante.
//   - **Le résultat de l'exercice précédent** — les classes 6 et 7 d'une balance d'avant clôture — est
//     repris en 120 (bénéfice) ou 129 (perte), EN ATTENTE D'AFFECTATION. L'application ne décide pas de
//     son affectation (compte de l'exploitant, associés…) : c'est l'arbitrage du cabinet. Sur une
//     balance d'après clôture, les classes 6 et 7 sont soldées et cette ligne n'existe pas.
//   - **La classe 8 doit être soldée**, sinon on refuse. Des engagements hors bilan se compensent
//     entre eux ; un solde qui reste est le signe d'écritures de clôture (891, « bilan de clôture »),
//     qui retirent les comptes de bilan de la balance — les ouvrir tels quels déséquilibrerait tout.
//   - **Un compte de banque de la balance est ramené au compte banque de l'application** (512000), et
//     un compte de TVA écrit sur une autre longueur à son équivalent (44566 → 445660). Sans ça, le FEC
//     porterait l'ouverture de la banque sur un compte et ses mouvements sur un autre, et le solde de
//     trésorerie ignorerait l'ouverture. L'application ne tient qu'UN compte banque : plusieurs
//     comptes 512… de la balance y sont donc réunis, et l'écran le dit (`rapproches`).
//   - **Au centime près**, en centimes entiers. `controlerBalance` tolère un centime d'arrondi
//     d'export pour dire « équilibrée » ; des à-nouveaux, eux, doivent l'être exactement, sans quoi le
//     FEC de l'exercice s'ouvrirait déséquilibré. La base refuse d'ailleurs le contraire.
//
// UNE LIGNE PAR LIGNE DE BALANCE, jamais regroupées : chaque à-nouveau garde le numéro lu dans le
// fichier (`compteOrigine`), et c'est ce qui permet de dire d'où il vient.

/** Une ligne d'à-nouveau telle qu'elle partira à `enregistrer_a_nouveaux`. */
export interface LigneANouveau {
  compte: string
  /** Le numéro lu dans la balance ; nul pour le résultat, que l'application calcule. */
  compteOrigine: string | null
  libelle: string
  sens: 'debit' | 'credit'
  montant: number
}

export interface PreparationANouveaux {
  /** Tout ce qui sera écrit, résultat compris. */
  lignes: LigneANouveau[]
  /** La ligne du résultat de l'exercice précédent, aussi présente dans `lignes` ; nulle s'il est nul. */
  resultat: LigneANouveau | null
  /** Comptes de la balance repris sous le numéro d'un compte de l'application. */
  rapproches: { compteOrigine: string; libelle: string; compte: string }[]
  /** Comptes de bilan soldés : rien à ouvrir. */
  soldes: number
  /** Comptes de classe 8, écartés : hors bilan. */
  classe8: number
  totalDebit: number
  totalCredit: number
  /** Non nul : ces à-nouveaux ne peuvent PAS être enregistrés, et la phrase dit pourquoi. */
  refus: string | null
}

const COMPTES_DE_L_APPLICATION = [COMPTE_BANQUE, COMPTE_TVA_DEDUCTIBLE, COMPTE_TVA_COLLECTEE]

// Les chiffres qui comptent d'un numéro de compte : les zéros de fin ne sont qu'une longueur
// d'affichage, propre à chaque logiciel (44566, 445660 et 44566000 sont le même compte).
const significatif = (compte: string) => compte.replace(/0+$/, '')

/** Le compte de l'application sous lequel reprendre un compte lu dans une balance. */
export function compteDeLApplication(numero: string): string {
  const compte = numero.trim()
  if (compte.startsWith('512')) return COMPTE_BANQUE
  return COMPTES_DE_L_APPLICATION.find((c) => significatif(c) === significatif(compte)) ?? compte
}

const enCentimes = (montant: number) => Math.round(montant * 100)

/**
 * Le libellé du résultat d'un exercice EN ATTENTE D'AFFECTATION, en 120 (bénéfice) ou 129 (perte). Le même pour la
 * reprise d'une balance et pour le report des soldes d'un exercice validé (lib/reportDesSoldes.ts), que la base écrit
 * mot pour mot (`soldes_a_reporter`).
 */
export function libelleDuResultat(exercice: number, benefice: boolean): string {
  return `Résultat de l’exercice ${exercice} (${benefice ? 'bénéfice' : 'perte'}), en attente d’affectation`
}

/** La date des à-nouveaux qui ouvrent un exercice : son 1er janvier, les exercices étant civils. */
export function dateOuverture(exercice: number): string {
  return `${exercice}-01-01`
}

export function preparerANouveaux(balance: readonly LigneBalance[], exerciceOuvert: number): PreparationANouveaux {
  const lignes: LigneANouveau[] = []
  const rapproches: PreparationANouveaux['rapproches'] = []
  // Débit − crédit, en centimes.
  let resultat = 0
  let soldeClasse8 = 0
  let classe8 = 0
  let soldes = 0

  for (const l of balance) {
    const classe = classeDuCompte(l.compte)
    const net = enCentimes(l.debit) - enCentimes(l.credit)
    if (classe === 6 || classe === 7) {
      resultat += net
      continue
    }
    if (classe === 8) {
      classe8++
      soldeClasse8 += net
      continue
    }
    // `lireBalance` ne rend que des numéros du PCG : ce cas ne se produit pas, mais un compte qu'on ne
    // sait pas classer ne s'ouvre pas au jugé.
    if (classe === null) continue
    if (net === 0) {
      soldes++
      continue
    }
    const origine = l.compte.trim()
    const compte = compteDeLApplication(origine)
    if (compte !== origine) rapproches.push({ compteOrigine: origine, libelle: l.libelle, compte })
    lignes.push({
      compte,
      compteOrigine: origine,
      libelle: l.libelle,
      sens: net > 0 ? 'debit' : 'credit',
      montant: Math.abs(net) / 100,
    })
  }

  const ligneResultat: LigneANouveau | null = resultat === 0 ? null : {
    compte: resultat < 0 ? COMPTE_RESULTAT_BENEFICE : COMPTE_RESULTAT_PERTE,
    compteOrigine: null,
    libelle: libelleDuResultat(exerciceOuvert - 1, resultat < 0),
    sens: resultat < 0 ? 'credit' : 'debit',
    montant: Math.abs(resultat) / 100,
  }
  if (ligneResultat) lignes.push(ligneResultat)

  const totalDebit = lignes.filter((l) => l.sens === 'debit').reduce((s, l) => s + enCentimes(l.montant), 0)
  const totalCredit = lignes.filter((l) => l.sens === 'credit').reduce((s, l) => s + enCentimes(l.montant), 0)

  let refus: string | null = null
  if (soldeClasse8 !== 0) {
    refus = `Les comptes de classe 8 de cette balance ne sont pas soldés (${formatMoney(Math.abs(soldeClasse8) / 100)}) : `
      + 'ce sont probablement des écritures de clôture (891, « bilan de clôture »), qui retirent les comptes '
      + 'de bilan de la balance. Reprenez la balance d’avant ces écritures.'
  } else if (totalDebit !== totalCredit) {
    refus = `Les à-nouveaux ne s’équilibrent pas au centime (écart de ${formatMoney(Math.abs(totalDebit - totalCredit) / 100)}) : `
      + 'la balance elle-même n’est pas exactement équilibrée. Un centime d’arrondi suffit à fausser '
      + 'l’ouverture du FEC — reprenez l’export avant de l’enregistrer.'
  } else if (lignes.length === 0) {
    refus = 'Aucun solde à reprendre : tous les comptes de bilan de cette balance sont soldés.'
  }

  return {
    lignes,
    resultat: ligneResultat,
    rapproches,
    soldes,
    classe8,
    totalDebit: totalDebit / 100,
    totalCredit: totalCredit / 100,
    refus,
  }
}

// Le solde du compte banque à l'ouverture. Des à-nouveaux SANS ligne de banque disent quand même
// quelque chose : la banque était soldée à la reprise — un zéro CONNU, pas une absence de donnée.
// D'où un solde nul plutôt que `null`, qui voudrait dire « pas d'ouverture ».
//
// Une seule date par dossier, la base le garantit (trigger `a_nouveaux_une_seule_ouverture`) : la
// première ligne la porte pour toutes.
export function ouvertureBanque(aNouveaux: readonly ANouveau[]): OuvertureBanque | null {
  if (aNouveaux.length === 0) return null
  const centimes = aNouveaux
    .filter((a) => a.compte === COMPTE_BANQUE)
    .reduce((s, a) => s + (a.sens === 'debit' ? 1 : -1) * enCentimes(a.montant), 0)
  return { date: aNouveaux[0].date, solde: centimes / 100 }
}

// Le libellé d'écriture d'un à-nouveau, le même dans le FEC et dans la piste d'audit : il porte le
// numéro de la balance d'origine quand l'application l'a repris sous un autre — c'est la seule trace
// de ce rapprochement une fois le fichier parti.
export function libelleEcritureANouveau(a: ANouveau): string {
  const origine = a.compte_origine && a.compte_origine !== a.compte ? `${a.compte_origine} ` : ''
  return `À-nouveau ${origine}${a.libelle}`.trim()
}
