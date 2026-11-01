import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as comptes from './comptes'
import { PLAN_PAR_DEFAUT } from './planComptable'

// AUCUN COMPTE DE RÔLE ÉCRIT EN DUR HORS DU CATALOGUE (ligne 43, étape PC3 ; conception, § 5.2). Depuis l'étape PC2, la
// base REFUSE une écriture composée à un autre compte que celui du plan du dossier ; l'application compose donc avec le
// plan qu'elle lit (lib/planComptable.ts), et un numéro de rôle resté en dur écrirait — ou chercherait — au compte par
// défaut dans un dossier qui en tient un autre. Le relevé part de TOUTE la source de l'application (src/, hors tests et
// fabriques de test) et des Edge Functions (supabase/), par l'analyseur de TypeScript : les commentaires n'y comptent pas,
// et un texte coupé par le formatage reste une seule expression. Quatre formes y sont des fautes :
//   - un NUMÉRO : le compte par défaut d'un rôle (l'une des trente-deux valeurs de `PLAN_PAR_DEFAUT`), en six chiffres
//     isolés, dans un texte, un gabarit, du JSX ou une expression régulière — un compte est un TEXTE dans toute
//     l'application (CompteNum), et un nombre de six chiffres y est un montant (120000 € de recettes, un cas de
//     l'Urssaf) ;
//   - une CONSTANTE : l'emploi de l'une des trente-deux constantes de lib/comptes.ts qui portent ces numéros, importée par
//     son nom ou par un espace de noms ;
//   - un ALIAS : l'emploi d'une variable locale qui en tient une (`const BANQUE = '512000'`, `const B = COMPTE_BANQUE`) ;
//   - un DÉFAUT : l'emploi du plan par défaut ou du plan décalé de lib/planComptable.ts, ou du compte par défaut d'un rôle
//     du catalogue (`compteDefaut`) — `PLAN_PAR_DEFAUT.banque` est le 512000 sous un autre nom.
// Un sous-compte du cabinet (616100, une catégorie) n'est pas un compte de rôle : seul le compte par défaut l'est, la
// racine se juge par le PCG (conception, § 2.6). Chaque exception porte sa raison ET son nombre exact : une forme ajoutée
// ou retirée dans un fichier excepté se voit aussi.

interface Source { chemin: string; texte: string }
interface Trouvaille { chemin: string; ligne: number; genre: 'numero' | 'constante' | 'alias' | 'defaut'; texte: string }

const COMPTES_PAR_DEFAUT: ReadonlySet<string> = new Set(Object.values(PLAN_PAR_DEFAUT))
// Les constantes de lib/comptes.ts dont la valeur est le compte par défaut d'un rôle — toutes, lues sur le module.
const CONSTANTES_DE_ROLE: ReadonlySet<string> = new Set(
  Object.entries(comptes).filter(([, valeur]) => typeof valeur === 'string' && COMPTES_PAR_DEFAUT.has(valeur)).map(([nom]) => nom),
)
const NUMERO = /(?<!\d)\d{6}(?!\d)/g
// Un import de lib/comptes.ts, d'où qu'il parte : './comptes', '../../lib/comptes'.
const MODULE_DES_COMPTES = /(^|\/)comptes$/
// Un import de lib/planComptable.ts, et les deux plans qu'il définit pour les tests et pour le défaut.
const MODULE_DU_PLAN = /(^|\/)planComptable$/
const PLANS_FIGES: ReadonlySet<string> = new Set(['PLAN_PAR_DEFAUT', 'PLAN_DECALE'])

function deroule(e: ts.Expression): ts.Expression {
  let x = e
  while (ts.isAsExpression(x) || ts.isSatisfiesExpression(x) || ts.isParenthesizedExpression(x)) x = x.expression
  return x
}

