import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RevisionTab from './RevisionTab'
import PanneauDroit, { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import { usePanneauDroit } from '../../lib/panneauDroit'
import { AnneeProvider } from '../../context/AnneeContext'
import { ExercicesValidesProvider } from '../../context/ExercicesValidesContext'
import { exerciceValide } from '../../test/exerciceValide'
import { DOSSIER, AUTEUR, ecritureEquilibree, ligne } from '../../test/revision'
import { explication, seuil } from '../../test/revueAnalytique'
import { conclusion } from '../../test/revisionRevue'
import { titreDeLaLigne } from '../../lib/revueAnalytiqueEcran'
import { POSTE_VENTES_FACTUREES } from '../../lib/declaration2035'
import type { ModeleComptable } from '../../lib/engagement'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import type { Categorie, ExerciceValide, Piece } from '../../lib/types'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'

// LA REVUE ANALYTIQUE DANS L'ONGLET RÉVISION (ligne 41, étape R5, phase C). Le module (lib/revueAnalytique.ts) est éprouvé à part :
// calculs, états, refus confrontés au texte des deux fonctions et rejoués sur l'essai de la base. CE QUI SE JOUE ICI, c'est ce
// qu'aucun calcul pur ne voit : que la section lise ses quatre tables EN ENTIER (le faux client applique les filtres) et ne dise
// rien sur une lecture partielle ou refusée ; que le seuil et l'explication ne partent que par leurs deux fonctions, une fois,
// sous un verrou relâché APRÈS la relecture ; que chaque refus se lise avant le clic et grise son bouton ; qu'une explication
// RETIENNE celle qu'elle remplace ; qu'une ligne expliquée passe « à revoir » quand ses montants changent.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  // Les tables dont la lecture est refusée : `lireTout` les rend incomplètes.
  refusees: new Set<string>(),
  // Une promesse que chaque LECTURE attend : le temps de voir l'écran avant toute réponse, ou pendant une relecture.
  attente: null as Promise<void> | null,
  lectures: {} as Record<string, number>,
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  reponseRpc: null as null | ((nom: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>),
  // Le compte connecté est-il chef du cabinet (la revue d'un cycle lui est réservée) ?
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
      // Un filtre sur une table jointe (`factures_emises!inner`, la lecture des lignes d'une facture) se juge sur la ligne
      // que la jointure désigne, comme en base.
      eq: (colonne: string, valeur: unknown) => {
        const [jointe, champ] = colonne.split('.')
        predicats.push(champ === undefined ? predicatEq(colonne, valeur)
          : (l) => (faux.tables[jointe] ?? []).some((x) => (x as Record<string, unknown>).id === l.facture_id && (x as Record<string, unknown>)[champ] === valeur))
        return c
      },
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
vi.mock('../../lib/controlesReleves', () => ({ chargerRelevesIncoherents: async () => [] }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: AUTEUR } }, estChef: faux.estChef }) }))

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000', plan: PLAN_PAR_DEFAUT }
const HASH = 'e'.repeat(64)

const CATEGORIES: Categorie[] = [
  { id: 'c-loyer', dossier_id: null, code: 'LOYER', libelle: 'Loyer', ordre: 1, compte_comptable: '613200', poste_2035: 'Loyers' },
  { id: 'c-banque', dossier_id: null, code: 'BANQUE', libelle: 'Frais de banque', ordre: 2, compte_comptable: '627000', poste_2035: 'Services bancaires' },
]

function piece(o: Partial<Piece>): Piece {
  return {
    id: 'p', dossier_id: DOSSIER, uploaded_by: null, source: 'upload', storage_path: `${DOSSIER}/loyer.pdf`,
    nom_fichier: 'loyer.pdf', storage_hash: HASH, date_piece: '2025-03-10', tiers: 'BAILLEUR FICTIF', montant_ht: null,
    montant_tva: null, montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    categorie_id: 'c-loyer', sous_dossier_id: null, type_piece: 'achat', statut: 'validee', notes: null, confiance: 'haute',
    superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null,
    identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, created_at: '2025-03-12T09:00:00Z',
    updated_at: '2025-03-12T09:00:00Z', ...o,
  }
}

// La base fictive : `fixer_seuil_de_signification` et `expliquer_variation` écrivent leur ligne comme les fonctions, à un instant
// qui avance d'une minute par écriture (la chaîne est l'ordre, jamais l'horodatage).
let numero = 0
const instant = () => `2026-03-15T10:${String(numero).padStart(2, '0')}:00+00:00`
function rpcCommeLaBase(nom: string, args: Record<string, unknown>) {
  if (nom === 'fixer_seuil_de_signification') {
    numero++
    faux.tables.revision_seuils.push(seuil({
      id: `s-ecrit-${numero}`, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee), seuil: Number(args.p_seuil),
      motif: String(args.p_motif), remplace_id: (args.p_remplace_id as string | null) ?? null, auteur: AUTEUR, cree_le: instant(),
    }))
    return Promise.resolve({ data: `s-ecrit-${numero}`, error: null })
  }
  if (nom === 'expliquer_variation') {
    numero++
    faux.tables.revision_explications.push(explication({
      id: `x-ecrite-${numero}`, dossier_id: String(args.p_dossier_id), annee: Number(args.p_annee),
      objet_type: args.p_objet_type as 'compte', objet: String(args.p_objet), nature: (args.p_nature as 'recette' | null) ?? null,
      montant: Number(args.p_montant), montant_precedent: (args.p_montant_precedent as number | null) ?? null,
      source_precedent: args.p_source_precedent as 'validee', explication: String(args.p_explication),
      remplace_id: (args.p_remplace_id as string | null) ?? null, auteur: AUTEUR, cree_le: instant(),
    }))
    return Promise.resolve({ data: `x-ecrite-${numero}`, error: null })
  }
  return Promise.resolve({ data: null, error: { message: `fonction inconnue : ${nom}` } })
}

