import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TvaTab from './TvaTab'
import type { Categorie, DeclarationTva, LigneBancaire, PeriodiciteTva, Piece, ReglementGroupe, VentilationBancaire } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'

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

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les filtres sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) : la lecture des paiements était
        // restreinte aux mouvements qui portent une pièce, ce qui écarterait en silence un virement qui en
        // règle plusieurs — il n'en porte aucune. Accepté sans effet, ce filtre remis laisserait ce test vert.
        const predicats: Predicat[] = []
        const lecture: Record<string, unknown> = {}
        Object.assign(lecture, {
          select: () => lecture,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return lecture },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return lecture },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return lecture },
          order: () => lecture,
          range: (d: number, f: number) => { debut = d; fin = f; return lecture },
          then: (suite: (r: unknown) => unknown) => {
            faux.lectures++
            const reponse = () => {
              const lignes = filtrer(faux.tables[table] ?? [], predicats)
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
  }
})

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
    piece_id: pieceId, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    libelle_brut: null, created_at: `${date}T09:00:00Z`,
  }
}

// Les recettes encaissées SANS FACTURE (lib/tvaDuReleve.ts) : une catégorie de recettes du cabinet, et un
// virement affecté à elle depuis le relevé, à son taux.
const RECETTES: Categorie = {
  id: 'c-recettes', dossier_id: null, code: 'ventes', libelle: 'Ventes / prestations', ordre: 80, compte_comptable: '706000', poste_2035: 'Recettes',
}
const FRAIS: Categorie = {
  id: 'c-frais', dossier_id: null, code: 'frais', libelle: 'Frais bancaires', ordre: 70, compte_comptable: '627000', poste_2035: 'Frais financiers',
}

function encaissementAffecte(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return { ...paiement('x', 600, '2027-03-12'), id: 'enc', libelle: 'VIR CLIENT MARTIN', piece_id: null, categorie_id: 'c-recettes', taux_tva: 20, ...o }
}