function analyser(sources: readonly Source[]): Trouvaille[] {
  const trouvees: Trouvaille[] = []
  for (const { chemin, texte } of sources) {
    const sf = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const noter = (genre: Trouvaille['genre'], n: ts.Node, t: string) =>
      trouvees.push({ chemin, ligne: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, genre, texte: t })

    // Premier passage : les noms qui portent un compte de rôle — les constantes importées, les espaces de noms du
    // module, et les variables locales qui en tiennent une (dans l'ordre de la source : un alias d'alias se suit).
    const constantes = new Set<string>()
    const espaces = new Set<string>()
    const alias = new Set<string>()
    const plansFiges = new Set<string>()
    const espacesDuPlan = new Set<string>()
    const declarer = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && MODULE_DU_PLAN.test(n.moduleSpecifier.text)) {
        const liaisons = n.importClause?.namedBindings
        if (liaisons && ts.isNamespaceImport(liaisons)) espacesDuPlan.add(liaisons.name.text)
        if (liaisons && ts.isNamedImports(liaisons)) {
          for (const s of liaisons.elements) if (PLANS_FIGES.has((s.propertyName ?? s.name).text)) plansFiges.add(s.name.text)
        }
      }
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && MODULE_DES_COMPTES.test(n.moduleSpecifier.text)) {
        const liaisons = n.importClause?.namedBindings
        if (liaisons && ts.isNamespaceImport(liaisons)) espaces.add(liaisons.name.text)
        if (liaisons && ts.isNamedImports(liaisons)) {
          for (const s of liaisons.elements) if (CONSTANTES_DE_ROLE.has((s.propertyName ?? s.name).text)) constantes.add(s.name.text)
        }
      }
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
        const valeur = deroule(n.initializer)
        const litteral = (ts.isStringLiteral(valeur) || ts.isNoSubstitutionTemplateLiteral(valeur)) && COMPTES_PAR_DEFAUT.has(valeur.text)
        const nomme = ts.isIdentifier(valeur) && (constantes.has(valeur.text) || alias.has(valeur.text))
        const espace = ts.isPropertyAccessExpression(valeur) && ts.isIdentifier(valeur.expression)
          && espaces.has(valeur.expression.text) && CONSTANTES_DE_ROLE.has(valeur.name.text)
        if (litteral || nomme || espace) alias.add(n.name.text)
      }
      ts.forEachChild(n, declarer)
    }
    declarer(sf)

    // Second passage : chaque forme, à sa ligne.
    const visiter = (n: ts.Node): void => {
      let t: string | null = null
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) t = n.text
      else if (ts.isJsxText(n)) t = n.text
      else if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) t = n.getText(sf)
      // Le texte d'un import est un chemin, jamais un compte.
      if (t !== null && !(ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent))) {
        for (const m of t.matchAll(NUMERO)) if (COMPTES_PAR_DEFAUT.has(m[0])) noter('numero', n, m[0])
      }
      if (ts.isIdentifier(n)) {
        const parent = n.parent
        // Ni le nom d'une propriété (`x.COMPTE_BANQUE`, `{ COMPTE_BANQUE: … }`), ni une déclaration, ni l'import lui-même.
        const nomDePropriete = (ts.isPropertyAccessExpression(parent) && parent.name === n)
          || (ts.isPropertyAssignment(parent) && parent.name === n)
        const declaration = (ts.isVariableDeclaration(parent) && parent.name === n) || ts.isImportSpecifier(parent) || ts.isImportClause(parent)
        if (!nomDePropriete && !declaration) {
          if (constantes.has(n.text)) noter('constante', n, n.text)
          else if (alias.has(n.text)) noter('alias', n, n.text)
          else if (plansFiges.has(n.text)) noter('defaut', n, n.text)
        }
      }
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && espacesDuPlan.has(n.expression.text) && PLANS_FIGES.has(n.name.text)) {
        noter('defaut', n, `${n.expression.text}.${n.name.text}`)
      }
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'compteDefaut') noter('defaut', n, 'compteDefaut')
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && espaces.has(n.expression.text) && CONSTANTES_DE_ROLE.has(n.name.text)) {
        noter('constante', n, `${n.expression.text}.${n.name.text}`)
      }
      ts.forEachChild(n, visiter)
    }
    visiter(sf)
  }
  return trouvees
}

// TOUTE la source : l'application (src/), hors ses tests et ses fabriques de test (src/test/), et tout ce que supabase/
// porte en TypeScript — les Edge Functions et leurs prothèses de type.
function laSource(): Source[] {
  const racine = new URL('../../', import.meta.url)
  const sources: Source[] = []
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(new URL(dossier, racine), { withFileTypes: true })) {
      const chemin = `${dossier}${entree.name}`
      if (entree.isDirectory()) {
        if (chemin !== 'src/test') parcourir(`${chemin}/`)
      } else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
        sources.push({ chemin, texte: readFileSync(new URL(chemin, racine), 'utf8') })
      }
    }
  }
  parcourir('src/')
  parcourir('supabase/')
  return sources
}

// Le reste de l'étape PC3a, que la session a découpée : ce que l'application LIT par le numéro (conception, § 2.4) et les
// explications qui n'accompagnent aucune écriture composée (§ 2.5). Sous le plan vide, chacun reste juste ; sous un plan
// réglé (PC4), chacun se tairait ou mentirait — d'où leur nombre ici, à rendre au plan avant PC4.
const RESTE_DE_PC3A = '— reste de PC3a, à rendre au plan avant que l’étape PC4 permette d’en régler un.'

