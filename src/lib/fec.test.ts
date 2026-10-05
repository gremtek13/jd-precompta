import { describe, expect, it } from 'vitest'
import { formaterFec, genererFec, libelleCompte, nomFichierFec, numeroterFec, numerotationValidee, type NumerotationFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { A_NOUVEAU_NON_VALIDE } from '../test/ecritures'
import { lignesPourPiece, type LigneAGenerer } from './ecritures'
import { defautsDeNumerotation } from './validationExercice'
import { lettrages, type LettrageDeLigne } from './lettrage'

// Le lettrage d'un fichier (lib/lettrage.ts) : vide, sauf dans les tests qui le calculent comme l'écran.
const SANS_LETTRAGE: ReadonlyMap<string, LettrageDeLigne> = new Map()

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', nom_fichier: `${id}.pdf`, chemin_stockage: '', statut: 'validee',
  type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
  montant_ttc: 100, tiers: null, categorie_id: null, sous_dossier_id: null, notes: null,
  created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const ligne = (pieceId: string, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: `e-${pieceId}-${o.compte ?? '606100'}`, dossier_id: 'd1', piece_id: pieceId,
  ligne_bancaire_id: null, date: '2026-03-10', libelle: 'Fournisseur', sens: 'debit',
  statut: 'proposee', compte: '606100', montant: 100, created_at: '2026-03-10T00:00:00Z', ...o,
} as EcritureBrouillon)

const colonnes = (fec: string) => fec.split('\r\n').map((l) => l.split('\t'))
// Relit un montant tel que la norme l'écrit, virgule décimale comprise — `Number('6000,00')` rend NaN.
const lireMontant = (champ: string) => Number(champ.replace(',', '.'))

// L'OUTIL DE LA DGFiP, ÉCRITURE PAR ÉCRITURE (Test Compta Demat, SQL/ECRITURE.sql et SQL/VUES.sql, l'écran des
// vérificateurs) : les lignes d'un même EcritureNum portent un seul journal, une seule date, une seule pièce, une seule
// date de pièce et un seul lettrage — un lettrage vide n'en est pas un, `min(code_lettrage) = max(code_lettrage)`
// ignorant les vides. Relus sur le fichier IMPRIMÉ, comme l'outil les lit.
function anomaliesDgfip(fec: string): string[] {
  const parEcriture = new Map<string, string[][]>()
  for (const r of colonnes(fec).slice(1)) parEcriture.set(r[2], [...(parEcriture.get(r[2]) ?? []), r])
  const anomalies: string[] = []
  for (const [num, rows] of parEcriture) {
    const distincts = (i: number) => new Set(rows.map((r) => r[i])).size
    if (distincts(0) !== 1) anomalies.push(`${num} : différents codes journaux`)
    if (distincts(3) !== 1) anomalies.push(`${num} : différentes dates comptables`)
    if (distincts(8) !== 1) anomalies.push(`${num} : différents numéros de pièce`)
    if (distincts(9) !== 1) anomalies.push(`${num} : différentes dates pièce`)
    if (new Set(rows.map((r) => r[13]).filter((v) => v !== '')).size > 1) anomalies.push(`${num} : différents lettrages`)
  }
  return anomalies
}

// Le sixième contrôle de l'outil, « Écriture non équilibrée » : en centimes, écriture par écriture.
function desequilibresDgfip(fec: string): string[] {
  const soldes = new Map<string, number>()
  for (const r of colonnes(fec).slice(1)) {
    soldes.set(r[2], (soldes.get(r[2]) ?? 0) + Math.round(lireMontant(r[11]) * 100) - Math.round(lireMontant(r[12]) * 100))
  }
  return [...soldes].filter(([, s]) => s !== 0).map(([num]) => num)
}

describe('genererFec — intégrité du fichier', () => {
  it("neutralise les sauts de ligne d'un libellé venu de l'OCR", () => {
    // Cas réel relevé en base : un en-tête de facture sur trois lignes ressort tel quel de
    // l'extraction. Sans neutralisation, cette seule pièce coupe la ligne FEC en trois et rend le
    // fichier structurellement invalide.
    const fec = genererFec(
      [ligne('p1', { libelle: "CAISSE\nD'EPARGNE\nCEPAC" })],
      [piece('p1', { tiers: "CAISSE\nD'EPARGNE\nCEPAC" })],
      [],
      [],
      'tresorerie', [], SANS_LETTRAGE,
    )
    const rows = colonnes(fec)
    expect(rows).toHaveLength(2) // en-tête + 1 écriture, pas 4
    expect(rows[1][10]).toBe("CAISSE D'EPARGNE CEPAC")
  })

  it('neutralise une tabulation, qui décalerait toutes les colonnes suivantes', () => {
    const fec = genererFec([ligne('p1', { libelle: 'ACME\tSARL' })], [piece('p1')], [], [], 'tresorerie', [], SANS_LETTRAGE)
    const rows = colonnes(fec)
    expect(rows[1]).toHaveLength(18) // le format en impose 18, ni plus ni moins
    expect(rows[1][10]).toBe('ACME SARL')
  })

  it('neutralise aussi un nom de fichier piégé', () => {
    const fec = genererFec([ligne('p1')], [piece('p1', { nom_fichier: 'facture\tmars.pdf' })], [], [], 'tresorerie', [], SANS_LETTRAGE)
    expect(colonnes(fec)[1][8]).toBe('facture mars.pdf')
  })

  it('garde toutes les lignes à 18 colonnes, quoi qu’il arrive', () => {
    const fec = genererFec(
      [ligne('p1', { libelle: "a\tb\nc" }), ligne('p1', { compte: COMPTE_BANQUE, sens: 'credit' })],
      [piece('p1', { nom_fichier: "x\ny.pdf" })],
      [],
      [],
      'tresorerie', [], SANS_LETTRAGE,
    )
    expect(colonnes(fec).every((r) => r.length === 18)).toBe(true)
  })
})

// La forme que l'article A47 A-1 impose au fichier à plat : noms des champs en première ligne,
// tabulation, dates AAAAMMJJ, et des montants en base décimale dont « la virgule sépare la fraction
// entière de la partie décimale », sans « aucun séparateur de millier ». Jusqu'au 28/09/2026 les
// montants sortaient avec un point, et aucun test ne le voyait : ils n'éprouvaient que les colonnes.
describe('genererFec — la forme imposée par l’article A47 A-1', () => {
  const MONTANT_NORME = /^-?\d+,\d{2}$/
  const DATE_NORME = /^\d{8}$/

  const fichierComplet = () => genererFec(
    [
      ligne('p1', { montant: 1234567.8 }),
      ligne('p1', { compte: COMPTE_BANQUE, sens: 'credit', montant: 1234567.8, ligne_bancaire_id: 'l1' }),
      ligne('p2', { montant: 0.05, date: '2026-04-01' }),
      ligne('p2', { compte: COMPTE_BANQUE, sens: 'credit', montant: 0.05, date: '2026-04-01' }),
    ],
    [piece('p1'), piece('p2', { date_piece: '2026-04-01' })],
    [],
    [{
      id: 'an-1', dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '512000', libelle: 'Banque',
      sens: 'debit', montant: 25000.1, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2026-09-26T10:00:00Z',
    }],
    'tresorerie', [], SANS_LETTRAGE,
  )

  it('écrit les montants avec une virgule décimale et sans séparateur de milliers', () => {
    const lignes = colonnes(fichierComplet()).slice(1)
    expect(lignes).toHaveLength(5)
    for (const l of lignes) {
      expect(l[11]).toMatch(MONTANT_NORME)
      expect(l[12]).toMatch(MONTANT_NORME)
    }
    expect(lignes.map((l) => [l[11], l[12]])).toEqual([
      ['25000,10', '0,00'],
      ['1234567,80', '0,00'],
      ['0,00', '1234567,80'],
      ['0,05', '0,00'],
      ['0,00', '0,05'],
    ])
  })

  it('met le signe d’un montant négatif en tête', () => {
    // Défensif : la génération écrit des valeurs absolues et porte le signe dans le sens. Mais un
    // montant négatif qui arriverait jusqu'ici doit rester lisible selon la norme, pas « 12,50- ».
    const l = colonnes(genererFec([ligne('p1', { montant: -12.5 })], [piece('p1')], [], [], 'tresorerie', [], SANS_LETTRAGE))[1]
    expect(l[11]).toBe('-12,50')
  })

  it('porte les noms des champs en première ligne, sépare par des tabulations et termine chaque ligne par CRLF', () => {
    const fec = fichierComplet()
    expect(fec.split('\r\n')[0]).toBe([
      'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib',
      'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit',
      'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
    ].join('\t'))
    expect(fec.replaceAll('\r\n', '')).not.toContain('\n')
    expect(fec.replaceAll('\r\n', '')).not.toContain('\r')
  })

  it('écrit les dates sur huit chiffres, sans séparateur', () => {
    for (const l of colonnes(fichierComplet()).slice(1)) {
      expect(l[3]).toMatch(DATE_NORME) // EcritureDate
      expect(l[9]).toMatch(DATE_NORME) // PieceDate
      expect(l[15]).toMatch(DATE_NORME) // ValidDate
    }
  })
})

