import { beforeEach, describe, expect, it, vi } from 'vitest'
import { colonneDeLaDateDeValeur, libelleDeLigne } from './csv'
import { AUCUNE_DECISION, interpreterReleve, mappingDuReglage, refusDuReglage, type ReglageDeLImport } from './importReleve'
import { colonneDeLaDateDeValeurDuReleve, lireReleveOfxQif, REGLAGE_OFX_QIF, type ReleveOfxQifLu } from './releveOfxQif'

// EXP58-Q4 : LA DATE DE VALEUR À L'IMPORT D'UN RELEVÉ — reconnue par l'en-tête d'un CSV, lue de DTAVAIL dans un OFX, gardée
// sur chaque opération ou écartée et comptée, jamais dans le dédoublonnage. Le drapeau (`DATE_DE_VALEUR_PREVUE`) se joue dans
// ses deux états par un accesseur : baissé, ce qui se lit est celui d'hier, à l'octet. Fichiers FICTIFS.

const drapeau = vi.hoisted(() => ({ leve: false }))
vi.mock('./dateDeValeur', async (original) => {
  const module = await original<typeof import('./dateDeValeur')>()
  return { ...module, get DATE_DE_VALEUR_PREVUE() { return drapeau.leve } }
})
beforeEach(() => { drapeau.leve = false })

// Un export à la forme du Crédit Mutuel et du CIC : la date de valeur entre la date et les montants.
const CSV = [
  ['Date', 'Date de valeur', 'Débit', 'Crédit', 'Libellé', 'Solde'],
  ['30/12/2025', '02/01/2026', '', '250,00', 'REM CHQ FICTIVE', '1250,00'],
  ['05/01/2026', '', '-40,00', '', 'PRLV FICTIF', '1210,00'],
  ['06/01/2026', '31/02/2026', '-10,00', '', 'CB FICTIVE', '1200,00'],
  ['07/01/2026', '07/06/2026', '-5,00', '', '', '1195,00'],
]
const REGLAGE: ReglageDeLImport = {
  colDate: 0, colLibelle: 4, hasHeader: true, format: 'debit_credit', colMontant: 2, colDebit: 2, colCredit: 3, colSolde: 5,
}

describe('le CSV', () => {
  it('l’en-tête nomme la colonne de la date de valeur ; sans en-tête, elle ne se devine pas', () => {
    expect(colonneDeLaDateDeValeur(CSV)).toBe(1)
    expect(colonneDeLaDateDeValeur([['Date valeur', 'Date', 'Montant']])).toBe(0)
    expect(colonneDeLaDateDeValeur(CSV.slice(1))).toBeNull()
  })

  it('sans colonne de la date de valeur : l’interprétation d’hier, à l’octet', () => {
    const lu = interpreterReleve(CSV.slice(1), REGLAGE, AUCUNE_DECISION)
    expect(lu.datesDeValeur).toBeUndefined()
    for (const o of lu.operations) expect(Object.keys(o)).toEqual(['date', 'libelle', 'montant', 'brut'])
    for (const l of lu.lignes) expect(l).not.toHaveProperty('valeur')
    expect(mappingDuReglage(REGLAGE)).not.toHaveProperty('colDateValeur')
    expect(mappingDuReglage({ ...REGLAGE, colDateValeur: null })).not.toHaveProperty('colDateValeur')
    // Un libellé vide se reconstitue des autres colonnes, la date de valeur comprise, comme hier.
    expect(lu.operations[3].libelle).toBe('07/06/2026')
  })

  it('avec elle : chaque opération porte la sienne, ou rien, et ce qui s’écarte se compte', () => {
    const lu = interpreterReleve(CSV.slice(1), { ...REGLAGE, colDateValeur: 1 }, AUCUNE_DECISION)
    expect(lu.operations.map((o) => [o.date, o.dateValeur])).toEqual([
      ['2025-12-30', '2026-01-02'], ['2026-01-05', null], ['2026-01-06', null], ['2026-01-07', null],
    ])
    expect(lu.datesDeValeur).toEqual({ gardees: 1, sans: 1, illisibles: 1, eloignees: 1 })
    expect(lu.lignes.map((l) => (l.nature === 'operation' ? l.valeur : 'autre'))).toEqual([
      { date: '2026-01-02' }, null, { ecart: 'illisible' }, { ecart: 'eloignee' },
    ])
    // Lue dans son champ, elle n'entre plus dans un libellé reconstitué ; la date, le libellé et le montant — la signature
    // du dédoublonnage — restent ceux de la ligne.
    expect(lu.operations[3].libelle).toBe('Mouvement bancaire')
    expect(lu.operations.map((o) => [o.libelle, o.montant])).toEqual([
      ['REM CHQ FICTIVE', 250], ['PRLV FICTIF', -40], ['CB FICTIVE', -10], ['Mouvement bancaire', -5],
    ])
  })

  it('une colonne déjà lue pour autre chose se refuse comme colonne de la date de valeur', () => {
    expect(refusDuReglage({ ...REGLAGE, colDateValeur: 1 })).toBeNull()
    expect(refusDuReglage({ ...REGLAGE, colDateValeur: 0 })).toMatch(/déjà lue comme la date d’opération/)
    expect(refusDuReglage({ ...REGLAGE, colDateValeur: 4 })).toMatch(/déjà lue comme le libellé/)
    expect(refusDuReglage({ ...REGLAGE, colDateValeur: 3 })).toMatch(/déjà lue comme un montant/)
    expect(refusDuReglage({ ...REGLAGE, colDateValeur: 5 })).toMatch(/déjà lue comme le solde courant/)
  })

  it('libelleDeLigne n’écarte la colonne que si le réglage la lit', () => {
    const ligne = ['05/01/2026', '06/01/2026', '', 'REF 42']
    const mapping = { colDate: 0, colLibelle: 2, colMontant: 3, hasHeader: false }
    expect(libelleDeLigne(ligne, mapping)).toBe('06/01/2026')
    expect(libelleDeLigne(ligne, { ...mapping, colDateValeur: 1 })).toBe('')
  })
})

