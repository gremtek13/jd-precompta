import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TuilesVentesClient from './TuilesVentesClient'
import ClientHome from './ClientHome'
import AccueilVentesClient from './AccueilVentesClient'
import { motsDuCabinet } from '../lib/espaceVentes'
import { useVentesDuClient } from '../lib/ventesDuClientLecture'
import { ETAT_FICTIF, ETAT_NEUF, statutLuFictif } from '../test/etatFactureElectronique'
import FacturesTab from './dossier/FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../test/facturesCii'
import type {
  EncaissementFacture, EncaissementFactureTaux, FactureEmise, TransmissionEncaissement, TransmissionFacture,
} from '../lib/types'

// « À ENCAISSER » ET « À DÉCLARER » SUR L'ACCUEIL DU CLIENT (espace client, étape P4b). Ce que ces cas gardent :
//  1. sans la case « Ventes » relue à la base : rien — ni tuile, ni squelette une fois lu ;
//  2. une lecture pas encore revenue : des squelettes, aucun chiffre ; partielle, ou des droits illisibles : aucun chiffre,
//     une phrase qui le dit ;
//  3. lue en entier : les NOMBRES des pastilles de l'onglet Factures, montées sur le MÊME jeu d'essai — un compte qui
//     divergerait de l'onglet enverrait le client chercher ce qu'il n'y trouve pas ; chaque tuile mène à « Mes ventes » ;
//  4. l'accueil ne monte les tuiles qu'avec « Mes ventes » ouvert sur la société affichée ;
//  5. depuis l'étape A6b2, l'accueil les monte AVEC l'encart « Facture électronique », d'après UNE SEULE lecture des ventes : le
//     faux client compte les requêtes, et l'encart dit les mêmes nombres que les tuiles et l'onglet.
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refusees: new Set<string>(),
  droits: { cabinet: false, membre: true, ventes: true, banque: false } as unknown,
  refusDroits: null as string | null,
  rpcs: [] as string[],
  // Les tables lues, une entrée par requête partie : l'accueil lit les ventes UNE fois pour les tuiles et pour l'encart.
  tablesLues: [] as string[],
  // L'état de la facture électronique que rend la base (étape A6b2), ou son refus.
  etat: null as unknown,
  refusEtat: null as string | null,
  // Toutes les réponses restent EN ATTENTE tant que le cas ne les libère pas.
  retenir: false,
  enAttente: [] as (() => void)[],
  droitsParDossier: {} as Record<string, { ventes: boolean; banque: boolean }>,
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const attendre = () => (faux.retenir ? new Promise<void>((r) => { faux.enAttente.push(r) }) : Promise.resolve())
  return {
    supabase: {
      rpc: async (nom: string) => {
        faux.rpcs.push(nom)
        await attendre()
        if (nom === 'droits_sur_le_dossier') {
          return faux.refusDroits ? { data: null, error: { message: faux.refusDroits } } : { data: faux.droits, error: null }
        }
        if (nom === 'couverture_du_releve') return { data: [], error: null }
        if (nom === 'etat_facture_electronique') {
          return faux.refusEtat ? { data: null, error: { message: faux.refusEtat } } : { data: faux.etat, error: null }
        }
        return { data: null, error: { message: `fonction inattendue : ${nom}` } }
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
        faux.tablesLues.push(table)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        const lire = async () => {
          await attendre()
          if (faux.refusees.has(table)) return { data: null, error: { message: 'permission denied' }, count: null }
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
            // Les lignes et l'historique de Super PDP se filtrent par le dossier de LEUR facture.
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          or: () => c,
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: async () => {
            const r = await lire()
            return { data: Array.isArray(r.data) ? r.data[0] ?? null : null, error: r.error }
          },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => lire().then(suite, echec),
        })
        return c
      },
    },
  }
})

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'd1', prenom: null, mesSocietes: [], droitsParDossier: faux.droitsParDossier }),
}))
// Le dépôt de l'accueil n'est pas atteint ici.
vi.mock('../lib/depot', () => ({ deposerFichier: async () => { throw new Error('dépôt non attendu') } }))

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
const HOTE = 'flux.plateforme-fictive.fr'
const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }

