import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FactureApercu from './FactureApercu'
import { MENTIONS_VIDES } from '../../test/factures'
import { SIREN_CLIENT, SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'
import type { DossierCii } from '../../lib/factureCii'
import type { FactureEmise, StatutTva } from '../../lib/types'

// L'APERÇU EST LE DOCUMENT QU'ON IMPRIME ET QU'ON ENVOIE (ligne 28.5, étape c4) : il imprime les mentions que la facture
// porte — le SIREN du client, la catégorie de l'opération, sa date ou sa période, l'adresse de livraison, l'option pour
// les débits, ce qu'un organisme public demande —, et seulement elles. Ses notes, internes, n'y paraissent jamais.

vi.mock('../../lib/supabase', () => {
  const lignes = [{ id: 'l1', facture_id: 'f1', ordre: 0, designation: 'Mission de conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]
  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'facture_lignes') throw new Error(`Table non attendue dans ce test : ${table}`)
        const requete = { select: () => requete, eq: () => requete, order: () => Promise.resolve({ data: lignes, error: null }) }
        return requete
      },
    },
  }
})

function validee(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'd1', numero: 'F2026-0012', statut: 'validee', type: 'facture', facture_origine_id: null,
    date_emission: '2026-09-30', date_echeance: '2026-10-30', tiers_nom: 'Client Fictif SAS', tiers_adresse: null, tiers_siret: null,
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, mentions_legales: null, notes: 'Client lent à payer : relancer le 10.',
    emetteur_nom: 'Atelier Démo Conseil', emetteur_siret: null, emetteur_adresse: null, superpdp_invoice_id: null,
    superpdp_dernier_statut: null, tiers_email: null, created_by: null, created_at: '2026-09-30T08:00:00Z',
    validated_at: '2026-09-30T08:05:00Z', ...MENTIONS_VIDES, ...o,
  }
}

afterEach(() => cleanup())

const REDEVABLE: DossierCii = { statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }

describe('FactureApercu — les mentions imprimées', () => {
  it('imprime les mentions que la facture porte', async () => {
    render(<FactureApercu facture={validee({
      type_client: 'organisme_public', tiers_siren: SIREN_CLIENT, nature_operation: 'mixte', periode_debut: '2026-09-01',
      periode_fin: '2026-09-30', livraison_adresse: '3 quai des Essais', livraison_code_postal: '1000', livraison_ville: 'Bruxelles',
      livraison_pays: 'BE', option_debits: true, code_service: 'SERVICE-ACHATS', numero_engagement: 'EJ-42',
    })} dossier={REDEVABLE} onClose={() => {}} />)
    await screen.findByText('Mission de conseil')
    for (const texte of [
      'SIREN du client : 987 654 324',
      'Opérations : Livraisons de biens et prestations de services',
      'Période : du 01/09/2026 au 30/09/2026',
      'Adresse de livraison : 3 quai des Essais, 1000 Bruxelles, BE',
      'TVA : Option pour le paiement de la taxe d’après les débits',
      'Code service : SERVICE-ACHATS',
      'Numéro d’engagement : EJ-42',
    ]) expect(screen.getByText(texte)).toBeTruthy()
  })

  it('une facture d’avant n’imprime aucune mention à la place de celles qu’elle n’a pas, et jamais ses notes', async () => {
    render(<FactureApercu facture={validee()} dossier={REDEVABLE} onClose={() => {}} />)
    await screen.findByText('Mission de conseil')
    expect(screen.queryByText(/SIREN du client|Opérations :|Période :|Adresse de livraison|Code service/)).toBeNull()
    expect(screen.queryByText(/relancer/)).toBeNull()
  })

  // CGI, ann. II, art. 242 nonies A, I, 2° : le numéro de TVA de l'émetteur, celui que porte la facture électronique.
  it('le numéro de TVA de l’émetteur : un redevable, un dossier qui a coché sa case ; aucun sinon', async () => {
    const cas: [StatutTva | null, boolean, string | null][] = [
      ['redevable', false, TVA_VENDEUR], ['franchise', true, TVA_VENDEUR], ['exonere', true, TVA_VENDEUR],
      ['franchise', false, null], ['exonere', false, null], [null, false, null],
    ]
    for (const [statut_tva, numero_tva_attribue, attendu] of cas) {
      render(<FactureApercu facture={validee({ emetteur_siret: SIRET_VENDEUR })}
        dossier={{ statut_tva, article_exoneration: null, numero_tva_attribue }} onClose={() => {}} />)
      await screen.findByText('Mission de conseil')
      const imprime = screen.queryByText(/^N° TVA intracommunautaire/)?.textContent ?? null
      expect(imprime, `${statut_tva} ${numero_tva_attribue}`).toBe(attendu && `N° TVA intracommunautaire ${attendu}`)
      cleanup()
    }
  })
})
