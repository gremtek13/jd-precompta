import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EXEMPLAIRES_DES_FACTURES_EXPORTES,
  JUMELLE_INVERSEE_EXPORTEE,
  ORDRE_DES_REFUS_DE_LA_GARDE,
  ORDRE_DES_REFUS_DE_LA_GARDE_JUMELLE,
  ORDRE_DES_REFUS_DU_JOURNAL,
  GESTES_DU_JOURNAL,
  REFUS_DECLARATION,
  REFUS_DESIGNATION,
  REFUS_DESIGNATION_JUMELLE,
  REFUS_EXEMPLAIRE_D_UNE_SOURCE,
  REFUS_GARDE_EXEMPLAIRE,
  REFUS_GARDE_JUMELLE,
  REFUS_JOURNAL,
  REFUS_RETRAIT_DECLARATION,
  REFUS_RETRAIT_DESIGNATION,
  REFUS_RETRAIT_DESIGNATION_JUMELLE,
  REFUS_VALIDATION_D_UNE_VENTE,
  argumentsDeLaDeclaration,
  argumentsDeLaDesignation,
  argumentsDuRetraitDeLaDeclaration,
  argumentsDuRetraitDeLaDesignation,
  exerciceFigeantLaDesignation,
  exerciceFigeantLaFactureSource,
  refusDeLaDeclaration,
  refusDeLaDesignation,
  refusDeLaDesignationMarquee,
  refusDeLaModificationMarquee,
  refusDeLaPieceDesignee,
  refusDeLaValidationDUneVente, passageJugeParG3,
  refusDuLienDeLExemplaire,
  refusDuRetraitDeLaDeclaration,
  refusDuRetraitDeLaDesignation,
  refusDuRetraitMarque,
  verdictDuPont,
  type ContexteDesMarques,
  type FacturePourExemplaire,
  type FacturePourLesGestes,
  type LiensDeLaPiece,
  type PieceDesignable,
  type PieceMarquable,
  type VerdictDuPont,
} from './exemplairesDesFactures'
import type { Statut, StatutFacture, TypePiece } from './types'
import { appelsDe, commeLaBase, etapesDe, lignesInserees, valeurSql, type Etape } from '../test/essaiSql'
import { argumentsSql, codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// L'EXEMPLAIRE D'UNE FACTURE ÉMISE ET LA JUMELLE INVERSÉE (chantier EC-Q3, étapes VF1a et VF6b), confrontés à ce qui fait
// foi.
//
// LES FONCTIONS DE VF1a (refusDeLaDesignation, refusDuRetraitDeLaDesignation, refusDeLaPieceDesignee) disent ce que la
// PRODUCTION refuse aujourd'hui : la migration `exemplaires_des_factures` y est, et l'export la porte (VF1A-Q1). Elles se
// confrontent au texte de CETTE migration (§ 5), et à leurs cas (§ 4) — plus à l'essai, que l'étape VF6b a étendu à la
// migration `jumelle_inversee` : la désignation y REMPLACE désormais (VF6-Q1), et l'essai n'exige plus le refus d'hier.
//
// LE BLOC DE VF6b (refusDeLaDesignationMarquee et la suite) dit ce que la base refuse depuis la migration
// `jumelle_inversee`, appliquée le 24/10/2026. Il se confronte à l'essai `supabase/essais/exemplairesDesFactures.sql`, joué sur une réplique égale à la
// production plus les migrations de VF5h et de VF6b, dont chaque contrôle exige de la base un code ET des mots : chaque
// refus du bloc y est exigé (§ 2), et le test rejoue dans le bloc, appel par appel, ce que l'essai a demandé à la base —
// sur le même jeu, l'état de J relevé par l'essai lui-même (231 et 232) —, le refus au mot près, ou rien quand elle a
// accepté (§ 3). Le drapeau `JUMELLE_INVERSEE_EXPORTEE` levé, il se confronte aussi au texte exporté (§ 5). CHAQUE AUTRE
// ATTENDU EST ÉCRIT À LA MAIN, depuis la migration (son en-tête dit l'ordre des refus) et la conception (HISTORIQUE.md,
// « VF6, LA JUMELLE INVERSÉE : LA CONCEPTION », § 3).
//
// LE GEL DES DÉSIGNATIONS (étape VF7e ; migration `gel_des_designations`, appliquée en production le 26/10/2026 sous
// la version `20261026000808`) : les définitions qui font foi sont désormais les siennes. L'essai l'éprouve dans
// deux dossiers de plus (400 à 451), que le rejeu rejoue aussi — les exercices validés, les biens qu'une pièce justifie —,
// et le gel du module se confronte, facture par facture et pièce par pièce, à ce que les deux fonctions neuves ont rendu
// (444, 445) ; le § 5 garde la migration : sa garde sur les corps de VF6b, la définition de VF6b ligne à ligne dans la
// nouvelle, les droits, la condition qui porte VF7-Q1.

const ESSAI = readFileSync(new URL('../../supabase/essais/exemplairesDesFactures.sql', import.meta.url), 'utf8')

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

// LES COMPTES DE L'ESSAI, relevés sur son texte et sur son rejeu : des planchers, qui distinguent « aucun écart »
// d'« aveugle ». Un contrôle ajouté à l'essai les change, et ce test le dit.
const COMPTES_PAR_GENRE = [15, 19, 238, 36, 28, 0]
const MUTATIONS_DE_L_ESSAI = 21
const CONTROLES_NUMEROTES = 305
const PIECES_DE_J = 36
const FACTURES_DE_J = 8
const APPELS_REJOUES = [81, 37, 25, 8]
const ECRITURES_REJOUEES = [10, 20]
const LIENS_REJOUES = [9, 1, 10, 1]
const ACCEPTES_ET_ACCES = [[38, 7], [12, 7], [4, 7], [1, 3]]
const PLANTE_SANS_DESIGNATION = ['17', '76', '77', '148']
const PLANTE_PONT = ['211', '270', '313']
const PLANTE_LIEN = ['260']
const PLANTE_MIXTE = ['285', '286', '287', '288', '289']
const PLANTE_GEL = ['410', '411', '412', '413', '417', '423', '438']

const modeles = (liste: readonly { modele: string }[]) => liste.map((r) => r.modele)

// Un modèle du module, en expression régulière : chaque « % » une valeur.
function modeleEnRegex(modele: string): RegExp {
  return new RegExp(`^${modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`)
}

const FONCTIONS = [
  'designer_exemplaire_facture', 'defaire_exemplaire_facture', 'declarer_vente_hors_des_factures',
  'retirer_declaration_hors_des_factures',
] as const
type Fonction = (typeof FONCTIONS)[number]

type ListeDeRefus = readonly { readonly cle: string; readonly modele: string; readonly code: string }[]

/** La liste des refus du bloc de VF6b pour chaque fonction du cabinet. */
const REFUS_DE: Record<Fonction, ListeDeRefus> = {
  designer_exemplaire_facture: REFUS_DESIGNATION_JUMELLE,
  defaire_exemplaire_facture: REFUS_RETRAIT_DESIGNATION_JUMELLE,
  declarer_vente_hors_des_factures: REFUS_DECLARATION,
  retirer_declaration_hors_des_factures: REFUS_RETRAIT_DECLARATION,
}

// La dernière instruction d'une étape : c'est elle dont l'essai exige le refus.
const derniere = (e: Etape) => e.appel.split(';').map((x) => x.trim()).filter(Boolean).at(-1) ?? ''
const TABLES_DE_G4 = ['lignes_bancaires', 'reglements_groupes', 'ecritures_brouillon', 'lettrages_manuels'] as const

// ── 1. L'essai, lu ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('l’essai, lu', () => {
  const etapes = etapesDe(ESSAI)

  it('ses étapes, toutes : le plancher qui distingue « aucun écart » d’« aveugle »', () => {
    // Le compte des étapes que le fichier OUVRE (« array[' » suivi d'un genre) est celui des étapes que le motif reconnaît
    // en entier : un motif qui ne les reconnaîtrait plus rendrait une liste vide, et tout ce qui suit passerait sans rien
    // confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*array\['(?:jeu|controle|fait|valeur|retenir|lecture)'/gm)].length
    expect(etapes).toHaveLength(ouvertes)
    const parGenre = (g: string) => etapes.filter((e) => e.genre === g).length
    expect([parGenre('jeu'), parGenre('fait'), parGenre('controle'), parGenre('lecture'), parGenre('valeur'), parGenre('retenir')])
      .toEqual(COMPTES_PAR_GENRE)
    expect(etapes.filter((e) => /^\d+\. MUTATION — /.test(e.titre))).toHaveLength(MUTATIONS_DE_L_ESSAI)
    // Chaque contrôle a son numéro, une seule fois ; les étapes « 0. le jeu » posent le jeu.
    const numerotees = etapes.filter((e) => e.numero !== '' && e.numero !== '0')
    expect(new Set(numerotees.map((e) => e.numero)).size).toBe(numerotees.length)
    expect(numerotees).toHaveLength(CONTROLES_NUMEROTES)
  })

  it('un modèle du module se lit comme remplirModele l’écrit : chaque « % » une valeur, jamais rien', () => {
    expect(modeleEnRegex(REFUS_DESIGNATION[3].modele).test(
      "Cette pièce porte une écriture validée de l'exercice 2026 : sa désignation ne change plus.")).toBe(true)
    expect(modeleEnRegex(REFUS_DESIGNATION[3].modele).test(
      "Cette pièce porte une écriture validée de l'exercice  : sa désignation ne change plus.")).toBe(false)
    expect(modeleEnRegex(REFUS_DESIGNATION[1].modele).test('Pièce introuvable dans ce dossier')).toBe(false)
  })

  it('l’état de J que l’essai relève (231, 232) se lit en entier : une ligne par pièce, une par facture', () => {
    const { pieces, factures } = etatsReleves(ESSAI, nomsDe(ESSAI))
    expect([pieces.length, factures.length]).toEqual([PIECES_DE_J, FACTURES_DE_J])
  })
})

// ── 2. Chaque refus du bloc de VF6b, exigé de la base par l'essai — et l'inverse ──────────────────────────────────────

describe('les refus du bloc de VF6b sont ceux que l’essai exige de la base', () => {
  const controles = etapesDe(ESSAI).filter((e) => e.genre === 'controle' && e.code !== 'OK')
  // Une étape de plusieurs instructions exige le refus de sa DERNIÈRE instruction.
  const exiges = (f: Fonction) => controles.filter((e) => new RegExp(`\\b${f}\\(`).test(derniere(e)))
    .map((e) => ({ code: e.code, message: e.attendu }))
  const exigeDe = (filtre: (e: Etape) => boolean) => (r: { code: string; modele: string }) =>
    controles.some((e) => filtre(e) && e.code === r.code && modeleEnRegex(r.modele).test(e.attendu))

  for (const f of FONCTIONS) {
    it(`${f} : chaque refus du bloc est exigé, sous son code ; chaque refus exigé est un refus du bloc ou le droit d’exécution`, () => {
      for (const r of REFUS_DE[f]) {
        expect(exiges(f).some((x) => x.code === r.code && modeleEnRegex(r.modele).test(x.message)), r.cle).toBe(true)
      }
      for (const x of exiges(f)) {
        const connu = REFUS_DE[f].some((r) => r.code === x.code && modeleEnRegex(r.modele).test(x.message))
          || (x.code === '42501' && x.message === `permission denied for function ${f}`)
        expect(connu, x.message).toBe(true)
      }
    })
  }

  it('la garde étendue : chaque refus est exigé d’une écriture directe d’une pièce, sous son code', () => {
    const directe = (e: Etape) => /^(update pieces|insert into pieces)\b/.test(derniere(e))
    for (const r of REFUS_GARDE_JUMELLE) expect(exigeDe(directe)(r), r.cle).toBe(true)
  })

  it('G3 : chaque refus est exigé d’une écriture directe d’une pièce, sous son code', () => {
    const directe = (e: Etape) => /^(update pieces|insert into pieces)\b/.test(derniere(e))
    for (const r of REFUS_VALIDATION_D_UNE_VENTE) expect(exigeDe(directe)(r), r.cle).toBe(true)
  })

  it('G4 : son refus est exigé sur chacune des quatre tables, à l’insertion et à la mise à jour', () => {
    for (const table of TABLES_DE_G4) {
      const ecrit = (e: Etape) => new RegExp(`^(update ${table}|insert into ${table})\\b`).test(derniere(e))
      expect(exigeDe(ecrit)(REFUS_EXEMPLAIRE_D_UNE_SOURCE[0]), table).toBe(true)
    }
    const misAJour = (e: Etape) => TABLES_DE_G4.some((t) => derniere(e).startsWith(`update ${t} `))
    expect(exigeDe(misAJour)(REFUS_EXEMPLAIRE_D_UNE_SOURCE[0])).toBe(true)
  })

  it('le journal : chaque refus de sa garde est exigé d’une écriture directe, sous son code', () => {
    const ecrit = (e: Etape) => /^(update|insert into|delete from) designations_des_pieces\b/.test(derniere(e))
    for (const r of REFUS_JOURNAL) expect(exigeDe(ecrit)(r), r.cle).toBe(true)
  })

  it('les mots partagés : l’accès, la pièce introuvable, les deux gels, les preuves contraires — et ceux de VF1a qui demeurent', () => {
    const mot = (l: ListeDeRefus, cle: string) => l.find((r) => r.cle === cle)?.modele
    for (const l of Object.values(REFUS_DE)) {
      expect(mot(l, 'acces')).toBe(mot(REFUS_DESIGNATION, 'acces'))
      expect(mot(l, 'piece_introuvable')).toBe(mot(REFUS_DESIGNATION, 'piece_introuvable'))
    }
    expect(mot(REFUS_RETRAIT_DESIGNATION_JUMELLE, 'piece_figee')).toBe(mot(REFUS_DESIGNATION, 'piece_figee'))
    expect(mot(REFUS_RETRAIT_DECLARATION, 'piece_figee')).toBe(mot(REFUS_DECLARATION, 'piece_figee'))
    // Ce que VF6b ne change pas se dit sous les mots de VF1a.
    for (const cle of ['pas_une_vente', 'piece_figee', 'deja_cette_facture', 'facture_introuvable', 'facture_brouillon']) {
      expect(mot(REFUS_DESIGNATION_JUMELLE, cle), cle).toBe(mot(REFUS_DESIGNATION, cle))
    }
    expect(mot(REFUS_RETRAIT_DESIGNATION_JUMELLE, 'pas_designee')).toBe(mot(REFUS_RETRAIT_DESIGNATION, 'pas_designee'))
    for (const r of REFUS_GARDE_EXEMPLAIRE) expect(mot(REFUS_GARDE_JUMELLE, r.cle), r.cle).toBe(r.modele)
    // La déclaration refusée à une pièce qui n'est pas une vente : les mêmes mots, de la fonction et de la garde.
    expect(mot(REFUS_GARDE_JUMELLE, 'declaration_pas_une_vente')).toBe(mot(REFUS_DECLARATION, 'pas_une_vente'))
    // Le virement mixte : les mêmes mots aux quatre rangs qui le disent.
    const virement = mot(REFUS_DESIGNATION_JUMELLE, 'virement_mixte')
    expect([mot(REFUS_DESIGNATION_JUMELLE, 'virement_mixte_quittee'), mot(REFUS_RETRAIT_DESIGNATION_JUMELLE, 'virement_mixte'),
      mot(REFUS_DECLARATION, 'virement_mixte')]).toEqual([virement, virement, virement])
  })
})

