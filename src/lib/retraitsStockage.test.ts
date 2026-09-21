import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UN RETRAIT DE FICHIER EST LA SEULE ÉCRITURE QUE RIEN NE RECHARGE.
//
// Le balayage du 20/09/2026 sur les écritures non vérifiées posait la bonne question — *quelque
// chose recharge-t-il derrière ?* — mais il la posait des TABLES, où la réponse est presque toujours
// oui : un `load()` suit, la ligne supprimée réapparaît, l'échec se voit. **Pour le STOCKAGE la
// réponse est toujours non** : aucun écran de ce projet ne relit jamais un seau. Neuf retraits
// vivaient donc en `.remove([...]).catch(() => {})`, la façon la plus explicite possible de dire
// qu'on ne veut pas savoir.
//
// La règle ne reste pas dans CLAUDE.md, elle devient ce test — comme `verrousExecution` et
// `lecturesPaginees` avant lui, et pour la même raison : **une règle qu'il faut « penser à
// rejouer », et dont personne ne peut voir qu'elle a cessé d'être vraie, ne vaut rien.**

/**
 * Les fichiers qui ont le droit d'appeler `remove()` en direct, avec la raison.
 *
 * Une entrée ici doit expliquer pourquoi le point unique ne convient PAS — jamais « c'est plus
 * simple ». Deux à ce jour, et toutes deux ont besoin du RÉSULTAT, que `retirerFichiers` ne rend pas.
 */