const EXCEPTIONS: Readonly<Record<string, { nombre: number; raison: string }>> = {
  'src/lib/comptes.ts': {
    nombre: 73,
    raison: 'LE CATALOGUE D’AUJOURD’HUI : les trente-deux constantes que `PLAN_PAR_DEFAUT` épingle (planComptable.test.ts), '
      + 'leurs libellés et ce qu’on en tire — le défaut de chaque rôle, et lui seul ; les six de la vente facturée (étape '
      + 'VF4a) et leurs libellés, tous les six dans `LIBELLES_COMPTES` — le 706000 et le 627000 depuis l’étape VF4c2 '
      + '(VF4A-Q1), les quatre autres depuis l’étape VF4c3 (VF4C2-Q1) : une clé chacun, et sa lecture dans '
      + '`LIBELLES_DE_LA_VENTE_FACTUREE`.',
  },
  'src/lib/planComptable.ts': {
    nombre: 33,
    raison: 'LE CATALOGUE DES RÔLES : le compte par défaut de chacun, confronté à la migration qui l’a inséré, et le plan '
      + 'par défaut qu’on en tire.',
  },
  'src/lib/ecritures.ts': {
    nombre: 2,
    raison: 'Le compte que l’application SUGGÈRE pour deux catégories communes (`SUGGESTIONS_COMPTE_PAR_CODE`) : « frais_bancaires » '
      + 'au 627000, « ventes_prestations » au 706000 — les comptes que ces catégories portent en base (relu le 19/10/2026). '
      + 'Le compte d’une CATÉGORIE, que le cabinet règle, et non celui d’un rôle : depuis l’étape VF4a, ils égalent le défaut '
      + 'des rôles `services_bancaires` et `prestations_de_services`, sans en être l’emploi.',
  },
  'supabase/functions/agent-comptable/index.ts': {
    nombre: 141,
    raison: 'PC3b — l’assistant, Edge Function auto-portée, recopie les constantes dans ses blocs gardés et nomme les '
      + 'comptes dans sa consigne (deux de plus depuis l’étape C5 de la caisse : la caisse et la TVA collectée d’une recette en '
      + 'espèces ; deux encore depuis l’étape C13 : la caisse de la contrepartie d’un paiement par la caisse, et celle qui la '
      + 'juge) ; il lira le plan du dossier à l’étape PC3b, avec son redéploiement.',
  },
  'src/lib/compteDeBilan.ts': {
    nombre: 2,
    raison: 'Deux refus recopiés MOT POUR MOT de `refus_compte_de_bilan` (« s’écrit au 580000, virements internes »), que '
      + 'compteDeBilan.test.ts confronte à la fonction exportée : ils changeront avec la base, à l’étape PC4.',
  },
  'src/lib/aNouveaux.ts': { nombre: 1, raison: `§ 2.4 : \`ouvertureBanque\` cherche la banque des à-nouveaux à son numéro ${RESTE_DE_PC3A}` },
  'src/lib/bilan.ts': { nombre: 3, raison: `§ 2.4 : les comptes détaillés tiers par tiers ${RESTE_DE_PC3A}` },
  'src/lib/engagement.ts': {
    nombre: 3,
    raison: `§ 2.4 et § 3.9 : le compte auxiliaire du FEC, indexé par le numéro (\`AUXILIAIRES\`) — le préfixe du plan viendra avec lui ${RESTE_DE_PC3A}`,
  },
  'src/lib/lettrage.ts': {
    nombre: 11,
    raison: '§ 2.4 : les comptes lettrables (`COMPTES_LETTRABLES`, que lettragesLecture.ts et StatistiquesTab lisent aussi), '
      + `le sens d’un compte de tiers et leur ordre ; la contrainte \`lettrages_manuels_compte\` de la base les borne encore ${RESTE_DE_PC3A}`,
  },
  'src/lib/ouvertureConfrontee.ts': { nombre: 3, raison: `§ 2.5 : les comptes du report nommés dans une explication ${RESTE_DE_PC3A}` },
  'src/lib/pisteAudit.ts': { nombre: 2, raison: `§ 2.4 : une ligne de banque sans mouvement, reconnue à son numéro ${RESTE_DE_PC3A}` },
  'src/lib/revisionCycles.ts': { nombre: 4, raison: `§ 2.4 : le cycle d’un compte de rôle, rangé par son numéro ${RESTE_DE_PC3A}` },
  'src/lib/revisionPreuves.ts': {
    nombre: 21,
    raison: `§ 2.4 et § 2.5 : les preuves proposées des comptes de TVA, de la banque, de l’emprunt et de l’exploitant ${RESTE_DE_PC3A}`,
  },
  'src/lib/tableauPilotage.ts': { nombre: 2, raison: `§ 2.4 : les soldes de fin de mois et les lignes de la banque ${RESTE_DE_PC3A}` },
  'src/pages/dossier/ComptesDeTiersCard.tsx': { nombre: 5, raison: `§ 2.4 : le sens de chaque compte de tiers ${RESTE_DE_PC3A}` },
  'src/pages/dossier/ConcordanceCard.tsx': { nombre: 1, raison: `§ 2.5 : une explication qui nomme le compte de l’exploitant ${RESTE_DE_PC3A}` },
  'src/pages/dossier/FinancementTab.tsx': { nombre: 1, raison: `§ 2.4 : la requête de la trésorerie, filtrée sur la banque ${RESTE_DE_PC3A}` },
  'src/pages/dossier/ValidationExerciceCard.tsx': { nombre: 6, raison: `§ 2.5 : les comptes du report nommés avant la validation ${RESTE_DE_PC3A}` },
}

