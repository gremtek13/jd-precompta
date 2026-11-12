import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

// LES RÔLES DU CHANGE DANS TOUS LES LECTEURS DU PLAN (ligne 31 ; HISTORIQUE.md, « 12/11/2026 — LES RÔLES DU CHANGE DANS
// TOUS LES LECTEURS DU PLAN »). Depuis la migration `ecarts_de_reglement` (en production le 12/11/2026), la base porte
// trente-quatre rôles (`roles_comptables`) : les trente-deux de `ROLES_COMPTABLES` et les deux du change
// (lib/rolesDuChange.ts), que la lecture du plan exige le drapeau levé. Un lecteur qui parcourt `ROLES_COMPTABLES` en
// croyant parcourir le plan en oublie deux — la reprise de PC6 renvoyait ainsi au catalogue le 666000 qu'un dossier avait
// choisi. Ce que le plan porte AUJOURD'HUI se lit par `rolesLusAuPlan()` (lib/planComptable.ts).
//
// LE SCANNER part de TOUTE la source TypeScript (src/ et supabase/), hors des tests (un test n'est pas un lecteur du
// plan : un faux `plan_du_dossier` tiré des seuls trente-deux se fait refuser par la lecture le drapeau levé, et part de
// src/test/rolesDeLaBase.ts), des fabriques de src/test/ et de lib/planComptable.ts, qui déclare le catalogue et le lit
// pour juger une réponse. Il relève chaque IDENTIFIANT `ROLES_COMPTABLES` — et, dans les Edge Functions, `ROLES_DU_PLAN`,
// sa copie — par l'arbre syntaxique, jamais la ligne (un commentaire qui le nomme n'est pas un emploi ; un import non
// plus) : tout emploi hors de la liste ci-dessous, ou un nombre qui en diffère, est une faute.

interface Source { chemin: string; texte: string }

function laSource(): Source[] {
  const racine = new URL('../../', import.meta.url)
  const sources: Source[] = []
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(new URL(dossier, racine), { withFileTypes: true })) {
      const chemin = `${dossier}${entree.name}`
      if (entree.isDirectory()) {
        if (chemin !== 'src/test' && entree.name !== 'node_modules') parcourir(`${chemin}/`)
      } else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name) && chemin !== 'src/lib/planComptable.ts') {
        sources.push({ chemin, texte: readFileSync(new URL(chemin, racine), 'utf8') })
      }
    }
  }
  parcourir('src/')
  parcourir('supabase/')
  return sources
}

/** Le nom que le catalogue des rôles porte dans une source : sa copie s'appelle `ROLES_DU_PLAN` dans les Edge Functions. */
const nomsDuCatalogue = (chemin: string) => (chemin.startsWith('supabase/functions/') ? ['ROLES_COMPTABLES', 'ROLES_DU_PLAN'] : ['ROLES_COMPTABLES'])

