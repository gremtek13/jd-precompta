import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PieceCommentaire } from './types'

// Le client Supabase est simulé plutôt que la logique découpée : l'écriture d'un commentaire EST un
// appel à la base, et ce qui se vérifie ici c'est justement la ligne envoyée — l'auteur, l'origine,
// et laquelle des deux cibles est renseignée. Le faux client reproduit le chaînage réellement
// utilisé (`from().insert().select().single()`, `from().select().eq().order()`).
const reponses = {
  utilisateur: { data: { user: { id: 'u-auteur' } as { id: string } | null } },
  insert: { data: null as PieceCommentaire | null, error: null as { message: string } | null },
  select: { data: [] as PieceCommentaire[] | null },
  delete: { error: null as { message: string } | null },
}
let insere: Record<string, unknown> | null = null

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve(reponses.utilisateur) },
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        insere = payload
        return { select: () => ({ single: () => Promise.resolve(reponses.insert) }) }
      },
      select: () => {
        // Le chaînage réel finit par `.range()` : la lecture des commentaires se fait par tranches
        // (voir lib/lectureComplete.ts), et un faux client qui s'arrêterait à `.order()` testerait
        // un appel que la production ne fait plus.
        const chaine = {
          eq: () => chaine,
          order: () => chaine,
          range: () => chaine,
          then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre({
            data: reponses.select.data ?? [],
            error: null,
            count: (reponses.select.data ?? []).length,
          })),
        }
        return chaine
      },
      delete: () => {
        const chaine = { eq: () => Promise.resolve(reponses.delete) }
        return chaine
      },
    }),
  },
}))

const {
  ajouterCommentaire, chargerCommentaires, cleCible, cleDuCommentaire,
  commentairesParCible, dernierCommentaire, supprimerCommentaire, texteExploitable,
} = await import('./commentaires')

const commentaire = (o: Partial<PieceCommentaire>): PieceCommentaire => ({
  id: 'c', dossier_id: 'd1', piece_id: 'p1', document_id: null, auteur_id: 'u',
  origine: 'client', texte: 'un mot', created_at: '2026-03-10T09:00:00Z', ...o,
})

beforeEach(() => {
  insere = null
  reponses.utilisateur = { data: { user: { id: 'u-auteur' } } }
  reponses.insert = { data: commentaire({ id: 'c-neuf' }), error: null }
  reponses.select = { data: [] }
  reponses.delete = { error: null }
})

describe('texteExploitable — un commentaire vide n’apprend rien', () => {
  it('rend le texte nettoyé de ses espaces', () => {
    expect(texteExploitable('  four de la salle d’attente  ')).toBe('four de la salle d’attente')
  })

  it('rend null sur du vide ou du blanc', () => {
    // Refusé ici plutôt que par la contrainte de la base, dont l'erreur serait illisible pour un
    // client — et un fil qui se remplit de lignes vides cesse d'être lu.
    expect(texteExploitable('')).toBeNull()
    expect(texteExploitable('   \n\t ')).toBeNull()
  })
})

describe('clés de cible — une pièce n’est pas un document', () => {
  it('fait entrer le type dans la clé', () => {
    // Rien ne garantit qu'une pièce et un document n'aient pas le même identifiant. Les confondre
    // afficherait le commentaire de l'un sous l'autre — au mieux déroutant, au pire trompeur.
    expect(cleCible({ type: 'piece', id: 'x' })).not.toBe(cleCible({ type: 'document', id: 'x' }))
  })

  it('donne la même clé depuis la cible et depuis le commentaire enregistré', () => {
    // Les deux chemins se rejoignent à l'écran : l'un vient de ce qu'on affiche, l'autre de ce que la
    // base rend. S'ils divergeaient, un commentaire tout juste écrit n'apparaîtrait pas sous sa pièce.
    expect(cleDuCommentaire(commentaire({ piece_id: 'p9', document_id: null })))
      .toBe(cleCible({ type: 'piece', id: 'p9' }))
    expect(cleDuCommentaire(commentaire({ piece_id: null, document_id: 'd9' })))
      .toBe(cleCible({ type: 'document', id: 'd9' }))
  })
})

describe('commentairesParCible — un fil par pièce', () => {
  it('range chaque commentaire sous sa cible', () => {
    const parCible = commentairesParCible([
      commentaire({ id: 'a', piece_id: 'p1' }),
      commentaire({ id: 'b', piece_id: 'p2' }),
      commentaire({ id: 'c', piece_id: 'p1' }),
      commentaire({ id: 'd', piece_id: null, document_id: 'doc1' }),
    ])
    expect(parCible.get('piece:p1')?.map((c) => c.id)).toEqual(['a', 'c'])
    expect(parCible.get('piece:p2')?.map((c) => c.id)).toEqual(['b'])
    expect(parCible.get('document:doc1')?.map((c) => c.id)).toEqual(['d'])
  })

  it('préserve l’ordre reçu, du plus ancien au plus récent', () => {
    // L'ordre de lecture d'une conversation. Inversé, le fil se lirait à l'envers et la dernière
    // précision — celle qui compte — passerait pour la première.
    const parCible = commentairesParCible([
      commentaire({ id: 'vieux', created_at: '2026-01-01T00:00:00Z' }),
      commentaire({ id: 'recent', created_at: '2026-06-01T00:00:00Z' }),
    ])
    expect(parCible.get('piece:p1')?.map((c) => c.id)).toEqual(['vieux', 'recent'])
  })

  it('rend une table vide sans commentaire', () => {
    expect(commentairesParCible([]).size).toBe(0)
  })
})

