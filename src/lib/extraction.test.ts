import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase simulé (même motif que contrepartieBanque.test.ts) : cette fonction n'est qu'une
// paire de lectures, il n'y a pas de calcul pur à extraire.
const reponses: Record<string, { count: number | null; error: { message: string } | null }> = {
  pieces: { count: 0, error: null },
  documents_divers: { count: 0, error: null },
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const chaine = {
          eq: () => chaine,
          then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(reponses[table])),
        }
        return chaine
      },
    }),
  },
}))

const { fichierDejaPresent } = await import('./extraction')

beforeEach(() => {
  reponses.pieces = { count: 0, error: null }
  reponses.documents_divers = { count: 0, error: null }
})

describe('fichierDejaPresent', () => {
  it('repère le doublon dans les pièces comme dans les documents', async () => {
    reponses.pieces = { count: 1, error: null }
    expect(await fichierDejaPresent('d1', 'abc')).toBe(true)

    reponses.pieces = { count: 0, error: null }
    reponses.documents_divers = { count: 2, error: null }
    expect(await fichierDejaPresent('d1', 'abc')).toBe(true)
  })

  it('rend false quand le fichier est réellement nouveau', async () => {
    expect(await fichierDejaPresent('d1', 'abc')).toBe(false)
  })

  it('lève quand une lecture échoue, au lieu de répondre « nouveau »', async () => {
    // Le piège : un `count` nul est indiscernable d'un « aucun doublon ». Une lecture refusée
    // faisait donc répondre « ce fichier est nouveau » avec assurance, et créait précisément la
    // ligne en double que cette fonction existe pour empêcher.
    reponses.pieces = { count: null, error: { message: 'permission denied' } }
    await expect(fichierDejaPresent('d1', 'abc')).rejects.toThrow('Vérification des doublons impossible')

    reponses.pieces = { count: 0, error: null }
    reponses.documents_divers = { count: null, error: { message: 'réseau indisponible' } }
    await expect(fichierDejaPresent('d1', 'abc')).rejects.toThrow('réseau indisponible')
  })
})

const { orientationDe, ACHAT_PAR_DEFAUT } = await import('./extraction')

describe('orientationDe', () => {
  it('garde une facture en Pièces, au débit', () => {
    expect(orientationDe('facture')).toEqual({ destination: 'pieces', type_piece: 'achat' })
  })

  it('garde un justificatif de recette en Pièces, mais en vente', () => {
    // Le cœur de la règle : un bordereau de télétransmission est une PIÈCE (il a un montant à
    // ventiler, il se rapproche d'un encaissement) — simplement dans l'autre sens. L'envoyer dans
    // l'archive Documents le perdrait tout autant que le laisser en achat.
    expect(orientationDe('facture_vente')).toEqual({ destination: 'pieces', type_piece: 'vente' })
  })

  it('envoie tout le reste dans Documents, sous sa propre catégorie', () => {
    // Exhaustif volontairement : c'est la liste que `CategorieDocument` doit continuer de couvrir.
    // Une classification ajoutée sans être traitée ici ne compilerait pas — et si elle compilait,
    // elle atterrirait dans Documents sans que personne l'ait décidé.
    for (const c of ['releve_bancaire', 'cotisation', 'attestation', 'autre'] as const) {
      expect(orientationDe(c)).toEqual({ destination: 'documents', categorie: c })
    }
  })

  it('retombe sur un achat en Pièces quand l\'extraction n\'a rien donné', () => {
    // Le repli partagé par les deux pipelines : sans extraction on ne sait rien, et une pièce à
    // vérifier vaut mieux qu'un fichier rangé dans une archive que personne ne relit.
    expect(ACHAT_PAR_DEFAUT).toEqual({ destination: 'pieces', type_piece: 'achat' })
  })
})
