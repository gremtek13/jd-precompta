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
// L'EXCEPTION PORTE UN NOMBRE, PAS SEULEMENT UNE RAISON — la leçon de `datesUtc.test.ts`, portée
// ici le 22/09/2026 parce qu'elle manquait. Dispenser un FICHIER dispense TOUT le fichier, et les
// deux dispensés portent justement un retrait LÉGITIME : mesuré, un second retrait planté dans
// `stockage.ts` laissait les onze tests VERTS — dans les deux fichiers où le résidu ne sera jamais
// ramassé. Le compte doit tomber JUSTE : une de plus est une rechute, une de moins est une raison
// morte.
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'lib/stockage.ts': {
    nombre: 1,
    raison:
      "c'est le point unique lui-même : l'unique retrait que tous les écrans appellent, celui qui " +
      'journalise le chemin au lieu de bâtir un message par écran, et qui ne lève jamais',
  },
  'lib/suppressionDossier.ts': {
    nombre: 1,
    raison:
      "elle construit un BILAN (combien retirés, lesquels refusés) que l'écran doit montrer : " +
      "journaliser ne suffit pas quand la ligne `dossiers` part aussi et que plus rien ne " +
      'pourra retrouver les fichiers ensuite',
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

/**
 * Les retraits de fichier faits en direct. Il ne consulte PLUS les exceptions lui-même : une
 * fonction qui rend `[]` pour un fichier dispensé ne peut pas dire COMBIEN elle y a vu, donc le
 * compte ne serait comparable à rien. Le filtrage appartient à l'appelant.
 */
export function retraitsEnDirect(_chemin: string, texte: string): string[] {
  const code = sansCommentairesPleins(texte)
  // La chaîne peut être coupée sur plusieurs lignes par le formatage du dépôt, d'où la fenêtre —
  // bornée, pour qu'un `.remove(` sans rapport bien plus bas ne soit pas rattaché à ce `.storage`.
  return [...code.matchAll(/\.storage[\s\S]{0,160}?\.remove\s*\(/g)].map((m) => m[0].replace(/\s+/g, ' '))
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
    const fautes: string[] = []
    for (const f of tout) {
      const trouves = retraitsEnDirect(f.chemin, f.texte)
      if (trouves.length === 0) continue
      const exception = EXCEPTIONS[f.chemin]
      // Le compte doit être EXACT : une exception plus étroite que la réalité laisse les retraits
      // en trop remonter, avec de quoi comprendre pourquoi.
      if (exception && trouves.length === exception.nombre) continue
      const surplus = exception ? ` (exception déclarée pour ${exception.nombre}, trouvé ${trouves.length})` : ''
      fautes.push(...trouves.map((e) => `${f.chemin} — ${e}${surplus}`))
    }
    expect(
      fautes.join('\n'),
      'rien ne recharge le stockage : un retrait raté hors de `retirerFichiers` n’a aucun témoin',
    ).toBe('')
  })

  it('chaque exception porte sa raison ET son compte', () => {
    for (const [chemin, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      expect(raison.length, `${chemin} : une exception sans raison est une dette muette`).toBeGreaterThan(80)
      expect(nombre, `${chemin} : une exception sans compte dispense tout le fichier`).toBeGreaterThan(0)
    }
  })

  it('n’admet que des exceptions RÉELLES, ni mortes ni plus LARGES que ce qu’elles couvrent', () => {
    // Sans ce contrôle la liste se remplirait de raisons mortes — une exception laissée après le
    // déplacement du code qu'elle dispensait, et personne pour s'en apercevoir. Et sans le COMPTE,
    // elle couvrirait aussi le retrait que quelqu'un ajoutera demain à côté du légitime.
    for (const [chemin, { nombre }] of Object.entries(EXCEPTIONS)) {
      const fichier = tout.find((f) => f.chemin === chemin)
      expect(fichier, `exception morte (fichier absent) : ${chemin}`).toBeDefined()
      expect(
        retraitsEnDirect(chemin, fichier!.texte).length,
        `${chemin} : l’exception annonce ${nombre} retrait(s) dispensé(s)`,
      ).toBe(nombre)
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

  it('le détecteur COMPTE, il ne dispense plus — la dispense appartient à l’appelant', () => {
    // Il rendait `[]` pour un fichier dispensé. Une fonction qui rend `[]` ne peut pas dire COMBIEN
    // elle a vu, donc le compte d'une exception n'était comparable à rien — et un second retrait
    // écrit à côté du légitime passait. Elle rend maintenant TOUT, et c'est l'appelant qui compare.
    expect(retraitsEnDirect('lib/stockage.ts', fautif)).toHaveLength(1)
    expect(retraitsEnDirect('lib/stockage-bis.ts', fautif)).toHaveLength(1)
  })

  it('la dispense vaut pour le fichier NOMMÉ et jusqu’à son COMPTE, jamais au-delà', () => {
    // La règle telle qu'elle vit maintenant, éprouvée sur un jeu synthétique : un fichier dispensé
    // pour UN retrait qui en porte DEUX est en faute, et un fichier non nommé l'est dès le premier.
    const filtrer = (chemin: string, texte: string) => {
      const trouves = retraitsEnDirect(chemin, texte)
      const exception = EXCEPTIONS[chemin]
      return exception && trouves.length === exception.nombre ? [] : trouves
    }
    expect(filtrer('lib/stockage.ts', fautif)).toEqual([])
    expect(filtrer('lib/stockage.ts', `${fautif}\n${fautif}`)).toHaveLength(2)
    expect(filtrer('lib/stockage-bis.ts', fautif)).toHaveLength(1)
  })
})
