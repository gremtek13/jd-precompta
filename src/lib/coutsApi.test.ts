import { describe, expect, it } from 'vitest'
import { PRIX_TOKEN_ENTREE_USD, PRIX_TOKEN_SORTIE_USD, estimerCoutUsd, formatUsd } from './coutsApi'

describe('estimerCoutUsd', () => {
  it('applique un tarif distinct à l’entrée et à la sortie', () => {
    // Un million de chaque : 3 $ + 15 $.
    expect(estimerCoutUsd(1_000_000, 1_000_000)).toBeCloseTo(18, 10)
  })

  it('rend zéro sans consommation', () => {
    expect(estimerCoutUsd(0, 0)).toBe(0)
  })

  it('fige les tarifs, recopiés dans l’Edge Function', () => {
    // `supabase/functions/agent-comptable/index.ts` redéclare ces deux constantes : la fonction est
    // auto-portée (déployée par copier-coller) et ne peut pas importer src/lib. La duplication est
    // assumée, mais elle peut diverger en silence — et c'est cette fonction qui applique le plafond
    // mensuel du cabinet. Si ces valeurs changent ici, il faut les changer là-bas aussi.
    //
    // Tarifs Claude Sonnet 4.6, le modèle réellement invoqué (MODEL = "eu.anthropic.claude-sonnet-4-6").
    expect(PRIX_TOKEN_ENTREE_USD * 1_000_000).toBe(3)
    expect(PRIX_TOKEN_SORTIE_USD * 1_000_000).toBe(15)
  })
})

describe('formatUsd', () => {
  it('formate en dollars, pas en euros', () => {
    expect(formatUsd(1234.5678)).toContain('$')
    expect(formatUsd(1234.5678)).not.toContain('€')
  })

  it('descend à quatre décimales sous un dollar, deux au-dessus', () => {
    // Une poignée de questions coûte quelques millièmes de dollar : arrondir à deux décimales
    // afficherait « 0,00 $ » et laisserait croire que rien n'a été consommé.
    expect(formatUsd(0.0012)).toContain('0,0012')
    // Le séparateur de milliers rendu par Intl est une espace fine insécable (U+202F), pas une
    // espace ordinaire : on vérifie la partie décimale, pas le groupement.
    expect(formatUsd(1234.5678)).toContain('234,57')
    expect(formatUsd(1234.5678)).not.toContain('234,5678')
  })

  it('formate zéro sans lever', () => {
    expect(formatUsd(0)).toContain('0,00')
  })
})
