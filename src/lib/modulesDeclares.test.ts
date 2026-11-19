import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import {
  FONCTIONS_EDGE,
  MODULE_DE_LA_CASE,
  MODULE_DE_LA_FONCTION,
  MODULE_DE_LA_ROUTE,
  MODULE_DE_LA_ROUTE_DU_CABINET,
  MODULE_DE_L_ONGLET,
  ROUTES_DE_L_ESPACE_CLIENT,
  ROUTES_DU_CABINET,
  ROUTES_HORS_DES_MODULES,
  USAGES_DE_SEND_EMAIL,
} from './modulesDuCabinet'

// TOUT CE QUE L'APPLICATION OUVRE A SON MODULE (conception 56, OPT2 ; § 8 : « un écran oublié reste monté sous une option
// fermée »). Les tables d'appartenance de lib/modulesDuCabinet.ts sont des listes tenues à la main : ce scanner part de TOUT
// ce que l'application ouvre, et met en faute ce qui n'y a pas de module — ou un module pour ce qui n'existe plus :
//   - les onglets d'un dossier : le type `DossierTab` de lib/ongletsDossier.ts, lu dans son texte (le compilateur ferme déjà
//     `MODULE_DE_L_ONGLET`, un `Record<DossierTab, Module>` ; la lecture le redit, et garde le plancher) ;
//   - les routes des deux espaces : chaque `<Route` de App.tsx, rangée dans le bloc `role === 'cabinet'` ou
//     `role === 'client'` qui la contient ; un chemin qui n'est pas une chaîne, une route hors des deux blocs (la route de
//     la coque exceptée, sans chemin) sont des formes non reconnues, donc des fautes ;
//   - les cases d'un accès client : chaque colonne `droit_*` qu'une migration exportée ou préparée ajoute ;
//   - les Edge Functions : chaque sous-dossier de supabase/functions/ ; et les usages de `send-email`, les clés de son
//     `QUI_PEUT_QUOI`, dont chaque type admis (`TYPES_ADMIS`) doit être une.
// Les planchers (19/11/2026) : 22 onglets, 17 routes du client, 8 du cabinet, 7 cases, 16 fonctions, 5 usages. Chaque
// relevé est éprouvé par un défaut planté.

const RACINE = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(RACINE + chemin, 'utf8')
const sansCommentairesTs = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

/** Une liste comparée à une autre, dans les deux sens. */
function ecarts(nom: string, lus: readonly string[], declares: readonly string[]): string[] {
  return [
    ...lus.filter((x) => !declares.includes(x)).map((x) => `${nom} « ${x} » sans module`),
    ...declares.filter((x) => !lus.includes(x)).map((x) => `${nom} « ${x} » a un module mais n'existe plus`),
  ]
}

// ── Les onglets ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les membres du type `DossierTab`, lus dans le texte de lib/ongletsDossier.ts ; nul si le type ne se lit pas. */
export function ongletsDuType(texte: string): string[] | null {
  const m = /export type DossierTab =([\s\S]*?)\n\s*\n/.exec(texte)
  if (!m) return null
  const membres = m[1].split('|').map((s) => s.trim()).filter(Boolean)
  if (!membres.every((s) => /^'[a-z][a-z-]*'$/.test(s))) return null
  return membres.map((s) => s.slice(1, -1))
}

export function fautesDesOnglets(texte: string, declares: readonly string[]): string[] {
  const lus = ongletsDuType(texte)
  if (lus === null) return ['le type DossierTab ne se lit pas : une forme non reconnue']
  return ecarts('l’onglet', lus, declares)
}

// ── Les routes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** La fin du bloc ouvert par la parenthèse en `debut` : sa parenthèse fermante, les imbriquées comptées. */
function finDuBloc(texte: string, debut: number): number {
  let profondeur = 0
  for (let i = debut; i < texte.length; i++) {
    if (texte[i] === '(') profondeur += 1
    else if (texte[i] === ')') {
      profondeur -= 1
      if (profondeur === 0) return i
    }
  }
  return -1
}

export interface RoutesLues { client: string[]; cabinet: string[]; fautes: string[] }

