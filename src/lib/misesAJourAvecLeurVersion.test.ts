import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// TOUTE MISE À JOUR DU NAVIGATEUR LIT LA LIGNE QU'ELLE A ÉCRITE (audit du 28/11/2026, lib/versionLue.ts).
//
// Une mise à jour que la base n'applique pas — la policy l'écarte, une garde la filtre, la version lue a changé — ne lève
// RIEN : PostgREST rend zéro ligne sans erreur, et `{ error }` lu (`ecrituresVerifiees.test.ts`) n'y voit qu'un succès. La
// relecture des cotisations du 28/11/2026 l'a trouvé sur la fiche d'un bien et la confirmation d'une prévisionnelle ; l'audit
// qui a suivi, en partant de toute la source, sur la fiche d'une pièce, la remise « à traiter » d'un mouvement, la coche d'un
// justificatif, la validation en lot, les catégories suggérées, le régime de TVA, le modèle comptable… Toutes lisent
// désormais la ligne rendue, et celles qui réécrivent ce qu'une lecture a rempli retiennent la version lue.
//
// CE QUI COMPTE COMME UNE MISE À JOUR : une chaîne `.from(…)` qui porte `.update(`. Un `.update(` hors de toute chaîne est
// une faute (une forme que ce garde ne sait pas suivre).
//
// CE QUI EST « LIRE LA LIGNE RENDUE » :
//   - un `.select(` après `.update(` dans la chaîne ;
//   - la chaîne passée en premier argument à `retenirLaVersionLue(…)`, suivie de `.select(` ;
//   - la chaîne affectée à une variable (`let requete = supabase.from(…).update(…)`) dont un `requete.select(` suit ;
//   - le compte demandé (`.update(valeurs, { count: 'exact' })`), qu'on compare à ce qu'on visait.
//
// CE QUE CE GARDE NE VOIT PAS, dit plutôt que laissé croire : qu'une ligne rendue NULLE se dise (le test d'écran le tient, un
// par cas : FichePiece, ChecklistTab, PiecesTab.validationEnLot, BanqueTab, TvaTab, relectureDocuments, reglementBanque), et
// qu'un formulaire retienne TOUTES les colonnes qu'il réécrit — la liste des colonnes retenues est un choix de l'écran.

/**
 * Les fichiers dont des mises à jour ne lisent pas encore la ligne rendue, avec la raison ET LE NOMBRE — une de plus est
 * une rechute, une de moins une raison morte. « À traiter » : un défaut connu, hors des écrans du MVP, laissé pour un lot à
 * part (la classe (a) : un formulaire réécrit en entier ; (b) : un champ basculé par un clic).
 */
const EXCEPTIONS: Record<string, { nombre: number; raison: string }> = {
  'pages/dossier/CotisationsTab.tsx': {
    nombre: 2,
    raison: 'le rattachement et le détachement d’un avis (deux, classe b) restent à traiter ; la confirmation et le remplacement '
      + 'd’une prévisionnelle, comme la fiche d’un bien, lisent leur ligne depuis la relecture des cotisations du 28/11/2026',
  },
  'lib/contrepartieBanque.ts': {
    nombre: 2,
    raison: 'classe c : la date des lignes d’une pièce au brouillon, recomposée par l’application à chaque rapprochement — plusieurs '
      + 'lignes, aucune saisie lue ne s’y écrase, et leur nombre ne se connaît pas d’avance',
  },
  'lib/sauvegardeDonnees.ts': {
    nombre: 1,
    raison: 'classe c : la seconde passe de la restauration, sur un dossier qu’elle vient de créer, aucune lecture d’avant à retenir ; '
      + 'son compte des liens reposés suppose la ligne écrite (à traiter : le lire de la ligne rendue)',
  },
  'pages/dossier/SupplementsTab.tsx': {
    nombre: 3,
    raison: 'à traiter (hors BNC) : la fiche d’un supplément et celle d’un compte courant d’associé (classe a), la facturation d’un supplément (classe b)',
  },
  'pages/CabinetBrandingPage.tsx': {
    nombre: 2,
    raison: 'à traiter (hors du dossier) : la charte du cabinet (classe a) et le retrait de son logo (classe b)',
  },
  'pages/EquipePage.tsx': {
    nombre: 1,
    raison: 'à traiter : le rôle d’un membre de l’équipe (classe b) — la relecture qui suit montre la base, mais le refus muet ne se dit pas',
  },
  'pages/SuperAdminPage.tsx': {
    nombre: 1,
    raison: 'à traiter (super-administrateur) : les plafonds de l’assistant d’un cabinet (classe a)',
  },
}

