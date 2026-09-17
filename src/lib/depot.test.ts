import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase et extraction simulés (même motif que importFichiers.test.ts, dont ce module est le
// jumeau côté client). Le faux client journalise ce qui part vraiment vers la base et le stockage :
// c'est le seul moyen de distinguer « le fichier a été rangé » de « le fichier a été perdu en
// silence », qui donnent tous deux `{ statut: 'ok' }` vu de l'écran.
const etat = {
  presents: new Set<string>(),
  lectureDoublonLeve: false,
  // De vraies instances d'Error : `PostgrestError` et `StorageError` étendent Error, et c'est ce qui
  // décide si l'écran affiche la cause réelle ou le générique « l'envoi a échoué ». Un simple objet
  // `{ message }` aurait testé un comportement que la production n'a pas.
  uploadError: null as Error | null,
  insertError: null as Error | null,
  // Écriture acceptée mais relecture vide : ce que rendrait une policy qui autorise l'insert sans
  // autoriser le select. Ni erreur, ni ligne — le cas qu'un `if (error)` seul laisserait passer.
  insertRendVide: false,
  extraction: null as Record<string, unknown> | null,
  extractionLeve: false,
  utilisateur: 'u1' as string | null,
}
// `type` note le sens de la pièce écrite : « rangé dans Pièces » ne suffit plus à décrire un dépôt
// correct depuis qu'un justificatif de recette peut y entrer à l'envers.
const journal: { action: string; cible: string; type?: string }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      // `.insert().select().single()` et non `.insert()` seul : le dépôt rend désormais la ligne
      // créée, de quoi proposer au client d'y ajouter une précision tout de suite (voir
      // lib/commentaires.ts). Le faux client reproduit ce chaînage, sans quoi il testerait une
      // écriture que la production ne fait plus.
      insert: (ligne: Record<string, unknown>) => {
        journal.push({
          action: `insert:${table}`,
          cible: String(ligne.categorie ?? ligne.uploaded_by ?? ''),
          type: ligne.type_piece as string | undefined,
        })
        return {
          select: () => ({
            single: () => Promise.resolve(
              etat.insertError
                ? { data: null, error: etat.insertError }
                : { data: etat.insertRendVide ? null : { id: `id-${table}` }, error: null },
            ),
          }),
        }
      },
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: etat.utilisateur ? { id: etat.utilisateur } : null } }),
    },
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
}))

vi.mock('./extraction', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./extraction')>()
  return {
    ...reel,
    hashFichier: async (f: Blob) => `hash-de-${await f.text()}`,
    // Volontairement asynchrone comme la vraie (elle interroge la base) : c'est cet `await` qui laisse
    // deux dépôts parallèles se croiser, et le test du lot ci-dessous n'aurait aucun sens sans lui.
    fichierDejaPresent: async (_dossierId: string, hash: string) => {
      await Promise.resolve()
      if (etat.lectureDoublonLeve) throw new Error('Vérification des doublons impossible : permission denied')
      return etat.presents.has(hash)
    },
    extractPiece: async () => {
      if (etat.extractionLeve) throw new Error('Textract indisponible')
      return etat.extraction
    },
  }
})

const { deposerFichier } = await import('./depot')

// Le contenu porte le hash (voir le faux `hashFichier`), le nom ne compte que pour le chemin et
// l'aiguillage CSV — exactement comme en vrai, où deux noms différents peuvent désigner le même
// document.
const fichier = (nom: string, contenu = nom) => new File([contenu], nom, { type: 'application/pdf' })

const deposer = (nom: string, contenu?: string, lot = new Set<string>()) =>
  deposerFichier('d1', fichier(nom, contenu), lot)

beforeEach(() => {
  etat.presents = new Set()
  etat.lectureDoublonLeve = false
  etat.uploadError = null
  etat.insertError = null
  etat.insertRendVide = false
  etat.extraction = { classification: 'facture', date_piece: '2026-03-10', tiers: 'EDF', montant_ttc: 120, confiance: 'haute' }
  etat.extractionLeve = false
  etat.utilisateur = 'u1'
  journal.length = 0
})

