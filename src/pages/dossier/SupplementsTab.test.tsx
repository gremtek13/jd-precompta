import { act, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SupplementsTab from './SupplementsTab'
import type { CompteCourantAssocie, MouvementCca } from '../../lib/cca'

// SUPPRIMER UN MOUVEMENT DE COMPTE COURANT EST UNE ACTION QUE L'UTILISATEUR VIENT DE CONFIRMER.
//
// `supprimer` jetait le résultat de sa suppression, alors que sa fonction JUMELLE `ajouter` —
// trente lignes plus haut, dans le même composant, avec le même état d'erreur déjà affiché —
// lisait le sien. Exactement le couple `DocumentsTab.supprimer` / `supprimerSelection`.
//
// Le `onChanged()` qui suit recharge, donc la ligne réapparaît : c'est un signal, mais MUET et
// ambigu. Le réflexe est de reconfirmer et d'obtenir le même silence — le défaut déjà payé sur
// `SuperPdpModal.retirer()`. Et le solde d'un compte courant est TOUJOURS recalculé depuis
// l'historique complet : une ligne qu'on croit retirée et qui reste est un solde que le cabinet
// croit faux.
//
// Aucun test de `src/lib` ne peut voir ça : `soldeCca` est juste, la lecture est juste, c'est
// l'écran qui se taisait.
const faux = vi.hoisted(() => ({
  comptes: [] as CompteCourantAssocie[],
  mouvements: [] as MouvementCca[],
  erreurSuppression: null as { message: string } | null,
  suppressions: 0,
  rechargements: 0,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => (suppression ? Promise.resolve({ error: faux.erreurSuppression }) : chaine),
        in: () => chaine,
        order: () => chaine,
        range: () => chaine,
        delete: () => { suppression = true; faux.suppressions += 1; return chaine },
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          if (table === 'comptes_courants_associes') faux.rechargements += 1
          const lignes =
            table === 'comptes_courants_associes' ? faux.comptes
            : table === 'mouvements_cca' ? faux.mouvements
            : []
          return Promise.resolve({ data: lignes, error: null, count: lignes.length }).then(suite)
        },
      })
      return chaine
    },
  },
}))

function compte(o: Partial<CompteCourantAssocie> = {}): CompteCourantAssocie {
  return {
    id: 'c1', dossier_id: 'd1', nom_associe: 'MARTIN', taux_interet_annuel: null,
    created_at: '2026-09-01T10:00:00Z', ...o,
  }
}

function mouvement(o: Partial<MouvementCca> = {}): MouvementCca {
  return {
    id: 'm1', compte_id: 'c1', date: '2026-03-10', type: 'apport', montant: 1500,
    libelle: 'Apport initial', created_at: '2026-03-10T09:00:00Z', ...o,
  }
}

async function ouvrirLesMouvements() {
  render(<SupplementsTab dossierId="d1" />)
  await act(async () => {})
  const ouvrir = screen.getByRole('button', { name: /^Mouvements$/ })
  await act(async () => { ouvrir.click() })
}

async function supprimerLaLigne() {
  // Deux boutons « Supprimer » cohabitent — celui de la CARTE du compte et celui de la LIGNE de
  // mouvement. On s'ancre donc sur la ligne qui porte le libellé, jamais sur un rang dans le
  // document : un test qui se tromperait de bouton supprimerait le compte entier et passerait.
  const ligne = screen.getByText('Apport initial').closest('tr')
  if (!ligne) throw new Error('ligne du mouvement introuvable')
  const bouton = within(ligne).getByRole('button', { name: /^Supprimer$/ })
  await act(async () => { bouton.click() })
}

beforeEach(() => {
  faux.comptes = [compte()]
  faux.mouvements = [mouvement()]
  faux.erreurSuppression = null
  faux.suppressions = 0
  faux.rechargements = 0
  window.confirm = () => true
})

describe('mouvement de compte courant : une suppression refusée se dit', () => {
  it('DIT pourquoi quand la suppression échoue', async () => {
    // La RAISON rendue par Postgres, pas un repli plausible : c'est elle qui dit à l'opérateur
    // s'il doit corriger quelque chose, appeler l'administrateur ou réessayer.
    faux.erreurSuppression = { message: 'new row violates row-level security policy' }
    await ouvrirLesMouvements()
    await supprimerLaLigne()
    expect(screen.getByText(/row-level security/)).toBeTruthy()
  })

  it('ne recharge PAS derrière un échec', async () => {
    // Le rechargement est ce qui faisait passer l'échec pour un geste réussi puis annulé : la ligne
    // revenait, sans un mot. On s'arrête avant, et on le dit.
    faux.erreurSuppression = { message: 'refusé' }
    await ouvrirLesMouvements()
    const avant = faux.rechargements
    await supprimerLaLigne()
    expect(faux.rechargements).toBe(avant)
  })

  it('ne dit rien et recharge quand la suppression passe', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran dit l'échec » serait satisfait par un écran qui
    // crie au loup à chaque suppression, et on cesserait de le lire.
    faux.erreurSuppression = null
    await ouvrirLesMouvements()
    const avant = faux.rechargements
    await supprimerLaLigne()

    expect(faux.suppressions).toBe(1)
    expect(faux.rechargements).toBeGreaterThan(avant)
    expect(screen.queryAllByText(/n'a pas pu être supprimé/)).toHaveLength(0)
  })

  it('ne supprime rien quand la confirmation est refusée', async () => {
    // La garde qui rend le geste difficile à déclencher par distraction : un test qui la
    // contournerait ne décrirait plus le geste réel.
    window.confirm = () => false
    await ouvrirLesMouvements()
    await supprimerLaLigne()
    expect(faux.suppressions).toBe(0)
  })
})
