import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EreportingCard from './EreportingCard'
import { dossier, regime } from '../../test/ereportingEcran'
import type { DossierEreporting } from '../../lib/ereporting'

// LA CARTE « E-REPORTING » DE L'ONGLET TVA (ligne 28.5, étape e5c). Ce que ces cas gardent : elle ne lit que les régimes, rien
// n'est dit du régime avant sa lecture ni sur une lecture partielle ; elle dit ce que le dossier déclare sous son statut
// d'aujourd'hui (exonéré et franchisé compris), le régime confirmé, et qu'il est à reconfirmer quand l'onglet TVA le
// contredit ; elle ouvre la fenêtre sur un clic, et relit son régime quand la fenêtre l'a changé. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  // Les tables lues, dans l'ordre : la carte ne lit que les régimes ; la fenêtre, le reste.
  lues: [] as string[],
  // Les lectures d'un dossier restent en attente tant qu'on ne les libère pas.
  retenues: {} as Record<string, Promise<void>>,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  type Ligne = Record<string, unknown>
  return {
    supabase: {
      rpc: (nom: string, args: Ligne) => {
        faux.rpcs.push({ nom, args })
        if (nom === 'confirmer_regime_ereporting') {
          faux.tables.regimes_ereporting.push({
            id: '00000000-0000-4000-8000-000000000501', dossier_id: args.p_dossier_id, depuis: args.p_depuis, statut_tva: args.p_statut_tva,
            article_exoneration: args.p_article_exoneration, tva_periodicite: args.p_tva_periodicite, tva_sur_debits: args.p_tva_sur_debits,
            frequence_transactions: args.p_frequence_transactions, frequence_paiements: args.p_frequence_paiements, note: args.p_note,
            cree_par: 'u1', cree_le: '2027-11-05T10:00:00Z', retire_le: null, retire_par: null,
          })
        }
        return Promise.resolve({ data: {}, error: null })
      },
      from: (table: string) => {
        const predicats: ((l: Ligne) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let dossierLu = ''
        const c: Ligne = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { if (colonne === 'dossier_id') dossierLu = String(valeur); predicats.push(predicatEq(colonne, valeur)); return c },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.lues.push(table)
            const reponse = () => {
              const toutes = filtrer(faux.tables[table] ?? [], predicats)
              return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity)), error: null, count: toutes.length }
            }
            return (faux.retenues[dossierLu] ?? Promise.resolve()).then(reponse).then(suite)
          },
        })
        return c
      },
    },
  }
})

