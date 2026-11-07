import { describe, expect, it } from 'vitest'
import {
  ensembleDuJour, ensemblesDesJours, type EncaissementDeLaCaisse, type EtatDeLaCaisse, type FactureDeLaCaisse,
  type OperationDeLaCaisse,
} from './caisse'
import type { GenreOperationCaisse, MoyenEncaissement } from './types'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// L'INDEX DE L'ENSEMBLE DU JOUR (le banc de charge, 07/11/2026) : `ensemblesDesJours` indexe l'état une fois, là où
// `ensembleDuJour`, gardée telle quelle, parcourt les encaissements et les opérations pour chaque jour. Les deux formes se
// confrontent sur des caisses tirées d'une graine fixe — factures sources ou non, encaissements en espèces ou non, avec un
// mouvement ou sans, retirés, contre-passés ; paiements de pièces de vente ou d'achat, retirés ; d'autres genres — et
// sur chaque jour de l'année, plus des jours que rien ne porte : mêmes identifiants, même ordre.

const MOYENS: readonly MoyenEncaissement[] = ['especes', 'especes', 'especes', 'virement', 'cheque', 'compensation']
const GENRES: readonly GenreOperationCaisse[] = ['paiement', 'paiement', 'recette', 'apport', 'prelevement']

function jour(rang: number): string {
  const d = new Date(Date.UTC(2026, 0, 1 + rang))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function etatTire(graine: number, volume: number): EtatDeLaCaisse {
  const suivant = tirage(graine)
  const entier = (n: number) => entierTire(suivant, n)
  const parmi = <T>(liste: readonly T[]): T => liste[entier(liste.length)]
  const factures: FactureDeLaCaisse[] = Array.from({ length: Math.max(1, volume / 4) }, (_, i) => ({
    id: `f-${i}`, numero: suivant() < 0.9 ? `F${i}` : null, source_de_la_vente: suivant() < 0.7,
  }))
  const encaissements: EncaissementDeLaCaisse[] = []
  for (let i = 0; i < volume; i++) {
    const annule = encaissements.length > 0 && suivant() < 0.1 ? parmi(encaissements) : null
    encaissements.push({
      // Des identifiants qui ne suivent pas l'ordre d'insertion : le tri du jour se voit.
      id: `e-${entier(1_000_000)}-${i}`, facture_id: suivant() < 0.97 ? parmi(factures).id : 'f-absente',
      date_encaissement: jour(entier(380)), montant: entier(50_000) / 100,
      moyen: parmi(MOYENS), ligne_bancaire_id: suivant() < 0.2 ? `l-${i}` : null,
      annule_id: annule?.id ?? null, retire_le: suivant() < 0.1 ? '2026-12-01T10:00:00Z' : null,
    })
  }
  const pieces = Array.from({ length: Math.max(1, volume / 3) }, (_, i) => `p-${i}`)
  const operations: OperationDeLaCaisse[] = []
  for (let i = 0; i < volume; i++) {
    operations.push({
      id: `o-${entier(1_000_000)}-${i}`, genre: parmi(GENRES), date: jour(entier(380)), montant: entier(50_000) / 100,
      retire_le: suivant() < 0.1 ? '2026-12-01T10:00:00Z' : null, origine: 'cabinet', cree_par: null, remplace_id: null,
      categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: suivant() < 0.8 ? parmi(pieces) : null,
    })
  }
  return {
    compteCaisse: '530000', ouvertures: [], mouvements: [], encaissements, factures, operations,
    piecesDeVente: suivant() < 0.9 ? pieces.filter(() => suivant() < 0.5) : undefined,
  }
}

describe('ensemblesDesJours rend, pour chaque jour, ce que rend ensembleDuJour', () => {
  for (const [graine, volume] of [[1, 0], [3, 20], [2026, 1000], [42, 4000]] as const) {
    it(`graine ${graine}, ${volume} encaissements et ${volume} opérations`, () => {
      const etat = etatTire(graine, volume)
      const ensembleDe = ensemblesDesJours(etat)
      let nonVides = 0
      for (let r = -3; r < 400; r++) {
        const j = jour(r)
        const attendu = ensembleDuJour(etat, j)
        expect(ensembleDe(j)).toEqual(attendu)
        if (attendu.length > 0) nonVides++
      }
      expect(ensembleDe('pas-une-date')).toEqual(ensembleDuJour(etat, 'pas-une-date'))
      // Le jeu n'est pas aveugle : sur une grande caisse, bien des jours portent des espèces.
      if (volume >= 1000) expect(nonVides).toBeGreaterThan(100)
    })
  }

  it('sans pièces de vente, aucun paiement : comme ensembleDuJour', () => {
    const etat = { ...etatTire(8, 500), piecesDeVente: undefined }
    const ensembleDe = ensemblesDesJours(etat)
    for (let r = 0; r < 365; r++) expect(ensembleDe(jour(r))).toEqual(ensembleDuJour(etat, jour(r)))
  })

  it('rend un tableau neuf à chaque lecture : le modifier ne touche pas l’index', () => {
    const etat = etatTire(11, 800)
    const ensembleDe = ensemblesDesJours(etat)
    const j = Array.from({ length: 365 }, (_, r) => jour(r)).find((x) => ensembleDe(x).length > 0)!
    const avant = ensembleDe(j)
    ensembleDe(j).length = 0
    expect(ensembleDe(j)).toEqual(avant)
  })
})
