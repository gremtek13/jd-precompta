import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// LA PAGINATION DE TEXTRACT, EXÉCUTÉE PLUTÔT QUE RELUE.
//
// `GetDocumentTextDetection` rend ses résultats par pages et ne le signale QUE par un `NextToken`.
// Sans la boucle qui le suit, un document de plusieurs pages rendrait ses mille premiers blocs et
// rien d'autre : texte OCR tronqué, donc classification faite sur un fragment, 2035 lue à moitié,
// échéancier de cotisation amputé — et aucune erreur nulle part. C'est la famille de défaut la plus
// coûteuse de ce dépôt (« le plafond de PostgREST »), arrivée par une porte que le passage à la
// détection de texte vient d'ouvrir : `AnalyzeExpense` rendait ses pages autrement.
//
// Les autres garde-fous posés sur cette fonction vérifient un CÂBLAGE par recherche de texte, faute
// de pouvoir exécuter du Deno ici. Celui-ci n'a pas cette excuse : la boucle a été écrite sur un
// fournisseur de pages, donc elle s'extrait et se lance pour de bon.
function collecterBlocsDeployee() {
  const source = readFileSync(
    new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  const debut = source.indexOf('// ── DÉBUT PAGINATION')
  const fin = source.indexOf('// ── FIN PAGINATION')
  expect(debut, 'bornes de la pagination introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)

  const bloc = source.slice(debut, fin)
  expect(bloc, '`collecterBlocs` absente du bloc gardé').toContain('async function collecterBlocs(')

  return new Function(`${bloc}; return collecterBlocs`)() as (
    premiere: { Blocks?: unknown[]; NextToken?: string },
    pageSuivante: (suite: string) => Promise<{ Blocks?: unknown[]; NextToken?: string }>,
  ) => Promise<unknown[]>
}

const collecter = collecterBlocsDeployee()

// Un faux pagineur : il REFUSE un jeton qu'il ne connaît pas, pour qu'une boucle qui redemanderait la
// même page indéfiniment échoue au lieu de tourner.
function pagineur(pages: Record<string, { Blocks?: unknown[]; NextToken?: string }>) {
  const vus = new Set<string>()
  return async (suite: string) => {
    if (vus.has(suite)) throw new Error(`jeton redemandé : ${suite}`)
    vus.add(suite)
    const page = pages[suite]
    if (!page) throw new Error(`jeton inconnu : ${suite}`)
    return page
  }
}

describe('extract-piece / pagination de la détection de texte', () => {
  it('recolle TOUTES les pages, pas seulement la première', async () => {
    const blocs = await collecter(
      { Blocks: ['p1a', 'p1b'], NextToken: 'j2' },
      pagineur({ j2: { Blocks: ['p2a'], NextToken: 'j3' }, j3: { Blocks: ['p3a', 'p3b'] } }),
    )
    expect(blocs).toEqual(['p1a', 'p1b', 'p2a', 'p3a', 'p3b'])
  })

  it('garde l’ORDRE de lecture — un texte OCR remis dans le désordre ne se voit pas', async () => {
    // L'ordre n'est pas cosmétique : `dateDepuisTexteBrut` prend la PREMIÈRE date en ordre de lecture
    // quand aucun libellé ne tranche, et `lectureAppelCotisation` lit des échéances ligne à ligne.
    const blocs = await collecter(
      { Blocks: [1], NextToken: 'a' },
      pagineur({ a: { Blocks: [2, 3], NextToken: 'b' }, b: { Blocks: [4] } }),
    )
    expect(blocs).toEqual([1, 2, 3, 4])
  })

  it('s’arrête quand l’API ne rend plus de jeton', async () => {
    const blocs = await collecter({ Blocks: ['seule'] }, pagineur({}))
    expect(blocs).toEqual(['seule'])
  })

  it('accepte une page vide sans perdre les suivantes', async () => {
    // Une page sans bloc n'est pas la fin : c'est le `NextToken` qui décide, et confondre les deux
    // couperait le document à la première page blanche.
    const blocs = await collecter(
      { Blocks: [], NextToken: 'a' },
      pagineur({ a: { Blocks: ['après le vide'] } }),
    )
    expect(blocs).toEqual(['après le vide'])
  })

  it('ne perd rien quand la première page n’annonce aucun bloc du tout', async () => {
    const blocs = await collecter({ NextToken: 'a' }, pagineur({ a: { Blocks: ['x'] } }))
    expect(blocs).toEqual(['x'])
  })
})
