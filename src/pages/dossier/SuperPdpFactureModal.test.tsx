import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SuperPdpFactureModal from './SuperPdpFactureModal'
import type { FactureEmise } from '../../lib/types'

// Le dernier des quatre verrous corrigés le 20/09/2026 à n'avoir aucun test d'écran, et celui dont
// le doublon sort de l'application : il TRANSMET deux fois la même facture à une plateforme de
// dématérialisation agréée DGFiP. Une facture transmise ne s'annule pas par cette voie — seul un
// avoir la corrige — donc le doublon ne se rattrape pas d'un clic, contrairement à une ligne en
// base qu'un cabinet voit et supprime.
//
// ET CE TEST A TROUVÉ UN SECOND DÉFAUT, celui qu'il fallait écrire pour voir : le relâchement du
// verrou vivait en clair après l'`await`, sans `try`. Toute exception inattendue laissait donc le
// verrou PRIS et `enCours` à true — bouton grisé, aucun message, aucun moyen de réessayer. Les trois
// autres verrous du projet portaient déjà un `finally` ; celui-ci était le seul sans.
const faux = vi.hoisted(() => ({
  appels: [] as { nom: string; body: unknown }[],
  // La promesse du premier appel reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un clic
  // surnuméraire arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudre: null as null | ((v: unknown) => void),
  rejeter: null as null | ((e: unknown) => void),
  // La relecture des événements APRÈS une transmission réussie peut, elle aussi, rester en attente :
  // c'est la seconde fenêtre que le verrou doit couvrir (voir le cas dédié plus bas).
  appelsCharger: 0,
  suspendreRelecture: false,
  resoudreCharger: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'facture_superpdp_events') {
        return {
          select: () => ({
            eq: () => ({
              order: () => {
                faux.appelsCharger += 1
                if (faux.appelsCharger > 1 && faux.suspendreRelecture) {
                  return new Promise((resolve) => { faux.resoudreCharger = resolve })
                }
                return Promise.resolve({ data: [] })
              },
            }),
          }),
        }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    functions: {
      invoke: (nom: string, options: { body: unknown }) => {
        faux.appels.push({ nom, body: options.body })
        return new Promise((resolve, reject) => { faux.resoudre = resolve; faux.rejeter = reject })
      },
    },
  },
}))

const facture: FactureEmise = {
  id: 'f1',
  dossier_id: 'd1',
  numero: 'F-2026-0001',
  statut: 'validee',
  type: 'facture',
  facture_origine_id: null,
  date_emission: '2026-09-01',
  date_echeance: null,
  tiers_nom: 'Client Test',
  tiers_adresse: null,
  tiers_siret: null,
  montant_ht: 100,
  montant_tva: 20,
  montant_ttc: 120,
  mentions_legales: null,
  notes: null,
  emetteur_nom: 'Cabinet Test',
  emetteur_siret: null,
  emetteur_adresse: null,
  superpdp_invoice_id: null,
  superpdp_dernier_statut: null,
  tiers_email: null,
  created_by: null,
  created_at: '2026-09-01T00:00:00Z',
  validated_at: '2026-09-01T00:00:00Z',
}

async function monter() {
  faux.appels = []
  faux.resoudre = null
  faux.rejeter = null
  faux.appelsCharger = 0
  faux.suspendreRelecture = false
  faux.resoudreCharger = null
  render(
    <SuperPdpFactureModal dossierId="d1" facture={facture} onClose={() => {}} onUpdated={() => {}} />,
  )
  // Les événements se chargent en `useEffect` : on attend le rendu stable avant de cliquer, sinon le
  // test mesurerait un écran encore en chargement.
  await screen.findByText('Jamais transmise')
  return screen.getByRole('button', { name: /Envoyer/ })
}

describe('SuperPdpFactureModal — le verrou de transmission', () => {
  it("ne transmet qu'une fois quand on clique deux fois de suite", async () => {
    const bouton = await monter()

    // LES DEUX CLICS DANS LE MÊME `act` : deux `.click()` successifs ouvrent chacun leur `act`, qui
    // rend le composant en sortant — le second tomberait sur un bouton déjà re-rendu avec `enCours`
    // à jour, et le test resterait VERT avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0]).toEqual({ nom: 'superpdp-emit', body: { dossierId: 'd1', factureId: 'f1', action: 'envoyer' } })
  })

  // IL FAUT TROIS CLICS pour distinguer un verrou posé AVANT le `try` d'un verrou posé dedans : si
  // la pose vivait dans le `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait
  // le verrou du PREMIER — encore en cours — et le troisième repartirait pour une seconde
  // transmission. Avec deux clics la version fautive paraît correcte.
  it("un troisième clic ne déclenche pas de seconde transmission", async () => {
    const bouton = await monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toHaveLength(1)
  })

  // LE VERROU DOIT TENIR JUSQU'APRÈS LA RELECTURE, pas seulement jusqu'à la réponse de `invoke` —
  // cas repris de la Routine du 23/09/2026 (commit ac8ce91 sur `main`), qui l'avait écrit
  // indépendamment. L'ancien code relâchait le verrou juste après ce premier `await`, AVANT de
  // relire les événements : un clic pendant la relecture qui suit un envoi réussi transmettait alors
  // une seconde fois la même facture. Aucun des autres cas ne sépare ces deux placements.
  it('reste verrouillé pendant la relecture qui suit une transmission réussie', async () => {
    const bouton = await monter()
    faux.suspendreRelecture = true
    await act(async () => { bouton.click() })
    expect(faux.appels).toHaveLength(1)

    await act(async () => { faux.resoudre?.({ data: { ok: true }, error: null }) })
    expect(faux.appelsCharger).toBe(2)

    await act(async () => { screen.getByRole('button', { name: /Envoi…/ }).click() })
    expect(faux.appels).toHaveLength(1)

    await act(async () => { faux.resoudreCharger?.({ data: [] }) })
  })

  it('relâche le verrou sur une erreur rendue par la fonction, pour laisser réessayer', async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudre?.({ data: { error: 'SIRET vendeur non conforme' }, error: null }) })

    expect(screen.getByText(/SIRET vendeur non conforme/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /Envoyer/ }).click() })
    expect(faux.appels).toHaveLength(2)
  })

  // LE DÉFAUT QUE CE TEST A TROUVÉ, et le seul des quatre cas qui échouait avant correction. Une
  // exception — et non une erreur RENDUE — sortait de `appeler` sans relâcher quoi que ce soit :
  // verrou pris, `enCours` à true, bouton grisé, aucun message. L'utilisateur ne pouvait ni savoir
  // si la facture était partie, ni réessayer sans rouvrir la modale. C'est le pire état possible
  // pour une action irréversible qui sort de l'application.
  it('relâche le verrou sur une exception inattendue, et dit pourquoi', async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    await act(async () => { faux.rejeter?.(new Error('Réseau injoignable')) })

    expect(screen.getByText(/Réseau injoignable/)).toBeTruthy()
    const relance = screen.getByRole('button', { name: /Envoyer/ }) as HTMLButtonElement
    expect(relance.disabled).toBe(false)
    await act(async () => { relance.click() })
    expect(faux.appels).toHaveLength(2)
  })
})
