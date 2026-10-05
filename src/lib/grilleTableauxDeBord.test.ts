import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// LA GRILLE DES TABLEAUX DE BORD SUIT SA PLACE, PAS LA FENÊTRE (05/10/2026) — index.css, `.bento`, `.kpi`, `.widget`.
//
// Volet de droite ouvert à 1 280 pixels, quatre tuiles chiffrées tenaient chacune 130 pixels : la tuile de trésorerie, un
// <button> qui prenait la largeur de son contenu, passait sous sa voisine ; et le bouton d'une ligne de check sortait de
// sa carte, le libellé réduit à un mot par ligne. Rien de cela ne sortait du panneau central, et `debordements.mjs` ne
// le voyait pas avant d'apprendre la carte et le texte. Une fois la tuile pleine case, un montant trop long passe à la
// ligne au lieu de déborder — ce que l'outil ne compte pas, et c'est voulu. Ce test garde donc les règles elles-mêmes.
//
// ET CE QUI LES REND SÛRES : `container-type` fait de son porteur la référence des éléments `position: fixed` qu'il
// contient, et les fenêtres superposées de l'application sont posées en place (`position: 'fixed', inset: 0`), pas
// dans un portail. Une fenêtre ouverte DANS une grille ou une carte s'y retrouverait enfermée. Le test cherche donc,
// dans chaque grille des écrans, les composants qui posent une fenêtre fixe — leur liste se tire des sources, jamais
// tenue à la main.

const RACINE = new URL('../', import.meta.url).pathname
const CSS = readFileSync(join(RACINE, 'index.css'), 'utf8')

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

// Le corps d'un bloc CSS ouvert à `debut` (l'accolade comprise), jusqu'à l'accolade qui lui répond.
function bloc(css: string, debut: number): string {
  const ouverture = css.indexOf('{', debut)
  let profondeur = 0
  for (let i = ouverture; i < css.length; i++) {
    if (css[i] === '{') profondeur++
    else if (css[i] === '}' && --profondeur === 0) return css.slice(ouverture + 1, i)
  }
  throw new Error('bloc CSS non refermé')
}

function regle(css: string, selecteur: string): string {
  const debut = css.search(new RegExp(`^${selecteur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'm'))
  if (debut < 0) throw new Error(`règle ${selecteur} introuvable`)
  return bloc(css, debut)
}

// Le texte d'un élément `<div …>` depuis sa balise ouvrante jusqu'à la fermante qui lui répond. Les `<div …>` ouvrants
// et les `</div>` se comptent ; un `<div … />` ne compte pas, et la fin d'une balise est son premier `>` hors d'une
// expression entre accolades — un `=>` d'attribut n'en est pas un.
function elementDepuis(texte: string, debut: number): string {
  let profondeur = 0
  let i = debut
  while (i < texte.length) {
    if (texte.startsWith('</div>', i)) {
      i += 6
      if (--profondeur === 0) return texte.slice(debut, i)
      continue
    }
    if (texte.startsWith('<div', i) && /[\s>]/.test(texte[i + 4] ?? '')) {
      let j = i + 4
      let accolades = 0
      for (; j < texte.length; j++) {
        if (texte[j] === '{') accolades++
        else if (texte[j] === '}') accolades--
        else if (texte[j] === '>' && accolades === 0) break
      }
      if (texte[j - 1] !== '/') profondeur++
      i = j + 1
      continue
    }
    i++
  }
  throw new Error('balise fermante introuvable')
}

// Les composants qui posent une fenêtre fixe : ceux dont le fichier porte `position: 'fixed'` (une fenêtre superposée
// de l'application) — le nom du fichier est celui du composant.
function composantsFixes(tous: { chemin: string; texte: string }[]): string[] {
  return tous.filter(({ texte }) => /position:\s*'fixed'/.test(texte)).map(({ chemin }) => basename(chemin, '.tsx'))
}

// Dans le texte d'une grille : une fenêtre fixe posée en place, ou un composant qui en pose une.
function fenetresDans(element: string, fixes: string[]): string[] {
  const trouvees = fixes.filter((nom) => new RegExp(`<${nom}\\b`).test(element))
  if (/position:\s*'fixed'/.test(element)) trouvees.push("position: 'fixed'")
  return trouvees
}

describe('la grille des tableaux de bord suit sa place', () => {
  it('la grille est son propre conteneur, et sous 760 pixels se range comme sur téléphone', () => {
    expect(regle(CSS, '.bento')).toContain('container: bento / inline-size')
    const debut = CSS.indexOf('@container bento (max-width: 760px)')
    expect(debut).toBeGreaterThan(-1)
    const corps = bloc(CSS, debut)
    expect(corps).toContain('.bento > * { grid-column: span 12; }')
    expect(corps).toContain('.bento > .kpi, .bento > .span-3 { grid-column: span 6; }')
  })

  it('une tuile remplit sa case, et sa valeur suit la largeur de la tuile', () => {
    const kpi = regle(CSS, '.kpi')
    expect(kpi).toContain('width: 100%')
    expect(kpi).toContain('container: tuile / inline-size')
    expect(regle(CSS, '.kpi-valeur')).toMatch(/font-size: clamp\([^)]*cqi[^)]*\)/)
  })

  it('une carte étroite range le bouton d’une ligne de check sous son libellé', () => {
    expect(regle(CSS, '.widget')).toContain('container: carte / inline-size')
    const debut = CSS.indexOf('@container carte (max-width: 440px)')
    expect(debut).toBeGreaterThan(-1)
    expect(bloc(CSS, debut)).toContain('.check-ligne { flex-wrap: wrap; }')
  })
})

describe('aucune fenêtre superposée dans une grille ni dans une carte', () => {
  const tous = sources(RACINE)
  const fixes = composantsFixes(tous)
  const grilles = tous.flatMap(({ chemin, texte }) =>
    [...texte.matchAll(/<div className="bento"/g)].map((m) => ({ chemin, element: elementDepuis(texte, m.index) })))

  it('les grilles des écrans ne portent aucune fenêtre fixe', () => {
    const fautes = grilles.flatMap(({ chemin, element }) => fenetresDans(element, fixes).map((f) => `${chemin} : ${f}`))
    expect(fautes).toEqual([])
  })

  it('les tuiles et les cartes non plus', () => {
    const widgets = tous.filter(({ chemin }) => chemin.startsWith('components/widgets/'))
    expect(widgets.length).toBeGreaterThanOrEqual(5)
    expect(widgets.flatMap(({ chemin, texte }) => fenetresDans(texte, fixes).map((f) => `${chemin} : ${f}`))).toEqual([])
  })

  // Sans ces bornes, « aucune fenêtre trouvée » serait aussi ce que rendrait un balayage devenu aveugle.
  it('le balayage voit les grilles et les fenêtres', () => {
    expect(grilles.length).toBeGreaterThanOrEqual(7)
    expect(fixes).toEqual(expect.arrayContaining(['ConfirmationSuppression', 'EnvoyerEmailModal', 'FactureFormModal']))
    const essai = `<div className="bento">\n  <div className="span-3" title={n > 1 ? 'a' : 'b'} />\n  <Widget onClick={() => ouvrir()}>\n    <div>\n      <EnvoyerEmailModal />\n    </div>\n  </Widget>\n</div>\n<ConfirmationSuppression />`
    const element = elementDepuis(essai, 0)
    expect(element.endsWith('</Widget>\n</div>')).toBe(true)
    expect(fenetresDans(element, fixes)).toEqual(['EnvoyerEmailModal'])
  })
})
