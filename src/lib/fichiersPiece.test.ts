import { describe, expect, it } from 'vitest'
import { fichierAMontrer, fichiersDeLaPiece } from './fichiersPiece'

describe('fichiersDeLaPiece', () => {
  it("une pièce déposée n'a qu'un fichier", () => {
    expect(fichiersDeLaPiece({ storage_path: 'd/1-facture.pdf', lisible_path: null })).toEqual(['d/1-facture.pdf'])
  })

  it("une facture reçue en XML emporte aussi sa version lisible, l'original d'abord", () => {
    expect(fichiersDeLaPiece({ storage_path: 'd/1-facture.xml', lisible_path: 'd/1-facture-lisible.pdf' }))
      .toEqual(['d/1-facture.xml', 'd/1-facture-lisible.pdf'])
  })

  it("un chemin vide ne s'envoie pas au retrait", () => {
    expect(fichiersDeLaPiece({ storage_path: '', lisible_path: null })).toEqual([])
  })
})

describe('fichierAMontrer', () => {
  it('une facture reçue en XML se montre par sa version lisible', () => {
    expect(fichierAMontrer({ storage_path: 'd/1-facture.xml', lisible_path: 'd/1-facture-lisible.pdf' }))
      .toEqual({ chemin: 'd/1-facture-lisible.pdf', lisible: true })
  })

  it('une pièce sans version lisible se montre par son original', () => {
    expect(fichierAMontrer({ storage_path: 'd/1-facture.pdf', lisible_path: null }))
      .toEqual({ chemin: 'd/1-facture.pdf', lisible: false })
  })
})
