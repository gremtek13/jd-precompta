// L'IMPORT D'UN RELEVÉ BANCAIRE PAR FICHIER (corrections du 31/10/2026, avant l'import réel de l'année 2025 d'un
// praticien) : le séparateur, l'encodage, les en-têtes Débit / Crédit / Solde, le montant interprété, les lignes de solde,
// le dédoublonnage par multiplicité, le recouvrement d'une période déjà importée. Les exports de banques sont des jeux
// FICTIFS, à la forme des exports réels (point-virgule, virgule décimale, JJ/MM/AAAA, préambules, windows-1252).
import { describe, expect, it } from 'vitest'
import {
  colonnesParEntete, detectColumnMapping, estUnSoldeCourant, libelleDeLigne, montantDeLigne, parseCsv, parseMontantBancaire,
  separateurDuCsv, type DetectionDesColonnes,
} from './csv'
import { decoderUtf8OuWindows1252 } from './decodageTexte'
import {
  douteDuSens, interpreterReleve, partagerParMultiplicite, phraseDesEcartees, phraseDesRecouvrements, recouvrements,
  refusDuReglage, signatureMouvement, type ReglageDeLImport,
} from './importReleve'
import { aLaFormeDUnSolde, lignesDeSolde, phraseDesSoldes } from './soldeReleve'
import { parseLignesFromPdf } from './relevePdf'

// Un fichier tel qu'une banque l'écrit en windows-1252 : chaque caractère sur un octet (é = 0xE9, € = 0x80).
function octetsWindows1252(texte: string): Uint8Array {
  return Uint8Array.from([...texte].map((c) => (c === '€' ? 0x80 : c.charCodeAt(0))))
}

// De l'octet au relevé interprété, par les fonctions mêmes de l'import.
function lire(octets: Uint8Array) {
  const { texte, encodage } = decoderUtf8OuWindows1252(octets)
  const rows = parseCsv(texte)
  const detection = detectColumnMapping(rows)
  const dataRows = detection.hasHeader ? rows.slice(1) : rows
  return { encodage, rows, detection, releve: interpreterReleve(dataRows, detection) }
}
const utf8 = (texte: string) => new TextEncoder().encode(texte)

describe('le signe moins typographique', () => {
  it('se lit comme un trait d’union', () => {
    expect(parseMontantBancaire('\u221212,50')).toBe(-12.5)
    expect(parseMontantBancaire('\u22121 234,56 €')).toBe(-1234.56)
  })
  it('et la devise écrite en lettres reste illisible : une cellule qui n’est pas un montant ne compte pas comme tel', () => {
    expect(parseMontantBancaire('1 234,56 EUR')).toBeNull()
    expect(parseMontantBancaire('12,50 USD')).toBeNull()
  })
})

describe('separateurDuCsv — le séparateur le plus régulier', () => {
  it('garde la virgule d’un fichier à virgules dont un libellé porte un point-virgule', () => {
    const texte = 'Date,Libelle,Montant\n2025-03-05,CB PHARMACIE; CENTRE,-12.50\n2025-03-06,VIR CPAM,120.00\n2025-03-07,PRLV ORANGE,-40.00\n'
    expect(separateurDuCsv(texte)).toBe(',')
    expect(parseCsv(texte)[1]).toEqual(['2025-03-05', 'CB PHARMACIE; CENTRE', '-12.50'])
  })
  it('prend le point-virgule d’un fichier français sans en-tête, aussi régulier que ses virgules décimales', () => {
    expect(separateurDuCsv('05/03/2025;CB PHARMACIE;-12,50\n06/03/2025;VIR CPAM;120,00\n')).toBe(';')
  })
  it('garde le point-virgule d’un relevé dont les lignes de solde sont plus courtes, malgré ses virgules régulières', () => {
    // Une virgule décimale par ligne est plus RÉGULIÈRE que des points-virgules dont le nombre varie : la régularité seule
    // aurait découpé ce relevé à la virgule.
    expect(separateurDuCsv('01/03/2025;1 000,00;;SOLDE\n05/03/2025;-12,50;Carte;CB PHARMACIE;;\n07/03/2025;120,00;Virement;VIR CPAM;;\n31/03/2025;1 107,50;;SOLDE\n')).toBe(';')
  })
  it('départage par la régularité un fichier sans dates (une balance)', () => {
    expect(separateurDuCsv('Compte;Libelle;Debit;Credit\n411000;Clients;1 200,00;\n512000;Banque;;3 400,50\n')).toBe(';')
    expect(separateurDuCsv('Compte,Libelle,Debit,Credit\n411000,Clients,1200.00,\n512000,"Banque; courant",,3400.50\n')).toBe(',')
  })
  it('ne compte pas un séparateur entre guillemets', () => {
    expect(separateurDuCsv('a,"b;c",d\ne,"f;g",h\n')).toBe(',')
  })
  it('reconnaît la tabulation', () => {
    expect(parseCsv('05/03/2025\tCB PHARMACIE\t-12,50\n06/03/2025\tVIR CPAM\t120,00\n')[0]).toEqual(['05/03/2025', 'CB PHARMACIE', '-12,50'])
  })
  it('ne se laisse pas tromper par un préambule plus court', () => {
    const texte = 'Compte courant;0123456789\nDate;Libellé;Débit;Crédit\n02/01/2025;CB;45,20;\n03/01/2025;VIR;;120,00\n'
    expect(separateurDuCsv(texte)).toBe(';')
  })
})

