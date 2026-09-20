import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CE TEST REMPLACE UN GREP, ET C'EST TOUT SON INTÉRÊT.
//
// Le plafond « Max rows » de PostgREST tronque toute lecture sans le dire (voir CLAUDE.md et
// lib/lectureComplete.ts). Le portage de 2026 s'est appuyé sur un grep décrit dans CLAUDE.md —
// `from('<table>')` + `select(` sans `count: 'exact'` — annoncé comme rendant zéro.
//
// **Ce grep était faux, et il rendait zéro pour une raison fausse** : il travaille ligne à ligne,
// alors que le formatage normal du dépôt coupe la chaîne Supabase sur plusieurs lignes. Rejoué le
// 20/09/2026 en tenant compte des retours à la ligne, il a rendu TROIS lectures non paginées, dont
// l'aperçu d'un pack et la liste des pièces à rapprocher.
//
// Une vérification qui doit être « rejouée à la main » et dont personne ne peut voir qu'elle est
// fausse ne vaut rien. Elle tourne donc ici, à chaque `npm test` et à chaque CI.

const TABLES = ['pieces', 'lignes_bancaires', 'ecritures_brouillon', 'documents_divers',
                'piece_textes_ocr', 'piece_commentaires']

// Les lectures dont la petitesse est garantie par le MODÈLE et non par la chance. Chaque entrée
// porte sa raison : c'est ce qui fait de l'ajout d'une exception un acte délibéré plutôt qu'un
// moyen de faire taire le test.
const EXCEPTIONS: Record<string, string> = {
  'src/lib/contrepartieBanque.ts': "les écritures d'UNE pièce — la partie double en produit deux ou trois, jamais mille",
}

function fichiersSource(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiersSource(chemin)
    if (!/\.tsx?$/.test(nom) || nom.includes('.test.')) return []
    return [chemin]
  })
}

/** Les lectures de COLLECTION qui n'annoncent pas de compte — donc indiscernables d'une troncature. */
export function lecturesNonPaginees(): { fichier: string; table: string; extrait: string }[] {
  // `[^;]*?` et non `.*?` : la chaîne s'arrête au point-virgule, sinon une expression voisine
  // fournirait le `count:` qui manque et masquerait le défaut.
  const chaine = new RegExp(
    `\\.from\\('(${TABLES.join('|')})'\\)((?:[^;])*?)(?=\\n\\s*(?:const|let|return|if|await|\\}|//)|;)`,
    'gs',
  )
  const trouves: { fichier: string; table: string; extrait: string }[] = []
  for (const fichier of fichiersSource('src')) {
    const source = readFileSync(fichier, 'utf8')
    for (const m of source.matchAll(chaine)) {
      const [, table, corps] = m
      if (!corps.includes('.select(')) continue                       // écriture, pas lecture
      if (corps.includes('count:')) continue                          // paginée et déclarée
      if (corps.includes('.single()') || corps.includes('.maybeSingle()')) continue  // une ligne
      if (/\.limit\(\s*\d+\s*\)/.test(corps)) continue                // plafond VOULU et écrit
      trouves.push({ fichier, table, extrait: corps.split(/\s+/).join(' ').slice(0, 90) })
    }
  }
  return trouves
}

describe('plafond PostgREST — aucune collection lue sans compte annoncé', () => {
  it('ne laisse passer que les exceptions déclarées, avec leur raison', () => {
    const restants = lecturesNonPaginees().filter((l) => !(l.fichier in EXCEPTIONS))
    expect(
      restants.map((l) => `${l.fichier} [${l.table}] ${l.extrait}`),
      'Lecture de collection sans `count: \'exact\'` : passe par `lireTout` (lib/lectureComplete.ts), ' +
      'ou inscris-la dans EXCEPTIONS avec la raison qui borne sa taille.',
    ).toEqual([])
  })

  // Un contrôle qui ne trouve jamais rien peut être un contrôle cassé : celui-ci le dit en
  // vérifiant qu'il sait ENCORE voir. Sans ça, une regex devenue inopérante afficherait zéro
  // exactement comme un dépôt sain — la panne qui ressemble au succès.
  it('sait encore repérer une lecture non paginée', () => {
    const toutes = lecturesNonPaginees()
    expect(toutes.length, "le contrôle ne voit plus rien du tout — regex à reprendre").toBeGreaterThan(0)
    expect(Object.keys(EXCEPTIONS).every((f) => toutes.some((l) => l.fichier === f)),
      'une exception déclarée ne correspond à aucune lecture réelle — à retirer').toBe(true)
  })
})
