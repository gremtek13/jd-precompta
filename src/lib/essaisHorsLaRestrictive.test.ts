import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// TOUT ESSAI DE LA BASE QUI COMPTE OU LISTE DES POLICIES MET À PART LA RESTRICTIVE `deux_facteurs`.
//
// La double authentification exigée (C7, second temps, migration `deux_facteurs_exiges`, préparée) pose sur CHAQUE table
// de public, et sur storage.objects, une policy RESTRICTIVE nommée `deux_facteurs`. Un essai qui compte les policies d'une
// table, ou les liste, changerait de verdict le jour du collage : le 13/11/2026, 35 essais, trois essais de réplique et
// quatre contrôles de rls.sql ont été remis au même verdict dans les deux états — HISTORIQUE.md, « DES ESSAIS DE LA BASE
// REMIS AU SCHÉMA ». Ce contrôle empêche qu'un essai neuf, ou un contrôle ajouté, l'oublie.
//
// CE QU'IL LIT : TOUS les fichiers `supabase/essais/*.sql`, commentaires `--` retirés, et TOUTE mention de `pg_policies`
// ou de `pg_policy`, qualifiée `pg_catalog.` ou non. Il juge l'EXPRESSION, jamais la ligne : la clause qui suit la vue
// (jusqu'à la parenthèse qui la ferme, au `;`, à la fin d'un texte dollar, ou à union / group by / order by / limit /
// having / loop / then / returning), puis les conjoints de premier niveau de son `where`. Une mention est :
//   • une LECTURE CONFORME : un conjoint du `where` est exactement le filtre — `not (policyname = 'deux_facteurs' and
//     permissive = 'RESTRICTIVE')` sur la vue, `not (polname = 'deux_facteurs' and not polpermissive)` sur le
//     catalogue, sans préfixe ou sous l'alias de la vue —, sans `or` de premier niveau dans le `where`. C'est la forme de
//     la sous-requête (`from (select * from pg_policies where not (…)) pg_policies`) comme celle « autres / en tout » du
//     bloc DP (le filtre posé dans le `where` du compte). Un filtre plus large — les seules permissives, `polname <>
//     'deux_facteurs'` — n'en est pas une : il tairait une restrictive d'un autre nom, ou une permissive de ce nom ;
//   • une LECTURE PAR LE NOM : le `where` ne retient que des policies nommées (`polname = '…'`, `policyname like '…'`,
//     ou une disjonction dont chaque branche nomme), d'un nom ou d'un motif qui ne peut pas être `deux_facteurs` : elle
//     cherche des policies précises, elle ne compte rien que la restrictive changerait ;
//   • l'ALIAS de la sous-requête filtrée (`… 'RESTRICTIVE')) pg_policies`) ;
//   • un NOM DANS UN LITTÉRAL (`'pg_policy'::regclass` d'une lecture de pg_depend, `'cible', 'pg_policy'`) ;
//   • une EXCEPTION NOMMÉE (`EXCEPTIONS`), qui porte sa raison et son nombre EXACT : une lecture de plus, ou de moins,
//     la remet en faute ;
//   • sinon, une FAUTE — une forme que le contrôle ne reconnaît pas n'est jamais un silence.
// UN PLANCHER sépare « zéro faute » d'« aveugle » (`PLANCHER_DE_LECTURES`, `PLANCHER_D_ESSAIS`). Éprouvé par des défauts
// plantés (plus bas) et par mutation du contrôle — HISTORIQUE.md, « 14/11/2026 — LE SCANNER DES ESSAIS HORS LA
// RESTRICTIVE ».

// ─── Le lexique ─────────────────────────────────────────────────────────────────────────────────────────────────────

