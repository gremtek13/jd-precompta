// LE RELEVÉ IMPORTÉ EN OFX OU EN QIF : la reconnaissance au contenu, la lecture sous le réglage fixe, et chaque refus. Les
// fichiers sont FICTIFS, écrits ici à la forme des exports des banques (code banque 99999, libellés inventés) ; ils passent
// ensuite par les fonctions mêmes de l'import d'un CSV (`interpreterReleve`), pour que ce qui est vérifié soit ce qui
// s'écrit.
import { describe, expect, it } from 'vitest'
import { AUCUNE_DECISION, douteDuSens, interpreterReleve } from './importReleve'
import { controlerSolde, phraseDesSoldes } from './soldeReleve'
import {
  decoderReleve, formatOfxQif, lireReleveOfxQif, phraseDesSensDouteux, phraseDuSoldeAnnonce, REGLAGE_OFX_QIF,
  type LectureOfxQif, type ReleveOfxQifLu,
} from './releveOfxQif'

const utf8 = (texte: string) => new TextEncoder().encode(texte)
// Un fichier tel qu'une banque l'écrit en windows-1252 : chaque caractère sur un octet (é = 0xE9).
const octetsWindows1252 = (texte: string) => Uint8Array.from([...texte].map((c) => c.charCodeAt(0)))

const ENTETE_SGML = (charset = '1252', encodage = 'USASCII') => [
  'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', `ENCODING:${encodage}`, `CHARSET:${charset}`,
  'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
].join('\r\n')

interface OperationFictive { type: string; date: string; montant: string; nom?: string; memo?: string }

// Un STMTRS au format SGML (feuilles non fermées), tel que l'exportent les banques françaises en « Money ».
function stmtrsSgml(operations: readonly OperationFictive[], { devise = 'EUR', solde = '1234.56', au = '20261130' } = {}): string {
  return [
    '<STMTRS>', `<CURDEF>${devise}`,
    '<BANKACCTFROM>', '<BANKID>99999', '<BRANCHID>00001', '<ACCTID>00012345678', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', '<DTSTART>20261101', '<DTEND>20261130',
    ...operations.flatMap((o, i) => [
      '<STMTTRN>', `<TRNTYPE>${o.type}`, `<DTPOSTED>${o.date}`, `<TRNAMT>${o.montant}`, `<FITID>FICTIF${i}`,
      ...(o.nom !== undefined ? [`<NAME>${o.nom}`] : []), ...(o.memo !== undefined ? [`<MEMO>${o.memo}`] : []), '</STMTTRN>',
    ]),
    '</BANKTRANLIST>',
    ...(solde === '' ? [] : ['<LEDGERBAL>', `<BALAMT>${solde}`, `<DTASOF>${au}`, '</LEDGERBAL>']),
    '</STMTRS>',
  ].join('\r\n')
}

function ofxSgml(stmtrs: readonly string[], entete = ENTETE_SGML()): string {
  return `${entete}\r\n<OFX>\r\n<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261201<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>\r\n`
    + `<BANKMSGSRSV1>\r\n${stmtrs.map((s) => `<STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>\r\n${s}\r\n</STMTTRNRS>`).join('\r\n')}`
    + '\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n'
}

const OPERATIONS: OperationFictive[] = [
  { type: 'DEBIT', date: '20261103', montant: '-45.20', nom: 'CB PHARMACIE FICTIVE', memo: 'CB PHARMACIE FICTIVE' },
  { type: 'CREDIT', date: '20261105120000', montant: '250,00', nom: 'VIR PATIENT FICTIF', memo: 'HONORAIRES OCTOBRE' },
  { type: 'DIRECTDEBIT', date: '20261110', montant: '-89.9', nom: 'PRLV ASSURANCE FICTIVE' },
]

function lu(l: LectureOfxQif | null): ReleveOfxQifLu {
  if (l === null || l.refus !== null) throw new Error(`Lecture refusée : ${l?.refus ?? 'pas un OFX ni un QIF'}`)
  return l
}
const refus = (l: LectureOfxQif | null) => (l && l.refus !== null ? l.refus : null)
const interpreter = (l: ReleveOfxQifLu) => interpreterReleve(l.lignes, REGLAGE_OFX_QIF, AUCUNE_DECISION)