/** Les chemins des routes de chaque espace, et les formes non reconnues. */
export function routesDeLApplication(texteApp: string): RoutesLues {
  const texte = sansCommentairesTs(texteApp)
  const blocs: { espace: 'cabinet' | 'client'; debut: number; fin: number }[] = []
  const fautes: string[] = []
  for (const espace of ['cabinet', 'client'] as const) {
    const ouvertures = [...texte.matchAll(new RegExp(`\\{role === '${espace}' && \\(`, 'g'))]
    if (ouvertures.length !== 1) {
      fautes.push(`le bloc des routes ${espace === 'cabinet' ? 'du cabinet' : 'du client'} : ${ouvertures.length} au lieu d'un`)
      continue
    }
    const debut = ouvertures[0].index + ouvertures[0][0].length - 1
    const fin = finDuBloc(texte, debut)
    if (fin < 0) fautes.push(`le bloc des routes ${espace} ne se referme pas`)
    else blocs.push({ espace, debut, fin })
  }
  const client: string[] = []
  const cabinet: string[] = []
  for (const m of texte.matchAll(/<Route\b/g)) {
    // La balise ouvrante entière : jusqu'au `>` hors des accolades (un attribut `element={<X />}` en porte).
    let profondeur = 0
    let fin = m.index + m[0].length
    for (; fin < texte.length; fin++) {
      if (texte[fin] === '{') profondeur += 1
      else if (texte[fin] === '}') profondeur -= 1
      else if (texte[fin] === '>' && profondeur === 0) break
    }
    const attributs = texte.slice(m.index + m[0].length, fin).replace(/\/\s*$/, '')
    if (/^\s*element=\{<Layout \/>\}\s*$/.test(attributs)) continue
    const chemin = /\bpath="([^"]+)"/.exec(attributs)?.[1]
    if (chemin === undefined) {
      fautes.push(`une route sans chemin lisible : « <Route${attributs.slice(0, 60)} »`)
      continue
    }
    const bloc = blocs.find((b) => m.index > b.debut && m.index < b.fin)
    if (!bloc) fautes.push(`la route « ${chemin} » hors des blocs des deux espaces`)
    else (bloc.espace === 'client' ? client : cabinet).push(chemin)
  }
  return { client, cabinet, fautes }
}

export function fautesDesRoutes(texteApp: string): string[] {
  const { client, cabinet, fautes } = routesDeLApplication(texteApp)
  const horsDesModules = Object.keys(ROUTES_HORS_DES_MODULES)
  return [
    ...fautes,
    ...ecarts('la route du client', client.filter((c) => !horsDesModules.includes(c)), Object.keys(MODULE_DE_LA_ROUTE)),
    ...ecarts('la route du cabinet', cabinet.filter((c) => !horsDesModules.includes(c)), Object.keys(MODULE_DE_LA_ROUTE_DU_CABINET)),
  ]
}

// ── Les cases ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les colonnes `droit_*` que les migrations ajoutent, dans l'ordre de leur première apparition. */
export function colonnesDesDroits(fichiers: readonly { texte: string }[]): string[] {
  const vues: string[] = []
  for (const f of fichiers) {
    const texte = f.texte.replace(/--[^\n]*/g, '')
    for (const m of texte.matchAll(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?(droit_[a-z_]+)/gi)) {
      if (!vues.includes(m[1].toLowerCase())) vues.push(m[1].toLowerCase())
    }
  }
  return vues
}

export function fautesDesCases(fichiers: readonly { texte: string }[]): string[] {
  return ecarts('la case', colonnesDesDroits(fichiers), Object.keys(MODULE_DE_LA_CASE).map((d) => `droit_${d}`))
}

// ── Les Edge Functions ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Les usages de `send-email` : les clés de son `QUI_PEUT_QUOI` ; et ses types admis, qui doivent en être. */
export function usagesDeSendEmail(texte: string): { usages: string[] | null; admis: string[] } {
  const bloc = /const QUI_PEUT_QUOI[^=]*=\s*\{([\s\S]*?)\n\}/.exec(texte)?.[1]
  const usages = bloc === undefined ? null : [...sansCommentairesTs(bloc).matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])
  const admisBloc = /const TYPES_ADMIS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(texte)?.[1] ?? ''
  const admis = [...new Set([...admisBloc.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))]
  return { usages, admis }
}

