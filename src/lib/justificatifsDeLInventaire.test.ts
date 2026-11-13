import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatMoney } from './format'
import {
  citablesParUneProvision, ligneDeLaCitation, MOTS_DES_JUSTIFICATIFS, optionCitee, optionDeLaFacture, optionDeLaPiece, optionsAffichees,
  optionsDeCitation, OPTIONS_AFFICHEES_AU_PLUS, piecesCitablesParUneRegularisation, refusDeLaCitationDUneProvision,
  refusDeLaPieceDUneRegularisation, type FactureACiter, type JustificatifsDuDossier, type PieceACiter,
} from './justificatifsDeLInventaire'

// CE QU'UNE ÉCRITURE D'INVENTAIRE CITE (ligne 35, INV5-Q1 ; lib/justificatifsDeLInventaire.ts). Ce que ces cas gardent : ce qui se
// PROPOSE est ce que la base acceptera — toute pièce du dossier pour une régularisation et un risque, les pièces de vente et les
// factures émises validées pour une créance (les avoirs écartés) — dans un ordre total ; le refus dit avant le clic, aux mots des
// deux migrations, dans l'ordre de la base, et muet quand rien n'est lu ; le titre, le détail, la recherche commune et son
// plafond ; la ligne de la confirmation qui nomme ce qui est cité. Des jeux FICTIFS.

const piece = (p: Partial<PieceACiter> & Pick<PieceACiter, 'id'>): PieceACiter => ({
  dossier_id: 'd1', nom_fichier: `${p.id}.pdf`, date_piece: '2025-12-15', tiers: 'Assureur fictif', montant_ttc: 1200, type_piece: 'achat',
  statut: 'validee', ...p,
})

const facture = (p: Partial<FactureACiter> & Pick<FactureACiter, 'id'>): FactureACiter => ({
  dossier_id: 'd1', numero: `F2025-${p.id}`, statut: 'validee', type: 'facture', date_emission: '2025-10-01', tiers_nom: 'Client fictif',
  montant_ttc: 3000, ...p,
})

const J: JustificatifsDuDossier = {
  pieces: [
    piece({ id: 'p2', date_piece: '2025-06-01' }),
    piece({ id: 'p1', date_piece: '2026-01-10', statut: 'a_valider' }),
    piece({ id: 'p3', date_piece: null }),
    piece({ id: 'v1', type_piece: 'vente', date_piece: '2025-09-01' }),
  ],
  factures: [facture({ id: 'f1' }), facture({ id: 'a1', type: 'avoir', montant_ttc: -500 })],
}

describe('ce qui se propose : ce que la base acceptera', () => {
  it('une régularisation : toutes les pièces du dossier, quels que soient leur sens et leur statut, les plus récentes d’abord', () => {
    expect(piecesCitablesParUneRegularisation(J).map((p) => p.id)).toEqual(['p1', 'v1', 'p2', 'p3'])
  })

  it('une provision pour risques : toute pièce, aucune facture', () => {
    const c = citablesParUneProvision('risque', J)
    expect(c.pieces.map((p) => p.id)).toEqual(['p1', 'v1', 'p2', 'p3'])
    expect(c.factures).toEqual([])
  })

  it('une dépréciation de créance : les pièces de vente et les factures validées, jamais un avoir', () => {
    const c = citablesParUneProvision('depreciation_creance', J)
    expect(c.pieces.map((p) => p.id)).toEqual(['v1'])
    expect(c.factures.map((f) => f.id)).toEqual(['f1'])
  })

  it('l’ordre est total : à date égale, l’identifiant départage', () => {
    const j = { pieces: [piece({ id: 'b' }), piece({ id: 'a' })], factures: [] }
    expect(piecesCitablesParUneRegularisation(j).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('le refus dit avant le clic, aux mots de la base', () => {
  it('une régularisation : une pièce absente de ce qui est lu se refuse ; rien de cité, ou rien de lu, ne se refuse pas', () => {
    expect(refusDeLaPieceDUneRegularisation('p1', J)).toBeNull()
    expect(refusDeLaPieceDUneRegularisation('ailleurs', J)).toBe(MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier)
    expect(refusDeLaPieceDUneRegularisation(null, J)).toBeNull()
    expect(refusDeLaPieceDUneRegularisation('ailleurs', null)).toBeNull()
  })

  it('une provision pour risques ne cite pas de facture, lue ou non', () => {
    expect(refusDeLaCitationDUneProvision('risque', { genre: 'facture', id: 'f1' }, J)).toBe(MOTS_DES_JUSTIFICATIFS.factureHorsDeLaDepreciation)
    expect(refusDeLaCitationDUneProvision('risque', { genre: 'facture', id: 'f1' }, null)).toBe(MOTS_DES_JUSTIFICATIFS.factureHorsDeLaDepreciation)
    expect(refusDeLaCitationDUneProvision('risque', { genre: 'piece', id: 'p2' }, J)).toBeNull()
    expect(refusDeLaCitationDUneProvision('risque', { genre: 'piece', id: 'ailleurs' }, J)).toBe(MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier)
  })

  it('une créance : une pièce qui n’est pas de vente, un avoir, une facture absente se refusent', () => {
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'piece', id: 'v1' }, J)).toBeNull()
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'piece', id: 'p2' }, J)).toBe(MOTS_DES_JUSTIFICATIFS.pieceHorsDesVentes)
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'facture', id: 'f1' }, J)).toBeNull()
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'facture', id: 'a1' }, J)).toBe(MOTS_DES_JUSTIFICATIFS.factureNonValidee)
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'facture', id: 'x' }, J)).toBe(MOTS_DES_JUSTIFICATIFS.factureNonValidee)
    expect(refusDeLaCitationDUneProvision('depreciation_creance', { genre: 'piece', id: 'x' }, null)).toBeNull()
    expect(refusDeLaCitationDUneProvision('depreciation_creance', null, J)).toBeNull()
  })

  it('chaque mot se trouve dans sa migration', () => {
    const operations = readFileSync(new URL('../../supabase/preparees/20261112190000_operations_d_inventaire.sql', import.meta.url), 'utf8')
    const provisions = readFileSync(new URL('../../supabase/preparees/20261112230000_provisions.sql', import.meta.url), 'utf8')
    expect(operations).toContain(MOTS_DES_JUSTIFICATIFS.pieceHorsDuDossier)
    for (const [cle, mot] of Object.entries(MOTS_DES_JUSTIFICATIFS)) expect(provisions, cle).toContain(mot)
  })
})

