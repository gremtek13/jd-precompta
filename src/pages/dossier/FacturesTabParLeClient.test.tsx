import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii } from '../../test/facturesCii'
import type { FactureEmise, FactureLigne } from '../../lib/types'
import { NON_BASCULE } from '../../test/factures'

// « PAR LE CLIENT » DANS L'ONGLET FACTURES DU CABINET (espace client, étape P4c). Le cabinet voit tout ce que le client fait,
// et QUI : le compte qui a validé une facture, ou qui a rédigé un brouillon, se reconnaît parmi les accès du dossier
// (`memberships.user_id`). Ce que ces cas gardent :
//
//  1. UNE PASTILLE « par le client » sur une facture ou un avoir VALIDÉ dont `valide_par` est le client, et sur un BROUILLON
//     dont `created_by` est le client ; aucune sur une facture validée par un autre compte, d'avant P2 (`valide_par` nul), ni
//     sur un compte dont l'accès a été retiré depuis — on ne le devine pas.
//  2. LE FILTRE « Émises par le client » ne change que l'AFFICHAGE : ni les pastilles d'encaissement, ni l'origine d'un avoir
//     masquée, ni la relecture des factures, et « N sur M » compte après lui.
//  3. TANT QUE LES ACCÈS NE SONT PAS LUS EN ENTIER (en cours, partiels, refusés, levés) : aucune pastille, le filtre grisé
//     avec sa raison. Une réponse d'un autre dossier ne s'écrit pas dans celui-ci.
//  4. UNE SEULE LECTURE des accès, passée aux deux fenêtres (le cabinet seul) ; le client n'en lit aucun et rien ne s'y dit.
//
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Les tables LUES, une entrée par requête partie.
  lectures: [] as string[],
  // Comment répond la lecture des accès : entière, tronquée (le compte annoncé dépasse ce qui revient), refusée, ou qui LÈVE.
  acces: 'entiers' as 'entiers' | 'partiels' | 'refus' | 'leve',
  // Les dossiers dont la lecture des accès reste EN ATTENTE, et ce qui la libère.
  retenus: new Set<string>(),
  libres: [] as { dossier: string; rendre: () => void }[],
}))

// Les fenêtres ont leurs propres tests : doublées ici pour montrer ce que l'onglet leur PASSE, les accès qu'il a lus.
vi.mock('./TransmissionFactureModal', () => ({
  default: (p: { espace: string; acces?: { etat: string; comptes?: string[] } }) => (
    <p>Transmettre — {p.espace} — {p.acces ? `${p.acces.etat} ${(p.acces.comptes ?? []).join(',')}` : 'sans accès'}</p>
  ),
}))
vi.mock('./EncaissementsFactureModal', () => ({
  default: (p: { espace: string; acces?: { etat: string; comptes?: string[] } }) => (
    <p>Encaissements — {p.espace} — {p.acces ? `${p.acces.etat} ${(p.acces.comptes ?? []).join(',')}` : 'sans accès'}</p>
  ),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      functions: { invoke: async () => ({ data: { connexion: null }, error: null }) },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        let dossier = ''
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste?: string) => {
            colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
            return c
          },
          eq: (colonne: string, valeur: unknown) => {
            if (colonne === 'dossier_id') dossier = String(valeur)
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            faux.lectures.push(table)
            if (table === 'memberships') {
              if (faux.acces === 'leve') return Promise.reject(new Error('réseau coupé')).then(suite, echec)
              if (faux.acces === 'refus') {
                return Promise.resolve({ data: null, error: { message: 'accès refusé' }, count: null }).then(suite, echec)
              }
            }
            const toutes = filtrer(faux.tables[table], predicats)
            // « Partiels » : la base annonce un compte que la lecture n'atteint pas.
            const annonce = table === 'memberships' && faux.acces === 'partiels' ? toutes.length + 3 : toutes.length
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length))
              .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
            const reponse = { data: rendu, error: null, count: annonce }
            if (table === 'memberships' && faux.retenus.has(dossier)) {
              return new Promise((resoudre) => { faux.libres.push({ dossier, rendre: () => resoudre(reponse) }) }).then(suite, echec)
            }
            return Promise.resolve(reponse).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
const CLIENT = 'u-client'
const CABINET = 'u-cabinet'
const ANCIEN = 'u-ancien'

const ligneDeFacture = (id: string): FactureLigne => ({
  id: `l-${id}`, facture_id: id, ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20,
})

const facture = (o: Partial<FactureEmise>): FactureEmise => factureCii([{ ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }], {
  dossier_id: 'd1', date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})

// Une facture par cas : qui l'a rédigée, qui l'a validée.
const F_CLIENT = facture({ id: 'f1', numero: 'F2027-0001', tiers_nom: 'Client A', created_by: CLIENT, valide_par: CLIENT })
const F_CREEE_PAR_LE_CLIENT_VALIDEE_PAR_LE_CABINET = facture({ id: 'f2', numero: 'F2027-0002', tiers_nom: 'Client B', created_by: CLIENT, valide_par: CABINET })
const F_AVANT_P2 = facture({ id: 'f3', numero: 'F2027-0003', tiers_nom: 'Client C', created_by: null, valide_par: null })
const F_ACCES_RETIRE = facture({ id: 'f4', numero: 'F2027-0004', tiers_nom: 'Client D', created_by: ANCIEN, valide_par: ANCIEN })
const B_CLIENT = facture({ id: 'b1', numero: null, statut: 'brouillon', validated_at: null, tiers_nom: 'Client E', created_by: CLIENT, valide_par: null })
const B_CABINET = facture({ id: 'b2', numero: null, statut: 'brouillon', validated_at: null, tiers_nom: 'Client F', created_by: CABINET, valide_par: null })
const B_SANS_AUTEUR = facture({ id: 'b3', numero: null, statut: 'brouillon', validated_at: null, tiers_nom: 'Client G', created_by: null, valide_par: null })
// L'avoir du client sur une facture que le cabinet a validée : l'origine est masquée par le filtre, et se lit encore.
const A_CLIENT = facture({
  id: 'a1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f2', tiers_nom: 'Client B — avoir',
  montant_ht: -1000, montant_tva: -200, montant_ttc: -1200, created_by: CLIENT, valide_par: CLIENT,
})
const TOUTES = [F_CLIENT, F_CREEE_PAR_LE_CLIENT_VALIDEE_PAR_LE_CABINET, F_AVANT_P2, F_ACCES_RETIRE, B_CLIENT, B_CABINET, B_SANS_AUTEUR, A_CLIENT]

const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))

