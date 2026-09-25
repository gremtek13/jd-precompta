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
// L'INVARIANT EST « TOUTES, POINT », et il ne l'a été qu'au second temps. Le premier balayage l'a
// posé en « toutes ou aucune » parce que neuf écrans ne signalaient RIEN — leur donner un signal est
// une décision par écran (que dit-on au client ? faut-il bloquer un export ?) et non une correction,
// et un scanner qui aurait crié sur leurs 29 lectures aurait été du bruit. Les neuf ont été couverts
// dans la foulée, donc la borne faible n'a plus de raison d'être : les 110 sites du dépôt lisent
// désormais leur drapeau, et TOUTE lecture qui le jetterait est une faute.
// La version faible est écrite ici plutôt qu'effacée : c'est elle qui permet de reprendre ce
// contrôle sur un dépôt où le portage n'est pas fini, sans le rendre inécoutable.
//
// ET CE SCANNER NE LISAIT QUE TROIS FORMES D'ÉCRITURE — HUIT APPELS SUR 118 LUI ÉCHAPPAIENT
// (25/09/2026). Écrits `lireTout(…).then((lecture) => …)` ou `Promise.all([…]).then(([a, b]) => …)`,
// ils n'étaient ni comptés ni vérifiés, et cinq jetaient leur drapeau : les trois lectures qui font
// la liste des exercices d'un dossier (sous un commentaire qui décrivait le dégât), les relevés déjà
// classés de l'import bancaire, les catégories de la Balance. Le « 110 sites » ci-dessous était donc
// vrai des formes connues, pas du dépôt. C'est désormais le RECENSEMENT des appels qui fait foi : un
// appel qu'aucune forme ne lie est une FAUTE, et la prochaine forme se signalera d'elle-même.

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
  return entreesPositionnees(corps).map((e) => e.texte)
}

