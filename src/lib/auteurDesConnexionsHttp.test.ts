import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATS, SCENARIOS_AUTEUR_DES_CONNEXIONS, SCENARIOS_AUTEUR_NON_LU, SCENARIOS_RECEPTION_SOUS_L_AUTEUR, jugerScenario,
  type ContratFonction, type Contexte,
} from '../test/contratsFonctions'
import {
  AUTEUR_DES_CONNEXIONS_BAISSE, AUTEUR_DES_CONNEXIONS_LEVE, auteurDesConnexionsBaissee, muter, prechauffer, sourceDe,
} from '../test/fonctionsEdge'
import { AUTEUR_DES_CONNEXIONS_PREVU } from './auteurDesConnexions'

// QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT, LES APPELS HTTP (B4RS-Q1, tranchée par le cabinet le 12/11/2026 :
// « (B) Garder EC-Q4, refuser sur une connexion écrite par un client »). `plateforme-agreee` ne lit l'auteur que sous
// `AUTEUR_DES_CONNEXIONS_EN_BASE`, LEVÉE depuis que la migration `auteur_des_connexions_plateformes` est en production
// (15/11/2026) : servie, la réception par le client se refuse sur une connexion que le cabinet n'a pas écrite, avant tout
// appel à la plateforme, et aboutit sur une qu'il a écrite (les scénarios de B4r), le cabinet atteste ce qu'il enregistre
// sous sa session, le client jamais, et la vue dit si le cabinet a écrit la configuration — jamais qui. Baissée en mémoire
// (`auteurDesConnexionsBaissee`, l'état d'avant, éprouvé tant que son code existe), la fonction ne sait pas qui a écrit la
// connexion, et la réception par un accès client se refuse toujours (`auteur_de_la_connexion_non_lu`,
// `SCENARIOS_AUTEUR_NON_LU`), celle du cabinet restant celle d'hier.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'plateforme-agreee')
  if (!c) throw new Error('aucun contrat pour plateforme-agreee')
  return c
})()
const servie = () => sourceDe('plateforme-agreee')
const baissee = () => auteurDesConnexionsBaissee(sourceDe('plateforme-agreee'))
const scenario = (motif: RegExp) => {
  const s = [...SCENARIOS_AUTEUR_DES_CONNEXIONS, ...SCENARIOS_RECEPTION_SOUS_L_AUTEUR, ...SCENARIOS_AUTEUR_NON_LU, ...contrat.scenarios]
    .find((x) => motif.test(x.nom))
  if (!s) throw new Error(`aucun scénario ${motif}`)
  return s
}
const REFUS_LISTE = /^lister_achats — une connexion que le cabinet n’a pas écrite/
const REFUS_RECEPTION = /^recevoir_achat — une connexion que le cabinet n’a pas écrite/
const CHEF = /^enregistrer — le chef : la configuration écrite, puis attestée/
const CLIENT = /^enregistrer — le client « Ventes »/
const STATUT = /^statut — la vue dit que le cabinet a écrit/
const PART_LISTE = /^lister_achats — une connexion que le cabinet a écrite/
const PART_RECEPTION = /^recevoir_achat — une connexion que le cabinet a écrite/
const NON_LU_LISTE = /^lister_achats — client « Achats » sur la base de demain, l’auteur de la connexion non lu/
const NON_LU_RECEPTION = /^recevoir_achat — client « Achats » sur la base de demain, l’auteur de la connexion non lu/
const CHEF_LISTE = /^lister_achats — le chef sur la base de demain/
const CHEF_RECEPTION = /^recevoir_achat — le chef sur la base de demain/
const B4R_LISTE = /^lister_achats — client « Achats » sur la base de demain : les achats seuls/
const B4R_AUTRE = /^recevoir_achat — une facture adressée à une autre entreprise/
// Le refus de l'auteur non lu, tel que la source le porte (il ne mord que la constante baissée).
const REFUS_NON_LU = 'if (!AUTEUR_DES_CONNEXIONS_EN_BASE && !c.cabinet) {'
const juger = async (motif: RegExp, source: string) => jugerScenario(contrat, scenario(motif), contexte, source)

beforeAll(() => { prechauffer(servie()); prechauffer(baissee()) })

