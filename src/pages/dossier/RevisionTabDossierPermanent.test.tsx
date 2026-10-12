import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RevisionTab from './RevisionTab'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import { usePanneauDroit } from '../../lib/panneauDroit'
import { AnneeProvider } from '../../context/AnneeContext'
import { ExercicesValidesProvider } from '../../context/ExercicesValidesContext'
import { exerciceValide } from '../../test/exerciceValide'
import { DOSSIER, AUTEUR } from '../../test/revision'
import { DOCUMENT_STATUTS, HASH_DE_LA_CITATION, PIECE_BAIL, PIECE_LIBRE, entreePermanente, idDEntree } from '../../test/dossierPermanent'
import type { ModeleComptable } from '../../lib/engagement'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import type { EntreeDossierPermanent, ExerciceValide, Piece } from '../../lib/types'

// LE DOSSIER PERMANENT DANS L'ONGLET RÉVISION (ligne 41, étape R7, phase C). Le module (lib/dossierPermanent.ts) est éprouvé à
// part : refus confrontés au texte des deux fonctions et rejoués sur l'essai de la base. CE QUI SE JOUE ICI, c'est ce
// qu'aucun calcul pur ne voit : que la section lise sa table EN ENTIER (le faux client applique les filtres) et ne dise rien
// sur une lecture absente, partielle, qui lève ou illisible — le reste de l'onglet demeurant ; que « Consigner », « Nouvelle
// version » et « Retirer » ne partent que par leurs deux fonctions, une fois, sous un verrou relâché APRÈS la relecture,
// relue aussi sur un refus ; que chaque refus se lise avant le clic, dans son ordre, et grise son bouton ; qu'une nouvelle
// version RETIENNE celle qu'elle remplace ; que ce que A9 propose sans qu'aucune entrée le porte soit une information.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Les tables dont la lecture est refusée : `lireTout` les rend incomplètes.
  refusees: new Set<string>(),
  // Les tables dont la lecture LÈVE.
  levantes: new Set<string>(),
  // Le plafond du serveur par table (le « Max rows » de PostgREST, qui ne se signale pas) : au-delà de ce rang rien n'est rendu,
  // et le compte annoncé reste entier.
  plafonds: {} as Record<string, number>,
  // Une promesse que chaque LECTURE attend : le temps de voir l'écran avant toute réponse.
  attente: null as Promise<void> | null,
  // Une promesse que les lectures d'UNE table attendent : la relecture d'après une écriture, vue pendant qu'elle dure.
  retenues: {} as Record<string, Promise<void> | undefined>,
  lectures: {} as Record<string, number>,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  reponseRpc: null as null | ((nom: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>),
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    const predicats: ReturnType<typeof predicatEq>[] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const reponse = () => {
      faux.lectures[table] = (faux.lectures[table] ?? 0) + 1
      if (faux.levantes.has(table)) throw new Error('la lecture a levé')
      if (faux.refusees.has(table)) return { data: null, error: { message: 'permission denied' }, count: null }
      const lignes = filtrer(faux.tables[table] ?? [], predicats)
      const plafond = faux.plafonds[table]
      const finReelle = plafond === undefined ? fin + 1 : Math.min(fin + 1, plafond)
      return { data: lignes.slice(debut, finReelle), error: null, count: lignes.length }
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
      then: (suite: (r: unknown) => unknown, rejet?: (e: unknown) => unknown) =>
        Promise.all([faux.attente ?? Promise.resolve(), faux.retenues[table] ?? Promise.resolve()]).then(reponse).then(suite, rejet),
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
vi.mock('../../lib/controlesReleves', () => ({ chargerRelevesIncoherents: async () => [] }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: AUTEUR } }, estChef: false }) }))

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000' }
const AUTRE_HASH = 'f'.repeat(64)

function piece(o: Partial<Piece>): Piece {
  return {
    id: 'p', dossier_id: DOSSIER, uploaded_by: null, source: 'upload', storage_path: `${DOSSIER}/bail.pdf`,
    nom_fichier: 'bail-fictif.pdf', storage_hash: HASH_DE_LA_CITATION, date_piece: '2025-03-10', tiers: 'BAILLEUR FICTIF', montant_ht: null,
    montant_tva: null, montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    categorie_id: null, sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: 'haute',
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, created_at: '2025-03-12T09:00:00Z',
    updated_at: '2025-03-12T09:00:00Z', ...o,
  }
}

// L'entrée du dossier fictif.
const entree = (o: Partial<EntreeDossierPermanent> = {}) => entreePermanente({ dossier_id: DOSSIER, ...o })

// La base fictive : les deux fonctions écrivent leur ligne comme elles le font — l'empreinte de la source recopiée à la citation —,
// à un instant qui avance d'une minute par écriture (la chaîne est l'ordre, jamais l'horodatage).
let numero = 0
const instant = () => `2026-03-15T10:${String(numero).padStart(2, '0')}:00+00:00`
function rpcCommeLaBase(nom: string, args: Record<string, unknown>) {
  const lignes = faux.tables.dossier_permanent as EntreeDossierPermanent[]
  if (nom === 'consigner_au_dossier_permanent') {
    numero++
    const citation = args.p_citation as { piece_id?: string; document_id?: string } | null
    const source = citation?.piece_id !== undefined
      ? (faux.tables.pieces as Piece[]).find((x) => x.id === citation.piece_id)
      : (faux.tables.documents_divers as { id: string; storage_hash: string | null }[]).find((x) => x.id === citation?.document_id)
    lignes.push(entree({
      id: idDEntree(100 + numero), nature: args.p_nature as EntreeDossierPermanent['nature'], titre: String(args.p_titre),
      texte: (args.p_texte as string | null) ?? null, piece_id: citation?.piece_id ?? null, document_id: citation?.document_id ?? null,
      empreinte: source?.storage_hash ?? null, valable_du: (args.p_valable_du as string | null) ?? null,
      valable_jusqu_au: (args.p_valable_jusqu_au as string | null) ?? null, remplace_id: (args.p_remplace_id as string | null) ?? null,
      auteur: AUTEUR, cree_le: instant(),
    }))
    return Promise.resolve({ data: idDEntree(100 + numero), error: null })
  }
  if (nom === 'retirer_du_dossier_permanent') {
    numero++
    const cible = lignes.find((x) => x.id === args.p_entree_id)
    if (cible) { cible.retire_le = instant(); cible.retire_par = AUTEUR }
    return Promise.resolve({ data: null, error: null })
  }
  return Promise.resolve({ data: null, error: { message: `fonction inconnue : ${nom}` } })
}