// Un dossier dont l'exercice 2025 se révise (nous sommes le 15 mars 2026 à Paris) et dont 2024 est validé :
//  - le brouillon : 1 000 € en banque et en recettes en juin 2025 ; 600 € en juin 2024 ;
//  - une facture de loyer de 120 € en 2025 (exonéré : TTC), un repère de 100 € pour 2024 ;
//  - un repère annuel de 2024 : 5 000 € de recettes, 1 000 € de résultat ;
//  - deux frais de banque rapprochés, sans pièce : 300 € et 20 €.
function dossier2025() {
  faux.tables = {
    ecritures_brouillon: [
      ...ecritureEquilibree('e1', '2025-06-01', '512000', '706000', 1000),
      ...ecritureEquilibree('e0', '2024-06-01', '512000', '706000', 600),
    ],
    pieces: [piece({ id: 'p1' })],
    lignes_bancaires: [
      ligne({ id: 'l-gros', date: '2025-04-02', montant: -300, libelle: 'PRELEVEMENT GROS FICTIF', categorie_id: 'c-banque' }),
      ligne({ id: 'l-petit', date: '2025-05-02', montant: -20, libelle: 'PRELEVEMENT PETIT FICTIF', categorie_id: 'c-banque' }),
    ],
    categories: CATEGORIES,
    references_annuelles: [{ dossier_id: DOSSIER, annee: 2024, chiffre_affaires: 5000, resultat_net: 1000 }],
    references_postes_annuels: [{ dossier_id: DOSSIER, annee: 2024, poste: 'Loyers', montant: 100 }],
    cotisations_declarees: [], immobilisations: [], natures_immobilisation: [], a_nouveaux: [], emprunts: [],
    ventilations_bancaires: [], reglements_groupes: [], vehicules: [], lettrages_manuels: [], declarations_tva: [],
    factures_emises: [], transmissions_factures: [], informations_dossier: [], exercices_clotures: [], soldes_reportes: [],
    controles_releves_bancaires: [], documents_divers: [], revision_justifications: [], revision_preuves: [],
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

function rendre(o: { annee?: ValeurAnnee; exercices?: ExerciceValide[]; modele?: ModeleComptable } = {}) {
  return render(
    <FournisseurPanneauDroit>
      <ExercicesValidesProvider exercices={o.exercices ?? [exerciceValide(2024)]} relire={async () => {}}>
        <AnneeProvider defaut={o.annee ?? 2025}>
          <RevisionTab
            dossierId={DOSSIER} modele={o.modele ?? TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere"
            onNavigate={() => {}}
          />
        </AnneeProvider>
      </ExercicesValidesProvider>
      <AutreContenu />
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const section = () => screen.getByRole('region', { name: 'Revue analytique' })
const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const texte = (el: Element) => (el.textContent ?? '').replace(/[\s  ]/g, ' ')
const echapper = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const compte = (numero: string) => titreDeLaLigne({ objet_type: 'compte', objet: numero, nature: null })
const BANQUE = compte('512000')
// Le bouton d'une ligne du tableau : « Ouvrir | Expliquer | Revoir la ligne <titre> ».
const boutonDeLaLigne = (titre: string) =>
  within(section()).getByRole('button', { name: new RegExp(`la ligne ${echapper(titre)}$`) }) as HTMLButtonElement
const ligneDuTableau = (titre: string) => boutonDeLaLigne(titre).closest('tr') as HTMLElement
const boutonDuVolet = (nom: string) => within(volet()).getByRole('button', { name: nom }) as HTMLButtonElement
const boutonDeLaSection = (nom: string) => within(section()).getByRole('button', { name: nom }) as HTMLButtonElement
const champDuSeuil = () => within(section()).getByLabelText('Seuil de signification (€)') as HTMLInputElement
const motifDuSeuil = () => within(section()).getByLabelText('Motif du seuil') as HTMLTextAreaElement
const champDeLExplication = () => within(volet()).getByLabelText('Explication') as HTMLTextAreaElement
const seuilAffiche = (montant: string) => within(section()).findByText(montant, { selector: '.check-ligne-libelle' })

async function attendreLaSection() {
  await screen.findByRole('region', { name: 'Revue analytique' })
}

function saisirLeSeuil(montant: string, motif: string) {
  fireEvent.change(champDuSeuil(), { target: { value: montant } })
  fireEvent.change(motifDuSeuil(), { target: { value: motif } })
}

async function fixerLeSeuil(montant: string, motif: string) {
  saisirLeSeuil(montant, motif)
  const b = within(section()).getByRole('button', { name: /^(Fixer|Remplacer) le seuil$/ })
  await act(async () => { b.click() })
}

async function ouvrirLaLigne(titre: string) {
  await act(async () => { fireEvent.click(boutonDeLaLigne(titre)) })
}

function saisirLExplication(valeur: string) {
  fireEvent.change(champDeLExplication(), { target: { value: valeur } })
}

const MOTIF = 'Un dixième des recettes de l’exercice précédent'

beforeEach(() => {
  faux.tables = {}
  faux.refusees = new Set()
  faux.attente = null
  faux.lectures = {}
  faux.appels = []
  faux.reponseRpc = rpcCommeLaBase
  faux.estChef = false
  numero = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-03-15T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RevisionTab, revue analytique — rien avant d’avoir lu, rien sur une lecture partielle', () => {
  it('n’affirme rien tant que les lectures ne sont pas revenues', async () => {
    dossier2025()
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Revue analytique' })).toBeNull()
    expect(screen.queryByText('Fixer le seuil')).toBeNull()
    await act(async () => { liberer() })
    await attendreLaSection()
  })

  it.each([
    ['revision_seuils', /Les seuils de signification n'ont pas pu être lus en entier \(.*permission denied\)/],
    ['revision_explications', /Les explications de la revue analytique n'ont pas pu être lues en entier \(.*permission denied\)/],
    ['references_annuelles', /Les repères annuels de l’onglet Estimation n'ont pas pu être lus en entier \(.*permission denied\)/],
    ['references_postes_annuels', /Les repères par poste de l’onglet Estimation n'ont pas pu être lus en entier \(.*permission denied\)/],
  ])('la table %s refusée : la section le dit, sans tableau, sans état ni geste — le reste de l’onglet demeure', async (table, message) => {
    dossier2025()
    faux.refusees.add(table)
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(message)).toBeDefined()
    expect(within(section()).getByText(/ne dit rien d’une lecture incomplète/)).toBeDefined()
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(within(section()).queryByRole('button')).toBeNull()
    expect(within(section()).queryByLabelText('Seuil de signification (€)')).toBeNull()
    expect(within(section()).queryByText(/Sans seuil|À expliquer|Sans comparaison/)).toBeNull()
    // Les cycles de la révision des soldes ne dépendent pas de cette lecture.
    expect(screen.getByRole('button', { name: 'Ouvrir le compte 512000' })).toBeDefined()
    expect(faux.lectures[table]).toBeGreaterThan(0)
  })

  it('plusieurs lectures refusées se disent chacune', async () => {
    dossier2025()
    faux.refusees.add('revision_seuils')
    faux.refusees.add('references_annuelles')
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Les seuils de signification n'ont pas pu/)).toBeDefined()
    expect(within(section()).getByText(/Les repères annuels de l’onglet Estimation n'ont pas pu/)).toBeDefined()
  })

  it('une table de la Vue d’ensemble refusée cache toute la révision, la revue analytique avec elle', async () => {
    dossier2025()
    faux.refusees.add('pieces')
    rendre()
    expect(await screen.findByText(/pas pu être lues en entier/)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Revue analytique' })).toBeNull()
  })

  it('lit ses quatre tables pour CE dossier, et rien d’un autre', async () => {
    dossier2025()
    faux.tables.revision_seuils.push(seuil({ id: 's-autre', dossier_id: 'autre-dossier', annee: 2025, seuil: 7, motif: 'AUTRE DOSSIER' }))
    faux.tables.references_annuelles.unshift({ dossier_id: 'autre-dossier', annee: 2024, chiffre_affaires: 9, resultat_net: 9 })
    faux.tables.references_postes_annuels.unshift({ dossier_id: 'autre-dossier', annee: 2024, poste: 'Loyers', montant: 999 })
    faux.tables.revision_explications.unshift(explication({
      id: 'x-autre-dossier', dossier_id: 'autre-dossier', annee: 2025, objet: '512000', montant: 1000, montant_precedent: 600,
      source_precedent: 'validee', explication: 'EXPLICATION DE L’AUTRE DOSSIER',
    }))
    rendre()
    await attendreLaSection()
    for (const t of ['revision_seuils', 'revision_explications', 'references_annuelles', 'references_postes_annuels']) {
      expect(faux.lectures[t], t).toBe(1)
    }
    expect(texte(section())).not.toContain('AUTRE DOSSIER')
    expect(texte(section())).toContain('Aucun seuil n’est fixé pour 2025')
    // Le repère de l'autre dossier ne compare rien : celui du dossier (5 000 €) fait la variation du total des recettes.
    expect(texte(ligneDuTableau('Total des recettes'))).toContain('5 000,00 €')
    // Ni le repère par poste, ni l'explication de l'autre dossier.
    expect(texte(ligneDuTableau('Loyers (dépense)'))).toContain('100,00 €')
    expect(texte(ligneDuTableau('Loyers (dépense)'))).not.toContain('999')
    expect(texte(ligneDuTableau(BANQUE))).not.toContain('explication')
    expect(texte(ligneDuTableau(BANQUE))).not.toContain('Expliquée')
  })

  it('une chaîne de seuils qui ne se relit pas n’affirme rien et n’offre aucun geste', async () => {
    dossier2025()
    faux.tables.revision_seuils.push(
      seuil({ id: 's1', annee: 2025, remplace_id: null, cree_le: '2026-02-01T10:00:00+00:00' }),
      seuil({ id: 's2', annee: 2025, remplace_id: null, cree_le: '2026-02-02T10:00:00+00:00' }),
    )
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Le seuil de signification de 2025 ne se relit pas/)).toBeDefined()
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(within(section()).queryByRole('button')).toBeNull()
  })
})

describe('RevisionTab, revue analytique — le tableau', () => {
  it('range chaque poste de la 2035, ses totaux et chaque compte, avec leur précédent, leur variation, leur source et leur état', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    const loyers = texte(ligneDuTableau('Loyers (dépense)'))
    expect(loyers).toContain('120,00 €')
    expect(loyers).toContain('100,00 €')
    expect(loyers).toContain('+20,00 €')
    expect(loyers).toContain('+20 %')
    expect(loyers).toContain('Repère annuel')
    expect(loyers).toContain('Sans seuil')
    // Un poste sans repère ne se compare à rien, et le dit.
    const banque = texte(ligneDuTableau('Services bancaires (dépense)'))
    expect(banque).toContain('320,00 €')
    expect(banque).toContain('Aucune')
    expect(banque).toContain('Sans comparaison')
    const recettes = texte(ligneDuTableau('Total des recettes'))
    expect(recettes).toContain('5 000,00 €')
    expect(recettes).toContain('-5 000,00 €')
    expect(recettes).toContain('-100 %')
    expect(texte(ligneDuTableau('Résultat'))).toContain('-1 440,00 €')
    // Les comptes : le solde du 31/12, débit positif, face à celui de l'exercice validé.
    const banqueDuBilan = texte(ligneDuTableau(BANQUE))
    expect(banqueDuBilan).toContain('1 000,00 €')
    expect(banqueDuBilan).toContain('600,00 €')
    expect(banqueDuBilan).toContain('+400,00 €')
    expect(banqueDuBilan).toContain('+66,7 %')
    expect(banqueDuBilan).toContain('Exercice validé')
    expect(texte(section())).toContain('7 lignes — sans comparaison : 2 ; sans seuil : 5.')
  })

  it('aucune variation n’est dite normale : ni pastille, ni note de ligne', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    const pastilles = [...section().querySelectorAll('.badge')]
    expect(pastilles.length).toBeGreaterThan(5)
    for (const pastille of pastilles) expect(pastille.textContent?.toLowerCase()).not.toContain('normal')
    await ouvrirLaLigne('Total des recettes')
    expect(texte(volet()).toLowerCase()).not.toContain('normal')
  })

  it('un poste de l’exercice précédent validé qui a disparu garde sa ligne, face à zéro', async () => {
    dossier2025()
    const declaration = {
      postes: [{ poste: 'Honoraires', nature: 'recette', montant: 8000 }, { poste: 'Loyers', nature: 'depense', montant: 100 }],
      totalRecettes: 8000, totalDepenses: 100, resultat: 7900,
    }
    rendre({ exercices: [exerciceValide(2024, { declaration })] })
    await attendreLaSection()
    const honoraires = texte(ligneDuTableau('Honoraires (recette)'))
    expect(honoraires).toContain('0,00 €')
    expect(honoraires).toContain('8 000,00 €')
    expect(honoraires).toContain('-8 000,00 €')
    expect(honoraires).toContain('-100 %')
    // La 2035 validée de l'exercice précédent l'emporte sur le repère annuel de l'Estimation.
    expect(texte(ligneDuTableau('Loyers (dépense)'))).toContain('Exercice validé')
    expect(texte(ligneDuTableau('Total des recettes'))).toContain('Exercice validé')
  })

  it('une 2035 validée qui ne se relit pas le dit, et ne compare rien de la 2035', async () => {
    dossier2025()
    rendre({ exercices: [exerciceValide(2024, { declaration: { postes: 'illisible' } })] })
    await attendreLaSection()
    expect(within(section()).getByText('La 2035 validée de 2024 ne se relit pas : rien de la 2035 ne se compare.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /la ligne Loyers/ })).toBeNull()
    // Les comptes, eux, ne dépendent pas de la 2035.
    expect(boutonDeLaLigne(BANQUE)).toBeDefined()
  })

  it('l’exercice précédent pas validé : les comptes n’ont aucune comparaison, et ne se recalculent pas', async () => {
    dossier2025()
    rendre({ exercices: [] })
    await attendreLaSection()
    expect(within(section()).getByText(/L’exercice 2024 n’est pas validé : les comptes n’ont aucune comparaison/)).toBeDefined()
    const banque = texte(ligneDuTableau(BANQUE))
    expect(banque).toContain('Sans comparaison')
    expect(banque).toContain('Aucune')
    expect(banque).not.toContain('600,00')
  })

  it('un dossier en engagement n’a pas de 2035 : il le dit, et les comptes se comparent', async () => {
    dossier2025()
    rendre({ modele: ENGAGEMENT })
    await attendreLaSection()
    expect(within(section()).getByText(/tenu en comptabilité d’engagement : la 2035 n’est pas produite/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /la ligne Loyers/ })).toBeNull()
    expect(boutonDeLaLigne(BANQUE)).toBeDefined()
  })

  it('les recettes mois par mois, face au même mois de l’exercice précédent validé', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    const lignes = within(section()).getAllByRole('row')
    const juin = lignes.find((r) => texte(r).startsWith('juin 2025')) as HTMLElement
    expect(texte(juin)).toContain('1 000,00 €')
    expect(texte(juin)).toContain('600,00 €')
    expect(texte(juin)).toContain('+400,00 €')
    const janvier = lignes.find((r) => texte(r).startsWith('janvier 2025')) as HTMLElement
    expect(texte(janvier)).toContain('aucune écriture')
    expect(lignes.filter((r) => /^[a-zéû]+ 2025/.test(texte(r)))).toHaveLength(12)
  })

  it('les dépenses sans pièce : toutes sans seuil, avec le mouvement et son poste', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Aucun seuil n’est fixé : elles sont toutes montrées/)).toBeDefined()
    const gros = within(section()).getByText('PRELEVEMENT GROS FICTIF').closest('tr') as HTMLElement
    expect(texte(gros)).toContain('-300,00 € au relevé')
    expect(texte(gros)).toContain('Services bancaires')
    expect(within(section()).getByText('PRELEVEMENT PETIT FICTIF')).toBeDefined()
  })

  it('une longue liste de dépenses sans pièce se replie, et se déplie : un état tronqué se dit', async () => {
    dossier2025()
    faux.tables.lignes_bancaires = Array.from({ length: 35 }, (_, n) =>
      ligne({ id: `l-${n}`, date: '2025-04-02', montant: -(100 + n), libelle: `PRELEVEMENT FICTIF ${n}`, categorie_id: 'c-banque' }))
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText('Montrer les 5 autres')).toBeDefined()
    expect(within(section()).queryByText('PRELEVEMENT FICTIF 0')).toBeNull()
    expect(within(section()).getByText('PRELEVEMENT FICTIF 34')).toBeDefined()
    fireEvent.click(within(section()).getByRole('button', { name: 'Montrer les 5 autres' }))
    expect(within(section()).getByText('PRELEVEMENT FICTIF 0')).toBeDefined()
    expect(within(section()).queryByText(/Montrer les/)).toBeNull()
  })
})

describe('RevisionTab, revue analytique — le seuil', () => {
  it('sans seuil : aucune explication n’est attendue, et « Fixer le seuil » dit pourquoi il est grisé', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    expect(within(section()).getByText(/Aucun seuil n’est fixé pour 2025 : aucune explication n’est attendue/)).toBeDefined()
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('« Fixer le seuil » : Le seuil de signification est un montant positif, au centime.')
    expect(faux.appels).toEqual([])
  })

  it.each(['', 'abc', '-5', '0', '12,345'])('le montant %j se refuse avant le clic', async (montant) => {
    dossier2025()
    rendre()
    await attendreLaSection()
    saisirLeSeuil(montant, MOTIF)
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('Le seuil de signification est un montant positif, au centime.')
    expect(faux.appels).toEqual([])
  })

  it('un seuil se motive : sans motif, ou fait de blancs, ou trop long, le bouton est grisé sous les mots de la base', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    saisirLeSeuil('50', '')
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('Un seuil de signification se motive.')
    saisirLeSeuil('50', '  \n\t ')
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('Un seuil de signification se motive.')
    saisirLeSeuil('50', 'x'.repeat(4001))
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('Un motif tient en 4 000 caractères au plus.')
    saisirLeSeuil('50', MOTIF)
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(false)
    expect(faux.appels).toEqual([])
  })

  it('« Fixer le seuil » écrit par fixer_seuil_de_signification seule, puis relit : le seuil, son auteur et les états le disent', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    expect(faux.appels).toEqual([{
      nom: 'fixer_seuil_de_signification',
      args: { p_dossier_id: DOSSIER, p_annee: 2025, p_seuil: 50, p_motif: MOTIF, p_remplace_id: null },
    }])
    expect(faux.lectures.revision_seuils).toBe(2)
    expect(await seuilAffiche('50,00 €')).toBeDefined()
    expect(texte(section())).toContain(MOTIF)
    expect(texte(section())).toMatch(/Fixé le \d{2}\/\d{2}\/2026, par toi\./)
    // La saisie repart vide, et le geste devient un remplacement.
    expect(champDuSeuil().value).toBe('')
    expect(motifDuSeuil().value).toBe('')
    expect(boutonDeLaSection('Remplacer le seuil')).toBeDefined()
    // Au-delà du seuil, strictement : +20 € sous 50 €, ±400 € et les totaux au-delà.
    expect(texte(ligneDuTableau('Loyers (dépense)'))).toContain('Sous le seuil')
    expect(texte(ligneDuTableau('Total des recettes'))).toContain('À expliquer')
    expect(texte(ligneDuTableau(BANQUE))).toContain('À expliquer')
    expect(texte(ligneDuTableau('Services bancaires (dépense)'))).toContain('Sans comparaison')
    expect(texte(section())).toContain('7 lignes — sans comparaison : 2 ; sous le seuil : 1 ; à expliquer : 4.')
    // Le geste de chaque ligne dit ce qu'elle attend.
    expect(boutonDeLaLigne('Total des recettes').textContent).toBe('Expliquer')
    expect(boutonDeLaLigne('Loyers (dépense)').textContent).toBe('Ouvrir')
    // Les dépenses sans pièce : seule celle qui dépasse le seuil est montrée, l'autre est comptée.
    expect(within(section()).getByText('PRELEVEMENT GROS FICTIF')).toBeDefined()
    expect(within(section()).queryByText('PRELEVEMENT PETIT FICTIF')).toBeNull()
    expect(within(section()).getByText('1 autre sous le seuil, non montrée.')).toBeDefined()
  })

  it('un seuil de 20 € se lit STRICTEMENT : une variation de 20 € n’est pas au-delà', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('20', MOTIF)
    expect(texte(ligneDuTableau('Loyers (dépense)'))).toContain('Sous le seuil')
    await fixerLeSeuil('19,99', MOTIF)
    expect(await within(ligneDuTableau('Loyers (dépense)')).findByText('À expliquer')).toBeDefined()
  })

  it('« Remplacer le seuil » remplace le courant nommément, et l’historique reste', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    await fixerLeSeuil('1 200,50', 'Un autre motif')
    expect(faux.appels).toHaveLength(2)
    expect(faux.appels[1]).toEqual({
      nom: 'fixer_seuil_de_signification',
      args: { p_dossier_id: DOSSIER, p_annee: 2025, p_seuil: 1200.5, p_motif: 'Un autre motif', p_remplace_id: 's-ecrit-1' },
    })
    expect(await seuilAffiche('1 200,50 €')).toBeDefined()
    expect(within(section()).getByText('Historique du seuil (2)')).toBeDefined()
    // Le plus récent d'abord.
    const historique = [...section().querySelectorAll('details li')].map((li) => texte(li))
    expect(historique).toHaveLength(2)
    expect(historique[0]).toContain('1 200,50 €')
    expect(historique[1]).toContain('50,00 €')
    // Sous le nouveau seuil, rien n'est plus attendu des comptes ; les totaux de 5 000 € le sont encore.
    expect(texte(ligneDuTableau('Total des recettes'))).toContain('À expliquer')
    expect(texte(ligneDuTableau(BANQUE))).toContain('Sous le seuil')
  })

  it('le seuil d’un autre exercice ne compte pas pour celui-ci', async () => {
    dossier2025()
    faux.tables.revision_seuils.push(seuil({ id: 's-2024', annee: 2024, seuil: 10 }))
    rendre()
    await attendreLaSection()
    expect(texte(section())).toContain('Aucun seuil n’est fixé pour 2025')
    await fixerLeSeuil('50', MOTIF)
    expect(faux.appels[0].args.p_remplace_id).toBeNull()
  })

  it('une saisie RETIENT le seuil qu’elle remplace : un autre fixé depuis se dit avant le clic', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    saisirLeSeuil('50', MOTIF)
    // Une autre session fixe le premier seuil pendant la saisie ; la nôtre, refusée, relit.
    faux.tables.revision_seuils.push(seuil({ id: 's-autre', annee: 2025, seuil: 75, motif: 'Fixé par une autre session' }))
    faux.reponseRpc = async () => ({ data: null, error: { message: 'Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.' } })
    await act(async () => { boutonDeLaSection('Fixer le seuil').click() })
    expect(faux.appels).toHaveLength(1)
    expect(await seuilAffiche('75,00 €')).toBeDefined()
    // La saisie est gardée, et le module redit le refus de la base avant tout nouveau clic.
    expect(champDuSeuil().value).toBe('50')
    expect(boutonDeLaSection('Remplacer le seuil').disabled).toBe(true)
    expect(texte(section())).toContain('« Remplacer le seuil » : Un autre seuil a été fixé pour cet exercice depuis : relire avant de le changer.')
  })

  it('un refus de la base se dit sous ses mots, garde la saisie, et relit', async () => {
    dossier2025()
    faux.reponseRpc = async () => ({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    expect(await within(section()).findByText('Accès refusé à ce dossier.')).toBeDefined()
    expect(champDuSeuil().value).toBe('50')
    expect(faux.lectures.revision_seuils).toBe(2)
    // Une erreur sans message lisible se dit avec le repli de l'écran.
    faux.reponseRpc = async () => ({ data: null, error: {} as { message: string } })
    await act(async () => { boutonDeLaSection('Fixer le seuil').click() })
    expect(await within(section()).findByText('Le seuil n’a pas pu être enregistré.')).toBeDefined()
  })

  it('trois clics dans le même rendu n’envoient qu’un seuil', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    saisirLeSeuil('50', MOTIF)
    const b = boutonDeLaSection('Fixer le seuil')
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('le verrou ne se relâche qu’APRÈS la relecture : le geste attend, puis redevient possible', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    // Le second seuil : la relecture qui suit l'écriture est retenue.
    let liberer = () => {}
    saisirLeSeuil('60', 'Second motif')
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { boutonDeLaSection('Remplacer le seuil').click() })
    expect(faux.appels).toHaveLength(2)
    expect(boutonDeLaSection('Remplacer le seuil').disabled).toBe(true)
    expect(champDuSeuil().disabled).toBe(true)
    faux.attente = null
    await act(async () => { liberer() })
    expect(await seuilAffiche('60,00 €')).toBeDefined()
    saisirLeSeuil('70', 'Troisième motif')
    expect(boutonDeLaSection('Remplacer le seuil').disabled).toBe(false)
  })

  it('un exercice en cours : la phrase de la base, ni saisie ni geste, et les lignes « Exercice en cours »', async () => {
    dossier2025()
    faux.tables.ecritures_brouillon.push(...ecritureEquilibree('e6', '2026-02-01', '512000', '706000', 50))
    rendre({ annee: 2026 })
    await attendreLaSection()
    expect(within(section()).getByText('L\'exercice 2026 n\'est pas terminé : sa révision s\'ouvre une fois clos.')).toBeDefined()
    expect(within(section()).queryByLabelText('Seuil de signification (€)')).toBeNull()
    expect(within(section()).queryByRole('button', { name: /le seuil$/ })).toBeNull()
    expect(texte(ligneDuTableau(BANQUE))).toContain('Exercice en cours')
    expect(texte(ligneDuTableau(compte('706000')))).toContain('Exercice en cours')
    await ouvrirLaLigne(BANQUE)
    expect(texte(volet())).toContain('L\'exercice 2026 n\'est pas terminé : sa révision s\'ouvre une fois clos.')
    expect(within(volet()).queryByLabelText('Explication')).toBeNull()
    expect(within(volet()).queryByRole('button', { name: /^(Expliquer|Remplacer l’explication)$/ })).toBeNull()
    expect(faux.appels).toEqual([])
  })
})

