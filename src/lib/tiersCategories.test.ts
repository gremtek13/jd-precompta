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
    // Le stockage et la recherche passent tous deux par `normalizeTiers` (voir FichePiece) —
    // c'est ce qui fait qu'une saisie "  EDF   Marseille " retrouve la règle enregistrée.
    expect(suggererCategorie('  EDF   MARSEILLE ', [regleDossier('edf marseille', 'c')], [])).toBe('c')
  })

  it('ne suggère rien sur un tiers vide ou fait d’espaces', () => {
    expect(suggererCategorie('', [regleDossier('', 'c')], [])).toBeNull()
    expect(suggererCategorie('   ', [regleDossier('', 'c')], [])).toBeNull()
  })

  it('retrouve la règle malgré un accent que l’OCR a perdu ou ajouté', () => {
    // `normalizeTiers` ne replie pas les accents : longtemps, « Sécu » et « secu » étaient deux clés
    // distinctes et la règle ne s'appliquait pas. La clé d'identité du fournisseur, elle, les replie.
    expect(suggererCategorie('SÉCU', [regleDossier('secu', 'c')], [])).toBe('c')
  })

  it('retrouve la règle à travers le bruit que l’OCR colle au nom', () => {
    // Le cas réel : dix-sept pièces du même fournisseur, trois graphies, parce que l'OCR a recopié
    // des bouts de slogan avec le nom. Une règle apprise sur le nom propre doit toutes les couvrir.
    const regles = [regleDossier('transmedical', 'c-honoraires')]
    expect(suggererCategorie('Transmedical', regles, [])).toBe('c-honoraires')
    expect(suggererCategorie('Transmedical\net redevient', regles, [])).toBe('c-honoraires')
    expect(suggererCategorie('Transmedical\net soigner redevient', regles, [])).toBe('c-honoraires')
  })

  it('fait primer une règle posée sur le nom exact sur une règle posée sur l’identité', () => {
    // Sinon un arbitrage précis (« Apple Marseille » chez ce client) serait écrasé par un arbitrage
    // plus large (« Apple »), alors que c'est l'inverse qui doit se produire.
    const suggestion = suggererCategorie(
      'Apple Marseille',
      [regleDossier('apple', 'large'), regleDossier('apple marseille', 'precis')],
      [],
    )
    expect(suggestion).toBe('precis')
  })

  it('ne regroupe pas deux fournisseurs sans identité lisible', () => {
    // « CARTE BANCAIRE » n'est pas un fournisseur : aucun mot ne l'identifie, donc aucune règle ne
    // doit s'y accrocher par ricochet.
    expect(suggererCategorie('CARTE BANCAIRE', [regleDossier('edf', 'c')], [])).toBeNull()
  })

  it('retrouve la règle d’un sigle écrit avec des points', () => {
    // Bout en bout : la règle est enregistrée sous « cpam » (c'est ce que produit cleFournisseur au
    // moment de l'arbitrage), et une pièce dont l'OCR a lu « C.P.A.M. Marseille » doit la retrouver.
    expect(suggererCategorie('C.P.A.M. Marseille', [regleDossier('cpam', 'recettes')], [])).toBe('recettes')
    expect(suggererCategorie('C.P.A.M Marseille', [], [regleCabinet('cpam', 'recettes')])).toBe('recettes')
  })

  it('ne fait pas d’un sigle pointé la clé de sa ville', () => {
    // Le ricochet que la correction évite : sans elle « C.P.A.M. Marseille » avait pour identité
    // « marseille », et se serait accroché à toute règle portant sur ce mot.
    expect(suggererCategorie('C.P.A.M. Marseille', [regleDossier('marseille', 'autre')], [])).toBeNull()
  })

  it('préfère toujours le dossier au cabinet, y compris par l’identité', () => {
    const suggestion = suggererCategorie(
      'Transmedical et soigner redevient',
      [regleDossier('transmedical', 'dossier')],
      [regleCabinet('transmedical', 'cabinet')],
    )
    expect(suggestion).toBe('dossier')
  })
})