// ── 3. L'essai rejoué appel par appel ─────────────────────────────────────────────────────────────────────────────────

interface Rejeu {
  etape: Etape
  quoi: string
  /** Ce que la base a rendu : « OK », ou le code et le message. */
  base: string
  /** Ce que le bloc en dit : la clé de son refus, « OK », ou « acces » quand l'appelant n'a pas accès. */
  cle: string
  message: string | null
  /** Le code du refus, tiré de la liste qui le lèverait (un même mot vit dans deux listes, sous deux codes). */
  code: string | null
}

const TYPES: readonly TypePiece[] = ['achat', 'vente', 'note_frais', 'autre']
const STATUTS_FACTURE: readonly StatutFacture[] = ['brouillon', 'validee']
const STATUTS_PIECE: readonly Statut[] = ['a_valider', 'validee']
const SANS_LIEN: LiensDeLaPiece = { rapprochee: false, reglee: false, ecrite: false, lettree: false }
const AUCUNE: VerdictDuPont = { genre: 'aucune' }

/** Une pièce telle que le rejeu la connaît : ses marques, ce que le pont en prouve, ses liens. */
interface PieceRejouee extends PieceMarquable {
  pont: VerdictDuPont
  liens: LiensDeLaPiece
}

function nomsDe(essai: string): Map<string, string> {
  const noms = new Map<string, string>()
  for (const m of essai.matchAll(/\{(\w+)\}/g)) if (!noms.has(m[1])) noms.set(m[1], m[1])
  return noms
}

/** Un identifiant jetable entre accolades, rendu par son nom. */
function nom(valeur: string, noms: ReadonlyMap<string, string>): string {
  const v = valeurSql(`'${valeur}'`, noms)
  if (typeof v !== 'string') throw new Error(`Identifiant illisible : ${valeur}`)
  return v
}

/** L'état de J que l'essai relève lui-même après son jeu : 231 (les pièces) et 232 (les factures), lus dans les valeurs
 *  qu'il attend de la base. */
function etatsReleves(essai: string, noms: ReadonlyMap<string, string>) {
  const etapes = etapesDe(essai)
  const lire = (numero: string) => {
    const e = etapes.find((x) => x.genre === 'valeur' && x.numero === numero)
    if (e === undefined) throw new Error(`L'état ${numero} manque à l'essai.`)
    return e.attendu.split(' ').map((l) => l.split(':'))
  }
  const pieces = lire('231').map(([id, type, statut, facture, declaree, pont, liens, fige]) => {
    const type_piece = TYPES.find((t) => t === type)
    const statutPiece = STATUTS_PIECE.find((s) => s === statut)
    if (type_piece === undefined || statutPiece === undefined || fige === undefined) throw new Error(`Pièce relevée illisible : ${id}`)
    return {
      id: nom(id, noms), type_piece, statut: statutPiece, facture_id: facture === '-' ? null : nom(facture, noms),
      vente_hors_des_factures: declaree === 'true',
      pont: (pont === '-' ? AUCUNE : pont === 'contraire' ? { genre: 'contraires' } : { genre: 'une', factureId: nom(pont, noms) }) as VerdictDuPont,
      liens: { rapprochee: liens.includes('r'), reglee: liens.includes('g'), ecrite: liens.includes('e'), lettree: liens.includes('l') },
      annee: fige === '-' ? null : Number(fige),
    }
  })
  const factures = lire('232').map(([id, statut, type, numero, source, mixte]) => {
    if (STATUTS_FACTURE.find((s) => s === statut) === undefined || mixte === undefined) throw new Error(`Facture relevée illisible : ${id}`)
    return { id: nom(id, noms), statut, type, numero: numero === '-' ? null : numero, source: source === 'true', mixte: mixte === 'true' }
  })
  return { pieces, factures }
}

/** Ce que le rejeu sait au moment d'une étape `valeur` : de quoi confronter au module ce que la base y a rendu (444, 445). */
interface EtatDuRejeu {
  factures: readonly FacturePourLesGestes[]
  pieces: ReadonlyMap<string, PieceRejouee>
  figees: ReadonlyMap<string, number>
  exercices: ReadonlyMap<string, readonly number[]>
}

/**
 * L'essai rejoué : ce qu'il a construit en base au moment de chaque étape — ses dossiers et leur bascule, ses factures et
 * leur source, ses pièces et leurs marques, les écritures validées qui en figent (celles de la pièce, et celles du bien
 * qu'elle justifie), les exercices validés (le gel des désignations, VF7e), et, dès que l'essai la relève (231, 232),
 * l'état de J entier : ce que le pont prouve de chaque pièce, ses liens, le virement mixte. Les étapes de J qui précèdent ce
 * relevé posent le jeu, que l'essai exige « OK » : elles ne se rejouent pas. Puis, pour chaque appel aux quatre fonctions,
 * chaque écriture directe d'une pièce (la garde, puis G3) et chaque lien posé ou changé sur les quatre tables de G4, ce que
 * le bloc en dit. Les profils et leurs accès sont ceux du moteur de l'essai : le chef (super-administrateur) et le chef
 * simple partout dans le cabinet, le membre dans T seul, le membre d'ailleurs dans A seul ; le client — avec ou sans accès
 * à T, avec ou sans cases —, le compte rattaché à rien et l'anonyme, nulle part ; un dossier qui n'existe pas, pour
 * personne.
 */