const EXCEPTIONS: Record<string, string> = {
  'lib/stockage.ts':
    "c'est le point unique lui-même",
  'lib/suppressionDossier.ts':
    "elle construit un BILAN (combien retirés, lesquels refusés) que l'écran doit montrer : " +
    "journaliser ne suffit pas quand la ligne `dossiers` part aussi et que plus rien ne " +
    'pourra retrouver les fichiers ensuite',
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

/**
 * Retire les lignes ENTIÈREMENT en commentaire avant d'analyser.
 *
 * Nécessaire parce que ce dépôt EXPLIQUE ses défauts dans les commentaires : `stockage.ts` cite
 * `.catch(() => {})` en toutes lettres pour dire pourquoi c'est interdit. On ne coupe JAMAIS un
 * commentaire de fin de ligne — le code fautif serait alors AVANT le `//`, donc toujours vu, et
 * couper là risquerait d'avaler une chaîne contenant `//` (une URL) et de rendre le scanner aveugle
 * sur cette ligne.
 */
function sansCommentairesPleins(texte: string): string {
  return texte
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') ? '' : l))
    .join('\n')
}

/** Les retraits de fichier faits en direct, hors point unique. */
export function retraitsEnDirect(chemin: string, texte: string): string[] {
  const code = sansCommentairesPleins(texte)
  // La chaîne peut être coupée sur plusieurs lignes par le formatage du dépôt, d'où la fenêtre —
  // bornée, pour qu'un `.remove(` sans rapport bien plus bas ne soit pas rattaché à ce `.storage`.
  const trouves = [...code.matchAll(/\.storage[\s\S]{0,160}?\.remove\s*\(/g)]
  if (trouves.length === 0 || EXCEPTIONS[chemin]) return []
  return trouves.map((m) => m[0].replace(/\s+/g, ' '))
}

/** Les promesses ravalées — `.catch(() => {})` ne dit rien à personne, par construction. */
export function catchsMuets(texte: string): string[] {
  return [...sansCommentairesPleins(texte).matchAll(/\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g)].map((m) => m[0])
}

describe('un retrait de fichier passe par le point unique', () => {
  const tout = sources()

  it('parcourt bien les sources de production', () => {
    // Sans cette borne, un scanner qui ne lirait plus rien annoncerait « zéro faute » — la panne qui
    // ressemble exactement au succès, et que ce dépôt a déjà payée trois fois sur un même contrôle.
    expect(tout.length).toBeGreaterThan(60)
    expect(tout.map((f) => f.chemin)).toContain('lib/stockage.ts')
    expect(tout.map((f) => f.chemin)).toContain('pages/dossier/PiecesTab.tsx')
  })

  it('voit bien des retraits quelque part — sinon il ne garderait rien', () => {
    // La borne symétrique : le motif doit exister dans ces sources, sans quoi « aucun retrait en
    // faute » voudrait seulement dire « aucun retrait vu ».
    const total = tout.reduce((n, f) => n + (f.texte.match(/\.remove\s*\(/g)?.length ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(2)
  })

  it('n’en laisse aucun hors du point unique', () => {
    const fautes = tout.flatMap((f) => retraitsEnDirect(f.chemin, f.texte).map((e) => `${f.chemin} — ${e}`))
    expect(
      fautes.join('\n'),
      'rien ne recharge le stockage : un retrait raté hors de `retirerFichiers` n’a aucun témoin',
    ).toBe('')
  })

  it('n’admet que des exceptions qui correspondent à un fichier RÉEL portant un retrait', () => {
    // Sans ce contrôle la liste se remplirait de raisons mortes — une exception laissée après le
    // déplacement du code qu'elle dispensait, et personne pour s'en apercevoir.
    for (const chemin of Object.keys(EXCEPTIONS)) {
      const fichier = tout.find((f) => f.chemin === chemin)
      expect(fichier, `exception morte (fichier absent) : ${chemin}`).toBeDefined()
      expect(
        /\.storage[\s\S]{0,160}?\.remove\s*\(/.test(sansCommentairesPleins(fichier!.texte)),
        `exception morte (plus aucun retrait en direct) : ${chemin}`,
      ).toBe(true)
    }
  })

  it('ne ravale aucune promesse en silence', () => {
    // Aucune exception, comme pour le ternaire d'`erreursSupabase` : il n'existe pas de cas où
    // `.catch(() => {})` soit la bonne réponse. Vouloir ignorer un échec se dit en le journalisant.
    const fautes = tout.flatMap((f) => catchsMuets(f.texte).map(() => f.chemin))
    expect(fautes.join('\n')).toBe('')
  })
})

describe('le scanner lui-même — défaut PLANTÉ, pas espéré', () => {
  const fautif = `
    async function supprimer(doc) {
      await supabase.from('documents_divers').delete().eq('id', doc.id)
      await supabase.storage.from('pieces').remove([doc.storage_path]).catch(() => {})
    }
  `
  const correct = `
    async function supprimer(doc) {
      await retirerFichiers('pieces', [doc.storage_path], 'DocumentsTab')
    }
  `
  const commente = `
    // Six écrans écrivaient .storage.from('pieces').remove([p]).catch(() => {}) — plus aucun.
    await retirerFichiers('pieces', [p], 'X')
  `
  // Un `.remove(` qui n'est pas un retrait de FICHIER : le mot est courant (Set, Map, DOM).
  const homonyme = `
    lot.remove(cle)
    const n = new Set(); n.remove('x')
  `

  it('attrape un retrait fait en direct', () => {
    expect(retraitsEnDirect('pages/X.tsx', fautif)).toHaveLength(1)
  })

  it('attrape le .catch(() => {}) qui l’accompagnait', () => {
    expect(catchsMuets(fautif)).toHaveLength(1)
  })

  it('ne crie pas au loup sur un appel au point unique', () => {
    expect(retraitsEnDirect('pages/X.tsx', correct)).toEqual([])
    expect(catchsMuets(correct)).toEqual([])
  })

  it('ne se fait pas berner par un commentaire qui CITE le défaut', () => {
    // C'est le cas réel : `stockage.ts` explique pourquoi la forme est interdite, en l'écrivant.
    expect(retraitsEnDirect('pages/X.tsx', commente)).toEqual([])
    expect(catchsMuets(commente)).toEqual([])
  })

  it('ne confond pas un .remove() qui n’a rien à voir avec un fichier', () => {
    expect(retraitsEnDirect('pages/X.tsx', homonyme)).toEqual([])
  })

  it('respecte la liste d’exceptions, et seulement pour le fichier nommé', () => {
    expect(retraitsEnDirect('lib/stockage.ts', fautif)).toEqual([])
    expect(retraitsEnDirect('lib/stockage-bis.ts', fautif)).toHaveLength(1)
  })
})
