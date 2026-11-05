import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { devis, lienDevisFacture } from '../../test/devis'
import type { FactureEmise } from '../../lib/types'
import { NON_BASCULE } from '../../test/factures'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { formatMoney } from '../../lib/format'
import { BON_POUR_ACCORD, MENTION_BROUILLON_IMPRIMEE } from '../../lib/devis'

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
  // `ENVOI_DES_DEVIS_OFFERT` (étape P6c3) : baissé par défaut, levé par les cas de l'envoi.
  envoi: false,
  // Ce que `send-email` rendrait à un refus : le message de son corps JSON, sous un statut non-2xx.
  refusEnvoi: null as string | null,
}))

vi.mock('../../lib/devis', async (original) => ({
  ...(await original<typeof import('../../lib/devis')>()),
  get DEVIS_EXPORTES() { return faux.drapeau },
  get ENVOI_DES_DEVIS_OFFERT() { return faux.envoi },
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
        // La réponse (étape P6a2) : le devis réécrit, rendu tel quel.
        if (nom === 'decider_devis') {
          const d = faux.tables.devis.find((x) => x.id === args.p_devis_id) as Record<string, unknown>
          Object.assign(d, { reponse: args.p_reponse, date_reponse: args.p_date })
          return { data: { ...d }, error: null }
        }
        // La facture tirée d'un devis accepté : un brouillon, et son lien.
        if (nom === 'facturer_devis') {
          const d = faux.tables.devis.find((x) => x.id === args.p_devis_id) as Record<string, unknown>
          faux.tables.factures_emises.push({ ...faux.tables.factures_emises[0], id: 'f-tiree', numero: null, statut: 'brouillon', tiers_nom: d.tiers_nom })
          faux.tables.devis_factures.push({ ...lienDevisFacture({ id: 'df-tiree', devis_id: String(d.id), facture_id: 'f-tiree' }) })
          return { data: 'f-tiree', error: null }
        }
        return { data: {}, error: null }
      },
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') return { data: { connexion: null }, error: null }
          if (nom === 'superpdp-credentials' && options.body.action === 'status') return { data: { configured: false }, error: null }
          if (nom === 'send-email') {
            faux.appels.push({ nom, args: options.body })
            await Promise.resolve()
            return faux.refusEnvoi
              ? { data: null, error: { context: new Response(JSON.stringify({ error: faux.refusEnvoi }), { status: 429 }) } }
              : { data: { ok: true }, error: null }
          }
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
          // Une ligne par sa clé (l'identité du dossier) : la première, ou nulle.
          maybeSingle: () => Promise.resolve().then(partir).then((r) => ({ data: r.data[0] ?? null, error: null })),
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

// L'émetteur qu'un devis émis porte, posé à son émission : un autre que le dossier d'aujourd'hui, pour que l'aperçu dise lequel.
const EMETTEUR_FIGE = { emetteur_nom: 'Émetteur Figé Fictif', emetteur_siret: SIRET_VENDEUR, emetteur_adresse: '9 rue Figée' }

// Quatre devis : un brouillon, un émis encore valable, un émis expiré, un accepté dont une facture est tirée — et un devis
// d'un autre dossier, que le filtre écarte.
const DEVIS = [
  devis({ id: 'dv1', tiers_nom: 'Brouillon Fictif SARL', date_emission: '2026-11-02', date_validite: '2026-12-02', cree_le: '2026-11-02T08:00:00Z' }),
  devis({
    id: 'dv2', numero: 'D2026-0001', statut: 'emis', tiers_nom: 'Émis Fictif SAS', date_emission: '2026-10-20', date_validite: '2026-11-20',
    lignes: [{ designation: 'Audit fictif', quantite: 2, prix_unitaire_ht: 250, taux_tva: 20 }], montant_ht: 500, montant_tva: 100, montant_ttc: 600,
    objet: 'Mission fictive', conditions: 'Acompte fictif de 30 % à la commande.', mentions_legales: 'Mentions légales fictives.',
    notes: 'Note partagée fictive', ...EMETTEUR_FIGE,
  }),
  devis({ id: 'dv3', numero: 'D2026-0002', statut: 'emis', tiers_nom: 'Expiré Fictif', date_emission: '2026-09-01', date_validite: '2026-10-01', ...EMETTEUR_FIGE }),
  devis({ id: 'dv4', numero: 'D2026-0003', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-09-10', tiers_nom: 'Facturé Fictif', date_emission: '2026-09-05', date_validite: '2026-10-05', ...EMETTEUR_FIGE }),
  devis({ id: 'dv9', dossier_id: 'd2', tiers_nom: 'Autre Dossier Fictif' }),
]

beforeEach(() => {
  // Le 4 novembre 2026 à midi, à Paris : le jour que la base lirait.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T11:00:00Z'))
  faux.drapeau = true
  faux.envoi = false
  faux.refusEnvoi = null
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
    // Émis sans réponse : l'aperçu (étape P6b) et la réponse (étape P6a2).
    expect(within(emis).getAllByRole('button').map((b) => b.textContent)).toEqual(['Aperçu', 'Enregistrer la réponse'])
    expect(ligneDe(tableau, 'D2026-0002').textContent).toContain('Expiré')
    // Facturé : sa facture dite, et l'aperçu seul.
    const facture = ligneDe(tableau, 'D2026-0003')
    expect(facture.textContent).toContain('Facturé')
    expect(within(facture).getByText('F2026-0001')).toBeTruthy()
    expect(within(facture).getAllByRole('button').map((b) => b.textContent)).toEqual(['Aperçu'])
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

// L'ÉTAPE P6a2 : la réponse à un devis émis, la facture tirée d'un devis accepté, la facture dite dans la liste et la recherche.
// Au client, aucune confirmation ne porte un mot du cabinet.
const sansMotsDuCabinet = (espace: 'cabinet' | 'client', texte: string) => {
  if (espace === 'client') expect(motsDuCabinet(texte)).toEqual([])
}
// Un devis accepté sans facture, ajouté au jeu de la vue.
const ACCEPTE = devis({
  id: 'dv5', numero: 'D2026-0004', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-10-25', tiers_nom: 'Accepté Fictif',
  date_emission: '2026-10-15', date_validite: '2026-11-15', cree_le: '2026-10-15T08:00:00Z',
})

describe.each(['cabinet', 'client'] as const)('Devis — répondre et facturer (P6a2) — %s', (espace) => {
  async function repondreA(numero: string) {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, numero)).getByRole('button', { name: 'Enregistrer la réponse' }))
    return screen.getByRole('dialog')
  }
  const choisir = (fenetre: HTMLElement, reponse: 'Accepté' | 'Refusé') => fireEvent.click(within(fenetre).getByLabelText(reponse))
  const bouton = (fenetre: HTMLElement) => within(fenetre).getByRole('button', { name: 'Enregistrer la réponse' }) as HTMLButtonElement

  it('dans la validité : la date proposée au jour, la confirmation nomme le devis, le client, la réponse et sa date ; hors validité à faux', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await repondreA('D2026-0001')
    expect((within(fenetre).getByLabelText('Date de la réponse') as HTMLInputElement).value).toBe('2026-11-04')
    // Aucun choix : le refus de la base, avant le clic.
    expect(within(fenetre).getByText('La réponse au devis est « acceptée » ou « refusée ».')).toBeTruthy()
    expect(bouton(fenetre).disabled).toBe(true)
    choisir(fenetre, 'Accepté')
    expect(bouton(fenetre).disabled).toBe(false)
    fireEvent.click(bouton(fenetre))
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte).toContain('l’acceptation du devis D2026-0001 pour « Émis Fictif SAS »')
    expect(texte).toContain('datée du 04/11/2026')
    expect(texte).not.toContain('RENOUVELER')
    sansMotsDuCabinet(espace, texte)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels).toEqual([{
      nom: 'decider_devis',
      args: { p_dossier_id: 'd1', p_devis_id: 'dv2', p_reponse: 'acceptee', p_date: '2026-11-04', p_hors_validite: false },
    }])
    expect(screen.getByRole('status').textContent).toBe('Réponse au devis D2026-0001 enregistrée : accepté le 04/11/2026.')
    // Relue : le devis est accepté, et se transforme.
    const ligne = ligneDe(screen.getByRole('table', { name: 'Devis' }), 'D2026-0001')
    expect(ligne.textContent).toContain('Accepté')
    expect(within(ligne).getByRole('button', { name: 'Transformer en facture' })).toBeTruthy()
  })

  it('hors validité : un refus part à faux ; une acceptation se dit avant le clic, la confirmation dit qu’elle renouvelle l’offre, et part à vrai', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fenetre = await repondreA('D2026-0002')
    choisir(fenetre, 'Refusé')
    expect(within(fenetre).queryByText(/n’était plus valable/)).toBeNull()
    fireEvent.click(bouton(fenetre))
    const refus = confirmer.mock.calls[0][0] as string
    expect(refus).toContain('le refus du devis D2026-0002 pour « Expiré Fictif »')
    expect(refus).not.toContain('RENOUVELER')
    expect(faux.appels).toHaveLength(0)
    choisir(fenetre, 'Accepté')
    expect(within(fenetre).getByText(/Le devis n’était plus valable le 04\/11\/2026 : il l’était jusqu’au 01\/10\/2026/)).toBeTruthy()
    // Hors validité, l'acceptation n'est pas refusée : elle se confirme.
    expect(bouton(fenetre).disabled).toBe(false)
    confirmer.mockReturnValue(true)
    fireEvent.click(bouton(fenetre))
    const texte = confirmer.mock.calls[1][0] as string
    expect(texte).toContain('n’était plus valable le 04/11/2026 : il l’était jusqu’au 01/10/2026')
    expect(texte).toContain('c’est RENOUVELER L’OFFRE')
    expect(texte).toContain('l’acceptation du devis D2026-0002 pour « Expiré Fictif »')
    sansMotsDuCabinet(espace, texte)
    await vi.waitFor(() => expect(faux.appels).toHaveLength(1))
    expect(faux.appels[0].args).toMatchObject({ p_devis_id: 'dv3', p_reponse: 'acceptee', p_hors_validite: true })
  })

  it('les refus se disent avant le clic, sur la date telle qu’elle part : ni avant le devis, ni dans l’avenir', async () => {
    const fenetre = await repondreA('D2026-0001')
    choisir(fenetre, 'Refusé')
    const dater = (v: string) => fireEvent.change(within(fenetre).getByLabelText('Date de la réponse'), { target: { value: v } })
    dater('2026-10-19')
    expect(within(fenetre).getByText('Une réponse ne précède pas le devis, daté du 20/10/2026.')).toBeTruthy()
    expect(bouton(fenetre).disabled).toBe(true)
    dater('2026-11-05')
    expect(within(fenetre).getByText(/Une réponse ne se date pas dans l'avenir : nous sommes le 04\/11\/2026\./)).toBeTruthy()
    expect(bouton(fenetre).disabled).toBe(true)
    dater('')
    expect(within(fenetre).getByText('La date de la réponse est à renseigner.')).toBeTruthy()
    expect(faux.appels).toHaveLength(0)
  })

  it('deux clics du même act sur « Enregistrer la réponse » n’écrivent qu’une fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await repondreA('D2026-0001')
    choisir(fenetre, 'Refusé')
    act(() => {
      fireEvent.click(bouton(fenetre))
      fireEvent.click(bouton(fenetre))
    })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels.map((a) => a.nom)).toEqual(['decider_devis'])
  })

  it('la transformation se confirme en disant ce qui part ; puis la liste relue mène au brouillon tiré', async () => {
    faux.tables.devis.push({ ...ACCEPTE })
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    const transformer = within(ligneDe(tableau, 'D2026-0004')).getByRole('button', { name: 'Transformer en facture' })
    fireEvent.click(transformer)
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte).toContain('Transformer le devis D2026-0004 pour « Accepté Fictif »')
    expect(texte).toContain('BROUILLON de facture sera créé, daté du 04/11/2026')
    expect(texte).toContain('le client et ses mentions, la ligne et les totaux du devis')
    expect(texte).toContain('à l’émetteur du jour')
    expect(texte).toContain('Le devis sera marqué facturé')
    sansMotsDuCabinet(espace, texte)
    expect(faux.appels).toHaveLength(0)
    confirmer.mockReturnValue(true)
    act(() => {
      fireEvent.click(transformer)
      fireEvent.click(transformer)
    })
    // Le brouillon tiré s'ouvre, dans la vue « Factures », relue.
    expect(await screen.findByText('Modifier le brouillon')).toBeTruthy()
    expect(faux.appels).toEqual([{ nom: 'facturer_devis', args: { p_dossier_id: 'd1', p_devis_id: 'dv5' } }])
    expect(screen.getByRole('tab', { name: 'Factures' }).getAttribute('aria-selected')).toBe('true')
  })

  it('le refus de la transformation se dit, et rien n’est ouvert', async () => {
    faux.tables.devis.push({ ...ACCEPTE })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refus = { message: 'Le devis D2026-0004 a déjà sa facture (F2026-0007) : un devis se transforme une fois.' }
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, 'D2026-0004')).getByRole('button', { name: 'Transformer en facture' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Le devis D2026-0004 a déjà sa facture (F2026-0007) : un devis se transforme une fois.')
    expect(screen.getByRole('tab', { name: 'Devis' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('Modifier le brouillon')).toBeNull()
  })

  it.each(['devis_factures', 'factures_emises'])('lue en partie (« %s ») : ni réponse ni transformation', async (table) => {
    faux.tables.devis.push({ ...ACCEPTE })
    faux.manquantes[table] = 1
    await monter(espace)
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    expect(screen.getByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enregistrer la réponse' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Transformer en facture' })).toBeNull()
  })

  it('la recherche filtre l’affichage seul : le compte lit la liste entière, et le vide ne se dit pas du dossier', async () => {
    await monter(espace)
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    const barre = screen.getByRole('searchbox')
    fireEvent.change(barre, { target: { value: 'expire' } })
    const tableau = screen.getByRole('table', { name: 'Devis' })
    expect(within(tableau).getAllByRole('row')).toHaveLength(2)
    expect(within(tableau).getByText('Expiré Fictif')).toBeTruthy()
    expect(screen.getByText('1 sur 4')).toBeTruthy()
    // La facture tirée se cherche aussi.
    fireEvent.change(barre, { target: { value: 'F2026-0001' } })
    expect(within(screen.getByRole('table', { name: 'Devis' })).getByText('Facturé Fictif')).toBeTruthy()
    fireEvent.change(barre, { target: { value: 'introuvable' } })
    expect(screen.getByText('Aucun devis ne correspond à la recherche.')).toBeTruthy()
    expect(screen.queryByText(/aucun devis\.|Aucun devis pour ce dossier/)).toBeNull()
    expect(screen.getByText('aucun résultat')).toBeTruthy()
  })
})

