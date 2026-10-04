import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// UN TABLEAU QUI SE REPLIE VIT DANS SON ENVELOPPE ADAPTABLE (04/10/2026).
//
// Une ligne d'un `table-empilable` se replie, dans une carte étroite, en fiche empilée — chaque cellule précédée
// de son libellé — au lieu de se comprimer jusqu'à l'illisible : les champs d'un tableau qu'on REMPLIT
// (`table-formulaire`), ou les phrases d'un tableau qu'on lit (les écarts de la concordance de la 2035). Ce repli
// suit la largeur de l'enveloppe `.tableau-adaptable` — une requête de CONTENEUR (index.css), et non la largeur
// de la fenêtre : la carte Véhicules écrasait ses champs à 1 024 pixels, et volet ouvert à 1 280, alors que le
// repli n'existait que sur téléphone.
//
// LES PIÈGES QUE CE TEST FERME : une requête de conteneur ne s'applique qu'aux descendants d'un conteneur. Un
// `table-empilable` posé hors de l'enveloppe ne se replierait plus NULLE PART, téléphone compris — et rien ne
// le dirait, le tableau restant juste écrasé. Et un `table-formulaire` sans `table-empilable` garderait ses
// règles de champs sans jamais se replier. Il exige donc que chaque tableau qui se replie soit dans une
// enveloppe, que tout tableau-formulaire se replie, et que la feuille de style déclare le conteneur que la
// requête nomme.

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

// Chaque `table-empilable` et la `div` qui l'enveloppe au plus près : la dernière ouverte avant lui.
function tableauxHorsEnveloppe(texte: string): number[] {
  const fautes: number[] = []
  for (const m of texte.matchAll(/<table className="([^"]*\btable-empilable\b[^"]*)"/g)) {
    const avant = texte.slice(0, m.index)
    const divs = [...avant.matchAll(/<div className="([^"]*)"/g)]
    const enveloppe = divs.at(-1)?.[1] ?? ''
    if (!enveloppe.split(/\s+/).includes('tableau-adaptable')) fautes.push(avant.split('\n').length)
  }
  return fautes
}

// Chaque `table-formulaire` qui ne se replie pas : ses champs garderaient leurs règles sans jamais s'empiler.
function formulairesQuiNeSeReplientPas(texte: string): number[] {
  const fautes: number[] = []
  for (const m of texte.matchAll(/<table className="([^"]*\btable-formulaire\b[^"]*)"/g)) {
    if (!m[1].split(/\s+/).includes('table-empilable')) fautes.push(texte.slice(0, m.index).split('\n').length)
  }
  return fautes
}

describe('les tableaux qui se replient en fiches', () => {
  const tous = sources(RACINE)

  it('vivent chacun dans une enveloppe `tableau-adaptable`', () => {
    const fautes = tous.flatMap(({ chemin, texte }) => tableauxHorsEnveloppe(texte).map((ligne) => `${chemin}:${ligne}`))
    expect(fautes).toEqual([])
    // Le plancher : sans lui, un balayage devenu aveugle passerait la règle à vide. Deux tableaux-formulaires
    // (Véhicules, candidates à l'immobilisation) et les écarts de la concordance de la 2035.
    const nombre = tous.reduce((n, { texte }) => n + [...texte.matchAll(/className="[^"]*\btable-empilable\b/g)].length, 0)
    expect(nombre).toBeGreaterThanOrEqual(3)
  })

  it('comptent tous les tableaux-formulaires', () => {
    const fautes = tous.flatMap(({ chemin, texte }) => formulairesQuiNeSeReplientPas(texte).map((ligne) => `${chemin}:${ligne}`))
    expect(fautes).toEqual([])
    const nombre = tous.reduce((n, { texte }) => n + [...texte.matchAll(/className="[^"]*\btable-formulaire\b/g)].length, 0)
    expect(nombre).toBeGreaterThanOrEqual(2)
  })

  it('se replient sur la largeur du conteneur que la feuille de style déclare', () => {
    const css = readFileSync(join(RACINE, 'index.css'), 'utf8')
    expect(css).toMatch(/\.tableau-adaptable \{ container-type: inline-size; container-name: tableau; \}/)
    const bloc = /@container tableau \(max-width: \d+px\) \{([\s\S]*?)\n\}/.exec(css)
    expect(bloc, 'requête de conteneur `tableau` introuvable').not.toBeNull()
    expect(bloc![1]).toContain('.table-empilable thead { display: none; }')
    expect(bloc![1]).toMatch(/\.table-empilable td::before \{\s*content: attr\(data-libelle\);/)
  })

  it('attrapent un tableau posé hors de l’enveloppe, et pas celui qui y est', () => {
    const fautif = '<div className="card">\n  <div className="table-scroll">\n    <table className="table-empilable">'
    const juste = '<div className="card">\n  <div className="table-scroll tableau-adaptable">\n    {/* un commentaire */}\n    <table className="table-formulaire table-empilable">'
    expect(tableauxHorsEnveloppe(fautif)).toEqual([3])
    expect(tableauxHorsEnveloppe(juste)).toEqual([])
  })

  it('attrapent un tableau-formulaire qui ne se replie pas, et pas celui qui se replie', () => {
    expect(formulairesQuiNeSeReplientPas('<div>\n<table className="table-formulaire">')).toEqual([2])
    expect(formulairesQuiNeSeReplientPas('<table className="table-formulaire table-empilable">')).toEqual([])
    expect(formulairesQuiNeSeReplientPas('<table className="table-empilable">')).toEqual([])
  })
})