describe('la reconnaissance, au contenu', () => {
  it('reconnaît l’OFX 1.x à son en-tête, l’OFX 2.x à sa déclaration, le QIF à son type', () => {
    expect(formatOfxQif(ofxSgml([stmtrsSgml(OPERATIONS)]))).toBe('ofx-sgml')
    expect(formatOfxQif('<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="211"?>\n<OFX></OFX>')).toBe('ofx-xml')
    expect(formatOfxQif('﻿!Type:Bank\nD05/11/2026\nT-1,00\n^')).toBe('qif')
  })
  it('et un CSV n’en est pas un, même s’il nomme OFX dans son libellé', () => {
    expect(formatOfxQif('Date;Libellé;Montant\n02/06/2025;OFXHEADER:100;-1,00')).toBeNull()
    expect(lireReleveOfxQif('Date;Libellé;Montant\n02/06/2025;VIR;1,00')).toBeNull()
  })
})

describe('l’OFX 1.x (SGML)', () => {
  it('rend la date, le libellé et le montant signé sous le réglage fixe, et l’import les lit comme un CSV', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS)])))
    expect(l.format).toBe('ofx-sgml')
    const releve = interpreter(l)
    expect(releve.operations.map(({ date, libelle, montant }) => ({ date, libelle, montant }))).toEqual([
      // NAME et MEMO égaux : un seul des deux.
      { date: '2026-11-03', libelle: 'CB PHARMACIE FICTIVE', montant: -45.2 },
      { date: '2026-11-05', libelle: 'VIR PATIENT FICTIF — HONORAIRES OCTOBRE', montant: 250 },
      { date: '2026-11-10', libelle: 'PRLV ASSURANCE FICTIVE', montant: -89.9 },
    ])
    expect(douteDuSens(REGLAGE_OFX_QIF, releve.operations)).toBeNull()
    expect(l.sensDouteux).toEqual([])
  })

  it('lit la virgule décimale, et écarte en le comptant un montant à trois décimales plutôt que de le multiplier par mille', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml([
      { type: 'DEBIT', date: '20261103', montant: '-12,5', nom: 'A' },
      { type: 'DEBIT', date: '20261104', montant: '-12.345', nom: 'B' },
      { type: 'DEBIT', date: '20261105', montant: '-7.500', nom: 'C' },
      { type: 'CREDIT', date: '20261106', montant: '', nom: 'D' },
      { type: 'CREDIT', date: '20261107', montant: '1,234.56', nom: 'E' },
    ])])))
    const releve = interpreter(l)
    expect(releve.operations.map((o) => [o.libelle, o.montant])).toEqual([['A', -12.5], ['C', -7.5]])
    expect(releve.ecartees).toEqual([{ raison: 'sans montant', nombre: 1 }, { raison: 'montant illisible', nombre: 2 }])
  })

  it('lit la date sur ses huit premiers chiffres, la date civile de la banque, jamais convertie de fuseau', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml([
      { type: 'DEBIT', date: '20261105230000.000[-5:EST]', montant: '-1.00', nom: 'SOIR A NEW YORK' },
      { type: 'DEBIT', date: '20261105003000[+1:CET]', montant: '-2.00', nom: 'NUIT A PARIS' },
      { type: 'DEBIT', date: '20261231235959[-10:HST]', montant: '-3.00', nom: 'FIN D ANNEE' },
      { type: 'DEBIT', date: '20260231', montant: '-4.00', nom: 'TRENTE ET UN FEVRIER' },
    ])])))
    const releve = interpreter(l)
    expect(releve.operations.map((o) => o.date)).toEqual(['2026-11-05', '2026-11-05', '2026-12-31'])
    expect(releve.ecartees).toEqual([{ raison: 'date illisible', nombre: 1 }])
  })

  it('dit le solde comptable, retenu comme solde par le mécanisme d’un CSV et jamais importé', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS, { solde: '1234,56', au: '20261130120000' })])))
    expect(l.soldeAnnonce).toEqual({ nature: 'comptable', date: '2026-11-30', montant: 1234.56 })
    const releve = interpreter(l)
    expect(releve.soldes).toEqual([{ date: '2026-11-30', montant: 1234.56 }])
    expect(releve.operations).toHaveLength(3)
    // Un seul solde : l'arithmétique ne se vérifie pas, et l'écran le dit, comme pour un CSV.
    expect(controlerSolde(releve.soldes, releve.operations)).toBeNull()
    expect(phraseDesSoldes(releve.soldes.length)).toMatch(/1 ligne de solde reconnue/)
    expect(phraseDuSoldeAnnonce(l.soldeAnnonce)).toMatch(/^Solde comptable donné par la banque au 30\/11\/2026 : 1\s234,56\s€\. Confronte-le/)
  })

  it('dit un solde comptable illisible, sans l’inventer', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS, { solde: 'N/A' })])))
    expect(l.soldeAnnonce).toBeNull()
    expect(l.doutes).toEqual([expect.stringMatching(/solde comptable du fichier \(LEDGERBAL\) ne se lit pas/)])
    expect(interpreter(l).soldes).toEqual([])
  })

  it('dit douteuse, sans la retourner, une opération dont le signe contredit le type', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml([
      { type: 'DEBIT', date: '20261103', montant: '45.20', nom: 'CB PHARMACIE FICTIVE' },
      { type: 'CREDIT', date: '20261104', montant: '-10.00', nom: 'VIR FICTIF' },
      { type: 'POS', date: '20261105', montant: '8.00', nom: 'REMBOURSEMENT CB' },
      { type: 'DEBIT', date: '20261106', montant: '-3.00', nom: 'FRAIS' },
    ])])))
    expect(l.sensDouteux).toEqual([
      { date: '2026-11-03', libelle: 'CB PHARMACIE FICTIVE', montant: 45.2, type: 'DEBIT' },
      { date: '2026-11-04', libelle: 'VIR FICTIF', montant: -10, type: 'CREDIT' },
    ])
    // Le montant entre avec SON signe : jamais retourné.
    expect(interpreter(l).operations.map((o) => o.montant)).toEqual([45.2, -10, 8, -3])
    expect(phraseDesSensDouteux(l.sensDouteux)).toMatch(/^2 opérations ont un montant dont le signe contredit le type.*jamais retourné/)
    expect(phraseDesSensDouteux([])).toBeNull()
  })

  it('ne garde ni le numéro du compte, ni le code banque, ni le guichet', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS)])))
    const tout = JSON.stringify(l) + JSON.stringify(interpreter(l))
    for (const identifiant of ['99999', '00001', '00012345678', 'CHECKING']) expect(tout).not.toContain(identifiant)
  })

  it('lit l’encodage que son en-tête déclare : windows-1252', () => {
    const octets = octetsWindows1252(ofxSgml([stmtrsSgml([{ type: 'DEBIT', date: '20261103', montant: '-5.00', nom: 'CB CAFÉ DE LA GARE' }])]))
    const { texte, encodage } = decoderReleve(octets)
    expect(encodage).toBe('windows-1252')
    expect(interpreter(lu(lireReleveOfxQif(texte))).operations[0].libelle).toBe('CB CAFÉ DE LA GARE')
  })

  it('et l’UTF-8 quand l’en-tête le dit, jusqu’à ce que les octets le démentent', () => {
    const texte = ofxSgml([stmtrsSgml([{ type: 'DEBIT', date: '20261103', montant: '-5.00', nom: 'CB CAFÉ' }])], ENTETE_SGML('NONE', 'UTF-8'))
    expect(decoderReleve(utf8(texte))).toEqual({ texte, encodage: 'utf-8' })
    // Un en-tête muet (CHARSET:NONE) sur des octets windows-1252 : le repli de `decoderUtf8OuWindows1252`.
    const muet = ofxSgml([stmtrsSgml([{ type: 'DEBIT', date: '20261103', montant: '-5.00', nom: 'CB CAFÉ' }])], ENTETE_SGML('NONE'))
    expect(decoderReleve(octetsWindows1252(muet)).encodage).toBe('windows-1252')
  })

  it('décode les entités d’un libellé', () => {
    const l = lu(lireReleveOfxQif(ofxSgml([stmtrsSgml([{ type: 'DEBIT', date: '20261103', montant: '-5.00', nom: 'DUPONT &amp; FILS' }])])))
    expect(l.lignes[0][1]).toBe('DUPONT & FILS')
  })
})

