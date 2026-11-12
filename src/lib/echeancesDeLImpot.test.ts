import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AVIS_JOUR_NON_OUVRE_IS, CALENDRIER_IS_EXPORTE, SANS_IMPOT_SUR_LES_SOCIETES, echeancesDeLImpotSurLesSocietes, estOuvre,
  jourDit, prochainesEcheances, prochainesEcheancesDuDossier, type EcheanceDeLImpot, type EntreesDesAcomptes,
  type ExerciceALImpotSurLesSocietes, type ImpotDuDossier,
} from './echeancesFiscales'
import { AVIS_IMPOT_A_PRECISER, composerEcheancier, motsDuClientPourLImpot, type DossierDeLEcheancier } from './echeancierClient'
import { motsDuCabinet } from './espaceVentes'
import { ajouterJours } from './format'
import { BAREME_ARTICLE_219, baremeDeLExercice, type EntreesImpot, type ReferenceDesAcomptes } from './impotSurLesSocietes'
import { acompteAProposer } from './rapprochementDesAcomptesIs'

// LIA8 : LES ACOMPTES ET LE SOLDE DE L'IS AU CALENDRIER. Les montants attendus se recalculent à la main sur l'article 219
// (15 % jusqu'à 42 500 €, 25 % au-delà) et le quart de l'article 359 de l'annexe III, jamais recopiés d'une sortie.

const E = (euros: number) => euros * 100

const ref = (beneficeEuros: number, annee: number): ReferenceDesAcomptes => ({
  etat: 'connue', debut: `${annee}-01-01`, fin: `${annee}-12-31`, beneficeImposable: E(beneficeEuros), tauxReduitApplicable: true,
})

// N−2 (2024) : 100 000 € → IS 6 375 + 14 375 = 20 750 € ; N−1 (2025) : 140 000 € → 6 375 + 24 375 = 30 750 €.
const ACOMPTES_2026: EntreesDesAcomptes = { avantDernier: ref(100_000, 2024), dernier: ref(140_000, 2025), bareme: BAREME_ARTICLE_219 }

const impot2025 = (e: Partial<EntreesImpot> = {}): EntreesImpot => ({
  debut: '2025-01-01', fin: '2025-12-31', bareme: baremeDeLExercice('2025-01-01', '2025-12-31'),
  resultatComptable: E(140_000), reintegrations: [], deductions: [], deficitsAReporterALOuverture: 0,
  reportEnArriere: { option: 'non' },
  tauxReduit: { regle: 'chiffre-d-affaires-et-attestation', chiffreDAffairesHt: E(500_000), capitalAtteste: true },
  creancesImputees: 0, creditsDImpotImputes: 0, acomptesVerses: E(25_000), ...e,
})

const exercice = (annee: number, e: Partial<ExerciceALImpotSurLesSocietes> = {}): ExerciceALImpotSurLesSocietes => ({
  annee, imposition: 'is', debut: `${annee}-01-01`, fin: `${annee}-12-31`, premierExercice: false,
  acomptes: { lecture: 'incomplete' }, impot: { lecture: 'a-venir' }, ...e,
})

const societe = (...exercices: ExerciceALImpotSurLesSocietes[]): ImpotDuDossier => ({ regime: 'par-exercice', exercices })

const montants = (es: EcheanceDeLImpot[]) => es.map((e) => [e.date, e.formulaire, e.montant.etat === 'du' ? e.montant.centimes : e.montant.etat])

// Tous les jours de 2025 à 2028 : la fenêtre glisse sur chaque bord d'année et chaque échéance.
const JOURS: string[] = []
for (let d = '2025-01-01'; d <= '2028-12-31'; d = ajouterJours(d, 1)) JOURS.push(d)

const empreinte = (valeur: unknown) => createHash('sha256').update(JSON.stringify(valeur)).digest('hex')