const MENTION = /\b(?:pg_catalog\.)?pg_polic(?:y|ies)\b/gi
const FIN_DE_CLAUSE = /^(?:union|group\s+by|order\s+by|limit|having|loop|then|returning)\b/i
const FILTRE_VUE = /^not\s*\(\s*(?:(\w+)\.)?policyname\s*=\s*'deux_facteurs'\s+and\s+(?:(\w+)\.)?permissive\s*=\s*'RESTRICTIVE'\s*\)$/i
const FILTRE_CATALOGUE = /^not\s*\(\s*(?:(\w+)\.)?polname\s*=\s*'deux_facteurs'\s+and\s+not\s+(?:(\w+)\.)?polpermissive\s*\)$/i
const EGALITE_DE_NOM = /^(?:\w+\.)?(?:polname|policyname)\s*=\s*(.+)$/i
const MOTIF_DE_NOM = /^(?:\w+\.)?(?:polname|policyname)\s+like\s+'((?:[^']|'')*)'$/i
const LISTE_DE_NOMS = /^(?:\w+\.)?(?:polname|policyname)\s+in\s*\(((?:\s*'[^']*'\s*,)*\s*'[^']*'\s*)\)$/i
const MOTS_QUI_NE_SONT_PAS_UN_ALIAS = /^(?:where|join|on|left|inner|cross|natural|as|union|group|order|limit|into|loop|then)$/i
const SOUS_REQUETE_FILTREE =
  /\(\s*select\s+\*\s+from\s+(?:pg_catalog\.)?(?:pg_policies\s+where\s+not\s*\(\s*policyname\s*=\s*'deux_facteurs'\s+and\s+permissive\s*=\s*'RESTRICTIVE'\s*\)|pg_policy\s+where\s+not\s*\(\s*polname\s*=\s*'deux_facteurs'\s+and\s+not\s+polpermissive\s*\))\s*\)\s*$/i

/** Le texte sans ses commentaires `--` (ce qui suit `--` hors d'une chaîne de la ligne), le nombre de lignes gardé. */
export function sansCommentaires(texte: string): string {
  return texte
    .split('\n')
    .map((ligne) => {
      let dansChaine = false
      for (let i = 0; i < ligne.length; i++) {
        if (ligne[i] === "'") dansChaine = !dansChaine
        else if (!dansChaine && ligne[i] === '-' && ligne[i + 1] === '-') return ligne.slice(0, i)
      }
      return ligne
    })
    .join('\n')
}

/** L'indice qui suit la chaîne `'…'` ouverte en `i` (les `''` doublées comprises). */
function apresLaChaine(texte: string, i: number): number {
  let j = i + 1
  while (j < texte.length) {
    if (texte[j] === "'" && texte[j + 1] === "'") j += 2
    else if (texte[j] === "'") return j + 1
    else j++
  }
  return j
}

/** La clause qui suit la vue : jusqu'à la parenthèse qui la ferme, au `;`, à la fin d'un texte dollar, ou à un mot qui
 *  clôt un `where`. Les chaînes `'…'` sont sautées entières (leurs parenthèses ne comptent pas). */
export function clauseApres(texte: string, debut: number): string {
  let profondeur = 0
  let i = debut
  while (i < texte.length) {
    const c = texte[i]
    if (c === "'") {
      i = apresLaChaine(texte, i)
      continue
    }
    if (c === '$' && /^\$[a-z_]*\$/i.test(texte.slice(i, i + 12))) break
    if (c === '(') profondeur++
    else if (c === ')') {
      if (profondeur === 0) break
      profondeur--
    } else if (c === ';' && profondeur === 0) break
    else if (profondeur === 0 && /\s/.test(texte[i - 1] ?? ' ') && FIN_DE_CLAUSE.test(texte.slice(i, i + 12))) break
    i++
  }
  return texte.slice(debut, i)
}

/** Les morceaux de premier niveau d'un texte coupé au mot donné (hors parenthèses et chaînes), espaces réduits. */
export function decouper(texte: string, mot: 'and' | 'or' | 'where'): string[] {
  const morceaux: string[] = []
  const motif = new RegExp(`^${mot}\\b`, 'i')
  let profondeur = 0
  let depart = 0
  let i = 0
  while (i < texte.length) {
    const c = texte[i]
    if (c === "'") {
      i = apresLaChaine(texte, i)
      continue
    }
    if (c === '(') profondeur++
    else if (c === ')') profondeur--
    else if (profondeur === 0 && /\s/.test(texte[i - 1] ?? ' ') && motif.test(texte.slice(i, i + mot.length + 1))) {
      morceaux.push(texte.slice(depart, i))
      depart = i + mot.length
    }
    i++
  }
  morceaux.push(texte.slice(depart))
  return morceaux.map((m) => m.replace(/\s+/g, ' ').trim())
}

/** Vrai si les parenthèses du texte se referment sans jamais descendre sous zéro (chaînes sautées). */
function equilibre(texte: string): boolean {
  let profondeur = 0
  let i = 0
  while (i < texte.length) {
    if (texte[i] === "'") {
      i = apresLaChaine(texte, i)
      continue
    }
    if (texte[i] === '(') profondeur++
    else if (texte[i] === ')' && --profondeur < 0) return false
    i++
  }
  return profondeur === 0
}

/** Le motif LIKE en expression régulière : `\_` et `\%` littéraux, `_` un caractère, `%` une suite. */
export function motifLike(motif: string): RegExp {
  const echapper = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let corps = ''
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]
    if (c === '\\' && i + 1 < motif.length) corps += echapper(motif[++i])
    else if (c === '_') corps += '.'
    else if (c === '%') corps += '.*'
    else corps += echapper(c)
  }
  return new RegExp(`^${corps}$`, 's')
}