describe('l’OFX 2.x (XML)', () => {
  const xml = (corps: string) => '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
    + '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n'
    + `<OFX><BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>${corps}</STMTTRNRS></BANKMSGSRSV1></OFX>`

  it('lit les feuilles fermées, une feuille vide comprise', () => {
    const l = lu(lireReleveOfxQif(xml(
      '<STMTRS><CURDEF>EUR</CURDEF><BANKACCTFROM><BANKID>99999</BANKID><ACCTID>00012345678</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>'
      + '<BANKTRANLIST><DTSTART>20261101</DTSTART><DTEND>20261130</DTEND>'
      + '<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261103000000.000[+1:CET]</DTPOSTED><TRNAMT>-45.20</TRNAMT><FITID>X1</FITID><NAME>CB PHARMACIE FICTIVE</NAME><MEMO></MEMO></STMTTRN>'
      + '<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261105</DTPOSTED><TRNAMT>250.00</TRNAMT><FITID>X2</FITID><NAME>VIR PATIENT FICTIF</NAME><MEMO>HONORAIRES</MEMO></STMTTRN>'
      + '</BANKTRANLIST><LEDGERBAL><BALAMT>1500.00</BALAMT><DTASOF>20261130</DTASOF></LEDGERBAL></STMTRS>',
    )))
    expect(l.format).toBe('ofx-xml')
    expect(interpreter(l).operations.map((o) => [o.date, o.libelle, o.montant])).toEqual([
      ['2026-11-03', 'CB PHARMACIE FICTIVE', -45.2], ['2026-11-05', 'VIR PATIENT FICTIF — HONORAIRES', 250],
    ])
    expect(l.soldeAnnonce).toEqual({ nature: 'comptable', date: '2026-11-30', montant: 1500 })
  })

  it('lit la déclaration d’encodage windows-1252', () => {
    const texte = '<?xml version="1.0" encoding="windows-1252"?><?OFX OFXHEADER="200" VERSION="211"?><OFX></OFX>'
    expect(decoderReleve(octetsWindows1252(texte)).encodage).toBe('windows-1252')
  })

  it('refuse une opération dans une autre devise', () => {
    expect(refus(lireReleveOfxQif(xml(
      '<STMTRS><CURDEF>EUR</CURDEF><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261103</DTPOSTED><TRNAMT>-10.00</TRNAMT>'
      + '<NAME>ACHAT FICTIF</NAME><CURRENCY><CURRATE>1.1</CURRATE><CURSYM>USD</CURSYM></CURRENCY></STMTTRN></BANKTRANLIST></STMTRS>',
    )))).toMatch(/est en USD, pas en euros/)
  })
})

