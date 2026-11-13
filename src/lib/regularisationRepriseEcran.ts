import { libelleCompteTenu } from './comptes'
import { formatDate } from './format'
import {
  composerRegularisationReprise, compteDeLaRepriseAdmis, racinesDeLaReprise, type EcritureDInventaire, type ExerciceDeLaReprise,
  type NatureReprise,
} from './inventaire'
import { comptesReprisNonExtournes, type CompteReprisNonExtourne } from './inventaireDeLaValidation'
import {
  CHOIX_DU_CABINET, centimesDeLaSaisie, derniereValidee, euros, natureAvecTvaDAttente, texteDesCentimes,
  type ContexteDeLInventaire, type DonneesDeLInventaire,
} from './inventaireEcran'
import { ligneDeLaCitation, refusDeLaPieceDUneRegularisation, type Citation, type JustificatifsDuDossier } from './justificatifsDeLInventaire'
import type { ANouveau, OperationInventaire } from './types'

// LA RÉGULARISATION REPRISE D'UNE BALANCE, À L'ÉCRAN (ligne 35, INV3-Q2 (A) ; docs/conceptions/35-inventaire.md, § 11). Un module
// PUR : la section de l'onglet Inventaire (src/pages/dossier/RegularisationsReprises.tsx) appelle, affiche et passe ses gestes
// au verrou de l'onglet ; ici se décident, sur la saisie TELLE QU'ELLE PART, le verdict aux mots de la base
// (`composerRegularisationReprise`, lib/inventaire.ts), les arguments exacts de `enregistrer_operation_inventaire` (`reprise:
// true`, l'exercice que la balance clôt, la seule extourne), ce que la confirmation NOMME, et ce que la validation du premier
// exercice retiendra (`comptesReprisNonExtournes`, lib/inventaireDeLaValidation.ts).
//
// UNE BALANCE REPRISE AU 1er JANVIER qui porte d'anciennes CCA, PCA, FNP ou FAE (486, 487, 408, 418) : leur constatation est
// dans la balance, l'exercice qu'elle clôt (N−1) n'est pas tenu ici ; seule l'EXTOURNE au 1er janvier de N s'écrit, sous la
// pièce « Inventaire N−1 ». Le compte de régularisation se CHOISIT parmi les comptes de la balance sous la racine de sa nature
// (le 4084 excepté) : jamais tapé, jamais pris au plan — un sous-compte repris que le plan ne porte pas ne bloque rien.

/** Une ligne de la balance reprise, telle que la section la lit (lib/balanceRepriseDeLInventaireLecture.ts). */
export type LigneDeLaBalanceReprise = Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>

/** Les natures qu'une régularisation reprise peut avoir, dans l'ordre du document, et leurs libellés. */
export const NATURES_DE_LA_REPRISE: readonly NatureReprise[] = ['cca', 'pca', 'fnp', 'fae']

/** La date des premiers à-nouveaux (AAAA-MM-JJ), lue sur la balance entière ; nulle : aucune balance reprise. */
export function ouvertureDeLaBalance(lignes: readonly Pick<LigneDeLaBalanceReprise, 'date'>[]): string | null {
  return lignes.reduce<string | null>((min, l) => (min === null || l.date < min ? l.date : min), null)
}

/** La balance reprise ouvre-t-elle CET exercice au 1er janvier ? Sinon, aucune régularisation reprise ne s'y saisit. */
export const repriseOuverteSur = (exercice: number, ouverture: string | null): boolean => ouverture === `${exercice}-01-01`

/** La pièce sous laquelle l'extourne d'une régularisation reprise s'écrit : « Inventaire N−1 », l'exercice que la balance clôt. */
export const pieceDeLaReprise = (exercice: number): string => `Inventaire ${exercice - 1}`

/** Un compte de la balance qu'une régularisation reprise de cette nature peut extourner, et son solde repris (débit positif). */
export interface CompteDeLaBalance {
  compte: string
  soldeCentimes: number
}

const centimesDe = (montant: number) => Math.round(montant * 100)

/** Les comptes de la balance sous la racine de la nature (le 4084 excepté, `compteDeLaRepriseAdmis`), dans l'ordre des numéros,
 *  avec leur solde repris. Vide : la balance ne porte rien à reprendre pour cette nature. */
