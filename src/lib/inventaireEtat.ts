import { dateAParis, formatDate } from './format'
import { prorataApresLaCloture } from './inventaire'
import { ciblePrecedente } from './inventaireDeLaValidation'
import {
  CHOIX_DU_CABINET, declarationEnVigueur, ecrituresAJour, euros, evaluationDeLExercice, LIBELLES_DES_GENRES, LIBELLES_DES_NATURES,
  operationsDeLExercice, provisionsDeLExercice, texteDesCentimes, type DonneesDeLInventaire,
} from './inventaireEcran'
import { pdfDesBlocs } from './pdfLettreDeMission'
import type { BlocDuPdf } from './lettresDeMissionVue'
import { referenceDeLInventaire } from './pieceDeLInventaire'
import { champCsv } from './pisteAudit'
import type { OperationInventaire } from './types'

// L'ÉTAT D'INVENTAIRE D'UN EXERCICE (ligne 35, INV5 ; docs/conceptions/35-inventaire.md, § 3.3) : la pièce justificative des
// écritures d'inventaire — « Inventaire AAAA » (`referenceDeLInventaire`), au FEC —, que l'application PRODUIT, en PDF et en CSV :
// une ligne par régularisation ou par provision, son calcul, sa justification, sa date de saisie, et si l'inventaire est déclaré.
// Module pur : l'état se tire des seules lignes lues en entier (jamais d'une lecture partielle : l'appelant ne l'offre pas
// alors), des mots que l'écran dit déjà, et ne lit pas « maintenant » — le PDF est daté du dernier geste de l'état (une
// saisie, une déclaration), de sorte que deux impressions du même état rendent les mêmes octets.
//
// QUI A SAISI : la base garde l'identifiant du compte (`cree_par`), jamais un nom, et un nom n'a rien à faire sur une pièce qui part
// au dossier ; l'état dit « saisie du cabinet » et sa date, comme la lettre de mission dit « le cabinet ».

export interface LigneDeLEtat {
  nature: string
  objet: string
  /** La charge ou le produit régularisé ; pour une provision, le compte de sa dotation ou de sa reprise. */
  compteDeResultat: string | null
  /** Le compte de régularisation ; pour une provision, son compte. */
  compteDeBilan: string
  /** En centimes : la régularisation hors taxes (toutes taxes comprises d'un exonéré), la cible d'une provision ; nul : non évaluée. */
  montantCentimes: number | null
  tvaCentimes: number
  /** La période couverte, dite en clair ; nulle sans elle. */
  periode: string | null
  /** Les dates des écritures. */
  ecritures: string
  calcul: string
  justification: string
  /** Le jour de la dernière saisie (jour de Paris), JJ/MM/AAAA. */
  saisieLe: string
  /** Les lignes du brouillon sont celles que la régularisation commande (`regularisationAJour`). */
  aJour: boolean
}

export interface EtatDInventaire {
  exercice: number
  dossierNom: string
  /** Le jour de la déclaration en vigueur, JJ/MM/AAAA ; nul : l'inventaire n'est pas déclaré. */
  declareLe: string | null
  lignes: LigneDeLEtat[]
  /** Le dernier geste de l'état (saisie, déclaration), un instant ISO — jamais « maintenant ». */
  instant: string
}

const jourDe = (instant: string) => formatDate(dateAParis(instant))

function periodeDite(o: OperationInventaire): string | null {
  return o.periode_debut !== null && o.periode_fin !== null ? `du ${formatDate(o.periode_debut)} au ${formatDate(o.periode_fin)}` : null
}

function calculDUneRegularisation(o: OperationInventaire): string {
  if (o.tva_centimes > 0) {
    return `Hors taxes ${euros(o.montant_centimes)} + TVA d’attente ${euros(o.tva_centimes)} = ${euros(o.montant_centimes + o.tva_centimes)} au compte de tiers.`
  }
  if ((o.nature === 'cca' || o.nature === 'pca') && o.periode_debut !== null && o.periode_fin !== null) {
    const prorata = prorataApresLaCloture(
      { montantCentimes: o.montant_centimes, debut: o.periode_debut, fin: o.periode_fin, exercice: o.exercice }, CHOIX_DU_CABINET.methodeDuProrata,
    )
    if (prorata.ok) {
      return `Période de ${prorata.joursDeLaPeriode} jour(s), dont ${prorata.joursApres} après le 31/12/${o.exercice} (jours réels) ; `
        + `montant constaté d’avance, confirmé par le cabinet : ${euros(o.montant_centimes)}.`
    }
  }
  return `Montant confirmé par le cabinet : ${euros(o.montant_centimes)}.`
}

