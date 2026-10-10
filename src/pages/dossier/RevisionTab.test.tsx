import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RevisionTab from './RevisionTab'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import { usePanneauDroit } from '../../lib/panneauDroit'
import { useAnnee } from '../../context/AnneeContext'
import { ContexteDossier } from '../../test/exercicesValides'
import { DOSSIER, decision, citation, ecritureEquilibree, soldeReporte } from '../../test/revision'
import { conclusion, noteDuJournal, revue } from '../../test/revisionRevue'
import { TEXTES_DES_PREUVES } from '../../lib/revisionPreuves'
import { PROGRAMME_DES_CYCLES } from '../../lib/revisionRevue'
import type { ModeleComptable } from '../../lib/engagement'
import type { DossierTab } from '../../lib/ongletsDossier'
import type { LigneBancaire, Piece } from '../../lib/types'
import type { ValeurAnnee } from '../../components/AnneeTabs'

// L'ONGLET DE LA RÉVISION (ligne 41, étape R3). Le module (lib/revision.ts, R2) est éprouvé à part : états, preuves,
// refus confrontés au texte de `justifier_solde` et rejoués sur l'essai de la base. CE QUI SE JOUE ICI, c'est ce qu'aucun
// calcul pur ne voit : que l'écran lise TOUT le dossier, et rien d'un autre (le faux client applique les filtres) ; qu'il
// ne dise rien avant d'avoir lu, ni sur une lecture partielle ; que les refus se lisent AVANT le clic et grisent leur
// bouton ; que la décision parte par `justifier_solde` SEULE, une fois, sous un verrou relâché APRÈS la relecture ; que
// la reprise de l'exercice précédent remplisse sans écrire ; que les contrôles de la Vue d'ensemble se rangent dans leur
// cycle.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Les tables dont la lecture est refusée : `lireTout` les rend incomplètes.
  refusees: new Set<string>(),
  // Une promesse que chaque LECTURE attend : le temps de voir l'écran avant toute réponse, ou pendant une relecture.
  attente: null as Promise<void> | null,
  // Les lectures demandées, table par table.
  lectures: {} as Record<string, number>,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  // La réponse d'un appel de fonction ; sans elle, `justifier_solde` écrit la décision comme la base.
  reponseRpc: null as null | ((nom: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>),
  relevesIllisibles: false,
  // Le compte connecté est-il chef du cabinet (la revue d'un cycle lui est réservée, hypothèse Q2) ?
  estChef: false,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: ReturnType<typeof predicatEq>[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const reponse = () => {
      faux.lectures[table] = (faux.lectures[table] ?? 0) + 1
      if (faux.refusees.has(table)) return { data: null, error: { message: 'permission denied' }, count: null }
      const lignes = filtrer(faux.tables[table] ?? [], predicats)
      return { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }
    }
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => (faux.attente ?? Promise.resolve()).then(() => {
        const r = reponse()
        return { data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error }
      }),
      then: (suite: (r: unknown) => unknown) => (faux.attente ?? Promise.resolve()).then(reponse).then(suite),
    })
    return c
  }
  return {
    supabase: {
      from: (table: string) => chaine(table),
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        return faux.reponseRpc ? faux.reponseRpc(nom, args) : Promise.resolve({ data: null, error: null })
      },
    },
  }
})
vi.mock('../../lib/controlesReleves', () => ({
  chargerRelevesIncoherents: async () => {
    if (faux.relevesIllisibles) throw new Error('lecture refusée')
    return []
  },
}))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, estChef: faux.estChef }) }))

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000' }
const HASH = 'e'.repeat(64)
// Des identifiants d'uuid : la base refuse une preuve qui n'en cite pas un (refus 12), et l'écran le dit avant elle.
const P_RELEVE = '00000000-0000-4000-8000-0000000000a1'
const P_TABLEAU = '00000000-0000-4000-8000-0000000000a2'

function piece(o: Partial<Piece>): Piece {
  return {
    id: 'p', dossier_id: DOSSIER, uploaded_by: null, source: 'upload', storage_path: `${DOSSIER}/tableau.pdf`,
    nom_fichier: 'tableau-emprunt.pdf', storage_hash: HASH, date_piece: '2024-01-10', tiers: 'BANQUE FICTIVE', montant_ht: null,
    montant_tva: null, montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: 'haute',
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, created_at: '2024-01-12T09:00:00Z',
    updated_at: '2024-01-12T09:00:00Z', ...o,
  }
}

function ligne(o: Partial<LigneBancaire>): LigneBancaire {
  return {
    id: 'l', dossier_id: DOSSIER, date: '2025-06-01', libelle: 'VIREMENT FICTIF', montant: 10, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null,
    emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
    declaration_tva_id: null, prelevement_personnel: false, source_fichier: 'releve-fictif.pdf', libelle_brut: 'VIREMENT FICTIF',
    id_externe: null, created_at: '2025-06-02T10:00:00Z', ...o,
  }
}

// La base fictive : `justifier_solde` écrit la décision et ses preuves comme la fonction, et `verifier_exercice_valide`
// rend vrai.
let numero = 0
function rpcCommeLaBase(nom: string, args: Record<string, unknown>) {
  if (nom === 'justifier_solde') {
    numero++
    const id = `j-ecrite-${numero}`
    faux.tables.revision_justifications.push(decision({
      id, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee), compte: String(args.p_compte), solde: Number(args.p_solde),
      etat: args.p_etat as 'justifie', motif: (args.p_motif as string | null) ?? null, portee: args.p_portee as 'exercice',
      preuve_application: (args.p_preuve_application as Record<string, unknown> | null) ?? null,
      remplace_id: (args.p_remplace_id as string | null) ?? null, reprise_de: (args.p_reprise_de as string | null) ?? null,
      auteur: 'u1', cree_le: '2026-03-15T10:00:00+00:00',
    }))
    for (const [n, p] of (args.p_preuves as { piece_id?: string; document_id?: string; precision?: string }[]).entries()) {
      faux.tables.revision_preuves.push(citation({
        id: `rp-${id}-${n}`, justification_id: id, piece_id: p.piece_id ?? null, document_id: p.document_id ?? null,
        empreinte: HASH, precision: p.precision ?? null,
      }))
    }
    return Promise.resolve({ data: [{ id }], error: null })
  }
  // Les trois fonctions des cycles (étape R4) écrivent leur ligne comme la base, à un instant qui avance d'une minute par
  // écriture : l'état d'un cycle lit l'ordre des conclusions, des notes et des revues.
  if (nom === 'conclure_cycle') {
    numero++
    const id = `k-ecrite-${numero}`
    faux.tables.revision_conclusions.push(conclusion({
      id, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee), cycle: String(args.p_cycle), etat: args.p_etat as 'revise',
      travaux: args.p_travaux, conclusion: String(args.p_conclusion), a_suivre: (args.p_a_suivre as string | null) ?? null,
      remplace_id: (args.p_remplace_id as string | null) ?? null, auteur: 'u1', cree_le: instantEcrit(),
    }))
    return Promise.resolve({ data: id, error: null })
  }
  if (nom === 'noter_revision') {
    numero++
    faux.tables.revision_notes.push(noteDuJournal({
      id: `n-ecrite-${numero}`, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee), cycle: String(args.p_cycle),
      nature: args.p_nature as 'travail', texte: String(args.p_texte), auteur: 'u1', cree_le: instantEcrit(),
    }))
    return Promise.resolve({ data: null, error: null })
  }
  if (nom === 'revoir_cycle') {
    numero++
    faux.tables.revision_revues.push(revue({
      id: `v-ecrite-${numero}`, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee),
      conclusion_id: String(args.p_conclusion_id), avis: args.p_avis as 'approuve', observation: (args.p_observation as string | null) ?? null,
      revu_par: 'u1', revu_le: instantEcrit(),
    }))
    return Promise.resolve({ data: null, error: null })
  }
  if (nom === 'verifier_exercice_valide') return Promise.resolve({ data: true, error: null })
  return Promise.resolve({ data: null, error: { message: `fonction inconnue : ${nom}` } })
}

