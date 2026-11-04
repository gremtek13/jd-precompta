import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { devis, lienDevisFacture } from '../../test/devis'
import type { FactureEmise } from '../../lib/types'
import { NON_BASCULE } from '../../test/factures'

// LA VUE « DEVIS » DANS L'ONGLET FACTURES (espace client, étape P6a1), avec la VRAIE vue et son faux client, qui APPLIQUE les
// filtres et annonce un compte. Ce que ces cas gardent, dans les deux espaces : le drapeau d'export (`DEVIS_EXPORTES`) décide
// si la vue existe — baissé, aucun onglet et aucune lecture des devis ; la liste lue dit le numéro ou « Brouillon », le client,
// le total et l'état déduit ; le vide ne se dit que d'une liste lue en entier ; lue en partie, aucun geste ; les refus se disent
// avant le clic ; l'émission et la suppression se confirment en nommant ce qui part ; deux clics du même `act` ne font qu'une
// écriture. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as string[],
  // Des lignes que le serveur compte sans les rendre : la lecture est partielle.
  manquantes: {} as Record<string, number>,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  refus: null as { message: string } | null,
  drapeau: true,
}))

vi.mock('../../lib/devis', async (original) => ({
  ...(await original<typeof import('../../lib/devis')>()),
  get DEVIS_EXPORTES() { return faux.drapeau },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        await Promise.resolve()
        if (faux.refus) return { data: null, error: faux.refus }
        if (nom === 'enregistrer_devis') {
          return { data: [{ devis_id: args.p_devis_id ?? 'dv-neuf', numero: args.p_emettre ? 'D2026-0002' : null }], error: null }
        }
        if (nom === 'supprimer_brouillon_devis') return { data: args.p_devis_id, error: null }
        return { data: {}, error: null }
      },
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') return { data: { connexion: null }, error: null }
          if (nom === 'superpdp-credentials' && options.body.action === 'status') return { data: { configured: false }, error: null }
          throw new Error(`Appel non attendu : ${nom}`)
        },
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        const partir = () => {
          faux.lectures.push(table)
          const toutes = filtrer(faux.tables[table], predicats)
          const rendu = toutes.slice(debut, fin + 1).map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length + (faux.manquantes[table] ?? 0) }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste?: string) => {
            colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
            return c
          },
          eq: (colonne: string, valeur: unknown) => {
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const FACTURE: FactureEmise = factureCii([LIGNE], {
  id: 'f1', numero: 'F2026-0001', date_emission: '2026-10-01', date_echeance: '2026-10-31', option_debits: false, tiers_nom: 'ALPHA FICTIVE SAS',
})

// Quatre devis : un brouillon, un émis encore valable, un émis expiré, un accepté dont une facture est tirée — et un devis
// d'un autre dossier, que le filtre écarte.
const DEVIS = [
  devis({ id: 'dv1', tiers_nom: 'Brouillon Fictif SARL', date_emission: '2026-11-02', date_validite: '2026-12-02', cree_le: '2026-11-02T08:00:00Z' }),
  devis({ id: 'dv2', numero: 'D2026-0001', statut: 'emis', tiers_nom: 'Émis Fictif SAS', date_emission: '2026-10-20', date_validite: '2026-11-20', montant_ht: 500, montant_tva: 100, montant_ttc: 600 }),
  devis({ id: 'dv3', numero: 'D2026-0002', statut: 'emis', tiers_nom: 'Expiré Fictif', date_emission: '2026-09-01', date_validite: '2026-10-01' }),
  devis({ id: 'dv4', numero: 'D2026-0003', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-09-10', tiers_nom: 'Facturé Fictif', date_emission: '2026-09-05', date_validite: '2026-10-05' }),
  devis({ id: 'dv9', dossier_id: 'd2', tiers_nom: 'Autre Dossier Fictif' }),
]

beforeEach(() => {
  // Le 4 novembre 2026 à midi, à Paris : le jour que la base lirait.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T11:00:00Z'))
  faux.drapeau = true
  faux.lectures = []
  faux.manquantes = {}
  faux.appels = []
  faux.refus = null
  faux.tables = {
    // Le dossier, lu avec les devis : l'émetteur que la base posera (A7).
    dossiers: [{ id: 'd1', nom: 'Atelier fictif', siret: '12345678200010', adresse: '1 rue Fictive', forme_juridique: '5710', denomination_imprimee: 'Atelier fictif SAS' }],
    factures_emises: [{ ...FACTURE }],
    facture_lignes: [{ ...LIGNE, id: 'l0', facture_id: 'f1' }],
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    transmissions_encaissements: [],
    statuts_factures_recus: [],
    lignes_bancaires: [],
    reglements_groupes: [],
    pieces: [],
    memberships: [],
    devis: DEVIS.map((d) => ({ ...d })),
    devis_factures: [{ ...lienDevisFacture({ devis_id: 'dv4' }) }],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function monter(espace: 'cabinet' | 'client') {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: '1 rue Fictive',
    statutTva: 'redevable' as const, articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
  }
  render(espace === 'client'
    ? <FacturesTab reglageDesVentes={NON_BASCULE} espace="client" banque={false} {...commun} />
    : <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" compteCaisse="530000" onAdresseUpdated={() => {}} {...commun} />)
  await screen.findByText('F2026-0001')
}

const vers = (nom: string) => fireEvent.click(screen.getByRole('tab', { name: nom }))
const ligneDe = (tableau: HTMLElement, texte: string) =>
  within(tableau).getAllByRole('row').find((r) => r.textContent?.includes(texte)) as HTMLElement
const saisir = (libelle: string | RegExp, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } })

describe.each(['cabinet', 'client'] as const)('Devis dans l’onglet Factures — %s', (espace) => {
  it('le drapeau baissé : aucun onglet « Devis », aucune lecture des devis', async () => {
    faux.drapeau = false
    await monter(espace)
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Factures', 'Règlements', 'Articles', 'Clients', 'Paramètres'])
    expect(faux.lectures).not.toContain('devis')
    expect(faux.lectures).not.toContain('devis_factures')
  })

  it('le drapeau levé : « Devis » suit « Factures », qui reste la vue par défaut, et rien n’est lu avant le clic', async () => {
    await monter(espace)
    expect(screen.getAllByRole('tab').map((t) => t.textContent))
      .toEqual(['Factures', 'Devis', 'Règlements', 'Articles', 'Clients', 'Paramètres'])
    expect(screen.getByRole('tab', { name: 'Factures' }).getAttribute('aria-selected')).toBe('true')
    expect(faux.lectures).not.toContain('devis')
  })

  it('la liste lue : le numéro ou « Brouillon », le client, le total et l’état déduit ; rien d’un autre dossier', async () => {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    expect(within(tableau).getAllByRole('row')).toHaveLength(5)
    const brouillon = ligneDe(tableau, 'Brouillon Fictif SARL')
    expect(within(brouillon).getByText('Brouillon', { selector: 'td' })).toBeTruthy()
    expect(within(brouillon).getByText('Brouillon', { selector: 'span' })).toBeTruthy()
    expect(within(brouillon).getByRole('button', { name: 'Supprimer le brouillon' })).toBeTruthy()
    const emis = ligneDe(tableau, 'D2026-0001')
    expect(emis.textContent).toContain('Émis — en attente de réponse')
    expect(emis.textContent?.replace(/\s/g, ' ')).toContain('600,00 €')
    expect(within(emis).queryByRole('button')).toBeNull()
    expect(ligneDe(tableau, 'D2026-0002').textContent).toContain('Expiré')
    expect(ligneDe(tableau, 'D2026-0003').textContent).toContain('Facturé')
    expect(screen.queryByText('Autre Dossier Fictif')).toBeNull()
    expect(faux.lectures).toEqual(expect.arrayContaining(['devis', 'devis_factures']))
  })

  it('le vide ne se dit que d’une liste lue en entier', async () => {
    faux.tables.devis = []
    faux.tables.devis_factures = []
    await monter(espace)
    vers('Devis')
    expect(await screen.findByText(espace === 'client' ? 'Tu n’as encore aucun devis.' : 'Aucun devis pour ce dossier.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '+ Nouveau devis' })).toBeTruthy()
  })

  it('lue en partie : le bandeau, et aucun geste — ni nouveau devis, ni modifier, ni supprimer', async () => {
    faux.manquantes.devis_factures = 1
    await monter(espace)
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    expect(screen.getByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '+ Nouveau devis' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Supprimer le brouillon' })).toBeNull()
  })

  it('les refus se disent avant le clic, sur la saisie telle qu’elle part ; le brouillon part par enregistrer_devis', async () => {
    await monter(espace)
    vers('Devis')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau devis' }))
    const fenetre = screen.getByRole('dialog')
    // Validité proposée à un mois de la date du jour.
    expect((screen.getByLabelText('Date du devis') as HTMLInputElement).value).toBe('2026-11-04')
    expect((screen.getByLabelText('Valable jusqu’au') as HTMLInputElement).value).toBe('2026-12-04')
    expect(within(fenetre).getByText('Le nom du client est à renseigner.')).toBeTruthy()
    expect((within(fenetre).getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(fenetre).getByRole('button', { name: 'Émettre' }) as HTMLButtonElement).disabled).toBe(true)
    saisir('Client (nom ou raison sociale)', 'Nouveau Fictif SAS')
    // Un prix vide n'est pas un prix (jamais zéro) : la ligne n'est pas une ligne de devis, dans l'ordre de la base.
    expect(within(fenetre).getByText(/La ligne 1 n'est pas une ligne de devis/)).toBeTruthy()
    saisir('Prix unitaire HT de la ligne 1', '250,5')
    expect(within(fenetre).getByText('Ligne 1 : sa désignation manque.')).toBeTruthy()
    saisir('Désignation de la ligne 1', 'Étude')
    // L'émission demande encore la validité après la date : on la recule pour voir le refus, puis on la remet.
    saisir('Valable jusqu’au', '2026-11-01')
    expect(within(fenetre).getByText(/Un devis n'expire pas avant sa date/)).toBeTruthy()
    saisir('Valable jusqu’au', '2026-12-04')
    expect(within(fenetre).getByLabelText('Totaux du devis').textContent?.replace(/\s/g, ' ')).toContain('300,60 € TTC')
    const enregistrer = within(fenetre).getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement
    expect(enregistrer.disabled).toBe(false)
    fireEvent.click(enregistrer)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels).toHaveLength(1)
    const { nom, args } = faux.appels[0]
    expect(nom).toBe('enregistrer_devis')
    expect(args).toMatchObject({ p_dossier_id: 'd1', p_devis_id: null, p_emettre: false })
    expect(args.p_lignes).toEqual([{ designation: 'Étude', quantite: 1, prix_unitaire_ht: 250.5, taux_tva: 20 }])
    expect(args.p_devis).toMatchObject({ tiers_nom: 'Nouveau Fictif SAS', montant_ht: 250.5, montant_tva: 50.1, montant_ttc: 300.6 })
    // Aucun émetteur ne part : la base le pose à l'émission, depuis le dossier.
    expect(Object.keys(args.p_devis as object).filter((k) => k.startsWith('emetteur'))).toEqual([])
    expect(screen.getByRole('status').textContent).toBe('Brouillon de devis enregistré.')
  })

  it('l’émission se confirme en nommant ce qui part ; refusée, rien ne part', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, 'Brouillon Fictif SARL')).getByRole('button', { name: 'Modifier' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Émettre' }))
    expect(confirmer).toHaveBeenCalledTimes(1)
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte).toContain('« Brouillon Fictif SARL »')
    expect(texte.replace(/\s/g, ' ')).toContain('1 200,00 € TTC')
    expect(texte).toContain('valable jusqu’au 02/12/2026')
    expect(texte).toContain('prochain numéro de la série D2026')
    expect(texte).toContain('ne se modifiera plus')
    expect(faux.appels).toHaveLength(0)
    confirmer.mockReturnValue(true)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Émettre' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args).toMatchObject({ p_devis_id: 'dv1', p_emettre: true })
    expect(screen.getByRole('status').textContent).toBe('Devis D2026-0002 émis.')
  })

  it('le refus de la base se dit dans la fenêtre, et la liste est relue', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refus = { message: 'Le devis D2026-0009 est émis : il ne se modifie plus — il se duplique.' }
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, 'Brouillon Fictif SARL')).getByRole('button', { name: 'Modifier' }))
    const lectures = faux.lectures.filter((t) => t === 'devis').length
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer le brouillon' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Le devis D2026-0009 est émis : il ne se modifie plus — il se duplique.')
    expect(faux.lectures.filter((t) => t === 'devis').length).toBe(lectures + 1)
  })

  it('la suppression se confirme en nommant le brouillon ; deux clics du même act ne suppriment qu’une fois', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    const bouton = within(ligneDe(tableau, 'Brouillon Fictif SARL')).getByRole('button', { name: 'Supprimer le brouillon' })
    fireEvent.click(bouton)
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte).toContain('« Brouillon Fictif SARL » du 02/11/2026')
    expect(texte.replace(/\s/g, ' ')).toContain('1 200,00 € TTC')
    expect(texte).toContain('irréversible')
    expect(faux.appels).toHaveLength(0)
    confirmer.mockReturnValue(true)
    act(() => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Brouillon de devis supprimé.'))
    expect(faux.appels).toEqual([{ nom: 'supprimer_brouillon_devis', args: { p_dossier_id: 'd1', p_devis_id: 'dv1' } }])
  })

  it('deux clics du même act sur « Enregistrer le brouillon » n’écrivent qu’une fois', async () => {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, 'Brouillon Fictif SARL')).getByRole('button', { name: 'Modifier' }))
    const bouton = within(screen.getByRole('dialog')).getByRole('button', { name: 'Enregistrer le brouillon' })
    act(() => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels.map((a) => a.nom)).toEqual(['enregistrer_devis'])
  })
})

describe('Devis — les mots de chaque espace', () => {
  it('au client : le tutoiement, ses notes que son cabinet lit, aucun onglet', async () => {
    await monter('client')
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    expect(screen.getByText(/Tes devis : un brouillon se modifie/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '+ Nouveau devis' }))
    expect(screen.getByLabelText('Notes (elles ne figurent pas sur le devis, mais ton cabinet les lit aussi)')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\bonglet/i)
  })

  it('au cabinet : les notes que lit le client « Ventes »', async () => {
    await monter('cabinet')
    vers('Devis')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouveau devis' }))
    expect(screen.getByLabelText(/Notes \(elles ne figurent pas sur le devis, mais le client qui porte la case/)).toBeTruthy()
  })
})