/** Les mêmes entrées, chacune avec sa position dans `corps` — pour savoir QUEL appel elle porte. */
function entreesPositionnees(corps: string): { texte: string; debut: number }[] {
  const entrees: { texte: string; debut: number }[] = []
  let prof = 0; let cour = ''; let debut = 0; let chaine: string | null = null
  for (let i = 0; i < corps.length; i++) {
    const c = corps[i]
    if (chaine) {
      if (c === '\\') { cour += c + (corps[i + 1] ?? ''); i++; continue }
      if (c === chaine) chaine = null
    } else if (c === '"' || c === "'" || c === '`') chaine = c
    else if (c === '(' || c === '[' || c === '{') prof++
    else if (c === ')' || c === ']' || c === '}') prof--
    else if (c === ',' && prof === 0) { entrees.push({ texte: cour, debut }); cour = ''; debut = i + 1; continue }
    cour += c
  }
  entrees.push({ texte: cour, debut })
  while (entrees.length > 0 && entrees[entrees.length - 1].texte.trim() === '') entrees.pop()
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

/** Nom donné à un appel qu'aucune forme connue ne lie : il est compté en faute, jamais sauté. */
export const FORME_NON_RECONNUE = '<forme non reconnue>'

/**
 * Chaque APPEL de `lireTout`, par sa position — sa définition exclue (elle vit dans
 * lib/lectureComplete.ts et, recopiée, dans deux Edge Functions).
 *
 * C'est ce RECENSEMENT qui fait foi, et c'est la leçon du 25/09/2026 : les trois formes connues
 * liaient 110 appels sur 118. Les huit autres s'écrivaient `lireTout(…).then((lecture) => …)` ou
 * `Promise.all([…]).then(([a, b]) => …)`, et le scanner ne les voyait pas du tout — cinq d'entre eux
 * jetaient leur drapeau, dont les trois lectures qui font la liste des exercices d'un dossier, sous
 * un commentaire qui décrivait déjà le dégât. Un appel qu'aucune forme ne lie est désormais une
 * FAUTE : la prochaine forme d'écriture se signalera d'elle-même au lieu de passer en silence.
 */
export function appelsLireTout(src: string): number[] {
  return [...src.matchAll(/\blireTout\s*[<(]/g)]
    .map((m) => m.index!)
    .filter((i) => !/\bfunction\s+$/.test(src.slice(Math.max(0, i - 40), i)))
}

/** Fin (parenthèse fermante) de l'appel dont le jeton `lireTout` commence en `i`. */
function finAppel(src: string, i: number): number {
  let j = i + 'lireTout'.length
  while (/\s/.test(src[j] ?? '')) j++
  if (src[j] === '<') {
    // L'argument de type, qui peut porter ses propres chevrons ; une flèche `=>` n'en ferme aucun.
    let prof = 0
    for (; j < src.length; j++) {
      if (src[j] === '<') prof++
      else if (src[j] === '>' && src[j - 1] !== '=') { prof--; if (prof === 0) { j++; break } }
    }
    while (/\s/.test(src[j] ?? '')) j++
  }
  return src[j] === '(' ? groupe(src, j).fin : -1
}

/**
 * Le rappel d'un `.then(` qui suit la position `fin`, s'il y en a un : son paramètre tel qu'écrit
 * (un nom, `{ … }` ou `[ … ]`) et son texte entier. C'est DANS ce texte que le drapeau doit être lu —
 * le paramètre n'existe que là, et un même nom lu ailleurs dans le fichier ne prouve rien (dans
 * `BanqueTab`, `lecture.complete` est lu par une autre lecture que celle des relevés).
 */
function rappelThen(src: string, fin: number): { parametre: string; texte: string } | null {
  const suite = /^\s*\.\s*then\s*\(/.exec(src.slice(fin + 1))
  if (!suite) return null
  const ouverture = fin + suite[0].length
  const texte = groupe(src, ouverture).corps
  const sansAsync = texte.replace(/^\s*async\s+/, '')
  let parametre: string | null = null
  if (/^\s*\(/.test(sansAsync)) {
    const debut = sansAsync.indexOf('(')
    const { corps, fin: fermeture } = groupe(sansAsync, debut)
    if (/^\s*=>/.test(sansAsync.slice(fermeture + 1))) {
      parametre = corps.trim().replace(/^([A-Za-z_$][\w$]*)\s*:[\s\S]*$/, '$1')
    }
  } else {
    parametre = /^\s*([A-Za-z_$][\w$]*)\s*=>/.exec(sansAsync)?.[1] ?? null
  }
  return parametre ? { parametre, texte } : null
}

/** Les blocs `{ … }` du texte, hors chaînes, chacun par ses deux bornes. */
function blocs(src: string): [number, number][] {
  const paires: [number, number][] = []
  const pile: number[] = []
  let chaine: string | null = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (chaine) {
      if (c === '\\') { i++; continue }
      if (c === chaine) chaine = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { chaine = c; continue }
    if (c === '{') pile.push(i)
    else if (c === '}') { const o = pile.pop(); if (o !== undefined) paires.push([o, i]) }
  }
  return paires
}

/**
 * Les noms couverts là où vit une déclaration faite en `p` : de `p` à la fin du bloc qui la
 * contient.
 *
 * Pas dans le fichier entier, et c'est une faute trouvée qui l'a exigé (25/09/2026) : `PacksTab`
 * déclare `const lecture = await lireTout(…)` dans DEUX fonctions, et seule la seconde lit son
 * drapeau. Jugé à l'échelle du fichier, le nom était « couvert », et la liste des packs déjà
 * générés jetait le sien en silence depuis le portage. Un nom n'existe que dans son bloc ; son
 * drapeau doit y être lu.
 */
function couvertsDansLaPortee(src: string, lesBlocs: [number, number][], p: number): Set<string> {
  let fin = src.length
  for (const [ouvre, ferme] of lesBlocs) if (ouvre < p && p < ferme && ferme < fin) fin = ferme
  return nomsCouverts(src.slice(p, fin))
}

/** Toutes les liaisons d'un résultat de `lireTout`, dans leurs cinq formes d'écriture — et, en
 *  faute, tout appel qu'aucune d'elles ne lie. */
export function liaisonsLireTout(source: string): Liaison[] {
  const src = sansCommentaires(source)
  const lesBlocs = blocs(src)
  const liaisons: Liaison[] = []
  const lies = new Set<number>()
  const tableDe = (bout: string) => /from\(\s*['"`]([^'"`]+)/.exec(bout)?.[1] ?? '?'
  const couvertParNom = (nom: string, portee: Set<string>) => (nom.startsWith('{')
    ? nom.includes('complete') || nom.includes('motif')
    : portee.has(nom))
  const ajouter = (nom: string, bout: string, portee: Set<string>) => {
    liaisons.push({ nom, couverte: couvertParNom(nom, portee), table: tableDe(bout) })
  }
  const appels = appelsLireTout(src)
  // Les appels portés par une entrée : chaque entrée en lie UN, le premier ; un second resterait non lié.
  const lierEntrees = (debutGroupe: number, corps: string, noms: string[], portee: Set<string>) => {
    let k = 0
    for (const e of entreesPositionnees(corps)) {
      const debut = debutGroupe + 1 + e.debut
      const premier = appels.find((p) => p >= debut && p < debut + e.texte.length)
      if (premier !== undefined) {
        lies.add(premier)
        ajouter(noms[k] ?? `<position ${k}>`, e.texte, portee)
      }
      k++
    }
  }

  // 1 et 2 — `const X = await lireTout(` et `const { … } = await lireTout(`
  for (const m of source.matchAll(/const\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*await\s+lireTout\s*[<(]/g)) {
    lies.add(m.index! + m[0].lastIndexOf('lireTout'))
    ajouter(
      m[1].trim(),
      source.slice(m.index! + m[0].length, m.index! + m[0].length + 400),
      couvertsDansLaPortee(src, lesBlocs, m.index!),
    )
  }
  // 3 — entrée d'un `Promise.all`, la forme normale d'un chargement d'écran ici : elle s'écrit
  //     SANS `await`, donc elle échappe à tout scanner ancré sur `await`.
  for (const m of src.matchAll(/const\s*\[/g)) {
    const i = src.indexOf('[', m.index!)
    const { corps: motif, fin } = groupe(src, i)
    if (!/^\s*=\s*await\s+Promise\.all\s*\(\s*\[/.test(src.slice(fin + 1, fin + 60))) continue
    const j = src.indexOf('[', src.indexOf('Promise.all', fin))
    // La virgule de queue du MOTIF est retirée par `decoupe` comme celle des entrées : sans les
    // deux, l'appariement glisse d'un cran — et un écran de ce dépôt en porte une.
    lierEntrees(j, groupe(src, j).corps, decoupe(motif).map((n) => n.trim()), couvertsDansLaPortee(src, lesBlocs, m.index!))
  }
  // 4 — `lireTout(…).then((lecture) => …)` : le drapeau se lit dans le rappel.
  for (const p of appels) {
    if (lies.has(p)) continue
    const fin = finAppel(src, p)
    if (fin === -1) continue
    const rappel = rappelThen(src, fin)
    if (!rappel || rappel.parametre.startsWith('[')) continue
    lies.add(p)
    ajouter(rappel.parametre, src.slice(p, fin + 1), nomsCouverts(rappel.texte))
  }
  // 5 — `Promise.all([…]).then(([a, b]) => …)` : les entrées appariées au motif du rappel.
  for (const m of src.matchAll(/\bPromise\.all\s*\(\s*\[/g)) {
    const ouverture = src.indexOf('(', m.index!)
    const tableau = src.indexOf('[', ouverture)
    const { fin } = groupe(src, ouverture)
    const rappel = rappelThen(src, fin)
    if (!rappel || !rappel.parametre.startsWith('[')) continue
    const noms = decoupe(rappel.parametre.slice(1, -1)).map((n) => n.trim())
    lierEntrees(tableau, groupe(src, tableau).corps, noms, nomsCouverts(rappel.texte))
  }
  // Tout appel resté sans liaison : une forme que ce scanner ne sait pas lire. Il ne peut rien
  // dire de son drapeau, donc il le compte comme jeté — « aveugle » ne doit jamais valoir « propre ».
  for (const p of appels) {
    if (!lies.has(p)) liaisons.push({ nom: FORME_NON_RECONNUE, couverte: false, table: tableDe(src.slice(p, p + 400)) })
  }
  return liaisons
}

/** Toute lecture dont le drapeau de complétude n'est lu nulle part. */
export function lecturesNonSignalees(chemin: string, source: string): string[] {
  const jetees = liaisonsLireTout(source)
    .filter((l) => !l.couverte)
    .map((l) => `${chemin} — ${l.nom} [${l.table}]`)
  return jetees.slice(EXCEPTIONS[chemin]?.nombre ?? 0)
}

const TOUTES = sourcesDeProduction()

describe('toute lecture de collection dit si elle est partielle', () => {
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
      'Cette lecture reçoit `complete` et le jette : le bandeau reste alors éteint sur une lecture ' +
      'tronquée, et son silence se lit « tout a été lu ». Câble-la sur le drapeau de son écran ' +
      '(`BandeauLecturePartielle`), fais-la REFUSER si elle produit un livrable, ou inscris-la ' +
      'dans EXCEPTIONS avec sa raison et son compte.',
    ).toEqual([])
  })

  it('voit toujours autant de lectures qu’il y en a', () => {
    // Garde SYMÉTRIQUE : « aucune lecture jetée » est aussi ce que rend un scanner qui ne voit plus
    // AUCUNE lecture — la panne qui ressemble exactement au succès, et que ce dépôt a déjà payée
    // sous six autres noms. Mesuré le 22/09/2026 : 110 sites dans 35 fichiers — les formes connues
    // seulement. 118 le 25/09/2026, TOUS les appels du dépôt, les deux formes `.then` comprises.
    const liaisons = TOUTES.flatMap((f) => liaisonsLireTout(f.texte))
    expect(liaisons.length).toBeGreaterThanOrEqual(118)
    expect(liaisons.every((l) => l.couverte)).toBe(true)
    expect(liaisons.filter((l) => l.nom === FORME_NON_RECONNUE)).toEqual([])
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

const PAR_THEN = `
lireTout((d, f) => supabase.from('documents_divers').select('*').range(d, f))
  .then((lecture) => setDocuments(lecture.lignes))
`

const PAR_THEN_SIGNALE = `
lireTout<Doc>((d, f) => supabase.from('documents_divers').select('*').range(d, f))
  .then(async (lecture: LectureComplete<Doc>) => {
    setDocuments(lecture.lignes)
    setMotif(lecture.complete ? null : lecture.motif)
  })
`

// Le même nom, couvert AILLEURS dans le fichier : c'est la forme exacte de BanqueTab, où
// `lecture.complete` est lu par la lecture des mouvements et pas par celle des relevés.
const MEME_NOM_AILLEURS = `
const lecture = await lireTout((d, f) => supabase.from('lignes_bancaires').select('*').range(d, f))
setMotif(lecture.motif)
lireTout((d, f) => supabase.from('documents_divers').select('*').range(d, f))
  .then((lecture) => setDocuments(lecture.lignes))
`

const TOUT_PAR_THEN = `
Promise.all([
  lireTout((d, f) => supabase.from('pieces').select('*').range(d, f)),
  // une virgule, dans un commentaire, comme partout ici
  lireTout((d, f) => supabase.from('categories').select('*').range(d, f)),
]).then(([pcs, cats]) => {
  setMotif(pcs.motif)
})
`

const DESTRUCTURE_THEN = `
lireTout((d, f) => supabase.from('pieces').select('*').range(d, f)).then(({ lignes }) => setPieces(lignes))
lireTout((d, f) => supabase.from('categories').select('*').range(d, f)).then(({ lignes, motif }) => { setCats(lignes); setMotif(motif) })
`

// La forme exacte de PacksTab : le même nom dans deux fonctions, une seule lit son drapeau.
const DEUX_FONCTIONS_MEME_NOM = `
async function chargerPacks() {
  const lecture = await lireTout((d, f) => supabase.from('packs').select('*').range(d, f))
  setPacks(lecture.lignes)
}
async function chargerApercu() {
  const lecture = await lireTout((d, f) => supabase.from('pieces').select('*').range(d, f))
  setMotif(lecture.complete ? null : lecture.motif)
}
`

const FORME_INCONNUE = `
const pieces = (await lireTout((d, f) => supabase.from('pieces').select('*').range(d, f))).lignes
`

const DEFINITION = `
export async function lireTout<T>(lire: (debut: number, fin: number) => unknown) {
  return { lignes: [] as T[], complete: true, motif: null }
}
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

  it('attrape un fichier qui ne signale RIEN — la borne a été resserrée', () => {
    // Sous l'invariant faible du premier temps, ce cas sortait vide : il fallait qu'un fichier
    // signale déjà quelque chose pour qu'on lui reproche le reste. Les neuf écrans concernés ayant
    // été couverts, il est redevenu une faute — et ce test est ce qui empêche la borne de
    // retomber en silence à sa version faible.
    expect(lecturesNonSignalees('faux.tsx', SANS_AUCUN_SIGNAL)).toEqual(['faux.tsx — lectureA [pieces]'])
    expect(liaisonsLireTout(SANS_AUCUN_SIGNAL)).toHaveLength(1)
  })

  it('apparie les entrées d’un `Promise.all` malgré la virgule de queue du motif', () => {
    expect(liaisonsLireTout(AVEC_COMMENTAIRE).map((l) => l.nom)).toEqual(['lectureA', 'lectureB'])
    expect(liaisonsLireTout(AVEC_COMMENTAIRE).map((l) => l.table)).toEqual(['pieces', 'categories'])
  })

  it('voit la forme `lireTout(…).then((lecture) => …)` et y attrape le drapeau jeté', () => {
    expect(lecturesNonSignalees('faux.tsx', PAR_THEN)).toEqual(['faux.tsx — lecture [documents_divers]'])
    // Rappel `async` et paramètre typé : la même forme, écrite comme on l'écrit vraiment.
    expect(lecturesNonSignalees('faux.tsx', PAR_THEN_SIGNALE)).toEqual([])
  })

  it('lit le drapeau DANS le rappel : le même nom lu ailleurs dans le fichier ne couvre rien', () => {
    expect(lecturesNonSignalees('faux.tsx', MEME_NOM_AILLEURS)).toEqual(['faux.tsx — lecture [documents_divers]'])
  })

  it('voit la forme `Promise.all([…]).then(([a, b]) => …)` et en apparie les entrées', () => {
    expect(liaisonsLireTout(TOUT_PAR_THEN).map((l) => l.nom)).toEqual(['pcs', 'cats'])
    expect(lecturesNonSignalees('faux.tsx', TOUT_PAR_THEN)).toEqual(['faux.tsx — cats [categories]'])
  })

  it('juge chaque déclaration dans SON bloc : le même nom couvert dans la fonction voisine ne compte pas', () => {
    expect(lecturesNonSignalees('faux.tsx', DEUX_FONCTIONS_MEME_NOM)).toEqual(['faux.tsx — lecture [packs]'])
  })

  it('comprend un paramètre déstructuré dans le rappel', () => {
    expect(lecturesNonSignalees('faux.tsx', DESTRUCTURE_THEN)).toEqual(['faux.tsx — { lignes } [pieces]'])
  })

  it('compte en FAUTE un appel écrit sous une forme qu’il ne sait pas lire — jamais en silence', () => {
    expect(lecturesNonSignalees('faux.tsx', FORME_INCONNUE)).toEqual([`faux.tsx — ${FORME_NON_RECONNUE} [pieces]`])
  })

  it('ne prend pas la DÉFINITION de `lireTout` pour un appel', () => {
    // Elle vit dans lib/lectureComplete.ts et, recopiée, dans deux Edge Functions : comptée comme
    // un appel non lié, elle ferait crier le scanner sur trois fichiers corrects.
    expect(liaisonsLireTout(DEFINITION)).toEqual([])
  })
})
