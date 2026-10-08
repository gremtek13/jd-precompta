import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SIREN_CLIENT, SIRET_CLIENT, SIRET_VENDEUR } from '../test/facturesCii'
import { MENTIONS_VIDES } from '../test/factures'
import {
  apercuDeTransmission,
  FORME_ADRESSE_ELECTRONIQUE,
  FORME_PAYS,
  FORME_SIREN,
  FORME_SIRET,
  LONGUEUR_CODE_SERVICE,
  LONGUEUR_NUMERO_ENGAGEMENT,
  mentionsAEnregistrer,
  refusDesMentions,
  saisieDesMentions,
  sirenDuSiret,
  siretAEnregistrer,
  type BrouillonATransmettre,
  type SaisieMentions,
} from './mentionsFacture'
import type { FactureEmise } from './types'

// Les mentions de la facture électronique telles que le formulaire les saisit (ligne 28.5, étape c4). Les factures
// sont FICTIVES (src/test/facturesCii.ts) : des identifiants valides par leur clé mais inventés.

const MIGRATION = readFileSync(new URL('../../supabase/schema/20261007164932_mentions_de_la_facture.sql', import.meta.url), 'utf8')

/** Le texte de la contrainte nommée, de son nom à la contrainte suivante. */
function contrainte(nom: string): string {
  const debut = MIGRATION.indexOf(`add constraint ${nom}\n`)
  expect(debut, `contrainte ${nom} introuvable dans la migration`).toBeGreaterThan(-1)
  const fin = MIGRATION.indexOf('add constraint', debut + 1)
  return MIGRATION.slice(debut, fin === -1 ? undefined : fin)
}

const motif = (texte: string, colonne: string) => {
  const m = new RegExp(`${colonne} ~ '([^']+)'`).exec(texte)
  expect(m, `motif de ${colonne}`).not.toBeNull()
  return (m as RegExpExecArray)[1]
}

describe('les formes que la base impose, recopiées pour être dites avant le clic', () => {
  it('sont celles de la migration, au caractère près', () => {
    expect(FORME_SIREN.source).toBe(motif(contrainte('factures_emises_tiers_siren_check'), 'tiers_siren'))
    expect(FORME_SIRET.source).toBe(motif(contrainte('factures_emises_siret_du_siren'), 'tiers_siret'))
    expect(FORME_ADRESSE_ELECTRONIQUE.source)
      .toBe(motif(contrainte('factures_emises_adresse_electronique_check'), 'tiers_adresse_electronique'))
    expect(FORME_PAYS.source).toBe(motif(contrainte('factures_emises_livraison_pays_check'), 'livraison_pays'))
    expect(contrainte('factures_emises_code_service_check')).toContain(`length(code_service) <= ${LONGUEUR_CODE_SERVICE}`)
    expect(contrainte('factures_emises_numero_engagement_check')).toContain(`length(numero_engagement) <= ${LONGUEUR_NUMERO_ENGAGEMENT}`)
  })

  it('l’adresse électronique : les quatre formes de l’annuaire, et rien d’autre', () => {
    for (const a of [SIREN_CLIENT, `${SIREN_CLIENT}_${SIRET_CLIENT}`, `${SIREN_CLIENT}_${SIRET_CLIENT}_SERVICE-42`, `${SIREN_CLIENT}_FACTURES`]) {
      expect(FORME_ADRESSE_ELECTRONIQUE.test(a), a).toBe(true)
    }
    for (const a of ['98765432', `${SIREN_CLIENT}_`, `${SIREN_CLIENT} FACTURES`, `${SIREN_CLIENT}_é`, `${SIREN_CLIENT}_${'x'.repeat(101)}`]) {
      expect(FORME_ADRESSE_ELECTRONIQUE.test(a), a).toBe(false)
    }
  })
})

const SAISIE_VIDE = saisieDesMentions(null)
const saisie = (o: Partial<SaisieMentions> = {}): SaisieMentions => ({ ...SAISIE_VIDE, ...o })