// Des prestations de services à une entreprise, sans option pour les débits, émises après le 01/09/2027 : le statut
// « Encaissée » est DÛ.
const facture = (id: string, numero: string, o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  id, numero, date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const transmission = (id: string, factureId: string): TransmissionFacture => ({
  id, dossier_id: 'd1', facture_id: factureId, canal: 'plateforme', hote: HOTE, flux_id: `flux-${id}`, sha256: 'e'.repeat(64),
  etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z',
})
const encaissement = (id: string, factureId: string, montant: number, date: string): EncaissementFacture => ({
  id, dossier_id: 'd1', facture_id: factureId, date_encaissement: date, montant, moyen: 'virement', ligne_bancaire_id: null,
  annule_id: null, motif: null, cree_par: null, cree_le: `${date}T09:00:00Z`, retire_le: null, retire_par: null,
  compte_contrepartie: null,
})
const part = (encaissementId: string, montant: number): EncaissementFactureTaux => ({
  encaissement_id: encaissementId, dossier_id: 'd1', taux: 20, montant,
})
const declaration = (id: string, encaissementId: string, factureId: string): TransmissionEncaissement => ({
  id, dossier_id: 'd1', encaissement_id: encaissementId, facture_id: factureId, canal: 'manuel', hote: HOTE, flux_id: null,
  sha256: null, etat: 'depose', detail: null, note: null, cree_par: null, cree_le: '2027-10-28T09:00:00Z',
  maj_le: '2027-10-28T09:00:00Z',
})

const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))

function poser() {
  // f1 : rien d'encaissé. f2 : encaissée en partie, à déclarer depuis début octobre. f3 : encaissée, à déclarer depuis
  // mi-novembre, pas encore en retard. f4 : encaissée et déclarée. b1 : un brouillon. Une facture d'un AUTRE dossier, qui ne compte pas.
  const factures = [
    facture('f1', 'F2027-0001'), facture('f2', 'F2027-0002'), facture('f3', 'F2027-0003'), facture('f4', 'F2027-0004'),
    facture('b1', 'F2027-0005', { numero: null, statut: 'brouillon', validated_at: null }),
    facture('x1', 'F2027-0099', { dossier_id: 'd2' }),
  ]
  faux.tables = {
    factures_emises: nues(factures),
    facture_lignes: factures.map((f, i) => ({ ...LIGNE, id: `l${i}`, facture_id: f.id })),
    transmissions_factures: nues([transmission('t2', 'f2'), transmission('t3', 'f3'), transmission('t4', 'f4')]),
    facture_superpdp_events: [],
    encaissements_factures: nues([
      encaissement('e2', 'f2', 600, '2027-10-05'), encaissement('e3', 'f3', 1200, '2027-11-15'),
      encaissement('e4', 'f4', 1200, '2027-10-20'),
    ]),
    encaissements_factures_taux: nues([part('e2', 600), part('e3', 1200), part('e4', 1200)]),
    transmissions_encaissements: nues([declaration('te4', 'e4', 'f4')]),
    statuts_factures_recus: [],
    dossiers: [{ id: 'd1', nom: 'Atelier fictif', statut_tva: 'redevable', contact_nom: null }],
    // Ce que l'accueil lit en plus.
    pieces: [], documents_divers: [], cotisations_declarees: [], exercices_clotures: [],
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-20T10:00:00Z'))
  poser()
  faux.muetApres = {}
  faux.refusees = new Set()
  faux.droits = { cabinet: false, membre: true, ventes: true, banque: false }
  faux.refusDroits = null
  faux.rpcs = []
  faux.tablesLues = []
  faux.etat = ETAT_FICTIF
  faux.refusEtat = null
  faux.retenir = false
  faux.enAttente = []
  faux.droitsParDossier = { d1: { ventes: true, banque: false } }
})
afterEach(() => {
  vi.useRealTimers()
})

// Les tuiles ne lisent plus : l'accueil lit les ventes une fois (`useVentesDuClient`) et les leur passe, comme à l'encart.
function TuilesLues() {
  return <TuilesVentesClient dossierId="d1" ventes={useVentesDuClient('d1')} />
}

