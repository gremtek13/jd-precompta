import { describe, expect, it } from 'vitest'
import { tirage } from '../test/encaissementsBatterie'
import { TRANCHES_DU_RESTE, duContrePaye, rangDuJour, type EntreesDuDu, type LigneComparee } from './duContrePaye'

// BOR5 : le facturé confronté au payé (src/lib/duContrePaye.ts ; conception 59, § 6). Des chiffres FABRIQUÉS, aucun dossier réel.

type Total = EntreesDuDu['facture']['totaux']['lignes'][number]
type Paiement = EntreesDuDu['paye']['paiements']['lignes'][number]

const lot = (date: string, montant: number, caisse = 349, factures = 3): Total =>
  ({ date_creation_lot: date, part: 'obligatoire', regime: 1, caisse, montant_centimes: montant, nombre_de_factures: factures })
const mutuelle = (date: string, montant: number): Total =>
  ({ date_creation_lot: date, part: 'complementaire', regime: null, caisse: null, montant_centimes: montant, nombre_de_factures: 2 })
const paiement = (date: string, montant: number, part: Paiement['part'] = 'obligatoire', caisse: number | null = 349, regularisations = 0): Paiement => ({
  date_journee_comptable: date, regime: part === 'obligatoire' ? 1 : null, caisse: part === 'obligatoire' ? caisse : null, part,
  montant_centimes: montant, regularisations_centimes: regularisations, nombre_de_factures: part === 'forfait' || montant === regularisations ? 0 : 2,
})

function entrees(totaux: Total[], paiements: Paiement[], autre: Partial<EntreesDuDu> = {}): EntreesDuDu {
  return {
    facture: { imports: { complete: true, lignes: [{ premier_lot_le: '2026-01-02', dernier_lot_le: '2026-03-31' }] }, totaux: { complete: true, lignes: totaux } },
    paye: { imports: { complete: true, lignes: [{ periode_du: '2026-01-02', periode_au: '2026-04-15' }] }, paiements: { complete: true, lignes: paiements } },
    fenetre: { du: '2026-01-01', au: '2026-03-31' },
    aujourdHui: '2026-04-20',
    ...autre,
  }
}
const ouverte = (e: EntreesDuDu) => ({ ...e, fenetre: { du: '2026-01-02', au: '2026-03-31' } })

function compte(e: EntreesDuDu) {
  const r = duContrePaye(e)
  if (r.etat !== 'compte') throw new Error(`attendu « compte », rendu « ${r.etat} »`)
  return r
}

describe('le calendrier civil en entiers', () => {
  it('rend le rang d’une date et refuse ce qui n’en est pas une', () => {
    expect(rangDuJour('1970-01-01')).toBe(0)
    expect(rangDuJour('2026-03-01')! - rangDuJour('2026-02-28')!).toBe(1)
    expect(rangDuJour('2024-03-01')! - rangDuJour('2024-02-28')!).toBe(2)
    expect(rangDuJour('2000-03-01')! - rangDuJour('2000-02-28')!).toBe(2)
    expect(rangDuJour('2100-03-01')! - rangDuJour('2100-02-28')!).toBe(1)
    for (const faux of ['2026-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-01-01T00:00:00Z', null, 20260101]) expect(rangDuJour(faux)).toBeNull()
  })
})

