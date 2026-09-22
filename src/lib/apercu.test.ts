import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const faux = vi.hoisted(() => ({
  url: 'https://exemple/fichier.pdf' as string | null,
  erreur: null as { message: string } | null,
  appels: [] as { seau: string; chemin: string; secondes: number }[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (seau: string) => ({
        createSignedUrl: (chemin: string, secondes: number) => {
          faux.appels.push({ seau, chemin, secondes })
          return Promise.resolve(
            faux.erreur || !faux.url
              ? { data: null, error: faux.erreur }
              : { data: { signedUrl: faux.url }, error: null },
          )
        },
      }),
    },
  },
}))

const { ouvrirApercu } = await import('./apercu')

// Ce que `window.open` a reçu, et ce qu'il a rendu. Le RETOUR est tout l'enjeu : c'est le seul
// signal qu'un navigateur donne quand il refuse une fenêtre surgissante.
const ouvert = { urls: [] as string[], bloque: false, opener: 'intact' as unknown }

beforeEach(() => {
  faux.url = 'https://exemple/fichier.pdf'
  faux.erreur = null
  faux.appels = []
  ouvert.urls = []
  ouvert.bloque = false
  ouvert.opener = 'intact'
  vi.stubGlobal('window', {
    // Le faux MODÉLISE la règle du navigateur qui décide de toute la conception de ce module : avec
    // le mot-clé `noopener`, la spécification HTML refuse de rendre une référence à l'ouvrant, donc
    // `window.open` rend `null` MÊME QUAND IL RÉUSSIT. Sans cette fidélité-là, remettre `noopener`
    // passerait inaperçu — et le module perdrait silencieusement sa seule façon de voir un blocage.
    open: (url: string, _cible?: string, options?: string) => {
      ouvert.urls.push(url)
      if (ouvert.bloque || (options ?? '').includes('noopener')) return null
      const onglet = { get opener() { return ouvert.opener }, set opener(v: unknown) { ouvert.opener = v } }
      return onglet
    },
  })
})

afterEach(() => { vi.unstubAllGlobals() })

describe('ouvrirApercu', () => {
  it('signe puis ouvre, et coupe la référence vers la page ouvrante', async () => {
    expect(await ouvrirApercu('pieces', 'd1/facture.pdf', 300)).toEqual({ ok: true })
    expect(faux.appels).toEqual([{ seau: 'pieces', chemin: 'd1/facture.pdf', secondes: 300 }])
    expect(ouvert.urls).toEqual(['https://exemple/fichier.pdf'])
    // `opener = null` plutôt que le mot-clé `noopener` : voir le test suivant, c'est lui qui
    // explique pourquoi les deux ne sont PAS interchangeables ici.
    expect(ouvert.opener).toBeNull()
  })

  it('DIT que le navigateur a bloqué, au lieu de rendre « ok »', async () => {
    // LE DÉFAUT D'ORIGINE, sur les cinq copies : personne ne lisait le retour de `window.open`.
    // Appelé après un `await` — ce que font les cinq, puisqu'ils attendent une URL signée — il sort
    // de la fenêtre d'activation transitoire du navigateur, rend `null`, et il ne se passe RIEN :
    // ni onglet, ni message. Un bouton cassé a exactement la même tête.
    ouvert.bloque = true
    const r = await ouvrirApercu('pieces', 'd1/facture.pdf', 300)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toMatch(/bloquée par le navigateur/)
    // Le message nomme la SORTIE, sinon il dit seulement qu'on a perdu.
    expect(r.ok === false && r.message).toMatch(/le fichier, lui, est bien là/)
  })

  it('rend la RAISON quand l’URL signée échoue, jamais « indisponible » tout court', async () => {
    // Trois des cinq copies disaient « Aperçu indisponible. » sans passer par `messageErreur` :
    // l'opérateur ne pouvait pas savoir s'il devait corriger, réessayer ou appeler l'administrateur.
    faux.erreur = { message: 'Object not found' }
    const r = await ouvrirApercu('packs', 'd1/p/pack.zip', 60)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toMatch(/Object not found/)
    // Et surtout : on n'ouvre rien.
    expect(ouvert.urls).toEqual([])
  })

  it('passe la durée de validité telle qu’on la lui donne', async () => {
    // Exigée sans valeur par défaut : 300 s pour consulter un justificatif, 60 s pour un
    // téléchargement immédiat. Un paramètre par défaut est un angle mort des tests.
    await ouvrirApercu('packs', 'd1/p/pack.zip', 60)
    expect(faux.appels[0].secondes).toBe(60)
  })
})

// LA RÈGLE DEVIENT UN TEST, comme `retraitsStockage` et `verrousExecution` avant elle.
//
// Cinq copies avaient divergé sur trois points (la raison de l'échec, `noopener`, le retour de
// `window.open`), et rien ne pouvait le voir. Le scanner part de TOUTE source de production de
// `src/` : un sixième appelant écrit demain est examiné sans que personne ait à y penser.
// L'EXCEPTION PORTE UN NOMBRE, PAS SEULEMENT UNE RAISON — la leçon de `datesUtc.test.ts`, portée
// ici le 22/09/2026 parce qu'elle manquait. Dispenser un FICHIER dispense TOUT le fichier : mesuré,
// un second `window.open` planté dans `apercu.ts` laissait les neuf tests VERTS, et le point unique
// cessait d'être unique en silence.
// Le compte doit tomber JUSTE : une de plus est une rechute, une de moins est une raison morte.
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'lib/apercu.ts': {
    nombre: 1,
    raison:
      "c'est le point unique lui-même : l'unique `window.open` du dépôt, celui dont tous les autres "
      + "écrans dépendent. C'est lui qui lit le retour, coupe `opener` et rend la raison de l'échec",
  },
}

