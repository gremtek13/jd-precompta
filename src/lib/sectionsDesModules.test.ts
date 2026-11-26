import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { MODULE_DE_LA_SECTION, NOMS_DES_SECTIONS, type ModuleOptionnel } from './modulesDuCabinet'

// LES SECTIONS D'UN MODULE NE SE MONTENT QUE SOUS LEUR MODULE (conception 56, OPT3 ; OPT6, 26/11/2026). modulesDeclares.test.ts
// juge les onglets, les routes, les cases et les fonctions ; un module peut aussi n'être qu'une SECTION d'un écran du socle
// (l'assurance maladie dans Banque et « Ma banque », l'écriture libre dans Écritures, la connexion bancaire dans Banque). Ce
// scanner part :
//   - des fichiers de src/components/ et src/pages/ dont le nom désigne un module (`NOMS_DES_SECTIONS`) : chaque composant
//     qu'ils exportent et qu'un AUTRE fichier monte est une section de ce module, et figure dans `MODULE_DE_LA_SECTION` sous
//     ce module, ou dans les exceptions ci-dessous, chacune avec sa raison, au nombre près ;
//   - de chaque section de `MODULE_DE_LA_SECTION` : montée au moins une fois, et à CHAQUE montage, l'expression JSX qui la
//     monte (de l'accolade ouvrante non refermée la plus proche jusqu'à la balise) porte `estOuvert('<son module>'`.
// Lu dans l'EXPRESSION, jamais la ligne : une section enfant d'une section gardée (l'association sous les paiements) hérite de
// la garde de l'expression qui l'enveloppe. Le relevé est éprouvé par des défauts plantés.

const RACINE = new URL('../../', import.meta.url).pathname

function fichiers(dossier: string): string[] {
  const sortie: string[] = []
  for (const nom of readdirSync(RACINE + dossier)) {
    const chemin = dossier + '/' + nom
    if (statSync(RACINE + chemin).isDirectory()) sortie.push(...fichiers(chemin))
    else if (nom.endsWith('.tsx') && !/\.test\.tsx$/.test(nom)) sortie.push(chemin)
  }
  return sortie
}

/** Les composants qu'un fichier de section ne monte pas comme section gardée par une expression, et pourquoi. */
export const EXCEPTIONS: Readonly<Record<string, string>> = {
  // La fiche d'un crédit (FicheMouvement) le monte sans condition : BanqueTab lui passe `{ genre: 'rien' }` quand le module
  // est fermé (`associationOfferte`, qui lit `estOuvert('assurance_maladie', …)`), et le composant ne rend alors rien.
  AssociationDansLaFiche: 'jugée en amont, dans BanqueTab (associationOfferte)',
}
const NOMBRE_D_EXCEPTIONS = 1

type Source = { chemin: string; texte: string }

function moduleDuNom(chemin: string): ModuleOptionnel | null {
  const base = chemin.split('/').pop()!.replace(/\.tsx$/, '')
  for (const [motif, module] of NOMS_DES_SECTIONS) if (motif.test(base)) return module
  return null
}