describe('RevisionTab, revue analytique — le panneau « Expliquer »', () => {
  it('ouvre la ligne : ses montants, sa variation, sa source, son état — et le bouton grisé sous le refus dit', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    await ouvrirLaLigne('Total des recettes')
    const v = texte(volet())
    expect(v).toContain('Total des recettes')
    expect(v).toContain('Revue analytique 2025')
    expect(v).toContain('Exercice 2025')
    expect(v).toContain('0,00 €')
    expect(v).toContain('Exercice 2024')
    expect(v).toContain('5 000,00 €')
    expect(v).toContain('-5 000,00 €')
    expect(v).toContain('-100 %')
    expect(v).toContain('Repère annuel')
    expect(v).toContain('À expliquer')
    expect(v).toContain('La variation dépasse le seuil de signification : une explication est attendue')
    expect(v).toContain('Cette ligne n’a pas encore d’explication pour 2025.')
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(v).toContain('« Expliquer » : Une explication se rédige : elle ne peut pas être vide.')
    expect(faux.appels).toHaveLength(1)
  })

  it('« Expliquer » écrit par expliquer_variation seule, avec les dix arguments, puis relit : la ligne est expliquée', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await fixerLeSeuil('50', MOTIF)
    await ouvrirLaLigne('Total des recettes')
    saisirLExplication('Une année de moins : le cabinet a cessé une activité')
    expect(boutonDuVolet('Expliquer').disabled).toBe(false)
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(faux.appels[1]).toEqual({
      nom: 'expliquer_variation',
      args: {
        p_dossier_id: DOSSIER, p_annee: 2025, p_objet_type: 'total_2035', p_objet: 'recettes', p_nature: null, p_montant: 0,
        p_montant_precedent: 5000, p_source_precedent: 'reference', p_explication: 'Une année de moins : le cabinet a cessé une activité',
        p_remplace_id: null,
      },
    })
    expect(faux.lectures.revision_explications).toBe(3)
    expect(await within(ligneDuTableau('Total des recettes')).findByText('Expliquée')).toBeDefined()
    const v = texte(volet())
    expect(v).toContain('Une année de moins : le cabinet a cessé une activité')
    expect(v).toMatch(/Le \d{2}\/\d{2}\/2026, par toi\./)
    expect(v).toContain('Elle commentait 0,00 € (précédent 5 000,00 €, source : repère annuel).')
    expect(v).toContain('courante')
    // La saisie repart vide, et le geste devient un remplacement ; le panneau reste ouvert.
    expect(champDeLExplication().value).toBe('')
    expect(boutonDuVolet('Remplacer l’explication')).toBeDefined()
    expect(v).toContain('Celle-ci remplacera l’explication courante du')
  })

  it('une ligne de compte : le solde et le côté partent, avec l’exercice validé pour source', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Les recettes de juin sont arrivées')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(faux.appels[0]).toEqual({
      nom: 'expliquer_variation',
      args: {
        p_dossier_id: DOSSIER, p_annee: 2025, p_objet_type: 'compte', p_objet: '512000', p_nature: null, p_montant: 1000,
        p_montant_precedent: 600, p_source_precedent: 'validee', p_explication: 'Les recettes de juin sont arrivées', p_remplace_id: null,
      },
    })
  })

  it('un poste part avec sa NATURE', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne('Loyers (dépense)')
    saisirLExplication('Le loyer a été révisé')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(faux.appels[0].args).toMatchObject({
      p_objet_type: 'poste_2035', p_objet: 'Loyers', p_nature: 'depense', p_montant: 120, p_montant_precedent: 100,
      p_source_precedent: 'reference',
    })
  })

  it('« Remplacer l’explication » remplace la courante nommément, et l’historique reste', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Première explication')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    saisirLExplication('Seconde explication')
    await act(async () => { boutonDuVolet('Remplacer l’explication').click() })
    expect(faux.appels).toHaveLength(2)
    expect(faux.appels[1].args.p_remplace_id).toBe('x-ecrite-1')
    const v = texte(volet())
    expect(v).toContain('Première explication')
    expect(v).toContain('Seconde explication')
    expect(within(volet()).getAllByText('courante')).toHaveLength(1)
    expect(within(ligneDuTableau(BANQUE)).getByText('2 explications')).toBeDefined()
    // La plus récente d'abord, et c'est elle la courante.
    const historique = [...volet().querySelectorAll('ol > li')].map((li) => texte(li))
    expect(historique).toHaveLength(2)
    expect(historique[0]).toContain('Seconde explication')
    expect(historique[0]).toContain('courante')
    expect(historique[1]).toContain('Première explication')
  })

  it('une saisie RETIENT l’explication qu’elle remplace : une autre donnée depuis se dit avant le clic', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Ma saisie')
    faux.tables.revision_explications.push(explication({
      id: 'x-autre', annee: 2025, objet_type: 'compte', objet: '512000', montant: 1000, montant_precedent: 600,
      source_precedent: 'validee', explication: 'Donnée par une autre session',
    }))
    faux.reponseRpc = async () => ({ data: null, error: { message: 'Accès refusé à ce dossier.' } })
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(await within(volet()).findByText('Donnée par une autre session')).toBeDefined()
    expect(champDeLExplication().value).toBe('Ma saisie')
    expect(boutonDuVolet('Remplacer l’explication').disabled).toBe(true)
    expect(texte(volet())).toMatch(/« Remplacer l’explication » : Une autre explication a été donnée sur cette ligne depuis : relire avant d.expliquer\./)
    expect(faux.appels).toHaveLength(1)
  })

  it('une ligne expliquée passe « à revoir » quand le montant de l’exercice change, et le panneau le dit', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Les recettes de juin sont arrivées')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(await within(ligneDuTableau(BANQUE)).findByText('Expliquée')).toBeDefined()
    // Une écriture de plus sur le compte : les montants commentés ne sont plus ceux du jour. Un seuil fixé relit tout.
    faux.tables.ecritures_brouillon.push(...ecritureEquilibree('e2', '2025-08-01', '512000', '706000', 200))
    await fixerLeSeuil('50', MOTIF)
    expect(await within(ligneDuTableau(BANQUE)).findByText('À revoir')).toBeDefined()
    const v = texte(volet())
    expect(v).toContain('À revoir : l’explication courante est restée à d’autres chiffres — le montant de l’exercice n’est plus celui qu’elle commente.')
    expect(v).toContain('Elle commentait 1 000,00 €')
    expect(v).toContain('1 200,00 €')
    expect(within(ligneDuTableau(BANQUE)).getByRole('button', { name: /Revoir la ligne/ })).toBeDefined()
    // La reprendre se fait sur les chiffres du jour.
    saisirLExplication('Et une facture d’août')
    await act(async () => { boutonDuVolet('Remplacer l’explication').click() })
    expect(faux.appels.at(-1)?.args).toMatchObject({ p_montant: 1200, p_montant_precedent: 600, p_remplace_id: 'x-ecrite-1' })
    expect(await within(ligneDuTableau(BANQUE)).findByText('Expliquée')).toBeDefined()
  })

  it('« à revoir » aussi quand le montant précédent change', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Les recettes de juin sont arrivées')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    await within(ligneDuTableau(BANQUE)).findByText('Expliquée')
    const e0 = (faux.tables.ecritures_brouillon as { id: string; montant: number }[]).filter((e) => e.id.startsWith('e0-'))
    for (const e of e0) e.montant = 700
    await fixerLeSeuil('50', MOTIF)
    expect(await within(ligneDuTableau(BANQUE)).findByText('À revoir')).toBeDefined()
    expect(texte(volet())).toContain('le montant de l’exercice précédent n’est plus celui qu’elle commente')
  })

  it('« à revoir » aussi quand la source change : le précédent est validé depuis', async () => {
    dossier2025()
    faux.tables.revision_explications.push(explication({
      id: 'x-repere', annee: 2025, objet_type: 'compte', objet: '512000', montant: 1000, montant_precedent: 600, source_precedent: 'aucune',
    }))
    // Une explication qui annonce un précédent sans source ne se lit pas : la ligne dit sa source d'aujourd'hui.
    rendre()
    await attendreLaSection()
    expect(texte(ligneDuTableau(BANQUE))).toContain('À revoir')
    await ouvrirLaLigne(BANQUE)
    expect(texte(volet())).toContain('la source de la comparaison n’est plus celle qu’elle commente')
  })

  it('des explications qui ne se relisent pas en chaîne : « à revoir », sans explication courante', async () => {
    dossier2025()
    faux.tables.revision_explications.push(
      explication({ id: 'x1', annee: 2025, objet: '512000', montant: 1000, montant_precedent: 600, source_precedent: 'validee' }),
      explication({ id: 'x2', annee: 2025, objet: '512000', montant: 1000, montant_precedent: 600, source_precedent: 'validee', cree_le: '2026-02-02T11:00:00+00:00' }),
    )
    rendre()
    await attendreLaSection()
    expect(texte(ligneDuTableau(BANQUE))).toContain('À revoir')
    await ouvrirLaLigne(BANQUE)
    expect(texte(volet())).toContain('les explications de cette ligne ne se relisent pas en chaîne')
    expect(texte(volet())).toContain('La chaîne des explications ne se lit pas')
    expect(within(volet()).queryByText('courante')).toBeNull()
  })

  it('l’explication d’une autre ligne, d’une autre nature ou d’un autre exercice ne compte pas pour celle-ci', async () => {
    dossier2025()
    faux.tables.revision_explications.push(
      explication({ id: 'x-autre-ligne', annee: 2025, objet: '706000', montant: -1000, montant_precedent: -600, source_precedent: 'validee' }),
      explication({ id: 'x-autre-annee', annee: 2024, objet: '512000', montant: 600, montant_precedent: null, source_precedent: 'aucune' }),
      explication({
        id: 'x-autre-nature', annee: 2025, objet_type: 'poste_2035', objet: 'Loyers', nature: 'recette', montant: 120,
        montant_precedent: 100, source_precedent: 'reference',
      }),
    )
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    expect(texte(volet())).toContain('Cette ligne n’a pas encore d’explication pour 2025.')
    expect(texte(ligneDuTableau('Loyers (dépense)'))).not.toContain('Expliquée')
    expect(texte(ligneDuTableau('Loyers (dépense)'))).not.toContain('À revoir')
  })

  it('chaque refus se dit avant le clic, bouton grisé : explication vide, faite de blancs, trop longue', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(texte(volet())).toContain('Une explication se rédige : elle ne peut pas être vide.')
    saisirLExplication('   \n ')
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(texte(volet())).toContain('Une explication se rédige : elle ne peut pas être vide.')
    saisirLExplication('x'.repeat(4001))
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(texte(volet())).toContain('Une explication tient en 4 000 caractères au plus.')
    saisirLExplication('Une explication')
    expect(boutonDuVolet('Expliquer').disabled).toBe(false)
    expect(faux.appels).toEqual([])
  })

  it('un refus de la base se dit dans le panneau, garde la saisie et relit — sur cette ligne seulement', async () => {
    dossier2025()
    faux.reponseRpc = async () => ({ data: null, error: { message: 'Le solde du compte 512000 a changé.' } })
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Ma saisie')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(await within(volet()).findByText('Le solde du compte 512000 a changé.')).toBeDefined()
    expect(champDeLExplication().value).toBe('Ma saisie')
    expect(faux.lectures.revision_explications).toBe(2)
    // Le refus d'une explication ne se dit pas dans la section du seuil.
    expect(within(section()).queryByText('Le solde du compte 512000 a changé.')).toBeNull()
    // Une erreur sans message lisible se dit avec le repli de l'écran.
    faux.reponseRpc = async () => ({ data: null, error: {} as { message: string } })
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(await within(volet()).findByText('L’explication n’a pas pu être enregistrée.')).toBeDefined()
    // Une autre ligne ouverte ne montre pas l'erreur de celle-ci.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await ouvrirLaLigne(compte('706000'))
    expect(texte(volet())).not.toContain('Le solde du compte 512000 a changé.')
  })

  it('trois clics dans le même rendu n’envoient qu’une explication', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une explication')
    const b = boutonDuVolet('Expliquer')
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('le verrou ne se relâche qu’APRÈS la relecture : le panneau et la section se grisent, puis redeviennent possibles', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une explication')
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(faux.appels).toHaveLength(1)
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(champDeLExplication().disabled).toBe(true)
    // Un seul geste de la revue à la fois : le seuil attend aussi.
    saisirLeSeuil('50', MOTIF)
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    faux.attente = null
    await act(async () => { liberer() })
    expect(await within(ligneDuTableau(BANQUE)).findByText('Expliquée')).toBeDefined()
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(false)
    saisirLExplication('Seconde explication')
    expect(boutonDuVolet('Remplacer l’explication').disabled).toBe(false)
  })

  it('une explication en cours de saisie se garde : changer de ligne la confirme, fermer le panneau le ferme', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    // Rien de saisi : on change de ligne sans rien demander.
    await ouvrirLaLigne('Loyers (dépense)')
    expect(confirmer).not.toHaveBeenCalled()
    expect(texte(volet())).toContain('Loyers (dépense)')
    saisirLExplication('Une saisie qui attend')
    // Refusé : le panneau reste sur la ligne, la saisie aussi.
    await ouvrirLaLigne(BANQUE)
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('L’explication en cours de saisie n’est pas enregistrée')
    expect(texte(volet())).toContain('Loyers (dépense)')
    expect(champDeLExplication().value).toBe('Une saisie qui attend')
    // Rouvrir la MÊME ligne ne demande rien : la saisie y reste.
    await ouvrirLaLigne('Loyers (dépense)')
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(champDeLExplication().value).toBe('Une saisie qui attend')
    // Accepté : le panneau passe à l'autre ligne, vierge.
    confirmer.mockReturnValue(true)
    await ouvrirLaLigne(BANQUE)
    expect(texte(volet())).toContain('Compte 512000')
    expect(champDeLExplication().value).toBe('')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Fermer le panneau' })) })
    expect(screen.queryByText('Revue analytique 2025')).toBeNull()
  })

  it('fermer le panneau avec une saisie en attente le confirme : refusé, il reste et la saisie aussi', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une saisie qui attend')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Fermer le panneau' })) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(champDeLExplication().value).toBe('Une saisie qui attend')
    expect(ligneDuTableau(BANQUE).getAttribute('aria-current')).toBe('true')
    confirmer.mockReturnValue(true)
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Fermer le panneau' })) })
    expect(screen.queryByLabelText('Explication')).toBeNull()
    expect(ligneDuTableau(BANQUE).getAttribute('aria-current')).toBeNull()
  })

  it('un autre contenu du volet (l’assistant, une fiche) ne prend pas la place sur une saisie en attente sans confirmation', async () => {
    dossier2025()
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une saisie qui attend')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un autre contenu' })) })
    expect(confirmer).toHaveBeenCalledTimes(1)
    expect(confirmer.mock.calls[0][0]).toContain('L’explication en cours de saisie n’est pas enregistrée')
    expect(screen.queryByText('Autre contenu')).toBeNull()
    expect(champDeLExplication().value).toBe('Une saisie qui attend')
    confirmer.mockReturnValue(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir un autre contenu' })) })
    expect(screen.getByText('Autre contenu')).toBeDefined()
  })

  it('l’erreur d’une écriture qui revient après qu’on a changé de ligne ne se dit pas sur l’autre', async () => {
    dossier2025()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let refuser = () => {}
    faux.reponseRpc = () => new Promise((resolve) => { refuser = () => resolve({ data: null, error: { message: 'Refus tardif de la base.' } }) })
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une explication')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    // Pendant l'écriture, le panneau passe à une autre ligne ; la base répond ensuite par un refus.
    await ouvrirLaLigne(compte('706000'))
    await act(async () => { refuser() })
    await act(async () => { await Promise.resolve() })
    expect(texte(volet())).toContain('706000')
    expect(texte(volet())).not.toContain('Refus tardif de la base.')
  })

  it('la ligne ouverte se repère dans le tableau', async () => {
    dossier2025()
    rendre()
    await attendreLaSection()
    await ouvrirLaLigne('Loyers (dépense)')
    expect(ligneDuTableau('Loyers (dépense)').getAttribute('aria-current')).toBe('true')
    expect(ligneDuTableau(BANQUE).getAttribute('aria-current')).toBeNull()
  })
})