function poser(factures: FactureEmise[] = TOUTES, accesDuDossier: Record<string, string[]> = { d1: [CLIENT], d2: [] }) {
  faux.tables = {
    factures_emises: nues(factures),
    facture_lignes: factures.map((f) => ({ ...ligneDeFacture(f.id) })),
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    transmissions_encaissements: [],
    statuts_factures_recus: [],
    memberships: Object.entries(accesDuDossier).flatMap(([dossier, comptes]) => comptes.map((u, i) => ({
      id: `m-${dossier}-${i}`, dossier_id: dossier, user_id: u, created_at: '2027-09-01T08:00:00Z',
    }))),
  }
  faux.lectures = []
  faux.acces = 'entiers'
  faux.retenus = new Set()
  faux.libres = []
}

const commun = {
  dossierNom: 'Atelier fictif', dossierSiret: '12345678901234', dossierAdresse: null, statutTva: 'redevable' as const,
  articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
}
const cabinet = (dossierId = 'd1') => (
  <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" onAdresseUpdated={() => {}} dossierId={dossierId} {...commun} />
)

async function monter(attendre = 'Client A') {
  const rendu = render(cabinet())
  await screen.findByText(attendre)
  return rendu
}

const ligneDe = (client: string) => screen.getByText(client).closest('tr') as HTMLElement
const pastilles = (racine: HTMLElement = document.body) => within(racine).queryAllByText('par le client')
const filtre = () => screen.getByRole('checkbox', { name: 'Émises par le client' }) as HTMLInputElement

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-10-20T10:00:00Z')) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('FacturesTab, cabinet — la pastille « par le client »', () => {
  it('se pose sur une facture validée par le client, un avoir validé par lui, et un brouillon de sa main', async () => {
    poser()
    await monter()
    await waitFor(() => expect(pastilles()).toHaveLength(3))
    expect(pastilles(ligneDe('Client A'))[0].getAttribute('title')).toBe('Validée par le client')
    expect(pastilles(ligneDe('Client B — avoir'))[0].getAttribute('title')).toBe('Validée par le client')
    expect(pastilles(ligneDe('Client E'))[0].getAttribute('title')).toBe('Brouillon du client')
  })

  it('ne se pose ni sur une validation du cabinet, ni sur une facture d’avant P2, ni sur un accès retiré depuis', async () => {
    poser()
    await monter()
    await waitFor(() => expect(pastilles()).toHaveLength(3))
    // Rédigée par le client mais VALIDÉE par le cabinet : c'est le cabinet qui l'a émise.
    expect(pastilles(ligneDe('Client B'))).toHaveLength(0)
    // Pas d'auteur : on ne devine pas.
    expect(pastilles(ligneDe('Client C'))).toHaveLength(0)
    // Un compte qui n'a plus d'accès : sa ligne n'existe plus, on ne le reconnaît pas, et on ne dit pas « par le cabinet ».
    expect(pastilles(ligneDe('Client D'))).toHaveLength(0)
    expect(screen.queryByText(/par le cabinet/i)).toBeNull()
    // Un brouillon du cabinet, un brouillon sans auteur.
    expect(pastilles(ligneDe('Client F'))).toHaveLength(0)
    expect(pastilles(ligneDe('Client G'))).toHaveLength(0)
  })

  it('un dossier sans accès client ne reconnaît personne, et le dit au filtre', async () => {
    poser(TOUTES, { d1: [] })
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    expect(pastilles()).toHaveLength(0)
    fireEvent.click(filtre())
    await screen.findByText('Aucune facture ni aucun avoir n’a été validé par le client.')
  })
})

