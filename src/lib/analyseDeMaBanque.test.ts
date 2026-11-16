import { describe, expect, it } from 'vitest'
import * as module from './analyseDeMaBanque'
import {
  analyseDeMaBanque, anneeDeMaBanque, dernierJourDuMois, finDeCouverture, intervallesCouverts, memeJourLAnneeDAvant,
  motsDeLAnnee, sourceDUnCompte, variationEnPourcent, type ControleAnalyse, type MouvementAnalyse, type SourceDUnCompte,
} from './analyseDeMaBanque'
import { motsDuCabinet } from './espaceVentes'
import type { CompteDuClient } from './banqueClientParCompte'

// « MON ANNÉE » DANS « MA BANQUE » (demande du cabinet du 16/11/2026). Ce que ces cas gardent : un mois ne se compte que
// couvert par un relevé contrôlé cohérent ; un mois non couvert n'a aucun chiffre ; les montants en centimes entiers ; la
// comparaison au cumul à date, contre la même période couverte de l'année d'avant, sinon tue avec sa raison ; une lecture
// partielle muette ; plusieurs comptes, chacun le sien, jamais leur total. Données FICTIVES.

const controle = (o: Partial<ControleAnalyse>): ControleAnalyse => ({
  id: 'c0', coherent: true, periode_debut: '2026-01-01', periode_fin: '2026-01-31', ...o,
})
const mvt = (id: string, date: string, montant: number, compte?: string): MouvementAnalyse => ({ id, date, montant, compte_bancaire_id: compte })
const lue = (s: SourceDUnCompte) => { if (s.etat !== 'lue') throw new Error('source non lue'); return s }
const AUJOURD_HUI = '2026-11-16'

describe('les périodes couvertes', () => {
  it('se réunissent quand elles se touchent ou se chevauchent ; un relevé incohérent ou non daté ne couvre rien', () => {
    expect(intervallesCouverts([
      controle({ id: 'a', periode_debut: '2026-02-01', periode_fin: '2026-02-28' }),
      controle({ id: 'b', periode_debut: '2026-01-01', periode_fin: '2026-01-31' }),
      controle({ id: 'c', periode_debut: '2026-02-20', periode_fin: '2026-03-10' }),
      controle({ id: 'd', periode_debut: '2026-05-01', periode_fin: '2026-05-31', coherent: false }),
      controle({ id: 'e', periode_debut: null, periode_fin: '2026-06-30' }),
      controle({ id: 'f', periode_debut: '2026-07-01', periode_fin: null }),
      controle({ id: 'g', periode_debut: '2026-09-10', periode_fin: '2026-09-01' }),
    ])).toEqual([{ debut: '2026-01-01', fin: '2026-03-10' }])
  })

  it('le calendrier civil : fin de mois, bissextile, même jour un an plus tôt', () => {
    expect(dernierJourDuMois('2024-02')).toBe('2024-02-29')
    expect(dernierJourDuMois('2026-02')).toBe('2026-02-28')
    expect(dernierJourDuMois('2026-12')).toBe('2026-12-31')
    expect(memeJourLAnneeDAvant('2028-02-29')).toBe('2027-02-28')
    expect(memeJourLAnneeDAvant('2026-11-10')).toBe('2025-11-10')
    expect(finDeCouverture([{ debut: '2026-01-01', fin: '2026-03-10' }], '2026-03-11')).toBeNull()
  })
})

