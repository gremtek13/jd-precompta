import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase simulé (même motif que commentaires.test.ts) : archiver et relire un texte SONT
// des appels à la base, et ce qui se vérifie ici c'est la ligne envoyée — et surtout ce qui n'est
// PAS envoyé quand il n'y a rien à archiver.
const reponses = {
  select: { data: [] as { piece_id: string }[] | null },
  single: { data: null as { texte: string } | null },
  upsert: { error: null as { message: string } | null },
}
let upsert: Record<string, unknown> | null = null

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (ligne: Record<string, unknown>) => {
        upsert = ligne
        return Promise.resolve(reponses.upsert)
      },
      select: () => {
        const chaine = {
          eq: () => chaine,
          maybeSingle: () => Promise.resolve(reponses.single),
          then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(reponses.select)),
        }
        return chaine
      },
    }),
  },
}))

const { enregistrerTexteOcr, piecesAvecTexteOcr, texteOcrDeLaPiece, texteOcrExploitable } =
  await import('./texteOcr')

beforeEach(() => {
  upsert = null
  reponses.select = { data: [] }
  reponses.single = { data: null }
  reponses.upsert = { error: null }
})

describe('texteOcrExploitable — rien lu n’est pas « rien dessus »', () => {
  it('rend le texte débarrassé de ses espaces de bord', () => {
    expect(texteOcrExploitable('\n FOUR MICRO-ONDES \n')).toBe('FOUR MICRO-ONDES')
  })

  it('rend null sur un texte vide ou blanc', () => {
    // Textract n'a rien lu : photo floue, page blanche, PDF d'images sans couche texte. Archiver du
    // vide ferait croire à l'écran que le document a été lu et qu'il ne contient rien, alors que le
    // vrai message est « la lecture a échoué ».
    expect(texteOcrExploitable('')).toBeNull()
    expect(texteOcrExploitable('   \n\t ')).toBeNull()
    expect(texteOcrExploitable(null)).toBeNull()
    expect(texteOcrExploitable(undefined)).toBeNull()
  })

  it('garde les retours à la ligne intérieurs, qui portent la mise en page', () => {
    // Le texte se lit comme il est imprimé sur le document. Les aplatir rendrait un ticket de caisse
    // illisible — colonnes et lignes d'articles fondues en un seul paragraphe.
    expect(texteOcrExploitable('BOULANGER\nFOUR MICRO-ONDES\n199,99'))
      .toBe('BOULANGER\nFOUR MICRO-ONDES\n199,99')
  })
})

describe('enregistrerTexteOcr', () => {
  it('archive le texte sous la pièce et son dossier', () => {
    return enregistrerTexteOcr('d1', 'p1', 'FOUR MICRO-ONDES').then(() => {
      expect(upsert).toMatchObject({ dossier_id: 'd1', piece_id: 'p1', texte: 'FOUR MICRO-ONDES' })
    })
  })

  it('nettoie le texte avant de l’archiver', () => {
    return enregistrerTexteOcr('d1', 'p1', '  FOUR MICRO-ONDES  ').then(() => {
      expect(upsert).toMatchObject({ texte: 'FOUR MICRO-ONDES' })
    })
  })

  it('n’écrit rien quand la lecture n’a rien donné', () => {
    return enregistrerTexteOcr('d1', 'p1', '   ')
      .then(() => { expect(upsert).toBeNull() })
      .then(() => enregistrerTexteOcr('d1', 'p1', undefined))
      .then(() => { expect(upsert).toBeNull() })
  })

  it('ne fait pas échouer l’appelant quand la base refuse', () => {
    // Ce texte est un confort de relecture, pas une donnée comptable. Un dépôt qui échouerait parce
    // que l'OCR n'a pas pu être archivé ferait perdre au client son document — sans commune mesure.
    reponses.upsert = { error: { message: 'new row violates row-level security policy' } }
    return expect(enregistrerTexteOcr('d1', 'p1', 'FOUR')).resolves.toBeUndefined()
  })
})

describe('lecture', () => {
  it('rend les seuls identifiants des pièces dont on a le texte', () => {
    // Volontairement pas les textes : ils pèsent des kilo-octets chacun, et la liste n'a besoin que
    // de savoir où proposer « texte lu ».
    reponses.select = { data: [{ piece_id: 'a' }, { piece_id: 'b' }] }
    return piecesAvecTexteOcr('d1').then((ids) => {
      expect([...ids].sort()).toEqual(['a', 'b'])
    })
  })

  it('rend un ensemble vide plutôt que null quand la base ne rend rien', () => {
    reponses.select = { data: null }
    return piecesAvecTexteOcr('d1').then((ids) => { expect(ids.size).toBe(0) })
  })

  it('rend le texte d’une pièce', () => {
    reponses.single = { data: { texte: 'FOUR MICRO-ONDES' } }
    return texteOcrDeLaPiece('p1').then((t) => { expect(t).toBe('FOUR MICRO-ONDES') })
  })

  it('rend null pour une pièce déposée avant qu’on conserve le texte', () => {
    // Cas normal, pas une anomalie : l'écran ne doit pas proposer « texte lu » sur ces pièces tant
    // qu'elles n'ont pas été relues.
    reponses.single = { data: null }
    return texteOcrDeLaPiece('p1').then((t) => { expect(t).toBeNull() })
  })
})
