import { auteurDeLaVersion, instantDeLaVersion, referenceDeLEcritureLibre, type EcritureLibreDeLEtat } from './ecrituresLibresDesExports'
import { contrePassationDe, origineDe } from './contrePassationDesEcrituresLibres'
import { classeDeResultat, type ModeComptableDeLEcriture } from './ecritureLibre'
import { dateAParis, formatDate } from './format'
import type { BlocDuPdf } from './lettresDeMissionVue'
import { champCsv, designationDUnePiece } from './pisteAudit'
import { pdfDesBlocs } from './pdfLettreDeMission'
import type { Piece } from './types'

// L'ÉTAT DES ÉCRITURES LIBRES D'UN EXERCICE (EL3 ; conception docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md,
// § 3.6, EL-Q8 (A)). La PIÈCE JUSTIFICATIVE de chaque écriture libre (PCG, art. 1032-2 : chaque écriture s'appuie sur une
// pièce datée) : le FEC la cite sous « EL<année>-<numéro> » (PieceRef), la piste d'audit aussi. Une ligne par ligne d'écriture :
// le numéro, la date, le libellé, le MOTIF (ici seulement : jamais au FEC ni à la piste d'audit), le compte, le débit ou le
// crédit, l'effet sur la 2035, l'extourne, la version, son auteur et son instant, la pièce du dossier citée par son dépôt et
// son empreinte — jamais le nom de son fichier ni son tiers. Un document du cabinet, comme l'état d'inventaire.
//
// Pur, sans réseau : l'appelant passe les écritures libres de l'exercice LUES EN ENTIER (une lecture partielle n'offre pas
// l'état), l'adresse de chaque compte du cabinet qui a écrit (sinon « le cabinet »), et les pièces citées qu'il a lues. Rien
// n'est à l'écran avant EL5 ; le drapeau `ECRITURES_LIBRES_PREVUES` baissé, rien ne l'appelle.
//
// LA CONTRE-PASSATION (RA253-Q1 (A), 26/11/2026) : sous une contre-passation, l'état nomme l'écriture qu'elle annule — « Contre-passe
// EL2025-0003 du 30/06/2025 » —, et sous l'écriture annulée, celle qui l'annule, d'après le LIEN que la base garde
// (`ecritures_libres.contre_passe_id`, EL7), jamais d'après le libellé, que le cabinet a pu changer. Rien d'autre de l'autre écriture
// n'y passe (ni son libellé, ni son motif) : sa référence, par `referenceDeLEcritureLibre`, et sa date. Une écriture citée que la
// lecture ne porte pas se dit « non lue », jamais devinée ni tue. La colonne n'existe que si la lecture porte le lien (le drapeau
// `CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE` levé, `contrePassation` du contexte) : baissé, l'état d'hier à l'octet. Le FEC, la
// piste d'audit et la 2035 ne lisent pas ce lien (contrePassationDansLesMoteurs.test.ts).

export interface ContexteDeLEtat {
  // Le modèle du dossier : en engagement, aucune ligne n'a d'effet sur la 2035.
  mode: ModeComptableDeLEcriture
  // L'adresse de chaque compte qui a écrit une version ; un compte absent se dit « le cabinet ».
  auteurs: ReadonlyMap<string, string>
  // Les pièces que les écritures citent, lues ; une pièce absente se dit « hors du jeu chargé », jamais tue.
  pieces: ReadonlyMap<string, Pick<Piece, 'id' | 'created_at' | 'storage_hash'>>
  // La lecture porte le lien de la contre-passation (`contre_passe_id`, lu sous le drapeau d'EL7 levé) : l'état le nomme. Faux :
  // l'état d'hier, sans la colonne.
  contrePassation: boolean
}

/** Une ligne de l'état : une ligne d'une écriture libre, et ce que son écriture dit. */
export interface LigneDeLEtat {
  reference: string
  date: string
  libelle: string
  motif: string
  compte: string
  compteLib: string
  debitCentimes: number
  creditCentimes: number
  effetSur2035: string
  extourne: boolean
  version: number
  auteur: string
  instant: string
  pieceCitee: string
  pieceEmpreinte: string
  // Ce que le lien de la contre-passation dit de son écriture (`contrePassationDansLEtat`) ; vide sur une écriture ordinaire.
  contrePassation: string
}

/**
 * Ce que l'état dit d'une écriture par le LIEN de la contre-passation, parmi les écritures du dossier lues (tous exercices :
 * l'écriture annulée est souvent dans l'exercice d'avant) : « Contre-passe EL… du … » sous une contre-passation, « Contre-passée par
 * EL… du … » sous l'écriture qu'une autre annule, les deux à la suite si elle l'est à son tour ; « Contre-passe une écriture non lue »
 * quand le lien désigne une écriture absente de la lecture. Vide sur une écriture ordinaire.
 */