describe('la constante de l’auteur des connexions et le drapeau de l’écran', () => {
  it('servie, la constante est levée, une fois exactement ; baissée en mémoire, rien d’autre ne change', () => {
    const source = servie()
    expect(source.split(AUTEUR_DES_CONNEXIONS_LEVE)).toHaveLength(2)
    expect(source.includes(AUTEUR_DES_CONNEXIONS_BAISSE)).toBe(false)
    expect(baissee().replace(AUTEUR_DES_CONNEXIONS_BAISSE, AUTEUR_DES_CONNEXIONS_LEVE)).toBe(source)
  })

  it('l’écran ne dit l’auteur que d’une fonction qui le lit', () => {
    expect(!AUTEUR_DES_CONNEXIONS_PREVU || servie().includes(AUTEUR_DES_CONNEXIONS_LEVE),
      'AUTEUR_DES_CONNEXIONS_PREVU levé sur une plateforme-agreee dont AUTEUR_DES_CONNEXIONS_EN_BASE est baissée').toBe(true)
  })
})

describe('plateforme-agreee, constante baissée en mémoire (l’état d’avant la migration) : l’auteur non lu', () => {
  it.each(SCENARIOS_AUTEUR_NON_LU.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, baissee())).toEqual([])
  })

  it('la réception par un accès client se refuse sous une autre raison que l’auteur lu : les scénarios d’après tombent', async () => {
    expect(await juger(REFUS_RECEPTION, baissee())).not.toEqual([])
    expect(await juger(REFUS_LISTE, baissee())).not.toEqual([])
    expect(await juger(PART_RECEPTION, baissee())).not.toEqual([])
    expect(await juger(PART_LISTE, baissee())).not.toEqual([])
  })

  it('le chef enregistre sans rien attester, et la vue ne dit rien de l’auteur : le scénario d’après tombe', async () => {
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, baissee())).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(STATUT), contexte, baissee())).not.toEqual([])
  })
})

describe('plateforme-agreee servie (constante levée) : l’auteur non lu ne se dit plus', () => {
  it('ses scénarios tombent : la relève se juge sur l’auteur lu, celle du chef comme celle du client', async () => {
    for (const motif of [NON_LU_LISTE, NON_LU_RECEPTION, CHEF_LISTE, CHEF_RECEPTION]) expect(await juger(motif, servie())).not.toEqual([])
  })
})

describe('plateforme-agreee servie (constante levée) : l’auteur de la connexion', () => {
  it.each(SCENARIOS_AUTEUR_DES_CONNEXIONS.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, servie())).toEqual([])
  })
})

describe('plateforme-agreee servie (constante levée) : la réception par l’accès « Achats » (B4r), sur une connexion du cabinet', () => {
  it.each(SCENARIOS_RECEPTION_SOUS_L_AUTEUR.map((s) => [s.nom, s] as const))('%s', async (_nom, s) => {
    expect(await jugerScenario(contrat, s, contexte, servie())).toEqual([])
  })
})

// Des défauts PLANTÉS dans la source BAISSÉE en mémoire : le refus de l'auteur non lu, tant que son code existe.
describe('le refus de l’auteur non lu : les juges voient ce qu’ils gardent', () => {
  it.each([['lister_achats', NON_LU_LISTE], ['recevoir_achat', NON_LU_RECEPTION]] as const)(
    'le refus ôté pour %s seule : son scénario tombe', async (action, motif) => {
      const mutee = muter(baissee(), [[REFUS_NON_LU, `if (!AUTEUR_DES_CONNEXIONS_EN_BASE && !c.cabinet && action !== "${action}") {`]])
      expect(await juger(motif, mutee)).not.toEqual([])
    })

  it('le refus posé après la lecture de la connexion : les deux scénarios tombent', async () => {
    const mutee = muter(baissee(), [
      [REFUS_NON_LU, 'if (false) {'],
      ['  const hote = new URL(connexion.url_flux).hostname\n  if (action === "recevoir_achat" && payload.version',
        '  if (!c.cabinet) return json({ error: "Refus planté.", raison: "auteur_de_la_connexion_non_lu" }, 409)\n'
        + '  const hote = new URL(connexion.url_flux).hostname\n  if (action === "recevoir_achat" && payload.version'],
    ])
    expect(await juger(NON_LU_LISTE, mutee)).not.toEqual([])
    expect(await juger(NON_LU_RECEPTION, mutee)).not.toEqual([])
  })

  it('le refus posé après l’appel à la plateforme : la relève a dépensé avant de refuser', async () => {
    const mutee = muter(baissee(), [
      [REFUS_NON_LU, 'if (false) {'],
      ['  if (action === "lister_achats") return await listerLesAchats(c, connexion, hote, depuis)',
        '  if (action === "lister_achats") {\n    const rendue = await listerLesAchats(c, connexion, hote, depuis)\n'
        + '    if (!c.cabinet) return json({ error: "Refus planté.", raison: "auteur_de_la_connexion_non_lu" }, 409)\n    return rendue\n  }'],
    ])
    expect(await juger(NON_LU_LISTE, mutee)).not.toEqual([])
  })

  it('le refus appliqué aussi au cabinet : la relève du chef tombe', async () => {
    const mutee = muter(baissee(), [[REFUS_NON_LU, 'if (!AUTEUR_DES_CONNEXIONS_EN_BASE) {']])
    expect(await juger(CHEF_LISTE, mutee)).not.toEqual([])
    expect(await juger(CHEF_RECEPTION, mutee)).not.toEqual([])
  })

  it('l’appelant pris pour le cabinet : la relève du client part', async () => {
    const mutee = muter(baissee(), [['cabinet: lus.droits.cabinet,', 'cabinet: true,']])
    expect(await juger(NON_LU_LISTE, mutee)).not.toEqual([])
    expect(await juger(NON_LU_RECEPTION, mutee)).not.toEqual([])
  })

  it('la constante ignorée : levée, la relève du client sur une connexion du cabinet reste fermée', async () => {
    const mutee = muter(servie(), [[REFUS_NON_LU, 'if (!c.cabinet) {']])
    expect(await juger(PART_LISTE, mutee)).not.toEqual([])
    expect(await juger(PART_RECEPTION, mutee)).not.toEqual([])
    expect(await juger(B4R_LISTE, mutee)).not.toEqual([])
  })
})

