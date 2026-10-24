import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// DÉSIGNER L'EXEMPLAIRE D'UNE FACTURE ÉMISE EST UN GESTE DU CABINET, JAMAIS DU CLIENT (ligne 28.6, étape VF1b). La base le
// tient — `designer_exemplaire_facture` et `defaire_exemplaire_facture` n'ouvrent qu'à `admin_du_dossier`, essai
// `exemplairesDesFactures.sql` —, mais l'écran ne doit pas non plus l'offrir : « aujourd'hui la restriction est une règle
// d'ÉCRAN » pour tant d'autres choses (CLAUDE.md), et un geste que la base refuserait au client ne lui est pas montré.
//
// Ce garde part de ce que le client MONTE (les six écrans de son espace, et la coque qu'il partage) et suit les imports
// relatifs de proche en proche : aucun fichier atteint ne nomme les quatre fonctions de la base (désigner, défaire, et depuis
// l'étape VF6c déclarer une vente hors des factures et retirer la déclaration), ni ne lit le journal des désignations, ni ne
// monte la fiche d'une pièce ou la section « Ce que cette pièce est ». Il part aussi du résultat inverse — le cabinet, lui, atteint la section —, faute de
// quoi un parcours qui ne suivrait aucun import passerait pour un espace client vierge.
const SRC = resolve(process.cwd(), 'src')

// Le code sans ses commentaires : un commentaire qui NOMME une fonction (comme celui-ci) n'est pas un appel.
const sansCommentaires = (texte: string) => texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

const ECRANS_DU_CLIENT = [
  'pages/ClientHome.tsx', 'pages/ClientUpload.tsx', 'pages/ClientInformations.tsx', 'pages/ClientSimulation.tsx',
  'pages/ClientVentes.tsx', 'pages/ClientBanque.tsx', 'components/Layout.tsx',
]

function resoudre(depuis: string, specifieur: string): string | null {
  const base = resolve(dirname(depuis), specifieur)
  for (const candidat of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidat)) return candidat
  }
  return null
}

/** Tous les fichiers de production atteints depuis `racines` par des imports relatifs (statiques ou dynamiques). */
function atteints(racines: readonly string[]): Map<string, string> {
  const vus = new Map<string, string>()
  const file = racines.map((r) => join(SRC, r))
  while (file.length > 0) {
    const chemin = file.pop() as string
    if (vus.has(chemin)) continue
    const texte = sansCommentaires(readFileSync(chemin, 'utf8'))
    vus.set(chemin, texte)
    for (const m of texte.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const suivant = resoudre(chemin, m[1])
      if (suivant !== null && !/\.test\.tsx?$/.test(suivant)) file.push(suivant)
    }
  }
  return vus
}

const nommant = (fichiers: Map<string, string>, motif: RegExp) =>
  [...fichiers].filter(([, texte]) => motif.test(texte)).map(([chemin]) => relative(SRC, chemin)).sort()

// Les quatre fonctions de la marque d'une pièce : les deux de VF1a, et les deux de la déclaration (étape VF6b), que la
// section « Ce que cette pièce est » appelle depuis l'étape VF6c — le cabinet seul, comme la base (`admin_du_dossier`).
const LES_DEUX_FONCTIONS = /designer_exemplaire_facture|defaire_exemplaire_facture/
const LES_FONCTIONS_DE_LA_DECLARATION = /declarer_vente_hors_des_factures|retirer_declaration_hors_des_factures/
const LES_QUATRE_FONCTIONS = new RegExp(`${LES_DEUX_FONCTIONS.source}|${LES_FONCTIONS_DE_LA_DECLARATION.source}`)
// Le journal des désignations, lu par la fiche (lib/marquesDeLaPieceLecture.ts) : sa policy n'a aucune branche client.
const LE_JOURNAL = /designations_des_pieces|marquesDeLaPieceLecture/
const LA_SECTION = /ExemplaireDeLaFacture|FichePiece/

describe('l’exemplaire d’une facture n’est offert qu’au cabinet', () => {
  const client = atteints(ECRANS_DU_CLIENT)
  const cabinet = atteints(['pages/DossierDetail.tsx'])

  it('le parcours du client suit bien les imports (un parcours muet serait un client sans rien)', () => {
    expect(client.size).toBeGreaterThanOrEqual(40)
    expect(nommant(client, /\bsupabase\b/).length).toBeGreaterThan(10)
  })

  it('le cabinet atteint la section et les quatre fonctions : le garde voit ce qu’il cherche', () => {
    expect(nommant(cabinet, LES_DEUX_FONCTIONS)).toEqual(['pages/dossier/ExemplaireDeLaFacture.tsx'])
    expect(nommant(cabinet, LES_FONCTIONS_DE_LA_DECLARATION)).toEqual(['pages/dossier/ExemplaireDeLaFacture.tsx'])
    expect(nommant(cabinet, LA_SECTION)).toContain('pages/dossier/FichePiece.tsx')
    expect(nommant(cabinet, LA_SECTION)).toContain('pages/dossier/PiecesTab.tsx')
    expect(nommant(cabinet, LE_JOURNAL)).toContain('lib/marquesDeLaPieceLecture.ts')
  })

  it('aucun fichier de l’espace du client ne nomme les quatre fonctions de la base', () => {
    expect(nommant(client, LES_QUATRE_FONCTIONS)).toEqual([])
  })

  it('aucun fichier de l’espace du client ne lit le journal des désignations', () => {
    expect(nommant(client, LE_JOURNAL)).toEqual([])
  })

  it('aucun fichier de l’espace du client ne monte la fiche d’une pièce ni la section de l’exemplaire', () => {
    expect(nommant(client, LA_SECTION)).toEqual([])
  })

  it('la section n’a aucune variante pour le client : pas d’`espace`, pas de prop de droit', () => {
    const section = sansCommentaires(readFileSync(join(SRC, 'pages/dossier/ExemplaireDeLaFacture.tsx'), 'utf8'))
    expect(section).not.toMatch(/\bespace\b/)
    expect(section).not.toMatch(/droit/i)
  })

  it('seule la section nomme les quatre fonctions, sur toute la source de production', () => {
    const tous = atteints(['main.tsx', 'App.tsx'])
    expect(nommant(tous, LES_QUATRE_FONCTIONS)).toEqual(['pages/dossier/ExemplaireDeLaFacture.tsx'])
  })
})