export function contrePassationDansLEtat(
  e: Pick<EcritureLibreDeLEtat, 'id' | 'contre_passe_id'>, toutes: readonly EcritureLibreDeLEtat[],
): string {
  const mentions: string[] = []
  if ((e.contre_passe_id ?? null) !== null) {
    const o = origineDe(e, toutes)
    mentions.push(o === null ? 'Contre-passe une écriture non lue' : `Contre-passe ${referenceDeLEcritureLibre(o)} du ${formatDate(o.date)}`)
  }
  const c = contrePassationDe(e, toutes)
  if (c !== null) mentions.push(`Contre-passée par ${referenceDeLEcritureLibre(c)} du ${formatDate(c.date)}`)
  return mentions.join(' ; ')
}

/** L'effet d'une ligne sur la 2035 : son poste, « Hors de la 2035 » pour une ligne de résultat qui n'en porte pas, « — » pour
 *  une ligne de bilan, et toute ligne en engagement (aucune 2035). */
export function effetDeLaLigne(l: { compte: string; poste_2035: string | null }, mode: ModeComptableDeLEcriture): string {
  if (mode !== 'tresorerie' || classeDeResultat(l.compte) === null) return '—'
  return l.poste_2035 ?? 'Hors de la 2035'
}

const HEURE_A_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Un instant, au jour et à l'heure de Paris : « JJ/MM/AAAA à HH:MM ». */
export function instantAParis(instant: string): string {
  return `${formatDate(dateAParis(instant))} à ${HEURE_A_PARIS.format(new Date(instant))}`
}

/** Les lignes de l'état d'un exercice, écriture par écriture dans l'ordre des numéros, ligne par ligne dans l'ordre saisi. */
export function lignesDeLEtat(
  ecritures: readonly EcritureLibreDeLEtat[], exercice: number, contexte: ContexteDeLEtat,
): LigneDeLEtat[] {
  return [...ecritures].filter((e) => e.exercice === exercice)
    .sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id))
    .flatMap((e) => {
      const citee = e.piece_citee_id === null ? null : contexte.pieces.get(e.piece_citee_id) ?? null
      const pieceCitee = e.piece_citee_id === null ? '' : citee === null ? 'Pièce citée hors du jeu chargé' : designationDUnePiece(citee)
      const commun = {
        reference: referenceDeLEcritureLibre(e), date: e.date, libelle: e.libelle, motif: e.motif, extourne: e.avec_extourne,
        version: e.version, auteur: auteurDeLaVersion(e, contexte.auteurs), instant: instantAParis(instantDeLaVersion(e)),
        pieceCitee, pieceEmpreinte: citee?.storage_hash?.trim() ?? '',
        contrePassation: contexte.contrePassation ? contrePassationDansLEtat(e, ecritures) : '',
      }
      return e.lignes.map((l): LigneDeLEtat => ({
        ...commun, compte: l.compte, compteLib: l.compte_lib?.trim() ?? '',
        debitCentimes: l.sens === 'debit' ? l.centimes : 0, creditCentimes: l.sens === 'credit' ? l.centimes : 0,
        effetSur2035: effetDeLaLigne(l, contexte.mode),
      }))
    })
}

