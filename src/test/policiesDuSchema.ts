import { FormeInconnue } from './schema'

// LES POLICIES DU SCHÉMA, REJOUÉES INSTRUCTION PAR INSTRUCTION (relecture de sécurité du 13/11/2026, SECU3-Q1 et SECU3-Q2).
//
// Deux scanners en dépendent — stockageSansMiseAJour.test.ts (aucun seau n'ouvre la mise à jour d'un objet) et
// policiesDeMiseAJour.test.ts (la mise à jour relit la cible comme l'insertion). Ils lisent l'export (supabase/schema, le
// socle compris) PUIS les migrations préparées (supabase/preparees) : la dernière définition de chaque policy, celle que
// la base porterait.
//
// Il part de TOUT : chaque `create policy`, `alter policy` et `drop policy` du texte, hors des commentaires — au premier
// niveau, ou dans le corps d'un bloc DO ou d'une fonction —, et chaque `drop table`. Une forme qu'il ne sait pas
// rejouer LÈVE (FormeInconnue) au lieu d'être devinée : un renommage, une clause inconnue, une policy écrite dans une
// chaîne (`execute '…'`) qui n'est pas la policy RESTRICTIVE `deux_facteurs` (qui n'ouvre rien), un `alter` ou un `drop`
// d'une policy jamais posée. Une seule exception, avec sa raison : le socle (supabase/schema/socle) est un INSTANTANÉ du
// catalogue, régénéré après toute migration qui touche ses douze tables ; il vient après les migrations et pose les
// policies telles que la base les porte aujourd'hui. Une migration qui en modifiait une avant lui (l'`alter` d'une policy
// que seul le socle crée) attend donc sa création par le socle, qui la remplace ; une modification que rien ne résout
// lève à la fin.

export type Commande = 'all' | 'select' | 'insert' | 'update' | 'delete'

export interface PolicyDuSchema {
  /** `schéma.table` : `public.pieces`, `storage.objects`. */
  table: string
  nom: string
  permissive: boolean
  commande: Commande
  /** Les rôles, en minuscules ; `public` sans clause TO. */
  roles: string[]
  /** Le texte de l'expression, espaces ramenés à un seul ; nul sans la clause. */
  using: string | null
  withCheck: string | null
  /** Le fichier de la dernière instruction qui l'a posée ou changée. */
  chemin: string
}

export interface ReleveDesPolicies {
  /** Les policies, sous la clé `schéma.table.nom`. */
  policies: Map<string, PolicyDuSchema>
  /** Les tables créées (`schéma.table`), `drop table` rejoués. */
  tables: Set<string>
  /** Les instructions de policy lues au texte (création, modification, retrait). */
  instructions: number
  /** Les policies restrictives `deux_facteurs` écrites dans une chaîne, reconnues et comptées. */
  dynamiques: number
}

type Zone = 'code' | 'chaine'
interface Morceau { debut: number; fin: number; zone: Zone }

// Le texte découpé en zones : le code (premier niveau, et corps d'un DO ou d'une fonction, ouvert par `$…$` après `do` ou
// `as`) et les chaînes (`'…'`, `E'…'`, et tout `$…$` qui n'est pas un corps) ; les commentaires (`--`, `/* */`) ne sont dans
// aucune zone. Un corps contient du code ; un `$…$` dans un corps est une chaîne (le SQL d'un `execute`).
function zones(texte: string): Morceau[] {
  const morceaux: Morceau[] = []
  let i = 0
  let debutCode = 0
  const pile: string[] = [] // les étiquettes des corps ouverts
  const pousserCode = (fin: number) => { if (fin > debutCode) morceaux.push({ debut: debutCode, fin, zone: 'code' }) }
  while (i < texte.length) {
    const c = texte[i]
    if (texte.startsWith('--', i)) {
      pousserCode(i)
      const fin = texte.indexOf('\n', i)
      i = fin < 0 ? texte.length : fin
      debutCode = i
      continue
    }
    if (texte.startsWith('/*', i)) {
      pousserCode(i)
      const fin = texte.indexOf('*/', i + 2)
      if (fin < 0) throw new FormeInconnue('Un commentaire /* ne se referme pas.')
      i = fin + 2
      debutCode = i
      continue
    }
    if (c === "'") {
      const echappe = i > 0 && /[eE]/.test(texte[i - 1]) && (i < 2 || !/[\w$]/.test(texte[i - 2]))
      pousserCode(echappe ? i - 1 : i)
      let k = i + 1
      for (;;) {
        if (k >= texte.length) throw new FormeInconnue('Une chaîne ne se referme pas.')
        if (echappe && texte[k] === '\\') { k += 2; continue }
        if (texte[k] === "'") {
          if (texte[k + 1] === "'") { k += 2; continue }
          break
        }
        k++
      }
      morceaux.push({ debut: i + 1, fin: k, zone: 'chaine' })
      i = k + 1
      debutCode = i
      continue
    }
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(texte.slice(i, i + 64))
    if (dollar && !(i > 0 && /\w/.test(texte[i - 1]))) {
      const balise = dollar[0]
      if (pile.length > 0 && balise === pile[pile.length - 1]) {
        // La fin d'un corps.
        pousserCode(i)
        pile.pop()
        i += balise.length
        debutCode = i
        continue
      }
      const avant = texte.slice(0, i).replace(/\s+$/, '')
      const estUnCorps = pile.length === 0 && /\b(do|as)$/i.test(avant)
      pousserCode(i)
      if (estUnCorps) {
        pile.push(balise)
        i += balise.length
        debutCode = i
        continue
      }
      const fin = texte.indexOf(balise, i + balise.length)
      if (fin < 0) throw new FormeInconnue(`La chaîne ${balise} ne se referme pas.`)
      morceaux.push({ debut: i + balise.length, fin, zone: 'chaine' })
      i = fin + balise.length
      debutCode = i
      continue
    }
    i++
  }
  pousserCode(texte.length)
  if (pile.length > 0) throw new FormeInconnue(`Le corps ${pile[pile.length - 1]} ne se referme pas.`)
  return morceaux
}