const ECRITURES_D_UNE_REGULARISATION = (exercice: number) => `31/12/${exercice} ; extourne au 01/01/${exercice + 1}`

/** L'état d'inventaire d'un exercice : une ligne par régularisation, puis une par provision qu'il porte. */
export function etatDInventaire(d: DonneesDeLInventaire, exercice: number, dossierNom: string): EtatDInventaire {
  const operations = operationsDeLExercice(d.operations, exercice)
  const lignes: LigneDeLEtat[] = []
  const gestes: number[] = []
  const saisie = (o: { cree_le: string; modifie_le: string | null }) => {
    const instant = o.modifie_le ?? o.cree_le
    gestes.push(new Date(instant).getTime())
    return jourDe(instant)
  }
  for (const o of operations.filter((x) => x.nature !== 'provision')) {
    lignes.push({
      nature: LIBELLES_DES_NATURES[o.nature], objet: o.objet, compteDeResultat: o.compte_resultat, compteDeBilan: o.compte_regularisation,
      montantCentimes: o.montant_centimes, tvaCentimes: o.tva_centimes, periode: periodeDite(o),
      ecritures: ECRITURES_D_UNE_REGULARISATION(exercice), calcul: calculDUneRegularisation(o),
      justification: `Régularisation saisie par le cabinet : ${o.objet}.${o.piece_citee_id !== null ? ' Une pièce du dossier la fonde.' : ''}`,
      saisieLe: saisie(o), aJour: ecrituresAJour(o, d),
    })
  }
  const vue = (x: OperationInventaire) => ({ ...x, provision_id: x.provision_id ?? null })
  for (const p of provisionsDeLExercice(d.provisions, exercice)) {
    const genre = LIBELLES_DES_GENRES[p.genre]
    const evaluation = evaluationDeLExercice(p, d.operations, exercice)
    if (evaluation === null) {
      const derniere = d.operations.filter((x) => x.provision_id === p.id && x.exercice < exercice).sort((a, b) => b.exercice - a.exercice)[0]
      lignes.push({
        nature: genre, objet: p.objet, compteDeResultat: null, compteDeBilan: p.compte_provision, montantCentimes: null, tvaCentimes: 0,
        periode: null, ecritures: 'aucune',
        calcul: derniere !== undefined && derniere.montant_centimes === 0
          ? `Soldée au 31/12/${derniere.exercice} : elle ne s’évalue plus.`
          : 'Ouverte, non évaluée sur cet exercice : aucune dotation ni reprise n’est écrite.',
        justification: `Provision ouverte par le cabinet : ${p.objet}.`, saisieLe: saisie(p), aJour: true,
      })
      continue
    }
    const precedente = ciblePrecedente(vue(evaluation), d.operations.map(vue), d.provisions) ?? 0
    const ecart = evaluation.montant_centimes - precedente
    lignes.push({
      nature: genre, objet: evaluation.objet, compteDeResultat: evaluation.compte_resultat, compteDeBilan: evaluation.compte_regularisation,
      montantCentimes: evaluation.montant_centimes, tvaCentimes: 0, periode: null,
      ecritures: ecart === 0 ? 'aucune' : `31/12/${exercice} (${ecart > 0 ? 'dotation' : 'reprise'}, sans extourne)`,
      calcul: `Cible au 31/12/${exercice} ${euros(evaluation.montant_centimes)} − provision au 31/12/${exercice - 1} ${euros(precedente)} = `
        + `${ecart === 0 ? 'écart nul' : `${ecart > 0 ? 'dotation' : 'reprise'} de ${euros(Math.abs(ecart))}`}.`,
      justification: `Provision évaluée par le cabinet : ${evaluation.objet}.${p.piece_citee_id !== null || p.facture_id !== null ? ' Une pièce ou une facture du dossier la fonde.' : ''}`,
      saisieLe: saisie(evaluation), aJour: ecrituresAJour(evaluation, d),
    })
  }
  const declaration = declarationEnVigueur(d.declarations, exercice)
  if (declaration !== null) gestes.push(new Date(declaration.declare_le).getTime())
  const dernier = gestes.length === 0 ? Number.NaN : Math.max(...gestes)
  return {
    exercice, dossierNom, declareLe: declaration === null ? null : jourDe(declaration.declare_le), lignes,
    instant: Number.isNaN(dernier) ? `${exercice + 1}-01-01T00:00:00.000Z` : new Date(dernier).toISOString(),
  }
}

