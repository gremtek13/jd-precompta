import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RevisionTab from './RevisionTab'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import { usePanneauDroit } from '../../lib/panneauDroit'
import { useAnnee } from '../../context/AnneeContext'
import { ContexteDossier } from '../../test/exercicesValides'
import { DOSSIER, decision, citation, ecritureEquilibree, soldeReporte } from '../../test/revision'
import { TEXTES_DES_PREUVES } from '../../lib/revisionPreuves'
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
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }))

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
  if (nom === 'verifier_exercice_valide') return Promise.resolve({ data: true, error: null })
  return Promise.resolve({ data: null, error: { message: `fonction inconnue : ${nom}` } })
}

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
    'revision_preuves',
  ])('la table %s refusée : un bandeau, et ni état ni geste', async (table) => {
    dossier2025()
    faux.refusees.add(table)
    rendre()
    expect(await screen.findByText(/n'ont pas pu être lu(e)?s en entier/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Ouvrir le compte/ })).toBeNull()
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