describe('deposerFichier', () => {
  it('range une facture dans Pièces, à valider', async () => {
    expect(await deposer('facture.pdf')).toEqual({ statut: 'ok', cible: { type: 'piece', id: 'id-pieces' } })
    expect(journal.map((j) => j.action)).toEqual(['upload', 'insert:pieces'])
  })

  it('range une facture au débit', async () => {
    await deposer('facture.pdf')
    expect(journal.find((j) => j.action === 'insert:pieces')?.type).toBe('achat')
  })

  it('range un relevé ou une attestation dans Documents', async () => {
    etat.extraction = { classification: 'releve_bancaire' }
    await deposer('releve.pdf')
    expect(journal.map((j) => j.action)).toContain('insert:documents_divers')
  })

  it('range un justificatif de recette dans Pièces, en vente', async () => {
    // Les deux moitiés comptent. Dans Documents, le bordereau serait perdu comme justificatif
    // d'encaissement ; en Pièces mais en « achat », son montant partirait en charge — et la recette
    // manquerait par-dessus le marché. Le dépôt client est le chemin le plus exposé : le praticien
    // photographie son bordereau, et il n'a pas le droit de corriger la pièce ensuite.
    etat.extraction = { classification: 'facture_vente', date_piece: '2025-12-09', montant_ttc: 364.75 }
    expect(await deposer('bordereau.pdf')).toEqual({ statut: 'ok', cible: { type: 'piece', id: 'id-pieces' } })
    expect(journal.find((j) => j.action === 'insert:pieces')?.type).toBe('vente')
  })

  it('classe un CSV en relevé sans tenter d’extraction', async () => {
    // Textract ne sait pas lire un CSV ; l'extraction est court-circuitée. `extractionLeve` ferait
    // échouer le test si le raccourci disparaissait.
    etat.extractionLeve = true
    expect(await deposer('export.csv')).toEqual({ statut: 'ok', cible: { type: 'document', id: 'id-documents_divers' } })
    expect(journal.find((j) => j.action === 'insert:documents_divers')?.cible).toBe('releve_bancaire')
  })

  it('archive quand même le fichier en Pièces si l’extraction échoue', async () => {
    // Le client n'a pas le droit de corriger une pièce après coup : un document illisible par
    // Textract doit quand même arriver au cabinet, à compléter à la main, pas être refusé.
    etat.extractionLeve = true
    expect(await deposer('illisible.pdf')).toEqual({ statut: 'ok', cible: { type: 'piece', id: 'id-pieces' } })
    expect(journal.map((j) => j.action)).toEqual(['upload', 'insert:pieces'])
  })

  it('refuse un fichier déjà en base sans rien envoyer', async () => {
    etat.presents.add('hash-de-facture.pdf')
    expect(await deposer('facture.pdf')).toEqual({ statut: 'doublon' })
    expect(journal).toEqual([])
  })

  it('retire le fichier du stockage quand l’insertion échoue', async () => {
    // Sans ce nettoyage le fichier restait dans le stockage sans aucune ligne pointant dessus : le
    // client ne voyait rien, le cabinet non plus, et seule la suppression du dossier entier
    // l'aurait ramassé.
    etat.insertError = new Error('permission denied')
    expect(await deposer('facture.pdf')).toEqual({ statut: 'erreur', message: 'permission denied' })
    expect(journal.map((j) => j.action)).toEqual(['upload', 'insert:pieces', 'remove'])
  })

  it('remonte l’échec de la vérification anti-doublon au lieu de déposer quand même', async () => {
    // Une lecture refusée est indiscernable d'un « aucun doublon » : la traiter comme telle ferait
    // recréer précisément la ligne en double que cette vérification existe pour empêcher.
    etat.lectureDoublonLeve = true
    const resultat = await deposer('facture.pdf')
    expect(resultat).toMatchObject({ statut: 'erreur' })
    expect(journal).toEqual([])
  })

  it('enregistre la pièce même sans session lisible, plutôt que d’échouer', async () => {
    // `uploaded_by` était lu avec `user!.id` : une session expirée entre l'envoi et l'insertion
    // faisait planter le dépôt sur un TypeError, après que le fichier soit déjà dans le stockage.
    etat.utilisateur = null
    expect(await deposer('facture.pdf')).toEqual({ statut: 'ok', cible: { type: 'piece', id: 'id-pieces' } })
    expect(journal.find((j) => j.action === 'insert:pieces')?.cible).toBe('')
  })
})

