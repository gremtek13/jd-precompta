import { describe, expect, it } from 'vitest'
import { soldeCca, type MouvementCca, type TypeMouvementCca } from './cca'

const mvt = (type: TypeMouvementCca, montant: number): MouvementCca =>
  ({ id: `${type}-${montant}`, compte_id: 'c1', date: '2026-03-10', type, montant, libelle: null,
     created_at: '2026-03-10T00:00:00Z' })

describe('soldeCca', () => {
  it('crédite sur un apport et des intérêts, débite sur un retrait', () => {
    // Le solde est vu du côté de l'associé : ce que la société lui doit. Un apport et les intérêts
    // augmentent cette dette, un retrait la rembourse.
    expect(soldeCca([mvt('apport', 10000), mvt('interet', 300), mvt('retrait', 2500)])).toBe(7800)
  })

  it('rend un solde négatif quand l’associé a retiré plus qu’il n’a apporté', () => {
    // Compte courant débiteur : l'associé doit de l'argent à la société. Situation à signaler en
    // comptabilité, pas une erreur de calcul — le solde doit donc pouvoir passer sous zéro.
    expect(soldeCca([mvt('apport', 1000), mvt('retrait', 2500)])).toBe(-1500)
  })

  it('rend zéro sans mouvement', () => {
    expect(soldeCca([])).toBe(0)
  })

  it('arrondit au centime', () => {
    expect(soldeCca([mvt('apport', 0.1), mvt('apport', 0.2)])).toBe(0.3) // 0.30000000000000004 sans arrondi
  })
})
