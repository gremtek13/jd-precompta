import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContactsVue from './ContactsVue'
import { ACCES_SANS_OBJET } from '../../lib/auteursVentes'
import type { LectureDesFichesLiees } from '../../lib/fichesLieesLecture'
import { contact } from '../../test/contacts'

// LA FICHE LIÉE DANS LA VUE « CLIENTS » (LM3), sous ses DEUX états de drapeau (un accesseur, CLAUDE.md « Tests »), devant un
// faux client qui APPLIQUE les filtres et dont `enregistrer_contact` écrit la table d'essai. Ce que ces cas gardent :
//  1. drapeau baissé : la section n'existe pas, rien de neuf ne se lit — et une fiche liée en base (le collage d'avant la
//     bascule) ne s'affiche jamais dans la liste des clients, qui n'a pas de nom à montrer ;
//  2. drapeau levé, au client : rien de neuf ;
//  3. drapeau levé, au cabinet : la liaison part par `enregistrer_contact` seule, sous le verrou de la vue — deux clics du même
//     `act`, une écriture —, la liste relue, le message qui nomme le dossier ; le refus de la base dit dans la fenêtre.
// Données FICTIVES.
const faux = vi.hoisted(() => ({
  drapeau: false,
  contacts: [] as Record<string, unknown>[],
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  lectures: 0,
  lecturesDesFiches: 0,
  refus: null as string | null,
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
}))

vi.mock('../../lib/fichesLiees', async (original) => ({
  ...(await original<typeof import('../../lib/fichesLiees')>()),
  get FICHES_LIEES_PREVUES() { return faux.drapeau },
}))

