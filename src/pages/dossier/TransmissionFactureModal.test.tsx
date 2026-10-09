import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransmissionFactureModal from './TransmissionFactureModal'
import { facture as factureCii, ligne } from '../../test/facturesCii'
import type { FactureEmise, StatutTva, TransmissionFacture } from '../../lib/types'

// LA FENÊTRE QUI TRANSMET UNE FACTURE VALIDÉE (ligne 28.5, étape c4), par la plateforme du client ou par Super PDP.
// Le doublon, ici, sort de l'application : une facture transmise deux fois à une plateforme agréée ne se reprend pas.
// Ce que ces cas gardent : un seul envoi pour plusieurs clics, et le verrou tenu jusqu'après la relecture ; la
// confirmation qui nomme ce qui part ; rien de proposé tant qu'on ne sait pas si la facture est déjà partie, ni quand
// le jugement des fonctions la refuse ; le suivi d'une transmission active. Les factures sont FICTIVES
// (src/test/facturesCii.ts).
const faux = vi.hoisted(() => ({
  lignes: [] as unknown[],
  origine: null as unknown,
  transmissions: [] as unknown[],
  refusTransmissions: null as string | null,
  lecturesTransmissions: 0,
  // La relecture des transmissions qui suit une action peut rester EN ATTENTE : la fenêtre que le verrou doit couvrir.
  suspendreRelecture: false,
  libererRelecture: null as null | (() => void),
  evenements: [] as unknown[],
  connexion: null as unknown,
  lecturesConnexion: 0,
  // Pour un avoir : les rejets de la facture qu'il corrige, et ses refus chez Super PDP (210, 213).
  rejetsOrigine: 0,
  refusOrigine: 0,
  // Ces deux comptes peuvent rester EN ATTENTE : tant qu'on ne sait pas si l'avoir est interne, rien n'est proposé.
  retenirOrigine: false,
  libererOrigine: [] as (() => void)[],
  superpdp: false,
  appels: [] as { nom: string; body: Record<string, unknown> }[],
  // La promesse d'une action reste en attente jusqu'à ce que le cas la résolve.
  resoudre: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => {
  const compteDeLOrigine = (reponse: unknown) => (faux.retenirOrigine
    ? new Promise((resolve) => { faux.libererOrigine.push(() => resolve(reponse)) })
    : Promise.resolve(reponse))
  const requete = (reponse: () => unknown, fin: string) => {
    const q: Record<string, unknown> = { select: () => q, eq: () => q, order: () => q }
    q[fin] = () => Promise.resolve(reponse())
    return q
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'facture_lignes') {
          const q: Record<string, unknown> = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: faux.lignes, error: null }) }
          return q
        }
        if (table === 'factures_emises') return requete(() => ({ data: faux.origine, error: null }), 'maybeSingle')
        if (table === 'facture_superpdp_events') {
          const q: Record<string, unknown> = {
            select: () => q, eq: () => q,
            order: () => Promise.resolve({ data: faux.evenements, error: null }),
            // Le compte des refus de la facture qu'un avoir corrige.
            in: () => compteDeLOrigine({ data: null, error: null, count: faux.refusOrigine }),
          }
          return q
        }
        if (table === 'transmissions_factures') {
          let compte = false
          const q: Record<string, unknown> = {
            select: (_: string, options?: { head?: boolean }) => { compte = options?.head === true; return q },
            eq: () => q, order: () => q,
            // Le compte des rejets de la facture qu'un avoir corrige : une lecture sans lignes, attendue telle quelle.
            then: (suite: (r: unknown) => unknown) => {
              if (!compte) throw new Error('lecture des transmissions sans range')
              return compteDeLOrigine({ data: null, error: null, count: faux.rejetsOrigine }).then(suite)
            },
          }
          q.range = () => {
            faux.lecturesTransmissions += 1
            const reponse = faux.refusTransmissions
              ? { data: null, error: { message: faux.refusTransmissions }, count: null }
              : { data: faux.transmissions, error: null, count: faux.transmissions.length }
            if (faux.lecturesTransmissions > 1 && faux.suspendreRelecture) {
              return new Promise((resolve) => { faux.libererRelecture = () => resolve(reponse) })
            }
            return Promise.resolve(reponse)
          }
          return q
        }
        throw new Error(`Table non attendue dans ce test : ${table}`)
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, body: args })
        return new Promise((resolve) => { faux.resoudre = resolve })
      },
      functions: {
        invoke: (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') {
            faux.lecturesConnexion += 1
            return Promise.resolve({ data: { connexion: faux.connexion }, error: null })
          }
          if (nom === 'superpdp-credentials') return Promise.resolve({ data: { configured: faux.superpdp }, error: null })
          faux.appels.push({ nom, body: options.body })
          return new Promise((resolve) => { faux.resoudre = resolve })
        },
      },
    },
  }
})