function monterTuiles() {
  return render(
    <MemoryRouter initialEntries={['/accueil']}>
      <Routes>
        <Route path="/accueil" element={<div className="bento"><TuilesLues /></div>} />
        <Route path="/mes-ventes" element={<p>Écran des ventes</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const valeurDe = (libelle: string) => {
  const tuile = screen.getByText(libelle).closest('.kpi') as HTMLElement
  return {
    valeur: Number(tuile.querySelector('.kpi-valeur')?.textContent),
    detail: tuile.querySelector('.kpi-detail')?.textContent ?? '',
    tuile,
  }
}

// ── 1 et 2. Le droit, et les lectures ────────────────────────────────────────────────────────────────────────────────
describe('les tuiles des ventes, avant d’être lues et sans le droit', () => {
  it('pas encore revenues : deux squelettes, aucun chiffre', async () => {
    faux.retenir = true
    monterTuiles()
    await act(async () => {})
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(2)
    expect(screen.queryByText('À encaisser')).toBeNull()
    expect(screen.queryByText('À déclarer')).toBeNull()
  })

  it('sans la case « Ventes » relue à la base : rien, ni tuile ni squelette', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: true }
    const { container } = monterTuiles()
    await act(async () => {})
    await act(async () => {})
    expect(faux.rpcs).toContain('droits_sur_le_dossier')
    expect(container.querySelector('.bento')?.childElementCount).toBe(0)
  })

  it('des droits illisibles : aucun chiffre, et le motif', async () => {
    faux.refusDroits = 'panne fictive'
    monterTuiles()
    await screen.findByText(/^Tes ventes n’ont pas pu être toutes lues \(tes droits n’ont pas pu être vérifiés \(panne fictive\)\)/)
    expect(screen.queryByText('À encaisser')).toBeNull()
  })

  it.each([
    ['les encaissements', 'encaissements_factures'],
    ['les déclarations', 'transmissions_encaissements'],
    ['les factures', 'factures_emises'],
    ['les transmissions', 'transmissions_factures'],
  ])('%s lus en partie : aucun chiffre — un « 0 » serait faux —, une phrase, et le lien vers « Mes ventes »', async (_nom, table) => {
    faux.muetApres = { [table]: 1 }
    // Une ligne de plus que le rang muet, pour que la lecture soit partielle même là où le jeu n'en a qu'une.
    faux.tables[table] = [...faux.tables[table], ...faux.tables[table].map((l) => ({ ...l, id: `${String(l.id)}-bis` }))]
    monterTuiles()
    await screen.findByText(/^Tes ventes n’ont pas pu être toutes lues/)
    expect(screen.queryByText('À encaisser')).toBeNull()
    expect(screen.queryByText('À déclarer')).toBeNull()
    expect(screen.getByRole('link', { name: 'Mes ventes' }).getAttribute('href')).toBe('/mes-ventes')
  })

  it('la société illisible : aucun chiffre — le statut de TVA décide de ce qui se déclare', async () => {
    faux.refusees = new Set(['dossiers'])
    monterTuiles()
    await screen.findByText(/^Tes ventes n’ont pas pu être toutes lues \(permission denied\)/)
    expect(screen.queryByText('À déclarer')).toBeNull()
  })
})

// ── 3. Les nombres, égaux aux pastilles de l'onglet ──────────────────────────────────────────────────────────────────
// Les pastilles de l'onglet Factures monté pour le client sur le même jeu : celles qui disent un reste à encaisser, et
// celles qui disent une déclaration due.
async function pastillesDeLOnglet() {
  render(
    <MemoryRouter>
      <FacturesTab
        espace="client" banque={false} dossierId="d1" dossierNom="Atelier fictif" dossierSiret={SIRET_VENDEUR}
        dossierAdresse={null} statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false} tvaSurDebits={false}
      />
    </MemoryRouter>,
  )
  await screen.findByText('F2027-0001')
  const badges = [...document.querySelectorAll('.badge')].map((b) => b.textContent ?? '')
  return {
    aEncaisser: badges.filter((t) => t === 'À encaisser' || t.startsWith('Encaissée en partie')).length,
    enPartie: badges.filter((t) => t.startsWith('Encaissée en partie')).length,
    aDeclarer: badges.filter((t) => t === 'À déclarer' || t === 'Déclaration en retard').length,
    enRetard: badges.filter((t) => t === 'Déclaration en retard').length,
  }
}