describe('les refus de l’OFX', () => {
  it('refuse plusieurs comptes dans un fichier', () => {
    expect(refus(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS), stmtrsSgml(OPERATIONS)])))).toMatch(/2 comptes : exporte un compte à la fois/)
  })
  it('refuse un relevé de carte, de placement, et dit lequel', () => {
    const carte = ofxSgml([]).replace('<BANKMSGSRSV1>', '<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR</CCSTMTRS></CCSTMTTRNRS>')
    expect(refus(lireReleveOfxQif(carte))).toMatch(/un relevé de carte bancaire/)
    const placement = ofxSgml([]).replace('<BANKMSGSRSV1>', '<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>EUR</INVSTMTRS>')
    expect(refus(lireReleveOfxQif(placement))).toMatch(/un relevé de placement/)
  })
  it('refuse une devise autre que l’euro, et une devise non dite', () => {
    expect(refus(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS, { devise: 'CHF' })])))).toMatch(/tenu en CHF, pas en euros/)
    expect(refus(lireReleveOfxQif(ofxSgml([stmtrsSgml(OPERATIONS).replace('<CURDEF>EUR\r\n', '')])))).toMatch(/ne dit pas sa devise/)
  })
  it('refuse un fichier sans relevé bancaire', () => {
    expect(refus(lireReleveOfxQif(ofxSgml([])))).toMatch(/aucun compte bancaire/)
    expect(refus(lireReleveOfxQif('OFXHEADER:100\r\nDATA:OFXSGML\r\n'))).toMatch(/pas de corps <OFX>/)
  })
  it('refuse une opération au libellé d’une ligne de solde, plutôt que de la perdre', () => {
    expect(refus(lireReleveOfxQif(ofxSgml([stmtrsSgml([{ type: 'CREDIT', date: '20261103', montant: '10.00', nom: 'SOLDE CREDITEUR' }])]))))
      .toMatch(/a le libellé d’une ligne de solde/)
  })
})