describe('muet, sous un état nommé, jamais 0', () => {
  it('une lecture partielle de l’un des quatre', () => {
    const e = entrees([lot('2026-01-05', 1000)], [])
    expect(duContrePaye({ ...e, facture: { ...e.facture, totaux: { ...e.facture.totaux, complete: false } } })).toEqual({ etat: 'lecture_partielle', cotes: ['facture'] })
    expect(duContrePaye({ ...e, paye: { ...e.paye, imports: { ...e.paye.imports, complete: false } } })).toEqual({ etat: 'lecture_partielle', cotes: ['paye'] })
  })

  it('un côté sans import, une fenêtre à l’envers ou à venir, une date illisible', () => {
    const e = ouverte(entrees([lot('2026-01-05', 1000)], []))
    expect(duContrePaye({ ...e, paye: { imports: { complete: true, lignes: [] }, paiements: { complete: true, lignes: [] } } }))
      .toEqual({ etat: 'rien_importe', cotes: ['paye'] })
    expect(duContrePaye({ ...e, fenetre: { du: '2026-03-01', au: '2026-02-01' } })).toEqual({ etat: 'fenetre_invalide', raison: 'a_l_envers' })
    expect(duContrePaye({ ...e, fenetre: { du: '2026-03-01', au: '2026-04-21' } })).toEqual({ etat: 'fenetre_invalide', raison: 'a_venir' })
    expect(duContrePaye({ ...e, aujourdHui: '20/04/2026' })).toEqual({ etat: 'donnee_illisible', cote: 'parametres' })
    expect(duContrePaye(ouverte(entrees([lot('2026-01-05', 10.5)], [])))).toEqual({ etat: 'donnee_illisible', cote: 'facture' })
    expect(duContrePaye(ouverte(entrees([], [paiement('2026-01-05', 100, 'obligatoire', 349, 5)])))).toEqual({ etat: 'donnee_illisible', cote: 'paye' })
  })

  it('une fenêtre que l’un des deux côtés ne couvre pas', () => {
    const e = entrees([lot('2026-01-05', 1000)], [])
    // Le premier lot importé est du 2 janvier : le 1er n'est couvert par aucun des deux.
    expect(duContrePaye(e)).toEqual({
      etat: 'non_couvert', cotes: ['facture', 'paye'],
      etendues: { facture: { du: '2026-01-02', au: '2026-03-31' }, paye: { du: '2026-01-02', au: '2026-04-15' } },
    })
    expect(duContrePaye({ ...e, fenetre: { du: '2026-02-01', au: '2026-04-10' } })).toMatchObject({ etat: 'non_couvert', cotes: ['facture'] })
  })
})

