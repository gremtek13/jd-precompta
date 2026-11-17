import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES, MUET, REFUS_DE_L_ASSOCIATION, REFUS_DU_RETRAIT_D_ASSOCIATION,
  REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE, centimesDuMouvement, controleDit, horsDit, journeesDesReferences,
  justificationDuCandidat, nommeLAssuranceMaladie, rapprocherLesPaiements, refusDeLAssociation, refusDeLaSomme,
  refusDuRetraitDAssociation,
  type AssociationDuRapprochement, type EntreeDuRapprochement, type MouvementDuRapprochement, type PaiementDuRapprochement,
  type RapprochementCalcule,
} from './rapprochementAssuranceMaladie'
import { montantDit } from './paiementsAssuranceMaladieVue'

// Des mouvements et des paiements FABRIQUÉS : des dates, des montants, des codes d'organisme ; aucun nom.
const mouvement = (o: Partial<MouvementDuRapprochement> & Pick<MouvementDuRapprochement, 'id' | 'date' | 'montant'>): MouvementDuRapprochement => ({
  libelle: 'VIREMENT CPAM ESSAI', libelle_brut: null, statut: 'non_rapprochee', prelevement_personnel: false,
  encaissements_de_factures: false, ...o,
})
const paiement = (o: Partial<PaiementDuRapprochement> & Pick<PaiementDuRapprochement, 'id' | 'date_journee_comptable' | 'montant_centimes'>): PaiementDuRapprochement => ({
  regime: 1, caisse: 691, part: 'obligatoire', nombre_de_factures: 3, ...o,
})
const entree = (mouvements: MouvementDuRapprochement[], paiements: PaiementDuRapprochement[],
  associations: AssociationDuRapprochement[] = [], o: Partial<EntreeDuRapprochement> = {}): EntreeDuRapprochement => ({
  mouvements: { lignes: mouvements, complete: true }, paiements: { lignes: paiements, complete: true },
  associations: { lignes: associations, complete: true }, retenusParLesVentes: new Set(), anneesValidees: new Set(),
  jour: '2026-11-17', ...o,
})
const calcule = (e: EntreeDuRapprochement): RapprochementCalcule => {
  const r = rapprocherLesPaiements(e)
  if (r.etat !== 'calcule') throw new Error(r.raison)
  return r
}
const REF = (aammjj: string) => `VIREMENT CPAM 0012345678${aammjj}`

describe('les candidats d’un mouvement : le montant au centime, la journée de zéro à cinq jours avant', () => {
  it('un paiement seul, la référence, la date : proposé et dans le lot', () => {
    const r = calcule(entree([mouvement({ id: 'm1', date: '2026-03-05', montant: 123.45, libelle: REF('260303') })],
      [paiement({ id: 'p1', date_journee_comptable: '2026-03-03', montant_centimes: 12345 })]))
    expect(r.parMouvement.get('m1')).toEqual({ genre: 'propose', autres: [], proposition: {
      mouvementId: 'm1', paiementIds: ['p1'], journee: '2026-03-03', joursApres: 2, reference: true, ailleurs: 0 } })
    expect(r.concordances.map((c) => c.mouvementId)).toEqual(['m1'])
    expect(r.controles).toEqual([])
  })

  it('les deux parts d’une même journée et d’un même organisme pour un crédit ; deux crédits, une part chacun', () => {
    const p = [paiement({ id: 'o', date_journee_comptable: '2026-03-03', montant_centimes: 10000, nombre_de_factures: 9 }),
      paiement({ id: 'c', date_journee_comptable: '2026-03-03', montant_centimes: 2345, part: 'complementaire', nombre_de_factures: 4 })]
    const un = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 123.45, libelle: REF('260303') })], p))
    const etat = un.parMouvement.get('m')
    expect(etat?.genre === 'propose' && etat.proposition.paiementIds).toEqual(['c', 'o'])
    expect(etat?.genre === 'propose' && justificationDuCandidat(etat.proposition, un.paiementsParId)).toBe(
      'Paiement de l’assurance maladie — journée comptable du 03/03/2026, organisme régime 1, caisse 691, part complémentaire et part obligatoire, 13 factures : même montant au centime ; crédité 1 jour après la journée comptable ; la référence du virement porte la journée comptable.')
    const deux = calcule(entree([mouvement({ id: 'mo', date: '2026-03-04', montant: 100 }), mouvement({ id: 'mc', date: '2026-03-04', montant: 23.45 })], p))
    expect([deux.parMouvement.get('mo'), deux.parMouvement.get('mc')].map((e) => e?.genre === 'propose' && e.proposition.paiementIds))
      .toEqual([['o'], ['c']])
  })

  it('deux parts d’organismes différents ne se somment pas ; un forfait ne se somme jamais', () => {
    const r = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 30 })], [
      paiement({ id: 'o', date_journee_comptable: '2026-03-03', montant_centimes: 1000 }),
      paiement({ id: 'c', date_journee_comptable: '2026-03-03', montant_centimes: 2000, part: 'complementaire', caisse: 692 }),
      paiement({ id: 'f', date_journee_comptable: '2026-03-03', montant_centimes: 2000, part: 'forfait', regime: null, caisse: null, nombre_de_factures: 0 }),
    ]))
    expect(r.parMouvement.get('m')).toBeUndefined()
  })

  it('la fenêtre : le jour même, cinq jours après ; ni six jours après, ni la veille', () => {
    const p = [paiement({ id: 'p', date_journee_comptable: '2026-02-26', montant_centimes: 5000 })]
    const genre = (date: string) => calcule(entree([mouvement({ id: 'm', date, montant: 50 })], p)).parMouvement.get('m')?.genre
    expect(['2026-02-26', '2026-03-03', '2026-03-04', '2026-02-25'].map(genre)).toEqual(['propose', 'propose', undefined, undefined])
  })

  it('un net négatif se rapproche d’un débit, par la même égalité', () => {
    const r = calcule(entree([mouvement({ id: 'd', date: '2026-03-05', montant: -12 })],
      [paiement({ id: 'p', date_journee_comptable: '2026-03-04', montant_centimes: -1200, nombre_de_factures: 0 })]))
    expect(r.parMouvement.get('d')?.genre).toBe('propose')
  })
})