// ── Le CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTETE_DU_CSV = [
  'Exercice', 'Nature', 'Objet', 'Compte de charge ou de produit', 'Compte de régularisation', 'Montant', 'TVA d’attente', 'Période',
  'Écritures', 'Calcul', 'Justification', 'Saisie le', 'Écritures à jour',
] as const

const montantDuCsv = (c: number | null) => (c === null ? '' : texteDesCentimes(c))

/** Le CSV de l'état : un BOM UTF-8, le point-virgule, chaque champ par `champCsv`, des montants à virgule décimale sans symbole
 *  qu'un tableur lit comme des nombres. */
export function csvDeLEtat(e: EtatDInventaire): string {
  const lignes: (readonly string[])[] = [
    ENTETE_DU_CSV,
    ...e.lignes.map((l) => [
      String(e.exercice), l.nature, l.objet, l.compteDeResultat ?? '', l.compteDeBilan, montantDuCsv(l.montantCentimes),
      montantDuCsv(l.tvaCentimes > 0 ? l.tvaCentimes : null), l.periode ?? '', l.ecritures, l.calcul, l.justification, l.saisieLe,
      l.aJour ? 'oui' : 'non',
    ]),
  ]
  return '﻿' + lignes.map((c) => c.map(champCsv).join(';')).join('\r\n')
}

// ── Le PDF ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les blocs de l'état, tirés de ses seules valeurs : le titre, le dossier et la déclaration, puis chaque nature et ses lignes. */
export function blocsDeLEtat(e: EtatDInventaire): BlocDuPdf[] {
  const blocs: BlocDuPdf[] = [
    { genre: 'titre', texte: `État d’inventaire ${e.exercice}` },
    { genre: 'mention', texte: `Dossier : ${e.dossierNom} — pièce justificative « ${referenceDeLInventaire(e.exercice)} », datée du 31/12/${e.exercice}.` },
    { genre: 'texte', texte: e.declareLe === null ? 'L’inventaire de cet exercice n’est pas déclaré à ce jour.' : `Inventaire déclaré fait le ${e.declareLe}.` },
  ]
  if (e.lignes.length === 0) {
    blocs.push({ genre: 'texte', texte: 'Aucune régularisation ni provision sur cet exercice.' })
  }
  let nature: string | null = null
  for (const l of e.lignes) {
    if (l.nature !== nature) {
      nature = l.nature
      blocs.push({ genre: 'intertitre', texte: l.nature })
    }
    blocs.push({
      genre: 'texte',
      texte: [
        l.objet,
        `${l.compteDeResultat === null ? '' : `Compte ${l.compteDeResultat} ; `}compte de bilan ${l.compteDeBilan}`
          + `${l.montantCentimes === null ? '' : ` ; montant ${euros(l.montantCentimes)}`}`
          + `${l.tvaCentimes > 0 ? ` ; TVA d’attente ${euros(l.tvaCentimes)}` : ''}`
          + `${l.periode === null ? '' : ` ; période ${l.periode}`}.`,
        `Écritures : ${l.ecritures}.`,
        `Calcul : ${l.calcul}`,
        `${l.justification} Saisie le ${l.saisieLe}.`,
        ...(l.aJour ? [] : ['Attention : les écritures de cette ligne ne sont plus celles qu’elle commande — à enregistrer de nouveau.']),
      ].join('\n'),
    })
  }
  blocs.push({
    genre: 'mention',
    texte: `Les écritures d’inventaire partent au FEC au journal OD, sous la pièce « ${referenceDeLInventaire(e.exercice)} ». `
      + 'Cet état ne valide rien : il dit l’inventaire tel que le cabinet l’a saisi à la date de son dernier geste.',
  })
  return blocs
}

/** Le PDF de l'état (pdf-lib, A4, Helvetica, comme la lettre de mission) : daté du dernier geste de l'état, jamais de l'heure du clic. */
export function pdfDeLEtat(e: EtatDInventaire): Promise<Uint8Array> {
  return pdfDesBlocs(blocsDeLEtat(e), {
    titre: `État d’inventaire ${e.exercice}`, pied: `${referenceDeLInventaire(e.exercice)} — ${e.dossierNom}`, instant: e.instant,
  })
}

/** Le nom d'un fichier de l'état : l'exercice et le dossier, sans accent ni signe. */
export function nomDuFichierDeLEtat(e: Pick<EtatDInventaire, 'exercice' | 'dossierNom'>, extension: 'pdf' | 'csv'): string {
  const dossier = e.dossierNom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `inventaire-${e.exercice}${dossier === '' ? '' : `-${dossier}`}.${extension}`
}