describe('le BNC en trésorerie ne change pas d’un octet', () => {
  it('le drapeau est baissé', () => {
    expect(CALENDRIER_IS_EXPORTE).toBe(false)
  })

  // Le calcul lourd (chaque jour de quatre années, sous plusieurs profils) se paie UNE fois, avant les tests qui le lisent ;
  // le crochet a son propre délai, comme celui de `changementDeRib.test.ts`, la suite entière le faisant attendre.
  const ecartsDuCalendrier: string[] = []
  const empreintesDesEcheanciers: string[] = []
  let avisImpotsDits = 0
  let empreinteDuCalendrier = ''
  beforeAll(() => {
    const ir: ImpotDuDossier = { regime: 'par-exercice', exercices: [2024, 2025, 2026, 2027, 2028, 2029].map((annee) => ({ annee, imposition: 'ir' as const })) }
    const cas = [[SANS_IMPOT_SUR_LES_SOCIETES, false], [SANS_IMPOT_SUR_LES_SOCIETES, true], [ir, true], [societe(exercice(2026)), false]] as const
    for (const jour of JOURS) {
      const hier = JSON.stringify(prochainesEcheances(jour))
      for (const [impot, exporte] of cas) {
        const c = prochainesEcheancesDuDossier(jour, impot, exporte)
        if (JSON.stringify(c.echeances) !== hier || c.avis.length > 0) ecartsDuCalendrier.push(`${jour} ${impot.regime} ${exporte}`)
      }
    }
    const profils: { dossier: DossierDeLEcheancier | null; avecMontants: boolean }[] = [
      { dossier: { statut_tva: 'franchise', tva_periodicite: 'trimestrielle', mode_comptable: 'tresorerie' }, avecMontants: false },
      { dossier: { statut_tva: 'redevable', tva_periodicite: 'mensuelle', mode_comptable: 'tresorerie' }, avecMontants: true },
      { dossier: { statut_tva: null, tva_periodicite: 'trimestrielle', mode_comptable: 'tresorerie' }, avecMontants: true },
    ]
    const cotisations = [
      { id: 'a', echeance: '2026-03-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 812.5 },
      { id: 'b', echeance: '2027-06-20', previsionnel: true, paiement_personnel_le: null, montant_appele: 1_204 },
    ]
    for (const calendrierIsExporte of [false, true, undefined]) {
      const sortie = JOURS.flatMap((aujourdHui) => profils.map(({ dossier, avecMontants }) => {
        const r = composerEcheancier({ aujourdHui, dossier, cotisations, avecMontants, impot: SANS_IMPOT_SUR_LES_SOCIETES, calendrierIsExporte })
        if (r.avisImpot !== null) avisImpotsDits += 1
        return { echeances: r.echeances, avisTva: r.avisTva }
      }))
      empreintesDesEcheanciers.push(empreinte(sortie))
    }
    empreinteDuCalendrier = empreinte(JOURS.map((j) => prochainesEcheances(j)))
  }, 60_000)

  it('rend, chaque jour, exactement le calendrier d’hier — drapeau baissé ou levé, sans IS ou à l’IR', () => {
    expect(JOURS).toHaveLength(1_461)
    expect(ecartsDuCalendrier).toEqual([])
  })

  it('le chemin par défaut est le drapeau baissé', () => {
    expect(prochainesEcheancesDuDossier('2026-02-01', societe(exercice(2026)))).toEqual(prochainesEcheancesDuDossier('2026-02-01', societe(exercice(2026)), false))
  })

  // L'empreinte des échéanciers d'un BNC, calculée sur le code d'AVANT LIA8 (commit 99596a0) pour chaque jour de 2025 à 2028,
  // sous trois profils (le dossier non lu a sa règle, dans echeancierClient.test.ts) : le même texte, au caractère près, sort aujourd'hui — drapeau baissé, levé, ou par défaut.
  it('« Mon échéancier » rend l’échéancier d’avant LIA8, à l’empreinte près', () => {
    expect(empreintesDesEcheanciers).toEqual([EMPREINTE_DES_ECHEANCIERS_AVANT_LIA8, EMPREINTE_DES_ECHEANCIERS_AVANT_LIA8, EMPREINTE_DES_ECHEANCIERS_AVANT_LIA8])
    expect(avisImpotsDits).toBe(0)
    expect(empreinteDuCalendrier).toBe(EMPREINTE_DU_CALENDRIER_AVANT_LIA8)
  })
})

describe('les quatre acomptes (2571) et le solde (2572)', () => {
  it('rend les acomptes de l’année et le solde de l’exercice précédent, aux dates légales, avec leurs montants', () => {
    const c = echeancesDeLImpotSurLesSocietes(2026, societe(
      exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025() } }),
      exercice(2026, { acomptes: { lecture: 'entiere', entrees: ACOMPTES_2026 } }),
    ))
    // Premier : 20 750 / 4 = 5 187,50 € ; deuxième : 30 750 / 2 − 5 187,50 = 10 187,50 € ; puis 7 687,50 € deux fois.
    // Solde 2025 : 30 750 − 25 000 = 5 750 €.
    expect(montants(c.echeances)).toEqual([
      ['2026-05-15', '2572', E(5_750)],
      ['2026-03-15', '2571', 518_750], ['2026-06-15', '2571', 1_018_750], ['2026-09-15', '2571', 768_750], ['2026-12-15', '2571', 768_750],
    ])
    expect(c.echeances.map((e) => e.id)).toEqual(['is-solde-2026', 'is-acompte-1-2026', 'is-acompte-2-2026', 'is-acompte-3-2026', 'is-acompte-4-2026'])
    expect(c.echeances.map((e) => e.exercice)).toEqual([2025, 2026, 2026, 2026, 2026])
    expect(c.avis).toEqual([])
  })

  it('tait le montant d’une lecture incomplète, jamais 0', () => {
    const c = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'incomplete' } }), exercice(2026)))
    expect(c.echeances).toHaveLength(5)
    for (const e of c.echeances) {
      expect(e.montant.etat).toBe('sans-montant')
      expect(e.condition).toMatch(/pas toutes lues/)
    }
  })

  it('dit sans montant un solde dont la liasse n’est pas établie, une référence à saisir, un calcul refusé', () => {
    const c = echeancesDeLImpotSurLesSocietes(2027, societe(
      exercice(2026, { impot: { lecture: 'a-venir' } }),
      exercice(2027, { acomptes: { lecture: 'entiere', entrees: { ...ACOMPTES_2026, avantDernier: { etat: 'a-saisir' }, dernier: { etat: 'a-saisir' } } } }),
    ))
    expect(c.echeances.map((e) => e.montant.etat)).toEqual(['sans-montant', 'sans-montant', 'sans-montant', 'sans-montant', 'sans-montant'])
    expect(c.echeances[0].condition).toMatch(/liasse/)
    expect(c.echeances[1].condition).toMatch(/à saisir/)
    // Un exercice clos le 31/12/2026 ou après : le barème est à confirmer (LIA3-Q1), et le calendrier le dit.
    expect(c.echeances[1].condition).toMatch(/à confirmer/)
    const refuse = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025({ resultatComptable: 1_050 }) } })))
    expect(refuse.echeances[0].montant).toMatchObject({ etat: 'sans-montant', raison: expect.stringMatching(/euros entiers/) })
    const autreExercice = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025({ debut: '2024-01-01', fin: '2024-12-31' }) } })))
    expect(autreExercice.echeances[0].montant.etat).toBe('sans-montant')
  })

  it('dit « rien à payer » au premier exercice, en dispense, au deuxième acompte couvert et au solde excédentaire', () => {
    const premier = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026, { premierExercice: true, debut: '2026-04-01', acomptes: { lecture: 'entiere', entrees: { ...ACOMPTES_2026, avantDernier: { etat: 'aucun-exercice' }, dernier: { etat: 'aucun-exercice' } } } })))
    expect(premier.echeances.filter((e) => e.formulaire === '2571').map((e) => e.montant.etat)).toEqual(['rien-a-payer', 'rien-a-payer', 'rien-a-payer', 'rien-a-payer'])
    const dispense = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026, { acomptes: { lecture: 'entiere', entrees: { ...ACOMPTES_2026, avantDernier: ref(20_000, 2024), dernier: ref(20_000, 2025) } } })))
    expect(dispense.echeances.filter((e) => e.formulaire === '2571').every((e) => e.montant.etat === 'rien-a-payer' && /dispense/.test(e.condition))).toBe(true)
    // N−2 : 100 000 € → 20 750 € (premier acompte 5 187,50 €) ; N−1 : 40 000 € → 6 000 € : le deuxième tombe à zéro, les
    // deux suivants sont le quart de 6 000 €.
    const couvert = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026, { acomptes: { lecture: 'entiere', entrees: { ...ACOMPTES_2026, dernier: ref(40_000, 2025) } } })))
    expect(montants(couvert.echeances.filter((e) => e.formulaire === '2571'))).toEqual([
      ['2026-03-15', '2571', 518_750], ['2026-06-15', '2571', 'rien-a-payer'], ['2026-09-15', '2571', E(1_500)], ['2026-12-15', '2571', E(1_500)],
    ])
    // 140 000 € → 30 750 € d'IS, 32 000 € d'acomptes : 1 250 € à restituer.
    const excedent = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025({ acomptesVerses: E(32_000) }) } })))
    expect(excedent.echeances[0].montant).toEqual({ etat: 'rien-a-payer', excedent: E(1_250), raison: expect.stringMatching(/restitue/) })
    const juste = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025({ acomptesVerses: E(30_750) }) } })))
    expect(juste.echeances[0].montant).toMatchObject({ etat: 'rien-a-payer', excedent: 0 })
  })

  it('n’a ni acompte ni solde à l’IR, et dit ce qu’il ne sait pas : un régime pas dit, un exercice qui n’est pas civil', () => {
    expect(echeancesDeLImpotSurLesSocietes(2026, { regime: 'par-exercice', exercices: [{ annee: 2025, imposition: 'ir' }, { annee: 2026, imposition: 'ir' }] })).toEqual({ echeances: [], avis: [] })
    const sansRegime = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026)))
    expect(sansRegime.echeances.map((e) => e.formulaire)).toEqual(['2571', '2571', '2571', '2571'])
    expect(sansRegime.avis).toEqual(['Le régime d’imposition de l’exercice 2025 n’est pas dit : le solde de son impôt sur les sociétés ne figure pas ici.'])
    const decale = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026, { debut: '2025-07-01', fin: '2026-06-30' }), exercice(2025, { debut: '2025-01-01', fin: '2025-06-30' })))
    expect(decale.echeances).toEqual([])
    expect(decale.avis).toHaveLength(2)
    expect(decale.avis.every((a) => /n’est pas l’année civile/.test(a))).toBe(true)
    // Ouvert en cours d'année sans être le premier : pas couvert non plus (un changement de date de clôture, ligne 42).
    const entame = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025), exercice(2026, { debut: '2026-04-01' })))
    expect(entame.echeances.map((e) => e.formulaire)).toEqual(['2572'])
    expect(entame.avis).toHaveLength(1)
  })

  it('tait le solde quand la contribution sociale n’est pas calculée', () => {
    // 4 000 000 € de bénéfice : un IS d'environ un million, au-delà de l'abattement de 763 000 €.
    const c = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025({ resultatComptable: E(4_000_000) }) } })))
    expect(c.echeances[0].montant).toMatchObject({ etat: 'sans-montant', raison: expect.stringMatching(/ne se dit pas sans elle/) })
  })

  it('garde la date légale d’un 15 qui tombe un jour non ouvré, et le dit (aucun texte ne la reporte pour l’IS)', () => {
    // Le 15 mars 2026 est un dimanche ; le 15 juin 2025 aussi ; le 15 mai 2027, un samedi.
    expect(estOuvre('2026-03-15')).toBe(false)
    const c = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2025), exercice(2026)))
    const mars = c.echeances.find((e) => e.id === 'is-acompte-1-2026') as EcheanceDeLImpot
    expect(mars.date).toBe('2026-03-15')
    expect(mars.jourNonOuvre).toBe(true)
    expect(mars.condition).toContain(`Le ${jourDit('2026-03-15')} n’est pas un jour ouvré. ${AVIS_JOUR_NON_OUVRE_IS}`)
    expect(jourDit('2026-03-15')).toBe('dimanche 15 mars 2026')
    expect(jourDit('2026-05-14')).toBe('jour férié, jeudi 14 mai 2026')
    const juin = c.echeances.find((e) => e.id === 'is-acompte-2-2026') as EcheanceDeLImpot
    expect(juin.jourNonOuvre).toBe(false)
    expect(juin.condition).not.toContain(AVIS_JOUR_NON_OUVRE_IS)
    const solde2026 = echeancesDeLImpotSurLesSocietes(2027, societe(exercice(2026), exercice(2027))).echeances[0]
    expect([solde2026.date, solde2026.jourNonOuvre]).toEqual(['2027-05-15', true])
  })
})