function rejouer(essai: string, surValeur?: (etape: Etape, etat: EtatDuRejeu) => void): Rejeu[] {
  const noms = nomsDe(essai)
  const dossiers = new Set<string>()
  const bascules = new Set<string>()
  const factures: FacturePourLesGestes[] = []
  const pieces = new Map<string, PieceRejouee>()
  const figees = new Map<string, number>()
  const exercices = new Map<string, number[]>()
  const biens = new Map<string, string>()
  const virementMixte = new Set<string>()
  let etatDeJ = false
  const rejeux: Rejeu[] = []

  for (const e of etapesDe(essai)) {
    if (e.genre === 'jeu' || e.genre === 'fait') {
      for (const d of lignesInserees(e.appel, 'dossiers', noms)) {
        dossiers.add(String(d.id))
        if (d.ventes_par_les_factures === true) bascules.add(String(d.id))
      }
      for (const m of e.appel.matchAll(/update dossiers set ventes_par_les_factures = true where id = '\{(\w+)\}'/g)) bascules.add(m[1])
      for (const f of lignesInserees(e.appel, 'factures_emises', noms)) {
        const statut = STATUTS_FACTURE.find((s) => s === f.statut)
        if (statut == null) throw new Error(`Statut de facture inconnu : ${String(f.statut)}`)
        factures.push({
          id: String(f.id), dossier_id: String(f.dossier_id), statut, numero: f.numero == null ? null : String(f.numero),
          source_de_la_vente: f.source_de_la_vente === true, date_emission: String(f.date_emission),
        })
      }
      for (const p of lignesInserees(e.appel, 'pieces', noms)) {
        const type = TYPES.find((t) => t === p.type_piece)
        if (type == null) throw new Error(`Type de pièce inconnu : ${String(p.type_piece)}`)
        const statut = p.statut === undefined ? 'a_valider' : STATUTS_PIECE.find((s) => s === p.statut)
        if (statut == null) throw new Error(`Statut de pièce inconnu : ${String(p.statut)}`)
        pieces.set(String(p.id), {
          id: String(p.id), dossier_id: String(p.dossier_id), type_piece: type, statut, nom_fichier: String(p.nom_fichier),
          facture_id: null, vente_hors_des_factures: p.vente_hors_des_factures === true, pont: AUCUNE, liens: SANS_LIEN,
        })
      }
      for (const b of lignesInserees(e.appel, 'immobilisations', noms)) if (b.piece_id != null) biens.set(String(b.id), String(b.piece_id))
      for (const x of lignesInserees(e.appel, 'ecritures_brouillon', noms)) {
        // La pièce que l'écriture fige : la sienne, ou celle du bien qu'elle amortit (le critère d'exercice_figeant_la_piece).
        const fige = x.piece_id != null ? String(x.piece_id) : x.immobilisation_id != null ? biens.get(String(x.immobilisation_id)) : undefined
        if (x.statut !== 'validee' || fige === undefined) continue
        const annee = Number(String(x.date).slice(0, 4))
        const avant = figees.get(fige)
        figees.set(fige, avant === undefined ? annee : Math.min(avant, annee))
      }
      for (const v of lignesInserees(e.appel, 'exercices_valides', noms)) {
        exercices.set(String(v.dossier_id), [...(exercices.get(String(v.dossier_id)) ?? []), Number(v.annee)])
      }
    }
    if (e.genre === 'valeur' && surValeur !== undefined) surValeur(e, { factures, pieces, figees, exercices })
    // L'état de J, tel que l'essai le relève : il remplace ce que le jeu en a dit.
    if (e.genre === 'valeur' && e.numero === '232') {
      const releve = etatsReleves(essai, noms)
      for (const p of releve.pieces) {
        const connue = pieces.get(p.id)
        if (connue === undefined) throw new Error(`Pièce relevée que le jeu n'a pas posée : ${p.id}`)
        pieces.set(p.id, { ...connue, type_piece: p.type_piece, statut: p.statut, facture_id: p.facture_id,
          vente_hors_des_factures: p.vente_hors_des_factures, pont: p.pont, liens: p.liens })
        if (p.annee === null) figees.delete(p.id)
        else figees.set(p.id, p.annee)
      }
      for (const f of releve.factures) {
        const i = factures.findIndex((x) => x.id === f.id)
        if (i < 0) throw new Error(`Facture relevée que le jeu n'a pas posée : ${f.id}`)
        factures[i] = { ...factures[i], source_de_la_vente: f.source, numero: f.numero }
        if (f.mixte) virementMixte.add(f.id)
      }
      etatDeJ = true
      continue
    }
    if (e.genre !== 'fait' && e.genre !== 'controle') continue
    const fait = e.genre === 'fait'
    if (fait) expect(e.code, e.titre).toBe('OK')
    const base = e.code === 'OK' ? 'OK' : `${e.code} ${e.attendu}`
    const dire = (quoi: string, liste: ListeDeRefus, cle: string, refus: { cle: string; message: string } | null = null) => {
      const retenue = refus?.cle ?? cle
      const code = retenue === 'OK' ? null : liste.find((x) => x.cle === retenue)?.code
      if (code === undefined) throw new Error(`Refus sans code dans sa liste : ${retenue}`)
      rejeux.push({ etape: e, quoi, base, cle: retenue, message: refus?.message ?? null, code })
    }
    // Plusieurs instructions (un appel, puis une écriture directe ; un réglage, puis une écriture) : l'essai les juge seul.
    if (e.appel.includes(';')) continue
    // Avant le relevé de J, ses étapes posent le jeu.
    const avantLeReleve = (dossier: string) => dossier === 'J' && !etatDeJ

    // Une écriture directe d'une pièce, d'une seule instruction : la garde, puis G3.
    const directe = /^update pieces set (.+) where id = '\{(\w+)\}'$/.exec(e.appel)
    if (directe) {
      const affectations = new Map(directe[1].split(', ').map((a) => {
        const m = /^(\w+) = (.+)$/.exec(a)
        if (!m) throw new Error(`Affectation que le test ne sait pas lire : ${a}`)
        return [m[1], m[2]] as const
      }))
      const piece = pieces.get(directe[2])
      if (piece == null) throw new Error(`Pièce inconnue : ${directe[2]}`)
      if (avantLeReleve(piece.dossier_id)) continue
      const lire = (colonne: string) => {
        const v = affectations.get(colonne)
        return v === undefined || v === colonne ? undefined : valeurSql(v, noms)
      }
      // Hors des fonctions, la désignation et la déclaration ne s'écrivent pas — pour personne ; réécrites à elles-mêmes,
      // elles ne changent pas.
      if (lire('facture_id') !== undefined) {
        dire('écriture directe de la marque', REFUS_GARDE_JUMELLE, 'hors_des_fonctions', {
          cle: 'hors_des_fonctions', message: REFUS_GARDE_JUMELLE[0].modele,
        })
        continue
      }
      const declaree = lire('vente_hors_des_factures')
      if (declaree !== undefined && declaree !== (piece.vente_hors_des_factures ?? false)) {
        dire('écriture directe de la marque', REFUS_GARDE_JUMELLE, 'declaration_hors_des_fonctions', {
          cle: 'declaration_hors_des_fonctions', message: REFUS_GARDE_JUMELLE[1].modele,
        })
        continue
      }
      const type = lire('type_piece')
      const statut = lire('statut')
      const dossier = lire('dossier_id')
      const modification = {
        ...(dossier === undefined ? {} : { dossier_id: String(dossier) }),
        ...(type === undefined ? {} : { type_piece: TYPES.find((t) => t === type) }),
        ...(statut === undefined ? {} : { statut: STATUTS_PIECE.find((s) => s === statut) }),
      }
      if (Object.values(modification).some((v) => v === undefined)) throw new Error(`Valeur inconnue : ${e.appel}`)
      const arrivee = String(dossier ?? piece.dossier_id)
      const refus = refusDeLaModificationMarquee(piece, modification, { factures, basculeDuDossier: bascules.has(arrivee), pont: piece.pont })
      dire('écriture directe de la pièce', [...REFUS_GARDE_JUMELLE, ...REFUS_VALIDATION_D_UNE_VENTE], 'OK', refus)
      // Faite et acceptée, elle change la pièce que le rejeu connaît (PG6 validée, étape VF7e).
      if (fait && refus === null) Object.assign(piece, modification)
      continue
    }

    // Un lien posé ou changé sur une des quatre tables de G4, d'une seule instruction.
    const lien = /^update (\w+) set (.+) where id = '\{(\w+)\}'$/.exec(e.appel)
    if (lien && (TABLES_DE_G4 as readonly string[]).includes(lien[1])) {
      const piece = /\bpiece_id = '\{(\w+)\}'/.exec(lien[2])
      const cible = piece == null ? undefined : pieces.get(piece[1])
      if (piece != null && cible === undefined) throw new Error(`Pièce inconnue : ${piece[1]}`)
      dire(`lien de ${lien[1]}`, REFUS_EXEMPLAIRE_D_UNE_SOURCE, 'OK', cible === undefined ? null : refusDuLienDeLExemplaire(cible, factures))
      continue
    }
    const table = TABLES_DE_G4.find((t) => e.appel.startsWith(`insert into ${t} `))
    if (table !== undefined) {
      for (const ligne of lignesInserees(e.appel, table, noms)) {
        const cible = ligne.piece_id == null ? undefined : pieces.get(String(ligne.piece_id))
        if (ligne.piece_id != null && cible === undefined) throw new Error(`Pièce inconnue : ${String(ligne.piece_id)}`)
        dire(`lien de ${table}`, REFUS_EXEMPLAIRE_D_UNE_SOURCE, 'OK', cible === undefined ? null : refusDuLienDeLExemplaire(cible, factures))
      }
      continue
    }

    const appels = appelsDe(e.appel)
    // Une insertion directe d'une pièce, une écriture du journal : les gardes à l'insertion et la restauration, que l'essai
    // juge seul (l'écran n'insère jamais une pièce marquée, n'écrit jamais le journal).
    if (appels == null) continue
    for (const { fonction, arguments: brut } of appels) {
      const f = FONCTIONS.find((x) => x === fonction)
      if (f === undefined) throw new Error(`Fonction que le test ne sait pas rejouer : ${fonction}`)
      const v = brut.map((x) => valeurSql(x, noms))
      const dossier = String(v[0])
      if (avantLeReleve(dossier)) continue
      const liste = REFUS_DE[f]
      const accesRefuse = ['anon', 'inconnu', 'client', 'client_t', 'client_t_ventes'].includes(e.profil) || !dossiers.has(dossier)
        || (e.profil === 'membre' && dossier !== 'T') || (e.profil === 'membre_ailleurs' && dossier !== 'A')
      if (accesRefuse) {
        dire(f, liste, 'acces')
        continue
      }
      const piece = v[1] == null ? null : pieces.get(String(v[1])) ?? null
      const contexte: ContexteDesMarques = {
        dossierId: dossier, anneeFigeante: piece == null ? null : figees.get(piece.id) ?? null, factures,
        exercicesValides: exercices.get(dossier) ?? [], dossierBascule: bascules.has(dossier), pont: piece?.pont ?? AUCUNE,
        liens: piece?.liens ?? SANS_LIEN, facturesDuVirementMixte: virementMixte,
      }
      if (f === 'designer_exemplaire_facture') {
        const factureId = v[2] == null ? null : String(v[2])
        const refus = refusDeLaDesignationMarquee(piece, factureId, contexte)
        dire(f, liste, 'OK', refus)
        if (fait && refus == null && piece != null) Object.assign(piece, { facture_id: factureId, vente_hors_des_factures: false })
      } else if (f === 'defaire_exemplaire_facture') {
        const refus = refusDuRetraitMarque(piece, contexte)
        dire(f, liste, 'OK', refus)
        if (fait && refus == null && piece != null) piece.facture_id = null
      } else if (f === 'declarer_vente_hors_des_factures') {
        const refus = refusDeLaDeclaration(piece, contexte)
        dire(f, liste, 'OK', refus)
        if (fait && refus == null && piece != null) Object.assign(piece, { facture_id: null, vente_hors_des_factures: true })
      } else {
        const refus = refusDuRetraitDeLaDeclaration(piece, contexte)
        dire(f, liste, 'OK', refus)
        if (fait && refus == null && piece != null) piece.vente_hors_des_factures = false
      }
    }
  }
  return rejeux
}

// Le bloc dit-il ce que la base a dit ? L'accès se juge à son code ; un refus, à son code et à ses mots.
function concorde(r: Rejeu): boolean {
  if (r.cle === 'acces') return r.base.startsWith('42501 ')
  if (r.cle === 'OK') return r.base === 'OK'
  return r.code !== null && r.base.startsWith(`${r.code} `) && commeLaBase(r.base.slice(r.code.length + 1), r.message)
}

describe('l’essai joué sur la réplique, rejoué appel par appel dans le bloc de VF6b', () => {
  const rejeux = rejouer(ESSAI)
  const de = (quoi: string) => rejeux.filter((r) => r.quoi === quoi)

  it('le bloc dit ce que la base a dit, à chaque appel, à chaque écriture directe d’une pièce, à chaque lien de G4', () => {
    for (const r of rejeux) expect(concorde(r), `${r.etape.titre} : la base « ${r.base} », le bloc « ${r.cle} » ${r.message ?? ''}`).toBe(true)
  })

  it('rejoue tous les appels des étapes d’une seule instruction passées le relevé de J, et les écritures directes', () => {
    expect(FONCTIONS.map((f) => de(f).length)).toEqual(APPELS_REJOUES)
    expect([de('écriture directe de la marque').length, de('écriture directe de la pièce').length]).toEqual(ECRITURES_REJOUEES)
    expect(TABLES_DE_G4.map((t) => de(`lien de ${t}`).length)).toEqual(LIENS_REJOUES)
  })

  it('des acceptés et des accès refusés sur chaque fonction ; des refus et des acceptés de la garde, de G3 et de G4', () => {
    const compte = (quoi: string, cle: string) => de(quoi).filter((r) => r.cle === cle).length
    expect(FONCTIONS.map((f) => [compte(f, 'OK'), compte(f, 'acces')])).toEqual(ACCEPTES_ET_ACCES)
    const directes = de('écriture directe de la pièce')
    expect(directes.filter((r) => r.cle === 'OK').length).toBeGreaterThan(0)
    expect(directes.filter((r) => REFUS_VALIDATION_D_UNE_VENTE.some((x) => x.cle === r.cle)).length).toBeGreaterThan(0)
    expect(directes.filter((r) => REFUS_GARDE_JUMELLE.some((x) => x.cle === r.cle)).length).toBeGreaterThan(0)
    const liens = rejeux.filter((r) => r.quoi.startsWith('lien de '))
    expect([liens.filter((r) => r.cle === 'OK').length > 0, liens.filter((r) => r.cle === 'exemplaire_d_une_source').length > 0])
      .toEqual([true, true])
  })

  it('chaque refus que l’écran peut dire d’une fonction, de G3 et des marques d’une pièce a été rendu au moins une fois par la base', () => {
    const vus = new Set(rejeux.map((r) => `${r.quoi}:${r.cle}`))
    for (const f of FONCTIONS) {
      expect(REFUS_DE[f].map((x) => x.cle).filter((cle) => cle !== 'acces' && !vus.has(`${f}:${cle}`)), f).toEqual([])
    }
    // G3 à la mise à jour (née validée : une insertion, que l'essai juge seul), et la garde d'une pièce marquée.
    const g3 = REFUS_VALIDATION_D_UNE_VENTE.map((x) => x.cle).filter((cle) => cle !== 'nee_validee')
    expect(g3.filter((cle) => !vus.has(`écriture directe de la pièce:${cle}`))).toEqual([])
    const marquees = ['change_de_dossier', 'change_de_nature', 'declaree_change_de_dossier', 'declaree_change_de_nature']
    expect(marquees.filter((cle) => !vus.has(`écriture directe de la pièce:${cle}`))).toEqual([])
  })

  it('un message réécrit dans l’essai, un accepté devenu refus, un refus devenu accepté, un état relevé faux : le rejeu les voit', () => {
    const planter = (avant: string, apres: string) => {
      expect(ESSAI.split(avant), avant).toHaveLength(2)
      return rejouer(ESSAI.replace(avant, apres)).filter((r) => !concorde(r)).map((r) => r.etape.numero)
    }
    expect(planter("('{T}', '{PV4}', '{F2}')$q$,\n      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0002.'],",
      "('{T}', '{PV4}', '{F2}')$q$,\n      '22023', 'Cette pièce est déjà l''exemplaire de la facture F2026-0001.'],")).toEqual(['17'])
    expect(planter("$q$select designer_exemplaire_facture('{T}', '{PV1}', '{F1}')$q$, 'OK', ''],\n    array['controle', '9.",
      "$q$select designer_exemplaire_facture('{T}', '{PV1}', '{FB}')$q$, 'OK', ''],\n    array['controle', '9.")).toEqual(['8'])
    expect(planter("$q$select defaire_exemplaire_facture('{T}', '{PFIG2}')$q$,",
      "$q$select defaire_exemplaire_facture('{T}', '{PV4}')$q$,")).toEqual(['49'])
    expect(planter("$q$update pieces set type_piece = 'achat' where id = '{PV4}'$q$,",
      "$q$update pieces set type_piece = 'vente' where id = '{PV4}'$q$,")).toEqual(['77'])
    // Le jeu : une désignation de moins, et la pièce qu'elle portait n'est plus « déjà l'exemplaire » de rien.
    expect(planter("designer_exemplaire_facture('{T}', '{PV4}', '{F2}'), designer_exemplaire_facture('{T}', '{PV5}', '{F1}')",
      "designer_exemplaire_facture('{T}', '{PV5}', '{F1}')")).toEqual(PLANTE_SANS_DESIGNATION)
    // L'état relevé de J : un pont de moins (PJ1 ne prouve plus FS1), un lien de moins (PL n'est plus rapprochée), une
    // facture qui n'est plus comptée par le virement mixte (FA0) — chaque fois, les contrôles qui en dépendent.
    expect(planter('{PJ1}:vente:a_valider:-:false:{FS1}:-:-', '{PJ1}:vente:a_valider:-:false:-:-:-')).toEqual(PLANTE_PONT)
    expect(planter('{PL}:vente:a_valider:-:false:-:r:-', '{PL}:vente:a_valider:-:false:-:-:-')).toEqual(PLANTE_LIEN)
    expect(planter('{FA0}:validee:facture:F2026-0004:false:true', '{FA0}:validee:facture:F2026-0004:false:false')).toEqual(PLANTE_MIXTE)
    // Le gel (VF7e) : l'exercice 2024 de DG validé en 2023 — chaque contrôle dont l'exercice qui fige change.
    expect(planter("('{DG}', 2024, '2025-01-20 10:00:00+00'", "('{DG}', 2023, '2025-01-20 10:00:00+00'")).toEqual(PLANTE_GEL)
  })

  it('le gel du module est celui que la base a rendu (VF7e) : facture par facture (444), pièce par pièce (445)', () => {
    const vus: string[] = []
    const dossiers = ['DG', 'DN']
    rejouer(ESSAI, (e, etat) => {
      if (e.numero === '444') {
        expect(etat.factures.filter((f) => dossiers.includes(f.dossier_id))
          .map((f) => `${f.numero ?? ''}=${exerciceFigeantLaFactureSource(f, etat.exercices.get(f.dossier_id) ?? []) ?? '-'}`)
          .sort().join(' ')).toBe(e.attendu)
        vus.push(e.numero)
      }
      if (e.numero === '445') {
        expect([...etat.pieces.values()].filter((p) => dossiers.includes(p.dossier_id))
          .map((p) => {
            const piece = etat.figees.get(p.id) ?? null
            const designation = exerciceFigeantLaDesignation(p, {
              anneeFigeante: piece, factures: etat.factures, exercicesValides: etat.exercices.get(p.dossier_id) ?? [],
            })
            return `${p.nom_fichier}=${designation ?? '-'}/${piece ?? '-'}`
          })
          .sort().join(' ')).toBe(e.attendu)
        vus.push(e.numero)
      }
    })
    expect(vus).toEqual(['444', '445'])
  })
})