describe('la proposition, l’égalité et le lot', () => {
  it('à égalité, aucune proposée ; la référence départage, mais le lot ne prend pas un mouvement à deux candidats', () => {
    const p = [paiement({ id: 'p1', date_journee_comptable: '2026-03-02', montant_centimes: 5000 }),
      paiement({ id: 'p2', date_journee_comptable: '2026-03-03', montant_centimes: 5000, caisse: 692 })]
    const egalite = calcule(entree([mouvement({ id: 'm', date: '2026-03-05', montant: 50 })], p))
    expect(egalite.parMouvement.get('m')?.genre).toBe('a_egalite')
    expect(egalite.concordances).toEqual([])
    const departage = calcule(entree([mouvement({ id: 'm', date: '2026-03-05', montant: 50, libelle: REF('260303') })], p))
    const e = departage.parMouvement.get('m')
    expect(e?.genre === 'propose' && [e.proposition.paiementIds, e.autres.map((a) => a.paiementIds)]).toEqual([['p2'], [['p1']]])
    expect(departage.concordances).toEqual([])
  })

  it('le lot exige la référence : un seul candidat sans elle est proposé, hors du lot, et la fiche dit ce qui manque', () => {
    const r = calcule(entree([mouvement({ id: 'm', date: '2026-03-05', montant: 50 })],
      [paiement({ id: 'p', date_journee_comptable: '2026-03-05', montant_centimes: 5000 })]))
    const e = r.parMouvement.get('m')
    expect(e?.genre).toBe('propose')
    expect(r.concordances).toEqual([])
    expect(e?.genre === 'propose' && justificationDuCandidat(e.proposition, r.paiementsParId)).toContain(
      'crédité le jour même de la journée comptable ; la référence du virement ne porte pas la journée comptable')
  })

  it('les deux sens : un paiement candidat de deux mouvements n’entre pas au lot, et la fiche le dit', () => {
    const r = calcule(entree([
      mouvement({ id: 'm1', date: '2026-03-04', montant: 50, libelle: REF('260303') }),
      mouvement({ id: 'm2', date: '2026-03-05', montant: 50, libelle: REF('260303') }),
    ], [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 })]))
    const e = r.parMouvement.get('m1')
    expect(e?.genre === 'propose' && e.proposition.ailleurs).toBe(1)
    expect(r.concordances).toEqual([])
    expect(e?.genre === 'propose' && justificationDuCandidat(e.proposition, r.paiementsParId)).toContain('Un de ces paiements est aussi candidat d’un autre mouvement.')
  })
})