describe('le compte courant par organisme et par part', () => {
  it('le payé s’impute aux lots les plus anciens, jamais à un lot créé après la journée qui le paie', () => {
    const r = compte(ouverte(entrees(
      [lot('2026-01-05', 10_000), lot('2026-02-10', 5_000), lot('2026-03-30', 2_000)],
      [paiement('2026-01-09', 6_000), paiement('2026-02-03', 7_000), paiement('2026-02-20', 4_000), paiement('2026-04-02', 1_500)],
    )))
    expect(r.situationAu).toBe('2026-04-15')
    expect(r.joursDepuisLaSituation).toBe(5)
    const [l] = r.lignes
    // Le 3 février, 4 000 ferment le lot du 5 janvier ; 3 000 restent sans lot en face (le lot du 10 février n'existe pas encore).
    expect(l).toMatchObject<Partial<LigneComparee>>({
      regime: 1, caisse: 349, enFace: 'les_deux', factureCentimes: 17_000, payeDesJourneesCentimes: 17_000,
      payeSansLotEnFaceCentimes: 3_000, resteEstimeCentimes: 1_500, payeImputeCentimes: 15_500, plusAncienLotOuvert: '2026-03-30',
    })
    // Le 2 avril (hors de la fenêtre, avant la situation) ferme les 1 000 du lot du 10 février, puis 500 de celui du 30 mars :
    // 1 500 restent, seize jours avant la situation du 15 avril.
    expect(l.tranches).toEqual({ sept_jours_au_plus: 0, de_8_a_30_jours: 1_500, de_31_a_90_jours: 0, plus_de_90_jours: 0 })
    expect(r.total).toEqual({ factureCentimes: 17_000, payeDesJourneesCentimes: 17_000, resteEstimeCentimes: 1_500, payeSansLotEnFaceCentimes: 3_000 })
  })

  it('les bornes : sept jours tout juste ; un paiement sans lot hors de la fenêtre ; une journée après le jour ne paie rien', () => {
    const e = ouverte(entrees([lot('2026-03-25', 1_000), lot('2026-03-31', 600)], [paiement('2026-04-08', 600), paiement('2026-04-12', 1_000)]))
    const [l] = compte(e).lignes
    // Le 8 avril ferme 600 du lot du 25 mars ; le 12 avril ferme le reste (400) et le lot du 31 mars (600) — et 0 sans lot.
    expect(l).toMatchObject({ resteEstimeCentimes: 0, payeSansLotEnFaceCentimes: 0 })
    const tout = compte({ ...e, paye: { ...e.paye, paiements: { complete: true, lignes: [paiement('2026-04-12', 3_000)] } } })
    // 1 400 de trop le 12 avril : hors de la fenêtre, ils ne se disent pas « sans lot » de la fenêtre.
    expect(tout.lignes[0]).toMatchObject({ resteEstimeCentimes: 0, payeSansLotEnFaceCentimes: 0 })
    const situation = { ...e, paye: { imports: { complete: true, lignes: [{ periode_du: '2026-01-02', periode_au: '2026-04-07' }] }, paiements: { complete: true, lignes: [] } } }
    expect(compte(situation).lignes[0].tranches).toEqual({ sept_jours_au_plus: 600, de_8_a_30_jours: 1_000, de_31_a_90_jours: 0, plus_de_90_jours: 0 })
    // Une journée importée après le jour (que la base refuse) ne paie rien : la situation est le jour.
    const avenir = { ...e, aujourdHui: '2026-04-07', paye: { imports: { complete: true, lignes: [{ periode_du: '2026-01-02', periode_au: '2026-04-12' }] }, paiements: { complete: true, lignes: [paiement('2026-04-12', 1_600)] } } }
    expect(compte(avenir)).toMatchObject({ situationAu: '2026-04-07', joursDepuisLaSituation: 0, total: { resteEstimeCentimes: 1_600 } })
  })

  it('un organisme d’un seul côté se dit tel, jamais comme une dette', () => {
    const r = compte(ouverte(entrees([lot('2026-01-05', 10_000, 349)], [paiement('2026-01-09', 10_000, 'obligatoire', 921)])))
    expect(r.lignes.map((l) => [l.caisse, l.enFace, l.resteEstimeCentimes, l.payeSansLotEnFaceCentimes])).toEqual([
      [349, 'facture_seul', 10_000, 0], [921, 'paye_seul', 0, 10_000],
    ])
    expect(r.lignes[0].tranches.plus_de_90_jours).toBe(10_000)
  })

  it('l’origine est le plus tardif des deux débuts : un paiement d’un lot plus ancien ne ferme pas un lot de la fenêtre', () => {
    const e = ouverte(entrees([lot('2026-01-05', 1_000)], [paiement('2026-01-03', 800), paiement('2026-01-20', 1_000)]))
    // Le payé commence le 2 janvier, le facturé le 2 janvier : origine le 2 ; le paiement du 3 précède tout lot.
    const r = compte(e)
    expect(r.origine).toBe('2026-01-02')
    expect(r.lignes[0]).toMatchObject({ resteEstimeCentimes: 0, payeSansLotEnFaceCentimes: 800 })
    // Un payé importé depuis le 15 janvier seulement : la fenêtre doit commencer après lui.
    const tard = { ...e, paye: { ...e.paye, imports: { complete: true, lignes: [{ periode_du: '2026-01-15', periode_au: '2026-04-15' }] } } }
    expect(duContrePaye(tard)).toMatchObject({ etat: 'non_couvert', cotes: ['paye'] })
    const r2 = compte({ ...tard, fenetre: { du: '2026-01-15', au: '2026-03-31' } })
    expect(r2.origine).toBe('2026-01-15')
    // Le lot du 5 janvier est avant l'origine : hors du compte ; le paiement du 20 n'a aucun lot en face.
    expect(r2.lignes[0]).toMatchObject({ factureCentimes: 0, payeSansLotEnFaceCentimes: 1_000, enFace: 'paye_seul' })
  })

  it('un lot de décembre payé en janvier : la situation, pas la fenêtre, borne le payé', () => {
    const e: EntreesDuDu = {
      facture: { imports: { complete: true, lignes: [{ premier_lot_le: '2025-12-01', dernier_lot_le: '2025-12-30' }] }, totaux: { complete: true, lignes: [lot('2025-12-30', 4_000)] } },
      paye: { imports: { complete: true, lignes: [{ periode_du: '2025-12-01', periode_au: '2026-01-10' }] }, paiements: { complete: true, lignes: [paiement('2026-01-06', 4_000)] } },
      fenetre: { du: '2025-12-01', au: '2025-12-31' }, aujourdHui: '2026-01-20',
    }
    expect(duContrePaye(e)).toMatchObject({ etat: 'non_couvert', cotes: ['facture'] })
    const r = compte({ ...e, fenetre: { du: '2025-12-01', au: '2025-12-30' } })
    expect(r.lignes[0]).toMatchObject({ factureCentimes: 4_000, payeDesJourneesCentimes: 0, resteEstimeCentimes: 0, payeImputeCentimes: 4_000 })
    expect(r.moisSansPaiement).toEqual(['2025-12'])
  })
})