// ── 4. Les refus dits avant le clic, cas par cas ──────────────────────────────────────────────────────────────────────

const D = 'd1'
function piece(o: Partial<PieceDesignable> = {}): PieceDesignable {
  return { id: 'p1', dossier_id: D, type_piece: 'vente', facture_id: null, ...o }
}
function facture(o: Partial<FacturePourExemplaire> = {}): FacturePourExemplaire {
  return { id: 'f1', dossier_id: D, statut: 'validee', numero: 'F2026-0007', ...o }
}
const FACTURES = [facture(), facture({ id: 'f2', numero: 'F2026-0008' }), facture({ id: 'av', numero: 'A2026-0001' }),
  facture({ id: 'fb', statut: 'brouillon', numero: null }), facture({ id: 'fa', dossier_id: 'd2', numero: 'F2026-0001' })]
const contexte = (o: Partial<{ anneeFigeante: number | null }> = {}) => ({ dossierId: D, anneeFigeante: null, factures: FACTURES, ...o })
const cle = (r: { cle: string } | null) => r?.cle ?? 'aucun'

describe('refusDeLaDesignation — dit avant le clic ce que designer_exemplaire_facture refuserait', () => {
  it('une pièce de vente du dossier, que rien ne fige ni ne désigne, et une facture validée du dossier — un avoir compris', () => {
    expect(refusDeLaDesignation(piece(), 'f1', contexte())).toBeNull()
    expect(refusDeLaDesignation(piece(), 'av', contexte())).toBeNull()
    // Une pièce dont la désignation n'a pas été lue (la colonne absente) n'en porte aucune.
    expect(refusDeLaDesignation({ id: 'p1', dossier_id: D, type_piece: 'vente' }, 'f1', contexte())).toBeNull()
  })

  it('2. la pièce : aucune, ou d’un autre dossier', () => {
    expect(refusDeLaDesignation(null, 'f1', contexte())).toEqual({ cle: 'piece_introuvable', message: 'Pièce introuvable dans ce dossier.' })
    expect(cle(refusDeLaDesignation(piece({ dossier_id: 'd2' }), 'f1', contexte()))).toBe('piece_introuvable')
  })

  it('3. une pièce de vente seulement', () => {
    for (const type_piece of ['achat', 'note_frais', 'autre'] as const) {
      expect(refusDeLaDesignation(piece({ type_piece }), 'f1', contexte()), type_piece)
        .toEqual({ cle: 'pas_une_vente', message: "Seule une pièce de vente est l'exemplaire d'une facture émise." })
    }
  })

  it('4. une pièce figée : l’exercice qui la fige est dit', () => {
    expect(refusDeLaDesignation(piece(), 'f1', contexte({ anneeFigeante: 2025 }))).toEqual({
      cle: 'piece_figee', message: "Cette pièce porte une écriture validée de l'exercice 2025 : sa désignation ne change plus.",
    })
  })

  it('5. une pièce déjà désignée : à cette facture, ou à une autre — le numéro est celui de la facture qu’elle désigne', () => {
    expect(refusDeLaDesignation(piece({ facture_id: 'f2' }), 'f2', contexte())).toEqual({
      cle: 'deja_cette_facture', message: "Cette pièce est déjà l'exemplaire de la facture F2026-0008.",
    })
    expect(refusDeLaDesignation(piece({ facture_id: 'f2' }), 'f1', contexte())).toEqual({
      cle: 'deja_une_autre',
      message: "Cette pièce est déjà l'exemplaire de la facture F2026-0008 : défaire cette désignation avant d'en faire une autre.",
    })
    // Aucune facture choisie : une autre que celle qu'elle désigne, comme la base le compare (nul n'égale rien).
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f2' }), null, contexte()))).toBe('deja_une_autre')
    // La facture qu'elle désigne absente de la lecture : la base dirait son numéro ; le module ne l'invente pas.
    expect(refusDeLaDesignation(piece({ facture_id: 'fx' }), 'f1', contexte())?.message)
      .toBe("Cette pièce est déjà l'exemplaire de la facture (sans numéro) : défaire cette désignation avant d'en faire une autre.")
  })

  it('6. la facture : aucune, absente, ou d’un autre dossier ; 7. un brouillon', () => {
    expect(refusDeLaDesignation(piece(), null, contexte())).toEqual({ cle: 'facture_introuvable', message: 'Facture introuvable dans ce dossier.' })
    expect(cle(refusDeLaDesignation(piece(), 'fx', contexte()))).toBe('facture_introuvable')
    expect(cle(refusDeLaDesignation(piece(), 'fa', contexte()))).toBe('facture_introuvable')
    expect(refusDeLaDesignation(piece(), 'fb', contexte())).toEqual({
      cle: 'facture_brouillon', message: "Seule une facture validée a un exemplaire : un brouillon n'est pas encore une facture émise.",
    })
  })

  it('deux refus ensemble : le premier dans l’ordre de la fonction', () => {
    // La pièce avant la facture, la nature avant le gel, le gel avant la désignation, la désignation avant la facture.
    expect(cle(refusDeLaDesignation(piece({ dossier_id: 'd2' }), 'fb', contexte()))).toBe('piece_introuvable')
    expect(cle(refusDeLaDesignation(piece({ type_piece: 'achat' }), 'fb', contexte({ anneeFigeante: 2026 })))).toBe('pas_une_vente')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'f2', contexte({ anneeFigeante: 2026 })))).toBe('piece_figee')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'fa', contexte()))).toBe('deja_une_autre')
    expect(cle(refusDeLaDesignation(piece({ facture_id: 'f1' }), 'fb', contexte()))).toBe('deja_une_autre')
  })
})

describe('refusDuRetraitDeLaDesignation — dit avant le clic ce que defaire_exemplaire_facture refuserait', () => {
  it('une pièce désignée que rien ne fige se défait', () => {
    expect(refusDuRetraitDeLaDesignation(piece({ facture_id: 'f1' }), contexte())).toBeNull()
  })

  it('2. la pièce ; 3. une pièce que rien ne désigne — la colonne absente comprise ; 4. le gel', () => {
    expect(cle(refusDuRetraitDeLaDesignation(null, contexte()))).toBe('piece_introuvable')
    expect(cle(refusDuRetraitDeLaDesignation(piece({ dossier_id: 'd2', facture_id: 'f1' }), contexte()))).toBe('piece_introuvable')
    expect(refusDuRetraitDeLaDesignation(piece(), contexte()))
      .toEqual({ cle: 'pas_designee', message: "Cette pièce n'est l'exemplaire d'aucune facture." })
    expect(cle(refusDuRetraitDeLaDesignation({ id: 'p1', dossier_id: D, type_piece: 'vente' }, contexte()))).toBe('pas_designee')
    expect(refusDuRetraitDeLaDesignation(piece({ facture_id: 'f1' }), contexte({ anneeFigeante: 2024 }))).toEqual({
      cle: 'piece_figee', message: "Cette pièce porte une écriture validée de l'exercice 2024 : sa désignation ne change plus.",
    })
  })

  it('une pièce figée que rien ne désigne : la désignation avant le gel', () => {
    expect(cle(refusDuRetraitDeLaDesignation(piece(), contexte({ anneeFigeante: 2024 })))).toBe('pas_designee')
  })
})

describe('refusDeLaPieceDesignee — ce que la garde refuse d’une pièce désignée qu’on modifie', () => {
  it('une pièce que rien ne désigne change librement', () => {
    expect(refusDeLaPieceDesignee(piece(), { dossier_id: 'd2', type_piece: 'achat' }, FACTURES)).toBeNull()
    expect(refusDeLaPieceDesignee({ id: 'p1', dossier_id: D, type_piece: 'vente' }, { dossier_id: 'd2' }, FACTURES)).toBeNull()
  })

  it('une pièce désignée ne change pas de dossier, et reste une vente ; le dossier se dit d’abord', () => {
    const p = piece({ facture_id: 'f2' })
    expect(refusDeLaPieceDesignee(p, { dossier_id: 'd2' }, FACTURES)).toEqual({
      cle: 'change_de_dossier',
      message: "Cette pièce est l'exemplaire de la facture F2026-0008 : elle ne change plus de dossier — défaire d'abord la désignation.",
    })
    expect(refusDeLaPieceDesignee(p, { type_piece: 'achat' }, FACTURES)).toEqual({
      cle: 'change_de_nature',
      message: "Cette pièce est l'exemplaire de la facture F2026-0008 : elle reste une pièce de vente — défaire d'abord la désignation.",
    })
    expect(cle(refusDeLaPieceDesignee(p, { dossier_id: 'd2', type_piece: 'achat' }, FACTURES))).toBe('change_de_dossier')
  })

  it('le reste d’une pièce désignée se modifie : son dossier et sa nature réécrits à l’identique compris', () => {
    const p = piece({ facture_id: 'f2' })
    expect(refusDeLaPieceDesignee(p, {}, FACTURES)).toBeNull()
    expect(refusDeLaPieceDesignee(p, { dossier_id: D, type_piece: 'vente' }, FACTURES)).toBeNull()
  })
})

// ── 4 bis. Les refus du bloc de VF6b, cas par cas ─────────────────────────────────────────────────────────────────────

function pieceM(o: Partial<PieceMarquable> = {}): PieceMarquable {
  return { id: 'p1', dossier_id: D, type_piece: 'vente', statut: 'a_valider', nom_fichier: 'vente-1.pdf', facture_id: null,
    vente_hors_des_factures: false, ...o }
}
function factureM(o: Partial<FacturePourLesGestes> = {}): FacturePourLesGestes {
  return { id: 'f1', dossier_id: D, statut: 'validee', numero: 'F2026-0007', source_de_la_vente: false, date_emission: '2026-03-14', ...o }
}
// f1 et f2 : d'avant la bascule ; s1 et s2 : sources ; un brouillon ; une facture d'un autre dossier.
const FACTURES_M = [factureM(), factureM({ id: 'f2', numero: 'F2026-0008' }),
  factureM({ id: 's1', numero: 'F2026-0009', source_de_la_vente: true }), factureM({ id: 's2', numero: 'F2026-0010', source_de_la_vente: true }),
  factureM({ id: 'fb', statut: 'brouillon', numero: null }), factureM({ id: 'fa', dossier_id: 'd2', numero: 'F2026-0001' })]
function ctxM(o: Partial<ContexteDesMarques> = {}): ContexteDesMarques {
  return { dossierId: D, anneeFigeante: null, factures: FACTURES_M, exercicesValides: [], dossierBascule: true, pont: AUCUNE,
    liens: SANS_LIEN, facturesDuVirementMixte: new Set<string>(), ...o }
}
const lie = (o: Partial<LiensDeLaPiece>): LiensDeLaPiece => ({ ...SANS_LIEN, ...o })

