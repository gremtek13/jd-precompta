import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// CHAQUE APPELANT DE `paiementsDesPieces` A JUGÉ LES PAIEMENTS PAR LA CAISSE (ligne 26.6, étape C9a). Le quatrième paramètre
// est obligatoire : le compilateur a fait la liste des appelants, et chacun a été jugé — il lit les paiements de la caisse
// du dossier (une expression tirée de `paiementsParLaCaisse…`, ou le paramètre qui les porte), ou, de son propre
// jugement, n'en compte AUCUN, écrit en toutes lettres (`AUCUN_PAIEMENT_PAR_LA_CAISSE`) et justifié ci-dessous. Une liste
// vide écrite à la main (`[]`) se lirait comme un oubli : elle est une faute hors des tests. Le scanner part de TOUS les
// fichiers de `src/` et du banc des captures ; une forme qu'il ne reconnaît pas est une faute.

const RACINE = fileURLToPath(new URL('../..', import.meta.url))

// Les appelants qui ne comptent AUCUN paiement par la caisse, et pourquoi — fichier par fichier, au nombre près.
const SANS_LA_CAISSE: Readonly<Record<string, { appels: number; raison: string }>> = {
  'src/pages/ClientSimulation.tsx': { appels: 1, raison: 'la session du client ne lit pas la caisse (CAISSE-Q1)' },
  'src/pages/dossier/PiecesTab.tsx': { appels: 1, raison: '« Rapprochée » dit un mouvement bancaire ; « Payée en espèces » se dit à part (C9b), et le reste à régler de la fiche lit la caisse' },
  'src/pages/dossier/EncaissementsFactureModal.tsx': { appels: 1, raison: 'les propositions ne nomment que des mouvements, et la fenêtre sert le client' },
  'outils/captures/fauxSupabase.ts': { appels: 3, raison: 'les dossiers de référence du banc n’ont aucune caisse' },
}

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) return fichiers(chemin)
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) ? [chemin] : []
  })
}

interface Appel { fichier: string; quatrieme: string | null; nbArguments: number }

function appels(): Appel[] {
  const trouves: Appel[] = []
  for (const chemin of [...fichiers(join(RACINE, 'src')), join(RACINE, 'outils', 'captures', 'fauxSupabase.ts')]) {
    const texte = readFileSync(chemin, 'utf8')
    if (!texte.includes('paiementsDesPieces')) continue
    const source = ts.createSourceFile(chemin, texte, ts.ScriptTarget.Latest, true, chemin.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visiter = (noeud: ts.Node) => {
      if (ts.isCallExpression(noeud)) {
        const appele = noeud.expression
        const nom = ts.isIdentifier(appele) ? appele.text : ts.isPropertyAccessExpression(appele) ? appele.name.text : null
        if (nom === 'paiementsDesPieces') {
          trouves.push({
            fichier: relative(RACINE, chemin).split('\\').join('/'), nbArguments: noeud.arguments.length,
            quatrieme: noeud.arguments[3]?.getText(source) ?? null,
          })
        }
      }
      ts.forEachChild(noeud, visiter)
    }
    visiter(source)
  }
  return trouves
}

// Une expression tirée des paiements de la caisse du dossier : un appel de `paiementsParLaCaisse…`, éventuellement suivi
// de `?? []` là où l'écran attend déjà (une caisse lue en partie n'a ni 2035 ni CA3), ou le nom qui les porte.
const DE_LA_CAISSE = /^(?:paiementsParLaCaisse\w*\([^]*\)|paiementsDeLaCaisse|paiementsParLaCaisse)(?: \?\? \[\])?$/

describe('les appelants de paiementsDesPieces', () => {
  const tous = appels()

  it('le plancher : le scanner voit les appelants', () => {
    expect(tous.length).toBeGreaterThanOrEqual(15)
  })

  it('chacun passe les paiements par la caisse, en quatrième argument', () => {
    expect(tous.filter((a) => a.nbArguments !== 4 && a.fichier !== 'src/lib/rattachement.ts')).toEqual([])
  })

  it('chacun les lit de la caisse du dossier, ou n’en compte aucun par un jugement écrit — jamais `[]`', () => {
    const fautes = tous.filter((a) => a.quatrieme !== null && a.quatrieme !== 'AUCUN_PAIEMENT_PAR_LA_CAISSE' && !DE_LA_CAISSE.test(a.quatrieme))
    expect(fautes).toEqual([])
    const sans = new Map<string, number>()
    for (const a of tous) if (a.quatrieme === 'AUCUN_PAIEMENT_PAR_LA_CAISSE') sans.set(a.fichier, (sans.get(a.fichier) ?? 0) + 1)
    expect(Object.fromEntries(sans)).toEqual(Object.fromEntries(Object.entries(SANS_LA_CAISSE).map(([f, x]) => [f, x.appels])))
  })

  it('le motif reconnaît ce qu’il doit, et refuse le reste', () => {
    for (const bon of ['paiementsParLaCaisseDuDossier(lectureCaisse, dossierId) ?? []', 'paiementsDeLaCaisse', 'paiementsDeLaCaisse ?? []',
      'paiementsParLaCaisse', 'paiementsParLaCaisse(d.operationsDeCaisse === null ? [] : operationsDe(d.operationsDeCaisse))']) {
      expect(DE_LA_CAISSE.test(bon), bon).toBe(true)
    }
    for (const faux of ['[]', 'AUCUN', 'paiementsDeLaCaisse ?? autre', 'x ?? []', 'paiementsParLaCaisseSelon', 'autre(paiementsDeLaCaisse)']) {
      expect(DE_LA_CAISSE.test(faux), faux).toBe(false)
    }
  })
})
