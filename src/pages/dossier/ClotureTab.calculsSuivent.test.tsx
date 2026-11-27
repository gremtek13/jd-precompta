import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import ClotureTab from './ClotureTab'
import type { Immobilisation } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// LES CALCULS DE LA CLÔTURE SUIVENT LEURS DONNÉES, ET SEULEMENT ELLES (le banc de charge, 27/11/2026 ;
// pages/dossier/useClotureDuDossier.ts). La 2035 de chaque exercice, les états des ventes facturées et les préalables de la
// validation se calculent dans un `useMemo` : une saisie dans un champ de l'onglet ne les relance plus, et une relecture qui
// change une donnée les relance — l'affichage la suit, jamais une valeur d'avant. Le faux client est celui de ClotureTab.test.tsx ;
// les préalables de la validation sont comptés. Données FICTIVES.

// Chaque calcul des préalables d'un exercice, compté : le même module, appelé à travers une doublure qui compte.
const compteur = vi.hoisted(() => ({ prealables: 0 }))
vi.mock('../../lib/prealablesValidation', async (original) => {
  const vrai = await original<typeof import('../../lib/prealablesValidation')>()
  return {
    ...vrai,
    prealablesDeValidation: (...args: Parameters<typeof vrai.prealablesDeValidation>) => {
      compteur.prealables++
      return vrai.prealablesDeValidation(...args)
    },
  }
})
afterEach(() => { cleanup(); compteur.prealables = 0 })

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Le rôle de qui regarde : seul le chef du cabinet valide un exercice.
  estChef: true,
  // Les appels de fonctions de la base, et ce que chacune rend.
  appels: [] as { nom: string; params: Record<string, unknown> }[],
  reponses: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  // Ce que la base garde d'une validation acceptée : la ligne de l'exercice, avec la 2035 qu'elle a reçue.
  apresValidation: null as Record<string, unknown> | null,
  // Et l'ouverture de l'exercice suivant qu'elle écrit dans le même geste (ligne 34) : les soldes reportés.
  apresValidationReportes: [] as Record<string, unknown>[],
  // Le serveur cesse de rendre cette table au-delà de la position donnée, tout en continuant
  // d'annoncer le vrai total. C'est ce qui produit une lecture incomplète (voir lectureComplete.ts).
  muetApresParTable: {} as Record<string, number>,
  // Ce que `remplir2035` a reçu : les cases telles que le PDF les porterait, et le déclarant.
  remplies: [] as Map<string, number>[],
  // Ce que la doublure de `remplir2035` rend comme cases qu'elle n'a pas su placer (vide : toutes placées).
  codesSansAncrage: [] as string[],
  // Et l'exercice qui choisit le millésime du modèle (étape 2035S6).
  exercicesRemplis: [] as number[],
  entetes: [] as unknown[],
  // Le cadre 7 de la 2035-B que reçoit `remplir2035` (lib/cadre7.ts), et ce que sa doublure en rend (17/11/2026).
  cadres7: [] as unknown[],
  vehiculesSansLigne: [] as string[],
  cadre7Repere: true,
  // Et l'annexe 2035-E portée en page 3, ou null quand elle n'est pas due.
  annexes: [] as ({
    valeurs: ReadonlyMap<string, number | null>; aSaisir: readonly string[]; cadre: unknown; entete: Record<string, unknown>
  } | null)[],
  // Le drapeau `SAISIES_2035E_EXPORTEES`, levé le 13/11/2026 : ce fichier garde son état d'avant éprouvé (baissé par défaut)
  // et ne le lève que le temps d'un test (le mock du module le lit ici).
  saisies2035E: false,
  // La déclaration principale n° 2035-SD (`FORMULAIRE_2035_SD_OFFERT`, levé le 17/11/2026) : son drapeau, que le mock du module
  // lit ici pour jouer aussi l'état d'avant, et ce que `remplir2035SD` a reçu.
  formulaire2035SDOffert: true,
  declarations2035SD: [] as { annee: number; benefice: number; deficit: number; immobilisations: Record<string, unknown> }[],
  entetes2035SD: [] as Record<string, unknown>[],
  // Le début d'activité que la lecture des paramètres des cotisations rend ; `undefined` : une lecture qui échoue.
  debutActivite: null as string | null | undefined,
  // Une promesse qui retient le remplissage : de quoi cliquer deux fois pendant qu'il court.
  attente2035SD: null as Promise<void> | null,
  // Les mises à jour envoyées, table et valeurs : l'enregistrement d'un poste manquant.
  misesAJour: [] as { table: string; valeurs: unknown }[],
  // Ce que l'écran croit de qui regarde (`useAuth().isSuperAdmin`), et ce qu'en sait la BASE : la policy d'écriture
  // d'une catégorie commune (`dossier_id` nul) ne laisse passer que le super-administrateur, et écarte la ligne sans
  // lever pour tout autre (supabase/essais/categoriesCommunes.sql).
  superAdmin: true,
  superAdminEnBase: true,
  // Une lecture de cette table attend la promesse posée au moment où elle part : de quoi voir l'écran avant qu'elle
  // revienne, ou faire revenir la lecture d'un dossier quitté APRÈS celle du dossier ouvert.
  attentes: {} as Record<string, Promise<void> | undefined>,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr, predicatIn } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, params: Record<string, unknown>) => {
        faux.appels.push({ nom, params })
        const reponse = faux.reponses[nom] ?? { data: null, error: { message: `fonction ${nom} non programmée` } }
        if (nom === 'valider_exercice' && reponse.error === null && faux.apresValidation) {
          faux.parTable.exercices_valides = [...(faux.parTable.exercices_valides ?? []), { ...faux.apresValidation, declaration: params.p_declaration }]
          faux.parTable.soldes_reportes = [...(faux.parTable.soldes_reportes ?? []), ...faux.apresValidationReportes]
        }
        return Promise.resolve(reponse)
      },
      from: (table: string) => {
        const chaine: Record<string, unknown> = {}
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // `.not` et `.or` sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) : acceptés sans effet, ils
        // laissaient ce test vert avec la lecture des mouvements rapprochés restreinte à ceux qui portent
        // une pièce — la 2035 perdait alors les recettes affectées sans qu'un test tombe.
        const predicats: Predicat[] = []
        // Une mise à jour, et la ligne qu'elle vise : lue avec sa ligne (`.select('id').maybeSingle()`), la base rend la
        // ligne modifiée, ou rien — sans erreur — quand la policy l'écarte.
        let miseAJour = false
        let idVise: unknown = undefined
        Object.assign(chaine, {
          select: () => chaine,
          update: (valeurs: unknown) => { faux.misesAJour.push({ table, valeurs }); miseAJour = true; return chaine },
          // Le cadrage par dossier n'est appliqué qu'aux natures, les seules lignes du jeu d'essai qui le
          // renseignent : une lecture des seules natures du dossier perdrait celles du cabinet, et avec elles le
          // véhicule du registre — le faux doit pouvoir le voir.
          // Le statut d'une pièce aussi : la validation lit à part les pièces validées et celles à valider. Et celui
          // d'un mouvement : la validation lit TOUT le relevé, et une lecture restreinte aux rapprochés lui cacherait
          // les mouvements à traiter.
          // Et la source d'une facture émise : les ventes facturées ne lisent que les factures SOURCES de leur vente
          // (lib/ventesFactureesLecture.ts) ; non appliqué, le filtre leur rendrait une facture d'avant la bascule, que la
          // lecture juge étrangère à ce qu'elle a demandé.
          // Les tables des ventes facturées, entières : chacune rend ses lignes du dossier, et celles d'un autre dossier
          // ferment la lecture (lib/ventesFactureesLecture.ts). Les lignes d'une facture n'ont pas de dossier : la base les
          // filtre par leur facture (`factures_emises!inner`), et le faux aussi.
          eq: (colonne: string, valeur: unknown) => {
            if (table === 'natures_immobilisation' || (['pieces', 'lignes_bancaires'].includes(table) && colonne === 'statut')
              || ['factures_emises', 'encaissements_factures', 'encaissements_factures_taux'].includes(table)) {
              predicats.push(predicatEq(colonne, valeur))
            } else if (table === 'facture_lignes' && colonne.startsWith('factures_emises.')) {
              const champ = colonne.slice('factures_emises.'.length)
              predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) =>
                (f as Record<string, unknown>).id === l.facture_id && (f as Record<string, unknown>)[champ] === valeur))
            }
            if (colonne === 'id') idVise = valeur
            return chaine
          },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
          // Les ventes facturées lisent les factures validées ET reprises (A8c : `.in('statut', etatsDesVentes())`) : le faux
          // applique ce filtre comme la base, une facture reprise d'un autre état écartée.
          in: (colonne: string, valeurs: readonly unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return chaine },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          maybeSingle: () => {
            if (miseAJour) {
              const visee = (faux.parTable[table] ?? []).find((l) => (l as { id?: unknown }).id === idVise) as
                { id: unknown; dossier_id?: unknown } | undefined
              const laisse = visee != null && (table !== 'categories' || visee.dossier_id != null || faux.superAdminEnBase)
              return Promise.resolve({ data: laisse ? { id: visee.id } : null, error: null })
            }
            return Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null })
          },
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            const reponse = () => {
              const toutes = filtrer(faux.parTable[table] ?? [], predicats)
              const muet = faux.muetApresParTable[table]
              const borne = muet == null ? toutes.length : Math.min(toutes.length, muet)
              return {
                data: toutes.slice(debut, Math.min(debut + (fin - debut + 1), borne)),
                error: null,
                count: toutes.length,
              }
            }
            const attente = faux.attentes[table]
            return (attente ? attente.then(reponse) : Promise.resolve(reponse())).then(suite)
          },
        })
        return chaine
      },
    },
  }
})

