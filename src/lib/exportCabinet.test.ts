import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ce module n'a qu'un travail propre : disposer un sous-dossier par dossier client dans un seul ZIP.
// Le remplissage de chacun est celui des packs, déjà couvert par packGenerator.test.ts — il est donc
// simulé ici par un marqueur et un Recap.xlsx, ce qui suffit à voir si deux dossiers se marchent
// dessus. Le téléchargement final touche au DOM, absent en environnement Node : il est neutralisé
// plus bas, et le ZIP est récupéré au passage.
const etat = {
  dossiers: { data: [] as { id: string; nom: string }[], error: null as Error | null },
  manquantesParDossier: new Map<string, string[]>(),
}
let blobTelecharge: Blob | null = null
let nomTelecharge = ''

vi.mock('./supabase', () => {
  // `range` et le `count` annoncé sont requis depuis que la liste des dossiers est lue par tranches
  // (voir lib/lectureComplete.ts) : sans compte annoncé, la lecture se déclarerait incomplète et
  // l'export refuserait — le test passerait pour une raison fausse.
  const chaine: Record<string, unknown> = {}
  Object.assign(chaine, {
    select: () => chaine,
    eq: () => chaine,
    order: () => chaine,
    range: () => chaine,
    then: (suite: (r: unknown) => unknown) => Promise.resolve({
      ...etat.dossiers,
      count: etat.dossiers.error ? null : (etat.dossiers.data ?? []).length,
    }).then(suite),
  })
  return { supabase: { from: () => chaine } }
})

vi.mock('./packGenerator', () => ({
  remplirZipDossier: async (destination: JSZip, dossierId: string) => {
    destination.file('Recap.xlsx', `RECAP du dossier ${dossierId}`)
    destination.folder('Pieces')!.file(`${dossierId}.pdf`, `piece du dossier ${dossierId}`)
    return {
      nbPieces: 1,
      totalTtc: 100,
      excelBlob: new Blob([]),
      manquantes: etat.manquantesParDossier.get(dossierId) ?? [],
    }
  },
}))

const { genererExportCabinet } = await import('./exportCabinet')

beforeEach(() => {
  etat.dossiers = { data: [], error: null }
  etat.manquantesParDossier = new Map()
  blobTelecharge = null
  nomTelecharge = ''

  // Le vrai `telechargerBlob` crée un <a download> et le clique. On garde le blob au vol pour relire
  // l'archive réellement produite, plutôt que de tester autre chose que ce qui part chez l'utilisateur.
  const ancre = {
    href: '', download: '',
    click() { nomTelecharge = this.download },
  }
  vi.stubGlobal('document', {
    createElement: () => ancre,
    body: { appendChild: () => {}, removeChild: () => {} },
  })
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => {
      blobTelecharge = blob
      return 'blob:faux'
    },
    revokeObjectURL: () => {},
  })
})

async function archiveTelechargee(): Promise<JSZip> {
  expect(blobTelecharge).not.toBeNull()
  return await JSZip.loadAsync(await blobTelecharge!.arrayBuffer())
}

const cheminsDe = (zip: JSZip) => Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()

describe('genererExportCabinet', () => {
  it('range chaque dossier dans son propre sous-dossier', async () => {
    etat.dossiers.data = [{ id: 'd1', nom: 'Martin' }, { id: 'd2', nom: 'Durand' }]
    const resultat = await genererExportCabinet('c1', 'JD Consult')

    expect(resultat.nbDossiers).toBe(2)
    expect(resultat.nbPiecesTotal).toBe(2)
    expect(cheminsDe(await archiveTelechargee())).toEqual([
      'Durand/Pieces/d2.pdf', 'Durand/Recap.xlsx',
      'Martin/Pieces/d1.pdf', 'Martin/Recap.xlsx',
    ])
  })

  it('sépare deux dossiers dont les noms se réduisent au même slug', async () => {
    // Le défaut corrigé. `slugify` retire les accents et réduit la ponctuation à « _ », donc
    // « Café Martin » et « Cafe Martin » donnent le même nom. `zip.folder()` ne lève rien sur un
    // chemin déjà pris : les deux dossiers se mélangeaient et le second Recap.xlsx écrasait le
    // premier — sur un export fait avant de vider un cabinet, c'était la dernière copie qui y passait.
    etat.dossiers.data = [
      { id: 'd1', nom: 'Café Martin' },
      { id: 'd2', nom: 'Cafe Martin' },
      { id: 'd3', nom: 'Dupont & Fils' },
      { id: 'd4', nom: 'Dupont Fils' },
    ]
    const resultat = await genererExportCabinet('c1', 'JD Consult')
    const zip = await archiveTelechargee()

    expect(resultat.nbDossiers).toBe(4)
    // Quatre Recap distincts : un par dossier, aucun écrasé.
    const recaps = cheminsDe(zip).filter((c) => c.endsWith('Recap.xlsx'))
    expect(recaps).toHaveLength(4)
    const contenus = await Promise.all(recaps.map((r) => zip.file(r)!.async('string')))
    expect(new Set(contenus).size).toBe(4)
    expect(cheminsDe(zip).filter((c) => c.includes('Pieces/'))).toHaveLength(4)
  })

  it('retombe sur l’identifiant quand le nom ne laisse aucun slug', async () => {
    // Un dossier nommé « --- » se réduit à la chaîne vide : sans ce repli, tous les dossiers de ce
    // genre partageraient la racine du ZIP.
    etat.dossiers.data = [{ id: 'd1', nom: '---' }, { id: 'd2', nom: '???' }]
    const zip = await genererExportCabinet('c1', 'JD Consult').then(archiveTelechargee)
    expect(cheminsDe(zip)).toEqual(['d1/Pieces/d1.pdf', 'd1/Recap.xlsx', 'd2/Pieces/d2.pdf', 'd2/Recap.xlsx'])
  })

  it('préfixe les pièces manquantes du nom de leur dossier', async () => {
    // Un export de cabinet couvre plusieurs dossiers : « facture.pdf » seul ne dirait pas d'où elle
    // vient.
    etat.dossiers.data = [{ id: 'd1', nom: 'Martin' }, { id: 'd2', nom: 'Durand' }]
    etat.manquantesParDossier.set('d2', ['2026-03-10_EDF_120.00€.pdf'])
    const resultat = await genererExportCabinet('c1', 'JD Consult')
    expect(resultat.manquantes).toEqual(['Durand / 2026-03-10_EDF_120.00€.pdf'])
  })

  it('lève si la liste des dossiers ne peut pas être lue, au lieu d’exporter un ZIP vide', async () => {
    // Un `data` nul est indiscernable d'un cabinet sans dossier : l'export aurait annoncé
    // « 0 dossier » avec assurance, juste avant une suppression de cabinet.
    etat.dossiers = { data: [], error: new Error('permission denied') }
    await expect(genererExportCabinet('c1', 'JD Consult')).rejects.toThrow('permission denied')
  })

  it('date le fichier du jour civil et nomme l’archive d’après le cabinet', async () => {
    etat.dossiers.data = [{ id: 'd1', nom: 'Martin' }]
    await genererExportCabinet('c1', 'JD Consult')
    expect(nomTelecharge).toMatch(/^Export_JD_Consult_\d{4}-\d{2}-\d{2}\.zip$/)
  })
})
