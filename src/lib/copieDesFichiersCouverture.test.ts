import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CHAQUE CHEMIN DE STOCKAGE QUE LA BASE GARDE A SA PLACE DANS CE QUI PROTÈGE LES FICHIERS (relecture adverse du 27/11/2026).
//
// La copie des fichiers (INAL6, lib/copieDesFichiers.ts) dit, seau par seau, ce qu'elle porte et ce qu'elle écarte — une
// liste tenue à la main : une colonne qui désignera demain un fichier du stockage (le document d'une demande, la pièce
// d'une note de frais, un justificatif signé) n'y entrerait que si quelqu'un y pense, et son fichier ne serait ni dans la
// copie, ni dans la sauvegarde (qui ne porte que les logos des factures), sans que rien le dise. LA SOURCE EST L'EXPORT DU
// SCHÉMA, comme pour le plan de sauvegarde (sauvegardeTables.test.ts) : toute colonne de `public` dont le nom dit un chemin
// (`path`, `chemin`) se classe ici, avec sa raison — portée par la copie (et alors LUE par elle), portée par la sauvegarde,
// ou écartée.

type Classement =
  | { par: 'copie' }
  | { par: 'sauvegarde'; raison: string }
  | { par: 'ecartee'; raison: string }

const CLASSEMENT: Readonly<Record<string, Classement>> = {
  'pieces.storage_path': { par: 'copie' },
  'pieces.lisible_path': { par: 'copie' },
  'documents_divers.storage_path': { par: 'copie' },
  'imports_factures.fichier_chemin': { par: 'copie' },
  'factures_importees.fichier_chemin': { par: 'copie' },
  'parametres_facturation.logo_chemin': { par: 'sauvegarde', raison: 'le logo des factures : la sauvegarde (format 2) porte son fichier, vérifié à son empreinte' },
  'factures_emises.logo_chemin': { par: 'sauvegarde', raison: 'le logo figé d’une facture validée, celui d’une version des paramètres : la sauvegarde le porte' },
  'packs.storage_path_zip': { par: 'ecartee', raison: 'un pack se REFAIT des pièces, que la copie porte' },
  'packs.storage_path_excel': { par: 'ecartee', raison: 'le récapitulatif d’un pack se refait de même' },
  'cabinets.logo_storage_path': { par: 'ecartee', raison: 'le logo PUBLIC de la charte du cabinet, la donnée d’aucun dossier, se redépose' },
  'originaux_liberes.chemin': { par: 'ecartee', raison: 'un original qu’aucun import ne cite plus (libéré), sans policy : à retirer, pas à garder' },
}

const RACINES = ['supabase/schema', 'supabase/schema/socle']
const NOM_DE_CHEMIN = /(path|chemin)/i

/** Les colonnes `table.colonne` de `public` dont le nom dit un chemin, dans l'ordre écrit des migrations. */
export function colonnesDeChemin(fichiers: { chemin: string; texte: string }[]): Set<string> {
  const colonnes = new Set<string>()
  for (const { texte } of [...fichiers].sort((a, b) => (a.chemin < b.chemin ? -1 : 1))) {
    // Les corps des fonctions (leurs `declare v_chemin text`) et les lignes de commentaire ne déclarent aucune colonne.
    const utile = texte
      .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    for (const instruction of utile.split(';')) {
      const creation = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*)\)\s*$/i.exec(instruction.trim())
      if (creation) {
        for (const ligne of creation[2].split('\n')) {
          const m = /^\s*"?(\w+)"?\s+(?:text|character varying|varchar)\b/i.exec(ligne)
          if (m && NOM_DE_CHEMIN.test(m[1])) colonnes.add(`${creation[1]}.${m[1]}`)
        }
        continue
      }
      const alteration = /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?\s+([\s\S]*)$/i.exec(instruction.trim())
      if (alteration) {
        for (const m of alteration[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi)) {
          if (NOM_DE_CHEMIN.test(m[1])) colonnes.add(`${alteration[1]}.${m[1]}`)
        }
        for (const m of alteration[2].matchAll(/drop\s+column\s+(?:if\s+exists\s+)?"?(\w+)"?/gi)) colonnes.delete(`${alteration[1]}.${m[1]}`)
      }
      const suppression = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?(\w+)"?/i.exec(instruction)
      if (suppression) for (const c of [...colonnes]) if (c.startsWith(`${suppression[1]}.`)) colonnes.delete(c)
    }
  }
  return colonnes
}

function fichiersDuSchema() {
  return RACINES.flatMap((racine) =>
    readdirSync(racine)
      .filter((nom) => nom.endsWith('.sql') && statSync(join(racine, nom)).isFile())
      .map((nom) => ({ chemin: join(racine, nom), texte: readFileSync(join(racine, nom), 'utf-8') })),
  )
}

describe('chaque chemin de stockage de l’export est porté par la copie, par la sauvegarde, ou écarté avec sa raison', () => {
  const duSchema = colonnesDeChemin(fichiersDuSchema())

  it('lit bien tout le schéma, socle compris', () => {
    // La borne sans laquelle « aucune colonne oubliée » voudrait aussi dire « le lecteur ne voit plus rien » : la colonne
    // du socle (créée hors migration) et une colonne ajoutée par `alter table … add column` parmi d'autres.
    expect(duSchema.has('documents_divers.storage_path')).toBe(true)
    expect(duSchema.has('pieces.lisible_path')).toBe(true)
    expect(duSchema.size).toBeGreaterThanOrEqual(11)
  })

  it('aucune colonne de chemin n’est hors du classement, aucune entrée du classement n’est hors du schéma', () => {
    expect([...duSchema].filter((c) => !(c in CLASSEMENT)).sort(),
      'une colonne de chemin que rien ne classe : son fichier ne serait ni copié, ni sauvegardé, sans que rien le dise').toEqual([])
    expect(Object.keys(CLASSEMENT).filter((c) => !duSchema.has(c)).sort()).toEqual([])
  })

  it('ce que la copie porte, elle le LIT : la colonne est dans la sélection de sa table', () => {
    const lecture = readFileSync('src/lib/copieDesFichiersLecture.ts', 'utf-8')
    for (const [cle, classement] of Object.entries(CLASSEMENT)) {
      if (classement.par !== 'copie') continue
      const [table, colonne] = cle.split('.')
      const selection = new RegExp(`from\\('${table}'\\)\\.select\\('([^']*)'`).exec(lecture)
      expect(selection, `la copie ne lit pas « ${table} »`).not.toBeNull()
      expect(selection![1].split(',').map((c) => c.trim()), `la copie ne lit pas « ${cle} »`).toContain(colonne)
    }
  })

  it('LE LECTEUR VOIT UN DÉFAUT PLANTÉ', () => {
    expect([...colonnesDeChemin([
      { chemin: '00.sql', texte: 'create table public.demandes (\n  id uuid primary key,\n  fichier_chemin text not null,\n  nom text\n);' },
      { chemin: '01.sql', texte: 'alter table public.notes add column justificatif_path text, add column montant numeric;' },
      // Un corps de fonction qui déclare un chemin, une ligne de commentaire qui en cite un : ni l'un ni l'autre.
      { chemin: '02.sql', texte: 'create function f() returns void language plpgsql as $$\ndeclare v_chemin text;\nbegin end $$;\n-- create table x (y_path text);' },
      { chemin: '03.sql', texte: 'alter table public.notes drop column justificatif_path;' },
    ])].sort()).toEqual(['demandes.fichier_chemin'])
  })
})
