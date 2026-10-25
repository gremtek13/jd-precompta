import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import type {
  EncaissementFacture, EncaissementFactureTaux, FactureEmise, LigneBancaire, TransmissionEncaissement, TransmissionFacture,
} from '../../lib/types'
import { NON_BASCULE } from '../../test/factures'

// « RÈGLEMENTS » (espace client, étape A3) : la vue de l'onglet Factures, montée pour le cabinet et pour le client « Ventes »,
// avec la VRAIE fenêtre des encaissements. Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. avant sa lecture, ni « aucun », ni total, ni export ; lue vide en entier, elle le dit ; lue en partie, rien que le motif ;
//  2. les lignes dans les deux espaces — la contre-passation négative, le retiré, la déclaration — ; sans « Banque », le
//     relevé n'est pas demandé et le mouvement se dit sous les mots de la fenêtre ;
//  3. chaque ligne ouvre la fenêtre « Encaissements » de SA facture ; rien ne s'écrit depuis la liste ; ce que la fenêtre
//     écrit fait relire la liste, et revenir aux factures relit l'onglet ;
//  4. une recherche ne touche ni le total ni l'export ; un filtre les change ;
//  5. « par le client », au cabinet seul, sur des accès lus en entier ; un accès retiré n'est pas deviné.
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts) et ne rend que les colonnes demandées. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  lectures: [] as string[],
  ecritures: [] as string[],
  rpcs: [] as string[],
  retenir: false,
  enAttente: [] as (() => void)[],
  telecharges: [] as { nom: string; contenu: string }[],
}))

vi.mock('../../lib/fec', async (original) => ({
  ...(await original<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { faux.telecharges.push({ nom, contenu }) },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ data: {}, error: null }) },
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
        let ecriture: string | null = null
        const partir = () => {
          if (ecriture) { faux.ecritures.push(`${table} ${ecriture}`); return { data: null, error: null } }
          faux.lectures.push(table)
          const toutes = filtrer(faux.tables[table], predicats)
          const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
            .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length }
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
          update: () => { ecriture = 'update'; return c },
          delete: () => { ecriture = 'delete'; return c },
          insert: () => { ecriture = 'insert'; return c },
          upsert: () => { ecriture = 'upsert'; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.retenir) {
              return new Promise((r) => { faux.enAttente.push(() => r(undefined)) }).then(partir).then(suite, echec)
            }
            return Promise.resolve().then(partir).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
const HOTE = 'flux.plateforme-fictive.fr'
const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }

const facture = (o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  numero: 'F2027-0001', date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const transmission = (o: Partial<TransmissionFacture> = {}): TransmissionFacture => ({
  id: 't1', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: HOTE, flux_id: 'flux-1', sha256: 'e'.repeat(64),
  etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z', ...o,
})
const encaissement = (o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-10-05', montant: 600, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: '2027-10-05T09:00:00Z', retire_le: null,
  retire_par: null, compte_contrepartie: null, ...o,
})
const part = (o: Partial<EncaissementFactureTaux> = {}): EncaissementFactureTaux => ({
  encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 600, ...o,
})
const declaration = (o: Partial<TransmissionEncaissement> = {}): TransmissionEncaissement => ({
  id: 'te1', dossier_id: 'd1', encaissement_id: 'e1', facture_id: 'f1', canal: 'manuel', hote: HOTE, flux_id: null, sha256: null,
  etat: 'depose', detail: null, note: null, cree_par: null, cree_le: '2027-10-08T09:00:00Z', maj_le: '2027-10-08T09:00:00Z', ...o,
})
const mouvement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'm1', dossier_id: 'd1', date: '2027-10-05', montant: 600, libelle: 'VIR SEPA ALPHA FICTIVE', libelle_brut: null,
  statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2027-10-06T08:00:00Z', encaissements_de_factures: false, ...o,
})

const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))