/** Les emplois du catalogue dans une source : chaque identifiant, hors des déclarations d'import. */
function emploisDuCatalogue(source: Source): number {
  const noms = new Set(nomsDuCatalogue(source.chemin))
  const fichier = ts.createSourceFile(source.chemin, source.texte, ts.ScriptTarget.Latest, true,
    source.chemin.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let n = 0
  const visiter = (noeud: ts.Node) => {
    if (ts.isImportDeclaration(noeud)) return
    if (ts.isIdentifier(noeud) && noms.has(noeud.text)) n++
    ts.forEachChild(noeud, visiter)
  }
  visiter(fichier)
  return n
}

// Chaque emploi qui garde les trente-deux, sa raison et son nombre. Un emploi qui doit voir le plan entier passe par
// `rolesLusAuPlan()`, et n'a rien à faire ici.
const EXCEPTIONS: Readonly<Record<string, { nombre: number; raison: string }>> = {
  'src/lib/aNouveaux.ts': {
    nombre: 3,
    raison: 'les à-nouveaux ne portent que des comptes de bilan (classes 1 à 5 : `preparerAvec` écarte les classes 6, 7 '
      + 'et 8 avant de ranger, `refusDUnANouveau` ne juge que `^[1-5]`) ; les comptes du change (656/666, 756/766) sont '
      + 'des comptes de résultat, qu’aucun à-nouveau ne range ni ne refuse.',
  },
  'src/lib/caisseClient.ts': {
    nombre: 2,
    raison: 'le plan et les libellés que le client ne lit pas : aucun compte, que la caisse du praticien (un BNC en '
      + 'trésorerie) ne lit jamais, ni le change (l’engagement seul) ; le type admet l’absence des deux rôles, et une '
      + 'constante de module ne lit pas le drapeau au chargement.',
  },
  'src/lib/categoriesDepuisLaBalance.ts': {
    nombre: 1,
    raison: 'les racines de deux rôles nommés (`dotations_amortissements`, `cotisations_exploitant`), le paramètre typé '
      + 'sur eux : le `find(...)!` ne voit jamais un rôle du change. Un 656 ou un 756 de la balance se propose en catégorie '
      + 'comme le 627 des services bancaires : la base ne refuse une catégorie que sur un rôle du bilan ou le barème.',
  },
  'src/lib/ficheDesComptesBancaires.ts': {
    nombre: 1,
    raison: 'un compte bancaire est un 512… (`refusDuCompteBancaire` exige `^512[0-9]{3}$` avant de chercher le rôle '
      + 'qui le tient) : aucun compte du change, sous 656/666/756/766, ne peut l’égaler.',
  },
  'src/lib/modeleDuCabinet.ts': {
    nombre: 2,
    raison: '`estDeTiers` cherche un préfixe d’auxiliaire, que les rôles du change n’ont pas ; `definitionDuRole` lit '
      + 'les trente-deux ET les deux du change, le drapeau levé ou non (la base les connaît dans les deux cas).',
  },
  'supabase/functions/agent-comptable/index.ts': {
    nombre: 8,
    raison: 'la copie de `planDeLaReponse` (bloc PLAN DU DOSSIER : la déclaration, le type, `sousUneRacineDuRole`, '
      + 'l’examen des trente-deux, puis `[...ROLES_DU_PLAN, ...duChange]`), confrontée à src/lib réponse par réponse, '
      + 'le drapeau levé et baissé, par agentComptablePlan.test.ts.',
  },
}

describe('les lecteurs du plan voient les rôles du change', () => {
  // Lire et analyser toute la source se paie une fois, dans le beforeAll (CLAUDE.md, « Un calcul lourd se paie dans un
  // beforeAll ») : dans le corps du test, il dépassait les 5 s de Vitest sous la charge de la CI (n° 355, 12/11/2026).
  let sources: Source[] = []
  let relevees: Record<string, number> = {}
  beforeAll(() => {
    sources = laSource()
    relevees = Object.fromEntries(sources.map((s) => [s.chemin, emploisDuCatalogue(s)] as const).filter(([, n]) => n > 0))
  }, 60_000)

  it('tout emploi du catalogue des trente-deux hors de lib/planComptable.ts est une exception motivée, au nombre près', () => {
    expect(relevees).toEqual(Object.fromEntries(Object.entries(EXCEPTIONS).map(([chemin, e]) => [chemin, e.nombre])))
  })

  it('n’est pas aveugle : il parcourt la source et voit un emploi, pas un import ni un commentaire', () => {
    expect(sources.length).toBeGreaterThan(300)
    expect(sources.some((s) => s.chemin === 'supabase/functions/agent-comptable/index.ts')).toBe(true)
    // Le défaut planté : un lecteur neuf qui parcourt les trente-deux.
    const plante = {
      chemin: 'src/lib/lecteurNeuf.ts',
      texte: [
        "import { ROLES_COMPTABLES, type PlanComptable } from './planComptable'",
        '// ROLES_COMPTABLES, nommé dans un commentaire, ne compte pas',
        'export const comptes = (plan: PlanComptable) => ROLES_COMPTABLES.map((r) => plan[r.role])',
      ].join('\n'),
    }
    expect(emploisDuCatalogue(plante)).toBe(1)
    expect(emploisDuCatalogue({ ...plante, chemin: 'src/lib/lecteurNeuf.tsx' })).toBe(1)
    // `ROLES_DU_PLAN` ne compte que dans une Edge Function, où il est la copie du catalogue.
    expect(emploisDuCatalogue({ chemin: 'src/lib/x.ts', texte: 'const ROLES_DU_PLAN = 1' })).toBe(0)
    expect(emploisDuCatalogue({ chemin: 'supabase/functions/x/index.ts', texte: 'const ROLES_DU_PLAN = 1' })).toBe(1)
  })
})
