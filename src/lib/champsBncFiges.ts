import { natureDuCompte } from './affectationBanque'
import { POSTES_RATTACHES, posteRattache } from './cases2035'
import { MODES_REGLEMENT, NATURES_OPERATION } from './champsBncDuFec'
import { sirenValide, siretValide } from './factureCii'
import type { FactureEmise } from './types'

// LES QUATRE CHAMPS DU FEC D'UN BNC, FIGÉS PAR LA VALIDATION (ligne 26.6, étape e ; lot FEC22b ; MVP-D5). La migration
// `champs_bnc_du_fec` (supabase/preparees/, puis l'export sous sa version) pose cinq colonnes nulles sur
// `ecritures_brouillon` — `date_reglement`, `mode_reglement`, `nature_operation`, `poste_rattache`, `identification_client`
// —, et `valider_exercice` les reçoit dans `p_lignes`, les juge et les fige avec chaque ligne, comme sa pièce et son
// numéro (LPF, art. A47 A-1, VIII, 7° ; PCG, art. 1031-3). Une demande qui ne les porte pas valide comme hier.
//
// CE MODULE REDIT LA BASE, IL NE LA REMPLACE PAS : les clés de la demande, les refus neufs de la validation — leur clé,
// leur code et leurs mots, dans l'ordre où elle les dit —, les listes fermées qu'elle copie, et le jugement lui-même, pur,
// pour que l'écran dise un refus AVANT le clic, sur la demande telle qu'elle part (le lot FEC22c2, derrière le drapeau du
// fichier, `CHAMPS_BNC_EXPORTES`). champsBncFiges.test.ts confronte chaque refus et chaque liste au texte de la migration,
// et ce texte à lib/champsBncDuFec.ts et lib/cases2035.ts ; supabase/essais/validationExercice.sql (étapes 150 à 190) joue
// les mêmes cas en base.
//
// UN MODULE PUR : il ne lit ni la base ni l'horloge — le jour de Paris est un paramètre, comme le reste de ce qu'il juge.
// Les préalables de la validation l'appellent depuis FEC22c2 (lib/prealablesValidation.ts, `champs-bnc`), le drapeau levé ;
// baissé, la demande ne porte pas ces clés, et la migration est neutre pour elle.

// ── Les clés de la demande, les colonnes de la base ────────────────────────────────────────────────────────────────────

/** Les cinq colonnes que la migration pose, et les cinq clés de `p_lignes` que `valider_exercice` lit, dans cet ordre. */
export const COLONNES_CHAMPS_BNC = [
  'date_reglement', 'mode_reglement', 'nature_operation', 'poste_rattache', 'identification_client',
] as const
export type ColonneChampsBnc = (typeof COLONNES_CHAMPS_BNC)[number]

// Ce qu'une ligne de la demande porte de plus, le poste que NatOp porte, les cinq clés d'une ligne de la demande et la NatOp
// d'une ligne validée vivent dans lib/champsBncDesLignes.ts depuis FEC22c2, et se redisent ici : la numérotation (lib/fec.ts) et
// la demande (lib/validationExercice.ts) les lisent, et ce module-ci, qui calcule ses listes au chargement depuis
// lib/cases2035.ts, ne peut pas entrer dans le cycle de leurs imports (cases2035 → declaration2035 → amortissements →
// validationExercice) sans s'évaluer avant elles.
export { champsDeLaLigneDemandee, natOpFigee, posteDeLaNatOp, type ChampsBncDUneLigne } from './champsBncDesLignes'

// ── Les listes fermées que la base copie ───────────────────────────────────────────────────────────────────────────────

/**
 * Les postes que la 2035 range, chacun avec la classe des comptes qui le portent, tirée de `posteRattache` lui-même — la
 * nature sous laquelle la 2035 le range (`cadreCompatible`, lib/cases2035.ts), comme la NatOp d'une ligne le lit
 * (`natOpDeLaLigne`, lib/champsBncDuFec.ts) : 7, un produit, pour un poste rangé sous une RECETTE ; 6, une charge, pour
 * un poste rangé sous une DÉPENSE — ceux des dépenses, et ceux des deux cases qui se retranchent des recettes (AB, les
 * débours ; AC, les honoraires rétrocédés), qui ne reçoivent qu'une dépense : la rétrocession payée à un remplaçant est
 * une charge. Un poste rangé sous les deux natures, ou sous aucune, est une faute de la table, qui se lève. La migration
 * en copie la liste (`postes(poste, classe)`, et les deux de sa contrainte) ; le test les confronte.
 */
