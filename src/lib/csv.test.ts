import { describe, expect, it } from 'vitest'
import { detectColumnMapping, parseCsv, parseDateBancaire, parseMontantBancaire } from './csv'

describe('parseMontantBancaire', () => {
  it('lit le format français courant', () => {
    expect(parseMontantBancaire('1 234,56')).toBe(1234.56)
    expect(parseMontantBancaire('1 234,56')).toBe(1234.56) // espace insécable
    expect(parseMontantBancaire('1 234,56')).toBe(1234.56) // espace fine insécable
    expect(parseMontantBancaire('-45,20')).toBe(-45.2)
    expect(parseMontantBancaire('45,20 €')).toBe(45.2)
  })

  it('ne suppose pas quel séparateur porte les décimales', () => {
    // Selon la banque, le point sépare les milliers ou les décimales. L'ancienne version
    // remplaçait la première virgule par un point et laissait parseFloat s'arrêter au séparateur
    // suivant : ces deux montants devenaient 1,23 €.
    expect(parseMontantBancaire('1.234,56')).toBe(1234.56)
    expect(parseMontantBancaire('1,234.56')).toBe(1234.56)
    expect(parseMontantBancaire('1.234.567,89')).toBe(1234567.89)
  })

  it('traite un séparateur suivi de trois chiffres comme des milliers', () => {
    // Un montant n'a jamais trois décimales : "1.234" vaut mille deux cent trente-quatre.
    expect(parseMontantBancaire('1.234')).toBe(1234)
    expect(parseMontantBancaire('1,234')).toBe(1234)
    expect(parseMontantBancaire('12,50')).toBe(12.5) // deux chiffres : bien des décimales
  })

  it('reconnaît un signe rejeté en fin ou porté par des parenthèses', () => {
    // Sans cela, un débit ressortait en crédit — le sens de l'opération inversé en silence.
    expect(parseMontantBancaire('45,20-')).toBe(-45.2)
    expect(parseMontantBancaire('(45,20)')).toBe(-45.2)
    expect(parseMontantBancaire('+45,20')).toBe(45.2)
  })

  it('refuse ce qui n’est pas un montant', () => {
    expect(parseMontantBancaire('')).toBeNull()
    expect(parseMontantBancaire('   ')).toBeNull()
    expect(parseMontantBancaire('VIREMENT')).toBeNull()
    expect(parseMontantBancaire('12abc')).toBeNull() // parseFloat rendait 12
    expect(parseMontantBancaire('01/01/2026')).toBeNull()
  })

  it('garde zéro distinct de l’absence de montant', () => {
    expect(parseMontantBancaire('0,00')).toBe(0)
  })
})

describe('parseDateBancaire', () => {
  it('lit le format français et l’ISO', () => {
    expect(parseDateBancaire('02/09/2026')).toBe('2026-09-02')
    expect(parseDateBancaire('2/9/2026')).toBe('2026-09-02')
    expect(parseDateBancaire('02.09.2026')).toBe('2026-09-02')
    expect(parseDateBancaire('2026-09-02')).toBe('2026-09-02')
  })

  it('complète une année sur deux chiffres autour du pivot 70', () => {
    expect(parseDateBancaire('02/09/26')).toBe('2026-09-02')
    expect(parseDateBancaire('02/09/99')).toBe('1999-09-02')
  })

  it('refuse ce qui n’est pas une date', () => {
    expect(parseDateBancaire('VIREMENT')).toBeNull()
    expect(parseDateBancaire('')).toBeNull()
  })

  it('refuse une date qui n’existe pas au calendrier', () => {
    // Rendait auparavant la chaîne « 2026-02-31 », que Postgres rejette : l'insertion échouait pour
    // tout le lot, pas seulement pour cette ligne. La refuser fait ignorer la seule ligne fautive,
    // comme n'importe quelle autre ligne illisible.
    expect(parseDateBancaire('31/02/2026')).toBeNull()
    expect(parseDateBancaire('31/04/2026')).toBeNull()
    expect(parseDateBancaire('2026-04-31')).toBeNull()
    expect(parseDateBancaire('02/13/2026')).toBeNull() // mois 13 — une date américaine mal lue
  })

  it('suit les années bissextiles', () => {
    expect(parseDateBancaire('29/02/2023')).toBeNull()
    expect(parseDateBancaire('29/02/2024')).toBe('2024-02-29')
  })

  it('laisse intactes les fins de mois légitimes', () => {
    expect(parseDateBancaire('31/01/2026')).toBe('2026-01-31')
    expect(parseDateBancaire('30/04/2026')).toBe('2026-04-30')
    expect(parseDateBancaire('2026-12-31')).toBe('2026-12-31')
  })
})

