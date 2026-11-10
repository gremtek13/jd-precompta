import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPTIONS_DES_REGIMES, SAISIE_INTERNATIONALE_VIDE, ceQueLaFactureInternationaleImprime, champsInternationaux,
  confirmationInternationale, horsTvaQuiPart, internationaleOuverte, internationaleQuiPart, jugementInternational,
  mentionDuRegimeDite, numeroDeTvaOuvert, saisieInternationaleLue, type InternationaleAJuger,
} from './factureInternationaleVue'
import { MENTIONS_DES_REGIMES, REFUS_DE_LA_FACTURE_INTERNATIONALE, REFUS_DE_LA_MENTION_DU_DOSSIER, REGIMES_INTERNATIONAUX } from './factureInternationale'
import { MENTION_FRANCHISE } from './statutTva'

// LA FACTURE À UN CLIENT ÉTABLI HORS DE FRANCE, À L'ÉCRAN (étape e7b) : l'assemblage de la saisie telle qu'elle part, ses refus
// tirés du module des règles (jamais recopiés : chaque attente se lit dans `REFUS_DE_LA_FACTURE_INTERNATIONALE`), la
// confirmation, l'impression d'une facture figée. Le drapeau `FACTURE_INTERNATIONALE_EXPORTEE` est joué par un accesseur, état
// par état : baissé, rien ne part, rien ne se refuse, rien ne s'imprime.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./factureInternationale', async (original) => {
  const vrai = await original<typeof import('./factureInternationale')>()
  return { ...vrai, get FACTURE_INTERNATIONALE_EXPORTEE() { return drapeau.leve } }
})
afterEach(() => { drapeau.leve = true })

const AUTOLIQUIDATION = { pays: ' de', numeroTva: 'de 123 456 789', regime: 'autoliquidation_ue' as const }
const aJuger = (o: Partial<InternationaleAJuger> = {}): InternationaleAJuger => ({
  qp: internationaleQuiPart(AUTOLIQUIDATION, 'etranger'), typeClient: 'etranger', nature: 'services', statutTva: 'redevable',
  numeroTvaDuVendeur: 'FR40123456824', montantTva: 0, tauxDesLignes: [0], mentionDuDossier: null, mentionsLegales: '', ...o,
})

describe('la saisie telle qu’elle part', () => {
  it('le pays et le numéro en capitales, sans blanc ; le numéro tu pour un particulier ; rien pour un autre client', () => {
    expect(internationaleQuiPart(AUTOLIQUIDATION, 'etranger')).toEqual({ pays: 'DE', numeroTva: 'DE123456789', regime: 'autoliquidation_ue' })
    expect(internationaleQuiPart({ ...AUTOLIQUIDATION, regime: 'hors_champ' }, 'non_assujetti'))
      .toEqual({ pays: 'DE', numeroTva: null, regime: 'hors_champ' })
    for (const type of ['assujetti', 'organisme_public', '', null] as const) {
      expect(internationaleQuiPart(AUTOLIQUIDATION, type)).toEqual({ pays: null, numeroTva: null, regime: null })
    }
    expect(internationaleQuiPart(SAISIE_INTERNATIONALE_VIDE, 'etranger')).toEqual({ pays: null, numeroTva: null, regime: null })
    expect(numeroDeTvaOuvert('non_assujetti')).toBe(false)
  })

  it('les trois clés partent toujours drapeau levé (un champ caché à nul), aucune drapeau baissé', () => {
    expect(champsInternationaux({ pays: null, numeroTva: null, regime: null }))
      .toEqual({ client_pays: null, client_numero_tva: null, regime_international: null })
    drapeau.leve = false
    expect(champsInternationaux({ pays: 'DE', numeroTva: null, regime: 'exportation' })).toEqual({})
    expect(internationaleOuverte('etranger')).toBe(false)
    expect(internationaleQuiPart(AUTOLIQUIDATION, 'etranger')).toEqual({ pays: null, numeroTva: null, regime: null })
    expect(horsTvaQuiPart({ pays: 'DE', numeroTva: null, regime: 'exportation' })).toBe(false)
  })

  it('un brouillon rouvert retrouve ses colonnes, drapeau levé seulement', () => {
    const f = { client_pays: 'CH', client_numero_tva: null, regime_international: 'prestation_hors_ue' as const }
    expect(saisieInternationaleLue(f)).toEqual({ pays: 'CH', numeroTva: '', regime: 'prestation_hors_ue' })
    drapeau.leve = false
    expect(saisieInternationaleLue(f)).toEqual(SAISIE_INTERNATIONALE_VIDE)
  })
})