// `remplir2035` importe `pdfjs-dist/...?url`, qui touche au navigateur DÈS L'IMPORT : le module
// entier fait échouer le montage sous jsdom. Même famille que `pdfText.ts`, dont CLAUDE.md dit déjà
// qu'une dépendance navigateur doit vivre à part. La doublure est honnête : elle ne dessine rien et
// RETIENT les cases reçues — c'est ce que l'écran envoie au formulaire qui est en cause, pas le
// dessin, que `gabarit2035.test.ts` éprouve sur le vrai PDF.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: faux.estChef, isSuperAdmin: faux.superAdmin }) }))

const TRESORERIE = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT } as const

vi.mock('../../lib/saisies2035E', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/saisies2035E')>()
  const module = { ...original }
  Object.defineProperty(module, 'SAISIES_2035E_EXPORTEES', { get: () => faux.saisies2035E, enumerable: true })
  return module
})

vi.mock('../../lib/remplir2035', () => ({
  remplir2035: (
    valeurs: Map<string, number>,
    entete: unknown,
    annexe: { valeurs: ReadonlyMap<string, number | null>; aSaisir: readonly string[]; cadre: unknown; entete: Record<string, unknown> } | null,
    annee: number,
    cadre7: unknown,
  ) => {
    faux.exercicesRemplis.push(annee)
    faux.cadres7.push(cadre7)
    faux.remplies.push(valeurs)
    faux.entetes.push(entete)
    faux.annexes.push(annexe)
    return Promise.resolve({
      pdf: new Uint8Array(), codesSansAncrage: faux.codesSansAncrage, codesSansAncrage2035E: [],
      vehiculesSansLigne: faux.vehiculesSansLigne, cadre7Repere: faux.cadre7Repere, ligne23Reperee: true,
    })
  },
}))

