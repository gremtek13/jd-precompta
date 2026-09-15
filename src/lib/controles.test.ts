import { describe, expect, it } from 'vitest'
import { categoriesSansCompte, categoriesSansPoste, piecesSansTva } from './controles'
import type { Categorie, Piece } from './types'

const categorie = (o: Partial<Categorie>): Categorie =>
  ({ id: 'c1', dossier_id: null, libelle: 'Achats', code: 'achats', compte_comptable: '606100',
     poste_2035: 'Achats', ...o } as Categorie)

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: 20, montant_ttc: 120,
  categorie_id: 'c1', created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

describe('categoriesSansCompte', () => {
  it('ne signale que les catégories réellement utilisées', () => {
    // Une catégorie sans compte mais que personne n'emploie ne bloque rien : la signaler
    // encombrerait la checklist sans qu'il y ait quoi que ce soit à corriger.
    const categories = [
      categorie({ id: 'utilisee', compte_comptable: null }),
      categorie({ id: 'inutilisee', compte_comptable: null }),
      categorie({ id: 'complete', compte_comptable: '606100' }),
    ]
    const manquantes = categoriesSansCompte(categories, [piece({ categorie_id: 'utilisee' })])
    expect(manquantes.map((c) => c.id)).toEqual(['utilisee'])
  })

  it('ne signale rien quand tout est renseigné', () => {
    expect(categoriesSansCompte([categorie({})], [piece({})])).toEqual([])
  })
})

describe('categoriesSansPoste', () => {
  it('suit la même règle côté poste 2035', () => {
    const categories = [
      categorie({ id: 'sans', poste_2035: null }),
      categorie({ id: 'avec', poste_2035: 'Achats' }),
    ]
    const manquantes = categoriesSansPoste(categories, [
      piece({ id: 'a', categorie_id: 'sans' }),
      piece({ id: 'b', categorie_id: 'avec' }),
    ])
    expect(manquantes.map((c) => c.id)).toEqual(['sans'])
  })
})

describe('piecesSansTva', () => {
  it('ne signale rien sur un dossier non assujetti', () => {
    // L'absence de TVA y est la norme, pas un oubli.
    expect(piecesSansTva([piece({ montant_tva: null })], false)).toEqual([])
  })

  it('signale une pièce sans TVA sur un dossier assujetti', () => {
    const oubli = piece({ id: 'oubli', montant_tva: null })
    expect(piecesSansTva([oubli, piece({ id: 'ok', montant_tva: 20 })], true).map((p) => p.id)).toEqual(['oubli'])
  })

  it('ignore une pièce sans montant du tout', () => {
    // Rien de saisi : ce n'est pas un oubli de TVA, c'est une pièce pas encore renseignée.
    expect(piecesSansTva([piece({ montant_ttc: null, montant_tva: null })], true)).toEqual([])
  })

  it('traite une TVA à zéro comme une TVA absente', () => {
    // Conséquence du test `!p.montant_tva`. Sans effet en pratique : une facture exonérée est
    // enregistrée avec une TVA nulle, jamais à zéro — aucune pièce en base n'a de TVA à 0.
    // Documenté ici pour que le jour où ce cas apparaîtrait, le choix soit visible plutôt que subi.
    expect(piecesSansTva([piece({ id: 'exonere', montant_tva: 0 })], true).map((p) => p.id)).toEqual(['exonere'])
  })
})