export const CLASSE_DU_POSTE: ReadonlyMap<string, '6' | '7'> = new Map(POSTES_RATTACHES.map((poste) => {
  const recette = posteRattache(poste, 'recette') === poste
  const depense = posteRattache(poste, 'depense') === poste
  if (recette === depense) {
    throw new Error(`Le poste rattaché « ${poste} » se range sous ${recette ? 'les deux natures' : 'aucune nature'}.`)
  }
  return [poste, recette ? '7' : '6'] as const
}))

// ── Les refus neufs de la validation ───────────────────────────────────────────────────────────────────────────────────

/**
 * Les refus que `valider_exercice` ajoute, dans l'ordre où elle les dit — après tous ceux d'hier, le premier défaut
 * l'emportant —, avec leur code et leurs mots, au caractère près. champsBncFiges.test.ts les relit dans la migration.
 */
export const REFUS_DES_CHAMPS_BNC = [
  { cle: 'date_illisible', code: '22023', message: 'Une ligne de la numérotation proposée porte une date de règlement illisible.' },
  { cle: 'date_future', code: '22023', message: "Une ligne de la numérotation proposée porte une date de règlement postérieure à aujourd'hui." },
  { cle: 'mode_hors_liste', code: '22023', message: 'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.' },
  { cle: 'nature_hors_liste', code: '22023', message: "Une ligne de la numérotation proposée porte une nature d'opération hors de sa liste." },
  { cle: 'poste_hors_liste', code: '22023', message: 'Une ligne de la numérotation proposée porte un poste de la 2035 hors de sa liste.' },
  { cle: 'poste_sans_nature', code: '22023', message: "Une ligne de la numérotation proposée porte un poste de la 2035 sans nature d'opération." },
  {
    cle: 'poste_hors_resultat', code: '22023',
    message: "Une ligne de la numérotation proposée porte un poste de la 2035 sur un compte qui n'est ni de charge ni de produit.",
  },
  {
    cle: 'poste_hors_cadre', code: '22023',
    message: 'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.',
  },
  { cle: 'date_differe', code: '22023', message: "Les lignes d'une même écriture ne portent pas la même date de règlement." },
  { cle: 'mode_differe', code: '22023', message: "Les lignes d'une même écriture ne portent pas le même mode de règlement." },
  { cle: 'nature_differe', code: '22023', message: "Les lignes d'une même écriture ne portent pas la même nature d'opération." },
  { cle: 'client_differe', code: '22023', message: "Les lignes d'une même écriture ne portent pas la même identification du client." },
  {
    cle: 'client_inconnu', code: '22023',
    message: "Une ligne de la numérotation proposée identifie le client autrement que par le numéro d'une facture validée du dossier ou par le SIREN qu'elle porte.",
  },
] as const
export type CleDuRefusDesChampsBnc = (typeof REFUS_DES_CHAMPS_BNC)[number]['cle']
export type RefusDesChampsBnc = (typeof REFUS_DES_CHAMPS_BNC)[number]

// ── Le jugement, pur ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Une ligne de la demande telle que la base la juge : son écriture (journal et numéro), son compte — celui de la ligne du
 * brouillon, que la base lit chez elle — et ses cinq valeurs. Une valeur venue d'ailleurs que du composeur (`unknown` d'un
 * JSON relu) se juge aussi : la base reçoit du texte.
 */
export interface LigneAJuger {
  journal: string
  numero: number
  compte: string
  date_reglement: string | null
  mode_reglement: string | null
  nature_operation: string | null
  poste_rattache: string | null
  identification_client: string | null
}

/** Un document du dossier tel que la garde du secret le lit : son numéro, son statut et le SIRET figé de son client. */
export type DocumentDuDossier = Pick<FactureEmise, 'numero' | 'statut' | 'tiers_siret'>

const FORME_DE_DATE = /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Une date du calendrier, AAAA-MM-JJ, ce que la base relit à l'identique (un 30 février n'en est pas une). */
function dateLisible(texte: string): boolean {
  if (!FORME_DE_DATE.test(texte)) return false
  const [a, m, j] = texte.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, j))
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j
}

/** Une valeur est la même sur toutes les lignes d'une écriture quand elle y est partout, une seule, ou nulle partout. */
function differe(valeurs: readonly (string | null)[]): boolean {
  const posees = valeurs.filter((v): v is string => v !== null)
  return new Set(posees).size > 1 || (posees.length !== 0 && posees.length !== valeurs.length)
}

