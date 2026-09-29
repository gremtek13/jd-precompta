import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TvaTab from './TvaTab'
import type { DeclarationTva, LigneBancaire, PeriodiciteTva, Piece } from '../../lib/types'

// LE CALCUL EST DANS lib/declarationTva.ts ET SE TESTE LÀ. Ce qui se joue ici est ce qu'aucun test du
// module ne peut voir : l'écran montre les cases de la bonne période, reprend le crédit de la
// déclaration précédente, enregistre ce qui a été déposé une seule fois, refuse de l'enregistrer sur
// une lecture partielle, et écrit le régime du dossier en annulant ce qu'il a affiché si la base refuse.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Tables dont la lecture s'arrête avant le compte annoncé : `lireTout` la déclare incomplète.
  tronquees: new Set<string>(),
  lectures: 0,
  insertions: [] as { table: string; valeurs: Record<string, unknown> }[],
  misesAJour: [] as { table: string; valeurs: Record<string, unknown> }[],
  suppressions: [] as { table: string; id: unknown }[],
  // Non nul : l'insertion attend qu'on la libère, pour éprouver le verrou.
  suspendue: null as null | { liberer: () => void },
  // Non nul : la relecture des déclarations qui SUIT une insertion attend qu'on la libère.
  relectureSuspendue: null as null | { liberer: () => void },
  miseAJourRefusee: false,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      const lecture: Record<string, unknown> = {}
      Object.assign(lecture, {
        select: () => lecture,
        eq: () => lecture,
        not: () => lecture,
        order: () => lecture,
        range: (d: number, f: number) => { debut = d; fin = f; return lecture },
        then: (suite: (r: unknown) => unknown) => {
          faux.lectures++
          const reponse = () => {
            const lignes = faux.tables[table] ?? []
            return {
              data: lignes.slice(debut, Math.min(fin + 1, lignes.length)),
              error: null,
              count: lignes.length + (faux.tronquees.has(table) ? 1 : 0),
            }
          }
          const suspendre = faux.relectureSuspendue && table === 'declarations_tva' && faux.insertions.length > 0
          if (!suspendre) return Promise.resolve(reponse()).then(suite)
          return new Promise((resoudre) => { faux.relectureSuspendue!.liberer = () => resoudre(reponse()) }).then(suite)
        },
        insert: (valeurs: Record<string, unknown>) => {
          faux.insertions.push({ table, valeurs })
          return new Promise((resoudre) => {
            const repondre = () => {
              faux.tables[table] = [...(faux.tables[table] ?? []), { id: `nouvelle-${faux.insertions.length}`, created_at: '2027-04-15T10:00:00Z', notes: null, ...valeurs }]
              resoudre({ error: null })
            }
            if (faux.suspendue) faux.suspendue.liberer = repondre
            else repondre()
          })
        },
        update: (valeurs: Record<string, unknown>) => ({
          eq: () => {
            faux.misesAJour.push({ table, valeurs })
            return Promise.resolve(faux.miseAJourRefusee
              ? { error: { message: 'new row violates row-level security policy' } }
              : { error: null })
          },
        }),
        delete: () => ({
          eq: (_colonne: string, id: unknown) => {
            faux.suppressions.push({ table, id })
            faux.tables[table] = (faux.tables[table] ?? []).filter((l) => (l as { id: unknown }).id !== id)
            return Promise.resolve({ error: null })
          },
        }),
      })
      return lecture
    },
  },
}))

// Jeux d'essai typés SANS `as` : le compilateur vérifie chaque champ contre la table.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'vente', dossier_id: 'd', uploaded_by: null, source: 'upload', storage_path: 'd/v.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2027-02-10', tiers: 'Client Durand',
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2027-02-10T09:00:00Z', updated_at: '2027-02-10T09:00:00Z', ...o,
  }
}

function paiement(pieceId: string, montant: number, date: string): LigneBancaire {
  return {
    id: `m-${pieceId}`, dossier_id: 'd', date, libelle: 'VIREMENT', montant, statut: 'rapprochee',
    piece_id: pieceId, cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null,
    libelle_brut: null, created_at: `${date}T09:00:00Z`,
  }
}

function declaration(o: Partial<DeclarationTva> = {}): DeclarationTva {
  return {
    id: 'decl', dossier_id: 'd', periode_debut: '2026-10-01', periode_fin: '2026-12-31', tva_declaree: 0,
    credit_anterieur: 0, date_declaration: '2027-01-20', notes: null, created_at: '2027-01-20T10:00:00Z', ...o,
  }
}

// Une recette de 1 000 € HT encaissée en février, un achat payé en mars : le premier trimestre 2027
// porte 200 € de TVA brute et 50 € de TVA déductible, soit 150 € à payer.
function dossierCourant() {
  faux.tables = {
    pieces: [
      piece(),
      piece({ id: 'achat', type_piece: 'achat', tiers: 'Papeterie', date_piece: '2027-03-01', montant_ht: 250, montant_tva: 50, montant_ttc: 300 }),
    ],
    lignes_bancaires: [paiement('vente', 1200, '2027-02-20'), paiement('achat', -300, '2027-03-05')],
    immobilisations: [],
    declarations_tva: [],
  }
}