const CONNEXION = {
  nom: 'Plateforme Démo', url_flux: 'https://flux.plateforme-demo.fr', url_jeton: 'https://flux.plateforme-demo.fr/jeton',
  hote: 'flux.plateforme-demo.fr', client_id: 'cabinet', organisation_id: null, portee: null, recherche_depuis: null,
  derniere_recuperation: null, cycle_vie_depuis: null, cycle_vie_lu_le: null, created_at: '2026-10-01T08:00:00+00:00',
  version: 'v1',
}

function transmission(o: Partial<TransmissionFacture> = {}): TransmissionFacture {
  return {
    id: 't1', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: 'flux.plateforme-demo.fr', flux_id: 'FLUX-1',
    sha256: 'a'.repeat(64), etat: 'depose', detail: null, cree_le: '2026-10-08T08:00:00+00:00', maj_le: '2026-10-08T08:00:00+00:00',
    ...o,
  }
}

// Une facture validée que rien n'empêche de partir : celle des exemples jugés par le validateur officiel.
const FACTURE: FactureEmise = factureCii([ligne()])

function monter(o: {
  facture?: FactureEmise; lignes?: unknown[]; origine?: unknown; connexion?: unknown; superpdp?: boolean
  transmissions?: TransmissionFacture[]; refusTransmissions?: string; rejetsOrigine?: number; refusOrigine?: number
  statutTva?: StatutTva; numeroTvaAttribue?: boolean; retenirOrigine?: boolean
} = {}) {
  faux.lignes = o.lignes ?? [ligne()]
  faux.origine = o.origine ?? null
  faux.transmissions = o.transmissions ?? []
  faux.refusTransmissions = o.refusTransmissions ?? null
  faux.lecturesTransmissions = 0
  faux.suspendreRelecture = false
  faux.libererRelecture = null
  faux.evenements = []
  faux.connexion = o.connexion === undefined ? CONNEXION : o.connexion
  faux.lecturesConnexion = 0
  faux.rejetsOrigine = o.rejetsOrigine ?? 0
  faux.refusOrigine = o.refusOrigine ?? 0
  faux.retenirOrigine = o.retenirOrigine ?? false
  faux.libererOrigine = []
  faux.superpdp = o.superpdp ?? false
  faux.appels = []
  faux.resoudre = null
  render(
    <TransmissionFactureModal
      dossierId="d1" facture={o.facture ?? FACTURE} statutTva={o.statutTva ?? 'redevable'} articleExoneration={null}
      numeroTvaAttribue={o.numeroTvaAttribue ?? false} onClose={() => {}} onUpdated={() => {}}
    />,
  )
}