describe('parseCsv', () => {
  it('détecte le point-virgule, courant sur les exports français', () => {
    // Le montant portant déjà une virgule décimale, la virgule ne peut pas être le délimiteur.
    expect(parseCsv('date;libelle;montant\n02/09/2026;LOYER;-1 200,00')).toEqual([
      ['date', 'libelle', 'montant'],
      ['02/09/2026', 'LOYER', '-1 200,00'],
    ])
  })

  it('respecte les guillemets, y compris autour du délimiteur', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']])
    expect(parseCsv('a,"il a dit ""oui""",c')).toEqual([['a', 'il a dit "oui"', 'c']])
  })

  it('accepte CRLF comme LF, et ignore les lignes vides', () => {
    expect(parseCsv('a,b\r\nc,d\r\n\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })
})

describe('detectColumnMapping', () => {
  const entete = ['Date', 'Libellé', 'Montant']

  it('trouve la colonne des montants même au-delà de mille', () => {
    // Le défaut qui a motivé ces tests : `isFullMontant` rejetait les séparateurs de milliers que
    // l'analyseur acceptait. Aucune colonne n'obtenait de correspondance, et le montant était
    // deviné par défaut — en pratique la colonne du libellé.
    const mapping = detectColumnMapping([
      entete,
      ['02/09/2026', 'VIREMENT CLIENT ALPHA', '12 500,00'],
      ['05/09/2026', 'LOYER CABINET', '-2 300,00'],
      ['09/09/2026', 'ACHAT MATERIEL MEDICAL', '-4 780,50'],
    ])
    expect(mapping).toEqual({ colDate: 0, colMontant: 2, colLibelle: 1, hasHeader: true })
  })

  it('ne dépend pas de l’ordre des colonnes', () => {
    const mapping = detectColumnMapping([
      ['Montant', 'Date', 'Libellé'],
      ['12 500,00', '02/09/2026', 'VIREMENT CLIENT ALPHA'],
      ['-2 300,00', '05/09/2026', 'LOYER CABINET'],
    ])
    expect(mapping).toMatchObject({ colDate: 1, colMontant: 0, colLibelle: 2 })
  })

  it('repère l’absence d’en-tête', () => {
    const mapping = detectColumnMapping([
      ['02/09/2026', 'VIREMENT CLIENT ALPHA', '12 500,00'],
      ['05/09/2026', 'LOYER CABINET', '-2 300,00'],
    ])
    expect(mapping.hasHeader).toBe(false)
  })

  it('ne confond pas une date en points avec un montant', () => {
    const mapping = detectColumnMapping([
      entete,
      ['02.09.2026', 'VIREMENT CLIENT ALPHA', '125,00'],
      ['05.09.2026', 'LOYER CABINET', '-230,00'],
    ])
    expect(mapping).toMatchObject({ colDate: 0, colMontant: 2 })
  })

  it('tolère des lignes de longueurs inégales', () => {
    // Une ligne de solde plus courte que les lignes d'opérations ne doit pas tronquer l'analyse.
    const mapping = detectColumnMapping([
      entete,
      ['02/09/2026', 'VIREMENT', '12 500,00'],
      ['Solde'],
      ['05/09/2026', 'LOYER', '-2 300,00'],
    ])
    expect(mapping).toMatchObject({ colDate: 0, colMontant: 2, colLibelle: 1 })
  })
})
