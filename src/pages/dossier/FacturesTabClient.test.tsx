import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import type {
  EncaissementFacture, EncaissementFactureTaux, FactureEmise, LigneBancaire, StatutTva, TransmissionEncaissement,
  TransmissionFacture,
} from '../../lib/types'

// L'ONGLET FACTURES EN MODE CLIENT — « Mes ventes › Factures » (espace client, étape P4a). L'onglet et ses VRAIES fenêtres,
// montés pour le client qui porte la case « Ventes », et pour le cabinet en regard. Ce que ces cas gardent :
//
//  1. LE GARDE DES MOTS : en mode client, aucun texte rendu — fenêtres, titres, confirmations comprises — ne renvoie à un
//     onglet du cabinet, ne nomme le titulaire « le client » comme le cabinet le nomme, ni ne le vouvoie
//     (lib/espaceVentes.ts, `motsDuCabinet`). Défini précisément par ces formes, et éprouvé par son défaut planté : les
//     MÊMES états, montés pour le cabinet, en portent chacun au moins une — le garde n'est pas aveugle là où il dit « rien ».
//  2. Les gestes du cabinet retirés : l'adresse du dossier ne s'enregistre pas depuis la facture ; une adresse absente se
//     dit ; un statut de TVA à préciser se dit avec la phrase de la conception.
//  3. La banque : sans « Banque », la fenêtre des encaissements ne lit ni le relevé, ni les règlements groupés, ni les
//     pièces, et le dit ; avec, elle les lit et propose un mouvement.
//  4. Deux puis trois clics sur « Valider la facture » dans le même `act` : une seule validation.
//  5. Une lecture partielle ne commande aucun geste ; le refus du plafond d'e-mails (429) se dit en français.
//
// Le faux client APPLIQUE les filtres qui décident de ce que l'écran voit (src/test/filtresPostgrest.ts). Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  // Les tables LUES (une entrée par requête partie), et les écritures directes — aucune n'est attendue du client.
  lectures: [] as string[],
  ecritures: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  appels: [] as Record<string, unknown>[],
  connexion: null as unknown,
  superpdp: false,
  retenirRpc: false,
  enAttente: [] as (() => void)[],
  // Ce que rend `plateforme-agreee` (action « relever ») et `send-email`, fabriqué à chaque appel : un corps ne se lit qu'une fois.
  relever: null as null | (() => unknown),
  email: null as null | (() => unknown),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const executer = (nom: string, args: Record<string, unknown>) => {
    if (nom === 'enregistrer_facture') {
      return { data: [{ facture_id: args.p_facture_id ?? 'f-neuve', numero: args.p_valider ? 'F2027-0002' : null }], error: null }
    }
    return { data: {}, error: null }
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (faux.retenirRpc) return new Promise((r) => { faux.enAttente.push(() => r(executer(nom, args))) })
        return Promise.resolve(executer(nom, args))
      },
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
          faux.appels.push({ nom, ...options.body })
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') return { data: { connexion: faux.connexion }, error: null }
          if (nom === 'superpdp-credentials' && options.body.action === 'status') return { data: { configured: faux.superpdp }, error: null }
          if (nom === 'plateforme-agreee' && options.body.action === 'relever' && faux.relever) return faux.relever()
          if (nom === 'send-email' && faux.email) return faux.email()
          throw new Error(`Appel non attendu : ${nom} ${String(options.body.action ?? '')}`)
        },
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        let tete = false
        let ecriture: string | null = null
        const lire = () => {
          const toutes = filtrer(faux.tables[table], predicats)
          if (tete) return { data: null, error: null, count: toutes.length }
          const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
            .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length }
        }
        const partir = () => {
          if (ecriture) {
            faux.ecritures.push(`${table} ${ecriture}`)
            return { data: null, error: null }
          }
          faux.lectures.push(table)
          return lire()
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste?: string, options?: { head?: boolean }) => {
            // Les colonnes demandées, et elles seules ; une jointure (`table!inner(…)`) ne rend rien ici.
            colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
            tete = options?.head === true
            return c
          },
          eq: (colonne: string, valeur: unknown) => {
            // Les lignes et l'historique de Super PDP se filtrent par le dossier de LEUR facture.
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          update: () => { ecriture = 'update'; return c },
          delete: () => { ecriture = 'delete'; return c },
          insert: () => { ecriture = 'insert'; return c },
          upsert: () => { ecriture = 'upsert'; return c },
          maybeSingle: () => Promise.resolve().then(() => {
            const r = partir()
            return { data: Array.isArray(r.data) ? r.data[0] ?? null : null, error: null }
          }),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
const HOTE = 'flux.plateforme-fictive.fr'
const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }

// Une facture validée de prestations de services à une entreprise, sans option pour les débits, émise après le
// 01/09/2027 : son statut « Encaissée » est DÛ.
const facture = (o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  numero: 'F2027-0001', date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const brouillon = (): FactureEmise => facture({ id: 'b1', numero: null, statut: 'brouillon', validated_at: null })
const transmission = (o: Partial<TransmissionFacture> = {}): TransmissionFacture => ({
  id: 't1', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: HOTE, flux_id: 'flux-1', sha256: 'e'.repeat(64),
  etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z', ...o,
})
const encaissement = (o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-10-05', montant: 600, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: '2027-10-05T09:00:00Z', retire_le: null,
  retire_par: null, ...o,
})
const part = (o: Partial<EncaissementFactureTaux> = {}): EncaissementFactureTaux => ({
  encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 600, ...o,
})
const declaration = (o: Partial<TransmissionEncaissement> = {}): TransmissionEncaissement => ({
  id: 'te1', dossier_id: 'd1', encaissement_id: 'e2', facture_id: 'f1', canal: 'manuel', hote: HOTE, flux_id: null, sha256: null,
  etat: 'depose', detail: null, note: null, cree_par: null, cree_le: '2027-10-08T09:00:00Z', maj_le: '2027-10-08T09:00:00Z', ...o,
})
const mouvement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'm1', dossier_id: 'd1', date: '2027-10-15', montant: 1200, libelle: 'VIR SEPA CLIENT FICTIF SAS', libelle_brut: null,
  statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2027-10-16T08:00:00Z', ...o,
})
const CONNEXION = {
  nom: 'Plateforme fictive', url_flux: `https://${HOTE}/flux`, url_jeton: `https://${HOTE}/jeton`, hote: HOTE, client_id: 'app',
  organisation_id: null, portee: null, recherche_depuis: null, derniere_recuperation: null, cycle_vie_depuis: null,
  cycle_vie_lu_le: null, created_at: '2027-09-01T08:00:00Z', version: 'v1',
}

const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))

interface Jeu {
  factures?: FactureEmise[]
  transmissions?: TransmissionFacture[]
  encaissements?: EncaissementFacture[]
  parts?: EncaissementFactureTaux[]
  declarations?: TransmissionEncaissement[]
  mouvements?: LigneBancaire[]
}

function poser(j: Jeu = {}) {
  const factures = j.factures ?? [facture(), brouillon()]
  faux.tables = {
    factures_emises: nues(factures),
    facture_lignes: factures.map((f, i) => ({ ...LIGNE, id: `l${i}`, facture_id: f.id })),
    transmissions_factures: nues(j.transmissions ?? []),
    facture_superpdp_events: [],
    encaissements_factures: nues(j.encaissements ?? []),
    encaissements_factures_taux: nues(j.parts ?? []),
    transmissions_encaissements: nues(j.declarations ?? []),
    statuts_factures_recus: [],
    lignes_bancaires: nues(j.mouvements ?? [mouvement()]),
    reglements_groupes: [],
    pieces: [],
    dossiers: [],
  }
}

type Espace = 'client' | 'cabinet'
interface Montage {
  statutTva?: StatutTva | null
  adresse?: string | null
  debits?: boolean
  banque?: boolean
}

const adresseEnregistree = vi.fn()

async function monter(espace: Espace, m: Montage = {}) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: m.adresse ?? null,
    statutTva: m.statutTva === undefined ? 'redevable' as const : m.statutTva, articleExoneration: null, numeroTvaAttribue: false,
    tvaSurDebits: m.debits ?? false,
  }
  render(espace === 'client'
    ? <FacturesTab espace="client" banque={m.banque ?? false} {...commun} />
    : <FacturesTab espace="cabinet" onAdresseUpdated={adresseEnregistree} {...commun} />)
  await screen.findByText('F2027-0001')
}

const ligneDe = (numero: string) => screen.getByText(numero).closest('tr') as HTMLElement
const boutonDe = (numero: string, nom: string) => within(ligneDe(numero)).getByRole('button', { name: nom })
const fenetre = (titre: RegExp) => screen.getByRole('heading', { name: titre }).closest('.card') as HTMLElement

