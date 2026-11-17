import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CHEMINS_DOSSIER, COLONNES_GENEREES, ORDRE_RESTAURATION, sansColonnesGenerees } from './sauvegarde'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE CUMUL REPRIS D'UN BIEN AU PLAN DE SAUVEGARDE (EXP58-Q5 ; la migration `cumul_repris_des_biens`, préparée). Ni table, ni
// rang, ni chemin nouveaux : deux colonnes sur une table au plan, que la sauvegarde recopie avec ses lignes entières
// (`select('*')`) et que la restauration envoie telles (`lotsDEcriture`). Deux sauvegardes à restaurer :
//   - D'AVANT la migration, sans les clés `cumul_repris` et `cumul_repris_au` : la ligne part sans elles, et la base, qui n'a
//     pour les colonnes ni valeur par défaut ni `not null`, les pose nulles — le plan d'hier, depuis la mise en service.
//   - D'APRÈS, avec elles : la ligne part avec son cumul, nul compris. Ses contraintes ne lisent que la ligne, et sa garde ne
//     fige le cumul qu'après un exercice validé, que la restauration réinsère en dernier (`exercices_valides` ferme la marche) :
//     rien ne la refuse.
// Ce que ce fichier ne couvre pas, dit dans le retour : une sauvegarde d'APRÈS, restaurée sur une base revenue en arrière, porte
// deux clés que la table n'a plus — le retour refuse tant qu'un bien porte un cumul.

vi.mock('./supabase', () => ({ supabase: {} }))
const { lotsDEcriture } = await import('./sauvegardeDonnees')

const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_cumul_repris_des_biens\.sql$/.test(f.chemin))!

const avant = (id: string) => ({
  id, dossier_id: 'd1', piece_id: null, nature_id: 'n1', libelle: `Bien fictif ${id}`, valeur: 4800, date_acquisition: '2022-03-15',
  date_mise_en_service: null, duree_annees: 5, created_at: '2025-01-10T09:00:00+00:00',
})

describe('le cumul repris au plan, avant comme après la migration', () => {
  it('la table reste au plan, par son chemin direct, avant les exercices validés, et le cumul n’est pas une colonne générée', () => {
    expect(ORDRE_RESTAURATION).toContain('immobilisations')
    expect(ORDRE_RESTAURATION.indexOf('immobilisations')).toBeLessThan(ORDRE_RESTAURATION.indexOf('exercices_valides'))
    expect(CHEMINS_DOSSIER.immobilisations).toEqual({ acces: 'direct' })
    expect(COLONNES_GENEREES.immobilisations ?? []).toEqual([])
    const ligne = { ...avant('b1'), cumul_repris: 2000, cumul_repris_au: '2024-12-31' }
    expect(sansColonnesGenerees('immobilisations', [ligne])).toEqual([ligne])
  })

  it('une sauvegarde d’avant part sans les deux clés — et les colonnes, sans défaut ni `not null`, les posent nulles', () => {
    const lots = lotsDEcriture([avant('b1'), avant('b2')])
    expect(lots).toEqual([[avant('b1'), avant('b2')]])
    expect(lots.flat().some((l) => 'cumul_repris' in l || 'cumul_repris_au' in l)).toBe(false)
    expect(MIGRATION.texte).toContain('alter table public.immobilisations add column cumul_repris numeric;\n')
    expect(MIGRATION.texte).toContain('alter table public.immobilisations add column cumul_repris_au date;\n')
    // L'essai le prouve en base : les deux colonnes nullables sans défaut, et le bien d'hier inscrit sans elles.
    const essai = readFileSync(new URL('../../supabase/essais/cumulReprisDesBiens.sql', import.meta.url), 'utf8')
    expect(essai).toContain("'OK', 'cumul_repris numeric false false, cumul_repris_au date false false'")
    expect(essai).toContain("(br::uuid, da::uuid, na::uuid, 'ESSAI EXP58Q5 BR', 4800, '2022-03-15', 5, null, null)")
  })

  it('une sauvegarde d’après part avec son cumul, nul compris ; deux formes ne se mêlent pas dans un lot', () => {
    const apres = [
      { ...avant('b1'), cumul_repris: 2000, cumul_repris_au: '2024-12-31' },
      { ...avant('b2'), cumul_repris: null, cumul_repris_au: null },
    ]
    expect(lotsDEcriture(apres)).toEqual([apres])
    // Une ligne sans les clés à côté d'une ligne qui les porte (impossible d'une même sauvegarde, gardé quand même) : deux lots.
    expect(lotsDEcriture([avant('b0'), ...apres]).map((lot) => lot.map((l) => l.id))).toEqual([['b0'], ['b1', 'b2']])
  })
})
