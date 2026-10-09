import { describe, expect, it } from 'vitest'
import {
  lireMontantSaisi, montantPourSaisie, partsEnMots, pastilleDeclaration, pastilleEncaissement, tauxAffiche,
} from './encaissementsAffichage'
import type {
  DeclarationLue, EncaissementLu, EncaissementPourContrePassation, EvenementSuperpdpLu, LigneDeFacture, PartLue,
  StatutPlateformeLu, TransmissionPourDeclaration,
} from './encaissementsFactures'
import type { FactureEmise } from './types'
import { facture as factureCii } from '../test/facturesCii'

// LA PASTILLE D'ENCAISSEMENT DE L'ONGLET FACTURES ET LA SAISIE D'UN MONTANT (ligne 28.5, étape d3). Le jugement est celui
// du module d2 ; ce qui se garde ici est le passage aux mots : quand la pastille se tait, et ce qu'elle dit.

// 1 000 € à 20 % : 1 200,00 € TTC. Une facture validée de prestations de services, à une entreprise.
const LIGNES: LigneDeFacture[] = [
  { facture_id: 'f1', ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
]
const FACTURE: FactureEmise = factureCii([{ ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }],
  { option_debits: false })

const encaissement = (o: Partial<EncaissementLu> = {}): EncaissementLu => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', montant: 600, ligne_bancaire_id: null, annule_id: null, retire_le: null, ...o,
})
const part = (o: Partial<PartLue> = {}): PartLue => ({ encaissement_id: 'e1', taux: 20, montant: 600, ...o })

describe('pastilleEncaissement', () => {
  it('« À encaisser », puis « Encaissée en partie — … sur … », puis « Encaissée »', () => {
    expect(pastilleEncaissement(FACTURE, LIGNES, [], [], 'redevable')).toEqual({ libelle: 'À encaisser', classe: 'badge-neutral' })
    const partielle = pastilleEncaissement(FACTURE, LIGNES, [encaissement()], [part()], 'redevable')
    expect(partielle?.classe).toBe('badge-warning')
    expect(partielle?.libelle).toMatch(/^Encaissée en partie — 600,00\s€ sur 1\s200,00\s€$/)
    expect(pastilleEncaissement(FACTURE, LIGNES, [encaissement({ montant: 1200 })], [part({ montant: 1200 })], 'redevable'))
      .toEqual({ libelle: 'Encaissée', classe: 'badge-ok' })
  })

  it('un encaissement retiré ne compte plus ; celui d’une autre facture non plus', () => {
    expect(pastilleEncaissement(FACTURE, LIGNES, [encaissement({ retire_le: '2026-10-08T10:00:00Z' })], [part()], 'redevable')?.libelle)
      .toBe('À encaisser')
    expect(pastilleEncaissement(FACTURE, LIGNES, [encaissement({ facture_id: 'f2' })], [part()], 'redevable')?.libelle)
      .toBe('À encaisser')
  })

  it('se tait quand le statut « Encaissée » est sans objet, et sur un brouillon ou un avoir', () => {
    expect(pastilleEncaissement(FACTURE, LIGNES, [], [], 'exonere')).toBeNull()
    expect(pastilleEncaissement({ ...FACTURE, nature_operation: 'biens' }, LIGNES, [], [], 'redevable')).toBeNull()
    expect(pastilleEncaissement({ ...FACTURE, type_client: 'non_assujetti' }, LIGNES, [], [], 'redevable')).toBeNull()
    expect(pastilleEncaissement({ ...FACTURE, statut: 'brouillon' }, LIGNES, [], [], 'redevable')).toBeNull()
    expect(pastilleEncaissement({ ...FACTURE, type: 'avoir' }, LIGNES, [], [], 'redevable')).toBeNull()
  })

  it('parle encore quand l’obligation est seulement à préciser, facultative ou refusée : l’encaissement reste un fait', () => {
    expect(pastilleEncaissement(FACTURE, LIGNES, [], [], null)?.libelle).toBe('À encaisser')
    expect(pastilleEncaissement({ ...FACTURE, nature_operation: 'mixte' }, LIGNES, [], [], 'redevable')?.libelle).toBe('À encaisser')
  })

  it('se tait sur une facture dont aucune ligne n’a été lue', () => {
    expect(pastilleEncaissement(FACTURE, [], [], [], 'redevable')).toBeNull()
  })
})

describe('lireMontantSaisi et montantPourSaisie', () => {
  it('lit la virgule, le point, les espaces et le symbole', () => {
    expect(lireMontantSaisi('1 200,50')).toBe(1200.5)
    expect(lireMontantSaisi('1\u202f200,50\u00a0€')).toBe(1200.5)
    expect(lireMontantSaisi('600')).toBe(600)
    expect(lireMontantSaisi('12.345')).toBe(12.345)
  })

  it('rend null pour un champ vide, NaN pour ce qui ne se lit pas', () => {
    expect(lireMontantSaisi('')).toBeNull()
    expect(lireMontantSaisi('   ')).toBeNull()
    for (const t of ['abc', '1.200,50', '-5', '1,2,3', ',5']) expect(lireMontantSaisi(t), t).toBeNaN()
  })

  it('écrit des centimes pour un champ, et se relit', () => {
    expect(montantPourSaisie(135550)).toBe('1355,50')
    expect(montantPourSaisie(5)).toBe('0,05')
    expect(montantPourSaisie(-500)).toBe('-5,00')
    for (const c of [1, 99, 100, 123456789]) expect(Math.round((lireMontantSaisi(montantPourSaisie(c)) as number) * 100)).toBe(c)
  })

  it('écrit un taux à la française', () => {
    expect(tauxAffiche(5.5)).toBe('5,5 %')
    expect(tauxAffiche(20)).toBe('20 %')
  })
})

