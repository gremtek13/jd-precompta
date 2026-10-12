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
