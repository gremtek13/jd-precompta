import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  APERCU_EREPORTING_EXPORTE, CLES_DE_L_EREPORTING, JOURS_DES_DECLARATIONS_RENDUES, lireEreporting, phraseDesStatutsAnciens,
  phrasesDeLEreporting, prochainesPeriodes, type EreportingLu,
} from './apercuEreporting'
import { lireEtatFactureElectronique } from './etatFactureElectronique'

// L'étape C3 : la clé `ereporting` d'`etat_facture_electronique`, lue sans rien deviner, et la prochaine période de chaque
// objet. Les clés sont confrontées au texte de la migration préparée et à l'essai qui l'éprouve.

const MIGRATION = readFileSync('supabase/preparees/20261106170000_apercu_facture_electronique.sql', 'utf8')
const ESSAI = readFileSync('supabase/essais/apercuFactureElectronique.sql', 'utf8')
const DOSSIER = 'c3c30000-0000-4000-8000-0000000000a1'

const HIER = {
  plateforme: { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null },
  superpdp: { relie: false, depuis: null },
  adresse: null,
}
const regime = (depuis: string, autre: Record<string, unknown> = {}) => ({
  depuis, statut_tva: 'franchise', article_exoneration: null, tva_periodicite: null, tva_sur_debits: false,
  frequence_transactions: 'bimestre', frequence_paiements: 'bimestre', ...autre,
})
const ereporting = (autre: Record<string, unknown> = {}) => ({
  statut_du_dossier: { statut_tva: 'franchise', article_exoneration: null, tva_periodicite: 'trimestrielle', tva_sur_debits: false },
  regimes: [regime('2026-01-01')],
  declarations: [],
  ...autre,
})
const lu = (autre: Record<string, unknown> = {}): EreportingLu => {
  const e = lireEreporting(ereporting(autre))
  if (e === null) throw new Error('jeu illisible')
  return e
}

describe('la clé `ereporting`, confrontée à la migration et à son essai', () => {
  it('chaque clé rendue est écrite dans la migration, et les sept clés d’un régime dans l’essai', () => {
    for (const cles of Object.values(CLES_DE_L_EREPORTING)) {
      for (const c of cles) expect(MIGRATION).toContain(`'${c}'`)
    }
    for (const c of CLES_DE_L_EREPORTING.regime) expect(ESSAI).toContain(`"${c}"`)
    expect(MIGRATION).toContain(`::date - ${JOURS_DES_DECLARATIONS_RENDUES}`)
    expect(ESSAI).toContain(`(jour - ${JOURS_DES_DECLARATIONS_RENDUES})::text`)
    expect(MIGRATION).toContain("'465307bcdf36e179469859535fe1af2c'")
  })

  it('le drapeau reste baissé tant que la migration n’est pas en production', () => {
    expect(APERCU_EREPORTING_EXPORTE).toBe(false)
  })
})

describe('lireEtatFactureElectronique : la fonction d’hier, ou celle de C3', () => {
  it('une clé absente veut dire la fonction d’hier : la valeur d’hier, sans `ereporting`', () => {
    const l = lireEtatFactureElectronique(HIER)
    expect(l).not.toBeNull()
    expect(l && 'ereporting' in l).toBe(false)
  })

  it('les quatre clés : `ereporting` lu', () => {
    expect(lireEtatFactureElectronique({ ...HIER, ereporting: ereporting() })?.ereporting?.regimes).toHaveLength(1)
  })

  it.each([
    ['une clé de trop', ereporting({ note: 'x' })],
    ['un régime qui porte un identifiant', ereporting({ regimes: [{ ...regime('2026-01-01'), id: 'x' }] })],
    ['une déclaration qui porte sa plateforme', ereporting({ declarations: [{ objet: 'ventes', debut: '2026-07-01', fin: '2026-08-31', declaree_le: '2026-09-02T10:00:00+00:00', plateforme: 'x' }] })],
    ['des régimes dans le désordre', ereporting({ regimes: [regime('2026-06-01'), regime('2026-01-01')] })],
    ['une fréquence inconnue', ereporting({ regimes: [regime('2026-01-01', { frequence_transactions: 'semaine' })] })],
    ['une liste nulle', ereporting({ declarations: null })],
    ['un jour de déclaration qui n’est pas un instant', ereporting({ declarations: [{ objet: 'ventes', debut: '2026-07-01', fin: '2026-08-31', declaree_le: '2026-09-02' }] })],
  ])('%s rend la valeur ENTIÈRE illisible', (_cas, e) => {
    expect(lireEtatFactureElectronique({ ...HIER, ereporting: e })).toBeNull()
  })
})