describe('verdictDuPont — le verdict que les fonctions et G3 tirent de factures_du_pont', () => {
  it('aucune ligne, une ligne de sa nature, une ligne contraire, deux lignes', () => {
    expect(verdictDuPont([])).toEqual({ genre: 'aucune' })
    expect(verdictDuPont([{ facture_id: 'f1', nature_contraire: false }])).toEqual({ genre: 'une', factureId: 'f1' })
    expect(verdictDuPont([{ facture_id: 'f1', nature_contraire: true }])).toEqual({ genre: 'contraires' })
    expect(verdictDuPont([{ facture_id: 'f1', nature_contraire: false }, { facture_id: 'f2', nature_contraire: false }]))
      .toEqual({ genre: 'contraires' })
  })
})

describe('refusDeLaDesignationMarquee — ce que designer_exemplaire_facture (VF6b) refuserait', () => {
  it('acceptée : une pièce que rien ne marque, une pièce désignée à une AUTRE facture ou déclarée (elle se remplace)', () => {
    expect(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 'f2', ctxM())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM({ vente_hors_des_factures: true }), 'f1', ctxM())).toBeNull()
    // Les colonnes de la marque absentes : ni désignée, ni déclarée.
    expect(refusDeLaDesignationMarquee({ id: 'p1', dossier_id: D, type_piece: 'vente', statut: 'a_valider', nom_fichier: 'x.pdf' }, 's1',
      ctxM())).toBeNull()
  })

  it('2. à 7. : les refus d’hier, sauf la désignation à une autre facture', () => {
    expect(cle(refusDeLaDesignationMarquee(null, 'f1', ctxM()))).toBe('piece_introuvable')
    expect(cle(refusDeLaDesignationMarquee(pieceM({ dossier_id: 'd2' }), 'f1', ctxM()))).toBe('piece_introuvable')
    expect(cle(refusDeLaDesignationMarquee(pieceM({ type_piece: 'achat' }), 'f1', ctxM()))).toBe('pas_une_vente')
    expect(refusDeLaDesignationMarquee(pieceM(), 'f1', ctxM({ anneeFigeante: 2026 }))?.message)
      .toBe("Cette pièce porte une écriture validée de l'exercice 2026 : sa désignation ne change plus.")
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f2' }), 'f2', ctxM())).toEqual({
      cle: 'deja_cette_facture', message: "Cette pièce est déjà l'exemplaire de la facture F2026-0008.",
    })
    expect(cle(refusDeLaDesignationMarquee(pieceM(), null, ctxM()))).toBe('facture_introuvable')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 'fa', ctxM()))).toBe('facture_introuvable')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 'fb', ctxM()))).toBe('facture_brouillon')
    // Désignée, avec une facture absente : la facture introuvable, la désignation se remplacerait.
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 'fa', ctxM()))).toBe('facture_introuvable')
  })

  it('8. et 9. le pont, dans un dossier basculé seulement : la facture qu’il prouve est la seule ; des preuves contraires, aucune', () => {
    const pont: VerdictDuPont = { genre: 'une', factureId: 's1' }
    expect(refusDeLaDesignationMarquee(pieceM(), 's2', ctxM({ pont }))).toEqual({
      cle: 'pont_autre_facture',
      message: "Cette pièce est la facture F2026-0009 émise dans l'application, revenue comme pièce : elle n'est l'exemplaire que de celle-ci.",
    })
    expect(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ pont }))).toBeNull()
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ pont: { genre: 'contraires' } })))).toBe('preuves_contraires')
    // Hors d'un dossier basculé, le pont ne retient rien.
    expect(refusDeLaDesignationMarquee(pieceM(), 's2', ctxM({ pont, dossierBascule: false }))).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM(), 's2', ctxM({ pont: { genre: 'contraires' }, dossierBascule: false }))).toBeNull()
  })

  it('10. à 13. une facture source : rapprochée, réglée par une part, écrite, lettrée — dans cet ordre ; une facture d’avant, rien', () => {
    expect(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: lie({ rapprochee: true }) }))?.message).toBe(
      "Cette pièce est rapprochée d'un mouvement du relevé : l'exemplaire de la facture F2026-0009, source de sa vente, ne justifie "
      + "aucun mouvement — annuler d'abord ce rapprochement.")
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: lie({ reglee: true }) })))).toBe('reglee')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: lie({ ecrite: true }) })))).toBe('ecrite')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: lie({ lettree: true }) })))).toBe('lettree')
    const tous = lie({ rapprochee: true, reglee: true, ecrite: true, lettree: true })
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: tous })))).toBe('rapprochee')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ liens: lie({ ecrite: true, lettree: true }) })))).toBe('ecrite')
    expect(refusDeLaDesignationMarquee(pieceM(), 'f1', ctxM({ liens: tous }))).toBeNull()
  })

  it('14. et 15. le virement mixte : ni la facture d’avant qu’elle quitte, ni celle qu’elle prend ; une facture source, jamais', () => {
    const mixte = new Set(['f1', 's1'])
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 'f2', ctxM({ facturesDuVirementMixte: mixte }))).toEqual({
      cle: 'virement_mixte_quittee',
      message: 'Un encaissement de la facture F2026-0007 est compté par un mouvement classé par ses encaissements, qui date son '
        + "exemplaire : retirer d'abord ce classement.",
    })
    expect(refusDeLaDesignationMarquee(pieceM(), 'f1', ctxM({ facturesDuVirementMixte: mixte }))?.cle).toBe('virement_mixte')
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's1' }), 's2', ctxM({ facturesDuVirementMixte: mixte }))).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ facturesDuVirementMixte: mixte }))).toBeNull()
    // Les deux : celle qu'elle quitte d'abord.
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f2' }), 'f1', ctxM({ facturesDuVirementMixte: new Set(['f1', 'f2']) }))))
      .toBe('virement_mixte_quittee')
  })

  it('deux refus ensemble : le premier dans l’ordre de la fonction', () => {
    const pont: VerdictDuPont = { genre: 'une', factureId: 's2' }
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's1' }), 's1', ctxM({ anneeFigeante: 2026 })))).toBe('piece_figee')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 'fb', ctxM({ pont })))).toBe('facture_brouillon')
    expect(cle(refusDeLaDesignationMarquee(pieceM(), 's1', ctxM({ pont, liens: lie({ rapprochee: true }) })))).toBe('pont_autre_facture')
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 's1',
      ctxM({ liens: lie({ lettree: true }), facturesDuVirementMixte: new Set(['f1']) })))).toBe('lettree')
  })
})

describe('refusDuRetraitMarque — ce que defaire_exemplaire_facture (VF6b) refuserait', () => {
  it('une pièce désignée, à valider ou d’un dossier qui n’a pas basculé, se défait', () => {
    expect(refusDuRetraitMarque(pieceM({ facture_id: 'f1' }), ctxM())).toBeNull()
    expect(refusDuRetraitMarque(pieceM({ facture_id: 'f1', statut: 'validee' }), ctxM({ dossierBascule: false }))).toBeNull()
  })

  it('2., 3., puis 4. une pièce validée d’un dossier basculé se remplace, elle ne se défait pas (VF6-Q1) ; 5. le gel ; 6. le virement mixte', () => {
    expect(cle(refusDuRetraitMarque(null, ctxM()))).toBe('piece_introuvable')
    expect(cle(refusDuRetraitMarque(pieceM(), ctxM()))).toBe('pas_designee')
    expect(refusDuRetraitMarque(pieceM({ facture_id: 'f1', statut: 'validee' }), ctxM())?.message).toBe(
      'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa désignation '
      + "— désignez l'autre facture, ou déclarez-la vente hors des factures de l'application.")
    expect(cle(refusDuRetraitMarque(pieceM({ facture_id: 'f1' }), ctxM({ anneeFigeante: 2025 })))).toBe('piece_figee')
    expect(cle(refusDuRetraitMarque(pieceM({ facture_id: 'f1' }), ctxM({ facturesDuVirementMixte: new Set(['f1']) })))).toBe('virement_mixte')
    expect(refusDuRetraitMarque(pieceM({ facture_id: 's1' }), ctxM({ facturesDuVirementMixte: new Set(['s1']) }))).toBeNull()
    // La validation avant le gel, le gel avant le virement mixte.
    expect(cle(refusDuRetraitMarque(pieceM({ facture_id: 'f1', statut: 'validee' }), ctxM({ anneeFigeante: 2025 }))))
      .toBe('validee_dans_un_dossier_bascule')
    expect(cle(refusDuRetraitMarque(pieceM({ facture_id: 'f1' }), ctxM({ anneeFigeante: 2025, facturesDuVirementMixte: new Set(['f1']) }))))
      .toBe('piece_figee')
  })
})

describe('refusDeLaDeclaration — ce que declarer_vente_hors_des_factures refuserait', () => {
  it('une vente que le pont ne rattache à rien, dans un dossier basculé, se déclare — désignée, elle se remplace', () => {
    expect(refusDeLaDeclaration(pieceM(), ctxM())).toBeNull()
    expect(refusDeLaDeclaration(pieceM({ facture_id: 's1' }), ctxM())).toBeNull()
  })

  it('3. une vente ; 4. un dossier basculé ; 5. le gel ; 6. déjà déclarée ; 7. le pont ; 8. les preuves contraires ; 9. le virement mixte', () => {
    expect(cle(refusDeLaDeclaration(null, ctxM()))).toBe('piece_introuvable')
    expect(refusDeLaDeclaration(pieceM({ type_piece: 'note_frais' }), ctxM())?.message)
      .toBe("Seule une pièce de vente se déclare vente hors des factures de l'application.")
    expect(cle(refusDeLaDeclaration(pieceM(), ctxM({ dossierBascule: false })))).toBe('dossier_non_bascule')
    expect(refusDeLaDeclaration(pieceM(), ctxM({ anneeFigeante: 2026 }))?.message)
      .toBe("Cette pièce porte une écriture validée de l'exercice 2026 : sa déclaration ne change plus.")
    expect(cle(refusDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), ctxM()))).toBe('deja_declaree')
    expect(refusDeLaDeclaration(pieceM(), ctxM({ pont: { genre: 'une', factureId: 'f2' } }))?.message).toBe(
      "Cette pièce est la facture F2026-0008 émise dans l'application, revenue comme pièce : elle se désigne exemplaire de cette "
      + "facture, et ne se déclare pas hors des factures de l'application.")
    expect(cle(refusDeLaDeclaration(pieceM(), ctxM({ pont: { genre: 'contraires' } })))).toBe('preuves_contraires')
    expect(cle(refusDeLaDeclaration(pieceM({ facture_id: 'f1' }), ctxM({ facturesDuVirementMixte: new Set(['f1']) })))).toBe('virement_mixte')
    expect(refusDeLaDeclaration(pieceM({ facture_id: 's1' }), ctxM({ facturesDuVirementMixte: new Set(['s1']) }))).toBeNull()
  })

  it('deux refus ensemble : la nature avant la bascule, la bascule avant le gel, le gel avant la déclaration, la déclaration avant le pont', () => {
    expect(cle(refusDeLaDeclaration(pieceM({ type_piece: 'achat' }), ctxM({ dossierBascule: false })))).toBe('pas_une_vente')
    expect(cle(refusDeLaDeclaration(pieceM(), ctxM({ dossierBascule: false, anneeFigeante: 2026 })))).toBe('dossier_non_bascule')
    expect(cle(refusDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), ctxM({ anneeFigeante: 2026 })))).toBe('piece_figee')
    expect(cle(refusDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), ctxM({ pont: { genre: 'contraires' } })))).toBe('deja_declaree')
  })
})

describe('refusDuRetraitDeLaDeclaration — ce que retirer_declaration_hors_des_factures refuserait', () => {
  it('une pièce déclarée, à valider ou d’un dossier qui n’a pas basculé, perd sa déclaration', () => {
    expect(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), ctxM())).toBeNull()
    expect(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true, statut: 'validee' }), ctxM({ dossierBascule: false }))).toBeNull()
  })

  it('2. la pièce ; 3. une pièce déclarée ; 4. validée dans un dossier basculé ; 5. le gel — dans cet ordre', () => {
    expect(cle(refusDuRetraitDeLaDeclaration(null, ctxM()))).toBe('piece_introuvable')
    expect(cle(refusDuRetraitDeLaDeclaration(pieceM(), ctxM()))).toBe('pas_declaree')
    expect(cle(refusDuRetraitDeLaDeclaration({ id: 'p1', dossier_id: D, type_piece: 'vente', statut: 'a_valider', nom_fichier: 'x.pdf' }, ctxM())))
      .toBe('pas_declaree')
    expect(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true, statut: 'validee' }), ctxM())?.message).toBe(
      'Cette pièce est validée dans un dossier dont les factures sont la source de leurs ventes : elle ne perd pas sa déclaration '
      + "— désignez-la exemplaire de sa facture, ou remettez-la d'abord à valider.")
    expect(cle(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), ctxM({ anneeFigeante: 2024 })))).toBe('piece_figee')
    expect(cle(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true, statut: 'validee' }), ctxM({ anneeFigeante: 2024 }))))
      .toBe('validee_dans_un_dossier_bascule')
  })
})