describe('hors de l’association, comme la base le refuse', () => {
  const p = [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 })]
  const raison = (m: Partial<MouvementDuRapprochement>, o: Partial<EntreeDuRapprochement> = {}) => {
    const e = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 50, ...m })], p, [], o)).parMouvement.get('m')
    return e?.genre === 'hors' ? e.raison : e?.genre
  }
  it('écarté, personnel, retenu par les ventes (le drapeau ou l’ensemble), d’un exercice validé', () => {
    expect([
      raison({ statut: 'ignoree' }), raison({ prelevement_personnel: true }), raison({ encaissements_de_factures: true }),
      raison({}, { retenusParLesVentes: new Set(['m']) }), raison({}, { anneesValidees: new Set([2026]) }), raison({}, { anneesValidees: new Set([2025]) }),
    ]).toEqual(['ecarte', 'personnel', 'ventes', 'ventes', 'fige', 'propose'])
    expect(horsDit('personnel')).toBe('Ce mouvement ne s’associe pas à un paiement de l’assurance maladie : il est classé en virement personnel.')
  })
  it('un mouvement hors de l’association ne prend pas le paiement d’un autre (les deux sens l’ignorent)', () => {
    const r = calcule(entree([mouvement({ id: 'h', date: '2026-03-04', montant: 50, statut: 'ignoree', libelle: REF('260303') }),
      mouvement({ id: 'm', date: '2026-03-05', montant: 50, libelle: REF('260303') })], p))
    expect(r.concordances.map((c) => c.mouvementId)).toEqual(['m'])
  })
})

describe('les associations et les contrôles', () => {
  it('associé : les paiements, cohérent ou non, et une association que le classement contredit', () => {
    const p = [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 })]
    const bon = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 50 })], p, [{ paiement_id: 'p', ligne_bancaire_id: 'm' }]))
    expect(bon.parMouvement.get('m')).toEqual({ genre: 'associe', paiementIds: ['p'], paiementsCentimes: 5000, coherent: true, fige: false })
    expect(bon.controles).toEqual([])
    const faux = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 51, statut: 'ignoree' })], p, [{ paiement_id: 'p', ligne_bancaire_id: 'm' }]))
    expect(faux.controles.map((c) => c.genre)).toEqual(['association_incoherente', 'association_contredite'])
    expect(faux.controles.map((c) => controleDit(c, faux.paiementsParId))).toEqual([
      `Le mouvement du 04/03/2026 est associé à des paiements qui font ${montantDit(5000)}, pas son montant : défaire l’association.`,
      'Le mouvement du 04/03/2026 est associé à un paiement de l’assurance maladie, mais il est écarté : défaire l’association, ou revoir son classement.',
    ])
    const fige = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 50 })], p, [{ paiement_id: 'p', ligne_bancaire_id: 'm' }], { anneesValidees: new Set([2026]) }))
    expect(fige.parMouvement.get('m')).toMatchObject({ genre: 'associe', fige: true })
  })

  it('un crédit de l’assurance maladie sans paiement, un écart désigné par la référence, un paiement sans crédit par ancienneté', () => {
    const r = calcule(entree([
      mouvement({ id: 'sans', date: '2026-04-10', montant: 80, libelle: 'VIR CPAM DE L’ESSAI' }),
      mouvement({ id: 'ecart', date: '2026-03-06', montant: 99, libelle: REF('260303') }),
      mouvement({ id: 'autre', date: '2026-03-06', montant: 77, libelle: 'VIR DE QUELQU’UN 260303' }),
      mouvement({ id: 'fin', date: '2026-05-30', montant: -10, libelle: 'FRAIS' }),
    ], [
      paiement({ id: 'p3', date_journee_comptable: '2026-03-03', montant_centimes: 9000 }),
      paiement({ id: 'p20', date_journee_comptable: '2026-05-28', montant_centimes: 1234 }),
    ], [], { jour: '2026-06-01' }))
    expect(r.controles.map((c) => [c.genre, c.genre === 'paiement_sans_credit' ? c.paiementId : c.mouvementId])).toEqual([
      ['paiement_sans_credit', 'p3'], ['ecart', 'ecart'], ['credit_sans_paiement', 'sans'], ['paiement_sans_credit', 'p20']])
    expect(r.controles.map((c) => controleDit(c, r.paiementsParId))).toEqual([
      `Paiement de l’assurance maladie (journée comptable du 03/03/2026, organisme régime 1, caisse 691, part obligatoire, 3 factures, ${montantDit(9000)}) : aucun mouvement du relevé ne fait son montant (journée comptable vieille de 90 jours).`,
      `Crédit de l’assurance maladie du 06/03/2026 (${montantDit(9900)}) : la référence du virement désigne la journée comptable du 03/03/2026, dont les paiements importés font ${montantDit(9000)} — un écart de ${montantDit(900)}.`,
      `Crédit de l’assurance maladie du 10/04/2026 (${montantDit(8000)}) : aucun paiement importé ne le justifie — aucun paiement importé de ces jours-là. S’il rembourse le praticien comme assuré, c’est un virement personnel.`,
      `Paiement de l’assurance maladie (journée comptable du 28/05/2026, organisme régime 1, caisse 691, part obligatoire, 3 factures, ${montantDit(1234)}) : le relevé importé ne va pas encore jusqu’à la date où il devrait être crédité.`,
    ])
  })
})