describe('une année', () => {
  // 2026 : janvier à octobre couverts sans interruption, mars excepté (aucun relevé) ; novembre jusqu'au 10.
  const controles = [
    controle({ id: 'j', periode_debut: '2026-01-01', periode_fin: '2026-02-28' }),
    controle({ id: 'a', periode_debut: '2026-04-01', periode_fin: '2026-10-31' }),
    controle({ id: 'n', periode_debut: '2026-11-01', periode_fin: '2026-11-10' }),
  ]
  const mouvements = [
    mvt('1', '2026-01-05', 0.1), mvt('2', '2026-01-06', 0.2), mvt('3', '2026-01-20', -39.99),
    mvt('4', '2026-03-15', 1000), // un mois non couvert : il ne se compte nulle part
    mvt('5', '2026-11-05', 200), mvt('6', '2026-11-12', 50), // le 12 n'est couvert par aucun relevé
  ]
  const source = lue(sourceDUnCompte(mouvements, controles, AUJOURD_HUI))
  const a = anneeDeMaBanque(source, 2026, AUJOURD_HUI)

  it('chaque mois dit sa couverture ; un mois non couvert n’a aucun chiffre ; les montants en centimes entiers', () => {
    expect(a.mois.map((m) => m.etat)).toEqual(['couvert', 'couvert', 'non_couvert', 'couvert', 'couvert', 'couvert', 'couvert',
      'couvert', 'couvert', 'couvert', 'en_partie', 'a_venir'])
    expect(a.mois[0]).toEqual({ mois: '2026-01', etat: 'couvert', entrees: 30, sorties: 3999, difference: -3969 })
    expect(a.mois[2]).toEqual({ mois: '2026-03', etat: 'non_couvert' })
    expect(a.mois[10]).toEqual({ mois: '2026-11', etat: 'en_partie', jusquAu: '2026-11-10', entrees: 20000, sorties: 0, difference: 20000 })
    expect(a.totaux).toEqual({ entrees: 20030, sorties: 3999, difference: 16031 })
    expect(a.complete).toBe(false)
    expect(a.moisCouvertsEnEntier).toBe(9)
    const mots = motsDeLAnnee(a)
    expect(mots).toContain('9 mois sur 12')
    expect(mots).toContain('Non couvert : mars 2026')
    expect(mots).toContain('novembre 2026 se compte jusqu’au 10/11/2026')
    expect(mots).toContain('À venir : décembre 2026')
  })

  it('la comparaison se tait quand le 1er janvier de l’année d’avant n’est pas couvert, et le dit', () => {
    expect(a.comparaison).toEqual({ etat: 'tue', raison: 'Pas de comparaison avec 2025 : ton relevé n’y est pas couvert sans interruption du 01/01/2025 au 28/02/2025.' })
  })

  it('les années offertes : de la plus ancienne à l’année en cours, sans trou', () => {
    const s = lue(sourceDUnCompte([mvt('x', '2023-06-01', 1)], controles, AUJOURD_HUI))
    expect(s.annees).toEqual([2026, 2025, 2024, 2023])
  })
})

describe('la comparaison à l’année d’avant', () => {
  const mouvements = [
    mvt('a1', '2025-01-10', 1000), mvt('a2', '2025-06-10', -400), mvt('a3', '2025-11-11', 999), // après le 10/11 : hors du cumul
    mvt('b1', '2026-01-10', 1200), mvt('b2', '2026-06-10', -300),
  ]

  it('au cumul à date : du 1er janvier au dernier jour couvert sans interruption, contre la même période', () => {
    const s = lue(sourceDUnCompte(mouvements, [
      controle({ id: '1', periode_debut: '2025-01-01', periode_fin: '2025-12-31' }),
      controle({ id: '2', periode_debut: '2026-01-01', periode_fin: '2026-11-10' }),
    ], AUJOURD_HUI))
    const c = anneeDeMaBanque(s, 2026, AUJOURD_HUI).comparaison
    expect(c).toEqual({
      etat: 'lue', jusquAu: '2026-11-10', jusquAuN1: '2025-11-10', interrompue: false,
      n: { entrees: 120000, sorties: 30000, difference: 90000 },
      n1: { entrees: 100000, sorties: 40000, difference: 60000 },
    })
    expect(variationEnPourcent(120000, 100000)).toBe('+20 %')
    expect(variationEnPourcent(30000, 40000)).toBe('−25 %')
    expect(variationEnPourcent(1, 0)).toBeNull()
    // Une année passée, couverte en entier : toute l'année.
    const passee = anneeDeMaBanque(s, 2025, AUJOURD_HUI)
    expect(passee.complete).toBe(true)
    expect(passee.comparaison).toEqual({ etat: 'tue', raison: 'Pas de comparaison avec 2024 : ton relevé n’y est pas couvert sans interruption du 01/01/2024 au 31/12/2024.' })
  })

  it('le 1er janvier non couvert : tue ; une interruption plus tard : la comparaison s’arrête avant, et le dit', () => {
    const sansDebut = lue(sourceDUnCompte(mouvements, [controle({ periode_debut: '2026-02-01', periode_fin: '2026-10-31' })], AUJOURD_HUI))
    expect(anneeDeMaBanque(sansDebut, 2026, AUJOURD_HUI).comparaison)
      .toEqual({ etat: 'tue', raison: 'Pas de comparaison : le 1er janvier 2026 n’est couvert par aucun relevé contrôlé.' })
    const coupee = lue(sourceDUnCompte(mouvements, [
      controle({ id: '1', periode_debut: '2025-01-01', periode_fin: '2025-12-31' }),
      controle({ id: '2', periode_debut: '2026-01-01', periode_fin: '2026-03-31' }),
      controle({ id: '3', periode_debut: '2026-05-01', periode_fin: '2026-10-31' }),
    ], AUJOURD_HUI))
    const c = anneeDeMaBanque(coupee, 2026, AUJOURD_HUI).comparaison
    expect(c).toMatchObject({ etat: 'lue', jusquAu: '2026-03-31', jusquAuN1: '2025-03-31', interrompue: true })
    if (c.etat === 'lue') expect(c.n.entrees).toBe(120000)
  })
})