/** Un conjoint qui désigne une policy par son nom, d'un nom (ou d'un motif) qui ne peut pas être `deux_facteurs`. */
function nommeUnePolicy(conjoint: string): boolean {
  const liste = LISTE_DE_NOMS.exec(conjoint)
  if (liste) return !/'deux_facteurs'/i.test(liste[1])
  const like = MOTIF_DE_NOM.exec(conjoint)
  if (like) return !motifLike(like[1]).test('deux_facteurs')
  const egal = EGALITE_DE_NOM.exec(conjoint)
  if (!egal) return false
  return !/deux_facteurs/i.test(egal[1]) && !/\b(?:polname|policyname)\b/i.test(egal[1])
}

/** Une expression qui ne retient que des policies nommées : un conjoint qui nomme, ou une disjonction dont CHAQUE branche
 *  nomme (`(p.policyname = 'a' and …) or (p.policyname = 'b' and …)`). */
export function neRetientQueDesNoms(expression: string): boolean {
  let e = expression.trim()
  while (e.startsWith('(') && e.endsWith(')') && equilibre(e.slice(1, -1))) e = e.slice(1, -1).trim()
  const branches = decouper(e, 'or')
  if (branches.length > 1) return branches.every(neRetientQueDesNoms)
  return decouper(e, 'and').some((c) => nommeUnePolicy(c) || (c.startsWith('(') && c.endsWith(')') && neRetientQueDesNoms(c)))
}

// ─── Le jugement ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Genre = 'conforme' | 'par-le-nom' | 'alias' | 'litteral' | 'exception' | 'faute'

export interface Mention {
  fichier: string
  ligne: number
  genre: Genre
  /** La clause lue (ou le voisinage d'une mention qui n'est pas une lecture), espaces réduits. */
  texte: string
  exception?: string
}

/** Une exception désigne ses lectures par un passage du texte (commentaires retirés, espaces réduits) qui les précède ou
 *  qu'elles lisent, ou par un BLOC d'un essai (de la ligne qui commence par `de` à celle qui commence par `a`). */
export type Exception = { fichier: string; nombre: number; raison: string } & ({ designe: string } | { bloc: { de: string; a?: string } })

function nomDeLException(e: Exception): string {
  return 'bloc' in e ? `bloc « ${e.bloc.de} »` : e.designe
}

export function jugerLaClause(clause: string): 'conforme' | 'par-le-nom' | 'faute' {
  const [avant, ...apres] = decouper(clause, 'where')
  if (apres.length !== 1) return 'faute'
  const alias = /^\s*([a-z_][a-z0-9_]*)/i.exec(avant)?.[1]
  const aliasDeLaVue = alias && !MOTS_QUI_NE_SONT_PAS_UN_ALIAS.test(alias) ? alias : undefined
  const where = apres[0]
  const sansOu = decouper(where, 'or').length === 1
  const filtre =
    sansOu &&
    decouper(where, 'and').some((c) => {
      const m = FILTRE_VUE.exec(c) ?? FILTRE_CATALOGUE.exec(c)
      // Le filtre nomme la vue lue : sous son alias s'il en porte un, ou sans préfixe.
      return m !== null && [m[1], m[2]].every((p) => p === undefined || p === aliasDeLaVue)
    })
  if (filtre) return 'conforme'
  return neRetientQueDesNoms(where) ? 'par-le-nom' : 'faute'
}

