import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATS, SCENARIOS_OUVERTURES_ATTESTEES, SCENARIOS_OUVERTURES_NON_ATTESTEES, jugerScenario, type ContratFonction, type Contexte,
} from '../test/contratsFonctions'
import {
  OUVERTURES_ATTESTEES_BAISSEES, OUVERTURES_ATTESTEES_LEVEES, muter, ouverturesAttesteesBaissees, prechauffer, sourceDe,
} from '../test/fonctionsEdge'
import { OUVERTURES_ATTESTEES_PREVUES } from './ouverturesAttestees'

// QUI A OUVERT UN ACCÈS CLIENT, LES APPELS HTTP (P1TQ2-Q1). `create-client-access` n'atteste l'ouverture que sous
// `OUVERTURES_ATTESTEES_EN_BASE`, LEVÉE depuis que la migration `auteur_des_ouvertures_d_acces` est en production (16/11/2026) :
// servie, l'accès écrit sous la clé secrète s'atteste sous la session de l'appelant, une fois, et la réponse dit si
// l'attestation a été écrite (ses contrats, `edgeFunctionsHttp.test.ts`, l'attendent de tout accès écrit). Baissée en mémoire
// (`ouverturesAttesteesBaissees`, l'état d'avant, éprouvé tant que son code existe), la fonction écrit et répond comme avant,
// mot pour mot. Les contrôles qui valent partout (ni secret ni valeur de pièce au journal, aucun hôte non déclaré)
// s'appliquent à chacun.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'create-client-access')
  if (!c) throw new Error('aucun contrat pour create-client-access')
  return c
})()
const servie = () => sourceDe('create-client-access')
const baissee = () => ouverturesAttesteesBaissees(sourceDe('create-client-access'))
const scenario = (motif: RegExp) => {
  const s = SCENARIOS_OUVERTURES_ATTESTEES.find((x) => motif.test(x.nom))
  if (!s) throw new Error(`aucun scénario ${motif}`)
  return s
}
const chefAtteste = /^chef : l’accès écrit sous la clé secrète/

beforeAll(() => { prechauffer(servie()); prechauffer(baissee()) })

describe('la constante de l’attestation et le drapeau de l’écran', () => {
  it('servie, la constante est levée, une fois exactement ; baissée en mémoire, rien d’autre ne change', () => {
    const source = servie()
    expect(source.split(OUVERTURES_ATTESTEES_LEVEES)).toHaveLength(2)
    expect(source.includes(OUVERTURES_ATTESTEES_BAISSEES)).toBe(false)
    expect(baissee().replace(OUVERTURES_ATTESTEES_BAISSEES, OUVERTURES_ATTESTEES_LEVEES)).toBe(source)
  })

  it('l’ordre de mise en production : l’écran ne lit la table que sur une fonction qui l’écrit', () => {
    expect(!OUVERTURES_ATTESTEES_PREVUES || servie().includes(OUVERTURES_ATTESTEES_LEVEES),
      'OUVERTURES_ATTESTEES_PREVUES levé sur une create-client-access dont OUVERTURES_ATTESTEES_EN_BASE est baissée').toBe(true)
  })

  it('baissée en mémoire : rien d’attesté, la réponse d’avant — le scénario de l’attestation tombe', async () => {
    expect(await jugerScenario(contrat, scenario(chefAtteste), contexte, baissee())).not.toEqual([])
  })
})

describe('create-client-access servie (constante levée) : l’ouverture attestée', () => {
  it.each(SCENARIOS_OUVERTURES_ATTESTEES.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, servie())).toEqual([])
  })
})

describe('create-client-access, constante baissée en mémoire : l’état d’avant, éprouvé tant que son code existe', () => {
  it.each(SCENARIOS_OUVERTURES_NON_ATTESTEES.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, baissee())).toEqual([])
  })

  it('servie, le scénario d’avant tombe : la réponse porte l’attestation', async () => {
    expect(await jugerScenario(contrat, SCENARIOS_OUVERTURES_NON_ATTESTEES[0], contexte, servie())).not.toEqual([])
  })
})

// Des défauts PLANTÉS dans la source levée : les juges voient ce qu'ils gardent.
describe('les juges voient ce qu’ils gardent', () => {
  it('l’attestation sous la clé secrète (le client du service) : le compte n’est plus celui de la session, le chef tombe', async () => {
    const mutee = muter(servie(), [['await attesterLOuverture(supabaseAsCaller, ', 'await attesterLOuverture(supabaseAdmin, ']])
    expect(await jugerScenario(contrat, scenario(chefAtteste), contexte, mutee)).not.toEqual([])
  })

  it('l’attestation avant l’écriture : le chef tombe', async () => {
    const mutee = muter(servie(), [
      ['  const insertion = supabaseAdmin\n', '  await attesterLOuverture(supabaseAsCaller, dossierId, "avant")\n  const insertion = supabaseAdmin\n'],
    ])
    expect(await jugerScenario(contrat, scenario(chefAtteste), contexte, mutee)).not.toEqual([])
  })

  it('une panne de l’attestation qui défait la réponse : le scénario de la panne tombe', async () => {
    const mutee = muter(servie(), [['    return !error\n', '    if (error) throw new Error("panne")\n    return true\n'],
      ['  } catch {\n    return false\n  }\n}\n\nDeno.serve', '  } catch {\n    throw new Error("panne")\n  }\n}\n\nDeno.serve']])
    expect(await jugerScenario(contrat, scenario(/^le chef, l’attestation en panne/), contexte, mutee)).not.toEqual([])
  })

  it('la réponse qui tait l’issue de l’attestation : le chef tombe', async () => {
    const mutee = muter(servie(), [['    return json({ ok: true, compte, ouvertureAttestee })\n', '    void ouvertureAttestee\n    return json({ ok: true, compte })\n']])
    expect(await jugerScenario(contrat, scenario(chefAtteste), contexte, mutee)).not.toEqual([])
  })
})