describe('les douze mois à venir, drapeau levé', () => {
  const dossier = societe(
    exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025() } }),
    exercice(2026, { acomptes: { lecture: 'entiere', entrees: ACOMPTES_2026 } }),
    exercice(2027),
  )
  it('ajoute à la fenêtre les seules échéances d’IS qui y tombent, triées avec les autres', () => {
    const c = prochainesEcheancesDuDossier('2026-06-01', dossier, true)
    const is = c.echeances.filter((e) => e.impot === 'IS').map((e) => e.id)
    // Du 01/06/2026 au 31/05/2027 : le 15 juin 2027 n'y est plus, le 15 mai 2027 y est.
    expect(is).toEqual(['is-acompte-2-2026', 'is-acompte-3-2026', 'is-acompte-4-2026', 'is-acompte-1-2027', 'is-solde-2027'])
    expect(c.echeances.map((e) => e.date)).toEqual([...c.echeances.map((e) => e.date)].sort())
    expect(c.echeances.filter((e) => e.impot !== 'IS')).toEqual(prochainesEcheances('2026-06-01'))
    // Le solde de 2026 figure, sans montant : sa liasse n'est pas établie.
    expect((c.echeances.find((e) => e.id === 'is-solde-2027') as EcheanceDeLImpot).montant.etat).toBe('sans-montant')
  })
  it('ne dit un avis que si l’échéance qu’il tait tombe dans la fenêtre', () => {
    // Le 01/06/2026 : la fenêtre va au 31/05/2027 ; l'exercice 2028 n'y a aucune échéance.
    expect(prochainesEcheancesDuDossier('2026-06-01', dossier, true).avis).toEqual([])
    // Sans l'exercice 2025 : son solde (15 mai 2026) est déjà passé, rien ne se dit.
    expect(prochainesEcheancesDuDossier('2026-06-01', societe(exercice(2026, { acomptes: { lecture: 'entiere', entrees: ACOMPTES_2026 } }), exercice(2027)), true).avis).toEqual([])
    // Le 01/06/2027 : les acomptes de 2028 (15 mars 2028) y tombent, et 2028 n'est pas dit.
    expect(prochainesEcheancesDuDossier('2027-06-01', dossier, true).avis).toEqual([
      'Le régime d’imposition de l’exercice 2028 n’est pas dit : ses acomptes d’impôt sur les sociétés ne figurent pas ici.',
    ])
  })
})

