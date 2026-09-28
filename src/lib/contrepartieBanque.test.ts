import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPTE_BANQUE, COMPTE_FOURNISSEURS } from './comptes'
import type { ModeleComptable } from './engagement'
import type { LigneBancaire, Piece } from './types'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// Le client Supabase est simulé plutôt que le module découpé : ces deux fonctions *sont* des appels à
// la base, il n'y a pas de calcul pur à extraire. Le faux client reproduit le chaînage réellement
// utilisé (`from().select().eq()`, `from().insert()`, `from().delete().eq().eq()`) et rend la réponse
// programmée par le test — de quoi vérifier ce qui est écrit, et ce qui se passe quand la base refuse.
const reponses = {
  select: { data: [] as { id: string; compte: string; ligne_bancaire_id?: string | null }[] | null, error: null as { message: string } | null },
  insert: { error: null as { message: string } | null },
  delete: { error: null as { message: string } | null },
  update: { error: null as { message: string } | null },
}
// Un objet en trésorerie (la contrepartie seule), un tableau en engagement (les deux lignes du règlement).
let insere: unknown = null
let supprime = false
// Les filtres de la suppression : c'est ce qui dit QUELLES lignes partent.
let filtresSuppression: string[] = []
// Les mises à jour de date, avec leurs filtres : c'est ce qui dit QUELLES lignes changent de date —
// la contrepartie banque, elle, garde toujours la date de son mouvement.
let misesAJour: { valeurs: Record<string, unknown>; filtres: string[] }[] = []

vi.mock('./supabase', () => {
  const resolvable = (op: 'select' | 'insert' | 'delete' | 'update', filtres: string[] = []) => {
    const chaine = {
      eq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}=${valeur}`); return chaine },
      neq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}!=${valeur}`); return chaine },
      then: (resoudre: (v: unknown) => unknown) => Promise.resolve(resoudre(reponses[op])),
    }
    return chaine
  }
  return {
    supabase: {
      from: () => ({
        select: () => resolvable('select'),
        insert: (payload: Record<string, unknown>) => { insere = payload; return resolvable('insert') },
        delete: () => { supprime = true; filtresSuppression = []; return resolvable('delete', filtresSuppression) },
        update: (valeurs: Record<string, unknown>) => {
          const filtres: string[] = []
          misesAJour.push({ valeurs, filtres })
          return resolvable('update', filtres)
        },
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
  reponses.update = { error: null }
  insere = null
  supprime = false
  filtresSuppression = []
  misesAJour = []
})

describe('synchroniserContrepartieBanque', () => {
  it('déduit le sens du signe du mouvement, pas du type de la pièce', () => {
    // Le compte banque est un compte d'actif : une sortie d'argent le crédite, une entrée le débite.
    // Un remboursement reçu sur une pièce d'achat va dans l'autre sens que le type ne le laisse
    // croire — c'est le piège que ce choix évite.
    return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(-120), TRESORERIE)
      .then(() => { expect(insere).toMatchObject({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }) })
      .then(() => { insere = null; return synchroniserContrepartieBanque('d1', piece({ type_piece: 'achat' }), ligne(45), TRESORERIE) })
      .then(() => { expect(insere).toMatchObject({ sens: 'debit', montant: 45 }) })
  })

  it('prend le montant réel du mouvement, pas celui de la pièce', async () => {
    // Ils peuvent différer de quelques centimes (frais bancaires, arrondi) — c'est la banque qui fait foi.
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-119.98), TRESORERIE)
    expect(insere).toMatchObject({ montant: 119.98, date: '2026-03-12' })
  })

  it('libelle par le tiers, sinon par le nom du fichier', async () => {
    await synchroniserContrepartieBanque('d1', piece({ tiers: null }), ligne(-120), TRESORERIE)
    expect(insere).toMatchObject({ libelle: 'facture.pdf' })
  })

  it('n’écrit rien tant que la pièce n’a pas sa ligne de charge', async () => {
    // La contrepartie viendra d'elle-même quand les écritures seront générées.
    reponses.select = { data: [], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(insere).toBeNull()
  })

  it('reste idempotente : pas de doublon si la contrepartie existe déjà', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(insere).toBeNull()
  })

  it('lève quand la base refuse l’écriture, au lieu de rendre la main', async () => {
    // Sans cela, l'échec ne se voyait qu'indirectement : une pièce comptée « en attente de
    // rapprochement bancaire » dans la Checklist, sans qu'on sache que l'écriture avait été refusée.
    reponses.insert = { error: { message: 'new row violates row-level security policy' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE))
      .rejects.toMatchObject({ message: expect.stringContaining('row-level security') })
  })

  it('lève aussi quand c’est la lecture préalable qui échoue', async () => {
    // Une lecture refusée rendait `data` nul, ce qui ressemblait à « pas encore d'écriture » : le
    // renoncement paraissait légitime alors qu'il masquait un refus.
    reponses.select = { data: null, error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

// L'ÉCRITURE SUIT LA DATE DU PAIEMENT, comme la 2035 compte la pièce (lib/rattachement.ts) : générée
// avant le rapprochement, elle portait la date de facture.
describe('synchroniserContrepartieBanque — la date du paiement', () => {
  it("passe l'écriture à la date du paiement qui règle la pièce, sans toucher la contrepartie", async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-12' }, filtres: ['piece_id=p1', `compte!=${COMPTE_BANQUE}`] }])
  })

  it('tient pour réglée une pièce payée à des frais près', async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 120 }), ligne(-119.98), TRESORERIE)
    expect(misesAJour).toHaveLength(1)
  })

  it("laisse la date d'une pièce réglée en partie : « Régénérer » la répartira", async () => {
    await synchroniserContrepartieBanque('d1', piece({ montant_ttc: 1000 }), ligne(-400), TRESORERIE)
    expect(misesAJour).toEqual([])
    expect(insere).toMatchObject({ compte: COMPTE_BANQUE, montant: 400 })
  })

  it('ne touche à rien quand la contrepartie existe déjà', async () => {
    reponses.select = { data: [{ id: 'e1', compte: '606100' }, { id: 'e2', compte: COMPTE_BANQUE }], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)
    expect(misesAJour).toEqual([])
  })

  it("lève quand la date ne peut pas être écrite, avant d'écrire la contrepartie", async () => {
    // L'ordre garde le message de l'appelant vrai : « la contrepartie n'a pas pu être créée ».
    reponses.update = { error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

describe('retirerContrepartieBanque', () => {
  it('supprime la ligne banque de la pièce', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(supprime).toBe(true)
  })

  it('lève quand la suppression échoue', async () => {
    // L'appelant doit pouvoir le dire : le rapprochement est annulé mais l'écriture de paiement
    // subsiste, pour un mouvement qui n'est plus rapproché.
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
  })

  it("rend l'écriture à la date de sa facture : plus rien ne la date au paiement", async () => {
    await retirerContrepartieBanque('l1', 'p1', piece({ date_piece: '2026-03-10' }), TRESORERIE)
    expect(misesAJour).toEqual([{ valeurs: { date: '2026-03-10' }, filtres: ['piece_id=p1'] }])
  })

  it('à la date de dépôt pour une pièce sans date, comme la génération', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece({ date_piece: null, created_at: '2026-03-01T10:00:00Z' }), TRESORERIE)
    expect(misesAJour[0].valeurs).toEqual({ date: '2026-03-01' })
  })

  it("ne date rien quand l'écran n'a pas la pièce", async () => {
    await retirerContrepartieBanque('l1', 'p1', null, TRESORERIE)
    expect(supprime).toBe(true)
    expect(misesAJour).toEqual([])
  })

  it('lève quand la date ne peut pas être rendue', async () => {
    reponses.update = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)).rejects.toMatchObject({ message: 'permission denied' })
  })
})

// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT : le compte de tiers contre la
// banque, au mouvement — et ne redate jamais la facture.
describe('synchroniserContrepartieBanque — en engagement', () => {
  beforeEach(() => {
    reponses.select = { data: [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: COMPTE_FOURNISSEURS, ligne_bancaire_id: null }], error: null }
  })

  it('écrit le règlement du mouvement, 401 contre 512, sans redater la facture', async () => {
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 120, date: '2026-03-12', ligne_bancaire_id: 'l1' }),
      expect.objectContaining({ compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date: '2026-03-12', ligne_bancaire_id: 'l1' }),
    ])
    expect(misesAJour).toEqual([])
  })

  it('n’écrit rien tant que la facture n’est pas générée — la génération écrira les deux', async () => {
    reponses.select = { data: [], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toBeNull()
  })

  it('reste idempotente PAR MOUVEMENT : un second paiement reçoit son propre règlement', async () => {
    reponses.select = { data: [
      { id: 'e1', compte: '606100', ligne_bancaire_id: null },
      { id: 'e3', compte: COMPTE_BANQUE, ligne_bancaire_id: 'l1' },
    ], error: null }
    await synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)
    expect(insere).toBeNull()
    await synchroniserContrepartieBanque('d1', piece(), ligne(-60, { id: 'l2' }), ENGAGEMENT)
    expect(insere).toEqual([
      expect.objectContaining({ ligne_bancaire_id: 'l2', montant: 60 }),
      expect.objectContaining({ ligne_bancaire_id: 'l2', montant: 60 }),
    ])
  })

  it('lève quand la base refuse le règlement', async () => {
    reponses.insert = { error: { message: 'new row violates row-level security policy' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT))
      .rejects.toMatchObject({ message: expect.stringContaining('row-level security') })
  })

  it('lève quand la lecture préalable échoue, sans rien écrire', async () => {
    reponses.select = { data: null, error: { message: 'permission denied' } }
    await expect(synchroniserContrepartieBanque('d1', piece(), ligne(-120), ENGAGEMENT)).rejects.toMatchObject({ message: 'permission denied' })
    expect(insere).toBeNull()
  })
})

describe('retirerContrepartieBanque — en engagement', () => {
  it('retire le règlement de CE mouvement, et ne redate rien', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece(), ENGAGEMENT)
    expect(filtresSuppression).toEqual(['ligne_bancaire_id=l1'])
    expect(misesAJour).toEqual([])
  })

  it('retire en trésorerie la contrepartie de la pièce, comme avant', async () => {
    await retirerContrepartieBanque('l1', 'p1', piece(), TRESORERIE)
    expect(filtresSuppression).toEqual(['piece_id=p1', `compte=${COMPTE_BANQUE}`])
  })

  it('lève quand la suppression échoue', async () => {
    reponses.delete = { error: { message: 'permission denied' } }
    await expect(retirerContrepartieBanque('l1', 'p1', piece(), ENGAGEMENT)).rejects.toMatchObject({ message: 'permission denied' })
  })
})
