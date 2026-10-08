import { describe, expect, it } from 'vitest'
import { lireMontantSaisi, montantPourSaisie, pastilleEncaissement, tauxAffiche } from './encaissementsAffichage'
import type { EncaissementLu, LigneDeFacture, PartLue } from './encaissementsFactures'
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