/** Un montant au centime, en entiers, virgule décimale, sans séparateur de milliers (le CSV de la piste d'audit). */
export function montantDeLEtat(centimes: number): string {
  const signe = centimes < 0 ? '-' : ''
  const a = Math.abs(centimes)
  return `${signe}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
}

export const COLONNES_DE_L_ETAT = [
  'Numéro', 'Date', 'Libellé', 'Motif', 'Compte', 'Libellé du compte', 'Débit', 'Crédit', 'Effet sur la 2035',
  'Extourne au 1er janvier', 'Version', 'Auteur', 'Instant de la version', 'Pièce citée', 'Empreinte SHA-256',
] as const

/** La colonne du lien de la contre-passation, après l'extourne, quand la lecture porte le lien (RA253-Q1 (A)). */
export const COLONNE_DE_LA_CONTRE_PASSATION_DANS_L_ETAT = 'Contre-passation'

/** Les colonnes du CSV : celles d'hier, et celle de la contre-passation quand la lecture porte le lien. */
export function colonnesDeLEtat(contrePassation: boolean): readonly string[] {
  if (!contrePassation) return COLONNES_DE_L_ETAT
  const rang = COLONNES_DE_L_ETAT.indexOf('Extourne au 1er janvier') + 1
  return [...COLONNES_DE_L_ETAT.slice(0, rang), COLONNE_DE_LA_CONTRE_PASSATION_DANS_L_ETAT, ...COLONNES_DE_L_ETAT.slice(rang)]
}

/** Le CSV de l'état : point-virgule, virgule décimale, chaque texte par `champCsv`, BOM UTF-8 et fins de ligne CRLF — la règle
 *  du premier export CSV de l'application (la piste d'audit). `contrePassation` : la lecture porte le lien (celui du contexte). */
export function genererEtatDesEcrituresLibresCsv(lignes: readonly LigneDeLEtat[], contrePassation: boolean): string {
  const corps = lignes.map((l) => [
    l.reference, formatDate(l.date), champCsv(l.libelle), champCsv(l.motif), l.compte, champCsv(l.compteLib),
    l.debitCentimes === 0 ? '' : montantDeLEtat(l.debitCentimes), l.creditCentimes === 0 ? '' : montantDeLEtat(l.creditCentimes),
    champCsv(l.effetSur2035), l.extourne ? 'oui' : 'non', ...(contrePassation ? [champCsv(l.contrePassation)] : []),
    String(l.version), champCsv(l.auteur), champCsv(l.instant), champCsv(l.pieceCitee), l.pieceEmpreinte,
  ].join(';'))
  return '﻿' + [colonnesDeLEtat(contrePassation).join(';'), ...corps].join('\r\n')
}

/** Le nom du fichier : l'exercice seul, jamais un nom de personne. */
export function nomDuFichierDeLEtat(exercice: number, extension: 'csv' | 'pdf'): string {
  return `etat-des-ecritures-libres-${exercice}.${extension}`
}

export const PIED_DE_L_ETAT =
  'État des écritures libres : la pièce justificative des écritures du journal des opérations diverses qu’il numérote (PCG, art. 1032-2).'

/** Les blocs du PDF : un titre, puis, par écriture, sa référence, sa date et son libellé, ses lignes, son motif et sa trace. */
export function contenuDeLEtat(lignes: readonly LigneDeLEtat[], exercice: number): BlocDuPdf[] {
  const blocs: BlocDuPdf[] = [{ genre: 'titre', texte: `État des écritures libres — exercice ${exercice}` }]
  if (lignes.length === 0) return [...blocs, { genre: 'texte', texte: 'Aucune écriture libre dans cet exercice.' }]
  const parReference = new Map<string, LigneDeLEtat[]>()
  for (const l of lignes) parReference.set(l.reference, [...(parReference.get(l.reference) ?? []), l])
  for (const [reference, ls] of parReference) {
    const e = ls[0]
    blocs.push({ genre: 'intertitre', texte: `${reference} — ${formatDate(e.date)} — ${e.libelle}` })
    for (const l of ls) {
      const sens = l.debitCentimes > 0 ? `Débit ${montantDeLEtat(l.debitCentimes)} €` : `Crédit ${montantDeLEtat(l.creditCentimes)} €`
      const compte = l.compteLib === '' ? l.compte : `${l.compte} ${l.compteLib}`
      blocs.push({ genre: 'texte', texte: `${compte} : ${sens} — 2035 : ${l.effetSur2035}` })
    }
    if (e.extourne) blocs.push({ genre: 'texte', texte: 'Extournée au 1er janvier suivant.' })
    if (e.contrePassation !== '') blocs.push({ genre: 'texte', texte: `${e.contrePassation}.` })
    blocs.push({ genre: 'texte', texte: `Motif : ${e.motif}` })
    const piece = e.pieceCitee === '' ? '' : ` Pièce citée : ${e.pieceCitee}.`
    blocs.push({ genre: 'mention', texte: `Version ${e.version}, le ${e.instant}, par ${e.auteur}.${piece}` })
  }
  return blocs
}

/**
 * Le PDF de l'état (pdf-lib, Helvetica, A4, par `pdfDesBlocs`) : daté de la plus récente version qu'il porte, jamais de
 * l'heure du clic — deux téléchargements des mêmes écritures rendent les mêmes octets.
 */
export function pdfDeLEtat(ecritures: readonly EcritureLibreDeLEtat[], exercice: number, contexte: ContexteDeLEtat): Promise<Uint8Array> {
  const lignes = lignesDeLEtat(ecritures, exercice, contexte)
  const instants = ecritures.filter((e) => e.exercice === exercice).map(instantDeLaVersion).sort()
  return pdfDesBlocs(contenuDeLEtat(lignes, exercice), {
    titre: `État des écritures libres ${exercice}`,
    pied: PIED_DE_L_ETAT,
    instant: instants.length === 0 ? `${exercice}-12-31T12:00:00Z` : instants[instants.length - 1],
  })
}
