import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { muter } from '../test/fonctionsEdge'
import { fichiersDuSchema, relationsDuSchema } from '../test/schema'

// LE CLIENT D'UNE PIÈCE DE VENTE NE PART PAS AU MODÈLE (VF9C-Q1 : la réponse (A) du cabinet du 28/10/2026 ; chantier EC-Q3,
// ligne 28.65). NI QUI A PAYÉ UN CRÉDIT DU RELEVÉ, NI LE LIBELLÉ D'UNE LIGNE RATTACHÉE À RIEN (VF9CQ1 : les réponses (A) du
// cabinet du 28/10/2026 à VF9CQ1-Q1 et Q2). NI À QUI UN DÉBIT REND OU DÉFAIT L'ARGENT D'UN CLIENT (VF9CQ1B : la réponse (A) du
// cabinet du 28/10/2026 à VF9CQ1B-Q1).
//
// Le tiers d'une pièce de vente est son client — chez un praticien, un patient (RGPD.md, § 8.7) —, le nom de son fichier
// le porte souvent, et le libellé de ses écritures le recopie (`piece.tiers ?? piece.nom_fichier`, src/lib/ecritures.ts et
// src/lib/engagement.ts). Le libellé qu'une ligne du brouillon tient d'un mouvement du relevé est celui de la banque, et celui
// d'un crédit nomme souvent qui a payé ; l'écriture restée d'une pièce supprimée garde le libellé qui nomme son client. Pour
// tout dossier, `agent-comptable` nomme une pièce de vente par sa date et son montant, une ligne d'un crédit par la date et le
// montant du mouvement, et tait celui d'une ligne rattachée à rien ; un débit qui rend ou défait l'argent d'un client — une ligne
// propre sur un compte de produit ou de client, ou classé par les contre-passations d'un encaissement — se nomme de même par sa
// date et son montant, un autre débit garde son libellé. Tout ce que le modèle reçoit d'une
// pièce, ou d'une ligne du brouillon, passe par UN passage, le bloc `── DÉBUT/FIN PIÈCES DE VENTE` de la fonction. Ce test le
// garde de trois façons :
//   - le bloc, extrait, transpilé et exécuté SEUL — un nom qu'il emprunterait au reste du fichier lèverait —, sur une table
//     de cas nommés, et une dérive plantée par fonction et par constante pour prouver qu'elle sait encore échouer ; ses
//     types confrontés à la contrainte du schéma exporté, et ses RATTACHEMENTS à chaque clé étrangère du brouillon ;
//   - un SCANNER qui part de TOUTES les lectures de la fonction (`.from(`), en lit la sélection — un texte, ou le choix entre
//     deux textes ; toute autre forme est une faute —, et relève celles qui rapportent un tiers, un nom de fichier, un
//     libellé du brouillon ou du relevé. Chacune passe par le passage, et le corps de son outil ne rend ses lignes que passées
//     par lui ; ou elle se déclare, avec sa raison ET son nombre (une de plus est une rechute, une de moins une raison morte).
//     Le client d'une facture (`tiers_nom`), le libellé que la banque a donné et ce que la validation fige au brouillon pour le
//     FEC ne se lisent jamais. Un plancher distingue « zéro faute » d'« aveugle », et chaque défaut que le scanner craint est
//     planté dans la vraie source.
//
// Ce que le scanner ne voit pas, dit plutôt que deviné : ce qu'un outil fait d'une lecture DÉCLARÉE interne (le tiers des
// pièces de `points_a_traiter`, que le lettrage fait à la main compare). Le contrat HTTP de l'assistant le juge, lui, sur des
// mondes qui remplissent chaque clé qui compte une pièce de vente, et sur des mondes où chaque sorte de mouvement du relevé
// porte un marqueur (src/test/contratsFonctions.ts, « VF9C-Q1 » et « VF9CQ1 ») : le scanner voit ce qu'on LIT, le contrat ce
// qui ATTEINT le modèle.

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

/** Ce qu'un dossier qui lit ses ventes facturées en sait (VF9c), tel que `lister_ecritures` le passe au bloc. */
interface VentesNommees {
  factures: ReadonlyMap<string, { id: string; type: string; numero: string | null }>
  encaissements: ReadonlyMap<string, { id: string; facture_id: string; annule_id: string | null }>
  classes: ReadonlySet<string>
}

interface Bloc {
  TYPES_DONT_LE_TIERS_SE_DIT: readonly string[]
  RATTACHEMENTS_D_UNE_LIGNE: readonly string[]
  nomDUnePieceDeVente: (piece: { date_piece: unknown; montant_ttc: unknown }) => string
  nomDUnCreditDuReleve: (mouvement: { date: unknown; montant: unknown }) => string
  RACINES_DES_COMPTES_D_UN_CLIENT: readonly string[]
  nomDUnDebitDuReleve: (mouvement: { date: unknown; montant: unknown }) => string
  debitQuiRendLArgentDUnClient: (mouvement: Record<string, unknown>) => boolean
  pieceVueParLeModele: (piece: Record<string, unknown>) => Record<string, unknown>
  libelleDuBrouillon: (ligne: Record<string, unknown>) => string | null
  libelleDUneLigneDePiece: (ligne: Record<string, unknown>) => string | null
  libelleDUneLigneDuReleve: (ligne: Record<string, unknown>) => string | null
  libelleEtSource: (ligne: Record<string, unknown>, ventes: VentesNommees | null) => { libelle: string | null; source: string | null }
  ecritureVueParLeModele: (ligne: Record<string, unknown>, ventes: VentesNommees | null) => Record<string, unknown>
}

const NOMS = [
  'TYPES_DONT_LE_TIERS_SE_DIT', 'RATTACHEMENTS_D_UNE_LIGNE', 'nomDUnePieceDeVente', 'nomDUnCreditDuReleve', 'pieceVueParLeModele',
  'libelleDuBrouillon', 'libelleDUneLigneDePiece', 'libelleDUneLigneDuReleve', 'libelleEtSource', 'ecritureVueParLeModele',
  'RACINES_DES_COMPTES_D_UN_CLIENT', 'nomDUnDebitDuReleve', 'debitQuiRendLArgentDUnClient',
] as const
/** Les types que le bloc déclare : ce qu'il nomme d'une pièce, d'un mouvement, des factures et des encaissements ; ce qu'il lit d'une ligne d'un mouvement. */
const TYPES_DU_BLOC = ['PieceNommee', 'MouvementNomme', 'LigneDuMouvementLue', 'FactureNommeeRow', 'EncaissementNommeRow', 'VentesNommees']

/** Le bloc transpilé puis exécuté SEUL, en mode strict : il ne voit rien du reste du fichier. */
function executer(code: string): Bloc {
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`"use strict";\n${js}\nreturn { ${NOMS.join(', ')} }`)() as Bloc
}

const deployee = executer(bloc(sourceDeployee()))

// ── LE BLOC : CE QU'IL REND, CAS PAR CAS ────────────────────────────────────────────────────────────────────────────────

const ID_PIECE = 'a1000000-0000-4000-8000-000000000001'
const ID_MOUVEMENT = 'b1000000-0000-4000-8000-000000000001'
const ID_CLASSE = 'b1000000-0000-4000-8000-000000000002'
const piece = (o: Record<string, unknown>) => ({
  date_piece: '2026-01-15', tiers: 'Client fictif', nom_fichier: 'facture du client fictif.pdf', montant_ht: 100, montant_tva: 20,
  montant_ttc: 120, type_piece: 'vente', statut: 'validee', confiance: 'haute', ...o,
})
/**
 * Une ligne telle que `lister_ecritures` la lit : ses colonnes, ses huit rattachements — ici, une ligne de pièce de vente —,
 * sa pièce et son mouvement embarqués.
 */
