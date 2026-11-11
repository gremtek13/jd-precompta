import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientSimulation from './ClientSimulation'

// « MA SIMULATION » QUAND LE DOSSIER TIENT PLUSIEURS COMPTES BANCAIRES (ligne 26.6, MCB7), sous les deux états de
// `COMPTES_BANCAIRES_PREVUS` joués par un accesseur. La simulation lit les mouvements RAPPROCHÉS du dossier, tous comptes
// confondus, et n'en compte que ce que l'Estimation du cabinet compte : un mouvement affecté à une catégorie, une échéance
// d'emprunt, une part ventilée, le paiement d'une pièce ou d'une cotisation. Un virement entre deux comptes du praticien
// s'écrit au compte des virements internes (580000, MCB3) des deux côtés, par `ecrire_mouvement_compte_bilan`, sans
// catégorie : il ne compte jamais, ni une fois ni deux. Le drapeau ne change rien à la simulation (elle ne lit pas les
// comptes) : ce fichier garde que deux comptes s'additionnent, et que la paire du virement reste hors du calcul. Données
// FICTIVES.
vi.mock('../lib/couvertureReleve', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/couvertureReleve')>(),
  COUVERTURE_EXPORTEE: true,
}))

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  demandees: [] as string[],
  drapeau: false,
}))

vi.mock('../lib/comptesBancaires', async (original) => {
  const reel = await original<typeof import('../lib/comptesBancaires')>()
  return { ...reel, get COMPTES_BANCAIRES_PREVUS() { return faux.drapeau } }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => { faux.demandees.push(table); return Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }) },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          faux.demandees.push(table)
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length }).then(suite)
        },
      })
      return chaine
    },
    rpc: (nom: string) => {
      // Un dossier qui n'a pas basculé : aucune vente facturée à compter ; la case « Banque » confirmée par la base.
      const donnees = nom === 'ventes_facturees_de_la_simulation'
        ? { data: { par_mois: {}, sources: [] }, error: null }
        : { data: { cabinet: false, membre: true, ventes: false, banque: true }, error: null }
      return { then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) =>
        Promise.resolve({ ...donnees, count: null, status: 200, statusText: '' }).then(suite, echec) }
    },
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: 'dossier-de-test', droitsParDossier: { 'dossier-de-test': { ventes: false, banque: true } } }),
}))

const BLANCS_INSECABLES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')

// Un mouvement rapproché, tel que la base le rend (les colonnes que les moteurs lisent).
const mouvement = (o: Record<string, unknown>) => ({
  dossier_id: 'dossier-de-test', libelle: 'MOUVEMENT FICTIF', statut: 'rapprochee', piece_id: null, cotisation_id: null,
  categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  prelevement_personnel: false, encaissements_de_factures: false, taux_tva: null, source_fichier: null,
  created_at: '2026-03-03T08:00:00Z', ...o,
})

function poser(avecLeVirement: boolean) {
  faux.parTable = {
    dossiers: [{ assujetti_tva: false, mode_comptable: 'tresorerie', ventes_par_les_factures: false }],
    pieces: [],
    cotisations_declarees: [],
    references_annuelles: [],
    references_postes_annuels: [],
    lignes_bancaires: [
      // Une recette sur chaque compte, affectée à la catégorie des honoraires.
      mouvement({ id: 'p1', date: '2026-02-10', montant: 1000, categorie_id: 'cat-honoraires', compte_bancaire_id: 'P' }),
      mouvement({ id: 'b1', date: '2026-03-05', montant: 300, categorie_id: 'cat-honoraires', compte_bancaire_id: 'B' }),
      // Le virement du principal vers le livret, ses deux moitiés au 580 (MCB3).
      ...(avecLeVirement ? [
        mouvement({ id: 'p2', date: '2026-03-01', montant: -500, compte_bilan: '580000', compte_bancaire_id: 'P' }),
        mouvement({ id: 'b2', date: '2026-03-02', montant: 500, compte_bilan: '580000', compte_bancaire_id: 'B' }),
      ] : []),
    ],
    categories: [
      { id: 'cat-honoraires', dossier_id: null, code: 'HON', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'recettes' },
    ],
    ventilations_bancaires: [],
    reglements_groupes: [],
  }
  faux.demandees = []
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-03-20T10:00:00Z')) })
afterEach(() => { vi.useRealTimers() })

async function caEncaisse(): Promise<string> {
  render(<ClientSimulation />)
  const libelle = await screen.findByText('CA encaissé à date')
  await act(async () => {})
  return (libelle.parentElement?.querySelector('strong')?.textContent ?? '').replace(BLANCS_INSECABLES, ' ')
}

describe.each([false, true])('« Ma simulation », deux comptes bancaires — drapeau levé : %s', (drapeau) => {
  beforeEach(() => { faux.drapeau = drapeau })

  it('les recettes des deux comptes s’additionnent', async () => {
    poser(false)
    expect(await caEncaisse()).toBe('1 300,00 €')
  })

  it('le virement entre les deux comptes, au 580 des deux côtés, ne compte ni une fois ni deux', async () => {
    poser(true)
    expect(await caEncaisse()).toBe('1 300,00 €')
    // La simulation ne lit pas les comptes : rien de plus n'est demandé, quel que soit le drapeau.
    expect(faux.demandees).not.toContain('comptes_bancaires')
  })
})
