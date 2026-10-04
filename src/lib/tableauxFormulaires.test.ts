import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// UN TABLEAU-FORMULAIRE VIT DANS SON ENVELOPPE ADAPTABLE (04/10/2026).
//
// Une ligne d'un `table-formulaire` se REMPLIT : dans une carte étroite, elle se replie en fiche empilée,
// chaque champ précédé de son libellé, au lieu de comprimer ses champs jusqu'à les rendre illisibles. Ce
// repli suit la largeur de l'enveloppe `.formulaire-adaptable` — une requête de CONTENEUR (index.css), et non
// plus la largeur de la fenêtre : la carte Véhicules écrasait ses champs à 1 024 pixels, et volet ouvert à
// 1 280, alors que le repli n'existait que sur téléphone.
//
// LE PIÈGE QUE CE TEST FERME : une requête de conteneur ne s'applique qu'aux descendants d'un conteneur. Un
// `table-formulaire` posé hors de l'enveloppe ne se replierait plus NULLE PART, téléphone compris — et rien ne
// le dirait, le tableau restant juste écrasé. Il exige donc que chaque `table-formulaire` des écrans soit dans
// une enveloppe, et que la feuille de style déclare le conteneur que la requête nomme.

const RACINE = new URL('../', import.meta.url).pathname

function sources(dossier: string): { chemin: string; texte: string }[] {
  const resultat: { chemin: string; texte: string }[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) resultat.push(...sources(chemin))
    else if (entree.name.endsWith('.tsx') && !entree.name.endsWith('.test.tsx')) {
      resultat.push({ chemin: chemin.slice(RACINE.length), texte: readFileSync(chemin, 'utf8') })
    }
  }
  return resultat
}

// Chaque `table-formulaire` et la `div` qui l'enveloppe au plus près : la dernière ouverte avant lui.
function tableauxHorsEnveloppe(texte: string): number[] {
  const fautes: number[] = []
  for (const m of texte.matchAll(/<table className="([^"]*\btable-formulaire\b[^"]*)"/g)) {
    const avant = texte.slice(0, m.index)
    const divs = [...avant.matchAll(/<div className="([^"]*)"/g)]
    const enveloppe = divs.at(-1)?.[1] ?? ''
    if (!enveloppe.split(/\s+/).includes('formulaire-adaptable')) fautes.push(avant.split('\n').length)
  }
  return fautes
}

describe('les tableaux-formulaires', () => {
  const tous = sources(RACINE)

  it('vivent chacun dans une enveloppe `formulaire-adaptable`', () => {
    const fautes = tous.flatMap(({ chemin, texte }) => tableauxHorsEnveloppe(texte).map((ligne) => `${chemin}:${ligne}`))
    expect(fautes).toEqual([])
    // Le plancher : sans lui, un balayage devenu aveugle passerait la règle à vide.
    const nombre = tous.reduce((n, { texte }) => n + [...texte.matchAll(/className="[^"]*\btable-formulaire\b/g)].length, 0)
    expect(nombre).toBeGreaterThanOrEqual(2)
  })

  it('se replient sur la largeur du conteneur que la feuille de style déclare', () => {
    const css = readFileSync(join(RACINE, 'index.css'), 'utf8')
    expect(css).toMatch(/\.formulaire-adaptable \{ container-type: inline-size; container-name: formulaire; \}/)
    const bloc = /@container formulaire \(max-width: \d+px\) \{([\s\S]*?)\n\}/.exec(css)
    expect(bloc, 'requête de conteneur `formulaire` introuvable').not.toBeNull()
    expect(bloc![1]).toContain('.table-formulaire thead { display: none; }')
    expect(bloc![1]).toMatch(/\.table-formulaire td::before \{\s*content: attr\(data-libelle\);/)
  })

  it('attrapent un tableau posé hors de l’enveloppe, et pas celui qui y est', () => {
    const fautif = '<div className="card">\n  <div className="table-scroll">\n    <table className="table-formulaire">'
    const juste = '<div className="card">\n  <div className="table-scroll formulaire-adaptable">\n    {/* un commentaire */}\n    <table className="table-formulaire">'
    expect(tableauxHorsEnveloppe(fautif)).toEqual([3])
    expect(tableauxHorsEnveloppe(juste)).toEqual([])
  })
})