const ligne = (o: Record<string, unknown>) => ({
  date: '2026-01-20', compte: '706000', libelle: 'Client fictif', sens: 'credit', montant: 100, piece_id: ID_PIECE,
  ligne_bancaire_id: null, facture_id: null, encaissement_id: null, immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null,
  pieces: { type_piece: 'vente', date_piece: '2026-01-15', montant_ttc: 120 }, lignes_bancaires: null, ...o,
})
/** Une ligne sans pièce : celle d'un mouvement, d'une vente facturée, d'une écriture composée, ou rattachée à rien. */
const sansPiece = (o: Record<string, unknown>) => ligne({ piece_id: null, pieces: null, ...o })
/** Les lignes d'un mouvement, telles que `lister_ecritures` les lit avec lui (VF9CQ1B) : propres, sur ces comptes. */
const lignesDuMouvement = (...comptes: string[]) => comptes.map((compte) => ({ compte, facture_id: null, encaissement_id: null }))
/** Le mouvement lu tel qu'un débit d'un fournisseur : ni classé par ses encaissements, ses lignes propres sur une charge et la banque. */
const DEBIT_D_UN_FOURNISSEUR = { encaissements_de_factures: false, ecritures_brouillon: lignesDuMouvement('606000', '512000') }
/**
 * La ligne d'un mouvement du relevé, de ce montant, que la ligne ne porte pas forcément elle-même ; lu avec son classement et ses
 * lignes (`lu`), par défaut ceux d'un débit d'un fournisseur (VF9CQ1B).
 */
const duMouvement = (montant: unknown, o: Record<string, unknown> = {}, lu: Record<string, unknown> = DEBIT_D_UN_FOURNISSEUR) =>
  sansPiece({ ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { date: '2026-02-10', montant, ...lu }, ...o })
/** La ligne de la banque d'un débit de 45 € lu avec ce classement et ces lignes, sous un libellé qui nomme un client. */
const debitLu = (lu: Record<string, unknown>, o: Record<string, unknown> = {}) =>
  duMouvement(-45, { compte: '512000', sens: 'credit', montant: 45, libelle: 'VIR REMBOURSEMENT CLIENT FICTIF', ...o }, lu)
const NOM_DU_DEBIT = 'Débit du relevé du 10/02/2026, 45,00 €'
const LIBELLE_DU_DEBIT = 'VIR REMBOURSEMENT CLIENT FICTIF'
/** Un débit lu en entier, ni classé par ses encaissements, sur ces lignes. */
const surLesLignes = (...lignes: unknown[]) => ({ encaissements_de_factures: false, ecritures_brouillon: lignes })
const achat = (o: Record<string, unknown> = {}) =>
  ligne({ libelle: 'Fournisseur fictif', pieces: { type_piece: 'achat', date_piece: '2026-01-15', montant_ttc: 120 }, ...o })
