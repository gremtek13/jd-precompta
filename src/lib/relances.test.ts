import { describe, expect, it } from 'vitest'
import { PROPOSITIONS_PAR_DEFAUT } from './parametresFacturation'
import {
  INDEMNITE_FORFAITAIRE_CENTIMES, RAISON_PARTICULIER, RELANCES_EXPORTEES, TAUX_REFINANCEMENT_BCE, derniereRelance,
  origineDuTauxEnMots, penalitesDeRetard, retardDeLaFacture, semestreDe, tauxDeLaFacture, tauxEnMots,
  type EntreeDesPenalites,
} from './relances'

// LES RELANCES ET LES PÉNALITÉS DE RETARD (étape C5, ligne 51.5) : le module au jour près, sur le calendrier de Paris.

const entree = (o: Partial<EntreeDesPenalites>): EntreeDesPenalites => ({
  typeClient: 'assujetti', mentionsFigees: true, penalitesFigees: null, dateEcheance: '2026-06-15',
  aujourdHui: '2026-07-10', resteCentimes: 100_000, tauxBce: TAUX_REFINANCEMENT_BCE, ...o,
})

describe('le drapeau et la table des taux', () => {
  it('le drapeau est levé depuis le 08/11/2026 : la migration et send-email v11 sont en production', () => {
    expect(RELANCES_EXPORTEES).toBe(true)
  })

  it('la table porte les seuls semestres relus sur la page de la BCE, en centièmes de point', () => {
    expect(TAUX_REFINANCEMENT_BCE).toEqual({
      '2023-S1': 250, '2023-S2': 400, '2024-S1': 450, '2024-S2': 425,
      '2025-S1': 315, '2025-S2': 215, '2026-S1': 215, '2026-S2': 240,
    })
    expect(Object.isFrozen(TAUX_REFINANCEMENT_BCE)).toBe(true)
  })

  it('le semestre d’une date : le 30 juin au premier, le 1er juillet au second', () => {
    expect(semestreDe('2026-06-30')).toBe('2026-S1')
    expect(semestreDe('2026-07-01')).toBe('2026-S2')
    expect(semestreDe('2026-01-01')).toBe('2026-S1')
  })
})

describe('une facture en retard, au jour près', () => {
  const f = { statut: 'validee', type: 'facture', date_echeance: '2026-09-30' }
  it('le jour de l’échéance, elle n’est pas en retard ; le lendemain, d’un jour', () => {
    expect(retardDeLaFacture(f, 1000, '2026-09-30')).toEqual({ etat: 'a_jour' })
    expect(retardDeLaFacture(f, 1000, '2026-10-01')).toEqual({ etat: 'en_retard', jours: 1, resteCentimes: 1000 })
    expect(retardDeLaFacture(f, 1000, '2026-11-06')).toEqual({ etat: 'en_retard', jours: 37, resteCentimes: 1000 })
  })

  it('soldée, elle est à jour ; ses encaissements pas lus en entier, rien ne s’affirme', () => {
    expect(retardDeLaFacture(f, 0, '2026-11-06')).toEqual({ etat: 'a_jour' })
    expect(retardDeLaFacture(f, null, '2026-11-06').etat).toBe('illisible')
  })

  it('ni un brouillon, ni un avoir, ni une facture sans échéance', () => {
    expect(retardDeLaFacture({ ...f, statut: 'brouillon' }, 1000, '2026-11-06').etat).toBe('a_jour')
    expect(retardDeLaFacture({ ...f, type: 'avoir' }, 1000, '2026-11-06').etat).toBe('a_jour')
    expect(retardDeLaFacture({ ...f, date_echeance: null }, 1000, '2026-11-06').etat).toBe('a_jour')
  })
})