const deposer = () => screen.findByRole('button', { name: 'Déposer sur Plateforme Démo' })

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('TransmissionFactureModal — un seul envoi', () => {
  // LES TROIS CLICS DANS LE MÊME `act` : deux suffisent à voir un verrou absent, il en faut trois pour voir un verrou
  // posé dans le `try`, que le `finally` du deuxième relâcherait pendant que le premier court (CLAUDE.md).
  it('dépose une seule fois quand on clique trois fois, et la confirmation nomme ce qui part', async () => {
    monter()
    const bouton = await deposer()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'plateforme-agreee', body: { action: 'deposer', dossierId: 'd1', factureId: 'f1', version: 'v1' } }])
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(confirmation.mock.calls[0][0]).toMatch(/^Transmettre la facture F2026-0001 à Client Fictif SAS par Plateforme Démo \?/)
    expect(confirmation.mock.calls[0][0]).toContain('seul un avoir la corrige')
  })

  it('une confirmation refusée n’envoie rien', async () => {
    monter()
    const bouton = await deposer()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { bouton.click() })
    expect(faux.appels).toEqual([])
  })

  it('le verrou tient jusqu’après la relecture qui suit un dépôt', async () => {
    monter()
    const bouton = await deposer()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.suspendreRelecture = true
    await act(async () => { bouton.click() })
    faux.transmissions = [transmission()]
    await act(async () => { faux.resoudre?.({ data: { transmission: transmission() }, error: null }) })
    expect(faux.lecturesTransmissions).toBe(2)
    // La relecture court : le bouton dit qu'un dépôt est en cours, et rien ne repart.
    const enCours = screen.getByRole('button', { name: 'Dépôt…' })
    expect(enCours).toHaveProperty('disabled', true)
    await act(async () => { enCours.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { faux.libererRelecture?.() })
    expect(screen.getByRole('status').textContent).toBe('Déposée sur Plateforme Démo.')
    expect(screen.queryByRole('button', { name: /Déposer sur/ })).toBeNull()
  })

  it('Super PDP seul : « Envoyer par Super PDP », une seule fois', async () => {
    monter({ connexion: null, superpdp: true })
    const bouton = await screen.findByRole('button', { name: 'Envoyer par Super PDP' })
    expect(screen.queryByRole('button', { name: /Déposer sur/ })).toBeNull()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'superpdp-emit', body: { dossierId: 'd1', factureId: 'f1', action: 'envoyer' } }])
  })
})

