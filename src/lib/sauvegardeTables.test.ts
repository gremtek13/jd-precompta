import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CHEMINS_DOSSIER, ORDRE_RESTAURATION } from './sauvegarde'

// LE PLAN DE SAUVEGARDE EST UNE LISTE D'INCLUSION TENUE À LA MAIN, ET ELLE A CÉDÉ.
//
// Une table par dossier doit être inscrite à trois endroits de `sauvegarde.ts` (le graphe des clés
// étrangères, l'ordre de restauration, le mode d'accès). Rien ne le vérifiait. `exercices_clotures`,
// créée le 22/09/2026, n'était inscrite dans AUCUN des trois : une sauvegarde omettait silencieusement
// les marques de clôture, et une restauration aurait fait redemander au client les documents d'un
// exercice bouclé. C'est le motif que ce dépôt nomme partout — « une liste d'inclusion tenue à la
// main ne contient que ce à quoi quelqu'un a pensé, et son silence est indiscernable d'un dépôt
// sain ».
//
// LA SOURCE EXHAUSTIVE EST LE SCHÉMA EXPORTÉ, comme `rls.sql` part de `pg_class` : une table ajoutée
// demain est attrapée sans que personne ait à y penser. Et elle n'est devenue exhaustive que le
// 22/09/2026 — jusque-là DOUZE des 41 tables n'avaient aucun `create table` nulle part, ayant été
// créées hors `apply_migration` (voir `supabase/schema/socle/tables_sans_migration.sql`). Ce test
// n'aurait donc pas pu exister avant, et c'est en essayant de l'écrire que le trou est apparu.
//
// LES DEUX SENS COMPTENT, et pas par symétrie décorative : une table du schéma absente du plan n'est
// pas sauvegardée ; une table du plan absente du schéma fait échouer une restauration au moment
// précis où l'on ne peut plus rien vérifier.

const RACINES = ['supabase/schema', 'supabase/schema/socle']

// On ne coupe QUE les lignes entièrement en commentaire, jamais un `--` de fin de ligne : l'en-tête
// du fichier de socle CITE « 30 `create table` » en toutes lettres pour expliquer le trou qu'il
// comble, et un scanner qui lirait cette phrase compterait une table fantôme. Même règle que
// `retraitsStockage.test.ts`, où `stockage.ts` cite la forme interdite.
const CREATE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi
const DROP = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi

export function tablesDuSchema(fichiers: { chemin: string; texte: string }[]): Set<string> {
  const tables = new Set<string>()
  // Les fichiers se jouent dans l'ordre de leur nom : une table CRÉÉE puis SUPPRIMÉE ne doit pas
  // rester dans le compte (`pack_pieces`, supprimée par `drop_table_morte_pack_pieces`). Le socle
  // vient après, il ne fait qu'ajouter.
  for (const { texte } of [...fichiers].sort((a, b) => (a.chemin < b.chemin ? -1 : 1))) {
    const utile = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    for (const m of utile.matchAll(CREATE)) tables.add(m[1])
    for (const m of utile.matchAll(DROP)) tables.delete(m[1])
  }
  return tables
}

function fichiersDuSchema() {
  return RACINES.flatMap((racine) =>
    readdirSync(racine)
      .filter((nom) => nom.endsWith('.sql') && statSync(join(racine, nom)).isFile())
      .map((nom) => ({ chemin: join(racine, nom), texte: readFileSync(join(racine, nom), 'utf-8') })),
  )
}

describe('le plan de sauvegarde couvre TOUTES les tables du schéma', () => {
  it('aucune table du schéma n’est absente du plan', () => {
    const schema = tablesDuSchema(fichiersDuSchema())
    const horsOrdre = [...schema].filter((t) => !ORDRE_RESTAURATION.includes(t)).sort()
    const horsChemins = [...schema].filter((t) => !(t in CHEMINS_DOSSIER)).sort()
    expect(
      horsOrdre,
      'Table du schéma absente de ORDRE_RESTAURATION : une restauration ne la réinsérerait jamais. '
      + 'Inscris-la aux TROIS sites de sauvegarde.ts (RELATIONS, ORDRE_RESTAURATION, CHEMINS_DOSSIER).',
    ).toEqual([])
    expect(
      horsChemins,
      'Table du schéma absente de CHEMINS_DOSSIER : la sauvegarde d’un dossier l’omet EN SILENCE.',
    ).toEqual([])
  })

  it('aucune table du plan n’est absente du schéma', () => {
    // Le sens inverse : une table du plan qui n'existe nulle part fait échouer la restauration au
    // moment précis où plus rien ne peut être vérifié. C'est aussi ce qui attrape une table
    // supprimée (`pack_pieces`) restée dans le plan.
    const schema = tablesDuSchema(fichiersDuSchema())
    expect([...ORDRE_RESTAURATION].filter((t) => !schema.has(t)).sort()).toEqual([])
    expect(Object.keys(CHEMINS_DOSSIER).filter((t) => !schema.has(t)).sort()).toEqual([])
  })

  it('LE SCANNER VOIT UN DÉFAUT PLANTÉ', () => {
    // « Zéro faute » et « aveugle » se ressemblent trop : si le balayage rendait un ensemble vide,
    // les deux contrôles ci-dessus passeraient au vert sur un dépôt entièrement découvert. C'est la
    // panne que ce dépôt connaît sous plusieurs noms.
    const synthetique = [
      { chemin: '00_a.sql', texte: 'create table public.gardee (\n  id uuid primary key\n);' },
      { chemin: '01_b.sql', texte: 'create table if not exists jetee (id uuid);\ndrop table public.jetee;' },
      // Une ligne entièrement en commentaire qui CITE la forme : c'est exactement ce que fait
      // l'en-tête du fichier de socle, et la compter serait une table fantôme.
      { chemin: '02_c.sql', texte: '-- create table public.fantome (id uuid);\ncreate table public.vraie (id uuid);' },
    ]
    expect([...tablesDuSchema(synthetique)].sort()).toEqual(['gardee', 'vraie'])
  })

  it('le socle est bien BALAYÉ, pas seulement présent', () => {
    // Sans lui, les douze tables créées hors migration retomberaient dans le trou d'origine — et le
    // test passerait au vert en ne regardant que les migrations, qui n'en parlent pas.
    const schema = tablesDuSchema(fichiersDuSchema())
    for (const t of ['lignes_bancaires', 'ecritures_brouillon', 'documents_divers']) {
      expect(schema.has(t), `${t} est créée dans le socle : le balayage doit le lire`).toBe(true)
    }
    // Et la table dont l'omission a fait naître ce test.
    expect(schema.has('exercices_clotures')).toBe(true)
  })
})
