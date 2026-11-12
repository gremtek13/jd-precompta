import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modeleDeLaReponse, type LectureDuModele } from './modeleDuCabinet'
import { ROLES_COMPTABLES } from './planComptable'

// L'EXPORT D'UN CABINET PORTE SON MODÈLE DE PLAN (ligne 43, PC5 ; conception, § 3.10), sous les deux états du drapeau
// (`MODELE_DU_CABINET_PREVU`, joué par un accesseur) : levé, le modèle lu en entier part à la racine de l'archive, et une
// lecture refusée annule l'export avant tout téléchargement ; baissé, ni lecture ni fichier — l'export d'hier.

const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./modeleDuCabinet', async (original) => {
  const vrai = await original<typeof import('./modeleDuCabinet')>()
  return { ...vrai, get MODELE_DU_CABINET_PREVU() { return drapeau.leve } }
})
const etat = vi.hoisted(() => ({ modele: null as unknown as LectureDuModele, lectures: [] as string[] }))
vi.mock('./modeleDuCabinetLecture', () => ({
  lireLeModeleDuCabinet: async (cabinetId: string) => { etat.lectures.push(cabinetId); return { cabinetId, lecture: etat.modele } },
}))
vi.mock('./supabase', () => {
  const chaine: Record<string, unknown> = {}
  Object.assign(chaine, {
    select: () => chaine, eq: () => chaine, order: () => chaine, range: () => chaine,
    then: (suite: (r: unknown) => unknown) => Promise.resolve({ data: [{ id: 'd1', nom: 'Martin' }], error: null, count: 1 }).then(suite),
  })
  return { supabase: { from: () => chaine } }
})
vi.mock('./packGenerator', () => ({
  remplirZipDossier: async (destination: JSZip) => {
    destination.file('Recap.xlsx', 'RECAP')
    return { nbPieces: 0, totalTtc: 0, manquantes: [] }
  },
}))

const { genererExportCabinet } = await import('./exportCabinet')
let blob: Blob | null = null

beforeEach(() => {
  drapeau.leve = true
  etat.lectures = []
  etat.modele = modeleDeLaReponse({
    data: ROLES_COMPTABLES.map((r) => ({
      role: r.role, compte: r.role === 'banque' ? '512100' : r.compteDefaut, libelle: r.libelleDefaut,
      prefixe_auxiliaire: r.prefixeAuxiliaireDefaut, origine: r.role === 'banque' ? 'modele_du_cabinet' : 'application',
    })),
    error: null,
  })
  blob = null
  vi.stubGlobal('document', { createElement: () => ({ click() {} }), body: { appendChild: () => {}, removeChild: () => {} } })
  vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blob = b; return 'blob:faux' }, revokeObjectURL: () => {} })
})

describe('l’export d’un cabinet et son modèle de plan', () => {
  it('drapeau levé : le modèle du cabinet exporté part à la racine de l’archive', async () => {
    await genererExportCabinet('c1', 'Cabinet')
    expect(etat.lectures).toEqual(['c1'])
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer())
    const csv = await zip.file('Modele_de_plan_du_cabinet.csv')!.async('string')
    expect(csv).toContain('Banque;banque;512100;Banque;;modèle du cabinet')
    expect(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()).toEqual(['Martin/Recap.xlsx', 'Modele_de_plan_du_cabinet.csv'])
  })

  it('le modèle illisible : l’export s’annule, rien n’est téléchargé', async () => {
    etat.modele = { modele: null, motif: 'modèle de plan refusé : X' }
    await expect(genererExportCabinet('c1', 'Cabinet')).rejects.toThrow(/Le modèle de plan du cabinet n'a pas pu être lu \(modèle de plan refusé : X\)/)
    expect(blob).toBeNull()
  })

  it('drapeau baissé : ni lecture ni fichier du modèle', async () => {
    drapeau.leve = false
    await genererExportCabinet('c1', 'Cabinet')
    expect(etat.lectures).toEqual([])
    const zip = await JSZip.loadAsync(await blob!.arrayBuffer())
    expect(zip.file('Modele_de_plan_du_cabinet.csv')).toBeNull()
  })
})
