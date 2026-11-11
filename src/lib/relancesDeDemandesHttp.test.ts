import { beforeAll, describe, expect, it } from 'vitest'
import {
  CONTRATS, SCENARIOS_RELANCES_DE_DEMANDES, SCENARIO_RELANCE_DE_DEMANDE_AVANT_SA_MIGRATION, jugerScenario,
  type ContratFonction, type Contexte,
} from '../test/contratsFonctions'
import { RELANCES_DE_DEMANDES_BAISSEES, RELANCES_DE_DEMANDES_LEVEES, muter, prechauffer, relancesDeDemandesLevees, sourceDe } from '../test/fonctionsEdge'
import { RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE } from './documentsEtDemandes'

// LA RELANCE D'UNE DEMANDE DU CABINET PAR E-MAIL, LES APPELS HTTP (étape B3b, ligne 51.5). `send-email` n'admet le modèle
// « relance_demande » que sous `RELANCES_DE_DEMANDES_EN_BASE`, baissée tant que la migration préparée
// `relance_des_demandes_par_email` n'est pas en base : servie, la fonction le refuse comme un type inconnu, mot pour mot ;
// levée en mémoire (`relancesDeDemandesLevees`), elle se joue : le cabinet seul relance, l'adresse est celle de l'accès,
// jamais celle du corps, le texte ne recopie pas le détail, le journal et la relance s'inscrivent d'un tenant. Les
// contrôles qui valent partout (ni secret ni valeur de pièce au journal, aucun hôte non déclaré) s'appliquent à chacun.

const contexte: Contexte = { entetesDuNavigateur: [] }
const contrat: ContratFonction = (() => {
  const c = CONTRATS.find((x) => x.slug === 'send-email')
  if (!c) throw new Error('aucun contrat pour send-email')
  return c
})()
const servie = () => sourceDe('send-email')
const levee = () => relancesDeDemandesLevees(sourceDe('send-email'))

beforeAll(() => { prechauffer(servie()); prechauffer(levee()) })

describe('la constante de la relance d’une demande et le drapeau de l’écran', () => {
  it('servie, la constante est baissée, une fois exactement ; levée en mémoire, rien d’autre ne change', () => {
    const source = servie()
    expect(source.split(RELANCES_DE_DEMANDES_BAISSEES)).toHaveLength(2)
    expect(source.includes(RELANCES_DE_DEMANDES_LEVEES)).toBe(false)
    expect(levee().replace(RELANCES_DE_DEMANDES_LEVEES, RELANCES_DE_DEMANDES_BAISSEES)).toBe(source)
  })

  it('l’ordre de mise en production : le bouton ne s’offre jamais sur une fonction qui refuserait la relance', () => {
    const servieLevee = servie().includes(RELANCES_DE_DEMANDES_LEVEES)
    expect(!RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE || servieLevee,
      'RELANCE_DES_DEMANDES_PAR_EMAIL_PREVUE levé sur une send-email dont RELANCES_DE_DEMANDES_EN_BASE est baissée').toBe(true)
  })
})

describe('send-email servie (constante baissée) : l’état d’avant la migration', () => {
  it('la relance d’une demande se refuse comme un type inconnu, rien de lu ni d’envoyé', async () => {
    expect(await jugerScenario(contrat, SCENARIO_RELANCE_DE_DEMANDE_AVANT_SA_MIGRATION, contexte, servie())).toEqual([])
  })

  it('levée, la même relance part : le scénario d’avant tombe', async () => {
    expect(await jugerScenario(contrat, SCENARIO_RELANCE_DE_DEMANDE_AVANT_SA_MIGRATION, contexte, levee())).not.toEqual([])
  })
})

describe('send-email, constante levée en mémoire : la relance d’une demande', () => {
  it.each(SCENARIOS_RELANCES_DE_DEMANDES.map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(contrat, scenario, contexte, levee())).toEqual([])
  })
})