describe('decoderUtf8OuWindows1252', () => {
  it('lit un export windows-1252 : le symbole euro et les accents', () => {
    const { texte, encodage } = decoderUtf8OuWindows1252(octetsWindows1252('Libellé;-12,50 €'))
    expect(encodage).toBe('windows-1252')
    expect(texte).toBe('Libellé;-12,50 €')
  })
  it('garde l’UTF-8, et retire sa marque d’ordre', () => {
    expect(decoderUtf8OuWindows1252(utf8('Libellé;-12,50 €'))).toEqual({ texte: 'Libellé;-12,50 €', encodage: 'utf-8' })
    expect(decoderUtf8OuWindows1252(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8('Date')])).texte).toBe('Date')
  })
})

describe('montantDeLigne — la seule interprétation d’un montant de relevé', () => {
  const signe = { format: 'signe', colMontant: 2, colDebit: 2, colCredit: 3 } as const
  const deux = { format: 'debit_credit', colMontant: 2, colDebit: 2, colCredit: 3 } as const
  it('en montant signé : le montant, ou pourquoi il ne se lit pas', () => {
    expect(montantDeLigne(['05/03/2025', 'X', '-12,50'], signe)).toEqual({ montant: -12.5 })
    expect(montantDeLigne(['05/03/2025', 'X', ''], signe)).toEqual({ ecart: 'absent' })
    expect(montantDeLigne(['05/03/2025', 'X'], signe)).toEqual({ ecart: 'absent' })
    expect(montantDeLigne(['05/03/2025', 'X', '#VALEUR!'], signe)).toEqual({ ecart: 'illisible' })
  })
  it('en Débit / Crédit : le débit sort, écrit en positif comme en négatif', () => {
    expect(montantDeLigne(['05/03/2025', 'X', '45,20', ''], deux)).toEqual({ montant: -45.2 })
    expect(montantDeLigne(['05/03/2025', 'X', '-45,20', ''], deux)).toEqual({ montant: -45.2 })
    expect(montantDeLigne(['05/03/2025', 'X', '', '120,00'], deux)).toEqual({ montant: 120 })
    // Une banque écrit parfois 0,00 dans la colonne qui ne sert pas.
    expect(montantDeLigne(['05/03/2025', 'X', '0,00', '120,00'], deux)).toEqual({ montant: 120 })
  })
  it('n’écrit jamais zéro à la place d’un montant illisible ou absent', () => {
    expect(montantDeLigne(['05/03/2025', 'X', '1 234,56 EUR', ''], deux)).toEqual({ ecart: 'illisible' })
    expect(montantDeLigne(['05/03/2025', 'X', '', 'N/A'], deux)).toEqual({ ecart: 'illisible' })
    expect(montantDeLigne(['05/03/2025', 'X', '', ''], deux)).toEqual({ ecart: 'absent' })
    expect(montantDeLigne(['05/03/2025', 'X'], deux)).toEqual({ ecart: 'absent' })
  })
  it('refuse de deviner le sens : deux montants, ou un crédit négatif', () => {
    expect(montantDeLigne(['05/03/2025', 'X', '45,20', '120,00'], deux)).toEqual({ ecart: 'ambigu' })
    expect(montantDeLigne(['05/03/2025', 'X', '', '-120,00'], deux)).toEqual({ ecart: 'ambigu' })
  })
})