export function analyser(fichiers: { nom: string; texte: string }[], exceptions: Exception[]): Mention[] {
  const mentions: Mention[] = []
  for (const { nom, texte: brut } of fichiers) {
    const texte = sansCommentaires(brut)
    const lignesBrutes = brut.split('\n')
    const ligneDe = (marque: string) => lignesBrutes.findIndex((l) => l.startsWith(marque)) + 1
    for (const m of texte.matchAll(MENTION)) {
      const index = m.index
      const fin = index + m[0].length
      const ligne = texte.slice(0, index).split('\n').length
      const avant = texte.slice(Math.max(0, index - 400), index)
      const apres = texte.slice(fin)
      let genre: Genre
      let lu = (texte.slice(Math.max(0, index - 60), index) + m[0] + apres.slice(0, 80)).replace(/\s+/g, ' ')
      if (texte[index - 1] === "'" && apres[0] === "'") genre = 'litteral'
      else if (SOUS_REQUETE_FILTREE.test(avant)) genre = 'alias'
      else if (/\b(?:from|join)\s+$/i.test(avant)) {
        const clause = clauseApres(texte, fin)
        lu = (m[0] + clause).replace(/\s+/g, ' ').trim()
        genre = jugerLaClause(clause)
      } else genre = 'faute'
      if (genre === 'faute') {
        const voisinage = (avant + m[0] + apres.slice(0, 600)).replace(/\s+/g, ' ')
        const e = exceptions.find((x) => {
          if (x.fichier !== nom) return false
          if ('bloc' in x) {
            const de = ligneDe(x.bloc.de)
            const a = x.bloc.a === undefined ? lignesBrutes.length + 1 : ligneDe(x.bloc.a)
            return de > 0 && a > de && ligne > de && ligne < a
          }
          return voisinage.includes(x.designe)
        })
        if (e) {
          mentions.push({ fichier: nom, ligne, genre: 'exception', texte: lu, exception: nomDeLException(e) })
          continue
        }
      }
      mentions.push({ fichier: nom, ligne, genre, texte: lu })
    }
  }
  return mentions
}

/** Les fautes : les mentions non reconnues, et chaque exception dont le nombre ne tombe pas juste. */
export function fautes(mentions: Mention[], exceptions: Exception[]): string[] {
  const dites = mentions.filter((m) => m.genre === 'faute').map((m) => `${m.fichier}:${m.ligne} — ${m.texte.slice(0, 220)}`)
  for (const e of exceptions) {
    const vues = mentions.filter((m) => m.fichier === e.fichier && m.exception === nomDeLException(e)).length
    if (vues !== e.nombre) dites.push(`exception ${e.fichier} ${nomDeLException(e)} : ${vues} lecture(s), ${e.nombre} attendue(s)`)
  }
  return dites
}

// ─── Les exceptions ─────────────────────────────────────────────────────────────────────────────────────────────────

const OUVRE = 'juge ce qu\'OUVRENT les policies, les seules permissives : une restrictive n\'ouvre rien (rls.sql, « Une policy RESTRICTIVE n\'ouvre rien »), la restrictive deux_facteurs comprise, et le verdict est le même dans les deux états'