function sources(): { chemin: string; texte: string }[] {
  const racine = new URL('../', import.meta.url)
  const trouves: { chemin: string; texte: string }[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, '')
  return trouves
}

// Les lignes ENTIÈREMENT en commentaire sont retirées : ce dépôt CITE la forme fautive pour
// l'expliquer — `apercu.ts` le fait en toutes lettres. On ne coupe jamais un commentaire de fin de
// ligne, le code fautif serait alors avant le `//` et couper là rendrait le scanner aveugle.
function sansCommentairesPleins(texte: string): string {
  return texte.split('\n').map((l) => {
    const t = l.trimStart()
    return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l
  }).join('\n')
}

export function ouverturesDirectes(fichiers: { chemin: string; texte: string }[]): string[] {
  const trouves: string[] = []
  for (const { chemin, texte } of fichiers) {
    const propre = sansCommentairesPleins(texte)
    const global = /window\s*\.\s*open\s*\(/g
    let m: RegExpExecArray | null
    while ((m = global.exec(propre)) !== null) {
      trouves.push(`${chemin}:${propre.slice(0, m.index).split('\n').length}`)
    }
  }
  return trouves
}

const SOURCE_FAUTIVE = `
export async function voir(chemin: string) {
  const { data } = await supabase.storage.from('pieces').createSignedUrl(chemin, 300)
  window.open(data.signedUrl, '_blank')
}
`

// La MÊME faute, coupée par le formatage normal du dépôt — la forme qui aveugle un scanner lisant
// « la ligne », et que ce projet s'est déjà fait servir quatre fois.
const SOURCE_FAUTIVE_MULTILIGNE = `
export function voir(url: string) {
  window
    .open(url, '_blank')
}
`

const SOURCE_SAINE = `
import { ouvrirApercu } from '../../lib/apercu'
export async function voir(chemin: string) {
  const r = await ouvrirApercu('pieces', chemin, 300)
  if (!r.ok) window.alert(r.message)
}
`

const SOURCE_COMMENTEE = `
// Jamais \`window.open(url)\` en direct : le retour n'y est pas lu.
export function ok() { return 1 }
`

describe('aucune ouverture de fenêtre hors du point unique', () => {
  const toutes = sources()

  it('balaie toutes les sources de production de src/', () => {
    expect(toutes.some((s) => s.chemin.startsWith('pages/'))).toBe(true)
    expect(toutes.some((s) => s.chemin.startsWith('lib/'))).toBe(true)
    expect(toutes.length).toBeGreaterThan(80)
  })

  /** Les ouvertures par fichier — c'est la granularité à laquelle le compte se compare. */
  const parFichier = (): Map<string, string[]> => {
    const m = new Map<string, string[]>()
    for (const o of ouverturesDirectes(toutes)) {
      const f = o.split(':')[0]
      m.set(f, [...(m.get(f) ?? []), o])
    }
    return m
  }

  it('ne laisse aucun `window.open` en dehors de lib/apercu.ts', () => {
    const fautifs: string[] = []
    for (const [fichier, ouvertures] of parFichier()) {
      const exception = EXCEPTIONS[fichier]
      // Le compte doit être EXACT : une exception plus étroite que la réalité laisse les sites en
      // trop remonter, avec de quoi comprendre pourquoi.
      if (exception && ouvertures.length === exception.nombre) continue
      const surplus = exception ? ` (exception déclarée pour ${exception.nombre}, trouvé ${ouvertures.length})` : ''
      fautifs.push(...ouvertures.map((o) => `${o}${surplus}`))
    }
    expect(fautifs).toEqual([])
  })

  it('chaque exception porte sa raison ET son compte', () => {
    for (const [chemin, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${chemin} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
      expect(nombre, `${chemin} : une exception sans compte dispense tout le fichier`).toBeGreaterThan(0)
    }
  })

  it('n’a aucune exception morte, ni plus LARGE que ce qu’elle couvre', () => {
    const vues = parFichier()
    for (const [chemin, { nombre }] of Object.entries(EXCEPTIONS)) {
      expect(vues.has(chemin), `exception inventée : ${chemin}`).toBe(true)
      expect(
        vues.get(chemin)?.length,
        `${chemin} : l’exception annonce ${nombre} ouverture(s) dispensée(s)`,
      ).toBe(nombre)
    }
  })

  it('attrape la forme fautive, y compris coupée sur plusieurs lignes', () => {
    expect(ouverturesDirectes([{ chemin: 'faux.ts', texte: SOURCE_FAUTIVE }])).toHaveLength(1)
    expect(ouverturesDirectes([{ chemin: 'faux.ts', texte: SOURCE_FAUTIVE_MULTILIGNE }])).toHaveLength(1)
  })

  it('laisse passer l’appel au point unique, et le défaut CITÉ dans un commentaire', () => {
    expect(ouverturesDirectes([{ chemin: 'sain.ts', texte: SOURCE_SAINE }])).toEqual([])
    expect(ouverturesDirectes([{ chemin: 'commente.ts', texte: SOURCE_COMMENTEE }])).toEqual([])
  })
})