// Deux factures : F2027-0001 (Alpha) acceptée par la plateforme, un virement déclaré puis contre-passé, et un chèque
// retiré ; F2027-0002 (Beta), un chèque d'octobre à déclarer, en retard au 20 novembre.
const FACTURES = [facture({ id: 'f1', tiers_nom: 'ALPHA FICTIVE SAS' }), facture({ id: 'f2', numero: 'F2027-0002', tiers_nom: 'BETA FICTIVE SARL' })]
const ENCAISSEMENTS = [
  encaissement({ ligne_bancaire_id: 'm1', cree_par: 'u-client' }),
  encaissement({ id: 'e1x', montant: -600, annule_id: 'e1', motif: 'Rendu', date_encaissement: '2027-10-12', cree_le: '2027-10-12T09:00:00Z' }),
  encaissement({ id: 'e1r', montant: 250, moyen: 'cheque', date_encaissement: '2027-10-04', retire_le: '2027-10-06T08:00:00Z', retire_par: 'u-x', cree_par: 'u-ancien' }),
  encaissement({ id: 'e2', facture_id: 'f2', montant: 300, moyen: 'cheque', date_encaissement: '2027-10-07' }),
]

function poser(o: { encaissements?: EncaissementFacture[]; acces?: string[] } = {}) {
  const encaissements = o.encaissements ?? ENCAISSEMENTS
  faux.tables = {
    factures_emises: nues(FACTURES),
    facture_lignes: FACTURES.map((f, i) => ({ ...LIGNE, id: `l${i}`, facture_id: f.id })),
    transmissions_factures: nues([transmission(), transmission({ id: 't2', facture_id: 'f2', flux_id: 'flux-2' })]),
    facture_superpdp_events: [],
    encaissements_factures: nues(encaissements),
    encaissements_factures_taux: nues(encaissements.map((e) => part({ encaissement_id: e.id, montant: e.montant }))),
    transmissions_encaissements: nues(encaissements.some((e) => e.id === 'e1') ? [declaration()] : []),
    statuts_factures_recus: [],
    // Lus par la fenêtre des encaissements au cabinet (étape VF5b) : aucun ici.
    exercices_valides: [],
    lignes_bancaires: nues([mouvement()]),
    reglements_groupes: [],
    pieces: [],
    memberships: (o.acces ?? ['u-client']).map((u, i) => ({ id: `ms${i}`, user_id: u, dossier_id: 'd1', created_at: '2027-01-01T00:00:00Z' })),
  }
}

async function monter(espace: 'cabinet' | 'client', banque = false) {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: '1 rue Fictive',
    statutTva: 'redevable' as const, articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
  }
  render(espace === 'client'
    ? <FacturesTab reglageDesVentes={NON_BASCULE} espace="client" banque={banque} {...commun} />
    : <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" onAdresseUpdated={() => {}} {...commun} />)
  await screen.findByText('F2027-0001')
}