describe('colonnesParEntete', () => {
  it('reconnaît les variantes des banques : euros, EUR, €, accents, « opération »', () => {
    expect(colonnesParEntete([['Date', 'Libellé', 'Débit euros', 'Crédit euros']])).toMatchObject({ ligne: 0, date: 0, debit: 2, credit: 3 })
    expect(colonnesParEntete([['Date opération', 'Débit (EUR)', 'CREDIT (€)', 'Solde en euros']])).toMatchObject({ date: 0, debit: 1, credit: 2, solde: 3 })
    expect(colonnesParEntete([['Date de l\'opération', 'Libellé', 'Montant de l\'opération', 'Devise']])).toMatchObject({ date: 0, montant: 2 })
    expect(colonnesParEntete([['Date', 'Date de valeur', 'Montant(EUROS)']])).toMatchObject({ date: 0, dateValeur: 1, montant: 2 })
  })
  it('trouve l’en-tête après un préambule', () => {
    expect(colonnesParEntete([['Compte courant', '0123456789'], ['Période du 01/03/2025 au 31/03/2025'], ['Date', 'Libellé', 'Montant']]))
      .toMatchObject({ ligne: 2, date: 0, montant: 2 })
  })
  it('ne prend pas pour un en-tête une ligne sans colonne de montants, ni une opération', () => {
    expect(colonnesParEntete([['Date', 'Solde (EUR)']])).toBeNull()
    expect(colonnesParEntete([['05/03/2025', 'CB PHARMACIE', '-12,50']])).toBeNull()
    // Un libellé qui contient « débit » n'est pas l'en-tête d'une colonne.
    expect(colonnesParEntete([['Date', 'Libellé', 'Montant débité']])).toBeNull()
  })
})

describe('estUnSoldeCourant — un calcul, pas une supposition', () => {
  const montant = (r: string[]) => parseMontantBancaire(r[1])
  it('reconnaît un solde courant, du plus ancien au plus récent ou l’inverse', () => {
    const croissant = [['02/01', '-45,20', '1 954,80'], ['03/01', '120,00', '2 074,80'], ['06/01', '-89,00', '1 985,80']]
    expect(estUnSoldeCourant(croissant, 2, montant)).toBe(true)
    expect(estUnSoldeCourant([...croissant].reverse(), 2, montant)).toBe(true)
  })
  it('ne voit pas un solde dans une colonne qui n’en suit pas l’arithmétique, ni sur deux lignes', () => {
    expect(estUnSoldeCourant([['a', '-45,20', '10,00'], ['b', '120,00', '20,00'], ['c', '-89,00', '30,00']], 2, montant)).toBe(false)
    expect(estUnSoldeCourant([['a', '-45,20', '1 954,80'], ['b', '120,00', '2 074,80']], 2, montant)).toBe(false)
  })
})

