import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AVIS_TVA_A_PRECISER, ECHEANCIER_CONDITIONS, ECHEANCIER_ILLISIBLE, ECHEANCIER_INTRODUCTION, ECHEANCIER_LECTURE_PARTIELLE,
  ECHEANCIER_SANS_MONTANTS, ECHEANCIER_VIDE, composerEcheancier, dateEnLettres, finDeLaFenetre, motsDuClientPour,
  type CotisationDeLEcheancier, type DossierDeLEcheancier,
} from './echeancierClient'
import { echeancesFiscales } from './echeancesFiscales'
import { motsDuCabinet } from './espaceVentes'
import { aujourdHuiAParis } from './format'

const SANS_TVA: DossierDeLEcheancier = { statut_tva: 'franchise', tva_periodicite: 'trimestrielle' }

function cotisation(champs: Partial<CotisationDeLEcheancier>): CotisationDeLEcheancier {
  return { id: 'c1', echeance: '2027-01-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 812.5, ...champs }
}

function composer(entree: Partial<Parameters<typeof composerEcheancier>[0]>) {
  return composerEcheancier({ aujourdHui: '2026-11-06', dossier: SANS_TVA, cotisations: [], avecMontants: false, ...entree })
}

afterEach(() => { vi.useRealTimers() })

describe('la fenêtre des douze mois', () => {
  it('d’aujourd’hui inclus à aujourd’hui plus 365 jours exclu, et rien en dehors', () => {
    const { echeances } = composer({ aujourdHui: '2026-12-15' })
    expect(echeances.length).toBeGreaterThan(0)
    for (const e of echeances) {
      expect(e.date >= '2026-12-15').toBe(true)
      expect(e.date < finDeLaFenetre('2026-12-15')).toBe(true)
    }
    // Le 15 décembre 2026 tombe un mardi : le solde de la CFE est ce jour-là, et compte.
    expect(echeances[0].id).toBe('cfe-solde-2026')
  })

  it('en décembre, la 2035 de mai suivant y est déjà, déposée par le cabinet', () => {
    const liasse = composer({ aujourdHui: '2026-12-20' }).echeances.find((e) => e.id === 'liasse-2027')
    expect(liasse?.libelle).toBe('Déclaration de tes revenus 2026 (2035), déposée par ton cabinet')
    expect(liasse?.date.startsWith('2027-05-')).toBe(true)
    expect(liasse?.montant).toBeNull()
  })

  it('une échéance d’hier n’y est plus', () => {
    // Le 16 décembre 2026, le solde de la CFE du 15 est passé.
    expect(composer({ aujourdHui: '2026-12-16' }).echeances.some((e) => e.id === 'cfe-solde-2026')).toBe(false)
  })

  it('« aujourd’hui » est le jour de Paris : à 23 h 30 UTC le 31 décembre, c’est déjà le 1er janvier', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'))
    const aujourdHui = aujourdHuiAParis()
    expect(aujourdHui).toBe('2027-01-01')
    // La déclaration initiale de CFE du 31 décembre 2026 est passée à Paris, quel que soit le fuseau du poste.
    expect(composer({ aujourdHui }).echeances.some((e) => e.id === 'cfe-1447c-2026')).toBe(false)
  })
})