describe('aucun compte de rôle écrit en dur hors du catalogue', () => {
  // Le relevé de toute la source se paie une fois, avant les tests, et non dans leur délai.
  let sources: Source[] = []
  const parFichier = new Map<string, Trouvaille[]>()
  beforeAll(() => {
    sources = laSource()
    for (const t of analyser(sources)) parFichier.set(t.chemin, [...(parFichier.get(t.chemin) ?? []), t])
  }, 60_000)

  it('connaît les trente-deux comptes par défaut et les trente-deux constantes qui les portent', () => {
    expect(COMPTES_PAR_DEFAUT.size).toBe(32)
    expect(CONSTANTES_DE_ROLE.size).toBe(32)
  })

  it('n’en trouve aucun hors des exceptions, et chaque exception au nombre près', () => {
    const fautes: string[] = []
    for (const [chemin, liste] of parFichier) {
      const exception = EXCEPTIONS[chemin]
      if (!exception) {
        fautes.push(...liste.map((t) => `${t.chemin}:${t.ligne} ${t.genre} ${t.texte}`))
      } else if (liste.length !== exception.nombre) {
        fautes.push(`${chemin} : ${liste.length} au lieu de ${exception.nombre} (${exception.raison})`)
      }
    }
    // Une exception que plus rien ne justifie est une raison morte.
    for (const chemin of Object.keys(EXCEPTIONS)) if (!parFichier.has(chemin)) fautes.push(`${chemin} : exception sans objet`)
    expect(fautes.join('\n'), 'un compte de rôle écrit en dur : le prendre dans le plan du dossier').toBe('')
  })

  it('ne relève pas à l’aveugle : il voit la source entière, et le catalogue tel qu’il est', () => {
    expect(sources.length).toBeGreaterThan(250)
    expect(sources.some((s) => s.chemin === 'supabase/functions/agent-comptable/index.ts')).toBe(true)
    // Les trente-deux numéros du catalogue, un par rôle, chacun là où il se définit.
    const duCatalogue = (parFichier.get('src/lib/comptes.ts') ?? []).filter((t) => t.genre === 'numero').map((t) => t.texte)
    expect(new Set(duCatalogue)).toEqual(COMPTES_PAR_DEFAUT)
  })

  it('relève un défaut planté sous chacune de ses formes, et rien dans un commentaire', () => {
    const plante = [
      "import { COMPTE_BANQUE, COMPTE_EXPLOITANT as EXPLOITANT } from '../lib/comptes'",
      "import * as tous from './comptes'",
      '// Le 512000 dans un commentaire ne compte pas.',
      "const tva = '445660'",
      'const deTva = tva',
      'export const ecrire = () => [COMPTE_BANQUE, EXPLOITANT, tous.COMPTE_CLIENTS, deTva, tva]',
      'const message = `au ${tva} ou au 658000`',
      "const motif = /^(758000|606100)$/",
      // Un nombre est un montant, jamais un compte.
      'const nombre = 129000',
      "const objet = { COMPTE_BANQUE: 'clé', x: 1 }",
      'const autre = objet.COMPTE_BANQUE',
      'export const p = <p>Le compte 401000 porte la dette.</p>',
      "import { PLAN_PAR_DEFAUT as DEFAUT, PLAN_PAR_DEFAUT } from './planComptable'",
      "import * as plans from '../lib/planComptable'",
      'const banque = DEFAUT.banque',
      'const decale = plans.PLAN_DECALE.banque',
      "const duRole = definitionDuRole('banque')?.compteDefaut",
    ].join('\n')
    const relevees = analyser([{ chemin: 'src/lib/plante.tsx', texte: plante }])
      .map((t) => `${t.ligne} ${t.genre} ${t.texte}`)
    expect(relevees).toEqual([
      '4 numero 445660',
      '5 alias tva',
      '6 constante COMPTE_BANQUE',
      '6 constante EXPLOITANT',
      '6 constante tous.COMPTE_CLIENTS',
      '6 alias deTva',
      '6 alias tva',
      '7 alias tva',
      '7 numero 658000',
      '8 numero 758000',
      '12 numero 401000',
      '15 defaut DEFAUT',
      '16 defaut plans.PLAN_DECALE',
      '17 defaut compteDefaut',
    ])
  })
})
