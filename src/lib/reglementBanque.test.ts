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
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
  }
}

function ligne(montant: number): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2026-03-12', montant,
    libelle: 'PRLV FOURNISSEUR', libelle_brut: null, statut: 'rapprochee',
    piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    created_at: '2026-03-12T09:00:00Z',
  }
}

beforeEach(() => { faux.maj = []; faux.erreur = null })

describe('reglerPieceSurBanque — une pièce en euros', () => {
  it('aligne la pièce sur le débit réel quand l’écart tient sous le seuil', async () => {
    const rendue = await reglerPieceSurBanque(piece(), [ligne(-120.06)])

    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0].montant_ttc).toBeCloseTo(120.06, 10)
    expect(rendue.montant_ttc).toBeCloseTo(120.06, 10)
  })

  // UNE PIÈCE EN EUROS N'A AUCUN TAUX DE CHANGE, et lui en écrire un la ferait passer pour
  // convertie — donc afficher un cours qui n'a jamais existé sur un document en euros.
  it('n’écrit ni taux de change ni source de conversion', async () => {
    const rendue = await reglerPieceSurBanque(piece(), [ligne(-120.06)])

    expect(faux.maj[0]).not.toHaveProperty('taux_change')
    expect(faux.maj[0]).not.toHaveProperty('conversion_source')
    expect(rendue.conversion_source).toBeNull()
  })

  // GARDE SYMÉTRIQUE — sans elle, « on aligne » serait satisfait par une fonction qui écrase
  // TOUJOURS, y compris sur un paiement partiel, ce que toute cette décision existe pour éviter.
  it('n’écrit RIEN sur un écart large : un paiement partiel n’est pas une erreur de saisie', async () => {
    const rendue = await reglerPieceSurBanque(piece({ montant_ttc: 1000, montant_ht: null, montant_tva: null }), [ligne(-500)])

    expect(faux.maj).toHaveLength(0)
    expect(rendue.montant_ttc).toBe(1000)
  })

  it('n’écrit rien quand les montants sont déjà identiques', async () => {
    await reglerPieceSurBanque(piece(), [ligne(-120)])
    expect(faux.maj).toHaveLength(0)
  })

  // Le chemin d'origine, inchangé et sans seuil : le montant posé au taux BCE n'est qu'un
  // provisoire, donc le débit réel le remplace quel que soit l'écart.
  it('garde le chemin DEVISE sans seuil, avec son taux', async () => {
    const rendue = await reglerPieceSurBanque(
      piece({ devise: 'USD', montant_devise: 140, montant_ttc: 120, montant_ht: null, montant_tva: null }),
      [ligne(-131.2)],
    )

    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0].taux_change).toBeDefined()
    expect(faux.maj[0].conversion_source).toBe('banque')
    expect(rendue.conversion_source).toBe('banque')
  })

  // PAYÉE EN PLUSIEURS FOIS, ELLE SE RÈGLE SUR LE TOTAL. Réglée sur un paiement seul, une pièce de 40 € payée 20 +
  // 19,99 gardait un centime que rien n'écrit — son écriture déséquilibrée, la validation de son exercice refusée.
  it('aligne la pièce sur le TOTAL de ses paiements quand il tient sous le seuil', async () => {
    const quarante = piece({ montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 })
    const rendue = await reglerPieceSurBanque(quarante, [ligne(-20), ligne(-19.99)])

    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0]).toMatchObject({ montant_ttc: 39.99, montant_tva: 6.67, montant_ht: 33.32 })
    expect(rendue.montant_ttc).toBe(39.99)
  })

  // GARDE SYMÉTRIQUE : un paiement seul, quand d'autres la paient aussi, n'en est qu'une fraction — rien ne bouge
  // quand le total fait la pièce, ni quand il en reste à payer au-delà du seuil.
  it('ne l’aligne pas sur un paiement seul : le total fait foi', async () => {
    await reglerPieceSurBanque(piece({ montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 }), [ligne(-20), ligne(-20)])
    await reglerPieceSurBanque(piece({ montant_ttc: 1000, montant_ht: null, montant_tva: null }), [ligne(-500), ligne(-300)])
    expect(faux.maj).toHaveLength(0)
  })

  it('n’écrit rien quand les paiements s’annulent', async () => {
    await reglerPieceSurBanque(piece(), [ligne(-120), ligne(120)])
    expect(faux.maj).toHaveLength(0)
  })

  // En DEVISE, la pièce passe au total payé : réglée sur son seul dernier paiement, elle n'en valait qu'une part.
  it('règle une pièce en devise payée en deux fois sur le total des deux débits', async () => {
    const rendue = await reglerPieceSurBanque(
      piece({ devise: 'USD', montant_devise: 140, montant_ttc: 120, montant_ht: null, montant_tva: null }),
      [ligne(-60), ligne(-71.2)],
    )
    expect(faux.maj).toHaveLength(1)
    expect(faux.maj[0].montant_ttc).toBe(131.2)
    expect(rendue.conversion_source).toBe('banque')
  })

  // Le total se prend au centime : additionnés tels quels, 0,10 et 0,20 font 0,30000000000000004, et le taux d'une pièce
  // en devise se calculerait sur un débit que la banque n'a pas fait.
  it('calcule le taux d’une pièce en devise sur le total au centime', async () => {
    await reglerPieceSurBanque(
      piece({ devise: 'USD', montant_devise: 0.36, montant_ttc: 0.3, montant_ht: null, montant_tva: null }),
      [ligne(-0.1), ligne(-0.2)],
    )
    expect(faux.maj[0].taux_change).toBe(0.36 / 0.3)
  })

  // Non bloquant : le rapprochement lui-même est déjà écrit, donc remonter l'erreur ici déferait
  // un rapprochement correct. La pièce garde son montant d'origine.
  it('rend la pièce intacte si l’écriture échoue', async () => {
    faux.erreur = { message: 'refusé' }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rendue = await reglerPieceSurBanque(piece(), [ligne(-120.06)])
    expect(rendue.montant_ttc).toBe(120)
  })
})
