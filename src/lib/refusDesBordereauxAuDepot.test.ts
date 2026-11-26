import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

// TOUT CHEMIN DE DÉPÔT D'UN FICHIER CHOISI PASSE PAR LE REFUS DES BORDEREAUX (BOR6, première partie ; lib/refusDesBordereaux.ts).
//
// La garantie tient en deux relevés, qui partent chacun de TOUT :
//   - depotsDansLesSeaux.test.ts : tout dépôt de la source (`upload`, `update`, navigateur et Edge Functions) envoie le corps
//     d'un PRÉPARATEUR de lib/bornesStockage.ts, et toute autre forme y est une faute ;
//   - ce relevé : chaque préparateur de lib/bornesStockage.ts — toute fonction exportée qui rend une `IssueDuDepot`, lue dans
//     l'ARBRE du module — passe chacune de ses issues bornées par `sansBordereau` (aucun `borner(` nu), sauf trois exceptions
//     nommées avec leur raison ; et `preparerContenu`, qui reçoit ce que l'application fabrique, n'est appelé qu'aux endroits
//     comptés ici, au nombre près. Un préparateur neuf, un `borner(` laissé nu, un appel neuf de `preparerContenu` sont des
//     fautes. Un plancher distingue « zéro faute » d'« aveugle ».
//
// Ce qu'il ne voit pas : la réception par e-mail (`receive-email`, une Edge Function, qui ne passe par aucun préparateur du
// navigateur : la seconde partie de BOR6) ; un fichier qu'une personne aurait fait passer pour un contenu fabriqué (le
// compilateur et les appels comptés le bornent, pas sa valeur).

const RACINE = new URL('../../', import.meta.url).pathname
const MODULE = join(RACINE, 'src/lib/bornesStockage.ts')

/** Les préparateurs qui ne lisent pas un PDF choisi par une personne, et pourquoi. */
const EXCEPTIONS: Readonly<Record<string, string>> = {
  preparerContenu: 'le contenu est fait par l’application ou reçu de la plateforme agréée du client (appels comptés plus bas)',
  preparerLogo: 'un logo de cabinet : PNG, JPEG ou WebP, jamais un PDF — une image n’a pas de texte à lire',
  preparerLogoDeFacture: 'un logo de facture : PNG ou JPEG, jamais un PDF',
}

/** Les appels de `preparerContenu` hors de bornesStockage.ts, par fichier, et pourquoi aucun ne porte un fichier choisi. */
const APPELS_DE_PREPARER_CONTENU: Readonly<Record<string, { n: number; raison: string }>> = {
  'src/lib/depotDesHonorairesLecture.ts': { n: 1, raison: 'le PDF de la facture d’honoraires, rendu par l’application (LM8)' },
  'src/lib/receptionPlateforme.ts': { n: 2, raison: 'la facture reçue de la plateforme agréée du client, et son PDF lisible rendu par l’application' },
  'src/lib/packGenerator.ts': { n: 2, raison: 'le ZIP et l’Excel d’un pack, faits par l’application (seau `packs`)' },
}

interface Preparateur { nom: string; corps: string }

export function preparateurs(texte: string): Preparateur[] {
  const source = ts.createSourceFile('bornesStockage.ts', texte, ts.ScriptTarget.Latest, true)
  const rendu: Preparateur[] = []
  for (const n of source.statements) {
    if (!ts.isFunctionDeclaration(n) || n.name === undefined || n.body === undefined) continue
    const exporte = n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
    if (!exporte || n.type === undefined || !/\bIssueDuDepot\b/.test(n.type.getText(source))) continue
    rendu.push({ nom: n.name.text, corps: n.body.getText(source) })
  }
  return rendu
}

