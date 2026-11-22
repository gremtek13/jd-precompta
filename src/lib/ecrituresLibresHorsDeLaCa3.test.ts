import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// LA CA3 EST AVEUGLE AUX ÉCRITURES LIBRES (EL4 ; conception 54, § 5.4). Elle se calcule des SOURCES — les pièces à leur
// paiement, le relevé, les ventes facturées, la caisse — selon l'exigibilité à l'encaissement ou au paiement, et ne lit aucune
// écriture du brouillon : une correction de TVA passée en écriture libre ne s'y voit pas, et l'écran de l'écriture libre le dit
// sous la ligne (`MOTS_DES_AVERTISSEMENTS`, lib/ecritureLibre.ts). Comment la CA3 reprendrait une telle correction reste une
// question à l'expert-comptable (EL-E4), avant tout code.
//
// Ce test lit le calcul de la CA3, sa liquidation, la TVA du relevé et l'écran qui assemble ses données : aucun ne nomme une
// écriture libre, ni n'importe un des trois modules qui la portent, et les données de la CA3 (`DonneesTva`) n'ont aucun champ
// qui porterait une écriture du brouillon. Le jour où la CA3 devrait la lire (la réponse à EL-E4), ce test tombe, et c'est voulu.

const RACINE = join(__dirname, '..')
const MODULES_DE_LA_CA3 = [
  'lib/declarationTva.ts', 'lib/liquidationTva.ts', 'lib/tvaDuReleve.ts', 'pages/dossier/TvaTab.tsx',
] as const
const MODULES_DE_L_ECRITURE_LIBRE = ['ecritureLibre', 'ecrituresLibresDesExports', 'ecrituresLibresDeLa2035', 'etatDesEcrituresLibres']

// Ce qui trahirait une lecture : le nom de la colonne, de la table, d'un des modules, ou du type des écritures libres.
const LECTURE = /ecriture_libre|ecritures_libres|EcrituresLibres|ecrituresLibres|EcritureLibre/

function lectureDesEcrituresLibres(source: string): string[] {
  const fautes: string[] = []
  for (const [n, ligne] of source.split('\n').entries()) {
    if (LECTURE.test(ligne)) fautes.push(`ligne ${n + 1} : ${ligne.trim()}`)
    const importe = /from\s+['"][^'"]*\/([^/'"]+)['"]/.exec(ligne)?.[1]
    if (importe && MODULES_DE_L_ECRITURE_LIBRE.includes(importe)) fautes.push(`ligne ${n + 1} : importe ${importe}`)
  }
  return fautes
}

describe('EL4 — la CA3 ne lit pas les écritures libres', () => {
  it.each(MODULES_DE_LA_CA3)('%s ne nomme ni n’importe une écriture libre', (chemin) => {
    expect(lectureDesEcrituresLibres(readFileSync(join(RACINE, chemin), 'utf8'))).toEqual([])
  })

  it('les données de la CA3 n’ont aucun champ d’écritures du brouillon', () => {
    const source = readFileSync(join(RACINE, 'lib/declarationTva.ts'), 'utf8')
    const debut = source.indexOf('export interface DonneesTva {')
    expect(debut).toBeGreaterThan(-1)
    const corps = source.slice(debut, source.indexOf('\n}', debut))
    const champs = [...corps.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1])
    // Un plancher : le scanner voit les champs, il n'est pas aveugle.
    expect(champs).toEqual(expect.arrayContaining(['pieces', 'paiements', 'releve', 'ventesFacturees']))
    expect(champs.filter((c) => /ecriture|brouillon|libre/i.test(c))).toEqual([])
  })

  it('le scanner voit une lecture plantée', () => {
    expect(lectureDesEcrituresLibres("import { lignesDeResultatLibres } from './ecrituresLibresDeLa2035'")).toHaveLength(2)
    expect(lectureDesEcrituresLibres("  if (e.ecriture_libre_id) continue")).toHaveLength(1)
    expect(lectureDesEcrituresLibres("import { x } from './ecritureLibre'")).toHaveLength(1)
  })
})
