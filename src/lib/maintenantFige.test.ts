import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// UNE VALEUR TIRÉE DE « MAINTENANT » AU NIVEAU D'UN MODULE EST FIGÉE POUR TOUTE LA SESSION.
//
// Un module ne s'évalue qu'une fois, et cette application est une SPA en `HashRouter` : elle ne
// recharge JAMAIS la page. Un onglet de cabinet laissé ouvert — le cas normal, c'est l'outil du
// quotidien — garde donc l'année et le compte de mois du jour où il a été ouvert.
//
// Ce qui rend le motif coûteux n'est pas la péremption mais l'APPARIEMENT : `ClientHome` figeait son
// année au chargement du module et recalculait ses mois écoulés à chaque rendu. Au passage d'une
// année, il affichait « Relevés bancaires 2026 » avec RIEN à envoyer, alors que les douze mois de 2026
// sont dus — une bonne nouvelle fabriquée, étiquetée d'une année précise, sur l'écran dont le métier
// est de dire ce qui manque. Et il contredisait `ClientUpload`, alors que CLAUDE.md pose que ces trois
// écrans doivent toujours dire la même chose au même moment.
//
// Le scanner part de TOUTE source de production, comme `rls.sql` part de `pg_class` : un écran ajouté
// demain est attrapé sans que personne ait à y penser. Il n'admet que des exceptions écrites, portant
// **la raison pour laquelle figer cette valeur est sans conséquence** — et la seule raison admise à ce
// jour est la même pour les deux : la valeur est utilisée de façon COHÉRENTE dans tout l'écran (jamais
// appariée à une lecture d'horloge vivante) ET l'année est ÉTIQUETÉE à l'écran, si bien qu'un onglet
// périmé affiche « Projection 2026 » — périmé, mais pas faux.

const RACINES = ['src']
const EXTENSIONS = ['.ts', '.tsx']

// Chaque exception porte sa raison. Le COMPTE fait foi : une de plus est une rechute, une de moins est
// une raison morte (voir `datesUtc.test.ts`, où dispenser un fichier entier avait failli masquer le
// défaut d'à côté).
const EXCEPTIONS: { fichier: string; nom: string; raison: string }[] = [
  {
    fichier: 'src/pages/ClientSimulation.tsx',
    nom: 'ANNEE_COURANTE',
    raison:
      "Utilisée partout dans l'écran (projection, référence N-1, libellés) et ÉTIQUETÉE — « Projection 2026 ». "
      + "Jamais appariée à une lecture d'horloge vivante, donc un onglet périmé est périmé, pas faux.",
  },
  {
    fichier: 'src/pages/dossier/EstimationTab.tsx',
    nom: 'ANNEE_COURANTE',
    raison:
      "Même cas : elle amorce des `useState` (valeur initiale, pas une lecture répétée), sert de "
      + "référence N-1 et s'affiche en toutes lettres. Cohérente avec elle-même dans tout l'écran.",
  },
]

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) {
      out.push(...sources(chemin))
      continue
    }
    if (!EXTENSIONS.some((e) => entree.endsWith(e))) continue
    if (entree.includes('.test.')) continue
    out.push(chemin)
  }
  return out
}

// Une déclaration de niveau module se reconnaît à son absence d'indentation : dans ce dépôt tout ce
// qui vit dans une fonction ou un composant est indenté. On ne coupe QUE les lignes entièrement en
// commentaire, jamais un commentaire de fin de ligne — le code fautif serait de toute façon avant le
// `//`, et couper là risquerait d'avaler une chaîne contenant `//`, c'est-à-dire de rendre le scanner
// aveugle sur cette ligne (le seul sens dangereux). Voir `retraitsStockage.test.ts`.
const DECLARATION_MODULE = /^(?:export\s+)?const\s+(\w+)\s*=\s*(.*)$/
const LECTURE_HORLOGE = /new Date\(\s*\)|anneeEtMoisEcoules\(\)|aujourdHuiSql\(\)|premierJourDuMoisCourant\(\)/