// Un OFX 2.x minimal, FICTIF : DTAVAIL sur la première opération, absente sur la seconde, d'une forme inconnue sur la troisième.
const OFX = ['<?xml version="1.0" encoding="UTF-8"?>', '<?OFX OFXHEADER="200" VERSION="220"?>', '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>',
  '<CURDEF>EUR</CURDEF><BANKTRANLIST>',
  '<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260102</DTPOSTED><DTAVAIL>20251231</DTAVAIL><TRNAMT>80.00</TRNAMT><NAME>VIR FICTIF</NAME></STMTTRN>',
  '<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260105</DTPOSTED><TRNAMT>-12.00</TRNAMT><NAME>CB FICTIVE</NAME></STMTTRN>',
  '<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260106</DTPOSTED><DTAVAIL>J+1</DTAVAIL><TRNAMT>-3.00</TRNAMT><NAME>FRAIS FICTIFS</NAME></STMTTRN>',
  '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'].join('\n')

function lu(texte: string): ReleveOfxQifLu {
  const l = lireReleveOfxQif(texte)
  if (!l || l.refus !== null) throw new Error(`refusé : ${l?.refus}`)
  return l
}

const SANS_DTAVAIL = OFX.split('\n').map((l) => l.replace(/<DTAVAIL>[^<]*<\/DTAVAIL>/, '')).join('\n')

describe('l’OFX', () => {
  it('drapeau levé, aucun DTAVAIL dans le fichier : les trois colonnes d’hier', () => {
    drapeau.leve = true
    expect(lu(SANS_DTAVAIL).lignes.map((l) => l.length)).toEqual([3, 3, 3])
  })

  it('drapeau baissé : trois colonnes, DTAVAIL ignoré, aucune colonne de date de valeur au réglage', () => {
    expect(lu(OFX).lignes).toEqual([['2026-01-02', 'VIR FICTIF', '80'], ['2026-01-05', 'CB FICTIVE', '-12'], ['2026-01-06', 'FRAIS FICTIFS', '-3']])
    expect(colonneDeLaDateDeValeurDuReleve('ofx-xml')).toBeNull()
  })

  it('drapeau levé : DTAVAIL en quatrième colonne de TOUTES les opérations, vide où il manque, gardé ou compté illisible', () => {
    drapeau.leve = true
    const lecture = lu(OFX)
    // Une opération sans DTAVAIL garde la largeur des autres : plus courte, `lignesDeSolde` la prendrait pour un solde.
    expect(lecture.lignes).toEqual([
      ['2026-01-02', 'VIR FICTIF', '80', '2025-12-31'], ['2026-01-05', 'CB FICTIVE', '-12', ''],
      ['2026-01-06', 'FRAIS FICTIFS', '-3', 'forme non reconnue : J+1'],
    ])
    const colonne = colonneDeLaDateDeValeurDuReleve('ofx-xml')
    expect(colonne).toBe(3)
    expect(colonneDeLaDateDeValeurDuReleve('ofx-sgml')).toBe(3)
    expect(colonneDeLaDateDeValeurDuReleve('qif')).toBeNull()
    const interpretation = interpreterReleve(lecture.lignes, { ...REGLAGE_OFX_QIF, colDateValeur: colonne }, AUCUNE_DECISION)
    expect(interpretation.operations.map((o) => o.dateValeur)).toEqual(['2025-12-31', null, null])
    expect(interpretation.datesDeValeur).toEqual({ gardees: 1, sans: 1, illisibles: 1, eloignees: 0 })
    expect(interpretation.soldes).toEqual([])
    // Le libellé et le montant, la signature du dédoublonnage, sont ceux d'hier.
    expect(interpretation.operations.map((o) => `${o.date}|${o.libelle}|${o.montant}`))
      .toEqual(['2026-01-02|VIR FICTIF|80', '2026-01-05|CB FICTIVE|-12', '2026-01-06|FRAIS FICTIFS|-3'])
  })
})
