import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BORNE_DES_TOKENS_DE_SORTIE, BORNE_DES_TOKENS_D_ENTREE, CONSOMMATION_TENUE_PAR_LA_FONCTION, LECTURE_DES_CONSOMMATIONS,
  TABLES_DES_CONSOMMATIONS, consommationsParCabinet, debutDuMoisUtc, type LigneConsommation,
} from './consommationDeLAssistant'
import { fichiersDuSchema } from '../test/schema'

// LE MODULE DU JOURNAL DE CONSOMMATION DE L'ASSISTANT (ASSIST-Q1), CONFRONTÉ À SA MIGRATION. La migration préparée
// `consommations_de_l_assistant` pose la table, sa garde et la lecture du super-administrateur ; ce module redit son nom, ses
// bornes et la forme de ce que la lecture rend, et relit ces sommes pour l'écran des comptes. Les essais de la base
// (supabase/essais/consommationsDeLAssistant.sql, sa suppression sur une réplique, le bloc CO de rls.sql) se jouent sur la base.

const CHEMIN = 'supabase/preparees/20261127230000_consommations_de_l_assistant.sql'
const MIGRATION = readFileSync(new URL(`../../${CHEMIN}`, import.meta.url), 'utf8')
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261127230100_retour_consommations_de_l_assistant.sql', import.meta.url), 'utf8')
const sansCommentaires = (t: string) => t.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

describe('le module redit la migration', () => {
  it('la table, ses colonnes, ses bornes, ses clés étrangères', () => {
    expect(TABLES_DES_CONSOMMATIONS).toEqual(['consommations_de_l_assistant'])
    const corps = /create table public\.consommations_de_l_assistant \(([\s\S]*?)\n\);/i.exec(MIGRATION)?.[1] ?? ''
    expect(corps).toContain('cabinet_id uuid not null references public.cabinets (id) on delete cascade,')
    expect(corps).toContain('dossier_id uuid references public.dossiers (id) on delete set null,')
    expect(corps).toContain('compte uuid not null,')
    expect(corps).toContain(`check (tokens_entree between 0 and ${BORNE_DES_TOKENS_D_ENTREE})`)
    expect(corps).toContain(`check (tokens_sortie between 0 and ${BORNE_DES_TOKENS_DE_SORTIE})`)
    // Aucun texte : ni question, ni réponse, ni outil.
    expect([...corps.matchAll(/^\s+(\w+) (\w+)/gm)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'id uuid', 'cabinet_id uuid', 'dossier_id uuid', 'compte uuid', 'consommee_le timestamptz', 'tokens_entree integer',
      'tokens_sortie integer', 'constraint consommations_de_l_assistant_tokens_entree', 'constraint consommations_de_l_assistant_tokens_sortie',
    ])
  })

  it('aucune policy permissive, aucun droit aux rôles de l’API : la seule policy, la restrictive de la double authentification sous condition', () => {
    const texte = sansCommentaires(MIGRATION)
    expect(texte).toContain('alter table public.consommations_de_l_assistant enable row level security;')
    expect(texte).toContain('revoke all on public.consommations_de_l_assistant from anon, authenticated;')
    expect([...texte.matchAll(/create policy (\w+) on public\.(\w+)/gi)].map((m) => `${m[1]}:${m[2]}`)).toEqual(['deux_facteurs:consommations_de_l_assistant'])
    expect(texte).not.toMatch(/grant\s+[^;]*\bon\s+(?:table\s+)?public\.consommations_de_l_assistant\b/i)
  })

  it('la lecture : le nom, son paramètre, ce qu’elle rend, au super-administrateur seul', () => {
    expect(MIGRATION).toContain(`create function public.${LECTURE_DES_CONSOMMATIONS}(p_depuis timestamptz)`)
    expect(MIGRATION).toContain('returns table (cabinet_id uuid, tokens_entree bigint, tokens_sortie bigint, tokens_entree_depuis bigint, tokens_sortie_depuis bigint)')
    const ligne: Record<keyof LigneConsommation, true> = { cabinet_id: true, tokens_entree: true, tokens_sortie: true, tokens_entree_depuis: true, tokens_sortie_depuis: true }
    expect(Object.keys(ligne)).toEqual(['cabinet_id', 'tokens_entree', 'tokens_sortie', 'tokens_entree_depuis', 'tokens_sortie_depuis'])
    const corps = MIGRATION.slice(MIGRATION.search(new RegExp(`create function public\\.${LECTURE_DES_CONSOMMATIONS}\\(`, 'i')))
    expect(corps.indexOf('if not public.is_super_admin() then')).toBeGreaterThan(0)
    expect(corps.indexOf('if not public.is_super_admin() then')).toBeLessThan(corps.indexOf('from public.consommations_de_l_assistant c'))
  })

  it('par l’outil : aucun mot qui retient l’application, et le retour, lui, se colle', () => {
    expect(MIGRATION).not.toMatch(/\b(?:drop|truncate)\b/i)
    expect(MIGRATION).not.toMatch(/\bdelete\s+from\b/i)
    expect(MIGRATION).not.toMatch(/[\\\r]/)
    expect(RETOUR).toMatch(/drop table public\.consommations_de_l_assistant;/i)
  })

  it('le drapeau ne se lève qu’avec la migration rangée dans l’export', () => {
    const rangee = fichiersDuSchema().some((f) => /\/\d{14}_consommations_de_l_assistant\.sql$/.test(f.chemin))
    expect(CONSOMMATION_TENUE_PAR_LA_FONCTION).toBe(rangee)
  })
})

describe('les sommes du journal, relues pour l’écran des comptes', () => {
  const l = (cabinet_id: string, e: number | string | null, s: number | string | null, em: number | string | null, sm: number | string | null): LigneConsommation =>
    ({ cabinet_id, tokens_entree: e, tokens_sortie: s, tokens_entree_depuis: em, tokens_sortie_depuis: sm })

  it('une ligne par cabinet, les chaînes d’entiers relues', () => {
    const { carte, illisibles } = consommationsParCabinet([l('a', 10, '20', 1, 2), l('b', 0, 0, 0, 0)])
    expect(illisibles).toEqual([])
    expect(carte.get('a')).toEqual({ tokensEntree: 10, tokensSortie: 20, tokensEntreeDuMois: 1, tokensSortieDuMois: 2 })
    expect(carte.get('b')).toEqual({ tokensEntree: 0, tokensSortie: 0, tokensEntreeDuMois: 0, tokensSortieDuMois: 0 })
  })

  it('illisibles, jamais un zéro : une ligne en double, un nombre négatif, décimal, absent, un mois plus grand que le total', () => {
    const { carte, illisibles } = consommationsParCabinet([
      l('double', 1, 1, 0, 0), l('double', 1, 1, 0, 0), l('negatif', -1, 0, 0, 0), l('decimal', 1.5, 0, 0, 0),
      l('nul', null, 0, 0, 0), l('texte', 'beaucoup', 0, 0, 0), l('mois', 5, 5, 6, 0), l('sain', 3, 3, 3, 3),
    ])
    expect(illisibles).toEqual(['decimal', 'double', 'mois', 'negatif', 'nul', 'texte'])
    expect([...carte.keys()]).toEqual(['sain'])
  })

  it('le premier instant du mois UTC, quel que soit le fuseau', () => {
    expect(debutDuMoisUtc(new Date('2026-12-01T00:30:00+01:00'))).toBe('2026-11-01T00:00:00.000Z')
    expect(debutDuMoisUtc(new Date('2026-12-01T00:30:00Z'))).toBe('2026-12-01T00:00:00.000Z')
  })
})
