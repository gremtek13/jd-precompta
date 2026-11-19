import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHEMINS_DOSSIER } from './sauvegarde'
import { COLONNES_DES_PLAFONDS, PLAFONDS_HORS_DU_CLIENT_PREVUS, plafondsParCabinet } from './plafondsDeLAssistant'

// LES LECTURES DE `cabinets` NOMMENT LEURS COLONNES, ET AUCUNE NE DEMANDE LES PLAFONDS DE L'ASSISTANT (OPT1-Q3 (B), 19/11/2026).
// La migration `plafonds_hors_du_client` retire aux deux rôles de l'API la lecture de la table et leur rend chaque colonne,
// les deux plafonds exceptés : après elle, une lecture `*` — ou qui nomme un plafond — d'un connecté échoue (42501), et un
// écran d'avant se croirait en panne. Un resserrement vient en dernier : ce scanner garde, AVANT la migration, que plus rien
// ne la demande. Il part de TOUT : chaque `.from('cabinets')` des sources de `src/` et de `supabase/functions/` (hors des
// tests et des fabriques de test), sa chaîne d'appels lue comme une EXPRESSION — jamais la ligne —, et chaque `.select(`
// de cette chaîne jugé sur son premier argument ; une forme qu'il ne lit pas est une faute. Une exception porte sa raison et
// son nombre ; un plancher distingue « zéro faute » d'« aveugle ». Le récit : HISTORIQUE.md, « 19/11/2026 — OPT1-Q3 : LES
// PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT ».

const RACINE = join(__dirname, '..', '..')

function sources(dossier: string): string[] {
  const rendu: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) {
      if (nom === 'node_modules' || chemin === join(RACINE, 'src', 'test')) continue
      rendu.push(...sources(chemin))
    } else if (/\.(ts|tsx)$/.test(nom) && !/\.test\.tsx?$/.test(nom)) {
      rendu.push(chemin)
    }
  }
  return rendu
}

/** L'indice qui suit la parenthèse fermante de celle ouverte à `ouvrante`, chaînes et gabarits sautés ; -1 sans elle. */
function finDesParentheses(texte: string, ouvrante: number): number {
  let profondeur = 0
  for (let i = ouvrante; i < texte.length; i++) {
    const c = texte[i]
    if (c === '\'' || c === '"' || c === '`') {
      const fin = texte.indexOf(c, i + 1)
      if (fin < 0) return -1
      i = fin
    } else if (c === '(') {
      profondeur++
    } else if (c === ')') {
      profondeur--
      if (profondeur === 0) return i + 1
    }
  }
  return -1
}

interface Appel { methode: string; arguments: string }

/** La chaîne d'appels qui suit `.from('cabinets')` : chaque `.methode(arguments)`, blancs et retours à la ligne sautés,
 *  jusqu'au premier caractère qui n'en continue pas une. */
function chaineApres(texte: string, debut: number): Appel[] {
  const appels: Appel[] = []
  let i = debut
  for (;;) {
    let j = i
    while (j < texte.length && /\s/.test(texte[j])) j++
    if (texte[j] !== '.') return appels
    const nom = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(texte.slice(j))
    if (!nom) return appels
    const ouvrante = j + nom[0].length - 1
    const fin = finDesParentheses(texte, ouvrante)
    if (fin < 0) return appels
    appels.push({ methode: nom[1], arguments: texte.slice(ouvrante + 1, fin - 1) })
    i = fin
  }
}

/** Le premier argument d'un appel, à la première virgule hors des chaînes, parenthèses et accolades. */
function premierArgument(argumentsDeLAppel: string): string {
  let profondeur = 0
  for (let i = 0; i < argumentsDeLAppel.length; i++) {
    const c = argumentsDeLAppel[i]
    if (c === '\'' || c === '"' || c === '`') {
      const fin = argumentsDeLAppel.indexOf(c, i + 1)
      if (fin < 0) return argumentsDeLAppel
      i = fin
    } else if (c === '(' || c === '{' || c === '[') profondeur++
    else if (c === ')' || c === '}' || c === ']') profondeur--
    else if (c === ',' && profondeur === 0) return argumentsDeLAppel.slice(0, i)
  }
  return argumentsDeLAppel
}

const LITTERAL = String.raw`(?:'[^'\\]*'|"[^"\\]*"|\`[^\`$\\]*\`)`
// Une liste de colonnes : un littéral, ou un littéral par branche d'un drapeau en capitales — rien d'autre ne se lit.
const FORME_LUE = new RegExp(String.raw`^\s*(?:${LITTERAL}|[A-Z][A-Z0-9_]*\s*\?\s*${LITTERAL}\s*:\s*${LITTERAL})\s*$`)