export const EXCEPTIONS: Exception[] = [
  // Les blocs de rls.sql que ce lot ne touche pas.
  { fichier: 'rls.sql', bloc: { de: '-- ══ DF. ', a: '-- ══ PR. ' }, nombre: 3,
    raison: 'le bloc DF juge la restrictive deux_facteurs elle-même : sa présence sur chaque table, sa pré-requête, les deux tables de l\'exigence' },
  { fichier: 'rls.sql', bloc: { de: '-- ══ SM. ', a: '-- ══ TO. ' }, nombre: 2, raison: `le bloc SM ${OUVRE}` },
  { fichier: 'rls.sql', bloc: { de: '-- ══ TO. ' }, nombre: 1, raison: `le bloc TO ${OUVRE}` },
  // Ce qui ouvre : les seules permissives.
  { fichier: 'rls.sql', designe: "p.polcmd in ('w', '*') and p.polpermissive and (coalesce(pg_get_expr(p.polqual", nombre: 1, raison: `le seau des ventes : ${OUVRE}` },
  { fichier: 'rls.sql', designe: "p.polpermissive and p.polcmd in ('d', '*') and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%''pieces''%'", nombre: 1, raison: `la suppression d'une pièce : ${OUVRE}` },
  { fichier: 'rls.sql', designe: "p.polrelid = 'public.originaux_liberes'::regclass and p.polpermissive", nombre: 1, raison: `originaux_liberes n'a aucune policy qui l'ouvre (advisor volontaire) : ${OUVRE}` },
  { fichier: 'rls.sql', designe: "p.polpermissive and p.polcmd in ('d', 'r', '*')", nombre: 1, raison: `le sous-arbre des originaux : ${OUVRE}` },
  { fichier: 'rls.sql', designe: "p.polrelid = to_regclass('public.originaux_liberes') and p.polpermissive", nombre: 2, raison: `originaux_liberes, le contrôle et sa mutation : ${OUVRE}` },
  { fichier: 'rls.sql', designe: "p.polcmd in ('w', '*') and p.polpermissive and (0::oid = any (p.polroles)", nombre: 1, raison: `le bloc RT, qui peut écrire la colonne du cabinet : ${OUVRE}` },
  { fichier: 'documentsCabinet.sql', designe: "p.polpermissive and p.polcmd in ('w', '*') and coalesce(pg_get_expr(p.polqual, p.polrelid), '') like '%documents-cabinet%'", nombre: 1, raison: `le seau documents-cabinet : ${OUVRE}` },
  // Par leur prédicat : la restrictive porte `(select public.deux_facteurs_satisfaits())`, aucun des prédicats cherchés.
  { fichier: 'rls.sql', designe: "p2.qual like '%client_du_dossier(dossier_id, ''banque''%'", nombre: 2,
    raison: 'cherche les policies par leur PRÉDICAT « Banque » (client_du_dossier, gere_la_banque), que la restrictive ne porte pas' },
  { fichier: 'rls.sql', designe: 'pg_policy po join pg_class c on c.oid = po.polrelid join pg_namespace ns on ns.oid = c.relnamespace', nombre: 2,
    raison: 'cherche les policies par leur PRÉDICAT « Ventes » (client_du_dossier, gere_les_ventes), que la restrictive ne porte pas' },
  { fichier: 'rls.sql', designe: 'pg_policies p where mot_libre is not null', nombre: 1,
    raison: 'cherche les policies dont le prédicat cite une case de l\'accès (achats, frais, documents), que la restrictive ne cite pas' },
  { fichier: 'troisCasesDeLAcces.sql', designe: "coalesce(p.with_check, '') ~ ('''(' || mots || ')''')", nombre: 1,
    raison: 'cherche les policies dont le prédicat cite une des trois cases, que la restrictive ne cite pas' },
  { fichier: 'accesAvantLesGardes.sql', designe: 'join pg_policy o on o.oid = d.objid', nombre: 1,
    raison: 'cherche les policies qui DÉPENDENT d\'une colonne (pg_depend) : la restrictive n\'en lit aucune, son prédicat est une fonction sans argument' },
  { fichier: 'rls.sql', designe: "count(*) filter (where p.polname = 'ventes_depot_d_un_original')", nombre: 1,
    raison: 'ne compte que par ses filtres de nom (ventes_depot_d_un_original, ventes_lecture) : la clause where ne fait que borner la table' },
  // Le catalogue entier, la restrictive comprise.
  { fichier: 'inventaire.sql', designe: "select 'policy|' || tablename || '.' || policyname from pg_policies", nombre: 1,
    raison: 'l\'inventaire confronte TOUT le catalogue à l\'export : la restrictive, une fois collée, est dans l\'un comme dans l\'autre' },
  { fichier: 'signature.sql', designe: "pg_policies where schemaname = 'public'", nombre: 1,
    raison: 'la signature compare la réplique à la production famille par famille : la restrictive en est une policy comme une autre' },
  { fichier: 'socle.sql', designe: 'pg_policies p join manquantes m on m.t = p.tablename', nombre: 1,
    raison: 'le socle recompose les policies des tables créées hors migration : toutes, la restrictive comprise' },
  // La restrictive elle-même.
  { fichier: 'departDuClient.sql', designe: "and policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE' and cmd = 'ALL'", nombre: 1,
    raison: 'vise la restrictive deux_facteurs elle-même : présente sur les deux tables dès que sa fonction existe' },
]