// LE GEL DES DÉSIGNATIONS (étape VF7e ; VF7-Q1, option B, suivie sur la recommandation) : la validation de l'exercice d'une
// facture SOURCE fige la désignation de son exemplaire — qui ne porte jamais d'écriture (G4) —, et une telle facture ne
// reçoit plus qu'une première désignation, d'une pièce que rien ne marque. Les mots de la base, dans son ordre.
describe('le gel des désignations (VF7e) — l’exercice qui fige une facture source, et la désignation de son exemplaire', () => {
  // s25 : une facture source de décembre 2025 ; a25 : son avoir ; s23 : une facture source de 2023 ; p25 : une facture d'avant
  // la bascule, de 2025 ; s26 : une facture source de 2026.
  const s25 = factureM({ id: 's25', numero: 'F2025-0042', source_de_la_vente: true, date_emission: '2025-12-15' })
  const a25 = factureM({ id: 'a25', numero: 'A2025-0003', source_de_la_vente: true, date_emission: '2025-12-20' })
  const s23 = factureM({ id: 's23', numero: 'F2023-0001', source_de_la_vente: true, date_emission: '2023-03-01' })
  const p25 = factureM({ id: 'p25', numero: 'F2025-0007', source_de_la_vente: false, date_emission: '2025-11-01' })
  const s26 = factureM({ id: 's26', numero: 'F2026-0001', source_de_la_vente: true, date_emission: '2026-01-10' })
  const factures = [...FACTURES_M, s25, a25, s23, p25, s26]
  const gele = (o: Partial<ContexteDesMarques> = {}) => ctxM({ factures, exercicesValides: [2024, 2025], ...o })
  const FIGEE_2025 = "Cette pièce est l'exemplaire de la facture F2025-0042, figée par la validation de l'exercice 2025 : sa désignation "
    + 'ne change plus.'

  it('exerciceFigeantLaFactureSource : le premier exercice validé qui couvre sa date d’émission, ou la suit ; rien pour une facture qui n’est pas source', () => {
    expect(exerciceFigeantLaFactureSource(s25, [2024, 2025])).toBe(2025)
    expect(exerciceFigeantLaFactureSource(s25, [2025, 2026])).toBe(2025)
    // Ce qui précède le premier exercice validé est figé avec lui.
    expect(exerciceFigeantLaFactureSource(s23, [2024, 2025])).toBe(2024)
    expect(exerciceFigeantLaFactureSource(s26, [2024, 2025])).toBeNull()
    expect(exerciceFigeantLaFactureSource(s25, [])).toBeNull()
    expect(exerciceFigeantLaFactureSource(s25, [2024])).toBeNull()
    expect(exerciceFigeantLaFactureSource(p25, [2024, 2025])).toBeNull()
    expect(exerciceFigeantLaFactureSource(undefined, [2025])).toBeNull()
  })

  it('exerciceFigeantLaDesignation : le plus ancien de celui de la pièce et de celui de la facture source qu’elle désigne', () => {
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 's25' }), gele())).toBe(2025)
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 's25' }), gele({ anneeFigeante: 2024 }))).toBe(2024)
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 's23' }), gele({ anneeFigeante: 2025 }))).toBe(2024)
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 'p25' }), gele())).toBeNull()
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 'p25' }), gele({ anneeFigeante: 2025 }))).toBe(2025)
    expect(exerciceFigeantLaDesignation(pieceM(), gele({ anneeFigeante: 2026 }))).toBe(2026)
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 's26' }), gele())).toBeNull()
    // Une facture que la liste ne porte pas ne fige rien ici : l'écran ne propose alors aucun geste (la fiche le dit).
    expect(exerciceFigeantLaDesignation(pieceM({ facture_id: 'absente' }), gele())).toBeNull()
  })

  it('désigner : la désignation figée ne se remplace pas — la facture nommée quand c’est elle qui fige, les mots d’hier sinon', () => {
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 's26', gele())).toEqual({ cle: 'designation_figee', message: FIGEE_2025 })
    // Le gel avant « déjà l'exemplaire de cette facture ».
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 's25', gele()))).toBe('designation_figee')
    // La pièce figée plus tôt que sa facture : les mots d'hier, et son année.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 's26', gele({ anneeFigeante: 2024 }))?.message)
      .toBe("Cette pièce porte une écriture validée de l'exercice 2024 : sa désignation ne change plus.")
    // La facture plus tôt que la pièce : la facture, et son année ; à égalité, les mots d'hier.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's23' }), 's26', gele({ anneeFigeante: 2025 }))?.message)
      .toBe("Cette pièce est l'exemplaire de la facture F2023-0001, figée par la validation de l'exercice 2024 : sa désignation ne change plus.")
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 's26', gele({ anneeFigeante: 2025 })))).toBe('piece_figee')
    // Une facture d'avant la bascule ne fige rien de ce côté ; une facture source que rien ne fige non plus.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'p25' }), 's26', gele())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's26' }), 'f1', gele())).toBeNull()
    // Sans exercice validé, rien ne se fige.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 's26', gele({ exercicesValides: [] }))).toBeNull()
  })

  it('désigner À une facture source figée (7 bis) : une première désignation seulement, d’une pièce que rien ne marque', () => {
    expect(refusDeLaDesignationMarquee(pieceM(), 's25', gele())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM(), 'a25', gele())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM(), 's23', gele())).toBeNull()
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's26' }), 's25', gele())).toEqual({
      cle: 'facture_figee',
      message: "La facture F2025-0042 est figée par la validation de l'exercice 2025 : elle ne reçoit plus qu'une première désignation, "
        + "d'une pièce qui n'est encore ni l'exemplaire d'une facture ni déclarée — retirer d'abord sa désignation ou sa déclaration "
        + "(validée, la pièce se remet d'abord à valider).",
    })
    expect(refusDeLaDesignationMarquee(pieceM({ vente_hors_des_factures: true }), 'a25', gele())?.message)
      .toMatch(/^La facture A2025-0003 est figée par la validation de l'exercice 2025 : /)
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 's23', gele())?.message)
      .toMatch(/^La facture F2023-0001 est figée par la validation de l'exercice 2024 : /)
    // Une facture d'avant la bascule, d'un exercice validé : elle n'est pas source, ce côté ne la fige pas.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 's26' }), 'p25', gele())).toBeNull()
    // Une facture source que rien ne fige reçoit une pièce marquée.
    expect(refusDeLaDesignationMarquee(pieceM({ facture_id: 'f1' }), 's26', gele())).toBeNull()
    // Dans l'ordre : après le brouillon, avant le pont et les liens.
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's26' }), 'fb', gele()))).toBe('facture_brouillon')
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's26' }), 's25',
      gele({ pont: { genre: 'une', factureId: 's26' }, liens: lie({ rapprochee: true }) })))).toBe('facture_figee')
    // Sa désignation figée d'abord : le rang 4 avant le 7 bis.
    expect(cle(refusDeLaDesignationMarquee(pieceM({ facture_id: 's25' }), 'a25', gele()))).toBe('designation_figee')
  })

  it('défaire et déclarer : la désignation figée ne se défait ni ne se remplace par une déclaration ; la validation d’abord', () => {
    expect(refusDuRetraitMarque(pieceM({ facture_id: 's25' }), gele())).toEqual({ cle: 'designation_figee', message: FIGEE_2025 })
    expect(cle(refusDuRetraitMarque(pieceM({ facture_id: 's25', statut: 'validee' }), gele()))).toBe('validee_dans_un_dossier_bascule')
    expect(refusDuRetraitMarque(pieceM({ facture_id: 's26' }), gele())).toBeNull()
    expect(refusDeLaDeclaration(pieceM({ facture_id: 's25' }), gele())).toEqual({ cle: 'designation_figee', message: FIGEE_2025 })
    expect(cle(refusDeLaDeclaration(pieceM({ facture_id: 's25' }), gele({ dossierBascule: false })))).toBe('dossier_non_bascule')
    expect(refusDeLaDeclaration(pieceM({ facture_id: 's26' }), gele())).toBeNull()
    // Une pièce déclarée ne désigne aucune facture : son gel reste celui de la pièce, sous les mots d'hier.
    expect(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), gele())).toBeNull()
    expect(refusDuRetraitDeLaDeclaration(pieceM({ vente_hors_des_factures: true }), gele({ anneeFigeante: 2025 }))?.message)
      .toBe("Cette pièce porte une écriture validée de l'exercice 2025 : sa déclaration ne change plus.")
  })
})

describe('refusDeLaValidationDUneVente — G3, la pièce de vente validée d’un dossier basculé', () => {
  const g3 = (avant: PieceMarquable | null, apres: PieceMarquable, o: Partial<{ basculeDuDossier: boolean; pont: VerdictDuPont }> = {}) =>
    refusDeLaValidationDUneVente(avant, apres, { factures: FACTURES_M, basculeDuDossier: true, pont: AUCUNE, ...o })
  const validee = (o: Partial<PieceMarquable> = {}) => pieceM({ statut: 'validee', ...o })

  it('hors de son champ : une pièce qui n’est pas une vente validée, un dossier qui n’a pas basculé, une pièce validée qui reste ce qu’elle est (EC3-Q1)', () => {
    expect(g3(pieceM(), pieceM())).toBeNull()
    expect(g3(pieceM({ type_piece: 'achat' }), validee({ type_piece: 'achat' }))).toBeNull()
    expect(g3(pieceM(), validee(), { basculeDuDossier: false })).toBeNull()
    expect(g3(validee(), validee())).toBeNull()
    expect(g3(validee(), validee(), { pont: { genre: 'une', factureId: 's1' } })).toBeNull()
  })

  it('1. née validée ; 2. le pont, la facture nommée ; 3. les preuves contraires ; 4. ni désignée ni déclarée', () => {
    expect(g3(null, validee())?.message)
      .toBe('Une pièce de vente naît à valider dans un dossier dont les factures sont la source de leurs ventes.')
    expect(g3(pieceM(), validee(), { pont: { genre: 'une', factureId: 's1' } })?.message).toBe(
      "La pièce « vente-1.pdf » est la facture F2026-0009 émise dans l'application, revenue comme pièce : désignez-la exemplaire de "
      + 'cette facture avant de la valider.')
    expect(cle(g3(pieceM(), validee({ facture_id: 's2' }), { pont: { genre: 'une', factureId: 's1' } }))).toBe('pont_une_facture')
    expect(cle(g3(pieceM(), validee({ vente_hors_des_factures: true }), { pont: { genre: 'une', factureId: 's1' } }))).toBe('pont_une_facture')
    expect(g3(pieceM(), validee({ facture_id: 's1' }), { pont: { genre: 'une', factureId: 's1' } })).toBeNull()
    expect(cle(g3(pieceM(), validee({ facture_id: 's1' }), { pont: { genre: 'contraires' } }))).toBe('preuves_contraires')
    expect(g3(pieceM(), validee())?.message).toBe(
      "Désignez la pièce « vente-1.pdf » exemplaire de sa facture, ou déclarez-la vente hors des factures de l'application, avant "
      + 'de la valider : les factures de ce dossier sont la source de leurs ventes.')
    expect(g3(pieceM(), validee({ facture_id: 'f1' }))).toBeNull()
    expect(g3(pieceM(), validee({ vente_hors_des_factures: true }))).toBeNull()
  })

  it('le passage : une pièce validée qui devient une vente, arrive d’un autre dossier, ou dont la marque change, se juge', () => {
    expect(cle(g3(validee({ type_piece: 'achat' }), validee()))).toBe('ni_designee_ni_declaree')
    expect(cle(g3(validee({ dossier_id: 'd2' }), validee()))).toBe('ni_designee_ni_declaree')
    expect(cle(g3(validee({ facture_id: 'f1' }), validee({ facture_id: 'f2' }), { pont: { genre: 'une', factureId: 'f1' } })))
      .toBe('pont_une_facture')
  })

  // Le passage, seul (étape VF6c) : ce que la fiche d'une pièce lit pour savoir si la validation attend la lecture du dossier.
  it('passageJugeParG3 : une vente qui DEVIENT validée, et elle seule', () => {
    expect(passageJugeParG3(null, validee())).toBe(true)
    expect(passageJugeParG3(pieceM(), validee())).toBe(true)
    expect(passageJugeParG3(validee({ type_piece: 'achat' }), validee())).toBe(true)
    expect(passageJugeParG3(validee({ dossier_id: 'd2' }), validee())).toBe(true)
    expect(passageJugeParG3(validee(), validee({ facture_id: 'f1' }))).toBe(true)
    expect(passageJugeParG3(validee(), validee({ vente_hors_des_factures: true }))).toBe(true)
    expect(passageJugeParG3(validee(), validee())).toBe(false)
    expect(passageJugeParG3(pieceM(), pieceM())).toBe(false)
    expect(passageJugeParG3(null, validee({ type_piece: 'achat' }))).toBe(false)
  })
})