// LA PASTILLE DE DÉCLARATION (ligne 28.5, étape d4) : rien tant que le statut « Encaissée » n'est pas DÛ ; « À déclarer »
// tant qu'un encaissement ou une contre-passation qui compte n'est pas déclaré ; « Déclaration en retard » quand l'échéance
// de l'un d'eux est passée au jour donné.
describe('pastilleDeclaration', () => {
  // Due : des prestations de services à une entreprise, émise après le 01/09/2027.
  const DUE: FactureEmise = { ...FACTURE, date_emission: '2027-10-01', type_client: 'assujetti', nature_operation: 'services' }
  const ACCEPTEE: TransmissionPourDeclaration = { facture_id: 'f1', canal: 'plateforme', hote: 'flux.plateforme-demo.fr', etat: 'accepte' }
  const enc = (o: Partial<EncaissementPourContrePassation> = {}): EncaissementPourContrePassation => ({
    ...encaissement(), date_encaissement: '2027-10-20', ...o,
  })
  const decl = (o: Partial<DeclarationLue> = {}): DeclarationLue => ({
    id: 'te1', dossier_id: 'd1', encaissement_id: 'e1', facture_id: 'f1', canal: 'manuel', hote: 'flux.plateforme-demo.fr', etat: 'depose', ...o,
  })
  const juger = (o: {
    facture?: FactureEmise; encaissements?: EncaissementPourContrePassation[]; declarations?: DeclarationLue[]
    transmissions?: TransmissionPourDeclaration[]; evenements?: EvenementSuperpdpLu[]; statutsRecus?: StatutPlateformeLu[]
    statut?: 'redevable' | 'franchise'; aujourdHui?: string
  } = {}) => pastilleDeclaration(
    'd1', o.facture ?? DUE, LIGNES, o.encaissements ?? [enc()], o.declarations ?? [], o.transmissions ?? [ACCEPTEE], o.evenements ?? [],
    o.statutsRecus ?? [], o.statut ?? 'redevable', o.aujourdHui ?? '2027-11-02',
  )
  const A_DECLARER = { libelle: 'À déclarer', classe: 'badge-warning' }
  const EN_RETARD = { libelle: 'Déclaration en retard', classe: 'badge-danger' }

  it('« À déclarer » avant l’échéance — le jour même compris —, « Déclaration en retard » le lendemain', () => {
    expect(juger()).toEqual(A_DECLARER)
    expect(juger({ aujourdHui: '2027-11-10' })).toEqual(A_DECLARER)
    expect(juger({ aujourdHui: '2027-11-11' })).toEqual(EN_RETARD)
    // Un seul encaissement en retard suffit.
    expect(juger({ encaissements: [enc(), enc({ id: 'e2', date_encaissement: '2027-09-30' })] })).toEqual(EN_RETARD)
    expect(juger({ encaissements: [enc({ id: 'e2', date_encaissement: '2027-09-30' }), enc()] })).toEqual(EN_RETARD)
  })

  it('en franchise, l’échéance du bimestre : le 25 du mois qui le suit', () => {
    // Septembre-octobre 2027 : au plus tard le 25/11/2027.
    expect(juger({ statut: 'franchise', aujourdHui: '2027-11-25' })).toEqual(A_DECLARER)
    expect(juger({ statut: 'franchise', aujourdHui: '2027-11-26' })).toEqual(EN_RETARD)
  })

  it('rien quand tout ce qui compte est déclaré ; une déclaration échouée ou rejetée ne compte pas', () => {
    expect(juger({ declarations: [decl()] })).toBeNull()
    expect(juger({ declarations: [decl({ etat: 'accepte' })] })).toBeNull()
    expect(juger({ declarations: [decl({ etat: 'envoi' })] })).toBeNull()
    expect(juger({ declarations: [decl({ etat: 'rejete' })] })).toEqual(A_DECLARER)
    expect(juger({ declarations: [decl({ etat: 'echec' })] })).toEqual(A_DECLARER)
    // La déclaration d'un autre encaissement ne déclare pas celui-ci.
    expect(juger({ declarations: [decl({ encaissement_id: 'e2' })] })).toEqual(A_DECLARER)
  })

  it('un encaissement retiré, d’une autre facture ou d’un autre dossier ne compte pas', () => {
    expect(juger({ encaissements: [enc({ retire_le: '2027-10-21T08:00:00Z' })] })).toBeNull()
    expect(juger({ encaissements: [enc({ facture_id: 'f2' })] })).toBeNull()
    expect(juger({ encaissements: [enc({ dossier_id: 'd2' })] })).toBeNull()
    expect(juger({ encaissements: [] })).toBeNull()
  })

  it('une contre-passation de l’encaissement déclaré se déclare à son tour', () => {
    const encaissements = [enc(), enc({ id: 'e9', montant: -600, annule_id: 'e1', date_encaissement: '2027-09-28' })]
    expect(juger({ encaissements, declarations: [decl()] })).toEqual(EN_RETARD)
    expect(juger({ encaissements, declarations: [decl(), decl({ id: 'te9', encaissement_id: 'e9' })] })).toBeNull()
  })

  it('rien de ce qui ne se déclare pas d’ici : jamais acceptée par l’application, rejetée ou refusée', () => {
    // Jamais transmise, ou déposée sans accusé : une déclaration faite ailleurs ne s'inscrirait pas ici — même en retard,
    // la pastille ne s'allume pas, la fenêtre dit l'échéance et pourquoi.
    expect(juger({ transmissions: [] })).toBeNull()
    expect(juger({ transmissions: [], aujourdHui: '2028-01-01' })).toBeNull()
    expect(juger({ transmissions: [{ ...ACCEPTEE, etat: 'depose' }] })).toBeNull()
    expect(juger({ transmissions: [{ ...ACCEPTEE, etat: 'envoi' }] })).toBeNull()
    // La transmission d'une autre facture n'accepte pas celle-ci.
    expect(juger({ transmissions: [{ ...ACCEPTEE, facture_id: 'f2' }] })).toBeNull()
    expect(juger({ transmissions: [{ ...ACCEPTEE, etat: 'rejete' }] })).toBeNull()
    const superpdp: TransmissionPourDeclaration = { facture_id: 'f1', canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'accepte' }
    expect(juger({ transmissions: [superpdp], evenements: [{ facture_id: 'f1', status_code: 'fr:210' }] })).toBeNull()
    expect(juger({ transmissions: [superpdp], evenements: [{ facture_id: 'f1', status_code: 'fr:213' }] })).toBeNull()
    // L'historique d'une autre facture ne dit rien de celle-ci.
    expect(juger({ transmissions: [superpdp], evenements: [{ facture_id: 'f2', status_code: 'fr:210' }] })).toEqual(A_DECLARER)
  })

  it('rien quand la facture a été refusée (210) ou rejetée (213) sur la plateforme du client — même en retard (étape d7)', () => {
    expect(juger({ statutsRecus: [{ facture_id: 'f1', code: '210' }] })).toBeNull()
    expect(juger({ statutsRecus: [{ facture_id: 'f1', code: '213' }], aujourdHui: '2028-01-01' })).toBeNull()
    // Un litige, une approbation, un paiement transmis, un écho de l'encaissement : la facture vit, le statut reste dû.
    for (const code of ['205', '206', '207', '211', '212'] as const) {
      expect(juger({ statutsRecus: [{ facture_id: 'f1', code }] }), code).toEqual(A_DECLARER)
    }
    // Le refus d'une autre facture ne dit rien de celle-ci.
    expect(juger({ statutsRecus: [{ facture_id: 'f2', code: '210' }] })).toEqual(A_DECLARER)
  })

  it('rien quand l’obligation n’est pas due : facultative, sans objet, à préciser, refusée ; ni sur un brouillon ou un avoir', () => {
    expect(juger({ facture: { ...DUE, date_emission: '2027-08-31' }, aujourdHui: '2028-01-01' })).toBeNull()
    expect(juger({ facture: { ...DUE, type_client: 'non_assujetti' } })).toBeNull()
    expect(juger({ facture: { ...DUE, option_debits: null } })).toBeNull()
    expect(juger({ facture: { ...DUE, nature_operation: 'mixte' } })).toBeNull()
    expect(juger({ facture: { ...DUE, statut: 'brouillon' } })).toBeNull()
    expect(juger({ facture: { ...DUE, type: 'avoir' } })).toBeNull()
    expect(pastilleDeclaration('d1', DUE, LIGNES, [enc()], [], [ACCEPTEE], [], [], null, '2027-11-02')).toBeNull()
  })
})

describe('partsEnMots', () => {
  it('une part, deux parts, trois parts ; aucune', () => {
    expect(partsEnMots([{ taux: 20, centimes: 120000 }])).toMatch(/^1\s200,00\s€ à 20 %$/)
    expect(partsEnMots([{ taux: 20, centimes: 100000 }, { taux: 0, centimes: 20000 }])).toMatch(/^1\s000,00\s€ à 20 % et 200,00\s€ à 0 %$/)
    expect(partsEnMots([{ taux: 20, centimes: -50000 }, { taux: 5.5, centimes: -1000 }, { taux: 0, centimes: -500 }]))
      .toMatch(/^-500,00\s€ à 20 %, -10,00\s€ à 5,5 % et -5,00\s€ à 0 %$/)
    expect(partsEnMots([])).toBe('')
  })
})
