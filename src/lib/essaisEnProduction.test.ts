import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// CE QUE RENDENT LES ESSAIS DE LA BASE REJOUÉS EN PRODUCTION — ce que la suite en tient sans base (HISTORIQUE.md, « CE
// QUE RENDENT LES ESSAIS DE LA BASE REJOUÉS EN PRODUCTION »). Les essais de supabase/essais se rejouent en production après
// chaque migration, et ce qu'ils rendent entre dans la conversation de la session : un essai joué en production ne rend
// rien qui dépende d'une ligne hors de ses dossiers fictifs — ni une valeur, ni un compte de toute la base. Le garde entier
// est le banc du leurre (outils/leurre/banc.py), qui rejoue chaque essai sur une réplique, avec et sans quatre dossiers
// « réels » de leurre, et exige la même sortie ; la CI n'a pas de base. Ce fichier tient ce qui se lit dans les textes :
//   1. chaque fichier des essais se classe par sa forme, la règle que le banc lit aussi (outils/leurre/regles.json) —
//      joué en production, de réplique seulement, ou outil — et une autre forme est une faute ;
//   2. les cas particuliers du banc nomment des essais joués en production, chacun avec sa raison et son semis ;
//   3. aucun fichier des essais ne porte un motif du leurre, et le leurre les porte tous ;
//   4. les deux formes des fautes que l'audit du 29/10/2026 a trouvées et corrigées : « le premier » d'une table sans
//      ancre sur une ligne connue de l'essai, et un compte rendu « avant -> après » — chacune éprouvée par un défaut
//      planté. Ce que les textes ne disent pas (un compte de toute la base rendu sous une autre forme, une liste), le banc
//      le voit : la règle de CLAUDE.md veut qu'il se rejoue après tout changement d'un essai.

const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')
const DOSSIER = 'supabase/essais'

interface Regles {
  replique_seulement: { phrase: string; meta_commande: string; raison: string }
  motifs: Record<string, string>
  identifiants_fixes: Record<string, string>
  particuliers: Record<string, { famille?: string; role?: string; attendu?: string; raison: string }>
}
const REGLES = JSON.parse(lire('outils/leurre/regles.json')) as Regles

// ── 1. La classification, celle du banc (`entete_sql`, `classer`) ───────────────────────────────────────────────────────

/** Le premier paragraphe de l'en-tête d'un fichier SQL : ses lignes de commentaire jusqu'à la première vide (« -- »
 * seul) ou à la première instruction, sans leurs « -- », jointes et ramenées à un blanc. Plus bas, un en-tête parle
 * d'AUTRES essais (rls.sql : « la suppression, sur une réplique seulement, par … »). */
function premierParagraphe(texte: string): string {
  const lignes: string[] = []
  for (const ligne of texte.split('\n')) {
    const s = ligne.trim()
    if (!s.startsWith('--') || !s.slice(2).trim()) {
      if (lignes.length > 0 || (s && !s.startsWith('--'))) break
      continue
    }
    lignes.push(s.slice(2))
  }
  return lignes.join(' ').split(/\s+/).filter(Boolean).join(' ')
}

interface Classement {
  production: string[]
  replique: Record<string, string>
  outils: string[]
  inconnus: string[]
}

function classer(fichiers: { nom: string; texte: string | null }[]): Classement {
  const phrase = REGLES.replique_seulement.phrase.toUpperCase()
  const meta = new RegExp(REGLES.replique_seulement.meta_commande, 'm')
  const c: Classement = { production: [], replique: {}, outils: [], inconnus: [] }
  for (const { nom, texte } of fichiers) {
    const m = /^(.*)\.(sql|py|mjs)$/.exec(nom)
    if (texte === null || !m) {
      c.inconnus.push(nom)
      continue
    }
    if (m[2] !== 'sql') c.outils.push(nom)
    else if (premierParagraphe(texte).toUpperCase().includes(phrase)) c.replique[m[1]] = 'son en-tête'
    else if (meta.test(texte)) c.replique[m[1]] = 'une méta-commande de psql'
    else c.production.push(m[1])
  }
  return c
}

const FICHIERS = readdirSync(resolve(RACINE, DOSSIER))
  .sort()
  .map((nom) => {
    const chemin = resolve(RACINE, DOSSIER, nom)
    return { nom, texte: statSync(chemin).isDirectory() ? null : readFileSync(chemin, 'utf8') }
  })
