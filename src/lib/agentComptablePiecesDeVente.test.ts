import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { muter } from '../test/fonctionsEdge'
import { fichiersDuSchema } from '../test/schema'

// LE CLIENT D'UNE PIÈCE DE VENTE NE PART PAS AU MODÈLE (VF9C-Q1 : la réponse (A) du cabinet du 28/10/2026 ; chantier EC-Q3,
// ligne 28.65).
//
// Le tiers d'une pièce de vente est son client — chez un praticien, un patient (RGPD.md, § 8.7) —, le nom de son fichier
// le porte souvent, et le libellé de ses écritures le recopie (`piece.tiers ?? piece.nom_fichier`, src/lib/ecritures.ts et
// src/lib/engagement.ts). Pour toute pièce de vente de tout dossier, aucun des trois ne part au modèle : `agent-comptable`
// la nomme par sa date et son montant. Tout ce que le modèle reçoit d'une pièce, ou d'une ligne du brouillon qui en cite
// une, passe par UN passage, le bloc `── DÉBUT/FIN PIÈCES DE VENTE` de la fonction. Ce test le garde de deux façons :
//   - le bloc, extrait, transpilé et exécuté SEUL — un nom qu'il emprunterait au reste du fichier lèverait —, sur une table
//     de cas nommés, et une dérive plantée par fonction et par constante pour prouver qu'elle sait encore échouer ; ses
//     types confrontés à la contrainte du schéma exporté ;
//   - un SCANNER qui part de TOUTES les lectures de la fonction (`.from(`), en lit la sélection — un texte, ou le choix entre
//     deux textes ; toute autre forme est une faute —, et relève celles qui rapportent un tiers, un nom de fichier ou un
//     libellé du brouillon. Chacune passe par le passage, et le corps de son outil ne rend ses lignes que passées par lui ;
//     ou elle se déclare, avec sa raison ET son nombre (une de plus est une rechute, une de moins une raison morte). Le
//     client d'une facture (`tiers_nom`) ne se lit jamais. Un plancher distingue « zéro faute » d'« aveugle », et chaque
//     défaut que le scanner craint est planté dans la vraie source.
//
// Ce que le scanner ne voit pas, dit plutôt que deviné : ce qu'un outil fait d'une lecture DÉCLARÉE interne (le tiers des
// pièces de `points_a_traiter`, que le lettrage fait à la main compare). Le contrat HTTP de l'assistant le juge, lui, sur des
// mondes qui remplissent chaque clé qui compte une pièce de vente (src/test/contratsFonctions.ts, « VF9C-Q1 ») : le scanner
// voit ce qu'on LIT, le contrat ce qui ATTEINT le modèle.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

const DEBUT = '// ── DÉBUT PIÈCES DE VENTE'
const FIN = '// ── FIN PIÈCES DE VENTE'

