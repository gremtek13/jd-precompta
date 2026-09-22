import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// UN ÉCRAN QUI SIGNALE UNE LECTURE PARTIELLE LES SIGNALE TOUTES.
//
// `lireTout` rend `{ lignes, complete, motif }` précisément pour que l'appelant ne puisse plus
// ignorer le plafond de PostgREST « par omission » — c'est écrit dans son en-tête. Mais recevoir le
// drapeau et le LIRE sont deux choses : un écran peut poser un `BandeauLecturePartielle`, le câbler
// sur deux lectures, et jeter le drapeau des sept autres. Le bandeau reste alors éteint sur une
// lecture tronquée, et son silence se lit « tout a été lu ».
//
// C'est le défaut de `ClotureTab`, que CLAUDE.md décrit déjà : il refusait la 2035 sur une lecture
// partielle « en n'ayant vérifié QUE les pièces, soit une entrée sur cinq », et « le garde-fou
// promettait donc "ce formulaire est bâti sur tout" sans pouvoir le tenir ». Corrigé là, resté
// entier sur HUIT écrans voisins — 23 lectures, mesurées le 22/09/2026 :
//
//   ChecklistTab    4 lues / 5 jetées    PiecesTab      1 / 5     EstimationTab  2 / 5
//   BanqueTab       2 / 2                ClientHome     2 / 2     ClientUpload   2 / 2
//   DocumentsTab    1 / 1                EcrituresTab   6 / 1
//
// POURQUOI « TOUTES OU AUCUNE » ET NON « TOUTES, POINT » : neuf écrans ne signalent RIEN, et leur
// donner un signal est une décision par écran (que dit-on au client ? faut-il bloquer un export ?),
// pas une correction. Ce contrôle mord donc exactement sur le défaut démontré — une promesse tenue à
// moitié — et il se met à mordre tout seul sur un écran le jour où il gagne son premier signal.
// Les 29 lectures restantes sont nommées dans CLAUDE.md plutôt que laissées croire couvertes.

/** Les exceptions portent une RAISON et un NOMBRE — dispenser un fichier dispenserait ses lectures
 *  correctes aussi, et une rechute y passerait sans un mot (leçon de `datesUtc.test.ts`). */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {}

function sourcesDeProduction(): { chemin: string; texte: string }[] {
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
  parcourir(new URL('../', import.meta.url), 'src/')
  parcourir(new URL('../../supabase/functions/', import.meta.url), 'supabase/functions/')
  return trouves
}

/**
 * Remplace chaque commentaire par des espaces de MÊME longueur — les index restent valides.
 *
 * Indispensable ici, et ce n'est pas de la prudence : les tableaux `Promise.all` de ce dépôt
 * portent de longs commentaires, et une virgule dedans décale l'appariement entrée ↔ nom. Mon
 * premier détecteur s'y est fait prendre et a rendu « ?position 7 » sur du code parfaitement
 * apparié.
 */
export function sansCommentaires(src: string): string {
  const out = [...src]
  let i = 0
  let chaine: string | null = null
  while (i < src.length) {
    const c = src[i]
    if (chaine) {
      if (c === '\\') { i += 2; continue }
      if (c === chaine) chaine = null
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { chaine = c; i++; continue }
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i); if (j === -1) j = src.length
      for (let k = i; k < j; k++) out[k] = ' '
      i = j; continue
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i); j = j === -1 ? src.length : j + 2
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' '
      i = j; continue
    }
    i++
  }
  return out.join('')
}

/** Le contenu du groupe ouvert en `i`, et l'index de sa fermeture. */
function groupe(src: string, i: number): { corps: string; fin: number } {
  const paires: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const ouvre = src[i]; const ferme = paires[ouvre]
  let prof = 0; let j = i; let chaine: string | null = null
  while (j < src.length) {
    const c = src[j]
    if (chaine) {
      if (c === '\\') { j += 2; continue }
      if (c === chaine) chaine = null
    } else if (c === '"' || c === "'" || c === '`') chaine = c
    else if (c === ouvre) prof++
    else if (c === ferme) { prof--; if (prof === 0) return { corps: src.slice(i + 1, j), fin: j } }
    j++
  }
  return { corps: src.slice(i + 1), fin: src.length }
}

/**
 * Les entrées de PREMIER niveau d'un groupe, virgule de queue retirée.
 *
 * Le retrait de la virgule de queue tient PAR CONSTRUCTION, et c'est écrit ici plutôt que maquillé
 * en assertion de complaisance : une entrée vide n'apparaît qu'en FIN de liste, donc elle ne décale
 * jamais un indice antérieur — la mutation qui l'enlève a survécu, et elle avait raison. Ce qui
 * garde réellement l'appariement est la mutation qui décale `noms[k]` d'un cran, et celle-là mord.
 */
