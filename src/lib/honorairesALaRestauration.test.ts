import { describe, expect, it } from 'vitest'
import {
  HONORAIRES_RESTAURES_AVANT_LA_DESIGNATION_PREVUS, TABLES_GARDEES_PAR_LA_DESIGNATION, refusDesHonorairesALaRestauration,
} from './honorairesALaRestauration'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// HR-Q1 (relecture adverse du 28/11/2026) : la restauration d'un dossier du cabinet s'arrêtait à son premier lien
// d'honoraires. Ces tests gardent le refus d'avant la migration, et confrontent ce qu'il suppose au texte des gardes.

const PREPAREE = 'supabase/preparees/20261128100000_honoraires_restaures_avant_la_designation.sql'
const textePrepare = () => fichiersPrepares().find((f) => f.chemin === PREPAREE)?.texte ?? ''

describe('les honoraires du dossier du cabinet à la restauration (HR-Q1)', () => {
  it('le drapeau est baissé : la migration est préparée, pas appliquée, et l’export n’en porte rien', () => {
    expect(HONORAIRES_RESTAURES_AVANT_LA_DESIGNATION_PREVUS).toBe(false)
    expect(fichiersDuSchema().some((f) => f.chemin.includes('honoraires_restaures_avant_la_designation'))).toBe(false)
  })

  it('sans la migration, chaque table d’honoraires portée se refuse, avec son compte ; une table vide ou absente, non', () => {
    const contenu = { honoraires_factures: [{}, {}], honoraires_deposes: [], pieces: [{}] }
    const refus = refusDesHonorairesALaRestauration(contenu, false)
    expect(refus).toHaveLength(1)
    expect(refus[0]).toContain('2 ligne(s) de « honoraires_factures »')
    expect(refus[0]).toContain('honoraires_restaures_avant_la_designation')
    expect(refusDesHonorairesALaRestauration({ pieces: [{}] }, false)).toEqual([])
    expect(refusDesHonorairesALaRestauration({ honoraires_deposes: [{}] }, false)[0]).toContain('« honoraires_deposes »')
  })

  it('la migration en base, rien ne se refuse', () => {
    expect(refusDesHonorairesALaRestauration({ honoraires_factures: [{}], honoraires_deposes: [{}] }, true)).toEqual([])
  })

  it('les deux tables refusées sont celles dont la garde en production exige la désignation pour tout auteur', () => {
    // La condition que la préparée lève, dans l'export : la désignation, sans exception pour le super-administrateur.
    const gardes: Record<string, RegExp> = {
      honoraires_factures: /create function public\.garder_honoraires_factures\(\)[\s\S]*?or not exists \(select 1 from public\.cabinets c where c\.dossier_du_cabinet = new\.dossier_id\) then/i,
      honoraires_deposes: /create function public\.garder_honoraires_deposes\(\)[\s\S]*?if not exists \(select 1 from public\.cabinets c where c\.dossier_du_cabinet = new\.dossier_id\) then/i,
    }
    const schema = fichiersDuSchema().map((f) => f.texte).join('\n')
    for (const table of TABLES_GARDEES_PAR_LA_DESIGNATION) expect(schema).toMatch(gardes[table])
    expect(Object.keys(gardes).sort()).toEqual([...TABLES_GARDEES_PAR_LA_DESIGNATION].sort())
    // Et la préparée ouvre ces deux conditions au super-administrateur seul.
    const preparee = textePrepare()
    expect(preparee.match(/and not public\.is_super_admin\(\)/g)).toHaveLength(2)
  })
})