// Un dossier dont l'exercice 2025 se révise (nous sommes le 15 mars 2026 à Paris), avec deux pièces et un document à citer.
function dossier2025(entrees: EntreeDossierPermanent[] = []) {
  faux.tables = {
    ecritures_brouillon: [],
    pieces: [
      piece({ id: PIECE_BAIL, nom_fichier: 'bail-fictif.pdf' }),
      piece({ id: PIECE_LIBRE, nom_fichier: 'avenant-fictif.pdf', storage_hash: AUTRE_HASH, tiers: 'AVENANT FICTIF' }),
    ],
    documents_divers: [{ id: DOCUMENT_STATUTS, dossier_id: DOSSIER, nom_fichier: 'statuts-fictifs.pdf', categorie: 'autre', storage_hash: HASH_DE_LA_CITATION }],
    dossier_permanent: entrees,
    lignes_bancaires: [], categories: [], references_annuelles: [], references_postes_annuels: [],
    cotisations_declarees: [], immobilisations: [], natures_immobilisation: [], a_nouveaux: [], emprunts: [],
    ventilations_bancaires: [], reglements_groupes: [], vehicules: [], lettrages_manuels: [], declarations_tva: [],
    factures_emises: [], transmissions_factures: [], informations_dossier: [], exercices_clotures: [], soldes_reportes: [],
    controles_releves_bancaires: [], revision_justifications: [], revision_preuves: [],
    revision_conclusions: [], revision_notes: [], revision_revues: [], revision_seuils: [], revision_explications: [],
  }
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

function rendre(o: { annee?: ValeurAnnee; exercices?: ExerciceValide[] } = {}) {
  return render(
    <FournisseurPanneauDroit>
      <ExercicesValidesProvider exercices={o.exercices ?? [exerciceValide(2024)]} relire={async () => {}}>
        <AnneeProvider defaut={o.annee ?? 2025}>
          <RevisionTab
            dossierId={DOSSIER} modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere"
            onNavigate={() => {}}
          />
        </AnneeProvider>
      </ExercicesValidesProvider>
      <AutreContenu />
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const section = () => screen.getByRole('region', { name: 'Dossier permanent' })
const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const texte = (el: Element) => (el.textContent ?? '').replace(/[\s  ]/g, ' ')
const bouton = (zone: HTMLElement, nom: string | RegExp) => within(zone).getByRole('button', { name: nom }) as HTMLButtonElement
const ligneDe = (titre: string) => within(section()).getByText(titre, { selector: '.check-ligne-libelle' }).closest('.entree-permanente') as HTMLElement
const champ = (nom: string | RegExp) => within(volet()).getByLabelText(nom)

async function attendreLaSection() {
  await screen.findByRole('region', { name: 'Dossier permanent' })
}

async function ouvrirLaConsignation() {
  await act(async () => { fireEvent.click(bouton(section(), 'Consigner une entrée')) })
}

function saisir(nature: string, titre: string, contenu: string) {
  if (nature !== '') fireEvent.change(champ('Nature'), { target: { value: nature } })
  fireEvent.change(champ('Titre'), { target: { value: titre } })
  if (contenu !== '') fireEvent.change(champ(/^Texte/), { target: { value: contenu } })
}

const bontonDeLaSaisie = () => bouton(volet(), /^(Consigner l’entrée|Enregistrer la nouvelle version)$/)

beforeEach(() => {
  faux.tables = {}
  faux.refusees = new Set()
  faux.levantes = new Set()
  faux.plafonds = {}
  faux.attente = null
  faux.retenues = {}
  faux.lectures = {}
  faux.appels = []
  faux.reponseRpc = rpcCommeLaBase
  numero = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RevisionTab, dossier permanent — rien avant d’avoir lu, rien sur une lecture partielle', () => {
  it('n’affirme rien et n’offre aucun geste tant que les lectures ne sont pas revenues', async () => {
    dossier2025([entree()])
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Dossier permanent' })).toBeNull()
    expect(screen.queryByText('Consigner une entrée')).toBeNull()
    await act(async () => { liberer() })
    await attendreLaSection()
    expect(bouton(section(), 'Consigner une entrée')).toBeDefined()
  })

  it('la table refusée : la section seule le dit, sans entrée, sans état ni geste — le reste de l’onglet demeure', async () => {
    dossier2025([entree()])
    faux.refusees.add('dossier_permanent')
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Les entrées du dossier permanent n'ont pas pu être lues en entier \(.*permission denied\)/)).toBeDefined()
    expect(within(section()).getByText(/ne dit rien d’une lecture incomplète/)).toBeDefined()
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(within(section()).queryByText('Lettre de mission')).toBeNull()
    expect(within(section()).queryByText(/Aucune entrée n’est consignée|À titre d’information|Aucune lettre de mission/)).toBeNull()
    // Les cycles de la révision des soldes ne dépendent pas de cette lecture.
    expect(screen.getByRole('region', { name: 'Cycle Ensemble' })).toBeDefined()
    expect(faux.lectures.dossier_permanent).toBeGreaterThan(0)
  })

  it('une lecture partielle (le plafond du serveur) le dit de même : aucune entrée affirmée, aucun geste', async () => {
    dossier2025([entree({ id: idDEntree(1) }), entree({ id: idDEntree(2), titre: 'Autre' })])
    faux.plafonds.dossier_permanent = 1
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Les entrées du dossier permanent n'ont pas pu être lues en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\)/)).toBeDefined()
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(within(section()).queryByText('Lettre de mission')).toBeNull()
  })

  it('une lecture qui LÈVE tombe du côté signalé : la section se tait et le dit, l’onglet demeure', async () => {
    dossier2025([entree()])
    faux.levantes.add('dossier_permanent')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Les entrées du dossier permanent n'ont pas pu être lues en entier \(la lecture a échoué\)/)).toBeDefined()
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(screen.getByRole('region', { name: 'Cycle Ensemble' })).toBeDefined()
  })

  it('une table de la Vue d’ensemble refusée (les pièces) cache la révision ; la section, qui en dépend, se tait et le dit à son tour', async () => {
    dossier2025([entree()])
    faux.refusees.add('pieces')
    rendre()
    expect(await screen.findByText(/pas pu être lues en entier/)).toBeDefined()
    await attendreLaSection()
    // La section ne nomme plus ce qu'une entrée cite sans les pièces : ni entrée, ni état, ni élément absent, ni geste.
    expect(within(section()).getByText(/Les pièces du dossier n'ont pas pu être affichées en entier/)).toBeDefined()
    expect(within(section()).getByText(/Le dossier permanent ne dit rien tant que cette lecture est incomplète/)).toBeDefined()
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(within(section()).queryByText(/Lettre de mission|Aucune entrée n’est consignée|À titre d’information/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Cycle Ensemble' })).toBeNull()
  })

  it('une chaîne de versions qui ne se relit pas n’affirme rien et n’offre aucun geste', async () => {
    // Une version dont la précédente est absente de la lecture : la base ne laisse rien de tel se former.
    dossier2025([entree({ id: idDEntree(2), remplace_id: idDEntree(1) })])
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Les versions du dossier permanent ne forment pas des chaînes lisibles/)).toBeDefined()
    expect(within(section()).queryByRole('button')).toBeNull()
  })

  it('lit sa table pour CE dossier, et rien d’un autre', async () => {
    dossier2025([entree({ titre: 'Lettre du dossier' }), entree({ id: idDEntree(9), dossier_id: 'autre-dossier', titre: 'AUTRE DOSSIER' })])
    rendre()
    await attendreLaSection()
    expect(faux.lectures.dossier_permanent).toBe(1)
    expect(texte(section())).toContain('Lettre du dossier')
    expect(texte(section())).not.toContain('AUTRE DOSSIER')
  })
})

describe('RevisionTab, dossier permanent — ce que la section montre', () => {
  it('range les entrées courantes dans l’ordre de A9, par nature', async () => {
    dossier2025([
      entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail du cabinet' }),
      entree({ id: idDEntree(2), nature: 'lettre_mission', titre: 'Lettre signée' }),
      entree({ id: idDEntree(3), nature: 'statuts', titre: 'Statuts à jour' }),
      entree({ id: idDEntree(4), nature: 'description', titre: 'Description de l’activité' }),
      entree({ id: idDEntree(5), nature: 'autre', titre: 'Un autre document' }),
      entree({ id: idDEntree(6), nature: 'organisation_comptable', titre: 'Organisation' }),
    ])
    rendre()
    await attendreLaSection()
    const natures = [...section().querySelectorAll('h4')].map((h) => h.textContent).filter((t) => t !== 'À titre d’information')
    expect(natures).toEqual([
      'Lettre de mission', 'Description de l\'entité', 'Organisation comptable', 'Statuts', 'Bail', 'Autre document',
    ])
  })

  it('dit la validité de chaque entrée, et celle qui ne couvre pas l’exercice regardé', async () => {
    dossier2025([
      entree({ id: idDEntree(1), titre: 'Sans date', nature: 'bail', valable_du: null, valable_jusqu_au: null }),
      entree({ id: idDEntree(2), titre: 'Bornée', nature: 'contrat', valable_du: '2024-07-01', valable_jusqu_au: '2033-06-30' }),
      entree({ id: idDEntree(3), titre: 'Finie', nature: 'statuts', valable_du: '2020-01-01', valable_jusqu_au: '2023-12-31' }),
      entree({ id: idDEntree(4), titre: 'Depuis 2026', nature: 'description', valable_du: '2026-01-01', valable_jusqu_au: null }),
    ])
    rendre()
    await attendreLaSection()
    expect(texte(ligneDe('Sans date'))).toContain('valable depuis toujours, sans terme')
    expect(texte(ligneDe('Sans date'))).not.toContain('ne couvre pas')
    expect(texte(ligneDe('Bornée'))).toContain('valable du 01/07/2024 au 30/06/2033 (bornes comprises)')
    expect(texte(ligneDe('Bornée'))).not.toContain('ne couvre pas')
    expect(texte(ligneDe('Finie'))).toContain('valable du 01/01/2020 au 31/12/2023 (bornes comprises) — ne couvre pas 2025')
    expect(texte(ligneDe('Depuis 2026'))).toContain('valable depuis le 01/01/2026, sans terme — ne couvre pas 2025')
  })

  it('dit en mots ce que chaque citation prouve encore', async () => {
    dossier2025([
      entree({ id: idDEntree(1), nature: 'lettre_mission', titre: 'Intacte', piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION }),
      entree({ id: idDEntree(2), nature: 'description', titre: 'Changée', piece_id: PIECE_LIBRE, empreinte: HASH_DE_LA_CITATION }),
      entree({ id: idDEntree(3), nature: 'organisation_comptable', titre: 'Disparue', document_id: DOCUMENT_STATUTS, empreinte: HASH_DE_LA_CITATION }),
      entree({ id: idDEntree(4), nature: 'statuts', titre: 'Sans empreinte', piece_id: PIECE_BAIL, empreinte: null }),
      entree({ id: idDEntree(5), nature: 'bail', titre: 'Introuvable', piece_id: 'bbbbbbbb-0000-4000-8000-0000000000ff', empreinte: HASH_DE_LA_CITATION }),
      entree({ id: idDEntree(6), nature: 'autre', titre: 'Sans citation', texte: 'Un texte seul.' }),
    ])
    ;(faux.tables.documents_divers as { storage_hash: string | null }[])[0].storage_hash = null
    rendre()
    await attendreLaSection()
    expect(texte(ligneDe('Intacte'))).toContain('Pièce citée : bail-fictif.pdf empreinte intacte')
    expect(texte(ligneDe('Changée'))).toContain('Pièce citée : avenant-fictif.pdf fichier changé depuis la citation')
    expect(texte(ligneDe('Disparue'))).toContain('Document cité : statuts-fictifs.pdf empreinte disparue')
    expect(texte(ligneDe('Sans empreinte'))).toContain('Pièce citée : bail-fictif.pdf sans empreinte')
    expect(texte(ligneDe('Introuvable'))).toContain('Pièce citée : introuvable introuvable dans ce qui a été lu')
    expect(texte(ligneDe('Sans citation'))).not.toContain('citée')
  })

  it('replie l’historique des versions, texte compris, et garde les entrées retirées dans un repli à part', async () => {
    dossier2025([
      entree({ id: idDEntree(1), titre: 'Première version', texte: 'Texte de la première.', cree_le: '2026-01-05T10:00:00+00:00' }),
      entree({ id: idDEntree(2), titre: 'Version courante', texte: 'Texte de la courante.', remplace_id: idDEntree(1), cree_le: '2026-02-05T10:00:00+00:00' }),
      entree({ id: idDEntree(3), nature: 'bail', titre: 'Bail retiré', texte: null, piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION, retire_le: '2026-03-01T10:00:00+00:00', retire_par: AUTEUR }),
    ])
    rendre()
    await attendreLaSection()
    const courante = ligneDe('Version courante')
    expect(texte(courante)).toContain('version 2, consignée le 05/02/2026, par un autre compte du cabinet (u1)')
    // L'historique est un repli fermé : la première version s'y lit, la courante y est marquée.
    const historique = within(courante).getByText('Historique (2 versions)').closest('details') as HTMLDetailsElement
    expect(historique.open).toBe(false)
    expect(texte(historique)).toContain('Première version')
    expect(texte(historique)).toContain('Texte de la première.')
    expect(texte(historique)).toContain('(courante)')
    // Les retirées : un repli à part, fermé, que ni la liste courante ni le compte des natures ne montrent.
    expect(within(section()).queryByText('Bail', { selector: 'h4' })).toBeNull()
    const retirees = within(section()).getByText('Entrées retirées (1)').closest('details') as HTMLDetailsElement
    expect(retirees.open).toBe(false)
    expect(texte(retirees)).toContain('Bail retiré — bail')
    expect(texte(retirees)).toContain('Retirée le 01/03/2026, par toi')
    expect(within(retirees).queryByRole('button', { name: /Retirer|Nouvelle version/ })).toBeNull()
  })

  it('dit ce que A9 propose et qu’aucune entrée en vigueur ne porte pour l’exercice : une information, jamais une faute', async () => {
    dossier2025([
      entree({ id: idDEntree(1), nature: 'lettre_mission', titre: 'Lettre en vigueur', valable_du: '2025-01-01', valable_jusqu_au: null }),
      // Une description dont la validité s'arrête avant l'exercice, et une organisation retirée : aucune ne porte 2025.
      entree({ id: idDEntree(2), nature: 'description', titre: 'Description finie', valable_du: '2020-01-01', valable_jusqu_au: '2023-12-31' }),
      entree({ id: idDEntree(3), nature: 'organisation_comptable', titre: 'Organisation retirée', retire_le: '2026-02-01T10:00:00+00:00', retire_par: AUTEUR }),
    ])
    rendre()
    await attendreLaSection()
    const info = within(section()).getByText('À titre d’information').parentElement as HTMLElement
    expect(texte(info)).not.toContain('lettre de mission')
    expect(texte(info)).toContain('Aucune description de l’entité et de son activité n’est en vigueur en 2025.')
    expect(texte(info)).toContain('Aucune présentation de l’organisation comptable n’est en vigueur en 2025.')
    expect(texte(info)).toContain('rien n’est refusé faute de les consigner')
    // Jamais une faute : ni le style d'erreur, ni un bouton qui l'accuse.
    expect(section().querySelector('.error-text')).toBeNull()
    expect(info.querySelector('.error-text, .check-manque, .badge-danger')).toBeNull()
  })

  it('un dossier sans entrée dit les trois éléments de A9 comme une information, et le dit d’une phrase', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText('Aucune entrée n’est consignée au dossier permanent.')).toBeDefined()
    expect(within(section()).getByText('Aucune lettre de mission n’est en vigueur en 2025.')).toBeDefined()
    expect(section().querySelector('.error-text')).toBeNull()
  })

  it('vaut pour tous les exercices : changer d’exercice ne change ni les entrées ni leur lecture, seulement l’information', async () => {
    dossier2025([entree({ titre: 'Lettre pour 2026', valable_du: '2026-01-01', valable_jusqu_au: null })])
    const { unmount } = rendre({ annee: 2025, exercices: [exerciceValide(2024)] })
    await attendreLaSection()
    expect(texte(section())).toContain('Lettre pour 2026')
    expect(within(section()).getByText('Aucune lettre de mission n’est en vigueur en 2025.')).toBeDefined()
    unmount()
    rendre({ annee: 2026, exercices: [exerciceValide(2025)] })
    await attendreLaSection()
    expect(texte(section())).toContain('Lettre pour 2026')
    expect(within(section()).queryByText(/Aucune lettre de mission/)).toBeNull()
  })
})

describe('RevisionTab, dossier permanent — consigner une entrée', () => {
  it('chaque refus se lit avant le clic, dans l’ordre de la fonction, et grise le bouton', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    const refus = () => texte(volet().querySelector('.fiche-mouvement-note strong')?.parentElement as Element)
    // 2. La nature, d'abord.
    expect(bontonDeLaSaisie().disabled).toBe(true)
    expect(refus()).toContain('Une entrée du dossier permanent est la lettre de mission, la description de l’entité'.replace('’', "'"))
    fireEvent.change(champ('Nature'), { target: { value: 'bail' } })
    // 3. Un titre.
    expect(refus()).toContain('Une entrée du dossier permanent porte un titre.')
    fireEvent.change(champ('Titre'), { target: { value: 'x'.repeat(501) } })
    expect(refus()).toContain('Un titre tient en 500 caractères au plus.')
    fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial' } })
    // 6. Elle dit quelque chose : un texte, ou une source citée.
    expect(refus()).toContain('Une entrée du dossier permanent dit quelque chose : un texte, ou la pièce ou le document qu\'elle cite.')
    // 4. Un texte fait de blancs n'en est pas un : il part nul, et c'est « une entrée dit quelque chose » qui refuse. Trop long, non.
    fireEvent.change(champ(/^Texte/), { target: { value: '   ' } })
    expect(refus()).toContain('Une entrée du dossier permanent dit quelque chose')
    fireEvent.change(champ(/^Texte/), { target: { value: 'y'.repeat(8001) } })
    expect(refus()).toContain('Un texte tient en 8 000 caractères au plus.')
    fireEvent.change(champ(/^Texte/), { target: { value: 'Bail de trois ans.' } })
    expect(bontonDeLaSaisie().disabled).toBe(false)
    expect(volet().querySelector('.fiche-mouvement-note strong')).toBeNull()
    // 7. La validité : hors des bornes, puis inversée.
    fireEvent.change(champ('Valable du'), { target: { value: '1800-01-01' } })
    expect(texte(volet())).toContain('Une date de validité est comprise entre 1900 et 2100.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
    fireEvent.change(champ('Valable du'), { target: { value: '2026-06-01' } })
    fireEvent.change(champ('Valable jusqu’au'), { target: { value: '2026-01-01' } })
    expect(texte(volet())).toContain('La fin de validité précède son début.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
    fireEvent.change(champ('Valable jusqu’au'), { target: { value: '2026-06-01' } })
    expect(bontonDeLaSaisie().disabled).toBe(false)
    expect(faux.appels).toEqual([])
  })

  it('une date qui n’existe pas ne part pas : l’écran le dit au lieu d’envoyer une entrée sans sa borne', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', 'Un texte.')
    // Cinq chiffres d'année : un champ de date l'admet, la fonction ne le lirait pas comme une date.
    fireEvent.change(champ('Valable du'), { target: { value: '12345-01-01' } })
    expect(texte(volet())).toContain('Une date de validité n’existe pas dans le calendrier : elle ne partirait pas.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
    expect(faux.appels).toEqual([])
  })

  it('écrit par consigner_au_dossier_permanent SEULE, une fois, relit, ferme le panneau et montre l’entrée', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('lettre_mission', '  Lettre de mission 2026  ', 'Mission de présentation des comptes.')
    fireEvent.change(champ('Valable du'), { target: { value: '2026-01-01' } })
    const lecturesAvant = faux.lectures.dossier_permanent
    await act(async () => { bontonDeLaSaisie().click() })

    expect(faux.appels).toEqual([{
      nom: 'consigner_au_dossier_permanent',
      args: {
        p_dossier_id: DOSSIER, p_nature: 'lettre_mission', p_titre: '  Lettre de mission 2026  ',
        p_texte: 'Mission de présentation des comptes.', p_citation: null, p_valable_du: '2026-01-01', p_valable_jusqu_au: null,
        p_remplace_id: null,
      },
    }])
    expect(faux.lectures.dossier_permanent).toBe((lecturesAvant ?? 0) + 1)
    expect(screen.queryByRole('complementary', { name: 'Panneau contextuel' })?.textContent ?? '').not.toContain('Consigner l’entrée')
    expect(texte(ligneDe('Lettre de mission 2026'))).toContain('consignée le 15/03/2026, par toi')
    // Elle vaut 2026 : l'information sur 2025 la dit hors de l'exercice regardé.
    expect(texte(ligneDe('Lettre de mission 2026'))).toContain('ne couvre pas 2025')
  })

  it('cite une pièce ou un document du dossier choisi dans la liste lue, et l’état de la citation se lit aussitôt', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('statuts', 'Statuts de la société', '')
    // La liste ne montre rien tant qu'on ne cherche pas ; la recherche dit combien elle en trouve.
    expect(within(volet()).queryByRole('button', { name: /^Citer / })).toBeNull()
    fireEvent.change(within(volet()).getByPlaceholderText('Chercher un justificatif, un document…'), { target: { value: 'statuts' } })
    await act(async () => { bouton(volet(), 'Citer statuts-fictifs.pdf').click() })
    expect(texte(volet())).toContain('statuts-fictifs.pdf')
    expect(bontonDeLaSaisie().disabled).toBe(false)
    await act(async () => { bontonDeLaSaisie().click() })

    expect(faux.appels).toHaveLength(1)
    expect(faux.appels[0].args).toMatchObject({ p_texte: null, p_citation: { document_id: DOCUMENT_STATUTS } })
    expect(texte(ligneDe('Statuts de la société'))).toContain('Document cité : statuts-fictifs.pdf empreinte intacte')
  })

  it('cite une pièce du dossier, et retire la citation avant d’enregistrer', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', '')
    fireEvent.change(within(volet()).getByPlaceholderText('Chercher un justificatif, un document…'), { target: { value: 'avenant' } })
    await act(async () => { bouton(volet(), 'Citer avenant-fictif.pdf').click() })
    expect(bontonDeLaSaisie().disabled).toBe(false)
    await act(async () => { bouton(volet(), 'Retirer la citation').click() })
    // Plus de citation, plus de texte : « une entrée dit quelque chose » refuse.
    expect(bontonDeLaSaisie().disabled).toBe(true)
    expect(texte(volet())).toContain('Une entrée du dossier permanent dit quelque chose')
    fireEvent.change(within(volet()).getByPlaceholderText('Chercher un justificatif, un document…'), { target: { value: 'avenant' } })
    await act(async () => { bouton(volet(), 'Citer avenant-fictif.pdf').click() })
    await act(async () => { bontonDeLaSaisie().click() })
    expect(faux.appels[0].args).toMatchObject({ p_citation: { piece_id: PIECE_LIBRE } })
  })

  it('deux clics dans le MÊME instant n’envoient qu’une entrée ; pendant la relecture, plus aucun geste ne part', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail existant' })])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('lettre_mission', 'Lettre', 'Texte.')
    // La relecture d'après l'écriture est retenue : on voit l'écran pendant qu'elle dure.
    let liberer = () => {}
    faux.retenues.dossier_permanent = new Promise<void>((r) => { liberer = r })
    const b = bontonDeLaSaisie()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.appels.filter((a) => a.nom === 'consigner_au_dossier_permanent')).toHaveLength(1)
    // Pendant la relecture : « Consigner une entrée », « Nouvelle version » et « Retirer » sont grisés, le panneau reste ouvert.
    expect(bouton(section(), 'Consigner une entrée').disabled).toBe(true)
    expect(bouton(section(), 'Nouvelle version de Bail existant').disabled).toBe(true)
    expect(bouton(section(), 'Retirer Bail existant').disabled).toBe(true)
    expect(bontonDeLaSaisie().disabled).toBe(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail existant')) })
    expect(faux.appels.filter((a) => a.nom === 'retirer_du_dossier_permanent')).toHaveLength(0)
    await act(async () => { liberer() })
    expect(bouton(section(), 'Consigner une entrée').disabled).toBe(false)
    expect(faux.appels).toHaveLength(1)
  })

  it('un refus de la base se dit sous les mots de la base, le panneau garde la saisie, et la liste est relue', async () => {
    dossier2025([])
    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: 'La pièce ou le document cité n\'est pas de ce dossier.' } })
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', 'Un texte.')
    const lecturesAvant = faux.lectures.dossier_permanent ?? 0
    await act(async () => { bontonDeLaSaisie().click() })

    expect(within(volet()).getByText('La pièce ou le document cité n\'est pas de ce dossier.')).toBeDefined()
    expect((champ('Titre') as HTMLInputElement).value).toBe('Bail')
    expect(faux.lectures.dossier_permanent).toBe(lecturesAvant + 1)
    // Le verrou est relâché : un second essai part.
    expect(bontonDeLaSaisie().disabled).toBe(false)
    await act(async () => { bontonDeLaSaisie().click() })
    expect(faux.appels).toHaveLength(2)
  })

  it('un refus sans phrase de la base se dit par un message de repli', async () => {
    dossier2025([])
    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: '' } })
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', 'Un texte.')
    await act(async () => { bontonDeLaSaisie().click() })
    expect(within(volet()).getByText('L’entrée n’a pas pu être consignée.')).toBeDefined()
  })

  it('abandonner une saisie non enregistrée se confirme ; une saisie enregistrée ferme sans rien demander', async () => {
    dossier2025([])
    rendre()
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', 'Un texte.')
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un autre contenu' })) })
    expect(confirmation).toHaveBeenCalledWith('L’entrée en cours de saisie n’est pas enregistrée. L’abandonner ?')
    expect(screen.queryByText('Autre contenu')).toBeNull()
    expect(champ('Titre')).toBeDefined()

    confirmation.mockReturnValue(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un autre contenu' })) })
    expect(screen.getByText('Autre contenu')).toBeDefined()

    // Rouverte, enregistrée : le panneau se ferme sans demander l'abandon d'une saisie qu'il vient d'écrire.
    confirmation.mockClear()
    await ouvrirLaConsignation()
    saisir('bail', 'Bail', 'Un texte.')
    await act(async () => { bontonDeLaSaisie().click() })
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.appels).toHaveLength(1)
  })
})

