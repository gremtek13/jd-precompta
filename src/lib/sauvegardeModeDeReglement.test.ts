import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { COLONNES_GENEREES, planReinsertion, RELATIONS, RELATIONS_PREVUES, sansColonnesGenerees } from './sauvegarde'
import { lotsDEcriture } from './sauvegardeDonnees'

// `lotsDEcriture` est pur, mais son module lit la base : un client qui ne répond à rien, que ces cas n'appellent pas.
vi.mock('./supabase', () => ({ supabase: {} }))

// LE MODE DE RÈGLEMENT D'UN MOUVEMENT AU PLAN DE SAUVEGARDE (EXP58-Q1 ; migration `mode_de_reglement_des_mouvements`,
// PRÉPARÉE). Ni table, ni relation, ni rang : une colonne de `lignes_bancaires`, que la sauvegarde recopie avec la ligne entière
// et que la restauration réinsère telle, par le super-administrateur que la garde du mode laisse passer. Ici : la colonne n'est
// ni générée ni une clé ; une ligne qui la porte part telle quelle au plan de réinsertion ; une sauvegarde d'avant (sans la
// colonne) part dans un lot à elle ; le plan ne nomme ni la colonne ni le drapeau. Données FICTIVES.

const SAUVEGARDE = readFileSync(new URL('./sauvegarde.ts', import.meta.url), 'utf8')
const DONNEES = readFileSync(new URL('./sauvegardeDonnees.ts', import.meta.url), 'utf8')
const mouvement = (o: Record<string, unknown>) => ({
  id: 'm1', dossier_id: 'd1', date: '2026-03-05', libelle: 'PRLV SEPA IMAGINAIRE', montant: -45.5, statut: 'non_rapprochee', ...o,
})

describe('le mode de règlement d’un mouvement, dans la sauvegarde et la restauration', () => {
  it('ni une colonne générée, ni une clé : rien ne le retire ni ne l’ordonne', () => {
    expect(COLONNES_GENEREES.lignes_bancaires ?? []).not.toContain('mode_reglement')
    expect(sansColonnesGenerees('lignes_bancaires', [mouvement({ mode_reglement: 'Chèque' })])[0]).toMatchObject({ mode_reglement: 'Chèque' })
    expect([...RELATIONS, ...RELATIONS_PREVUES].filter((r) => r.colonne === 'mode_reglement')).toEqual([])
  })

  it('une ligne qui porte un mode part telle quelle au plan de réinsertion ; une ligne d’avant, sans la colonne, aussi', () => {
    const plan = planReinsertion({
      lignes_bancaires: [mouvement({ id: 'm1', mode_reglement: 'Carte bancaire' }), mouvement({ id: 'm2', mode_reglement: null })],
    })
    const etape = plan.etapes.find((e) => e.table === 'lignes_bancaires')
    expect(etape?.lignes.map((l) => l.mode_reglement)).toEqual(['Carte bancaire', null])
    const davant = planReinsertion({ lignes_bancaires: [mouvement({ id: 'm3' })] }).etapes.find((e) => e.table === 'lignes_bancaires')
    expect(davant?.lignes[0]).not.toHaveProperty('mode_reglement')
  })

  it('les lots d’écriture : une ligne sans la colonne ne part pas avec une ligne qui la nomme', () => {
    const lots = lotsDEcriture([mouvement({ id: 'm1', mode_reglement: 'Chèque' }), mouvement({ id: 'm3' })])
    expect(lots).toHaveLength(2)
    for (const lot of lots) expect(new Set(lot.map((l) => Object.keys(l).sort().join(','))).size).toBe(1)
  })

  it('la table se lit entière, et le plan ne nomme ni la colonne ni son drapeau : le même dans les deux états', () => {
    expect(DONNEES).toContain("supabase.from(table).select('*', { count: 'exact' })")
    const code = SAUVEGARDE.replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/mode_reglement|MODE_DE_REGLEMENT_PREVU/)
  })
})
