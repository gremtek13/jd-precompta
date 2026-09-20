import { beforeEach, describe, expect, it, vi } from 'vitest'

// Faux client Supabase — requis même pour la fonction PURE de ce module : `doublonsTexte.ts` importe
// `supabase.ts`, qui lève au chargement quand les variables d'environnement manquent (ce qui est le
// cas en CI). Voir contrepartieBanque.test.ts, même motif.
const etat = {
  reponse: null as { data: unknown; error: unknown } | null,
  // Plafond du serveur (« Max rows » de PostgREST, qui ne se signale pas) et total annoncé quand le
  // test veut le faire mentir — voir lib/lectureComplete.ts.
  plafond: null as number | null,
  compteAnnonce: null as number | null,
}
const journal: { table: string; colonnes: string; dossierId: string }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (colonnes: string) => {
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine = {
          eq: (_col: string, dossierId: string) => {
            journal.push({ table, colonnes, dossierId })
            return chaine
          },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (resoudre: (v: unknown) => unknown) => {
            const reponse = etat.reponse ?? { data: [], error: null }
            if (reponse.error) return Promise.resolve(resoudre({ ...reponse, count: null }))
            const toutes = (reponse.data ?? []) as unknown[]
            const demande = fin - debut + 1
            const taille = etat.plafond == null ? demande : Math.min(demande, etat.plafond)
            return Promise.resolve(resoudre({
              data: toutes.slice(debut, debut + taille),
              error: null,
              count: etat.compteAnnonce ?? toutes.length,
            }))
          },
        }
        return chaine
      },
    }),
  },
}))

const { grouperDoublonsDeTexte, chargerEmpreintesTexte, chargerDoublonsDeTexte } =
  await import('./doublonsTexte')

beforeEach(() => {
  etat.reponse = null
  etat.plafond = null
  etat.compteAnnonce = null
  journal.length = 0
})

const empreinte = (o: Partial<{ pieceId: string | null; documentId: string | null; empreinte: string }>) => ({
  pieceId: null, documentId: null, empreinte: 'aaa', ...o,
})

