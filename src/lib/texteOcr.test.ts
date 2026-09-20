import { beforeEach, describe, expect, it, vi } from 'vitest'

// Client Supabase simulé (même motif que commentaires.test.ts) : archiver et relire un texte SONT
// des appels à la base, et ce qui se vérifie ici c'est la ligne envoyée — et surtout ce qui n'est
// PAS envoyé quand il n'y a rien à archiver.
const reponses = {
  select: { data: [] as { piece_id: string }[] | null, error: null as { message: string } | null },
  single: { data: null as { texte: string } | null },
  upsert: { error: null as { message: string } | null },
  // Plafond du serveur et total annoncé — voir lib/lectureComplete.ts.
  plafond: null as number | null,
  compteAnnonce: null as number | null,
}
let upsert: Record<string, unknown> | null = null
let onConflict: string | undefined

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (ligne: Record<string, unknown>, opts?: { onConflict?: string }) => {
        upsert = ligne
        onConflict = opts?.onConflict
        return Promise.resolve(reponses.upsert)
      },
      select: () => {
        // `range` honoré et `count` annoncé : la liste « qui a déjà un texte » se lit par tranches
        // (voir lib/lectureComplete.ts), et c'est elle qui décide d'une dépense Textract.
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine = {
          eq: () => chaine,
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          maybeSingle: () => Promise.resolve(reponses.single),
          then: (resoudre: (v: unknown) => unknown) => {
            if (reponses.select.error) {
              return Promise.resolve(resoudre({ data: null, error: reponses.select.error, count: null }))
            }
            const toutes = reponses.select.data ?? []
            const demande = fin - debut + 1
            const taille = reponses.plafond == null ? demande : Math.min(demande, reponses.plafond)
            return Promise.resolve(resoudre({
              data: toutes.slice(debut, debut + taille),
              error: null,
              count: reponses.compteAnnonce ?? toutes.length,
            }))
          },
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
  onConflict = undefined
  reponses.select = { data: [], error: null }
  reponses.single = { data: null }
  reponses.upsert = { error: null }
  reponses.plafond = null
  reponses.compteAnnonce = null
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
    return enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, 'FOUR MICRO-ONDES').then(() => {
      expect(upsert).toMatchObject({ dossier_id: 'd1', piece_id: 'p1', texte: 'FOUR MICRO-ONDES' })
    })
  })

  it('nettoie le texte avant de l’archiver', () => {
    return enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, '  FOUR MICRO-ONDES  ').then(() => {
      expect(upsert).toMatchObject({ texte: 'FOUR MICRO-ONDES' })
    })
  })

  it('n’écrit rien quand la lecture n’a rien donné', () => {
    return enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, '   ')
      .then(() => { expect(upsert).toBeNull() })
      .then(() => enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, undefined))
      .then(() => { expect(upsert).toBeNull() })
  })

  it('archive aussi le texte d’un DOCUMENT, pas seulement celui d’une pièce', () => {
    // Le défaut corrigé : Textract tournait sur tous les fichiers, mais seul le texte des pièces
    // était conservé. Relevés, cotisations, attestations et SNIR perdaient le leur — après l'avoir
    // payé. Soixante-sept documents en production.
    return enregistrerTexteOcr('d1', { type: 'document', id: 'doc1' }, 'RELEVE SNIR 2025').then(() => {
      expect(upsert).toMatchObject({ dossier_id: 'd1', document_id: 'doc1', texte: 'RELEVE SNIR 2025' })
      expect(upsert).not.toHaveProperty('piece_id')
    })
  })

  it('vise explicitement la bonne colonne en conflit', () => {
    // Sans `onConflict`, l'upsert porterait sur la clé primaire — devenue un `id` de substitution,
    // puisque `piece_id` doit pouvoir être nul. Il ne trouverait donc jamais de conflit et empilerait
    // un doublon à chaque relecture. C'est la panne silencieuse que ce projet connaît déjà.
    return enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, 'X')
      .then(() => { expect(onConflict).toBe('piece_id') })
      .then(() => enregistrerTexteOcr('d1', { type: 'document', id: 'doc1' }, 'X'))
      .then(() => { expect(onConflict).toBe('document_id') })
  })

  it('ne fait pas échouer l’appelant quand la base refuse', () => {
    // Ce texte est un confort de relecture, pas une donnée comptable. Un dépôt qui échouerait parce
    // que l'OCR n'a pas pu être archivé ferait perdre au client son document — sans commune mesure.
    reponses.upsert = { error: { message: 'new row violates row-level security policy' } }
    return expect(enregistrerTexteOcr('d1', { type: 'piece', id: 'p1' }, 'FOUR')).resolves.toBeUndefined()
  })
})

describe('lecture', () => {
  it('rend les seuls identifiants des pièces dont on a le texte', () => {
    // Volontairement pas les textes : ils pèsent des kilo-octets chacun, et la liste n'a besoin que
    // de savoir où proposer « texte lu ».
    reponses.select = { data: [{ piece_id: 'a' }, { piece_id: 'b' }], error: null }
    return piecesAvecTexteOcr('d1').then(({ avecTexte, erreur }) => {
      expect([...avecTexte].sort()).toEqual(['a', 'b'])
      expect(erreur).toBeNull()
    })
  })

  it('rend un ensemble vide plutôt que null quand la base ne rend rien', () => {
    reponses.select = { data: null, error: null }
    return piecesAvecTexteOcr('d1').then(({ avecTexte, erreur }) => {
      expect(avecTexte.size).toBe(0)
      expect(erreur).toBeNull()
    })
  })

  it('recolle les tranches quand le serveur plafonne', () => {
    // Lue d'un coup, la liste n'aurait qu'une pièce sur trois : les deux autres passeraient pour
    // « sans texte », et le bouton de relecture proposerait de repayer Textract dessus.
    reponses.plafond = 1
    reponses.select = { data: [{ piece_id: 'a' }, { piece_id: 'b' }, { piece_id: 'c' }], error: null }
    return piecesAvecTexteOcr('d1').then(({ avecTexte, erreur }) => {
      expect([...avecTexte].sort()).toEqual(['a', 'b', 'c'])
      expect(erreur).toBeNull()
    })
  })

  it('DIT que la lecture est INCOMPLÈTE, comme elle dit qu’elle a échoué', () => {
    // La base annonce cinq lignes et n'en rend qu'une, puis plus rien : ne pas savoir interdit de
    // relancer une lecture facturée, exactement comme un refus.
    reponses.plafond = 1
    reponses.compteAnnonce = 5
    reponses.select = { data: [{ piece_id: 'a' }], error: null }
    return piecesAvecTexteOcr('d1').then(({ erreur }) => {
      expect(erreur).toContain('sur 5')
    })
  })

  it('DIT que la lecture a échoué, au lieu de rendre un ensemble vide muet', () => {
    // Les deux cas rendent un ensemble vide et veulent dire le contraire l'un de l'autre : « aucun
    // texte en base » invite à relancer la lecture, « je n'ai pas pu savoir » l'interdit — chaque
    // relecture est un appel Textract facturé sur des documents peut-être déjà lus. L'appelant ne
    // peut faire la différence que si elle lui est dite.
    reponses.select = { data: null, error: { message: 'permission denied for table piece_textes_ocr' } }
    return piecesAvecTexteOcr('d1').then(({ avecTexte, erreur }) => {
      expect(avecTexte.size).toBe(0)
      expect(erreur).toContain('permission denied')
    })
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
