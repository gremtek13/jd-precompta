import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, jouerScenario, type Contexte, type Scenario } from '../test/contratsFonctions'
import { MODULES_DE_LA_BASE, decrire, depensesDe, prechauffer, sourceDe, type Monde } from '../test/fonctionsEdge'
import {
  FONCTIONS_EDGE, MODULES_OPTIONNELS, MODULE_DE_LA_FONCTION, MOTS_DU_REFUS, moduleDeLAppel, type FonctionEdge, type Module,
} from './modulesDuCabinet'

// LES EDGE FUNCTIONS DES MODULES, EN HTTP, SOUS LES OPTIONS DU CABINET (conception 56, § 3.2, étage 2 ; OPT5, 20/11/2026).
//
// Chaque scénario des contrats (`contratsFonctions.ts`) d'une fonction rangée sous un module se rejoue quatre fois devant le
// monde de référence : tout ouvert (l'état d'un cabinet existant, celui des contrats) ; tout fermé ; son seul module ouvert ;
// et la lecture des options en panne. Un scénario qui n'atteint pas la lecture (un appelant refusé, un corps mal formé, la
// relance de pièces du socle) rend la même réponse et les mêmes dépenses, tout fermé — l'ordre des contrôles d'hier
// demeure. Un scénario qui l'atteint la fait une fois, au jeton de l'appelant ; tout fermé, il rend 403 aux mots du
// refus, en panne 503, sans rien dépenser ni écrire ; son seul module ouvert, il rend ce qu'il rendait. Les fonctions du
// socle ne lisent pas les options (optionDuCabinetCopie.test.ts, sur leur source).

const contexte: Contexte = { entetesDuNavigateur: ['apikey', 'authorization', 'content-type', 'x-client-info'] }

const NOM = 'modules_ouverts_du_dossier'
type Etat = 'ouvert' | 'ferme' | 'seul' | 'panne'

function exigeUnModule(slug: FonctionEdge): boolean {
  const e = MODULE_DE_LA_FONCTION[slug]
  return 'module' in e ? e.module !== 'socle' : 'parUsage' in e && Object.values(e.parUsage).some((m) => m !== 'socle')
}
const TOUCHEES = FONCTIONS_EDGE.filter(exigeUnModule)

/** Le module que l'appel exige : celui de la fonction, ou, pour `send-email`, celui du modèle que le corps demande. */
async function moduleDuScenario(slug: FonctionEdge, scenario: Scenario): Promise<Module | null> {
  if (slug !== 'send-email') return moduleDeLAppel(slug)
  const corps: unknown = await scenario.requete(slug, contexte).json().catch(() => null)
  const type = corps && typeof corps === 'object' ? (corps as Record<string, unknown>).type : undefined
  return moduleDeLAppel(slug, typeof type === 'string' ? type : undefined)
}

function fermer(monde: Monde, sauf: Module | null) {
  const cabinets = new Set<string>([
    ...(monde.base.cabinets ?? []).map((c) => String(c.id)), ...(monde.base.dossiers ?? []).map((d) => String(d.cabinet_id)),
  ])
  for (const c of cabinets) monde.modulesFermes[c] = MODULES_DE_LA_BASE.filter((m) => m !== sauf)
}

async function jouer(slug: FonctionEdge, scenario: Scenario, etat: Etat, module: Module | null) {
  const contrat = CONTRATS.find((c) => c.slug === slug)
  if (!contrat) throw new Error(`pas de contrat pour ${slug}`)
  const { monde, r } = await jouerScenario(contrat, scenario, contexte, {
    apres: (m) => {
      if (etat === 'ferme') fermer(m, null)
      if (etat === 'seul') fermer(m, module)
      if (etat === 'panne') m.pannes.push({ rpc: NOM, erreur: { message: 'délai dépassé' } })
    },
  })
  const lectures = monde.journal.filter((e) => e.genre === 'rpc' && e.nom === NOM)
  return {
    statut: r.statut, erreur: (r.json as { error?: unknown } | undefined)?.error,
    lectures: lectures.map((e) => (e.genre === 'rpc' ? e.role : '')), depenses: depensesDe(monde.journal).map(decrire),
  }
}

