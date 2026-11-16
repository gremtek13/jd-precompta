import { describe, expect, it } from 'vitest'
import {
  ariaSortDe, choixDuSelecteur, etatDuSelecteur, trierLignes, triSuivant, valeurDuSelecteur,
  type ColonneTriable,
} from './triDesTableaux'

type Ligne = { id: string; date: string | null; montant: number | null; tiers: string | null; statut: string | null }
const ligne = (l: Partial<Ligne> & { id: string }): Ligne => ({ date: null, montant: null, tiers: null, statut: null, ...l })

const colonnes: ColonneTriable<Ligne>[] = [
  { cle: 'date', libelle: 'Date', type: 'date', valeur: (l) => l.date },
  { cle: 'montant', libelle: 'Montant', type: 'montant', valeur: (l) => l.montant },
  { cle: 'tiers', libelle: 'Tiers', type: 'texte', valeur: (l) => l.tiers },
  { cle: 'statut', libelle: 'Statut', type: 'rang', valeur: (l) => l.statut, ordre: ['a_valider', 'validee', 'rapprochee'] },
]
const ids = (l: Ligne[]) => l.map((x) => x.id)

describe('le cycle du tri au clic', () => {
  it('croissant, puis décroissant, puis l’ordre d’origine ; une autre colonne repart du croissant', () => {
    const a = triSuivant(null, 'date')
    expect(a).toEqual({ colonne: 'date', sens: 'croissant' })
    const b = triSuivant(a, 'date')
    expect(b).toEqual({ colonne: 'date', sens: 'decroissant' })
    expect(triSuivant(b, 'date')).toBeNull()
    expect(triSuivant(b, 'tiers')).toEqual({ colonne: 'tiers', sens: 'croissant' })
  })

  it('aria-sort suit l’état, et « none » pour toute autre colonne', () => {
    expect(ariaSortDe(null, 'date')).toBe('none')
    expect(ariaSortDe({ colonne: 'date', sens: 'croissant' }, 'date')).toBe('ascending')
    expect(ariaSortDe({ colonne: 'date', sens: 'decroissant' }, 'date')).toBe('descending')
    expect(ariaSortDe({ colonne: 'date', sens: 'decroissant' }, 'tiers')).toBe('none')
  })
})

describe('trierLignes, par type de colonne', () => {
  it('une date civile se compare en chaîne ; une forme inconnue est vide, en fin', () => {
    const l = [ligne({ id: 'a', date: '2026-03-01' }), ligne({ id: 'b', date: '01/02/2026' }), ligne({ id: 'c', date: '2025-12-31' }), ligne({ id: 'd', date: '2026-01-15T10:00:00Z' })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'date', sens: 'croissant' }))).toEqual(['c', 'd', 'a', 'b'])
    expect(ids(trierLignes(l, colonnes, { colonne: 'date', sens: 'decroissant' }))).toEqual(['a', 'd', 'c', 'b'])
  })

  it('un montant se compare en nombre (10 après 9), négatifs compris ; un non-nombre est vide', () => {
    const l = [ligne({ id: 'a', montant: 10 }), ligne({ id: 'b', montant: 9 }), ligne({ id: 'c', montant: -3 }), ligne({ id: 'd', montant: Number.NaN })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'croissant' }))).toEqual(['c', 'b', 'a', 'd'])
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'decroissant' }))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('un texte se compare en français : sans casse ni accent, les nombres dans l’ordre des nombres', () => {
    const l = [ligne({ id: 'a', tiers: 'Zèbre' }), ligne({ id: 'b', tiers: 'écureuil' }), ligne({ id: 'c', tiers: 'Agence 10' }), ligne({ id: 'd', tiers: 'agence 9' }), ligne({ id: 'e', tiers: '  ' })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'tiers', sens: 'croissant' }))).toEqual(['d', 'c', 'b', 'a', 'e'])
  })

  it('un rang suit la liste d’ordre ; une valeur hors liste après elle, les vides en fin', () => {
    const l = [ligne({ id: 'a', statut: 'rapprochee' }), ligne({ id: 'b', statut: 'inconnu' }), ligne({ id: 'c', statut: null }), ligne({ id: 'd', statut: 'a_valider' })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'statut', sens: 'croissant' }))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(trierLignes(l, colonnes, { colonne: 'statut', sens: 'decroissant' }))).toEqual(['b', 'a', 'd', 'c'])
  })

  it('les vides restent en FIN dans les deux sens, dans leur ordre d’origine', () => {
    const l = [ligne({ id: 'v1' }), ligne({ id: 'a', montant: 1 }), ligne({ id: 'v2' }), ligne({ id: 'b', montant: 2 })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'croissant' }))).toEqual(['a', 'b', 'v1', 'v2'])
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'decroissant' }))).toEqual(['b', 'a', 'v1', 'v2'])
  })

  it('le tri est STABLE : à égalité, l’ordre d’origine tient dans les deux sens', () => {
    const l = [ligne({ id: 'x', montant: 5 }), ligne({ id: 'y', montant: 1 }), ligne({ id: 'z', montant: 5 }), ligne({ id: 'w', montant: 5 })]
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'croissant' }))).toEqual(['y', 'x', 'z', 'w'])
    expect(ids(trierLignes(l, colonnes, { colonne: 'montant', sens: 'decroissant' }))).toEqual(['x', 'z', 'w', 'y'])
  })

  it('sans tri, ou sur une colonne inconnue, l’ordre d’origine — une copie, la liste reçue intacte', () => {
    const l = [ligne({ id: 'b', montant: 2 }), ligne({ id: 'a', montant: 1 })]
    const sans = trierLignes(l, colonnes, null)
    expect(ids(sans)).toEqual(['b', 'a'])
    expect(sans).not.toBe(l)
    expect(ids(trierLignes(l, colonnes, { colonne: 'absente', sens: 'croissant' }))).toEqual(['b', 'a'])
    trierLignes(l, colonnes, { colonne: 'montant', sens: 'croissant' })
    expect(ids(l)).toEqual(['b', 'a'])
  })

  it('le tri ne retire ni n’ajoute aucune ligne', () => {
    const l = Array.from({ length: 50 }, (_, i) => ligne({ id: `p${i}`, montant: (i * 7) % 11, tiers: i % 3 ? `T${i % 5}` : null }))
    for (const c of colonnes) for (const sens of ['croissant', 'decroissant'] as const) {
      expect(ids(trierLignes(l, colonnes, { colonne: c.cle, sens })).sort()).toEqual(ids(l).sort())
    }
  })
})

describe('le sélecteur « Trier par » d’un tableau replié', () => {
  it('offre l’origine puis chaque colonne dans les deux sens, et relit sa valeur', () => {
    const choix = choixDuSelecteur(colonnes)
    expect(choix[0]).toEqual({ valeur: '', libelle: 'Ordre d’origine' })
    expect(choix).toHaveLength(1 + 2 * colonnes.length)
    expect(choix[1].libelle).toBe('Date — plus ancienne d’abord')
    const etat = etatDuSelecteur('tiers:decroissant', colonnes)
    expect(etat).toEqual({ colonne: 'tiers', sens: 'decroissant' })
    expect(valeurDuSelecteur(etat)).toBe('tiers:decroissant')
    expect(etatDuSelecteur('', colonnes)).toBeNull()
    expect(etatDuSelecteur('absente:croissant', colonnes)).toBeNull()
  })
})