describe('le fiscal, aux mots du client', () => {
  it('chaque échéance du calendrier fiscal a ses mots, sur plusieurs années', () => {
    for (const annee of [2026, 2027, 2028, 2029, 2030]) {
      for (const e of echeancesFiscales(annee)) expect(motsDuClientPour(e), e.id).not.toBeNull()
    }
  })

  it('les dates sont celles du calendrier fiscal, reprises telles quelles', () => {
    const { echeances } = composer({ aujourdHui: '2027-01-01' })
    const fiscales = echeancesFiscales(2027)
    for (const e of echeances.filter((x) => x.nature === 'impots' && x.id.endsWith('-2027'))) {
      expect(e.date).toBe(fiscales.find((f) => f.id === e.id)?.date)
      expect(e.auMois).toBe(false)
    }
  })

  it('une condition reste une condition, jamais tranchée', () => {
    const acompte = composer({ aujourdHui: '2027-01-01' }).echeances.find((e) => e.id === 'cfe-acompte-2027')
    expect(acompte?.precision).toMatch(/^Seulement si ta CFE de 2026 atteignait 3 000 €/)
  })

  it('aucun mot du cabinet, ni « Checklist », dans aucun texte que le client lit', () => {
    const redevable: DossierDeLEcheancier = { statut_tva: 'redevable', tva_periodicite: 'trimestrielle' }
    const textes = [
      AVIS_TVA_A_PRECISER, ECHEANCIER_CONDITIONS, ECHEANCIER_ILLISIBLE, ECHEANCIER_INTRODUCTION, ECHEANCIER_LECTURE_PARTIELLE,
      ECHEANCIER_SANS_MONTANTS, ECHEANCIER_VIDE,
    ]
    for (const aujourdHui of ['2026-11-06', '2027-03-01', '2027-08-20']) {
      for (const dossier of [redevable, { ...redevable, tva_periodicite: 'mensuelle' as const }]) {
        const cotisations = [cotisation({ echeance: aujourdHui }), cotisation({ id: 'c2', echeance: aujourdHui, previsionnel: true })]
        for (const e of composer({ aujourdHui, dossier, cotisations, avecMontants: true }).echeances) {
          textes.push(e.libelle, e.precision ?? '', dateEnLettres(e))
        }
      }
    }
    for (const t of textes) {
      expect(motsDuCabinet(t), t).toEqual([])
      expect(t).not.toMatch(/checklist/i)
    }
  })
})

describe('la TVA, pour un dossier redevable seulement', () => {
  it('mensuelle : une CA3 par mois de dépôt, au mois, sans jour, douze sur douze mois', () => {
    const tva = composer({ dossier: { statut_tva: 'redevable', tva_periodicite: 'mensuelle' } }).echeances.filter((e) => e.nature === 'tva')
    expect(tva.map((e) => e.id)).toEqual([
      'ca3-2026-10', 'ca3-2026-11', 'ca3-2026-12', 'ca3-2027-01', 'ca3-2027-02', 'ca3-2027-03', 'ca3-2027-04', 'ca3-2027-05',
      'ca3-2027-06', 'ca3-2027-07', 'ca3-2027-08', 'ca3-2027-09',
    ])
    expect(tva[0]).toMatchObject({ date: '2026-11-01', auMois: true, montant: null, libelle: 'TVA d’octobre 2026 : déclaration (CA3) et paiement' })
    expect(dateEnLettres(tva[0])).toBe('courant novembre 2026')
    expect(tva[0].precision).toMatch(/entre le 15 et le 24 du mois, dépend de ton entreprise/)
  })

  it('mensuelle, après le 24 : la CA3 du mois en cours est passée, celle du même mois l’an prochain entre', () => {
    const ids = composer({ aujourdHui: '2026-11-25', dossier: { statut_tva: 'redevable', tva_periodicite: 'mensuelle' } })
      .echeances.filter((e) => e.nature === 'tva').map((e) => e.id)
    expect(ids[0]).toBe('ca3-2026-11')
    expect(ids[ids.length - 1]).toBe('ca3-2027-10')
    expect(ids).toHaveLength(12)
  })

  it('trimestrielle : janvier, avril, juillet, octobre, pour le trimestre qui vient de finir', () => {
    const tva = composer({ dossier: { statut_tva: 'redevable', tva_periodicite: 'trimestrielle' } }).echeances.filter((e) => e.nature === 'tva')
    expect(tva.map((e) => [e.id, e.date])).toEqual([
      ['ca3-2026-t4', '2027-01-01'], ['ca3-2027-t1', '2027-04-01'], ['ca3-2027-t2', '2027-07-01'], ['ca3-2027-t3', '2027-10-01'],
    ])
    expect(tva[0].libelle).toBe('TVA du 4e trimestre 2026 (octobre à décembre) : déclaration (CA3) et paiement')
  })

  it('franchise ou exonéré : aucune CA3 ; statut à préciser : aucune, et l’avis le dit ; dossier illu : ni l’une ni l’avis', () => {
    for (const statut_tva of ['franchise', 'exonere'] as const) {
      const r = composer({ dossier: { statut_tva, tva_periodicite: 'mensuelle' } })
      expect(r.echeances.filter((e) => e.nature === 'tva')).toEqual([])
      expect(r.avisTva).toBeNull()
    }
    const aPreciser = composer({ dossier: { statut_tva: null, tva_periodicite: 'mensuelle' } })
    expect(aPreciser.echeances.filter((e) => e.nature === 'tva')).toEqual([])
    expect(aPreciser.avisTva).toBe(AVIS_TVA_A_PRECISER)
    const illu = composer({ dossier: null })
    expect(illu.echeances.filter((e) => e.nature === 'tva')).toEqual([])
    expect(illu.avisTva).toBeNull()
  })
})