const versLesReglements = () => fireEvent.click(screen.getByRole('tab', { name: 'Règlements' }))
const tableau = () => screen.findByRole('table', { name: 'Règlements' })
const lignes = async () => within(await tableau()).getAllByRole('row').slice(1)
const ligneDe = async (texte: string) => (await lignes()).find((r) => r.textContent?.includes(texte)) as HTMLElement
const totalAffiche = () => screen.getByText(/^Total : /).textContent

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-20T10:00:00Z'))
  poser()
  faux.muetApres = {}
  faux.lectures = []
  faux.ecritures = []
  faux.rpcs = []
  faux.retenir = false
  faux.enAttente = []
  faux.telecharges = []
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Règlements — avant et après la lecture', () => {
  it('avant sa lecture : « Chargement… », ni « aucun », ni total, ni export ; revenue, les lignes', async () => {
    await monter('cabinet')
    faux.retenir = true
    versLesReglements()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/aucun/i)).toBeNull()
    expect(screen.queryByText(/^Total : /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exporter (CSV)' })).toBeNull()
    expect(screen.queryByRole('table', { name: 'Règlements' })).toBeNull()
    await act(async () => { faux.retenir = false; for (const r of faux.enAttente.splice(0)) r() })
    expect(await lignes()).toHaveLength(4)
    expect(screen.queryByText('Chargement…')).toBeNull()
  })

  it('un registre vide, lu en entier : il le dit, sans total, l’export grisé', async () => {
    poser({ encaissements: [] })
    await monter('cabinet')
    versLesReglements()
    expect(await screen.findByText('Aucun encaissement n’est enregistré pour ce dossier.')).toBeTruthy()
    expect(screen.queryByText(/^Total : /)).toBeNull()
    expect((screen.getByRole('button', { name: 'Exporter (CSV)' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['encaissements_factures', 'Les encaissements, leur répartition ou les lignes des factures'],
    ['transmissions_encaissements', 'Les déclarations des encaissements ou l’historique de Super PDP'],
    ['lignes_bancaires', 'Les mouvements du relevé'],
  ])('%s lue en partie : son motif, ni ligne, ni total, ni export', async (table, quoi) => {
    faux.muetApres = { [table]: 0 }
    await monter('cabinet')
    versLesReglements()
    expect(await screen.findByText(new RegExp(`^${quoi}`))).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Règlements' })).toBeNull()
    expect(screen.queryByText(/^Total : /)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exporter (CSV)' })).toBeNull()
    expect(screen.queryByText(/^Aucun/)).toBeNull()
  })
})

describe('Règlements — les lignes, dans les deux espaces', () => {
  it('au cabinet : la contre-passation négative, le retiré, la déclaration, le mouvement nommé, « par le client »', async () => {
    await monter('cabinet')
    versLesReglements()
    const cp = await ligneDe('Annulation')
    expect(within(cp).getByText(/-600,00/)).toBeTruthy()
    expect(within(cp).getByText('Déclaration en retard')).toBeTruthy()
    const retire = await ligneDe('Retiré le')
    expect(within(retire).getByText(/250,00/)).toBeTruthy()
    const e1 = await ligneDe('Contre-passé')
    expect(within(e1).getByText('05/10/2027 · VIR SEPA ALPHA FICTIVE')).toBeTruthy()
    expect(within(e1).getByText('Déclarée')).toBeTruthy()
    expect(within(e1).getByText('par le client')).toBeTruthy()
    // L'auteur du retiré n'a plus d'accès : on ne le devine pas.
    expect(within(retire).queryByText('par le client')).toBeNull()
    expect(faux.lectures).toContain('lignes_bancaires')
  })

  it('au client sans « Banque » : le relevé n’est pas demandé, le mouvement se dit sous les mots de la fenêtre', async () => {
    await monter('client', false)
    versLesReglements()
    const e1 = await ligneDe('Contre-passé')
    expect(within(e1).getByText('Un mouvement du relevé, que ton accès ne montre pas')).toBeTruthy()
    expect(faux.lectures).not.toContain('lignes_bancaires')
    expect(faux.lectures).not.toContain('memberships')
    expect(within(e1).queryByText('par le client')).toBeNull()
    expect(screen.queryByText('Enregistrés par le client')).toBeNull()
    expect(screen.getByText(/Ton accès ne porte pas « Banque »/)).toBeTruthy()
  })

  it('au client avec « Banque » : le mouvement nommé', async () => {
    await monter('client', true)
    versLesReglements()
    const e1 = await ligneDe('Contre-passé')
    expect(within(e1).getByText('05/10/2027 · VIR SEPA ALPHA FICTIVE')).toBeTruthy()
    expect(faux.lectures).toContain('lignes_bancaires')
  })

  it('le client ne lit rien du cabinet dans la liste ; le cabinet, si', async () => {
    await monter('client', false)
    versLesReglements()
    await tableau()
    expect(motsDuCabinet(document.body.textContent ?? '')).toEqual([])
  })
})

describe('Règlements — chaque ligne ouvre la fenêtre de SA facture, rien ne s’écrit d’ici', () => {
  it('la ligne, et son bouton, ouvrent « Encaissements » de sa facture', async () => {
    await monter('cabinet')
    versLesReglements()
    fireEvent.click(await ligneDe('BETA FICTIVE SARL'))
    expect(await screen.findByRole('heading', { name: /^Encaissements de la facture F2027-0002/ })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Fermer' })[0])
    fireEvent.click(within(await ligneDe('Contre-passé')).getByRole('button', { name: 'Encaissements' }))
    expect(await screen.findByRole('heading', { name: /^Encaissements de la facture F2027-0001/ })).toBeTruthy()
    expect(faux.ecritures).toEqual([])
    expect(faux.rpcs).toEqual([])
  })

  it('ce que la fenêtre écrit fait relire la liste ; revenir aux factures relit l’onglet', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await monter('cabinet')
    versLesReglements()
    fireEvent.click(await ligneDe('BETA FICTIVE SARL'))
    const retirer = await screen.findByRole('button', { name: 'Retirer' })
    const avant = faux.lectures.filter((t) => t === 'lignes_bancaires').length
    fireEvent.click(retirer)
    await screen.findByText(/^Encaissement du 07\/10\/2027 retiré/)
    await vi.waitFor(() => expect(faux.rpcs).toEqual(['retirer_encaissement']))
    // La fenêtre relit son relevé ; la liste relit le sien : deux lectures de plus.
    await vi.waitFor(() => expect(faux.lectures.filter((t) => t === 'lignes_bancaires').length).toBeGreaterThanOrEqual(avant + 2))
    fireEvent.click(screen.getAllByRole('button', { name: 'Fermer' })[0])
    const facturesAvant = faux.lectures.filter((t) => t === 'factures_emises').length
    fireEvent.click(screen.getByRole('tab', { name: 'Factures' }))
    await vi.waitFor(() => expect(faux.lectures.filter((t) => t === 'factures_emises').length).toBeGreaterThan(facturesAvant))
  })
})

describe('Règlements — la recherche ne touche ni le total ni l’export ; un filtre, si', () => {
  it('une recherche réduit les lignes, pas le total, pas l’export', async () => {
    await monter('cabinet')
    versLesReglements()
    await tableau()
    const total = totalAffiche()
    expect(total).toMatch(/300,00/)
    // « alpha » : le virement, sa contre-passation et le chèque retiré — dont le total, seul, serait de 0,00 €.
    fireEvent.change(screen.getByPlaceholderText('Rechercher un numéro, un client, un montant…'), { target: { value: 'alpha' } })
    expect(await lignes()).toHaveLength(3)
    expect(totalAffiche()).toBe(total)
    fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' }))
    expect(faux.telecharges).toHaveLength(1)
    expect(faux.telecharges[0].nom).toBe('reglements-2027-11-20.csv')
    // L'en-tête et les quatre lignes : la recherche n'a rien retiré de l'export.
    expect(faux.telecharges[0].contenu.split('\r\n')).toHaveLength(5)
  })

  it('un filtre change le total et l’export', async () => {
    await monter('cabinet')
    versLesReglements()
    await tableau()
    fireEvent.change(screen.getByLabelText('Moyen'), { target: { value: 'cheque' } })
    expect(await lignes()).toHaveLength(2)
    expect(totalAffiche()).toMatch(/Total : 300,00/)
    fireEvent.click(screen.getByRole('button', { name: 'Exporter (CSV)' }))
    expect(faux.telecharges[0].contenu.split('\r\n')).toHaveLength(3)
  })

  it('« Enregistrés par le client », au cabinet, sur des accès lus en entier', async () => {
    await monter('cabinet')
    versLesReglements()
    await tableau()
    const caseClient = screen.getByRole('checkbox', { name: 'Enregistrés par le client' }) as HTMLInputElement
    expect(caseClient.disabled).toBe(false)
    fireEvent.click(caseClient)
    expect(await lignes()).toHaveLength(1)
    expect((await lignes())[0].textContent).toContain('Contre-passé')
  })
})