export function constantesFigees(fichiers: { chemin: string; texte: string }[]) {
  const trouvees: { fichier: string; nom: string }[] = []
  for (const { chemin, texte } of fichiers) {
    for (const ligne of texte.split('\n')) {
      if (ligne.trimStart().startsWith('//')) continue
      const m = DECLARATION_MODULE.exec(ligne)
      if (m && LECTURE_HORLOGE.test(m[2])) trouvees.push({ fichier: chemin, nom: m[1] })
    }
  }
  return trouvees
}

function fichiersDeProduction() {
  return RACINES.flatMap(sources).map((chemin) => ({ chemin, texte: readFileSync(chemin, 'utf-8') }))
}

describe('aucune valeur de « maintenant » figée au chargement d’un module', () => {
  it('ne trouve que les exceptions écrites', () => {
    const trouvees = constantesFigees(fichiersDeProduction())
    const fautives = trouvees.filter(
      (t) => !EXCEPTIONS.some((e) => e.fichier === t.fichier && e.nom === t.nom),
    )
    expect(
      fautives,
      "Une valeur tirée de « maintenant » au niveau d'un module est figée pour toute la session "
        + "(HashRouter ne recharge jamais). La lire à chaque rendu, ou l'inscrire dans EXCEPTIONS avec "
        + 'la raison pour laquelle la figer est sans conséquence.',
    ).toEqual([])
  })

  it('le compte des exceptions fait foi', () => {
    // Une de plus est une rechute, une de moins est une raison morte qui encombre la liste.
    const trouvees = constantesFigees(fichiersDeProduction())
    expect(trouvees).toHaveLength(EXCEPTIONS.length)
    for (const e of EXCEPTIONS) {
      expect(
        trouvees.some((t) => t.fichier === e.fichier && t.nom === e.nom),
        `Exception inscrite mais introuvable dans le code : ${e.fichier} / ${e.nom}`,
      ).toBe(true)
      expect(e.raison.length, "Une exception sans raison n'en est pas une").toBeGreaterThan(40)
    }
  })

  it('LE SCANNER VOIT UN DÉFAUT PLANTÉ', () => {
    // « Zéro faute » et « aveugle » se ressemblent trop — c'est la panne que ce dépôt connaît sous
    // plusieurs noms. Un défaut planté dans une source synthétique les sépare.
    const synthetique = [
      {
        chemin: 'src/pages/Faux.tsx',
        texte: [
          "const NOMS = ['a', 'b']",
          'const ANNEE_FIGEE = new Date().getFullYear()',
          'export const PAIRE_FIGEE = anneeEtMoisEcoules()',
          'function Ecran() {',
          '  const { annee } = anneeEtMoisEcoules()',
          '  return annee',
          '}',
        ].join('\n'),
      },
    ]
    const trouvees = constantesFigees(synthetique)
    expect(trouvees.map((t) => t.nom)).toEqual(['ANNEE_FIGEE', 'PAIRE_FIGEE'])
  })

  it('NE CRIE PAS AU LOUP sur ce qui est légitime', () => {
    // Le risque symétrique : un scanner qui attrape tout ne se lit plus. Une lecture DANS un composant
    // est indentée ; une constante sans horloge n'a rien à voir ; une ligne entièrement en commentaire
    // qui CITE la forme fautive doit être ignorée, comme `stockage.ts` cite `.catch(() => {})`.
    const synthetique = [
      {
        chemin: 'src/pages/Sain.tsx',
        texte: [
          '// const ANNEE = new Date().getFullYear() — exactement ce qu’il ne faut pas faire',
          "const LABELS = { a: 'A' }",
          'function Ecran() {',
          '  const { annee, moisEcoules } = anneeEtMoisEcoules()',
          '  const debut = aujourdHuiSql()',
          '  return annee + moisEcoules + debut.length',
          '}',
        ].join('\n'),
      },
    ]
    expect(constantesFigees(synthetique)).toEqual([])
  })
})