describe('prochainesPeriodes', () => {
  it('avant le 1er septembre 2027 : la première période, prête si le régime est confirmé', () => {
    const a = prochainesPeriodes(lu(), DOSSIER, '2026-11-06')
    expect(a).toMatchObject({ etat: 'periodes' })
    if (a.etat !== 'periodes') return
    expect(a.periodes.map((p) => [p.objet, p.periode.debut, p.periode.fin, p.phase])).toEqual([
      ['ventes', '2027-09-01', '2027-10-31', 'prete'], ['achats', '2027-09-01', '2027-10-31', 'prete'],
      ['paiements', '2027-09-01', '2027-10-31', 'prete'],
    ])
    expect(phrasesDeLEreporting(a, 'client')[0]).toBe('Ventes, septembre et octobre 2027 : prête (échéance le 25/11/2027).')
  })

  it('sans régime confirmé : « en attente de ton cabinet », la première période nommée', () => {
    const a = prochainesPeriodes(lu({ regimes: [] }), DOSSIER, '2026-11-06')
    expect(a).toEqual({ etat: 'sans_regime', avantLObligation: true })
    expect(phrasesDeLEreporting(a, 'client')).toEqual([
      'Ton cabinet n’a pas encore confirmé ton régime d’e-reporting ; la première période commence le 01/09/2027.',
    ])
  })

  it('une période finie : déclarée le jour lu, ou en attente du cabinet jusqu’à son échéance', () => {
    const declarations = [{ objet: 'ventes', debut: '2027-09-01', fin: '2027-10-31', declaree_le: '2027-11-03T09:00:00+00:00' }]
    const a = prochainesPeriodes(lu({ declarations }), DOSSIER, '2027-11-12')
    if (a.etat !== 'periodes') throw new Error('attendu : des périodes')
    expect(a.periodes.map((p) => p.phase)).toEqual(['declaree', 'en_attente_du_cabinet', 'en_attente_du_cabinet'])
    expect(phrasesDeLEreporting(a, 'client')).toEqual([
      'Ventes, septembre et octobre 2027 : déclarée le 03/11/2027.',
      'Achats, septembre et octobre 2027 : en attente de ton cabinet (échéance le 25/11/2027).',
      'Paiements, septembre et octobre 2027 : en attente de ton cabinet (échéance le 25/11/2027).',
    ])
    expect(phrasesDeLEreporting(a, 'cabinet')[1]).toBe('Achats, septembre et octobre 2027 : à traiter par le cabinet (échéance le 25/11/2027).')
  })

  it('l’échéance passée : la période suivante ; un redevable sur les débits n’a pas de période de paiements', () => {
    const e = lu({
      statut_du_dossier: { statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'trimestrielle', tva_sur_debits: true },
      regimes: [regime('2026-01-01', { statut_tva: 'redevable', tva_periodicite: 'trimestrielle', tva_sur_debits: true, frequence_transactions: 'mois', frequence_paiements: null })],
    })
    const a = prochainesPeriodes(e, DOSSIER, '2027-11-11')
    if (a.etat !== 'periodes') throw new Error('attendu : des périodes')
    expect(a.periodes.map((p) => [p.objet, p.periode.libelle, p.phase])).toEqual([
      ['ventes', 'novembre 2027', 'prete'], ['achats', 'novembre 2027', 'prete'],
    ])
  })

  it('le statut du dossier n’est plus celui du régime : « régime à confirmer », jamais « prête »', () => {
    const e = lu({ statut_du_dossier: { statut_tva: 'redevable', article_exoneration: null, tva_periodicite: 'mensuelle', tva_sur_debits: false } })
    const a = prochainesPeriodes(e, DOSSIER, '2026-11-06')
    if (a.etat !== 'periodes') throw new Error('attendu : des périodes')
    expect(new Set(a.periodes.map((p) => p.raison))).toEqual(new Set(['regime_a_confirmer']))
    expect(phrasesDeLEreporting(a, 'client')[0]).toBe('Ventes, septembre et octobre 2027 : en attente de ton cabinet, qui doit confirmer ton régime.')
  })

  it('les mots du client ne nomment aucun onglet', () => {
    for (const jour of ['2026-11-06', '2027-11-12']) {
      for (const p of phrasesDeLEreporting(prochainesPeriodes(lu(), DOSSIER, jour), 'client')) expect(p).not.toMatch(/onglet/i)
    }
  })
})

describe('phraseDesStatutsAnciens', () => {
  const relie = (statuts_lus_le: string | null) => {
    const l = lireEtatFactureElectronique({
      ...HIER,
      plateforme: { reliee: true, nom: 'PA', creee_le: '2027-01-01T08:00:00+00:00', derniere_recuperation: null, statuts_lus_le },
    })
    if (l === null) throw new Error('jeu illisible')
    return l
  }
  it('au-delà de sept jours sans relevé, la phrase ; à sept jours, ou jamais relevés, rien de plus ici', () => {
    expect(phraseDesStatutsAnciens(relie('2027-11-03T23:00:00+00:00'), '2027-11-12', 'client')).toBe(
      'Les statuts de tes factures n’ont pas été relevés sur ta plateforme depuis le 04/11/2027 : une réponse de l’acheteur ne se verrait pas ici.')
    expect(phraseDesStatutsAnciens(relie('2027-11-05T00:00:00+00:00'), '2027-11-12', 'cabinet')).toBeNull()
    expect(phraseDesStatutsAnciens(relie(null), '2027-11-12', 'client')).toBeNull()
    expect(phraseDesStatutsAnciens(lireEtatFactureElectronique(HIER)!, '2027-11-12', 'client')).toBeNull()
  })
})