const MONTANT = (texte: string) => new RegExp(`^${texte.replace(/ /g, '\\s')}$`)
const ligneDe = (libelle: string) => screen.getByText(libelle).closest('tr') as HTMLElement

function Hote({ periodicite = 'trimestrielle', surDebits = false, assujetti = true, espion }: {
  periodicite?: PeriodiciteTva
  surDebits?: boolean
  assujetti?: boolean
  espion?: (m: unknown) => void
}) {
  const [regime, setRegime] = useState({ tva_periodicite: periodicite, tva_sur_debits: surDebits })
  return (
    <TvaTab
      dossierId="d"
      assujettiTva={assujetti}
      periodicite={regime.tva_periodicite}
      surDebits={regime.tva_sur_debits}
      onRegimeUpdated={(m) => { espion?.(m); setRegime((r) => ({ ...r, ...m })) }}
    />
  )
}

async function afficher(props: Parameters<typeof Hote>[0] = {}) {
  render(<Hote {...props} />)
  await act(async () => {})
}

beforeEach(() => {
  // La période proposée est la dernière TERMINÉE : l'horloge est fixée pour que le test ne dépende pas
  // du jour où il tourne. Seule `Date` est feinte, les minuteurs dont `findBy…` dépend restent vrais.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2027, 3, 15, 10, 0, 0))
  dossierCourant()
  faux.tronquees = new Set()
  faux.lectures = 0
  faux.insertions = []
  faux.misesAJour = []
  faux.suppressions = []
  faux.suspendue = null
  faux.relectureSuspendue = null
  faux.miseAJourRefusee = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('l’onglet TVA', () => {
  it('ne lit rien et le dit, sur un dossier qui n’est pas assujetti', async () => {
    await afficher({ assujetti: false })
    expect(screen.getByText('Pas de déclaration de TVA')).toBeTruthy()
    expect(faux.lectures).toBe(0)
  })

  it('montre la CA3 de la dernière période close, case par case', async () => {
    await afficher()
    expect(screen.getByText('CA3 — 1er trimestre 2027')).toBeTruthy()
    const l08 = ligneDe('Taux normal 20 %')
    expect(within(l08).getByText(MONTANT('1 000,00 €'))).toBeTruthy()
    expect(within(l08).getByText(MONTANT('200,00 €'))).toBeTruthy()
    expect(within(ligneDe('Autres biens et services')).getByText(MONTANT('50,00 €'))).toBeTruthy()
    expect(within(ligneDe('TVA nette due')).getByText(MONTANT('150,00 €'))).toBeTruthy()
    expect(within(ligneDe('Total à payer')).getByText(MONTANT('150,00 €'))).toBeTruthy()
  })

  it('suit la période choisie : l’encaissement de février ne compte pas au deuxième trimestre', async () => {
    await afficher()
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '1' } })
    expect(screen.getByText('CA3 — 2e trimestre 2027')).toBeTruthy()
    expect(screen.getByText(/Déclaration « néant »/)).toBeTruthy()
  })

  it('reprend en ligne 22 le crédit que la déclaration précédente a reporté', async () => {
    // Le quatrième trimestre 2026 s'est soldé par un crédit de 80 € : sa ligne 27.
    faux.tables.declarations_tva = [declaration({ tva_declaree: -80 })]
    await afficher()
    expect((screen.getByLabelText(/Crédit reporté/) as HTMLInputElement).value).toBe('80')
    expect(screen.getByText('Repris de la déclaration du 4e trimestre 2026, sa ligne 27.')).toBeTruthy()
    expect(within(ligneDe('TVA nette due')).getByText(MONTANT('70,00 €'))).toBeTruthy()
  })

  it('enregistre la TVA nette de la période et le crédit reçu, pas le montant payé', async () => {
    faux.tables.declarations_tva = [declaration({ tva_declaree: -80 })]
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer comme déposée' }).click() })
    expect(faux.insertions).toEqual([{
      table: 'declarations_tva',
      valeurs: {
        dossier_id: 'd', periode_debut: '2027-01-01', periode_fin: '2027-03-31',
        tva_declaree: 150, credit_anterieur: 80, date_declaration: '2027-04-15',
      },
    }])
    // Relue, elle apparaît comme déposée pour la période.
    expect(screen.getByText('déjà déposée')).toBeTruthy()
  })

  it('n’enregistre qu’une fois sur trois clics rapprochés', async () => {
    faux.suspendue = { liberer: () => {} }
    await afficher()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.insertions).toHaveLength(1)
    await act(async () => { faux.suspendue!.liberer() })
    expect(faux.insertions).toHaveLength(1)
    expect(screen.getByText('déjà déposée')).toBeTruthy()
  })

  it('tient le verrou jusqu’à la relecture : un clic pendant qu’elle court n’enregistre pas deux fois', async () => {
    // Relâché avant la relecture, un second clic enregistrerait la même déclaration une seconde
    // fois, la mention « déjà déposée » n'étant pas encore revenue.
    faux.relectureSuspendue = { liberer: () => {} }
    await afficher()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' })
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(1)
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(1)
    await act(async () => { faux.relectureSuspendue!.liberer() })
    expect(screen.getByText('déjà déposée')).toBeTruthy()
  })

  // La garde répétée dans le gestionnaire (`if (… lectureIncomplete …) return`) n'est atteinte par
  // aucun clic, le bouton étant déjà grisé : une seconde ceinture, comme le refus côté gestionnaire de
  // ClotureTab. Sa mutation survit à juste titre, et c'est dit ici plutôt que déguisé en assertion.
  it('suspend l’enregistrement sur une lecture partielle, et le dit', async () => {
    faux.tronquees = new Set(['pieces'])
    await afficher()
    expect(screen.getByText(/Les justificatifs n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.getByText(/Enregistrement suspendu/)).toBeTruthy()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions).toEqual([])
  })

  it('suspend aussi sur l’historique des déclarations lu à moitié : le crédit proposé en dépend', async () => {
    faux.tronquees = new Set(['declarations_tva'])
    await afficher()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('compare chaque déclaration déposée au calcul de sa période', async () => {
    // Déposée à 100 €, alors que le trimestre en porte 150 aujourd'hui : une pièce a changé depuis.
    faux.tables.declarations_tva = [declaration({ id: 't1', periode_debut: '2027-01-01', periode_fin: '2027-03-31', tva_declaree: 100 })]
    await afficher()
    const ligne = screen.getAllByText('1er trimestre 2027').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText(MONTANT('-50,00 €'))).toBeTruthy()
  })

  it('ne signale aucun écart quand le recalcul retombe sur le dépôt', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't1', periode_debut: '2027-01-01', periode_fin: '2027-03-31', tva_declaree: 150 })]
    await afficher()
    const ligne = screen.getAllByText('1er trimestre 2027').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText('aucun')).toBeTruthy()
  })

  it('écrit la périodicité sur le dossier et repart de la dernière période close', async () => {
    const espion = vi.fn()
    await afficher({ espion })
    // Une période choisie d'abord (le 2e trimestre) : son rang ne doit pas désigner février une fois
    // passé au mois.
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '1' } })
    await act(async () => { fireEvent.change(screen.getByLabelText('Déclaration CA3'), { target: { value: 'mensuelle' } }) })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { tva_periodicite: 'mensuelle' } }])
    expect(espion).toHaveBeenCalledWith({ tva_periodicite: 'mensuelle' })
    expect(screen.getByText('CA3 — mars 2027')).toBeTruthy()
  })

  it('annule ce qu’il a affiché si la base refuse le régime, et le dit', async () => {
    faux.miseAJourRefusee = true
    await afficher()
    await act(async () => { fireEvent.change(screen.getByLabelText('TVA des recettes due'), { target: { value: 'debits' } }) })
    expect((screen.getByLabelText('TVA des recettes due') as HTMLSelectElement).value).toBe('encaissements')
    expect(screen.getByText('new row violates row-level security policy')).toBeTruthy()
  })

  it('dit la recette qu’aucun paiement ne rattache, au lieu de se taire sur elle', async () => {
    faux.tables.pieces = [...faux.tables.pieces, piece({ id: 'impayee', tiers: 'Client Martin', date_piece: '2027-03-20' })]
    await afficher()
    expect(screen.getByText(/1 pièce\(s\) ne sont rattachées à aucun paiement/)).toBeTruthy()
  })

  it('écarte, en disant pourquoi, la recette qu’il ne sait pas placer', async () => {
    faux.tables.pieces = [...faux.tables.pieces, piece({ id: 'presse', tiers: 'Abonnés', montant_ht: 1000, montant_tva: 21, montant_ttc: 1021 })]
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, paiement('presse', 1021, '2027-03-10')]
    await afficher()
    expect(screen.getByText(/1 pièce\(s\) de la période ne sont pas dans les cases/)).toBeTruthy()
    expect(screen.getByText('2,1 % : ligne T6 en France continentale, 11 dans les DOM, T4 en Corse')).toBeTruthy()
  })

  it('demande confirmation avant de retirer une déclaration, en nommant ce qui part', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(confirmer.mock.calls[0][0]).toMatch(/4e trimestre 2026.*crédit qu’elle reporte ne sera plus proposé/)
    expect(faux.suppressions).toEqual([{ table: 'declarations_tva', id: 't4' }])
    confirmer.mockRestore()
  })
})