// L'instant d'une écriture fictive : le 15 mars 2026, une minute de plus à chaque écriture.
const instantEcrit = () => `2026-03-15T10:${String(numero).padStart(2, '0')}:00+00:00`

// Un dossier dont l'exercice 2025 se révise : rien ne le précède, et 2025 est terminé (le 15 mars 2026 à Paris).
function dossier2025() {
  faux.tables = {
    ecritures_brouillon: [
      ...ecritureEquilibree('e1', '2025-06-01', '512000', '706000', 1000),
      ...ecritureEquilibree('e2', '2025-07-01', '108000', '512000', 200),
      // Un autre dossier : rien de lui ne doit compter ici.
      ...ecritureEquilibree('x1', '2025-06-01', '512000', '101000', 99_999, { dossier_id: 'autre-dossier' }),
    ],
    pieces: [], lignes_bancaires: [], cotisations_declarees: [], immobilisations: [], natures_immobilisation: [], categories: [],
    a_nouveaux: [], emprunts: [], ventilations_bancaires: [], reglements_groupes: [], vehicules: [], lettrages_manuels: [],
    declarations_tva: [], factures_emises: [], transmissions_factures: [], informations_dossier: [], exercices_clotures: [],
    soldes_reportes: [], controles_releves_bancaires: [], documents_divers: [], revision_justifications: [], revision_preuves: [],
    revision_conclusions: [], revision_notes: [], revision_revues: [],
  }
}

function rendre(o: { annee?: ValeurAnnee; valides?: number[]; onNavigate?: (t: DossierTab) => void } = {}) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee={o.annee ?? 2025} valides={o.valides ?? []}>
        <RevisionTab
          dossierId={DOSSIER} modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere"
          onNavigate={o.onNavigate ?? (() => {})}
        />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