describe('muet sur une lecture partielle : ni candidat, ni proposition, ni contrôle', () => {
  const m = [mouvement({ id: 'm', date: '2026-03-04', montant: 50 })]
  const p = [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 })]
  it.each([
    ['le relevé', { mouvements: { lignes: m, complete: false } }, MUET.releve],
    ['les paiements', { paiements: { lignes: p, complete: false } }, MUET.paiements],
    ['les associations', { associations: { lignes: [], complete: false } }, MUET.associations],
    ['les encaissements des factures', { retenusParLesVentes: null }, MUET.ventes],
    ['les exercices validés', { anneesValidees: null }, MUET.exercices],
  ] as const)('%s lus en partie', (_nom, o, raison) => {
    expect(rapprocherLesPaiements(entree(m, p, [], o))).toEqual({ etat: 'muet', raison })
  })
})

describe('les signaux en mots et en nombres', () => {
  it('le montant d’un mouvement en centimes, jamais arrondi en silence', () => {
    expect([12.34, 0.29, -0.1, 100, 1.005, Number.NaN].map(centimesDuMouvement)).toEqual([1234, 29, -10, 10000, null, null])
  })
  it('la liste fermée des organismes, en mots entiers, accents et ponctuation écartés', () => {
    expect(['VIR CPAM 34', 'vir c.p.a.m.', 'VIREMENT MSA', 'Assurance Maladie', 'CPAMX 12', 'MUTUELLE ESSAI'].map(nommeLAssuranceMaladie))
      .toEqual([true, false, true, true, false, false])
  })
  it('les journées que les références portent : les six derniers chiffres d’une suite, quand c’est une date', () => {
    expect(journeesDesReferences('VIR CPAM 0012345678260303 ET 991231 ET 260230 ET 12345')).toEqual(['2026-03-03', '2099-12-31'])
    expect(journeesDesReferences('REF 240229 250229')).toEqual(['2024-02-29'])
  })
})