const ligneDeTable = (x: object): Record<string, unknown> => Object.fromEntries(Object.entries(x))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-05T10:00:00Z'))
  faux.tables = { regimes_ereporting: [ligneDeTable(regime())] }
  faux.muetApres = {}
  faux.lues = []
  faux.retenues = {}
  faux.rpcs = []
  vi.spyOn(window, 'confirm').mockImplementation(() => true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function laisser(tours = 12) {
  for (let i = 0; i < tours; i++) await act(async () => { await Promise.resolve() })
}

async function monter(d: DossierEreporting = dossier(), statutChange = false) {
  const vue = render(<EreportingCard dossierId="d1" dossier={d} statutChange={statutChange} />)
  await laisser()
  return vue
}

const bouton = (nom: string | RegExp) => screen.queryByRole('button', { name: nom })

describe('la carte', () => {
  it('ne lit que les régimes du dossier', async () => {
    await monter()
    expect(faux.lues).toEqual(['regimes_ereporting'])
  })

  it('avant la lecture, elle dit ce que le dossier déclare — et rien de son régime', async () => {
    let liberer = () => {}
    faux.retenues.d1 = new Promise<void>((r) => { liberer = r })
    await monter()
    expect(screen.getByRole('heading', { name: 'E-reporting' })).toBeTruthy()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/Régime d’e-reporting/)).toBeNull()
    expect(bouton('Confirmer le régime…')).toBeNull()
    delete faux.retenues.d1
    await act(async () => { liberer() })
    await laisser()
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.getByText(/Régime d’e-reporting/)).toBeTruthy()
  })

  it('dit les trois déclarations du dossier, sous son statut d’aujourd’hui', async () => {
    await monter()
    expect(screen.getByText('Achats à un fournisseur établi hors de France')).toBeTruthy()
    expect(screen.getByText('Ventes à des particuliers')).toBeTruthy()
    expect(screen.getByText('Paiements de ces ventes')).toBeTruthy()
    const items = within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'DueAchats à un fournisseur établi hors de FranceDéclaration chaque mois.',
      'DueVentes à des particuliersDéclaration chaque mois.',
      'DuePaiements de ces ventesDéclaration chaque mois.',
    ])
  })

  it.each([
    ['exonéré', { statut_tva: 'exonere', article_exoneration: 'cgi_261_4_1' }, ['Due', 'Le cas échéant', 'Le cas échéant']],
    ['en franchise', { statut_tva: 'franchise', article_exoneration: null }, ['Due', 'Due', 'Due']],
    ['à préciser', { statut_tva: null, article_exoneration: null }, ['Due', 'À préciser', 'À préciser']],
  ] as const)('la carte est aussi celle d’un dossier %s : ses achats à l’étranger sont dus', async (_nom, d, etats) => {
    await monter(dossier(d))
    const badges = within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.querySelector('.badge')?.textContent)
    expect(badges).toEqual(etats)
  })

  it('sans régime confirmé : elle le dit, et offre de le confirmer', async () => {
    faux.tables.regimes_ereporting = []
    await monter()
    expect(screen.getByText(/aucun n’est confirmé/)).toBeTruthy()
    expect(bouton('Confirmer le régime…')).toBeTruthy()
    expect(bouton('Régime, périodes et déclarations')).toBeTruthy()
  })

  it('un régime confirmé en vigueur : son libellé, son jour, ses fréquences — et rien à reconfirmer', async () => {
    await monter()
    const p = screen.getByText(/Régime d’e-reporting :/).closest('p') as HTMLElement
    expect(p.textContent).toBe('Régime d’e-reporting : redevable, chaque mois, confirmé à partir du 01/01/2026 — ses ventes et ses achats se déclarent chaque mois ; ses paiements se déclarent chaque mois.')
    expect(document.querySelector('.alerte-tva')).toBeNull()
    expect(bouton('Confirmer le régime…')).toBeNull()
  })

  it('un régime retiré, ou qui ne commence que dans l’avenir, n’est pas en vigueur', async () => {
    faux.tables.regimes_ereporting = [
      ligneDeTable(regime({ retire_le: '2027-11-01T10:00:00Z', retire_par: 'u1' })),
      ligneDeTable(regime({ id: '00000000-0000-4000-8000-000000000502', depuis: '2027-12-01' })),
    ]
    await monter()
    expect(screen.getByText(/aucun n’est confirmé/)).toBeTruthy()
  })

  it('l’onglet TVA contredit le régime : à reconfirmer à partir du jour du changement, que le cabinet saisit', async () => {
    await monter(dossier({ statut_tva: 'franchise', article_exoneration: null }))
    const alerte = document.querySelector('.alerte-tva') as HTMLElement
    expect(alerte.textContent).toContain('à reconfirmer à partir du jour du changement, que le cabinet saisit')
    expect(alerte.textContent).not.toContain('vient d’être changé')
    expect(bouton('Confirmer le régime…')).toBeTruthy()
  })

  it('le statut vient d’être changé dans l’onglet : la carte le dit', async () => {
    await monter(dossier({ statut_tva: 'franchise', article_exoneration: null }), true)
    expect((document.querySelector('.alerte-tva') as HTMLElement).textContent).toMatch(/^Le statut de TVA vient d’être changé\. /)
  })

  it('le statut changé ne dit rien quand le régime est celui de l’onglet', async () => {
    await monter(dossier(), true)
    expect(document.querySelector('.alerte-tva')).toBeNull()
  })

  it('les régimes lus en partie : la carte le dit, ne dit pas le régime et n’offre pas de le confirmer', async () => {
    faux.tables.regimes_ereporting = [ligneDeTable(regime()), ligneDeTable(regime({ id: '00000000-0000-4000-8000-000000000503', depuis: '2026-06-01' }))]
    faux.muetApres.regimes_ereporting = 1
    await monter()
    expect(screen.getByText(/Les régimes d’e-reporting confirmés n'ont pas pu être lus en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\)/)).toBeTruthy()
    expect(screen.queryByText(/Régime d’e-reporting :/)).toBeNull()
    expect(screen.queryByText(/aucun n’est confirmé/)).toBeNull()
    expect(bouton('Confirmer le régime…')).toBeNull()
    expect(document.querySelector('.alerte-tva')).toBeNull()
  })

  it('les régimes lus en partie ne laissent pas dire « à reconfirmer » ni offrir de confirmer, même quand l’onglet contredit le régime lu', async () => {
    faux.tables.regimes_ereporting = [ligneDeTable(regime()), ligneDeTable(regime({ id: '00000000-0000-4000-8000-000000000503', depuis: '2026-06-01' }))]
    faux.muetApres.regimes_ereporting = 1
    await monter(dossier({ statut_tva: 'franchise' }), true)
    expect(screen.getByText(/Les régimes d’e-reporting confirmés n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(bouton('Confirmer le régime…')).toBeNull()
    expect(document.querySelector('.alerte-tva')).toBeNull()
    expect(screen.queryByText(/Le statut de TVA vient d’être changé/)).toBeNull()
  })
})

describe('la fenêtre', () => {
  it('s’ouvre sur un clic, jamais avant, et lit alors le reste', async () => {
    await monter()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faux.lues).toEqual(['regimes_ereporting'])
    await act(async () => { fireEvent.click(bouton('Régime, périodes et déclarations') as HTMLElement) })
    await laisser()
    expect(screen.getByRole('dialog', { name: 'E-reporting du dossier' })).toBeTruthy()
    expect(faux.lues).toContain('declarations_ereporting')
    expect(faux.lues).toContain('factures_emises')
    // Hors de la carte : une fenêtre superposée ne vit pas dans une carte.
    expect(screen.getByRole('dialog').closest('.card')).toBe(screen.getByRole('dialog'))
    expect(document.querySelector('.card .card')).toBeNull()
  })

  it('« Confirmer le régime… » l’ouvre sur le formulaire du régime', async () => {
    faux.tables.regimes_ereporting = []
    await monter()
    await act(async () => { fireEvent.click(bouton('Confirmer le régime…') as HTMLElement) })
    await laisser()
    expect(screen.getByLabelText('À partir du')).toBeTruthy()
  })

  it('Fermer la referme', async () => {
    await monter()
    await act(async () => { fireEvent.click(bouton('Régime, périodes et déclarations') as HTMLElement) })
    await laisser()
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fermer' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('un régime confirmé dans la fenêtre paraît sur la carte, relu', async () => {
    faux.tables.regimes_ereporting = []
    await monter()
    await act(async () => { fireEvent.click(bouton('Confirmer le régime…') as HTMLElement) })
    await laisser()
    await act(async () => { fireEvent.change(screen.getByLabelText('À partir du'), { target: { value: '2027-09-01' } }) })
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer le régime' })) })
    await laisser()
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['confirmer_regime_ereporting'])
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fermer' })) })
    await laisser()
    expect(screen.getByText(/Régime d’e-reporting :/).closest('p')?.textContent).toContain('confirmé à partir du 01/09/2027')
    expect(bouton('Confirmer le régime…')).toBeNull()
  })
})