vi.mock('../../lib/modeles2035SD', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/modeles2035SD')>()
  const module = { ...original }
  Object.defineProperty(module, 'FORMULAIRE_2035_SD_OFFERT', { get: () => faux.formulaire2035SDOffert, enumerable: true })
  return module
})

// La 2035-SD importe pdf.js comme la 2035 : sa doublure retient ce que l'écran lui envoie ; le dessin est éprouvé sur le vrai
// formulaire par gabarit2035SD.test.ts et remplir2035SD.test.ts.
// Le début d'activité de l'onglet Cotisations, que la 2035-SD lit au clic (2035SD-Q1) : sa lecture, telle que le test la pose.
vi.mock('../../lib/parametresDesCotisationsLecture', () => ({
  lireLesParametresDesCotisations: async (dossierId: string) => faux.debutActivite === undefined
    ? { dossierId, etat: 'incomplets', motif: 'lecture refusée' }
    : { dossierId, etat: 'lus', debutActivite: faux.debutActivite, parExercice: new Map() },
}))

vi.mock('../../lib/remplir2035SD', () => ({
  remplir2035SD: async (declaration: (typeof faux.declarations2035SD)[number], entete: Record<string, unknown>) => {
    faux.declarations2035SD.push(declaration)
    faux.entetes2035SD.push(entete)
    if (faux.attente2035SD) await faux.attente2035SD
    return { pdf: new Uint8Array(), libellesSansAncrage: [], etatsAnnexes: 0 }
  },
}))

const CATEGORIE = {
  id: 'cat-achats', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats',
  ordre: 1, compte_comptable: '606100', poste_2035: 'Achats',
}

const PIECE = {
  id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'facture.pdf', statut: 'validee',
  type_piece: 'achat', date_piece: '2025-03-10', montant_ht: null, montant_tva: null,
  montant_ttc: 120, tiers: 'FOURNISSEUR', categorie_id: 'cat-achats',
  created_at: '2025-03-10T09:00:00Z',
}

function cotisation(id: string, o: Record<string, unknown> = {}) {
  return {
    id, dossier_id: 'dossier-de-test', organisme: 'URSSAF', echeance: '2025-03-05',
    montant_appele: 300, montant_verse: 300, montant_csg_crds: null,
    previsionnel: false, document_id: null, created_at: '2025-03-05T09:00:00Z', paiement_personnel_le: null, ...o,
  }
}