describe('saisieDesMentions', () => {
  it('une facture neuve : rien de deviné, la France pour une livraison qu’on ouvrirait', () => {
    expect(SAISIE_VIDE).toEqual({
      typeClient: '', siren: '', adresseElectronique: '', codeService: '', numeroEngagement: '', nature: '',
      prestation: 'facture', datePrestation: '', periodeDebut: '', periodeFin: '', livraisonAilleurs: false,
      livraisonAdresse: '', livraisonCodePostal: '', livraisonVille: '', livraisonPays: 'FR',
    })
  })

  it('un brouillon : ses mentions, sa date ou sa période, sa livraison', () => {
    const brouillon = (o: Partial<FactureEmise>) => ({ ...MENTIONS_VIDES, ...o }) as FactureEmise
    expect(saisieDesMentions(brouillon({ periode_debut: '2026-09-01', periode_fin: '2026-09-30' })))
      .toMatchObject({ prestation: 'periode', periodeDebut: '2026-09-01', periodeFin: '2026-09-30' })
    expect(saisieDesMentions(brouillon({ date_prestation: '2026-09-12' }))).toMatchObject({ prestation: 'date', datePrestation: '2026-09-12' })
    expect(saisieDesMentions(brouillon({
      type_client: 'assujetti', tiers_siren: SIREN_CLIENT, nature_operation: 'biens',
      livraison_adresse: '3 quai des Essais', livraison_code_postal: '1000', livraison_ville: 'Bruxelles', livraison_pays: 'BE',
    }))).toMatchObject({
      typeClient: 'assujetti', siren: SIREN_CLIENT, nature: 'biens', livraisonAilleurs: true, livraisonPays: 'BE', prestation: 'facture',
    })
  })
})

describe('mentionsAEnregistrer : ce qu’un choix ferme repart à nul, dans la même écriture', () => {
  const complete = saisie({
    typeClient: 'organisme_public', siren: ' 987 654 324 ', adresseElectronique: `${SIREN_CLIENT}_FACTURES`,
    codeService: ' SERVICE-ACHATS ', numeroEngagement: 'EJ-1', nature: 'mixte', prestation: 'periode',
    datePrestation: '2026-09-12', periodeDebut: '2026-09-01', periodeFin: '2026-09-30', livraisonAilleurs: true,
    livraisonAdresse: ' 3 quai des Essais ', livraisonCodePostal: '1000', livraisonVille: 'Bruxelles', livraisonPays: 'be',
  })

  it('un organisme public garde tout, normalisé ; la date d’une période choisie ne part pas', () => {
    expect(mentionsAEnregistrer(complete)).toEqual({
      type_client: 'organisme_public', tiers_siren: SIREN_CLIENT, tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
      code_service: 'SERVICE-ACHATS', numero_engagement: 'EJ-1', nature_operation: 'mixte', date_prestation: null,
      periode_debut: '2026-09-01', periode_fin: '2026-09-30', livraison_adresse: '3 quai des Essais',
      livraison_code_postal: '1000', livraison_ville: 'Bruxelles', livraison_pays: 'BE',
    })
  })

  it('une entreprise perd le code service et le numéro d’engagement', () => {
    expect(mentionsAEnregistrer({ ...complete, typeClient: 'assujetti' })).toMatchObject({ code_service: null, numero_engagement: null })
  })

  it('un particulier perd aussi l’adresse électronique, et garde un SIREN s’il en a un', () => {
    expect(mentionsAEnregistrer({ ...complete, typeClient: 'non_assujetti' }))
      .toMatchObject({ tiers_adresse_electronique: null, code_service: null, numero_engagement: null, tiers_siren: SIREN_CLIENT })
  })

  it('un client établi hors de France n’a pas de SIREN', () => {
    expect(mentionsAEnregistrer({ ...complete, typeClient: 'etranger' })).toMatchObject({ tiers_siren: null, tiers_adresse_electronique: null })
  })

  it('des services ne se livrent pas ; une livraison décochée ne part pas', () => {
    const sansLivraison = { livraison_adresse: null, livraison_code_postal: null, livraison_ville: null, livraison_pays: null }
    expect(mentionsAEnregistrer({ ...complete, nature: 'services' })).toMatchObject(sansLivraison)
    expect(mentionsAEnregistrer({ ...complete, livraisonAilleurs: false })).toMatchObject(sansLivraison)
  })

  it('la date de la facture n’envoie ni date ni période ; un autre jour n’envoie que la date', () => {
    expect(mentionsAEnregistrer({ ...complete, prestation: 'facture' })).toMatchObject({ date_prestation: null, periode_debut: null, periode_fin: null })
    expect(mentionsAEnregistrer({ ...complete, prestation: 'date' })).toMatchObject({ date_prestation: '2026-09-12', periode_debut: null, periode_fin: null })
  })

  it('un brouillon vide enregistre des mentions nulles', () => {
    const { option_debits: _, ...vides } = MENTIONS_VIDES
    expect(mentionsAEnregistrer(SAISIE_VIDE)).toEqual(vides)
  })
})

