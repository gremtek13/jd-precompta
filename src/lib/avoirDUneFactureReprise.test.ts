import { beforeEach, describe, expect, it, vi } from 'vitest'
import { derniereDefinitionSql } from '../test/schema'
import { donnees, facture, ligne } from '../test/facturesCii'
import { identiteDuDossier } from '../test/mentionsFigees'
import {
  CREDITE_D_UNE_REPRISE_INCONNU, RETENUE_REPRISE_EN_LECTURE, avisDeLAvoirDUneReprise, crediteDeLOrigine, refusDeLaReprise,
  retenueDeLaReprise, retenueRepriseIllisible, type LectureDeLaRepriseDeLOrigine,
} from './avoirDUneFactureReprise'
import { SANS_ACOMPTE, refusDeLAvoir } from './acomptesDesFactures'
import { REFUS_AVOIR_D_UNE_REPRISE } from './encaissementsDesReprises'
import { REFUS_CII_D_UNE_REPRISE, factureCii, refusDuCii, refusEmission } from './factureCii'
import { refusAvoir } from './factures'
import { emetteurDeLAvoir } from './mentionsFigeesVue'
import { serieDeLaValidation } from './validationDeLaFacture'

// L'AVOIR D'UNE FACTURE REPRISE (étape A8c6, ligne 51.5). Le drapeau `FACTURES_IMPORTEES_PREVUES`, levé en production, se joue
// dans ses deux états par un accesseur : baissé, une reprise se refuse dès son état, comme hier.
const drapeau = vi.hoisted(() => ({ leve: true }))
vi.mock('./facturesImportees', () => ({ get FACTURES_IMPORTEES_PREVUES() { return drapeau.leve } }))
vi.mock('./supabase', () => ({ supabase: {} }))
beforeEach(() => { drapeau.leve = true })

const REPRISE = {
  id: 'r1', type: 'facture' as const, statut: 'importee' as never, numero: 'ANC-0042', date_emission: '2026-06-15',
  montant_ttc: 120, nature_operation: 'services' as 'services' | 'mixte',
}
const VALIDEE = { ...REPRISE, id: 'f1', statut: 'validee' as const, numero: 'F2026-0001' }
const LUE: LectureDeLaRepriseDeLOrigine = { etat: 'lue', factureId: 'r1', repriseLe: '2026-11-01', crediteParLesRepris: 0 }
const TOTAL = [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]
const UNE_PART = [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 25, taux_tva: 20 }]
const [MIXTE, AVANT] = REFUS_AVOIR_D_UNE_REPRISE

