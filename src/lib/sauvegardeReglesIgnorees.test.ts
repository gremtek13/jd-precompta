import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CHEMINS_DOSSIER, COLONNES_GENEREES, ORDRE_RESTAURATION, sansColonnesGenerees } from './sauvegarde'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE SENS DES RÈGLES « TOUJOURS IGNORER » AU PLAN DE SAUVEGARDE (REGLES-Q1 ; la migration `sens_des_regles_ignorees`,
// préparée). Ni table, ni rang, ni chemin nouveaux : une colonne sur une table au plan, que la sauvegarde recopie avec ses
// lignes entières (`select('*')`) et que la restauration envoie telle (`lotsDEcriture`). Deux sauvegardes à restaurer :
//   - D'AVANT la migration, sans la clé `sens` : la ligne part sans elle, et la base, qui n'a pour la colonne ni valeur par
//     défaut ni `not null`, la pose nulle — LES DEUX SENS, ce que la règle valait quand on l'a sauvegardée. L'essai le prouve
//     en base (supabase/essais/sensDesReglesIgnorees.sql, étape 3 : « une règle insérée sans sens : nulle »).
//   - D'APRÈS, avec elle : la ligne part avec son sens, nul compris.
// Ce que ce fichier ne couvre pas, dit dans le retour arrière : une sauvegarde d'APRÈS, restaurée sur une base revenue en
// arrière, porte une clé que la table n'a plus.

vi.mock('./supabase', () => ({ supabase: {} }))
const { lotsDEcriture } = await import('./sauvegardeDonnees')

const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_sens_des_regles_ignorees\.sql$/.test(f.chemin))!

const avant = (id: string, motif: string) => ({ id, dossier_id: 'd1', motif, created_at: '2026-10-01T09:00:00+00:00' })

describe('la règle « toujours ignorer » au plan, avant comme après la migration', () => {
  it('la table reste au plan, par son chemin direct, et `sens` n’est pas une colonne générée', () => {
    expect(ORDRE_RESTAURATION).toContain('regles_bancaires_ignorees')
    expect(CHEMINS_DOSSIER.regles_bancaires_ignorees).toEqual({ acces: 'direct' })
    expect(COLONNES_GENEREES.regles_bancaires_ignorees ?? []).not.toContain('sens')
    expect(sansColonnesGenerees('regles_bancaires_ignorees', [{ ...avant('r1', 'cpam'), sens: 'decaissement' }]))
      .toEqual([{ ...avant('r1', 'cpam'), sens: 'decaissement' }])
  })

  it('une sauvegarde d’avant part sans la clé `sens` — et la colonne, sans défaut ni `not null`, la pose nulle', () => {
    const lots = lotsDEcriture([avant('r1', 'cpam'), avant('r2', 'macsf')])
    expect(lots).toEqual([[avant('r1', 'cpam'), avant('r2', 'macsf')]])
    expect(lots.flat().some((l) => 'sens' in l)).toBe(false)
    expect(MIGRATION.texte).toContain('alter table public.regles_bancaires_ignorees\n  add column sens text;\n')
    // L'essai le prouve en base : une règle insérée sans sens est nulle.
    const essai = readFileSync(new URL('../../supabase/essais/sensDesReglesIgnorees.sql', import.meta.url), 'utf8')
    expect(essai).toContain("3. une règle insérée sans sens, comme hier : nulle (les deux sens)")
    expect(essai).toContain("returning coalesce(sens, 'nul')$q$, 'OK', 'nul')")
  })

  it('une sauvegarde d’après part avec son sens, nul compris ; deux formes ne se mêlent pas dans un lot', () => {
    const apres = [{ ...avant('r1', 'cpam'), sens: 'decaissement' }, { ...avant('r2', 'macsf'), sens: null }]
    expect(lotsDEcriture(apres)).toEqual([apres])
    // Une ligne sans la clé à côté d'une ligne qui la porte (impossible d'une même sauvegarde, gardé quand même) : deux lots.
    expect(lotsDEcriture([avant('r0', 'edf'), ...apres]).map((lot) => lot.map((l) => l.id))).toEqual([['r0'], ['r1', 'r2']])
  })
})
