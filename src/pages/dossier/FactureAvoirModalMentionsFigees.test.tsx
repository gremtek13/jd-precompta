import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureAvoirModal from './FactureAvoirModal'
import { NON_BASCULE } from '../../test/factures'
import { versionParametres } from '../../test/parametresFacturation'
import { BIC_ESSAI, IBAN_ESSAI, factureFigee, identiteDuDossier } from '../../test/mentionsFigees'
import { REFUS_DE_LA_VALIDATION_FIGEE } from '../../lib/mentionsFigees'
import { RETENUE_EN_LECTURE } from '../../lib/mentionsFigeesVue'
import { MODELE_IBAN_DANS_UN_TEXTE } from '../../lib/parametresFacturation'
import { motsDuCabinet, type EspaceVentes } from '../../lib/espaceVentes'
import type { FactureEmise } from '../../lib/types'

// LA FACTURE FIGE SES MENTIONS, À L'ÉCRAN — L'AVOIR (étape A7b), créé validé, drapeau `MENTIONS_FIGEES_EXPORTEES` LEVÉ (l'état
// d'avant : FactureAvoirModal.test.tsx). Ce que ces cas gardent : ses lignes reprennent l'unité, la référence et la nature des
// lignes qu'elles créditent ; un IBAN dans sa mention légale se dit avant le clic ; il attend ce que sa validation lit — le
// dossier, ses paramètres, et les contacts quand sa facture vient d'un contact — ; il reprend l'identité de sa facture figée
// et n'est jugé ni sur l'émetteur ni sur la forme ; sa confirmation NOMME ce qu'il figera et imprimera. Données FICTIVES.

const faux = vi.hoisted(() => ({
  identite: null as Record<string, unknown> | null,
  versions: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  lignes: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  retenirDossier: false,
  dossierEnAttente: [] as (() => void)[],
  tables: [] as string[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        return { data: [{ facture_id: 'av1', numero: 'A2027-0001' }], error: null }
      },
      from: (table: string) => {
        faux.tables.push(table)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const source = () => {
          switch (table) {
            case 'parametres_facturation': return faux.versions
            case 'contacts': return faux.contacts
            case 'facture_lignes': return faux.lignes
            default: throw new Error(`Table non attendue dans ce test : ${table}`)
          }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: async () => {
            if (faux.retenirDossier) await new Promise<void>((r) => { faux.dossierEnAttente.push(r) })
            return { data: faux.identite ? filtrer([faux.identite], predicats)[0] ?? null : null, error: null }
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(() => {
            const toutes = filtrer(source(), predicats)
            return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

let confirmations: string[] = []
let reponse = true

beforeEach(() => {
  faux.identite = { id: 'd1', ...identiteDuDossier() }
  faux.versions = [{ ...versionParametres({ iban: IBAN_ESSAI, bic: BIC_ESSAI, titulaire_compte: 'CAMILLE ESSAI', rib_etat: 'confirme' }) }]
  faux.contacts = []
  faux.lignes = [{ id: 'l1', facture_id: 'f1', ordre: 0, designation: 'Séance', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, unite: 'HUR', reference: 'SEA-01', nature: 'services', article_id: 'a1' }]
  faux.rpcs = []
  faux.retenirDossier = false
  faux.dossierEnAttente = []
  faux.tables = []
  confirmations = []
  reponse = true
  vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { confirmations.push(m ?? ''); return reponse })
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// Une facture émise bien avant aujourd'hui : un avoir ne précède pas la facture qu'il corrige.
const figee = (o: Partial<FactureEmise> = {}) => factureFigee({ date_emission: '2026-01-15', date_echeance: null, ...o })

async function monter(espace: EspaceVentes, origine: FactureEmise = figee()) {
  render(<FactureAvoirModal reglageDesVentes={NON_BASCULE} espace={espace} dossierId="d1" factureOrigine={origine} credite={0} onClose={() => {}} onCreated={() => {}} />)
  await screen.findByDisplayValue('Séance')
}
const valider = () => screen.getByRole('button', { name: "Valider l'avoir" }) as HTMLButtonElement

for (const espace of ['cabinet', 'client'] as const) {
  describe(`l’avoir d’une facture qui a figé ses mentions (${espace})`, () => {
    it('ses lignes reprennent l’unité, la référence et la nature des lignes créditées — jamais l’article', async () => {
      await monter(espace)
      await waitFor(() => expect(valider().disabled).toBe(false))
      await act(async () => { valider().click() })
      const envoi = faux.rpcs.find((r) => r.nom === 'enregistrer_facture')!.params
      expect(envoi.p_lignes).toEqual([{ designation: 'Séance', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20, unite: 'HUR', reference: 'SEA-01', nature: 'services' }])
      expect(envoi.p_valider).toBe(true)
    })

    it('sa confirmation NOMME ce qu’il figera et imprimera : l’identité de sa facture, le RIB confirmé du jour ; refusée, rien ne part', async () => {
      await monter(espace, figee({ denomination_imprimee: 'Ancienne Dénomination EI' }))
      await waitFor(() => expect(valider().disabled).toBe(false))
      reponse = false
      await act(async () => { valider().click() })
      expect(faux.rpcs).toEqual([])
      expect(confirmations[0]).toMatch(/^Validé, l’avoir figera et imprimera :/)
      expect(confirmations[0]).toContain('– le nom « Ancienne Dénomination EI »')
      expect(confirmations[0]).toContain('– le RIB FR76 9999 9000 0100 0000 0000 600, BIC ESSAFR10, au nom de CAMILLE ESSAI')
      if (espace === 'client') expect(motsDuCabinet(confirmations[0])).toEqual([])
    })

    it('il n’est jugé ni sur l’émetteur ni sur la forme : le dossier sans SIRET ni adresse, il se valide', async () => {
      faux.identite = { id: 'd1', ...identiteDuDossier({ siret: null, adresse: null, forme_juridique: null }) }
      await monter(espace)
      await waitFor(() => expect(valider().disabled).toBe(false))
    })

    it('avant que ce qu’il lit revienne, il ne se valide pas, et l’écran le dit', async () => {
      faux.retenirDossier = true
      await monter(espace)
      expect(screen.getByText(RETENUE_EN_LECTURE)).toBeTruthy()
      expect(valider().disabled).toBe(true)
      await act(async () => { faux.dossierEnAttente.forEach((r) => r()) })
      await waitFor(() => expect(valider().disabled).toBe(false))
    })

    it('un IBAN dans sa mention légale : dit avant le clic, rien ne part', async () => {
      await monter(espace)
      fireEvent.change(screen.getByLabelText('Mentions légales'), { target: { value: `Rembourser sur ${IBAN_ESSAI}` } })
      expect(await screen.findByText(MODELE_IBAN_DANS_UN_TEXTE.replace('%', 'la mention légale'))).toBeTruthy()
      expect(valider().disabled).toBe(true)
    })

    it('sa facture vient d’un contact : les contacts sont lus, et un contact absent du dossier refuse la validation', async () => {
      faux.contacts = []
      await monter(espace, figee({ contact_id: 'c1' }))
      expect(await screen.findByText(REFUS_DE_LA_VALIDATION_FIGEE.find((r) => r.cle === 'contact_garde')!.modele)).toBeTruthy()
      expect(valider().disabled).toBe(true)
      expect(faux.tables).toContain('contacts')
    })
  })
}

it('une facture sans contact : les contacts ne sont pas lus', async () => {
  await monter('cabinet')
  await waitFor(() => expect(valider().disabled).toBe(false))
  expect(faux.tables).not.toContain('contacts')
})