describe('le SIRET', () => {
  it('s’enregistre sans ses espaces, et donne son SIREN', () => {
    expect(siretAEnregistrer(' 987 654 324 00019 ')).toBe(SIRET_CLIENT)
    expect(siretAEnregistrer('  ')).toBeNull()
    expect(sirenDuSiret('987 654 324 00019')).toBe(SIREN_CLIENT)
    expect([sirenDuSiret('9876543240001'), sirenDuSiret(''), sirenDuSiret('98765432400019x')]).toEqual([null, null, null])
  })
})

describe('refusDesMentions : ce que la base refuserait, chaque faute seule', () => {
  it('une saisie vide, ou complète et juste, passe', () => {
    expect(refusDesMentions(SAISIE_VIDE, '')).toEqual([])
    expect(refusDesMentions(saisie({ typeClient: 'assujetti', siren: SIREN_CLIENT, nature: 'biens', livraisonAilleurs: true,
      livraisonAdresse: '3 quai des Essais', livraisonCodePostal: '13002', livraisonVille: 'Marseille' }), '987 654 324 00019')).toEqual([])
  })

  it.each([
    ['un SIREN de huit chiffres', saisie({ siren: '98765432' }), '', 'Le SIREN du client s’écrit en neuf chiffres.'],
    ['un SIRET de treize chiffres avec un SIREN', saisie({ siren: SIREN_CLIENT }), '9876543240001', 'Le SIRET du client s’écrit en quatorze chiffres.'],
    ['un SIRET d’une autre entreprise', saisie({ siren: SIREN_CLIENT }), '12345678200010', 'Le SIRET du client ne commence pas par son SIREN.'],
    ['une adresse électronique sans SIREN', saisie({ typeClient: 'assujetti', adresseElectronique: 'FACTURES' }), '', 'L’adresse de facturation électronique s’écrit'],
    ['un code service trop long', saisie({ typeClient: 'organisme_public', codeService: 'x'.repeat(101) }), '', 'Le code service tient en 100 caractères'],
    ['un numéro d’engagement trop long', saisie({ typeClient: 'organisme_public', numeroEngagement: 'x'.repeat(51) }), '', 'Le numéro d’engagement tient en 50 caractères'],
    ['un autre jour sans sa date', saisie({ prestation: 'date' }), '', 'Indique la date de la livraison ou de la prestation.'],
    ['une période sans sa fin', saisie({ prestation: 'periode', periodeDebut: '2026-09-01' }), '', 'Indique le début et la fin de la période.'],
    ['une période à l’envers', saisie({ prestation: 'periode', periodeDebut: '2026-09-30', periodeFin: '2026-09-01' }), '', 'La période finit avant de commencer.'],
    ['une livraison sans sa ville', saisie({ nature: 'biens', livraisonAilleurs: true, livraisonAdresse: '3 quai', livraisonCodePostal: '13002' }), '', 'L’adresse de livraison demande'],
    ['un pays en trois lettres', saisie({ nature: 'mixte', livraisonAilleurs: true, livraisonAdresse: '3 quai', livraisonCodePostal: '1000', livraisonVille: 'Bruxelles', livraisonPays: 'BEL' }), '', 'Le pays de livraison s’écrit en deux lettres'],
  ])('%s', (_, s, siret, attendu) => {
    expect(refusDesMentions(s, siret)).toEqual([expect.stringContaining(attendu)])
  })

  it('ce qu’un choix ferme ne se juge pas : un SIREN faux d’un client étranger, une livraison de services', () => {
    expect(refusDesMentions(saisie({ typeClient: 'etranger', siren: '123' }), '')).toEqual([])
    expect(refusDesMentions(saisie({ nature: 'services', livraisonAilleurs: true }), '')).toEqual([])
    expect(refusDesMentions(saisie({ typeClient: 'non_assujetti', adresseElectronique: 'FACTURES' }), '')).toEqual([])
  })

  it('un SIRET seul, sans SIREN, ne se juge pas : la base l’accepte tel quel', () => {
    expect(refusDesMentions(SAISIE_VIDE, 'abc')).toEqual([])
  })
})

