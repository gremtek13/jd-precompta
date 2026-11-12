import { beforeEach, describe, expect, it, vi } from 'vitest'

// Un retrait de fichier est la seule écriture du projet que RIEN ne recharge : aucun écran de
// l'application ne relit jamais un seau. Ce qui est gardé ici n'est donc pas « le fichier part »
// mais « quand il ne part pas, ça laisse une trace » — six écrans écrivaient
// `.remove([...]).catch(() => {})`, la façon la plus explicite de dire qu'on ne veut pas savoir.
const etat = {
  error: null as { message: string } | null,
  leve: false,
}
const journal: string[] = []

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        remove: (chemins: string[]) => {
          journal.push(`${bucket}:${chemins.join(',')}`)
          if (etat.leve) return Promise.reject(new Error('réseau coupé'))
          return Promise.resolve({ error: etat.error })
        },
      }),
    },
  },
}))

const { retirerFichiers } = await import('./stockage')

beforeEach(() => {
  etat.error = null
  etat.leve = false
  journal.length = 0
})

async function dit(action: () => Promise<void>): Promise<string[]> {
  const console_ = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await action()
    return console_.mock.calls.map((c) => c.map(String).join(' '))
  } finally {
    console_.mockRestore()
  }
}

describe('retirerFichiers', () => {
  it('ne dit rien quand le retrait passe', async () => {
    expect(await dit(() => retirerFichiers('pieces', ['d1/a.pdf'], 'Test', 'd1'))).toEqual([])
    expect(journal).toEqual(['pieces:d1/a.pdf'])
  })

  it('journalise un refus du serveur, avec le chemin et la raison', async () => {
    etat.error = { message: 'objet verrouillé' }
    const messages = await dit(() => retirerFichiers('pieces', ['d1/a.pdf'], 'PiecesTab', 'd1'))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('ORPHELIN')
    expect(messages[0]).toContain('d1/a.pdf')
    expect(messages[0]).toContain('PiecesTab')
    // La RAISON, pas seulement le fait : c'est elle qui dira s'il faut corriger une policy ou
    // réessayer. Une erreur Supabase n'est pas une instance d'Error, d'où `messageErreur`.
    expect(messages[0]).toContain('objet verrouillé')
  })

  it('journalise aussi un rejet — les deux laissent le même fichier en place', async () => {
    // `remove()` rend `{ error }` sur un refus du serveur mais REJETTE sur une coupure réseau : ne
    // traiter que le premier cas laisserait l'exception remonter dans un gestionnaire qui ne
    // l'attend pas, et couperait le `load()` qui suit.
    etat.leve = true
    const messages = await dit(() => retirerFichiers('pieces', ['d1/a.pdf'], 'FichePiece', 'd1'))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('réseau coupé')
  })

  it('ne LÈVE jamais — un retrait raté ne doit pas casser le geste qui l’a demandé', async () => {
    etat.leve = true
    await expect(retirerFichiers('pieces', ['d1/a.pdf'], 'Test', 'd1')).resolves.toBeUndefined()
  })

  it('n’appelle pas le stockage pour une liste vide', async () => {
    await retirerFichiers('pieces', [], 'Test', 'd1')
    expect(journal).toEqual([])
  })

  it('ne retire JAMAIS un chemin hors de sa racine, et le compte sans le recopier (CFCS-Q1)', async () => {
    // Le chemin d'une pièce que le client a posée dans d1 en nommant le fichier de d2 : aux droits du cabinet, le retrait
    // supprimerait le fichier de d2. Ni demandé, ni recopié au journal.
    const messages = await dit(() => retirerFichiers('pieces', ['d1/a.pdf', 'd2/b.pdf', 'd1/../d2/c.pdf'], 'PiecesTab', 'd1'))
    expect(journal).toEqual(['pieces:d1/a.pdf'])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('2 chemin(s) hors du dossier')
    expect(messages[0]).not.toContain('d2')
    expect(messages[0]).not.toContain('b.pdf')
  })

  it('n’appelle pas le stockage quand tous les chemins sont hors de la racine', async () => {
    await dit(() => retirerFichiers('pieces', ['d2/b.pdf'], 'Test', 'd1'))
    expect(journal).toEqual([])
  })

  it('nomme TOUS les chemins d’un lot refusé', async () => {
    // Un seul compte (« 3 fichiers ») ne désigne aucun fichier : le signalement doit pouvoir être
    // recopié tel quel par quelqu'un qui ira les retirer à la main.
    etat.error = { message: 'refusé' }
    const messages = await dit(() => retirerFichiers('packs', ['d1/x.zip', 'd1/y.xlsx'], 'Test', 'd1'))
    expect(messages[0]).toContain('d1/x.zip')
    expect(messages[0]).toContain('d1/y.xlsx')
  })
})