const K = '1b300000-0000-4000-8000-0000000000a1'
const C = '1b300000-0000-4000-8000-0000000000c1'
const C2 = '1b300000-0000-4000-8000-0000000000c2'
const LUE: LectureDesFichesLiees = {
  etat: 'lue', dossierDuCabinetId: K,
  dossiers: [
    { id: K, nom: 'Cabinet', denomination_imprimee: null, adresse: null, siret: null },
    { id: C, nom: 'Dossier Un', denomination_imprimee: null, adresse: null, siret: '12345678200010' },
    { id: C2, nom: 'Dossier Deux', denomination_imprimee: null, adresse: null, siret: null },
  ],
  identites: [{
    contact_id: 'f1', dossier_client_id: C, dossier_present: true, tiers_nom: 'UN SARL', tiers_adresse: '1 rue A',
    tiers_siret: '12345678200010', tiers_siren: '123456782', type_client: 'assujetti',
  }],
}
vi.mock('../../lib/fichesLieesLecture', () => ({
  lireCeQueLesFichesLieesDemandent: async () => { faux.lecturesDesFiches += 1; return LUE },
}))
vi.mock('../../lib/contactsInactifsLecture', () => ({
  lireLesActivitesDesContacts: async () => ({ activites: [], complete: true, motif: null }),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        if (faux.refus) return { data: null, error: { message: faux.refus } }
        if (nom === 'delier_fiche_liee') {
          // La base délie : la fiche, sans lien, porte l'identité recopiée et sa trace (LM3-Q1 (B)).
          const fiche = faux.contacts.find((c) => c.id === params.p_contact_id) as Record<string, unknown>
          const deliee = { ...fiche, dossier_client_id: null, nom: 'UN SARL', adresse: '1 rue A', type_client: 'assujetti',
            siren: '123456782', siret: '12345678200010', delie_le: '2027-11-20T10:00:00Z', delie_par: 'u-moi' }
          faux.contacts = faux.contacts.map((c) => (c.id === params.p_contact_id ? deliee : c)) as typeof faux.contacts
          return { data: deliee, error: null }
        }
        if (nom !== 'enregistrer_contact') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
        const ecrit = {
          id: `neuf-${faux.contacts.length + 1}`, dossier_id: params.p_dossier_id, genre: 'client', nom: null, type_client: null, adresse: null,
          siren: null, siret: null, code_service: null, retire_le: null, retire_par: null, efface_le: null, efface_par: null, cree_par: 'u-moi',
          cree_le: '2027-11-20T10:00:00Z', modifie_par: null, modifie_le: null, ...(params.p_contact as object),
        }
        faux.contacts = [...faux.contacts, ecrit]
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        if (table !== 'contacts') throw new Error(`Table non attendue dans ce test : ${table}`)
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
            faux.lectures += 1
            const toutes = filtrer(faux.contacts, predicats)
            return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

const ORDINAIRE = { ...contact({ id: 'c1', dossier_id: K, nom: 'Aubert SAS' }) }
// Une fiche liée telle que la base la rend : sans nom ni identité.
const FICHE = {
  ...contact({ id: 'f1', dossier_id: K, type_client: null, adresse: null, siren: null, siret: null, dossier_client_id: C }), nom: null,
}

beforeEach(() => {
  faux.drapeau = false; faux.contacts = [ORDINAIRE, FICHE]; faux.rpcs = []; faux.lectures = 0; faux.lecturesDesFiches = 0
  faux.refus = null; faux.retenirRpc = false; faux.rpcEnAttente = []
})

async function monter(espace: 'cabinet' | 'client') {
  render(espace === 'cabinet'
    ? <ContactsVue espace="cabinet" acces={ACCES_SANS_OBJET} dossierId={K} articleExoneration={null} />
    : <ContactsVue espace="client" dossierId={K} articleExoneration={null} />)
  await screen.findByRole('table', { name: 'Clients' })
  await act(async () => {})
}
const lignesDuTableau = () => within(screen.getByRole('table', { name: 'Clients' })).getAllByRole('row').slice(1)

describe('la vue « Clients » et les fiches liées (LM3)', () => {
  it('drapeau baissé : aucune section, rien de neuf lu, et une fiche liée ne s’affiche jamais comme un client sans nom', async () => {
    await monter('cabinet')
    expect(screen.queryByText('Clients du cabinet reliés à leur dossier')).toBeNull()
    expect(faux.lecturesDesFiches).toBe(0)
    expect(lignesDuTableau().map((r) => r.textContent)).toEqual([expect.stringContaining('Aubert SAS')])
    expect(screen.queryByRole('button', { name: 'Relier un dossier client' })).toBeNull()
  })

  it('drapeau levé, au client : rien de neuf', async () => {
    faux.drapeau = true
    await monter('client')
    expect(screen.queryByText('Clients du cabinet reliés à leur dossier')).toBeNull()
    expect(faux.lecturesDesFiches).toBe(0)
    expect(lignesDuTableau()).toHaveLength(1)
  })

  it('drapeau levé, au cabinet : relier passe le verrou de la vue — une écriture pour deux clics —, relit et nomme le dossier', async () => {
    faux.drapeau = true
    await monter('cabinet')
    expect(screen.getByRole('list', { name: 'Fiches reliées' }).textContent).toContain('UN SARL')
    expect(lignesDuTableau()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Relier un dossier client' }))
    const fenetre = screen.getByRole('dialog', { name: 'Relier un dossier client' })
    fireEvent.change(fenetre.querySelector('#fiche-liee-dossier')!, { target: { value: C2 } })
    fireEvent.change(fenetre.querySelector('#fiche-liee-delai')!, { target: { value: '15' } })
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier…' }))
    const lecturesAvant = faux.lectures
    faux.retenirRpc = true
    const relier = within(fenetre).getByRole('button', { name: 'Relier ce dossier' })
    act(() => { fireEvent.click(relier); fireEvent.click(relier) })
    await act(async () => {})
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { for (const r of faux.rpcEnAttente) r() })
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_contact',
      params: {
        p_dossier_id: K, p_contact_id: null,
        p_contact: { dossier_client_id: C2, adresse_electronique: null, email: null, delai_paiement_jours: 15, observations: null },
      },
    }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Dossier « Dossier Deux » relié.')
    // La nouvelle fiche n'entre pas dans la liste des clients : elle n'a pas de nom.
    expect(lignesDuTableau()).toHaveLength(1)
  })

  it('drapeau levé, au cabinet : délier passe le verrou de la vue — un appel pour deux clics —, à la version lue, puis relit', async () => {
    faux.drapeau = true
    // Le client ordinaire porte un autre SIRET que le dossier relié : la base ne refuserait pas le SIRET recopié.
    faux.contacts = [{ ...ORDINAIRE, siren: '732829320', siret: '73282932000017' }, FICHE]
    await monter('cabinet')
    fireEvent.click(screen.getByRole('button', { name: 'Délier' }))
    const lecturesAvant = faux.lectures
    faux.retenirRpc = true
    const delier = screen.getByRole('button', { name: 'Délier la fiche' })
    act(() => { fireEvent.click(delier); fireEvent.click(delier) })
    await act(async () => {})
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { for (const r of faux.rpcEnAttente) r() })
    expect(faux.rpcs).toEqual([{ nom: 'delier_fiche_liee', params: { p_dossier_id: K, p_contact_id: 'f1', p_modifie_le: null } }])
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    expect(screen.getByRole('status').textContent).toBe('Fiche de « UN SARL » déliée : elle est désormais saisie à la main.')
  })

  it('drapeau levé : le refus de la base se dit dans la fenêtre, sous ses mots', async () => {
    faux.drapeau = true
    faux.refus = 'Ce dossier a déjà sa fiche de facturation.'
    await monter('cabinet')
    fireEvent.click(screen.getByRole('button', { name: 'Relier un dossier client' }))
    const fenetre = screen.getByRole('dialog')
    fireEvent.change(fenetre.querySelector('#fiche-liee-dossier')!, { target: { value: C2 } })
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier…' }))
    await act(async () => { fireEvent.click(within(fenetre).getByRole('button', { name: 'Relier ce dossier' })) })
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('Ce dossier a déjà sa fiche de facturation.')
  })
})