describe('les mots qui nomment le choix', () => {
  it('une pièce : son fichier pour titre, son sens, sa date, son tiers, son montant, et « à valider » s’il y a lieu', () => {
    const o = optionDeLaPiece(piece({ id: 'p1', date_piece: '2026-01-10', statut: 'a_valider' }))
    expect(o).toMatchObject({ citation: { genre: 'piece', id: 'p1' }, titre: 'p1.pdf', fichier: true })
    expect(o.detail).toBe(`Dépense · 10/01/2026 · Assureur fictif · ${formatMoney(1200)} TTC · à valider`)
    expect(optionDeLaPiece(piece({ id: 'p3', date_piece: null, tiers: null, montant_ttc: null, type_piece: 'vente' })).detail).toBe('Recette · sans date')
  })

  it('une facture : son numéro pour titre, sa date, son client, son montant', () => {
    const o = optionDeLaFacture(facture({ id: 'f1' }))
    expect(o).toMatchObject({ citation: { genre: 'facture', id: 'f1' }, titre: 'Facture F2025-f1', fichier: false })
    expect(o.detail).toBe(`Facture émise · 01/10/2025 · Client fictif · ${formatMoney(3000)} TTC`)
  })

  it('les factures d’abord, puis les pièces ; la citée se retrouve dans tout ce qui est lu, sinon nulle', () => {
    expect(optionsDeCitation(citablesParUneProvision('depreciation_creance', J)).map((o) => o.citation.id)).toEqual(['f1', 'v1'])
    expect(optionCitee({ genre: 'piece', id: 'p2' }, J)?.titre).toBe('p2.pdf')
    expect(optionCitee({ genre: 'facture', id: 'a1' }, J)?.titre).toBe('Facture F2025-a1')
    expect(optionCitee({ genre: 'piece', id: 'x' }, J)).toBeNull()
    expect(optionCitee({ genre: 'piece', id: 'p2' }, null)).toBeNull()
    expect(optionCitee(null, J)).toBeNull()
  })

  it('la recherche commune garde ce qui correspond (fichier, tiers, date, montant), et la liste dit son plafond', () => {
    const options = optionsDeCitation({ pieces: J.pieces, factures: [] })
    expect(optionsAffichees(options, 'v1').affichees.map((o) => o.citation.id)).toEqual(['v1'])
    expect(optionsAffichees(options, '10/01/2026').affichees.map((o) => o.citation.id)).toEqual(['p1'])
    expect(optionsAffichees(options, '1200').trouvees).toBe(4)
    const beaucoup = Array.from({ length: OPTIONS_AFFICHEES_AU_PLUS + 7 }, (_, i) => optionDeLaPiece(piece({ id: `q${String(i).padStart(3, '0')}` })))
    const { affichees, trouvees } = optionsAffichees(beaucoup, '')
    expect(affichees).toHaveLength(OPTIONS_AFFICHEES_AU_PLUS)
    expect(trouvees).toBe(OPTIONS_AFFICHEES_AU_PLUS + 7)
  })

  it('la confirmation nomme ce qui est cité, et ne devine pas ce qu’elle ne retrouve pas', () => {
    expect(ligneDeLaCitation(null, J)).toBe('Aucune pièce citée.')
    expect(ligneDeLaCitation({ genre: 'piece', id: 'p2' }, J)).toBe(`Pièce citée : « p2.pdf » (${optionDeLaPiece(J.pieces[0]).detail}).`)
    expect(ligneDeLaCitation({ genre: 'facture', id: 'f1' }, J)).toBe(`Facture citée : Facture F2025-f1 (${optionDeLaFacture(J.factures[0]).detail}).`)
    expect(ligneDeLaCitation({ genre: 'piece', id: 'p2' }, null)).toBe('Pièce citée : celle qui était déjà citée.')
    expect(ligneDeLaCitation({ genre: 'facture', id: 'f1' }, null)).toBe('Facture citée : celle qui était déjà citée.')
  })
})