function poser(
  muet: Record<string, number> = {},
  immos: Immobilisation[] = [],
  cotis: Record<string, unknown>[] = [cotisation('c1'), cotisation('c2')],
) {
  faux.muetApresParTable = muet
  faux.codesSansAncrage = []
  faux.attentes = {}
  faux.misesAJour = []
  faux.superAdmin = true
  faux.superAdminEnBase = true
  faux.parTable = {
    categories: [CATEGORIE],
    pieces: [PIECE],
    immobilisations: immos,
    cotisations_declarees: cotis,
    vehicules: [],
    lignes_bancaires: [],
    dossiers: [{ nom: 'Dossier de test', libelle_naf: 'Infirmier', siret: '12345678901234' }],
  }
}

// `ventesParLesFactures` : le réglage du dossier. Un dossier qui compte une facture source a basculé — la base l'impose — :
// les tests des ventes facturées le montent basculé.
function monter(annee = 2025, assujettiTva = true, ventesParLesFactures = false) {
  return render(
    <ContexteDossier annee={annee}>
      <ClotureTab dossierId="dossier-de-test" assujettiTva={assujettiTva} periodiciteTva="trimestrielle" ventesParLesFactures={ventesParLesFactures} modele={TRESORERIE} />
    </ContexteDossier>,
  )
}

describe('ClotureTab — les calculs suivent leurs données, et seulement elles', () => {
  // Une pièce de 80 € rangée dans une catégorie dont le poste n'a pas de case : hors de la 2035, la carte des postes la dit,
  // et la validation la refuse. Le poste corrigé, la relecture la fait entrer dans la ligne des achats.
  const DIVERS = { ...CATEGORIE, id: 'cat-divers', code: 'divers', libelle: 'Divers', poste_2035: 'eau_gaz_electricite' }

  it('une saisie ne relance pas les calculs ; la relecture qui corrige le poste les relance, et la 2035 et la validation la suivent', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, DIVERS]
    faux.parTable.pieces = [PIECE, { ...PIECE, id: 'p2', montant_ttc: 80, categorie_id: 'cat-divers' }]
    monter()
    const champ = await screen.findByLabelText('Nouveau poste de la catégorie Divers')
    expect(await screen.findByText(/qu'aucune case du formulaire ne porte/)).toBeTruthy()
    // 600 € de cotisations et la pièce de 120 € ; celle de 80 € n'a pas de case.
    const report = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(report.parentElement!).getByText(/Déficit de 720 € : case 5QE/)
    const avantLaSaisie = compteur.prealables
    expect(avantLaSaisie).toBeGreaterThan(0)

    // Une saisie dans le champ : des rendus de plus, aucune donnée changée — les préalables ne se recalculent pas.
    for (const valeur of ['A', 'Ac', 'Ach', 'Achats']) fireEvent.change(champ, { target: { value: valeur } })
    expect((champ as HTMLInputElement).value).toBe('Achats')
    expect(compteur.prealables).toBe(avantLaSaisie)

    // L'enregistrement : la base garde le poste, et la relecture le rend. La carte part, le refus de la validation avec elle,
    // et la pièce de 80 € entre dans la 2035.
    faux.parTable.categories = [CATEGORIE, { ...DIVERS, poste_2035: 'Achats' }]
    await act(async () => { within(champ.closest('.card') as HTMLElement).getByRole('button', { name: 'Enregistrer' }).click() })
    await waitFor(() => expect(screen.queryByLabelText('Nouveau poste de la catégorie Divers')).toBeNull())
    expect(screen.queryByText(/qu'aucune case du formulaire ne porte/)).toBeNull()
    const relu = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(relu.parentElement!).getByText(/Déficit de 800 € : case 5QE/)
    expect(compteur.prealables).toBeGreaterThan(avantLaSaisie)
  })

  // Un réglage du dossier qui change sans relecture (le dossier devient assujetti, dans l'onglet TVA) : la 2035 le suit au rendu
  // même — le hors-taxe d'un assujetti, le TTC d'un exonéré (lib/montantRetenu.ts). Une dépendance oubliée du calcul laisserait
  // l'écran sur l'ancien réglage.
  it('un réglage du dossier qui change recalcule la 2035, sans relecture', async () => {
    poser()
    faux.parTable.pieces = [{ ...PIECE, montant_ht: 100, montant_tva: 20 }]
    const arbre = (assujettiTva: boolean) => (
      <ContexteDossier annee={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={assujettiTva} periodiciteTva="trimestrielle" ventesParLesFactures={false} modele={TRESORERIE} />
      </ContexteDossier>
    )
    const { rerender } = render(arbre(false))
    const report = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(report.parentElement!).getByText(/Déficit de 720 € : case 5QE/)
    rerender(arbre(true))
    const relu = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(relu.parentElement!).getByText(/Déficit de 700 € : case 5QE/)
  })
})