// Des défauts PLANTÉS dans la source servie (levée) : les juges voient ce qu'ils gardent.
describe('les juges voient ce qu’ils gardent', () => {
  it('le refus retiré : la réception part sur une connexion du client, les deux refus tombent', async () => {
    const mutee = muter(servie(), [['if (AUTEUR_DES_CONNEXIONS_EN_BASE && connexion.ecrite_par == null) {', 'if (false) {']])
    expect(await jugerScenario(contrat, scenario(REFUS_RECEPTION), contexte, mutee)).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(REFUS_LISTE), contexte, mutee)).not.toEqual([])
  })

  // LA RÉCEPTION PAR LE CLIENT « ACHATS » (étape B4r) : les ventes demandées, le point de reprise du cabinet lu, l'acheteur
  // non vérifié.
  it('les ventes demandées à la plateforme pour le client : la relève tombe', async () => {
    const mutee = muter(servie(), [['const TYPES_ACHATS = ["SupplierInvoice"]', 'const TYPES_ACHATS = ["SupplierInvoice", "CustomerInvoice"]']])
    expect(await juger(B4R_LISTE, mutee)).not.toEqual([])
  })

  it('le point de reprise du cabinet lu par la relève du client : la relève tombe', async () => {
    const mutee = muter(servie(), [['  if (action === "lister_achats") return await listerLesAchats(c, connexion, hote, depuis)',
      '  if (action === "lister_achats") return await listerLesAchats(c, connexion, hote, connexion.recherche_depuis)']])
    expect(await juger(B4R_LISTE, mutee)).not.toEqual([])
  })

  it('l’acheteur de la facture non vérifié : la facture d’une autre entreprise tombe', async () => {
    const mutee = muter(servie(), [['  if (concordance === "autre") return json({ hote, flowId, issue: "autre_entreprise" })\n', '']])
    expect(await juger(B4R_AUTRE, mutee)).not.toEqual([])
  })

  it('l’attestation oubliée : le chef enregistre une connexion qui reste à personne', async () => {
    const mutee = muter(servie(), [['if (!AUTEUR_DES_CONNEXIONS_EN_BASE || !lus.droits.cabinet) return', 'if (true) return']])
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, mutee)).not.toEqual([])
  })

  it('l’attestation demandée pour le client aussi : le scénario du client tombe', async () => {
    const mutee = muter(servie(), [['if (!AUTEUR_DES_CONNEXIONS_EN_BASE || !lus.droits.cabinet) return', 'if (!AUTEUR_DES_CONNEXIONS_EN_BASE) return']])
    expect(await jugerScenario(contrat, scenario(CLIENT), contexte, mutee)).not.toEqual([])
  })

  it('la vue qui nomme le compte de l’auteur : le statut et l’enregistrement du chef tombent', async () => {
    const mutee = muter(servie(), [['{ ecrite_par_le_cabinet: c.ecrite_par !== null, ecrite_le: c.ecrite_le ?? null }',
      '{ ecrite_par_le_cabinet: c.ecrite_par !== null, ecrite_le: c.ecrite_le ?? null, ecrite_par: c.ecrite_par }']])
    expect(await jugerScenario(contrat, scenario(STATUT), contexte, mutee)).not.toEqual([])
    expect(await jugerScenario(contrat, scenario(CHEF), contexte, mutee)).not.toEqual([])
  })
})