describe('genererFec — numérotation et dates', () => {
  it('numérote chaque journal dans l’ordre chronologique', () => {
    // Un EcritureNum non croissant dans un même journal fait rejeter le fichier à l'import.
    const fec = genererFec(
      [ligne('tard', { date: '2026-06-01' }), ligne('tot', { date: '2026-01-15' }), ligne('vente', { date: '2026-03-01' })],
      [
        piece('tard', { date_piece: '2026-06-01' }),
        piece('tot', { date_piece: '2026-01-15' }),
        piece('vente', { date_piece: '2026-03-01', type_piece: 'vente' }),
      ],
      [],
      [],
      'tresorerie', [], SANS_LETTRAGE,
    )
    const rows = colonnes(fec).slice(1)
    expect(rows.map((r) => [r[0], r[2]])).toEqual([
      ['AC', 'AC00001'], // 15/01
      ['VE', 'VE00001'], // 01/03 — compteur propre au journal des ventes
      ['AC', 'AC00002'], // 01/06
    ])
  })

  it('numérote dans l’ordre des dates d’ÉCRITURE — celles du paiement — et non des factures', () => {
    // Une facture de janvier payée en mars, une de février payée le 5 février : les écritures sont
    // datées au paiement (lib/rattachement.ts), et c'est leur ordre qui fait la numérotation. Trier
    // sur PieceDate numéroterait mars avant février.
    const fec = genererFec(
      [
        ligne('janvier', { date: '2026-03-01' }), ligne('janvier', { compte: COMPTE_BANQUE, date: '2026-03-01', sens: 'credit' }),
        ligne('fevrier', { date: '2026-02-05' }), ligne('fevrier', { compte: COMPTE_BANQUE, date: '2026-02-05', sens: 'credit' }),
      ],
      [piece('janvier', { date_piece: '2026-01-10' }), piece('fevrier', { date_piece: '2026-02-01' })],
      [],
      [],
      'tresorerie', [], SANS_LETTRAGE,
    )
    const rows = colonnes(fec).slice(1)
    expect(rows.map((r) => [r[2], r[3], r[9]])).toEqual([
      ['AC00001', '20260205', '20260201'],
      ['AC00001', '20260205', '20260201'],
      ['AC00002', '20260301', '20260110'],
      ['AC00002', '20260301', '20260110'],
    ])
  })

  it('date la pièce par le justificatif, pas par la contrepartie banque', () => {
    // La ligne banque porte la date de paiement ; PieceDate doit rester celle de la facture,
    // quel que soit l'ordre dans lequel les lignes remontent de la base.
    const lignes = [
      ligne('p1', { compte: COMPTE_BANQUE, date: '2026-04-20', sens: 'credit' }),
      ligne('p1', { date: '2026-03-10' }),
    ]
    const rows = colonnes(genererFec(lignes, [piece('p1', { date_piece: '2026-03-10' })], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.every((r) => r[9] === '20260310')).toBe(true)
    // Une écriture ne porte qu'une date : la charge à la date de la facture et la banque à celle du paiement — un
    // brouillon d'avant la datation au paiement, que le contrôle des écritures déclare à régénérer — font deux écritures.
    expect(rows.map((r) => [r[2], r[3]])).toEqual([['AC00001', '20260310'], ['AC00002', '20260420']])
  })

  it('produit deux fois le même fichier pour les mêmes données', () => {
    const lignes = [ligne('b'), ligne('a')]
    const pieces = [piece('a', { date_piece: '2026-02-01' }), piece('b', { date_piece: '2026-02-01' })]
    expect(genererFec(lignes, pieces, [], [], 'tresorerie', [], SANS_LETTRAGE)).toBe(genererFec([...lignes].reverse(), pieces, [], [], 'tresorerie', [], SANS_LETTRAGE))
  })

  it('ignore les écritures sans pièce rattachée', () => {
    const orpheline = { ...ligne('p1'), piece_id: null } as EcritureBrouillon
    expect(colonnes(genererFec([orpheline], [piece('p1')], [], [], 'tresorerie', [], SANS_LETTRAGE))).toHaveLength(1) // en-tête seul
  })
})

// UNE ÉCRITURE NE PORTE QU'UNE DATE (05/10/2026). En trésorerie, une pièce payée en plusieurs fois a une part par
// paiement, chacune à sa date : sous un seul numéro, elle faisait une écriture à plusieurs dates, que l'outil de la DGFiP
// range parmi ses anomalies. Les brouillons ci-dessous sont ceux que la génération écrit (`lignesPourPiece`).
describe('genererFec — une écriture ne porte qu’une date (l’outil de la DGFiP)', () => {
  const TRESORERIE = { mode: 'tresorerie' as const, compteNotesDeFrais: '455000' as const }
  const ENGAGEMENT = { mode: 'engagement' as const, compteNotesDeFrais: '455000' as const }
  const paiement = (id: string, date: string, montant: number) => ({ id, date, montant, origine: 'rapprochement' as const })
  const enBase = (prefixe: string) => (l: LigneAGenerer, i: number): EcritureBrouillon =>
    ligne(l.piece_id!, { ...l, id: `${prefixe}${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null })
  const debitMoinsCredit = (r: string[]) => Math.round((lireMontant(r[11]) - lireMontant(r[12])) * 100) / 100

  it('fait d’une pièce payée en deux fois deux écritures, une par paiement, chacune équilibrée', () => {
    const p = piece('p1', { montant_ttc: 100, date_piece: '2026-02-20', nom_fichier: 'facture.pdf' })
    const brouillon = lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, false,
      [paiement('l1', '2026-03-05', -60), paiement('l2', '2026-04-05', -40)], TRESORERIE).map(enBase('a'))
    const fec = genererFec(brouillon, [p], [], [], 'tresorerie', [], SANS_LETTRAGE)
    const rows = colonnes(fec).slice(1)
    expect(rows.map((r) => [r[2], r[3], r[4], debitMoinsCredit(r)])).toEqual([
      ['AC00001', '20260305', '606100', 60], ['AC00001', '20260305', COMPTE_BANQUE, -60],
      ['AC00002', '20260405', '606100', 40], ['AC00002', '20260405', COMPTE_BANQUE, -40],
    ])
    // La pièce reste la même : sa référence et sa date, sur les deux écritures.
    expect(new Set(rows.map((r) => `${r[8]}|${r[9]}`))).toEqual(new Set(['facture.pdf|20260220']))
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
    expect(defautsDeNumerotation(numeroterFec(brouillon, [p], [], [], 'tresorerie', []))).toEqual([])
  })

  it('garde la TVA d’une date avec sa charge : chaque écriture s’équilibre face à son paiement', () => {
    const p = piece('p2', { montant_ttc: 120, montant_ht: 100, montant_tva: 20, date_piece: '2026-02-20' })
    const brouillon = lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, true,
      [paiement('l1', '2026-03-05', -60), paiement('l2', '2026-04-05', -60)], TRESORERIE).map(enBase('t'))
    const fec = genererFec(brouillon, [p], [], [], 'tresorerie', [], SANS_LETTRAGE)
    expect(colonnes(fec).slice(1).map((r) => [r[2], r[4], debitMoinsCredit(r)])).toEqual([
      ['AC00001', '445660', 10], ['AC00001', '606100', 50], ['AC00001', COMPTE_BANQUE, -60],
      ['AC00002', '445660', 10], ['AC00002', '606100', 50], ['AC00002', COMPTE_BANQUE, -60],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
  })

  it('sépare la note de frais remboursée en partie : le reste face au 108000 à sa date, le virement à la sienne', () => {
    const note = piece('note', { type_piece: 'note_frais', montant_ttc: 42.5, date_piece: '2026-03-10', nom_fichier: 'ticket.jpg' })
    const brouillon = lignesPourPiece('d1', note, { compte: '625700', immobilisation: false }, false,
      [paiement('l1', '2026-03-20', -20)], TRESORERIE).map(enBase('n'))
    const fec = genererFec(brouillon, [note], [], [], 'tresorerie', [], SANS_LETTRAGE)
    expect(colonnes(fec).slice(1).map((r) => [r[2], r[3], r[4], debitMoinsCredit(r)])).toEqual([
      ['AC00001', '20260310', '625700', 22.5], ['AC00001', '20260310', '108000', -22.5],
      ['AC00002', '20260320', '625700', 20], ['AC00002', '20260320', COMPTE_BANQUE, -20],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
  })

  it('garde ensemble deux paiements du même jour', () => {
    const p = piece('p3', { montant_ttc: 100, date_piece: '2026-02-20' })
    const brouillon = lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, false,
      [paiement('l1', '2026-03-05', -70), paiement('l2', '2026-03-05', -30)], TRESORERIE).map(enBase('m'))
    const rows = colonnes(genererFec(brouillon, [p], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(new Set(rows.map((r) => r[2]))).toEqual(new Set(['AC00001']))
  })

  // En engagement, la facture à sa date et chaque règlement à la sienne : rien ne change, et le règlement reste au
  // journal de banque — la clé porte la date, le journal se lit toujours au règlement.
  it('laisse l’engagement tel qu’il était : la facture au journal des achats, chaque règlement au journal de banque', () => {
    const p = piece('p4', { montant_ttc: 100, date_piece: '2026-02-20', tiers: 'Transmedical' })
    const brouillon = lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, false,
      [paiement('l1', '2026-03-05', -60), paiement('l2', '2026-04-05', -40)], ENGAGEMENT).map(enBase('g'))
    const fec = genererFec(brouillon, [p], [], [], 'engagement', [], SANS_LETTRAGE)
    expect(colonnes(fec).slice(1).map((r) => [r[2], r[3], r[4]])).toEqual([
      ['AC00001', '20260220', '606100'], ['AC00001', '20260220', '401000'],
      ['BQ00001', '20260305', '401000'], ['BQ00001', '20260305', COMPTE_BANQUE],
      ['BQ00002', '20260405', '401000'], ['BQ00002', '20260405', COMPTE_BANQUE],
    ])
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual([])
  })

  // L'ORDRE DE RETOUR DE LA REQUÊTE NE DÉCIDE DE RIEN. En trésorerie, une écriture de pièce mêle sa charge et la
  // banque de son paiement ; si la ligne de banque remonte la première, elle ne fait pas pour autant de la pièce un
  // règlement au journal de banque — seul un règlement d'ENGAGEMENT y va, et toutes ses lignes désignent leur mouvement.
  it('rend le même fichier quel que soit l’ordre des lignes, la banque remontée la première comprise', () => {
    const p = piece('p6', { montant_ttc: 100, date_piece: '2026-02-20', tiers: 'Transmedical' })
    const paiements = [paiement('l1', '2026-03-05', -60), paiement('l2', '2026-04-05', -40)]
    for (const modele of [TRESORERIE, ENGAGEMENT]) {
      const brouillon = lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, false, paiements, modele)
        .map(enBase('o'))
      const fec = genererFec(brouillon, [p], [], [], modele.mode, [], SANS_LETTRAGE)
      expect(genererFec([...brouillon].reverse(), [p], [], [], modele.mode, [], SANS_LETTRAGE)).toBe(fec)
      if (modele.mode === 'tresorerie') expect(new Set(colonnes(fec).slice(1).map((r) => r[0]))).toEqual(new Set(['AC']))
    }
  })

  // DÉFENSIF, annoncé comme tel : aucune génération n'écrit une facture d'engagement sur deux dates. Mais la clé porte
  // la date dans les deux modèles, pour qu'aucune écriture du fichier n'en porte deux quel que soit le brouillon — un
  // brouillon défectueux fait deux écritures déséquilibrées, que la validation refuse, jamais une écriture à deux dates.
  it('ne fait jamais d’écriture à deux dates, même d’un brouillon d’engagement défectueux', () => {
    const p = piece('p7', { montant_ttc: 100, date_piece: '2026-02-20', tiers: 'Transmedical' })
    const brouillon = [
      ligne('p7', { id: 'f1', compte: '606100', sens: 'debit', montant: 100, date: '2026-02-20' }),
      ligne('p7', { id: 'f2', compte: '401000', sens: 'credit', montant: 100, date: '2026-02-21' }),
    ]
    const fec = genererFec(brouillon, [p], [], [], 'engagement', [], SANS_LETTRAGE)
    expect(anomaliesDgfip(fec)).toEqual([])
    expect(desequilibresDgfip(fec)).toEqual(['AC00001', 'AC00002'])
    expect(defautsDeNumerotation(numeroterFec(brouillon, [p], [], [], 'engagement', [])).map((d) => d.type))
      .toEqual(['desequilibre', 'desequilibre'])
  })

  // Le garde de l'outil lui-même : sans lui, « aucune anomalie » serait aussi ce que rendrait un contrôle aveugle.
  it('voit l’écriture à deux dates qu’un seul numéro ferait', () => {
    const fec = genererFec([ligne('p1', { date: '2026-03-05' }), ligne('p1', { id: 'b', compte: COMPTE_BANQUE, sens: 'credit', date: '2026-03-05' })],
      [piece('p1')], [], [], 'tresorerie', [], SANS_LETTRAGE)
    expect(anomaliesDgfip(fec)).toEqual([])
    const aDeuxDates = colonnes(fec).map((r) => (r[4] === COMPTE_BANQUE ? [...r.slice(0, 3), '20260306', ...r.slice(4)] : r))
      .map((r) => r.join('\t')).join('\r\n')
    expect(aDeuxDates).not.toBe(fec)
    expect(anomaliesDgfip(aDeuxDates)).toEqual(['AC00001 : différentes dates comptables'])
  })
})

describe('genererFec — les à-nouveaux ouvrent le fichier', () => {
  const aNouveau = (o: Partial<ANouveau>): ANouveau => ({
    id: 'an-1', dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '51210000',
    libelle: 'Banque Populaire', sens: 'debit', montant: 6000, source_nom: 'balance-2025.csv',
    source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2026-09-26T10:00:00Z', ...o,
  })
  // Données HORS de l'ordre des comptes, comme la base peut les rendre : sans cela, le test du tri
  // passerait sur un tri absent.
  const ouverture = [
    aNouveau({}),
    aNouveau({ id: 'an-2', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit', montant: 6000 }),
  ]

  it('les place en tête, en une seule écriture du journal AN, triées par compte', () => {
    const rows = colonnes(genererFec([ligne('p1')], [piece('p1')], [], ouverture, 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4]])).toEqual([
      ['AN', 'À-nouveaux', 'AN00001', '20260101', '108'],
      ['AN', 'À-nouveaux', 'AN00001', '20260101', '512000'],
      ['AC', 'Achats', 'AC00001', '20260310', '606100'],
    ])
  })

  it('garde le libellé de l’application pour la banque, et la balance d’origine dans le libellé d’écriture', () => {
    // Un même CompteNum ne porte qu'un CompteLib dans tout le fichier : les mouvements de la banque
    // l'appellent « Banque », son ouverture aussi.
    const banque = colonnes(genererFec([], [], [], ouverture, 'tresorerie', [], SANS_LETTRAGE)).find((r) => r[4] === '512000')!
    expect(banque[5]).toBe('Banque')
    expect(banque[10]).toBe('À-nouveau 51210000 Banque Populaire')
    expect(banque[8]).toBe('balance-2025.csv')
    expect([banque[11], banque[12]]).toEqual(['6000,00', '0,00'])
    const exploitant = colonnes(genererFec([], [], [], ouverture, 'tresorerie', [], SANS_LETTRAGE)).find((r) => r[4] === '108')!
    expect([exploitant[5], exploitant[10], exploitant[11], exploitant[12]])
      .toEqual(['Compte de l’exploitant', 'À-nouveau Compte de l’exploitant', '0,00', '6000,00'])
  })

  it('s’exporte même sans aucune écriture : l’ouverture d’un exercice qui commence', () => {
    const rows = colonnes(genererFec([], [], [], ouverture, 'tresorerie', [], SANS_LETTRAGE))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.length === 18)).toBe(true)
  })

  it('neutralise un nom de balance piégé comme tout autre champ', () => {
    const rows = colonnes(genererFec([], [], [], [aNouveau({ source_nom: 'balance\t2025.csv' })], 'tresorerie', [], SANS_LETTRAGE))
    expect(rows[1]).toHaveLength(18)
    expect(rows[1][8]).toBe('balance 2025.csv')
  })
})

describe('libelleCompte et nomFichierFec', () => {
  it('donne la priorité aux comptes fixes, puis à la catégorie, puis au numéro', () => {
    const categories = [{ compte_comptable: '606100', libelle: 'Achats fournisseurs' } as Categorie]
    expect(libelleCompte(COMPTE_BANQUE, categories)).toBe('Banque')
    expect(libelleCompte('606100', categories)).toBe('Achats fournisseurs')
    expect(libelleCompte('999999', categories)).toBe('999999')
  })

  it('bâtit le nom imposé par le format à partir du SIREN', () => {
    expect(nomFichierFec('123 456 789 00012', 2026)).toBe('123456789FEC20261231.txt')
    // Sans SIRET, un repère visible plutôt qu'un fichier qui a l'air valide sans l'être.
    expect(nomFichierFec(null, 2026)).toBe('A_COMPLETERFEC20261231.txt')
  })
})

// ═══ Engagement (lib/engagement.ts) ═══════════════════════════════════════════════════════════════
describe('genererFec — en engagement', () => {
  // Une facture d'achat du 10/03 réglée le 05/04, et une vente du 15/03 encaissée le 20/03, telles que
  // la génération les écrit.
  const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120 })
  const vente = piece('vente', { tiers: 'CPAM', type_piece: 'vente', date_piece: '2026-03-15', montant_ttc: 50 })
  const brouillon = [
    ligne('achat', { id: 'a1', compte: '606100', sens: 'debit', montant: 120 }),
    ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
    ligne('achat', { id: 'a3', compte: '401000', sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('achat', { id: 'a4', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('vente', { id: 'v1', compte: '706000', sens: 'credit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v2', compte: '411000', sens: 'debit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v3', compte: '411000', sens: 'credit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('vente', { id: 'v4', compte: COMPTE_BANQUE, sens: 'debit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
  ]
  const rows = () => colonnes(genererFec(brouillon, [achat, vente], [], [], 'engagement', [], SANS_LETTRAGE)).slice(1)

  it('range la facture au journal de sa nature et chaque règlement au journal de banque, sous son propre numéro', () => {
    expect(rows().map((r) => [r[0], r[2], r[3], r[4]])).toEqual([
      ['AC', 'AC00001', '20260310', '606100'],
      ['AC', 'AC00001', '20260310', '401000'],
      ['VE', 'VE00001', '20260315', '411000'],
      ['VE', 'VE00001', '20260315', '706000'],
      ['BQ', 'BQ00001', '20260320', COMPTE_BANQUE],
      ['BQ', 'BQ00001', '20260320', '411000'],
      ['BQ', 'BQ00002', '20260405', '401000'],
      ['BQ', 'BQ00002', '20260405', COMPTE_BANQUE],
    ])
  })

  it('équilibre chaque écriture du fichier, une par une', () => {
    const parNumero = new Map<string, number>()
    for (const r of rows()) parNumero.set(r[2], (parNumero.get(r[2]) ?? 0) + lireMontant(r[11]) - lireMontant(r[12]))
    expect([...parNumero.values()].every((s) => Math.abs(s) < 0.005)).toBe(true)
  })

  it('porte le compte auxiliaire du tiers sur les lignes de 401 et de 411, et sur elles seules', () => {
    expect(rows().map((r) => [r[4], r[6], r[7]])).toEqual([
      ['606100', '', ''],
      ['401000', 'FTRANSMEDICAL', 'Transmedical'],
      ['411000', 'CCPAM', 'CPAM'],
      ['706000', '', ''],
      [COMPTE_BANQUE, '', ''],
      ['411000', 'CCPAM', 'CPAM'],
      ['401000', 'FTRANSMEDICAL', 'Transmedical'],
      [COMPTE_BANQUE, '', ''],
    ])
    expect(rows().find((r) => r[4] === '401000')![5]).toBe('Fournisseurs')
  })

  it('donne un seul libellé à un compte auxiliaire, le premier rencontré', () => {
    const autre = piece('autre', { tiers: 'TRANSMEDICAL / et redevient', date_piece: '2026-06-01' })
    const fec = genererFec(
      [...brouillon, ligne('autre', { id: 'x1', compte: '401000', sens: 'credit', date: '2026-06-01' })],
      [achat, vente, autre], [], [], 'engagement', [], SANS_LETTRAGE,
    )
    const libelles = new Set(colonnes(fec).slice(1).filter((r) => r[6] === 'FTRANSMEDICAL').map((r) => r[7]))
    expect(libelles).toEqual(new Set(['Transmedical']))
  })

  // Le PREMIER RENCONTRÉ DANS L'ORDRE DU FICHIER, pas dans celui de la numérotation : un règlement écrit sans sa
  // facture et la facture d'une autre pièce du même fournisseur, le même jour, se numérotent dans l'ordre de leurs
  // clés mais s'impriment journal des achats d'abord. Le libellé figé à la validation doit être celui qu'on lit.
  it('prend le libellé d’un compte auxiliaire dans l’ordre du fichier', () => {
    const reglee = piece('aa', { tiers: 'Transmedical', date_piece: '2026-05-02', montant_ttc: 80 })
    const facturee = piece('zz', { tiers: 'TRANSMEDICAL SARL', date_piece: '2026-05-02', montant_ttc: 90 })
    const rows = colonnes(genererFec([
      ligne('aa', { id: 'r1', compte: '401000', sens: 'debit', montant: 80, date: '2026-05-02', ligne_bancaire_id: 'l-aa' }),
      ligne('aa', { id: 'r2', compte: COMPTE_BANQUE, sens: 'credit', montant: 80, date: '2026-05-02', ligne_bancaire_id: 'l-aa' }),
      ligne('zz', { id: 'f1', compte: '606100', montant: 90, date: '2026-05-02' }),
      ligne('zz', { id: 'f2', compte: '401000', sens: 'credit', montant: 90, date: '2026-05-02' }),
    ], [reglee, facturee], [], [], 'engagement', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => r[0])).toEqual(['AC', 'AC', 'BQ', 'BQ'])
    expect(rows.filter((r) => r[6] === 'FTRANSMEDICAL').map((r) => r[7])).toEqual(['TRANSMEDICAL SARL', 'TRANSMEDICAL SARL'])
  })

  it('garde une pièce en une seule écriture en trésorerie, contrepartie banque comprise', () => {
    const tresorerie = [
      ligne('achat', { id: 't1', compte: '606100', date: '2026-04-05' }),
      ligne('achat', { id: 't2', compte: COMPTE_BANQUE, sens: 'credit', date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ]
    const r = colonnes(genererFec(tresorerie, [achat], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(r.map((x) => [x[0], x[2]])).toEqual([['AC', 'AC00001'], ['AC', 'AC00001']])
  })
})

// LE LETTRAGE (ligne 32, lib/lettrage.ts) : « le repère utilisé dans le système comptable pour apparier deux écritures
// (règlement-facture) » et « la date à laquelle l'opération de lettrage a été validée » (BOI-CF-IOR-60-40-20, § 240).
// Les fichiers ci-dessous le calculent comme l'écran : sur TOUT le brouillon, pas sur l'exercice exporté.
describe('genererFec — le lettrage des comptes de tiers', () => {
  const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120 })
  const vente = piece('vente', { tiers: 'CPAM', type_piece: 'vente', date_piece: '2026-03-15', montant_ttc: 50 })
  const partielle = piece('partielle', { tiers: 'Bureau Vallée', montant_ttc: 200, date_piece: '2026-03-12' })
  const brouillon = [
    ligne('achat', { id: 'a1', compte: '606100', sens: 'debit', montant: 120 }),
    ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
    ligne('achat', { id: 'a3', compte: '401000', sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat', created_at: '2026-04-20T08:00:00Z' }),
    ligne('achat', { id: 'a4', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat', created_at: '2026-04-20T08:00:00Z' }),
    ligne('vente', { id: 'v1', compte: '706000', sens: 'credit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v2', compte: '411000', sens: 'debit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v3', compte: '411000', sens: 'credit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('vente', { id: 'v4', compte: COMPTE_BANQUE, sens: 'debit', montant: 50, date: '2026-03-20', ligne_bancaire_id: 'l-vente' }),
    ligne('partielle', { id: 'p1', compte: '606100', sens: 'debit', montant: 200, date: '2026-03-12' }),
    ligne('partielle', { id: 'p2', compte: '401000', sens: 'credit', montant: 200, date: '2026-03-12' }),
    ligne('partielle', { id: 'p3', compte: '401000', sens: 'debit', montant: 150, date: '2026-03-25', ligne_bancaire_id: 'l-partielle' }),
    ligne('partielle', { id: 'p4', compte: COMPTE_BANQUE, sens: 'credit', montant: 150, date: '2026-03-25', ligne_bancaire_id: 'l-partielle' }),
  ]
  const fec = () => genererFec(brouillon, [achat, vente, partielle], [], [], 'engagement', [], lettrages(brouillon, 'engagement'))
  const lettrees = () => colonnes(fec()).slice(1).filter((r) => r[13] !== '').map((r) => [r[2], r[4], r[13], r[14]])

  it('porte le code et la date sur les lignes de tiers d’une facture soldée, et sur elles seules', () => {
    expect(lettrees()).toEqual([
      ['AC00001', '401000', 'A', '20260420'],
      ['VE00001', '411000', 'A', '20260320'],
      ['BQ00001', '411000', 'A', '20260320'],
      ['BQ00003', '401000', 'A', '20260420'],
    ])
    // La banque, la charge et le produit restent à blanc, comme la norme le prévoit pour une ligne non lettrée.
    for (const r of colonnes(fec()).slice(1).filter((x) => !['401000', '411000'].includes(x[4]))) expect([r[13], r[14]]).toEqual(['', ''])
  })

  it('laisse à blanc une facture payée en partie', () => {
    expect(colonnes(fec()).slice(1).filter((r) => r[11] === '200,00' || r[11] === '150,00' || r[12] === '200,00' || r[12] === '150,00')
      .map((r) => r[13])).toEqual(['', '', '', ''])
  })

  // L'outil de la DGFiP relève une écriture dont les lignes portent deux codes (« Différents lettrages »).
  it('ne porte qu’un code par écriture', () => {
    expect(anomaliesDgfip(fec())).toEqual([])
  })

  it('porte le même code dans le FEC de la facture et dans celui de son règlement, l’exercice suivant', () => {
    const decembre = piece('dec', { tiers: 'Transmedical', date_piece: '2026-12-20', montant_ttc: 80 })
    const tout = [
      ligne('dec', { id: 'd1', compte: '606100', montant: 80, date: '2026-12-20' }),
      ligne('dec', { id: 'd2', compte: '401000', sens: 'credit', montant: 80, date: '2026-12-20' }),
      ligne('dec', { id: 'd3', compte: '401000', sens: 'debit', montant: 80, date: '2027-01-08', ligne_bancaire_id: 'l-dec', created_at: '2027-01-09T08:00:00Z' }),
      ligne('dec', { id: 'd4', compte: COMPTE_BANQUE, sens: 'credit', montant: 80, date: '2027-01-08', ligne_bancaire_id: 'l-dec', created_at: '2027-01-09T08:00:00Z' }),
    ]
    const lettrage = lettrages(tout, 'engagement')
    const exercice = (annee: string) => genererFec(tout.filter((e) => e.date.startsWith(annee)), [decembre], [], [], 'engagement', [], lettrage)
    const tiers = (f: string) => colonnes(f).slice(1).filter((r) => r[4] === '401000').map((r) => [r[13], r[14]])
    expect(tiers(exercice('2026'))).toEqual([['A', '20270109']])
    expect(tiers(exercice('2027'))).toEqual([['A', '20270109']])
  })

  it('porte le lettrage dans le FEC d’un exercice validé, qui ne le fige pas', () => {
    const numerotation = numeroterFec(brouillon, [achat, vente, partielle], [], [], 'engagement', [])
    const validees = numerotation.lignes.map((l) => ({
      ...l.ecriture, statut: 'validee' as const, valide_le: '2027-01-14T23:30:00Z', journal_code: l.journal, numero_ecriture: l.numero,
      piece_ref: l.pieceRef, piece_date: l.pieceDate, compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    }))
    const relu = formaterFec(numerotationValidee(validees, [], '2027-01-14T23:30:00Z'), lettrages(validees, 'engagement'))
    expect(colonnes(relu).slice(1).filter((r) => r[13] !== '').map((r) => [r[2], r[13], r[14]])).toEqual(lettrees().map((r) => [r[0], r[2], r[3]]))
  })

  it('ne lettre rien en trésorerie', () => {
    expect(colonnes(genererFec(brouillon, [achat, vente, partielle], [], [], 'tresorerie', [], lettrages(brouillon, 'tresorerie')))
      .slice(1).every((r) => r[13] === '' && r[14] === '')).toBe(true)
  })
})

// L'ÉCRITURE D'ACQUISITION (ligne 26.6, étape b) : la facture d'un bien entre au FEC sur le compte du bien, au
// journal des achats, sa TVA au 445620 ; en engagement, sa dette au 404000, avec son auxiliaire propre.
describe('genererFec — l’acquisition d’un bien immobilisé', () => {
  const facture = piece('bien', { tiers: 'Transmedical', nom_fichier: 'fauteuil.pdf', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 })

  it('porte la facture d’un bien au journal des achats, sur le compte du bien, face à la banque en trésorerie', () => {
    const brouillon = [
      ligne('bien', { id: 'b1', compte: '215400', montant: 1000, date: '2026-04-05' }),
      ligne('bien', { id: 'b2', compte: '445620', montant: 200, date: '2026-04-05' }),
      ligne('bien', { id: 'b3', compte: COMPTE_BANQUE, sens: 'credit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ]
    const r = colonnes(genererFec(brouillon, [facture], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(r.map((x) => [x[0], x[2], x[4], x[5], x[8], x[11], x[12]])).toEqual([
      ['AC', 'AC00001', '215400', 'Matériel industriel', 'fauteuil.pdf', '1000,00', '0,00'],
      ['AC', 'AC00001', '445620', 'TVA déductible sur immobilisations', 'fauteuil.pdf', '200,00', '0,00'],
      ['AC', 'AC00001', COMPTE_BANQUE, 'Banque', 'fauteuil.pdf', '0,00', '1200,00'],
    ])
  })

  it('en engagement, doit la facture au 404 avec un auxiliaire FI, distinct de celui du 401 du même fournisseur', () => {
    const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120 })
    const brouillon = [
      ligne('achat', { id: 'a1', compte: '606100', montant: 120 }),
      ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
      ligne('bien', { id: 'b1', compte: '215400', montant: 1000 }),
      ligne('bien', { id: 'b2', compte: '445620', montant: 200 }),
      ligne('bien', { id: 'b3', compte: '404000', sens: 'credit', montant: 1200 }),
      ligne('bien', { id: 'b4', compte: '404000', sens: 'debit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
      ligne('bien', { id: 'b5', compte: COMPTE_BANQUE, sens: 'credit', montant: 1200, date: '2026-04-05', ligne_bancaire_id: 'l-bien' }),
    ]
    const r = colonnes(genererFec(brouillon, [achat, facture], [], [], 'engagement', [], SANS_LETTRAGE)).slice(1)
    expect(r.filter((x) => x[4] === '404000').map((x) => [x[0], x[5], x[6], x[7]])).toEqual([
      ['AC', "Fournisseurs d'immobilisations", 'FITRANSMEDICAL', 'Transmedical'],
      ['BQ', "Fournisseurs d'immobilisations", 'FITRANSMEDICAL', 'Transmedical'],
    ])
    expect(r.find((x) => x[4] === '401000')![6]).toBe('FTRANSMEDICAL')
  })
})

describe('genererFec — les mouvements du relevé affectés sans justificatif', () => {
  // Ligne 26.6 : un encaissement de l'Assurance maladie rangé en recettes, des frais bancaires. Ils
  // n'ont pas de pièce ; leur justificatif est le relevé qui les porte.
  const mouvement = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
    id, dossier_id: 'd1', date: '2026-03-12', libelle: 'VIR CPAM', montant: 250, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'c-recettes', taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    source_fichier: 'releve-mars-2026.pdf', libelle_brut: null, created_at: '2026-03-13T00:00:00Z', ...o,
  })
  const cpam = mouvement('l-cpam')
  const frais = mouvement('l-frais', { date: '2026-02-28', montant: -8.5, libelle: 'FRAIS TENUE', categorie_id: 'c-frais', source_fichier: null })
  const brouillon = [
    ligne('', { id: 'm1', piece_id: null, ligne_bancaire_id: 'l-cpam', compte: '706000', sens: 'credit', montant: 250, date: '2026-03-12', libelle: 'VIR CPAM' }),
    ligne('', { id: 'm2', piece_id: null, ligne_bancaire_id: 'l-cpam', compte: COMPTE_BANQUE, sens: 'debit', montant: 250, date: '2026-03-12', libelle: 'VIR CPAM' }),
    ligne('', { id: 'm3', piece_id: null, ligne_bancaire_id: 'l-frais', compte: '627000', sens: 'debit', montant: 8.5, date: '2026-02-28', libelle: 'FRAIS TENUE' }),
    ligne('', { id: 'm4', piece_id: null, ligne_bancaire_id: 'l-frais', compte: COMPTE_BANQUE, sens: 'credit', montant: 8.5, date: '2026-02-28', libelle: 'FRAIS TENUE' }),
  ]

  it('les porte au journal de banque, un numéro par mouvement, le relevé pour pièce', () => {
    const rows = colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [cpam, frais], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[8], r[9]])).toEqual([
      ['BQ', 'Banque', 'BQ00001', '20260228', '627000', 'Relevé bancaire', '20260228'],
      ['BQ', 'Banque', 'BQ00001', '20260228', COMPTE_BANQUE, 'Relevé bancaire', '20260228'],
      ['BQ', 'Banque', 'BQ00002', '20260312', COMPTE_BANQUE, 'releve-mars-2026.pdf', '20260312'],
      ['BQ', 'Banque', 'BQ00002', '20260312', '706000', 'releve-mars-2026.pdf', '20260312'],
    ])
    // Aucun compte auxiliaire : l'écriture va de la catégorie à la banque, sans tiers.
    expect(rows.every((r) => r[6] === '' && r[7] === '')).toBe(true)
  })

  it('les numérote avec les règlements d’une pièce, dans l’ordre des dates du journal de banque', () => {
    const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120 })
    const reglement = [
      ligne('achat', { id: 'a1', compte: '606100', montant: 120 }),
      ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
      ligne('achat', { id: 'a3', compte: '401000', montant: 120, date: '2026-03-05', ligne_bancaire_id: 'l-achat' }),
      ligne('achat', { id: 'a4', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-03-05', ligne_bancaire_id: 'l-achat' }),
    ]
    const rows = colonnes(genererFec([...brouillon, ...reglement], [achat], [], [], 'engagement', [cpam, frais], SANS_LETTRAGE)).slice(1)
    expect([...new Set(rows.filter((r) => r[0] === 'BQ').map((r) => `${r[2]} ${r[3]}`))])
      .toEqual(['BQ00001 20260228', 'BQ00002 20260305', 'BQ00003 20260312'])
  })

  it('laisse dehors l’écriture sans pièce d’un mouvement qui n’est plus affecté', () => {
    // Le reste d'une pièce supprimée, ou d'une affectation défaite hors de l'application : sans
    // justificatif, elle ne va pas dans le fichier fiscal — `absenceFec` la chiffre à l'écran.
    const remis = { ...cpam, statut: 'non_rapprochee' as const, categorie_id: null }
    const rows = colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [remis, frais], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => r[4])).toEqual(['627000', COMPTE_BANQUE])
  })

  it('porte de même un virement personnel, sur le compte du dirigeant', () => {
    // Le prélèvement de l'exploitant, classé en virement personnel : il s'écrit sur son compte, face à
    // la banque, et le relevé est sa pièce (lib/virementPersonnel.ts).
    const prelevement = mouvement('l-perso', {
      date: '2026-03-20', montant: -500, libelle: 'VIR PERSO', statut: 'ignoree', categorie_id: null, prelevement_personnel: true,
    })
    const ecritures = [
      ligne('', { id: 'v1', piece_id: null, ligne_bancaire_id: 'l-perso', compte: '108000', sens: 'debit', montant: 500, date: '2026-03-20', libelle: 'VIR PERSO' }),
      ligne('', { id: 'v2', piece_id: null, ligne_bancaire_id: 'l-perso', compte: COMPTE_BANQUE, sens: 'credit', montant: 500, date: '2026-03-20', libelle: 'VIR PERSO' }),
    ]
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [prelevement], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[5], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '20260320', '108000', "Compte de l'exploitant", 'releve-mars-2026.pdf', '500,00', '0,00'],
      ['BQ', 'BQ00001', '20260320', COMPTE_BANQUE, 'Banque', 'releve-mars-2026.pdf', '0,00', '500,00'],
    ])
    // Le garde symétrique : remis à traiter, le même mouvement n'est plus justifié par le relevé.
    const remis = { ...prelevement, statut: 'non_rapprochee' as const, prelevement_personnel: false }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [remis], SANS_LETTRAGE)).slice(1)).toEqual([])
  })

  it('porte de même une échéance d’emprunt, le capital, les intérêts et l’assurance face à la banque', () => {
    // Le prélèvement d'un prêt rapproché de son échéance (lib/echeanceEmprunt.ts) : quatre lignes, une
    // écriture, le relevé pour pièce — et chaque compte nommé, sans quoi le FEC les donnerait par leur
    // seul numéro.
    const pret = mouvement('l-pret', {
      date: '2026-03-06', montant: -540, libelle: 'ECHEANCE PRET', categorie_id: null,
      emprunt_id: 'emp1', emprunt_echeance: 2, emprunt_interets: 36, emprunt_assurance: 21.03,
    })
    const ecritures = [
      ligne('', { id: 'p1', piece_id: null, ligne_bancaire_id: 'l-pret', compte: '164000', sens: 'debit', montant: 482.97, date: '2026-03-06', libelle: 'ECHEANCE PRET' }),
      ligne('', { id: 'p2', piece_id: null, ligne_bancaire_id: 'l-pret', compte: '661100', sens: 'debit', montant: 36, date: '2026-03-06', libelle: 'ECHEANCE PRET' }),
      ligne('', { id: 'p3', piece_id: null, ligne_bancaire_id: 'l-pret', compte: '616800', sens: 'debit', montant: 21.03, date: '2026-03-06', libelle: 'ECHEANCE PRET' }),
      ligne('', { id: 'p4', piece_id: null, ligne_bancaire_id: 'l-pret', compte: COMPTE_BANQUE, sens: 'credit', montant: 540, date: '2026-03-06', libelle: 'ECHEANCE PRET' }),
    ]
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [pret], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[4], r[5], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '164000', 'Emprunts auprès des établissements de crédit', 'releve-mars-2026.pdf', '482,97', '0,00'],
      ['BQ', 'BQ00001', '616800', 'Assurance des emprunts', 'releve-mars-2026.pdf', '21,03', '0,00'],
      ['BQ', 'BQ00001', '661100', 'Intérêts des emprunts et dettes', 'releve-mars-2026.pdf', '36,00', '0,00'],
      ['BQ', 'BQ00001', COMPTE_BANQUE, 'Banque', 'releve-mars-2026.pdf', '0,00', '540,00'],
    ])
    // Le garde symétrique : une fois le rapprochement retiré, la même écriture n'a plus de justificatif.
    const retire = { ...pret, statut: 'non_rapprochee' as const, emprunt_id: null }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [retire], SANS_LETTRAGE)).slice(1)).toEqual([])
  })

  it('porte de même une échéance de cotisation, la cotisation au 646000 et sa CSG-CRDS au 108000', () => {
    // Le prélèvement de l'Urssaf rapproché de son échéance (lib/cotisationRapprochee.ts) : une écriture,
    // le relevé pour pièce, chaque compte nommé.
    const urssaf = mouvement('l-urssaf', {
      date: '2026-03-05', montant: -500, libelle: 'PRLV URSSAF', categorie_id: null, cotisation_id: 'c1',
    })
    const ecritures = [
      ligne('', { id: 'u1', piece_id: null, ligne_bancaire_id: 'l-urssaf', compte: '646000', sens: 'debit', montant: 451.5, date: '2026-03-05', libelle: 'PRLV URSSAF' }),
      ligne('', { id: 'u2', piece_id: null, ligne_bancaire_id: 'l-urssaf', compte: '108000', sens: 'debit', montant: 48.5, date: '2026-03-05', libelle: 'PRLV URSSAF' }),
      ligne('', { id: 'u3', piece_id: null, ligne_bancaire_id: 'l-urssaf', compte: COMPTE_BANQUE, sens: 'credit', montant: 500, date: '2026-03-05', libelle: 'PRLV URSSAF' }),
    ]
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [urssaf], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[4], r[5], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '108000', "Compte de l'exploitant", 'releve-mars-2026.pdf', '48,50', '0,00'],
      ['BQ', 'BQ00001', '646000', "Cotisations sociales personnelles de l'exploitant", 'releve-mars-2026.pdf', '451,50', '0,00'],
      ['BQ', 'BQ00001', COMPTE_BANQUE, 'Banque', 'releve-mars-2026.pdf', '0,00', '500,00'],
    ])
    // Le garde symétrique : le rapprochement annulé, la même écriture n'a plus de justificatif.
    const annule = { ...urssaf, statut: 'non_rapprochee' as const, cotisation_id: null }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [annule], SANS_LETTRAGE)).slice(1)).toEqual([])
  })

  it('porte de même un mouvement ventilé, une ligne par part face à la banque', () => {
    // lib/ventilationBanque.ts : l'abonnement pris en charge à 70 %, la part personnelle sur le compte de
    // l'exploitant. Une écriture, le relevé pour pièce.
    const telephone = mouvement('l-tel', {
      date: '2026-03-15', montant: -120, libelle: 'PRLV OPERATEUR', categorie_id: null, ventilee: true, id_externe: null,
    })
    const ecritures = [
      ligne('', { id: 't1', piece_id: null, ligne_bancaire_id: 'l-tel', compte: '626000', sens: 'debit', montant: 84, date: '2026-03-15', libelle: 'PRLV OPERATEUR' }),
      ligne('', { id: 't2', piece_id: null, ligne_bancaire_id: 'l-tel', compte: '108000', sens: 'debit', montant: 36, date: '2026-03-15', libelle: 'PRLV OPERATEUR' }),
      ligne('', { id: 't3', piece_id: null, ligne_bancaire_id: 'l-tel', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-03-15', libelle: 'PRLV OPERATEUR' }),
    ]
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [telephone], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '20260315', '108000', 'releve-mars-2026.pdf', '36,00', '0,00'],
      ['BQ', 'BQ00001', '20260315', '626000', 'releve-mars-2026.pdf', '84,00', '0,00'],
      ['BQ', 'BQ00001', '20260315', COMPTE_BANQUE, 'releve-mars-2026.pdf', '0,00', '120,00'],
    ])
    // Le garde symétrique : la ventilation annulée, la même écriture n'a plus de justificatif.
    const annule = { ...telephone, statut: 'non_rapprochee' as const, ventilee: false, reglement_groupe: false, id_externe: null }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [annule], SANS_LETTRAGE)).slice(1)).toEqual([])
  })

  it('les équilibre, une écriture après l’autre', () => {
    const parNumero = new Map<string, number>()
    for (const r of colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [cpam, frais], SANS_LETTRAGE)).slice(1)) {
      parNumero.set(r[2], (parNumero.get(r[2]) ?? 0) + lireMontant(r[11]) - lireMontant(r[12]))
    }
    expect([...parNumero.values()].every((s) => Math.abs(s) < 0.005)).toBe(true)
  })
})

// UNE DOTATION AUX AMORTISSEMENTS (lib/amortissements.ts) : une écriture par bien et par exercice, au
// journal des OPÉRATIONS DIVERSES, au 31 décembre, le tableau d'amortissement pour pièce. Sans elle, le
// 681100 de la case CH n'était nulle part dans le fichier.
describe('genererFec — les dotations aux amortissements', () => {
  const dotation = (immobilisationId: string, montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] => [
    ligne('', { id: `${immobilisationId}-d`, piece_id: null, immobilisation_id: immobilisationId, date: '2026-12-31', compte: '681100', sens: 'debit', montant, libelle: 'Dotation 2026 — Ordinateur', ...o }),
    ligne('', { id: `${immobilisationId}-c`, piece_id: null, immobilisation_id: immobilisationId, date: '2026-12-31', compte: '281830', sens: 'credit', montant, libelle: 'Dotation 2026 — Ordinateur', ...o }),
  ]

  it('portent une écriture par bien au journal OD, le tableau d’amortissement pour pièce', () => {
    const rows = colonnes(genererFec([...dotation('i1', 400), ...dotation('i2', 150)], [], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[8], r[9], r[11], r[12]])).toEqual([
      ['OD', 'Opérations diverses', 'OD00001', '20261231', '681100', 'Dotations aux amortissements des immobilisations', '', "Tableau d'amortissement 2026", '20261231', '400,00', '0,00'],
      ['OD', 'Opérations diverses', 'OD00001', '20261231', '281830', 'Amortissements du matériel de bureau et matériel informatique', '', "Tableau d'amortissement 2026", '20261231', '0,00', '400,00'],
      ['OD', 'Opérations diverses', 'OD00002', '20261231', '681100', 'Dotations aux amortissements des immobilisations', '', "Tableau d'amortissement 2026", '20261231', '150,00', '0,00'],
      ['OD', 'Opérations diverses', 'OD00002', '20261231', '281830', 'Amortissements du matériel de bureau et matériel informatique', '', "Tableau d'amortissement 2026", '20261231', '0,00', '150,00'],
    ])
  })

  // Deux exercices d'un même bien sont deux écritures, chacune à son 31 décembre : réunies sous le seul bien,
  // elles feraient une écriture datée de deux jours, que le FEC ne sait pas porter.
  it('séparent les exercices d’un même bien', () => {
    const exercice2025 = [
      ligne('', { id: 'i1-d-2025', piece_id: null, immobilisation_id: 'i1', date: '2025-12-31', compte: '681100', sens: 'debit', montant: 200, libelle: 'Dotation 2025 — Ordinateur' }),
      ligne('', { id: 'i1-c-2025', piece_id: null, immobilisation_id: 'i1', date: '2025-12-31', compte: '281830', sens: 'credit', montant: 200, libelle: 'Dotation 2025 — Ordinateur' }),
    ]
    const rows = colonnes(genererFec([...exercice2025, ...dotation('i1', 400)], [], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[2], r[3], r[4], r[11], r[12]])).toEqual([
      ['OD00001', '20251231', '681100', '200,00', '0,00'],
      ['OD00001', '20251231', '281830', '0,00', '200,00'],
      ['OD00002', '20261231', '681100', '400,00', '0,00'],
      ['OD00002', '20261231', '281830', '0,00', '400,00'],
    ])
  })

  it('numérotent leur journal à part, après les écritures de l’année', () => {
    const rows = colonnes(genererFec([ligne('p1'), ligne('p1', { compte: COMPTE_BANQUE, sens: 'credit' }), ...dotation('i1', 400)], [piece('p1')], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => r[2])).toEqual(['AC00001', 'AC00001', 'OD00001', 'OD00001'])
  })

  it('ne font pas entrer une écriture sans pièce ni bien — le reste d’une pièce supprimée', () => {
    expect(colonnes(genererFec([ligne('', { piece_id: null })], [], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)).toEqual([])
  })

  it('nomment un compte 28 ouvert par les à-nouveaux comme celui que la dotation crédite', () => {
    const ouverture: ANouveau = {
      id: 'an1', dossier_id: 'd1', date: '2026-01-01', compte: '281830', compte_origine: '28183', libelle: 'Amort. matériel info',
      sens: 'credit', montant: 600, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2026-02-01T00:00:00Z',
    }
    const rows = colonnes(genererFec(dotation('i1', 400), [], [], [ouverture], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(new Set(rows.filter((r) => r[4] === '281830').map((r) => r[5])))
      .toEqual(new Set(['Amortissements du matériel de bureau et matériel informatique']))
  })
})

// UN FORFAIT KILOMÉTRIQUE (lib/forfaitKilometrique.ts) : une écriture par ligne du cadre 7, au journal des
// OPÉRATIONS DIVERSES, au 31 décembre, le barème kilométrique de l'exercice pour pièce. Sans elle, la ligne 23
// de la 2035 n'était nulle part dans le fichier.
describe('genererFec — les forfaits kilométriques', () => {
  const forfait = (vehiculeId: string, montant: number, date = '2026-12-31', compte = '108000'): EcritureBrouillon[] => [
    ligne('', { id: `${vehiculeId}-${date}-d`, piece_id: null, vehicule_id: vehiculeId, date, compte: '625110', sens: 'debit', montant, libelle: 'Indemnités kilométriques — Zoé' }),
    ligne('', { id: `${vehiculeId}-${date}-c`, piece_id: null, vehicule_id: vehiculeId, date, compte, sens: 'credit', montant, libelle: 'Indemnités kilométriques — Zoé' }),
  ]

  it('portent une écriture par véhicule au journal OD, le barème pour pièce', () => {
    const rows = colonnes(genererFec([...forfait('v1', 10_234), ...forfait('v2', 23.81)], [], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[5], r[6], r[8], r[9], r[11], r[12]])).toEqual([
      ['OD', 'OD00001', '20261231', '625110', 'Indemnités kilométriques (barème)', '', 'Barème kilométrique 2026', '20261231', '10234,00', '0,00'],
      ['OD', 'OD00001', '20261231', '108000', "Compte de l'exploitant", '', 'Barème kilométrique 2026', '20261231', '0,00', '10234,00'],
      ['OD', 'OD00002', '20261231', '625110', 'Indemnités kilométriques (barème)', '', 'Barème kilométrique 2026', '20261231', '23,81', '0,00'],
      ['OD', 'OD00002', '20261231', '108000', "Compte de l'exploitant", '', 'Barème kilométrique 2026', '20261231', '0,00', '23,81'],
    ])
  })

  // À date égale, l'ordre est celui de la clé — la dotation avant le forfait —, pour que deux exports du même
  // brouillon soient identiques.
  it('se numérotent avec les dotations, et chaque véhicule et chaque exercice à part', () => {
    const dotation = [
      ligne('', { id: 'i1-d', piece_id: null, immobilisation_id: 'i1', date: '2026-12-31', compte: '681100', sens: 'debit', montant: 400 }),
      ligne('', { id: 'i1-c', piece_id: null, immobilisation_id: 'i1', date: '2026-12-31', compte: '281830', sens: 'credit', montant: 400 }),
    ]
    const rows = colonnes(genererFec([...forfait('v1', 50, '2025-12-31'), ...dotation, ...forfait('v1', 60)], [], [], [], 'tresorerie', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[2], r[3], r[4], r[8]])).toEqual([
      ['OD00001', '20251231', '625110', 'Barème kilométrique 2025'],
      ['OD00001', '20251231', '108000', 'Barème kilométrique 2025'],
      ['OD00002', '20261231', '681100', "Tableau d'amortissement 2026"],
      ['OD00002', '20261231', '281830', "Tableau d'amortissement 2026"],
      ['OD00003', '20261231', '625110', 'Barème kilométrique 2026'],
      ['OD00003', '20261231', '108000', 'Barème kilométrique 2026'],
    ])
  })

  it('n’ont pas de compte auxiliaire, même au compte courant du dirigeant en engagement', () => {
    const rows = colonnes(genererFec(forfait('v1', 23.81, '2026-12-31', '455000'), [], [], [], 'engagement', [], SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[4], r[6], r[7]])).toEqual([['625110', '', ''], ['455000', '', '']])
  })
})

// ═══ La numérotation, partagée avec la validation d'un exercice (ligne 26.6, étape d) ════════════════
// `valider_exercice` reçoit ce que `numeroterFec` décide et le fige sur les écritures ; le FEC d'un exercice
// validé se relit ensuite depuis ce qui a été figé. Les deux temps doivent rendre le même fichier.
describe('numeroterFec — ce que la validation reçoit', () => {
  const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120, nom_fichier: 'facture-mars.pdf' })
  const vente = piece('vente', { tiers: 'CPAM', type_piece: 'vente', date_piece: '2026-03-15', montant_ttc: 50 })
  const brouillon = [
    ligne('achat', { id: 'a1', compte: '606100', sens: 'debit', montant: 120 }),
    ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
    ligne('achat', { id: 'a3', compte: '401000', sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('achat', { id: 'a4', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('vente', { id: 'v1', compte: '706000', sens: 'credit', montant: 50, date: '2026-03-15' }),
    ligne('vente', { id: 'v2', compte: '411000', sens: 'debit', montant: 50, date: '2026-03-15' }),
  ]

  it('donne à chaque ligne son journal, son numéro, sa pièce et le libellé de son compte', () => {
    const n = numeroterFec(brouillon, [achat, vente], [], [], 'engagement', [])
    expect(n.lignes.map((l) => [l.ecriture.id, l.journal, l.numero, l.pieceRef, l.pieceDate, l.compteLib, l.compAuxNum, l.compAuxLib, l.validDate])).toEqual([
      ['a1', 'AC', 1, 'facture-mars.pdf', '2026-03-10', '606100', null, null, '2026-03-10'],
      ['a2', 'AC', 1, 'facture-mars.pdf', '2026-03-10', 'Fournisseurs', 'FTRANSMEDICAL', 'Transmedical', '2026-03-10'],
      ['v2', 'VE', 1, 'vente.pdf', '2026-03-15', 'Clients', 'CCPAM', 'CPAM', '2026-03-15'],
      ['v1', 'VE', 1, 'vente.pdf', '2026-03-15', '706000', null, null, '2026-03-15'],
      ['a3', 'BQ', 1, 'facture-mars.pdf', '2026-03-10', 'Fournisseurs', 'FTRANSMEDICAL', 'Transmedical', '2026-04-05'],
      ['a4', 'BQ', 1, 'facture-mars.pdf', '2026-03-10', 'Banque', null, null, '2026-04-05'],
    ])
    expect(n.horsFec).toEqual([])
  })

  // La lecture rend les lignes dans l'ordre qu'on lui demande — Écritures lit par date décroissante. Le
  // fichier, lui, ne doit pas en dépendre : c'est ce qui permet au FEC relu depuis un exercice validé d'être
  // celui qu'on aurait exporté la veille.
  it('rend le même fichier quel que soit l’ordre de lecture', () => {
    const fec = (ecritures: EcritureBrouillon[]) => genererFec(ecritures, [achat, vente], [], [], 'engagement', [], SANS_LETTRAGE)
    const attendu = fec(brouillon)
    expect(fec([...brouillon].reverse())).toBe(attendu)
    expect(fec([brouillon[3], brouillon[0], brouillon[5], brouillon[2], brouillon[4], brouillon[1]])).toBe(attendu)
  })

  it('met dehors l’écriture que rien ne rattache, au lieu de l’imprimer', () => {
    const orpheline = ligne('', { id: 'o1', piece_id: null, compte: '606100', montant: 19.99 })
    const n = numeroterFec([...brouillon, orpheline], [achat, vente], [], [], 'engagement', [])
    expect(n.horsFec.map((e) => e.id)).toEqual(['o1'])
    expect(n.lignes.some((l) => l.ecriture.id === 'o1')).toBe(false)
  })

  it('ne laisse jamais une pièce sans référence', () => {
    const sansNom = piece('p-sans-nom-de-fichier', { nom_fichier: '  ' })
    const n = numeroterFec([ligne('p-sans-nom-de-fichier')], [sansNom], [], [], 'tresorerie', [])
    expect(n.lignes[0].pieceRef).toBe('p-sans-n')
  })

  // La validation refuse un compte qui porte deux libellés, à-nouveaux compris : le FEC aussi n'en écrit qu'un.
  it('donne un seul libellé à un compte, à-nouveaux et écritures compris', () => {
    const ouverture: ANouveau = {
      id: 'an1', dossier_id: 'd1', date: '2026-01-01', compte: '455100', compte_origine: '4551', libelle: 'Compte courant M. Martin',
      sens: 'credit', montant: 1000, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2026-02-01T00:00:00Z',
    }
    const n = numeroterFec([ligne('p1', { compte: '455100' })], [piece('p1')], [], [ouverture], 'tresorerie', [])
    expect(n.aNouveaux.map((a) => a.compteLib)).toEqual(['Compte courant M. Martin'])
    expect(n.lignes.map((l) => l.compteLib)).toEqual(['Compte courant M. Martin'])
  })

  it('garde le libellé de l’application pour un compte qu’elle tient, même repris', () => {
    const ouverture: ANouveau = {
      id: 'an1', dossier_id: 'd1', date: '2026-01-01', compte: COMPTE_BANQUE, compte_origine: '51210000', libelle: 'BNP Paribas',
      sens: 'debit', montant: 1000, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2026-02-01T00:00:00Z',
    }
    const n = numeroterFec([], [], [], [ouverture], 'tresorerie', [])
    expect(n.aNouveaux.map((a) => [a.compteLib, a.ecritureLib])).toEqual([['Banque', 'À-nouveau 51210000 BNP Paribas']])
  })
})

// La note de frais en trésorerie s'écrit face au compte de l'exploitant (lib/ecritures.ts) : son écriture part au
// journal des achats, équilibrée, et la validation n'y trouve plus rien à redire — elle refusait son exercice.
describe('numeroterFec — la note de frais en trésorerie', () => {
  it('fait une écriture équilibrée au journal des achats, le 108000 nommé, sans compte auxiliaire', () => {
    const note = piece('note', { type_piece: 'note_frais', tiers: 'Restaurant', montant_ttc: 42.5, nom_fichier: 'ticket.jpg' })
    const enBase = (l: LigneAGenerer, i: number): EcritureBrouillon => ligne('note', { ...l, id: `n${i}`, ligne_bancaire_id: null })
    const brouillon = lignesPourPiece('d1', note, { compte: '625700', immobilisation: false }, false, [], { mode: 'tresorerie', compteNotesDeFrais: '455000' })
      .map(enBase)
    const n = numeroterFec(brouillon, [note], [], [], 'tresorerie', [])
    expect(n.lignes.map((l) => [l.journal, l.numero, l.ecriture.compte, l.ecriture.sens, l.ecriture.montant, l.compteLib, l.compAuxNum])).toEqual([
      ['AC', 1, '625700', 'debit', 42.5, '625700', null],
      ['AC', 1, '108000', 'credit', 42.5, "Compte de l'exploitant", null],
    ])
    expect(defautsDeNumerotation(n)).toEqual([])
  })
})

describe('numerotationValidee — le FEC d’un exercice validé se relit depuis ce qui a été figé', () => {
  const achat = piece('achat', { tiers: 'Transmedical', montant_ttc: 120, nom_fichier: 'facture-mars.pdf' })
  const brouillon = [
    ligne('achat', { id: 'a1', compte: '606100', sens: 'debit', montant: 120 }),
    ligne('achat', { id: 'a2', compte: '401000', sens: 'credit', montant: 120 }),
    ligne('achat', { id: 'a3', compte: '401000', sens: 'debit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ligne('achat', { id: 'a4', compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
  ]
  const ouverture: ANouveau = {
    id: 'an1', dossier_id: 'd1', date: '2026-01-01', compte: COMPTE_BANQUE, compte_origine: '512', libelle: 'Banque',
    sens: 'debit', montant: 2500, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
    created_at: '2026-02-01T00:00:00Z',
  }
  // Ce que `valider_exercice` écrit sur chaque écriture et chaque à-nouveau : ce que la numérotation a décidé.
  const VALIDE_LE = '2027-01-14T23:30:00Z' // le 15 janvier à Paris
  const valider = (n: NumerotationFec): { ecritures: EcritureBrouillon[]; aNouveaux: ANouveau[] } => ({
    ecritures: n.lignes.map((l) => ({
      ...l.ecriture, statut: 'validee', valide_le: VALIDE_LE, journal_code: l.journal, numero_ecriture: l.numero,
      piece_ref: l.pieceRef, piece_date: l.pieceDate, compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    })),
    aNouveaux: n.aNouveaux.map((a) => ({ ...a.aNouveau, compte_lib: a.compteLib, ecriture_lib: a.ecritureLib })),
  })

  it('relit le fichier d’avant la validation, à ValidDate près', () => {
    const avant = numeroterFec(brouillon, [achat], [], [ouverture], 'engagement', [])
    const { ecritures, aNouveaux } = valider(avant)
    const apres = numerotationValidee([...ecritures].reverse(), aNouveaux, VALIDE_LE)
    expect(apres.horsFec).toEqual([])
    const sansValidDate = (fec: string) => colonnes(fec).map((r) => r.filter((_, i) => i !== 15))
    expect(sansValidDate(formaterFec(apres, SANS_LETTRAGE))).toEqual(sansValidDate(formaterFec(avant, SANS_LETTRAGE)))
    // Et ValidDate devient le jour de la validation, à Paris — le 15 et non le 14, quel que soit le fuseau.
    expect(colonnes(formaterFec(apres, SANS_LETTRAGE)).slice(1).map((r) => r[15])).toEqual(Array(5).fill('20270115'))
  })

  it('ne relit plus rien des pièces ni des catégories d’aujourd’hui', () => {
    const { ecritures, aNouveaux } = valider(numeroterFec(brouillon, [achat], [], [ouverture], 'engagement', []))
    // Ce que la validation a figé, même si l'application nommerait autrement ce compte aujourd'hui.
    const figees = ecritures.map((e) => (e.compte === '606100' ? { ...e, compte_lib: 'Achats de fournitures (2026)' } : e))
    const rows = colonnes(formaterFec(numerotationValidee(figees, aNouveaux, VALIDE_LE), SANS_LETTRAGE)).slice(1)
    expect(rows.find((r) => r[4] === '606100')![5]).toBe('Achats de fournitures (2026)')
    expect(rows.find((r) => r[0] === 'AN')!.slice(4, 6)).toEqual([COMPTE_BANQUE, 'Banque'])
  })

  it('lit les libellés figés des à-nouveaux', () => {
    const fige = { ...ouverture, compte_lib: 'Banque', ecriture_lib: 'À-nouveau 512 Banque Populaire' }
    const rows = colonnes(formaterFec(numerotationValidee([], [fige], VALIDE_LE), SANS_LETTRAGE)).slice(1)
    expect(rows.map((r) => [r[0], r[5], r[10], r[15]])).toEqual([['AN', 'Banque', 'À-nouveau 512 Banque Populaire', '20270115']])
  })

  it('met dehors une écriture qui ne porte pas sa validation, au lieu de l’imprimer à moitié', () => {
    const { ecritures, aNouveaux } = valider(numeroterFec(brouillon, [achat], [], [ouverture], 'engagement', []))
    const n = numerotationValidee([...ecritures, ligne('achat', { id: 'a5' })], aNouveaux, VALIDE_LE)
    expect(n.horsFec.map((e) => e.id)).toEqual(['a5'])
    expect(n.lignes).toHaveLength(4)
  })

  // DÉFENSIF, et dit comme tel : la base interdit à une écriture proposée de porter les champs d'une validation
  // (`ecritures_brouillon_validation_complete`). Si elle en portait, le fichier d'un exercice validé ne l'imprime pas.
  it('n’imprime jamais une écriture proposée, même si elle portait les champs d’une validation', () => {
    const { ecritures, aNouveaux } = valider(numeroterFec(brouillon, [achat], [], [ouverture], 'engagement', []))
    const n = numerotationValidee([{ ...ecritures[0], statut: 'proposee' }, ...ecritures.slice(1)], aNouveaux, VALIDE_LE)
    expect(n.horsFec.map((e) => e.id)).toEqual([ecritures[0].id])
  })
})