describe('refusDeLaModificationMarquee — la garde d’une pièce marquée, puis G3', () => {
  const contexte = (o: Partial<{ basculeDuDossier: boolean; pont: VerdictDuPont }> = {}) =>
    ({ factures: FACTURES_M, basculeDuDossier: true, pont: AUCUNE, ...o })

  it('une pièce désignée, puis une pièce déclarée, ne changent ni de dossier ni de nature — le dossier se dit d’abord', () => {
    expect(refusDeLaModificationMarquee(pieceM({ facture_id: 'f2' }), { dossier_id: 'd2' }, contexte())?.cle).toBe('change_de_dossier')
    expect(refusDeLaModificationMarquee(pieceM({ facture_id: 'f2' }), { type_piece: 'achat' }, contexte())?.message)
      .toBe("Cette pièce est l'exemplaire de la facture F2026-0008 : elle reste une pièce de vente — défaire d'abord la désignation.")
    expect(refusDeLaModificationMarquee(pieceM({ vente_hors_des_factures: true }), { dossier_id: 'd2', type_piece: 'achat' }, contexte())?.message)
      .toBe("Cette pièce est déclarée vente hors des factures de l'application : elle ne change plus de dossier — retirer d'abord la "
        + 'déclaration.')
    expect(refusDeLaModificationMarquee(pieceM({ vente_hors_des_factures: true }), { type_piece: 'autre' }, contexte())?.cle)
      .toBe('declaree_change_de_nature')
  })

  it('puis G3 : une pièce que rien ne marque ne se valide pas dans un dossier basculé ; marquée, elle se valide', () => {
    expect(refusDeLaModificationMarquee(pieceM(), { statut: 'validee' }, contexte())?.cle).toBe('ni_designee_ni_declaree')
    expect(refusDeLaModificationMarquee(pieceM({ facture_id: 'f1' }), { statut: 'validee' }, contexte())).toBeNull()
    expect(refusDeLaModificationMarquee(pieceM({ vente_hors_des_factures: true }), { statut: 'validee' }, contexte())).toBeNull()
    expect(refusDeLaModificationMarquee(pieceM(), { statut: 'validee' }, contexte({ basculeDuDossier: false }))).toBeNull()
    // Le reste d'une pièce marquée se modifie, son dossier et sa nature réécrits à l'identique compris.
    expect(refusDeLaModificationMarquee(pieceM({ facture_id: 'f1' }), { dossier_id: D, type_piece: 'vente' }, contexte())).toBeNull()
  })
})

describe('refusDuLienDeLExemplaire — G4', () => {
  it('l’exemplaire d’une facture source ne se lie à rien ; celui d’une facture d’avant, une pièce que rien ne désigne, si', () => {
    expect(refusDuLienDeLExemplaire(pieceM({ facture_id: 's1' }), FACTURES_M)).toEqual({
      cle: 'exemplaire_d_une_source',
      message: "La pièce « vente-1.pdf » est l'exemplaire de la facture F2026-0009, source de sa vente : la vente se règle et s'écrit "
        + 'par sa facture et ses encaissements.',
    })
    expect(refusDuLienDeLExemplaire(pieceM({ facture_id: 'f1' }), FACTURES_M)).toBeNull()
    expect(refusDuLienDeLExemplaire(pieceM(), FACTURES_M)).toBeNull()
    expect(refusDuLienDeLExemplaire(pieceM({ vente_hors_des_factures: true }), FACTURES_M)).toBeNull()
  })
})

// ── 5. Les drapeaux, et le texte des migrations exportées ─────────────────────────────────────────────────────────────