function composantsExportes(source: Source): string[] {
  const base = source.chemin.split('/').pop()!.replace(/\.tsx$/, '')
  const noms = new Set<string>()
  if (/export default function [A-Z]/.test(source.texte) || /export default [A-Z]\w*\s*$/m.test(source.texte)) noms.add(base)
  for (const m of source.texte.matchAll(/export function ([A-Z]\w*)\s*\(/g)) noms.add(m[1])
  return [...noms]
}

/** L'expression qui enveloppe la position : de l'accolade ouvrante non refermée la plus proche jusqu'à elle. */
function expressionEnveloppante(texte: string, position: number): string | null {
  let profondeur = 0
  for (let i = position - 1; i >= 0; i--) {
    const c = texte[i]
    if (c === '}') profondeur++
    else if (c === '{') {
      if (profondeur === 0) return texte.slice(i, position)
      profondeur--
    }
  }
  return null
}

function montages(sources: readonly Source[], nom: string, horsDe: string | null): { chemin: string; position: number }[] {
  const motif = new RegExp('<' + nom + '(?=[\\s/>])', 'g')
  const sortie: { chemin: string; position: number }[] = []
  for (const s of sources) {
    if (s.chemin === horsDe) continue
    for (const m of s.texte.matchAll(motif)) sortie.push({ chemin: s.chemin, position: m.index! })
  }
  return sortie
}

export function fautesDesSections(
  sources: readonly Source[],
  table: Readonly<Record<string, ModuleOptionnel>>,
  exceptions: Readonly<Record<string, string>>,
): { fautes: string[]; montagesGardes: number; sectionsVues: number } {
  const fautes: string[] = []
  let montagesGardes = 0
  let sectionsVues = 0
  // 1. Les fichiers qui portent le nom d'un module : chaque composant monté ailleurs est une section déclarée.
  for (const s of sources) {
    const module = moduleDuNom(s.chemin)
    if (module === null) continue
    for (const nom of composantsExportes(s)) {
      if (montages(sources, nom, s.chemin).length === 0) continue
      sectionsVues++
      if (nom in exceptions) continue
      if (!(nom in table)) fautes.push(`${nom} (${s.chemin}) : une section de « ${module} » sans module déclaré`)
      else if (table[nom] !== module) fautes.push(`${nom} : déclarée sous « ${table[nom]} », son fichier désigne « ${module} »`)
    }
  }
  // 2. Chaque section déclarée : montée, et gardée par son module à chaque montage.
  for (const [nom, module] of Object.entries(table)) {
    const lieux = montages(sources, nom, null).filter((l) => !l.chemin.endsWith('/' + nom + '.tsx'))
    if (lieux.length === 0) fautes.push(`${nom} : déclarée, jamais montée`)
    for (const l of lieux) {
      const texte = sources.find((s) => s.chemin === l.chemin)!.texte
      const expression = expressionEnveloppante(texte, l.position)
      // La garde est dans la CONDITION de l'expression : avant sa première balise (le corps d'une fonction ou une expression
      // qui commence par du JSX n'est pas une garde).
      const condition = expression === null ? '' : expression.slice(0, expression.search(/<[A-Za-z]/) < 0 ? undefined : expression.search(/<[A-Za-z]/))
      if (!condition.includes(`estOuvert('${module}'`)) {
        fautes.push(`${nom} (${l.chemin}) : montée hors de estOuvert('${module}', …)`)
      } else montagesGardes++
    }
  }
  return { fautes, montagesGardes, sectionsVues }
}

const SOURCES: Source[] = [...fichiers('src/components'), ...fichiers('src/pages'), 'src/App.tsx']
  .map((chemin) => ({ chemin, texte: readFileSync(RACINE + chemin, 'utf8') }))

describe('les sections d’un module ne se montent que sous leur module (OPT3, OPT6)', () => {
  it('chaque section, dans chaque écran qui la monte (plancher : 9 montages gardés, 7 sections vues)', () => {
    const r = fautesDesSections(SOURCES, MODULE_DE_LA_SECTION, EXCEPTIONS)
    expect(r.fautes).toEqual([])
    expect(r.montagesGardes).toBeGreaterThanOrEqual(9)
    expect(r.sectionsVues).toBeGreaterThanOrEqual(7)
    expect(Object.keys(EXCEPTIONS)).toHaveLength(NOMBRE_D_EXCEPTIONS)
  })
})

describe('le relevé des sections, éprouvé par des défauts plantés', () => {
  const page = (corps: string): Source => ({ chemin: 'src/pages/Ecran.tsx', texte: `export default function Ecran() { return (<div>${corps}</div>) }` })
  const section: Source = { chemin: 'src/components/PaiementsAssuranceMaladie.tsx', texte: 'export default function PaiementsAssuranceMaladie() { return null }' }
  const table = { PaiementsAssuranceMaladie: 'assurance_maladie' } as const

  it('gardée par son module : aucune faute', () => {
    expect(fautesDesSections([section, page(`{estOuvert('assurance_maladie', o) && <PaiementsAssuranceMaladie a={1} />}`)], table, {}).fautes).toEqual([])
  })
  it('montée sans garde, ou sous la garde d’un autre module : une faute', () => {
    expect(fautesDesSections([section, page('<PaiementsAssuranceMaladie />')], table, {}).fautes).toHaveLength(1)
    expect(fautesDesSections([section, page(`{estOuvert('tenue', o) && <PaiementsAssuranceMaladie />}`)], table, {}).fautes).toHaveLength(1)
  })
  it('une garde refermée avant la balise ne la couvre pas', () => {
    expect(fautesDesSections([section, page(`{estOuvert('assurance_maladie', o) && <p />}<PaiementsAssuranceMaladie />`)], table, {}).fautes).toHaveLength(1)
  })
  it('une section d’un fichier qui désigne un module, absente de la table ; ou déclarée et jamais montée : une faute', () => {
    const neuve: Source = { chemin: 'src/components/EcrituresLibresResume.tsx', texte: 'export function ResumeDesEcrituresLibres() { return null }' }
    expect(fautesDesSections([section, neuve, page(`{estOuvert('assurance_maladie', o) && <PaiementsAssuranceMaladie />}<ResumeDesEcrituresLibres />`)], table, {}).fautes)
      .toEqual(['ResumeDesEcrituresLibres (src/components/EcrituresLibresResume.tsx) : une section de « tenue » sans module déclaré'])
    expect(fautesDesSections([section, page('<p />')], table, {}).fautes).toEqual(['PaiementsAssuranceMaladie : déclarée, jamais montée'])
  })
})