describe('ce qui ne se compare pas, et ce qui se compte à part', () => {
  it('la part complémentaire, un lot d’avoirs, un paiement sans organisme', () => {
    const r = compte(ouverte(entrees(
      [mutuelle('2026-01-05', 900), lot('2026-01-05', 1_000, 349), lot('2026-01-08', -200, 349), lot('2026-01-05', 3_000, 921)],
      [paiement('2026-01-12', 700, 'complementaire'), paiement('2026-01-12', 800, 'obligatoire', 349), paiement('2026-01-12', 500, 'obligatoire', null),
        paiement('2026-01-12', 3_000, 'obligatoire', 921)],
    )))
    expect(r.lignes.map((l) => l.caisse)).toEqual([921])
    expect(r.nonComparables).toEqual([
      { part: 'obligatoire', regime: 1, caisse: 349, raison: 'avoir_dans_le_facture', factureCentimes: 800, payeDesJourneesCentimes: 800 },
      { part: 'obligatoire', regime: 1, caisse: null, raison: 'organisme_du_paiement_non_dit', factureCentimes: null, payeDesJourneesCentimes: 500 },
      { part: 'complementaire', regime: null, caisse: null, raison: 'complementaire_non_dite', factureCentimes: 900, payeDesJourneesCentimes: 700 },
    ])
  })

  it('les forfaits et les régularisations, des faits hors du reste ; le brut paie les factures', () => {
    const r = compte(ouverte(entrees(
      [lot('2026-01-05', 1_000)],
      [paiement('2026-01-12', 700, 'obligatoire', 349, -300), paiement('2026-01-13', 2_500, 'forfait'), paiement('2026-02-01', -400, 'obligatoire', 349, -400)],
    )))
    expect(r.horsFacture).toEqual({ forfaitsCentimes: 2_500, regularisationsCentimes: -700 })
    expect(r.lignes[0]).toMatchObject({ payeDesJourneesCentimes: 1_000, resteEstimeCentimes: 0 })
  })

  it('les mois sans lot ou sans paiement importé', () => {
    const r = compte(ouverte(entrees([lot('2026-01-05', 1_000)], [paiement('2026-03-02', 1_000)])))
    expect(r.moisSansLot).toEqual(['2026-02', '2026-03'])
    expect(r.moisSansPaiement).toEqual(['2026-01', '2026-02'])
  })

  it('le nombre de factures se montre des deux côtés, jamais soustrait', () => {
    const [l] = compte(ouverte(entrees([lot('2026-01-05', 1_000, 349, 7)], [paiement('2026-01-12', 1_000)]))).lignes
    expect([l.facturesFacturees, l.facturesPayees]).toEqual([7, 2])
    expect(Object.keys(l).filter((k) => /factures/i.test(k)).sort()).toEqual(['facturesFacturees', 'facturesPayees'])
  })
})

describe('une batterie tirée d’une graine : les égalités du compte tiennent', () => {
  it('reste = facturé − imputé ≥ 0 ; tranches = reste ; imputé + sans lot ≤ payé du compte ; entiers', () => {
    const alea = tirage(59_05)
    const jourAuHasard = () => {
      const mois = 1 + Math.floor(alea() * 3)
      return `2026-0${mois}-${String(2 + Math.floor(alea() * 27)).padStart(2, '0')}`
    }
    for (let essai = 0; essai < 200; essai += 1) {
      const totaux = Array.from({ length: 1 + Math.floor(alea() * 12) }, () => lot(jourAuHasard(), Math.floor(alea() * 50_000), [349, 921][Math.floor(alea() * 2)]))
      const paiements = Array.from({ length: Math.floor(alea() * 12) }, () => paiement(jourAuHasard(), 1 + Math.floor(alea() * 50_000), 'obligatoire', [349, 921, 131][Math.floor(alea() * 3)]))
      const r = compte(ouverte(entrees(totaux, paiements)))
      for (const l of r.lignes) {
        expect(l.resteEstimeCentimes).toBeGreaterThanOrEqual(0)
        expect(l.resteEstimeCentimes).toBe(l.factureCentimes - l.payeImputeCentimes)
        expect(TRANCHES_DU_RESTE.reduce((s, t) => s + l.tranches[t], 0)).toBe(l.resteEstimeCentimes)
        expect(l.payeImputeCentimes + l.payeSansLotEnFaceCentimes).toBeLessThanOrEqual(
          paiements.filter((p) => p.caisse === l.caisse).reduce((s, p) => s + p.montant_centimes, 0))
        for (const v of [l.factureCentimes, l.payeDesJourneesCentimes, l.resteEstimeCentimes, l.payeSansLotEnFaceCentimes]) expect(Number.isSafeInteger(v)).toBe(true)
      }
      // Le facturé de la fenêtre, tout entier dans les lignes.
      expect(r.total.factureCentimes).toBe(totaux.reduce((s, t) => s + t.montant_centimes, 0))
    }
  })
})