// L'APERÇU ET L'IMPRESSION (étape P6b), dans les deux espaces : un brouillon, un émis, un accepté, chacun imprimant ce qu'il
// doit ; les montants lus dans `textContent` tels que `formatMoney` les écrit (ils ne se coupent pas) ; aucun style en ligne
// sur ce que l'impression défait ; l'avis de l'écran, jamais le papier, dans les mots de l'espace.
describe.each(['cabinet', 'client'] as const)('L’aperçu d’un devis — %s', (espace) => {
  async function ouvrirLApercu(texte: string) {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, texte)).getByRole('button', { name: 'Aperçu' }))
    return screen.getByRole('dialog', { name: 'Aperçu du devis' })
  }
  const carteDe = (dialogue: HTMLElement) => dialogue.textContent ?? ''

  it('un émis : son numéro, l’émetteur qu’il porte, le client, l’objet, les lignes, les totaux, les mentions, « Bon pour accord »', async () => {
    const d = await ouvrirLApercu('D2026-0001')
    const t = carteDe(d)
    expect(within(d).getByRole('heading', { name: 'DEVIS D2026-0001' })).toBeTruthy()
    expect(t).toContain('Daté du 20/10/2026')
    expect(t).toContain('Devis valable jusqu’au 20/11/2026')
    // L'émetteur figé à l'émission, jamais le dossier d'aujourd'hui.
    expect(t).toContain('Émetteur Figé Fictif')
    expect(t).toContain('9 rue Figée')
    expect(t).not.toContain('Atelier fictif SAS')
    expect(t).toContain('Émis Fictif SAS')
    expect(t).toContain('Mission fictive')
    expect(t).toContain('Audit fictif')
    for (const montant of [250, 500, 600, 100]) expect(t).toContain(formatMoney(montant))
    expect(t).toContain('Acompte fictif de 30 % à la commande.')
    expect(t).toContain('Mentions légales fictives.')
    expect(t).toContain(BON_POUR_ACCORD)
    // Les notes ne s'impriment pas ; ni avis (en attente), ni brouillon.
    expect(t).not.toContain('Note partagée fictive')
    expect(t).not.toContain(MENTION_BROUILLON_IMPRIMEE)
    expect(within(d).queryByRole('note')).toBeNull()
  })

  it('un brouillon : « DEVIS — BROUILLON », le dossier comme émetteur, la phrase imprimée, et l’avis de l’écran', async () => {
    const d = await ouvrirLApercu('Brouillon Fictif SARL')
    const t = carteDe(d)
    expect(within(d).getByRole('heading', { name: 'DEVIS — BROUILLON' })).toBeTruthy()
    expect(t).toContain(MENTION_BROUILLON_IMPRIMEE)
    expect(t).toContain('Atelier fictif SAS')
    expect(t).toContain('SIRET 12345678200010')
    expect(t).toContain(formatMoney(1200))
    expect(within(d).getByRole('note').textContent).toMatch(/^Brouillon : ce devis n’est pas encore émis/)
    expect(t).toContain(BON_POUR_ACCORD)
  })

  it('un accepté : l’offre telle qu’émise, sa réponse dite à l’écran seulement', async () => {
    faux.tables.devis_factures = []
    const d = await ouvrirLApercu('D2026-0003')
    expect(within(d).getByRole('heading', { name: 'DEVIS D2026-0003' })).toBeTruthy()
    const avis = within(d).getByRole('note')
    expect(avis.textContent).toMatch(/^Ce devis a été accepté le 10\/09\/2026\. Le document reste l’offre telle qu’émise/)
    // L'avis vit dans le bloc que l'impression retire.
    expect(avis.className).toBe('facture-imprimable-avis')
    expect(carteDe(d)).toContain(BON_POUR_ACCORD)
  })

  it('« Imprimer » ouvre l’impression du navigateur ; « Fermer » ferme ; aucun style en ligne sur ce que l’impression défait', async () => {
    const imprimer = vi.spyOn(window, 'print').mockImplementation(() => {})
    const d = await ouvrirLApercu('D2026-0001')
    const actions = d.querySelector('.facture-imprimable-actions') as HTMLElement
    expect(actions.getAttribute('style')).toBeNull()
    expect(d.getAttribute('style')).toBeNull()
    expect(d.className).toBe('card facture-imprimable')
    expect(d.parentElement!.getAttribute('style')).toBeNull()
    expect(d.parentElement!.className).toBe('facture-apercu-voile')
    expect((d.querySelector('.devis-bon-pour-accord') as HTMLElement).getAttribute('style')).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: 'Imprimer / Enregistrer en PDF' }))
    expect(imprimer).toHaveBeenCalledTimes(1)
    fireEvent.click(within(d).getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('dialog', { name: 'Aperçu du devis' })).toBeNull()
  })

  it('un émis qui ne porte pas son émetteur ne s’imprime pas, et le dit', async () => {
    Object.assign(faux.tables.devis.find((x) => x.id === 'dv2') as Record<string, unknown>, { emetteur_nom: null })
    const d = await ouvrirLApercu('D2026-0001')
    expect(carteDe(d)).toContain('Ce devis ne peut pas s’imprimer : ce devis émis ne porte pas son émetteur.')
    expect(within(d).queryByRole('button', { name: 'Imprimer / Enregistrer en PDF' })).toBeNull()
  })

  it('lue en partie : aucun aperçu', async () => {
    faux.manquantes.devis = 1
    await monter(espace)
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    expect(screen.queryByRole('button', { name: 'Aperçu' })).toBeNull()
  })

  it('l’aperçu ne porte aucune forme du cabinet chez le client', async () => {
    const d = await ouvrirLApercu('Brouillon Fictif SARL')
    if (espace === 'client') expect(motsDuCabinet(carteDe(d))).toEqual([])
    else expect(carteDe(d)).toContain('Brouillon : ce devis')
  })
})