describe('« Comparer les années » : les courbes', () => {
  // 2025 : janvier à juin couverts, juillet non couvert, août à décembre couverts. 2026 : janvier et février couverts, mars
  // non couvert, avril à octobre couverts, novembre jusqu'au 10, décembre à venir. 2024 : aucun relevé.
  const controles = [
    controle({ id: 'p1', periode_debut: '2025-01-01', periode_fin: '2025-06-30' }),
    controle({ id: 'p2', periode_debut: '2025-08-01', periode_fin: '2025-12-31' }),
    controle({ id: 'j', periode_debut: '2026-01-01', periode_fin: '2026-02-28' }),
    controle({ id: 'a', periode_debut: '2026-04-01', periode_fin: '2026-10-31' }),
    controle({ id: 'n', periode_debut: '2026-11-01', periode_fin: '2026-11-10' }),
  ]
  const mouvements = [
    mvt('1', '2025-01-10', 1000), mvt('2', '2025-01-20', -1500.01), mvt('3', '2025-07-04', 999), // juillet 2025 : non couvert
    mvt('4', '2026-01-05', 0.1), mvt('5', '2026-01-06', 0.2), mvt('6', '2026-11-05', 200),
    mvt('7', '2024-05-01', 50),
  ]
  const source = lue(sourceDUnCompte(mouvements, controles, AUJOURD_HUI))

  it('les années cochées d’emblée : l’année en cours et la précédente, si le relevé la touche', () => {
    expect(module.anneesCocheesParDefaut(source, AUJOURD_HUI)).toEqual([2026, 2025])
    const seule = lue(sourceDUnCompte([], [controle({})], AUJOURD_HUI))
    expect(seule.annees).toEqual([2026])
    expect(module.anneesCocheesParDefaut(seule, AUJOURD_HUI)).toEqual([2026])
  })

  it('un point par mois couvert, aucun pour un mois non couvert ou à venir ; le mois en partie à part, non relié', () => {
    const [n, n1] = module.courbesDesAnnees(source, [2026, 2025], 'entrees', AUJOURD_HUI)
    expect(n.annee).toBe(2026)
    expect(n.points.map((p) => p.etat)).toEqual(['couvert', 'couvert', 'non_couvert', 'couvert', 'couvert', 'couvert', 'couvert',
      'couvert', 'couvert', 'couvert', 'en_partie', 'a_venir'])
    expect(n.points[0]).toEqual({ mois: '2026-01', etat: 'couvert', valeur: 30 })
    expect(n.points[2]).toEqual({ mois: '2026-03', etat: 'non_couvert' })
    expect(n.points[10]).toEqual({ mois: '2026-11', etat: 'en_partie', valeur: 20000, jusquAu: '2026-11-10' })
    expect(n.points[11]).toEqual({ mois: '2026-12', etat: 'a_venir' })
    // Le trou de mars coupe la courbe ; novembre, en partie, ne prolonge pas le tronçon d'octobre.
    expect(n.troncons).toEqual([{ debut: 0, fin: 1 }, { debut: 3, fin: 9 }])
    expect(n.total).toBe(20030)
    expect(n.moisCouverts).toBe(10)
    // Juillet 2025 n'est pas couvert : ses 999 € n'entrent nulle part, ni point ni total.
    expect(n1.points[6]).toEqual({ mois: '2025-07', etat: 'non_couvert' })
    expect(n1.troncons).toEqual([{ debut: 0, fin: 5 }, { debut: 7, fin: 11 }])
    expect(n1.total).toBe(100000)
  })

  it('la différence peut être négative, et l’échelle descend sous zéro en gardant la ligne de zéro', () => {
    const [n1] = module.courbesDesAnnees(source, [2025], 'difference', AUJOURD_HUI)
    expect(n1.points[0]).toEqual({ mois: '2025-01', etat: 'couvert', valeur: -50001 })
    expect(n1.total).toBe(-50001)
    const e = module.echelleDesCourbes([n1])
    expect(e.bas).toBeLessThanOrEqual(-50001)
    expect(e.haut).toBeGreaterThanOrEqual(0)
    expect(e.graduations).toContain(0)
    expect(e.graduations[0]).toBe(e.bas)
    expect(e.graduations[e.graduations.length - 1]).toBe(e.haut)
    expect(e.graduations.every((g) => Number.isInteger(g))).toBe(true)
    expect(e).toEqual({ bas: -60000, haut: 0, pas: 20000, graduations: [-60000, -40000, -20000, 0] })
  })

  it('une année sans aucun mois couvert : aucun point, aucun tronçon, un total nul (pas 0) ; l’échelle sans point : 0 à 1 €', () => {
    const [vide] = module.courbesDesAnnees(source, [2024], 'entrees', AUJOURD_HUI)
    expect(vide.points.every((p) => p.etat === 'non_couvert')).toBe(true)
    expect(vide.troncons).toEqual([])
    expect(vide.total).toBeNull()
    expect(vide.moisCouverts).toBe(0)
    expect(module.echelleDesCourbes([vide])).toEqual({ bas: 0, haut: 100, pas: 100, graduations: [0, 100] })
    expect(module.echelleDesCourbes([])).toEqual({ bas: 0, haut: 100, pas: 100, graduations: [0, 100] })
  })

  it('les sorties : la même couverture, une autre valeur', () => {
    const [n1] = module.courbesDesAnnees(source, [2025], 'sorties', AUJOURD_HUI)
    expect(n1.points[0]).toEqual({ mois: '2025-01', etat: 'couvert', valeur: 150001 })
    expect(n1.points[1]).toEqual({ mois: '2025-02', etat: 'couvert', valeur: 0 })
    expect(module.echelleDesCourbes([n1])).toMatchObject({ bas: 0, haut: 200000, pas: 50000 })
  })
})

