import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPTE_BANQUE } from './comptes'
import type { LigneBancaire, Piece } from './types'

// Le client Supabase est simulé plutôt que le module découpé : ces deux fonctions *sont* des appels à
// la base, il n'y a pas de calcul pur à extraire. Le faux client reproduit le chaînage réellement
// utilisé (`from().select().eq()`, `from().insert()`, `from().delete().eq().eq()`) et rend la réponse
// programmée par le test — de quoi vérifier ce qui est écrit, et ce qui se passe quand la base refuse.
const reponses = {
  select: { data: [] as { id: string; compte: string }[] | null, error: null as { message: string } | null },
  insert: { error: null as { message: string } | null },
  delete: { error: null as { message: string } | null },
}
let insere: Record<string, unknown> | null = null
let supprime = false

vi.mock('./supabase', () => {
  const resolvable = (op: 'select' | 'insert' | 'delete') => {
    const chaine = {
      eq: () => chaine,
      then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(reponses[op])),
    }
    return chaine
  }
  return {
    supabase: {
      from: () => ({
        select: () => resolvable('select'),
        insert: (payload: Record<string, unknown>) => { insere = payload; return resolvable('insert') },
        delete: () => { supprime = true; return resolvable('delete') },
      }),
    },
  }
})

const { synchroniserContrepartieBanque, retirerContrepartieBanque } = await import('./contrepartieBanque')

const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p1', dossier_id: 'd1', nom_fichier: 'facture.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ttc: 120, tiers: 'EDF', ...o,
} as Piece)

const ligne = (montant: number, o: Partial<LigneBancaire> = {}): LigneBancaire =>
  ({ id: 'l1', dossier_id: 'd1', date: '2026-03-12', libelle: 'PRLV EDF', montant, ...o } as LigneBancaire)

beforeEach(() => {
  reponses.select = { data: [{ id: 'e1', compte: '606100' }], error: null }
  reponses.insert = { error: null }
  reponses.delete = { error: null }
  insere = null
  supprime = false
})

describe('synchroniserContrepartieBanque', () => {
  it('déduit le sens du signe du mouvement, pas du type de la pièce', () => {
    // Le compte banque est un compte d'actif : une sortie d'argent le crédite, une entrée le débite.
    // Un remboursement reçu sur une pièce d'achat va dans l'autre sens que le type ne le laisse
    // croire — c'est le piège que ce choix évite.
    return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(-120))
      .then(() => { expect(insere).toMatchObject({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }) })
      .then(() => { insere = null; return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(45)) })
      .then(() => { expect(insere).toMatchObject({ sens: 'debit', montant: 45 }) })
  })

  it('prend le montant réel du mouvement, pas celui de la pièce', async () => {
    // Ils peuvent différer de quelques centimes (frais bancaires, arrondi) — c'est la banque qui fait foi.
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-119.98))
    expect(insere).toMatchObject({ montant: 119.98, date: '2026-03-12' })
  })

  it('libelle par le tiers, sinon par le nom du fichier', async () => {
    await synchroniserContrepartieBanque('d1', piece({ tiers: null }), ligne(-120))
    expect(insere).toMatchObject({ libelle: 'facture.pdf' })
  })

  it('n’écrit rien tant que la pièce n’a pas sa ligne de charge', async () => {
    // La contrepartie viendra d'elle-même quand les écritures seront générées.
    reponses.select = { data: [], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120))
    expect(insere).toBeNull()
  })

  it('reste idempotente : pas de doublon si la contrepartie existe déjà', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120))
    expect(insere).toBeNull()
  })

  it('lève quand la base refuse l’écriture, au lieu de rendre la main', async () => {
    // Sans cela, l'échec ne se voyait qu'indirectement : une pièce comptée « en attente de
    // rapprochement bancaire » dans la Checklist, sans qu'on sache que l'écriture avait été refusée.
    reponses.insert = { error: { message: 'new row violates row-level security policy' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120)))
      .rejects.toMatchObject({ message: expect.stringContaining('row-level security') })
  })

  it('lève aussi quand c’est la lecture préalable qui échoue', async () => {
    // Une lecture refusée rendait `data` nul, ce qui ressemblait à « pas encore d'écriture » : le
    // renoncement paraissait légitime alors qu'il masquait un refus.
    reponses.select = { data: null, error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120))).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

describe('retirerContrepartieBanque', () => {
  it('supprime la ligne banque de la pièce', async () => {
    await retirerContrepartieBanque('p1')
    expect(supprime).toBe(true)
  })

  it('lève quand la suppression échoue', async () => {
    // L'appelant doit pouvoir le dire : le rapprochement est annulé mais l'écriture de paiement
    // subsiste, pour un mouvement qui n'est plus rapproché.
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('p1')).rejects.toMatchObject({ message: 'permission denied' })
  })
})