function decoupe(corps: string): string[] {
  const entrees: string[] = []
  let prof = 0; let cour = ''; let chaine: string | null = null
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i]
    if (chaine) {
      if (c === '\\') { cour += c + (corps[i + 1] ?? ''); i++; continue }
      if (c === chaine) chaine = null
    } else if (c === '"' || c === "'" || c === '`') chaine = c
    else if (c === '(' || c === '[' || c === '{') prof++
    else if (c === ')' || c === ']' || c === '}') prof--
    else if (c === ',' && prof === 0) { entrees.push(cour); cour = ''; continue }
    cour += c
  }
  entrees.push(cour)
  while (entrees.length > 0 && entrees[entrees.length - 1].trim() === '') entrees.pop()
  return entrees
}

/**
 * Les noms dont la complétude EST consultée.
 *
 * `motif` compte autant que `complete` : le contrat de `lireTout` dit qu'il vaut `null` SI ET
 * SEULEMENT SI `complete` est vrai, donc `a.motif ?? b.motif` est exactement le même contrôle.
 * Quatre écrans l'écrivent ainsi, et un détecteur qui ne chercherait que `complete` les accuserait
 * à tort — vérifié, c'est ce que le mien a fait d'abord.
 */
export function nomsCouverts(src: string): Set<string> {
  const couverts = new Set<string>()
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(?:complete|motif)\b/g)) couverts.add(m[1])
  // `[a, b, c].find((l) => !l.complete)` : la forme qui passe la liste entière au contrôle.
  for (const m of src.matchAll(/\[/g)) {
    const i = m.index!
    const { corps, fin } = groupe(src, i)
    if (!/^\s*\.\s*(?:filter|find|some|every|map)\s*\(/.test(src.slice(fin + 1, fin + 90))) continue
    const j = src.indexOf('(', fin + 1)
    if (j === -1) continue
    const rappel = groupe(src, j).corps
    if (!rappel.includes('complete') && !rappel.includes('motif')) continue
    for (const e of decoupe(corps)) {
      const nom = e.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(nom)) couverts.add(nom)
    }
  }
  return couverts
}

export interface Liaison { nom: string; couverte: boolean; table: string }

