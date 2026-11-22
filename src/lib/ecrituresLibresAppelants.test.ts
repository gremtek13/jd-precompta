import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// AUCUN APPELANT DE L'APPLICATION N'OMET LES ÉCRITURES LIBRES (EL5). La 2035, la situation intermédiaire, l'estimation et le FEC
// les reçoivent en DERNIER paramètre, sous un défaut (EL3, EL4) : l'absence le drapeau baissé, et — pour la 2035 et ce qui s'en
// estime — un refus une fois levé. Ce scanner part de TOUTES les sources de l'application (hors des tests et de leurs fabriques,
// que EL8 rangera) et exige, à chaque appel de ces moteurs, autant d'arguments que la déclaration a de paramètres : un appelant
// qui s'en remettrait au défaut calculerait, le drapeau levé, une 2035 sans les écritures de l'expert, ou lèverait à l'écran.
const RACINE = join(__dirname, '..')
const MOTEURS: Record<string, string> = {
  calculerDeclaration2035: 'lib/declaration2035.ts',
  calculerSituationIntermediaire: 'lib/situationIntermediaire.ts',
  projectionAnnuelle: 'lib/estimation.ts',
  totauxPourAnnee: 'lib/estimation.ts',
  chiffreDAffairesDeLaPeriode: 'lib/estimation.ts',
  numeroterFec: 'lib/fec.ts',
  genererFec: 'lib/fec.ts',
  declarationPourLaRevue: 'lib/revueAnalytiqueEcran.ts',
}

function sources(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return nom === 'test' ? [] : sources(chemin)
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : []
  })
}

function analyser(chemin: string): ts.SourceFile {
  return ts.createSourceFile(chemin, readFileSync(chemin, 'utf8'), ts.ScriptTarget.Latest, true, chemin.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

function parametres(nom: string): number {
  const f = analyser(join(RACINE, MOTEURS[nom]))
  let n = -1
  const visiter = (noeud: ts.Node) => {
    if (ts.isFunctionDeclaration(noeud) && noeud.name?.text === nom) n = noeud.parameters.length
    ts.forEachChild(noeud, visiter)
  }
  visiter(f)
  return n
}

function appels(): { cle: string; nom: string; arguments: number }[] {
  const trouves: { cle: string; nom: string; arguments: number }[] = []
  for (const chemin of sources(RACINE)) {
    const f = analyser(chemin)
    const visiter = (noeud: ts.Node) => {
      if (ts.isCallExpression(noeud) && ts.isIdentifier(noeud.expression) && noeud.expression.text in MOTEURS) {
        const { line } = f.getLineAndCharacterOfPosition(noeud.getStart())
        trouves.push({ cle: `${relative(RACINE, chemin)}:${line + 1}`, nom: noeud.expression.text, arguments: noeud.arguments.length })
      }
      ts.forEachChild(noeud, visiter)
    }
    visiter(f)
  }
  return trouves
}

describe('les écritures libres passées par chaque appelant des moteurs (EL5)', () => {
  it('chaque moteur se trouve, et prend les écritures libres en dernier paramètre', () => {
    for (const nom of Object.keys(MOTEURS)) {
      expect(parametres(nom), nom).toBeGreaterThan(1)
      expect(readFileSync(join(RACINE, MOTEURS[nom]), 'utf8')).toContain('ecrituresLibres')
    }
  })

  it('aucun appel de l’application ne s’en remet au défaut', () => {
    const tous = appels()
    // Le plancher : le scanner voit les appels des écrans, sans quoi « zéro faute » serait « aveugle ».
    expect(tous.length).toBeGreaterThanOrEqual(14)
    const fautes = tous.filter((a) => a.arguments !== parametres(a.nom)).map((a) => `${a.cle} ${a.nom} (${a.arguments}/${parametres(a.nom)})`)
    expect(fautes).toEqual([])
  })
})
