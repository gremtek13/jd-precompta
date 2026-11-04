import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enregistrerDevis, supprimerBrouillonDevis } from './devisEcriture'
import type { EcritureDevis } from './devis'

// LES DEUX GESTES D'UN BROUILLON DE DEVIS, PAR LA BASE SEULE (étape P6a1) : les paramètres nommés de la fonction, son refus
// levé sous ses mots, et une réponse qui ne dit pas le devis visé refusée. Données fictives.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  reponse: { data: null, error: null } as { data: unknown; error: { message: string } | null },
}))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: async (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      return faux.reponse
    },
  },
}))

const ECRITURE: EcritureDevis = { devis: { tiers_nom: 'ALPHA FICTIVE SAS' }, lignes: [{ designation: 'Conseil' }], emettre: false }

beforeEach(() => {
  faux.appels = []
  faux.reponse = { data: null, error: null }
})

describe('enregistrerDevis', () => {
  it('passe les cinq paramètres d’enregistrer_devis et rend le devis écrit', async () => {
    faux.reponse = { data: [{ devis_id: 'dv-neuf', numero: null }], error: null }
    expect(await enregistrerDevis('d1', null, ECRITURE)).toEqual({ devisId: 'dv-neuf', numero: null })
    expect(faux.appels).toEqual([{
      nom: 'enregistrer_devis',
      args: { p_dossier_id: 'd1', p_devis_id: null, p_devis: ECRITURE.devis, p_lignes: ECRITURE.lignes, p_emettre: false },
    }])
  })

  it('émis, il rend son numéro ; sans numéro, la réponse se refuse', async () => {
    faux.reponse = { data: [{ devis_id: 'dv1', numero: 'D2026-0001' }], error: null }
    expect(await enregistrerDevis('d1', 'dv1', { ...ECRITURE, emettre: true })).toEqual({ devisId: 'dv1', numero: 'D2026-0001' })
    faux.reponse = { data: [{ devis_id: 'dv1', numero: null }], error: null }
    await expect(enregistrerDevis('d1', 'dv1', { ...ECRITURE, emettre: true })).rejects.toThrow('La base n’a pas rendu le devis écrit')
  })

  it('un autre devis rendu que celui visé, ou rien : refusé', async () => {
    faux.reponse = { data: [{ devis_id: 'dv2', numero: null }], error: null }
    await expect(enregistrerDevis('d1', 'dv1', ECRITURE)).rejects.toThrow('La base n’a pas rendu le devis écrit')
    faux.reponse = { data: [], error: null }
    await expect(enregistrerDevis('d1', null, ECRITURE)).rejects.toThrow('La base n’a pas rendu le devis écrit')
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Le nom du client est à renseigner.' } }
    await expect(enregistrerDevis('d1', null, ECRITURE)).rejects.toThrow('Le nom du client est à renseigner.')
  })
})

describe('supprimerBrouillonDevis', () => {
  it('passe ses deux paramètres et vérifie l’identifiant rendu', async () => {
    faux.reponse = { data: 'dv1', error: null }
    await supprimerBrouillonDevis('d1', 'dv1')
    expect(faux.appels).toEqual([{ nom: 'supprimer_brouillon_devis', args: { p_dossier_id: 'd1', p_devis_id: 'dv1' } }])
    faux.reponse = { data: null, error: null }
    await expect(supprimerBrouillonDevis('d1', 'dv1')).rejects.toThrow('La base n’a pas rendu le brouillon supprimé')
  })

  it('le refus de la base se lève sous ses mots', async () => {
    faux.reponse = { data: null, error: { message: 'Le devis D2026-0001 est émis : il ne se supprime plus.' } }
    await expect(supprimerBrouillonDevis('d1', 'dv1')).rejects.toThrow('Le devis D2026-0001 est émis : il ne se supprime plus.')
  })
})