describe('« Relancée le … » : le jour de Paris de la dernière relance du journal', () => {
  it('23 h 30 UTC le 5 novembre est déjà le 6 à Paris ; 22 h 30 UTC le 1er juillet, le 2', () => {
    expect(derniereRelance([{ facture_id: 'f1', created_at: '2026-11-05T23:30:00.000Z' }], 'f1')).toBe('2026-11-06')
    expect(derniereRelance([{ facture_id: 'f1', created_at: '2026-07-01T22:30:00.000Z' }], 'f1')).toBe('2026-07-02')
    expect(derniereRelance([{ facture_id: 'f1', created_at: '2026-11-05T22:59:59.000Z' }], 'f1')).toBe('2026-11-05')
  })

  it('la plus récente de SA facture, aucune quand le journal n’en porte pas', () => {
    const journal = [
      { facture_id: 'f1', created_at: '2026-10-02T08:00:00.000Z' },
      { facture_id: 'f2', created_at: '2026-11-01T08:00:00.000Z' },
      { facture_id: 'f1', created_at: '2026-10-20T08:00:00.000Z' },
      { facture_id: null, created_at: '2026-11-03T08:00:00.000Z' },
    ]
    expect(derniereRelance(journal, 'f1')).toBe('2026-10-20')
    expect(derniereRelance(journal, 'f3')).toBeNull()
  })
})

describe('le taux que la facture a figé, lu sans deviner', () => {
  it('un pourcentage seul se lit, à deux décimales au plus', () => {
    expect(tauxDeLaFacture(true, 'Pénalités de retard : 12 % l’an.')).toEqual({ origine: 'facture', centiemes: 1200 })
    expect(tauxDeLaFacture(true, 'Taux des pénalités : 10,5%')).toEqual({ origine: 'facture', centiemes: 1050 })
    expect(tauxDeLaFacture(true, 'Pénalités au taux annuel de 12,345 %')).toEqual({ origine: 'loi', motif: 'texte_illisible' })
  })

  it('le texte proposé par défaut renvoie au taux de la loi', () => {
    expect(tauxDeLaFacture(true, PROPOSITIONS_PAR_DEFAUT.penalites)).toEqual({ origine: 'loi', motif: 'renvoi_a_la_loi' })
  })

  it('un taux rapporté à un autre, ou deux taux, ne se devinent pas', () => {
    for (const texte of [
      'Une pénalité égale à trois fois le taux d’intérêt légal sera exigible.',
      'Taux BCE + 10 %', 'Pénalités : 12 % puis 15 % après 60 jours.', 'Pénalités de retard exigibles.',
    ]) expect(tauxDeLaFacture(true, texte), texte).toEqual({ origine: 'loi', motif: 'texte_illisible' })
  })

  it('sans texte, ou sans conditions figées, le taux de la loi', () => {
    expect(tauxDeLaFacture(true, null)).toEqual({ origine: 'loi', motif: 'aucun_texte' })
    expect(tauxDeLaFacture(true, '  ')).toEqual({ origine: 'loi', motif: 'aucun_texte' })
    expect(tauxDeLaFacture(false, '12 %')).toEqual({ origine: 'loi', motif: 'conditions_non_figees' })
  })
})

