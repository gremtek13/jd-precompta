import { describe, expect, it } from 'vitest'
import { absenceFec, rupturesPisteAudit } from './pisteAudit'
import { genererFec } from './fec'
import { COMPTE_BANQUE } from './comptes'
import { analyserEcritures } from './ecritures'
import type { Categorie, EcritureBrouillon, Piece } from './types'

const piece = (id: string, o: Partial<Piece> = {}): Piece => ({
  id, dossier_id: 'd1', nom_fichier: `${id}.pdf`, chemin_stockage: '', statut: 'validee',
  type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
  montant_ttc: 100, tiers: null, categorie_id: 'c1', sous_dossier_id: null, notes: null,
  created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: `e-${o.compte ?? '606100'}-${o.piece_id ?? 'nulle'}`, dossier_id: 'd1', piece_id: 'p1',
  ligne_bancaire_id: null, date: '2026-03-10', libelle: 'Fournisseur', sens: 'debit',
  statut: 'proposee', compte: '606100', montant: 100, created_at: '2026-03-10T00:00:00Z', ...o,
} as EcritureBrouillon)

describe('rupturesPisteAudit', () => {
  it('signale une écriture qui ne désigne aucun justificatif', () => {
    const orpheline = ecriture({ piece_id: null, montant: 199.99 })
    const ruptures = rupturesPisteAudit([ecriture(), orpheline])
    expect(ruptures).toHaveLength(1)
    expect(ruptures[0].motif).toBe('sans_justificatif')
    expect(ruptures[0].ecriture.montant).toBe(199.99)
  })

  it("signale une contrepartie banque qui n'indique aucun mouvement", () => {
    // Ne peut venir que d'une ligne bancaire supprimée : l'insertion pose toujours le lien.
    const ruptures = rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: null })])
    expect(ruptures.map((r) => r.motif)).toEqual(['sans_mouvement'])
  })

  it('ne signale pas une contrepartie banque correctement reliée', () => {
    expect(rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })])).toEqual([])
  })

  it("ne signale pas une écriture de charge sans ligne bancaire — ce n'est pas une contrepartie", () => {
    // Le cas NORMAL et de loin le plus fréquent : la ligne de charge n'a jamais de lien bancaire,
    // seule la contrepartie en porte un. Confondre les deux ferait crier au loup sur tout le brouillon.
    expect(rupturesPisteAudit([ecriture({ compte: '606100', ligne_bancaire_id: null })])).toEqual([])
  })

  it('rend les DEUX ruptures quand une contrepartie a tout perdu', () => {
    const ruptures = rupturesPisteAudit([ecriture({ compte: COMPTE_BANQUE, piece_id: null, ligne_bancaire_id: null })])
    expect(ruptures.map((r) => r.motif).sort()).toEqual(['sans_justificatif', 'sans_mouvement'])
  })

  it('rend une liste vide sur un brouillon sain', () => {
    expect(rupturesPisteAudit([ecriture(), ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })])).toEqual([])
  })
})

describe("l'angle mort que ce module ferme", () => {
  // Le cœur du chantier : cette écriture existe, pèse 199,99 € et n'est vue par rien.
  const orpheline = ecriture({ piece_id: null, montant: 199.99, compte: '606100' })
  const saine = ecriture({ piece_id: 'p1', montant: 100 })

  it('est invisible aux trois contrôles de analyserEcritures', () => {
    const { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees } =
      analyserEcritures([orpheline], [])
    expect(nbSansContrepartie).toBe(0)
    expect(groupesDesequilibres).toEqual([])
    expect(piecesDesynchronisees).toEqual([])
  })

  it('est absente du FEC', () => {
    const categories: Categorie[] = []
    const lignes = genererFec([orpheline, saine], [piece('p1')], categories).split('\r\n').filter(Boolean)
    // En-tête + la seule écriture justifiée : l'orpheline n'y est pas.
    expect(lignes).toHaveLength(2)
    expect(lignes.join('\n')).not.toContain('199,99')
  })

  it('mais pèse dans les totaux — et absenceFec chiffre exactement ce que le FEC ne dira pas', () => {
    expect(absenceFec([orpheline, saine])).toEqual({ nb: 1, debit: 199.99, credit: 0 })
  })
})

describe('absenceFec', () => {
  it('sépare le débit du crédit', () => {
    const r = absenceFec([
      ecriture({ piece_id: null, montant: 10, sens: 'debit' }),
      ecriture({ piece_id: null, montant: 4, sens: 'credit' }),
      ecriture({ piece_id: 'p1', montant: 999, sens: 'debit' }),
    ])
    expect(r).toEqual({ nb: 2, debit: 10, credit: 4 })
  })

  it('rend des zéros sur un brouillon sain', () => {
    expect(absenceFec([ecriture(), ecriture({ compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' })]))
      .toEqual({ nb: 0, debit: 0, credit: 0 })
  })
})