/** La définition d'une fonction dans UN texte de migration : la dernière qu'il porte, jusqu'à la fin de son corps. */
function definitionDans(texte: string, nom: string): string {
  const positions = [...texte.matchAll(new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g'))].map((m) => m.index)
  const debut = positions.at(-1)
  if (debut === undefined) throw new Error(`Fonction ${nom} introuvable dans ce texte.`)
  const fin = texte.indexOf('$$;', debut)
  if (fin < 0) throw new Error(`Corps de ${nom} introuvable dans ce texte.`)
  return texte.slice(debut, fin)
}

describe('les drapeaux, et les deux modules confrontés au texte exporté', () => {
  const fichiers = fichiersDuSchema()
  const texteDe = (motif: RegExp) => fichiers.find((f) => motif.test(f.texte))?.texte
  const VF1A = texteDe(/create function public\.designer_exemplaire_facture\(/)
  const VF6B = texteDe(/create function public\.declarer_vente_hors_des_factures\(/)

  it('chaque drapeau dit ce que porte l’export : levé quand sa migration y est, baissé sinon', () => {
    expect(EXEMPLAIRES_DES_FACTURES_EXPORTES, 'EXEMPLAIRES_DES_FACTURES_EXPORTES ne dit plus ce que porte l’export').toBe(VF1A !== undefined)
    expect(JUMELLE_INVERSEE_EXPORTEE, 'JUMELLE_INVERSEE_EXPORTEE ne dit plus ce que porte l’export').toBe(VF6B !== undefined)
  })

  // ── VF1a : le texte de SA migration, que la production exécute tant que celle de VF6b n'y est pas ──

  it('VF1a, exportée : désigner — les mêmes messages, dans le même ordre, sous les mêmes codes, aux mêmes valeurs', () => {
    if (VF1A === undefined) return
    const sql = definitionDans(VF1A, 'designer_exemplaire_facture')
    expect(messagesSql(sql)).toEqual(modeles(REFUS_DESIGNATION))
    expect(codesSql(sql)).toEqual(REFUS_DESIGNATION.map((r) => r.code))
    expect(argumentsSql(sql)).toEqual([[], [], [], ['v_annee'], ['v_numero'], ['v_numero'], [], []])
    expect(sql).toMatch(/designer_exemplaire_facture\(p_dossier_id uuid, p_piece_id uuid, p_facture_id uuid\)\nreturns public\.pieces\nlanguage plpgsql\nsecurity definer\nset search_path = public/)
    // L'accès d'abord, puis le verrou partagé de la validation, avant toute lecture de la pièce.
    const corps = sql.slice(sql.indexOf('\nbegin\n'))
    const acces = corps.indexOf("raise exception 'Accès refusé à ce dossier.'")
    expect(acces).toBeGreaterThan(0)
    expect(corps.slice(0, acces)).not.toMatch(/from public\.pieces/)
    expect(corps.indexOf('pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id))')).toBeGreaterThan(acces)
    expect(corps.indexOf('from public.pieces p')).toBeGreaterThan(corps.indexOf('pg_advisory_xact_lock_shared'))
    expect(sql).toContain('v_annee := public.exercice_figeant_la_piece(p_piece_id);')
  })

  it('VF1a, exportée : défaire — de même', () => {
    if (VF1A === undefined) return
    const sql = definitionDans(VF1A, 'defaire_exemplaire_facture')
    expect(messagesSql(sql)).toEqual(modeles(REFUS_RETRAIT_DESIGNATION))
    expect(codesSql(sql)).toEqual(REFUS_RETRAIT_DESIGNATION.map((r) => r.code))
    expect(argumentsSql(sql)).toEqual([[], [], [], ['v_annee']])
    expect(sql).toMatch(/defaire_exemplaire_facture\(p_dossier_id uuid, p_piece_id uuid\)\nreturns public\.pieces\nlanguage plpgsql\nsecurity definer\nset search_path = public/)
  })

  it('VF1a, exportée : la garde — ses refus dans l’ordre de son texte, aux droits de l’appelant', () => {
    if (VF1A === undefined) return
    const sql = definitionDans(VF1A, 'garder_exemplaire_facture')
    const parCle = (c: string) => REFUS_GARDE_EXEMPLAIRE.find((r) => r.cle === c) as (typeof REFUS_GARDE_EXEMPLAIRE)[number]
    expect(messagesSql(sql)).toEqual(ORDRE_DES_REFUS_DE_LA_GARDE.map((c) => parCle(c).modele))
    expect(codesSql(sql)).toEqual(ORDRE_DES_REFUS_DE_LA_GARDE.map((c) => parCle(c).code))
    expect(sql).toMatch(/garder_exemplaire_facture\(\) returns trigger\nlanguage plpgsql\nset search_path = public\nas/)
    // Le réglage que les deux fonctions annoncent est celui que la garde lit, pour la pièce même.
    expect(sql).toContain("coalesce(current_setting('jd.exemplaire_facture', true), '') is distinct from old.id::text")
    for (const f of ['designer_exemplaire_facture', 'defaire_exemplaire_facture']) {
      const corps = definitionDans(VF1A, f)
      expect(corps, f).toContain("perform set_config('jd.exemplaire_facture', p_piece_id::text, true);")
      expect(corps, f).toContain("perform set_config('jd.exemplaire_facture', '', true);")
    }
  })

  it('VF1a, exportée : la colonne, sa clé sans action, l’index, le déclencheur et les droits d’exécution', () => {
    if (VF1A === undefined) return
    expect(VF1A).toContain('alter table public.pieces add column facture_id uuid references public.factures_emises (id);')
    expect(VF1A).toContain('create index pieces_facture_idx on public.pieces (facture_id) where facture_id is not null;')
    expect(VF1A).toContain('create trigger pieces_exemplaire_de_facture\n  before insert or update of facture_id, dossier_id, type_piece on public.pieces\n  for each row execute function public.garder_exemplaire_facture();')
    expect(VF1A).toContain('revoke execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) from public, anon;')
    expect(VF1A).toContain('grant execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) to authenticated;')
    expect(VF1A).toContain('revoke execute on function public.defaire_exemplaire_facture(uuid, uuid) from public, anon;')
    expect(VF1A).toContain('grant execute on function public.defaire_exemplaire_facture(uuid, uuid) to authenticated;')
    expect(VF1A).toContain('revoke execute on function public.garder_exemplaire_facture() from public, anon, authenticated;')
    // Aucune policy : la migration n'en crée ni n'en change.
    expect(VF1A).not.toMatch(/\b(create|alter) policy\b/i)
  })

  // ── VF6b : le texte de SA migration, et les définitions qui font foi depuis qu'elle est la dernière ──

  it('VF6b puis VF7e, exportées : les quatre fonctions du cabinet — les mêmes messages, dans le même ordre, sous les mêmes codes, aux mêmes valeurs', () => {
    if (!JUMELLE_INVERSEE_EXPORTEE) return
    const numero = "coalesce(v_numero, '(sans numéro)')"
    // Les définitions qui font foi sont celles de la migration du gel des désignations (VF7e), la dernière de l'export : le
    // rang 4 ou 5 du gel dit la facture et l'exercice, puis les mots d'hier ; le rang 7 bis de la désignation, la facture et
    // l'exercice.
    const attendus: Record<Fonction, string[][]> = {
      designer_exemplaire_facture: [[], [], [], ['v_numero', 'v_annee'], ['v_annee'], ['v_numero'], [], [], ['v_numero', 'v_annee'],
        ['v_numero'], [], ['v_numero'], ['v_numero'], ['v_numero'], ['v_numero'], [numero], [numero]],
      defaire_exemplaire_facture: [[], [], [], [], ['v_numero', 'v_annee'], ['v_annee'], [numero]],
      declarer_vente_hors_des_factures: [[], [], [], [], ['v_numero', 'v_annee'], ['v_annee'], [], ['v_numero'], [], [numero]],
      retirer_declaration_hors_des_factures: [[], [], [], [], ['v_annee']],
    }
    for (const f of FONCTIONS) {
      const sql = derniereDefinitionSql(f)
      expect(messagesSql(sql), f).toEqual(modeles(REFUS_DE[f]))
      expect(codesSql(sql), f).toEqual(REFUS_DE[f].map((r) => r.code))
      expect(argumentsSql(sql), f).toEqual(attendus[f])
      expect(sql, f).toMatch(new RegExp(`${f}\\(p_dossier_id uuid, p_piece_id uuid(, p_facture_id uuid)?\\)\\nreturns public\\.pieces\\nlanguage plpgsql\\nsecurity definer\\nset search_path = public`))
      // L'accès d'abord, puis le verrou partagé de la validation, avant toute lecture de la pièce ; le réglage annoncé pour
      // la pièce même, puis retiré ; le journal écrit sous lui.
      const corps = sql.slice(sql.indexOf('\nbegin\n'))
      const acces = corps.indexOf("raise exception 'Accès refusé à ce dossier.'")
      expect(acces, f).toBeGreaterThan(0)
      expect(corps.slice(0, acces), f).not.toMatch(/from public\.pieces/)
      expect(corps.indexOf('pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id))'), f).toBeGreaterThan(acces)
      const pose = corps.indexOf("perform set_config('jd.exemplaire_facture', p_piece_id::text, true);")
      const retrait = corps.indexOf("perform set_config('jd.exemplaire_facture', '', true);")
      const journal = corps.indexOf('insert into public.designations_des_pieces')
      expect([pose > 0, journal > pose, retrait > journal], f).toEqual([true, true, true])
    }
  })

  it('VF6b, exportée : la garde étendue, G3, G4 et la garde du journal — leurs refus dans l’ordre de leur texte', () => {
    if (!JUMELLE_INVERSEE_EXPORTEE) return
    const dans = <C extends string>(liste: readonly { cle: string; modele: string; code: string }[], ordre: readonly C[]) =>
      ordre.map((c) => liste.find((r) => r.cle === c) as { modele: string; code: string })
    const garde = derniereDefinitionSql('garder_exemplaire_facture')
    expect(messagesSql(garde)).toEqual(dans(REFUS_GARDE_JUMELLE, ORDRE_DES_REFUS_DE_LA_GARDE_JUMELLE).map((r) => r.modele))
    expect(codesSql(garde)).toEqual(dans(REFUS_GARDE_JUMELLE, ORDRE_DES_REFUS_DE_LA_GARDE_JUMELLE).map((r) => r.code))
    expect(garde).toMatch(/garder_exemplaire_facture\(\) returns trigger\nlanguage plpgsql\nset search_path = public\nas/)
    const g3 = derniereDefinitionSql('garder_vente_d_un_dossier_bascule')
    expect(messagesSql(g3)).toEqual(modeles(REFUS_VALIDATION_D_UNE_VENTE))
    expect(codesSql(g3)).toEqual(REFUS_VALIDATION_D_UNE_VENTE.map((r) => r.code))
    expect(argumentsSql(g3)).toEqual([[], ['new.nom_fichier', "coalesce(v_numero, '(sans numéro)')"], ['new.nom_fichier'], ['new.nom_fichier']])
    const g4 = derniereDefinitionSql('garder_exemplaire_d_une_source')
    expect(messagesSql(g4)).toEqual(modeles(REFUS_EXEMPLAIRE_D_UNE_SOURCE))
    expect(argumentsSql(g4)).toEqual([['v_nom', "coalesce(v_numero, '(sans numéro)')"]])
    const journal = derniereDefinitionSql('garder_designation_des_pieces')
    expect(messagesSql(journal)).toEqual(dans(REFUS_JOURNAL, ORDRE_DES_REFUS_DU_JOURNAL).map((r) => r.modele))
    expect(codesSql(journal)).toEqual(dans(REFUS_JOURNAL, ORDRE_DES_REFUS_DU_JOURNAL).map((r) => r.code))
  })

  it('VF6b, exportée : la colonne et sa contrainte, les déclencheurs, le journal et ses deux policies, les droits d’exécution', () => {
    if (VF6B === undefined) return
    expect(VF6B).toContain('alter table public.pieces add column vente_hors_des_factures boolean not null default false;')
    expect(VF6B).toContain("check (not vente_hors_des_factures or (type_piece = 'vente' and facture_id is null));")
    expect(VF6B).toContain('create or replace trigger pieces_exemplaire_de_facture\n  before insert or update of facture_id, vente_hors_des_factures, dossier_id, type_piece on public.pieces')
    expect(VF6B).toContain('create trigger pieces_vente_d_un_dossier_bascule\n  before insert or update of statut, type_piece, dossier_id, facture_id, vente_hors_des_factures on public.pieces')
    for (const t of TABLES_DE_G4) {
      expect(VF6B, t).toContain(`create trigger ${t}_sans_exemplaire_d_une_source before insert or update of piece_id on public.${t}\n  for each row execute function public.garder_exemplaire_d_une_source();`)
    }
    expect(VF6B).toContain('create trigger designations_des_pieces_gardes before insert or update or delete on public.designations_des_pieces')
    expect(VF6B).toContain('alter table public.designations_des_pieces enable row level security;')
    // Les gestes du journal : ceux du module, dans l'ordre de sa contrainte.
    expect(VF6B).toContain(`check (geste in (${GESTES_DU_JOURNAL.map((g) => `'${g}'`).join(', ')}))`)
    expect([...VF6B.matchAll(/create policy (\w+) on public\.(\w+)\n\s+for (\w+) to (\w+) (?:using|with check) \(([^;]*)\);/g)]
      .map((m) => m.slice(1).join(' '))).toEqual([
      'designations_des_pieces_lecture designations_des_pieces select authenticated admin_du_dossier(dossier_id)',
      'designations_des_pieces_restauration designations_des_pieces insert authenticated is_super_admin()',
    ])
    // Aucune autre policy : ni créée, ni changée, ni retirée ; aucune donnée retirée.
    expect([...VF6B.matchAll(/\b(create|alter|drop) policy\b/gi)]).toHaveLength(2)
    expect(VF6B).not.toMatch(/\b(delete from|drop table|drop column|truncate)\b/i)
    for (const f of ['declarer_vente_hors_des_factures', 'retirer_declaration_hors_des_factures']) {
      expect(VF6B, f).toContain(`revoke execute on function public.${f}(uuid, uuid) from public, anon;`)
      expect(VF6B, f).toContain(`grant execute on function public.${f}(uuid, uuid) to authenticated;`)
    }
    for (const f of ['factures_du_pont(public.pieces)', 'garder_vente_d_un_dossier_bascule()', 'garder_exemplaire_d_une_source()',
      'garder_designation_des_pieces()']) {
      expect(VF6B, f).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`)
    }
  })

  it('VF6b, exportée : sa garde ne la remplace que sur les corps de VF1a, au caractère près', () => {
    if (VF6B === undefined || VF1A === undefined) return
    // Le préalable compare l'empreinte des trois corps d'hier à celle du texte de VF1a : la vérifier ici, c'est vérifier que
    // la migration exige bien les corps que la production exécute.
    const corps = (nom: string) => {
      const def = definitionDans(VF1A, nom)
      return def.slice(def.indexOf('$$') + 2)
    }
    for (const [nom, empreinte] of [...VF6B.matchAll(/\('public\.(\w+)\([^)]*\)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]])) {
      expect(md5(corps(nom)), nom).toBe(empreinte)
    }
  })

  // ── VF7e : le gel des désignations — sa migration appliquée le 26/10/2026 (`20261026000808`) ──

  const VF7E = fichiers.find((f) => /\/\d{14}_gel_des_designations\.sql$/.test(f.chemin))?.texte

  it('VF7e, exportée : sa garde ne remplace que les corps de VF6b — ceux que la production exécute —, au caractère près', () => {
    expect(VF7E).toBeDefined()
    if (VF7E === undefined || VF6B === undefined) return
    const corps = (nom: string) => {
      const def = definitionDans(VF6B, nom)
      return def.slice(def.indexOf('$$') + 2)
    }
    const garde = [...VF7E.matchAll(/\('public\.(\w+)\([^)]*\)', '([0-9a-f]{32})'\)/g)].map((m) => [m[1], m[2]])
    expect(garde.map(([nom]) => nom)).toEqual([...FONCTIONS])
    for (const [nom, empreinte] of garde) expect(md5(corps(nom)), nom).toBe(empreinte)
  })

  it('VF7e, exportée : chaque définition de VF6b, ligne à ligne, dans la nouvelle — la ligne du gel lue comme la nouvelle', () => {
    if (VF7E === undefined || VF6B === undefined) return
    const GEL_HIER = 'v_annee := public.exercice_figeant_la_piece(p_piece_id);'
    const GEL_NEUF = 'v_annee := public.exercice_figeant_la_designation(p_piece_id);'
    for (const f of FONCTIONS) {
      const hier = definitionDans(VF6B, f).replace('create function', 'create or replace function').replace(GEL_HIER, GEL_NEUF)
      const neuf = definitionDans(VF7E, f)
      const neuves = neuf.split('\n')
      let k = 0
      for (const ligne of hier.split('\n')) {
        while (k < neuves.length && neuves[k] !== ligne) k++
        expect(k < neuves.length, `${f} : ${ligne}`).toBe(true)
        k++
      }
      // Le gel se lit une fois, par la fonction neuve ; celui d'hier, à ce rang, plus jamais.
      expect(neuf.split(GEL_NEUF), f).toHaveLength(2)
      expect(neuf, f).not.toContain('v_annee := public.exercice_figeant_la_piece(')
    }
  })

  it('VF7e, exportée : deux fonctions neuves aux droits de l’appelant, qu’aucun rôle de l’API n’exécute ; rien que le détecteur retiendrait', () => {
    if (VF7E === undefined) return
    for (const nom of ['exercice_figeant_la_facture_source', 'exercice_figeant_la_designation']) {
      const def = derniereDefinitionSql(nom)
      expect(def, nom).toMatch(new RegExp(`^create function public\\.${nom}\\(p_\\w+ uuid\\) returns integer\\nlanguage sql stable set search_path = public as`))
      expect(def, nom).not.toContain('security definer')
      expect(VF7E, nom).toContain(`revoke execute on function public.${nom}(uuid) from public, anon, authenticated;`)
    }
    expect(VF7E).not.toMatch(/\b(drop|delete|truncate|grant)\b/i)
    expect(VF7E).not.toMatch(/\b(create|alter) (table|policy|trigger)\b/i)
    expect(VF7E).not.toContain('\\')
    // Ce qui ne change pas : le gel de la pièce, que sert aussi la fiche d'un achat hors de France ; la garde des pièces figées.
    expect(VF7E).not.toMatch(/function public\.(exercice_figeant_la_piece|garder_piece_validee)\(/)
  })

  it('VF7e, exportée : la condition qui porte VF7-Q1, une seule et nommée — l’option (A) la remplace par true, l’option (C) par false', () => {
    if (VF7E === undefined) return
    const sql = derniereDefinitionSql('designer_exemplaire_facture')
    expect(sql.split('\n').filter((l) => /\bv_deja_marquee\b/.test(l) && !l.trim().startsWith('--'))).toEqual([
      '  v_deja_marquee boolean;',
      '  v_deja_marquee := v_piece.facture_id is not null or v_piece.vente_hors_des_factures;',
      '  if v_annee is not null and v_deja_marquee then',
    ])
    // Le rang qu'elle garde suit le 7 et précède le pont ; il lit l'exercice de la facture choisie.
    const corps = sql.slice(sql.indexOf('\nbegin\n'))
    const rang7 = corps.indexOf("raise exception 'Seule une facture validée a un exemplaire")
    const lu = corps.indexOf('v_annee := public.exercice_figeant_la_facture_source(p_facture_id);')
    const rang7bis = corps.indexOf('if v_annee is not null and v_deja_marquee then')
    const pont = corps.indexOf('from public.factures_du_pont(v_piece)')
    expect([rang7 > 0, lu > rang7, rang7bis > lu, pont > rang7bis]).toEqual([true, true, true, true])
  })

  it('les paramètres, dans l’ordre des signatures exportées, et tels que le module les envoie (les drapeaux baissés comme levés)', () => {
    expect(argumentsDeLaDesignation('d', 'p', 'f')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p', p_facture_id: 'f' })
    expect(argumentsDuRetraitDeLaDesignation('d', 'p')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p' })
    expect(argumentsDeLaDeclaration('d', 'p')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p' })
    expect(argumentsDuRetraitDeLaDeclaration('d', 'p')).toEqual({ p_dossier_id: 'd', p_piece_id: 'p' })
    // PostgREST les lit par leur nom ; l'ordre des signatures (celui des migrations), pour qui les relit.
    expect([argumentsDeLaDesignation('d', 'p', 'f'), argumentsDuRetraitDeLaDesignation('d', 'p'), argumentsDeLaDeclaration('d', 'p'),
      argumentsDuRetraitDeLaDeclaration('d', 'p')].map((a) => Object.keys(a).join(','))).toEqual([
      'p_dossier_id,p_piece_id,p_facture_id', 'p_dossier_id,p_piece_id', 'p_dossier_id,p_piece_id', 'p_dossier_id,p_piece_id'])
    const parametresDe = (nom: string) => (/function public\.\w+\(([^)]*)\)/.exec(derniereDefinitionSql(nom))?.[1] ?? '')
      .split(',').map((p) => p.trim().split(/\s+/)[0])
    if (EXEMPLAIRES_DES_FACTURES_EXPORTES) {
      expect(Object.keys(argumentsDeLaDesignation('d', 'p', 'f'))).toEqual(parametresDe('designer_exemplaire_facture'))
      expect(Object.keys(argumentsDuRetraitDeLaDesignation('d', 'p'))).toEqual(parametresDe('defaire_exemplaire_facture'))
    }
    if (JUMELLE_INVERSEE_EXPORTEE) {
      expect(Object.keys(argumentsDeLaDeclaration('d', 'p'))).toEqual(parametresDe('declarer_vente_hors_des_factures'))
      expect(Object.keys(argumentsDuRetraitDeLaDeclaration('d', 'p'))).toEqual(parametresDe('retirer_declaration_hors_des_factures'))
    }
  })
})