describe('RevisionTab, revue analytique — un seul geste de l’onglet à la fois', () => {
  // Un dossier où un solde se décide (rien ne précède 2025), avec son cycle de trésorerie ouvert à la conclusion.
  function dossierSimple() {
    dossier2025()
    faux.tables.ecritures_brouillon = ecritureEquilibree('e1', '2025-06-01', '512000', '706000', 1000)
  }
  const bouton = (nom: string) => within(volet()).getByRole('button', { name: nom }) as HTMLButtonElement

  // Chaque geste des autres panneaux, préparé jusqu'au clic : le panneau ouvert, sa saisie valide, et le nom de la fonction que
  // le clic appellerait.
  const GESTES: [string, () => Promise<void>, () => HTMLButtonElement, string][] = [
    [
      'décider d’un solde',
      async () => {
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le compte 512000' })) })
        fireEvent.change(within(volet()).getByLabelText('Motif'), { target: { value: 'Un chèque en transit' } })
      },
      () => bouton('Accepter sur motif'),
      'justifier_solde',
    ],
    [
      'conclure un cycle',
      async () => {
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le cycle Trésorerie' })) })
        fireEvent.change(within(volet()).getByLabelText('Conclusion'), { target: { value: 'Le solde concorde.' } })
      },
      () => bouton('Conclure : révisé'),
      'conclure_cycle',
    ],
    [
      'noter dans le journal d’un cycle',
      async () => {
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le cycle Trésorerie' })) })
        fireEvent.change(within(volet()).getByLabelText('Nature de la note'), { target: { value: 'travail' } })
        fireEvent.change(within(volet()).getByLabelText('Note'), { target: { value: 'Relevé demandé.' } })
      },
      () => bouton('Ajouter au journal'),
      'noter_revision',
    ],
    [
      'revoir un cycle',
      async () => {
        faux.estChef = true
        faux.tables.revision_conclusions.push(conclusion({ id: 'k1', annee: 2025, cycle: 'tresorerie', auteur: 'u2' }))
      },
      () => bouton('Approuver'),
      'revoir_cycle',
    ],
  ]

  async function preparer(ouvrirLePanneau: () => Promise<void>, pourRevoir: boolean) {
    dossierSimple()
    if (pourRevoir) {
      faux.estChef = true
      faux.tables.revision_conclusions.push(conclusion({ id: 'k1', annee: 2025, cycle: 'tresorerie', auteur: 'u2' }))
    }
    rendre({ exercices: [] })
    await attendreLaSection()
    await ouvrirLePanneau()
    if (pourRevoir) await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le cycle Trésorerie' })) })
    saisirLeSeuil('50', MOTIF)
  }

  it.each(GESTES)('%s, puis le seuil, dans le même rendu : le premier part, le second attend', async (nom, ouvrirLePanneau, geste, fonction) => {
    await preparer(ouvrirLePanneau, fonction === 'revoir_cycle')
    const fixer = boutonDeLaSection('Fixer le seuil')
    const autre = geste()
    expect(autre.disabled).toBe(false)
    await act(async () => { autre.click(); fixer.click() })
    expect(faux.appels.map((a) => a.nom), nom).toEqual([fonction])
  })

  it.each(GESTES)('le seuil, puis %s, dans le même rendu : le seuil part, l’autre attend', async (nom, ouvrirLePanneau, geste, fonction) => {
    await preparer(ouvrirLePanneau, fonction === 'revoir_cycle')
    const fixer = boutonDeLaSection('Fixer le seuil')
    const autre = geste()
    await act(async () => { fixer.click(); autre.click() })
    expect(faux.appels.map((a) => a.nom), nom).toEqual(['fixer_seuil_de_signification'])
  })

  it.each([
    ['l’explication, puis le seuil', 'expliquer_variation'],
    ['le seuil, puis l’explication', 'fixer_seuil_de_signification'],
  ])('%s, dans le même rendu : le premier part, le second attend', async (ordre, attendu) => {
    dossierSimple()
    rendre({ exercices: [] })
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une explication')
    saisirLeSeuil('50', MOTIF)
    const expliquer = boutonDuVolet('Expliquer')
    const fixer = boutonDeLaSection('Fixer le seuil')
    await act(async () => {
      if (ordre.startsWith('l’explication')) { expliquer.click(); fixer.click() } else { fixer.click(); expliquer.click() }
    })
    expect(faux.appels.map((a) => a.nom)).toEqual([attendu])
  })

  it.each([
    ['le panneau « justifier » d’un solde', 'Ouvrir le compte 512000', 'Motif', 'Accepter sur motif'],
    ['le panneau d’un cycle', 'Ouvrir le cycle Trésorerie', 'Conclusion', 'Conclure : révisé'],
  ])('pendant un seuil en cours d’écriture, %s se grise — et se dégrise après la relecture', async (_nom, ouverture, champ, geste) => {
    dossierSimple()
    rendre({ exercices: [] })
    await attendreLaSection()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: ouverture })) })
    fireEvent.change(within(volet()).getByLabelText(champ), { target: { value: 'Une saisie' } })
    expect(bouton(geste).disabled).toBe(false)
    saisirLeSeuil('50', MOTIF)
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { boutonDeLaSection('Fixer le seuil').click() })
    expect(bouton(geste).disabled).toBe(true)
    faux.attente = null
    await act(async () => { liberer() })
    await seuilAffiche('50,00 €')
    expect(bouton(geste).disabled).toBe(false)
  })

  it('pendant un seuil en cours d’écriture, l’explication d’une ligne se grise', async () => {
    dossierSimple()
    rendre({ exercices: [] })
    await attendreLaSection()
    await ouvrirLaLigne(BANQUE)
    saisirLExplication('Une explication')
    saisirLeSeuil('50', MOTIF)
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { boutonDeLaSection('Fixer le seuil').click() })
    expect(boutonDuVolet('Expliquer').disabled).toBe(true)
    expect(champDeLExplication().disabled).toBe(true)
    faux.attente = null
    await act(async () => { liberer() })
    await seuilAffiche('50,00 €')
    expect(boutonDuVolet('Expliquer').disabled).toBe(false)
  })

  it('une décision en cours d’écriture grise le seuil, et une écriture du cycle aussi', async () => {
    dossierSimple()
    rendre({ exercices: [] })
    await attendreLaSection()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le compte 512000' })) })
    fireEvent.change(within(volet()).getByLabelText('Motif'), { target: { value: 'Un chèque en transit' } })
    saisirLeSeuil('50', MOTIF)
    let liberer = () => {}
    faux.attente = new Promise<void>((r) => { liberer = r })
    await act(async () => { bouton('Accepter sur motif').click() })
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(true)
    faux.attente = null
    await act(async () => { liberer() })
    expect(boutonDeLaSection('Fixer le seuil').disabled).toBe(false)
  })
})