const CLASSEMENT = classer(FICHIERS)

// ── 4a. « Le premier » d'une table : la sélection qui porte un `limit 1`, prise à sa profondeur de parenthèses ─────────

/** Le texte sans ses commentaires `--` (hors des chaînes entre apostrophes) ; les sauts de ligne restent, et les numéros
 * de ligne avec eux. Les corps `$…$` se lisent : ce sont les instructions que l'essai joue. */
function sansCommentaires(t: string): string {
  const morceaux: string[] = []
  let dans = false
  let debut = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === "'") dans = !dans
    else if (!dans && c === '-' && t[i + 1] === '-') {
      morceaux.push(t.slice(debut, i))
      const j = t.indexOf('\n', i)
      i = j < 0 ? t.length : j - 1
      debut = j < 0 ? t.length : j
    }
  }
  morceaux.push(t.slice(debut))
  return morceaux.join('')
}

const BOOLEEN = /(?:\band|\bor|\bwhere|\bnot|\bon)\s*$/i
// Un identifiant de ligne, de dossier, de compte… — jamais celui du cabinet : le cabinet des dossiers d'essai est celui
// qui recevra le dossier réel, et « le premier dossier du cabinet » le prendrait.
const COLONNE = String.raw`\b(?:[a-z_][a-z0-9_]*\.)?(?!cabinet_id\b)(?:[a-z_]*_id|id)\s*`
/** Une égalité sur un identifiant : à un littéral, à un repère `{X}` de l'essai, à une variable ou une colonne. */
const EGAL = new RegExp(COLONNE + String.raw`=\s*(?:'[^']*'|\{\w+\}|[a-z_][\w.]*\b(?!\s*\())`, 'i')
const NUL = new RegExp(COLONNE + String.raw`is\s+null\b`, 'i')
const DANS = new RegExp(COLONNE + String.raw`(?:in|=)\s*$`, 'i')
const SOURCE = /\b(?:from|join)\s+(?:only\s+)?(?:([a-z_]+)\.)?([a-z_][a-z0-9_]*)\b(\s*\()?/gi
const CTE = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([a-z_][a-z0-9_]*)\s*(?:\([^()]*\))?\s+as\s*(?:materialized\s+)?\(/gi
const CATALOGUE = new Set(['pg_catalog', 'information_schema', 'supabase_migrations'])
const LISTE = /^(?:\s*(?:'[^']*'|\{\w+\}|[a-z_][\w.]*)\s*,?)+$/i

class Lecteur {
  readonly t: string
  readonly paires = new Map<number, number>()
  readonly prof: Int32Array
  readonly ctes: Set<string>

  constructor(t: string) {
    this.t = t
    this.prof = new Int32Array(t.length)
    const pile: number[] = []
    let p = 0
    let dans = false
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      if (c === "'") dans = !dans
      if (!dans && c === '(') {
        this.prof[i] = p
        pile.push(i)
        p++
        continue
      }
      if (!dans && c === ')') {
        p--
        this.prof[i] = p
        const o = pile.pop()
        if (o !== undefined) this.paires.set(o, i)
        continue
      }
      this.prof[i] = p
    }
    this.ctes = new Set([...t.matchAll(CTE)].map((m) => m[1].toLowerCase()))
  }

  /** Le texte de [debut, fin) à son niveau : un groupe booléen (après and, or, where, not, on) se déplie, tout autre
   * groupe se réduit à « ‹n› », son numéro, pour retrouver une sous-requête. */
  vue(debut: number, fin: number): { v: string; groupes: [number, number][] } {
    let v = ''
    const groupes: [number, number][] = []
    let i = debut
    while (i < fin) {
      const j = this.t[i] === '(' ? this.paires.get(i) : undefined
      if (j !== undefined) {
        if (BOOLEEN.test(v)) {
          const dedans = this.vue(i + 1, Math.min(j, fin))
          const base = groupes.length
          groupes.push(...dedans.groupes)
          v += '(' + dedans.v.replace(/‹(\d+)›/g, (_, n: string) => `‹${Number(n) + base}›`) + ')'
        } else {
          groupes.push([i + 1, Math.min(j, fin)])
          v += `‹${groupes.length - 1}›`
        }
        i = j + 1
        continue
      }
      v += this.t[i]
      i++
    }
    return { v, groupes }
  }

  /** Une ancre : une égalité sur un identifiant, `is null`, ou `in (…)` / `= (…)` d'une liste ou d'une sous-requête
   * elle-même ancrée. */
  ancree(debut: number, fin: number): boolean {
    const { v, groupes } = this.vue(debut, fin)
    if (EGAL.test(v) || NUL.test(v)) return true
    for (const m of v.matchAll(/‹(\d+)›/g)) {
      if (!DANS.test(v.slice(0, m.index))) continue
      const [gd, gf] = groupes[Number(m[1])]
      const contenu = this.t.slice(gd, gf).trim()
      if (/^select\b/i.test(contenu) ? this.ancree(gd, gf) : LISTE.test(contenu)) return true
    }
    return false
  }

  /** Les tables que la sélection lit à son niveau, hors des fonctions, des CTE et du catalogue. */
  sources(debut: number, fin: number): string[] {
    const { v } = this.vue(debut, fin)
    return [...v.matchAll(SOURCE)]
      .filter(([, schema, nom, appel]) => !appel && !this.ctes.has(nom.toLowerCase())
        && !CATALOGUE.has((schema ?? '').toLowerCase()) && !/^pg_/i.test(nom))
      .map(([, , nom]) => nom.toLowerCase())
  }
}

/** Les lectures « le premier » (`limit 1`) d'une table, et celles qui ne s'ancrent à aucune ligne connue de l'essai. */
function premiers(nom: string, texte: string): { lectures: number; fautes: string[] } {
  const t = sansCommentaires(texte)
  const lec = new Lecteur(t)
  const selects = [...t.matchAll(/\bselect\b/gi)].map((m) => m.index)
  let lectures = 0
  const fautes: string[] = []
  for (const m of t.matchAll(/\blimit\s+1\b/gi)) {
    const niveau = lec.prof[m.index]
    let debut: number | undefined
    for (let k = selects.length - 1; k >= 0; k--) {
      const s = selects[k]
      if (s >= m.index || lec.prof[s] !== niveau) continue
      if (!lec.vue(s, m.index).v.includes(';')) debut = s
      break
    }
    if (debut === undefined) continue
    const fin = m.index + m[0].length
    if (lec.sources(debut, fin).length === 0) continue
    lectures++
    if (!lec.ancree(debut, fin)) {
      const ligne = t.slice(0, debut).split('\n').length
      fautes.push(`${nom}:${ligne} : ${lec.vue(debut, fin).v.split(/\s+/).join(' ').slice(0, 160)}`)
    }
  }
  return { lectures, fautes }
}

// ── 4b. Un compte rendu « avant -> après » ──────────────────────────────────────────────────────────────────────────

const FLECHE = /\|\|\s*' -> '\s*\|\|/g
/** Les lignes entièrement en commentaire ne comptent pas : ce dépôt cite la forme fautive pour l'expliquer. */
const sansCommentairesPleins = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
/** Les flèches qui restent, chacune avec sa raison et son nombre : aucune ne rend un compte de toute la base. */
const FLECHES_ADMISES: Record<string, { nombre: number; raison: string }> = {
  'affectation.sql': { nombre: 1, raison: 'les lignes du relevé du dossier `test` seul, avant et après' },
  'dossierPermanent.sql': { nombre: 2, raison: "ce que deux fonctions prennent et rendent, lu au catalogue" },
  'revisionSoldes.sql': { nombre: 1, raison: "ce qu'une fonction prend et rend, lu au catalogue" },
  'ventesFacturees.sql': { nombre: 1, raison: "le réglage d'un dossier jetable de l'essai, avant et après" },
}
const fleches = (texte: string) => [...sansCommentairesPleins(texte).matchAll(FLECHE)].length

describe('les essais de la base, rejoués en production', () => {
  it('chaque fichier se classe par sa forme, la règle que le banc lit aussi', () => {
    expect(CLASSEMENT.inconnus).toEqual([])
    // Six essais de réplique seulement : un de plus est un essai que le banc ne rejoue plus — à regarder avant. Le sixième, le
    // filet de la validation devant la caisse (la relecture du 01/11/2026), le reste jusqu'à ce que le banc l'ait rejoué : ses
    // migrations sont préparées, et la relecture ne pouvait pas monter les copies du banc (son en-tête le dit).
    expect(Object.entries(CLASSEMENT.replique).map(([e, q]) => `${e} (${q})`)).toEqual([
      'caisseSuppression (son en-tête)', 'frontiereDesEncaissements (son en-tête)', 'logoDesFacturesSuppression (son en-tête)',
      'recompositionDesVentes (son en-tête)', 'restauration (une méta-commande de psql)',
      'validationDesPaiementsParLaCaisse (son en-tête)',
    ])
    // Les outils ne se rejouent pas ; un outil de plus se lit avant d'entrer (l'audit du 29/10/2026 a lu ces cinq-là).
    expect(CLASSEMENT.outils).toEqual(['allerretour.py', 'batterieEncaissements.mjs', 'bordures.py', 'inventaire.py', 'socle.py'])
    // Le plancher : 63 essais joués en production le 29/10/2026 ; sous lui, la règle ne verrait plus les essais.
    expect(CLASSEMENT.production.length).toBeGreaterThanOrEqual(63)
  })

  it('la classification voit un défaut planté', () => {
    const planter = (nom: string, texte: string) => classer([{ nom, texte }])
    expect(planter('a.sql', '-- UN ESSAI — SUR UNE RÉPLIQUE\n-- SEULEMENT, par psql.\nselect 1;').replique).toEqual({ a: 'son en-tête' })
    expect(planter('a.sql', '-- Un essai — sur une réplique seulement.\nselect 1;').replique).toEqual({ a: 'son en-tête' })
    // Plus bas que le premier paragraphe, la phrase parle d'un autre essai : celui-ci se joue en production.
    expect(planter('a.sql', '-- UN ESSAI.\n--\n-- Sa suppression, sur une réplique seulement, par b.sql.\nselect 1;').production).toEqual(['a'])
    expect(planter('a.sql', '-- UN ESSAI.\n\\set ON_ERROR_STOP on\nselect 1;').replique).toEqual({ a: 'une méta-commande de psql' })
    expect(planter('a.sql', '-- UN ESSAI.\n-- \\set ON_ERROR_STOP on\nselect 1;').production).toEqual(['a'])
    expect(planter('a.txt', 'select 1;').inconnus).toEqual(['a.txt'])
    expect(classer([{ nom: 'sous-dossier', texte: null }]).inconnus).toEqual(['sous-dossier'])
  })

  it('les cas particuliers du banc nomment des essais joués en production, chacun avec sa raison et son semis', () => {
    const semis = new Set(readdirSync(resolve(RACINE, 'outils/leurre/semis')).map((n) => n.replace(/\.sql$/, '')))
    const familles = new Set([...semis, 'production', 'apres'])
    const cas = Object.entries(REGLES.particuliers)
    // Dix-neuf le 29/10/2026 : dix essais du jeu de départ, quatre autres semis ou rôles, deux par le super-utilisateur,
    // trois après des migrations préparées, un attendu impossible.
    expect(cas.length).toBe(19)
    for (const [essai, c] of cas) {
      expect(CLASSEMENT.production, essai).toContain(essai)
      expect(c.raison.length, essai).toBeGreaterThan(20)
      expect(familles.has(c.famille ?? 'production'), essai).toBe(true)
      expect(['proprietaire', 'super'], essai).toContain(c.role ?? 'proprietaire')
      expect([undefined, 'impossible'], essai).toContain(c.attendu)
    }
    // Un semis que rien n'appelle est un jeu de départ qui a vieilli.
    for (const f of semis) expect(cas.some(([, c]) => c.famille === f), f).toBe(true)
  })

  it('aucun fichier des essais ne porte un motif du leurre, et le leurre les porte tous', () => {
    const motifs = Object.entries(REGLES.motifs).map(([nom, m]) => [nom, new RegExp(m, 'gi')] as const)
    const trouves: string[] = []
    for (const { nom, texte } of FICHIERS) {
      if (texte === null) continue
      for (const [motif, r] of motifs) for (const m of texte.matchAll(r)) trouves.push(`${nom} : ${motif} « ${m[0]} »`)
    }
    expect(trouves).toEqual([])
    const leurre = ['leurre.sql', 'leurre_complement.sql', 'leurre_facture_zero.sql'].map((f) => lire(`outils/leurre/${f}`)).join('\n')
    for (const [motif, r] of motifs) expect(leurre.match(r)?.length ?? 0, motif).toBeGreaterThan(0)
  })

  it('un essai joué en production ne prend pas « le premier » d’une table sans l’ancrer à une ligne connue de l’essai', () => {
    let lectures = 0
    const fautes: string[] = []
    for (const e of CLASSEMENT.production) {
      const r = premiers(`${e}.sql`, lire(`${DOSSIER}/${e}.sql`))
      lectures += r.lectures
      fautes.push(...r.fautes)
    }
    expect(fautes).toEqual([])
    // Le plancher : 105 sélections lues le 29/10/2026 ; sous lui, le scanner ne les verrait plus.
    expect(lectures).toBeGreaterThanOrEqual(100)
  })

  it('le scanner des « premiers » voit un défaut planté', () => {
    const fautes = (texte: string) => premiers('planté.sql', texte).fautes.length
    // Les fautes que l'audit a trouvées : la première facture validée de la base, l'autre dossier qui la suit, le premier
    // bien de la base.
    expect(fautes("select f.id into facture_v from factures_emises f where f.statut = 'validee' order by f.id limit 1;")).toBe(1)
    expect(fautes('select d.id into autre from dossiers d where d.id <> dossier_f order by d.id limit 1;')).toBe(1)
    expect(fautes('select id from immobilisations order by id limit 1;')).toBe(1)
    // « Un autre dossier du cabinet » : le cabinet n'est pas une ancre, il recevra le dossier réel.
    expect(fautes('select d.id into autre from dossiers d where d.cabinet_id = cabinet and not exists (select 1 from '
      + 'memberships mb where mb.dossier_id = d.id and mb.user_id = client) order by d.id limit 1;')).toBe(1)
    // Une ancre dans un groupe booléen, dans une sous-requête ancrée, ou sur une variable de l'essai : rien à dire.
    expect(fautes("select f.id into v from factures_emises f where f.statut = 'validee' and (f.dossier_id = '{A}' or "
      + 'f.dossier_id in (select m.dossier_id from memberships m where m.user_id = client)) order by f.id limit 1;')).toBe(0)
    expect(fautes('select id into v from pieces where dossier_id = dossier_test order by id limit 1;')).toBe(0)
    expect(fautes('select id into v from categories where dossier_id is null order by code limit 1;')).toBe(0)
    // Une ancre dans une sous-requête qui n'est pas la condition (un `exists`) ne borne pas la sélection.
    expect(fautes('select d.id into v from documents_divers d where exists (select 1 from notes_internes n where '
      + 'n.document_id = d.id) order by d.id limit 1;')).toBe(1)
    // Une CTE et le catalogue ne sont pas des tables de dossier.
    expect(fautes("with recursive chaine(id) as (select 1) select c.id from chaine c order by c.id limit 1;")).toBe(0)
    expect(fautes('select s.name from supabase_migrations.schema_migrations s order by s.version desc limit 1;')).toBe(0)
  })

  it('un essai joué en production ne rend pas un compte « avant -> après » : l’écart seul', () => {
    const trouvees: Record<string, number> = {}
    for (const e of CLASSEMENT.production) {
      const n = fleches(lire(`${DOSSIER}/${e}.sql`))
      if (n > 0) trouvees[`${e}.sql`] = n
    }
    expect(trouvees).toEqual(Object.fromEntries(Object.entries(FLECHES_ADMISES).map(([f, a]) => [f, a.nombre])))
    for (const [f, a] of Object.entries(FLECHES_ADMISES)) expect(a.raison.length, f).toBeGreaterThan(20)
  })

  it('le scanner des flèches voit un défaut planté', () => {
    expect(fleches("  'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres, 'ok', avant = apres);")).toBe(1)
    expect(fleches("  'observe', 'transmissions ' || n_avant || ' -> ' || (select count(*) from transmissions_factures),")).toBe(1)
    expect(fleches("  -- l'ancienne forme : avant || ' -> ' || apres")).toBe(0)
    expect(fleches("  'observe', 'écarts ' || to_char(apres - avant, 'FMSG9999999990'),")).toBe(0)
  })
})
