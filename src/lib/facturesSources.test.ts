import { describe, expect, it } from 'vitest'
import { exemplaireDUneSource, exemplairesDesSources, facturesSourcesDe, horsDesExemplairesDesSources, type FacturesSources } from './facturesSources'
import { exemplaireDUneFactureSource } from './ventesFacturees'
import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser, type PieceAComptabiliser } from './ecritures'
import { piecesDeviseNonConvertie, piecesValideesSansCategorie } from './controles'
import type { ModeleComptable } from './engagement'
import type { PaiementsDesPieces } from './rattachement'
import type { PlanComptable } from './planComptable'
import type { Categorie, EcritureBrouillon, FactureEmise, Piece } from './types'
import { ventesFactureesVides } from '../test/ventesFacturees'

// L'EXEMPLAIRE D'UNE FACTURE SOURCE (ligne 28.65, étape VF6a) : une règle, et les factures sources en paramètre
// obligatoire de chaque fonction qui juge une pièce. Données FICTIVES.

type FactureLue = Pick<FactureEmise, 'id' | 'statut' | 'source_de_la_vente'>
const facture = (o: Partial<FactureLue>): FactureLue => ({ id: 'f1', statut: 'validee', source_de_la_vente: true, ...o })
const SOURCES: FacturesSources = new Set(['f-source'])

describe('exemplaireDUneSource', () => {
  it('reconnaît la pièce désignée à une facture source, et elle seule', () => {
    expect(exemplaireDUneSource({ facture_id: 'f-source' }, SOURCES)).toBe(true)
    expect(exemplaireDUneSource({ facture_id: 'f-autre' }, SOURCES)).toBe(false)
    expect(exemplaireDUneSource({ facture_id: null }, SOURCES)).toBe(false)
    expect(exemplaireDUneSource({ facture_id: 'f-source' }, new Set())).toBe(false)
  })

  it('est la règle même des moteurs de VF3b (`exemplaireDUneFactureSource`)', () => {
    const ventes = { ...ventesFactureesVides('d1'), sources: SOURCES }
    for (const facture_id of ['f-source', 'f-autre', null]) {
      expect(exemplaireDUneFactureSource({ facture_id }, ventes)).toBe(exemplaireDUneSource({ facture_id }, SOURCES))
    }
  })
})

describe('horsDesExemplairesDesSources et exemplairesDesSources', () => {
  const pieces = [
    { id: 'p1', facture_id: null }, { id: 'p2', facture_id: 'f-source' }, { id: 'p3', facture_id: 'f-autre' },
  ]
  it('garde les pièces qui comptent, dans leur ordre — l’exemplaire d’une facture qui n’est pas source compris', () => {
    expect(horsDesExemplairesDesSources(pieces, SOURCES).map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(horsDesExemplairesDesSources(pieces, new Set()).map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })
  it('nomme, par identifiant, les pièces exemplaires d’une facture source', () => {
    expect([...exemplairesDesSources(pieces, SOURCES)]).toEqual(['p2'])
    expect([...exemplairesDesSources(pieces, new Set())]).toEqual([])
  })
})

describe('facturesSourcesDe', () => {
  it('ne retient que les factures validées et sources de leur vente', () => {
    const sources = facturesSourcesDe([
      facture({ id: 'f1' }),
      facture({ id: 'f2', source_de_la_vente: false }),
      // Défensif : la base refuse un brouillon source (`factures_emises_source_d_une_facture_validee`).
      facture({ id: 'f3', statut: 'brouillon' }),
      facture({ id: 'f4' }),
    ])
    expect([...sources]).toEqual(['f1', 'f4'])
  })
  it('lit une colonne absente — une ligne d’une lecture qui ne la demande pas — comme « pas source »', () => {
    const sansColonne = { id: 'f5', statut: 'validee' } as unknown as FactureLue
    expect([...facturesSourcesDe([sansColonne])]).toEqual([])
  })
})

// LES FACTURES SOURCES SONT UN PARAMÈTRE OBLIGATOIRE : aucune fonction qui juge une pièce ne se compile sans elles. Chaque
// appel ci-dessous les omet et porte `@ts-expect-error` — que `tsc -b` refuse dès qu'il n'y a plus d'erreur à attendre,
// c'est-à-dire dès qu'une valeur par défaut s'y glisserait. La fonction n'est jamais appelée : seul le compilateur la juge.
interface Entrees {
  pieces: Piece[]
  categories: Categorie[]
  ecritures: EcritureBrouillon[]
  aComptabiliser: PieceAComptabiliser[]
  paiements: PaiementsDesPieces
  modele: ModeleComptable
  plan: PlanComptable
}

describe('les factures sources sont un paramètre OBLIGATOIRE', () => {
  it('aucune fonction ne se compile sans elles (les directives `@ts-expect-error` sont jugées par tsc -b)', () => {
    const sansLesSources = (x: Entrees) => {
      // @ts-expect-error — omises
      piecesAComptabiliser(x.pieces, x.categories, new Map())
      // @ts-expect-error — omises
      ecrituresSansObjet(x.ecritures, x.pieces, x.categories, new Map(), null, x.plan)
      // @ts-expect-error — les exemplaires, omis
      analyserEcritures(x.ecritures, x.aComptabiliser, true, x.paiements, x.modele, null)
      // @ts-expect-error — omises
      piecesValideesSansCategorie(x.pieces, new Set())
      // @ts-expect-error — omises
      piecesDeviseNonConvertie(x.pieces)
    }
    expect(typeof sansLesSources).toBe('function')
  })
})
