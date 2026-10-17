import { readFileSync, readdirSync } from 'node:fs'

// CE QUE LA MIGRATION `bornes_du_stockage` ET SON ESSAI POSENT, relus dans leur texte (ligne 22.6). Partagé par
// bornesStockage.test.ts (la taille et les types, confrontés au module) et depotsDansLesSeaux.test.ts (chaque dépôt de la
// source confronté aux types de son seau). La migration se cherche dans l'export par son NOM, jamais par sa version :
// préparée, elle porte une version provisoire, que l'application lui remplace.

export interface BornesLues {
  seau: string
  taille: number
  types: string[]
}

const SCHEMA = new URL('../../supabase/schema/', import.meta.url)

/** Le chemin de la migration dans l'export : un fichier, et un seul, au nom `<version>_bornes_du_stockage.sql`. */
export function fichierDeLaMigration(): URL {
  const noms = readdirSync(SCHEMA).filter((nom) => /^\d{14}_bornes_du_stockage\.sql$/.test(nom))
  if (noms.length !== 1) throw new Error(`la migration bornes_du_stockage doit être UNE dans l'export : ${noms.length} trouvée(s)`)
  return new URL(noms[0], SCHEMA)
}

export function texteDeLaMigration(): string {
  return readFileSync(fichierDeLaMigration(), 'utf8')
}

/** Le texte sans ses lignes de commentaire : ce que la base exécute. */
export function sansCommentairesSql(texte: string): string {
  return texte.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n')
}

/** Les éléments d'un `array['…', '…']` SQL. Lève sur un élément qui n'est pas une chaîne simple. */
function elements(liste: string): string[] {
  return liste.split(',').map((brut) => {
    const m = /^\s*'([^']*)'\s*$/.exec(brut)
    if (!m) throw new Error(`élément de tableau illisible : ${brut}`)
    return m[1]
  })
}

/**
 * Les bornes que la migration pose, seau par seau. Chaque `update storage.buckets` doit avoir la forme que le fichier
 * lui donne — une autre forme LÈVE, plutôt que d'être sautée : un garde qui ne lit pas une instruction ne dit rien d'elle.
 */
export function bornesDeLaMigration(texte: string): BornesLues[] {
  const code = sansCommentairesSql(texte)
  const forme = /update\s+storage\.buckets\s+set\s+file_size_limit\s*=\s*(\d+)\s*,\s*allowed_mime_types\s*=\s*array\[([^\]]*)\]\s+where\s+id\s*=\s*'([^']+)'\s*;/gi
  const lues = [...code.matchAll(forme)].map((m) => ({ seau: m[3], taille: Number(m[1]), types: elements(m[2]) }))
  const updates = [...code.matchAll(/\bupdate\s+storage\.buckets\b/gi)].length
  if (updates !== lues.length) throw new Error(`${updates} update storage.buckets, dont ${lues.length} de la forme attendue`)
  return lues
}

/** Les bornes attendues par l'essai `supabase/essais/bornesStockage.sql` (sa table `attendu`). */
export function bornesDeLEssai(texte: string): (BornesLues & { publique: boolean })[] {
  const forme = /\('([^']+)',\s*(true|false),\s*(\d+)::bigint,\s*array\[([^\]]*)\]\)/g
  return [...sansCommentairesSql(texte).matchAll(forme)].map((m) => ({
    seau: m[1], publique: m[2] === 'true', taille: Number(m[3]), types: elements(m[4]),
  }))
}

export function texteDeLEssai(): string {
  return readFileSync(new URL('../../supabase/essais/bornesStockage.sql', import.meta.url), 'utf8')
}

// ── Le quatrième seau, `ventes` (étape A5c1, migration `logo_des_factures`) ─────────────────────────────────────────────
// La migration du logo CRÉE son seau, bornes comprises, par un `insert into storage.buckets` — elle ne touche à aucun autre
// seau. Préparée et pas encore appliquée, elle n'est pas dans l'export : le seau se lit alors dans l'essai seul.

/** La migration du logo dans l'export — UNE au plus, au nom `<version>_logo_des_factures.sql` —, ou null avant elle. */
export function fichierDeLaMigrationDuLogo(): URL | null {
  const noms = readdirSync(SCHEMA).filter((nom) => /^\d{14}_logo_des_factures\.sql$/.test(nom))
  if (noms.length > 1) throw new Error(`la migration logo_des_factures doit être UNE dans l'export : ${noms.length} trouvées`)
  return noms.length === 1 ? new URL(noms[0], SCHEMA) : null
}

/**
 * Le seau que la migration du logo crée : son nom, son accès public, sa taille et ses types. UN `insert into storage.buckets`,
 * à la forme que le fichier lui donne, et aucun `update storage.buckets` — une autre forme, ou un autre nombre, LÈVE.
 */
export function seauDeLaMigrationDuLogo(texte: string): BornesLues & { publique: boolean } {
  const code = sansCommentairesSql(texte)
  const forme = /insert\s+into\s+storage\.buckets\s*\(\s*id\s*,\s*name\s*,\s*public\s*,\s*file_size_limit\s*,\s*allowed_mime_types\s*\)\s*values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(\d+)\s*,\s*array\[([^\]]*)\]\s*\)\s*;/gi
  const lues = [...code.matchAll(forme)]
  const inserts = [...code.matchAll(/\binsert\s+into\s+storage\.buckets\b/gi)].length
  const updates = [...code.matchAll(/\bupdate\s+storage\.buckets\b/gi)].length
  if (lues.length !== 1 || inserts !== 1 || updates !== 0) {
    throw new Error(`${inserts} insert into storage.buckets, dont ${lues.length} de la forme attendue, et ${updates} update storage.buckets`)
  }
  const [, id, nom, publique, taille, types] = lues[0]
  if (id !== nom) throw new Error(`le seau ${id} porte un autre nom : ${nom}`)
  return { seau: id, publique: publique === 'true', taille: Number(taille), types: elements(types) }
}
