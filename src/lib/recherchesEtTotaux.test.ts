import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// UNE RECHERCHE FILTRE L'AFFICHAGE, JAMAIS UN TOTAL — ET C'EST UN TEST QUI LE DIT.
//
// La règle est née d'un défaut réel sur la Balance des comptes : ses totaux débit/crédit portaient
// sur les lignes retenues par la recherche, si bien que taper « 606 » allumait le badge rouge
// « écart … », celui qui signale normalement un brouillon cassé. Une recherche ne doit jamais
// fabriquer une alerte.
//
// Elle a ensuite été écrite dans CLAUDE.md et confiée à la vigilance — exactement ce que ce dépôt a
// appris à ne pas faire (la lecture paginée, trois versions successives d'un scanner faux). Elle a
// donc été violée une seconde fois, sur la LISTE DES DOSSIERS, et dans le sens le plus dangereux :
// `nbAvecAlerte` calculé sur l'ensemble d'après-recherche alimentait la tuile « À jour » sous la
// forme `dossiers.length - nbAvecAlerte`, c'est-à-dire un MÉLANGE des deux ensembles. Plus la
// recherche restreignait, plus ce chiffre montait. Une recherche sans résultat affichait « tous les
// dossiers à jour ».
//
// Ce qui l'avait rendu invisible : « À régler » et « À jour » totalisaient toujours « Dossiers
// suivis ». Les deux tuiles restaient cohérentes ENTRE ELLES tout en étant fausses toutes les deux —
// et personne ne va vérifier une bonne nouvelle.
//
// POURQUOI LE SCANNER NE PART PAS DE `BarreRecherche`. Première version envisagée : lire
// `affiches={X.length}`, l'écran DÉCLARANT ainsi son ensemble d'après-recherche. Simple, exact, et
// elle aurait manqué le seul défaut réel du dépôt — la liste des dossiers porte un `<input>` à elle
// et pas le composant partagé. Un scanner qui rate la prise qui l'a fait naître est la panne que ce
// dépôt connaît déjà par cœur. Il part donc de `correspondALaRecherche(` lui-même, qu'aucun écran de
// recherche ne peut contourner.
function sources(racine: string): string[] {
  return readdirSync(racine).flatMap((nom) => {
    const chemin = join(racine, nom)
    if (statSync(chemin).isDirectory()) return sources(chemin)
    if (!/\.tsx?$/.test(nom) || nom.includes('.test.')) return []
    return [chemin]
  })
}

function sansCommentaires(texte: string): string {
  return texte.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
}

export type LectureRecherche = { ensembles: string[]; nonReconnues: string[] }

// Les littéraux de chaîne sont retirés avant tout comptage de parenthèses : un « ) » dans un message
// d'erreur fausserait sinon l'appariement. Le gabarit interdit le saut de ligne, donc une apostrophe
// française isolée (« l'écran ») ne peut pas se mettre à consommer la suite du fichier.
function sansLitteraux(texte: string): string {
  return texte
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/\/\/[^\n]*/g, '')
}

