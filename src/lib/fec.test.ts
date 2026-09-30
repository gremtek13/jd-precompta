import { describe, expect, it } from 'vitest'
import { genererFec, libelleCompte, nomFichierFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'

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
      'tresorerie', [],
    )
    const rows = colonnes(fec)
    expect(rows).toHaveLength(2) // en-tête + 1 écriture, pas 4
    expect(rows[1][10]).toBe("CAISSE D'EPARGNE CEPAC")
  })

  it('neutralise une tabulation, qui décalerait toutes les colonnes suivantes', () => {
    const fec = genererFec([ligne('p1', { libelle: 'ACME\tSARL' })], [piece('p1')], [], [], 'tresorerie', [])
    const rows = colonnes(fec)
    expect(rows[1]).toHaveLength(18) // le format en impose 18, ni plus ni moins
    expect(rows[1][10]).toBe('ACME SARL')
  })

  it('neutralise aussi un nom de fichier piégé', () => {
    const fec = genererFec([ligne('p1')], [piece('p1', { nom_fichier: 'facture\tmars.pdf' })], [], [], 'tresorerie', [])
    expect(colonnes(fec)[1][8]).toBe('facture mars.pdf')
  })

  it('garde toutes les lignes à 18 colonnes, quoi qu’il arrive', () => {
    const fec = genererFec(
      [ligne('p1', { libelle: "a\tb\nc" }), ligne('p1', { compte: COMPTE_BANQUE, sens: 'credit' })],
      [piece('p1', { nom_fichier: "x\ny.pdf" })],
      [],
      [],
      'tresorerie', [],
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
      sens: 'debit', montant: 25000.1, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64),
      created_at: '2026-09-26T10:00:00Z',
    }],
    'tresorerie', [],
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
    const l = colonnes(genererFec([ligne('p1', { montant: -12.5 })], [piece('p1')], [], [], 'tresorerie', []))[1]
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
      'tresorerie', [],
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
      'tresorerie', [],
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
    const rows = colonnes(genererFec(lignes, [piece('p1', { date_piece: '2026-03-10' })], [], [], 'tresorerie', [])).slice(1)
    expect(rows.every((r) => r[9] === '20260310')).toBe(true)
    // EcritureDate reste propre à chaque ligne : la banque garde sa date de paiement.
    expect(rows.map((r) => r[3]).sort()).toEqual(['20260310', '20260420'])
  })

  it('produit deux fois le même fichier pour les mêmes données', () => {
    const lignes = [ligne('b'), ligne('a')]
    const pieces = [piece('a', { date_piece: '2026-02-01' }), piece('b', { date_piece: '2026-02-01' })]
    expect(genererFec(lignes, pieces, [], [], 'tresorerie', [])).toBe(genererFec([...lignes].reverse(), pieces, [], [], 'tresorerie', []))
  })

  it('ignore les écritures sans pièce rattachée', () => {
    const orpheline = { ...ligne('p1'), piece_id: null } as EcritureBrouillon
    expect(colonnes(genererFec([orpheline], [piece('p1')], [], [], 'tresorerie', []))).toHaveLength(1) // en-tête seul
  })
})