describe('les tuiles des ventes, lues en entier', () => {
  it('les nombres sont ceux des pastilles de l’onglet, sur le même jeu', async () => {
    const onglet = await pastillesDeLOnglet()
    // Le jeu porte de chaque sorte : sans quoi l'égalité pourrait tenir à zéro.
    expect(onglet).toEqual({ aEncaisser: 2, enPartie: 1, aDeclarer: 2, enRetard: 1 })
    document.body.innerHTML = ''
    monterTuiles()
    await screen.findByText('À encaisser')
    const encaisser = valeurDe('À encaisser')
    const declarer = valeurDe('À déclarer')
    expect(encaisser.valeur).toBe(onglet.aEncaisser)
    expect(declarer.valeur).toBe(onglet.aDeclarer)
    expect(encaisser.detail).toBe(`factures en attente de paiement, dont ${onglet.enPartie} en partie`)
    expect(declarer.detail).toBe(`factures dont l’encaissement est à déclarer, dont ${onglet.enRetard} en retard`)
    expect(declarer.tuile.className).toContain('kpi-danger')
  })

  it('rien à encaisser ni à déclarer : « 0 », dit d’une liste lue en entier', async () => {
    faux.tables.factures_emises = faux.tables.factures_emises.filter((f) => f.id === 'f4' || f.id === 'b1')
    monterTuiles()
    await screen.findByText('À encaisser')
    expect(valeurDe('À encaisser')).toMatchObject({ valeur: 0, detail: 'aucune facture en attente de paiement' })
    expect(valeurDe('À déclarer')).toMatchObject({ valeur: 0, detail: 'aucun encaissement à déclarer' })
  })

  it.each(['À encaisser', 'À déclarer'])('« %s » mène à « Mes ventes »', async (libelle) => {
    monterTuiles()
    await screen.findByText(libelle)
    fireEvent.click(valeurDe(libelle).tuile)
    await screen.findByText('Écran des ventes')
  })
})

// ── 4. L'accueil ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('l’accueil ne monte les tuiles qu’avec « Mes ventes » ouvert', () => {
  const monterAccueil = () => render(<MemoryRouter><ClientHome /></MemoryRouter>)

  it('la case « Ventes » sur la société affichée : les deux tuiles', async () => {
    monterAccueil()
    await screen.findByText('À encaisser')
    screen.getByText('À déclarer')
    expect(faux.rpcs).toContain('droits_sur_le_dossier')
  })

  it('sans elle : ni tuile, ni lecture des droits ni des ventes', async () => {
    faux.droitsParDossier = { d1: { ventes: false, banque: true } }
    monterAccueil()
    await screen.findByText(/^Cotisations /)
    await act(async () => {})
    expect(screen.queryByText('À encaisser')).toBeNull()
    expect(faux.rpcs).not.toContain('droits_sur_le_dossier')
  })
})

