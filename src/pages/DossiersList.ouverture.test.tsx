import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anneeEtMoisEcoules } from '../lib/format'
import DossiersList from './DossiersList'

// LE TABLEAU DE BORD D'UN MEMBRE DE L'ÉQUIPE NE MONTRE QUE LES DOSSIERS QUE LE CABINET LUI OUVRE (23Q2Q2Q1-Q1, voir
// lib/dossiersOuverts.ts). La base lui rend aussi ceux dont il est client (`dossiers_select`), et leurs pièces : leur ligne, leurs
// pièces à valider et leurs dépôts récents n'ont rien à faire sur l'écran du cabinet. Le faux client APPLIQUE le filtre des accès
// sur le compte connecté — un chef lit aussi ceux des clients de ses dossiers — et dit ce qu'`admin_du_dossier` répond, dossier
// par dossier. Ce qui n'a pas pu être vérifié se dit, et aucun chiffre ne s'affiche : comme d'une liste lue en partie.
// Données FICTIVES.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  erreurs: {} as Record<string, string>,
  ouvertures: {} as Record<string, boolean | { erreur: string }>,
  ouverturesDemandees: [] as string[],
}))

vi.mock('../lib/listeDossiers', () => ({ signalerMajDossiers: () => {} }))
// Le compte connecté ; sans session — l'application ne monte alors aucun écran (App.tsx) —, la liste tombe du côté fermé.
const compte = vi.hoisted(() => ({ session: { user: { id: 'u-equipe' } } as { user: { id: string } } | null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: compte.session }) }))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, args: { p_dossier_id?: string }) => {
        if (nom !== 'admin_du_dossier') return Promise.resolve({ data: { dossiers: [] }, error: null })
        const id = args.p_dossier_id ?? ''
        faux.ouverturesDemandees.push(id)
        const reponse = faux.ouvertures[id]
        if (reponse === undefined) throw new Error(`Faux client : l’ouverture de ${id} n’est pas prévue.`)
        return Promise.resolve(typeof reponse === 'object'
          ? { data: null, error: { message: reponse.erreur } }
          : { data: reponse, error: null })
      },
      from: (table: string) => {
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const chaine: Record<string, unknown> = {}
        Object.assign(chaine, {
          select: () => chaine,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
          // Les dates des jeux d'essai sont toutes dans les bornes : `gte` ne retire rien ici.
          gte: () => chaine,
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: unknown) => unknown) => {
            if (faux.erreurs[table]) {
              return Promise.resolve({ data: null, error: { message: faux.erreurs[table] }, count: null }).then(suite)
            }
            const lignes = filtrer(faux.parTable[table] ?? [], predicats)
            return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }).then(suite)
          },
        })
        return chaine
      },
    },
  }
})

const ANNEE = new Date().getFullYear()
const MOIS_ECOULES = anneeEtMoisEcoules().moisEcoules

function dossier(id: string, nom: string) {
  return {
    id, nom, cabinet_id: 'cabinet-de-test', siret: null, contact_nom: null, contact_email: null, archive: false,
    created_at: `${ANNEE}-01-02T00:00:00Z`, code_email: id, assujetti_tva: false, statut_tva: null, article_exoneration: null,
    code_naf: null, libelle_naf: null, adresse: null,
  }
}

// Un relevé par mois écoulé et une cotisation : aucun dossier n'est en alerte, les pièces à valider mises à part.
function aJour(dossierId: string) {
  return {
    releves: Array.from({ length: MOIS_ECOULES }, (_, i) => ({
      id: `${dossierId}-l${i}`, dossier_id: dossierId, date: `${ANNEE}-${String(i + 1).padStart(2, '0')}-05`,
    })),
    cotisation: { id: `${dossierId}-c`, dossier_id: dossierId, echeance: `${ANNEE}-02-05` },
  }
}

