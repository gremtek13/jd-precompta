import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// ÉCRIRE, RÉÉCRIRE OU RETIRER LES ÉCRITURES D'UNE VENTE FACTURÉE, ET CHOISIR LE COMPTE D'UNE COMPENSATION, SONT DES GESTES
// DU CABINET (ligne 28.6, étape VF4c1 ; conception, § 10 : « ses écritures s'écrivent sur le clic du cabinet »). La base le
// tient — les trois fonctions n'ouvrent qu'à `admin_du_dossier` (essai `ecrituresVentesFacturees.sql`) —, et l'écran ne
// l'offre pas au client : aucun écran de son espace ne change à cette étape. Le patron de exemplaireCabinetSeul.test.ts :
// partir de ce que le client MONTE, suivre les imports relatifs, et vérifier qu'aucun fichier atteint ne nomme les trois
// fonctions ni ne monte la section ; et l'inverse, que le cabinet les atteint, faute de quoi le parcours serait aveugle.
const SRC = resolve(process.cwd(), 'src')

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

const LES_TROIS_FONCTIONS = /'(ecrire_vente_facturee|retirer_ecriture_vente_facturee|choisir_compte_contrepartie)'/
const LA_SECTION = /VentesFactureesEcritures|etatsDesVentesFacturees|lireLesSourcesDesEcrituresDeVente/

describe('les écritures d’une vente facturée ne s’offrent qu’au cabinet', () => {
  const client = atteints(ECRANS_DU_CLIENT)
  const cabinet = atteints(['pages/DossierDetail.tsx'])

  it('le parcours du client suit bien les imports', () => {
    expect(client.size).toBeGreaterThanOrEqual(40)
  })

  it('le cabinet atteint la section et les trois fonctions : le garde voit ce qu’il cherche', () => {
    expect(nommant(cabinet, LES_TROIS_FONCTIONS)).toEqual(['lib/ecrituresVentesFactureesEcran.ts', 'pages/dossier/VentesFactureesEcritures.tsx'])
    expect(nommant(cabinet, LA_SECTION)).toContain('pages/dossier/EcrituresTab.tsx')
  })

  it('aucun fichier de l’espace du client ne nomme les trois fonctions, ni ne monte la section ou sa lecture', () => {
    expect(nommant(client, LES_TROIS_FONCTIONS)).toEqual([])
    expect(nommant(client, LA_SECTION)).toEqual([])
  })

  it('la section n’a aucune variante pour le client : pas d’`espace`, pas de prop de droit', () => {
    const section = sansCommentaires(readFileSync(join(SRC, 'pages/dossier/VentesFactureesEcritures.tsx'), 'utf8'))
    expect(section).not.toMatch(/\bespace\b/)
    expect(section).not.toMatch(/droit/i)
  })
})