describe('un autre dossier', () => {
  it('une lecture plus lente que le changement de dossier n’écrit pas sur le nouveau', async () => {
    let libererD1 = () => {}
    faux.retenues.d1 = new Promise<void>((r) => { libererD1 = r })
    faux.tables.regimes_ereporting = [
      ligneDeTable(regime({ id: '00000000-0000-4000-8000-000000000601', depuis: '2020-01-01' })),
      ligneDeTable(regime({ id: '00000000-0000-4000-8000-000000000602', dossier_id: 'd2', depuis: '2024-04-04' })),
    ]
    const vue = render(<EreportingCard dossierId="d1" dossier={dossier()} />)
    await laisser()
    vue.rerender(<EreportingCard dossierId="d2" dossier={dossier({ id: 'd2' })} />)
    await laisser()
    expect(screen.getByText(/confirmé à partir du 04\/04\/2024/)).toBeTruthy()
    // Et le régime lu pour d2 ne se montre jamais pour d3, même un instant : d3 repart de « Chargement… ».
    let libererD3 = () => {}
    faux.retenues.d3 = new Promise<void>((r) => { libererD3 = r })
    vue.rerender(<EreportingCard dossierId="d3" dossier={dossier({ id: 'd3' })} />)
    await laisser()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByText(/confirmé à partir du/)).toBeNull()
    delete faux.retenues.d3
    await act(async () => { libererD3() })
    await laisser()
    vue.rerender(<EreportingCard dossierId="d2" dossier={dossier({ id: 'd2' })} />)
    await laisser()
    expect(screen.getByText(/confirmé à partir du 04\/04\/2024/)).toBeTruthy()
    // La lecture de d1 revient, en retard : elle n’écrase pas celle de d2.
    delete faux.retenues.d1
    await act(async () => { libererD1() })
    await laisser()
    expect(screen.getByText(/confirmé à partir du 04\/04\/2024/)).toBeTruthy()
    expect(screen.queryByText(/01\/01\/2020/)).toBeNull()
  })
})
