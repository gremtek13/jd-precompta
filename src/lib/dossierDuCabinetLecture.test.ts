import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REFUS_SUPPRESSION } from './dossierDuCabinet'

// LE DOSSIER DU CABINET, LU (ligne 47, LM2) : ses deux états de drapeau. Baissé, rien ne se lit — ni la liste des
// désignations, ni la désignation avant une suppression, ni celle du mandataire ; levé, la désignation se lit, une panne tombe
// du côté signalé, la suppression d'un dossier du cabinet se refuse AVANT tout retrait du stockage (sauf au
// super-administrateur), et le mandataire de ce dossier est « sans mandat ». Données FICTIVES.

const faux = vi.hoisted(() => ({
  leve: false,
  cabinets: [] as { id: string; nom: string; dossier_du_cabinet: string | null }[],
  dossiers: [] as { id: string; cabinet_id: string; nom: string }[],
  factures: [] as { id: string; dossier_id: string; numero: string | null; statut: string }[],
  panneCabinets: false,
  panneFactures: false,
  appels: [] as string[],
}))

vi.mock('./dossierDuCabinet', async (original) => {
  const reel = await original<typeof import('./dossierDuCabinet')>()
  return { ...reel, get DOSSIER_DU_CABINET_PREVU() { return faux.leve } }
})

vi.mock('./supabase', () => {
  const requete = (table: string) => {
    const filtres: [string, unknown][] = []
    let colonnes = '*'
    const lignes = () => {
      const source = (table === 'cabinets' ? faux.cabinets : table === 'dossiers' ? faux.dossiers
        : table === 'factures_emises' ? faux.factures : []) as Record<string, unknown>[]
      return source.filter((l) => filtres.every(([c, v]) => (c.startsWith('≠') ? l[c.slice(1)] !== v : l[c] === v)))
    }
    const projeter = (l: Record<string, unknown>) =>
      colonnes === '*' ? l : Object.fromEntries(colonnes.split(',').map((c) => c.trim()).map((c) => [c, l[c] ?? null]))
    const erreur = () => ((table === 'cabinets' && faux.panneCabinets) || (table === 'factures_emises' && faux.panneFactures)
      ? { message: 'délai dépassé' } : null)
    const r: Record<string, unknown> = {
      select: (c: string) => { colonnes = c; faux.appels.push(`select ${table}`); return r },
      eq: (c: string, v: unknown) => { filtres.push([c, v]); return r },
      neq: (c: string, v: unknown) => { filtres.push(['≠' + c, v]); return r },
      order: () => r,
      range: () => r,
      delete: () => { faux.appels.push(`delete ${table}`); return r },
      maybeSingle: async () => (erreur() ? { data: null, error: erreur() } : { data: lignes()[0] ? projeter(lignes()[0]) : null, error: null }),
      then: (suite: (x: unknown) => unknown) => Promise.resolve(erreur()
        ? { data: null, error: erreur(), count: null }
        : { data: lignes().map(projeter), error: null, count: lignes().length }).then(suite),
    }
    return r
  }
  return {
    supabase: {
      from: (table: string) => requete(table),
      storage: {
        from: (seau: string) => ({
          list: async () => { faux.appels.push(`list ${seau}`); return { data: [], error: null } },
          remove: async () => { faux.appels.push(`remove ${seau}`); return { data: [], error: null } },
        }),
      },
    },
  }
})

const { lireLesDossiersDesCabinets, estDesigneCommeDossierDuCabinet, lireLesFacturesQuiPartent } = await import('./dossierDuCabinetLecture')
const { supprimerDossierDefinitivement } = await import('./suppressionDossier')
const { lireLeMandataire } = await import('./mandataireLecture')

const CAB = 'c0000000-0000-4000-8000-000000000001'
const DU_CABINET = 'd0000000-0000-4000-8000-000000000001'
const CLIENT = 'd0000000-0000-4000-8000-000000000002'

beforeEach(() => {
  faux.leve = false
  faux.panneCabinets = false
  faux.panneFactures = false
  faux.appels = []
  faux.factures = [
    { id: 'f0000000-0000-4000-8000-000000000001', dossier_id: DU_CABINET, numero: 'F2026-1', statut: 'validee' },
    { id: 'f0000000-0000-4000-8000-000000000002', dossier_id: DU_CABINET, numero: 'F2026-2', statut: 'validee' },
    { id: 'f0000000-0000-4000-8000-000000000003', dossier_id: DU_CABINET, numero: null, statut: 'brouillon' },
  ]
  faux.cabinets = [{ id: CAB, nom: 'Cabinet fictif', dossier_du_cabinet: DU_CABINET }]
  faux.dossiers = [
    { id: DU_CABINET, cabinet_id: CAB, nom: 'Le cabinet lui-même' },
    { id: CLIENT, cabinet_id: CAB, nom: 'Client fictif' },
  ]
})