describe('doublons au sein d’un même dépôt', () => {
  it('n’envoie qu’une fois deux fichiers de contenu identique déposés ensemble', async () => {
    // Le défaut corrigé. ClientUpload lance les fichiers d'un même dépôt en parallèle : les deux
    // branches interrogent la base avant que l'une ait écrit sa ligne, et comme il n'existe aucun
    // index unique sur (dossier_id, storage_hash), la facture partait en double — donc comptée deux
    // fois dans le total du pack et dans la TVA déductible.
    const lot = new Set<string>()
    const memeFacture = 'contenu de la facture EDF'
    const [a, b] = await Promise.all([
      deposer('facture.pdf', memeFacture, lot),
      deposer('facture (1).pdf', memeFacture, lot),
    ])

    expect([a.statut, b.statut].sort()).toEqual(['doublon', 'ok'])
    expect(journal.filter((j) => j.action === 'insert:pieces')).toHaveLength(1)
    expect(journal.filter((j) => j.action === 'upload')).toHaveLength(1)
  })

  it('laisse passer deux fichiers différents du même dépôt', async () => {
    const lot = new Set<string>()
    const resultats = await Promise.all([
      deposer('facture-edf.pdf', 'EDF', lot),
      deposer('facture-orange.pdf', 'ORANGE', lot),
    ])
    expect(resultats.every((r) => r.statut === 'ok')).toBe(true)
    expect(journal.filter((j) => j.action === 'insert:pieces')).toHaveLength(2)
  })

  it('libère la réservation quand le dépôt échoue, pour qu’un réessai reste possible', async () => {
    // La réservation est posée avant l'envoi, donc avant de savoir s'il aboutira. La garder après un
    // échec ferait répondre « déjà déposé » à un fichier qui n'est jamais arrivé — le client n'a
    // alors plus aucun moyen de le renvoyer.
    const lot = new Set<string>()
    etat.insertError = new Error('permission denied')
    expect((await deposer('facture.pdf', 'EDF', lot)).statut).toBe('erreur')
    expect(lot.size).toBe(0)

    etat.insertError = null
    expect((await deposer('facture.pdf', 'EDF', lot)).statut).toBe('ok')
  })

  it('ne réserve rien qui empêcherait un dépôt légitime au lot suivant', async () => {
    // Un Set neuf par dépôt : le premier lot réserve, le second repart de la base. Ici la base ne
    // connaît pas encore le fichier (faux client sans persistance), donc il doit repasser.
    const premierLot = new Set<string>()
    await deposer('facture.pdf', 'EDF', premierLot)
    expect((await deposer('facture.pdf', 'EDF', new Set())).statut).toBe('ok')
  })
})

describe('la ligne créée est nommée', () => {
  // Sans elle, l'écran devrait deviner laquelle des lignes rechargées est celle qu'on vient de
  // déposer — et sur deux photos de la même enseigne prises à une minute d'intervalle, il se
  // tromperait. C'est ce qui permet de proposer une précision sur LE bon dépôt, au seul moment où le
  // client sait encore pourquoi il l'a envoyé (voir lib/commentaires.ts).
  it('désigne la pièce pour une facture', async () => {
    const resultat = await deposer('facture.pdf')
    expect(resultat).toMatchObject({ cible: { type: 'piece' } })
  })

  it('désigne le document pour un relevé', async () => {
    etat.extraction = { classification: 'releve_bancaire' }
    expect(await deposer('releve.pdf')).toMatchObject({ cible: { type: 'document' } })
  })

  it('traite une insertion qui ne rend aucune ligne comme un échec, et nettoie le stockage', async () => {
    // Une policy qui laisse passer l'écriture mais interdit la relecture rendrait `data` nul sans
    // erreur. Sans cette garde, le dépôt s'annoncerait réussi en désignant une cible inexistante.
    etat.insertRendVide = true
    expect((await deposer('facture.pdf')).statut).toBe('erreur')
    expect(journal.map((j) => j.action)).toEqual(['upload', 'insert:pieces', 'remove'])
  })
})
