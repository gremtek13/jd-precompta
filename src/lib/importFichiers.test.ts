import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase et extraction simulés (même motif que packGenerator.test.ts) : ce module est fait
// d'appels à la base, au stockage et à l'Edge Function d'extraction.
const etat = {
  pieces: { data: [] as { storage_hash: string | null }[], error: null as { message: string } | null },
  documents: { data: [] as { storage_hash: string | null }[], error: null as { message: string } | null },
  uploadError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  extraction: null as Record<string, unknown> | null,
  extractionLeve: false,
}
const journal: { action: string; cible: string }[] = []

vi.mock('./supabase', () => {
  const lecture = (table: 'pieces' | 'documents') => {
    const chaine = {
      select: () => chaine,
      eq: () => chaine,
      not: () => chaine,
      then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(etat[table])),
    }
    return chaine
  }
  return {
    supabase: {
      from: (table: string) => ({
        ...lecture(table === 'pieces' ? 'pieces' : 'documents'),
        insert: (ligne: Record<string, unknown>) => {
          journal.push({ action: `insert:${table}`, cible: String(ligne.categorie ?? ligne.type_piece ?? '') })
          return Promise.resolve({ error: etat.insertError })
        },
      }),
      storage: {
        from: () => ({
          upload: (chemin: string) => {
            journal.push({ action: 'upload', cible: chemin })
            return Promise.resolve({ error: etat.uploadError })
          },
          remove: (chemins: string[]) => {
            journal.push({ action: 'remove', cible: chemins.join(',') })
            return Promise.resolve({ error: null })
          },
        }),
      },
    },
  }
})

vi.mock('./extraction', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./extraction')>()
  return {
    ...reel,
    hashFichier: async (f: Blob) => `hash-de-${(f as File).name}`,
    extractPiece: async () => {
      if (etat.extractionLeve) throw new Error('Textract indisponible')
      return etat.extraction
    },
  }
})

const { chargerHashsExistants, importerFichierDossier, estFichierSupporte, extensionDe } = await import('./importFichiers')

const fichier = (nom: string, octets: number[] = [0x25, 0x50, 0x44, 0x46]) =>
  new File([new Uint8Array(octets)], nom, { type: 'application/pdf' })

const importer = (nom: string, hashsConnus = new Set<string>()) =>
  importerFichierDossier({ dossierId: 'd1', file: fichier(nom), sousDossierId: null, hashsConnus, userId: 'u1' })

beforeEach(() => {
  etat.pieces = { data: [], error: null }
  etat.documents = { data: [], error: null }
  etat.uploadError = null
  etat.insertError = null
  etat.extraction = { classification: 'facture', date_piece: '2026-03-10', tiers: 'EDF', montant_ttc: 120, confiance: 'haute' }
  etat.extractionLeve = false
  journal.length = 0
})

describe('extensionDe et estFichierSupporte', () => {
  it('reconnaît un format à son extension', async () => {
    expect(extensionDe('Facture.PDF')).toBe('pdf')
    expect(await estFichierSupporte(fichier('releve.csv', [1, 2, 3]))).toBe(true)
  })

  it('accepte un fichier sans extension en lisant sa signature', async () => {
    // `split('.').pop()` rend le nom entier quand il n'y a pas de point : se fier à l'extension
    // seule rejetterait un PDF valide simplement renommé.
    expect(await estFichierSupporte(fichier('scan_sans_extension'))).toBe(true)
    expect(await estFichierSupporte(fichier('scan_sans_extension', [0, 0, 0, 0]))).toBe(false)
  })
})

describe('chargerHashsExistants', () => {
  it('réunit les empreintes des pièces et des documents', async () => {
    etat.pieces.data = [{ storage_hash: 'a' }, { storage_hash: null }]
    etat.documents.data = [{ storage_hash: 'b' }]
    expect([...(await chargerHashsExistants('d1'))].sort()).toEqual(['a', 'b'])
  })

  it('lève quand une lecture échoue, au lieu de rendre un ensemble vide', async () => {
    // Le piège : un ensemble vide veut dire « rien n'est encore importé ». Sur un import en masse,
    // une lecture refusée faisait donc repartir tout un dossier en double.
    etat.pieces = { data: [], error: { message: 'permission denied' } }
    await expect(chargerHashsExistants('d1')).rejects.toThrow('Empreintes des fichiers déjà importés illisibles')
  })
})

describe('importerFichierDossier', () => {
  it('range une facture dans Pièces, à valider', async () => {
    const resultat = await importer('facture.pdf')
    expect(resultat.statut).toBe('ok')
    expect(journal.filter((j) => j.action === 'insert:pieces')).toHaveLength(1)
  })

  it('range un relevé ou une attestation dans Documents', async () => {
    etat.extraction = { classification: 'releve_bancaire' }
    await importer('releve.pdf')
    expect(journal.map((j) => j.action)).toContain('insert:documents_divers')
  })

  it('classe un CSV en relevé sans tenter d’extraction', async () => {
    // Textract ne sait pas lire un CSV ; dans ce contexte c'en est presque toujours un export bancaire.
    etat.extractionLeve = true // prouverait un appel à l'extraction en faisant échouer le test
    const resultat = await importer('export.csv')
    expect(resultat.message).toContain('Relevé bancaire')
  })

  it('archive quand même le fichier si l’extraction échoue', async () => {
    etat.extractionLeve = true
    const resultat = await importer('illisible.pdf')
    expect(resultat.statut).toBe('ok')
    expect(resultat.message).toContain('à refaire à la main')
    expect(journal.filter((j) => j.action === 'insert:pieces')).toHaveLength(1)
  })

  it('ignore un fichier déjà connu sans rien envoyer', async () => {
    const resultat = await importer('facture.pdf', new Set(['hash-de-facture.pdf']))
    expect(resultat.statut).toBe('doublon')
    expect(journal).toEqual([])
  })

  it('retire le fichier du stockage quand l’insertion échoue', async () => {
    // Sans ce nettoyage, un import interrompu laissait des fichiers que plus rien ne référence,
    // jusqu'à la suppression du dossier entier.
    etat.insertError = { message: 'permission denied' }
    await expect(importer('facture.pdf')).rejects.toMatchObject({ message: 'permission denied' })
    expect(journal.map((j) => j.action)).toEqual(['upload', 'insert:pieces', 'remove'])
  })

  it('ne retient l’empreinte qu’une fois la ligne écrite', async () => {
    // Elle était ajoutée avant l'envoi : un fichier dont l'import venait d'échouer était ensuite
    // annoncé « déjà présent », et n'était jamais réimporté.
    const hashs = new Set<string>()
    etat.insertError = { message: 'permission denied' }
    await expect(importer('facture.pdf', hashs)).rejects.toThrow()
    expect(hashs.size).toBe(0)

    etat.insertError = null
    await importer('facture.pdf', hashs)
    expect([...hashs]).toEqual(['hash-de-facture.pdf'])
  })

  it('repère un doublon entre deux fichiers du même lot', async () => {
    const hashs = new Set<string>()
    await importer('facture.pdf', hashs)
    expect((await importer('facture.pdf', hashs)).statut).toBe('doublon')
  })
})