describe('genererFec — les à-nouveaux ouvrent le fichier', () => {
  const aNouveau = (o: Partial<ANouveau>): ANouveau => ({
    id: 'an-1', dossier_id: 'd1', date: '2026-01-01', compte: '512000', compte_origine: '51210000',
    libelle: 'Banque Populaire', sens: 'debit', montant: 6000, source_nom: 'balance-2025.csv',
    source_empreinte: 'a'.repeat(64), created_at: '2026-09-26T10:00:00Z', ...o,
  })
  // Données HORS de l'ordre des comptes, comme la base peut les rendre : sans cela, le test du tri
  // passerait sur un tri absent.
  const ouverture = [
    aNouveau({}),
    aNouveau({ id: 'an-2', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit', montant: 6000 }),
  ]

  it('les place en tête, en une seule écriture du journal AN, triées par compte', () => {
    const rows = colonnes(genererFec([ligne('p1')], [piece('p1')], [], ouverture, 'tresorerie', [])).slice(1)
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4]])).toEqual([
      ['AN', 'À-nouveaux', 'AN00001', '20260101', '108'],
      ['AN', 'À-nouveaux', 'AN00001', '20260101', '512000'],
      ['AC', 'Achats', 'AC00001', '20260310', '606100'],
    ])
  })

  it('garde le libellé de l’application pour la banque, et la balance d’origine dans le libellé d’écriture', () => {
    // Un même CompteNum ne porte qu'un CompteLib dans tout le fichier : les mouvements de la banque
    // l'appellent « Banque », son ouverture aussi.
    const banque = colonnes(genererFec([], [], [], ouverture, 'tresorerie', [])).find((r) => r[4] === '512000')!
    expect(banque[5]).toBe('Banque')
    expect(banque[10]).toBe('À-nouveau 51210000 Banque Populaire')
    expect(banque[8]).toBe('balance-2025.csv')
    expect([banque[11], banque[12]]).toEqual(['6000,00', '0,00'])
    const exploitant = colonnes(genererFec([], [], [], ouverture, 'tresorerie', [])).find((r) => r[4] === '108')!
    expect([exploitant[5], exploitant[10], exploitant[11], exploitant[12]])
      .toEqual(['Compte de l’exploitant', 'À-nouveau Compte de l’exploitant', '0,00', '6000,00'])
  })

  it('s’exporte même sans aucune écriture : l’ouverture d’un exercice qui commence', () => {
    const rows = colonnes(genererFec([], [], [], ouverture, 'tresorerie', []))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.length === 18)).toBe(true)
  })

  it('neutralise un nom de balance piégé comme tout autre champ', () => {
    const rows = colonnes(genererFec([], [], [], [aNouveau({ source_nom: 'balance\t2025.csv' })], 'tresorerie', []))
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
  const rows = () => colonnes(genererFec(brouillon, [achat, vente], [], [], 'engagement', [])).slice(1)

  it('range la facture au journal de sa nature et chaque règlement au journal de banque, sous son propre numéro', () => {
    expect(rows().map((r) => [r[0], r[2], r[3], r[4]])).toEqual([
      ['AC', 'AC00001', '20260310', '606100'],
      ['AC', 'AC00001', '20260310', '401000'],
      ['VE', 'VE00001', '20260315', '706000'],
      ['VE', 'VE00001', '20260315', '411000'],
      ['BQ', 'BQ00001', '20260320', '411000'],
      ['BQ', 'BQ00001', '20260320', COMPTE_BANQUE],
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
      ['706000', '', ''],
      ['411000', 'CCPAM', 'CPAM'],
      ['411000', 'CCPAM', 'CPAM'],
      [COMPTE_BANQUE, '', ''],
      ['401000', 'FTRANSMEDICAL', 'Transmedical'],
      [COMPTE_BANQUE, '', ''],
    ])
    expect(rows().find((r) => r[4] === '401000')![5]).toBe('Fournisseurs')
  })

  it('donne un seul libellé à un compte auxiliaire, le premier rencontré', () => {
    const autre = piece('autre', { tiers: 'TRANSMEDICAL / et redevient', date_piece: '2026-06-01' })
    const fec = genererFec(
      [...brouillon, ligne('autre', { id: 'x1', compte: '401000', sens: 'credit', date: '2026-06-01' })],
      [achat, vente, autre], [], [], 'engagement', [],
    )
    const libelles = new Set(colonnes(fec).slice(1).filter((r) => r[6] === 'FTRANSMEDICAL').map((r) => r[7]))
    expect(libelles).toEqual(new Set(['Transmedical']))
  })

  it('garde une pièce en une seule écriture en trésorerie, contrepartie banque comprise', () => {
    const tresorerie = [
      ligne('achat', { id: 't1', compte: '606100', date: '2026-04-05' }),
      ligne('achat', { id: 't2', compte: COMPTE_BANQUE, sens: 'credit', date: '2026-04-05', ligne_bancaire_id: 'l-achat' }),
    ]
    const r = colonnes(genererFec(tresorerie, [achat], [], [], 'tresorerie', [])).slice(1)
    expect(r.map((x) => [x[0], x[2]])).toEqual([['AC', 'AC00001'], ['AC', 'AC00001']])
  })
})

