import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TvaTab from './TvaTab'
import type {
  ANouveau, ArticleExoneration, Categorie, DeclarationTva, LigneBancaire, PeriodiciteTva, Piece, ReglementGroupe, StatutTva,
  VentilationBancaire,
} from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'
import { AvecExercicesValides } from '../../test/exercicesValides'
import { A_NOUVEAU_NON_VALIDE } from '../../test/ecritures'

// LE CALCUL EST DANS lib/declarationTva.ts ET lib/liquidationTva.ts, ET SE TESTE LÀ. Ce qui se joue ici est ce
// qu'aucun test des modules ne peut voir : l'écran montre les cases de la bonne période, reprend le crédit de la
// déclaration précédente, enregistre par la base ce qui a été déposé — sa liquidation comprise — une seule fois,
// refuse de l'enregistrer sur une lecture partielle ou quand la base le refuserait, saisit à la main une période
// antérieure à l'ouverture, dit ce qui reste à payer, et écrit le régime du dossier en annulant ce qu'il a affiché
// si la base refuse.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Tables dont la lecture s'arrête avant le compte annoncé : `lireTout` la déclare incomplète.
  tronquees: new Set<string>(),
  lectures: 0,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  misesAJour: [] as { table: string; valeurs: Record<string, unknown> }[],
  // Non nul : l'appel à la base attend qu'on le libère, pour éprouver le verrou.
  suspendue: null as null | { liberer: () => void },
  // Non nul : la relecture des déclarations qui SUIT un appel à la base attend qu'on la libère.
  relectureSuspendue: null as null | { liberer: () => void },
  miseAJourRefusee: false,
  // Non nul : la base refuse l'appel avec ce message.
  rpcRefuse: null as string | null,
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
            const suspendre = faux.relectureSuspendue && table === 'declarations_tva' && faux.rpcs.length > 0
            if (!suspendre) return Promise.resolve(reponse()).then(suite)
            return new Promise((resoudre) => { faux.relectureSuspendue!.liberer = () => resoudre(reponse()) }).then(suite)
          },
          update: (valeurs: Record<string, unknown>) => ({
            eq: () => {
              faux.misesAJour.push({ table, valeurs })
              const refus = { message: 'new row violates row-level security policy' }
              const resultat = Promise.resolve(faux.miseAJourRefusee ? { error: refus } : { error: null })
              // Le statut de TVA relit ce que la base a écrit : `assujetti_tva`, son déclencheur le déduit du statut.
              return Object.assign(resultat, {
                select: () => ({
                  single: () => Promise.resolve(faux.miseAJourRefusee
                    ? { data: null, error: refus }
                    : { data: { ...valeurs, assujetti_tva: valeurs.statut_tva === 'redevable' }, error: null }),
                }),
              })
            },
          }),
        })
        return lecture
      },
      // Les deux fonctions de la base que l'écran appelle : la déclaration s'enregistre (ou se retire) dans la table,
      // pour que la relecture la montre.
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        return new Promise((resoudre) => {
          const repondre = () => {
            if (faux.rpcRefuse) return resoudre({ error: { message: faux.rpcRefuse } })
            if (nom === 'enregistrer_declaration_tva') {
              faux.tables.declarations_tva = [...(faux.tables.declarations_tva ?? []), {
                id: `nouvelle-${faux.rpcs.length}`, dossier_id: args.p_dossier_id, periode_debut: args.p_periode_debut,
                periode_fin: args.p_periode_fin, tva_declaree: args.p_tva_declaree, credit_anterieur: args.p_credit_anterieur,
                remboursement_demande: args.p_remboursement_demande, date_declaration: args.p_date_declaration, notes: null,
                created_at: '2027-04-15T10:00:00Z', cases: args.p_cases, tva_collectee: args.p_tva_collectee,
                tva_deductible: args.p_tva_deductible, tva_deductible_immobilisations: args.p_tva_deductible_immobilisations,
              }]
            }
            if (nom === 'retirer_declaration_tva') {
              faux.tables.declarations_tva = (faux.tables.declarations_tva ?? []).filter((d) => (d as DeclarationTva).id !== args.p_declaration_id)
            }
            resoudre({ data: 0, error: null })
          }
          if (faux.suspendue) faux.suspendue.liberer = repondre
          else repondre()
        })
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
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
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
    a_nouveaux: [],
  }
}