describe('le QIF', () => {
  const qif = (corps: string, type = 'Bank') => `!Type:${type}\r\n${corps}`

  it('lit la date jour/mois, le libellé P puis M, le montant à la virgule, et le solde d’ouverture comme un solde', () => {
    const l = lu(lireReleveOfxQif(qif([
      'D01/11/2026', 'T1 000,00', 'POpening Balance', 'L[Compte fictif]', '^',
      'D03/11/2026', 'T-45,20', 'PCB PHARMACIE FICTIVE', 'MCB PHARMACIE FICTIVE', '^',
      'D15/11/2026', 'T250,00', 'PVIR PATIENT FICTIF', 'MHONORAIRES', 'N123', 'LHonoraires', 'SHonoraires', '$250,00', '^',
      'D20.11.2026', 'T-1,234.56', 'PCHEQUE FICTIF', '^',
    ].join('\r\n'))))
    const releve = interpreter(l)
    expect(releve.operations.map((o) => [o.date, o.libelle, o.montant])).toEqual([
      ['2026-11-03', 'CB PHARMACIE FICTIVE', -45.2],
      ['2026-11-15', 'VIR PATIENT FICTIF — HONORAIRES', 250],
      ['2026-11-20', 'CHEQUE FICTIF', -1234.56],
    ])
    expect(releve.soldes).toEqual([{ date: '2026-11-01', montant: 1000 }])
    expect(l.soldeAnnonce).toEqual({ nature: 'ouverture', date: '2026-11-01', montant: 1000 })
    // Le nom du compte (« L[Compte fictif] », bloc !Account) ne s'écrit nulle part.
    expect(JSON.stringify(l)).not.toContain('Compte fictif')
  })

  it('écarte et compte un montant illisible, jamais zéro', () => {
    const releve = interpreter(lu(lireReleveOfxQif(qif('D13/11/2026\nT12 EUR\nPX\n^\nD14/11/2026\nPY\n^\nD15/11/2026\nT-1,00\nPZ\n^'))))
    expect(releve.operations.map((o) => o.libelle)).toEqual(['Z'])
    expect(releve.ecartees).toEqual([{ raison: 'sans montant', nombre: 1 }, { raison: 'montant illisible', nombre: 1 }])
  })

  it('refuse une année sur deux chiffres et l’apostrophe américaine', () => {
    expect(refus(lireReleveOfxQif(qif('D13/11/26\nT-1,00\nPX\n^')))).toMatch(/« 13\/11\/26 » ne dit pas son année sur quatre chiffres/)
    expect(refus(lireReleveOfxQif(qif('D11/13\'26\nT-1.00\nPX\n^')))).toMatch(/« 11\/13'26 »/)
  })

  it('refuse l’ordre mois/jour, et un ordre qu’aucune date ne prouve', () => {
    expect(refus(lireReleveOfxQif(qif('D11/13/2026\nT-1.00\nPX\n^')))).toMatch(/mois\/jour \(à l’américaine\)/)
    expect(refus(lireReleveOfxQif(qif('D05/11/2026\nT-1,00\nPX\n^\nD06/11/2026\nT-2,00\nPY\n^')))).toMatch(/Aucune date du fichier ne prouve/)
    // Une seule date qui passe 12 suffit à prouver l'ordre de tout le fichier.
    expect(interpreter(lu(lireReleveOfxQif(qif('D05/11/2026\nT-1,00\nPX\n^\nD16/11/2026\nT-2,00\nPY\n^')))).operations.map((o) => o.date))
      .toEqual(['2026-11-05', '2026-11-16'])
    // L'ISO ne demande aucune preuve.
    expect(lu(lireReleveOfxQif(qif('D2026-11-05\nT-1,00\nPX\n^'))).lignes).toEqual([['2026-11-05', 'X', '-1,00']])
  })

  it('refuse un relevé d’une autre nature, et dit lequel', () => {
    expect(refus(lireReleveOfxQif(qif('D13/11/2026\nT-1,00\n^', 'CCard')))).toMatch(/un relevé de carte bancaire \(!Type:CCard\)/)
    expect(refus(lireReleveOfxQif(qif('D13/11/2026\nT-1,00\n^', 'Invst')))).toMatch(/un relevé de placement/)
    expect(refus(lireReleveOfxQif(qif('D13/11/2026\nT-1,00\n^', 'Oth A')))).toMatch(/un compte d’actif/)
  })

  it('refuse plusieurs comptes', () => {
    const deux = '!Option:AutoSwitch\n!Account\nNCompte A\nTBank\n^\n!Type:Bank\nD13/11/2026\nT-1,00\n^\n'
      + '!Account\nNCompte B\nTBank\n^\n!Type:Bank\nD14/11/2026\nT-2,00\n^\n'
    expect(refus(lireReleveOfxQif(deux))).toMatch(/plusieurs comptes ou plusieurs listes : exporte un compte à la fois/)
    // Un seul compte déclaré se lit, son nom jamais repris.
    const un = '!Account\nNCompte A\nTBank\n^\n!Type:Bank\nD13/11/2026\nT-1,00\nPX\n^\n'
    expect(lu(lireReleveOfxQif(un)).lignes).toEqual([['2026-11-13', 'X', '-1,00']])
  })

  it('lit le windows-1252 par le repli, faute d’en-tête', () => {
    const { texte, encodage } = decoderReleve(octetsWindows1252('!Type:Bank\r\nD13/11/2026\r\nT-5,00\r\nPCB CAFÉ\r\n^\r\n'))
    expect(encodage).toBe('windows-1252')
    expect(lu(lireReleveOfxQif(texte)).lignes[0][1]).toBe('CB CAFÉ')
  })
})