describe('TransmissionFactureModal — rien n’est proposé sans savoir', () => {
  it('ce qui empêche la facture de partir se dit, et aucun envoi n’est proposé', async () => {
    monter({ facture: factureCii([ligne()], { tiers_siren: null }) })
    expect(await screen.findByText(/Le SIREN du client manque/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
  })

  // La case du numéro de TVA (décision du cabinet du 08/10/2026) : la fenêtre juge comme les fonctions, sur le dossier
  // tel que la page l'a lu.
  it('un dossier en franchise sans numéro de TVA : le refus dit où le cocher ; avec, la facture part', async () => {
    const sansTva = [ligne({ taux_tva: 0 })]
    monter({ facture: factureCii(sansTva), lignes: sansTva, statutTva: 'franchise' })
    expect(await screen.findByText(/sa case se coche dans l’onglet TVA du dossier, sous son statut de TVA/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
    cleanup()

    monter({ facture: factureCii(sansTva), lignes: sansTva, statutTva: 'franchise', numeroTvaAttribue: true })
    expect(await deposer()).toBeTruthy()
    expect(screen.queryByText(/règle G1\.47/)).toBeNull()
  })

  it('des transmissions illisibles : on ne sait pas si elle est partie, rien n’est proposé', async () => {
    monter({ refusTransmissions: 'JWT expired', superpdp: true })
    expect(await screen.findByText(/On ne sait donc pas si elle est déjà partie/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
  })

  it('aucune plateforme reliée au dossier : le dire', async () => {
    monter({ connexion: null, superpdp: false })
    expect(await screen.findByText(/Aucune plateforme n’est reliée à ce dossier/)).toBeTruthy()
  })

  // « Suivre » et « Actualiser » ne se confirment pas : seul le verrou de la fenêtre les retient.
  it('« Suivre » et « Actualiser » ne partent qu’une fois pour trois clics', async () => {
    monter({ transmissions: [transmission()] })
    const suivre = await screen.findByRole('button', { name: 'Suivre' })
    await act(async () => { suivre.click(); suivre.click(); suivre.click() })
    expect(faux.appels).toHaveLength(1)
    cleanup()

    monter({ facture: { ...FACTURE, superpdp_invoice_id: 42 }, superpdp: true })
    const actualiser = await screen.findByRole('button', { name: 'Actualiser le statut Super PDP' })
    await act(async () => { actualiser.click(); actualiser.click(); actualiser.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('un dépôt refusé parce que la connexion a changé relit la connexion, et rien ne repart seul', async () => {
    monter()
    const bouton = await deposer()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { bouton.click() })
    const corps = JSON.stringify({ error: 'La connexion à la plateforme a changé entre-temps : relancez la récupération.', perimee: true })
    await act(async () => { faux.resoudre?.({ data: null, error: { context: new Response(corps, { status: 409 }) } }) })
    expect(screen.getByText(/La connexion à la plateforme a changé entre-temps/)).toBeTruthy()
    expect(faux.lecturesConnexion).toBe(2)
    expect(faux.appels).toHaveLength(1)
  })
})

describe('TransmissionFactureModal — une facture déjà partie', () => {
  it('une transmission active : son état, « Suivre », et pas de nouvel envoi', async () => {
    monter({ transmissions: [transmission()] })
    expect(await screen.findByText(/La plateforme l’a reçue ; son accusé dira si elle l’accepte/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Suivre' }).click() })
    expect(faux.appels).toEqual([{ nom: 'plateforme-agreee', body: { action: 'suivre', dossierId: 'd1', transmissionId: 't1' } }])
    faux.transmissions = [transmission({ etat: 'accepte' })]
    await act(async () => { faux.resoudre?.({ data: { transmission: transmission({ etat: 'accepte' }), message: null }, error: null }) })
    expect(screen.getByRole('status').textContent).toBe('Acceptée.')
    expect(screen.queryByRole('button', { name: 'Suivre' })).toBeNull()
  })

  it('un échec ne bloque pas : la facture peut repartir', async () => {
    monter({ transmissions: [transmission({ etat: 'echec', flux_id: null, detail: 'Refusée : format.' })] })
    expect(await deposer()).toBeTruthy()
    expect(screen.getByText('Refusée : format.')).toBeTruthy()
  })

  it('partie par Super PDP avant les transmissions : pas de nouvel envoi, et son statut s’actualise', async () => {
    monter({ facture: { ...FACTURE, superpdp_invoice_id: 42 }, superpdp: true })
    expect(await screen.findByText(/avant que l’application garde chaque transmission/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Actualiser le statut Super PDP' }).click() })
    expect(faux.appels).toEqual([{ nom: 'superpdp-emit', body: { dossierId: 'd1', factureId: 'f1', action: 'actualiser' } }])
  })
})

// UNE FACTURE PARTIE PAR SUPER PDP SANS EN PORTER LE NUMÉRO : l'envoi a réussi, l'écriture du numéro a échoué, et sa
// transmission l'a gardé. Elle se suit quand même — superpdp-emit retrouve le numéro par la transmission.
describe('TransmissionFactureModal — partie par Super PDP sans en porter le numéro', () => {
  it('son historique et « Actualiser » restent offerts', async () => {
    monter({ transmissions: [transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'depose', flux_id: '42' })], superpdp: true })
    const bouton = await screen.findByRole('button', { name: 'Actualiser le statut Super PDP' })
    expect(screen.getByText('Historique chez Super PDP')).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'superpdp-emit', body: { dossierId: 'd1', factureId: 'f1', action: 'actualiser' } }])
  })

  it('une facture jamais partie par Super PDP n’en montre rien', async () => {
    monter({ transmissions: [transmission({ etat: 'depose' })], superpdp: true })
    await screen.findByText(/La plateforme l’a reçue/)
    expect(screen.queryByText('Historique chez Super PDP')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Actualiser le statut Super PDP' })).toBeNull()
  })
})

describe('TransmissionFactureModal — un avoir', () => {
  // Deux jours crédités : la base garde l'avoir et ses lignes négatifs.
  const credit = [ligne({ designation: 'Mission de conseil — septembre 2026', quantite: -2, prix_unitaire_ht: 85.5 })]
  const avoir = {
    facture: factureCii(credit, { type: 'avoir', numero: 'A2026-0003', facture_origine_id: 'f-origine', date_emission: '2026-10-02', date_echeance: null }),
    lignes: credit,
  }

  it('lit la facture qu’il corrige, et se dépose', async () => {
    monter({ facture: avoir.facture, lignes: avoir.lignes, origine: { numero: 'F2026-0012', date_emission: '2026-09-15' } })
    expect(screen.getByRole('heading', { name: 'Transmettre l’avoir A2026-0003' })).toBeTruthy()
    expect(await deposer()).toBeTruthy()
  })

  // Le garde symétrique : sans la facture qu'il corrige, l'avoir ne part pas — et c'est la lecture qui le dit.
  it('sans la facture qu’il corrige, il ne part pas', async () => {
    monter({ facture: avoir.facture, lignes: avoir.lignes, origine: null })
    expect(await screen.findByText(/L’avoir doit citer la facture qu’il corrige/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur/ })).toBeNull()
  })
})

// L'ABANDON D'UNE TRANSMISSION RESTÉE SANS ISSUE CONNUE (`abandonner_transmission`) : elle bloque tout nouvel envoi. Le
// bouton n'existe qu'un quart d'heure après son départ — la base refuserait plus tôt —, la confirmation dit quoi
// vérifier, et un seul abandon part pour plusieurs clics.
describe('TransmissionFactureModal — l’abandon d’une transmission sans issue connue', () => {
  const ilYA = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

  it('pas avant un quart d’heure : la fenêtre dit quand', async () => {
    monter({ transmissions: [transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'envoi', flux_id: null, cree_le: ilYA(5) })] })
    expect(await screen.findByText(/un quart d’heure après son départ, elle s’abandonne, vérification faite sur Super PDP/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abandonner' })).toBeNull()
  })

  it('passé le délai : confirmé en disant quoi vérifier, un seul abandon, et la facture peut repartir', async () => {
    const envoi = transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'envoi', flux_id: null, cree_le: ilYA(20) })
    monter({ transmissions: [envoi] })
    const bouton = await screen.findByRole('button', { name: 'Abandonner' })
    expect(screen.queryByRole('button', { name: /Déposer sur/ })).toBeNull()

    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { bouton.click() })
    expect(faux.appels).toEqual([])
    expect(confirmation.mock.calls[0][0]).toContain('Vérifie d’abord sur Super PDP que la facture F2026-0001 n’y est pas (elle y porterait l’identifiant externe f1)')
    expect(confirmation.mock.calls[0][0]).toContain('le client la recevra deux fois')

    confirmation.mockReturnValue(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'abandonner_transmission', body: { p_transmission_id: 't1' } }])
    faux.transmissions = [{ ...envoi, etat: 'echec', detail: 'Abandonnée par le cabinet.' }]
    await act(async () => { faux.resoudre?.({ data: null, error: null }) })
    expect(screen.getByRole('status').textContent).toBe('Transmission abandonnée : la facture peut repartir.')
    expect(await deposer()).toBeTruthy()
  })

  it('un abandon refusé par la base se dit', async () => {
    monter({ transmissions: [transmission({ etat: 'envoi', flux_id: null, cree_le: ilYA(20) })] })
    const bouton = await screen.findByRole('button', { name: 'Abandonner' })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { bouton.click() })
    expect(confirmation.mock.calls[0][0]).toContain('Vérifie d’abord sur la plateforme (flux.plateforme-demo.fr) que la facture F2026-0001 n’y est pas')
    await act(async () => { faux.resoudre?.({ data: null, error: { message: 'Accès refusé à ce dossier.' } }) })
    expect(screen.getByText('Accès refusé à ce dossier.')).toBeTruthy()
  })
})

// UNE FACTURE REJETÉE OU REFUSÉE S'ANNULE PAR UN AVOIR INTERNE, QUI NE SE TRANSMET PAS (spécifications externes de la
// DGFiP, § 3.6.4). La base le refuse (garder_transmission_facture) ; la fenêtre le dit avant, et ne propose rien.
describe('TransmissionFactureModal — l’avoir interne d’une facture rejetée ou refusée', () => {
  const credit = [ligne({ designation: 'Mission de conseil', quantite: -1, prix_unitaire_ht: 100 })]
  const avoir = factureCii(credit, { id: 'a1', type: 'avoir', numero: 'A2026-0001', facture_origine_id: 'f1', date_emission: '2026-10-02', date_echeance: null })
  const ORIGINE = { numero: 'F2026-0001', date_emission: '2026-09-15' }

  it('une facture rejetée ne repart pas, et la fenêtre dit pourquoi', async () => {
    monter({ transmissions: [transmission({ etat: 'rejete', detail: 'Error : SIREN inconnu.' })], superpdp: true })
    expect(await screen.findByText(/Rejetée par la plateforme du client \(flux.plateforme-demo.fr\) : elle ne repart pas/)).toBeTruthy()
    expect(screen.getByText(/s’annule par un avoir interne — qui ne se transmet pas —, puis une nouvelle facture \(spécifications externes de la DGFiP, § 3.6.4\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
  })

  it('l’avoir d’une facture rejetée par une plateforme est interne : il ne se propose pas', async () => {
    monter({ facture: avoir, lignes: credit, origine: ORIGINE, rejetsOrigine: 1, superpdp: true })
    expect(await screen.findByText(/Cet avoir annule une facture rejetée ou refusée : c’est un avoir interne, qui ne se transmet pas/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
  })

  it('l’avoir d’une facture refusée chez Super PDP aussi', async () => {
    monter({ facture: avoir, lignes: credit, origine: ORIGINE, refusOrigine: 1, superpdp: true })
    expect(await screen.findByText(/Cet avoir annule une facture rejetée ou refusée/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
  })

  it('tant qu’on ne sait pas si la facture corrigée a été rejetée ou refusée, rien n’est proposé', async () => {
    monter({ facture: avoir, lignes: credit, origine: ORIGINE, superpdp: true, retenirOrigine: true })
    // Tout le reste est lu — ses transmissions, ses lignes, les plateformes reliées — ; les deux comptes attendent.
    await vi.waitFor(() => expect(faux.lecturesConnexion).toBe(1))
    await act(async () => {})
    expect(faux.libererOrigine).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Déposer sur|Envoyer par/ })).toBeNull()
    await act(async () => { for (const liberer of faux.libererOrigine) liberer() })
    expect(await deposer()).toBeTruthy()
  })

  // Le garde symétrique : un avoir d'une facture simplement transmise se transmet.
  it('l’avoir d’une facture ni rejetée ni refusée se dépose', async () => {
    monter({ facture: avoir, lignes: credit, origine: ORIGINE })
    expect(await deposer()).toBeTruthy()
    expect(screen.queryByText(/avoir interne/)).toBeNull()
  })

  it('une facture refusée par le client chez Super PDP le dit', async () => {
    faux.evenements = []
    monter({
      facture: { ...FACTURE, superpdp_invoice_id: 42 }, superpdp: true,
      transmissions: [transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'accepte', flux_id: '42' })],
    })
    faux.evenements = [{ id: 'e1', facture_id: 'f1', superpdp_event_id: 2, status_code: 'fr:210', status_text: 'Refusée', occurred_at: '2026-10-08T09:00:00+00:00' }]
    await act(async () => { screen.getByRole('button', { name: 'Actualiser le statut Super PDP' }).click() })
    await act(async () => { faux.resoudre?.({ data: { ok: true }, error: null }) })
    expect(await screen.findByText(/Refusée par le client : elle s’annule par un avoir interne/)).toBeTruthy()
  })
})