describe('« Mon échéancier », drapeau levé', () => {
  const dossier = societe(
    exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025() } }),
    exercice(2026, { acomptes: { lecture: 'entiere', entrees: ACOMPTES_2026 } }),
  )
  const composer = (avecMontants: boolean) => composerEcheancier({
    aujourdHui: '2026-04-01', dossier: { statut_tva: 'franchise', tva_periodicite: 'trimestrielle', mode_comptable: 'tresorerie' }, cotisations: [], avecMontants,
    impot: dossier, calendrierIsExporte: true,
  })
  it('montre les montants sous « Banque » seulement, et dit le régime qui manque', () => {
    const avec = composer(true)
    const solde = avec.echeances.find((e) => e.id === 'is-solde-2026')
    expect(solde?.montant).toEqual({ valeur: 5_750, estimation: false })
    // L'exercice 2026 est au barème à confirmer (LIA3-Q1) : ses acomptes sont une estimation, dite comme telle.
    expect(avec.echeances.find((e) => e.id === 'is-acompte-2-2026')?.montant).toEqual({ valeur: 10_187.5, estimation: true })
    expect(composer(false).echeances.filter((e) => e.id.startsWith('is-')).every((e) => e.montant === null)).toBe(true)
    // Le 01/04/2026, la fenêtre atteint le 15/03/2027 : l'exercice 2027 n'est pas dit.
    expect(avec.avisImpot).toBe(AVIS_IMPOT_A_PRECISER)
  })
  it('parle au client : tutoiement, aucun nom d’onglet, aucune raison du cabinet recopiée', () => {
    const textes = composer(true).echeances.filter((e) => e.id.startsWith('is-')).flatMap((e) => [e.libelle, e.precision ?? ''])
    textes.push(AVIS_IMPOT_A_PRECISER)
    const variantes = echeancesDeLImpotSurLesSocietes(2027, societe(exercice(2026, { impot: { lecture: 'entiere', entrees: { ...impot2025({ acomptesVerses: E(40_000) }), debut: '2026-01-01', fin: '2026-12-31', bareme: baremeDeLExercice('2026-01-01', '2026-12-31') } } }), exercice(2027))).echeances
    for (const e of variantes) { const m = motsDuClientPourLImpot(e); textes.push(m.libelle, m.precision) }
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
    expect(textes.join(' ')).not.toMatch(/à saisir|liasse|CGI/)
  })
})