// Les exports des banques françaises, en jeux fictifs : la détection, puis ce que l'import lirait.
describe('les exports des banques (fictifs)', () => {
  const montants = (r: ReturnType<typeof lire>) => r.releve.operations.map((o) => [o.libelle, o.montant])

  it('CIC / Crédit Mutuel : Débit négatif, Crédit, et une colonne Solde qui n’est jamais un montant', () => {
    const r = lire(utf8([
      'Date;Date de valeur;Débit;Crédit;Libellé;Solde',
      '02/01/2025;02/01/2025;-45,20;;CB PHARMACIE DU CENTRE;1 954,80',
      '03/01/2025;03/01/2025;;120,00;VIR CPAM DES YVELINES;2 074,80',
    ].join('\r\n')))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colDebit: 2, colCredit: 3, colSolde: 5, colLibelle: 4, hasHeader: true })
    expect(montants(r)).toEqual([['CB PHARMACIE DU CENTRE', -45.2], ['VIR CPAM DES YVELINES', 120]])
  })

  it('Crédit Agricole : préambule, « Débit euros » positif, windows-1252 et le symbole euro', () => {
    const r = lire(octetsWindows1252([
      'Téléchargement du 01/04/2025;',
      'Compte de dépôt n° 12345678901;',
      'Date;Libellé;Débit euros;Crédit euros;',
      '02/01/2025;CB PHARMACIE DE LA GARE;45,20 €;;',
      '06/01/2025;PRLV ORANGE;89,00 €;;',
      '07/01/2025;VIR CPAM DES BOUCHES-DU-RHÔNE;;120,00 €;',
    ].join('\r\n')))
    expect(r.encodage).toBe('windows-1252')
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDebit: 2, colCredit: 3, colSolde: null, doute: null })
    expect(montants(r)).toEqual([['CB PHARMACIE DE LA GARE', -45.2], ['PRLV ORANGE', -89], ['VIR CPAM DES BOUCHES-DU-RHÔNE', 120]])
    // Les lignes de préambule et d'en-tête restées sous la première ligne se COMPTENT, jamais en silence.
    expect(r.releve.ecartees).toEqual([{ raison: 'date illisible', nombre: 2 }])
  })

  it('Société Générale : préambule, « Montant de l’opération » signé, la colonne Devise ignorée', () => {
    const r = lire(utf8([
      '="0123456789";Compte courant;',
      'Date de l\'opération;Libellé;Détail de l\'écriture;Montant de l\'opération;Devise',
      '05/03/2025;CARTE X1234;CARTE X1234 04/03 PHARMACIE;-12,50;EUR',
      '07/03/2025;VIR RECU;VIR RECU DE CPAM;120,00;EUR',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 3, colDate: 0 })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-12.5, 120])
  })

  it('BNP Paribas : « Date opération » et « Montant opération »', () => {
    const r = lire(utf8([
      'Date opération;Libellé court;Type opération;Libellé opération;Montant opération',
      '05/03/2025;CB PHARMACIE;CARTE;FACTURE CARTE DU 04/03 PHARMACIE;-12,50',
      '07/03/2025;VIR CPAM;VIREMENT;VIR SEPA RECU CPAM;120,00',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 4, colDate: 0 })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-12.5, 120])
  })

  it('La Banque Postale : un préambule qui porte un solde, puis « Montant(EUROS) »', () => {
    const r = lire(utf8([
      'Numéro Compte;0123456X020',
      'Type;CCP',
      'Date;Solde (EUR)',
      '31/03/2025;1 020,00',
      '',
      'Date;Libellé;Montant(EUROS)',
      '05/03/2025;ACHAT CB PHARMACIE;-12,50',
      '07/03/2025;VIREMENT DE CPAM;120,00',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 2, colDate: 0 })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-12.5, 120])
  })

  it('Caisse d’Épargne : « Numéro d’opération » numérique, Débit négatif', () => {
    const r = lire(utf8([
      'Date;Numéro d\'opération;Libellé;Débit;Crédit;Détail;',
      '05/03/2025;1234567;CB PHARMACIE;-12,50;;CB PHARMACIE 04/03;',
      '07/03/2025;1234568;VIR CPAM;;120,00;VIR SEPA CPAM;',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDebit: 3, colCredit: 4, colLibelle: 5 })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-12.5, 120])
  })

  it('LCL : sans en-tête, montant signé, lignes de solde plus courtes', () => {
    const r = lire(utf8([
      '01/03/2025;1 000,00;;SOLDE',
      '05/03/2025;-12,50;Carte;CB PHARMACIE;;',
      '07/03/2025;120,00;Virement;VIR CPAM;;',
      '31/03/2025;1 107,50;;SOLDE',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 1, hasHeader: false })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-12.5, 120])
    expect(r.releve.soldes).toEqual([{ date: '2025-03-01', montant: 1000 }, { date: '2025-03-31', montant: 1107.5 }])
  })

  it('sans en-tête, deux colonnes exclusives dont une négative : un Débit / Crédit, sans doute', () => {
    const r = lire(utf8('05/03/2025;CB PHARMACIE;-12,50;\n06/03/2025;PRLV ORANGE;-40,00;\n07/03/2025;VIR CPAM;;120,00\n'))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDebit: 2, colCredit: 3, doute: null })
  })

  it('sans en-tête, deux colonnes exclusives toutes deux positives : la première est le débit, et la détection le DIT', () => {
    const r = lire(utf8('05/03/2025;CB PHARMACIE;12,50;\n06/03/2025;PRLV ORANGE;40,00;\n07/03/2025;VIR CPAM;;120,00\n'))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDebit: 2, colCredit: 3 })
    expect(r.detection.doute).toMatch(/la colonne 3 est prise pour le débit, la colonne 4 pour le crédit/)
  })

  it('sans en-tête, un solde courant placé AVANT le montant n’est pas pris pour le montant', () => {
    const r = lire(utf8([
      '02/01/2025;CB PHARMACIE;1 954,80;-45,20',
      '03/01/2025;VIR CPAM;2 074,80;120,00',
      '06/01/2025;PRLV ORANGE;1 985,80;-89,00',
    ].join('\n')))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 3, colSolde: 2 })
    expect(r.releve.operations.map((o) => o.montant)).toEqual([-45.2, 120, -89])
  })

  it('une ligne d’en-tête en débit / crédit dont la première opération est un crédit reste lue', () => {
    // La première ligne a sa colonne Débit vide : lue en montant signé, elle passait pour un en-tête, et l'opération
    // disparaissait sans être comptée.
    const rows = parseCsv('07/01/2025;VIR CPAM;;120,00\n05/03/2025;CB PHARMACIE;-12,50;\n06/03/2025;PRLV ORANGE;-40,00;\n')
    expect(detectColumnMapping(rows).hasHeader).toBe(false)
  })
})