// Des défauts PLANTÉS dans la source levée : les juges voient ce qu'ils gardent.
describe('les juges voient ce qu’ils gardent', () => {
  const scenario = (motif: RegExp) => {
    const s = SCENARIOS_RELANCES_DE_DEMANDES.find((x) => motif.test(x.nom))
    if (!s) throw new Error(`aucun scénario ${motif}`)
    return s
  }
  const admis = /^relance_demande — le chef : admis$/

  it('l’adresse du corps reprise : l’envoi part ailleurs, le chef admis tombe', async () => {
    const mutee = muter(levee(), [['    adresse = adresseDeLAcces\n', '']])
    expect(await jugerScenario(contrat, scenario(admis), contexte, mutee)).not.toEqual([])
  })

  it('le détail recopié dans le corps : le chef admis tombe', async () => {
    const mutee = muter(levee(), [['.select("id, objet, echeance, close_le")', '.select("id, objet, detail, echeance, close_le")'],
      ['</strong> »${demande.echeance', '</strong> »${(demande as unknown as { detail: string }).detail}${demande.echeance']])
    expect(await jugerScenario(contrat, scenario(admis), contexte, mutee)).not.toEqual([])
  })

  it('la relance ouverte au client « Ventes » : la matrice tombe', async () => {
    const mutee = muter(levee(), [['  relance_demande: "cabinet",', '  relance_demande: "ventes",']])
    expect(await jugerScenario(contrat, scenario(/^relance_demande — client « Ventes » : refusé/), contexte, mutee)).not.toEqual([])
  })

  it('la demande close relancée : son refus tombe', async () => {
    const mutee = muter(levee(), [['    if (demande.close_le !== null) {', '    if (demande.close_le === "jamais") {']])
    expect(await jugerScenario(contrat, scenario(/une demande close/), contexte, mutee)).not.toEqual([])
  })

  it('l’accès lu sans son dossier : le compte sans accès passe, son refus tombe', async () => {
    const mutee = muter(levee(), [['.select("email").eq("dossier_id", dossierId).eq("user_id", accesId)', '.select("email").eq("user_id", accesId)']])
    expect(await jugerScenario(contrat, scenario(/un compte sans accès/), contexte, mutee)).not.toEqual([])
  })

  // B3B-Q3 : la signature est le nom du cabinet lu en base, et un nom illisible ne refuse rien.
  it('la signature d’hier remise en dur : le chef admis tombe', async () => {
    const mutee = muter(levee(), [['    nomExpediteur = signature\n', '    nomExpediteur = "Votre cabinet comptable"\n'],
      ['Cordialement,<br>${echapper(signature)}</p>', 'Cordialement,<br>Votre cabinet comptable</p>']])
    expect(await jugerScenario(contrat, scenario(admis), contexte, mutee)).not.toEqual([])
  })

  it('une lecture en panne qui refuserait la relance : la retombée tombe', async () => {
    const mutee = muter(levee(), [['    const signature = await nomDuCabinetQuiSigne(admin, dossierId)\n',
      '    const signature = await nomDuCabinetQuiSigne(admin, dossierId)\n    if (signature === SIGNATURE_DU_CABINET_PAR_DEFAUT) return json({ error: "Le cabinet ne se lit pas." }, 503)\n']])
    expect(await jugerScenario(contrat, scenario(/la lecture du cabinet en panne/), contexte, mutee)).not.toEqual([])
  })

  it('la panne de la lecture du dossier atteint bien la retombée : une autre signature y tombe', async () => {
    const mutee = muter(levee(), [['le cabinet du dossier ne se lit pas, signature par défaut")\n      return SIGNATURE_DU_CABINET_PAR_DEFAUT',
      'le cabinet du dossier ne se lit pas, signature par défaut")\n      return "Une signature fautive"']])
    expect(await jugerScenario(contrat, scenario(/le dossier sans cabinet rendu/), contexte, mutee)).not.toEqual([])
  })

  it('un nom vide gardé tel quel : la retombée tombe', async () => {
    const mutee = muter(levee(), [['typeof nom !== "string" || nom.trim() === ""', 'typeof nom !== "string"']])
    expect(await jugerScenario(contrat, scenario(/le nom du cabinet vide/), contexte, mutee)).not.toEqual([])
  })
})
