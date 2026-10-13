import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PiecesJointesEcartees from './PiecesJointesEcartees'
import type { PieceJointeEcartee } from '../../lib/types'

// LES PIÈCES JOINTES ÉCARTÉES À LA RÉCEPTION PAR E-MAIL, EN TÊTE DE L'ONGLET JUSTIFICATIFS (ligne 22.7). Ce que ces cas gardent,
// et qu'aucun calcul pur ne voit : rien n'est affirmé avant la lecture (ni un compte, ni le silence d'une liste vide) ; lue
// en entier et vide, rien ; une ligne de chaque raison se dit — combien, quand, pourquoi, quoi faire —, sans aucun nom ; lue
// en partie, refusée ou levée, le bandeau le dit, sans compte ni geste ; « Marquer comme vues » appelle la fonction de la
// base avec les seules lignes montrées, une fois sous trois clics, relit, et dit un refus. Données FICTIVES.
const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  muetApres: null as number | null,
  refusLecture: null as string | null,
  leve: false,
  // Une lecture retenue jusqu'à ce qu'on la libère : la fenêtre « en cours ».
  retenue: null as Promise<void> | null,
  lectures: 0,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  refusRpc: null as string | null,
  // La réponse de la fonction, retenue : un clic pendant qu'elle n'est pas revenue.
  rpcRetenu: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Ligne = Record<string, unknown>
  return {
    supabase: {
      rpc: (nom: string, args: Ligne) => {
        faux.rpcs.push({ nom, args })
        return (faux.rpcRetenu ?? Promise.resolve()).then(() => {
          if (faux.refusRpc) return { data: null, error: { message: faux.refusRpc, code: 'P0002' } }
          // La base marque vues celles qu'on lui désigne, de ce dossier, pas encore vues.
          let n = 0
          for (const l of faux.lignes) {
            if (l.dossier_id === args.p_dossier_id && (args.p_ids as string[]).includes(String(l.id)) && l.vue_le === null) {
              l.vue_le = '2026-10-13T07:30:00+00:00'
              l.vue_par = 'u1'
              n += 1
            }
          }
          return { data: n, error: null }
        })
      },
      from: (table: string) => {
        if (faux.leve) throw new Error('réseau coupé')
        if (table !== 'pieces_jointes_ecartees') throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Ligne) => boolean)[] = []
        const c: Ligne = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (debut: number, fin: number) => {
            faux.lectures += 1
            const reponse = () => {
              if (faux.refusLecture) return { data: null, error: { message: faux.refusLecture }, count: null }
              const toutes = filtrer(faux.lignes, predicats)
              return { data: toutes.slice(debut, Math.min(fin + 1, faux.muetApres ?? Infinity)).map((l) => ({ ...l })), error: null, count: toutes.length }
            }
            return (faux.retenue ?? Promise.resolve()).then(reponse)
          },
        })
        return c
      },
    },
  }
})

const D = 'd1'
const ecart = (o: Partial<PieceJointeEcartee> = {}): Record<string, unknown> => ({
  id: 'x1', dossier_id: D, recue_le: '2026-10-12T12:03:00+00:00', raison: 'format', octets: 4120, empreinte: 'a'.repeat(64),
  vue_le: null, vue_par: null, ...o,
})
const LOURDE = () => ecart({ id: 'x2', raison: 'taille', octets: 27_000_000, empreinte: 'b'.repeat(64), recue_le: '2026-10-11T08:00:00+00:00' })
const VUE = () => ecart({ id: 'x3', empreinte: 'c'.repeat(64), recue_le: '2026-09-01T08:00:00+00:00', vue_le: '2026-09-02T09:00:00+00:00', vue_par: 'u0' })

let fuseau: string | undefined
beforeEach(() => {
  // Un test de date choisit son fuseau : l'heure d'un instant est celle de qui regarde.
  fuseau = process.env.TZ
  process.env.TZ = 'Europe/Paris'
  faux.lignes = [ecart(), LOURDE(), VUE(), ecart({ id: 'ailleurs', dossier_id: 'd2' })]
  faux.muetApres = null
  faux.refusLecture = null
  faux.leve = false
  faux.retenue = null
  faux.lectures = 0
  faux.rpcs = []
  faux.refusRpc = null
  faux.rpcRetenu = null
})

afterEach(() => {
  cleanup()
  process.env.TZ = fuseau
})

async function laisser(tours = 10) {
  for (let i = 0; i < tours; i++) await act(async () => { await Promise.resolve() })
}

async function monter() {
  const vue = render(<PiecesJointesEcartees dossierId={D} />)
  await laisser()
  return vue
}

const texte = (vue: ReturnType<typeof render>) => (vue.container.textContent ?? '').replace(/\s+/g, ' ')

