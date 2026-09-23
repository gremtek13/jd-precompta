import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reglerPieceSurBanque } from './reglementBanque'
import type { LigneBancaire, Piece } from './types'

// LE CHEMIN D'ÉCRITURE, et il n'était gardé par rien — c'est une mutation qui l'a dit : « aucun
// alignement en euros » (le code tel qu'il était avant la décision du 23/09/2026) laissait les
// seize tests du chantier au VERT. Le CALCUL était couvert (alignementBanque.test.ts), le SIGNAL
// aussi (les deux écrans) ; ce que personne ne vérifiait est que la pièce soit réellement écrite.
const faux = vi.hoisted(() => ({ maj: [] as Record<string, unknown>[], erreur: null as unknown }))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'pieces') throw new Error(`Table non attendue dans ce test : ${table}`)
      return {
        update: (payload: Record<string, unknown>) => {
          faux.maj.push(payload)
          return { eq: () => Promise.resolve({ error: faux.erreur }) }
        },
      }
    },
  },
}))

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload',
    storage_path: 'd1/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-03-10', tiers: 'Fournisseur', montant_ht: 100, montant_tva: 20,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

function ligne(montant: number): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-03-12', montant,
    libelle: 'PRLV FOURNISSEUR', libelle_brut: null, statut: 'rapprochee',
    piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null,
    created_at: '2026-03-12T09:00:00Z',
  }
}

beforeEach(() => { faux.maj = []; faux.erreur = null })

describe('reglerPieceSurBanque — une pièce en euros', () => {
  it('aligne la pièce sur le débit réel quand l’écart tient sous le seuil', async () => {
    const rendue = await reglerPieceSurBanque(piece(), ligne(-120.06))

    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0].montant_ttc).toBeCloseTo(120.06, 10)
    expect(rendue.montant_ttc).toBeCloseTo(120.06, 10)
  })

  // UNE PIÈCE EN EUROS N'A AUCUN TAUX DE CHANGE, et lui en écrire un la ferait passer pour
  // convertie — donc afficher un cours qui n'a jamais existé sur un document en euros.
  it('n’écrit ni taux de change ni source de conversion', async () => {
    const rendue = await reglerPieceSurBanque(piece(), ligne(-120.06))

    expect(faux.maj[0]).not.toHaveProperty('taux_change')
    expect(faux.maj[0]).not.toHaveProperty('conversion_source')
    expect(rendue.conversion_source).toBeNull()
  })

  // GARDE SYMÉTRIQUE — sans elle, « on aligne » serait satisfait par une fonction qui écrase
  // TOUJOURS, y compris sur un paiement partiel, ce que toute cette décision existe pour éviter.
  it('n’écrit RIEN sur un écart large : un paiement partiel n’est pas une erreur de saisie', async () => {
    const rendue = await reglerPieceSurBanque(piece({ montant_ttc: 1000, montant_ht: null, montant_tva: null }), ligne(-500))

    expect(faux.maj).toHaveLength(0)
    expect(rendue.montant_ttc).toBe(1000)
  })

  it('n’écrit rien quand les montants sont déjà identiques', async () => {
    await reglerPieceSurBanque(piece(), ligne(-120))
    expect(faux.maj).toHaveLength(0)
  })

  // Le chemin d'origine, inchangé et sans seuil : le montant posé au taux BCE n'est qu'un
  // provisoire, donc le débit réel le remplace quel que soit l'écart.
  it('garde le chemin DEVISE sans seuil, avec son taux', async () => {
    const rendue = await reglerPieceSurBanque(
      piece({ devise: 'USD', montant_devise: 140, montant_ttc: 120, montant_ht: null, montant_tva: null }),
      ligne(-131.2),
    )

    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0].taux_change).toBeDefined()
    expect(faux.maj[0].conversion_source).toBe('banque')
    expect(rendue.conversion_source).toBe('banque')
  })

  // Non bloquant : le rapprochement lui-même est déjà écrit, donc remonter l'erreur ici déferait
  // un rapprochement correct. La pièce garde son montant d'origine.
  it('rend la pièce intacte si l’écriture échoue', async () => {
    faux.erreur = { message: 'refusé' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rendue = await reglerPieceSurBanque(piece(), ligne(-120.06))
    expect(rendue.montant_ttc).toBe(120)
  })
})