function declaration(o: Partial<DeclarationTva> = {}): DeclarationTva {
  return {
    id: 'decl', dossier_id: 'd', periode_debut: '2026-10-01', periode_fin: '2026-12-31', tva_declaree: 0,
    credit_anterieur: 0, remboursement_demande: 0, date_declaration: '2027-01-20', notes: null,
    created_at: '2027-01-20T10:00:00Z', cases: null, tva_collectee: null, tva_deductible: null,
    tva_deductible_immobilisations: null, ...o,
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
    reglements_groupes: [],
    categories: [RECETTES, FRAIS],
    ventilations_bancaires: [],
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

  // UN VIREMENT QUI RÈGLE PLUSIEURS RECETTES (ligne 26) : chacune devient exigible à la date du virement, pour
  // sa part. Le virement ne porte aucune pièce — elles sont dans ses parts, que l'écran doit lire.
  it('compte les recettes qu’un virement groupé encaisse dans la période du virement', async () => {
    const groupe: LigneBancaire = { ...paiement('groupe', 1800, '2027-03-10'), id: 'g', piece_id: null, reglement_groupe: true }
    const part = (id: string, pieceId: string, montant: number): ReglementGroupe => ({
      id, dossier_id: 'd', ligne_bancaire_id: 'g', piece_id: pieceId, montant, created_at: '2027-03-10T09:00:00Z',
    })
    faux.tables.pieces = [
      piece(),
      piece({ id: 'vente2', tiers: 'Client Martin', montant_ht: 500, montant_tva: 100, montant_ttc: 600 }),
      ...faux.tables.pieces.slice(1),
    ]
    faux.tables.lignes_bancaires = [groupe, paiement('achat', -300, '2027-03-05')]
    faux.tables.reglements_groupes = [part('p1', 'vente', 1200), part('p2', 'vente2', 600)]
    await afficher()
    const l08 = ligneDe('Taux normal 20 %')
    expect(within(l08).getByText(MONTANT('1 500,00 €'))).toBeTruthy()
    expect(within(l08).getByText(MONTANT('300,00 €'))).toBeTruthy()
    expect(within(ligneDe('TVA nette due')).getByText(MONTANT('250,00 €'))).toBeTruthy()
    expect(screen.queryByText(/ne sont rattachées à aucun paiement/)).toBeNull()
  })

  // LES RECETTES ENCAISSÉES SANS FACTURE (lib/tvaDuReleve.ts) : affectées depuis le relevé à leur taux, elles
  // entrent dans la CA3 à la date du virement. L'écran doit lire les catégories — du cabinet comprises — et
  // les parts ventilées pour les voir.
  it('compte la recette affectée depuis le relevé, à son taux, et la montre', async () => {
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, encaissementAffecte()]
    await afficher()
    const l08 = ligneDe('Taux normal 20 %')
    expect(within(l08).getByText(MONTANT('1 500,00 €'))).toBeTruthy()
    expect(within(l08).getByText(MONTANT('300,00 €'))).toBeTruthy()
    expect(within(ligneDe('TVA nette due')).getByText(MONTANT('250,00 €'))).toBeTruthy()
    fireEvent.click(screen.getByText('Les 1 recette(s) du relevé retenues, ligne par ligne'))
    const ligne = ligneDe('Ventes / prestations — VIR CLIENT MARTIN')
    expect(within(ligne).getByText('20 %')).toBeTruthy()
    expect(within(ligne).getByText(MONTANT('500,00 €'))).toBeTruthy()
    expect(within(ligne).getByText(MONTANT('100,00 €'))).toBeTruthy()
  })

  it('compte la part de recette d’un mouvement ventilé', async () => {
    const remise: LigneBancaire = { ...encaissementAffecte(), id: 'v', libelle: 'REMISE CB', categorie_id: null, taux_tva: null, ventilee: true, montant: 1180 }
    const part = (o: Partial<VentilationBancaire>): VentilationBancaire => ({
      id: 'a', dossier_id: 'd', ligne_bancaire_id: 'v', categorie_id: 'c-recettes', part_personnelle: false, montant: 1200, taux_tva: 20,
      created_at: '2027-03-12T10:00:00Z', ...o,
    })
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, remise]
    faux.tables.ventilations_bancaires = [part({}), part({ id: 'b', categorie_id: 'c-frais', montant: -20, taux_tva: null })]
    await afficher()
    expect(within(ligneDe('Taux normal 20 %')).getByText(MONTANT('2 000,00 €'))).toBeTruthy()
    expect(within(ligneDe('Taux normal 20 %')).getByText(MONTANT('400,00 €'))).toBeTruthy()
  })

  it('écarte et dit la recette du relevé sans taux, au lieu de deviner sa TVA', async () => {
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, encaissementAffecte({ taux_tva: null })]
    await afficher()
    expect(within(ligneDe('Taux normal 20 %')).getByText(MONTANT('1 000,00 €'))).toBeTruthy()
    expect(screen.getByText(/1 recette\(s\) du relevé encaissée\(s\) dans la période ne sont pas dans les cases/)).toBeTruthy()
    expect(within(ligneDe('Ventes / prestations — VIR CLIENT MARTIN')).getByText(/réaffecte-la en choisissant son taux/)).toBeTruthy()
  })

  it('sur option pour les débits, écarte la recette du relevé : sa date de facture manque', async () => {
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, encaissementAffecte()]
    await afficher({ surDebits: true })
    expect(within(ligneDe('Ventes / prestations — VIR CLIENT MARTIN')).getByText(/la TVA est due à la date de la facture/)).toBeTruthy()
  })

  it('suspend l’enregistrement quand les catégories ou les parts ventilées sont lues en partie', async () => {
    for (const table of ['categories', 'ventilations_bancaires']) {
      faux.tronquees = new Set([table])
      const { unmount } = render(<Hote />)
      await act(async () => {})
      expect(screen.getByText(/Les catégories et les parts ventilées n'ont pas pu être lues en entier/)).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
      unmount()
    }
  })

  it('suspend l’enregistrement quand les parts des virements groupés sont lues en partie', async () => {
    faux.tronquees = new Set(['reglements_groupes'])
    await afficher()
    expect(screen.getByText(/Les paiements rapprochés n'ont pas pu être lus en entier/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
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