describe('apercuDeTransmission : ce qui empêcherait la facture validée de partir par une plateforme', () => {
  const brouillon = (o: Partial<BrouillonATransmettre['facture']> = {}, b: Partial<BrouillonATransmettre> = {}): BrouillonATransmettre => ({
    facture: {
      type: 'facture', date_emission: '2026-09-15', date_echeance: '2026-10-15', tiers_nom: 'Client Fictif SAS',
      tiers_adresse: '5 avenue du Port\n13002 Marseille', tiers_siret: null, montant_ht: 100, montant_tva: 20, montant_ttc: 120,
      mentions_legales: null, emetteur_nom: 'Atelier Démo Conseil', emetteur_siret: SIRET_VENDEUR,
      emetteur_adresse: '12 rue des Exemples\n13001 Marseille',
      ...mentionsAEnregistrer(saisie({ typeClient: 'assujetti', siren: SIREN_CLIENT, nature: 'services' })),
      ...o,
    },
    lignes: [{ designation: 'Prestation de conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    statutTva: 'redevable',
    articleExoneration: null,
    optionDebits: false,
    aujourdHui: '2026-10-08',
    ...b,
  })

  it('un brouillon complet partira', () => {
    expect(apercuDeTransmission(brouillon())).toEqual({ cas: 'transmissible' })
  })

  it('un particulier ou un client étranger ne passe pas par une plateforme : l’e-reporting', () => {
    expect(apercuDeTransmission(brouillon({ type_client: 'non_assujetti' }))).toEqual({ cas: 'hors_plateforme', message: expect.stringContaining('particulier') })
    expect(apercuDeTransmission(brouillon({ type_client: 'etranger' }))).toEqual({ cas: 'hors_plateforme', message: expect.stringContaining('hors de France') })
  })

  it('dit ce qui manque, avec les mots des fonctions qui transmettent', () => {
    expect(apercuDeTransmission(brouillon({ tiers_siren: null, nature_operation: null, date_echeance: null }))).toEqual({
      cas: 'a_completer',
      refus: [
        expect.stringContaining('livraisons de biens, des prestations de services'),
        expect.stringContaining('Le SIREN du client manque'),
        expect.stringContaining('date d’échéance'),
      ],
      ailleurs: 0,
    })
    expect(apercuDeTransmission(brouillon({ type_client: null })))
      .toEqual({ cas: 'a_completer', refus: [expect.stringContaining('Dis à qui la facture est adressée')], ailleurs: 0 })
  })

  // Ce que le formulaire dit déjà ne se redit pas, mais compte : une facture que la TVA empêche de partir n'est jamais
  // annoncée « transmissible ».
  it('ne redit pas ce que le formulaire dit déjà de la TVA, et le compte : une ligne taxée d’un franchisé, un statut à préciser', () => {
    const franchise = apercuDeTransmission(brouillon({}, { statutTva: 'franchise', lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }] }))
    expect(franchise).toEqual({
      cas: 'a_completer', refus: [expect.stringContaining('numéro de TVA intracommunautaire du dossier est nécessaire')], ailleurs: 1,
    })
    const aPreciser = apercuDeTransmission(brouillon({ montant_tva: 0, montant_ttc: 100 }, {
      statutTva: null, lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 0 }],
    }))
    expect(aPreciser).toEqual({ cas: 'a_completer', refus: [], ailleurs: 1 })
    const sansArticle = apercuDeTransmission(brouillon({ montant_tva: 0, montant_ttc: 100 }, {
      lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 0 }],
    }))
    expect(sansArticle).toEqual({ cas: 'a_completer', refus: [], ailleurs: 1 })
  })

  it('sans rien filtrer d’autre : une quantité à cinq décimales se dit', () => {
    const r = apercuDeTransmission(brouillon({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 }, {
      lignes: [{ designation: 'Conseil', quantite: 1.00001, prix_unitaire_ht: 100, taux_tva: 20 }],
    }))
    expect(r).toEqual({ cas: 'a_completer', refus: [expect.stringContaining('Ligne 1 : la quantité ne s’écrit pas avec quatre décimales')], ailleurs: 0 })
  })
})
