import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `supabase/functions/agent-comptable/index.ts` est auto-porté (déployé à part, il ne peut rien
// importer de src/lib). `resultatListe` y est pure et décide de ce que le modèle apprend sur
// l'exhaustivité de ce qu'il reçoit — c'est le point où une liste tronquée cesse de ressembler à une
// liste complète. Ce test lit la *vraie* source déployée et exécute sa copie, comme le garde-fou de
// `extract-piece / parseAmount`.
//
// Volontairement fragile : renommer ou reformater `resultatListe` le casse bruyamment, ce qui vaut
// mieux qu'un signal de troncature qui disparaîtrait sans bruit.
function resultatListeDeLEdgeFunction() {
  const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
  const debut = source.indexOf('function resultatListe<T>(')
  expect(debut, "`function resultatListe<T>(` introuvable dans l'Edge Function — le garde-fou doit être remis à jour").toBeGreaterThan(-1)
  const fin = source.indexOf('\n}\n', debut)
  expect(fin, 'fin de `resultatListe` introuvable').toBeGreaterThan(debut)

  const corps = source
    .slice(debut, fin + 2)
    .replace('function resultatListe<T>(lignes: T[] | null, total: number | null, cle: string): Record<string, unknown> {',
             'function resultatListe(lignes, total, cle) {')
  return new Function(`${corps}; return resultatListe`)() as (
    lignes: unknown[] | null, total: number | null, cle: string,
  ) => Record<string, unknown>
}

const resultatListe = resultatListeDeLEdgeFunction()

const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ montant: i }))

describe('agent-comptable / resultatListe (copie déployée)', () => {
  it('signale une liste tronquée, et le dit assez fort pour être suivi', () => {
    // Le défaut corrigé : l'outil rendait le tableau plafonné tel quel, indiscernable d'une liste
    // complète. Le modèle additionnait les 100 lignes reçues et annonçait un total au comptable —
    // alors que le prompt système lui demande des « montants exacts » et de signaler des données
    // insuffisantes, ce qu'il ne pouvait pas faire faute de savoir qu'il lui en manquait.
    const r = resultatListe(lignes(100), 350, 'pieces')
    expect(r.tronque).toBe(true)
    expect(r.total_disponible).toBe(350)
    expect(r.nombre_renvoye).toBe(100)
    expect(r.avertissement).toContain('350')
    expect(r.avertissement).toContain('tronqu')
  })

  it('ne crie pas au loup quand la liste est complète', () => {
    // Un avertissement permanent serait ignoré ; il ne doit apparaître que quand il porte.
    const r = resultatListe(lignes(12), 12, 'ecritures')
    expect(r.tronque).toBe(false)
    expect(r).not.toHaveProperty('avertissement')
    expect(r.ecritures).toHaveLength(12)
  })

  it('range les lignes sous la clé demandée', () => {
    expect(resultatListe(lignes(2), 2, 'ecritures')).toHaveProperty('ecritures')
    expect(resultatListe(lignes(2), 2, 'pieces')).toHaveProperty('pieces')
  })

  it('ne prétend pas à une troncature quand le total est inconnu', () => {
    // `count` peut revenir null (en-tête absent). Annoncer « tronqué » à tort pousserait le modèle à
    // refuser de répondre sur des données pourtant complètes ; on s'en tient alors à ce qu'on a.
    const r = resultatListe(lignes(5), null, 'pieces')
    expect(r.tronque).toBe(false)
    expect(r.total_disponible).toBe(5)
  })

  it('traite une absence de données comme une liste vide, pas comme une erreur', () => {
    const r = resultatListe(null, 0, 'pieces')
    expect(r.pieces).toEqual([])
    expect(r.tronque).toBe(false)
    expect(r.nombre_renvoye).toBe(0)
  })

  it('reste cohérent : le total annoncé n’est jamais sous le nombre renvoyé', () => {
    // Garde-fou contre une inversion d'arguments : `total` sous `nombre_renvoye` n'a pas de sens et
    // ferait passer une liste tronquée pour complète.
    for (const [recues, total] of [[100, 350], [10, 10], [0, 0], [5, 5]] as const) {
      const r = resultatListe(lignes(recues), total, 'pieces')
      expect(r.total_disponible as number).toBeGreaterThanOrEqual(r.nombre_renvoye as number)
    }
  })
})