export function fautesDesFonctions(dossiers: readonly string[], texteSendEmail: string): string[] {
  const fautes = ecarts('la fonction', dossiers, Object.keys(MODULE_DE_LA_FONCTION))
  const { usages, admis } = usagesDeSendEmail(texteSendEmail)
  if (usages === null) return [...fautes, 'le QUI_PEUT_QUOI de send-email ne se lit pas : une forme non reconnue']
  const exigence = MODULE_DE_LA_FONCTION['send-email']
  const declares = 'parUsage' in exigence ? Object.keys(exigence.parUsage) : []
  return [
    ...fautes,
    ...ecarts('l’usage de send-email', usages, declares),
    ...admis.filter((a) => !usages.includes(a)).map((a) => `le type admis « ${a} » de send-email hors de son QUI_PEUT_QUOI`),
  ]
}

const ONGLETS = lire('src/lib/ongletsDossier.ts')
const APP = lire('src/App.tsx')
const SEND_EMAIL = lire('supabase/functions/send-email/index.ts')
const FONCTIONS = readdirSync(RACINE + 'supabase/functions').filter((n) => statSync(RACINE + 'supabase/functions/' + n).isDirectory()).sort()
const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()]

describe('tout ce que l’application ouvre a son module (OPT2)', () => {
  it('chaque onglet d’un dossier, lu dans le type DossierTab (au moins 22)', () => {
    expect(ongletsDuType(ONGLETS)?.length).toBeGreaterThanOrEqual(22)
    expect(fautesDesOnglets(ONGLETS, Object.keys(MODULE_DE_L_ONGLET))).toEqual([])
  })

  it('chaque route des deux espaces, lue dans App.tsx (au moins 17 du client, 8 du cabinet, et la redirection de chacun)', () => {
    const { client, cabinet, fautes } = routesDeLApplication(APP)
    expect(fautes).toEqual([])
    expect(client.filter((c) => c !== '*').length).toBeGreaterThanOrEqual(17)
    expect(cabinet.filter((c) => c !== '*').length).toBeGreaterThanOrEqual(8)
    expect(client.filter((c) => c === '*')).toHaveLength(1)
    expect(cabinet.filter((c) => c === '*')).toHaveLength(1)
    expect(fautesDesRoutes(APP)).toEqual([])
    expect([...ROUTES_DE_L_ESPACE_CLIENT].sort()).toEqual(Object.keys(MODULE_DE_LA_ROUTE).sort())
    expect([...ROUTES_DU_CABINET].sort()).toEqual(Object.keys(MODULE_DE_LA_ROUTE_DU_CABINET).sort())
  })

  it('chaque case d’un accès client, lue dans les colonnes droit_* de l’export et des préparées (au moins 7)', () => {
    expect(colonnesDesDroits(MIGRATIONS).length).toBeGreaterThanOrEqual(7)
    expect(fautesDesCases(MIGRATIONS)).toEqual([])
  })

  it('chaque Edge Function, lue dans supabase/functions/ (au moins 16), et chaque usage de send-email (au moins 5)', () => {
    expect(FONCTIONS.length).toBeGreaterThanOrEqual(16)
    expect([...FONCTIONS]).toEqual([...FONCTIONS_EDGE].sort())
    expect(usagesDeSendEmail(SEND_EMAIL).usages?.length).toBeGreaterThanOrEqual(5)
    expect(usagesDeSendEmail(SEND_EMAIL).usages).toEqual([...USAGES_DE_SEND_EMAIL])
    expect(fautesDesFonctions(FONCTIONS, SEND_EMAIL)).toEqual([])
  })
})