describe('les refus, dits avant le clic, aux mots du module', () => {
  it('une autoliquidation complète passe', () => {
    expect(jugementInternational(aJuger())).toEqual({ refusDeLEnregistrement: null, refusDeLaValidation: null })
  })

  it('la forme refuse tout enregistrement ; la garde, la validation seule', () => {
    const forme = jugementInternational(aJuger({ qp: { pays: 'FR', numeroTva: null, regime: null } }))
    expect(forme.refusDeLEnregistrement).toMatch(/^Le pays du client s'écrit en deux capitales/)
    expect(forme.refusDeLaValidation).toBe(forme.refusDeLEnregistrement)
    const taxee = jugementInternational(aJuger({ tauxDesLignes: [20], montantTva: 12 }))
    expect(taxee.refusDeLEnregistrement).toBeNull()
    expect(taxee.refusDeLaValidation).toBe(REFUS_DE_LA_FACTURE_INTERNATIONALE[15].replace('%', 'une autoliquidation par le client'))
    const biens = jugementInternational(aJuger({ nature: 'biens' }))
    expect(biens.refusDeLaValidation).toBe(REFUS_DE_LA_FACTURE_INTERNATIONALE[10].replace('%', 'une autoliquidation par le client'))
  })

  it('le numéro du vendeur pas encore jugé : le refus qui le lit ne se dit pas à faux ; nul, il se dit', () => {
    expect(jugementInternational(aJuger({ numeroTvaDuVendeur: undefined })).refusDeLaValidation).toBeNull()
    expect(jugementInternational(aJuger({ numeroTvaDuVendeur: null, statutTva: 'franchise' })).refusDeLaValidation)
      .toMatch(/^La facture porte une autoliquidation par le client, qui exige le numéro de TVA du vendeur/)
  })

  it('la mention du dossier, hors de la TVA française, se refuse après la garde', () => {
    const v = jugementInternational(aJuger({ statutTva: 'franchise', mentionDuDossier: MENTION_FRANCHISE, mentionsLegales: MENTION_FRANCHISE }))
    expect(v.refusDeLaValidation).toBe(REFUS_DE_LA_MENTION_DU_DOSSIER.replace('%', MENTION_FRANCHISE).replace('%', 'une autoliquidation par le client'))
  })

  it('drapeau baissé, aucun refus', () => {
    drapeau.leve = false
    expect(jugementInternational(aJuger({ qp: { pays: 'F1', numeroTva: null, regime: null } })))
      .toEqual({ refusDeLEnregistrement: null, refusDeLaValidation: null })
  })
})

describe('les mots de l’écran et ce qui s’imprime', () => {
  it('une option par régime, tirée du libellé du module', () => {
    expect(OPTIONS_DES_REGIMES.map((o) => o.valeur)).toEqual(REGIMES_INTERNATIONAUX)
    expect(OPTIONS_DES_REGIMES.map((o) => o.libelle)).toEqual([
      'Autoliquidation par le client', "Prestation hors de l'Union", 'Livraison intracommunautaire', 'Exportation',
      'Opération taxable en France', 'Prestation hors champ (art. 259 B du CGI)',
    ])
    expect(mentionDuRegimeDite('exportation')).toBe(`La facture imprimera « ${MENTIONS_DES_REGIMES.exportation} »`)
    expect(mentionDuRegimeDite('taxable_en_france')).toMatch(/mention de TVA du dossier/)
    expect(mentionDuRegimeDite(null)).toBeNull()
  })

  it('la confirmation nomme le pays, le numéro, le régime et sa mention ; rien sans eux ni drapeau baissé', () => {
    expect(confirmationInternationale({ pays: 'DE', numeroTva: 'DE123456789', regime: 'autoliquidation_ue' })).toBe(
      'Elle figera aussi le pays du client, DE, son numéro de TVA, DE123456789, le régime de l\'opération, une autoliquidation '
      + `par le client, sous la mention « ${MENTIONS_DES_REGIMES.autoliquidation_ue} ».`)
    expect(confirmationInternationale({ pays: 'CH', numeroTva: null, regime: 'taxable_en_france' }))
      .toBe('Elle figera aussi le pays du client, CH, le régime de l\'opération, une opération taxable en France, sous la mention de TVA du dossier.')
    expect(confirmationInternationale({ pays: null, numeroTva: null, regime: null })).toBeNull()
    drapeau.leve = false
    expect(confirmationInternationale({ pays: 'DE', numeroTva: null, regime: null })).toBeNull()
  })

  it('une facture figée imprime ses colonnes et la mention de son régime ; une facture d’avant, un brouillon, rien', () => {
    const figee = { mentions_figees: true, client_pays: 'DE', client_numero_tva: 'DE123456789', regime_international: 'autoliquidation_ue' as const }
    expect(ceQueLaFactureInternationaleImprime(figee))
      .toEqual({ pays: 'DE', numeroTva: 'DE123456789', mention: MENTIONS_DES_REGIMES.autoliquidation_ue })
    expect(ceQueLaFactureInternationaleImprime({ ...figee, regime_international: 'taxable_en_france' })?.mention).toBeNull()
    expect(ceQueLaFactureInternationaleImprime({ ...figee, mentions_figees: false })).toBeNull()
    expect(ceQueLaFactureInternationaleImprime({ mentions_figees: true })).toBeNull()
    drapeau.leve = false
    expect(ceQueLaFactureInternationaleImprime(figee)).toBeNull()
  })
})
