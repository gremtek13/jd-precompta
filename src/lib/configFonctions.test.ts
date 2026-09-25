import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `supabase/config.toml` : le réglage `verify_jwt` de chaque Edge Function, inscrit dans le dépôt.
//
// Pourquoi ce test existe. Jusqu'au 25/09/2026 ce réglage ne vivait qu'en production : la règle de
// CLAUDE.md disait de le relire par `list_edge_functions` avant chaque déploiement — c'est-à-dire de
// recopier la production sur elle-même, sans rien à quoi la comparer. Un projet recréé ou une
// installation ailleurs repartait sans lui, et l'outil de déploiement met `true` quand on l'omet.
//
// Ce qu'il garde, ce sont les trois façons dont ce fichier peut mentir sans que personne le voie :
// - une fonction ajoutée sans sa section (elle serait déployée avec la valeur par défaut) ;
// - une clé mal orthographiée. La CLI Supabase 2.117 l'IGNORE SANS ERREUR (vérifié : `verify_jwts`
//   est accepté, puis retombe sur `true`) — c'est le piège qui rend ce test nécessaire plutôt que
//   décoratif ;
// - une section pour une fonction qui n'existe plus, qui ferait croire à un réglage vivant.
// Et un seul invariant de VALEUR, parce qu'il a une raison qui ne dépend de personne : `receive-email`
// reçoit le webhook de Resend, qui ne porte aucun jeton, donc `true` y refuserait chaque e-mail
// entrant à la passerelle, sans un log.
//
// Ce qu'il ne garde PAS : que la production porte ces valeurs. Aucun outil de ce dépôt ne lit la
// production ; `list_edge_functions` se relit avant chaque déploiement, et une divergence avec ce
// fichier est un incident à comprendre.

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

interface Configuration {
  projectId: string | null
  /** Fonction → valeur de `verify_jwt` (absente si la section ne la porte pas). */
  fonctions: Map<string, boolean | undefined>
  /** Tout ce que ce lecteur ne sait pas lire — une faute, jamais un saut. */
  fautes: string[]
}

/**
 * Lit le sous-ensemble du TOML que ce fichier a le droit de porter, et rien d'autre : `project_id` en
 * tête, puis des sections `[functions.<nom>]` ne portant que `verify_jwt = true|false`. Une ligne d'une
 * autre forme est rendue en faute plutôt qu'ignorée — la CLI, elle, ignore ce qu'elle ne connaît pas,
 * et c'est précisément ce silence-là qu'il faut empêcher.
 */
function lireConfiguration(texte: string): Configuration {
  const configuration: Configuration = { projectId: null, fonctions: new Map(), fautes: [] }
  let section: string | null = null
  texte.split('\n').forEach((brute, i) => {
    const ligne = brute.trim()
    if (ligne === '' || ligne.startsWith('#')) return
    const entete = ligne.match(/^\[functions\.([a-z0-9-]+)\]$/)
    if (entete) {
      section = entete[1]
      if (configuration.fonctions.has(section)) configuration.fautes.push(`ligne ${i + 1} : section ${section} en double`)
      configuration.fonctions.set(section, undefined)
      return
    }
    const cle = ligne.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/)
    if (section === null && cle?.[1] === 'project_id' && /^"[^"]+"$/.test(cle[2])) {
      configuration.projectId = cle[2].slice(1, -1)
      return
    }
    if (section !== null && cle?.[1] === 'verify_jwt' && /^(true|false)$/.test(cle[2])) {
      if (configuration.fonctions.get(section) !== undefined) configuration.fautes.push(`ligne ${i + 1} : verify_jwt en double pour ${section}`)
      configuration.fonctions.set(section, cle[2] === 'true')
      return
    }
    configuration.fautes.push(`ligne ${i + 1} : « ${ligne} »`)
  })
  return configuration
}

function dossiersDeFonctions(): string[] {
  return readdirSync(racine('supabase/functions/'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

const configuration = lireConfiguration(readFileSync(racine('supabase/config.toml'), 'utf8'))

describe('supabase/config.toml', () => {
  it('ne porte que ce que ce lecteur sait vérifier', () => {
    expect(configuration.fautes).toEqual([])
    expect(configuration.projectId).toBe('jd-precompta')
  })

  it('donne une section à chaque fonction du dépôt, et à aucune autre', () => {
    const dossiers = dossiersDeFonctions()
    // Le plancher : sans lui, « chaque fonction a sa section » serait vrai d'un balayage aveugle.
    expect(dossiers.length).toBeGreaterThanOrEqual(13)
    expect([...configuration.fonctions.keys()].sort()).toEqual(dossiers)
  })

  it('dit pour chacune si la passerelle exige un jeton — la clé exacte, jamais une valeur par défaut', () => {
    const sansValeur = [...configuration.fonctions].filter(([, valeur]) => valeur === undefined).map(([nom]) => nom)
    expect(sansValeur).toEqual([])
  })

  it('laisse passer le webhook de Resend, qui ne porte aucun jeton', () => {
    expect(configuration.fonctions.get('receive-email')).toBe(false)
  })
})

describe('le lecteur de configuration lui-même', () => {
  it('refuse une clé mal orthographiée, que la CLI accepterait en silence', () => {
    const lu = lireConfiguration('project_id = "p"\n[functions.a]\nverify_jwts = false\n')
    expect(lu.fautes).toEqual(['ligne 3 : « verify_jwts = false »'])
    expect(lu.fonctions.get('a')).toBeUndefined()
  })

  it('refuse une valeur qui n’est pas un booléen, une section en double et toute autre clé', () => {
    expect(lireConfiguration('[functions.a]\nverify_jwt = "false"\n').fautes).toHaveLength(1)
    expect(lireConfiguration('[functions.a]\nverify_jwt = false\n[functions.a]\nverify_jwt = true\n').fautes).toHaveLength(1)
    expect(lireConfiguration('[functions.a]\nverify_jwt = false\nimport_map = "x"\n').fautes).toHaveLength(1)
    expect(lireConfiguration('[auth]\nsite_url = "x"\n').fautes).toHaveLength(2)
  })

  it('lit les commentaires comme des commentaires, et les valeurs comme des valeurs', () => {
    const lu = lireConfiguration('# en tête\nproject_id = "p"\n\n# la raison\n[functions.a]\nverify_jwt = true\n[functions.b]\nverify_jwt = false\n')
    expect(lu).toEqual({ projectId: 'p', fonctions: new Map([['a', true], ['b', false]]), fautes: [] })
  })
})