describe('la lecture', () => {
  const complete = <T,>(lignes: T[]) => ({ complete: true as const, motif: null, lignes })
  const partielle = <T,>(lignes: T[]) => ({ complete: false as const, motif: 'lu en partie', lignes })

  it('muette sur une lecture partielle, ou des comptes illisibles : aucun chiffre', () => {
    const c = [controle({})]
    expect(analyseDeMaBanque({ mouvements: partielle([]), controles: complete(c), comptes: { etat: 'sans_objet' }, aujourdHui: AUJOURD_HUI }))
      .toEqual({ etat: 'muette', raison: module.ANALYSE_MUETTE_MOUVEMENTS })
    expect(analyseDeMaBanque({ mouvements: complete([]), controles: partielle(c), comptes: { etat: 'sans_objet' }, aujourdHui: AUJOURD_HUI }))
      .toEqual({ etat: 'muette', raison: module.ANALYSE_MUETTE_RELEVES })
    expect(analyseDeMaBanque({ mouvements: complete([]), controles: complete(c), comptes: { etat: 'illisible', motif: 'x' }, aujourdHui: AUJOURD_HUI }))
      .toEqual({ etat: 'muette', raison: module.ANALYSE_MUETTE_COMPTES })
    expect(analyseDeMaBanque({ mouvements: complete([]), controles: complete([controle({ coherent: false })]), comptes: { etat: 'sans_objet' }, aujourdHui: AUJOURD_HUI }))
      .toEqual({ etat: 'un', source: { etat: 'sans_releve' } })
  })

  it('plusieurs comptes : chacun ses mouvements et ses relevés, jamais leur total', () => {
    const compte = (id: string, principal: boolean): CompteDuClient => ({ id, libelle: id === 'k1' ? 'Courant' : 'Épargne', principal, fin_d_identifiant: null, ouvert_le: null, clos_le: null })
    const r = analyseDeMaBanque({
      mouvements: complete([mvt('1', '2026-01-05', 100, 'k1'), mvt('2', '2026-01-05', -100, 'k2')]),
      controles: complete([controle({ id: 'x', compte_bancaire_id: 'k1' }), controle({ id: 'y', compte_bancaire_id: 'k2' })]),
      comptes: { etat: 'lus', comptes: [compte('k2', false), compte('k1', true)] },
      aujourdHui: AUJOURD_HUI,
    })
    if (r.etat !== 'comptes') throw new Error(r.etat)
    expect(r.comptes.map((c) => c.compte.id)).toEqual(['k1', 'k2'])
    const janvier = (s: SourceDUnCompte) => anneeDeMaBanque(lue(s), 2026, AUJOURD_HUI).mois[0]
    expect(janvier(r.comptes[0].source)).toMatchObject({ etat: 'couvert', entrees: 10000, sorties: 0 })
    expect(janvier(r.comptes[1].source)).toMatchObject({ etat: 'couvert', entrees: 0, sorties: 10000 })
    expect(Object.keys(r)).toEqual(['etat', 'comptes'])
  })

  it('les mots du client : tutoiement, aucun nom d’onglet', () => {
    const textes = Object.values(module).filter((v): v is string => typeof v === 'string')
    expect(textes.length).toBeGreaterThan(5)
    for (const t of [...textes, module.comparaisonSansDebut(2026), module.comparaisonSansAnneeDAvant(2025, '2025-11-10')]) {
      expect(motsDuCabinet(t), t).toEqual([])
    }
  })
})
