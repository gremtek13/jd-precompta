import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { MENTIONS_VIDES } from '../../test/factures'
import type { FactureEmise } from '../../lib/types'

// LA SUPPRESSION D'UN BROUILLON, DANS LES DEUX ÉTATS DU DRAPEAU (espace client, étape P2). `supprimer_brouillon_facture`
// vit dans une migration que le cabinet a collée le 10/10/2026 (20261010130643) ; l'export la porte depuis, et
// `SUPPRESSION_BROUILLON_EXPORTEE` est levé dans lib/factures.ts (factures.test.ts confronte l'un à l'autre) : l'onglet
// supprime un brouillon par la fonction, le chemin du client. Ce fichier FORCE le drapeau, lu à chaque appel par un
// accesseur, pour jouer les deux chemins quel que soit son état : levé, celui d'aujourd'hui ; baissé, celui d'avant —
// la suppression directe sous la policy du cabinet —, qui reste éprouvé tant que son code existe, comme
// espaceClientAvantCouverture.test.tsx le fait pour l'étape P7. FacturesTab.test.tsx joue l'état réel.
vi.mock('../../lib/factures', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../lib/factures')>(),
  get SUPPRESSION_BROUILLON_EXPORTEE() { return faux.drapeau },
}))

const faux = vi.hoisted(() => ({
  // Le drapeau tel que l'onglet le lit, posé par chaque bloc.
  drapeau: true,
  factures: [] as FactureEmise[],
  // Les appels à la fonction, et les suppressions directes : une seule des deux voies part, selon le drapeau.
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  suppressionsDirectes: 0,
  // Le refus d'une suppression directe, tel que supabase-js le rend : `{ error }`, sans lever.
  refusDirect: null as string | null,
  // Le refus de la fonction, tel que supabase-js le rend : `{ error }`, sans lever.
  refusRpc: null as string | null,
  // La fonction qui rend AUTRE CHOSE que la facture demandée : l'écran ne doit pas dire « supprimé ».
  rendu: null as unknown,
  lecturesFactures: 0,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return { supabase: {
    // La connexion à la plateforme du client : aucune.
    functions: { invoke: () => Promise.resolve({ data: { connexion: null }, error: null }) },
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      if (nom !== 'supprimer_brouillon_facture') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
      if (faux.refusRpc) return Promise.resolve({ data: null, error: { message: faux.refusRpc, code: 'P0002' } })
      const id = args.p_facture_id
      // La fonction MORD sur le faux : la relecture qui suit voit le brouillon parti.
      faux.factures = faux.factures.filter((f) => f.id !== id)
      return Promise.resolve({ data: faux.rendu ?? id, error: null })
    },
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      const predicats: Predicat[] = []
      let plage: [number, number] | null = null
      let suppression = false
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        range: (debut: number, fin: number) => { plage = [debut, fin]; return chaine },
        delete: () => { suppression = true; return chaine },
        eq: (colonne: string, valeur: unknown) => {
          // Les lignes, les événements de Super PDP : par leur facture, la table n'ayant pas de dossier.
          predicats.push(colonne === 'factures_emises.dossier_id' ? () => false : predicatEq(colonne, valeur))
          return chaine
        },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number | null }) => unknown) => {
          if (suppression) {
            // La suppression directe MORD sur le faux, sur les lignes que ses filtres désignent : la relecture qui suit
            // voit le brouillon parti — ou elle est refusée, et rien ne bouge.
            faux.suppressionsDirectes += 1
            if (faux.refusDirect) return Promise.resolve({ data: null, error: { message: faux.refusDirect }, count: null }).then(suite)
            if (table === 'factures_emises') {
              const visees = new Set(filtrer(faux.factures, predicats).map((f) => f.id))
              faux.factures = faux.factures.filter((f) => !visees.has(f.id))
            }
            return Promise.resolve({ data: null, error: null, count: null }).then(suite)
          }
          // Les autres tables de l'onglet sont vides : ce test ne regarde que la suppression d'un brouillon.
          const lignes = table === 'factures_emises' ? filtrer(faux.factures, predicats) : []
          if (table === 'factures_emises') faux.lecturesFactures += 1
          const tranche = plage ? lignes.slice(plage[0], plage[1] + 1) : lignes
          return Promise.resolve({ data: tranche, error: null, count: lignes.length }).then(suite)
        },
      })
      return chaine
    },
  } }
})