// ─── Les essais du dépôt ────────────────────────────────────────────────────────────────────────────────────────────

const ESSAIS = new URL('../../supabase/essais/', import.meta.url).pathname

function essaisDuDepot(): { nom: string; texte: string }[] {
  return readdirSync(ESSAIS)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((nom) => ({ nom, texte: readFileSync(join(ESSAIS, nom), 'utf8') }))
}

// Le 14/11/2026 : 140 essais lus, 239 mentions dans 67 — 139 lectures conformes dans 60 essais, 52 par le nom, 15 alias,
// 7 littéraux, 26 exceptions (20 entrées), 0 faute. Les planchers en sont un peu au-dessous.
const PLANCHER_D_ESSAIS_LUS = 130
const PLANCHER_DE_LECTURES = 130
const PLANCHER_D_ESSAIS = 55
const PLANCHER_PAR_LE_NOM = 45
const PLANCHER_D_ALIAS = 12

describe('les essais de la base mettent à part la restrictive deux_facteurs', () => {
  const essais = essaisDuDepot()
  const mentions = analyser(essais, EXCEPTIONS)

  it('aucune lecture de pg_policies ni de pg_policy hors des formes reconnues, chaque exception à son nombre', () => {
    expect(fautes(mentions, EXCEPTIONS)).toEqual([])
  })

  it('le plancher : le contrôle voit des lectures conformes et par le nom, dans des essais', () => {
    const conformes = mentions.filter((m) => m.genre === 'conforme')
    expect(essais.length).toBeGreaterThanOrEqual(PLANCHER_D_ESSAIS_LUS)
    expect(conformes.length).toBeGreaterThanOrEqual(PLANCHER_DE_LECTURES)
    expect(new Set(conformes.map((m) => m.fichier)).size).toBeGreaterThanOrEqual(PLANCHER_D_ESSAIS)
    expect(mentions.filter((m) => m.genre === 'par-le-nom').length).toBeGreaterThanOrEqual(PLANCHER_PAR_LE_NOM)
    expect(mentions.filter((m) => m.genre === 'alias').length).toBeGreaterThanOrEqual(PLANCHER_D_ALIAS)
  })
})

// ─── Les défauts plantés ────────────────────────────────────────────────────────────────────────────────────────────

function juger(sql: string, exceptions: Exception[] = []): Mention[] {
  return analyser([{ nom: 'plante.sql', texte: sql }], exceptions)
}
const genres = (sql: string) => juger(sql).map((m) => m.genre)

describe('le contrôle reconnaît les formes du filtre', () => {
  it('la sous-requête filtrée sous l\'alias de la vue, sur la vue comme sur le catalogue', () => {
    expect(genres(`select string_agg(policyname, ',') from (select * from pg_policies where not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE')) pg_policies where tablename = 'x';`))
      .toEqual(['conforme', 'alias'])
    expect(genres(`select count(*) from (select * from pg_policy where not (polname = 'deux_facteurs' and not polpermissive)) p where p.polrelid = 'public.x'::regclass;`))
      .toEqual(['conforme'])
  })

  it('« autres / en tout » : le filtre dans le where du compte, sous l\'alias ou sans préfixe, qualifié pg_catalog ou non', () => {
    expect(genres(`select count(*) filter (where cmd = 'ALL') || '/' || count(*) from pg_policies where tablename = 'x'
       and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE');`)).toEqual(['conforme'])
    expect(genres(`select count(*) from pg_catalog.pg_policy po where po.polrelid = 'public.x'::regclass and not (po.polname = 'deux_facteurs' and not po.polpermissive);`))
      .toEqual(['conforme'])
  })

  it('par le nom : une policy nommée, une liste, un motif, une disjonction de noms', () => {
    expect(genres(`select pg_get_expr(p.polqual, p.polrelid) into q from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polname = 'ventes_lecture';`))
      .toEqual(['par-le-nom'])
    expect(genres(`select count(*) from pg_policies p where p.policyname like 'ventes\\_%' or p.policyname in ('a', 'b');`)).toEqual(['par-le-nom'])
    expect(genres(`select count(*) from pg_policies p where p.schemaname = 'public' and ((p.policyname = 'a' and p.cmd = 'SELECT') or (p.policyname = 'b'));`))
      .toEqual(['par-le-nom'])
  })

  it('un nom dans un littéral, une mention dans un commentaire', () => {
    expect(genres(`select exists (select 1 from pg_depend d where d.classid = 'pg_policy'::regclass);
      -- un commentaire qui cite : select count(*) from pg_policies where tablename = 'x' — l'essai d'hier
      select 1;`)).toEqual(['litteral'])
  })
})