/**
 * Ce qui identifie un client, comme la base le lit : le numéro d'une facture ou d'un avoir VALIDÉ du dossier, ou le SIREN
 * de son client figé — les neuf premiers chiffres de `tiers_siret` quand il n'est fait que de neuf ou de quatorze chiffres
 * et passe ses clés (`sirenValide`, `siretValide` : La Poste et son siège compris). Jamais un nom.
 */
export function identificationsAdmises(documents: readonly DocumentDuDossier[]): ReadonlySet<string> {
  const admises = new Set<string>()
  for (const d of documents) {
    if (d.statut !== 'validee' || d.numero === null || d.numero === '') continue
    admises.add(d.numero)
    const s = d.tiers_siret
    if (s !== null && /^\d{14}$/.test(s) && siretValide(s) && sirenValide(s.slice(0, 9))) admises.add(s.slice(0, 9))
    if (s !== null && /^\d{9}$/.test(s) && sirenValide(s)) admises.add(s)
  }
  return admises
}

/**
 * Le premier refus de la validation pour les quatre champs d'une demande, ou nul : le jugement de la base, dans son ordre
 * (`REFUS_DES_CHAMPS_BNC`). `documents` : les factures et avoirs du dossier, LUS EN ENTIER (une liste partielle ferait
 * refuser un client connu) ; `aujourdhuiAParis` : le jour de Paris, AAAA-MM-JJ. Il ne juge que les champs neufs : les refus
 * d'hier (`defautsDeNumerotation`, lib/validationExercice.ts) passent avant, en base comme ici.
 */
export function refusDesChampsBnc(
  lignes: readonly LigneAJuger[],
  documents: readonly DocumentDuDossier[],
  aujourdhuiAParis: string,
): RefusDesChampsBnc | null {
  const premier = (cle: CleDuRefusDesChampsBnc): RefusDesChampsBnc => {
    const r = REFUS_DES_CHAMPS_BNC.find((x) => x.cle === cle)
    if (r === undefined) throw new Error(`Refus inconnu : ${cle}`)
    return r
  }
  const modes: ReadonlySet<string> = new Set(MODES_REGLEMENT)
  const natures: ReadonlySet<string> = new Set(NATURES_OPERATION)
  if (lignes.some((l) => l.date_reglement !== null && !dateLisible(l.date_reglement))) return premier('date_illisible')
  if (lignes.some((l) => l.date_reglement !== null && l.date_reglement > aujourdhuiAParis)) return premier('date_future')
  if (lignes.some((l) => l.mode_reglement !== null && !modes.has(l.mode_reglement))) return premier('mode_hors_liste')
  if (lignes.some((l) => l.nature_operation !== null && !natures.has(l.nature_operation))) return premier('nature_hors_liste')
  if (lignes.some((l) => l.poste_rattache !== null && !CLASSE_DU_POSTE.has(l.poste_rattache))) return premier('poste_hors_liste')
  if (lignes.some((l) => l.poste_rattache !== null && l.nature_operation === null)) return premier('poste_sans_nature')
  if (lignes.some((l) => l.poste_rattache !== null && natureDuCompte(l.compte) === null)) return premier('poste_hors_resultat')
  if (lignes.some((l) => l.poste_rattache !== null && CLASSE_DU_POSTE.get(l.poste_rattache) !== l.compte.slice(0, 1))) {
    return premier('poste_hors_cadre')
  }
  const ecritures = new Map<string, LigneAJuger[]>()
  for (const l of lignes) {
    const cle = `${l.journal}|${l.numero}`
    ecritures.set(cle, [...(ecritures.get(cle) ?? []), l])
  }
  const groupes = [...ecritures.values()]
  if (groupes.some((g) => differe(g.map((l) => l.date_reglement)))) return premier('date_differe')
  if (groupes.some((g) => differe(g.map((l) => l.mode_reglement)))) return premier('mode_differe')
  if (groupes.some((g) => differe(g.map((l) => l.nature_operation)))) return premier('nature_differe')
  if (groupes.some((g) => differe(g.map((l) => l.identification_client)))) return premier('client_differe')
  const admises = identificationsAdmises(documents)
  if (lignes.some((l) => l.identification_client !== null && !admises.has(l.identification_client))) return premier('client_inconnu')
  return null
}
