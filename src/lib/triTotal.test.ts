import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clesPrimairesDuSchema, fichiersDuSchema } from '../test/schema'
import { lireTout } from './lectureComplete'

// UN TRI QUI N'EST PAS TOTAL REND UNE LECTURE DE LA BONNE LONGUEUR ET DU MAUVAIS CONTENU — ET
// AUCUN DES GARDE-FOUS DE CE DÉPÔT NE PEUT LE VOIR.
//
// La règle est écrite depuis le portage : « Le tri doit être TOTAL. `date` n'est pas unique : sans
// clé de départage (`.order('id')`), deux tranches se recouvrent ou sautent des lignes, et rien ne
// le signale. » Elle est répétée dans trois commentaires de production (`lectureComplete.ts`,
// `exportCabinet.ts`, `agent-comptable`). Elle n'était gardée NULLE PART.
//
// Ce qui la rend différente de tout ce que ce dépôt garde déjà : `lireTout` reçoit une FERMETURE.
// Il ne voit pas la requête, donc il ne peut pas exiger le tri — la règle vit entièrement dans les
// cent vingt sites d'appel, écrite à la main à chaque fois.
//
// ET LA CONSÉQUENCE EST PIRE QUE LA TRONCATURE ORDINAIRE. Postgres ne garantit aucun ordre stable
// entre deux `range()` quand l'`ORDER BY` a des ex æquo : une ligne peut revenir deux fois pendant
// qu'une autre n'est jamais servie. La boucle accumule alors exactement le nombre de lignes
// ANNONCÉ, s'arrête, et `lignes.length === annonce` — donc **`complete: true`, `motif: null`**, sur
// un jeu qui porte un doublon et à qui il manque une ligne. Le test « le drapeau ment » plus bas
// l'exécute plutôt que de l'affirmer.
//
// Tous les contrôles déjà en place répondent à « la lecture est-elle COMPLÈTE ? » —
// `lecturesPaginees` (annonce-t-elle un compte ?), `lecturesSignalees` (lit-on le drapeau ?),
// `lecturesVerifiees` (lit-on l'erreur ?), `BandeauLecturePartielle` (le dit-on à l'opérateur ?).
// Aucun ne répond à « est-ce LES BONNES LIGNES ? ». Le drapeau dit « complet » et il dit vrai sur
// la longueur : c'est le contenu qui est faux. Un FEC, une balance ou une piste d'audit bâtis
// là-dessus sont une bonne nouvelle fabriquée, la pire forme de cette famille.
//
// MESURÉ LE 23/09/2026, AVANT D'ÉCRIRE CE TEST : 123 sites d'appel, **117 écrivent leur tri à la
// main et les 117 terminent par la clé primaire** — zéro faute. Ce contrôle ne corrige donc rien.
// Comme `edgeFunctionsCodeMort`, il est refermé sur un trou DÉMONTRÉ et non sur un défaut trouvé, et
// la différence mérite d'être écrite : ce qui le justifie est que la 118e lecture s'écrira à la
// main comme les autres, et que rien ne la regarderait.

// ────────────────────────────────────────────────────────────────────────────────────────────────
// DEUX PAGINEURS, DEUX FAÇONS D'OBTENIR LE TRI — ET UNE SEULE EST À LA MERCI DE QUI ÉCRIT.
//
// `lireTout(fermeture)` : le tri est dans la fermeture, donc écrit à la main. C'est la PORTE 1.
// `lireToutesLesLignes(table, …)` (socle de sauvegarde) : le tri est DÉRIVÉ de `CLES_PRIMAIRES`,
// lui-même épinglé au schéma par `sauvegardeClesPrimaires.test.ts`. Ses six sites n'ont donc rien à
// écrire et rien à oublier — c'est la PORTE 2, qui vérifie cette dérivation plutôt que les sites.
// ────────────────────────────────────────────────────────────────────────────────────────────────

const RACINE = new URL('../../', import.meta.url).pathname
const DOSSIERS = ['src', 'supabase/functions']

function sources(virtuelles: Record<string, string> = {}): { chemin: string; texte: string }[] {
  const out: { chemin: string; texte: string }[] = []
  const descendre = (dir: string) => {
    for (const nom of readdirSync(join(RACINE, dir))) {
      const rel = `${dir}/${nom}`
      if (statSync(join(RACINE, rel)).isDirectory()) { descendre(rel); continue }
      if (!/\.tsx?$/.test(nom) || nom.includes('.test.')) continue
      out.push({ chemin: rel, texte: readFileSync(join(RACINE, rel), 'utf8') })
    }
  }
  for (const d of DOSSIERS) descendre(d)
  for (const [chemin, texte] of Object.entries(virtuelles)) out.push({ chemin, texte })
  return out
}