// Les confirmations demandées : leur texte compte comme un texte rendu. Refusées, sauf quand le cas les accepte.
let confirmations: string[] = []
let accepter = false

// Tout le texte qu'un état montre à qui regarde : les nœuds de texte, puis les titres, les textes d'aide et les
// confirmations. Chaque nœud à part : deux nœuds voisins collés fabriqueraient un mot qui n'existe pas.
function texteRendu(racine: HTMLElement = document.body): string {
  const morceaux: string[] = []
  const marche = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT)
  for (let n = marche.nextNode(); n; n = marche.nextNode()) if (n.nodeValue?.trim()) morceaux.push(n.nodeValue)
  for (const e of racine.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) if (e.getAttribute(a)) morceaux.push(e.getAttribute(a) as string)
  }
  return [...morceaux, ...confirmations].join('\n')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-02T10:00:00Z'))
  poser()
  faux.muetApres = {}
  faux.lectures = []
  faux.ecritures = []
  faux.rpcs = []
  faux.appels = []
  faux.connexion = null
  faux.superpdp = false
  faux.retenirRpc = false
  faux.enAttente = []
  faux.relever = null
  faux.email = null
  confirmations = []
  accepter = false
  vi.spyOn(window, 'confirm').mockImplementation((message?: string) => { confirmations.push(message ?? ''); return accepter })
  adresseEnregistree.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ── 1. Le garde des mots ─────────────────────────────────────────────────────────────────────────────────────────────
// Chaque état : comment l'atteindre, et ce qui s'y lit (l'onglet entier, ou la fenêtre ouverte).
interface Etat {
  nom: string
  jeu?: Jeu
  montage?: Montage
  connexion?: unknown
  superpdp?: boolean
  relever?: () => unknown
  atteindre?: () => Promise<HTMLElement | void>
}

const releveRefuse = () => ({
  data: null,
  error: { context: new Response(JSON.stringify({ error: 'La plateforme refuse l’identité enregistrée.', identifiants_refuses: true }), { status: 401 }) },
})
const releveIncomplet = () => ({
  data: {
    hote: HOTE, version: 'v1', depuis: null, issues: [], ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
    en_attente: 0, en_erreur: 0, reportes: 3, complete: false, motif: 'le délai de la fonction', cycle_vie_depuis: null,
    cycle_vie_lu_le: null, erreur_reprise: null,
  },
  error: null,
})

const ETATS: Etat[] = [
  { nom: 'l’onglet, statut de TVA à préciser, aucune plateforme reliée', montage: { statutTva: null } },
  {
    nom: 'une facture neuve, statut de TVA à préciser, adresse absente',
    montage: { statutTva: null },
    atteindre: async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
      return fenetre(/^Nouvelle facture$/)
    },
  },
  {
    nom: 'une facture neuve d’un redevable aux débits : une ligne à 0 % sans article, des prestations de services',
    montage: { debits: true, adresse: '1 rue Fictive' },
    atteindre: async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
      fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '0' } })
      fireEvent.change(screen.getByLabelText('La facture porte sur'), { target: { value: 'services' } })
      return fenetre(/^Nouvelle facture$/)
    },
  },
  {
    nom: 'la transmission d’une facture, statut de TVA à préciser',
    montage: { statutTva: null },
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Transmettre'))
      await screen.findByText(/ne peut pas partir telle quelle/)
      return fenetre(/^Transmettre la facture/)
    },
  },
  {
    nom: 'la transmission d’une facture prête, aucune plateforme reliée',
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Transmettre'))
      await screen.findByText(/Aucune plateforme n’est reliée/)
      return fenetre(/^Transmettre la facture/)
    },
  },
  {
    nom: 'la transmission d’une facture déposée sur la plateforme du titulaire, et sa pastille',
    jeu: { transmissions: [transmission({ etat: 'depose' })] },
    connexion: CONNEXION,
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Transmettre'))
      await screen.findByRole('button', { name: 'Suivre' })
    },
  },
  {
    nom: 'les encaissements, statut de TVA à préciser, sans « Banque »',
    montage: { statutTva: null },
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
      await screen.findByText(/^Reste à encaisser/)
      return fenetre(/^Encaissements de la facture/)
    },
  },
  {
    nom: 'la déclaration d’un encaissement sur la plateforme qui a accepté la facture, et sa confirmation',
    jeu: { transmissions: [transmission()], encaissements: [encaissement()], parts: [part()] },
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
      fireEvent.click(await screen.findByRole('button', { name: 'Déclaré sur la plateforme' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Inscrire la déclaration' }))
      return fenetre(/^Encaissements de la facture/)
    },
  },
  {
    nom: 'la contre-passation d’un encaissement déclaré',
    jeu: {
      transmissions: [transmission()], encaissements: [encaissement({ id: 'e2' })], parts: [part({ encaissement_id: 'e2' })],
      declarations: [declaration()],
    },
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
      fireEvent.click(await screen.findByRole('button', { name: 'Contre-passer' }))
      await screen.findByRole('button', { name: 'Enregistrer la contre-passation' })
      return fenetre(/^Encaissements de la facture/)
    },
  },
  {
    nom: 'l’avoir d’une facture',
    atteindre: async () => {
      fireEvent.click(boutonDe('F2027-0001', 'Avoir'))
      await screen.findByRole('button', { name: /^Valider l.avoir$/ })
      return fenetre(/^Avoir pour la facture/)
    },
  },
  {
    nom: 'la plateforme reliée, et son relevé refusé faute d’identifiants acceptés',
    connexion: CONNEXION,
    relever: releveRefuse,
    atteindre: async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Lire les statuts de la plateforme' }))
      await screen.findByText(/La plateforme refuse l’identité enregistrée/)
    },
  },
  {
    nom: 'le bilan d’un relevé incomplet',
    connexion: CONNEXION,
    relever: releveIncomplet,
    atteindre: async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Lire les statuts de la plateforme' }))
      await screen.findByText(/le délai de la fonction/)
    },
  },
]