describe('RevisionTab, dossier permanent — nouvelle version', () => {
  const courante = () => entree({
    id: idDEntree(1), nature: 'bail', titre: 'Bail commercial', texte: 'Trois ans.', piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION,
    valable_du: '2024-07-01', valable_jusqu_au: '2033-06-30',
  })

  it('part de la version courante, et la remplace : p_remplace_id est la courante, la nature peut changer', async () => {
    dossier2025([courante()])
    rendre()
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    expect((champ('Nature') as HTMLSelectElement).value).toBe('bail')
    expect((champ('Titre') as HTMLInputElement).value).toBe('Bail commercial')
    expect((champ(/^Texte/) as HTMLTextAreaElement).value).toBe('Trois ans.')
    expect((champ('Valable du') as HTMLInputElement).value).toBe('2024-07-01')
    expect(texte(volet())).toContain('bail-fictif.pdf')
    // Rien n'a changé : la nouvelle version n'est pas une saisie à abandonner, et — rien ne différant de la courante — elle ne
    // s'enregistre pas (R7C-Q2).
    expect(bontonDeLaSaisie().disabled).toBe(true)

    fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial, avenant 1' } })
    fireEvent.change(champ('Nature'), { target: { value: 'contrat' } })
    await act(async () => { bontonDeLaSaisie().click() })

    expect(faux.appels).toEqual([{
      nom: 'consigner_au_dossier_permanent',
      args: {
        p_dossier_id: DOSSIER, p_nature: 'contrat', p_titre: 'Bail commercial, avenant 1', p_texte: 'Trois ans.',
        p_citation: { piece_id: PIECE_BAIL }, p_valable_du: '2024-07-01', p_valable_jusqu_au: '2033-06-30', p_remplace_id: idDEntree(1),
      },
    }])
    // Une seule entrée courante, rangée sous sa nouvelle nature ; l'ancienne version est dans l'historique.
    expect([...section().querySelectorAll('h4')].map((h) => h.textContent).filter((t) => t !== 'À titre d’information')).toEqual(['Contrat'])
    const ligne = ligneDe('Bail commercial, avenant 1')
    expect(texte(ligne)).toContain('version 2')
    expect(texte(within(ligne).getByText('Historique (2 versions)').closest('details') as Element)).toContain('Bail commercial')
  })

  it('RETIENT la version qu’elle remplace : une autre prise depuis se dit avant le clic (refus 8), sans écrire', async () => {
    dossier2025([courante(), entree({ id: idDEntree(2), nature: 'description', titre: 'Description' })])
    rendre()
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial, avenant 1' } })
    expect(bontonDeLaSaisie().disabled).toBe(false)

    // Une autre version de la même entrée est consignée depuis (un autre poste du cabinet) ; la relecture qui suit un geste de
    // l'onglet — ici un retrait d'une AUTRE entrée — la montre.
    ;(faux.tables.dossier_permanent as EntreeDossierPermanent[]).push(entree({
      id: idDEntree(3), nature: 'bail', titre: 'Bail commercial (autre poste)', texte: 'x', remplace_id: idDEntree(1), cree_le: '2026-03-10T09:00:00+00:00',
    }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Description')) })

    expect(texte(volet())).toContain('Cette entrée a été remplacée depuis : relire avant de la remplacer.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
    expect(faux.appels.filter((a) => a.nom === 'consigner_au_dossier_permanent')).toEqual([])
    // La saisie reste : le cabinet la recopie sur la version qu'il n'avait pas lue.
    expect((champ('Titre') as HTMLInputElement).value).toBe('Bail commercial, avenant 1')
  })

  it('l’entrée retirée depuis ne se remplace plus : le refus 8 se dit avant le clic', async () => {
    dossier2025([courante()])
    rendre()
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial')) })
    expect(texte(volet())).toContain('Cette entrée est retirée : elle ne se remplace plus, une nouvelle entrée se consigne.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
  })

  it('une citation devenue introuvable se dit avant le clic (refus 9) et se retire', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail fantôme', texte: 'Texte.', piece_id: 'bbbbbbbb-0000-4000-8000-0000000000ff', empreinte: HASH_DE_LA_CITATION })])
    rendre()
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail fantôme')) })
    expect(texte(volet())).toContain('pièce introuvable dans ce dossier')
    expect(texte(volet())).toContain('La pièce ou le document cité n\'est pas de ce dossier.')
    expect(bontonDeLaSaisie().disabled).toBe(true)
    await act(async () => { bouton(volet(), 'Retirer la citation').click() })
    expect(bontonDeLaSaisie().disabled).toBe(false)
  })

  it('passer d’une nouvelle version à une autre demande d’abandonner la saisie en cours', async () => {
    dossier2025([courante(), entree({ id: idDEntree(2), nature: 'description', titre: 'Description' })])
    rendre()
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    fireEvent.change(champ('Titre'), { target: { value: 'Changé' } })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Description')) })
    expect(confirmation).toHaveBeenCalledWith('L’entrée en cours de saisie n’est pas enregistrée. L’abandonner ?')
    expect((champ('Titre') as HTMLInputElement).value).toBe('Changé')
    confirmation.mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Description')) })
    expect((champ('Titre') as HTMLInputElement).value).toBe('Description')
  })
})

describe('RevisionTab, dossier permanent — retirer', () => {
  const unBail = () => entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial', texte: 'Trois ans.', piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION })

  it('se confirme en disant qu’une entrée retirée ne se remplace plus et reste dans l’historique ; refusé, rien ne part', async () => {
    dossier2025([unBail()])
    rendre()
    await attendreLaSection()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial')) })
    const message = String(confirmation.mock.calls[0]?.[0])
    expect(message).toContain('Retirer « Bail commercial » du dossier permanent ?')
    expect(message).toContain('Une entrée retirée ne se remplace plus')
    expect(message).toContain('Elle reste dans l’historique')
    // Elle cite une pièce : la confirmation le dit, la source reste gardée.
    expect(message).toContain('la pièce ou le document ne se supprimera toujours pas')
    expect(faux.appels).toEqual([])
  })

  it('écrit par retirer_du_dossier_permanent SEULE, une fois, relit, et l’entrée passe aux retirées', async () => {
    dossier2025([unBail(), entree({ id: idDEntree(2), nature: 'description', titre: 'Description', texte: 'Texte.' })])
    rendre()
    await attendreLaSection()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const lecturesAvant = faux.lectures.dossier_permanent ?? 0
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial')) })

    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(String(confirmation.mock.calls[0][0])).toContain('la pièce ou le document ne se supprimera toujours pas')
    expect(faux.appels).toEqual([{ nom: 'retirer_du_dossier_permanent', args: { p_dossier_id: DOSSIER, p_entree_id: idDEntree(1) } }])
    expect(faux.lectures.dossier_permanent).toBe(lecturesAvant + 1)
    expect(within(section()).queryByRole('button', { name: 'Retirer Bail commercial' })).toBeNull()
    const retirees = within(section()).getByText('Entrées retirées (1)').closest('details') as HTMLElement
    expect(texte(retirees)).toContain('Bail commercial — bail')
    expect(within(section()).getByRole('button', { name: 'Retirer Description' })).toBeDefined()
  })

  it('retire la version COURANTE d’une entrée de plusieurs versions, pas sa première', async () => {
    dossier2025([
      entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail v1', cree_le: '2026-01-05T10:00:00+00:00' }),
      entree({ id: idDEntree(2), nature: 'bail', titre: 'Bail v2', remplace_id: idDEntree(1), cree_le: '2026-02-05T10:00:00+00:00' }),
    ])
    rendre()
    await attendreLaSection()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail v2')) })
    expect(faux.appels).toEqual([{ nom: 'retirer_du_dossier_permanent', args: { p_dossier_id: DOSSIER, p_entree_id: idDEntree(2) } }])
  })

  it('l’entrée repérée par le panneau ouvert se dit à la lecture d’écran', async () => {
    dossier2025([unBail()])
    rendre()
    await attendreLaSection()
    expect(ligneDe('Bail commercial').getAttribute('aria-current')).toBeNull()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    expect(ligneDe('Bail commercial').getAttribute('aria-current')).toBe('true')
  })

  it('deux clics dans le MÊME instant ne retirent qu’une fois', async () => {
    dossier2025([unBail()])
    rendre()
    await attendreLaSection()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const b = bouton(section(), 'Retirer Bail commercial')
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.appels.filter((a) => a.nom === 'retirer_du_dossier_permanent')).toHaveLength(1)
  })

  it('un refus de la base se dit sous l’entrée, sous les mots de la base ; la liste est relue et le verrou relâché', async () => {
    dossier2025([unBail()])
    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: 'Cette entrée a été remplacée depuis : relire avant de la retirer.' } })
    rendre()
    await attendreLaSection()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const lecturesAvant = faux.lectures.dossier_permanent ?? 0
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial')) })
    expect(within(ligneDe('Bail commercial')).getByText('Cette entrée a été remplacée depuis : relire avant de la retirer.')).toBeDefined()
    expect(faux.lectures.dossier_permanent).toBe(lecturesAvant + 1)
    expect(bouton(section(), 'Retirer Bail commercial').disabled).toBe(false)
  })

  it('un refus sans phrase de la base se dit par un message de repli', async () => {
    dossier2025([unBail()])
    faux.reponseRpc = () => Promise.resolve({ data: null, error: { message: '' } })
    rendre()
    await attendreLaSection()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial')) })
    expect(within(ligneDe('Bail commercial')).getByText('L’entrée n’a pas pu être retirée.')).toBeDefined()
  })
})