/** Fin du groupe ouvert en `i` (`texte[i]` vaut `ouvre`), délimiteurs appariés. */
function finDuGroupe(texte: string, i: number, ouvre: string, ferme: string): number {
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    if (texte[k] === ouvre) profondeur++
    else if (texte[k] === ferme) {
      profondeur--
      if (profondeur === 0) return k
    }
  }
  return texte.length
}

export interface SiteTri {
  cle: string
  chemin: string
  ligne: number
  table: string | null
  ordres: string[]
}

// LE CORPS EST DÉLIMITÉ PAR LES PARENTHÈSES APPARIÉES, JAMAIS PAR « LA LIGNE ».
//
// C'est la huitième fois que ce dépôt se ferait prendre par un retour à la ligne, et ici il n'y a
// même pas de cas limite : le formatage normal du dépôt écrit la fermeture sur trois à six lignes,
// `.from(` sur l'une, `.order(` sur une autre. Un détecteur qui lit « la ligne » ne verrait AUCUN
// tri, donc déclarerait les 117 sites en faute — il crierait au loup au lieu d'être aveugle, ce qui
// est le sens le moins dangereux mais tout aussi inutilisable.
export function sitesDeLecturePaginee(virtuelles: Record<string, string> = {}): SiteTri[] {
  const sites: SiteTri[] = []
  for (const { chemin, texte } of sources(virtuelles)) {
    for (const m of texte.matchAll(/\blireTout\b/g)) {
      // Une DÉFINITION n'est pas un appel : `async function lireTout<T>(` porte une liste de
      // paramètres, pas une fermeture. Il y en a trois dans le dépôt (src + les deux copies
      // auto-portées des Edge Functions).
      if (/\b(?:function|const|let)\s*$/.test(texte.slice(Math.max(0, m.index - 30), m.index))) continue
      let j = m.index + 'lireTout'.length
      if (texte[j] === '<') j = finDuGroupe(texte, j, '<', '>') + 1
      while (j < texte.length && /\s/.test(texte[j])) j++
      if (texte[j] !== '(') continue
      const corps = texte.slice(j, finDuGroupe(texte, j, '(', ')') + 1)
      const table = /\.from\(\s*['"](\w+)['"]/.exec(corps)?.[1] ?? null
      const ordres = [...corps.matchAll(/\.order\(\s*['"]([\w.]+)['"]/g)].map((o) => o[1])
      const ligne = texte.slice(0, m.index).split('\n').length
      sites.push({ cle: `${chemin} [${table ?? '?'}]`, chemin, ligne, table, ordres })
    }
  }
  return sites
}

// Clé : `chemin [table]`. La raison n'est pas décorative — c'est pourquoi ce site n'a pas besoin
// d'un tri unique écrit à la main. Et elle porte un NOMBRE, la leçon de `datesUtc.test.ts` : un
// fichier dispensé l'est ENTIÈREMENT, or les fichiers dispensés ici portent aussi des lectures
// correctes. Une de plus est une rechute, une de moins est une raison morte.
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {}

/**
 * Les sites dont le tri n'est PAS total, avec la raison.
 *
 * UNE TABLE NON RECONNUE EST UNE FAUTE, JAMAIS UN SAUT. Sans cette décision, il suffirait qu'une
 * lecture soit écrite d'une forme que le détecteur ne sait pas lire pour qu'elle passe en silence —
 * et « zéro faute » redeviendrait indiscernable d'« aveugle », la panne que ce dépôt connaît sous
 * six noms.
 */
export function triNonTotal(
  virtuelles: Record<string, string> = {},
  cles: Map<string, string[]> = clesPrimairesDuSchema(fichiersDuSchema()),
  exceptions: Record<string, { nombre: number; raison: string }> = EXCEPTIONS,
): string[] {
  const vus = new Map<string, number>()
  const fautes: string[] = []
  for (const site of sitesDeLecturePaginee(virtuelles)) {
    vus.set(site.cle, (vus.get(site.cle) ?? 0) + 1)
    if (exceptions[site.cle]) continue
    if (site.table == null) {
      fautes.push(`${site.chemin}:${site.ligne} — table illisible dans la fermeture`)
      continue
    }
    const pk = cles.get(site.table)
    if (pk == null || pk.length === 0) {
      fautes.push(`${site.chemin}:${site.ligne} — « ${site.table} » n'a aucune clé primaire dans le schéma exporté`)
      continue
    }
    const manquantes = pk.filter((c) => !site.ordres.includes(c))
    if (manquantes.length > 0) {
      fautes.push(
        `${site.chemin}:${site.ligne} — tri non total sur « ${site.table} » : ` +
          `order(${site.ordres.join(', ') || '—'}) ne départage pas ${manquantes.join(', ')}`,
      )
    }
  }
  for (const [cle, { nombre }] of Object.entries(exceptions)) {
    const reel = vus.get(cle) ?? 0
    if (reel !== nombre) fautes.push(`exception « ${cle} » annonce ${nombre} lecture(s), il y en a ${reel}`)
  }
  return fautes
}

describe('tri total des lectures paginées', () => {
  const sites = sitesDeLecturePaginee()

  it('toute lecture paginée départage ses lignes par la clé primaire', () => {
    expect(triNonTotal()).toEqual([])
  })

  it('voit encore quelque chose — le plancher qui sépare « zéro faute » d’« aveugle »', () => {
    const avecTable = sites.filter((s) => s.table != null)
    expect(avecTable.length).toBeGreaterThanOrEqual(110)
    expect(new Set(avecTable.map((s) => s.table)).size).toBeGreaterThanOrEqual(30)
    // Les fermetures s'écrivent sur plusieurs lignes : si le détecteur lisait « la ligne », il ne
    // trouverait ni table ni tri. Les trois bornes ci-dessus tomberaient.
    expect(sites.filter((s) => s.ordres.length > 0).length).toBeGreaterThanOrEqual(110)

    // CE PLANCHER EST PORTANT, ET C'EST MESURÉ PLUTÔT QU'AFFIRMÉ. Pointer le balayage sur AUCUN
    // dossier réel (`DOSSIERS = []`) laisse passer tous les autres tests — les cas synthétiques
    // s'injectent dans le scanner et continuent de mordre — et ne fait tomber que celui-ci. La même
    // mutation AVEC les trois bornes neutralisées ne fait tomber PLUS RIEN : « zéro faute » et
    // « aveugle » redeviennent alors indiscernables, ce qui est exactement ce que ce test achète.
  })

  it('ignore les DÉFINITIONS de `lireTout`, jamais les appels', () => {
    // Trois définitions : `src/lib/lectureComplete.ts` et les deux copies auto-portées
    // (`agent-comptable`, `superpdp-sync`). Aucune ne doit compter comme site de lecture.
    expect(sites.some((s) => s.chemin === 'src/lib/lectureComplete.ts')).toBe(false)
  })

  it('attrape une lecture dont le tri ne départage pas', () => {
    const fautes = triNonTotal({
      'src/faux.ts': `
        const lecture = await lireTout<Piece>((debut, fin) =>
          supabase.from('pieces').select('*', { count: 'exact' })
            .eq('dossier_id', id)
            .order('date_piece')
            .range(debut, fin),
        )`,
    })
    expect(fautes.some((f) => f.includes('src/faux.ts') && f.includes('pieces'))).toBe(true)
  })

  it('ne crie pas au loup sur une lecture correcte coupée sur cinq lignes', () => {
    const fautes = triNonTotal({
      'src/bon.ts': `
        const lecture = await lireTout<Piece>((debut, fin) =>
          supabase.from('pieces').select('*', { count: 'exact' })
            .eq('dossier_id', id)
            .order('date_piece')
            .order('id')
            .range(debut, fin),
        )`,
    })
    expect(fautes.filter((f) => f.includes('src/bon.ts'))).toEqual([])
  })

  it('traite une table inconnue du schéma comme une FAUTE, pas comme un saut', () => {
    const fautes = triNonTotal({
      'src/inconnu.ts': `await lireTout((d, f) => supabase.from('table_absente').select('*').order('id').range(d, f))`,
    })
    expect(fautes.some((f) => f.includes('table_absente'))).toBe(true)
  })

  // LA RÈGLE DU NOMBRE EST EXERCÉE ALORS QU'AUCUNE EXCEPTION N'EXISTE ENCORE — et c'est délibéré.
  // `EXCEPTIONS` est vide aujourd'hui : sans cas synthétique, le comptage serait du code que rien
  // n'a jamais fait tourner, donc faux le jour où quelqu'un inscrit la première dispense. C'est
  // précisément ce qui s'est passé sur trois scanners de ce dépôt le 22/09/2026, dispensant un
  // FICHIER au lieu d'un nombre et entièrement aveugles derrière.
  it('exige que le compte d’une exception tombe JUSTE, dans les deux sens', () => {
    const deux = {
      'src/deux.ts': `
        await lireTout((d, f) => supabase.from('pieces').select('*').order('date_piece').range(d, f))
        await lireTout((d, f) => supabase.from('pieces').select('*').order('date_piece').range(d, f))`,
    }
    const cle = 'src/deux.ts [pieces]'
    // On ne juge QUE la source synthétique : ce test porte sur le comptage, pas sur la propreté du
    // dépôt, et les mélanger le ferait tomber pour la raison d'un autre.
    const sien = (n: number) =>
      triNonTotal(deux, undefined, { [cle]: { nombre: n, raison: 'essai' } })
        .filter((f) => f.includes('src/deux.ts'))
    // Le compte juste : les deux lectures fautives sont bien dispensées, et rien ne sort.
    expect(sien(2)).toEqual([])
    // Une de MOINS annoncée : la dispense couvrirait une lecture qu'on n'a pas examinée.
    expect(sien(1)).toEqual([`exception « ${cle} » annonce 1 lecture(s), il y en a 2`])
    // Une de PLUS annoncée : une raison morte, qui survivrait au retrait de la lecture.
    expect(sien(3)).toEqual([`exception « ${cle} » annonce 3 lecture(s), il y en a 2`])
  })

  it('refuse une exception qui ne correspond à aucune lecture réelle', () => {
    const vus = new Set(sites.map((s) => s.cle))
    for (const cle of Object.keys(EXCEPTIONS)) expect(vus.has(cle)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// PORTE 2 : LE SOCLE DE SAUVEGARDE NE VEUT PAS DE CE SCANNER, ET IL FAUT DIRE POURQUOI.
//
// Ses six sites passent `lireToutesLesLignes(table, …)` sans écrire de tri : c'est le pagineur qui
// le DÉRIVE de `CLES_PRIMAIRES`, colonne par colonne — ce qui compte pour les six tables à clé
// composite, où trier sur la première ne départage rien. Ce que ce contrôle vérifie est donc la
// dérivation, pas les sites ; le CONTENU de `CLES_PRIMAIRES` est épinglé au schéma ailleurs
// (`sauvegardeClesPrimaires.test.ts`, sans aucune exception, dans les deux sens).
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('tri total — le socle de sauvegarde le dérive au lieu de l’écrire', () => {
  const socle = readFileSync(join(RACINE, 'src/lib/sauvegardeDonnees.ts'), 'utf8')

  it('ordonne sur TOUTES les colonnes de la clé primaire', () => {
    expect(socle).toMatch(/const tri = clePrimaire\(table\)/)
    expect(socle).toMatch(/for \(const colonne of tri\) requete = requete\.order\(colonne\)/)
  })

  it('ne trie sur rien d’autre — aucun `.order(` littéral dans le socle', () => {
    expect([...socle.matchAll(/\.order\(\s*['"]/g)]).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// CE QUE `lireTout` NE PEUT PAS VOIR — EXÉCUTÉ, PAS AFFIRMÉ.
//
// Ce n'est pas un défaut de `lireTout` et ce test ne demande pas qu'il change : il n'a que les
// lignes qu'on lui rend, et rien de générique ne distingue un doublon d'une ligne légitimement
// identique. Il FIGE la frontière, pour que la phrase « le drapeau dit complet et le contenu est
// faux » cesse d'être une affirmation de commentaire. C'est aussi la garde symétrique : le jour où
// quelqu'un croira que `complete` protège du contenu, ce test dira le contraire.
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('tri non total — ce que le drapeau `complete` ne peut pas dire', () => {
  it('rend `complete: true` sur un jeu qui porte un doublon et à qui il manque une ligne', async () => {
    // Trois lignes en base (a, b, c), tranches de deux. Le serveur, faute de tri total, sert « b »
    // deux fois et jamais « c » — ce que produit un `ORDER BY date` sur deux lignes de même date.
    const tranches = [[{ id: 'a' }, { id: 'b' }], [{ id: 'b' }]]
    const lecture = await lireTout<{ id: string }>(
      (debut) => Promise.resolve({ data: tranches[debut / 2] ?? [], error: null, count: 3 }),
      2,
    )

    expect(lecture.complete).toBe(true)
    expect(lecture.motif).toBeNull()
    expect(lecture.lignes.map((l) => l.id)).toEqual(['a', 'b', 'b'])
    // La ligne « c » n'a jamais été servie, et rien dans le résultat ne le dit.
    expect(lecture.lignes.some((l) => l.id === 'c')).toBe(false)
  })

  it('dit bien « incomplet » quand la troncature est ORDINAIRE — la garde symétrique', async () => {
    // Sans quoi « le drapeau ne voit pas le contenu » serait satisfait par un drapeau qui ne voit
    // jamais rien. Ici le serveur CESSE de rendre après une ligne : la longueur ne colle plus au
    // compte annoncé, et c'est précisément ce que `complete` sait voir.
    const tranches = [[{ id: 'a' }], []]
    const lecture = await lireTout<{ id: string }>(
      (debut) => Promise.resolve({ data: tranches[debut / 2] ?? [], error: null, count: 3 }),
      2,
    )
    expect(lecture.complete).toBe(false)
    expect(lecture.motif).toContain('1 ligne(s) lue(s) sur 3')
  })
})