describe('le contrôle met en faute les défauts plantés', () => {
  it('un compte sans filtre', () => {
    expect(genres(`select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'x';`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policy p where p.polrelid = 'public.x'::regclass`)).toEqual(['faute'])
  })

  it('un filtre trop large : les seules permissives, ou tout ce qui porte le nom', () => {
    expect(genres(`select count(*) from pg_policies p where p.tablename = 'x' and p.permissive = 'PERMISSIVE';`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policy p where p.polrelid = 'public.x'::regclass and p.polpermissive;`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policies where tablename = 'x' and not (permissive = 'RESTRICTIVE');`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policy p where p.polrelid = 'public.x'::regclass and p.polname <> 'deux_facteurs';`)).toEqual(['faute'])
  })

  it('une lecture pg_catalog.pg_policies sans filtre', () => {
    expect(genres(`select count(*) from pg_catalog.pg_policies where tablename = 'x';`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_catalog.pg_policy where polrelid = 'public.x'::regclass;`)).toEqual(['faute'])
  })

  it('le filtre derrière un « or », ou sous un autre alias que celui de la vue', () => {
    expect(genres(`select count(*) from pg_policies where tablename = 'x' or not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE');`))
      .toEqual(['faute'])
    // « and » lie plus fort que « or » : le filtre ne vaut que pour la branche de y.
    expect(genres(`select count(*) from pg_policies where tablename = 'x' or tablename = 'y'
      and not (policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE');`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policies p join pg_policies q on q.tablename = p.tablename where p.tablename = 'x'
      and not (q.policyname = 'deux_facteurs' and q.permissive = 'RESTRICTIVE');`)).toContain('faute')
  })

  it('une lecture « par le nom » de la restrictive elle-même, ou d\'un motif qui la couvre', () => {
    expect(genres(`select count(*) from pg_policies where policyname = 'deux_facteurs';`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policies where policyname like 'deux%';`)).toEqual(['faute'])
    expect(genres(`select count(*) from pg_policies where policyname in ('a', 'deux_facteurs');`)).toEqual(['faute'])
  })

  it('une forme que le contrôle ne lit pas (la vue nommée hors d\'un from)', () => {
    expect(genres(`select pg_policies.policyname from x;`)).toEqual(['faute'])
  })

  it('une exception dont le nombre ne tombe plus juste : une lecture de plus', () => {
    const e: Exception = { fichier: 'plante.sql', designe: "policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE' and cmd", nombre: 1, raison: 'essai' }
    const une = `select count(*) from pg_policies where tablename = 'x' and policyname = 'deux_facteurs' and permissive = 'RESTRICTIVE' and cmd = 'ALL';`
    expect(fautes(juger(une, [e]), [e])).toEqual([])
    const deux = `${une}\n${une}`
    expect(fautes(juger(deux, [e]), [e])).toEqual([expect.stringContaining('2 lecture(s), 1 attendue(s)')])
  })

  it('une exception de bloc ne couvre que son bloc', () => {
    const e: Exception = { fichier: 'plante.sql', bloc: { de: '-- ══ DF.', a: '-- ══ PR.' }, nombre: 1, raison: 'essai' }
    const lecture = `select count(*) from pg_policy where polname = 'deux_facteurs';`
    const sql = `-- ══ DF. le bloc\n${lecture}\n-- ══ PR. la suite\n${lecture}`
    expect(juger(sql, [e]).map((m) => m.genre)).toEqual(['exception', 'faute'])
  })
})