const MONTANT = (texte: string) => new RegExp(`^${texte.replace(/ /g, '\\s')}$`)
const ligneDe = (libelle: string) => screen.getByText(libelle).closest('tr') as HTMLElement

// Les exercices validés que la page du dossier fournit (DossierDetail) : aucun par défaut.
function Hote({ periodicite = 'trimestrielle', surDebits = false, assujetti = true, statut, article = null, valides = [], espion }: {
  periodicite?: PeriodiciteTva
  surDebits?: boolean
  assujetti?: boolean
  // Le statut de TVA du dossier : redevable quand il est assujetti, à préciser sinon — sauf mention contraire.
  statut?: StatutTva | null
  article?: ArticleExoneration | null
  valides?: readonly number[]
  espion?: (m: unknown) => void
}) {
  const [regime, setRegime] = useState({ tva_periodicite: periodicite, tva_sur_debits: surDebits })
  // Comme la page du dossier : ce que la base a écrit remplace le statut ET le booléen qu'elle en déduit.
  const [tva, setTva] = useState({
    statut_tva: statut === undefined ? (assujetti ? 'redevable' as const : null) : statut,
    article_exoneration: article,
    assujetti_tva: assujetti,
  })
  return (
    <AvecExercicesValides annees={valides}>
      <TvaTab
        dossierId="d"
        assujettiTva={tva.assujetti_tva}
        statutTva={tva.statut_tva}
        articleExoneration={tva.article_exoneration}
        onStatutUpdated={(m) => { espion?.(m); setTva(m) }}
        periodicite={regime.tva_periodicite}
        surDebits={regime.tva_sur_debits}
        onRegimeUpdated={(m) => { espion?.(m); setRegime((r) => ({ ...r, ...m })) }}
      />
    </AvecExercicesValides>
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
  faux.rpcs = []
  faux.misesAJour = []
  faux.suspendue = null
  faux.relectureSuspendue = null
  faux.miseAJourRefusee = false
  faux.rpcRefuse = null
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

  // LE STATUT DE TVA SE RÈGLE ICI (ligne 28.5) — le badge « TVA » de l'en-tête y mène. Changé, il change l'onglet
  // lui-même : un dossier qui cesse d'être redevable ne prépare plus de déclaration.
  it('le statut se règle dans l’onglet : passé de redevable à la franchise, il ne prépare plus de déclaration', async () => {
    await afficher()
    expect(screen.getByText('CA3 — 1er trimestre 2027')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Changer le statut' }))
    fireEvent.click(screen.getByRole('button', { name: 'Franchise en base (art. 293 B du CGI)' }))
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { statut_tva: 'franchise', article_exoneration: null } }])
    expect(screen.getByText('Pas de déclaration de TVA')).toBeTruthy()
    expect(screen.getByText(/En franchise en base, le dossier ne facture ni ne déclare de TVA/)).toBeTruthy()
    expect(screen.queryAllByText('CA3 — 1er trimestre 2027')).toHaveLength(0)
  })

  it('un statut à préciser le dit, et l’onglet ne prépare rien', async () => {
    await afficher({ assujetti: false })
    expect(screen.getByText(/Le statut de TVA de ce dossier est à préciser/)).toBeTruthy()
    expect(screen.getByText(/Tant que son statut de TVA est à préciser/)).toBeTruthy()
  })

  it('la facturation électronique suit le statut ENREGISTRÉ, sur un redevable comme sur un exonéré', async () => {
    await afficher({ periodicite: 'mensuelle' })
    expect(screen.getByText('Facturation électronique')).toBeTruthy()
    expect(screen.getByText(/ses opérations avec l’étranger, par décade/)).toBeTruthy()
    cleanup()

    await afficher({ assujetti: false, statut: 'exonere', article: 'cgi_261_4_1' })
    expect(screen.getByText(/Exonéré, le dossier ne facture ni ne déclare de TVA/)).toBeTruthy()
    expect(screen.getByText(/^Réception des factures électroniques seulement/)).toBeTruthy()
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
    // Toutes les pièces de la période y sont : rien à dire de celles qui n'y seraient pas.
    expect(screen.queryByText(/Les pièces écartées ou à valider ci-dessus/)).toBeNull()
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

  // LA BASE ENREGISTRE LA DÉCLARATION ET SA LIQUIDATION ENSEMBLE (`enregistrer_declaration_tva`) : la TVA nette de la
  // période et le crédit reçu, pas le montant payé, ses cases, la TVA exacte des comptes, et l'écriture qui la solde.
  it('enregistre par la base la TVA nette de la période, le crédit reçu, et l’écriture qui la liquide', async () => {
    faux.tables.declarations_tva = [declaration({ tva_declaree: -80 })]
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer comme déposée' }).click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].nom).toBe('enregistrer_declaration_tva')
    expect(faux.rpcs[0].args).toMatchObject({
      p_dossier_id: 'd', p_periode_debut: '2027-01-01', p_periode_fin: '2027-03-31', p_tva_declaree: 150,
      p_credit_anterieur: 80, p_remboursement_demande: 0, p_date_declaration: '2027-04-15', p_tva_collectee: 200,
      p_tva_deductible: 50, p_tva_deductible_immobilisations: 0,
    })
    expect(faux.rpcs[0].args.p_cases).toMatchObject({ l16: 200, l20: 50, l22: 80, l28: 70, l32: 70 })
    // Le crédit reçu sort du 445670 ; ce qui reste à payer va au 445510.
    const libelle = 'CA3 1er trimestre 2027'
    expect(faux.rpcs[0].args.p_ecriture).toEqual([
      { compte: '445710', sens: 'debit', montant: 200, libelle },
      { compte: '445660', sens: 'credit', montant: 50, libelle },
      { compte: '445670', sens: 'credit', montant: 80, libelle },
      { compte: '445510', sens: 'credit', montant: 70, libelle },
    ])
    // Relue, elle apparaît comme déposée pour la période.
    expect(screen.getByText('déjà déposée')).toBeTruthy()
  })

  it('montre l’écriture de liquidation avant le clic, et l’arrondi à l’euro', async () => {
    // 1 000,40 € de recette à 20 % : 200,08 € de TVA, déclarée 200 € — huit centimes de produit.
    faux.tables.pieces = [piece({ montant_ht: 1000.40, montant_tva: 200.08, montant_ttc: 1200.48 }), ...faux.tables.pieces.slice(1)]
    faux.tables.lignes_bancaires = [paiement('vente', 1200.48, '2027-02-20'), paiement('achat', -300, '2027-03-05')]
    await afficher()
    const ecriture = screen.getByText(/Écriture de liquidation, au 31\/03\/2027/).closest('table') as HTMLElement
    expect(within(within(ecriture).getByText('445710').closest('tr') as HTMLElement).getByText(MONTANT('200,08 €'))).toBeTruthy()
    expect(within(within(ecriture).getByText('445660').closest('tr') as HTMLElement).getByText(MONTANT('50,00 €'))).toBeTruthy()
    expect(within(within(ecriture).getByText('445510').closest('tr') as HTMLElement).getByText(MONTANT('150,00 €'))).toBeTruthy()
    expect(within(within(ecriture).getByText('758000').closest('tr') as HTMLElement).getByText(MONTANT('0,08 €'))).toBeTruthy()
    expect(within(ecriture).getByText('TVA à décaisser')).toBeTruthy()
    expect(screen.getByText(/L’arrondi à l’euro des lignes de la CA3 fait 0,08\s€ de produit \(758000\)/)).toBeTruthy()
  })

  it('dit qu’il n’y a rien à liquider sur une période néant', async () => {
    await afficher()
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '1' } })
    expect(screen.getByText('Rien à liquider : la période ne porte aucune TVA.')).toBeTruthy()
  })

  // UNE PÉRIODE EN CRÉDIT (ligne 25) : le remboursement demandé (ligne 26) ne se reporte pas, il va au 445830, que le
  // virement du Trésor soldera. Le champ n'existe que sur une période en crédit.
  it('demande le remboursement d’un crédit, et l’écrit au 445830', async () => {
    faux.tables.pieces = [...faux.tables.pieces, piece({
      id: 'gros-achat', type_piece: 'achat', tiers: 'Matériel', date_piece: '2027-03-02', montant_ht: 5000, montant_tva: 1000, montant_ttc: 6000,
    })]
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, paiement('gros-achat', -6000, '2027-03-08')]
    await afficher()
    // 200 € de TVA brute, 1 050 € déductibles : 850 € de crédit.
    expect(within(ligneDe('Crédit de TVA (ligne 23 − ligne 16)')).getByText(MONTANT('850,00 €'))).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Remboursement demandé (ligne 26)'), { target: { value: '800' } })
    expect(within(ligneDe('Crédit de TVA à reporter (ligne 25 − ligne 26)')).getByText(MONTANT('50,00 €'))).toBeTruthy()
    // Au-dessus du seuil de 760 € : rien à redire.
    expect(screen.queryByText(/n’est accordé qu’à partir de/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer comme déposée' }).click() })
    expect(faux.rpcs[0].args).toMatchObject({ p_remboursement_demande: 800, p_tva_declaree: -850 })
    const comptes = (faux.rpcs[0].args.p_ecriture as { compte: string; sens: string; montant: number }[])
      .map((l) => [l.compte, l.sens, l.montant])
    expect(comptes).toEqual([
      ['445710', 'debit', 200], ['445660', 'credit', 1050], ['445670', 'debit', 50], ['445830', 'debit', 800],
    ])
  })

  it('signale un remboursement sous le seuil, et refuse avant le clic ce que la base refuserait', async () => {
    faux.tables.pieces = [...faux.tables.pieces, piece({
      id: 'gros-achat', type_piece: 'achat', tiers: 'Matériel', date_piece: '2027-03-02', montant_ht: 5000, montant_tva: 1000, montant_ttc: 6000,
    })]
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, paiement('gros-achat', -6000, '2027-03-08')]
    await afficher()
    const champ = screen.getByLabelText('Remboursement demandé (ligne 26)')
    const bouton = () => screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement
    fireEvent.change(champ, { target: { value: '300' } })
    expect(screen.getByText(/n’est accordé qu’à partir de 760,00\s€ en cours d’année/)).toBeTruthy()
    expect(bouton().disabled).toBe(false)
    fireEvent.change(champ, { target: { value: '900' } })
    expect(screen.getByText('Le remboursement demandé (ligne 26) dépasse le crédit de TVA de la période (ligne 25).')).toBeTruthy()
    expect(bouton().disabled).toBe(true)
    fireEvent.change(champ, { target: { value: '300,50' } })
    expect(screen.getByText('Le remboursement demandé (ligne 26) se demande en euros entiers.')).toBeTruthy()
    expect(bouton().disabled).toBe(true)
    await act(async () => { bouton().click() })
    expect(faux.rpcs).toEqual([])
  })

  // Ce qu'il gardait d'une saisie ne la suit pas quand la période cesse d'être en crédit : le champ disparaît, et un
  // remboursement que l'écran ne montre plus ne doit pas faire refuser l'enregistrement.
  it('oublie le remboursement saisi quand la période cesse d’être en crédit', async () => {
    // 1 000 € de crédit reçu de la déclaration précédente : 850 € de crédit sur la période.
    faux.tables.declarations_tva = [declaration({ tva_declaree: -1000 })]
    await afficher()
    fireEvent.change(screen.getByLabelText('Remboursement demandé (ligne 26)'), { target: { value: '800' } })
    fireEvent.change(screen.getByLabelText(/Crédit reporté/), { target: { value: '0' } })
    expect(screen.queryByLabelText('Remboursement demandé (ligne 26)')).toBeNull()
    expect(screen.queryByText(/dépasse le crédit de TVA de la période/)).toBeNull()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(false)
    await act(async () => { bouton.click() })
    expect(faux.rpcs[0].args).toMatchObject({ p_remboursement_demande: 0, p_credit_anterieur: 0, p_tva_declaree: 150 })
  })

  // Le champ n'est proposé que sur une période en crédit : ce qu'il gardait d'une saisie ne compte plus ailleurs.
  it('ne propose pas de remboursement sur une période qui n’est pas en crédit', async () => {
    await afficher()
    expect(screen.queryByLabelText('Remboursement demandé (ligne 26)')).toBeNull()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('dit le refus de la base, sans rien croire enregistré', async () => {
    faux.rpcRefuse = 'La déclaration proposée ne se tient pas : ses lignes ne se déduisent pas les unes des autres.'
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer comme déposée' }).click() })
    expect(screen.getByText('La déclaration proposée ne se tient pas : ses lignes ne se déduisent pas les unes des autres.')).toBeTruthy()
    expect(screen.queryByText('déjà déposée')).toBeNull()
  })

  it('refuse avant le clic une période d’un exercice validé', async () => {
    // Un mouvement de 2026 au relevé : l'année est proposée.
    faux.tables.lignes_bancaires = [...faux.tables.lignes_bancaires, paiement('ancienne', -50, '2026-11-05')]
    await afficher({ valides: [2026] })
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '3' } })
    expect(screen.getByText('CA3 — 4e trimestre 2026')).toBeTruthy()
    expect(screen.getByText('L\'exercice 2026 est validé : une déclaration de TVA ne s’y enregistre plus.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // UNE PÉRIODE ANTÉRIEURE À L'OUVERTURE D'UN DOSSIER REPRIS se saisit à la main : sa TVA est dans les à-nouveaux, elle
  // n'écrit pas de liquidation, et sert à rapprocher son paiement et à reporter son crédit.
  it('saisit à la main une période antérieure à l’ouverture, sans liquidation', async () => {
    const ouverture: ANouveau = {
      id: 'an', dossier_id: 'd', date: '2027-01-01', compte: '445510', compte_origine: '44551', libelle: 'TVA à décaisser',
      sens: 'credit', montant: 120, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2027-01-05T09:00:00Z',
    }
    faux.tables.a_nouveaux = [ouverture]
    await afficher()
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '3' } })
    expect(screen.getByText('Déclaration du 4e trimestre 2026')).toBeTruthy()
    expect(screen.queryByText('CA3 — 4e trimestre 2026')).toBeNull()
    const bouton = screen.getByRole('button', { name: 'Enregistrer la déclaration' }) as HTMLButtonElement
    // Sans TVA saisie, rien ne s'enregistre.
    expect(bouton.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('TVA nette de la période (ligne 16 moins lignes 19 à 21)'), { target: { value: '120' } })
    expect(bouton.disabled).toBe(false)
    await act(async () => { bouton.click() })
    expect(faux.rpcs[0].args).toMatchObject({
      p_periode_debut: '2026-10-01', p_periode_fin: '2026-12-31', p_tva_declaree: 120, p_credit_anterieur: 0,
      p_remboursement_demande: 0, p_cases: null, p_tva_collectee: null, p_ecriture: [],
    })
  })

  it('n’enregistre qu’une fois sur trois clics rapprochés', async () => {
    faux.suspendue = { liberer: () => {} }
    await afficher()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { faux.suspendue!.liberer() })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByText('déjà déposée')).toBeTruthy()
  })

  it('tient le verrou jusqu’à la relecture : un clic pendant qu’elle court n’enregistre pas deux fois', async () => {
    // Relâché avant la relecture, un second clic enregistrerait la même déclaration une seconde
    // fois, la mention « déjà déposée » n'étant pas encore revenue.
    faux.relectureSuspendue = { liberer: () => {} }
    await afficher()
    const bouton = screen.getByRole('button', { name: 'Enregistrer comme déposée' })
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
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
    expect(faux.rpcs).toEqual([])
  })

  it('suspend aussi sur l’ouverture lue à moitié : elle décide de ce qui se saisit à la main', async () => {
    faux.tronquees = new Set(['a_nouveaux'])
    await afficher()
    expect(screen.getByText(/L’ouverture du dossier n'a pas pu être lue en entier/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('suspend aussi sur l’historique des déclarations lu à moitié : le crédit proposé en dépend', async () => {
    faux.tronquees = new Set(['declarations_tva'])
    await afficher()
    expect((screen.getByRole('button', { name: 'Enregistrer comme déposée' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // Une déclaration préparée par l'application porte ses cases ; celle saisie à la main avant l'ouverture, non.
  const preparee = (o: Partial<DeclarationTva>) => declaration({
    cases: {}, tva_collectee: 0, tva_deductible: 0, tva_deductible_immobilisations: 0, ...o,
  })

  it('compare chaque déclaration déposée au calcul de sa période', async () => {
    // Déposée à 100 €, alors que le trimestre en porte 150 aujourd'hui : une pièce a changé depuis.
    faux.tables.declarations_tva = [preparee({ id: 't1', periode_debut: '2027-01-01', periode_fin: '2027-03-31', tva_declaree: 100 })]
    await afficher()
    const ligne = screen.getAllByText('1er trimestre 2027').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText(MONTANT('-50,00 €'))).toBeTruthy()
  })

  it('ne signale aucun écart quand le recalcul retombe sur le dépôt', async () => {
    faux.tables.declarations_tva = [preparee({ id: 't1', periode_debut: '2027-01-01', periode_fin: '2027-03-31', tva_declaree: 150 })]
    await afficher()
    const ligne = screen.getAllByText('1er trimestre 2027').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText('aucun')).toBeTruthy()
  })

  it('ne compare pas au calcul une déclaration saisie à la main', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    await afficher()
    const ligne = screen.getAllByText('4e trimestre 2026').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText('saisie à la main, avant l’ouverture')).toBeTruthy()
  })

  // CE QUE CHAQUE DÉCLARATION FAIT PAYER, ET CE QUE LE RELEVÉ EN PORTE (`suiviDesDeclarations`).
  it('dit ce qui reste à payer d’une déclaration, et ce qui est payé', async () => {
    const q4 = (id: string, aPayer: number) => preparee({ id, tva_declaree: aPayer, cases: { l28: aPayer, l32: aPayer } })
    const prelevement = (id: string, montant: number, decl: string): LigneBancaire => ({
      ...paiement('x', montant, '2027-01-20'), id, piece_id: null, declaration_tva_id: decl,
    })
    faux.tables.declarations_tva = [
      q4('d1', 150),
      { ...q4('d2', 150), periode_debut: '2026-07-01', periode_fin: '2026-09-30' },
      { ...q4('d3', 150), periode_debut: '2026-04-01', periode_fin: '2026-06-30' },
    ]
    faux.tables.lignes_bancaires = [
      ...faux.tables.lignes_bancaires, prelevement('p2', -150, 'd2'), prelevement('p3', -100, 'd3'),
    ]
    await afficher()
    const ligneDeLaPeriode = (libelle: string) =>
      screen.getAllByText(libelle).map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligneDeLaPeriode('4e trimestre 2026')).getByText(/^150,00\s€ à payer$/)).toBeTruthy()
    expect(within(ligneDeLaPeriode('3e trimestre 2026')).getByText('payée').className).toContain('badge-ok')
    expect(within(ligneDeLaPeriode('2e trimestre 2026')).getByText(/payée 100,00\s€ sur 150,00\s€/)).toBeTruthy()
  })

  // Un trop-payé — une majoration, un prélèvement en double — n'est pas une bonne nouvelle : la pastille le dit en rouge,
  // pour ce qui dépasse.
  it('dit en rouge une déclaration payée de trop', async () => {
    faux.tables.declarations_tva = [preparee({ id: 'd1', tva_declaree: 150, cases: { l28: 150, l32: 150 } })]
    faux.tables.lignes_bancaires = [
      ...faux.tables.lignes_bancaires,
      { ...paiement('x', -160, '2027-01-20'), id: 'p1', piece_id: null, declaration_tva_id: 'd1' },
    ]
    await afficher()
    const ligne = screen.getAllByText('4e trimestre 2026').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText(/^payée 10,00\s€ de trop$/).className).toContain('badge-danger')
  })

  it('ne dit pas ce qui reste dû sur un relevé lu en partie', async () => {
    faux.tables.declarations_tva = [preparee({ id: 'd1', tva_declaree: 150, cases: { l28: 150, l32: 150 } })]
    faux.tronquees = new Set(['lignes_bancaires'])
    await afficher()
    const ligne = screen.getAllByText('4e trimestre 2026').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).queryByText(/à payer/)).toBeNull()
  })

  it('ne propose pas de retirer une déclaration figée par la validation', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    await afficher({ valides: [2026] })
    const ligne = screen.getAllByText('4e trimestre 2026').map((n) => n.closest('tr')).find((tr) => tr !== null) as HTMLElement
    expect(within(ligne).getByText('figée')).toBeTruthy()
    expect(within(ligne).queryByRole('button', { name: 'Retirer' })).toBeNull()
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
    // Près du bouton : enregistrée, la déclaration ne les liquidera pas.
    expect(screen.getByText(/Les pièces écartées ou à valider ci-dessus ne sont pas dans la déclaration qui sera enregistrée/)).toBeTruthy()
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

  // UN MOIS SE NOMME AVEC SA PRÉPOSITION (lib/declarationTva.ts, `dePeriode`) : « de novembre », « d’octobre » — et
  // non « du octobre », que la phrase écrite pour un trimestre produisait.
  it('nomme une période mensuelle avec sa préposition', async () => {
    faux.tables.declarations_tva = [declaration({ id: 'oct', periode_debut: '2026-10-01', periode_fin: '2026-10-31', tva_declaree: -80 })]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await afficher({ periodicite: 'mensuelle' })
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '10' } })
    expect(screen.getByText('CA3 — novembre 2026')).toBeTruthy()
    expect(screen.getByText('Repris de la déclaration d’octobre 2026, sa ligne 27.')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(confirmer.mock.calls[0][0]).toMatch(/^Retirer la déclaration d’octobre 2026 \? /)
    confirmer.mockRestore()
  })

  it('nomme avec sa préposition le mois d’une déclaration saisie à la main', async () => {
    faux.tables.a_nouveaux = [{
      id: 'an', dossier_id: 'd', date: '2027-01-01', compte: '445670', compte_origine: '44567', libelle: 'Crédit de TVA',
      sens: 'debit', montant: 80, source_nom: 'balance.csv', source_empreinte: 'a'.repeat(64), ...A_NOUVEAU_NON_VALIDE,
      created_at: '2027-01-05T09:00:00Z',
    }]
    await afficher({ periodicite: 'mensuelle' })
    fireEvent.change(screen.getByLabelText('Année'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '9' } })
    expect(screen.getByText('Déclaration d’octobre 2026')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '10' } })
    expect(screen.getByText('Déclaration de novembre 2026')).toBeTruthy()
  })

  it('demande confirmation avant de retirer une déclaration, en nommant ce qui part', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(confirmer.mock.calls[0][0]).toBe(
      'Retirer la déclaration du 4e trimestre 2026 ? Le crédit qu’elle reporte ne sera plus proposé sur la déclaration suivante.',
    )
    expect(faux.rpcs).toEqual([{ nom: 'retirer_declaration_tva', args: { p_declaration_id: 't4' } }])
    expect(screen.getByText('Aucune déclaration enregistrée pour ce dossier.')).toBeTruthy()
    confirmer.mockRestore()
  })

  it('nomme la liquidation et les paiements qui partent avec une déclaration préparée', async () => {
    faux.tables.declarations_tva = [preparee({ id: 'd1', tva_declaree: 150, cases: { l28: 150, l32: 150 } })]
    faux.tables.lignes_bancaires = [
      ...faux.tables.lignes_bancaires, { ...paiement('x', -150, '2027-01-20'), id: 'p1', piece_id: null, declaration_tva_id: 'd1' },
    ]
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(confirmer.mock.calls[0][0]).toBe(
      'Retirer la déclaration du 4e trimestre 2026 ? Son écriture de liquidation part avec elle, 1 mouvement(s) qui la paient '
      + 'retournent à traiter sans leur écriture et le crédit qu’elle reporte ne sera plus proposé sur la déclaration suivante.',
    )
    // Refusée, rien ne part.
    expect(faux.rpcs).toEqual([])
    confirmer.mockRestore()
  })

  it('ne retire qu’une fois sur trois clics rapprochés', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    faux.suspendue = { liberer: () => {} }
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await afficher()
    const bouton = screen.getByRole('button', { name: 'Retirer' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(confirmer).toHaveBeenCalledTimes(1)
    await act(async () => { faux.suspendue!.liberer() })
    confirmer.mockRestore()
  })

  it('dit le refus de la base quand le retrait échoue', async () => {
    faux.tables.declarations_tva = [declaration({ id: 't4' })]
    faux.rpcRefuse = 'Une écriture de cette déclaration — sa liquidation ou un paiement — est validée : elle ne se retire plus.'
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await afficher()
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(screen.getByText(faux.rpcRefuse)).toBeTruthy()
    confirmer.mockRestore()
  })
})