// ── 5. L'encart « Facture électronique » de l'accueil (étape A6b2) ───────────────────────────────────────────────────────
// Les tuiles et l'encart disent des nombres des MÊMES listes : une seule lecture des ventes, que le faux client COMPTE.
describe('l’accueil monte l’encart « Facture électronique » avec les tuiles, d’après une seule lecture des ventes', () => {
  const monterAccueil = () => render(<MemoryRouter><ClientHome /></MemoryRouter>)
  const encart = () => document.querySelector('section.encart-fe') as HTMLElement | null
  const attendre = async () => { await screen.findByText('À encaisser'); await screen.findByText('Active') }
  const refus = (id: string, factureId: string, code: string) => ({
    ...statutLuFictif({ id, facture_id: factureId, code: code as '210' }), dossier_id: 'd1', lu_par: null,
  })

  it('UNE lecture : chaque table des ventes est demandée une fois, les cases une fois, l’état une fois', async () => {
    monterAccueil()
    await attendre()
    for (const table of ['factures_emises', 'transmissions_factures', 'facture_lignes', 'encaissements_factures',
      'encaissements_factures_taux', 'transmissions_encaissements', 'facture_superpdp_events', 'statuts_factures_recus']) {
      expect(faux.tablesLues.filter((t) => t === table), table).toHaveLength(1)
    }
    expect(faux.rpcs.filter((r) => r === 'droits_sur_le_dossier')).toHaveLength(1)
    expect(faux.rpcs.filter((r) => r === 'etat_facture_electronique')).toHaveLength(1)
  })

  it('l’encart dit les mêmes nombres que les tuiles : les encaissements à déclarer, dont ceux en retard', async () => {
    monterAccueil()
    await attendre()
    const declarer = valeurDe('À déclarer')
    expect(declarer.valeur).toBe(2)
    expect(encart()?.textContent).toContain(`${declarer.valeur} factures dont l’encaissement est à déclarer, dont 1 en retard.`)
    expect(encart()?.textContent).toContain('Aucune facture refusée ou rejetée parmi les statuts relevés sur ta plateforme.')
  })

  it('une facture refusée sur sa plateforme se compte, d’après les statuts lus', async () => {
    faux.tables.statuts_factures_recus = [refus('s1', 'f1', '210'), refus('s2', 'f1', '213')]
    monterAccueil()
    await attendre()
    expect(encart()?.textContent).toContain('1 facture refusée ou rejetée sur ta plateforme.')
  })

  it.each([
    ['les encaissements', 'encaissements_factures'],
    ['les statuts lus', 'statuts_factures_recus'],
    ['les factures', 'factures_emises'],
  ])('%s lus en partie : l’encart ne compte rien et le dit ; son état, lui, se dit', async (_nom, table) => {
    faux.tables[table] = [...faux.tables[table], ...faux.tables[table].map((l) => ({ ...l, id: `${String(l.id)}-bis` }))]
    if (table === 'statuts_factures_recus') faux.tables[table] = [refus('s1', 'f1', '210'), refus('s2', 'f2', '210')]
    faux.muetApres = { [table]: 1 }
    monterAccueil()
    await screen.findByText('Active')
    await screen.findByText('Ce qui t’attend ne se compte pas ici : tes ventes n’ont pas pu être toutes lues.')
    expect(encart()?.textContent).not.toMatch(/à déclarer, dont|refusée ou rejetée sur ta plateforme|Aucun encaissement/)
  })

  it('les cases illisibles : l’encart lit son état, et dit que ce qui attend ne se compte pas', async () => {
    faux.refusDroits = 'panne fictive'
    monterAccueil()
    await screen.findByText('Active')
    await screen.findByText('Ce qui t’attend ne se compte pas ici : tes ventes n’ont pas pu être toutes lues.')
  })

  it('pas encore revenues : un squelette pour l’encart, aucun état, et l’état n’est pas encore demandé', async () => {
    faux.retenir = true
    // L'accueil entier attend ses propres lectures avant de monter la grille : ce que l'encart montre se joue sur son composant.
    render(<MemoryRouter><div className="bento"><AccueilVentesClient dossierId="d1" /></div></MemoryRouter>)
    await act(async () => {})
    expect(document.querySelector('[aria-label="Chargement de ta facture électronique"]')?.getAttribute('aria-busy')).toBe('true')
    expect(encart()).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
    expect(faux.rpcs).not.toContain('etat_facture_electronique')
  })

  it('sans la case « Ventes » relue à la base : ni encart ni squelette, et l’état n’est jamais demandé', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: false, banque: true }
    monterAccueil()
    await screen.findByText(/^Cotisations /)
    await act(async () => {})
    await act(async () => {})
    expect(faux.rpcs).toContain('droits_sur_le_dossier')
    expect(encart()).toBeNull()
    expect(document.querySelector('[aria-label="Chargement de ta facture électronique"]')).toBeNull()
    expect(faux.rpcs).not.toContain('etat_facture_electronique')
  })

  it('sans la case sur la société affichée : ni encart, ni lecture des droits, des ventes ou de l’état', async () => {
    faux.droitsParDossier = { d1: { ventes: false, banque: true } }
    monterAccueil()
    await screen.findByText(/^Cotisations /)
    await act(async () => {})
    expect(encart()).toBeNull()
    expect(faux.rpcs).not.toContain('etat_facture_electronique')
    expect(faux.tablesLues).not.toContain('factures_emises')
  })

  it('un état illisible : l’encart le dit, sans « active » ni « à compléter » ; les tuiles, elles, se comptent', async () => {
    faux.etat = { ...ETAT_FICTIF, portee: 'x' }
    monterAccueil()
    await screen.findByText('Lecture impossible')
    expect(encart()?.textContent).not.toMatch(/Active|À compléter/)
    expect(valeurDe('À déclarer').valeur).toBe(2)
  })

  it('un état refusé : son motif, et les tuiles se comptent', async () => {
    faux.refusEtat = 'permission denied'
    monterAccueil()
    await screen.findByText('Lecture impossible')
    expect(encart()?.textContent).toContain('L’état de ta facture électronique n’a pas pu être lu (permission denied).')
    expect(valeurDe('À encaisser').valeur).toBe(2)
  })

  it('un dossier neuf : « À compléter », ce qui manque, aux mots du client', async () => {
    faux.etat = ETAT_NEUF
    monterAccueil()
    await screen.findByText('À compléter : 2 points')
    expect(motsDuCabinet(encart()?.textContent ?? '')).toEqual([])
    expect(encart()?.textContent).toContain('Tu n’as pas encore déclaré d’adresse de réception.')
  })

  it('une autre société repart du squelette : jamais les comptes ni l’état de la précédente', async () => {
    const vue = (id: string) => <MemoryRouter><div className="bento"><AccueilVentesClient key={id} dossierId={id} /></div></MemoryRouter>
    const { rerender } = render(vue('d1'))
    await attendre()
    faux.retenir = true
    rerender(vue('d2'))
    await act(async () => {})
    expect(encart()).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('À encaisser')).toBeNull()
    expect(document.querySelector('[aria-label="Chargement de ta facture électronique"]')).not.toBeNull()
  })
})