describe('les refus de la base, dits avant le clic, dans son ordre', () => {
  const r = calcule(entree([
    mouvement({ id: 'm', date: '2026-03-04', montant: 50 }), mouvement({ id: 'e', date: '2026-03-04', montant: 50, statut: 'ignoree' }),
    mouvement({ id: 'v', date: '2026-03-04', montant: 50, encaissements_de_factures: true }), mouvement({ id: 'f', date: '2025-12-30', montant: 50 }),
    mouvement({ id: 'a', date: '2026-03-04', montant: 30 }),
  ], [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 }), paiement({ id: 'q', date_journee_comptable: '2026-03-03', montant_centimes: 3000, caisse: 1 })],
  [{ paiement_id: 'q', ligne_bancaire_id: 'a' }], { anneesValidees: new Set([2025]) }))
  it('chaque refus', () => {
    const refus = (mouvementId: string, paiementIds: string[]) => refusDeLAssociation(r, [{ mouvementId, paiementIds }])
    expect([
      refusDeLAssociation(r, []), refus('m', ['p', 'p']), refus('x', ['p']), refus('m', ['x']), refus('f', ['p']), refus('e', ['p']),
      refus('v', ['p']), refus('m', ['q']), refus('a', ['p']), refus('m', []), refus('m', ['p']),
    ]).toEqual([
      REFUS_DE_L_ASSOCIATION.forme, REFUS_DE_L_ASSOCIATION.forme, REFUS_DE_L_ASSOCIATION.mouvementInconnu, REFUS_DE_L_ASSOCIATION.paiementInconnu,
      REFUS_DE_L_ASSOCIATION.fige, REFUS_DE_L_ASSOCIATION.ecarte, REFUS_DE_L_ASSOCIATION.ventes, REFUS_DE_L_ASSOCIATION.paiementDejaAssocie,
      REFUS_DE_L_ASSOCIATION.mouvementDejaAssocie, REFUS_DE_L_ASSOCIATION.forme, null,
    ])
    expect(refusDeLAssociation(r, [{ mouvementId: 'm', paiementIds: [] }, { mouvementId: 'v', paiementIds: ['p'] }])).toBe(REFUS_DE_L_ASSOCIATION.ventes)
    const somme = calcule(entree([mouvement({ id: 'm', date: '2026-03-04', montant: 51 })], [paiement({ id: 'p', date_journee_comptable: '2026-03-03', montant_centimes: 5000 })]))
    expect(refusDeLAssociation(somme, [{ mouvementId: 'm', paiementIds: ['p'] }])).toBe(refusDeLaSomme('2026-03-04'))
    expect(refusDeLaSomme('2026-03-04')).toBe('Les paiements associés au mouvement du 04/03/2026 ne font pas son montant au centime.')
    expect([refusDuRetraitDAssociation(r, 'a'), refusDuRetraitDAssociation(r, 'm'), refusDuRetraitDAssociation(r, 'x')])
      .toEqual([null, REFUS_DU_RETRAIT_D_ASSOCIATION.rien, REFUS_DE_L_ASSOCIATION.mouvementInconnu])
  })

  it('les mots sont ceux de la migration préparée, au caractère près, et le drapeau est baissé', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/preparees/20261117160000_association_paiements_assurance_maladie.sql'), 'utf8')
    const enSql = (t: string) => t.replace(/'/g, "''")
    for (const mots of [...Object.values(REFUS_DE_L_ASSOCIATION), ...Object.values(REFUS_DU_RETRAIT_D_ASSOCIATION), REFUS_DU_RETRAIT_D_UN_IMPORT_ASSOCIE]) {
      expect(sql).toContain(enSql(mots))
    }
    expect(sql).toContain("'Les paiements associés au mouvement du % ne font pas son montant au centime.'")
    expect(ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES).toBe(false)
  })
})

describe('le module ne sort rien et ne lit aucune horloge', () => {
  it('ni base, ni réseau, ni journal, ni horloge, ni fenêtre', () => {
    const code = readFileSync(resolve(process.cwd(), 'src/lib/rapprochementAssuranceMaladie.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    for (const motif of [/supabase/i, /\bfetch\s*\(/, /\bconsole\s*\./, /\bDate\b/, /performance\.now/, /\bwindow\s*\./, /localStorage/]) {
      expect(code).not.toMatch(motif)
    }
  })
})

// Un relevé fictif de 3 000 mouvements et 1 500 paiements sur une année : la règle « LES CANDIDATS DU RELEVÉ ».
describe('mesuré sur un relevé de 3 000 mouvements', () => {
  const MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const jour = (n: number) => {
    let reste = n
    for (let m = 0; m < 12; m += 1) {
      if (reste < MOIS[m]) return `2026-${String(m + 1).padStart(2, '0')}-${String(reste + 1).padStart(2, '0')}`
      reste -= MOIS[m]
    }
    return '2026-12-31'
  }
  const paiements: PaiementDuRapprochement[] = []
  const mouvements: MouvementDuRapprochement[] = []
  for (let k = 0; k < 1500; k += 1) {
    const j = k % 355
    const centimes = 1000 + ((k * 104729) % 90000)
    paiements.push(paiement({ id: `p${k}`, date_journee_comptable: jour(j), montant_centimes: centimes, caisse: k % 3, part: k % 2 ? 'complementaire' : 'obligatoire' }))
    if (k % 2 === 0) {
      const d = jour(j + 2)
      mouvements.push(mouvement({ id: `c${k}`, date: d, montant: centimes / 100, libelle: REF(jour(j).slice(2).replace(/-/g, '')) }))
    }
  }
  for (let i = mouvements.length; i < 3000; i += 1) {
    mouvements.push(mouvement({ id: `x${i}`, date: jour(i % 365), montant: ((i * 7919) % 200000 - 100000) / 100, libelle: 'CARTE ESSAI' }))
  }
  it('le calcul entier en moins d’une demi-seconde', () => {
    const debut = performance.now()
    const r = calcule(entree(mouvements, paiements))
    const duree = performance.now() - debut
    expect(mouvements).toHaveLength(3000)
    expect(r.concordances.length).toBeGreaterThan(600)
    expect(duree).toBeLessThan(500)
  })
})