export function comptesDeLaBalancePourLaNature(lignes: readonly LigneDeLaBalanceReprise[], nature: NatureReprise): CompteDeLaBalance[] {
  const soldes = new Map<string, number>()
  for (const l of lignes) {
    if (!compteDeLaRepriseAdmis(nature, l.compte)) continue
    soldes.set(l.compte, (soldes.get(l.compte) ?? 0) + (l.sens === 'debit' ? 1 : -1) * centimesDe(l.montant))
  }
  return [...soldes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([compte, soldeCentimes]) => ({ compte, soldeCentimes }))
}

/** Le solde d'un compte de la balance, dit à l'écran : son montant et son sens. */
export const soldeDit = (centimes: number): string =>
  centimes === 0 ? 'soldé' : `${euros(Math.abs(centimes))} ${centimes > 0 ? 'au débit' : 'au crédit'}`

/** Les racines d'une nature, dites : « sous le 486 ». */
export const racinesDites = (nature: NatureReprise): string => racinesDeLaReprise(nature).join(', ')

// ── Le formulaire ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FormulaireDeLaReprise {
  nature: NatureReprise
  /** Le compte de la balance qu'elle extourne, CHOISI parmi ceux de la balance ; vide : rien de choisi. */
  compteRegularisation: string
  /** Le compte de charge (classe 6) ou de produit (classe 7) que l'extourne reprend. */
  compteResultat: string
  montant: string
  tva: string
  objet: string
  pieceCitee: string | null
}

export const formulaireDeRepriseVide = (nature: NatureReprise): FormulaireDeLaReprise =>
  ({ nature, compteRegularisation: '', compteResultat: '', montant: '', tva: '', objet: '', pieceCitee: null })

/** Le formulaire d'une régularisation reprise existante, pour la REMPLACER : ce que la base porte, la pièce citée proposée. */
export function formulaireDeLaRepriseLue(o: OperationInventaire): FormulaireDeLaReprise {
  const nature = (NATURES_DE_LA_REPRISE as readonly string[]).includes(o.nature) ? o.nature as NatureReprise : 'cca'
  return {
    nature, compteRegularisation: o.compte_regularisation, compteResultat: o.compte_resultat,
    montant: texteDesCentimes(o.montant_centimes), tva: o.tva_centimes > 0 ? texteDesCentimes(o.tva_centimes) : '',
    objet: o.objet, pieceCitee: o.piece_citee_id,
  }
}

/** L'exercice de la régularisation reprise tel que le module le juge : N−1, figé dès que N−1 ou un suivant est validé. */
export function exerciceDeLaRepriseALEcran(ctx: ContexteDeLInventaire, ouverture: string | null): ExerciceDeLaReprise {
  const derniere = derniereValidee(ctx.anneesValidees)
  const exercice = ctx.exercice - 1
  return { exercice, valide: derniere !== null && exercice <= derniere, anneeEnCours: Number(ctx.aujourdhui.slice(0, 4)), ouverture }
}

// ── Le verdict ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type VerdictDeLaReprise =
  | {
    etat: 'permis'
    appel: { operation: Record<string, unknown>; ecritures: EcritureDInventaire[]; versionLue: number | null }
    extourne: EcritureDInventaire
    confirmation: string
  }
  | { etat: 'refuse'; refus: string[] }

const SENS = { debit: 'Débit', credit: 'Crédit' } as const
const lignesDite = (e: EcritureDInventaire) => e.lignes.map((l) => `${SENS[l.sens]} ${l.compte} ${euros(l.centimes)}`).join(' ; ')

/** La confirmation : elle NOMME ce qui part — la seule extourne, sa date, ses comptes et ses montants, le libellé qui ira au FEC,
 *  la pièce « Inventaire N−1 », et la pièce citée. */
export function confirmationDeLaReprise(extourne: EcritureDInventaire, exercice: number, remplace: OperationInventaire | null, citation: string): string {
  return [
    remplace === null ? 'Enregistrer cette régularisation reprise de la balance ?' : 'Remplacer cette régularisation reprise ? Son extourne est réécrite.',
    `Sa constatation est dans la balance reprise : seule l’extourne au ${formatDate(extourne.date)} s’écrit, au journal des opérations diverses.`,
    `Au ${formatDate(extourne.date)} (extourne) : ${lignesDite(extourne)}.`,
    `Libellé, qui part au FEC : « ${extourne.libelle} », sous la pièce « ${pieceDeLaReprise(exercice)} ».`,
    citation,
  ].join('\n')
}