// L'ÉTAPE P6c3 : « Envoyer par e-mail » un devis ÉMIS, derrière `ENVOI_DES_DEVIS_OFFERT` (baissé : l'état d'avant, éprouvé), dans
// les deux espaces. La confirmation nomme le devis, son client, son total et l'adresse ; un devis expiré, répondu ou facturé part
// tel quel, et le dit ; l'appel est celui de `send-email` sous un verrou ; une erreur de la fonction se dit, rien n'est dit envoyé.
describe.each(['cabinet', 'client'] as const)('Devis — envoyer par e-mail (P6c3) — %s', (espace) => {
  const ADRESSE = 'client@exemple.fr'
  // Un devis refusé, ajouté au jeu : l'avis d'une réponse négative.
  const REFUSE = devis({
    id: 'dv6', numero: 'D2026-0009', statut: 'emis', reponse: 'refusee', date_reponse: '2026-10-12', tiers_nom: 'Refusé Fictif',
    date_emission: '2026-10-10', date_validite: '2026-11-30', cree_le: '2026-10-10T08:00:00Z', ...EMETTEUR_FIGE,
  })

  beforeEach(() => {
    faux.envoi = true
    faux.tables.devis.push({ ...REFUSE })
    // Les devis émis portent l'adresse de leur client : celle que la fenêtre propose.
    for (const d of faux.tables.devis) if (d.statut === 'emis') d.tiers_email = ADRESSE
  })

  async function ouvrirLEnvoi(numero: string) {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    fireEvent.click(within(ligneDe(tableau, numero)).getByRole('button', { name: 'Envoyer par e-mail' }))
    return screen.getByRole('dialog')
  }
  const envoyerBouton = (fenetre: HTMLElement) => within(fenetre).getByRole('button', { name: 'Envoyer' }) as HTMLButtonElement
  const adresseDe = (fenetre: HTMLElement) => within(fenetre).getByLabelText('Adresse du destinataire') as HTMLInputElement
  const envois = () => faux.appels.filter((a) => a.nom === 'send-email')

  it('le drapeau baissé : aucun bouton, l’état d’avant', async () => {
    faux.envoi = false
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    expect(screen.queryByRole('button', { name: 'Envoyer par e-mail' })).toBeNull()
    expect(within(ligneDe(tableau, 'D2026-0001')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Aperçu', 'Enregistrer la réponse'])
  })

  it('sans « Devis » (DEVIS_EXPORTES baissé), l’envoi levé n’ouvre rien', async () => {
    faux.drapeau = false
    await monter(espace)
    // (Le bouton de l'onglet Factures, lui, envoie une facture : seule la vue des devis compte ici.)
    expect(screen.queryByRole('tab', { name: 'Devis' })).toBeNull()
    expect(faux.lectures).not.toContain('devis')
  })

  it('levé : un bouton sur chaque devis émis — en attente, expiré, répondu, facturé —, jamais sur un brouillon', async () => {
    await monter(espace)
    vers('Devis')
    const tableau = await screen.findByRole('table', { name: 'Devis' })
    expect(within(tableau).getAllByRole('button', { name: 'Envoyer par e-mail' })).toHaveLength(4)
    for (const numero of ['D2026-0001', 'D2026-0002', 'D2026-0003', 'D2026-0009']) {
      expect(within(ligneDe(tableau, numero)).getByRole('button', { name: 'Envoyer par e-mail' })).toBeTruthy()
    }
    expect(within(ligneDe(tableau, 'Brouillon Fictif SARL')).queryByRole('button', { name: 'Envoyer par e-mail' })).toBeNull()
  })

  it('lue en partie : aucun bouton', async () => {
    faux.manquantes.devis_factures = 1
    await monter(espace)
    vers('Devis')
    await screen.findByRole('table', { name: 'Devis' })
    expect(screen.queryByRole('button', { name: 'Envoyer par e-mail' })).toBeNull()
  })

  it('la fenêtre propose l’adresse du devis, modifiable ; la confirmation nomme le devis, le client, le total et l’adresse ; le corps part tel quel', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    expect(adresseDe(fenetre).value).toBe(ADRESSE)
    fireEvent.change(adresseDe(fenetre), { target: { value: ' autre@exemple.fr ' } })
    fireEvent.change(within(fenetre).getByLabelText('Message personnalisé (facultatif)'), { target: { value: ' Bonjour fictif ' } })
    fireEvent.click(envoyerBouton(fenetre))
    expect(confirmer).toHaveBeenCalledTimes(1)
    const texte = (confirmer.mock.calls[0][0] as string).replace(/\s/g, ' ')
    expect(texte).toContain('Envoyer le devis D2026-0001 pour « Émis Fictif SAS » (600,00 € TTC) à autre@exemple.fr ?')
    expect(texte).toContain('sans pièce jointe')
    sansMotsDuCabinet(espace, texte)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(envois()).toEqual([{ nom: 'send-email', args: {
      dossierId: 'd1', type: 'devis', devisId: 'dv2', destinataire: 'autre@exemple.fr', message: 'Bonjour fictif',
    } }])
    expect(screen.getByRole('status').textContent).toBe('Devis D2026-0001 envoyé à autre@exemple.fr.')
  })

  it('sans message : le champ n’est pas envoyé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    fireEvent.click(envoyerBouton(fenetre))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(envois()[0].args).toEqual({ dossierId: 'd1', type: 'devis', devisId: 'dv2', destinataire: ADRESSE })
    expect('message' in JSON.parse(JSON.stringify(envois()[0].args))).toBe(false)
  })

  it('confirmation refusée : rien ne part, la fenêtre reste', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    fireEvent.click(envoyerBouton(fenetre))
    expect(envois()).toHaveLength(0)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([
    ['D2026-0002', 'Sa validité a pris fin le 01/10/2026 ; il part tel quel.'],
    ['D2026-0003', 'Ce devis a déjà reçu sa réponse : il a été accepté le 10/09/2026, puis transformé en facture.'],
    ['D2026-0009', 'Ce devis a déjà reçu sa réponse : il a été refusé le 12/10/2026.'],
  ])('l’avis du devis %s se dit dans la fenêtre et dans la confirmation, sans rien refuser', async (numero, avis) => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await ouvrirLEnvoi(numero)
    expect(fenetre.textContent).toContain(avis)
    sansMotsDuCabinet(espace, fenetre.textContent ?? '')
    expect(envoyerBouton(fenetre).disabled).toBe(false)
    fireEvent.click(envoyerBouton(fenetre))
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte.startsWith(avis)).toBe(true)
    sansMotsDuCabinet(espace, texte)
    await vi.waitFor(() => expect(envois()).toHaveLength(1))
  })

  it('un émis encore en attente : aucun avis', async () => {
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    expect(fenetre.textContent).not.toContain('part tel quel')
  })

  it('les refus se disent avant le clic : adresse absente, adresse mal formée', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    fireEvent.change(adresseDe(fenetre), { target: { value: '' } })
    expect(within(fenetre).getByText('L’adresse du destinataire est à renseigner.')).toBeTruthy()
    expect(envoyerBouton(fenetre).disabled).toBe(true)
    fireEvent.change(adresseDe(fenetre), { target: { value: 'client@exemple' } })
    expect(within(fenetre).getByText('Adresse e-mail du destinataire invalide.')).toBeTruthy()
    expect(envoyerBouton(fenetre).disabled).toBe(true)
    fireEvent.click(envoyerBouton(fenetre))
    expect(confirmer).not.toHaveBeenCalled()
    expect(envois()).toHaveLength(0)
  })

  it('deux clics du même act sur « Envoyer » n’envoient qu’une fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    const bouton = envoyerBouton(fenetre)
    act(() => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(envois()).toHaveLength(1)
  })

  it('une erreur de la fonction se dit sous ses mots, la fenêtre reste, et rien ne se dit envoyé', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refusEnvoi = 'Ce dossier a déjà envoyé 30 e-mails aujourd’hui : celui-ci n’est pas parti.'
    const fenetre = await ouvrirLEnvoi('D2026-0001')
    fireEvent.click(envoyerBouton(fenetre))
    expect((await within(fenetre).findByRole('alert')).textContent).toBe(faux.refusEnvoi)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.body.textContent).not.toContain('envoyé à')
    expect(envoyerBouton(fenetre).disabled).toBe(false)
    // Le verrou est relâché : on peut recommencer, et la fonction cette fois accepte.
    faux.refusEnvoi = null
    fireEvent.click(envoyerBouton(fenetre))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(envois()).toHaveLength(2)
    expect(screen.getByRole('status').textContent).toBe(`Devis D2026-0001 envoyé à ${ADRESSE}.`)
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