describe('la proposition de rapprocher un débit d’une échéance d’IS', () => {
  const echeances = echeancesDeLImpotSurLesSocietes(2026, societe(
    exercice(2025, { impot: { lecture: 'entiere', entrees: impot2025() } }),
    exercice(2026, { acomptes: { lecture: 'entiere', entrees: ACOMPTES_2026 } }),
  )).echeances
  it('propose l’échéance au même montant et à quinze jours au plus, avec ses signaux', () => {
    expect(acompteAProposer({ date: '2026-03-16', montant: -5_187.5, libelle: 'PRLV SEPA DGFIP IMPOT' }, echeances)).toEqual({
      echeance: echeances.find((e) => e.id === 'is-acompte-1-2026'), signaux: ['montant', 'date', 'libelle-dgfip'],
    })
    expect(acompteAProposer({ date: '2026-05-29', montant: -5_750, libelle: 'Prélèvement' }, echeances)?.signaux).toEqual(['montant', 'date'])
  })
  it('ne propose rien hors de la fenêtre, sur un crédit, à un centime près, à égalité, ni sur une échéance sans montant', () => {
    expect(acompteAProposer({ date: '2026-03-31', montant: -5_187.5, libelle: 'DGFIP' }, echeances)).toBeNull()
    expect(acompteAProposer({ date: '2026-02-27', montant: -5_187.5, libelle: 'DGFIP' }, echeances)).toBeNull()
    expect(acompteAProposer({ date: '2026-02-28', montant: -5_187.5, libelle: 'DGFIP' }, echeances)?.echeance.id).toBe('is-acompte-1-2026')
    expect(acompteAProposer({ date: '2026-03-30', montant: -5_187.5, libelle: 'DGFIP' }, echeances)?.echeance.id).toBe('is-acompte-1-2026')
    expect(acompteAProposer({ date: '2026-03-15', montant: 5_187.5, libelle: 'DGFIP' }, echeances)).toBeNull()
    expect(acompteAProposer({ date: '2026-03-15', montant: -5_187.49, libelle: 'DGFIP' }, echeances)).toBeNull()
    // Les troisième et quatrième acomptes ont le même montant, mais trois mois les séparent : un seul candidat chacun.
    expect(acompteAProposer({ date: '2026-09-15', montant: -7_687.5, libelle: '' }, echeances)?.echeance.id).toBe('is-acompte-3-2026')
    const doublon = [...echeances, { ...echeances[2], id: 'autre' }]
    expect(acompteAProposer({ date: '2026-06-15', montant: -10_187.5, libelle: '' }, doublon)).toBeNull()
    const sans = echeancesDeLImpotSurLesSocietes(2026, societe(exercice(2026))).echeances
    expect(acompteAProposer({ date: '2026-03-15', montant: -0, libelle: '' }, sans)).toBeNull()
  })
  it('ne prend pas « DGFIP » dans un autre mot', () => {
    expect(acompteAProposer({ date: '2026-03-15', montant: -5_187.5, libelle: 'XDGFIPX' }, echeances)?.signaux).toEqual(['montant', 'date'])
  })
})

// Calculées sur le code d'avant LIA8 (voir le test qui les lit).
const EMPREINTE_DES_ECHEANCIERS_AVANT_LIA8 = '13960e28c434cfbbfaa72f64a843b5c10cc57cf580a8d773624c4a89e47d07b5'
const EMPREINTE_DU_CALENDRIER_AVANT_LIA8 = '79af4c241362d962899a22fb0db0af7183f81318f93779e4ef8b0bff6d47175b'