async function atteindre(espace: Espace, e: Etat): Promise<string> {
  poser(e.jeu)
  faux.connexion = e.connexion ?? null
  faux.superpdp = e.superpdp ?? false
  faux.relever = e.relever ?? null
  await monter(espace, e.montage)
  const racine = e.atteindre ? await e.atteindre() : undefined
  return texteRendu(racine ?? document.body)
}

describe('FacturesTab en mode client — le garde des mots', () => {
  it.each(ETATS.map((e) => [e.nom, e] as const))('%s : rien du cabinet dans ce que lit le client', async (_nom, e) => {
    const texte = await atteindre('client', e)
    expect(motsDuCabinet(texte)).toEqual([])
  })

  // LE DÉFAUT PLANTÉ : le même état, monté pour le cabinet — exactement l'erreur d'un écran qui oublierait de dire qui
  // regarde. Le garde y trouve au moins une forme : là où il dit « rien » au client, il regardait.
  it.each(ETATS.map((e) => [e.nom, e] as const))('%s : monté pour le cabinet, le garde y voit ses mots', async (_nom, e) => {
    const texte = await atteindre('cabinet', e)
    expect(motsDuCabinet(texte).length).toBeGreaterThan(0)
  })
})

// ── 2. Les gestes du cabinet retirés ─────────────────────────────────────────────────────────────────────────────────
describe('FacturesTab en mode client — les gestes du cabinet retirés', () => {
  it('l’adresse du dossier ne s’enregistre pas depuis la facture ; absente, elle se dit', async () => {
    await monter('client')
    fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
    expect(screen.queryByText(/Enregistrer comme adresse du dossier/)).toBeNull()
    expect(screen.queryAllByRole('checkbox').map((c) => c.id)).not.toContain('')
    screen.getByText(/Ton cabinet n’a pas encore enregistré l’adresse de ta société/)
  })

  it('une adresse enregistrée ne se signale pas absente', async () => {
    await monter('client', { adresse: '1 rue Fictive, 75001 Paris' })
    fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
    expect(screen.queryByText(/Ton cabinet n’a pas encore enregistré/)).toBeNull()
    expect((screen.getByLabelText(/Adresse de l'émetteur/) as HTMLTextAreaElement).value).toBe('1 rue Fictive, 75001 Paris')
  })

  it('le cabinet, lui, garde la case, et elle écrit l’adresse du dossier', async () => {
    await monter('cabinet')
    fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
    fireEvent.change(screen.getByLabelText(/Adresse de l'émetteur/), { target: { value: '2 rue Fictive' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Enregistrer comme adresse du dossier/ }))
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Client Fictif SAS' } })
    fireEvent.change(screen.getAllByRole('textbox').find((t) => (t as HTMLInputElement).value === '' && t.closest('td')) as HTMLElement, { target: { value: 'Conseil' } })
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '100' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' })) })
    expect(faux.ecritures).toEqual(['dossiers update'])
    expect(adresseEnregistree).toHaveBeenCalledWith('2 rue Fictive')
  })

  it('un statut de TVA à préciser se dit au client, avec la phrase de la conception ; pas au cabinet', async () => {
    await monter('client', { statutTva: null })
    screen.getByText('Ton cabinet doit d’abord préciser ton statut de TVA : tes factures ne peuvent pas partir.')
  })

  // Depuis l'étape P4b, le client relie lui-même sa plateforme (EC-Q4) : « Tes plateformes » le lui offre, là où P4a disait
  // que son cabinet la reliait.
  it('le client voit qu’aucune plateforme n’est reliée, et la relie lui-même dans « Tes plateformes » ; le cabinet n’a pas cette section', async () => {
    await monter('client')
    const section = (await screen.findByRole('heading', { name: 'Tes plateformes' })).closest('section') as HTMLElement
    await within(section).findByText(/^Ta plateforme agréée : aucune n’est reliée à ta société\./)
    within(section).getByRole('button', { name: 'Relier ta plateforme' })
    await within(section).findByRole('button', { name: 'Relier Super PDP' })
    expect(screen.queryByText(/c’est ton cabinet qui la relie/)).toBeNull()
  })

  it('… sa plateforme reliée, il la voit et relève ses statuts', async () => {
    faux.connexion = CONNEXION
    await monter('client')
    await screen.findByText(/^Ta plateforme : Plateforme fictive/)
    screen.getByRole('button', { name: 'Lire les statuts de la plateforme' })
  })

  it('pour le cabinet, rien de tout cela', async () => {
    await monter('cabinet', { statutTva: null })
    await act(async () => {})
    expect(screen.queryByText(/Ton cabinet doit d’abord préciser/)).toBeNull()
    expect(screen.queryByText(/Aucune plateforme agréée n’est reliée à ta société/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Tes plateformes' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Relier|Gérer/ })).toBeNull()
  })
})

// ── 3. La banque ─────────────────────────────────────────────────────────────────────────────────────────────────────
const LUES_SANS_BANQUE = ['lignes_bancaires', 'reglements_groupes', 'pieces']

describe('FacturesTab en mode client — la fenêtre des encaissements et la case « Banque »', () => {
  it('sans « Banque » : ni le relevé, ni les règlements, ni les pièces ne sont lus ; la fenêtre le dit, et s’enregistre sans mouvement', async () => {
    poser({ encaissements: [encaissement({ ligne_bancaire_id: 'm9' })], parts: [part()] })
    await monter('client', { banque: false })
    fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
    await screen.findByRole('button', { name: 'Enregistrer l’encaissement' })
    for (const table of LUES_SANS_BANQUE) expect(faux.lectures, table).not.toContain(table)
    screen.getByText(/Ton accès ne porte pas « Banque » sur cette société : le relevé n’est pas lu ici/)
    expect(screen.queryByLabelText('Mouvement du relevé (facultatif)')).toBeNull()
    expect(screen.queryByText(/Aucun mouvement ne se propose/)).toBeNull()
    // Le mouvement d'un encaissement que le cabinet a désigné : dit, sans « — » qui le nierait.
    screen.getByText('Un mouvement du relevé, que ton accès ne montre pas')

    fireEvent.change(screen.getByLabelText('Date de l’encaissement'), { target: { value: '2027-10-20' } })
    fireEvent.change(screen.getByLabelText('Moyen de paiement'), { target: { value: 'virement' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’encaissement' })) })
    const appel = faux.rpcs.find((r) => r.nom === 'enregistrer_encaissement')
    expect(appel?.args.p_ligne_bancaire_id).toBeNull()
  })

  it('avec « Banque » : le relevé est lu, et un mouvement se propose', async () => {
    await monter('client', { banque: true })
    fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
    await screen.findByRole('button', { name: 'Enregistrer l’encaissement' })
    for (const table of LUES_SANS_BANQUE) expect(faux.lectures, table).toContain(table)
    const choix = screen.getByLabelText('Mouvement du relevé (facultatif)') as HTMLSelectElement
    expect([...choix.options].map((o) => o.value)).toContain('m1')
    expect(screen.queryByText(/Ton accès ne porte pas « Banque »/)).toBeNull()
  })

  it('le cabinet lit le relevé, comme avant', async () => {
    await monter('cabinet')
    fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
    await screen.findByRole('button', { name: 'Enregistrer l’encaissement' })
    for (const table of LUES_SANS_BANQUE) expect(faux.lectures, table).toContain(table)
    screen.getByLabelText('Mouvement du relevé (facultatif)')
  })
})

// ── 4. Le verrou d'un geste du client ────────────────────────────────────────────────────────────────────────────────
describe('FacturesTab en mode client — « Valider la facture », plusieurs clics', () => {
  async function saisirUneFacture() {
    fireEvent.click(screen.getByRole('button', { name: '+ Nouvelle facture' }))
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Client Fictif SAS' } })
    const designation = screen.getAllByRole('textbox').find((t) => t.closest('td[data-libelle="Désignation"]')) as HTMLElement
    fireEvent.change(designation, { target: { value: 'Conseil' } })
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '100' } })
  }

  it.each([2, 3])('%i clics dans le même `act` : une seule validation, par la fonction', async (clics) => {
    faux.retenirRpc = true
    await monter('client', { adresse: '1 rue Fictive' })
    await saisirUneFacture()
    const valider = screen.getByRole('button', { name: 'Valider la facture' })
    act(() => { for (let i = 0; i < clics; i++) fireEvent.click(valider) })
    expect(faux.rpcs.filter((r) => r.nom === 'enregistrer_facture')).toHaveLength(1)
    expect(faux.rpcs[0].args.p_valider).toBe(true)
    await act(async () => { for (const r of faux.enAttente.splice(0)) r() })
    expect(faux.ecritures).toEqual([])
  })
})

// ── 5. Lecture partielle, plafond d'e-mails ──────────────────────────────────────────────────────────────────────────
describe('FacturesTab en mode client — une lecture partielle ne commande aucun geste', () => {
  it('les encaissements lus en partie : ni reste, ni formulaire, ni geste dans la fenêtre ; aucune pastille dans la liste', async () => {
    poser({ encaissements: [encaissement(), encaissement({ id: 'e2', montant: 100 })], parts: [part(), part({ encaissement_id: 'e2', montant: 100 })] })
    faux.muetApres = { encaissements_factures: 1 }
    await monter('client')
    await screen.findByText(/Les encaissements des factures/)
    const pastilles = [...ligneDe('F2027-0001').querySelectorAll('.badge')].map((b) => b.textContent)
    expect(pastilles.filter((p) => /encaiss/i.test(p ?? ''))).toEqual([])
    fireEvent.click(boutonDe('F2027-0001', 'Encaissements'))
    const carte = await screen.findByText(/Les encaissements du dossier/).then((e) => e.closest('.card') as HTMLElement)
    expect(within(carte).getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
    expect(within(carte).queryByText(/Reste à encaisser/)).toBeNull()
  })

  it('les factures lues en partie : l’avoir ne juge pas ce qui a été crédité, c’est la base qui juge', async () => {
    poser({ factures: [facture(), brouillon(), facture({ id: 'f2', numero: 'F2027-0003' })] })
    faux.muetApres = { factures_emises: 2 }
    await monter('client')
    await screen.findByText(/Les factures du dossier/)
    fireEvent.click(boutonDe('F2027-0001', 'Avoir'))
    await screen.findByText(/La liste des factures n'a pas été lue en entier/)
  })
})

describe('FacturesTab en mode client — l’envoi par e-mail', () => {
  it('le plafond de trente par jour (429) se dit en français, tel que la fonction le dit', async () => {
    const PLAFOND = 'Ce dossier a déjà envoyé 30 e-mails aujourd\'hui, le plafond d\'un accès client : celui-ci n\'est pas parti. '
      + 'Il pourra partir demain, ou ton cabinet peut l\'envoyer.'
    faux.email = () => ({ data: null, error: { context: new Response(JSON.stringify({ error: PLAFOND }), { status: 429 }) } })
    await monter('client')
    fireEvent.click(boutonDe('F2027-0001', 'Envoyer par e-mail'))
    fireEvent.change(screen.getByLabelText('Adresse du destinataire'), { target: { value: 'acheteur@exemple-fictif.fr' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer' })) })
    await screen.findByText(PLAFOND)
    expect(faux.appels.find((a) => a.nom === 'send-email')).toMatchObject({ type: 'facture', factureId: 'f1', dossierId: 'd1' })
  })
})