describe('dernierCommentaire — le mot qui compte', () => {
  it('rend le plus récent, pas le premier', () => {
    // C'est lui qu'on montre sur la ligne d'arbitrage : quand l'opérateur a rappelé le client, sa
    // note vaut mieux que la précision initiale.
    expect(dernierCommentaire([
      commentaire({ id: 'premier' }), commentaire({ id: 'dernier' }),
    ])?.id).toBe('dernier')
  })

  it('rend null sur un fil vide', () => {
    expect(dernierCommentaire([])).toBeNull()
  })
})

describe('ajouterCommentaire — ce qui part en base', () => {
  it('renseigne piece_id et laisse document_id nul', () => {
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p7' }, texte: 'le four de la salle d’attente', estCabinet: false,
    }).then(() => {
      expect(insere).toMatchObject({ dossier_id: 'd1', piece_id: 'p7', document_id: null })
    })
  })

  it('renseigne document_id et laisse piece_id nul', () => {
    // Un relevé CSV atterrit en documents_divers : sans cette branche, « il manque octobre » déposé
    // avec le fichier serait perdu en silence.
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'document', id: 'doc3' }, texte: 'il manque octobre', estCabinet: false,
    }).then(() => {
      expect(insere).toMatchObject({ piece_id: null, document_id: 'doc3' })
    })
  })

  it('signe « client » ou « cabinet » selon le droit, jamais selon l’écran', () => {
    // « Le client dit que c'est le four de la salle d'attente » et « l'opérateur suppose que c'est du
    // matériel » n'ont pas le même poids devant un contrôle. La base refuserait une signature fausse,
    // mais une application qui envoie ce qu'elle sait faux est une application qu'on finit par croire.
    const ecrire = (estCabinet: boolean) => ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: 'x', estCabinet,
    })
    return ecrire(false)
      .then(() => { expect(insere).toMatchObject({ origine: 'client' }) })
      .then(() => ecrire(true))
      .then(() => { expect(insere).toMatchObject({ origine: 'cabinet' }) })
  })

  it('attache l’auteur connecté', () => {
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: 'x', estCabinet: false,
    }).then(() => { expect(insere).toMatchObject({ auteur_id: 'u-auteur' }) })
  })

  it('enregistre le texte nettoyé de ses espaces', () => {
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: '  matériel  ', estCabinet: false,
    }).then(() => { expect(insere).toMatchObject({ texte: 'matériel' }) })
  })

  it('n’écrit rien sur un commentaire vide', () => {
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: '   ', estCabinet: false,
    }).then((r) => {
      expect(r.ok).toBe(false)
      expect(insere).toBeNull()
    })
  })

  it('n’écrit rien sans session plutôt que de se faire refuser par la policy', () => {
    // `auteur_id = auth.uid()` est exigé en base : sans session, l'insertion partirait pour revenir
    // avec une erreur de policy que personne ne saurait lire.
    reponses.utilisateur = { data: { user: null } }
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: 'x', estCabinet: false,
    }).then((r) => {
      expect(r).toMatchObject({ ok: false })
      expect(insere).toBeNull()
    })
  })

  it('remonte le refus de la base au lieu de faire comme si c’était passé', () => {
    reponses.insert = { data: null, error: { message: 'new row violates row-level security policy' } }
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: 'x', estCabinet: true,
    }).then((r) => {
      expect(r).toMatchObject({ ok: false, message: expect.stringContaining('row-level security') })
    })
  })

  it('rend le commentaire écrit, pour l’afficher sans recharger', () => {
    return ajouterCommentaire({
      dossierId: 'd1', cible: { type: 'piece', id: 'p1' }, texte: 'x', estCabinet: false,
    }).then((r) => {
      expect(r).toMatchObject({ ok: true })
      if (r.ok) expect(r.commentaire.id).toBe('c-neuf')
    })
  })
})

describe('lecture et suppression', () => {
  it('rend une liste vide plutôt que null quand la base ne rend rien', () => {
    reponses.select = { data: null }
    return chargerCommentaires('d1').then((c) => { expect(c).toEqual([]) })
  })

  it('remonte l’échec d’une suppression', () => {
    reponses.delete = { error: { message: 'permission denied' } }
    return supprimerCommentaire('c1').then((m) => { expect(m).toBe('permission denied') })
  })

  it('rend null quand la suppression passe', () => {
    return supprimerCommentaire('c1').then((m) => { expect(m).toBeNull() })
  })
})