describe('FacturesTab, cabinet — le filtre « Émises par le client »', () => {
  it('ne garde à l’écran que les factures et avoirs validés par le client, et se défait', async () => {
    poser()
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    fireEvent.click(filtre())
    expect(screen.getByText('Client A')).toBeTruthy()
    expect(screen.getByText('Client B — avoir')).toBeTruthy()
    for (const autre of ['Client B', 'Client C', 'Client D', 'Client E', 'Client F', 'Client G']) {
      expect(screen.queryByText(autre)).toBeNull()
    }
    fireEvent.click(filtre())
    for (const tous of ['Client A', 'Client B', 'Client C', 'Client D', 'Client E', 'Client F', 'Client G']) {
      expect(screen.getByText(tous)).toBeTruthy()
    }
  })

  it('ne filtre que l’affichage : l’origine d’un avoir masquée se lit, les pastilles de chaque ligne restent, rien n’est relu', async () => {
    poser()
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    const avant = within(ligneDe('Client A')).getByText(/À encaisser/).textContent
    const lecturesAvant = [...faux.lectures]
    fireEvent.click(filtre())
    // La facture d'origine (« F2027-0002 », validée par le cabinet) n'est plus listée, mais l'avoir la désigne encore.
    expect(screen.queryByText('Client B')).toBeNull()
    within(ligneDe('Client B — avoir')).getByText('→ F2027-0002')
    // La pastille d'encaissement de la ligne gardée dit la même chose : elle se calcule sur les lignes et les encaissements
    // du dossier entier, pas sur la liste affichée.
    expect(within(ligneDe('Client A')).getByText(/À encaisser/).textContent).toBe(avant)
    expect(faux.lectures).toEqual(lecturesAvant)
  })

  it('« N sur M » compte après le filtre, avant la recherche', async () => {
    poser()
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    fireEvent.click(filtre())
    fireEvent.change(screen.getByPlaceholderText('Rechercher un numéro, un client, un montant…'), { target: { value: 'F2027-0001' } })
    // Deux lignes passent le filtre (la facture et l'avoir), une seule la recherche.
    await screen.findByText('1 sur 2')
  })

  it('est dit pour ce qu’il reconnaît : les accès d’aujourd’hui, pas ceux qu’on a retirés', async () => {
    poser()
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    expect(screen.getByText(/Un accès retiré depuis n’est plus reconnu/)).toBeTruthy()
  })
})