describe('refusAvoir : l’avoir d’une facture reprise, aux refus et dans l’ordre de la base', () => {
  it('accepte un avoir daté de la reprise ou d’après, sur ce qui reste', () => {
    expect(refusAvoir(REPRISE, '2026-11-01', TOTAL, 0, LUE)).toBeNull()
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, LUE)).toBeNull()
  })

  it('la reprise mixte se refuse avant toute lecture ; la date de reprise attend sa lecture, puis se juge', () => {
    expect(refusAvoir({ ...REPRISE, nature_operation: 'mixte' }, '2026-11-20', TOTAL, 0, null))
      .toBe(MIXTE.modele.replace('%', 'ANC-0042'))
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, null)).toBe(RETENUE_REPRISE_EN_LECTURE)
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, { ...LUE, factureId: 'autre' })).toBe(RETENUE_REPRISE_EN_LECTURE)
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, { etat: 'illisible', factureId: 'r1', motif: 'refusée' }))
      .toBe(retenueRepriseIllisible('refusée'))
    expect(refusAvoir(REPRISE, '2026-10-31', TOTAL, 0, LUE)).toBe(AVANT.modele.replace('%', 'ANC-0042').replace('%', '01/11/2026'))
    // Sans date de reprise posée, la base refuse tout avoir (`v_reprise is null`).
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, { ...LUE, repriseLe: null })).toBe(AVANT.modele.replace('%', 'ANC-0042').replace('%', ''))
    // Les refus d'hier passent avant : la date de la facture, puis la reprise.
    expect(refusAvoir(REPRISE, '2026-06-14', TOTAL, 0, null)).toBe("Un avoir ne précède pas la facture qu'il corrige (émise le 15/06/2026).")
  })

  it('le plafond se juge net des avoirs de l’application ET des avoirs repris ; inconnus, la base juge seule', () => {
    expect(refusAvoir(REPRISE, '2026-11-20', UNE_PART, 70, { ...LUE, crediteParLesRepris: 30 })).toMatch(/n'a plus que 20,00/)
    expect(refusAvoir(REPRISE, '2026-11-20', UNE_PART, 70, { ...LUE, crediteParLesRepris: 20 })).toBeNull()
    // L'espace client ne lit pas les avoirs repris : rien n'est calculé sur un zéro qu'on n'a pas lu.
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 100, { ...LUE, crediteParLesRepris: null })).toBeNull()
    expect(crediteDeLOrigine(REPRISE, 70, { ...LUE, crediteParLesRepris: 30.1 })).toBe(100.1)
    expect(crediteDeLOrigine(REPRISE, null, LUE)).toBeNull()
    expect(crediteDeLOrigine(REPRISE, 0, { ...LUE, crediteParLesRepris: null })).toBeNull()
    expect(CREDITE_D_UNE_REPRISE_INCONNU).toMatch(/la base refusera/)
  })

  it('une facture de l’application garde ses refus d’hier, la lecture ignorée', () => {
    expect(refusAvoir(VALIDEE, '2026-11-20', TOTAL, 0, null)).toBeNull()
    expect(refusAvoir({ ...VALIDEE, nature_operation: 'mixte' }, '2026-11-20', TOTAL, 0, null)).toBeNull()
    expect(retenueDeLaReprise(VALIDEE, null)).toBeNull()
    expect(refusDeLaReprise(VALIDEE, '2020-01-01', null)).toBeNull()
    expect(crediteDeLOrigine(VALIDEE, 12, null)).toBe(12)
  })

  it('le drapeau baissé : une reprise se refuse dès son état, comme hier', () => {
    drapeau.leve = false
    expect(refusAvoir(REPRISE, '2026-11-20', TOTAL, 0, LUE)).toBe('Un avoir corrige une facture validée, jamais un brouillon ni un autre avoir.')
    expect(avisDeLAvoirDUneReprise(REPRISE, 'cabinet', null, 2026, LUE)).toBeNull()
  })

  it('la copie de `refusAvoir` (lib/acomptesDesFactures.ts) rend les mêmes refus, cas pour cas', () => {
    const cas: [typeof REPRISE | typeof VALIDEE, string, typeof TOTAL, number | null, LectureDeLaRepriseDeLOrigine | null][] = [
      [REPRISE, '2026-11-01', TOTAL, 0, LUE], [{ ...REPRISE, nature_operation: 'mixte' }, '2026-11-20', TOTAL, 0, null],
      [REPRISE, '2026-11-20', TOTAL, 0, null], [REPRISE, '2026-10-31', TOTAL, 0, LUE], [REPRISE, '2026-06-01', TOTAL, 0, LUE],
      [REPRISE, '2026-11-20', UNE_PART, 70, { ...LUE, crediteParLesRepris: 30 }], [REPRISE, '2026-11-20', [], 0, LUE],
      [REPRISE, '2026-11-20', [{ ...TOTAL[0], quantite: 0 }], 0, LUE], [VALIDEE, '2026-11-20', TOTAL, 130, null],
      [{ ...REPRISE, type: 'avoir' as never }, '2026-11-20', TOTAL, 0, LUE],
    ]
    for (const [o, d, l, c, r] of cas) expect(refusDeLAvoir(o, SANS_ACOMPTE, d, l, c, r)).toBe(refusAvoir(o, d, l, c, r))
    drapeau.leve = false
    for (const [o, d, l, c, r] of cas) expect(refusDeLAvoir(o, SANS_ACOMPTE, d, l, c, r)).toBe(refusAvoir(o, d, l, c, r))
  })

  it('l’ordre des refus est celui de la dernière définition exportée d’enregistrer_facture', () => {
    const texte = derniereDefinitionSql('enregistrer_facture')
    const rang = (m: string) => {
      const i = texte.indexOf(m)
      expect(i, m).toBeGreaterThan(0)
      return i
    }
    const rangs = [
      rang("Un avoir corrige une facture validée"), rang("v_origine.statut not in ('validee', 'importee')"),
      rang("Un avoir ne précède pas la facture"), rang('mêle biens et services : son avoir'), rang('son avoir se date du jour de la reprise'),
      rang("Les lignes d''un avoir créditent"), rang('Un avoir crédite un montant'), rang('from factures_importees ai'),
      rang('Cet avoir créditerait'),
    ]
    expect(rangs[1]).toBeLessThan(rangs[0])
    expect(rangs.slice(2)).toEqual([...rangs.slice(2)].sort((a, b) => a - b))
  })
})