/** Le texte du bloc, ses bornes exigées uniques : une borne en double ferait garder le mauvais morceau. */
function bloc(source: string): string {
  expect(source.split(DEBUT).length - 1, `« ${DEBUT} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  expect(source.split(FIN).length - 1, `« ${FIN} » introuvable ou en double — garde-fou à remettre à jour`).toBe(1)
  const i = source.indexOf(DEBUT)
  const j = source.indexOf(FIN)
  expect(j, `« ${FIN} » avant « ${DEBUT} »`).toBeGreaterThan(i)
  return source.slice(i, j)
}

interface Bloc {
  TYPES_DONT_LE_TIERS_SE_DIT: readonly string[]
  nomDUnePieceDeVente: (piece: { date_piece: unknown; montant_ttc: unknown }) => string
  pieceVueParLeModele: (piece: Record<string, unknown>) => Record<string, unknown>
  ecritureVueParLeModele: (ligne: Record<string, unknown>) => Record<string, unknown>
}

const NOMS = ['TYPES_DONT_LE_TIERS_SE_DIT', 'nomDUnePieceDeVente', 'pieceVueParLeModele', 'ecritureVueParLeModele'] as const

/** Le bloc transpilé puis exécuté SEUL, en mode strict : il ne voit rien du reste du fichier. */
function executer(code: string): Bloc {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`"use strict";\n${js}\nreturn { ${NOMS.join(', ')} }`)() as Bloc
}

const deployee = executer(bloc(sourceDeployee()))

// ── LE BLOC : CE QU'IL REND, CAS PAR CAS ────────────────────────────────────────────────────────────────────────────────

const ID_PIECE = 'a1000000-0000-4000-8000-000000000001'
const piece = (o: Record<string, unknown>) => ({
  date_piece: '2026-01-15', tiers: 'Client fictif', nom_fichier: 'facture du client fictif.pdf', montant_ht: 100, montant_tva: 20,
  montant_ttc: 120, type_piece: 'vente', statut: 'validee', confiance: 'haute', ...o,
})
const ligne = (o: Record<string, unknown>) => ({
  date: '2026-01-20', compte: '706000', libelle: 'Client fictif', sens: 'credit', montant: 100, piece_id: ID_PIECE,
  pieces: { type_piece: 'vente', date_piece: '2026-01-15', montant_ttc: 120 }, ...o,
})
const sansLaPiece = ({ pieces: _pieces, ...reste }: Record<string, unknown>) => reste

/** Chaque cas : ce que le bloc rend, mis en texte (l'ordre des clés compte : c'est ce qui part au modèle), et l'attendu. */
const CAS: readonly (readonly [nom: string, rendu: (b: Bloc) => unknown, attendu: unknown])[] = [
  // Le nom d'une pièce de vente : sa date, son montant TTC.
  ['le nom : une date et un montant', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-01-15', montant_ttc: 120 }), 'Pièce de vente du 15/01/2026, 120,00 €'],
  ['le nom : des centimes, sans séparateur de milliers', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-12-31', montant_ttc: 1234.5 }), 'Pièce de vente du 31/12/2026, 1234,50 €'],
  ['le nom : un avoir', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-02-20', montant_ttc: -50 }), 'Pièce de vente du 20/02/2026, -50,00 €'],
  ['le nom : zéro', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-02-20', montant_ttc: 0 }), 'Pièce de vente du 20/02/2026, 0,00 €'],
  ['le nom : sans date', (b) => b.nomDUnePieceDeVente({ date_piece: null, montant_ttc: 120 }), 'Pièce de vente sans date, 120,00 €'],
  ['le nom : une date mal formée', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-1-5', montant_ttc: 120 }), 'Pièce de vente sans date, 120,00 €'],
  ['le nom : un instant au lieu d’une date', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-01-15T10:00:00Z', montant_ttc: 120 }), 'Pièce de vente sans date, 120,00 €'],
  ['le nom : sans montant', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-01-15', montant_ttc: null }), 'Pièce de vente du 15/01/2026, sans montant'],
  ['le nom : un montant qui n’est pas un nombre', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-01-15', montant_ttc: Number.NaN }), 'Pièce de vente du 15/01/2026, sans montant'],
  ['le nom : un montant en texte', (b) => b.nomDUnePieceDeVente({ date_piece: '2026-01-15', montant_ttc: '120' }), 'Pièce de vente du 15/01/2026, sans montant'],
  // Une pièce, telle que `lister_pieces` la rend.
  ['une pièce de vente : ni tiers ni fichier, le reste à sa place',
    (b) => JSON.stringify(b.pieceVueParLeModele(piece({}))), JSON.stringify(piece({ tiers: null, nom_fichier: null }))],
  ['une pièce de vente à valider, sans tiers lu : null quand même', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ statut: 'a_valider', tiers: null }))),
    JSON.stringify(piece({ statut: 'a_valider', tiers: null, nom_fichier: null }))],
  ['une pièce d’achat : telle quelle', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ type_piece: 'achat' }))), JSON.stringify(piece({ type_piece: 'achat' }))],
  ['une note de frais : telle quelle', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ type_piece: 'note_frais' }))), JSON.stringify(piece({ type_piece: 'note_frais' }))],
  ['une pièce « autre » : telle quelle', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ type_piece: 'autre' }))), JSON.stringify(piece({ type_piece: 'autre' }))],
  ['un type que la base n’a pas : le côté fermé', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ type_piece: 'avoir_client' }))),
    JSON.stringify(piece({ type_piece: 'avoir_client', tiers: null, nom_fichier: null }))],
  ['un type non lu : le côté fermé', (b) => JSON.stringify(b.pieceVueParLeModele(piece({ type_piece: null }))), JSON.stringify(piece({ type_piece: null, tiers: null, nom_fichier: null }))],
  // Une ligne du brouillon, telle que `lister_ecritures` la rend.
  ['la ligne d’une pièce de vente : son nom, sans la pièce lue', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({}))),
    JSON.stringify(sansLaPiece(ligne({ libelle: 'Pièce de vente du 15/01/2026, 120,00 €' })))],
  ['la ligne d’une pièce de vente sans date ni montant', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ pieces: { type_piece: 'vente', date_piece: null, montant_ttc: null } }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: 'Pièce de vente sans date, sans montant' })))],
  ['la ligne d’une pièce d’achat : son libellé, sans la pièce lue',
    (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ libelle: 'Fournisseur fictif', pieces: { type_piece: 'achat', date_piece: '2026-01-15', montant_ttc: 120 } }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: 'Fournisseur fictif' })))],
  ['la ligne d’une note de frais : son libellé',
    (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ libelle: 'Restaurant fictif', pieces: { type_piece: 'note_frais', date_piece: null, montant_ttc: 9 } }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: 'Restaurant fictif' })))],
  ['une ligne sans pièce (un mouvement du relevé, une vente facturée…) : son libellé', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ libelle: 'VIR FICTIF', piece_id: null, pieces: null }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: 'VIR FICTIF', piece_id: null })))],
  ['une ligne qui cite une pièce que la lecture n’a pas rendue : aucun libellé', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ pieces: null }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: null })))],
  ['une ligne lue sans sa pièce : aucun libellé', (b) => JSON.stringify(b.ecritureVueParLeModele(sansLaPiece(ligne({ piece_id: null })))),
    JSON.stringify(sansLaPiece(ligne({ piece_id: null, libelle: null })))],
  ['une ligne lue sans sa colonne piece_id : aucun libellé', (b) => {
    const { piece_id: _piece, ...sansColonne } = ligne({ libelle: 'Fournisseur fictif', pieces: null })
    return JSON.stringify(b.ecritureVueParLeModele(sansColonne))
  }, JSON.stringify({ date: '2026-01-20', compte: '706000', libelle: null, sens: 'credit', montant: 100 })],
  ['la ligne d’une pièce d’un type inconnu : aucun libellé', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ pieces: { type_piece: 'avoir_client', date_piece: null, montant_ttc: 1 } }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: null })))],
  ['la ligne d’une pièce rendue sous une forme inattendue (une liste) : aucun libellé', (b) => JSON.stringify(b.ecritureVueParLeModele(ligne({ pieces: [{ type_piece: 'achat' }] }))),
    JSON.stringify(sansLaPiece(ligne({ libelle: null })))],
  ['les colonnes d’une ligne d’un dossier basculé gardées, à leur place', (b) => JSON.stringify(b.ecritureVueParLeModele({
    date: '2026-03-20', compte: '512000', libelle: 'Encaissement, facture F-1 — Client fictif', sens: 'debit', montant: 300, piece_id: null,
    facture_id: null, encaissement_id: 'e1', ligne_bancaire_id: 'm1', pieces: null,
  })), JSON.stringify({
    date: '2026-03-20', compte: '512000', libelle: 'Encaissement, facture F-1 — Client fictif', sens: 'debit', montant: 300, piece_id: null,
    facture_id: null, encaissement_id: 'e1', ligne_bancaire_id: 'm1',
  })],
  // Ce qui est rendu tel quel l'est vraiment : ni copie ni clé ajoutée.
  ['une pièce d’achat : le même objet', (b) => {
    const p = piece({ type_piece: 'achat' })
    return b.pieceVueParLeModele(p) === p
  }, true],
]

/** Les cas où le bloc ne rend pas ce qui est attendu. */
function ecarts(b: Bloc): string[] {
  return CAS.flatMap(([nom, rendu, attendu]) => {
    try {
      return JSON.stringify(rendu(b)) === JSON.stringify(attendu) ? [] : [nom]
    } catch {
      return [`${nom} (lève)`]
    }
  })
}

/** Les valeurs de la contrainte du type d'une pièce, telles que le schéma exporté l'écrit — une seule définition. */
function typesDuSchema(): string[][] {
  return fichiersDuSchema().flatMap((f) => [...f.texte.matchAll(/\btype_piece\s+text\b[^,\n]*?\bcheck\s*\(\s*type_piece\s+in\s*\(([^)]*)\)\s*\)/gi)]
    .map((m) => m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''))))
}

describe('agent-comptable / bloc PIÈCES DE VENTE (le seul passage vers le modèle, étape VF9C-Q1)', () => {
  it('s’exécute seul, et ne définit que ce que ce test confronte ou plante', () => {
    const texte = bloc(sourceDeployee())
    const declares = [...texte.matchAll(/^(?:function|const|interface)\s+(\w+)/gm)].map((m) => m[1]).sort()
    expect(declares).toEqual(['PieceNommee', ...NOMS].sort())
    for (const nom of NOMS) expect(typeof deployee[nom], nom).not.toBe('undefined')
  })

  it('rend, sur chaque cas nommé, ce qui est attendu', () => {
    expect(ecarts(deployee)).toEqual([])
  })

  // Le côté fermé tient à cette liste : un tiers ne part que d'un type qu'elle nomme. Elle est la contrainte du schéma
  // moins la vente ; un type que la base gagnerait (une migration qui réécrit la contrainte) fait tomber ce test — il se
  // tait jusque-là, et sera jugé avant de parler.
  it('les types dont le tiers se dit : ceux du schéma exporté, moins la vente — et la contrainte n’est écrite qu’une fois', () => {
    const definitions = typesDuSchema()
    expect(definitions, 'la contrainte du type d’une pièce introuvable, ou écrite plus d’une fois').toHaveLength(1)
    expect([...definitions[0]].sort()).toEqual(['achat', 'autre', 'note_frais', 'vente'])
    expect([...deployee.TYPES_DONT_LE_TIERS_SE_DIT].sort()).toEqual(definitions[0].filter((t) => t !== 'vente').sort())
    expect(fichiersDuSchema().filter((f) => /pieces_type_piece_check/.test(f.texte)).map((f) => f.chemin)).toEqual([])
  })
})

describe('le bloc PIÈCES DE VENTE sait encore échouer', () => {
  const planter = (avant: string, apres: string) => muter(sourceDeployee(), [[avant, apres]])
  const DERIVES: readonly (readonly [quoi: string, avant: string, apres: string])[] = [
    ['TYPES_DONT_LE_TIERS_SE_DIT : la vente y entre', '["achat", "note_frais", "autre"]', '["achat", "note_frais", "autre", "vente"]'],
    ['TYPES_DONT_LE_TIERS_SE_DIT : l’achat en sort', '["achat", "note_frais", "autre"]', '["note_frais", "autre"]'],
    ['nomDUnePieceDeVente : la date telle que la base l’écrit',
      '    ? `du ${piece.date_piece.slice(8, 10)}/${piece.date_piece.slice(5, 7)}/${piece.date_piece.slice(0, 4)}`\n', '    ? `du ${piece.date_piece}`\n'],
    ['nomDUnePieceDeVente : un instant pris pour une date', '/^\\d{4}-\\d{2}-\\d{2}$/.test(piece.date_piece)', '/^\\d{4}-\\d{2}-\\d{2}/.test(piece.date_piece)'],
    ['nomDUnePieceDeVente : le montant à l’anglaise', '${piece.montant_ttc.toFixed(2).replace(".", ",")} €', '${piece.montant_ttc.toFixed(2)} €'],
    ['nomDUnePieceDeVente : un montant qui n’est pas un nombre écrit tel quel',
      'typeof piece.montant_ttc === "number" && Number.isFinite(piece.montant_ttc)', 'piece.montant_ttc != null'],
    ['pieceVueParLeModele : le fichier rendu', '    : { ...piece, tiers: null, nom_fichier: null }\n', '    : { ...piece, tiers: null }\n'],
    ['pieceVueParLeModele : un type non lu pris pour un type qui dit son tiers',
      '  return typeof piece.type_piece === "string" && TYPES_DONT_LE_TIERS_SE_DIT.includes(piece.type_piece)\n',
      '  return piece.type_piece !== "vente"\n'],
    ['ecritureVueParLeModele : la pièce lue rendue avec la ligne', '  const { pieces: piece, ...reste } = ligne\n', '  const { pieces: piece } = ligne\n  const reste = { ...ligne }\n'],
    ['ecritureVueParLeModele : la ligne d’une pièce de vente sous son libellé',
      '    libelle: lue.type_piece === "vente" ? nomDUnePieceDeVente(', '    libelle: lue.type_piece === "vente" ? ligne.libelle ?? nomDUnePieceDeVente('],
    ['ecritureVueParLeModele : une pièce que la lecture n’a pas rendue prise pour une ligne sans pièce',
      '  if (piece === null || typeof piece !== "object") return ligne.piece_id == null ? reste : { ...reste, libelle: null }\n',
      '  if (piece === null || typeof piece !== "object") return reste\n'],
    ['ecritureVueParLeModele : une ligne lue sans sa pièce prise pour une ligne sans pièce',
      '  if (!("piece_id" in ligne) || !("pieces" in ligne)) return { ...reste, libelle: null }\n', ''],
    ['ecritureVueParLeModele : un type inconnu qui garde son libellé',
      '    libelle: lue.type_piece === "vente" ? nomDUnePieceDeVente({ date_piece: lue.date_piece ?? null, montant_ttc: lue.montant_ttc ?? null }) : null,\n',
      '    libelle: lue.type_piece === "vente" ? nomDUnePieceDeVente({ date_piece: lue.date_piece ?? null, montant_ttc: lue.montant_ttc ?? null }) : ligne.libelle,\n'],
  ]
  for (const [quoi, avant, apres] of DERIVES) {
    it(`attrape ${quoi}`, () => {
      expect(ecarts(executer(bloc(planter(avant, apres)))).length).toBeGreaterThan(0)
    })
  }

  it('chaque fonction et chaque constante du bloc porte au moins une dérive plantée', () => {
    const visees = DERIVES.map(([quoi]) => quoi.split(' : ')[0])
    for (const nom of NOMS) expect(visees, nom).toContain(nom)
  })
})

// ── LE SCANNER : TOUTES LES LECTURES DE LA FONCTION ─────────────────────────────────────────────────────────────────────

/** Le code de la fonction, ses lignes de commentaire vidées : une lecture qu'un commentaire cite n'en est pas une. */
function code(source: string): string {
  return source.split('\n').map((l) => (l.trimStart().startsWith('//') ? '' : l)).join('\n')
}

// Les outils, chacun dans sa branche de `executerOutil` : le scanner les connaît tous, et un outil qu'il ne connaît pas est
// une faute — ses lectures seraient jugées sous le nom d'un autre.
const OUTILS = ['resume_dossier', 'lister_comptes', 'lister_ecritures', 'lister_pieces', 'points_a_traiter'] as const
const HORS_DES_OUTILS = 'hors des outils'

/** Les colonnes qui peuvent nommer le client d'une vente : le tiers et le fichier d'une pièce, le libellé du brouillon. */
const QUI_NOMMENT: Readonly<Record<string, readonly string[]>> = {
  pieces: ['tiers', 'nom_fichier'],
  ecritures_brouillon: ['libelle'],
  factures_emises: ['tiers_nom'],
}
/** Ce qui ne se lit jamais, ni déclaré ni passé : le client d'une facture (VF9c). */
const JAMAIS = ['factures_emises.tiers_nom']

type Passage = 'pieceVueParLeModele' | 'ecritureVueParLeModele'

/** Ce qu'un passage demande à la lecture qu'il reçoit, dans chacune de ses sélections. */
const CE_QUE_LE_PASSAGE_LIT: Readonly<Record<Passage, readonly string[]>> = {
  pieceVueParLeModele: ['pieces.type_piece'],
  ecritureVueParLeModele: ['ecritures_brouillon.piece_id', 'pieces.type_piece', 'pieces.date_piece', 'pieces.montant_ttc'],
}
/**
 * Et la forme exacte de la pièce que `ecritureVueParLeModele` reçoit avec chaque ligne : embarquée À GAUCHE — une ligne
 * sans pièce, d'un mouvement du relevé ou d'une vente facturée, reste dans la liste —, et rien d'autre qu'elle.
 */
const PIECE_EMBARQUEE = 'pieces(type_piece, date_piece, montant_ttc)'

interface LectureDeclaree {
  zone: string
  table: string
  nomme: readonly string[]
  nombre: number
  passage: Passage | null
  raison: string
}

/**
 * Les lectures qui rapportent un tiers, un nom de fichier ou un libellé du brouillon, AVEC LEUR NOMBRE. Celles d'un outil
 * qui rend ses lignes au modèle passent par le passage ; les autres disent pourquoi rien n'en sort.
 */
const LECTURES_QUI_NOMMENT: readonly LectureDeclaree[] = [
  {
    zone: 'lister_pieces', table: 'pieces', nomme: ['pieces.nom_fichier', 'pieces.tiers'], nombre: 1, passage: 'pieceVueParLeModele',
    raison: 'les pièces que l’outil rend : chacune passe d’abord par le passage, qui retire le tiers et le fichier d’une pièce de vente',
  },
  {
    zone: 'lister_ecritures', table: 'ecritures_brouillon', nomme: ['ecritures_brouillon.libelle'], nombre: 1, passage: 'ecritureVueParLeModele',
    raison: 'les lignes que l’outil rend, lues avec leur pièce : chacune passe d’abord par le passage, qui recompose le libellé d’une ligne de pièce de vente',
  },
  {
    zone: 'points_a_traiter', table: 'pieces', nomme: ['pieces.tiers'], nombre: 2, passage: null,
    raison: 'le tiers des pièces validées et à valider, que le lettrage fait à la main compare (bloc LETTRAGE MANUEL) : un calcul, '
      + 'qu’aucune clé ne rend — le contrat HTTP le juge sur des mondes qui remplissent chaque clé qui compte une pièce de vente',
  },
  {
    zone: 'points_a_traiter', table: 'ecritures_brouillon', nomme: ['ecritures_brouillon.libelle'], nombre: 1, passage: null,
    raison: 'le brouillon entier, sous la forme d’`EcritureRow` : aucun contrôle ne lit le libellé, aucune clé ne le rend',
  },
]

interface Lecture { zone: string; table: string; selections: string[]; nomme: string[]; lues: string[]; position: number }

/** Découpe sur les virgules de premier niveau : `pieces(type_piece, date_piece)` est UNE entrée. */
function entrees(texte: string): string[] {
  const out: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of texte) {
    if (c === '(') profondeur++
    if (c === ')') profondeur--
    if (c === ',' && profondeur === 0) { out.push(courant.trim()); courant = '' } else courant += c
  }
  if (courant.trim()) out.push(courant.trim())
  return out
}

/** Les colonnes d'une sélection, `table.colonne`, ressources embarquées comprises ; une forme inconnue lève. */
function colonnesDe(table: string, selection: string): string[] {
  return entrees(selection).flatMap((e) => {
    if (/^\w+$/.test(e)) return [`${table}.${e}`]
    const embarquee = /^(\w+)(?:!inner)?\(([^()]*)\)$/.exec(e)
    if (embarquee) return colonnesDe(embarquee[1], embarquee[2])
    throw new Error(`une sélection que le scanner ne sait pas lire : « ${e} »`)
  })
}

/** Les branches des outils dans le code, et la faute d'un outil inconnu ou introuvable. */
function zonesDe(texte: string): { zones: { nom: string; debut: number; fin: number }[]; fautes: string[] } {
  const fautes: string[] = []
  const marques = [...texte.matchAll(/^ {2}if \(nom === "(\w+)"\) \{$/gm)]
  const inconnus = marques.map((m) => m[1]).filter((n) => !(OUTILS as readonly string[]).includes(n))
  if (inconnus.length > 0) fautes.push(`un outil que le scanner ne connaît pas : ${inconnus.join(', ')}`)
  for (const nom of OUTILS) {
    const n = marques.filter((m) => m[1] === nom).length
    if (n !== 1) fautes.push(`la branche de ${nom} trouvée ${n} fois`)
  }
  const finDesOutils = texte.indexOf('  return { erreur: `Outil inconnu : ${nom}` }')
  if (finDesOutils < 0) fautes.push('la fin des outils introuvable')
  const zones = marques.map((m, i) => ({ nom: m[1], debut: m.index, fin: i + 1 < marques.length ? marques[i + 1].index : finDesOutils }))
  return { zones, fautes }
}

/** Toutes les lectures de la fonction : chaque `.from(`, sa table et sa sélection ; une forme inconnue est une faute. */
function lecturesDe(source: string): { lectures: Lecture[]; fautes: string[] } {
  const texte = code(source)
  const { zones, fautes } = zonesDe(texte)
  const lectures: Lecture[] = []
  const departs = [...texte.matchAll(/\.(from|rpc)\(/g)].map((m) => ({ genre: m[1], position: m.index }))
  for (const [i, depart] of departs.entries()) {
    if (depart.genre !== 'from') continue
    const ou = `ligne ${texte.slice(0, depart.position).split('\n').length}`
    const zone = zones.find((z) => depart.position > z.debut && depart.position < z.fin)?.nom ?? HORS_DES_OUTILS
    // La chaîne de la lecture s'arrête au `.from(` ou au `.rpc(` suivant : une sélection plus loin est celle d'une autre.
    const chaine = texte.slice(depart.position, departs[i + 1]?.position ?? texte.length)
    const table = /^\.from\(\s*"(\w+)"\s*\)/.exec(chaine)?.[1]
    if (!table) { fautes.push(`${ou} : une table qui n’est pas un texte littéral`); continue }
    const s = chaine.indexOf('.select(')
    if (s < 0) { fautes.push(`${ou} : ${table} sans sélection — une écriture, ou une forme que le scanner ne sait pas lire`); continue }
    const argument = chaine.slice(s + '.select('.length)
    const litteral = /^\s*"([^"\\]*)"\s*[,)]/.exec(argument)
    const choix = /^\s*([\w.]+)\s*\?\s*"([^"\\]*)"\s*:\s*"([^"\\]*)"\s*[,)]/.exec(argument)
    const selections = litteral ? [litteral[1]] : choix ? [choix[2], choix[3]] : null
    if (!selections) { fautes.push(`${ou} : la sélection de ${table} n’est ni un texte ni le choix entre deux textes`); continue }
    if (selections.some((t) => entrees(t).includes('*'))) { fautes.push(`${ou} : ${table} lue en entier (*)`); continue }
    let lues: string[]
    try {
      lues = [...new Set(selections.flatMap((t) => colonnesDe(table, t)))].sort()
    } catch (e) {
      fautes.push(`${ou} : ${(e as Error).message}`)
      continue
    }
    const nomme = lues.filter((c) => {
      const [t, colonne] = c.split('.')
      return (QUI_NOMMENT[t] ?? []).includes(colonne)
    })
    lectures.push({ zone, table, selections, nomme, lues, position: depart.position })
  }
  return { lectures, fautes }
}

/** Les fautes du scanner sur une source : rien ne nomme le client d'une vente hors du passage ou d'une déclaration. */
function fautesDe(source: string): string[] {
  const { lectures, fautes } = lecturesDe(source)
  const texte = code(source)
  const { zones } = zonesDe(texte)
  // Le plancher : un scanner qui ne voit plus les lectures de la fonction ne dirait « zéro faute » que parce qu'il est aveugle.
  if (lectures.length < 45) fautes.push(`${lectures.length} lecture(s) vue(s), sous le plancher de 45 : le scanner est aveugle`)
  for (const l of lectures) {
    for (const c of l.nomme) if (JAMAIS.includes(c)) fautes.push(`${l.zone} : ${c} ne se lit jamais`)
  }
  const nommantes = lectures.filter((l) => l.nomme.some((c) => !JAMAIS.includes(c)))
  for (const d of LECTURES_QUI_NOMMENT) {
    const siennes = nommantes.filter((l) => l.zone === d.zone && l.table === d.table && JSON.stringify(l.nomme) === JSON.stringify([...d.nomme].sort()))
    if (siennes.length !== d.nombre) fautes.push(`${d.zone} · ${d.table} · ${d.nomme.join(', ')} : ${siennes.length} lecture(s) au lieu de ${d.nombre}`)
    if (d.passage === null) continue
    // Ce que le passage lit, chaque sélection le porte.
    for (const l of siennes) {
      for (const t of l.selections) {
        const lues = colonnesDe(d.table, t)
        const manque = CE_QUE_LE_PASSAGE_LIT[d.passage].filter((c) => !lues.includes(c))
        if (manque.length > 0) fautes.push(`${d.zone} : une sélection sans ${manque.join(', ')}, que ${d.passage} lit`)
        if (d.passage === 'ecritureVueParLeModele' && !entrees(t).includes(PIECE_EMBARQUEE)) {
          fautes.push(`${d.zone} : la pièce de chaque ligne ne se lit pas sous la forme ${PIECE_EMBARQUEE} (à gauche, et elle seule)`)
        }
      }
    }
    // Et l'outil ne rend ses lignes que passées : `data` ne sert qu'à les lire, puis à les passer, une fois.
    const zone = zones.find((z) => z.nom === d.zone)
    const corps = zone ? texte.slice(zone.debut, zone.fin) : ''
    const usages = [...corps.matchAll(/\bdata\b/g)].length
    const lue = (corps.match(/const \{ data, error, count \} = await q\./g) ?? []).length
    const passee = corps.split(`((data ?? []) as Record<string, unknown>[]).map(${d.passage})`).length - 1
    if (lue !== 1 || passee !== 1 || usages !== 2) {
      fautes.push(`${d.zone} : ses lignes lues ne partent pas toutes par ${d.passage} (lues ${lue}, passées ${passee}, ${usages} usage(s) de data)`)
    }
  }
  for (const l of nommantes) {
    const declaree = LECTURES_QUI_NOMMENT.some((d) => l.zone === d.zone && l.table === d.table && JSON.stringify(l.nomme) === JSON.stringify([...d.nomme].sort()))
    if (!declaree) fautes.push(`${l.zone} : une lecture de ${l.table} qui rapporte ${l.nomme.join(', ')}, ni passée ni déclarée`)
  }
  return fautes
}

describe('agent-comptable : tout ce qui peut nommer le client d’une vente passe par le bloc PIÈCES DE VENTE (étape VF9C-Q1)', () => {
  it('part de TOUTES les lectures de la fonction, sous le plancher : chaque outil, et hors des outils', () => {
    const { lectures, fautes } = lecturesDe(sourceDeployee())
    expect(fautes).toEqual([])
    expect(lectures.length).toBeGreaterThanOrEqual(45)
    for (const zone of [...OUTILS, HORS_DES_OUTILS]) expect(lectures.some((l) => l.zone === zone), zone).toBe(true)
    // Les lectures qui nomment, telles que le scanner les voit, une à une.
    expect(lectures.filter((l) => l.nomme.length > 0).map((l) => `${l.zone} · ${l.table} · ${l.nomme.join(', ')}`)).toEqual([
      'lister_ecritures · ecritures_brouillon · ecritures_brouillon.libelle',
      'lister_pieces · pieces · pieces.nom_fichier, pieces.tiers',
      'points_a_traiter · pieces · pieces.tiers',
      'points_a_traiter · pieces · pieces.tiers',
      'points_a_traiter · ecritures_brouillon · ecritures_brouillon.libelle',
    ])
  })

  it('chaque lecture qui nomme passe par le passage, ou se déclare avec sa raison et son nombre : aucune faute sur la vraie source', () => {
    expect(fautesDe(sourceDeployee())).toEqual([])
    for (const d of LECTURES_QUI_NOMMENT) expect(d.raison.length, `${d.zone} · ${d.table}`).toBeGreaterThan(40)
  })

  // Un scanner qui rend « aucune faute » sur la vraie source n'a rien prouvé tant qu'on ne l'a pas vu en rendre : chaque
  // défaut ci-dessous est posé dans la vraie source, en mémoire.
  const source = sourceDeployee()
  const DEFAUTS: readonly (readonly [quoi: string, mutee: () => string])[] = [
    ['une lecture de plus du tiers, dans resume_dossier', () => muter(source, [[
      'admin.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", dossierId).eq("statut", "a_valider"),',
      'admin.from("pieces").select("id, tiers", { count: "exact", head: true }).eq("dossier_id", dossierId).eq("statut", "a_valider"),']])],
    ['lister_pieces rend ses pièces sans le passage', () => muter(source, [[
      '    const lues = ((data ?? []) as Record<string, unknown>[]).map(pieceVueParLeModele)\n', '    const lues = ((data ?? []) as Record<string, unknown>[])\n']])],
    ['lister_ecritures rend aussi les lignes lues, sans le passage', () => muter(source, [[
      '    if (!lireLesVentes) return resultatListe(lignes, count, "ecritures")\n', '    if (!lireLesVentes) return resultatListe(data, count, "ecritures")\n']])],
    ['la pièce embarquée qui rapporte son tiers', () => muter(source, [[
      ': "date, compte, libelle, sens, montant, piece_id, pieces(type_piece, date_piece, montant_ttc)"',
      ': "date, compte, libelle, sens, montant, piece_id, pieces(type_piece, date_piece, montant_ttc, tiers)"']])],
    ['la pièce embarquée oubliée d’une des deux sélections', () => muter(source, [[
      'ligne_bancaire_id, pieces(type_piece, date_piece, montant_ttc)"', 'ligne_bancaire_id"']])],
    ['la pièce embarquée en jointure interne : une ligne sans pièce disparaîtrait', () => muter(source, [[
      'ligne_bancaire_id, pieces(type_piece, date_piece, montant_ttc)"', 'ligne_bancaire_id, pieces!inner(type_piece, date_piece, montant_ttc)"']])],
    ['une sélection par une variable', () => muter(source, [[
      'admin.from("categories").select("id, libelle", { count: "exact" })', 'admin.from("categories").select(colonnes, { count: "exact" })']])],
    ['une pièce lue en entier (*)', () => muter(source, [[
      'admin.from("pieces").select("id, tiers, confiance", { count: "exact" })', 'admin.from("pieces").select("*", { count: "exact" })']])],
    ['une troisième lecture du tiers dans points_a_traiter', () => muter(source, [[
      'admin.from("lettrages_manuels").select("id, groupe, piece_id, compte", { count: "exact" })', 'admin.from("pieces").select("id, groupe, tiers, compte", { count: "exact" })']])],
    ['le client d’une facture lu', () => muter(source, [[
      'admin.from("factures_emises").select("id, type, numero", { count: "exact" })', 'admin.from("factures_emises").select("id, type, numero, tiers_nom", { count: "exact" })']])],
    ['un outil que le scanner ne connaît pas', () => muter(source, [[
      '  if (nom === "points_a_traiter") {\n', '  if (nom === "lister_clients") {\n    return {}\n  }\n\n  if (nom === "points_a_traiter") {\n']])],
    ['une table nommée par une variable', () => muter(source, [[
      'admin.from("soldes_reportes").select(', 'admin.from(tableDesSoldes).select(']])],
    ['le scanner aveugle : plus aucune lecture reconnue', () => source.replaceAll('.from(', '.de(')],
  ]
  for (const [quoi, mutee] of DEFAUTS) {
    it(`voit ${quoi}`, () => {
      expect(fautesDe(mutee()).length).toBeGreaterThan(0)
    })
  }
})