describe('le relevé, éprouvé par des défauts plantés', () => {
  it('un onglet ajouté sans module, ou retiré en gardant le sien : une faute ; le type illisible : une faute', () => {
    const plante = ONGLETS.replace("  | 'acces'\n", "  | 'acces'\n  | 'nouvel-onglet'\n")
    expect(plante).not.toBe(ONGLETS)
    expect(fautesDesOnglets(plante, Object.keys(MODULE_DE_L_ONGLET))).toEqual(['l’onglet « nouvel-onglet » sans module'])
    expect(fautesDesOnglets(ONGLETS.replace("  | 'acces'\n", ''), Object.keys(MODULE_DE_L_ONGLET)))
      .toEqual(['l’onglet « acces » a un module mais n\'existe plus'])
    expect(fautesDesOnglets(ONGLETS.replace("  | 'acces'\n", '  | Autre\n'), Object.keys(MODULE_DE_L_ONGLET)))
      .toEqual(['le type DossierTab ne se lit pas : une forme non reconnue'])
  })

  it('une route du client ajoutée sans module, ou du cabinet : une faute chacune', () => {
    const client = APP.replace('<Route path="/securite" element={<SecuriteDuCompte espace="client" />} />',
      '<Route path="/mon-nouvel-ecran" element={<ClientHome />} />\n            <Route path="/securite" element={<SecuriteDuCompte espace="client" />} />')
    expect(client).not.toBe(APP)
    expect(fautesDesRoutes(client)).toEqual(['la route du client « /mon-nouvel-ecran » sans module'])
    const cabinet = APP.replace('<Route path="/retour-banque" element={<RetourBanque />} />',
      '<Route path="/retour-banque" element={<RetourBanque />} />\n            <Route path="/nouvelle-page" element={<RetourBanque />} />')
    expect(fautesDesRoutes(cabinet)).toEqual(['la route du cabinet « /nouvelle-page » sans module'])
  })

  it('une route dont le chemin n’est pas une chaîne, ou hors des deux blocs : une forme non reconnue', () => {
    const calcule = APP.replace('<Route path="/mes-pieces" element={<ClientUpload />} />', '<Route path={chemin} element={<ClientUpload />} />')
    expect(fautesDesRoutes(calcule)[0]).toMatch(/^une route sans chemin lisible/)
    const dehors = APP.replace('<Route element={<Layout />}>', '<Route element={<Layout />}>\n        <Route path="/dehors" element={<ClientHome />} />')
    expect(fautesDesRoutes(dehors)).toEqual(['la route « /dehors » hors des blocs des deux espaces'])
    // Une route citée en commentaire n'est pas une route.
    expect(fautesDesRoutes(APP.replace('<Route element={<Layout />}>', '<Route element={<Layout />}>\n        {/* <Route path="/cite" element={<X />} /> */}'))).toEqual([])
  })

  it('une colonne droit_* ajoutée sans case : une faute', () => {
    const plantee = [...MIGRATIONS, { chemin: 'supabase/preparees/x.sql', texte: 'alter table public.memberships\n  add column droit_nouveau boolean not null default false;' }]
    expect(fautesDesCases(plantee)).toEqual(['la case « droit_nouveau » sans module'])
    // Citée en commentaire, elle n'est pas ajoutée.
    expect(fautesDesCases([...MIGRATIONS, { texte: '-- add column droit_cite boolean' }])).toEqual([])
  })

  it('une Edge Function ajoutée sans module, ou retirée en gardant le sien ; un usage de send-email sans module ; un type admis hors de QUI_PEUT_QUOI', () => {
    expect(fautesDesFonctions([...FONCTIONS, 'nouvelle-fonction'], SEND_EMAIL)).toEqual(['la fonction « nouvelle-fonction » sans module'])
    expect(fautesDesFonctions(FONCTIONS.filter((f) => f !== 'banque-connexion'), SEND_EMAIL))
      .toEqual(['la fonction « banque-connexion » a un module mais n\'existe plus'])
    const usage = SEND_EMAIL.replace('  relance_demande: "cabinet",\n}', '  relance_demande: "cabinet",\n  nouvel_usage: "cabinet",\n}')
    expect(usage).not.toBe(SEND_EMAIL)
    expect(fautesDesFonctions(FONCTIONS, usage)).toEqual(['l’usage de send-email « nouvel_usage » sans module'])
    const admis = SEND_EMAIL.replace('...(RELANCES_DE_DEMANDES_EN_BASE ? ["relance_demande"] : []),', '...(RELANCES_DE_DEMANDES_EN_BASE ? ["relance_demande"] : ["autre_type"]),')
    expect(admis).not.toBe(SEND_EMAIL)
    expect(fautesDesFonctions(FONCTIONS, admis)).toEqual(['le type admis « autre_type » de send-email hors de son QUI_PEUT_QUOI'])
    expect(fautesDesFonctions(FONCTIONS, 'rien')).toEqual(['le QUI_PEUT_QUOI de send-email ne se lit pas : une forme non reconnue'])
  })
})
