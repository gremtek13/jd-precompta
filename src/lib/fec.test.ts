import { describe, expect, it } from 'vitest'
import { genererFec, libelleCompte, nomFichierFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import type { Categorie, EcritureBrouillon, Piece } from './types'

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

describe('genererFec — intégrité du fichier', () => {
  it("neutralise les sauts de ligne d'un libellé venu de l'OCR", () => {
    // Cas réel relevé en base : un en-tête de facture sur trois lignes ressort tel quel de
    // l'extraction. Sans neutralisation, cette seule pièce coupe la ligne FEC en trois et rend le
    // fichier structurellement invalide.
    const fec = genererFec(
      [ligne('p1', { libelle: "CAISSE\nD'EPARGNE\nCEPAC" })],
      [piece('p1', { tiers: "CAISSE\nD'EPARGNE\nCEPAC" })],
      [],
    )
    const rows = colonnes(fec)
    expect(rows).toHaveLength(2) // en-tête + 1 écriture, pas 4
    expect(rows[1][10]).toBe("CAISSE D'EPARGNE CEPAC")
  })

  it('neutralise une tabulation, qui décalerait toutes les colonnes suivantes', () => {
    const fec = genererFec([ligne('p1', { libelle: 'ACME\tSARL' })], [piece('p1')], [])
    const rows = colonnes(fec)
    expect(rows[1]).toHaveLength(18) // le format en impose 18, ni plus ni moins
    expect(rows[1][10]).toBe('ACME SARL')
  })

  it('neutralise aussi un nom de fichier piégé', () => {
    const fec = genererFec([ligne('p1')], [piece('p1', { nom_fichier: 'facture\tmars.pdf' })], [])
    expect(colonnes(fec)[1][8]).toBe('facture mars.pdf')
  })

  it('garde toutes les lignes à 18 colonnes, quoi qu’il arrive', () => {
    const fec = genererFec(
      [ligne('p1', { libelle: "a\tb\nc" }), ligne('p1', { compte: COMPTE_BANQUE, sens: 'credit' })],
      [piece('p1', { nom_fichier: "x\ny.pdf" })],
      [],
    )
    expect(colonnes(fec).every((r) => r.length === 18)).toBe(true)
  })
})

describe('genererFec — numérotation et dates', () => {
  it('numérote chaque journal dans l’ordre chronologique', () => {
    // Un EcritureNum non croissant dans un même journal fait rejeter le fichier à l'import.
    const fec = genererFec(
      [ligne('tard'), ligne('tot'), ligne('vente')],
      [
        piece('tard', { date_piece: '2026-06-01' }),
        piece('tot', { date_piece: '2026-01-15' }),
        piece('vente', { date_piece: '2026-03-01', type_piece: 'vente' }),
      ],
      [],
    )
    const rows = colonnes(fec).slice(1)
    expect(rows.map((r) => [r[0], r[2]])).toEqual([
      ['AC', 'AC00001'], // 15/01
      ['VE', 'VE00001'], // 01/03 — compteur propre au journal des ventes
      ['AC', 'AC00002'], // 01/06
    ])
  })

  it('date la pièce par le justificatif, pas par la contrepartie banque', () => {
    // La ligne banque porte la date de paiement ; PieceDate doit rester celle de la facture,
    // quel que soit l'ordre dans lequel les lignes remontent de la base.
    const lignes = [
      ligne('p1', { compte: COMPTE_BANQUE, date: '2026-04-20', sens: 'credit' }),
      ligne('p1', { date: '2026-03-10' }),
    ]
    const rows = colonnes(genererFec(lignes, [piece('p1', { date_piece: '2026-03-10' })], [])).slice(1)
    expect(rows.every((r) => r[9] === '20260310')).toBe(true)
    // EcritureDate reste propre à chaque ligne : la banque garde sa date de paiement.
    expect(rows.map((r) => r[3]).sort()).toEqual(['20260310', '20260420'])
  })

  it('produit deux fois le même fichier pour les mêmes données', () => {
    const lignes = [ligne('b'), ligne('a')]
    const pieces = [piece('a', { date_piece: '2026-02-01' }), piece('b', { date_piece: '2026-02-01' })]
    expect(genererFec(lignes, pieces, [])).toBe(genererFec([...lignes].reverse(), pieces, []))
  })

  it('ignore les écritures sans pièce rattachée', () => {
    const orpheline = { ...ligne('p1'), piece_id: null } as EcritureBrouillon
    expect(colonnes(genererFec([orpheline], [piece('p1')], []))).toHaveLength(1) // en-tête seul
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