describe('le drapeau baissé : rien ne se lit', () => {
  it('aucune désignation, sans lire les cabinets', async () => {
    const lu = await lireLesDossiersDesCabinets()
    expect(lu).toEqual({ etat: 'lue', designes: new Set() })
    expect(await estDesigneCommeDossierDuCabinet(DU_CABINET)).toBe(false)
    expect(faux.appels).toEqual([])
  })
  it('la suppression va au stockage comme hier ; le mandataire se lit sans la colonne', async () => {
    await supprimerDossierDefinitivement(DU_CABINET, { superAdministrateur: false })
    expect(faux.appels[0]).toBe('list pieces')
    expect(await lireLeMandataire(DU_CABINET)).toEqual({ etat: 'lu', nom: 'Cabinet fictif' })
  })
})

describe('le drapeau levé', () => {
  beforeEach(() => { faux.leve = true })

  it('les dossiers désignés se lisent ; une panne est illisible, jamais « aucun »', async () => {
    expect(await lireLesDossiersDesCabinets()).toEqual({ etat: 'lue', designes: new Set([DU_CABINET]) })
    faux.panneCabinets = true
    expect((await lireLesDossiersDesCabinets()).etat).toBe('illisible')
  })

  const NOMMEES = ['f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001']

  it('les factures qui partiraient se lisent en entier, les brouillons écartés ; une panne est illisible', async () => {
    const lu = await lireLesFacturesQuiPartent(DU_CABINET)
    expect(lu).toEqual({ etat: 'lue', dossierId: DU_CABINET, factures: [
      { id: 'f0000000-0000-4000-8000-000000000001', numero: 'F2026-1' }, { id: 'f0000000-0000-4000-8000-000000000002', numero: 'F2026-2' },
    ] })
    faux.panneFactures = true
    expect((await lireLesFacturesQuiPartent(DU_CABINET)).etat).toBe('illisible')
  })

  it('le dossier du cabinet sans ses factures nommées se refuse AVANT tout retrait du stockage (LM1-Q1 (B))', async () => {
    await expect(supprimerDossierDefinitivement(DU_CABINET, { superAdministrateur: false })).rejects.toThrow(/n’a pas nommé/)
    await expect(supprimerDossierDefinitivement(DU_CABINET, { superAdministrateur: false, facturesNommees: NOMMEES.slice(0, 1) }))
      .rejects.toThrow(/ont changé depuis la confirmation/)
    faux.panneFactures = true
    await expect(supprimerDossierDefinitivement(DU_CABINET, { superAdministrateur: true, facturesNommees: NOMMEES }))
      .rejects.toThrow(/n’ont pas pu être relues : rien n’a été supprimé/)
    expect(faux.appels.filter((a) => !a.startsWith('select'))).toEqual([])
    expect(REFUS_SUPPRESSION).toMatch(/que par le chef du cabinet/)
  })

  it('une désignation illisible refuse aussi, sans rien retirer', async () => {
    faux.panneCabinets = true
    await expect(supprimerDossierDefinitivement(CLIENT, { superAdministrateur: false })).rejects.toThrow(/rien n’a été supprimé/)
    expect(faux.appels.filter((a) => !a.startsWith('select'))).toEqual([])
  })

  it('ses factures nommées, le chef le supprime ; un dossier client se supprime comme hier, sans rien nommer', async () => {
    await supprimerDossierDefinitivement(DU_CABINET, { superAdministrateur: false, facturesNommees: NOMMEES })
    expect(faux.appels).toContain('list pieces')
    faux.appels = []
    await supprimerDossierDefinitivement(CLIENT, { superAdministrateur: false })
    expect(faux.appels).toContain('list pieces')
    expect(faux.appels).toContain('delete dossiers')
  })

  it('le mandataire : « sans mandat » sur le dossier du cabinet, le nom du cabinet ailleurs', async () => {
    expect(await lireLeMandataire(DU_CABINET)).toEqual({ etat: 'sans_mandat' })
    expect(await lireLeMandataire(CLIENT)).toEqual({ etat: 'lu', nom: 'Cabinet fictif' })
  })
})
