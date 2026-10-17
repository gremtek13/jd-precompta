import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ParametresVue from './ParametresVue'
import { versionParametres } from '../../test/parametresFacturation'

// « PARAMÈTRES » ET LE LOGO DES FACTURES (espace client, étape A5c1), la migration du logo EN BASE : le drapeau
// `LOGO_DES_FACTURES_EXPORTE` est FORCÉ ici, comme la bascule le lèvera. Ce que ces cas gardent, et qu'aucun calcul pur ne
// voit : le formulaire d'A5b1 n'offre pas le logo, et la base lit la saisie EN ENTIER — une clé absente y vaut « aucun
// logo » ; « Modifier les paramètres » doit donc ENVOYER le logo de la version qu'il remplace, sans quoi chaque modification
// le retirerait en silence. Et l'historique nomme ce qu'une version a fait du logo. Données fictives.

vi.mock('../../lib/logoDesFactures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/logoDesFactures')>()),
  LOGO_DES_FACTURES_EXPORTE: true,
}))

const faux = vi.hoisted(() => ({
  versions: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (nom !== 'enregistrer_parametres_facturation') throw new Error(`Fonction non attendue : ${nom}`)
        const p = params.p_parametres as Record<string, unknown>
        // Comme la base : une clé absente vaut nul — le logo compris.
        const ecrite = {
          ...versionParametres({ id: `v${faux.versions.length + 1}`, dossier_id: params.p_dossier_id as string }),
          ...p, logo_chemin: p.logo_chemin ?? null, logo_sha256: p.logo_sha256 ?? null,
          remplace_id: params.p_remplace_id, auteur: 'u-moi', cree_le: '2027-11-20T10:00:00Z',
        }
        faux.versions = [...faux.versions, ecrite]
        return { data: ecrite, error: null }
      },
      from: (table: string) => {
        if (table !== 'parametres_facturation') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(() => {
            const toutes = filtrer(faux.versions, predicats)
            return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

// Un identifiant de dossier à la forme de la base : le chemin d'un logo commence par lui (`<dossier>/logos/…`).
const D = 'a5c00000-0000-4000-8000-0000000000d1'
const H1 = '1'.repeat(64)
const LOGO = { logo_chemin: `${D}/logos/${H1}.png`, logo_sha256: H1 }
const V1 = versionParametres({ id: 'v1', dossier_id: D, logo_chemin: null, logo_sha256: null, cree_le: '2027-10-01T09:00:00Z' })
const V2 = versionParametres({ id: 'v2', dossier_id: D, remplace_id: 'v1', ...LOGO, cree_le: '2027-10-02T09:00:00Z' })

beforeEach(() => {
  faux.versions = [{ ...V1 }, { ...V2 }]
  faux.rpcs = []
})

const fenetre = () => screen.getByRole('dialog')

describe('Paramètres, la migration du logo en base', () => {
  it('modifier le délai d’une version qui porte un logo : la saisie envoie le logo repris, et la version neuve le garde', async () => {
    render(<ParametresVue espace="cabinet" acces={{ etat: 'lus', comptes: [] }} dossierId={D} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier les paramètres' }))
    fireEvent.change(within(fenetre()).getByLabelText(/^Délai de paiement/), { target: { value: '45' } })
    await act(async () => { fireEvent.click(within(fenetre()).getByRole('button', { name: 'Enregistrer' })) })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].params).toEqual(expect.objectContaining({ p_dossier_id: D, p_remplace_id: 'v2' }))
    expect(faux.rpcs[0].params.p_parametres).toEqual(expect.objectContaining({ delai_paiement_jours: 45, ...LOGO }))
    expect(faux.versions.at(-1)).toEqual(expect.objectContaining({ remplace_id: 'v2', ...LOGO }))
  })

  it('l’historique nomme ce qu’une version a fait du logo', async () => {
    render(<ParametresVue espace="cabinet" acces={{ etat: 'lus', comptes: [] }} dossierId={D} />)
    const historique = await screen.findByRole('table', { name: 'Historique des paramètres' })
    expect(within(historique).getByText('Logo posé')).toBeTruthy()
  })
})