const debit = () => duMouvement(-45, { compte: '606000', sens: 'debit', montant: 45, libelle: 'CB FOURNITURES FICTIVES' })
const dotation = () => sansPiece({ immobilisation_id: 'i1', compte: '681100', sens: 'debit', date: '2026-12-31', libelle: 'Dotation 2026 — Bien fictif' })
/** La ligne lue sans une de ses colonnes. */
const sans = (l: Record<string, unknown>, cle: string): Record<string, unknown> => Object.fromEntries(Object.entries(l).filter(([k]) => k !== cle))
/** Ce que le modèle reçoit d'une ligne : ses colonnes d'hier, dans leur ordre, sous ce libellé ; et sa source, d'un dossier qui lit ses ventes. */
const vue = (l: Record<string, unknown>, libelle: unknown, ...source: [unknown?]) => ({
  date: l.date, compte: l.compte, libelle, sens: l.sens, montant: l.montant, piece_id: l.piece_id, ...(source.length > 0 ? { source: source[0] } : {}),
})
const NOM_DU_CREDIT = 'Crédit du relevé du 10/02/2026, 300,00 €'
const NOM_DE_LA_PIECE = 'Pièce de vente du 15/01/2026, 120,00 €'
/** Les ventes d'un dossier qui les lit : deux factures (l'une un avoir sans numéro), un encaissement, sa contre-passation, un encaissement dont la facture n'est pas rendue, un mouvement classé. */
const VENTES: VentesNommees = {
  factures: new Map([['f1', { id: 'f1', type: 'facture', numero: 'F-1' }], ['a1', { id: 'a1', type: 'avoir', numero: null }]]),
  encaissements: new Map([
    ['e1', { id: 'e1', facture_id: 'f1', annule_id: null }], ['c1', { id: 'c1', facture_id: 'f1', annule_id: 'e1' }],
    ['e9', { id: 'e9', facture_id: 'f404', annule_id: null }],
  ]),
  classes: new Set([ID_CLASSE]),
}

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
  // Le nom d'un crédit du relevé : la date et le montant du mouvement (VF9CQ1-Q1).
  ['le nom d’un crédit : une date et un montant', (b) => b.nomDUnCreditDuReleve({ date: '2026-01-15', montant: 120 }), 'Crédit du relevé du 15/01/2026, 120,00 €'],
  ['le nom d’un crédit : des centimes, sans séparateur de milliers', (b) => b.nomDUnCreditDuReleve({ date: '2026-12-31', montant: 1234.5 }), 'Crédit du relevé du 31/12/2026, 1234,50 €'],
  ['le nom d’un crédit : sans date', (b) => b.nomDUnCreditDuReleve({ date: null, montant: 120 }), 'Crédit du relevé sans date, 120,00 €'],
  ['le nom d’un crédit : une date mal formée', (b) => b.nomDUnCreditDuReleve({ date: '2026-1-5', montant: 120 }), 'Crédit du relevé sans date, 120,00 €'],
  ['le nom d’un crédit : un instant au lieu d’une date', (b) => b.nomDUnCreditDuReleve({ date: '2026-01-15T10:00:00Z', montant: 120 }), 'Crédit du relevé sans date, 120,00 €'],
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
  // La ligne d'une pièce, telle que `lister_ecritures` la rend (VF9C-Q1) : sa source est la pièce, même sur un crédit.
  ['la ligne d’une pièce de vente : son nom, sans la pièce lue', (b) => b.ecritureVueParLeModele(ligne({}), null), vue(ligne({}), NOM_DE_LA_PIECE)],
  ['la ligne d’une pièce de vente sans date ni montant', (b) => b.ecritureVueParLeModele(ligne({ pieces: { type_piece: 'vente', date_piece: null, montant_ttc: null } }), null),
    vue(ligne({}), 'Pièce de vente sans date, sans montant')],
  ['la ligne d’une pièce d’achat : son libellé, sans la pièce lue', (b) => b.ecritureVueParLeModele(achat(), null), vue(achat(), 'Fournisseur fictif')],
  ['la ligne d’une note de frais : son libellé',
    (b) => b.ecritureVueParLeModele(ligne({ libelle: 'Restaurant fictif', pieces: { type_piece: 'note_frais', date_piece: null, montant_ttc: 9 } }), null),
    vue(ligne({}), 'Restaurant fictif')],
  ['la ligne d’une pièce « autre » : son libellé',
    (b) => b.ecritureVueParLeModele(ligne({ libelle: 'Organisme fictif', pieces: { type_piece: 'autre', date_piece: null, montant_ttc: 0 } }), null),
    vue(ligne({}), 'Organisme fictif')],
  ['une ligne qui cite une pièce que la lecture n’a pas rendue : aucun libellé', (b) => b.ecritureVueParLeModele(ligne({ pieces: null }), null), vue(ligne({}), null)],
  ['la ligne d’une pièce d’un type inconnu : aucun libellé',
    (b) => b.ecritureVueParLeModele(ligne({ pieces: { type_piece: 'avoir_client', date_piece: null, montant_ttc: 1 } }), null), vue(ligne({}), null)],
  ['la ligne d’une pièce rendue sous une forme inattendue (une liste) : aucun libellé',
    (b) => b.ecritureVueParLeModele(ligne({ pieces: [{ type_piece: 'achat' }] }), null), vue(ligne({}), null)],
  ['la ligne de banque d’une pièce de vente, sur un crédit : le nom de la pièce, pas celui du crédit',
    (b) => b.ecritureVueParLeModele(ligne({ compte: '512000', sens: 'debit', ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { date: '2026-02-10', montant: 300 } }), null),
    vue(ligne({ compte: '512000', sens: 'debit' }), NOM_DE_LA_PIECE)],
  ['la ligne de banque d’une pièce d’achat, sur un crédit (un avoir remboursé) : son fournisseur',
    (b) => b.ecritureVueParLeModele(achat({ compte: '512000', sens: 'debit', ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { date: '2026-02-10', montant: 300 } }), null),
    vue(achat({ compte: '512000', sens: 'debit' }), 'Fournisseur fictif')],
  // La ligne d'un mouvement du relevé (VF9CQ1-Q1) : le crédit se juge sur le mouvement, jamais sur le sens de la ligne.
  ['la ligne d’un crédit : son nom — la date et le montant du mouvement, pas ceux de la ligne',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { date: '2026-02-11', montant: 290, libelle: 'VIR M FICTIF' }), null),
    vue(duMouvement(300, { date: '2026-02-11', montant: 290 }), NOM_DU_CREDIT)],
  ['la ligne de banque d’un crédit, au débit : le même nom',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { compte: '512000', sens: 'debit', montant: 300, libelle: 'VIR M FICTIF' }), null),
    vue(duMouvement(300, { compte: '512000', sens: 'debit', montant: 300 }), NOM_DU_CREDIT)],
  ['la ligne d’un débit : son libellé, au caractère près',
    (b) => b.ecritureVueParLeModele(duMouvement(-45, { compte: '606000', sens: 'debit', montant: 45, libelle: '  CB FOURNITURES\tFICTIVES  ' }), null),
    vue(debit(), '  CB FOURNITURES\tFICTIVES  ')],
  ['la ligne de banque d’un débit, au crédit : son libellé',
    (b) => b.ecritureVueParLeModele(duMouvement(-45, { compte: '512000', sens: 'credit', montant: 45, libelle: 'CB FOURNITURES FICTIVES' }), null),
    vue(duMouvement(-45, { compte: '512000', sens: 'credit', montant: 45 }), 'CB FOURNITURES FICTIVES')],
  ['la ligne d’un débit dont le libellé n’est pas un texte : aucun libellé', (b) => b.ecritureVueParLeModele(duMouvement(-45, { libelle: 45 }), null), vue(duMouvement(-45), null)],
  ['la ligne restée d’une pièce supprimée, sur un crédit : le nom du crédit, jamais le client resté au brouillon',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { compte: '512000', sens: 'debit', montant: 300, libelle: 'Client fictif' }), null),
    vue(duMouvement(300, { compte: '512000', sens: 'debit', montant: 300 }), NOM_DU_CREDIT)],
  ['un crédit lu sans sa date : « sans date »', (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { montant: 300 } }), null),
    vue(sansPiece({}), 'Crédit du relevé sans date, 300,00 €')],
  // Le côté fermé : un mouvement dont le sens ne se lit pas ne donne aucun libellé.
  ['un mouvement que la lecture n’a pas rendu : aucun libellé', (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_MOUVEMENT, libelle: 'VIR M FICTIF' }), null),
    vue(sansPiece({}), null)],
  ['un mouvement de zéro euro : aucun libellé', (b) => b.ecritureVueParLeModele(duMouvement(0, { libelle: 'VIR M FICTIF' }), null), vue(duMouvement(0), null)],
  ['un mouvement au montant en texte : aucun libellé', (b) => b.ecritureVueParLeModele(duMouvement('300', { libelle: 'VIR M FICTIF' }), null), vue(duMouvement(0), null)],
  ['un mouvement au montant qui n’est pas un nombre : aucun libellé', (b) => b.ecritureVueParLeModele(duMouvement(Number.NaN, { libelle: 'VIR M FICTIF' }), null), vue(duMouvement(0), null)],
  ['un mouvement au montant infini : aucun libellé', (b) => b.ecritureVueParLeModele(duMouvement(Number.NEGATIVE_INFINITY, { libelle: 'VIR M FICTIF' }), null), vue(duMouvement(0), null)],
  ['un mouvement lu sans son montant : aucun libellé',
    (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { date: '2026-02-10' }, libelle: 'VIR M FICTIF' }), null), vue(sansPiece({}), null)],
  ['un mouvement rendu sous une forme inattendue (une liste) : aucun libellé',
    (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: [{ date: '2026-02-10', montant: -45 }], libelle: 'CB FICTIVE' }), null), vue(sansPiece({}), null)],
  // Une écriture que l'application compose sans pièce ni mouvement garde son libellé ; une ligne rattachée à rien n'en a aucun (VF9CQ1-Q2).
  ['la ligne d’une dotation : son libellé', (b) => b.ecritureVueParLeModele(dotation(), null), vue(dotation(), 'Dotation 2026 — Bien fictif')],
  ['la ligne d’un forfait kilométrique : son libellé', (b) => b.ecritureVueParLeModele(sansPiece({ vehicule_id: 'v1', libelle: 'Indemnités kilométriques 2026 — Voiture 5 CV' }), null),
    vue(sansPiece({}), 'Indemnités kilométriques 2026 — Voiture 5 CV')],
  ['la ligne d’une liquidation de TVA : son libellé', (b) => b.ecritureVueParLeModele(sansPiece({ declaration_tva_id: 'd1', libelle: 'CA3 1er trimestre 2026' }), null),
    vue(sansPiece({}), 'CA3 1er trimestre 2026')],
  ['la ligne d’une cotisation payée depuis le compte personnel : son libellé',
    (b) => b.ecritureVueParLeModele(sansPiece({ cotisation_id: 'c1', libelle: 'Cotisation, échéance du 15/02/2026, payée depuis le compte personnel' }), null),
    vue(sansPiece({}), 'Cotisation, échéance du 15/02/2026, payée depuis le compte personnel')],
  ['une ligne rattachée à rien, restée d’une pièce supprimée : aucun libellé', (b) => b.ecritureVueParLeModele(sansPiece({ libelle: 'Client fictif' }), null), vue(sansPiece({}), null)],
  // Le côté fermé : une ligne lue sans l'un de ses rattachements, sans sa pièce ou sans son mouvement, n'a aucun libellé —
  // chaque fois sur une ligne qui en aurait un, sans la garde.
  ...['piece_id', 'ligne_bancaire_id', 'facture_id', 'encaissement_id', 'immobilisation_id', 'vehicule_id', 'declaration_tva_id', 'cotisation_id'].map((c) => {
    const lue = sans(c === 'ligne_bancaire_id' ? dotation() : debit(), c)
    return [`une ligne lue sans sa colonne ${c} : aucun libellé`, (b: Bloc) => b.ecritureVueParLeModele(lue, null), vue(lue, null)] as const
  }),
  ['la ligne d’un débit lue sans sa pièce embarquée : aucun libellé', (b) => b.ecritureVueParLeModele(sans(debit(), 'pieces'), null), vue(debit(), null)],
  ['la ligne d’une pièce d’achat lue sans son mouvement embarqué : aucun libellé', (b) => b.ecritureVueParLeModele(sans(achat(), 'lignes_bancaires'), null), vue(achat(), null)],
  ['ce qui sort est écrit : aucune autre colonne de la ligne lue ne part',
    (b) => b.ecritureVueParLeModele(ligne({ id: 'x1', statut: 'validee', piece_ref: 'facture Client fictif.pdf', comp_aux_lib: 'Client fictif' }), null), vue(ligne({}), NOM_DE_LA_PIECE)],
  // Les ventes facturées (VF9c) : d'un dossier qui ne les lit pas, aucun libellé ni source ; d'un dossier qui les lit, leur
  // numéro et leur source, dans l'ordre des rattachements.
  ['d’un dossier qui ne lit pas ses ventes, la ligne d’une facture : aucun libellé, aucune source',
    (b) => b.ecritureVueParLeModele(sansPiece({ facture_id: 'f1', libelle: 'Facture F-1 — Client fictif' }), null), vue(sansPiece({}), null)],
  ['d’un dossier qui ne lit pas ses ventes, la ligne d’un encaissement : aucun libellé',
    (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'e1', libelle: 'Encaissement, facture F-1 — Client fictif' }), null), vue(sansPiece({}), null)],
  ['la ligne d’une facture : son numéro, sa source', (b) => b.ecritureVueParLeModele(sansPiece({ facture_id: 'f1', libelle: 'Facture F-1 — Client fictif' }), VENTES),
    vue(sansPiece({}), 'Facture F-1', 'facture')],
  ['la ligne d’un avoir sans numéro', (b) => b.ecritureVueParLeModele(sansPiece({ facture_id: 'a1', libelle: 'Avoir — Client fictif' }), VENTES), vue(sansPiece({}), 'Avoir sans numéro', 'avoir')],
  ['une facture que la lecture n’a pas rendue : aucun libellé', (b) => b.ecritureVueParLeModele(sansPiece({ facture_id: 'f404', libelle: 'Facture F-404 — Client fictif' }), VENTES),
    vue(sansPiece({}), null, 'facture')],
  ['la ligne d’un encaissement : son numéro, sa source', (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'e1', libelle: 'Encaissement — Client fictif' }), VENTES),
    vue(sansPiece({}), 'Encaissement, facture F-1', 'encaissement')],
  ['la ligne d’une contre-passation', (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'c1', libelle: 'Contre-passation — Client fictif' }), VENTES),
    vue(sansPiece({}), 'Contre-passation, facture F-1', 'encaissement')],
  ['un encaissement dont la facture n’est pas rendue : aucun libellé', (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'e9', libelle: 'Client fictif' }), VENTES),
    vue(sansPiece({}), null, 'encaissement')],
  ['un encaissement que la lecture n’a pas rendu : aucun libellé', (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'e404', libelle: 'Client fictif' }), VENTES),
    vue(sansPiece({}), null, 'encaissement')],
  ['la ligne d’une facture sur un crédit : son numéro — la facture avant le mouvement',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { facture_id: 'f1', libelle: 'Facture F-1 — Client fictif' }), VENTES), vue(sansPiece({}), 'Facture F-1', 'facture')],
  ['la ligne d’un encaissement sur un crédit classé : son numéro — l’encaissement avant le mouvement',
    (b) => b.ecritureVueParLeModele(sansPiece({ encaissement_id: 'e1', ligne_bancaire_id: ID_CLASSE, lignes_bancaires: { date: '2026-02-10', montant: 300 }, libelle: 'Client fictif' }), VENTES),
    vue(sansPiece({}), 'Encaissement, facture F-1', 'encaissement')],
  ['la ligne d’un crédit que ses encaissements classent : son nom, sa source',
    (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_CLASSE, lignes_bancaires: { date: '2026-02-10', montant: 300 }, libelle: 'VIR M FICTIF' }), VENTES),
    vue(sansPiece({}), NOM_DU_CREDIT, 'mouvement_d_encaissements')],
  // Adapté à VF9CQ1B : un débit que ses contre-passations classent défait l'argent d'un client, et se nomme.
  ['la ligne d’un débit que ses contre-passations classent : son nom, sa source',
    (b) => b.ecritureVueParLeModele(sansPiece({ ligne_bancaire_id: ID_CLASSE, lignes_bancaires: { date: '2026-02-10', montant: -20, encaissements_de_factures: true, ecritures_brouillon: lignesDuMouvement('511200', '512000') }, libelle: 'REJET VIR FICTIF' }), VENTES),
    vue(sansPiece({}), 'Débit du relevé du 10/02/2026, 20,00 €', 'mouvement_d_encaissements')],
  ['la ligne d’un crédit que ses encaissements ne classent pas, d’un dossier qui lit ses ventes : son nom, aucune source',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { libelle: 'VIR M FICTIF' }), VENTES), vue(sansPiece({}), NOM_DU_CREDIT, null)],
  ['la ligne d’une pièce, d’un dossier qui lit ses ventes : son nom, sa source', (b) => b.ecritureVueParLeModele(ligne({}), VENTES), vue(ligne({}), NOM_DE_LA_PIECE, 'piece')],
  ['une dotation, d’un dossier qui lit ses ventes : son libellé, aucune source', (b) => b.ecritureVueParLeModele(dotation(), VENTES), vue(dotation(), 'Dotation 2026 — Bien fictif', null)],
  ['une ligne rattachée à rien, d’un dossier qui lit ses ventes : ni libellé ni source', (b) => b.ecritureVueParLeModele(sansPiece({ libelle: 'Client fictif' }), VENTES),
    vue(sansPiece({}), null, null)],
  ['une ligne lue sans un de ses rattachements, d’un dossier qui lit ses ventes : ni libellé ni source',
    (b) => b.ecritureVueParLeModele(sans(sansPiece({ facture_id: 'f1' }), 'cotisation_id'), VENTES), vue(sansPiece({}), null, null)],
  // VF9CQ1B : le nom d'un débit qui rend ou défait l'argent d'un client — la date et le montant du mouvement, sans signe.
  ['le nom d’un débit : une date et un montant, sans signe', (b) => b.nomDUnDebitDuReleve({ date: '2026-01-15', montant: -45 }), 'Débit du relevé du 15/01/2026, 45,00 €'],
  ['le nom d’un débit : des centimes, sans séparateur de milliers', (b) => b.nomDUnDebitDuReleve({ date: '2026-12-31', montant: -1234.5 }), 'Débit du relevé du 31/12/2026, 1234,50 €'],
  ['le nom d’un débit : sans date', (b) => b.nomDUnDebitDuReleve({ date: null, montant: -45 }), 'Débit du relevé sans date, 45,00 €'],
  ['le nom d’un débit : une date mal formée', (b) => b.nomDUnDebitDuReleve({ date: '2026-1-5', montant: -45 }), 'Débit du relevé sans date, 45,00 €'],
  ['le nom d’un débit : un instant au lieu d’une date', (b) => b.nomDUnDebitDuReleve({ date: '2026-01-15T10:00:00Z', montant: -45 }), 'Débit du relevé sans date, 45,00 €'],
  // Ce que la base a écrit du débit le reconnaît : une ligne propre sur un produit ou un client, ou son classement par ses
  // contre-passations ; chaque ligne qui tient le libellé de la banque se nomme alors, celle de la banque comme les autres.
  ['un débit affecté à un produit (un trop-perçu remboursé) : la ligne de la banque se nomme',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('706000', '512000'))), null), vue(debitLu({}), NOM_DU_DEBIT)],
  ['un débit affecté à un produit : la ligne du produit se nomme aussi',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('706000', '512000')), { compte: '706000', sens: 'debit' }), null),
    vue(debitLu({}, { compte: '706000', sens: 'debit' }), NOM_DU_DEBIT)],
  ['un débit ventilé en partie sur un produit : sa ligne de charge se nomme aussi',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('627000', '709000', '512000')), { compte: '627000', sens: 'debit', montant: 2 }), null),
    vue(debitLu({}, { compte: '627000', sens: 'debit', montant: 2 }), NOM_DU_DEBIT)],
  ['un débit dont une ligne propre est sur un client (411, en engagement) : se nomme',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('411000', '512000'))), null), vue(debitLu({}), NOM_DU_DEBIT)],
  ['un débit dont une ligne propre est sur un client créditeur (419) : se nomme',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('419100', '512000'))), null), vue(debitLu({}), NOM_DU_DEBIT)],
  ['un débit que ses contre-passations classent, d’un dossier qui ne lit pas ses ventes : se nomme, sans source',
    (b) => b.ecritureVueParLeModele(debitLu({ encaissements_de_factures: true, ecritures_brouillon: lignesDuMouvement('511200', '512000') }), null), vue(debitLu({}), NOM_DU_DEBIT)],
  ['un débit d’un fournisseur (pièce supprimée, en engagement : 401) : son libellé',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('401000', '512000'))), null), vue(debitLu({}), LIBELLE_DU_DEBIT)],
  ['un virement personnel au débit (108) : son libellé',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('108000', '512000'))), null), vue(debitLu({}), LIBELLE_DU_DEBIT)],
  ['une échéance d’emprunt (164, 661, 616) : son libellé',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes(...lignesDuMouvement('164000', '661100', '616800', '512000'))), null), vue(debitLu({}), LIBELLE_DU_DEBIT)],
  ['une ligne d’une facture ou d’un encaissement, sur un produit ou un client, n’est pas propre : le débit garde son libellé',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes({ compte: '706000', facture_id: 'f1', encaissement_id: null },
      { compte: '411000', facture_id: null, encaissement_id: 'c1' }, ...lignesDuMouvement('627000', '512000'))), null), vue(debitLu({}), LIBELLE_DU_DEBIT)],
  ['une ligne qui n’est pas propre, au compte illisible : le débit garde son libellé',
    (b) => b.ecritureVueParLeModele(debitLu(surLesLignes({ compte: null, facture_id: null, encaissement_id: 'c1' }, ...lignesDuMouvement('627000', '512000'))), null),
    vue(debitLu({}), LIBELLE_DU_DEBIT)],
  ['la ligne d’une pièce d’achat sur un débit qui se nomme : son fournisseur — la pièce avant le mouvement',
    (b) => b.ecritureVueParLeModele(achat({ compte: '512000', sens: 'credit', ligne_bancaire_id: ID_MOUVEMENT, lignes_bancaires: { date: '2026-02-10', montant: -48, ...surLesLignes(...lignesDuMouvement('706000', '512000')) } }), null),
    vue(achat({ compte: '512000', sens: 'credit' }), 'Fournisseur fictif')],
  ['un crédit, quoi que disent ses lignes : le nom d’un crédit',
    (b) => b.ecritureVueParLeModele(duMouvement(300, { libelle: 'VIR M FICTIF' }, { encaissements_de_factures: true, ecritures_brouillon: lignesDuMouvement('706000') }), null),
    vue(duMouvement(300), NOM_DU_CREDIT)],
  // Le côté fermé : le classement, les lignes, l'une d'elles ou son compte non lus — le débit se nomme.
  ...([
    ['le classement par ses encaissements absent', { ecritures_brouillon: lignesDuMouvement('606000', '512000') }],
    ['le classement nul', { encaissements_de_factures: null, ecritures_brouillon: lignesDuMouvement('606000', '512000') }],
    ['le classement en texte', { encaissements_de_factures: 'false', ecritures_brouillon: lignesDuMouvement('606000', '512000') }],
    ['ses lignes absentes', { encaissements_de_factures: false }],
    ['ses lignes nulles', { encaissements_de_factures: false, ecritures_brouillon: null }],
    ['ses lignes, une liste vide', surLesLignes()],
    ['ses lignes rendues sous un objet', { encaissements_de_factures: false, ecritures_brouillon: { compte: '606000', facture_id: null, encaissement_id: null } }],
    ['une ligne nulle', surLesLignes(null, ...lignesDuMouvement('512000'))],
    ['une ligne lue sans sa facture', surLesLignes({ compte: '606000', encaissement_id: null }, ...lignesDuMouvement('512000'))],
    ['une ligne lue sans son encaissement', surLesLignes({ compte: '606000', facture_id: null }, ...lignesDuMouvement('512000'))],
    ['une ligne propre sans son compte', surLesLignes({ facture_id: null, encaissement_id: null }, ...lignesDuMouvement('512000'))],
    ['une ligne propre au compte qui n’est pas un texte', surLesLignes({ compte: 606000, facture_id: null, encaissement_id: null }, ...lignesDuMouvement('512000'))],
  ] as const).map(([quoi, lu]) => [`un débit, ${quoi} : son nom (le côté fermé)`, (b: Bloc) => b.ecritureVueParLeModele(debitLu(lu), null), vue(debitLu({}), NOM_DU_DEBIT)] as const),
  ['la reconnaissance, seule : un débit d’un fournisseur lu en entier n’en est pas un', (b) => b.debitQuiRendLArgentDUnClient(DEBIT_D_UN_FOURNISSEUR), false],
  ['la reconnaissance, seule : la racine commence le compte (607 et 401700 portent un 7, 104100 un 41)',
    (b) => b.debitQuiRendLArgentDUnClient(surLesLignes(...lignesDuMouvement('607000', '401700', '104100', '512000'))), false],
  ['la reconnaissance, seule : une ligne propre sur un produit suffit, quel que soit son rang', (b) => b.debitQuiRendLArgentDUnClient(surLesLignes(...lignesDuMouvement('512000', '627000', '708000'))), true],
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
    expect(declares).toEqual([...TYPES_DU_BLOC, ...NOMS].sort())
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

  // VF9CQ1 : « rattachée à rien » se définit par ce relevé. Une ligne du brouillon que la base gagnerait le droit de citer —
  // une clé étrangère neuve, la caisse du MVP par exemple — ferait tomber ce test : jusque-là, une ligne qui ne cite qu'elle
  // passe pour rattachée à rien, et se tait (le côté fermé), et la source qu'elle désigne sera jugée avant de parler.
  it('les rattachements d’une ligne : chaque clé étrangère d’ecritures_brouillon du schéma exporté, le dossier excepté', () => {
    const relations = relationsDuSchema(fichiersDuSchema()).filter((r) => r.enfant === 'ecritures_brouillon')
    expect(relations.some((r) => r.colonne === 'dossier_id' && r.parent === 'dossiers'), 'la clé du dossier, seule exceptée').toBe(true)
    const cles = relations.filter((r) => r.parent !== 'dossiers').map((r) => r.colonne).sort()
    expect(cles.length, 'le plancher : les huit sources d’aujourd’hui').toBeGreaterThanOrEqual(8)
    expect([...deployee.RATTACHEMENTS_D_UNE_LIGNE].sort()).toEqual(cles)
    expect(new Set(deployee.RATTACHEMENTS_D_UNE_LIGNE).size).toBe(deployee.RATTACHEMENTS_D_UNE_LIGNE.length)
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
    // Les cinq dérives de VF9C-Q1 sur la ligne d'une pièce, réancrées à VF9CQ1 : la vue s'écrit, et la pièce se juge dans
    // `libelleDUneLigneDePiece`, la garde des rattachements dans `libelleEtSource`.
    ['ecritureVueParLeModele : la pièce lue rendue avec la ligne',
      '  const vue = { date: ligne.date, compte: ligne.compte, libelle, sens: ligne.sens, montant: ligne.montant, piece_id: ligne.piece_id }\n',
      '  const vue = { ...ligne, libelle }\n'],
    ['ecritureVueParLeModele : la ligne d’une pièce de vente sous son libellé',
      '  return lue.type_piece === "vente" ? nomDUnePieceDeVente(', '  return lue.type_piece === "vente" ? libelleDuBrouillon(ligne) ?? nomDUnePieceDeVente('],
    ['ecritureVueParLeModele : une pièce que la lecture n’a pas rendue prise pour une ligne sans pièce',
      '  if (piece === null || typeof piece !== "object") return null\n', '  if (piece === null || typeof piece !== "object") return libelleDuBrouillon(ligne)\n'],
    ['ecritureVueParLeModele : une ligne lue sans sa pièce prise pour une ligne sans pièce', ' || !("pieces" in ligne)', ''],
    ['ecritureVueParLeModele : un type inconnu qui garde son libellé',
      'montant_ttc: lue.montant_ttc ?? null }) : null\n', 'montant_ttc: lue.montant_ttc ?? null }) : libelleDuBrouillon(ligne)\n'],
    // VF9CQ1.
    ['ecritureVueParLeModele : la source rendue à un dossier qui ne lit pas ses ventes', '  return ventes === null ? vue : { ...vue, source }\n', '  return { ...vue, source }\n'],
    ['ecritureVueParLeModele : la source tue d’un dossier qui lit ses ventes', '  return ventes === null ? vue : { ...vue, source }\n', '  return vue\n'],
    ['RATTACHEMENTS_D_UNE_LIGNE : le mouvement en sort', '  "piece_id", "ligne_bancaire_id", "facture_id",', '  "piece_id", "facture_id",'],
    ['RATTACHEMENTS_D_UNE_LIGNE : la cotisation en sort', '"declaration_tva_id",\n  "cotisation_id",\n]', '"declaration_tva_id",\n]'],
    ['nomDUnCreditDuReleve : la date telle que la base l’écrit',
      '    ? `du ${mouvement.date.slice(8, 10)}/${mouvement.date.slice(5, 7)}/${mouvement.date.slice(0, 4)}`\n', '    ? `du ${mouvement.date}`\n'],
    ['nomDUnCreditDuReleve : un instant pris pour une date', '/^\\d{4}-\\d{2}-\\d{2}$/.test(mouvement.date)', '/^\\d{4}-\\d{2}-\\d{2}/.test(mouvement.date)'],
    ['nomDUnCreditDuReleve : le montant à l’anglaise', '${mouvement.montant.toFixed(2).replace(".", ",")} €', '${mouvement.montant.toFixed(2)} €'],
    ['libelleDuBrouillon : un libellé qui n’est pas un texte rendu tel quel', '  return typeof ligne.libelle === "string" ? ligne.libelle : null\n', '  return ligne.libelle as string\n'],
    ['libelleDUneLigneDePiece : une pièce d’achat sous le nom d’une vente',
      'TYPES_DONT_LE_TIERS_SE_DIT.includes(lue.type_piece)) return libelleDuBrouillon(ligne)\n',
      'TYPES_DONT_LE_TIERS_SE_DIT.includes(lue.type_piece)) return nomDUnePieceDeVente({ date_piece: lue.date_piece ?? null, montant_ttc: lue.montant_ttc ?? null })\n'],
    // Les trois dérives du sens, réancrées à VF9CQ1B : le débit a sa branche, et le crédit prend le mouvement nommé.
    ['libelleDUneLigneDuReleve : un crédit sous le libellé du brouillon', '  return nomDUnCreditDuReleve(nomme)\n', '  return libelleDuBrouillon(ligne) ?? nomDUnCreditDuReleve(nomme)\n'],
    ['libelleDUneLigneDuReleve : un débit recomposé lui aussi',
      '  if (lu.montant < 0) {\n    return debitQuiRendLArgentDUnClient(mouvement as Record<string, unknown>) ? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n  }\n', ''],
    ['libelleDUneLigneDuReleve : le sens de la ligne pris pour celui du mouvement', '  if (lu.montant < 0) {\n', '  if (ligne.sens === "credit") {\n'],
    ['libelleDUneLigneDuReleve : un mouvement non rendu pris pour un débit',
      '  if (mouvement === null || typeof mouvement !== "object") return null\n', '  if (mouvement === null || typeof mouvement !== "object") return libelleDuBrouillon(ligne)\n'],
    ['libelleDUneLigneDuReleve : un montant nul pris pour un crédit', ' || lu.montant === 0) return null', ') return null'],
    ['libelleDUneLigneDuReleve : un montant en texte lu comme un nombre',
      'typeof lu.montant !== "number" || !Number.isFinite(lu.montant)', '!Number.isFinite(Number(lu.montant))'],
    ['libelleEtSource : une ligne rattachée à rien sous son libellé',
      '  return { libelle: null, source: null }\n}\n\n// Ce que le modèle reçoit', '  return { libelle: libelleDuBrouillon(ligne), source: null }\n}\n\n// Ce que le modèle reçoit'],
    ['libelleEtSource : les écritures composées sans pièce ni mouvement tues',
      '    return { libelle: libelleDuBrouillon(ligne), source: null }\n  }\n', '    return { libelle: null, source: null }\n  }\n'],
    ['libelleEtSource : le mouvement jugé avant la pièce', '  if (ligne.piece_id != null) return {', '  if (ligne.piece_id != null && ligne.ligne_bancaire_id == null) return {'],
    ['libelleEtSource : une vente facturée sous le libellé du brouillon, faute de ses ventes', '${numero(f)}` : null, source:', '${numero(f)}` : libelleDuBrouillon(ligne), source:'],
    ['libelleEtSource : une ligne lue sans son mouvement embarqué jugée quand même', ' || !("lignes_bancaires" in ligne)', ''],
    ['libelleEtSource : la source d’un crédit classé perdue', 'source: classe ? "mouvement_d_encaissements" : null', 'source: null'],
    // VF9CQ1B.
    ['libelleDUneLigneDuReleve : tout débit sous son libellé, comme hier',
      '? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n', '? libelleDuBrouillon(ligne) : libelleDuBrouillon(ligne)\n'],
    ['libelleDUneLigneDuReleve : tout débit recomposé', '? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n', '? nomDUnDebitDuReleve(nomme) : nomDUnDebitDuReleve(nomme)\n'],
    ['libelleDUneLigneDuReleve : un débit reconnu sous le libellé du brouillon, s’il en a un',
      '? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n', '? libelleDuBrouillon(ligne) ?? nomDUnDebitDuReleve(nomme) : libelleDuBrouillon(ligne)\n'],
    ['RACINES_DES_COMPTES_D_UN_CLIENT : le client en sort', '["7", "41"]', '["7"]'],
    ['RACINES_DES_COMPTES_D_UN_CLIENT : le produit en sort', '["7", "41"]', '["41"]'],
    ['RACINES_DES_COMPTES_D_UN_CLIENT : le fournisseur y entre', '["7", "41"]', '["7", "4"]'],
    ['nomDUnDebitDuReleve : le montant signé', 'montant: Math.abs(mouvement.montant) })', 'montant: mouvement.montant })'],
    ['nomDUnDebitDuReleve : le mot du crédit', '.replace(/^Crédit/, "Débit")', ''],
    ['debitQuiRendLArgentDUnClient : un classement non lu pris pour un débit ordinaire',
      '  if (mouvement.encaissements_de_factures !== false) return true\n', '  if (mouvement.encaissements_de_factures === true) return true\n'],
    ['debitQuiRendLArgentDUnClient : le classement par ses contre-passations oublié', '  if (mouvement.encaissements_de_factures !== false) return true\n', ''],
    ['debitQuiRendLArgentDUnClient : des lignes non lues prises pour un débit ordinaire',
      '  if (!Array.isArray(lignes) || lignes.length === 0) return true\n', '  if (!Array.isArray(lignes) || lignes.length === 0) return false\n'],
    ['debitQuiRendLArgentDUnClient : une liste vide prise pour lue', '  if (!Array.isArray(lignes) || lignes.length === 0) return true\n', '  if (!Array.isArray(lignes)) return true\n'],
    ['debitQuiRendLArgentDUnClient : une ligne non lue prise pour une ligne ordinaire',
      '    if (l === null || typeof l !== "object" || !("facture_id" in l) || !("encaissement_id" in l)) return true\n',
      '    if (l === null || typeof l !== "object" || !("facture_id" in l) || !("encaissement_id" in l)) return false\n'],
    ['debitQuiRendLArgentDUnClient : une ligne lue sans sa facture prise pour propre', ' || !("facture_id" in l)', ''],
    ['debitQuiRendLArgentDUnClient : une ligne d’une facture ou d’un encaissement comptée comme propre',
      '    if (lue.facture_id != null || lue.encaissement_id != null) return false\n', ''],
    ['debitQuiRendLArgentDUnClient : un compte illisible pris pour une charge', '    return typeof lue.compte !== "string" || RACINES', '    return typeof lue.compte === "string" && RACINES'],
    ['debitQuiRendLArgentDUnClient : la racine cherchée partout dans le compte', '(lue.compte as string).startsWith(r)', '(lue.compte as string).includes(r)'],
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

/**
 * Les colonnes qui peuvent nommer le client d'une vente ou qui a payé : le tiers et le fichier d'une pièce, le libellé du
 * brouillon et ce que la validation y fige pour le FEC (la référence de la pièce — son fichier —, le compte auxiliaire et son
 * libellé — son tiers), le libellé que la banque a donné à un mouvement, le client d'une facture.
 */
const QUI_NOMMENT: Readonly<Record<string, readonly string[]>> = {
  pieces: ['tiers', 'nom_fichier'],
  ecritures_brouillon: ['libelle', 'piece_ref', 'comp_aux_num', 'comp_aux_lib'],
  lignes_bancaires: ['libelle', 'libelle_brut'],
  factures_emises: ['tiers_nom'],
}
/**
 * Ce qui ne se lit jamais, ni déclaré ni passé : le client d'une facture (VF9c) ; le libellé de la banque (VF9CQ1 : il ne
 * parvient au modèle que recopié au brouillon, et passé) ; ce que la validation fige au brouillon pour le FEC.
 */
const JAMAIS = [
  'factures_emises.tiers_nom', 'lignes_bancaires.libelle', 'lignes_bancaires.libelle_brut',
  'ecritures_brouillon.piece_ref', 'ecritures_brouillon.comp_aux_num', 'ecritures_brouillon.comp_aux_lib',
]

type Passage = 'pieceVueParLeModele' | 'ecritureVueParLeModele'

/** Ce qu'un passage demande à la lecture qu'il reçoit, dans chacune de ses sélections : les rattachements, tels que le bloc les énumère. */
const CE_QUE_LE_PASSAGE_LIT: Readonly<Record<Passage, readonly string[]>> = {
  pieceVueParLeModele: ['pieces.type_piece'],
  ecritureVueParLeModele: [
    'ecritures_brouillon.libelle', ...deployee.RATTACHEMENTS_D_UNE_LIGNE.map((c) => `ecritures_brouillon.${c}`),
    'pieces.type_piece', 'pieces.date_piece', 'pieces.montant_ttc', 'lignes_bancaires.date', 'lignes_bancaires.montant',
    'lignes_bancaires.encaissements_de_factures',
  ],
}
/**
 * Et la forme exacte de la pièce et du mouvement que `ecritureVueParLeModele` reçoit avec chaque ligne : embarqués À GAUCHE —
 * une ligne sans pièce, d'un mouvement du relevé ou d'une vente facturée, reste dans la liste, comme une ligne sans mouvement —,
 * et rien d'autre qu'eux : ni le tiers, ni le libellé de la banque. Le mouvement, depuis VF9CQ1B, avec son classement par ses
 * encaissements et ses lignes — leur compte, leur facture, leur encaissement, jamais leur libellé ni ce que la validation y
 * fige —, à gauche aussi : un mouvement sans ligne resterait.
 */
const MOUVEMENT_EMBARQUE = 'lignes_bancaires(date, montant, encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))'
const EMBARQUES = ['pieces(type_piece, date_piece, montant_ttc)', MOUVEMENT_EMBARQUE]
/** L'appel du passage, tel que l'outil le fait sur ses lignes lues : une fois, et lui seul. */
const APPEL_DU_PASSAGE: Readonly<Record<Passage, string>> = {
  pieceVueParLeModele: '((data ?? []) as Record<string, unknown>[]).map(pieceVueParLeModele)',
  ecritureVueParLeModele: '((data ?? []) as Record<string, unknown>[]).map((ligne) => ecritureVueParLeModele(ligne, nommees))',
}

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
    raison: 'les lignes que l’outil rend, lues avec leurs rattachements, leur pièce et leur mouvement : chacune passe par le passage, qui écrit ce '
      + 'qui en sort — le libellé d’une ligne de pièce de vente, d’un crédit et d’un débit qui rend ou défait l’argent d’un client '
      + 'recomposé, celui d’une ligne rattachée à rien tu ; le mouvement lu avec son classement et les comptes de ses lignes',
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

/**
 * Les colonnes d'une sélection, `table.colonne`, ressources embarquées comprises — à toute profondeur : depuis VF9CQ1B, le
 * mouvement d'une ligne embarque ses propres lignes ; une forme inconnue lève.
 */
function colonnesDe(table: string, selection: string): string[] {
  return entrees(selection).flatMap((e) => {
    if (/^\w+$/.test(e)) return [`${table}.${e}`]
    const embarquee = /^(\w+)(?:!inner)?\((.*)\)$/s.exec(e)
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
        // Une colonne de la table lue se cherche à son premier niveau (VF9CQ1B) : les lignes du mouvement, embarquées, portent
        // aussi une facture et un encaissement, qui ne sont pas les rattachements de la ligne.
        const lues = colonnesDe(d.table, t)
        const premierNiveau = entrees(t).filter((e) => /^\w+$/.test(e)).map((e) => `${d.table}.${e}`)
        const manque = CE_QUE_LE_PASSAGE_LIT[d.passage].filter((c) => !(c.startsWith(`${d.table}.`) ? premierNiveau : lues).includes(c))
        if (manque.length > 0) fautes.push(`${d.zone} : une sélection sans ${manque.join(', ')}, que ${d.passage} lit`)
        if (d.passage === 'ecritureVueParLeModele') {
          for (const forme of EMBARQUES) {
            if (!entrees(t).includes(forme)) fautes.push(`${d.zone} : la sélection ne porte pas ${forme} (à gauche, et rien d’autre)`)
          }
        }
      }
    }
    // Et l'outil ne rend ses lignes que passées : `data` ne sert qu'à les lire, puis à les passer, une fois.
    const zone = zones.find((z) => z.nom === d.zone)
    const corps = zone ? texte.slice(zone.debut, zone.fin) : ''
    const usages = [...corps.matchAll(/\bdata\b/g)].length
    const lue = (corps.match(/const \{ data, error, count \} = await q\./g) ?? []).length
    const passee = corps.split(APPEL_DU_PASSAGE[d.passage]).length - 1
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
  const SELECTION_DES_LIGNES = 'piece_id, ligne_bancaire_id, facture_id, encaissement_id, immobilisation_id, vehicule_id, declaration_tva_id, cotisation_id, pieces(type_piece, date_piece, montant_ttc), lignes_bancaires(date, montant, encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))"'
  const DEFAUTS: readonly (readonly [quoi: string, mutee: () => string])[] = [
    ['une lecture de plus du tiers, dans resume_dossier', () => muter(source, [[
      'admin.from("pieces").select("id", { count: "exact", head: true }).eq("dossier_id", dossierId).eq("statut", "a_valider"),',
      'admin.from("pieces").select("id, tiers", { count: "exact", head: true }).eq("dossier_id", dossierId).eq("statut", "a_valider"),']])],
    ['lister_pieces rend ses pièces sans le passage', () => muter(source, [[
      '    const lues = ((data ?? []) as Record<string, unknown>[]).map(pieceVueParLeModele)\n', '    const lues = ((data ?? []) as Record<string, unknown>[])\n']])],
    // Réancré à VF9CQ1 : l'outil n'a plus qu'un retour, après le passage.
    ['lister_ecritures rend aussi les lignes lues, sans le passage', () => muter(source, [[
      '    return resultatListe(lignes, count, "ecritures")\n', '    return resultatListe(nommees ? lignes : data, count, "ecritures")\n']])],
    // Les trois défauts de la pièce embarquée, réancrés à VF9CQ1 : une seule sélection, la pièce et le mouvement embarqués.
    ['la pièce embarquée qui rapporte son tiers', () => muter(source, [[
      'pieces(type_piece, date_piece, montant_ttc), lignes_bancaires', 'pieces(type_piece, date_piece, montant_ttc, tiers), lignes_bancaires']])],
    ['la pièce embarquée oubliée d’une des deux sélections', () => muter(source, [[
      `, pieces(type_piece, date_piece, montant_ttc), ${MOUVEMENT_EMBARQUE}"`, `, ${MOUVEMENT_EMBARQUE}"`]])],
    ['la pièce embarquée en jointure interne : une ligne sans pièce disparaîtrait', () => muter(source, [[
      'pieces(type_piece, date_piece, montant_ttc), lignes_bancaires', 'pieces!inner(type_piece, date_piece, montant_ttc), lignes_bancaires']])],
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
    // VF9CQ1 : le mouvement de chaque ligne, ses rattachements, le libellé de la banque, ce que la validation fige au brouillon.
    // Réancrés à VF9CQ1B : le mouvement embarqué porte aussi son classement et ses lignes.
    ['le mouvement embarqué qui rapporte son libellé', () => muter(source, [['lignes_bancaires(date, montant, ', 'lignes_bancaires(date, montant, libelle, ']])],
    ['le mouvement embarqué qui rapporte son libellé brut', () => muter(source, [['lignes_bancaires(date, montant, ', 'lignes_bancaires(date, montant, libelle_brut, ']])],
    ['le mouvement de chaque ligne oublié', () => muter(source, [[`, ${MOUVEMENT_EMBARQUE}"`, '"']])],
    ['le mouvement de chaque ligne lu sans son montant', () => muter(source, [['lignes_bancaires(date, montant, ', 'lignes_bancaires(date, ']])],
    ['le mouvement de chaque ligne en jointure interne : une ligne sans mouvement disparaîtrait', () => muter(source, [['lignes_bancaires(date, montant, ', 'lignes_bancaires!inner(date, montant, ']])],
    // VF9CQ1B : le classement du mouvement et ses lignes, lus avec lui ; jamais leur libellé ni ce que la validation y fige.
    ['le classement du mouvement non lu', () => muter(source, [['lignes_bancaires(date, montant, encaissements_de_factures, ', 'lignes_bancaires(date, montant, ']])],
    ['les lignes du mouvement non lues', () => muter(source, [['encaissements_de_factures, ecritures_brouillon(compte, facture_id, encaissement_id))"', 'encaissements_de_factures)"']])],
    ['les lignes du mouvement lues sans leur compte', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(facture_id, encaissement_id))"']])],
    ['les lignes du mouvement lues sans leur facture', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(compte, encaissement_id))"']])],
    ['les lignes du mouvement lues sans leur encaissement', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(compte, facture_id))"']])],
    ['les lignes du mouvement lues avec leur libellé', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(compte, libelle, facture_id, encaissement_id))"']])],
    ['les lignes du mouvement lues avec leur référence de pièce figée', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(compte, piece_ref, facture_id, encaissement_id))"']])],
    ['les lignes du mouvement lues avec leur compte auxiliaire figé', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(compte, comp_aux_lib, facture_id, encaissement_id))"']])],
    ['les lignes du mouvement en jointure interne', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon!inner(compte, facture_id, encaissement_id))"']])],
    ['les lignes du mouvement désignées sous une forme que le scanner ne sait pas lire', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon!ligne_bancaire_id(compte, facture_id, encaissement_id))"']])],
    ['les lignes du mouvement lues en entier (*)', () => muter(source, [['ecritures_brouillon(compte, facture_id, encaissement_id))"', 'ecritures_brouillon(*))"']])],
    ['le mouvement de chaque ligne embarquant aussi ses encaissements', () => muter(source, [['encaissement_id))"', 'encaissement_id), encaissements_factures(id))"']])],
    ...['ligne_bancaire_id', 'facture_id', 'encaissement_id', 'immobilisation_id', 'vehicule_id', 'declaration_tva_id', 'cotisation_id'].map((c) => [
      `le rattachement ${c} non lu`, () => muter(source, [[SELECTION_DES_LIGNES, SELECTION_DES_LIGNES.replace(`, ${c}`, '')]]),
    ] as const),
    ['le libellé de la banque lu par points_a_traiter', () => muter(source, [[
      'admin.from("lignes_bancaires").select("id, date, montant, statut, piece_id, reglement_groupe,', 'admin.from("lignes_bancaires").select("id, date, libelle, montant, statut, piece_id, reglement_groupe,']])],
    ['la référence de pièce que la validation fige, lue', () => muter(source, [[
      'select("date, compte, libelle, sens, montant, piece_id, ligne_bancaire_id, statut,', 'select("date, compte, libelle, sens, montant, piece_id, piece_ref, ligne_bancaire_id, statut,']])],
    ['le compte auxiliaire que la validation fige, lu', () => muter(source, [[
      'select("date, compte, libelle, sens, montant, piece_id, ligne_bancaire_id, statut,', 'select("date, compte, libelle, sens, montant, piece_id, comp_aux_lib, ligne_bancaire_id, statut,']])],
    ['lister_ecritures passe ses lignes sans ce que le dossier sait de ses ventes', () => muter(source, [[
      '.map((ligne) => ecritureVueParLeModele(ligne, nommees))', '.map((ligne) => ecritureVueParLeModele(ligne, null))']])],
  ]
  for (const [quoi, mutee] of DEFAUTS) {
    it(`voit ${quoi}`, () => {
      expect(fautesDe(mutee()).length).toBeGreaterThan(0)
    })
  }
})