describe('libelleDeLigne — les autres colonnes de montants', () => {
  it('ne recopie ni le débit, ni le crédit, ni le solde courant dans un libellé reconstitué', () => {
    const mapping = { colDate: 0, colMontant: 2, colLibelle: 4, hasHeader: true, autresMontants: [2, 3, 5] }
    expect(libelleDeLigne(['02/01/2025', '02/01/2025', '-45,20', '', '', '1 954,80', 'Carte'], mapping)).toBe('02/01/2025 Carte')
  })
  it('sans autres colonnes déclarées, rien ne change', () => {
    expect(libelleDeLigne(['02/01/2025', '-45,20', '', 'X'], { colDate: 0, colMontant: 1, colLibelle: 2, hasHeader: true })).toBe('X')
  })
})

describe('les lignes de solde — la forme d’un solde', () => {
  it('reconnaît ce qu’écrivent les banques', () => {
    for (const t of ['SOLDE CREDITEUR AU 28/02/2025', 'Nouveau solde', 'Solde précédent', 'SOLDE EN FIN DE PERIODE',
      'Ancien solde au 31 mars 2025', 'Solde au 31/03/2025 compte n° 12345', 'SOLDE', 'Solde (EUR)', 'SOLDE DEBITEUR AU 31.03.25']) {
      expect(aLaFormeDUnSolde(t), t).toBe(true)
    }
  })
  it('garde une opération dont le libellé dit « solde »', () => {
    for (const t of ['VIR M DUPONT SOLDE NOTE HONORAIRES', 'LES SOLDES DU PORT', 'CB SOLDERIE', 'PRLV SOLDE CARTE', 'VIR SOLDE']) {
      expect(aLaFormeDUnSolde(t), t).toBe(false)
    }
  })
  it('lignesDeSolde ne retient que les deux vrais soldes', () => {
    const rows = [
      ['01/03/2025', 'SOLDE CREDITEUR AU 28/02/2025', '1 000,00'],
      ['05/03/2025', 'VIR M DUPONT SOLDE NOTE HONORAIRES', '60,00'],
      ['31/03/2025', 'SOLDE CREDITEUR AU 31/03/2025', '1 060,00'],
    ]
    expect(lignesDeSolde(rows, { colDate: 0, colLibelle: 1, colMontant: 2, hasHeader: false }).map((l) => l.index)).toEqual([0, 2])
  })
  it('le chemin PDF ne coche plus « solde » une recette qui dit le mot', () => {
    const lignes = ['SOLDE AU 01/03/2025 1 000,00', '05/03/2025 VIR M DUPONT SOLDE NOTE HONORAIRES 60,00', 'SOLDE AU 31/03/2025 1 060,00']
      .map((texte) => ({ texte, xFin: 0 }))
    expect(parseLignesFromPdf(lignes, 'signe', 'tous').map((l) => l.estSolde)).toEqual([true, false, true])
    expect(parseLignesFromPdf(lignes).map((l) => l.montant)).toEqual([60])
  })
  it('dit un relevé qui n’a pas exactement deux soldes', () => {
    expect(phraseDesSoldes(2)).toBeNull()
    expect(phraseDesSoldes(0)).toMatch(/Aucune ligne de solde reconnue/)
    expect(phraseDesSoldes(1)).toMatch(/^1 ligne de solde reconnue, alors qu’il en faut exactement deux/)
    expect(phraseDesSoldes(3)).toMatch(/^3 lignes de solde reconnues/)
  })
})