/** Le plancher : les mises à jour que le garde voit. Moins, il est devenu aveugle (une forme qu'il ne suit plus). */
const PLANCHER = 45

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

/** Les lignes de commentaire retirées (ce dépôt cite ses défauts dans ses commentaires), leur place gardée. */
function sansCommentaires(texte: string): string {
  return texte
    .split('\n')
    .map((l) => (l.trimStart().startsWith('//') || l.trimStart().startsWith('*') || l.trimStart().startsWith('/*') ? '' : l))
    .join('\n')
}

/** L'index qui suit le groupe ouvert à `depart` (`(`, `[` ou `{`), chaînes de caractères sautées, ou -1. */
function finDeGroupe(code: string, depart: number): number {
  const paires: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
  const pile: string[] = []
  for (let i = depart; i < code.length; i++) {
    const c = code[i]
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (paires[c]) pile.push(paires[c])
    else if (c === ')' || c === ']' || c === '}') {
      if (pile.pop() !== c) return -1
      if (pile.length === 0) return i + 1
    }
  }
  return -1
}

/** Les maillons `.nom(…)` de la chaîne qui commence à `depart`, la position de la parenthèse de chacun, et sa fin. */
function maillonsApres(code: string, depart: number): { noms: string[]; appels: Map<string, number>; fin: number } {
  const noms: string[] = []
  const appels = new Map<string, number>()
  let i = depart
  for (;;) {
    let j = i
    while (j < code.length && /\s/.test(code[j])) j++
    if (code[j] !== '.') break
    j++
    while (j < code.length && /\s/.test(code[j])) j++
    const nom = /^[A-Za-z_$][\w$]*/.exec(code.slice(j, j + 60))
    if (!nom) break
    j += nom[0].length
    let k = j
    while (k < code.length && /\s/.test(code[k])) k++
    noms.push(nom[0])
    if (code[k] === '(') {
      if (!appels.has(nom[0])) appels.set(nom[0], k)
      const fin = finDeGroupe(code, k)
      if (fin < 0) return { noms, appels, fin: code.length }
      i = fin
    } else {
      i = j
    }
  }
  return { noms, appels, fin: i }
}

/** L'ouvrante non refermée qui précède `depart`, ou -1. */
function ouvranteEnglobante(code: string, depart: number): number {
  let profondeur = 0
  for (let i = depart - 1; i >= 0; i--) {
    const c = code[i]
    if (c === ')' || c === ']' || c === '}') profondeur++
    else if (c === '(' || c === '[' || c === '{') {
      if (profondeur === 0) return i
      profondeur--
    }
  }
  return -1
}

type Verdict = 'lue' | 'faute'
interface MiseAJour { ligne: number; verdict: Verdict; forme: string }

/** Le début de l'expression dont `.from` est un maillon : l'identifiant (ou `)`) qui précède, remonté sur `supabase`, `client`… */
function teteDe(code: string, point: number): number {
  let i = point
  while (i > 0 && /\s/.test(code[i - 1])) i--
  while (i > 0 && /[\w$]/.test(code[i - 1])) i--
  return i
}