describe('ce que la fenêtre dit avant le clic', () => {
  it('un document de l’application, sa série (MA côté cabinet), ce qu’il fige, la date de reprise', () => {
    const serie = serieDeLaValidation('cabinet', 'avoir', 2026, [])
    const avis = avisDeLAvoirDUneReprise(REPRISE, 'cabinet', serie, 2026, LUE) ?? ''
    expect(avis).toMatch(/ANC-0042 est reprise de l’ancien logiciel : cet avoir est un document de l’application/)
    expect(avis).toMatch(/série des avoirs du cabinet, mandataire du dossier \(MA2026-…\)/)
    expect(avis).toMatch(/fige l’émetteur du dossier/)
    expect(avis).toMatch(/net de ses avoirs repris, et se date du jour de la reprise des factures \(le 01\/11\/2026\) ou d’après\.$/)
    // Le client ne lit pas les modèles : sa série, sans préfixe deviné.
    expect(avisDeLAvoirDUneReprise(REPRISE, 'client', null, 2026, null)).toMatch(/dans ta série d’avoirs, et sa validation/)
    expect(avisDeLAvoirDUneReprise(VALIDEE, 'cabinet', serie, 2026, LUE)).toBeNull()
  })

  it('l’émetteur que l’avoir fige : celui du dossier pour une reprise, jamais lu sur elle ; celui de sa facture sinon', () => {
    const identite = identiteDuDossier({ nom: 'Dossier Fictif', adresse: '3 rue du Dossier' })
    const vide = { emetteur_nom: null as never, emetteur_siret: null, emetteur_adresse: null }
    expect(emetteurDeLAvoir({ statut: 'importee' as never, ...vide }, identite))
      .toEqual({ nom: 'Dossier Fictif', siret: identite.siret, adresse: '3 rue du Dossier' })
    const posee = { statut: 'validee' as const, emetteur_nom: 'Émetteur figé', emetteur_siret: '1', emetteur_adresse: 'a' }
    expect(emetteurDeLAvoir(posee, identite)).toEqual({ nom: 'Émetteur figé', siret: '1', adresse: 'a' })
    drapeau.leve = false
    expect(emetteurDeLAvoir({ statut: 'importee' as never, ...vide }, identite)).toEqual({ nom: null, siret: null, adresse: null })
  })
})

describe('le CII : une reprise n’en a pas ; l’avoir qui la corrige cite le numéro et la date de l’ancien logiciel', () => {
  it('une facture reprise se refuse sous ses mots ; une autre, au jugement d’hier', () => {
    const d = donnees()
    expect(refusDuCii({ ...d, facture: { ...d.facture, statut: 'importee' as never } })).toEqual([REFUS_CII_D_UNE_REPRISE])
    expect(refusDuCii(d)).toEqual(refusEmission(d))
    drapeau.leve = false
    expect(refusDuCii({ ...d, facture: { ...d.facture, statut: 'importee' as never } })).toEqual(['Seule une facture validée se transmet.'])
  })

  it('BG-3 porte le numéro et la date de la reprise ; un numéro que le format ne transmet pas se refuse', () => {
    const lignes = [ligne({ quantite: -1 })]
    const avoir = { type: 'avoir' as const, numero: 'A2026-0001', montant_ht: -100, montant_tva: -20, montant_ttc: -120 }
    const r = factureCii({ ...donnees({ lignes, facture: avoir }), origine: { numero: 'ANC-0042', date_emission: '2026-06-15' } })
    expect(r.refus).toEqual([])
    expect(r.xml).toMatch(/<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>ANC-0042<\/ram:IssuerAssignedID>[\s\S]*?20260615/)
    const refuse = factureCii({ ...donnees({ lignes, facture: avoir }), origine: { numero: 'ANC#42', date_emission: '2026-06-15' } })
    expect(refuse.refus).toContain('Le numéro de la facture corrigée (ANC#42) ne peut pas être transmis.')
    expect(facture(lignes, avoir).statut).toBe('validee')
  })
})