beforeEach(() => {
  const recent = new Date(Date.now() - 3600 * 1000).toISOString()
  faux.parTable = {
    dossiers: [dossier('alpha', 'Alpha Santé'), dossier('bravo', 'Bravo Cabinet'), dossier('charlie', 'Charlie Soins')],
    // Une pièce déjà validée chez Alpha, une à valider chez Bravo : elle seule ferait monter « Pièces à valider ».
    pieces: [
      { id: 'p1', dossier_id: 'alpha', nom_fichier: 'alpha-facture.pdf', created_at: recent, statut: 'validee' },
      { id: 'p2', dossier_id: 'bravo', nom_fichier: 'bravo-ordonnance.pdf', created_at: recent, statut: 'a_valider' },
    ],
    lignes_bancaires: ['alpha', 'bravo', 'charlie'].flatMap((d) => aJour(d).releves),
    cotisations_declarees: ['alpha', 'bravo', 'charlie'].map((d) => aJour(d).cotisation),
    // Le compte est client de Bravo ; un autre compte est client de Charlie — un chef lit aussi cet accès-là.
    memberships: [
      { id: 'm1', user_id: 'u-equipe', dossier_id: 'bravo' },
      { id: 'm2', user_id: 'u-client', dossier_id: 'charlie' },
    ],
  }
  faux.erreurs = {}
  faux.ouvertures = { bravo: false }
  faux.ouverturesDemandees = []
  compte.session = { user: { id: 'u-equipe' } }
})

async function afficher() {
  await act(async () => { render(<MemoryRouter><DossiersList /></MemoryRouter>) })
}

const nomsDeLaListe = () => [...document.querySelectorAll('.cellule-identite-nom')].map((n) => n.textContent)
const fichiersRecents = () => [...document.querySelectorAll('.feed-fichier')].map((n) => n.textContent)
function valeurTuile(libelle: string): string | null {
  const tuile = [...document.querySelectorAll('.kpi')].find((t) => t.querySelector('.kpi-libelle')?.textContent?.trim() === libelle)
  return tuile?.querySelector('.kpi-valeur')?.textContent?.trim() ?? null
}

describe('DossiersList — les dossiers que le cabinet ouvre au compte', () => {
  it('un dossier qu’il ne lit que par son accès client : ni sa ligne, ni ses chiffres, ni ses dépôts', async () => {
    await afficher()
    expect(nomsDeLaListe()).toEqual(['Alpha Santé', 'Charlie Soins'])
    expect(valeurTuile('Dossiers suivis')).toBe('2')
    expect(valeurTuile('Pièces à valider')).toBe('0')
    expect(fichiersRecents()).toEqual(['alpha-facture.pdf'])
    expect(screen.queryByText(/Bravo Cabinet/)).toBeNull()
    // L'ouverture ne se demande que pour le dossier où le compte lui-même a un accès client.
    expect(faux.ouverturesDemandees).toEqual(['bravo'])
  })

  it('dont il est client, et que le cabinet lui ouvre aussi : il compte comme les autres', async () => {
    faux.ouvertures = { bravo: true }
    await afficher()
    expect(nomsDeLaListe()).toEqual(['Bravo Cabinet', 'Alpha Santé', 'Charlie Soins'])
    expect(valeurTuile('Dossiers suivis')).toBe('3')
    expect(valeurTuile('Pièces à valider')).toBe('1')
    expect(fichiersRecents()).toEqual(['alpha-facture.pdf', 'bravo-ordonnance.pdf'])
  })

  it('une ouverture illisible : la panne se dit, et aucun chiffre ne s’affiche ; « Réessayer » relit', async () => {
    faux.ouvertures = { bravo: { erreur: 'canceling statement due to statement timeout' } }
    await afficher()
    expect(screen.getByText(/impossible de charger la liste des dossiers \(l’ouverture d’un dossier à ce compte n’a pas pu être vérifiée \(canceling statement due to statement timeout\) : il ne s’affiche pas\)/)).toBeTruthy()
    expect(valeurTuile('Dossiers suivis')).toBeNull()
    expect(nomsDeLaListe()).toEqual([])

    faux.ouvertures = { bravo: false }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })) })
    expect(nomsDeLaListe()).toEqual(['Alpha Santé', 'Charlie Soins'])
  })

  it('des accès illisibles : aucun dossier, et la panne se dit — jamais un cabinet sans dossier', async () => {
    faux.erreurs = { memberships: 'permission denied for table memberships' }
    await afficher()
    expect(screen.getByText(/impossible de charger la liste des dossiers \(les accès client de ce compte n’ont pas pu être lus en entier \(.*permission denied for table memberships\) : aucun dossier ne s’affiche/)).toBeTruthy()
    expect(valeurTuile('Dossiers suivis')).toBeNull()
    expect(nomsDeLaListe()).toEqual([])
    expect(faux.ouverturesDemandees).toEqual([])
  })

  it('sans compte connecté : aucun dossier, et la panne se dit', async () => {
    compte.session = null
    await afficher()
    expect(screen.getByText(/les accès client de ce compte n’ont pas pu être lus en entier \(aucun compte connecté\)/)).toBeTruthy()
    expect(nomsDeLaListe()).toEqual([])
  })
})