// La déclaration de la ligne `j` enferme-t-elle l'appel de la ligne `i` ? On compte les parenthèses
// depuis le `(` du `.filter(` JUSQU'AU POINT où `correspondALaRecherche` apparaît : un solde encore
// positif signifie que l'appel n'est pas refermé, donc que la recherche est bien dans SON corps.
//
// C'est ce comptage, et non une borne de distance, qui empêche de lier un ensemble déclaré ailleurs.
// Une borne arbitraire est précisément ce qui a rendu faux trois versions successives du scanner de
// lectures paginées ; et un `const` local DANS le corps du filtre (ClientUpload en porte un) suffit
// à mettre en défaut la version naïve qui remonte au `const` le plus proche.
function enfermeLAppel(lignes: string[], j: number, i: number): boolean {
  const depart = lignes[j].search(/\.filter\s*\(/)
  const arrivee = lignes[i].search(/correspondALaRecherche\s*\(/)
  const morceaux = j === i
    ? [lignes[i].slice(depart, arrivee)]
    : [lignes[j].slice(depart), ...lignes.slice(j + 1, i), lignes[i].slice(0, arrivee)]
  let solde = 0
  for (const caractere of sansLitteraux(morceaux.join('\n'))) {
    if (caractere === '(') solde++
    else if (caractere === ')') solde--
  }
  return solde > 0
}

// L'ensemble d'APRÈS-recherche est celui du `.filter(` qui ENFERME chaque `correspondALaRecherche(`.
//
// LA FORME NON RECONNUE EST UNE FAUTE, PAS UN PASSE-DROIT. Si aucun `.filter(` n'enferme l'appel —
// par exemple un prédicat nommé passé plus loin à `.filter` — le scanner ne sait pas lire cet écran
// et le DIT. Rendre zéro serait la panne qui ressemble exactement au succès.
export function lireRecherches(texte: string): LectureRecherche {
  const lignes = sansCommentaires(texte).split('\n')
  const ensembles: string[] = []
  const nonReconnues: string[] = []

  lignes.forEach((ligne, i) => {
    if (!/correspondALaRecherche\s*\(/.test(ligne)) return
    // La DÉFINITION de la fonction n'est pas un usage — sans quoi lib/recherche.ts se signalerait.
    if (/function\s+correspondALaRecherche/.test(ligne)) return

    for (let j = i; j >= 0; j--) {
      const declaration = lignes[j].match(/^\s*const\s+(\w+)\s*=/)
      if (!declaration || !/\.filter\s*\(/.test(lignes[j])) continue
      if (!enfermeLAppel(lignes, j, i)) continue
      ensembles.push(declaration[1])
      return
    }
    nonReconnues.push(ligne.trim())
  })

  return { ensembles: [...new Set(ensembles)], nonReconnues }
}

// Les trois formes interdites, énumérées plutôt que devinées. Ce qui reste LÉGITIME sur cet ensemble
// et ne doit surtout pas être signalé : `X.map(…)` (le rendu des lignes), `X.length === 0` (l'état
// vide), `[...X].sort(…)` (le tri d'affichage) et `affiches={X.length}` — qui est précisément le N du
// compteur « N sur M » et doit suivre la recherche.
function interdits(nom: string): { motif: string; gabarit: RegExp }[] {
  return [
    {
      motif: 'un total calculé sur les lignes retenues par la recherche',
      gabarit: new RegExp(`\\b${nom}\\s*\\.\\s*reduce\\s*\\(`),
    },
    {
      motif: 'un sous-compte calculé sur les lignes retenues par la recherche',
      gabarit: new RegExp(`\\b${nom}\\s*\\.\\s*filter\\s*\\([^()]*(?:\\([^()]*\\)[^()]*)*\\)\\s*\\.\\s*length`),
    },
    {
      motif: 'le M du compteur « N sur M » suit la recherche, donc annonce toujours « N sur N »',
      gabarit: new RegExp(`total=\\{\\s*${nom}\\s*\\.\\s*length\\s*\\}`),
    },
  ]
}

export function fautes(texte: string): string[] {
  const { ensembles } = lireRecherches(texte)
  const corps = sansCommentaires(texte)
  return ensembles.flatMap((nom) =>
    interdits(nom).filter(({ gabarit }) => gabarit.test(corps)).map(({ motif }) => `${nom} : ${motif}`),
  )
}

describe('une recherche filtre l’affichage, jamais un total', () => {
  it('aucun écran ne calcule un chiffre sur les lignes que la recherche a retenues', () => {
    const enFaute = sources('src').flatMap((f) =>
      fautes(readFileSync(f, 'utf8')).map((faute) => `${f} :: ${faute}`),
    )
    expect(enFaute).toEqual([])
  })

  it('et aucun écran de recherche n’échappe à la lecture du scanner', () => {
    // Le pendant du contrôle ci-dessus : il ne peut rendre zéro faute que s'il a su LIRE tous les
    // écrans. Une forme qu'il ne sait pas lire le fait échouer ici, plutôt que passer là-haut.
    const illisibles = sources('src').flatMap((f) =>
      lireRecherches(readFileSync(f, 'utf8')).nonReconnues.map((l) => `${f} :: ${l}`),
    )
    expect(illisibles).toEqual([])
  })

  it('et le scanner voit encore quelque chose — défaut PLANTÉ, pas simple présence', () => {
    // « Le contrôle rend zéro » et « le contrôle est aveugle » se ressemblent trop. On lui donne donc
    // une source SYNTHÉTIQUE portant les trois formes à attraper, dont celle de la liste des dossiers
    // (`X.filter(…).length`), qu'aucune relecture n'avait vue.
    const synthetique = [
      '  const affichees = lignes.filter((l) =>',
      '    correspondALaRecherche([l.libelle, l.montant], recherche),',
      '  )',
      '  const total = affichees.reduce((s, l) => s + l.montant, 0)',
      '  const nbAvecAlerte = affichees.filter(alerte).length',
      '  return <BarreRecherche affiches={affichees.length} total={affichees.length} />',
    ].join('\n')
    expect(fautes(synthetique)).toHaveLength(3)
  })

  it('et il laisse passer les usages légitimes du même ensemble', () => {
    // Un scanner qui crie au loup partout finit désactivé, et le dépôt perd la règle avec lui. Ces
    // cinq formes sont correctes : le total porte sur l'ensemble d'AVANT, le N du compteur sur celui
    // d'après, et le reste n'est que de l'affichage.
    const correct = [
      '  const affichees = lignes.filter((l) =>',
      '    correspondALaRecherche([l.libelle], recherche),',
      '  )',
      '  const total = lignes.reduce((s, l) => s + l.montant, 0)',
      '  const nbAvecAlerte = lignes.filter(alerte).length',
      '  const trie = [...affichees].sort((a, b) => a.date.localeCompare(b.date))',
      '  return <BarreRecherche affiches={affichees.length} total={lignes.length} />',
    ].join('\n')
    expect(fautes(correct)).toEqual([])
  })

  it('et une forme qu’il ne sait pas lire est signalée, jamais ignorée', () => {
    // Un prédicat nommé passé plus loin à `.filter` : le scanner ne peut pas relier l'ensemble, donc
    // il le DIT. C'est la seule façon d'empêcher un « zéro faute » obtenu par cécité.
    //
    // LE FILTRE SANS RAPPORT AU-DESSUS EST LE CŒUR DU CAS, pas un décor. Sans lui la mutation qui
    // retire le comptage de parenthèses SURVIT — vérifié, pas supposé : le scanner remonterait alors
    // jusqu'à ce `.filter` étranger et lierait `lignesAnnee` EN SILENCE, ce qui est bien pire que de
    // ne rien lire. C'est la forme exacte qui l'aveugle, comme la lecture nue coincée entre deux
    // lectures paginées l'est pour son voisin.
    const inconnue = [
      '  const lignesAnnee = lignes.filter((l) => anneeDe(l.date) === annee)',
      '  const estTrouve = (l) => correspondALaRecherche([l.libelle], recherche)',
    ].join('\n')
    expect(lireRecherches(inconnue).ensembles).toEqual([])
    expect(lireRecherches(inconnue).nonReconnues).toHaveLength(1)
  })
})