/** Les fautes : un préparateur sans le refus, ou dont une issue bornée lui échappe ; une exception qui n'existe plus. */
export function fautesDesPreparateurs(liste: readonly Preparateur[]): string[] {
  const fautes: string[] = []
  for (const p of liste) {
    if (p.nom in EXCEPTIONS) continue
    const bornes = (p.corps.match(/\bborner\(/g) ?? []).length
    const gardes = (p.corps.match(/\bsansBordereau\(borner\(/g) ?? []).length
    if (gardes === 0) fautes.push(`${p.nom} ne passe pas par sansBordereau`)
    else if (bornes !== gardes) fautes.push(`${p.nom} laisse ${bornes - gardes} issue(s) bornée(s) hors de sansBordereau`)
  }
  for (const nom of Object.keys(EXCEPTIONS)) {
    if (!liste.some((p) => p.nom === nom)) fautes.push(`l’exception ${nom} ne nomme plus aucun préparateur`)
  }
  return fautes
}

function lister(dossier: string): string[] {
  const rendu: string[] = []
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) rendu.push(...lister(chemin))
    else if (/\.tsx?$/.test(chemin) && !/\.test\.tsx?$/.test(chemin) && !chemin.includes('/src/test/')) rendu.push(chemin)
  }
  return rendu
}

/** Les appels de `preparerContenu` de la source du navigateur, par fichier (bornesStockage.ts, qui le définit, hors du compte). */
export function appelsDePreparerContenu(fichiers: readonly { chemin: string; texte: string }[]): Record<string, number> {
  const rendu: Record<string, number> = {}
  for (const f of fichiers) {
    if (f.chemin === 'src/lib/bornesStockage.ts') continue
    const source = ts.createSourceFile(f.chemin, f.texte, ts.ScriptTarget.Latest, true)
    let n = 0
    const visiter = (noeud: ts.Node) => {
      if (ts.isIdentifier(noeud) && noeud.text === 'preparerContenu' && !ts.isImportSpecifier(noeud.parent)) n++
      ts.forEachChild(noeud, visiter)
    }
    visiter(source)
    if (n > 0) rendu[f.chemin] = n
  }
  return rendu
}

describe('chaque préparateur d’un fichier choisi passe par le refus des bordereaux', () => {
  const texte = readFileSync(MODULE, 'utf8')
  const liste = preparateurs(texte)

  it('aucune faute, au-dessus d’un plancher', () => {
    expect(fautesDesPreparateurs(liste)).toEqual([])
    // Le plancher : les quatre préparateurs d'un fichier choisi (pièce, document du cabinet, original d'import, procès-verbal).
    expect(liste.filter((p) => !(p.nom in EXCEPTIONS)).map((p) => p.nom).sort())
      .toEqual(['preparerDocumentDuCabinet', 'preparerOriginalDImport', 'preparerPiece', 'preparerProcesVerbal'])
    expect(Object.keys(EXCEPTIONS)).toHaveLength(3)
  })

  it('trois défauts plantés se voient : un préparateur neuf, un `borner(` laissé nu, une exception disparue', () => {
    const neuf = `${texte}\nexport async function preparerAutre(f: File): Promise<IssueDuDepot> { return borner(genreDuSeau('pieces'), f, 'application/pdf') }\n`
    expect(fautesDesPreparateurs(preparateurs(neuf))).toEqual(['preparerAutre ne passe pas par sansBordereau'])
    const garde = 'return sansBordereau(borner(genreDuSeau(\'pieces\'), fichier, type), fichier)'
    expect(texte).toContain(garde)
    const nu = texte.replace(garde, `if (fichier.size === 0) return borner(genreDuSeau('pieces'), fichier, type)\n  ${garde}`)
    expect(fautesDesPreparateurs(preparateurs(nu))).toEqual(['preparerPiece laisse 1 issue(s) bornée(s) hors de sansBordereau'])
    const sansLogo = texte.replace('export async function preparerLogo(', 'async function preparerLogo(')
    expect(fautesDesPreparateurs(preparateurs(sansLogo))).toEqual(['l’exception preparerLogo ne nomme plus aucun préparateur'])
  })
})

describe('`preparerContenu` n’est appelé qu’aux endroits comptés', () => {
  // La lecture et l'analyse de toute la source se paient une fois, hors des `it` (CLAUDE.md, « Tests »).
  let reels: Record<string, number>
  let avecPlante: Record<string, number>
  beforeAll(() => {
    const fichiers = lister(join(RACINE, 'src')).map((c) => ({ chemin: relative(RACINE, c), texte: readFileSync(c, 'utf8') }))
    reels = appelsDePreparerContenu(fichiers)
    const plante = [...fichiers, { chemin: 'src/pages/Neuf.tsx', texte: 'const p = preparerContenu(\'pieces\', fichierChoisi, \'application/pdf\')' }]
    avecPlante = appelsDePreparerContenu(plante)
  }, 120_000)

  it('au nombre près, chacun avec sa raison', () => {
    const attendus = Object.fromEntries(Object.entries(APPELS_DE_PREPARER_CONTENU).map(([c, { n }]) => [c, n]))
    expect(reels).toEqual(attendus)
  })

  it('un appel neuf se voit', () => {
    expect(avecPlante['src/pages/Neuf.tsx']).toBe(1)
  })
})