describe('interpreterReleve', () => {
  const reglage = (o: Partial<ReglageDeLImport> = {}): ReglageDeLImport => ({
    colDate: 0, colLibelle: 1, hasHeader: true, format: 'debit_credit', colMontant: 2, colDebit: 2, colCredit: 3, colSolde: null, ...o,
  })
  it('écarte et compte chaque ligne dont un champ ne se lit pas, avec sa raison', () => {
    const r = interpreterReleve([
      ['05/03/2025', 'PRLV LOYER', '1 234,56 EUR', ''],
      ['31/02/2025', 'DATE FAUSSE', '10,00', ''],
      ['06/03/2025', 'COMMENTAIRE', '', ''],
      ['07/03/2025', 'FRAIS OFFERTS', '0,00', ''],
      ['08/03/2025', 'DEUX MONTANTS', '10,00', '20,00'],
      ['09/03/2025', 'VIR CPAM', '', '120,00'],
    ], reglage())
    expect(r.operations.map((o) => o.montant)).toEqual([120])
    expect(r.ecartees).toEqual([
      { raison: 'date illisible', nombre: 1 }, { raison: 'sans montant', nombre: 1 }, { raison: 'montant illisible', nombre: 1 },
      { raison: 'débit et crédit à la fois', nombre: 1 }, { raison: 'montant nul', nombre: 1 },
    ])
    expect(phraseDesEcartees(r.ecartees)).toBe('5 ignorée(s) (1 date illisible, 1 sans montant, 1 montant illisible, 1 débit et crédit à la fois, 1 montant nul)')
    expect(phraseDesEcartees([])).toBeNull()
  })
  it('garde un solde à zéro, refuse une opération à zéro', () => {
    const r = interpreterReleve([
      ['01/03/2025', 'SOLDE AU 28/02/2025', '', '0,00'],
      ['05/03/2025', 'VIR CPAM', '', '120,00'],
      ['06/03/2025', 'RIEN', '0,00', ''],
      ['31/03/2025', 'SOLDE AU 31/03/2025', '', '120,00'],
    ], reglage())
    expect(r.soldes).toEqual([{ date: '2025-03-01', montant: 0 }, { date: '2025-03-31', montant: 120 }])
    expect(r.operations).toHaveLength(1)
  })
  it('ne fait jamais entrer le solde courant dans le libellé reconstitué', () => {
    const r = interpreterReleve([['05/03/2025', '', '-12,50', '', '1 954,80']], reglage({ colSolde: 4 }))
    expect(r.operations[0].libelle).toBe('Mouvement bancaire')
    expect(r.operations[0].brut).toBe('05/03/2025 |  | -12,50 |  | 1 954,80')
  })
})

describe('refusDuReglage', () => {
  const base: ReglageDeLImport = { colDate: 0, colLibelle: 4, hasHeader: true, format: 'debit_credit', colMontant: 2, colDebit: 2, colCredit: 3, colSolde: 5 }
  it('refuse le solde courant pris pour un montant, dans les deux formats', () => {
    expect(refusDuReglage({ ...base, format: 'signe', colMontant: 5 })).toMatch(/La colonne 6 est celle du solde courant/)
    expect(refusDuReglage({ ...base, colCredit: 5 })).toMatch(/La colonne 6 est celle du solde courant/)
  })
  it('refuse Débit et Crédit sur la même colonne', () => {
    expect(refusDuReglage({ ...base, colCredit: 2 })).toMatch(/même/)
  })
  it('laisse passer un réglage juste', () => {
    expect(refusDuReglage(base)).toBeNull()
    expect(refusDuReglage({ ...base, format: 'signe', colMontant: 2, colSolde: null })).toBeNull()
  })
})