/** Toutes les liaisons d'un résultat de `lireTout`, dans leurs trois formes d'écriture. */
export function liaisonsLireTout(source: string): Liaison[] {
  const src = sansCommentaires(source)
  const couverts = nomsCouverts(src)
  const liaisons: Liaison[] = []
  const tableDe = (bout: string) => /from\(\s*['"`]([^'"`]+)/.exec(bout)?.[1] ?? '?'
  const ajouter = (nom: string, bout: string) => {
    const couverte = nom.startsWith('{')
      ? nom.includes('complete') || nom.includes('motif')
      : couverts.has(nom)
    liaisons.push({ nom, couverte, table: tableDe(bout) })
  }

  // 1 et 2 — `const X = await lireTout(` et `const { … } = await lireTout(`
  for (const m of source.matchAll(/const\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*await\s+lireTout\s*[<(]/g)) {
    ajouter(m[1].trim(), source.slice(m.index! + m[0].length, m.index! + m[0].length + 400))
  }
  // 3 — entrée d'un `Promise.all`, la forme normale d'un chargement d'écran ici : elle s'écrit
  //     SANS `await`, donc elle échappe à tout scanner ancré sur `await`.
  for (const m of src.matchAll(/const\s*\[/g)) {
    const i = src.indexOf('[', m.index!)
    const { corps: motif, fin } = groupe(src, i)
    if (!/^\s*=\s*await\s+Promise\.all\s*\(\s*\[/.test(src.slice(fin + 1, fin + 60))) continue
    const j = src.indexOf('[', src.indexOf('Promise.all', fin))
    const entrees = decoupe(groupe(src, j).corps)
    // La virgule de queue du MOTIF est retirée par `decoupe` comme celle des entrées : sans les
    // deux, l'appariement glisse d'un cran — et un écran de ce dépôt en porte une.
    const noms = decoupe(motif).map((n) => n.trim())
    entrees.forEach((e, k) => { if (e.includes('lireTout')) ajouter(noms[k] ?? `<position ${k}>`, e) })
  }
  return liaisons
}

/** Les lectures jetées d'un fichier qui, lui, signale — vide si le fichier ne signale rien. */
export function lecturesNonSignalees(chemin: string, source: string): string[] {
  const liaisons = liaisonsLireTout(source)
  if (!liaisons.some((l) => l.couverte)) return []
  const jetees = liaisons.filter((l) => !l.couverte).map((l) => `${chemin} — ${l.nom} [${l.table}]`)
  return jetees.slice(EXCEPTIONS[chemin]?.nombre ?? 0)
}

const TOUTES = sourcesDeProduction()

describe('un écran qui signale une lecture partielle les signale toutes', () => {
  it('parcourt bien les sources des deux côtés', () => {
    // Sans cette borne, un scanner qui ne lirait plus rien annoncerait « zéro faute » — la panne qui
    // ressemble exactement au succès, et que ce dépôt a déjà payée sous six autres noms.
    expect(TOUTES.length).toBeGreaterThan(80)
    expect(TOUTES.some((f) => f.chemin.startsWith('supabase/functions/'))).toBe(true)
    expect(TOUTES.filter((f) => liaisonsLireTout(f.texte).length > 0).length).toBeGreaterThanOrEqual(30)
  })

  it('ne trouve aucune lecture jetée sur un fichier qui en signale une', () => {
    const fautes = TOUTES.flatMap((f) => lecturesNonSignalees(f.chemin, f.texte))
    expect(
      fautes,
      'Ce fichier signale une lecture partielle pour certaines de ses lectures et pas pour ' +
      'celles-ci : le bandeau reste alors éteint sur une lecture tronquée, et son silence se lit ' +
      '« tout a été lu ». Ajoute-les au drapeau, ou inscris-les dans EXCEPTIONS avec leur raison.',
    ).toEqual([])
  })

  it('le compte des fichiers qui signalent ne baisse pas', () => {
    // Garde SYMÉTRIQUE, et elle n'est pas décorative : sans elle, « toutes ou aucune » serait
    // satisfait en retirant le dernier contrôle de complétude de chaque écran.
    const signalent = TOUTES.filter((f) => liaisonsLireTout(f.texte).some((l) => l.couverte))
    expect(signalent.length, signalent.map((f) => f.chemin).join("\n")).toBeGreaterThanOrEqual(23)
  })

  it('n’admet que des exceptions RÉELLES, chacune portant sa raison et son compte', () => {
    for (const [chemin, { nombre, raison }] of Object.entries(EXCEPTIONS)) {
      const fichier = TOUTES.find((f) => f.chemin === chemin)
      expect(fichier, `exception inventée : ${chemin}`).toBeDefined()
      const liaisons = liaisonsLireTout(fichier!.texte)
      expect(liaisons.filter((l) => !l.couverte).length, `${chemin} — ${raison}`).toBe(nombre)
      expect(raison.length).toBeGreaterThan(20)
    }
  })
})

// ── Le scanner éprouvé sur des sources SYNTHÉTIQUES : « zéro faute » et « aveugle » ne doivent
//    jamais se ressembler, et chaque piège qui m'a eu pendant la mesure porte son cas.
const AVEC_COMMENTAIRE = `
const [
  lectureA,
  lectureB,
] = await Promise.all([
  // Une virgule DANS un commentaire, comme partout dans ce dépôt : sans retrait des commentaires,
  // l'appariement entrée ↔ nom glisse d'un cran.
  lireTout((d, f) => supabase.from('pieces').select('*').range(d, f)),
  lireTout((d, f) => supabase.from('categories').select('*').range(d, f)),
])
setIncomplet(lectureA.motif)
`

const PAR_MOTIF = `
const lectureA = await lireTout((d, f) => supabase.from('pieces').select('*').range(d, f))
const lectureB = await lireTout((d, f) => supabase.from('categories').select('*').range(d, f))
setIncomplet(lectureA.motif ?? lectureB.motif)
`

const PAR_TABLEAU = `
const lectureA = await lireTout((d, f) => supabase.from('pieces').select('*').range(d, f))
const lectureB = await lireTout((d, f) => supabase.from('categories').select('*').range(d, f))
setIncomplet([lectureA, lectureB].find((l) => !l.complete)?.motif ?? null)
`

const SANS_AUCUN_SIGNAL = `
const lectureA = await lireTout((d, f) => supabase.from('pieces').select('*').range(d, f))
setPieces(lectureA.lignes)
`

describe('le scanner, éprouvé sur des sources synthétiques', () => {
  it('attrape la lecture jetée d’un fichier qui en signale une autre', () => {
    expect(lecturesNonSignalees('faux.tsx', AVEC_COMMENTAIRE)).toEqual(['faux.tsx — lectureB [categories]'])
  })

  it('compte `motif` comme un contrôle de complétude, à l’égal de `complete`', () => {
    // `motif` vaut null SI ET SEULEMENT SI `complete` est vrai : ne chercher que `complete`
    // accuserait quatre écrans corrects de ce dépôt.
    expect(lecturesNonSignalees('faux.tsx', PAR_MOTIF)).toEqual([])
  })

  it('comprend la forme `[a, b].find((l) => !l.complete)`', () => {
    expect(lecturesNonSignalees('faux.tsx', PAR_TABLEAU)).toEqual([])
  })

  it('se TAIT sur un fichier qui ne signale rien — c’est une autre question', () => {
    // Garde symétrique : sans elle, « toutes ou aucune » serait satisfait par un scanner qui crie
    // sur les 29 lectures des neuf écrans sans signal, c'est-à-dire par du bruit.
    expect(lecturesNonSignalees('faux.tsx', SANS_AUCUN_SIGNAL)).toEqual([])
    expect(liaisonsLireTout(SANS_AUCUN_SIGNAL)).toHaveLength(1)
  })

  it('apparie les entrées d’un `Promise.all` malgré la virgule de queue du motif', () => {
    expect(liaisonsLireTout(AVEC_COMMENTAIRE).map((l) => l.nom)).toEqual(['lectureA', 'lectureB'])
    expect(liaisonsLireTout(AVEC_COMMENTAIRE).map((l) => l.table)).toEqual(['pieces', 'categories'])
  })
})