/**
 * Le verdict d'une régularisation reprise, TELLE QU'ELLE PART, sur l'exercice affiché N (celui que la balance ouvre) : les refus
 * de `composerRegularisationReprise` dans l'ordre de la base (le mode, l'exercice N−1, sa place, la nature, le plan de la TVA
 * d'attente, les comptes, les montants, l'objet), puis la pièce citée (l'étape 10), jugée sur les pièces LUES (`justificatifs`,
 * nul : pas lues, la base jugera seule). `remplace` : la régularisation reprise que la saisie remplace, dont la version est
 * retenue. Aucune période : une régularisation reprise n'a pas de prorata.
 */
export function verdictDeLaReprise(
  f: FormulaireDeLaReprise, ctx: ContexteDeLInventaire, d: Pick<DonneesDeLInventaire, 'comptes'>, ouverture: string | null,
  remplace: OperationInventaire | null, justificatifs: JustificatifsDuDossier | null,
): VerdictDeLaReprise {
  const saisie = {
    nature: f.nature,
    compteResultat: f.compteResultat.trim(),
    libelleCompteResultat: libelleCompteTenu(f.compteResultat.trim()),
    compteRegularisation: f.compteRegularisation.trim(),
    montantCentimes: centimesDeLaSaisie(f.montant, false),
    tvaCentimes: natureAvecTvaDAttente(f.nature, ctx.assujettiTva) ? centimesDeLaSaisie(f.tva, true) : 0,
    objet: f.objet.trim(),
  }
  const exercice = exerciceDeLaRepriseALEcran(ctx, ouverture)
  const composition = composerRegularisationReprise(saisie, {
    modeComptable: ctx.mode, assujettiTva: ctx.assujettiTva, comptes: d.comptes, exercice,
    tvaDesFacturesAttendues: CHOIX_DU_CABINET.tvaDesFacturesAttendues,
  })
  const refus = composition.ok ? [] : composition.refus.map((r) => r.message)
  const refusDeLaPiece = refusDeLaPieceDUneRegularisation(f.pieceCitee, justificatifs)
  if (refusDeLaPiece !== null) refus.push(refusDeLaPiece)
  if (!composition.ok || refusDeLaPiece !== null) return { etat: 'refuse', refus }
  const citation: Citation | null = f.pieceCitee === null ? null : { genre: 'piece', id: f.pieceCitee }
  return {
    etat: 'permis',
    appel: {
      operation: {
        id: remplace?.id ?? null, exercice: exercice.exercice, nature: f.nature, compte_resultat: saisie.compteResultat,
        compte_regularisation: saisie.compteRegularisation, montant_centimes: saisie.montantCentimes, tva_centimes: saisie.tvaCentimes,
        objet: saisie.objet, periode_debut: null, periode_fin: null, piece_citee_id: f.pieceCitee, reprise: true,
      },
      ecritures: [composition.extourne],
      versionLue: remplace?.version ?? null,
    },
    extourne: composition.extourne,
    confirmation: confirmationDeLaReprise(composition.extourne, ctx.exercice, remplace, ligneDeLaCitation(citation, justificatifs)),
  }
}

// ── Ce que la section montre ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les régularisations reprises qu'ouvre l'exercice affiché : celles de l'exercice que la balance clôt (N−1). */
export const reprisesDeLExercice = (operations: readonly OperationInventaire[], exercice: number): OperationInventaire[] =>
  operations.filter((o) => o.reprise && o.exercice === exercice - 1)
    .sort((a, b) => NATURES_DE_LA_REPRISE.indexOf(a.nature as NatureReprise) - NATURES_DE_LA_REPRISE.indexOf(b.nature as NatureReprise)
      || a.objet.localeCompare(b.objet, 'fr') || (a.id < b.id ? -1 : 1))

/** Ce que la validation de l'exercice retiendra (`reprise-non-extournee`) : chaque compte de régularisation repris que les
 *  extournes enregistrées ne soldent pas, son solde repris et ce qu'il en reste — sur la balance et les lignes LUES en entier. */
export function ceQueLaValidationRetiendra(
  balance: readonly LigneDeLaBalanceReprise[], d: Pick<DonneesDeLInventaire, 'operations' | 'lignes'>, exercice: number,
): CompteReprisNonExtourne[] {
  return comptesReprisNonExtournes(balance, d.operations, d.lignes, exercice)
}