// Le texte réduit au code et à ses chaînes, les commentaires effacés : chaque chaîne y est récrite entre apostrophes, les
// siennes doublées (une chaîne `$…$` ou `E'…'` comprise) — l'expression d'une policy en contient (`'packs'`), et la fin
// d'une instruction se cherche hors d'elles. Pour chaque position du texte réduit, sa zone.
function sansCommentaires(texte: string): { texte: string; zoneEn: (i: number) => Morceau | null } {
  let propre = ''
  const reperes: Morceau[] = []
  for (const m of zones(texte)) {
    if (m.zone === 'code') {
      reperes.push({ debut: propre.length, fin: propre.length + (m.fin - m.debut), zone: 'code' })
      propre += texte.slice(m.debut, m.fin) + ' '
      continue
    }
    const brut = texte.slice(m.debut, m.fin)
    const delimitee = texte[m.debut - 1] === "'"
    const echappee = delimitee && /[eE]/.test(texte[m.debut - 2] ?? '')
    const contenu = !delimitee ? brut.replace(/'/g, "''") : echappee ? brut.replace(/\\'/g, "''") : brut
    propre += "'"
    reperes.push({ debut: propre.length, fin: propre.length + contenu.length, zone: 'chaine' })
    propre += contenu + "' "
  }
  return { texte: propre, zoneEn: (i) => reperes.find((r) => i >= r.debut && i < r.fin) ?? null }
}

/** La fin (exclue) d'un groupe de parenthèses ouvert en `i`, les chaînes `'…'` sautées. */
function finDuGroupe(texte: string, i: number): number {
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    const c = texte[k]
    if (c === "'") {
      k++
      while (k < texte.length && !(texte[k] === "'" && texte[k + 1] !== "'")) k += texte[k] === "'" ? 2 : 1
      continue
    }
    if (c === '(') profondeur++
    else if (c === ')') {
      profondeur--
      if (profondeur === 0) return k + 1
    }
  }
  throw new FormeInconnue(`Une parenthèse ouverte ne se referme pas : ${texte.slice(i, i + 80)}`)
}