describe('les pénalités entre entreprises (C. com., L441-10)', () => {
  it('chaque jour sous le taux de son semestre : 15 jours à 12,15 %, puis 10 jours à 12,40 % sur 1 000 €', () => {
    const p = penalitesDeRetard(entree({}))
    expect(p).toMatchObject({
      etat: 'calculees', regime: 'commerce', jours: 25, indemniteCentimes: INDEMNITE_FORFAITAIRE_CENTIMES,
      periodes: [
        { du: '2026-06-16', au: '2026-06-30', jours: 15, centiemes: 1215 },
        { du: '2026-07-01', au: '2026-07-10', jours: 10, centiemes: 1240 },
      ],
    })
    // 100 000 × (1215 × 15 + 1240 × 10) / 3 650 000 = 839,04… centimes.
    expect(p.etat === 'calculees' && p.penalitesCentimes).toBe(839)
  })

  it('le passage de l’année : le 31 décembre au second semestre, le 1er janvier au premier', () => {
    const p = penalitesDeRetard(entree({ dateEcheance: '2025-12-20', aujourdHui: '2026-01-05' }))
    expect(p.etat === 'calculees' && p.periodes).toEqual([
      { du: '2025-12-21', au: '2025-12-31', jours: 11, centiemes: 1215 },
      { du: '2026-01-01', au: '2026-01-05', jours: 5, centiemes: 1215 },
    ])
  })

  it('le premier jour de retard compte un jour ; le jour de l’échéance, rien', () => {
    expect(penalitesDeRetard(entree({ aujourdHui: '2026-06-16' }))).toMatchObject({ etat: 'calculees', jours: 1 })
    expect(penalitesDeRetard(entree({ aujourdHui: '2026-06-15' })).etat).toBe('sans_objet')
  })

  it('le taux figé lisible prévaut, un seul pour tout le retard', () => {
    const p = penalitesDeRetard(entree({ penalitesFigees: 'Pénalités : 12 % l’an.', dateEcheance: '2026-10-07', aujourdHui: '2026-11-06' }))
    // 100 000 × 1200 × 30 / 3 650 000 = 986,30… centimes.
    expect(p).toMatchObject({ etat: 'calculees', taux: { origine: 'facture' }, penalitesCentimes: 986, periodes: [{ jours: 30, centiemes: 1200 }] })
  })

  it('l’arrondi au centime, une fois, le demi vers le haut', () => {
    const un = (reste: number) => penalitesDeRetard(entree({ penalitesFigees: '10 %', resteCentimes: reste, aujourdHui: '2026-06-16' }))
    expect(un(1825)).toMatchObject({ penalitesCentimes: 1 })
    expect(un(1824)).toMatchObject({ penalitesCentimes: 0 })
  })

  it('un semestre que la table ne porte pas se demande, jamais deviné', () => {
    const p = penalitesDeRetard(entree({ dateEcheance: '2026-12-20', aujourdHui: '2027-01-10' }))
    expect(p).toMatchObject({ etat: 'taux_manquant', semestres: ['2027-S1'] })
    expect(p.etat === 'taux_manquant' && p.raison).toMatch(/du 1er semestre 2027/)
    // Le taux figé n'en a pas besoin ; une table donnée par l'appelant non plus.
    expect(penalitesDeRetard(entree({ penalitesFigees: '12 %', dateEcheance: '2026-12-20', aujourdHui: '2027-01-10' })).etat).toBe('calculees')
    expect(penalitesDeRetard(entree({ dateEcheance: '2026-12-20', aujourdHui: '2027-01-10', tauxBce: { ...TAUX_REFINANCEMENT_BCE, '2027-S1': 265 } })).etat).toBe('calculees')
  })
})

describe('un organisme public (C. commande publique, R2192-31), un particulier, un type inconnu', () => {
  it('l’organisme public : le taux du semestre où le retard commence, majoré de 8 points, pour tout le retard', () => {
    const p = penalitesDeRetard(entree({ typeClient: 'organisme_public', penalitesFigees: '12 %' }))
    // 100 000 × 1015 × 25 / 3 650 000 = 695,2… centimes.
    expect(p).toMatchObject({
      etat: 'calculees', regime: 'commande_publique', penalitesCentimes: 695, indemniteCentimes: 4000,
      periodes: [{ du: '2026-06-16', au: '2026-07-10', jours: 25, centiemes: 1015 }],
    })
    expect(p.etat === 'calculees' && origineDuTauxEnMots(p.regime, p.taux)).toMatch(/R2192-31/)
  })

  it('un particulier : rien, et l’écran dit pourquoi', () => {
    expect(penalitesDeRetard(entree({ typeClient: 'non_assujetti' }))).toEqual({ etat: 'sans_objet', raison: RAISON_PARTICULIER })
  })

  it('un client établi hors de France, ou un type à préciser : rien, sous sa raison', () => {
    expect(penalitesDeRetard(entree({ typeClient: 'etranger' }))).toMatchObject({ etat: 'sans_objet', raison: expect.stringMatching(/hors de France/) })
    expect(penalitesDeRetard(entree({ typeClient: null }))).toMatchObject({ etat: 'sans_objet', raison: expect.stringMatching(/ne dit pas/) })
  })

  it('rien ne reste dû : rien', () => {
    expect(penalitesDeRetard(entree({ resteCentimes: 0 })).etat).toBe('sans_objet')
  })
})

describe('les mots', () => {
  it('un taux à la française', () => {
    expect(tauxEnMots(1215)).toBe('12,15 %')
    expect(tauxEnMots(1000)).toBe('10,00 %')
    expect(tauxEnMots(1015)).toBe('10,15 %')
  })
})
