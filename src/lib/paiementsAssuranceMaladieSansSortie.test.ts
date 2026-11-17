import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// LE MODULE QUI LIT UN RETOUR DE L'ASSURANCE MALADIE N'A AUCUNE SORTIE (conception 53, §3 : « le module de lecture est pur :
// ni supabase, ni fetch, ni stockage, ni console, ni horloge »). Le fichier d'un praticien porte des données de santé ; il
// se lit dans le navigateur, et seuls des agrégats en sortent, par le RETOUR des fonctions. Ce relevé lit le texte du module,
// commentaires ôtés : une sortie (le réseau, un journal, le stockage du navigateur, l'horloge, un import dynamique) ou un
// import d'un autre module que `./csv` (les types exceptés) est une faute. Éprouvé par trois défauts plantés.
//
// ET AUCUN MOTEUR NE LIT LES DEUX TABLES (conception 53, §8 : la recette entrerait deux fois) : leurs noms ne paraissent dans
// `src/` que là où la liste ci-dessous le dit, chaque fichier sous sa raison ; un lecteur nouveau se range ici, sa raison
// avec lui, ou il est une faute. Le plancher : les fichiers de la liste existent et nomment bien une des tables.

const MODULE = 'src/lib/paiementsAssuranceMaladie.ts'
const IMPORTS_PERMIS = new Set(['./csv'])

const sansCommentaires = (texte: string) => texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const SORTIES: readonly [string, RegExp][] = [
  ['le client de la base', /supabase/i],
  ['le réseau', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/],
  ['un journal', /\bconsole\s*\./],
  ['le stockage du navigateur', /localStorage|sessionStorage|indexedDB|document\.cookie|caches\./],
  ['l’horloge', /\bDate\b|performance\.now|\bsetTimeout\b|\bsetInterval\b/],
  ['un import dynamique', /\bimport\s*\(/],
  ['une Edge Function ou le modèle', /functions\.invoke|\binvoke\s*\(|bedrock/i],
  ['la fenêtre', /\bwindow\s*\.|\bnavigator\s*\.|\bpostMessage\b/],
]

/** Les fautes d'un texte de module : une sortie, ou un import hors de la liste (les imports de type exceptés). */
export function fautesDeSortie(texte: string): string[] {
  const code = sansCommentaires(texte)
  const fautes = SORTIES.filter(([, motif]) => motif.test(code)).map(([nom]) => nom)
  for (const m of code.matchAll(/^\s*import\s+(type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/gm)) {
    if (!m[1] && !IMPORTS_PERMIS.has(m[2])) fautes.push(`l’import de ${m[2]}`)
  }
  return fautes
}

describe('le module de lecture n’a aucune sortie', () => {
  const texte = readFileSync(resolve(process.cwd(), MODULE), 'utf8')

  it('aucune sortie, et `./csv` seul importé', () => {
    expect(fautesDeSortie(texte)).toEqual([])
    expect(texte).toContain('from \'./csv\'')
  })

  it('trois défauts plantés se voient : un journal d’une cellule, le client de la base, l’horloge', () => {
    const journal = texte.replace('for (const { ligne, cellules } of lignes) {', 'for (const { ligne, cellules } of lignes) {\n    console.log(cellules)')
    expect(journal).not.toBe(texte)
    expect(fautesDeSortie(journal)).toEqual(['un journal'])
    expect(fautesDeSortie(`import { supabase } from './supabase'\n${texte}`)).toEqual(['le client de la base', 'l’import de ./supabase'])
    expect(fautesDeSortie(texte.replace('const bissextile =', 'const aujourdHui = new Date()\n  const bissextile ='))).toEqual(['l’horloge'])
  })
})

// Les fichiers de `src/` qui nomment une des deux tables, chacun sous sa raison.
const LECTEURS_PERMIS: Readonly<Record<string, string>> = {
  'src/lib/paiementsAssuranceMaladie.ts': 'le module de lecture, qui nomme la fonction d’import de la base',
  'src/lib/paiementsAssuranceMaladie.test.ts': 'les essais du module, qui nomment la migration',
  'src/lib/sauvegarde.ts': 'le plan de sauvegarde, derrière le drapeau',
  'src/lib/sauvegardePaiementsAssuranceMaladie.test.ts': 'les essais du plan de sauvegarde',
  'src/lib/restaurationEssai.test.ts': 'la garde de l’essai de restauration',
  'src/lib/types.ts': 'le type des deux tables',
  'src/lib/paiementsAssuranceMaladieLecture.ts': 'la lecture de l’écran d’import (NOE4), qui montre et ne calcule rien',
  'src/lib/paiementsAssuranceMaladieLecture.test.ts': 'les essais de cette lecture',
  'src/components/PaiementsAssuranceMaladie.tsx': 'l’écran d’import (NOE4), qui appelle la fonction d’import et celle du retrait',
  'src/components/PaiementsAssuranceMaladie.test.tsx': 'les essais de l’écran d’import',
  'src/lib/rapprochementAssuranceMaladie.ts': 'le rapprochement (NOE5), qui propose et contrôle sans rien compter (conception 53, § 8), et nomme sa migration',
  'src/lib/rapprochementAssuranceMaladie.test.ts': 'les essais du rapprochement, qui relisent les mots de sa migration',
  'src/pages/dossier/BanqueTab.tsx': 'l’onglet Banque (NOE5b), qui appelle les deux fonctions de l’association, au cabinet seul ; '
    + 'il ne compte rien des paiements : la fiche et la section les montrent, les candidats d’une vente écartent un crédit associé',
  'src/pages/dossier/BanqueTab.assuranceMaladie.test.tsx': 'les essais de l’association dans l’onglet Banque',
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    return statSync(chemin).isDirectory() ? fichiers(chemin) : /\.(ts|tsx)$/.test(nom) ? [chemin] : []
  })
}

describe('aucun moteur ne lit les tables des paiements de l’assurance maladie', () => {
  const racine = process.cwd()
  const nommant = fichiers(resolve(racine, 'src'))
    .filter((f) => /(imports|paiements)_assurance_maladie/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(racine, f).split('\\').join('/'))
    .sort()

  it('seuls les fichiers de la liste nomment les tables', () => {
    expect(nommant.filter((f) => !(f in LECTEURS_PERMIS))).toEqual([])
  })

  it('le plancher : chaque fichier de la liste existe et nomme une des tables', () => {
    expect(nommant).toEqual(Object.keys(LECTEURS_PERMIS).sort())
  })
})