/** La fin (exclue) de l'instruction qui commence en `i` : le premier `;` hors chaîne et hors parenthèses. */
function finDeLInstruction(texte: string, i: number): number {
  let profondeur = 0
  for (let k = i; k < texte.length; k++) {
    const c = texte[k]
    if (c === "'") {
      k++
      while (k < texte.length && !(texte[k] === "'" && texte[k + 1] !== "'")) k += texte[k] === "'" ? 2 : 1
      continue
    }
    if (c === '(') profondeur++
    else if (c === ')') profondeur--
    else if (c === ';' && profondeur === 0) return k
  }
  throw new FormeInconnue(`Une instruction ne se termine pas : ${texte.slice(i, i + 80)}`)
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_]\w*)`
const nu = (ident: string) => (ident.startsWith('"') ? ident.slice(1, -1) : ident.toLowerCase())
function tableQualifiee(qualifiee: string): string {
  const m = new RegExp(String.raw`^(${IDENT})(?:\s*\.\s*(${IDENT}))?$`).exec(qualifiee.trim())
  if (!m) throw new FormeInconnue(`Une table illisible : ${qualifiee}`)
  return m[2] ? `${nu(m[1])}.${nu(m[2])}` : `public.${nu(m[1])}`
}
const espaces = (texte: string) => texte.replace(/\s+/g, ' ').trim()

interface Clauses { permissive?: boolean; commande?: Commande; roles?: string[]; using?: string; withCheck?: string }

// Les clauses qui suivent `on <table>` : chacune une fois au plus, dans l'ordre que PostgreSQL admet ; un reste lève.
function clauses(reste: string, creation: boolean, instruction: string): Clauses {
  const c: Clauses = {}
  let r = reste.trim()
  const lire = (motif: RegExp): RegExpExecArray | null => {
    const m = motif.exec(r)
    if (m) r = r.slice(m[0].length).trim()
    return m
  }
  if (creation) {
    const as = lire(/^as\s+(permissive|restrictive)\b/i)
    if (as) c.permissive = as[1].toLowerCase() === 'permissive'
    const pour = lire(/^for\s+(all|select|insert|update|delete)\b/i)
    if (pour) c.commande = pour[1].toLowerCase() as Commande
  }
  const a = lire(new RegExp(String.raw`^to\s+(${IDENT}(?:\s*,\s*${IDENT})*)`, 'i'))
  if (a) c.roles = a[1].split(',').map((x) => nu(x.trim()))
  for (const [cle, motif] of [['using', /^using\s*(?=\()/i], ['withCheck', /^with\s+check\s*(?=\()/i]] as const) {
    if (lire(motif)) {
      const fin = finDuGroupe(r, 0)
      c[cle] = espaces(r.slice(1, fin - 1))
      r = r.slice(fin).trim()
    }
  }
  if (r !== '') throw new FormeInconnue(`Une clause de policy jamais rencontrée (« ${r.slice(0, 60)} ») : ${instruction.slice(0, 120)}`)
  return c
}

// LA POLICY RESTRICTIVE `deux_facteurs`, la seule forme admise dans une chaîne : elle n'ouvre rien, elle ferme.
const DYNAMIQUE_ADMISE = /^create\s+policy\s+deux_facteurs\s+on\s+\S+\s+as\s+restrictive\s+for\s+all\s+to\s+authenticated\b/i

/** Les policies des fichiers donnés, dans leur ordre ; les chemins sous `/socle/` sont des instantanés (en-tête). */
export function policiesDuSchema(fichiers: { chemin: string; texte: string }[]): ReleveDesPolicies {
  const policies = new Map<string, PolicyDuSchema>()
  const tables = new Set<string>()
  const enAttente = new Map<string, string>() // les modifications que le socle doit résoudre : clé → chemin
  let instructions = 0
  let dynamiques = 0
  // Les tables du socle : créées hors des migrations, avec des policies d'avant l'export ; une migration a pu retirer ou
  // modifier l'une d'elles, que seul le socle (l'instantané d'aujourd'hui) dit encore, ou plus du tout.
  const tablesDuSocle = new Set<string>()
  for (const { chemin, texte } of fichiers) {
    if (!chemin.includes('/socle/')) continue
    for (const m of texte.matchAll(new RegExp(String.raw`^create\s+table\s+(?:if\s+not\s+exists\s+)?(${IDENT}(?:\s*\.\s*${IDENT})?)\s*\(`, 'gim'))) {
      tablesDuSocle.add(tableQualifiee(m[1]))
    }
  }
  for (const { chemin, texte } of fichiers) {
    const instantane = chemin.includes('/socle/')
    const { texte: propre, zoneEn } = sansCommentaires(texte)
    const motif = /\b(create|alter|drop)\s+(policy|table)\b/gi
    for (let m = motif.exec(propre); m; m = motif.exec(propre)) {
      const zone = zoneEn(m.index)
      const verbe = m[1].toLowerCase()
      const objet = m[2].toLowerCase()
      if (zone?.zone === 'chaine') {
        if (objet === 'table') continue // un texte qui nomme une table (un message, un commentaire) n'en crée aucune
        const contenu = propre.slice(m.index, zone.fin).replace(/''/g, "'")
        if (verbe !== 'create' || !DYNAMIQUE_ADMISE.test(contenu)) {
          throw new FormeInconnue(`${chemin} : une policy écrite dans une chaîne, qui n'est pas la policy restrictive deux_facteurs : ${contenu.slice(0, 120)}`)
        }
        dynamiques++
        continue
      }
      const fin = finDeLInstruction(propre, m.index)
      const instruction = espaces(propre.slice(m.index, fin))
      motif.lastIndex = fin
      if (objet === 'table') {
        if (verbe === 'create') {
          const t = new RegExp(String.raw`^create\s+table\s+(?:if\s+not\s+exists\s+)?(${IDENT}(?:\s*\.\s*${IDENT})?)\s*\(`, 'i').exec(instruction)
          if (t) tables.add(tableQualifiee(t[1]))
          continue
        }
        if (verbe === 'drop') {
          const t = new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?(${IDENT}(?:\s*\.\s*${IDENT})?)\s*(?:cascade|restrict)?$`, 'i').exec(instruction)
          if (!t) throw new FormeInconnue(`${chemin} : un drop table jamais rencontré : ${instruction.slice(0, 120)}`)
          const table = tableQualifiee(t[1])
          tables.delete(table)
          for (const [cle, p] of policies) if (p.table === table) policies.delete(cle)
          continue
        }
        // `alter table` : ni un renommage de table ni un changement de schéma n'existent dans l'export ; ils lèveraient.
        if (/^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?\S+\s+(?:rename\s+to|set\s+schema)\b/i.test(instruction)) {
          throw new FormeInconnue(`${chemin} : une table renommée ou déplacée, jamais rencontrée : ${instruction.slice(0, 120)}`)
        }
        continue
      }
      instructions++
      const tete = new RegExp(String.raw`^(create|alter|drop)\s+policy\s+(if\s+exists\s+)?(${IDENT})\s+on\s+(${IDENT}(?:\s*\.\s*${IDENT})?)`, 'i').exec(instruction)
      if (!tete || (tete[2] && verbe !== 'drop')) throw new FormeInconnue(`${chemin} : une instruction de policy jamais rencontrée : ${instruction.slice(0, 120)}`)
      const nom = nu(tete[3])
      const table = tableQualifiee(tete[4])
      const cle = `${table}.${nom}`
      const reste = instruction.slice(tete[0].length)
      if (verbe === 'drop') {
        if (!/^\s*(?:cascade|restrict)?\s*$/i.test(reste)) throw new FormeInconnue(`${chemin} : un drop policy jamais rencontré : ${instruction.slice(0, 120)}`)
        if (!policies.delete(cle) && !tete[2] && !tablesDuSocle.has(table)) {
          throw new FormeInconnue(`${chemin} : le retrait d'une policy jamais posée : ${cle}`)
        }
        enAttente.delete(cle)
        continue
      }
      if (verbe === 'create') {
        if (policies.has(cle) && !instantane) throw new FormeInconnue(`${chemin} : une policy posée deux fois : ${cle}`)
        const c = clauses(reste, true, instruction)
        policies.set(cle, {
          table, nom, permissive: c.permissive ?? true, commande: c.commande ?? 'all', roles: c.roles ?? ['public'],
          using: c.using ?? null, withCheck: c.withCheck ?? null, chemin,
        })
        if (instantane) enAttente.delete(cle)
        continue
      }
      // alter policy : un renommage lève (jamais rencontré) ; sinon TO, USING et WITH CHECK remplacent ce qu'ils nomment.
      if (/^\s*rename\s+to\b/i.test(reste)) throw new FormeInconnue(`${chemin} : une policy renommée, jamais rencontrée : ${cle}`)
      const c = clauses(reste, false, instruction)
      const p = policies.get(cle)
      if (!p) {
        if (!tablesDuSocle.has(table)) throw new FormeInconnue(`${chemin} : la modification d'une policy jamais posée : ${cle}`)
        enAttente.set(cle, chemin)
        continue
      }
      policies.set(cle, {
        ...p, roles: c.roles ?? p.roles, using: c.using ?? p.using, withCheck: c.withCheck ?? p.withCheck, chemin,
      })
    }
  }
  if (enAttente.size > 0) {
    throw new FormeInconnue(`La modification d'une policy que rien ne pose : ${[...enAttente].map(([cle, ch]) => `${cle} (${ch})`).join(', ')}`)
  }
  return { policies, tables, instructions, dynamiques }
}

/** Une policy vaut-elle pour cette commande ? (« pour tout » vaut pour chacune.) */
export const vautPour = (p: PolicyDuSchema, commande: Exclude<Commande, 'all'>) => p.commande === 'all' || p.commande === commande

/** Ce que la base juge sur la ligne PROPOSÉE d'une mise à jour : le WITH CHECK, à défaut l'USING (PostgreSQL 17, CREATE POLICY). */
export const controleDeLaLigneProposee = (p: PolicyDuSchema) => p.withCheck ?? p.using

/** Les tables qu'une expression relit (`from` ou `join` d'une sous-requête), parmi celles que le schéma crée. */
export function tablesRelues(expression: string | null, tables: Set<string>): Set<string> {
  const lues = new Set<string>()
  if (!expression) return lues
  const motif = new RegExp(String.raw`\b(?:from|join)\s+(${IDENT}(?:\s*\.\s*${IDENT})?)`, 'gi')
  for (const m of expression.matchAll(motif)) {
    const table = tableQualifiee(m[1])
    if (tables.has(table)) lues.add(table)
  }
  return lues
}