describe('rien d’affirmé avant la lecture, et le vide lu en entier se tait', () => {
  it('en cours : l’attente seule, ni compte, ni geste', async () => {
    let liberer = () => {}
    faux.retenue = new Promise<void>((r) => { liberer = r })
    const vue = await monter()
    expect(texte(vue)).toBe('Lecture des pièces jointes écartées à la réception par e-mail…')
    expect(vue.container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    await act(async () => { liberer() })
    await laisser()
    expect(texte(vue)).toMatch(/^2 pièces jointes reçues par e-mail n’ont pas été déposées/)
  })

  it('lue en entier et vide : rien du tout', async () => {
    faux.lignes = [ecart({ id: 'ailleurs', dossier_id: 'd2' })]
    const vue = await monter()
    expect(vue.container.innerHTML).toBe('')
    expect(faux.lectures).toBe(1)
  })
})

describe('ce qui se dit : combien, quand, pourquoi, quoi faire — sans nom', () => {
  it('une ligne de chaque raison, les plus récentes d’abord, et l’historique des vues replié', async () => {
    const vue = await monter()
    const section = screen.getByRole('region', { name: 'Pièces jointes écartées à la réception par e-mail' })
    expect(section.querySelector('h3')?.textContent).toBe('2 pièces jointes reçues par e-mail n’ont pas été déposées')
    const items = [...section.querySelectorAll('.pieces-jointes-ecartees-liste li')].map((li) => li.textContent)
    expect(items).toEqual([
      'le 12/10/2026 à 14 h 03 — format non pris en charge (4\u00a0Ko)',
      'le 11/10/2026 à 10 h 00 — au-delà des 20\u00a0Mo qu’une pièce peut peser (25,7\u00a0Mo)',
    ])
    expect(texte(vue)).toContain('Le client croit les avoir envoyées : demande-lui de les renvoyer en PDF, JPEG, PNG ou CSV')
    expect((screen.getByRole('button', { name: 'Marquer comme vues' }) as HTMLButtonElement).disabled).toBe(false)
    const historique = section.querySelector('details')
    expect(historique?.querySelector('summary')?.textContent).toBe('1 pièce jointe écartée déjà vue')
    expect(historique?.textContent).toContain('vue le 02/09/2026')
    // Celle d'un autre dossier ne se dit nulle part.
    expect(section.querySelectorAll('li')).toHaveLength(3)
  })

  it('seules des pièces jointes déjà vues : l’historique replié, discret, sans carte ni geste', async () => {
    faux.lignes = [VUE()]
    const vue = await monter()
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(vue.container.querySelector('details summary')?.textContent).toBe('1 pièce jointe écartée déjà vue')
  })
})

describe('lue en partie, refusée ou levée : le bandeau, sans compte ni geste', () => {
  it('partielle', async () => {
    faux.muetApres = 1
    const vue = await monter()
    expect(texte(vue)).toBe(
      "Les pièces jointes écartées à la réception par e-mail n'ont pas pu être lues en entier (1 ligne(s) lue(s) sur 3 annoncée(s)). "
      + 'Une pièce jointe que la réception a écartée peut donc ne pas être signalée ici, et rien ne se marque vu. Recharge la page.',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('refusée par la base', async () => {
    faux.refusLecture = 'permission denied for table pieces_jointes_ecartees'
    const vue = await monter()
    expect(texte(vue)).toContain("n'ont pas pu être lues en entier (lecture interrompue après 0 ligne(s) : permission denied")
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('une requête qui lève', async () => {
    faux.leve = true
    const vue = await monter()
    expect(texte(vue)).toContain("n'ont pas pu être lues en entier (lecture impossible : réseau coupé)")
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('« Marquer comme vues »', () => {
  it('appelle la fonction de la base avec les seules lignes montrées, une fois sous trois clics, puis relit', async () => {
    let liberer = () => {}
    faux.rpcRetenu = new Promise<void>((r) => { liberer = r })
    await monter()
    const bouton = screen.getByRole('button', { name: 'Marquer comme vues' })
    act(() => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(faux.rpcs).toEqual([{ nom: 'marquer_pieces_jointes_vues', args: { p_dossier_id: D, p_ids: ['x1', 'x2'] } }])
    expect((screen.getByRole('button', { name: 'Enregistrement…' }) as HTMLButtonElement).disabled).toBe(true)
    const lecturesAvant = faux.lectures
    await act(async () => { liberer() })
    await laisser()
    expect(faux.lectures).toBe(lecturesAvant + 1)
    // Relues vues : plus de carte, l'historique des trois, et aucun geste.
    expect(screen.queryByRole('region')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('details summary')?.textContent).toBe('3 pièces jointes écartées déjà vues')
  })

  it('un refus de la base se dit, la liste est relue, et le bouton revient', async () => {
    faux.refusRpc = "Une pièce jointe désignée n'est pas de ce dossier : relire la liste avant de la marquer vue."
    await monter()
    const lecturesAvant = faux.lectures
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marquer comme vues' })) })
    await laisser()
    expect(screen.getByRole('alert').textContent).toBe(
      "Elles n’ont pas pu être marquées vues : Une pièce jointe désignée n'est pas de ce dossier : relire la liste avant de la marquer vue.",
    )
    expect(faux.lectures).toBe(lecturesAvant + 1)
    expect((screen.getByRole('button', { name: 'Marquer comme vues' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('une seule pièce jointe à signaler : « Marquer comme vue », au singulier', async () => {
    faux.lignes = [ecart()]
    await monter()
    expect(screen.getByRole('heading').textContent).toBe('1 pièce jointe reçue par e-mail n’a pas été déposée')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marquer comme vue' })) })
    await laisser()
    expect(faux.rpcs.map((r) => r.args.p_ids)).toEqual([['x1']])
  })
})
