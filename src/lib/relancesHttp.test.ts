import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, SCENARIOS_RELANCES, jugerScenario, type ContratFonction, type Contexte } from '../test/contratsFonctions'
import { RELANCES_BAISSEES, RELANCES_LEVEES, muter, prechauffer, relancesLevees, sourceDe } from '../test/fonctionsEdge'
import { RELANCES_EXPORTEES } from './relances'

// LA RELANCE D'UNE FACTURE EN RETARD, LES APPELS HTTP CONSTANTE LEVÉE (étape C5, ligne 51.5). `send-email` n'admet le
// modèle « relance_facture » que sous `RELANCES_EN_BASE`, baissée tant que la migration préparée `relances_des_factures`
// n'est pas en base : la ligne de journal d'une relance y serait refusée APRÈS l'envoi, et l'e-mail ne compterait pas
// dans le plafond d'un accès client. Le contrat de la source servie (edgeFunctionsHttp.test.ts) éprouve le refus d'avant ;
// ceux-ci jouent la source du jour d'après, la constante levée en mémoire : le client « Ventes » relance ses factures, un
// client sans « Ventes » reçoit 404, des droits illisibles 503, le plafond de trente par jour de Paris, et les refus
// d'une facture qui n'est pas en retard au jour de Paris. Les contrôles qui valent partout (ni secret ni valeur de pièce
// au journal, aucun hôte non déclaré) s'appliquent à chaque scénario.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'send-email')
  if (!c) throw new Error('aucun contrat pour send-email')
  return c
})()
const levee = () => relancesLevees(sourceDe('send-email'))

beforeAll(() => { prechauffer(levee()) })

describe('la constante de la relance et le drapeau de l’écran', () => {
  it('servie, la constante est baissée, une fois exactement ; levée en mémoire, rien d’autre ne change', () => {
    const source = sourceDe('send-email')
    expect(source.split(RELANCES_BAISSEES)).toHaveLength(2)
    expect(source.includes(RELANCES_LEVEES)).toBe(false)
    expect(levee().replace(RELANCES_LEVEES, RELANCES_BAISSEES)).toBe(source)
  })

  it('l’ordre de mise en production : le bouton ne s’offre jamais sur une fonction qui refuserait la relance', () => {
    const servieLevee = sourceDe('send-email').includes(RELANCES_LEVEES)
    expect(!RELANCES_EXPORTEES || servieLevee, 'RELANCES_EXPORTEES levé sur une send-email dont RELANCES_EN_BASE est baissée').toBe(true)
  })
})

describe('send-email, constante levée : la relance d’une facture', () => {
  it.each(SCENARIOS_RELANCES.map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(contrat, scenario, contexte, levee())).toEqual([])
  })
})

// Des défauts PLANTÉS dans la source levée : les juges voient ce qu'ils gardent.
describe('les juges voient ce qu’ils gardent', () => {
  const scenario = (motif: RegExp) => {
    const s = SCENARIOS_RELANCES.find((x) => motif.test(x.nom))
    if (!s) throw new Error(`aucun scénario ${motif}`)
    return s
  }

  it('l’échéance jugée au jour d’UTC : la relance de 00 h 30 à Paris tombe', async () => {
    const mutee = muter(levee(), [['refusDeLaRelance(facture, jourCivilDeParis(Date.now()))', 'refusDeLaRelance(facture, new Date(Date.now()).toISOString().slice(0, 10))']])
    expect(await jugerScenario(contrat, scenario(/00 h 30 à Paris/), contexte, mutee)).not.toEqual([])
  })

  it('le jour de l’échéance compté en retard : le refus tombe', async () => {
    const mutee = muter(levee(), [['if (f.date_echeance >= aujourdHui) {', 'if (f.date_echeance > aujourdHui) {']])
    expect(await jugerScenario(contrat, scenario(/le jour de l’échéance/), contexte, mutee)).not.toEqual([])
  })

  it('la relance ouverte au cabinet seul : le client « Ventes » refusé, la matrice tombe', async () => {
    const mutee = muter(levee(), [['  relance_facture: "ventes",', '  relance_facture: "cabinet",']])
    expect(await jugerScenario(contrat, scenario(/^relance_facture — .*« Ventes ».*: admis$/), contexte, mutee)).not.toEqual([])
  })

  it('le journal qui ne cite pas la facture : « Relancée le … » ne se déduirait plus', async () => {
    const mutee = muter(levee(), [['    factureId = factureRelanceeId\n', '']])
    expect(await jugerScenario(contrat, scenario(/le cabinet n’est pas plafonné/), contexte, mutee)).not.toEqual([])
  })
})