describe('douteDuSens', () => {
  it('dit un relevé en montant signé sans aucun débit', () => {
    expect(douteDuSens({ format: 'signe' }, [{ montant: 45.2 }, { montant: 89 }, { montant: 120 }])).toMatch(/Aucun débit parmi les 3 opérations/)
  })
  it('se tait sur un relevé qui a un débit, sur deux colonnes, ou sur moins de trois lignes', () => {
    expect(douteDuSens({ format: 'signe' }, [{ montant: 45.2 }, { montant: -89 }, { montant: 120 }])).toBeNull()
    expect(douteDuSens({ format: 'debit_credit' }, [{ montant: 45.2 }, { montant: 89 }, { montant: 120 }])).toBeNull()
    expect(douteDuSens({ format: 'signe' }, [{ montant: 45.2 }, { montant: 89 }])).toBeNull()
  })
})

describe('partagerParMultiplicite', () => {
  const pharmacie = { date: '2025-03-05', libelle: 'CB PHARMACIE DU CENTRE', montant: -12.5 }
  it('importe n − m occurrences d’une même signature, jamais dédoublonnées à l’intérieur du fichier', () => {
    expect(partagerParMultiplicite([pharmacie, pharmacie], [])).toEqual({ nouvelles: [pharmacie, pharmacie], dejaPresentes: 0 })
    expect(partagerParMultiplicite([pharmacie, pharmacie], [pharmacie])).toEqual({ nouvelles: [pharmacie], dejaPresentes: 1 })
    expect(partagerParMultiplicite([pharmacie, pharmacie], [pharmacie, pharmacie])).toEqual({ nouvelles: [], dejaPresentes: 2 })
    expect(partagerParMultiplicite([pharmacie], [pharmacie, pharmacie])).toEqual({ nouvelles: [], dejaPresentes: 1 })
  })
  it('distingue au centime, au libellé et à la date', () => {
    const autres = [{ ...pharmacie, montant: -12.51 }, { ...pharmacie, libelle: 'CB PHARMACIE' }, { ...pharmacie, date: '2025-03-06' }]
    expect(partagerParMultiplicite(autres, [pharmacie]).nouvelles).toEqual(autres)
    expect(signatureMouvement(pharmacie)).toBe('2025-03-05|CB PHARMACIE DU CENTRE|-12.50')
  })
})

describe('recouvrements', () => {
  const ligne = (date: string, source_fichier: string | null) => ({ date, source_fichier })
  const fevrier = [ligne('2025-02-03', 'fevrier.pdf'), ligne('2025-03-01', 'fevrier.pdf')]
  const mars = [ligne('2025-03-03', 'mars.pdf'), ligne('2025-03-28', 'mars.pdf')]
  it('trouve le même mois importé sous un autre nom', () => {
    const r = recouvrements(['2025-03-03', '2025-03-28'], [...fevrier, ...mars], 'mars.csv')
    expect(r).toEqual([{ source: 'mars.pdf', du: '2025-03-03', au: '2025-03-28', mouvements: 2 }])
    expect(phraseDesRecouvrements(r)).toMatch(/« mars\.pdf » — 2 mouvement\(s\) du 03\/03\/2025 au 28\/03\/2025\. Si c’est le même relevé/)
  })
  it('ne voit pas un recouvrement entre deux mois qui se touchent au jour près', () => {
    expect(recouvrements(['2025-03-01', '2025-03-31'], fevrier, 'mars.csv')).toEqual([])
  })
  it('ignore le fichier en cours, que le dédoublonnage reconnaît ligne à ligne', () => {
    expect(recouvrements(['2025-03-03', '2025-03-28'], mars, 'mars.pdf')).toEqual([])
  })
  it('nomme les mouvements sans fichier d’origine (connexion bancaire)', () => {
    const r = recouvrements(['2025-03-03', '2025-03-28'], [ligne('2025-03-02', null), ligne('2025-03-30', null)], 'mars.csv')
    expect(phraseDesRecouvrements(r)).toMatch(/des mouvements sans fichier d’origine \(connexion bancaire, import ancien\)/)
  })
  it('se tait sans rien à importer, ou sans recouvrement', () => {
    expect(recouvrements([], mars, 'x.csv')).toEqual([])
    expect(phraseDesRecouvrements([])).toBeNull()
  })
})

// Le type rendu par la détection porte tout ce que l'écran règle : une forme qui en perdrait un champ ne compilerait pas.
const _detectionComplete: (d: DetectionDesColonnes) => ReglageDeLImport = (d) => d
void _detectionComplete
