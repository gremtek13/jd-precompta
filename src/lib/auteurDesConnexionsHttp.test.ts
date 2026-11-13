import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATS, SCENARIOS_AUTEUR_DES_CONNEXIONS, jugerScenario, type ContratFonction, type Contexte,
} from '../test/contratsFonctions'
import {
  AUTEUR_DES_CONNEXIONS_BAISSE, AUTEUR_DES_CONNEXIONS_LEVE, auteurDesConnexionsLeve, muter, prechauffer, sourceDe,
} from '../test/fonctionsEdge'
import { AUTEUR_DES_CONNEXIONS_PREVU } from './auteurDesConnexions'

// QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT, LES APPELS HTTP (B4RS-Q1, tranchée par le cabinet le 12/11/2026 :
// « (B) Garder EC-Q4, refuser sur une connexion écrite par un client »). `plateforme-agreee` ne lit l'auteur que sous
// `AUTEUR_DES_CONNEXIONS_EN_BASE`, baissée tant que la migration préparée `auteur_des_connexions_plateformes` n'est pas en
// base : servie, la fonction est celle d'hier ; levée en mémoire (`auteurDesConnexionsLeve`), la réception par le client se
// refuse sur une connexion que le cabinet n'a pas écrite, avant tout appel à la plateforme, le cabinet atteste ce qu'il
// enregistre sous sa session, le client jamais, et la vue dit si le cabinet a écrit la configuration — jamais qui.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'plateforme-agreee')
  if (!c) throw new Error('aucun contrat pour plateforme-agreee')
  return c
})()
const servie = () => sourceDe('plateforme-agreee')
const levee = () => auteurDesConnexionsLeve(sourceDe('plateforme-agreee'))
const scenario = (motif: RegExp) => {
  const s = SCENARIOS_AUTEUR_DES_CONNEXIONS.find((x) => motif.test(x.nom))
  if (!s) throw new Error(`aucun scénario ${motif}`)
  return s
}
const REFUS_LISTE = /^lister_achats — une connexion que le cabinet n’a pas écrite/
const REFUS_RECEPTION = /^recevoir_achat — une connexion que le cabinet n’a pas écrite/
const CHEF = /^enregistrer — le chef : la configuration écrite, puis attestée/
const CLIENT = /^enregistrer — le client « Ventes »/
const STATUT = /^statut — la vue dit que le cabinet a écrit/

beforeAll(() => { prechauffer(servie()); prechauffer(levee()) })

describe('la constante de l’auteur des connexions et le drapeau de l’écran', () => {
  it('servie, la constante est baissée, une fois exactement ; levée en mémoire, rien d’autre ne change', () => {
    const source = servie()
    expect(source.split(AUTEUR_DES_CONNEXIONS_BAISSE)).toHaveLength(2)
    expect(source.includes(AUTEUR_DES_CONNEXIONS_LEVE)).toBe(false)
    expect(levee().replace(AUTEUR_DES_CONNEXIONS_LEVE, AUTEUR_DES_CONNEXIONS_BAISSE)).toBe(source)
  })

  it('l’écran ne dit l’auteur que d’une fonction qui le lit', () => {
    expect(!AUTEUR_DES_CONNEXIONS_PREVU || servie().includes(AUTEUR_DES_CONNEXIONS_LEVE),
      'AUTEUR_DES_CONNEXIONS_PREVU levé sur une plateforme-agreee dont AUTEUR_DES_CONNEXIONS_EN_BASE est baissée').toBe(true)
  })
})

describe('plateforme-agreee servie (constante baissée) : la fonction d’hier', () => {
  it('la réception par le client ne regarde pas l’auteur : le refus tombe', async () => {
    expect(await jugerScenario(contrat, scenario(REFUS_RECEPTION), contexte, servie())).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(REFUS_LISTE), contexte, servie())).not.toEqual([])
  })

  it('le chef enregistre sans rien attester, et la vue ne dit rien de l’auteur : le scénario d’après tombe', async () => {
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, servie())).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(STATUT), contexte, servie())).not.toEqual([])
  })
})

describe('plateforme-agreee, constante levée en mémoire : l’auteur de la connexion', () => {
  it.each(SCENARIOS_AUTEUR_DES_CONNEXIONS.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, levee())).toEqual([])
  })
})

// Des défauts PLANTÉS dans la source levée : les juges voient ce qu'ils gardent.
describe('les juges voient ce qu’ils gardent', () => {
  it('le refus retiré : la réception part sur une connexion du client, les deux refus tombent', async () => {
    const mutee = muter(levee(), [['if (AUTEUR_DES_CONNEXIONS_EN_BASE && connexion.ecrite_par == null) {', 'if (false) {']])
    expect(await jugerScenario(contrat, scenario(REFUS_RECEPTION), contexte, mutee)).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(REFUS_LISTE), contexte, mutee)).not.toEqual([])
  })

  it('l’attestation oubliée : le chef enregistre une connexion qui reste à personne', async () => {
    const mutee = muter(levee(), [['if (!AUTEUR_DES_CONNEXIONS_EN_BASE || !lus.droits.cabinet) return', 'if (true) return']])
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, mutee)).not.toEqual([])
  })

  it('l’attestation demandée pour le client aussi : le scénario du client tombe', async () => {
    const mutee = muter(levee(), [['if (!AUTEUR_DES_CONNEXIONS_EN_BASE || !lus.droits.cabinet) return', 'if (!AUTEUR_DES_CONNEXIONS_EN_BASE) return']])
    expect(await jugerScenario(contrat, scenario(CLIENT), contexte, mutee)).not.toEqual([])
  })

  it('la vue qui nomme le compte de l’auteur : le statut et l’enregistrement du chef tombent', async () => {
    const mutee = muter(levee(), [['{ ecrite_par_le_cabinet: c.ecrite_par !== null, ecrite_le: c.ecrite_le ?? null }',
      '{ ecrite_par_le_cabinet: c.ecrite_par !== null, ecrite_le: c.ecrite_le ?? null, ecrite_par: c.ecrite_par }']])
    expect(await jugerScenario(contrat, scenario(STATUT), contexte, mutee)).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, mutee)).not.toEqual([])
  })
})