describe('RevisionTab, revue analytique — un libellé de poste commun à une recette et à une dépense', () => {
  it('chaque ligne a la sienne, et le panneau ouvre celle qu’on a cliquée', async () => {
    dossier2025()
    faux.tables.categories = [
      ...CATEGORIES,
      { id: 'c-remb-dep', dossier_id: null, code: 'REMB_DEP', libelle: 'Remboursement versé', ordre: 3, compte_comptable: '658000', poste_2035: 'Remboursements' },
      { id: 'c-remb-rec', dossier_id: null, code: 'REMB_REC', libelle: 'Remboursement reçu', ordre: 4, compte_comptable: '708000', poste_2035: 'Remboursements' },
    ]
    faux.tables.pieces.push(
      piece({ id: 'p-dep', categorie_id: 'c-remb-dep', montant_ttc: 30, date_piece: '2025-04-10' }),
      piece({ id: 'p-rec', categorie_id: 'c-remb-rec', type_piece: 'vente', montant_ttc: 70, date_piece: '2025-04-11' }),
    )
    rendre()
    await attendreLaSection()
    expect(texte(ligneDuTableau('Remboursements (dépense)'))).toContain('30,00 €')
    expect(texte(ligneDuTableau('Remboursements (recette)'))).toContain('70,00 €')
    // La recette se range avant la dépense : c'est la SECONDE qu'un repérage par le seul nom confondrait avec la première.
    await ouvrirLaLigne('Remboursements (dépense)')
    expect(texte(volet())).toContain('Remboursements (dépense)')
    expect(ligneDuTableau('Remboursements (dépense)').getAttribute('aria-current')).toBe('true')
    expect(ligneDuTableau('Remboursements (recette)').getAttribute('aria-current')).toBeNull()
    saisirLExplication('Une explication')
    await act(async () => { boutonDuVolet('Expliquer').click() })
    expect(faux.appels[0].args).toMatchObject({ p_objet: 'Remboursements', p_nature: 'depense', p_montant: 30 })
    // L'explication de la dépense ne dit rien de la recette.
    expect(texte(ligneDuTableau('Remboursements (recette)'))).not.toContain('explication')
  })
})

