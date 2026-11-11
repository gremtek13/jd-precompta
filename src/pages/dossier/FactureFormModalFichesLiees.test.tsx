import { CABINET_DU_DOSSIER } from '../../test/mentionsFigees'
import { SANS_ACOMPTE } from '../../lib/acomptesDesFactures'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FactureFormModal from './FactureFormModal'
import { NON_BASCULE } from '../../test/factures'
import { contact } from '../../test/contacts'

// LE CHOIX D'UNE FICHE LIÉE DANS UNE FACTURE (LM3), sous les DEUX états de `FICHES_LIEES_PREVUES` (un accesseur). Le formulaire
// lit les contacts en entier ; levé, et la liste porte une fiche liée, il lit les identités (`identites_des_fiches_liees`) et
// propose la fiche nommée par l'identité LUE de son dossier ; la choisir remplit le client ENTIER par `choixDeFicheLiee`, et un
// client déjà saisi ne se remplace qu'après une confirmation qui nomme ce qui part. Un dossier parti ne se propose pas, et le
// choix le dit. Baissé, rien ne se lit de neuf et la fiche — sans nom — ne se propose jamais. Données FICTIVES.
vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()), MENTIONS_FIGEES_EXPORTEES: false,
}))

const faux = vi.hoisted(() => ({
  drapeau: false,
  contacts: [] as Record<string, unknown>[],
  identites: [] as Record<string, unknown>[],
  rpcs: [] as string[],
}))
vi.mock('../../lib/fichesLiees', async (original) => ({
  ...(await original<typeof import('../../lib/fichesLiees')>()),
  get FICHES_LIEES_PREVUES() { return faux.drapeau },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  // Une lecture paginée, d'une table ou d'une fonction : les filtres appliqués, la tranche demandée, le compte annoncé.
  const constructeur = (lignes: () => Record<string, unknown>[]) => {
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
        const toutes = filtrer(lignes(), predicats)
        return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length)), error: null, count: toutes.length }
      }).then(suite, echec),
    })
    return c
  }
  return {
    supabase: {
      rpc: (nom: string) => {
        faux.rpcs.push(nom)
        if (nom !== 'identites_des_fiches_liees') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
        return constructeur(() => faux.identites)
      },
      from: (table: string) => {
        if (table === 'contacts') return constructeur(() => faux.contacts)
        if (table === 'articles') return constructeur(() => [])
        throw new Error(`Table non attendue dans ce test : ${table}`)
      },
    },
  }
})

const K = '1b300000-0000-4000-8000-0000000000a1'
const C = '1b300000-0000-4000-8000-0000000000c1'
const C2 = '1b300000-0000-4000-8000-0000000000c2'
const ORDINAIRE = { ...contact({ id: 'c1', dossier_id: K, nom: 'Aubert SAS', delai_paiement_jours: null }) }
const fiche = (id: string, lien: string, o: Record<string, unknown> = {}) => ({
  ...contact({ id, dossier_id: K, type_client: null, adresse: null, siren: null, siret: null, dossier_client_id: lien, delai_paiement_jours: 30 }),
  adresse_electronique: '123456782', nom: null, ...o,
})
const identite = (id: string, lien: string, o: Record<string, unknown> = {}) => ({
  contact_id: id, dossier_client_id: lien, dossier_present: true, tiers_nom: 'UN SARL', tiers_adresse: '1 rue A',
  tiers_siret: '12345678200010', tiers_siren: '123456782', type_client: 'assujetti', ...o,
})

beforeEach(() => {
  faux.drapeau = false; faux.rpcs = []
  faux.contacts = [ORDINAIRE, fiche('f1', C), fiche('f2', C2)]
  faux.identites = [identite('f1', C), identite('f2', C2, { dossier_present: false, tiers_nom: null, tiers_adresse: null, tiers_siret: null, tiers_siren: null, type_client: null })]
})

async function monter() {
  render(
    <FactureFormModal
      acompte={SANS_ACOMPTE} modelesDeNumerotation={null} facturesDeLaSerie={[]} reglageDesVentes={NON_BASCULE} espace="cabinet"
      onAdresseUpdated={() => {}} mandataire={CABINET_DU_DOSSIER} dossierId={K} dossierNom="Cabinet" dossierSiret={null} dossierAdresse={null}
      statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false} tvaSurDebits={false} facture={null}
      onClose={() => {}} onSaved={() => {}}
    />,
  )
  fireEvent.change(document.querySelector('#date-emission')!, { target: { value: '2027-11-01' } })
  await screen.findByRole('button', { name: 'Choisir un client' })
  await act(async () => {})
}
const valeur = (s: string) => (document.querySelector(s) as HTMLInputElement | HTMLSelectElement | null)?.value
const ouvrirLeChoix = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Choisir un client' }))
  return screen.getByRole('dialog', { name: 'Choisir un client' })
}

describe('le choix d’une fiche liée dans la facture (LM3)', () => {
  it('drapeau baissé : aucune identité lue, et la fiche sans nom ne se propose pas', async () => {
    await monter()
    expect(faux.rpcs).toEqual([])
    const fenetre = ouvrirLeChoix()
    expect(within(fenetre).getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringContaining('Aubert SAS'), 'Annuler'])
    expect(within(fenetre).queryByRole('list', { name: 'Clients reliés à leur dossier' })).toBeNull()
  })

  it('drapeau levé : la fiche nommée par l’identité LUE remplit le client entier ; un dossier parti se dit', async () => {
    faux.drapeau = true
    await monter()
    expect(faux.rpcs).toEqual(['identites_des_fiches_liees'])
    const fenetre = ouvrirLeChoix()
    expect(within(fenetre).getByRole('note').textContent).toBe('Ne se proposent pas : 1 fiche dont le dossier est parti.')
    const reliees = within(fenetre).getByRole('list', { name: 'Clients reliés à leur dossier' })
    expect(reliees.textContent).toContain('UN SARL — relié à son dossier')
    fireEvent.click(within(reliees).getByRole('button'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect([valeur('#tiers-nom'), valeur('#tiers-adresse'), valeur('#tiers-siret'), valeur('#type-client'), valeur('#tiers-adresse-electronique'), valeur('#date-echeance')])
      .toEqual(['UN SARL', '1 rue A', '12345678200010', 'assujetti', '123456782', '2027-12-01'])
    expect(document.body.textContent).toContain('Client relié à son dossier : UN SARL')
    expect(screen.queryByRole('button', { name: 'Enregistrer ce client' })).toBeNull()
  })

  it('drapeau levé : un client déjà saisi ne se remplace qu’après une confirmation qui nomme la fiche', async () => {
    faux.drapeau = true
    await monter()
    fireEvent.change(document.querySelector('#tiers-nom')!, { target: { value: 'Autre client' } })
    const fenetre = ouvrirLeChoix()
    fireEvent.click(within(within(fenetre).getByRole('list', { name: 'Clients reliés à leur dossier' })).getByRole('button'))
    expect(document.body.textContent).toContain('Choisir le client « UN SARL » remplace')
    expect(valeur('#tiers-nom')).toBe('Autre client')
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }))
    expect(valeur('#tiers-nom')).toBe('UN SARL')
  })
})