// Typé sans `as` : le compilateur confronte chaque champ à la table.
function brouillon(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'b1', dossier_id: 'dossier-de-test', numero: null, statut: 'brouillon', type: 'facture',
    facture_origine_id: null, date_emission: '2026-03-10', date_echeance: null,
    tiers_nom: 'CABINET VOISIN', tiers_adresse: null, tiers_siret: null,
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, mentions_legales: null, notes: null,
    emetteur_nom: 'Cabinet de test', emetteur_siret: '12345678901234', emetteur_adresse: null,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: null, created_at: '2026-03-10T09:00:00Z', validated_at: null, ...MENTIONS_VIDES, ...o,
  }
}

function monter() {
  return render(
    <FacturesTab
      dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234"
      dossierAdresse={null} statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false}
      tvaSurDebits={false} onAdresseUpdated={() => {}}
    />,
  )
}

async function boutonSupprimer() {
  const ligne = (await screen.findByText('CABINET VOISIN')).closest('tr') as HTMLElement
  return within(ligne).getByRole('button', { name: 'Supprimer' })
}

beforeEach(() => {
  faux.drapeau = true
  faux.factures = [brouillon()]
  faux.rpcs = []
  faux.suppressionsDirectes = 0
  faux.refusDirect = null
  faux.refusRpc = null
  faux.rendu = null
  faux.lecturesFactures = 0
})

afterEach(() => { vi.restoreAllMocks() })

describe('FacturesTab — la suppression d’un brouillon par la base, drapeau levé (l’état depuis le 10/10/2026)', () => {
  it('confirme, supprime par la fonction — le dossier annoncé, puis la facture —, jamais directement, et relit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    expect(faux.rpcs).toEqual([{ nom: 'supprimer_brouillon_facture', args: { p_dossier_id: 'dossier-de-test', p_facture_id: 'b1' } }])
    expect(faux.suppressionsDirectes).toBe(0)
    await screen.findByText('Aucune facture.')
  })

  it('dit le refus de la base, sous ses mots, et la ligne reste', async () => {
    faux.refusRpc = 'Facture introuvable dans ce dossier.'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    await screen.findByText(/Facture introuvable dans ce dossier\./)
    expect(screen.getByText('CABINET VOISIN')).toBeTruthy()
    expect(faux.suppressionsDirectes).toBe(0)
  })

  it('une réponse qui ne rend pas la facture demandée se dit, au lieu de passer pour une suppression', async () => {
    faux.rendu = 'autre'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    await screen.findByText(/La suppression du brouillon n'a pas rendu la facture supprimée\./)
  })

  it('annulée, rien ne part', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    expect(faux.rpcs).toEqual([])
    expect(faux.suppressionsDirectes).toBe(0)
  })

  // Deux clics dans le même `act` : le second trouve le verrou posé. Il en faut TROIS pour voir un verrou posé DANS le
  // `try` plutôt qu'avant (CLAUDE.md) ; et le verrou se relâche après la relecture : un clic suivant repart.
  it('deux ou trois clics du même rendu ne suppriment qu’une fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.rpcs).toHaveLength(1)
    await screen.findByText('Aucune facture.')
  })
})

// Drapeau baissé : l'état d'avant la migration, celui que rétablirait un retour arrière (le drapeau baissé avec la
// fonction retirée). Le brouillon part directement, sous la policy du cabinet, et la fonction n'est jamais appelée.
describe('FacturesTab — la suppression directe d’un brouillon, drapeau baissé (l’état d’avant, tant que son code existe)', () => {
  beforeEach(() => { faux.drapeau = false })

  it('confirme, supprime directement — jamais par la fonction —, et relit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    expect(faux.suppressionsDirectes).toBe(1)
    expect(faux.rpcs).toEqual([])
    await screen.findByText('Aucune facture.')
  })

  it('dit le refus de la base, et la ligne reste', async () => {
    faux.refusDirect = 'permission denied for table factures_emises'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click() })

    await screen.findByText(/permission denied for table factures_emises/)
    expect(screen.getByText('CABINET VOISIN')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
  })

  it('deux ou trois clics du même rendu ne suppriment qu’une fois', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    const bouton = await boutonSupprimer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.suppressionsDirectes).toBe(1)
    expect(faux.rpcs).toEqual([])
    await screen.findByText('Aucune facture.')
  })
})