// UN SEUL GESTE D'ÉCRITURE À LA FOIS DANS L'ONGLET : chacun relit, et une relecture plus lente ne doit pas écrire par-dessus
// celle qui suit l'autre écriture. Le dossier permanent partage le garde des décisions, des cycles et de la revue analytique —
// dans les deux sens, et au niveau du verrou, que deux clics du même instant (sans rendu entre eux) ne voient que là.
describe('RevisionTab, dossier permanent — un seul geste à la fois dans l’onglet', () => {
  const MOTIF = 'Un dixième des recettes de l’exercice précédent'
  const onglet = () => screen.getByRole('region', { name: 'Revue analytique' })

  function saisirLeSeuil() {
    fireEvent.change(within(onglet()).getByLabelText('Seuil de signification (€)'), { target: { value: '50' } })
    fireEvent.change(within(onglet()).getByLabelText('Motif du seuil'), { target: { value: MOTIF } })
  }
  const boutonDuSeuil = () => within(onglet()).getByRole('button', { name: 'Fixer le seuil' }) as HTMLButtonElement
  const sansSeuil = async (nom: string, args: Record<string, unknown>) =>
    (nom === 'fixer_seuil_de_signification' ? { data: null, error: null } : rpcCommeLaBase(nom, args))

  it('pendant la relecture d’une entrée, le seuil de la revue analytique est grisé — et inversement', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail' })])
    faux.reponseRpc = sansSeuil
    rendre()
    await attendreLaSection()
    saisirLeSeuil()
    expect(boutonDuSeuil().disabled).toBe(false)

    await ouvrirLaConsignation()
    saisir('bail', 'Autre bail', 'Texte.')
    let liberer = () => {}
    faux.retenues.dossier_permanent = new Promise<void>((r) => { liberer = r })
    await act(async () => { bontonDeLaSaisie().click() })
    expect(boutonDuSeuil().disabled).toBe(true)
    await act(async () => { liberer() })
    expect(boutonDuSeuil().disabled).toBe(false)

    // Inversement : pendant la relecture d'un seuil, ni « Consigner une entrée » ni « Retirer » ne sont offerts.
    faux.retenues = {}
    let libererLeSeuil = () => {}
    faux.retenues.revision_seuils = new Promise<void>((r) => { libererLeSeuil = r })
    await act(async () => { boutonDuSeuil().click() })
    expect(bouton(section(), 'Consigner une entrée').disabled).toBe(true)
    expect(bouton(section(), 'Retirer Bail').disabled).toBe(true)
    await act(async () => { libererLeSeuil() })
    expect(bouton(section(), 'Consigner une entrée').disabled).toBe(false)
  })

  it('deux gestes du même instant, sans rendu entre eux : seul le premier part (le verrou, pas le bouton)', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail' })])
    faux.reponseRpc = sansSeuil
    rendre()
    await attendreLaSection()
    saisirLeSeuil()
    await ouvrirLaConsignation()
    saisir('bail', 'Autre bail', 'Texte.')
    const consigner = bontonDeLaSaisie()
    const seuil = boutonDuSeuil()
    // L'entrée d'abord : le seuil, qui voit le verrou pris, ne part pas.
    await act(async () => { consigner.click(); seuil.click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
  })

  it('le seuil d’abord : l’entrée, qui voit le verrou pris, ne part pas', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail' })])
    faux.reponseRpc = sansSeuil
    rendre()
    await attendreLaSection()
    saisirLeSeuil()
    await ouvrirLaConsignation()
    saisir('bail', 'Autre bail', 'Texte.')
    const consigner = bontonDeLaSaisie()
    const seuil = boutonDuSeuil()
    await act(async () => { seuil.click(); consigner.click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['fixer_seuil_de_signification'])
  })

  it('le retrait et la consignation du même instant : un seul part', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail' })])
    rendre()
    await attendreLaSection()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await ouvrirLaConsignation()
    saisir('bail', 'Autre bail', 'Texte.')
    const consigner = bontonDeLaSaisie()
    const retirer = bouton(section(), 'Retirer Bail')
    await act(async () => { consigner.click(); retirer.click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
  })
})

// ── R7C-Q1, option B : la section s'affiche QUEL QUE SOIT l'exercice (décision du cabinet du 12/10/2026) ───────────────────────

// Un dossier NEUF : ni pièce, ni mouvement, ni écriture — l'en-tête du dossier n'offre aucun exercice à choisir.
function dossierNeuf(entrees: EntreeDossierPermanent[] = []) {
  dossier2025(entrees)
  faux.tables.pieces = []
  faux.tables.documents_divers = []
}

describe('RevisionTab, dossier permanent — sans exercice choisi', () => {
  it.each<[string, ValeurAnnee]>([['toutes', 'toutes'], ['sans date', 'sans_date']])(
    '« %s » : la partie annuelle demande un exercice, et la section s’offre avec tous ses gestes',
    async (_nom, annee) => {
      dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial', piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION })])
      rendre({ annee })
      expect(await screen.findByText(/choisis-en un en tête du dossier/)).toBeDefined()
      expect(screen.getByText(/Le dossier permanent, lui, ne dépend pas de l’exercice/)).toBeDefined()
      // Rien de la partie annuelle.
      expect(screen.queryByRole('region', { name: 'Cycle Ensemble' })).toBeNull()
      expect(screen.queryByText('Soldes à justifier')).toBeNull()
      // La section, elle, est là, avec ses trois gestes.
      await attendreLaSection()
      expect(bouton(section(), 'Consigner une entrée').disabled).toBe(false)
      expect(bouton(section(), 'Nouvelle version de Bail commercial').disabled).toBe(false)
      expect(bouton(section(), 'Retirer Bail commercial')).toBeDefined()
      expect(texte(ligneDe('Bail commercial'))).toContain('empreinte intacte')
    },
  )

  it('consigne une entrée sans exercice : la même fonction, les mêmes arguments, la liste relue', async () => {
    dossier2025([])
    rendre({ annee: 'toutes' })
    await attendreLaSection()
    await ouvrirLaConsignation()
    saisir('lettre_mission', 'Lettre de mission', 'Mission de présentation des comptes.')
    await act(async () => { bontonDeLaSaisie().click() })
    expect(faux.appels).toEqual([{
      nom: 'consigner_au_dossier_permanent',
      args: {
        p_dossier_id: DOSSIER, p_nature: 'lettre_mission', p_titre: 'Lettre de mission', p_texte: 'Mission de présentation des comptes.',
        p_citation: null, p_valable_du: null, p_valable_jusqu_au: null, p_remplace_id: null,
      },
    }])
    expect(within(section()).getByText('Lettre de mission', { selector: '.check-ligne-libelle' })).toBeDefined()
    expect(faux.lectures.dossier_permanent).toBe(2)
  })

  it('remplace et retire sans exercice, sous les mêmes confirmations', async () => {
    dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial', texte: 'Trois ans.' })])
    rendre({ annee: 'toutes' })
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), 'Nouvelle version de Bail commercial')) })
    fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial, avenant' } })
    await act(async () => { bontonDeLaSaisie().click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
    expect(faux.appels[0].args.p_remplace_id).toBe(idDEntree(1))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { fireEvent.click(bouton(section(), 'Retirer Bail commercial, avenant')) })
    expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent', 'retirer_du_dossier_permanent'])
  })

  it('un dossier NEUF, sans aucune année à choisir, le dit autrement — et la section s’offre dès maintenant', async () => {
    dossierNeuf()
    rendre({ annee: 'toutes', exercices: [] })
    expect(await screen.findByText(/Aucun exercice n’est encore à réviser/)).toBeDefined()
    expect(screen.getByText(/la révision des soldes attendra la première pièce datée ou le premier mouvement\s+daté du dossier/)).toBeDefined()
    expect(screen.getByText(/Le dossier permanent, lui, se consigne dès maintenant, ci-dessous/)).toBeDefined()
    expect(screen.queryByText(/choisis-en un en tête du dossier/)).toBeNull()
    await attendreLaSection()
    expect(within(section()).getByText('Aucune entrée n’est consignée au dossier permanent.')).toBeDefined()
    await ouvrirLaConsignation()
    saisir('lettre_mission', 'Lettre de mission', 'Mission.')
    await act(async () => { bontonDeLaSaisie().click() })
    expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
    expect(within(section()).getByText('Lettre de mission', { selector: '.check-ligne-libelle' })).toBeDefined()
  })

  it('un exercice déjà validé est une année à choisir, même sur un dossier sans pièce : l’ancien message demeure', async () => {
    dossierNeuf()
    rendre({ annee: 'toutes', exercices: [exerciceValide(2024)] })
    expect(await screen.findByText(/choisis-en un en tête du dossier/)).toBeDefined()
    expect(screen.queryByText(/Aucun exercice n’est encore à réviser/)).toBeNull()
  })

  it('un mouvement daté est une année à choisir', async () => {
    dossierNeuf()
    faux.tables.lignes_bancaires = [{ id: 'l1', dossier_id: DOSSIER, date: '2025-02-03', libelle: 'MOUVEMENT FICTIF', montant: -10 }]
    rendre({ annee: 'toutes', exercices: [] })
    expect(await screen.findByText(/choisis-en un en tête du dossier/)).toBeDefined()
  })

  it('rien n’est dit ni offert avant le retour des lectures, exercice choisi ou non', async () => {
    dossierNeuf([entree()])
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    rendre({ annee: 'toutes', exercices: [] })
    expect(screen.getByText('Chargement…')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Dossier permanent' })).toBeNull()
    expect(screen.queryByText(/Aucun exercice n’est encore à réviser|choisis-en un/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Consigner une entrée/ })).toBeNull()
    await act(async () => { liberer() })
    await attendreLaSection()
    expect(bouton(section(), 'Consigner une entrée')).toBeDefined()
  })

  describe('la section n’attend que ses lectures', () => {
    it.each(['lignes_bancaires', 'categories', 'controles_releves_bancaires', 'soldes_reportes', 'revision_justifications', 'revision_conclusions', 'revision_seuils'])(
      'la table %s refusée fait taire la partie annuelle, jamais la section (sans exercice)', async (table) => {
        dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial' })])
        faux.refusees.add(table)
        rendre({ annee: 'toutes' })
        await attendreLaSection()
        expect(bouton(section(), 'Consigner une entrée').disabled).toBe(false)
        expect(bouton(section(), 'Nouvelle version de Bail commercial')).toBeDefined()
        expect(screen.queryByRole('region', { name: 'Cycle Ensemble' })).toBeNull()
      },
    )

    it('de même avec un exercice choisi : une table étrangère refusée, la section demeure pendant que la révision se tait', async () => {
      dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial' })])
      faux.refusees.add('lignes_bancaires')
      rendre({ annee: 2025 })
      await attendreLaSection()
      expect(screen.getByText(/Les données du dossier n'ont pas pu être lues en entier/)).toBeDefined()
      expect(bouton(section(), 'Consigner une entrée').disabled).toBe(false)
      expect(screen.queryByRole('region', { name: 'Cycle Ensemble' })).toBeNull()
    })

    it('une table étrangère refusée n’empêche ni de consigner ni de relire', async () => {
      dossier2025([])
      faux.refusees.add('revision_conclusions')
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      await ouvrirLaConsignation()
      saisir('statuts', 'Statuts', 'Texte.')
      await act(async () => { bontonDeLaSaisie().click() })
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
      expect(within(section()).getByText('Statuts', { selector: '.check-ligne-libelle' })).toBeDefined()
    })

    it.each([
      ['pieces', /Les pièces du dossier n'ont pas pu être affichées en entier/],
      ['documents_divers', /Les documents du dossier n'ont pas pu être affichés en entier/],
    ] as const)('la table %s, refusée, fait taire la section seule — qui dit pourquoi, sans exercice aussi', async (table, mot) => {
      dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial' })])
      faux.refusees.add(table)
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(within(section()).getByText(mot)).toBeDefined()
      expect(within(section()).queryByRole('button')).toBeNull()
      expect(within(section()).queryByText(/Bail commercial|Aucune entrée n’est consignée|À titre d’information/)).toBeNull()
    })

    it('les pièces au plafond du serveur (lecture partielle sans refus) : la section se tait aussi', async () => {
      dossier2025([entree({ id: idDEntree(1), nature: 'bail', titre: 'Bail commercial' })])
      faux.plafonds.pieces = 1
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(within(section()).getByText(/Les pièces du dossier n'ont pas pu être affichées en entier/)).toBeDefined()
      expect(within(section()).queryByRole('button')).toBeNull()
    })

    it('le dossier permanent refusé, sans exercice : la section seule le dit, la partie annuelle demande un exercice', async () => {
      dossier2025([entree()])
      faux.refusees.add('dossier_permanent')
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(within(section()).getByText(/Les entrées du dossier permanent n'ont pas pu être lues en entier/)).toBeDefined()
      expect(within(section()).queryByRole('button')).toBeNull()
      expect(screen.getByText(/choisis-en un en tête du dossier/)).toBeDefined()
    })
  })

  describe('le jour d’aujourd’hui, à Paris, lu au rendu', () => {
    const entrees = () => [
      entree({ id: idDEntree(1), nature: 'lettre_mission', titre: 'Finie hier', valable_du: null, valable_jusqu_au: '2026-03-14' }),
      entree({ id: idDEntree(2), nature: 'description', titre: 'Un seul jour', valable_du: '2026-03-15', valable_jusqu_au: '2026-03-15' }),
      entree({ id: idDEntree(3), nature: 'organisation_comptable', titre: 'Commence demain', valable_du: '2026-03-16', valable_jusqu_au: null }),
      entree({ id: idDEntree(4), nature: 'bail', titre: 'Sans terme', valable_du: null, valable_jusqu_au: null }),
    ]

    it('dit « ne couvre pas aujourd’hui », bornes comprises, et ce que A9 propose sans entrée en vigueur aujourd’hui', async () => {
      dossier2025(entrees())
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(texte(ligneDe('Finie hier'))).toContain('— ne couvre pas aujourd’hui')
      expect(texte(ligneDe('Un seul jour'))).not.toContain('ne couvre pas')
      expect(texte(ligneDe('Commence demain'))).toContain('— ne couvre pas aujourd’hui')
      expect(texte(ligneDe('Sans terme'))).not.toContain('ne couvre pas')
      const info = within(section()).getByText('À titre d’information').parentElement as HTMLElement
      expect(texte(info)).toContain('Aucune lettre de mission n’est en vigueur aujourd’hui.')
      expect(texte(info)).toContain('Aucune présentation de l’organisation comptable n’est en vigueur aujourd’hui.')
      expect(texte(info)).not.toContain('description de l’entité')
      expect(texte(section())).not.toMatch(/en vigueur en \d{4}/)
      expect(texte(section())).not.toMatch(/ne couvre pas \d{4}/)
    })

    it('le jour est celui de PARIS : minuit passé à Paris, le jour d’UTC est encore la veille', async () => {
      dossier2025(entrees())
      // 23 h 30 UTC le 14 mars = 0 h 30 à Paris le 15 : « Finie hier » (jusqu'au 14) ne couvre plus le jour.
      vi.setSystemTime(new Date('2026-03-14T23:30:00Z'))
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(texte(ligneDe('Finie hier'))).toContain('ne couvre pas aujourd’hui')
      expect(texte(ligneDe('Un seul jour'))).not.toContain('ne couvre pas')
    })

    it('se relit à CHAQUE rendu : la page ne se recharge pas d’un jour à l’autre', async () => {
      dossier2025(entrees())
      vi.setSystemTime(new Date('2026-03-15T10:00:00Z'))
      rendre({ annee: 'toutes' })
      await attendreLaSection()
      expect(texte(ligneDe('Un seul jour'))).not.toContain('ne couvre pas')
      expect(texte(ligneDe('Commence demain'))).toContain('ne couvre pas aujourd’hui')
      // Le lendemain, un rendu de plus (l'ouverture du panneau) : le jour change, sans rechargement.
      vi.setSystemTime(new Date('2026-03-16T10:00:00Z'))
      await ouvrirLaConsignation()
      expect(texte(ligneDe('Un seul jour'))).toContain('ne couvre pas aujourd’hui')
      expect(texte(ligneDe('Commence demain'))).not.toContain('ne couvre pas')
    })

    it('avec un exercice choisi, rien ne change : l’exercice, jamais le jour', async () => {
      dossier2025(entrees())
      rendre({ annee: 2025 })
      await attendreLaSection()
      expect(texte(ligneDe('Finie hier'))).not.toContain('ne couvre pas')
      expect(texte(ligneDe('Commence demain'))).toContain('— ne couvre pas 2025')
      expect(texte(section())).toContain('Aucune présentation de l’organisation comptable n’est en vigueur en 2025.')
      expect(texte(section())).not.toContain('aujourd’hui')
    })
  })
})

// ── R7C-Q2, option B : une nouvelle version garde son préremplissage, avec trois garde-fous ────────────────────────────────────

describe('RevisionTab, dossier permanent — les garde-fous d’une nouvelle version', () => {
  const bail = (o: Partial<EntreeDossierPermanent> = {}) => entree({
    id: idDEntree(1), nature: 'bail', titre: 'Bail commercial', texte: 'Trois ans.', piece_id: PIECE_BAIL, empreinte: HASH_DE_LA_CITATION,
    valable_du: '2024-07-01', valable_jusqu_au: '2033-06-30', ...o,
  })
  const ouvrir = async (titre = 'Bail commercial') => {
    await attendreLaSection()
    await act(async () => { fireEvent.click(bouton(section(), `Nouvelle version de ${titre}`)) })
  }
  const modifier = () => fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial, avenant 1' } })
  const changerLaPiece = (hash: string | null) => {
    const cible = (faux.tables.pieces as Piece[]).find((x) => x.id === PIECE_BAIL)
    if (cible) cible.storage_hash = hash
  }
  const chercher = (terme: string) => fireEvent.change(within(volet()).getByPlaceholderText(/Chercher un justificatif/), { target: { value: terme } })

  describe('« Enregistrer la nouvelle version » reste grisé tant que rien ne diffère', () => {
    it('grisé à l’ouverture, avec la raison ; dégrisé par un changement ; grisé de nouveau quand on le défait', async () => {
      dossier2025([bail()])
      rendre()
      await ouvrir()
      expect(bontonDeLaSaisie().disabled).toBe(true)
      expect(bontonDeLaSaisie().title).toBe('Rien n’a changé depuis la version courante : une nouvelle version identique ne remplacerait rien.')
      expect(texte(volet())).toContain('« Enregistrer la nouvelle version » : Rien n’a changé depuis la version courante')
      modifier()
      expect(bontonDeLaSaisie().disabled).toBe(false)
      expect(bontonDeLaSaisie().title).toBe('')
      expect(texte(volet())).not.toContain('Rien n’a changé')
      fireEvent.change(champ('Titre'), { target: { value: 'Bail commercial' } })
      expect(bontonDeLaSaisie().disabled).toBe(true)
      // Cliquer un bouton grisé n'écrit rien.
      await act(async () => { bontonDeLaSaisie().click() })
      expect(faux.appels).toEqual([])
    })

    it.each<[string, () => void]>([
      ['la nature', () => fireEvent.change(champ('Nature'), { target: { value: 'contrat' } })],
      ['le titre', () => fireEvent.change(champ('Titre'), { target: { value: 'Autre titre' } })],
      ['le texte', () => fireEvent.change(champ(/^Texte/), { target: { value: 'Cinq ans.' } })],
      ['le début de validité', () => fireEvent.change(champ('Valable du'), { target: { value: '2024-08-01' } })],
      ['la fin de validité', () => fireEvent.change(champ('Valable jusqu’au'), { target: { value: '2034-06-30' } })],
    ])('dégrisé par un changement de %s', async (_quoi, changer) => {
      dossier2025([bail()])
      rendre()
      await ouvrir()
      expect(bontonDeLaSaisie().disabled).toBe(true)
      changer()
      expect(bontonDeLaSaisie().disabled).toBe(false)
    })

    it('dégrisé par un changement de citation (retirée), grisé de nouveau si on la remet', async () => {
      dossier2025([bail()])
      rendre()
      await ouvrir()
      await act(async () => { bouton(volet(), 'Retirer la citation').click() })
      expect(bontonDeLaSaisie().disabled).toBe(false)
      chercher('bail')
      await act(async () => { bouton(volet(), 'Citer bail-fictif.pdf').click() })
      expect(bontonDeLaSaisie().disabled).toBe(true)
    })

    // R7C2-Q1 (décision du cabinet du 12/10/2026) : citer de nouveau un fichier changé, ou qui n'a plus d'empreinte, relève
    // l'empreinte d'aujourd'hui — c'est en soi un changement, et la confirmation le garde.
    it.each<[string, string | null]>([
      ['changée', AUTRE_HASH],
      ['disparue', null],
    ])('une citation reprise %s suffit à le dégriser, sans autre changement (R7C2-Q1)', async (_etat, hash) => {
      dossier2025([bail()])
      changerLaPiece(hash)
      rendre()
      await ouvrir()
      expect(bontonDeLaSaisie().disabled).toBe(false)
      expect(bontonDeLaSaisie().title).toBe('')
      expect(texte(volet())).not.toContain('Rien n’a changé')
    })

    it('l’exception s’arrête là : une citation reprise « sans empreinte » le laisse grisé tant que rien ne diffère', async () => {
      dossier2025([bail({ empreinte: null })])
      rendre()
      await ouvrir()
      expect(texte(volet())).toContain('sans empreinte')
      expect(bontonDeLaSaisie().disabled).toBe(true)
      expect(bontonDeLaSaisie().title).toBe('Rien n’a changé depuis la version courante : une nouvelle version identique ne remplacerait rien.')
    })

    it('« Consigner l’entrée » d’une entrée NOUVELLE n’est pas concernée', async () => {
      dossier2025([])
      rendre()
      await attendreLaSection()
      await ouvrirLaConsignation()
      saisir('lettre_mission', 'Lettre', 'Texte.')
      expect(bontonDeLaSaisie().textContent).toBe('Consigner l’entrée')
      expect(bontonDeLaSaisie().disabled).toBe(false)
      expect(texte(volet())).not.toContain('Rien n’a changé')
    })

    it('le rappel : ce qui n’est pas modifié — dates de validité comprises — est repris tel quel', async () => {
      dossier2025([bail()])
      rendre()
      await ouvrir()
      expect(texte(volet())).toContain('ce qui n’est pas modifié — dates de validité comprises — est repris tel quel')
    })
  })

  describe('le volet MONTRE l’état de la citation reprise', () => {
    it('intacte : les mots et l’explication, aucun avertissement, aucune confirmation à l’enregistrement', async () => {
      dossier2025([bail()])
      rendre()
      await ouvrir()
      const note = texte(volet())
      expect(note).toContain('Citation reprise de la version courante')
      expect(note).toContain('empreinte intacte')
      expect(note).toContain('Le fichier cité porte encore l’empreinte relevée le jour de la citation.')
      expect(volet().querySelector('.error-text')).toBeNull()
      modifier()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).not.toHaveBeenCalled()
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
    })

    it('sans empreinte à la citation : dit en mots, sans avertissement ni confirmation', async () => {
      dossier2025([bail({ empreinte: null })])
      rendre()
      await ouvrir()
      expect(texte(volet())).toContain('sans empreinte')
      expect(texte(volet())).toContain('Le fichier n’avait pas d’empreinte le jour de la citation : rien ne se vérifie.')
      expect(volet().querySelector('.error-text')).toBeNull()
      modifier()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).not.toHaveBeenCalled()
    })

    it('introuvable : dit en mots, avec le refus 9 du module, et sans la confirmation du fichier changé', async () => {
      dossier2025([bail({ piece_id: 'bbbbbbbb-0000-4000-8000-0000000000ff' })])
      rendre()
      await ouvrir()
      expect(texte(volet())).toContain('introuvable dans ce qui a été lu')
      expect(texte(volet())).toContain('Le fichier cité n’est pas dans ce que l’écran a lu : il a pu être retiré du dossier.')
      expect(texte(volet())).not.toContain('Cette nouvelle version citera le fichier tel qu’il est aujourd’hui')
    })

    it('un document cité : son état se lit de même', async () => {
      dossier2025([entree({ id: idDEntree(1), nature: 'statuts', titre: 'Statuts', document_id: DOCUMENT_STATUTS, empreinte: HASH_DE_LA_CITATION })])
      rendre()
      await ouvrir('Statuts')
      expect(texte(volet())).toContain('empreinte intacte')
    })

    it('une entrée qui ne cite rien n’a pas d’état de citation', async () => {
      dossier2025([bail({ piece_id: null, empreinte: null })])
      rendre()
      await ouvrir()
      expect(texte(volet())).not.toContain('Citation reprise')
    })

    it('une citation choisie dans le volet dit que son empreinte sera relevée à l’enregistrement', async () => {
      dossier2025([])
      rendre()
      await attendreLaSection()
      await ouvrirLaConsignation()
      expect(texte(volet())).not.toContain('sera relevée à l’enregistrement.')
      chercher('avenant')
      await act(async () => { bouton(volet(), 'Citer avenant-fictif.pdf').click() })
      expect(texte(volet())).toContain('Citation choisie ici : l’empreinte du fichier sera relevée à l’enregistrement.')
      await act(async () => { bouton(volet(), 'Retirer la citation').click() })
      expect(texte(volet())).not.toContain('Citation choisie ici')
    })

    it('la citation reprise puis remplacée par une autre : l’état de la reprise disparaît, la nouvelle se dit, rien à confirmer', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await ouvrir()
      expect(texte(volet())).toContain('fichier changé depuis la citation')
      await act(async () => { bouton(volet(), 'Retirer la citation').click() })
      expect(texte(volet())).not.toContain('Citation reprise')
      expect(volet().querySelector('.error-text')).toBeNull()
      chercher('avenant')
      await act(async () => { bouton(volet(), 'Citer avenant-fictif.pdf').click() })
      expect(texte(volet())).toContain('Citation choisie ici : l’empreinte du fichier sera relevée à l’enregistrement.')
      expect(volet().querySelector('.error-text')).toBeNull()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).not.toHaveBeenCalled()
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
    })
  })

  describe('une citation « changée » ou « disparue » se dit AVANT le clic, puis se confirme', () => {
    it('changée : le volet le dit en clair avant tout clic, sans confirmation tant qu’on n’enregistre pas', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
      rendre()
      await ouvrir()
      const note = texte(volet())
      expect(note).toContain('fichier changé depuis la citation')
      expect(note).toContain('Le fichier cité n’est plus celui qui a été cité : son empreinte a changé depuis.')
      expect(note).toContain('Cette nouvelle version citera le fichier tel qu’il est aujourd’hui')
      expect(note).toContain('l’entrée paraîtra intacte')
      expect(note).toContain('seul l’historique gardera la trace du changement')
      expect(volet().querySelector('.error-text')).not.toBeNull()
      expect(confirmation).not.toHaveBeenCalled()
    })

    it('changée : l’enregistrement demande une confirmation qui le redit ; refusée, rien ne part et la saisie reste', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await ouvrir()
      modifier()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).toHaveBeenCalledTimes(1)
      const demande = String(confirmation.mock.calls[0][0])
      expect(demande).toContain('« Bail commercial »')
      expect(demande).toContain('Cette nouvelle version citera le fichier tel qu’il est aujourd’hui')
      expect(demande).toContain('l’entrée paraîtra intacte')
      expect(demande).toContain('seul l’historique gardera la trace du changement')
      expect(faux.appels).toEqual([])
      expect((champ('Titre') as HTMLInputElement).value).toBe('Bail commercial, avenant 1')
    })

    it('changée : confirmée, la nouvelle version part, citant la même pièce, et le panneau se ferme', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await ouvrir()
      modifier()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(faux.appels).toHaveLength(1)
      expect(faux.appels[0].args).toMatchObject({ p_citation: { piece_id: PIECE_BAIL }, p_remplace_id: idDEntree(1), p_titre: 'Bail commercial, avenant 1' })
      // La base a relevé l'empreinte d'aujourd'hui : l'entrée paraît intacte, et l'historique garde l'ancienne version changée.
      expect(texte(ligneDe('Bail commercial, avenant 1'))).toContain('empreinte intacte')
      expect(screen.queryByLabelText('Nature')).toBeNull()
    })

    it.each<[string, string | null]>([
      ['changée', AUTRE_HASH],
      ['disparue', null],
    ])('%s, SANS autre changement : refusée, la confirmation n’envoie rien ; acceptée, la version part telle quelle (R7C2-Q1)', async (_etat, hash) => {
      dossier2025([bail()])
      changerLaPiece(hash)
      rendre()
      await ouvrir()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).toHaveBeenCalledTimes(1)
      expect(faux.appels).toEqual([])
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).toHaveBeenCalledTimes(2)
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
      expect(faux.appels[0].args).toEqual({
        p_dossier_id: DOSSIER, p_nature: 'bail', p_titre: 'Bail commercial', p_texte: 'Trois ans.', p_citation: { piece_id: PIECE_BAIL },
        p_valable_du: '2024-07-01', p_valable_jusqu_au: '2033-06-30', p_remplace_id: idDEntree(1),
      })
      expect(screen.queryByLabelText('Nature')).toBeNull()
    })

    it('disparue : dit et confirmé de même, en disant que le fichier n’a plus d’empreinte', async () => {
      dossier2025([bail()])
      changerLaPiece(null)
      rendre()
      await ouvrir()
      const note = texte(volet())
      expect(note).toContain('empreinte disparue')
      expect(note).toContain('Le fichier cité n’a plus d’empreinte : rien ne dit qu’il est resté le même.')
      expect(note).toContain('Cette nouvelle version citera le fichier tel qu’il est aujourd’hui')
      expect(note).toContain('seul l’historique gardera la trace de sa disparition')
      modifier()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).toHaveBeenCalledTimes(1)
      expect(String(confirmation.mock.calls[0][0])).toContain('seul l’historique gardera la trace de sa disparition')
      expect(faux.appels).toEqual([])
    })

    it('un document dont l’empreinte a changé : de même', async () => {
      dossier2025([entree({ id: idDEntree(1), nature: 'statuts', titre: 'Statuts', document_id: DOCUMENT_STATUTS, empreinte: HASH_DE_LA_CITATION })])
      const documents = faux.tables.documents_divers as { id: string; storage_hash: string | null }[]
      documents[0].storage_hash = AUTRE_HASH
      rendre()
      await ouvrir('Statuts')
      expect(texte(volet())).toContain('fichier changé depuis la citation')
      fireEvent.change(champ('Titre'), { target: { value: 'Statuts à jour' } })
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).toHaveBeenCalledTimes(1)
      expect(faux.appels).toEqual([])
    })

    it('retirer la citation avant d’enregistrer : plus d’avertissement ni de confirmation', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await ouvrir()
      await act(async () => { bouton(volet(), 'Retirer la citation').click() })
      expect(volet().querySelector('.error-text')).toBeNull()
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).not.toHaveBeenCalled()
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
      expect(faux.appels[0].args.p_citation).toBeNull()
    })

    it('deux clics dans le MÊME instant sur une citation changée : une seule écriture', async () => {
      dossier2025([bail()])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await ouvrir()
      modifier()
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      const b = bontonDeLaSaisie()
      await act(async () => { b.click(); b.click() })
      expect(faux.appels.filter((a) => a.nom === 'consigner_au_dossier_permanent')).toHaveLength(1)
    })

    it('une nouvelle ENTRÉE qui cite une pièce ne demande rien : il n’y a pas de version courante à effacer', async () => {
      dossier2025([])
      changerLaPiece(AUTRE_HASH)
      rendre()
      await attendreLaSection()
      await ouvrirLaConsignation()
      saisir('bail', 'Bail', 'Texte.')
      chercher('bail')
      await act(async () => { bouton(volet(), 'Citer bail-fictif.pdf').click() })
      const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
      await act(async () => { bontonDeLaSaisie().click() })
      expect(confirmation).not.toHaveBeenCalled()
      expect(faux.appels.map((a) => a.nom)).toEqual(['consigner_au_dossier_permanent'])
    })
  })
})
