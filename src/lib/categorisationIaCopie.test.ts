import { existsSync, readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as original from './categorisationIa'

// LE BLOC DE `categorisationIa.ts` EST RECOPIÉ DANS LES EDGE FUNCTIONS QUI EN ONT BESOIN — elles
// sont auto-portées, aucune n'importe `src/`. Ce garde-fou pose trois questions, et aucune ne suffit
// seule :
//
//   1. La copie est-elle AU CARACTÈRE PRÈS celle du module ? Plus strict que le garde de
//      `extractionChamps`, qui tolère un reformatage : ici le bloc est du TypeScript des deux côtés,
//      donc rien ne justifie qu'il diffère d'un octet. Une copie qui dérive, et la mesure qui a
//      autorisé la fonctionnalité n'aurait pas mesuré ce qu'elle exécute.
//   2. Le bloc se suffit-il à lui-même ? Deux copies identiques peuvent dépendre toutes deux d'un nom
//      défini HORS du bloc — présent dans `src/lib`, absent de l'Edge Function, qui casserait alors au
//      premier appel. On l'EXÉCUTE donc seul, transpilé par le compilateur du projet.
//   3. La fonction s'en SERT-elle ? Un bloc parfait que le gestionnaire n'appelle plus est un garde
//      qui garde du code mort.

const DEBUT = '// ── DÉBUT COPIE categorisationIa'
const FIN = '// ── FIN COPIE categorisationIa'

const DOSSIER = new URL('../../supabase/functions/', import.meta.url)

function sourceDe(fonction: string): string {
  return readFileSync(new URL(`${fonction}/index.ts`, DOSSIER), 'utf8')
}

// LES COPIES SE TROUVENT, ELLES NE SE DÉCLARENT PAS (26/09/2026). La première version de ce garde
// nommait `evaluer-extraction` et elle seule : `proposer-categorie`, la seconde copie, serait arrivée
// sans lui, et le garde serait resté vert sur une copie qu'il ne regardait pas. Une fonction est une
// copie dès qu'elle porte les bornes OU qu'elle nomme l'une des pièces du contrat — une copie écrite à
// côté, sans ses bornes, tombe alors sur « bornes introuvables » au lieu de passer inaperçue.
const PIECES_DU_CONTRAT = /── DÉBUT COPIE categorisationIa|\b(?:verifierProposition|questionCategorisation|promptCategorisation|REGLAGES_MODELE)\b/

const FONCTIONS = readdirSync(DOSSIER, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/index.ts`, DOSSIER)))
  .map((d) => d.name)
  .filter((nom) => PIECES_DU_CONTRAT.test(sourceDe(nom)))
  .sort()
const SOURCE_LIB = readFileSync(new URL('./categorisationIa.ts', import.meta.url), 'utf8')

function blocDe(source: string, ou: string): string {
  const debut = source.indexOf(DEBUT)
  const fin = source.indexOf(FIN)
  expect(debut, `bornes de la copie introuvables dans ${ou} — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return source.slice(debut, source.indexOf('\n', fin) + 1)
}

/** Le bloc SEUL, transpilé et exécuté : tout nom qu'il emprunterait au reste du fichier lèverait. */
function executer(bloc: string): typeof original {
  const js = ts.transpileModule(bloc, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports: Record<string, unknown> = {}
  new Function('exports', js)(exports)
  return exports as unknown as typeof original
}

const CATEGORIES: original.CategoriePourIa[] = [
  { code: 'honoraires', libelle: 'Honoraires', poste_2035: 'Honoraires ne constituant pas des rétrocessions', compte_comptable: '622600' },
  { code: 'ventes_prestations', libelle: 'Ventes / prestations', poste_2035: 'Recettes', compte_comptable: '706000' },
  { code: 'divers_cabinet', libelle: 'Divers du cabinet', poste_2035: null, compte_comptable: null },
]
const CODES = CATEGORIES.map((c) => c.code)
const TEXTE = 'CABINET VERDIER\nConsultation du 3 mars\nHonoraires : 80,00 €\nPéage A7'

// Chaque issue possible y figure au moins une fois — voir le dernier test du fichier.
const REPONSES: (string | null | undefined)[] = [
  JSON.stringify({ categorie: 'honoraires', indice: 'Consultation' }),
  JSON.stringify({ categorie: 'Honoraires', indice: 'péage a7' }),
  JSON.stringify({ categorie: null, indice: null }),
  JSON.stringify({ categorie: 'informatique', indice: 'Consultation' }),
  JSON.stringify({ categorie: 'honoraires', indice: '80,00 €' }),
  JSON.stringify({ categorie: 'honoraires', indice: 'PEAGE A7' }),
  'Voici :\n```json\n{"categorie": "divers_cabinet", "indice": "CABINET VERDIER"}\n```',
  '{ categorie: honoraires }',
  undefined,
]

for (const fonction of FONCTIONS) describe(`${fonction} — copie de categorisationIa`, () => {
  const bloc = blocDe(sourceDe(fonction), fonction)

  it('porte le bloc de src/lib AU CARACTÈRE PRÈS', () => {
    expect(bloc).toBe(blocDe(SOURCE_LIB, 'src/lib/categorisationIa.ts'))
  })

  it('le bloc se suffit à lui-même : exécuté SEUL, il rend exactement ce que rend le module', () => {
    const copie = executer(bloc)
    for (const sens of ['dépense', 'recette', null] as const) {
      expect(copie.questionCategorisation(CATEGORIES, sens)).toEqual(original.questionCategorisation(CATEGORIES, sens))
    }
    for (const type of ['achat', 'vente', 'note_frais', 'autre', null]) {
      expect(copie.sensDePiece(type)).toBe(original.sensDePiece(type))
    }
    for (const brut of REPONSES) {
      expect(copie.verifierProposition(brut, CODES, TEXTE), `divergence sur ${JSON.stringify(brut)}`)
        .toEqual(original.verifierProposition(brut, CODES, TEXTE))
    }
    for (const c of CATEGORIES) expect(copie.natureCategorie(c)).toBe(original.natureCategorie(c))
  })

  it('la fonction s’en SERT, hors du bloc — sinon ce garde garderait du code mort', () => {
    const horsBloc = sourceDe(fonction).replace(bloc, '')
    expect(horsBloc).toMatch(/questionCategorisation\(/)
    expect(horsBloc).toMatch(/sensDePiece\(/)
    expect(horsBloc).toMatch(/verifierProposition\(/)
    // Les réglages de l'appel viennent du bloc, pas d'une valeur retapée à côté.
    expect(horsBloc).toMatch(/\.\.\.REGLAGES_MODELE/)
    // Et le texte suit la question sous le même séparateur : une question assemblée autrement n'est
    // plus celle qui a été mesurée, et aucun test de comportement ne le verrait.
    expect(horsBloc).toMatch(/content:\s*`\$\{prompt\}\\n\\n--- TEXTE ---\\n\$\{/)
  })
})

describe('les copies du contrat', () => {
  it('sont toutes vues — sinon « aucune divergence » et « aveugle » se confondent', () => {
    // Le PLANCHER : une copie de plus est vue sans qu'on l'ajoute ici.
    expect(FONCTIONS).toEqual(expect.arrayContaining(['evaluer-extraction', 'proposer-categorie']))
  })
})

// Le modèle que la mesure du 25/09/2026 a jugé (42 textes du dossier `test`, voir CLAUDE.md). ÉCRIT
// ICI, et pas lu dans le harnais : le défaut du harnais suit aussi le modèle de la CITATION des champs,
// et une nouvelle mesure de l'extraction ne doit pas faire changer de modèle à la catégorisation sans
// qu'elle soit mesurée à son tour. Le changer demande de changer cette ligne, sciemment.
const MODELE_MESURE = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0'

describe('proposer-categorie — le modèle qui propose est celui qui a été mesuré', () => {
  it('appelle le modèle mesuré, et c’est bien lui qui part à l’appel', () => {
    const source = sourceDe('proposer-categorie')
    expect(source.match(/const MODELE_CATEGORIE = "([^"]+)"/)?.[1]).toBe(MODELE_MESURE)
    expect(source).toMatch(/model:\s*MODELE_CATEGORIE,/)
    expect(source.match(/model:/g)).toHaveLength(1)
  })

  it('le harnais, appelé sans argument, mesure ce modèle-là — sinon la prochaine mesure ne dirait rien de la production', () => {
    const defaut = sourceDe('evaluer-extraction').match(/const MODELE_PAR_DEFAUT = "([^"]+)"/)?.[1]
    expect(defaut, 'MODELE_PAR_DEFAUT introuvable dans evaluer-extraction — garde-fou à remettre à jour').toBe(MODELE_MESURE)
  })
})

describe('evaluer-extraction — la fenêtre d’ouverture de l’essai', () => {
  const source = sourceDe('evaluer-extraction')
  const fenetre = source.match(/const ESSAI_OUVERT_JUSQU_A = "([^"]+)"/)?.[1]

  it('porte une date lisible, en UTC', () => {
    expect(fenetre, 'ESSAI_OUVERT_JUSQU_A introuvable — garde-fou à remettre à jour').toBeTruthy()
    expect(fenetre).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Number.isNaN(Date.parse(fenetre!))).toBe(false)
  })

  it('n’est jamais poussée OUVERTE — le dépôt est public', () => {
    // Une fenêtre qu'on aurait repoussée au loin « pour ne plus avoir à redéployer » rouvrirait la
    // porte que cette date referme : n'importe qui, depuis le dépôt public, ferait payer des appels au
    // modèle en boucle. Une mesure se lance, puis la fenêtre se referme AVANT que le code ne parte.
    expect(Date.parse(fenetre!), `la fenêtre ${fenetre} est encore ouverte`).toBeLessThan(Date.now())
  })

  it('est vérifiée AVANT tout appel au modèle', () => {
    const garde = source.indexOf('if (limite > 0 && Date.now() > Date.parse(ESSAI_OUVERT_JUSQU_A))')
    expect(garde, 'la garde de la fenêtre a disparu du gestionnaire').toBeGreaterThan(-1)
    const gestionnaire = source.indexOf('Deno.serve(')
    for (const appel of ['new AnthropicBedrock(', 'mesurerCategorisation(supabase']) {
      const premier = source.indexOf(appel, gestionnaire)
      expect(premier, `${appel} introuvable dans le gestionnaire`).toBeGreaterThan(-1)
      expect(garde, `${appel} précède la garde de la fenêtre`).toBeLessThan(premier)
    }
  })
})

describe('la batterie du garde', () => {
  it('produit chaque issue possible — sinon deux copies « d’accord » ne prouveraient rien', () => {
    const issues = new Set(REPONSES.map((r) => original.verifierProposition(r, CODES, TEXTE).issue))
    expect([...issues].sort()).toEqual([
      'abstention', 'code inconnu', 'indice absent du texte', 'indice manquant', 'retenue', 'réponse illisible',
    ])
  })
})