describe('grouperDoublonsDeTexte', () => {
  it('réunit deux pièces dont le texte lu est identique', () => {
    // Le cas réel : mai.pdf et juin.pdf, deux empreintes de FICHIER distinctes, un seul texte.
    const doublons = grouperDoublonsDeTexte([
      empreinte({ pieceId: 'mai', empreinte: 'e6af' }),
      empreinte({ pieceId: 'juin', empreinte: 'e6af' }),
      empreinte({ pieceId: 'avril', empreinte: '8cbd' }),
    ])
    expect(doublons).toHaveLength(1)
    expect(doublons[0]).toEqual({ empreinte: 'e6af', pieceIds: ['mai', 'juin'], documentIds: [] })
  })

  it('réunit une pièce et un document qui portent le même texte', () => {
    // Le même relevé déposé une fois en Pièces, une fois en Documents : c'est bien un doublon, et
    // aucun des deux écrans ne peut le voir seul.
    const doublons = grouperDoublonsDeTexte([
      empreinte({ pieceId: 'p1', empreinte: 'x' }),
      empreinte({ documentId: 'd1', empreinte: 'x' }),
    ])
    expect(doublons[0]).toEqual({ empreinte: 'x', pieceIds: ['p1'], documentIds: ['d1'] })
  })

  it('ne signale rien quand chaque texte est unique', () => {
    expect(grouperDoublonsDeTexte([
      empreinte({ pieceId: 'a', empreinte: '1' }),
      empreinte({ pieceId: 'b', empreinte: '2' }),
    ])).toEqual([])
  })

  it("ignore une empreinte vide plutôt que d'en faire un groupe", () => {
    // Sans ce garde, toutes les lignes sans empreinte formeraient le plus gros groupe du dossier —
    // et le plus faux : elles ne se ressemblent en rien.
    expect(grouperDoublonsDeTexte([
      empreinte({ pieceId: 'a', empreinte: '' }),
      empreinte({ pieceId: 'b', empreinte: '' }),
    ])).toEqual([])
  })

  it('ignore une ligne qui ne désigne ni pièce ni document', () => {
    // L'écran n'aurait rien à ouvrir. Le CHECK de la table l'interdit déjà ; on ne s'y fie pas.
    expect(grouperDoublonsDeTexte([
      empreinte({ empreinte: 'x' }),
      empreinte({ empreinte: 'x' }),
    ])).toEqual([])
  })

  it('compte un triplet comme un seul groupe', () => {
    const doublons = grouperDoublonsDeTexte([
      empreinte({ pieceId: 'a', empreinte: 'x' }),
      empreinte({ pieceId: 'b', empreinte: 'x' }),
      empreinte({ pieceId: 'c', empreinte: 'x' }),
    ])
    expect(doublons).toHaveLength(1)
    expect(doublons[0].pieceIds).toEqual(['a', 'b', 'c'])
  })

  it('rend le même ordre à chaque appel', () => {
    // L'ordre de retour d'une requête Postgres n'est pas garanti ; sans tri, deux ouvertures de
    // l'écran donneraient deux listes différentes.
    const lignes = [
      empreinte({ pieceId: 'a', empreinte: 'zzz' }), empreinte({ pieceId: 'b', empreinte: 'zzz' }),
      empreinte({ pieceId: 'c', empreinte: 'aaa' }), empreinte({ pieceId: 'd', empreinte: 'aaa' }),
    ]
    expect(grouperDoublonsDeTexte(lignes).map((d) => d.empreinte)).toEqual(['aaa', 'zzz'])
    expect(grouperDoublonsDeTexte([...lignes].reverse()).map((d) => d.empreinte)).toEqual(['aaa', 'zzz'])
  })
})

describe('chargerEmpreintesTexte', () => {
  it('ne lit QUE les empreintes, jamais les textes', async () => {
    // C'est tout l'intérêt de la colonne générée : un texte OCR pèse des kilo-octets par ligne, et
    // cette lecture couvre le dossier entier.
    await chargerEmpreintesTexte('d1')
    expect(journal).toEqual([{ table: 'piece_textes_ocr', colonnes: 'piece_id, document_id, texte_md5', dossierId: 'd1' }])
    expect(journal[0].colonnes).not.toContain('texte,')
  })

  it('lève sur une lecture refusée, au lieu de rendre « aucun doublon »', async () => {
    // Une lecture dont l'échec ressemble à un résultat vide se vérifie comme une écriture : un refus
    // RLS avalé ici se lirait « rien à signaler », soit exactement le contraire de ce qu'on sait.
    etat.reponse = { data: null, error: new Error('permission denied') }
    await expect(chargerEmpreintesTexte('d1')).rejects.toThrow('permission denied')
  })

  it('normalise les colonnes absentes en null / chaîne vide', async () => {
    etat.reponse = { data: [{ piece_id: 'p1', document_id: null, texte_md5: null }], error: null }
    expect(await chargerEmpreintesTexte('d1')).toEqual([{ pieceId: 'p1', documentId: null, empreinte: '' }])
  })
})

describe('chargerDoublonsDeTexte', () => {
  it('enchaîne la lecture et le regroupement', async () => {
    etat.reponse = {
      data: [
        { piece_id: 'mai', document_id: null, texte_md5: 'e6af' },
        { piece_id: 'juin', document_id: null, texte_md5: 'e6af' },
        { piece_id: 'avril', document_id: null, texte_md5: '8cbd' },
      ],
      error: null,
    }
    expect(await chargerDoublonsDeTexte('d1')).toEqual([
      { empreinte: 'e6af', pieceIds: ['mai', 'juin'], documentIds: [] },
    ])
  })
})