export function misesAJourDe(texte: string): MiseAJour[] {
  const code = sansCommentaires(texte)
  const ligneDe = (index: number) => code.slice(0, index).split('\n').length
  const trouvees: MiseAJour[] = []
  const vues = new Set<number>()
  for (const m of code.matchAll(/\.\s*from\s*\(/g)) {
    const { noms, appels, fin } = maillonsApres(code, m.index)
    const rang = noms.indexOf('update')
    if (rang < 0) continue
    const parenthese = appels.get('update')!
    vues.add(parenthese)
    const argument = code.slice(parenthese + 1, finDeGroupe(code, parenthese) - 1)
    const ligne = ligneDe(m.index)
    if (noms.slice(rang + 1).includes('select')) { trouvees.push({ ligne, verdict: 'lue', forme: 'select' }); continue }
    if (/count\s*:\s*'exact'/.test(argument)) { trouvees.push({ ligne, verdict: 'lue', forme: 'compte' }); continue }
    const tete = teteDe(code, m.index)
    const avant = code.slice(Math.max(0, tete - 200), tete)
    // Premier argument de `retenirLaVersionLue(` : le `.select(` suit la parenthèse fermante de l'appel.
    if (/retenirLaVersionLue\s*\(\s*$/.test(avant)) {
      const ouvrante = ouvranteEnglobante(code, tete)
      const apres = ouvrante < 0 ? -1 : finDeGroupe(code, ouvrante)
      const suite = apres < 0 ? [] : maillonsApres(code, apres).noms
      trouvees.push({ ligne, verdict: suite.includes('select') ? 'lue' : 'faute', forme: 'version' })
      continue
    }
    // Affectée à une variable : un `variable.select(` qui suit.
    const affectation = /(?:let|const)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(avant)
    if (affectation) {
      const reste = code.slice(fin)
      const suivie = new RegExp(`\\b${affectation[1]}\\s*\\.\\s*select\\s*\\(`).test(reste)
      trouvees.push({ ligne, verdict: suivie ? 'lue' : 'faute', forme: 'variable' })
      continue
    }
    trouvees.push({ ligne, verdict: 'faute', forme: 'sans lecture' })
  }
  // Un `.update(` hors de toute chaîne `.from(` : une forme que ce garde ne sait pas suivre.
  for (const m of code.matchAll(/\.\s*update\s*\(/g)) {
    const parenthese = m.index + m[0].length - 1
    if (vues.has(parenthese)) continue
    trouvees.push({ ligne: ligneDe(m.index), verdict: 'faute', forme: 'orpheline' })
  }
  return trouvees
}

describe('toute mise à jour du navigateur lit la ligne qu’elle a écrite', () => {
  const parFichier = sources().map(({ chemin, texte }) => ({ chemin, sites: misesAJourDe(texte) }))

  it('part de toute la source, et en voit au moins le plancher', () => {
    const total = parFichier.reduce((n, f) => n + f.sites.length, 0)
    expect(total).toBeGreaterThanOrEqual(PLANCHER)
  })

  it('aucune faute hors des exceptions, et chaque exception au nombre près', () => {
    const fautes: Record<string, number[]> = {}
    for (const { chemin, sites } of parFichier) {
      const enFaute = sites.filter((s) => s.verdict === 'faute').map((s) => s.ligne)
      if (enFaute.length > 0) fautes[chemin] = enFaute
    }
    const nombres = Object.fromEntries(Object.entries(fautes).map(([chemin, lignes]) => [chemin, lignes.length]))
    const attendus = Object.fromEntries(Object.entries(EXCEPTIONS).map(([chemin, e]) => [chemin, e.nombre]))
    // En cas d'écart, les lignes fautives se lisent dans `fautes`.
    expect({ nombres, fautes: Object.keys(fautes).filter((c) => !(c in EXCEPTIONS)).map((c) => `${c}:${fautes[c].join(',')}`) })
      .toEqual({ nombres: attendus, fautes: [] })
  })

  it('chaque exception dit sa raison', () => {
    for (const [chemin, e] of Object.entries(EXCEPTIONS)) {
      expect(e.raison.length, chemin).toBeGreaterThan(40)
      expect(e.nombre, chemin).toBeGreaterThan(0)
    }
  })
})

describe('le garde mord : des défauts plantés', () => {
  const verdicts = (code: string) => misesAJourDe(code).map((s) => `${s.forme}:${s.verdict}`)

  it('une mise à jour qui ne lit rien est une faute', () => {
    expect(verdicts("const { error } = await supabase.from('pieces').update({ statut: 'validee' }).eq('id', id)"))
      .toEqual(['sans lecture:faute'])
  })

  it('la ligne rendue lue, sur plusieurs lignes, et un commentaire entre les maillons', () => {
    expect(verdicts(`const { data, error } = await supabase
      .from('pieces')
      // la version lue
      .update({ statut: 'validee' })
      .eq('id', id)
      .select('id')
      .maybeSingle()`)).toEqual(['select:lue'])
  })

  it('retenirLaVersionLue suivie de select ; sans select, une faute', () => {
    expect(verdicts("await retenirLaVersionLue(supabase.from('pieces').update(p).eq('id', id), lue, ['tiers']).select('id').maybeSingle()"))
      .toEqual(['version:lue'])
    expect(verdicts("await retenirLaVersionLue(supabase.from('pieces').update(p).eq('id', id), lue, ['tiers'])"))
      .toEqual(['version:faute'])
  })

  it('une variable : lue si un variable.select( suit, une faute sinon', () => {
    expect(verdicts("let requete = supabase.from('t').update(v).eq('id', i)\nrequete = requete.is('x', null)\nconst r = await requete.select('id').maybeSingle()"))
      .toEqual(['variable:lue'])
    expect(verdicts("let requete = supabase.from('t').update(v).eq('id', i)\nconst r = await requete"))
      .toEqual(['variable:faute'])
  })

  it('le compte demandé se lit ; une mise à jour hors de toute chaîne est une faute', () => {
    expect(verdicts("const { count } = await supabase.from('t').update(v, { count: 'exact' }).in('id', ids)")).toEqual(['compte:lue'])
    expect(verdicts('const r = await requete.update(v)')).toEqual(['orpheline:faute'])
  })
})