describe('FacturesTab, cabinet — tant que les accès ne sont pas lus en entier', () => {
  it('en cours de lecture : aucune pastille, le filtre est grisé et dit pourquoi ; la lecture revenue, ils paraissent', async () => {
    poser()
    faux.retenus = new Set(['d1'])
    await monter()
    expect(pastilles()).toHaveLength(0)
    expect(filtre().disabled).toBe(true)
    screen.getByText('Les accès du dossier sont en cours de lecture.')
    await act(async () => { faux.libres.forEach((l) => l.rendre()) })
    await waitFor(() => expect(pastilles()).toHaveLength(3))
    expect(filtre().disabled).toBe(false)
  })

  it('lus en partie : rien n’est reconnu, même parmi les lignes revenues, et le motif est dit', async () => {
    poser()
    faux.acces = 'partiels'
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(true))
    expect(pastilles()).toHaveLength(0)
    expect(screen.getByText(/La liste des accès du dossier n’a pas été lue en entier/)).toBeTruthy()
    expect(screen.getByText(/lecture interrompue|total|ligne\(s\)/)).toBeTruthy()
  })

  it('refusés par la base, ou une requête qui lève : même chose, et la liste des factures reste lisible', async () => {
    for (const mode of ['refus', 'leve'] as const) {
      poser()
      faux.acces = mode
      const { unmount } = await monter()
      await waitFor(() => expect(filtre().disabled).toBe(true))
      expect(pastilles()).toHaveLength(0)
      expect(screen.getByText(mode === 'refus' ? /accès refusé/ : /réseau coupé/)).toBeTruthy()
      // Les factures, elles, se lisent : la panne des accès n'éteint que ce qui en dépend.
      screen.getByText('Client D')
      unmount()
    }
  })

  it('un filtre coché ne reste pas appliqué quand les accès cessent d’être lus en entier', async () => {
    poser()
    const { rerender } = await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    fireEvent.click(filtre())
    expect(screen.queryByText('Client C')).toBeNull()
    // Un autre dossier dont les accès tardent : la case du premier ne filtre plus rien dans l'attente.
    faux.retenus = new Set(['d2'])
    rerender(cabinet('d2'))
    expect(filtre().disabled).toBe(true)
    expect(filtre().checked).toBe(false)
  })

  it('en changeant de dossier : repart en lecture, et la réponse tardive du premier ne s’écrit pas dans le second', async () => {
    poser([...TOUTES, facture({ id: 'g1', dossier_id: 'd2', numero: 'F2027-0101', tiers_nom: 'Client H', created_by: CLIENT, valide_par: CLIENT })])
    const { rerender } = await monter()
    await waitFor(() => expect(pastilles()).toHaveLength(3))
    // Le second dossier : ses accès tardent. Le client du premier n'y est PAS reconnu pendant l'attente.
    faux.retenus = new Set(['d2'])
    rerender(cabinet('d2'))
    await screen.findByText('Client H')
    expect(pastilles()).toHaveLength(0)
    expect(filtre().disabled).toBe(true)
    // Il n'a, lui, aucun accès client : la lecture revenue ne reconnaît toujours personne.
    await act(async () => { faux.libres.forEach((l) => l.rendre()) })
    await waitFor(() => expect(filtre().disabled).toBe(false))
    expect(pastilles()).toHaveLength(0)
  })

  it('une réponse du premier dossier arrivée APRÈS le changement ne défait pas la lecture du second', async () => {
    poser([...TOUTES, facture({ id: 'g1', dossier_id: 'd2', numero: 'F2027-0101', tiers_nom: 'Client H', created_by: CLIENT, valide_par: CLIENT })])
    faux.retenus = new Set(['d1'])
    const { rerender } = render(cabinet())
    await screen.findByText('Client A')
    // Le changement de dossier : la lecture du second revient aussitôt, celle du premier tarde encore.
    faux.retenus = new Set()
    rerender(cabinet('d2'))
    await screen.findByText('Client H')
    await waitFor(() => expect(filtre().disabled).toBe(false))
    await act(async () => { faux.libres.forEach((l) => l.rendre()) })
    expect(filtre().disabled).toBe(false)
    expect(pastilles()).toHaveLength(0)
  })
})

describe('FacturesTab — les accès lus passent aux fenêtres, une seule fois ; le client n’en lit aucun', () => {
  it('le cabinet lit les accès UNE fois, et en passe la liste aux deux fenêtres', async () => {
    poser()
    await monter()
    await waitFor(() => expect(filtre().disabled).toBe(false))
    fireEvent.click(within(ligneDe('Client A')).getByRole('button', { name: 'Transmettre' }))
    await screen.findByText(`Transmettre — cabinet — lus ${CLIENT}`)
    fireEvent.click(within(ligneDe('Client A')).getByRole('button', { name: 'Encaissements' }))
    await screen.findByText(`Encaissements — cabinet — lus ${CLIENT}`)
    expect(faux.lectures.filter((t) => t === 'memberships')).toHaveLength(1)
  })

  it('dans « Mes ventes », rien n’est lu, aucun filtre, aucune pastille, et les fenêtres n’ont pas d’accès', async () => {
    poser()
    render(<FacturesTab reglageDesVentes={NON_BASCULE} espace="client" banque={false} dossierId="d1" {...commun} />)
    await screen.findByText('Client A')
    expect(faux.lectures).not.toContain('memberships')
    expect(screen.queryByRole('checkbox', { name: 'Émises par le client' })).toBeNull()
    expect(pastilles()).toHaveLength(0)
    expect(screen.queryByText(/par le client/i)).toBeNull()
    fireEvent.click(within(ligneDe('Client A')).getByRole('button', { name: 'Transmettre' }))
    await screen.findByText('Transmettre — client — sans accès')
    fireEvent.click(within(ligneDe('Client A')).getByRole('button', { name: 'Encaissements' }))
    await screen.findByText('Encaissements — client — sans accès')
  })
})