it('la liste fermée du faux PostgREST est celle de la migration exportée, et celle de modulesDuCabinet.ts', () => {
  const texte = readFileSync(new URL('../../supabase/schema/20261119140325_options_des_cabinets.sql', import.meta.url), 'utf8')
  const corps = texte.slice(texte.search(/create\s+function\s+public\.modules_ouverts_du_dossier/i))
  const liste = corps.match(/c_modules\s+constant\s+text\[\]\s*:=\s*array\[([^\]]+)\]/i)?.[1] ?? ''
  expect([...liste.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual([...MODULES_DE_LA_BASE])
  expect([...MODULES_DE_LA_BASE]).toEqual([...MODULES_OPTIONNELS])
})

it('huit fonctions exigent un module, chacune a son contrat', () => {
  expect(TOUCHEES).toHaveLength(8)
  for (const slug of TOUCHEES) expect(CONTRATS.some((c) => c.slug === slug), slug).toBe(true)
})

describe.each(TOUCHEES.map((s) => [s] as const))('%s — sous les options du cabinet', (slug) => {
  const scenarios = CONTRATS.find((c) => c.slug === slug)?.scenarios ?? []
  beforeAll(() => prechauffer(sourceDe(slug)))

  it('tout fermé, un scénario qui n’atteint pas la lecture rend ce qu’il rendait ; qui l’atteint, 403 sans rien dépenser', async () => {
    let atteints = 0
    const modulesAtteints = new Set<Module>()
    for (const scenario of scenarios) {
      const module = await moduleDuScenario(slug, scenario)
      const ouvert = await jouer(slug, scenario, 'ouvert', module)
      const ferme = await jouer(slug, scenario, 'ferme', module)
      if (ouvert.lectures.length === 0) {
        expect({ statut: ferme.statut, depenses: ferme.depenses, lectures: ferme.lectures }, scenario.nom)
          .toEqual({ statut: ouvert.statut, depenses: ouvert.depenses, lectures: [] })
        continue
      }
      atteints += 1
      if (module && module !== 'socle') modulesAtteints.add(module)
      expect(module, scenario.nom).not.toBe('socle')
      expect(ouvert.lectures, scenario.nom).toEqual(['authentifie'])
      expect({ statut: ferme.statut, erreur: ferme.erreur, depenses: ferme.depenses }, scenario.nom)
        .toEqual({ statut: 403, erreur: MOTS_DU_REFUS.fonctionFermee, depenses: [] })
    }
    // Le plancher : chaque fonction a des scénarios qui passent sa porte ; send-email, sous chacun de ses trois modèles de
    // la facturation (la relance d'une demande attend sa migration : refusée comme un type inconnu, avant la lecture).
    expect(atteints, 'aucun scénario n’atteint la lecture des options : le jeu serait aveugle').toBeGreaterThan(0)
    if (slug === 'send-email') expect([...modulesAtteints]).toEqual(['facturation'])
  }, 120_000)

  it('son seul module ouvert, chaque scénario rend ce qu’il rendait ; les options en panne, 503 sans rien dépenser', async () => {
    for (const scenario of scenarios) {
      const module = await moduleDuScenario(slug, scenario)
      const ouvert = await jouer(slug, scenario, 'ouvert', module)
      if (ouvert.lectures.length === 0) continue
      const seul = await jouer(slug, scenario, 'seul', module)
      expect({ statut: seul.statut, depenses: seul.depenses }, scenario.nom).toEqual({ statut: ouvert.statut, depenses: ouvert.depenses })
      const panne = await jouer(slug, scenario, 'panne', module)
      expect({ statut: panne.statut, erreur: panne.erreur, depenses: panne.depenses }, scenario.nom)
        .toEqual({ statut: 503, erreur: MOTS_DU_REFUS.fonctionSansOptions, depenses: [] })
    }
  }, 120_000)
})