// LES VENTES FACTURÉES (ligne 28.6, chantier EC-Q3, étape VF3b1) : la 2035 de la revue les compte comme celle de Clôture. Leur
// lecture ne sert qu'à la revue analytique : incomplète, ou rendue pour un autre dossier, elle seule se tait — les soldes et
// les cycles, qui ne la lisent pas, demeurent. Données FICTIVES.
describe('RevisionTab, revue analytique — les ventes facturées', () => {
  // Une facture SOURCE de services, 1 000 € HT à 20 %, encaissée entière le 10 mai 2025 : 1 000 € de recette.
  function avecUneVenteFacturee() {
    dossier2025()
    faux.tables.factures_emises = [{
      id: 'fs', dossier_id: DOSSIER, statut: 'validee', type: 'facture', numero: 'F2025-0042', date_emission: '2025-05-02',
      tiers_nom: 'CLIENT FICTIF', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services', option_debits: false,
      date_prestation: null,
    }]
    faux.tables.facture_lignes = [{ id: 'lfs', facture_id: 'fs', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }]
    faux.tables.encaissements_factures = [{
      id: 'enc', dossier_id: DOSSIER, facture_id: 'fs', date_encaissement: '2025-05-10', montant: 1200, moyen: 'virement',
      ligne_bancaire_id: null, annule_id: null, cree_le: '2025-05-10T10:00:00Z', retire_le: null,
    }]
    faux.tables.encaissements_factures_taux = [{ encaissement_id: 'enc', dossier_id: DOSSIER, taux: 20, montant: 1200 }]
  }
  const POSTE = titreDeLaLigne({ objet_type: 'poste_2035', objet: POSTE_VENTES_FACTUREES, nature: 'recette' })

  it('la 2035 de la revue compte l’encaissement de la facture source', async () => {
    avecUneVenteFacturee()
    rendre()
    await attendreLaSection()
    expect(texte(ligneDuTableau(POSTE))).toContain('1 000,00 €')
    expect(texte(ligneDuTableau('Total des recettes'))).toContain('1 000,00 €')
  })

  // `factures_emises` n'y est pas : la Vue d'ensemble la lit aussi (les jumelles), et refusée elle cache l'onglet entier,
  // la revue avec lui (« une table de la Vue d’ensemble refusée cache toute la révision », plus haut).
  it.each(['facture_lignes', 'encaissements_factures', 'encaissements_factures_taux'])(
    'la table %s refusée : la section le dit, sans tableau ni geste — les cycles demeurent',
    async (table) => {
      avecUneVenteFacturee()
      faux.refusees.add(table)
      rendre()
      await attendreLaSection()
      expect(within(section()).getByText(/Les ventes facturées du dossier n'ont pas pu être lues en entier \(.*permission denied\)/)).toBeDefined()
      expect(within(section()).queryByRole('table')).toBeNull()
      expect(within(section()).queryByRole('button')).toBeNull()
      expect(within(section()).queryByLabelText('Seuil de signification (€)')).toBeNull()
      expect(screen.getByRole('button', { name: 'Ouvrir le compte 512000' })).toBeDefined()
    },
  )

  it('rendue pour un autre dossier — celui qu’on vient de quitter —, elle ne vaut pas : la section le dit', async () => {
    avecUneVenteFacturee()
    const vue = rendre()
    await attendreLaSection()
    expect(texte(ligneDuTableau(POSTE))).toContain('1 000,00 €')
    // Un autre dossier s'ouvre dans le même onglet, et ses lectures ne sont pas revenues : la revue ne compte pas les ventes
    // facturées du dossier quitté pour lui.
    faux.attente = new Promise<void>(() => {})
    vue.rerender(
      <FournisseurPanneauDroit>
        <ExercicesValidesProvider exercices={[exerciceValide(2024)]} relire={async () => {}}>
          <AnneeProvider defaut={2025}>
            <RevisionTab
              dossierId="autre-dossier" modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva="exonere"
              onNavigate={() => {}}
            />
          </AnneeProvider>
        </ExercicesValidesProvider>
        <AutreContenu />
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    await act(async () => {})
    expect(within(section()).getByText(/Les ventes facturées du dossier n'ont pas pu être lues en entier \(la lecture rendue est celle d’un autre dossier\)/)).toBeDefined()
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(within(section()).queryByRole('button')).toBeNull()
  })
})