describe('genererFec — les mouvements du relevé affectés sans justificatif', () => {
  // Ligne 26.6 : un encaissement de l'Assurance maladie rangé en recettes, des frais bancaires. Ils
  // n'ont pas de pièce ; leur justificatif est le relevé qui les porte.
  const mouvement = (id: string, o: Partial<LigneBancaire> = {}): LigneBancaire => ({
    id, dossier_id: 'd1', date: '2026-03-12', libelle: 'VIR CPAM', montant: 250, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'c-recettes', prelevement_personnel: false,
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
    const rows = colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [cpam, frais])).slice(1)
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[8], r[9]])).toEqual([
      ['BQ', 'Banque', 'BQ00001', '20260228', '627000', 'Relevé bancaire', '20260228'],
      ['BQ', 'Banque', 'BQ00001', '20260228', COMPTE_BANQUE, 'Relevé bancaire', '20260228'],
      ['BQ', 'Banque', 'BQ00002', '20260312', '706000', 'releve-mars-2026.pdf', '20260312'],
      ['BQ', 'Banque', 'BQ00002', '20260312', COMPTE_BANQUE, 'releve-mars-2026.pdf', '20260312'],
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
    const rows = colonnes(genererFec([...brouillon, ...reglement], [achat], [], [], 'engagement', [cpam, frais])).slice(1)
    expect([...new Set(rows.filter((r) => r[0] === 'BQ').map((r) => `${r[2]} ${r[3]}`))])
      .toEqual(['BQ00001 20260228', 'BQ00002 20260305', 'BQ00003 20260312'])
  })

  it('laisse dehors l’écriture sans pièce d’un mouvement qui n’est plus affecté', () => {
    // Le reste d'une pièce supprimée, ou d'une affectation défaite hors de l'application : sans
    // justificatif, elle ne va pas dans le fichier fiscal — `absenceFec` la chiffre à l'écran.
    const remis = { ...cpam, statut: 'non_rapprochee' as const, categorie_id: null }
    const rows = colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [remis, frais])).slice(1)
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
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [prelevement])).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[5], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '20260320', '108000', "Compte de l'exploitant", 'releve-mars-2026.pdf', '500,00', '0,00'],
      ['BQ', 'BQ00001', '20260320', COMPTE_BANQUE, 'Banque', 'releve-mars-2026.pdf', '0,00', '500,00'],
    ])
    // Le garde symétrique : remis à traiter, le même mouvement n'est plus justifié par le relevé.
    const remis = { ...prelevement, statut: 'non_rapprochee' as const, prelevement_personnel: false }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [remis])).slice(1)).toEqual([])
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
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [pret])).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[4], r[5], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '164000', 'Emprunts auprès des établissements de crédit', 'releve-mars-2026.pdf', '482,97', '0,00'],
      ['BQ', 'BQ00001', '661100', 'Intérêts des emprunts et dettes', 'releve-mars-2026.pdf', '36,00', '0,00'],
      ['BQ', 'BQ00001', '616800', 'Assurance des emprunts', 'releve-mars-2026.pdf', '21,03', '0,00'],
      ['BQ', 'BQ00001', COMPTE_BANQUE, 'Banque', 'releve-mars-2026.pdf', '0,00', '540,00'],
    ])
    // Le garde symétrique : une fois le rapprochement retiré, la même écriture n'a plus de justificatif.
    const retire = { ...pret, statut: 'non_rapprochee' as const, emprunt_id: null }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [retire])).slice(1)).toEqual([])
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
    const rows = colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [telephone])).slice(1)
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[8], r[11], r[12]])).toEqual([
      ['BQ', 'BQ00001', '20260315', '626000', 'releve-mars-2026.pdf', '84,00', '0,00'],
      ['BQ', 'BQ00001', '20260315', '108000', 'releve-mars-2026.pdf', '36,00', '0,00'],
      ['BQ', 'BQ00001', '20260315', COMPTE_BANQUE, 'releve-mars-2026.pdf', '0,00', '120,00'],
    ])
    // Le garde symétrique : la ventilation annulée, la même écriture n'a plus de justificatif.
    const annule = { ...telephone, statut: 'non_rapprochee' as const, ventilee: false, reglement_groupe: false, id_externe: null }
    expect(colonnes(genererFec(ecritures, [], [], [], 'tresorerie', [annule])).slice(1)).toEqual([])
  })

  it('les équilibre, une écriture après l’autre', () => {
    const parNumero = new Map<string, number>()
    for (const r of colonnes(genererFec(brouillon, [], [], [], 'tresorerie', [cpam, frais])).slice(1)) {
      parNumero.set(r[2], (parNumero.get(r[2]) ?? 0) + lireMontant(r[11]) - lireMontant(r[12]))
    }
    expect([...parNumero.values()].every((s) => Math.abs(s) < 0.005)).toBe(true)
  })
})
