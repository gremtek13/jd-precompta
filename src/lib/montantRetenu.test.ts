import { describe, expect, it } from 'vitest'
import { montantRetenu, tvaVentilee } from './montantRetenu'

const piece = (montant_ht: number | null, montant_tva: number | null, montant_ttc: number | null) =>
  ({ montant_ht, montant_tva, montant_ttc })

describe('montant retenu : TTC pour un dossier exonéré, HT pour un assujetti', () => {
  // Le cas qui a fait naître ce module : une facture d'achat avec TVA, sur le dossier d'une
  // infirmière exonérée. La TVA ne se récupère pas, elle fait partie de la dépense.
  it("un dossier exonéré retient le TTC, TVA comprise, même quand le HT est lu", () => {
    expect(montantRetenu(piece(85.2, 17.04, 102.24), false)).toBe(102.24)
    expect(tvaVentilee(piece(85.2, 17.04, 102.24), false)).toBe(0)
  })

  it('un dossier assujetti retient le HT et ventile la TVA', () => {
    expect(montantRetenu(piece(85.2, 17.04, 102.24), true)).toBe(85.2)
    expect(tvaVentilee(piece(85.2, 17.04, 102.24), true)).toBe(17.04)
  })

  it('pour les deux statuts, montant retenu + TVA ventilée = ce que la pièce a coûté', () => {
    for (const assujetti of [false, true]) {
      const p = piece(85.2, 17.04, 102.24)
      expect(montantRetenu(p, assujetti)! + tvaVentilee(p, assujetti)).toBeCloseTo(102.24, 10)
    }
  })

  it('un assujetti sans HT lu retient le TTC moins la TVA, au centime', () => {
    expect(montantRetenu(piece(null, 0.07, 0.42), true)).toBe(0.35)
    expect(montantRetenu(piece(null, 16.67, 100), true)).toBe(83.33)
  })

  it('une pièce sans TVA retient ce qui a été payé, pour les deux statuts', () => {
    expect(montantRetenu(piece(null, null, 38.4), true)).toBe(38.4)
    expect(montantRetenu(piece(null, null, 38.4), false)).toBe(38.4)
    expect(montantRetenu(piece(38.4, 0, 38.4), true)).toBe(38.4)
    expect(tvaVentilee(piece(null, null, 38.4), true)).toBe(0)
  })

  // Sans TVA lue, un HT différent du TTC est une lecture incohérente. Pour un assujetti, la règle
  // d'avant tient à l'identique — le HT lu — et la Checklist signale la TVA manquante. Pour un dossier
  // exonéré, c'est le TTC : ce qu'il a payé.
  it("sans TVA lue, un assujetti garde le HT lu et un dossier exonéré le TTC", () => {
    expect(montantRetenu(piece(80, null, 100), true)).toBe(80)
    expect(montantRetenu(piece(80, null, 100), false)).toBe(100)
  })

  it("un dossier exonéré sans TTC le reconstitue du HT et de la TVA, jamais du HT seul", () => {
    expect(montantRetenu(piece(85.2, 17.04, null), false)).toBe(102.24)
    expect(montantRetenu(piece(85.2, null, null), false)).toBeNull()
  })

  it('rien de lu : rien de retenu', () => {
    expect(montantRetenu(piece(null, null, null), false)).toBeNull()
    expect(montantRetenu(piece(null, null, null), true)).toBeNull()
    expect(montantRetenu(piece(null, 12, null), true)).toBeNull()
  })

  // Un avoir garde son signe : il diminue le poste, exactement comme dans la 2035.
  it('un avoir reste négatif, pour les deux statuts', () => {
    expect(montantRetenu(piece(-50, -10, -60), false)).toBe(-60)
    expect(montantRetenu(piece(-50, -10, -60), true)).toBe(-50)
    expect(tvaVentilee(piece(-50, -10, -60), true)).toBe(-10)
  })
})