describe('les cotisations', () => {
  const cotisations = [
    cotisation({ id: 'passee', echeance: '2026-11-05' }),
    cotisation({ id: 'aujourdhui', echeance: '2026-11-06', montant_appele: 400 }),
    cotisation({ id: 'prevue', echeance: '2027-02-05', previsionnel: true, montant_appele: 950 }),
    cotisation({ id: 'personnelle', echeance: '2027-03-05', paiement_personnel_le: '2026-10-30' }),
    cotisation({ id: 'trop-loin', echeance: '2027-11-06' }),
  ]

  it('à venir seulement : ni passée, ni payée par le compte personnel, ni hors de la fenêtre', () => {
    const ids = composer({ cotisations }).echeances.filter((e) => e.nature === 'cotisations').map((e) => e.id)
    expect(ids).toEqual(['cotisation-aujourdhui', 'cotisation-prevue'])
  })

  it('une prévisionnelle se dit prévisionnelle, et son montant une estimation', () => {
    const prevue = composer({ cotisations, avecMontants: true }).echeances.find((e) => e.id === 'cotisation-prevue')
    expect(prevue).toMatchObject({
      prevision: true, libelle: 'Cotisations sociales : échéance prévisionnelle', montant: { valeur: 950, estimation: true },
    })
    expect(prevue?.precision).toMatch(/une estimation de ta caisse/)
  })

  it('aucun montant sans « Banque », même passé par l’appelant ; avec elle, le montant appelé', () => {
    expect(composer({ cotisations }).echeances.every((e) => e.montant === null)).toBe(true)
    const avec = composer({ cotisations, avecMontants: true }).echeances.find((e) => e.id === 'cotisation-aujourdhui')
    expect(avec?.montant).toEqual({ valeur: 400, estimation: false })
    // Sous « Banque », une ligne lue sans montant (la colonne pas demandée) n'en invente pas.
    const sansColonne = composer({ cotisations: [{ id: 'x', echeance: '2026-12-01', previsionnel: false, paiement_personnel_le: null }], avecMontants: true })
    expect(sansColonne.echeances.find((e) => e.id === 'cotisation-x')?.montant).toBeNull()
  })
})

describe('le tri', () => {
  it('par date, puis impôts, TVA, cotisations le même jour', () => {
    const { echeances } = composer({
      aujourdHui: '2026-12-01', dossier: { statut_tva: 'redevable', tva_periodicite: 'mensuelle' },
      cotisations: [cotisation({ id: 'meme-jour', echeance: '2026-12-15' }), cotisation({ id: 'avant', echeance: '2026-12-02' })],
    })
    const dates = echeances.map((e) => e.date)
    expect(dates).toEqual([...dates].sort())
    const quinze = echeances.filter((e) => e.date === '2026-12-15').map((e) => e.nature)
    expect(quinze).toEqual(['impots', 'cotisations'])
    expect(echeances[0].id).toBe('ca3-2026-11')
    expect(echeances[1].id).toBe('cotisation-avant')
  })

  it('la date en lettres : « 1er », le jour, ou « courant » le mois', () => {
    expect(dateEnLettres({ date: '2027-05-01', auMois: false })).toBe('1er mai 2027')
    expect(dateEnLettres({ date: '2027-06-15', auMois: false })).toBe('15 juin 2027')
    expect(dateEnLettres({ date: '2027-04-01', auMois: true })).toBe('courant avril 2027')
  })
})