// Un autre contenu du volet de droite — l'assistant, la fiche d'une pièce —, qui demande la place.
function AutreContenu() {
  const { ouvrir } = usePanneauDroit('autre')
  return (
    <>
      <button type="button" onClick={() => ouvrir()}>Ouvrir un autre contenu</button>
      <PanneauDroit nom="autre"><p>Autre contenu</p></PanneauDroit>
    </>
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const cycle = (libelle: string) => screen.getByRole('region', { name: `Cycle ${libelle}` })
const texte = (el: Element) => (el.textContent ?? '').replace(/\s/g, ' ')
const bouton = (nom: string) => within(volet()).getByRole('button', { name: nom }) as HTMLButtonElement

async function ouvrir(compte: string) {
  const b = await screen.findByRole('button', { name: `Ouvrir le compte ${compte}` })
  await act(async () => { fireEvent.click(b) })
}

function saisirMotif(valeur: string) {
  fireEvent.change(within(volet()).getByLabelText('Motif'), { target: { value: valeur } })
}

beforeEach(() => {
  faux.tables = {}
  faux.refusees = new Set()
  faux.attente = null
  faux.lectures = {}
  faux.appels = []
  faux.reponseRpc = rpcCommeLaBase
  faux.relevesIllisibles = false
  faux.estChef = false
  numero = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RevisionTab — rien avant d’avoir lu, rien sur une lecture partielle', () => {
  it('n’affirme rien tant que les lectures ne sont pas revenues', async () => {
    dossier2025()
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeDefined()
    expect(screen.queryByText('à justifier')).toBeNull()
    expect(screen.queryByRole('button', { name: /Ouvrir le compte/ })).toBeNull()
    await act(async () => { liberer() })
    expect(await screen.findByRole('button', { name: 'Ouvrir le compte 512000' })).toBeDefined()
  })

  it('une lecture partielle se dit, et l’écran n’offre ni état ni geste', async () => {
    dossier2025()
    faux.refusees.add('revision_preuves')
    rendre()
    expect(await screen.findByText(/Les preuves citées par la révision n'ont pas pu être lues en entier \(.*permission denied\)/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Ouvrir le compte/ })).toBeNull()
    expect(screen.queryByText('à justifier')).toBeNull()
  })

  // CHAQUE lecture, refusée, suspend la révision : celles de la Vue d'ensemble comme les siennes. Une collection
  // oubliée du compte des lectures partielles laisserait l'écran affirmer des états sur une liste incomplète.
  it.each([
    'pieces', 'cotisations_declarees', 'lignes_bancaires', 'immobilisations', 'natures_immobilisation', 'categories',
    'ecritures_brouillon', 'a_nouveaux', 'emprunts', 'ventilations_bancaires', 'reglements_groupes', 'vehicules',
    'lettrages_manuels', 'declarations_tva', 'factures_emises', 'transmissions_factures', 'informations_dossier',
    'exercices_clotures', 'soldes_reportes', 'controles_releves_bancaires', 'documents_divers', 'revision_justifications',
    'revision_preuves', 'revision_conclusions', 'revision_notes', 'revision_revues',
  ])('la table %s refusée : un bandeau, et ni état ni geste', async (table) => {
    dossier2025()
    faux.refusees.add(table)
    rendre()
    // « n'ont pas pu être lues », ou « n'a pas pu être lu » (le journal des cycles).
    expect(await screen.findByText(/pas pu être lu(e)?s? en entier/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Ouvrir le compte/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Ouvrir le cycle/ })).toBeNull()
    expect(screen.queryByText('à justifier')).toBeNull()
  })

  it('les relevés qui ne bouclent pas, illisibles, suspendent aussi la révision', async () => {
    dossier2025()
    faux.relevesIllisibles = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rendre()
    expect(await screen.findByText(/Les relevés qui ne bouclent pas n'ont pas pu être lus en entier/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Ouvrir le compte/ })).toBeNull()
  })

  it('lit le dossier entier, et rien d’un autre dossier', async () => {
    dossier2025()
    rendre()
    await screen.findByRole('button', { name: 'Ouvrir le compte 512000' })
    // 1 000 encaissés, 200 prélevés : 800 au débit — le 99 999 de l'autre dossier n'y est pas.
    const tresorerie = cycle('Trésorerie')
    expect(texte(within(tresorerie).getByText('512000').closest('tr') as Element)).toContain('800,00 € au débit')
    for (const table of ['ecritures_brouillon', 'revision_justifications', 'revision_preuves', 'soldes_reportes', 'documents_divers']) {
      expect(faux.lectures[table], table).toBeGreaterThan(0)
    }
  })

  it('sans exercice choisi, demande d’en choisir un', async () => {
    dossier2025()
    rendre({ annee: 'toutes' })
    expect(await screen.findByText(/choisis-en un en tête du dossier/)).toBeDefined()
  })
})

describe('RevisionTab — les soldes, par cycle', () => {
  it('range la banque à la trésorerie et l’exploitant aux capitaux, chacun avec son état et sa preuve', async () => {
    dossier2025()
    rendre()
    await screen.findByRole('button', { name: 'Ouvrir le compte 512000' })
    const banque = within(cycle('Trésorerie')).getByText('512000').closest('tr') as HTMLElement
    expect(within(banque).getByText('à justifier')).toBeDefined()
    const exploitant = within(cycle('Exploitant et capitaux')).getByText('108000').closest('tr') as HTMLElement
    expect(texte(exploitant)).toContain('200,00 € au débit')
    expect(within(exploitant).getByText('décrit le solde')).toBeDefined()
    // Les tuiles comptent les deux soldes à justifier.
    expect(texte(screen.getByText('Soldes à justifier').closest('.kpi') as Element)).toContain('2')
  })

  it('range les points de la Vue d’ensemble dans leur cycle, et mène à l’onglet où agir', async () => {
    dossier2025()
    faux.tables.lignes_bancaires = [ligne({ id: 'l1' })]
    const onNavigate = vi.fn()
    rendre({ onNavigate })
    await screen.findByRole('button', { name: 'Ouvrir le compte 512000' })
    const tresorerie = cycle('Trésorerie')
    expect(within(tresorerie).getByText('1 ligne(s) bancaire(s) non rapprochée(s)')).toBeDefined()
    fireEvent.click(within(tresorerie).getByRole('button', { name: 'Voir les opérations à rapprocher' }))
    expect(onNavigate).toHaveBeenCalledWith('banque')
  })

  it('un exercice en cours le dit sous les mots de la base, et le panneau n’offre aucune décision', async () => {
    dossier2025()
    faux.tables.ecritures_brouillon = ecritureEquilibree('e3', '2026-02-01', '512000', '706000', 50)
    rendre({ annee: 2026 })
    expect(await screen.findByText('L\'exercice 2026 n\'est pas terminé : ses soldes se justifient une fois clos.')).toBeDefined()
    await ouvrir('512000')
    expect(within(volet()).queryByRole('button', { name: 'Justifier' })).toBeNull()
    expect(within(volet()).getAllByText('L\'exercice 2026 n\'est pas terminé : ses soldes se justifient une fois clos.')).toHaveLength(1)
  })

  it('un exercice dont l’ouverture attend le dit, et mène à Clôture', async () => {
    dossier2025()
    faux.tables.ecritures_brouillon.push(...ecritureEquilibree('e0', '2024-12-01', '512000', '706000', 10))
    const onNavigate = vi.fn()
    rendre({ onNavigate })
    expect(await screen.findByText('L\'exercice 2024 n\'est pas validé : les soldes de 2025 ne sont pas encore définitifs.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2024 dans Clôture' }))
    expect(onNavigate).toHaveBeenCalledWith('cloture')
    expect(within(cycle('Trésorerie')).getByText('en attente')).toBeDefined()
  })
})

describe('RevisionTab — décider d’un solde', () => {
  it('la preuve se dit — ce qu’elle établit et n’établit pas —, et les refus se lisent avant le clic, boutons grisés', async () => {
    dossier2025()
    rendre()
    await ouvrir('512000')
    expect(within(volet()).getByText(TEXTES_DES_PREUVES.releve.etablit)).toBeDefined()
    expect(within(volet()).getByText(TEXTES_DES_PREUVES.releve.netablitPas)).toBeDefined()
    expect(bouton('Justifier').disabled).toBe(true)
    expect(bouton('Accepter sur motif').disabled).toBe(true)
    expect(bouton('Signaler une anomalie').disabled).toBe(true)
    expect(texte(volet())).toContain('« Justifier » : Un solde justifié cite au moins une pièce, un document ou la preuve de l\'application.')
    expect(texte(volet())).toContain('« Accepter sur motif » : Un solde accepté sans pièce se motive.')
    expect(texte(volet())).toContain('« Signaler une anomalie » : Une anomalie se motive.')
    expect(faux.appels).toEqual([])
  })

  it('« Accepter sur motif » écrit par justifier_solde seule, avec les onze arguments, puis relit : l’état et l’historique le disent', async () => {
    dossier2025()
    rendre()
    await ouvrir('512000')
    saisirMotif('Écart d’un chèque remis en janvier')
    expect(bouton('Accepter sur motif').disabled).toBe(false)
    await act(async () => { bouton('Accepter sur motif').click() })

    expect(faux.appels).toEqual([{
      nom: 'justifier_solde',
      args: {
        p_dossier_id: DOSSIER, p_annee: 2025, p_compte: '512000', p_solde: 800, p_etat: 'accepte',
        p_motif: 'Écart d’un chèque remis en janvier', p_portee: 'exercice', p_preuves: [], p_preuve_application: null,
        p_remplace_id: null, p_reprise_de: null,
      },
    }])
    const banque = within(cycle('Trésorerie')).getByText('512000').closest('tr') as HTMLElement
    expect(await within(banque).findByText('accepté sur motif')).toBeDefined()
    expect(texte(volet())).toContain('par toi, pour un solde de 800,00 € au débit.')
    expect(texte(volet())).toContain('Motif : Écart d’un chèque remis en janvier')
    // La saisie repart vide : la décision écrite est la courante, et la suivante la remplacera.
    expect((within(volet()).getByLabelText('Motif') as HTMLTextAreaElement).value).toBe('')
    expect(texte(volet())).toContain('Celle-ci remplacera la décision courante.')

    // La suivante remplace la courante, nommément : la base refuserait sinon (« relire avant de décider »).
    saisirMotif('Second motif')
    await act(async () => { bouton('Accepter sur motif').click() })
    expect(faux.appels).toHaveLength(2)
    expect(faux.appels[1].args.p_remplace_id).toBe('j-ecrite-1')
  })

  it('« Justifier » avec la preuve de l’application : son instantané part, et une source citée part avec sa précision', async () => {
    dossier2025()
    faux.tables.pieces = [piece({ id: P_RELEVE, nom_fichier: 'releve-decembre.pdf', date_piece: '2025-12-31' })]
    rendre()
    await ouvrir('512000')
    fireEvent.click(within(volet()).getByRole('checkbox'))
    fireEvent.change(within(volet()).getByRole('searchbox'), { target: { value: 'decembre' } })
    fireEvent.click(within(volet()).getByRole('button', { name: 'Citer' }))
    fireEvent.change(within(volet()).getByLabelText('Précision pour releve-decembre.pdf'), { target: { value: 'page 2' } })
    await act(async () => { bouton('Justifier').click() })

    expect(faux.appels).toHaveLength(1)
    const args = faux.appels[0].args
    expect(args.p_etat).toBe('justifie')
    expect(args.p_preuves).toEqual([{ piece_id: P_RELEVE, precision: 'page 2' }])
    expect(args.p_preuve_application).toMatchObject({ version: 1, type: 'releve', compte: '512000', annee: 2025, soldeCentimes: 80_000 })
  })

  it('le verrou : deux puis trois clics dans le même `act` n’envoient qu’une décision', async () => {
    dossier2025()
    let repondre = () => {}
    faux.reponseRpc = (nom, args) => new Promise((r) => { repondre = () => { void rpcCommeLaBase(nom, args).then(r) } })
    rendre()
    await ouvrir('512000')
    saisirMotif('Motif fictif')
    const accepter = bouton('Accepter sur motif')
    await act(async () => { accepter.click(); accepter.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { accepter.click(); accepter.click(); accepter.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { repondre() })
    expect(await within(cycle('Trésorerie')).findByText('accepté sur motif')).toBeDefined()
    expect(faux.appels).toHaveLength(1)
  })

  it('le verrou se relâche APRÈS la relecture, et un refus de la base se dit sous ses mots', async () => {
    dossier2025()
    const refus = 'Le solde du compte 512000 a changé : au 31/12/2025, il est de 900,00 € au débit.'
    let libererRelecture = () => {}
    faux.reponseRpc = () => {
      // La relecture qui suit est retenue : la fenêtre pendant laquelle un clic de plus ne doit rien envoyer.
      faux.attente = new Promise<void>((r) => { libererRelecture = r })
      return Promise.resolve({ data: null, error: { message: refus } })
    }
    rendre()
    await ouvrir('512000')
    saisirMotif('Motif fictif')
    const lecturesAvant = faux.lectures.revision_justifications
    await act(async () => { bouton('Accepter sur motif').click() })
    await act(async () => { bouton('Accepter sur motif').click() })
    expect(faux.appels).toHaveLength(1)

    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: refus } })
    await act(async () => { faux.attente = null; libererRelecture() })
    expect(await within(volet()).findByText(refus)).toBeDefined()
    // Relue après le refus, et la saisie gardée pour la corriger.
    expect(faux.lectures.revision_justifications).toBeGreaterThan(lecturesAvant)
    expect((within(volet()).getByLabelText('Motif') as HTMLTextAreaElement).value).toBe('Motif fictif')
    await act(async () => { bouton('Accepter sur motif').click() })
    expect(faux.appels).toHaveLength(2)
  })

  it('la garde du volet retient une saisie quand on ouvre un autre compte', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrir('512000')
    saisirMotif('Une saisie en cours')
    await ouvrir('108000')
    expect(confirmer).toHaveBeenCalledWith('La décision en cours de saisie n’est pas enregistrée. L’abandonner ?')
    expect(within(volet()).getByText('Compte 512000')).toBeDefined()
  })

  it('et quand un AUTRE contenu demande le volet (l’assistant, une fiche) : la garde le consulte', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <FournisseurPanneauDroit>
        <ContexteDossier annee={2025} valides={[]}>
          <RevisionTab dossierId={DOSSIER} modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere" onNavigate={() => {}} />
          <AutreContenu />
        </ContexteDossier>
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    await ouvrir('512000')
    saisirMotif('Une saisie en cours')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un autre contenu' })) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(within(volet()).getByText('Compte 512000')).toBeDefined()
  })
})

describe('RevisionTab — la mémoire d’un exercice à l’autre', () => {
  // 2024 est validé ; sa validation a reporté 5 000 € d'emprunt et de banque au 1er janvier 2025 ; le 164000 de 2024 était
  // justifié de façon permanente par le tableau d'emprunt.
  function dossierRepris() {
    dossier2025()
    faux.tables.ecritures_brouillon = []
    // Chaque solde reporté porte l'empreinte de l'exercice validé qui l'a écrit (`exerciceValide` : « empreinte-de-test »).
    faux.tables.soldes_reportes = [
      soldeReporte({ id: 's1', date: '2025-01-01', compte: '164000', sens: 'credit', montant: 5000, libelle: 'Emprunts', source_empreinte: 'empreinte-de-test' }),
      soldeReporte({ id: 's2', date: '2025-01-01', compte: '512000', sens: 'debit', montant: 6000, libelle: 'Banque', source_empreinte: 'empreinte-de-test' }),
      soldeReporte({ id: 's3', date: '2025-01-01', compte: '101000', sens: 'credit', montant: 1000, libelle: 'Capital', source_empreinte: 'empreinte-de-test' }),
    ]
    faux.tables.pieces = [piece({ id: P_TABLEAU })]
    faux.tables.revision_justifications = [decision({
      id: 'j-2024', annee: 2024, compte: '164000', solde: -5000, etat: 'justifie', portee: 'permanente',
      motif: 'Tableau d’amortissement de la banque', cree_le: '2025-02-01T10:00:00+00:00',
    })]
    faux.tables.revision_preuves = [citation({ id: 'rp-2024', justification_id: 'j-2024', piece_id: P_TABLEAU, empreinte: HASH, precision: 'ligne 12' })]
  }

  it('la justification permanente de N−1 se propose, remplit la décision sans rien écrire, puis part au clic', async () => {
    dossierRepris()
    rendre({ valides: [2024] })
    const emprunt = await within(await screen.findByRole('region', { name: 'Cycle Emprunts' })).findByText('164000')
    expect(texte(emprunt.closest('tr') as Element)).toContain('justification de 2024 à reprendre')
    await ouvrir('164000')
    expect(texte(volet())).toContain('Décidée de façon permanente en 2024 : solde justifié, pour un solde de 5 000,00 € au crédit')
    await act(async () => { bouton('Reprendre la justification de 2024').click() })
    expect(faux.appels).toEqual([])
    expect((within(volet()).getByLabelText('Motif') as HTMLTextAreaElement).value).toBe('Tableau d’amortissement de la banque')
    expect((within(volet()).getByLabelText('Précision pour tableau-emprunt.pdf') as HTMLInputElement).value).toBe('ligne 12')

    await act(async () => { bouton('Justifier').click() })
    expect(faux.appels).toEqual([{
      nom: 'justifier_solde',
      args: {
        p_dossier_id: DOSSIER, p_annee: 2025, p_compte: '164000', p_solde: -5000, p_etat: 'justifie',
        p_motif: 'Tableau d’amortissement de la banque', p_portee: 'permanente',
        p_preuves: [{ piece_id: P_TABLEAU, precision: 'ligne 12' }], p_preuve_application: null,
        p_remplace_id: null, p_reprise_de: 'j-2024',
      },
    }])
    expect(await within(volet()).findByText('reprise de 2024')).toBeDefined()
  })

  it('« Vérifier l’empreinte » de N−1 appelle la base une fois, et le dit', async () => {
    dossierRepris()
    rendre({ valides: [2024] })
    const verifier = await screen.findByRole('button', { name: 'Vérifier l’empreinte de l’exercice 2024' })
    await act(async () => { verifier.click(); verifier.click() })
    expect(faux.appels).toEqual([{ nom: 'verifier_exercice_valide', args: { p_dossier_id: DOSSIER, p_annee: 2024 } }])
    expect(await screen.findByText('L’exercice 2024 se relit tel qu’il a été validé : son empreinte est intacte.')).toBeDefined()
  })

  it('la preuve du 101000 lit la vérification : elle ne conclut pas avant, elle concorde après', async () => {
    dossierRepris()
    rendre({ valides: [2024] })
    const verifier = await screen.findByRole('button', { name: 'Vérifier l’empreinte de l’exercice 2024' })
    const capital = () => within(cycle('Exploitant et capitaux')).getByText('101000').closest('tr') as HTMLElement
    expect(within(capital()).getByText('ne conclut pas')).toBeDefined()
    await act(async () => { verifier.click() })
    expect(await within(capital()).findByText('concorde')).toBeDefined()
  })

  it('la vérification vaut pour l’exercice vérifié seulement : un autre exercice choisi en tête ne s’en sert pas', async () => {
    dossierRepris()
    render(
      <FournisseurPanneauDroit>
        <ContexteDossier annee={2025} valides={[2024, 2025]}>
          <RevisionTab dossierId={DOSSIER} modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere" onNavigate={() => {}} />
          <ChoisirExercice annee={2026} />
        </ContexteDossier>
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    // Cherché HORS de l'`act` : il paraît après les lectures.
    const verifier = await screen.findByRole('button', { name: 'Vérifier l’empreinte de l’exercice 2024' })
    await act(async () => { verifier.click() })
    expect(await screen.findByText(/son empreinte est intacte/)).toBeDefined()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choisir 2026' })) })
    expect(await screen.findByRole('button', { name: 'Vérifier l’empreinte de l’exercice 2025' })).toBeDefined()
    expect(screen.queryByText(/son empreinte est intacte/)).toBeNull()
  })
})

// L'exercice de l'en-tête, changé écran ouvert, comme le fait la page du dossier.
function ChoisirExercice({ annee }: { annee: number }) {
  const { setAnnee } = useAnnee()
  return <button type="button" onClick={() => setAnnee(annee)}>{`Choisir ${annee}`}</button>
}

// LES CYCLES (ligne 41, étape R4, phase C). Le module (lib/revisionRevue.ts) est éprouvé à part : l'état déduit, le
// programme, les refus confrontés au texte des trois fonctions et rejoués sur l'essai de la base. Ici, ce qu'aucun calcul
// pur ne voit : que la carte et le panneau DISENT l'état et le programme ; que les refus se lisent avant le clic, boutons
// grisés ; que chaque geste parte par SA fonction seule, une fois, sous un verrou relâché après la relecture ; que la
// revue ne s'offre qu'au chef ; qu'une saisie ne remplace pas sans la voir une conclusion prise entre-temps.

async function ouvrirCycle(libelle: string) {
  const b = await screen.findByRole('button', { name: `Ouvrir le cycle ${libelle}` })
  await act(async () => { fireEvent.click(b) })
}

function saisir(libelle: string, valeur: string) {
  fireEvent.change(within(volet()).getByLabelText(libelle), { target: { value: valeur } })
}

const champ = (libelle: string) => within(volet()).getByLabelText(libelle) as HTMLTextAreaElement

describe('RevisionTab — les cycles : l’état déduit et le programme proposé', () => {
  it('chaque carte dit l’état de son cycle, la synthèse a la sienne, et l’en-tête compte les cycles', async () => {
    dossier2025()
    rendre()
    const conclure = await screen.findByRole('button', { name: 'Ouvrir le cycle Trésorerie' })
    expect(conclure.textContent).toBe('Conclure')
    expect(within(cycle('Trésorerie')).getByText('non commencé')).toBeDefined()
    expect(within(cycle('Ensemble')).getByText('non commencé')).toBeDefined()
    const nombre = screen.getAllByRole('region').filter((r) => (r.getAttribute('aria-label') ?? '').startsWith('Cycle ')).length
    expect(texte(screen.getByText(/Pour 2025 :/))).toContain(`Pour 2025 : ${nombre} cycles — non commencé : ${nombre}.`)
  })

  it('le panneau propose le programme du cycle, et dit les refus avant le clic, boutons grisés', async () => {
    dossier2025()
    rendre()
    await ouvrirCycle('Trésorerie')
    for (const t of PROGRAMME_DES_CYCLES.tresorerie) {
      expect((within(volet()).getByRole('checkbox', { name: t.travail }) as HTMLInputElement).checked).toBe(false)
    }
    expect(texte(volet())).toContain('Le programme est celui que l’application propose')
    expect(bouton('Conclure : révisé').disabled).toBe(true)
    expect(bouton('Conclure : anomalie').disabled).toBe(true)
    expect(texte(volet())).toContain('« Conclure : révisé », « Conclure : anomalie » : Une conclusion se rédige : elle ne peut pas être vide.')
    expect(bouton('Ajouter au journal').disabled).toBe(true)
    expect(texte(volet())).toContain('« Ajouter au journal » : Une note du journal est un échange avec la direction, une consultation ou un travail.')
    saisir('Nature de la note', 'consultation')
    expect(texte(volet())).toContain('« Ajouter au journal » : Une note se rédige : elle ne peut pas être vide.')
    expect(texte(volet())).toContain('Une revue porte sur la conclusion courante : le cycle n’en a pas.')
    expect(faux.appels).toEqual([])
  })

  it('« Conclure : révisé » écrit par conclure_cycle seule, ses huit arguments, puis relit : l’état et l’historique le disent', async () => {
    dossier2025()
    rendre()
    await ouvrirCycle('Trésorerie')
    const [premier, ...autres] = PROGRAMME_DES_CYCLES.tresorerie
    fireEvent.click(within(volet()).getByRole('checkbox', { name: premier.travail }))
    saisir(`Note du travail : ${premier.travail}`, 'Relevé de décembre reçu')
    saisir('Conclusion', 'Le solde bancaire concorde avec le relevé.')
    saisir('Points à suivre en 2026', 'Obtenir le relevé de janvier.')
    expect(bouton('Conclure : révisé').disabled).toBe(false)
    await act(async () => { bouton('Conclure : révisé').click() })

    expect(faux.appels).toEqual([{
      nom: 'conclure_cycle',
      args: {
        p_dossier_id: DOSSIER, p_annee: 2025, p_cycle: 'tresorerie', p_etat: 'revise',
        p_travaux: [
          { code: premier.code, travail: premier.travail, fait: true, note: 'Relevé de décembre reçu' },
          ...autres.map((t) => ({ code: t.code, travail: t.travail, fait: false })),
        ],
        p_conclusion: 'Le solde bancaire concorde avec le relevé.', p_a_suivre: 'Obtenir le relevé de janvier.', p_remplace_id: null,
      },
    }])
    // « Révisé », mais le 512000 reste à justifier : le cycle est « en cours », et la carte dit pourquoi.
    const carte = cycle('Trésorerie')
    expect(await within(carte).findByText('en cours')).toBeDefined()
    expect(texte(carte)).toContain('Ce qui le retient : un solde de bilan du cycle reste à justifier.')
    expect(texte(carte)).toContain('Conclusion du 15/03/2026 — programme : 1 fait sur 5')
    // L'historique, et une saisie qui repart de la conclusion courante — la suivante la remplacera.
    expect(within(volet()).getByText('courante')).toBeDefined()
    expect(texte(volet())).toContain('Celle-ci remplacera la conclusion courante du 15/03/2026.')
    expect(texte(volet())).toContain('Le programme reprend celui de la conclusion courante')
    // Le programme repart de celui de la courante ; le texte, VIDE — un clic distrait ne refait pas la même conclusion.
    expect((within(volet()).getByRole('checkbox', { name: premier.travail }) as HTMLInputElement).checked).toBe(true)
    expect(champ('Conclusion').value).toBe('')
    expect(bouton('Conclure : anomalie').disabled).toBe(true)

    saisir('Conclusion', 'Un écart reste inexpliqué.')
    await act(async () => { bouton('Conclure : anomalie').click() })
    expect(faux.appels).toHaveLength(2)
    expect(faux.appels[1].args).toMatchObject({ p_etat: 'anomalie', p_remplace_id: 'k-ecrite-1' })
    expect(await within(cycle('Trésorerie')).findByText('anomalie')).toBeDefined()
    expect(within(volet()).getAllByText('courante')).toHaveLength(1)
  })

  it('un travail se retire et s’ajoute ; ajouté, il part sans code', async () => {
    dossier2025()
    rendre()
    await ouvrirCycle('Social')
    const [premier, second] = PROGRAMME_DES_CYCLES.social
    fireEvent.click(within(volet()).getByRole('button', { name: `Retirer du programme : ${premier.travail}` }))
    saisir('Travail à ajouter au programme', 'Vérifier la retraite complémentaire.')
    fireEvent.click(within(volet()).getByRole('button', { name: 'Ajouter' }))
    saisir('Conclusion', 'Cotisations rapprochées des avis.')
    await act(async () => { bouton('Conclure : révisé').click() })
    expect(faux.appels[0].args.p_travaux).toEqual([
      { code: second.code, travail: second.travail, fait: false },
      { travail: 'Vérifier la retraite complémentaire.', fait: false },
    ])
  })

  it('le verrou : deux puis trois clics dans le même `act` n’envoient qu’une conclusion', async () => {
    dossier2025()
    let repondre = () => {}
    faux.reponseRpc = (nom, args) => new Promise((r) => { repondre = () => { void rpcCommeLaBase(nom, args).then(r) } })
    rendre()
    await ouvrirCycle('Recettes')
    saisir('Conclusion', 'Recettes rapprochées du relevé SNIR.')
    const conclure = bouton('Conclure : révisé')
    await act(async () => { conclure.click(); conclure.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { conclure.click(); conclure.click(); conclure.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { repondre() })
    expect(await within(cycle('Recettes')).findByText('révisé, à revoir par le chef')).toBeDefined()
    expect(faux.appels).toHaveLength(1)
  })

  it('une conclusion en vol tient aussi la décision d’un solde : son panneau attend la relecture', async () => {
    dossier2025()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let repondre = () => {}
    faux.reponseRpc = (nom, args) => new Promise((r) => { repondre = () => { void rpcCommeLaBase(nom, args).then(r) } })
    rendre()
    await ouvrirCycle('Trésorerie')
    saisir('Conclusion', 'Le solde bancaire concorde.')
    await act(async () => { bouton('Conclure : révisé').click() })
    // Le panneau d'un compte s'ouvre pendant que la conclusion part : sa décision attend.
    await ouvrir('512000')
    saisirMotif('Motif fictif')
    expect(bouton('Accepter sur motif').disabled).toBe(true)
    await act(async () => { bouton('Accepter sur motif').click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['conclure_cycle'])
    await act(async () => { repondre() })
    expect(await within(cycle('Trésorerie')).findByText('en cours')).toBeDefined()
    expect(bouton('Accepter sur motif').disabled).toBe(false)
  })

  it('le verrou se relâche APRÈS la relecture, et un refus de la base se dit sous ses mots, la saisie gardée', async () => {
    dossier2025()
    const refus = 'Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.'
    let libererRelecture = () => {}
    faux.reponseRpc = () => {
      faux.attente = new Promise<void>((r) => { libererRelecture = r })
      return Promise.resolve({ data: null, error: { message: refus } })
    }
    rendre()
    await ouvrirCycle('Recettes')
    saisir('Conclusion', 'Recettes rapprochées du relevé SNIR.')
    const lecturesAvant = faux.lectures.revision_conclusions
    await act(async () => { bouton('Conclure : révisé').click() })
    await act(async () => { bouton('Conclure : révisé').click() })
    expect(faux.appels).toHaveLength(1)

    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: refus } })
    await act(async () => { faux.attente = null; libererRelecture() })
    expect(await within(volet()).findByText(refus)).toBeDefined()
    expect(faux.lectures.revision_conclusions).toBeGreaterThan(lecturesAvant)
    expect(champ('Conclusion').value).toBe('Recettes rapprochées du relevé SNIR.')
    await act(async () => { bouton('Conclure : révisé').click() })
    expect(faux.appels).toHaveLength(2)
  })

  it('une conclusion prise ailleurs pendant la saisie : le module le dit avant le clic, et la saisie ne la remplace pas sans la voir', async () => {
    dossier2025()
    rendre()
    await ouvrirCycle('Trésorerie')
    saisir('Conclusion', 'Ma conclusion')
    // Une note écrite fait tout relire — et la relecture rapporte une conclusion qu'un autre compte a prise entre-temps.
    faux.reponseRpc = (nom, args) => {
      faux.tables.revision_conclusions.push(conclusion({ id: 'k-autre', cycle: 'tresorerie', auteur: 'u2', cree_le: '2026-03-15T09:00:00+00:00' }))
      faux.reponseRpc = rpcCommeLaBase
      return rpcCommeLaBase(nom, args)
    }
    saisir('Nature de la note', 'travail')
    saisir('Note', 'Relevé de décembre demandé.')
    await act(async () => { bouton('Ajouter au journal').click() })
    expect(await within(volet()).findByText('Relevé de décembre demandé.')).toBeDefined()
    expect(bouton('Conclure : révisé').disabled).toBe(true)
    expect(texte(volet())).toContain('Une autre conclusion a été prise sur ce cycle depuis : relire avant de conclure.')
    expect(champ('Conclusion').value).toBe('Ma conclusion')

    fireEvent.click(within(volet()).getByRole('button', { name: 'Repartir de la conclusion courante' }))
    expect(champ('Conclusion').value).toBe('')
    expect(within(volet()).queryByRole('button', { name: 'Repartir de la conclusion courante' })).toBeNull()
    saisir('Conclusion', 'Ma conclusion, relue')
    await act(async () => { bouton('Conclure : révisé').click() })
    expect(faux.appels.at(-1)).toMatchObject({ nom: 'conclure_cycle', args: { p_conclusion: 'Ma conclusion, relue', p_remplace_id: 'k-autre' } })
  })

  it('la garde du volet retient une saisie quand on ouvre un autre cycle, ou un compte', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrirCycle('Trésorerie')
    saisir('Conclusion', 'En cours de rédaction')
    await ouvrirCycle('Recettes')
    expect(confirmer).toHaveBeenCalledWith('La saisie en cours sur ce cycle n’est pas enregistrée. L’abandonner ?')
    expect(within(volet()).getByText('Cycle Trésorerie')).toBeDefined()
    await ouvrir('512000')
    expect(confirmer).toHaveBeenCalledTimes(2)
    expect(within(volet()).getByText('Cycle Trésorerie')).toBeDefined()
  })

  it('un exercice en cours : la phrase de la base, et aucun geste sur le cycle', async () => {
    dossier2025()
    faux.estChef = true
    faux.tables.ecritures_brouillon = ecritureEquilibree('e3', '2026-02-01', '512000', '706000', 50)
    rendre({ annee: 2026 })
    expect((await screen.findByRole('button', { name: 'Ouvrir le cycle Trésorerie' })).textContent).toBe('Ouvrir le cycle')
    await ouvrirCycle('Trésorerie')
    expect(within(volet()).getByText('en attente')).toBeDefined()
    expect(texte(volet())).toContain('L\'exercice 2026 n\'est pas terminé : sa révision s\'ouvre une fois clos.')
    for (const nom of ['Conclure : révisé', 'Conclure : anomalie', 'Ajouter au journal', 'Approuver']) {
      expect(within(volet()).queryByRole('button', { name: nom }), nom).toBeNull()
    }
  })
})

describe('RevisionTab — le journal, la revue du chef, la mémoire', () => {
  it('« Ajouter au journal » écrit par noter_revision seule, et le journal ne fait que s’allonger', async () => {
    dossier2025()
    rendre()
    await ouvrirCycle('Trésorerie')
    saisir('Nature de la note', 'echange_direction')
    saisir('Note', 'La cliente confirme l’absence d’espèces.')
    await act(async () => { bouton('Ajouter au journal').click() })
    expect(faux.appels).toEqual([{
      nom: 'noter_revision',
      args: { p_dossier_id: DOSSIER, p_annee: 2025, p_cycle: 'tresorerie', p_nature: 'echange_direction', p_texte: 'La cliente confirme l’absence d’espèces.' },
    }])
    expect(await within(volet()).findByText('La cliente confirme l’absence d’espèces.')).toBeDefined()
    expect(texte(volet())).toContain('Journal du cycle (1)')
    expect(texte(volet())).toContain('Échange avec la direction')
    expect(champ('Note').value).toBe('')
    // Quelque chose est fait, rien n'est conclu : le cycle est « en cours ».
    expect(await within(cycle('Trésorerie')).findByText('en cours')).toBeDefined()
  })

  it('le verrou du journal : trois clics dans le même `act` n’envoient qu’une note', async () => {
    dossier2025()
    let repondre = () => {}
    faux.reponseRpc = (nom, args) => new Promise((r) => { repondre = () => { void rpcCommeLaBase(nom, args).then(r) } })
    rendre()
    await ouvrirCycle('Trésorerie')
    saisir('Nature de la note', 'travail')
    saisir('Note', 'Rapprochement refait.')
    const noter = bouton('Ajouter au journal')
    await act(async () => { noter.click(); noter.click(); noter.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { repondre() })
    expect(await within(volet()).findByText('Rapprochement refait.')).toBeDefined()
    expect(faux.appels).toHaveLength(1)
  })

  it('la revue ne s’offre qu’au chef du cabinet : à un autre compte, la phrase de la base', async () => {
    dossier2025()
    faux.tables.revision_conclusions = [conclusion({ id: 'k1', cycle: 'recettes', auteur: 'u2', cree_le: '2026-03-01T10:00:00+00:00' })]
    rendre()
    await ouvrirCycle('Recettes')
    expect(within(volet()).queryByRole('button', { name: 'Approuver' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Renvoyer à reprendre' })).toBeNull()
    expect(within(volet()).queryByLabelText('Observation')).toBeNull()
    expect(within(volet()).getByText('Seul le chef du cabinet revoit un cycle.')).toBeDefined()
  })

  it('le chef approuve : revoir_cycle seule, une fois, et le cycle est revu ; une revue par conclusion', async () => {
    dossier2025()
    faux.estChef = true
    faux.tables.revision_conclusions = [conclusion({ id: 'k1', cycle: 'recettes', auteur: 'u2', cree_le: '2026-03-01T10:00:00+00:00' })]
    rendre()
    expect(await within(await screen.findByRole('region', { name: 'Cycle Recettes' })).findByText('révisé, à revoir par le chef')).toBeDefined()
    await ouvrirCycle('Recettes')
    expect(bouton('Renvoyer à reprendre').disabled).toBe(true)
    expect(texte(volet())).toContain('« Renvoyer à reprendre » : Un cycle renvoyé à reprendre se motive.')
    const approuver = bouton('Approuver')
    await act(async () => { approuver.click(); approuver.click(); approuver.click() })
    expect(faux.appels).toEqual([{
      nom: 'revoir_cycle', args: { p_dossier_id: DOSSIER, p_annee: 2025, p_conclusion_id: 'k1', p_avis: 'approuve', p_observation: null },
    }])
    expect(await within(cycle('Recettes')).findByText('revu')).toBeDefined()
    // Une revue par conclusion : la fiche le dit, sans champ ni bouton qu'aucune observation ne rendrait recevables.
    expect(texte(volet())).toContain('Cette conclusion a déjà été revue : revoir de nouveau suppose une nouvelle conclusion.')
    expect(within(volet()).queryByRole('button', { name: 'Approuver' })).toBeNull()
    expect(within(volet()).queryByLabelText('Observation')).toBeNull()
  })

  it('« Renvoyer à reprendre » part avec son observation, et le cycle est à reprendre', async () => {
    dossier2025()
    faux.estChef = true
    faux.tables.revision_conclusions = [conclusion({ id: 'k1', cycle: 'recettes', auteur: 'u2', cree_le: '2026-03-01T10:00:00+00:00' })]
    rendre()
    await ouvrirCycle('Recettes')
    saisir('Observation', 'Le relevé SNIR manque au dossier.')
    await act(async () => { bouton('Renvoyer à reprendre').click() })
    expect(faux.appels).toEqual([{
      nom: 'revoir_cycle',
      args: { p_dossier_id: DOSSIER, p_annee: 2025, p_conclusion_id: 'k1', p_avis: 'a_reprendre', p_observation: 'Le relevé SNIR manque au dossier.' },
    }])
    expect(await within(cycle('Recettes')).findByText('à reprendre')).toBeDefined()
    expect(texte(volet())).toContain('Observation : Le relevé SNIR manque au dossier.')
    // Revue, la conclusion ne se revoit plus : une nouvelle conclusion le rendra possible.
    expect(within(volet()).queryByLabelText('Observation')).toBeNull()
    // Une nouvelle conclusion prise, la revue se rouvre — sur elle, l'observation repartie de zéro.
    saisir('Conclusion', 'Le relevé SNIR est au dossier.')
    await act(async () => { bouton('Conclure : révisé').click() })
    expect((await within(volet()).findByLabelText('Observation') as HTMLTextAreaElement).value).toBe('')
    await act(async () => { bouton('Approuver').click() })
    expect(faux.appels.at(-1)).toMatchObject({ nom: 'revoir_cycle', args: { p_conclusion_id: 'k-ecrite-2', p_avis: 'approuve', p_observation: null } })
  })

  it('l’historique relit le programme exécuté, la revue par l’auteur, et dit une revue périmée et un programme illisible', async () => {
    dossier2025()
    faux.tables.revision_conclusions = [
      conclusion({
        id: 'k1', cycle: 'recettes', auteur: 'u1', cree_le: '2026-03-01T10:00:00+00:00',
        travaux: [{ code: 'recettes-mois', travail: 'Examiner les mois sans recette.', fait: true, note: 'Août : congés.' }],
      }),
      conclusion({ id: 'k2', cycle: 'social', travaux: 'pas une liste', cree_le: '2026-03-01T10:00:00+00:00' }),
    ]
    faux.tables.revision_revues = [revue({ id: 'v1', conclusion_id: 'k1', revu_par: 'u1', revu_le: '2026-03-02T10:00:00+00:00' })]
    faux.tables.revision_notes = [noteDuJournal({ id: 'n1', cycle: 'recettes', cree_le: '2026-03-03T10:00:00+00:00' })]
    rendre()
    const recettes = await screen.findByRole('region', { name: 'Cycle Recettes' })
    expect(within(recettes).getByText('revue périmée')).toBeDefined()
    expect(texte(recettes)).toContain('une décision, une conclusion ou une note a suivi la revue')
    await ouvrirCycle('Recettes')
    expect(texte(volet())).toContain('Le programme : 1 fait sur 1 travail')
    expect(texte(volet())).toContain('Fait — Examiner les mois sans recette. — Août : congés.')
    expect(texte(volet())).toContain('par toi, qui l’avait préparée')
    expect(within(volet()).getByText('périmée')).toBeDefined()
    await ouvrirCycle('Social')
    expect(texte(volet())).toContain('Le programme de cette conclusion ne se relit pas sous la forme que la base exige')
  })

  it('la synthèse ne se dit pas révisée tant qu’un autre cycle ne l’est pas', async () => {
    dossier2025()
    faux.tables.revision_conclusions = [conclusion({ id: 'k-ens', cycle: 'ensemble' })]
    rendre()
    const ensemble = await screen.findByRole('region', { name: 'Cycle Ensemble' })
    expect(within(ensemble).getByText('en cours')).toBeDefined()
    expect(texte(ensemble)).toContain('un autre cycle n’est encore ni révisé, ni en anomalie, ni revu')
  })

  it('ce que 2024 a laissé à suivre s’affiche en tête du même cycle en 2025, et un cycle que seule une conclusion nomme a sa carte', async () => {
    dossier2025()
    faux.tables.revision_conclusions = [
      conclusion({ id: 'k-2024', annee: 2024, cycle: 'tresorerie', a_suivre: 'Demander le relevé du compte d’épargne.' }),
      conclusion({ id: 'k-stocks', cycle: 'stocks', etat: 'anomalie' }),
      // Un autre dossier : rien de lui ne compte ici.
      conclusion({ id: 'k-ailleurs', dossier_id: 'autre-dossier', cycle: 'tiers' }),
    ]
    rendre()
    const tresorerie = await screen.findByRole('region', { name: 'Cycle Trésorerie' })
    expect(texte(tresorerie)).toContain('Laissé à suivre par 2024 : Demander le relevé du compte d’épargne.')
    expect(within(cycle('Stocks')).getByText('anomalie')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Cycle Tiers' })).toBeNull()
    await ouvrirCycle('Trésorerie')
    expect(texte(volet())).toContain('Laissé à suivre par 2024')
  })
})
