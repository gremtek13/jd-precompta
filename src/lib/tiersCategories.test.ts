import { describe, expect, it } from 'vitest'
import { suggererCategorie } from './tiersCategories'
import type { TiersCategorie, TiersCategorieCabinet } from './types'

const regleDossier = (tiers: string, categorie: string): TiersCategorie =>
  ({ id: tiers, dossier_id: 'd1', tiers_normalise: tiers, categorie_id: categorie, updated_at: '2026-01-01T00:00:00Z' })
const regleCabinet = (tiers: string, categorie: string): TiersCategorieCabinet =>
  ({ id: tiers, cabinet_id: 'cab1', tiers_normalise: tiers, categorie_id: categorie, updated_at: '2026-01-01T00:00:00Z' })

describe('suggererCategorie', () => {
  it('préfère la règle du dossier à celle du cabinet', () => {
    // La plus spécifique gagne : un même fournisseur peut être classé autrement chez un client donné.
    const suggestion = suggererCategorie('EDF', [regleDossier('edf', 'cat-dossier')], [regleCabinet('edf', 'cat-cabinet')])
    expect(suggestion).toBe('cat-dossier')
  })

  it('se rabat sur la règle du cabinet, partagée entre dossiers', () => {
    expect(suggererCategorie('EDF', [], [regleCabinet('edf', 'cat-cabinet')])).toBe('cat-cabinet')
  })

  it('rend null quand aucune règle ne correspond', () => {
    expect(suggererCategorie('INCONNU', [regleDossier('edf', 'c')], [regleCabinet('orange', 'c')])).toBeNull()
  })

  it('normalise le tiers avant de chercher : casse et espaces multiples', () => {
    // Le stockage et la recherche passent tous deux par `normalizeTiers` (voir PieceFormModal) —
    // c'est ce qui fait qu'une saisie "  EDF   Marseille " retrouve la règle enregistrée.
    expect(suggererCategorie('  EDF   MARSEILLE ', [regleDossier('edf marseille', 'c')], [])).toBe('c')
  })

  it('ne suggère rien sur un tiers vide ou fait d’espaces', () => {
    expect(suggererCategorie('', [regleDossier('', 'c')], [])).toBeNull()
    expect(suggererCategorie('   ', [regleDossier('', 'c')], [])).toBeNull()
  })

  it('distingue deux tiers que seul l’accent sépare', () => {
    // `normalizeTiers` ne replie pas les accents : "Sécu" et "Secu" restent deux clés distinctes.
    // Choix de fait plutôt que décision explicite — noté ici pour qu'il soit visible le jour où un
    // tiers mal accentué par l'OCR ne retrouvera pas sa règle.
    expect(suggererCategorie('SÉCU', [regleDossier('secu', 'c')], [])).toBeNull()
  })
})