/** Les fautes d'une liste de colonnes demandée à `cabinets` : `*`, un plafond, ou une forme que le scanner ne lit pas. */
function fautesDUneSelection(argument: string): string[] {
  if (!FORME_LUE.test(argument)) return [`une liste de colonnes que le scanner ne lit pas : ${argument.trim()}`]
  const fautes: string[] = []
  for (const litteral of argument.match(new RegExp(LITTERAL, 'g')) ?? []) {
    const colonnes = litteral.slice(1, -1)
    if (colonnes.includes('*')) fautes.push(`« * » (${colonnes})`)
    for (const plafond of COLONNES_DES_PLAFONDS) {
      if (new RegExp(String.raw`\b${plafond}\b`).test(colonnes)) fautes.push(`le plafond ${plafond}`)
    }
  }
  return fautes
}

const DEPART = /\.from\(\s*(['"`])cabinets\1\s*\)/g

interface Lecture { fichier: string; ligne: number; receveur: string; fautes: string[]; appels: Appel[] }

function lecturesDe(fichier: string, texte: string): Lecture[] {
  const rendu: Lecture[] = []
  for (const m of texte.matchAll(DEPART)) {
    const debut = m.index ?? 0
    const avant = texte.slice(0, debut).replace(/\s+$/, '')
    const receveur = /([A-Za-z_$][\w$]*)$/.exec(avant)?.[1] ?? '?'
    const appels = chaineApres(texte, debut + m[0].length)
    const fautes = appels.filter((a) => a.methode === 'select').flatMap((a) => fautesDUneSelection(premierArgument(a.arguments)))
    rendu.push({ fichier, ligne: texte.slice(0, debut).split('\n').length, receveur, fautes, appels })
  }
  return rendu
}

// Les exceptions, chacune avec sa raison et son nombre de lectures fautives, au nombre près.
const EXCEPTIONS: readonly { fichier: string; nombre: number; raison: string }[] = [
  { fichier: 'supabase/functions/agent-comptable/index.ts', nombre: 1,
    raison: 'les plafonds lus par `verifierPlafondCabinet` avec la clé du service (service_role), que les droits par colonne ne touchent pas : la garde de la dépense' },
  { fichier: 'supabase/functions/create-client-access/index.ts', nombre: 1,
    raison: '`*` lu avec la clé du service (le dossier du cabinet, une colonne que la fonction ne nomme pas tant qu’elle peut manquer)' },
  { fichier: 'supabase/functions/delete-cabinet/index.ts', nombre: 1,
    raison: '`*` lu avec la clé du service, par le super-administrateur seul, avant de retirer le cabinet' },
  { fichier: 'src/pages/SuperAdminPage.tsx', nombre: PLAFONDS_HORS_DU_CLIENT_PREVUS ? 0 : 1,
    raison: 'l’écran du super-administrateur lit les plafonds de la table tant que la migration n’est pas en base ; le drapeau levé, par la fonction' },
]

const LECTURES = [join(RACINE, 'src'), join(RACINE, 'supabase', 'functions')]
  .flatMap(sources)
  .flatMap((f) => lecturesDe(relative(RACINE, f).split('\\').join('/'), readFileSync(f, 'utf8')))

describe('les lectures de `cabinets` (OPT1-Q3)', () => {
  it('le scanner voit chaque lecture du dépôt (le plancher)', () => {
    expect(LECTURES.length).toBeGreaterThanOrEqual(19)
    expect(new Set(LECTURES.map((l) => l.fichier)).size).toBeGreaterThanOrEqual(12)
    // Chaque `.from('cabinets')` porte une chaîne lue : un départ dont rien ne suit serait une forme inconnue.
    expect(LECTURES.filter((l) => l.appels.length === 0).map((l) => `${l.fichier}:${l.ligne}`)).toEqual([])
  })

  it('aucune lecture ne demande `*` ni un plafond, hors des exceptions déclarées, au nombre près', () => {
    const fautives = new Map<string, string[]>()
    for (const l of LECTURES) {
      if (l.fautes.length === 0) continue
      fautives.set(l.fichier, [...(fautives.get(l.fichier) ?? []), `${l.ligne} : ${l.fautes.join(' ; ')}`])
    }
    for (const e of EXCEPTIONS) {
      expect(e.raison.length, e.fichier).toBeGreaterThan(40)
      expect(fautives.get(e.fichier)?.length ?? 0, `${e.fichier} : ${e.raison}`).toBe(e.nombre)
      fautives.delete(e.fichier)
    }
    expect([...fautives.entries()]).toEqual([])
  })

  it('une Edge Function ne lit `cabinets` qu’avec la clé du service', () => {
    const parLAppelant = LECTURES.filter((l) => l.fichier.startsWith('supabase/functions/') && !['admin', 'supabaseAdmin'].includes(l.receveur))
    expect(parLAppelant.map((l) => `${l.fichier}:${l.ligne} (${l.receveur})`)).toEqual([])
  })

  it('aucun embarquement de `cabinets` dans une autre lecture', () => {
    const embarques: string[] = []
    for (const f of [join(RACINE, 'src'), join(RACINE, 'supabase', 'functions')].flatMap(sources)) {
      const texte = readFileSync(f, 'utf8')
      for (const m of texte.matchAll(/\.select\(/g)) {
        const fin = finDesParentheses(texte, (m.index ?? 0) + '.select'.length)
        const premier = premierArgument(texte.slice((m.index ?? 0) + '.select('.length, fin - 1))
        if (/\bcabinets\s*(?:![\w]+)?\s*\(/.test(premier)) embarques.push(`${relative(RACINE, f)} : ${premier.trim()}`)
      }
    }
    expect(embarques).toEqual([])
  })

  it('la sauvegarde ne lit pas `cabinets` par son lecteur générique (`*`)', () => {
    // `lireSelonChemin` rend [] pour un chemin « global » : la ligne du cabinet n'entre dans aucune sauvegarde.
    expect(CHEMINS_DOSSIER.cabinets).toEqual({ acces: 'global' })
  })
})

describe('le scanner mord sur les défauts plantés', () => {
  const juger = (texte: string) => lecturesDe('plante.ts', texte)
  it('`*`, un plafond, une liste qu’il ne lit pas, sur plusieurs lignes', () => {
    expect(juger("supabase.from('cabinets').select('*').eq('id', x)")[0].fautes).toEqual(['« * » (*)'])
    expect(juger("await supabase\n  .from(\"cabinets\")\n  .select(\"nom, limite_ia_blocage_usd\")\n  .maybeSingle()")[0].fautes)
      .toEqual(['le plafond limite_ia_blocage_usd'])
    expect(juger("supabase.from('cabinets').select(colonnes)")[0].fautes[0]).toMatch(/ne lit pas/)
    expect(juger("supabase.from('cabinets').select(FLAG ? 'id' : 'id, limite_ia_alerte_usd', { count: 'exact' })")[0].fautes)
      .toEqual(['le plafond limite_ia_alerte_usd'])
    expect(juger("supabase.from(`cabinets`).update({ nom }).eq('id', x).select()")[0].fautes[0]).toMatch(/ne lit pas/)
  })
  it('une lecture juste ne fait aucune faute, une écriture sans retour non plus', () => {
    expect(juger("supabase.from('cabinets').select('id, nom', { count: 'exact' }).order('id').range(a, b)")[0].fautes).toEqual([])
    expect(juger("admin.from('cabinets').insert({ nom }).select('id').single()")[0]).toMatchObject({ fautes: [], receveur: 'admin' })
    expect(juger("supabase.from('cabinets').update({ limite_ia_alerte_usd: 1 }).eq('id', x)")[0].fautes).toEqual([])
  })
})

describe('les plafonds rendus par la fonction (plafondsParCabinet)', () => {
  it('une ligne par cabinet ; nul veut dire « aucun plafond »', () => {
    const carte = plafondsParCabinet([
      { cabinet_id: 'a', limite_ia_alerte_usd: 10, limite_ia_blocage_usd: null },
      { cabinet_id: 'b', limite_ia_alerte_usd: '12.50', limite_ia_blocage_usd: '20' },
    ])
    expect(carte.get('a')).toEqual({ limite_ia_alerte_usd: 10, limite_ia_blocage_usd: null })
    expect(carte.get('b')).toEqual({ limite_ia_alerte_usd: 12.5, limite_ia_blocage_usd: 20 })
  })
  it('un cabinet absent, en double ou illisible n’est pas lu, jamais « sans plafond »', () => {
    const carte = plafondsParCabinet([
      { cabinet_id: 'd', limite_ia_alerte_usd: 1, limite_ia_blocage_usd: 2 },
      { cabinet_id: 'd', limite_ia_alerte_usd: 1, limite_ia_blocage_usd: 2 },
      { cabinet_id: 'e', limite_ia_alerte_usd: 'beaucoup', limite_ia_blocage_usd: null },
      { cabinet_id: 'f', limite_ia_alerte_usd: -1, limite_ia_blocage_usd: null },
    ])
    expect([...carte.keys()]).toEqual([])
    expect(carte.has('absent')).toBe(false)
  })
})
