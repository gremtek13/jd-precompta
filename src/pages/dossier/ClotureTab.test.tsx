import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import ClotureTab from './ClotureTab'
import type { Immobilisation } from '../../lib/types'
import { genererEcheancier, type Emprunt } from '../../lib/emprunts'
import type { Predicat } from '../../test/filtresPostgrest'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../../test/ecritures'

// L'ONGLET QUI PRODUIT LE SEUL DOCUMENT QUE LE CABINET SIGNE — la 2035. Son garde-fou refuse de
// remplir le formulaire sur une lecture partielle, et c'est la bonne règle : une déclaration bâtie
// sur une partie du dossier est plausible, fausse, et déposée.
//
// Ce que ce test garde, et qu'aucun test de `src/lib` ne peut garder : que le garde-fou couvre
// TOUTES les entrées de la déclaration, pas seulement les pièces. Il n'en vérifiait qu'une sur
// cinq — il promettait donc « ce formulaire est bâti sur tout » sans pouvoir le tenir. Un
// garde-fou qui ment est pire qu'un garde-fou absent : on cesse d'aller voir.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Le rôle de qui regarde : seul le chef du cabinet valide un exercice.
  estChef: true,
  // Les appels de fonctions de la base, et ce que chacune rend.
  appels: [] as { nom: string; params: Record<string, unknown> }[],
  reponses: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  // Ce que la base garde d'une validation acceptée : la ligne de l'exercice, avec la 2035 qu'elle a reçue.
  apresValidation: null as Record<string, unknown> | null,
  // Le serveur cesse de rendre cette table au-delà de la position donnée, tout en continuant
  // d'annoncer le vrai total. C'est ce qui produit une lecture incomplète (voir lectureComplete.ts).
  muetApresParTable: {} as Record<string, number>,
  // Ce que `remplir2035` a reçu : les cases telles que le PDF les porterait, et le déclarant.
  remplies: [] as Map<string, number>[],
  entetes: [] as unknown[],
  // Les mises à jour envoyées, table et valeurs : l'enregistrement d'un poste manquant.
  misesAJour: [] as { table: string; valeurs: unknown }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
      rpc: (nom: string, params: Record<string, unknown>) => {
        faux.appels.push({ nom, params })
        const reponse = faux.reponses[nom] ?? { data: null, error: { message: `fonction ${nom} non programmée` } }
        if (nom === 'valider_exercice' && reponse.error === null && faux.apresValidation) {
          faux.parTable.exercices_valides = [...(faux.parTable.exercices_valides ?? []), { ...faux.apresValidation, declaration: params.p_declaration }]
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
        Object.assign(chaine, {
          select: () => chaine,
          update: (valeurs: unknown) => { faux.misesAJour.push({ table, valeurs }); return chaine },
          // Le cadrage par dossier n'est appliqué qu'aux natures, les seules lignes du jeu d'essai qui le
          // renseignent : une lecture des seules natures du dossier perdrait celles du cabinet, et avec elles le
          // véhicule du registre — le faux doit pouvoir le voir.
          // Le statut d'une pièce aussi : la validation lit à part les pièces validées et celles à valider. Et celui
          // d'un mouvement : la validation lit TOUT le relevé, et une lecture restreinte aux rapprochés lui cacherait
          // les mouvements à traiter.
          eq: (colonne: string, valeur: unknown) => {
            if (table === 'natures_immobilisation' || (['pieces', 'lignes_bancaires'].includes(table) && colonne === 'statut')) {
              predicats.push(predicatEq(colonne, valeur))
            }
            return chaine
          },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          maybeSingle: () => Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }),
          then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
            const toutes = filtrer(faux.parTable[table] ?? [], predicats)
            const muet = faux.muetApresParTable[table]
            const borne = muet == null ? toutes.length : Math.min(toutes.length, muet)
            return Promise.resolve({
              data: toutes.slice(debut, Math.min(debut + (fin - debut + 1), borne)),
              error: null,
              count: toutes.length,
            }).then(suite)
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
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: faux.estChef }) }))

const TRESORERIE = { mode: 'tresorerie', compteNotesDeFrais: '108000' } as const
const ENGAGEMENT = { mode: 'engagement', compteNotesDeFrais: '455000' } as const

vi.mock('../../lib/remplir2035', () => ({
  remplir2035: (valeurs: Map<string, number>, entete: unknown) => {
    faux.remplies.push(valeurs)
    faux.entetes.push(entete)
    return Promise.resolve({ pdf: new Uint8Array(), codesSansAncrage: [] })
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
    previsionnel: false, document_id: null, created_at: '2025-03-05T09:00:00Z', ...o,
  }
}

// TYPÉ sans `as` — et son `piece_id` était INFIDÈLE : nul, alors qu'une immobilisation naît toujours
// d'une pièce validée (`ImmobilisationsTab` n'a qu'un chemin de création). C'était inerte tant que
// rien ne lisait ce lien ; depuis `immobilisationsSansJustificatif`, les deux tests de la réserve
// prorata afficheraient AUSSI la carte « Amortissement(s) sans justificatif ».
function immobilisation(o: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1', nature_id: null,
    libelle: 'Ordinateur', valeur: 12000, date_acquisition: '2025-01-01', date_mise_en_service: null, duree_annees: 5,
    created_at: '2025-01-01T09:00:00Z', ...o,
  }
}

function poser(
  muet: Record<string, number> = {},
  immos: Immobilisation[] = [],
  cotis: Record<string, unknown>[] = [cotisation('c1'), cotisation('c2')],
) {
  faux.muetApresParTable = muet
  faux.misesAJour = []
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

function monter(annee = 2025, assujettiTva = true) {
  return render(
    <AnneeProvider defaut={annee}>
      <ClotureTab dossierId="dossier-de-test" assujettiTva={assujettiTva} modele={TRESORERIE} />
    </AnneeProvider>,
  )
}

// L'EXERCICE D'UNE PIÈCE EST CELUI DE SON PAIEMENT (CGI, art. 93 : recettes encaissées, dépenses
// payées). Le moteur est testé à part (declaration2035.test.ts) ; ce qui se joue ici est le CÂBLAGE —
// que l'écran LISE les paiements, les passe au moteur, compte la pièce dans l'exercice où elle a été
// réglée, et DISE celles qu'il compte à leur date de facture faute de paiement rapproché.
describe("ClotureTab — l'exercice du paiement", () => {
  const FACTURE_DE_DECEMBRE = { ...PIECE, date_piece: '2025-12-20' }
  const REGLEE_EN_JANVIER = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2026-01-05', libelle: 'PRLV FOURNISSEUR', montant: -120,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2026-01-06T09:00:00Z',
  }
  const TITRE = /Pièces comptées à leur date de facture/

  function poserDecembre(payee: boolean) {
    poser()
    faux.parTable.pieces = [FACTURE_DE_DECEMBRE]
    faux.parTable.lignes_bancaires = payee ? [REGLEE_EN_JANVIER] : []
  }

  it("compte une facture de décembre réglée en janvier dans l'exercice du paiement", async () => {
    // 2025 ne garde que ses deux échéances de cotisation (600 €) ; les 120 € de la facture partent
    // en 2026, l'année où ils ont quitté le compte.
    poserDecembre(true)
    const en2025 = monter(2025)
    const titre2025 = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre2025.parentElement!).getByText(/Déficit de 600 € : case 5QE/)
    en2025.unmount()

    monter(2026)
    const titre2026 = await screen.findByText(/Report sur la déclaration des revenus 2026/)
    within(titre2026.parentElement!).getByText(/Déficit de 120 € : case 5QE/)
  })

  it('dit la pièce comptée à sa date de facture faute de paiement rapproché', async () => {
    poserDecembre(false)
    monter(2025)

    const titre = await screen.findByText(/Pièces comptées à leur date de facture \(1\)/)
    const carte = within(titre.closest('.card')!)
    carte.getByText('FOURNISSEUR')
    carte.getByText('20/12/2025')
    carte.getByText(/^120,00\s€$/)
    // Et la facture reste comptée en 2025 : 600 de cotisations + 120 = 720.
    const report = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(report.parentElement!).getByText(/Déficit de 720 € : case 5QE/)
  })

  it('se tait sur une pièce dont le paiement est rapproché', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran dit la supposition » serait satisfait par un écran qui
    // la dit toujours — et une mise en garde permanente cesse d'être lue.
    poserDecembre(true)
    monter(2026)

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it("propose l'exercice du paiement quand toutes les années sont affichées", async () => {
    // La liste des exercices suivait `date_piece` : la facture de décembre n'y faisait apparaître que
    // 2025, et ses 120 € réglés en 2026 disparaissaient de la vue « toutes années ».
    poserDecembre(true)
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={TRESORERIE} />
      </AnneeProvider>,
    )

    await screen.findByText(/Report sur la déclaration des revenus 2026/)
    await screen.findByText(/Report sur la déclaration des revenus 2025/)
  })

  it('refuse de remplir le formulaire quand les PAIEMENTS sont lus en partie', async () => {
    // Tronquée, cette lecture ferait retomber sur leur date de facture des pièces payées une autre
    // année : une 2035 plausible, fausse et signée — le drapeau des cinq autres entrées la couvre.
    poserDecembre(true)
    faux.muetApresParTable = { lignes_bancaires: 0 }
    monter(2026)

    await screen.findByText(/n'a pas pu être lue en entier/)
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
  })
})

// UNE ÉCHÉANCE DE COTISATION COMPTE À SON PRÉLÈVEMENT (lib/cotisationRapprochee.ts) : rapprochée d'un
// mouvement, elle compte l'année et pour le montant du relevé — ceux de son écriture au FEC. Ce qui se joue
// ici est le CÂBLAGE : que l'écran passe le relevé au calcul, et DISE les échéances comptées à leur date.
describe('ClotureTab — une échéance de cotisation compte à son prélèvement', () => {
  const PRELEVEE_EN_JANVIER = {
    id: 'l-urssaf', dossier_id: 'dossier-de-test', date: '2026-01-06', libelle: 'PRLV URSSAF', montant: -300,
    statut: 'rapprochee', piece_id: null, cotisation_id: 'c1', categorie_id: null, emprunt_id: null, ventilee: false,
    reglement_groupe: false, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
    created_at: '2026-01-07T09:00:00Z',
  }
  const TITRE = /Cotisations comptées à leur échéance/
  function poserDecembre(prelevee: boolean) {
    // La pièce d'achat de mars 2025 (120 €) reste, pour que 2025 ait toujours un résultat à reporter.
    poser({}, [], [cotisation('c1', { echeance: '2025-12-05', montant_appele: 300, montant_verse: null })])
    faux.parTable.lignes_bancaires = prelevee ? [PRELEVEE_EN_JANVIER] : []
  }

  it('compte une échéance de décembre prélevée en janvier dans l’exercice du prélèvement', async () => {
    poserDecembre(true)
    const en2025 = monter(2025)
    const titre2025 = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre2025.parentElement!).getByText(/Déficit de 120 € : case 5QE/)
    en2025.unmount()

    monter(2026)
    const titre2026 = await screen.findByText(/Report sur la déclaration des revenus 2026/)
    within(titre2026.parentElement!).getByText(/Déficit de 300 € : case 5QE/)
  })

  it('sans prélèvement rapproché, elle compte à son échéance, et la carte le dit', async () => {
    poserDecembre(false)
    monter(2025)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Déficit de 420 € : case 5QE/)
    expect(screen.getByText('Cotisations comptées à leur échéance (1)')).toBeTruthy()
  })

  it('se tait sur une échéance prélevée', async () => {
    // Garde SYMÉTRIQUE : sans lui, « l'écran dit la supposition » serait satisfait par un écran qui la dit
    // toujours.
    poserDecembre(true)
    monter(2026)
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it('la carte ne liste que les échéances de l’exercice affiché, et dit les prévisionnelles', async () => {
    poser({}, [], [
      cotisation('c1', { echeance: '2025-12-05', montant_appele: 300, montant_verse: null, previsionnel: true }),
      cotisation('c2', { echeance: '2024-06-05', montant_appele: 200, montant_verse: null }),
    ])
    monter(2025)
    const carte = within((await screen.findByText('Cotisations comptées à leur échéance (1)')).closest('.card')!)
    carte.getByText('05/12/2025 (prévisionnelle)')
    expect(carte.queryByText(/05\/06\/2024/)).toBeNull()
  })

  it('la CSG-CRDS non saisie se signale dans l’exercice du prélèvement, pas dans celui de l’échéance', async () => {
    // L'échéance de décembre (sans CSG-CRDS saisie) prélevée en janvier compte en 2026 : c'est la 2035 de
    // 2026 qui la porte ligne 25, donc là qu'il faut dire que sa part non déductible n'est pas chiffrable.
    const CSG = /Cotisations dont la CSG-CRDS n’est pas saisie/
    poserDecembre(true)
    const en2026 = monter(2026)
    const titre = await screen.findByText(CSG)
    within(titre.closest('.card')!).getByText(/1 — part non déductible non chiffrable/)
    en2026.unmount()

    monter(2025)
    await screen.findByText(/Report sur la déclaration des revenus 2025/)
    expect(screen.queryAllByText(CSG)).toHaveLength(0)
  })

  it('propose l’exercice du prélèvement quand toutes les années sont affichées', async () => {
    poserDecembre(true)
    faux.parTable.pieces = []
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={TRESORERIE} />
      </AnneeProvider>,
    )
    await screen.findByText(/Report sur la déclaration des revenus 2026/)
    expect(screen.queryByText(/Report sur la déclaration des revenus 2025/)).toBeNull()
  })
})

// UN VIREMENT QUI RÈGLE PLUSIEURS PIÈCES (ligne 26) : chaque part est un paiement de sa pièce, et la 2035 la
// compte à la date du virement, comme un rapprochement simple. Le virement ne porte aucune pièce — elles sont
// dans ses parts, que l'écran doit LIRE : sans elles, les deux factures retomberaient sur leur date de facture.
describe("ClotureTab — l'exercice d'un virement qui règle plusieurs pièces", () => {
  const DECEMBRE_A = { ...PIECE, id: 'pa', tiers: 'ALPHA', date_piece: '2025-12-20', montant_ttc: 120 }
  const DECEMBRE_B = { ...PIECE, id: 'pb', tiers: 'BETA', date_piece: '2025-12-22', montant_ttc: 80 }
  const VIREMENT_DE_JANVIER = {
    id: 'l-g', dossier_id: 'dossier-de-test', date: '2026-01-05', libelle: 'VIR FOURNISSEURS', montant: -200,
    statut: 'rapprochee', piece_id: null, cotisation_id: null, reglement_groupe: true, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2026-01-06T09:00:00Z',
  }
  const PARTS = [
    { id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-g', piece_id: 'pa', montant: -120, created_at: '2026-01-06T09:00:00Z' },
    { id: 'g2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-g', piece_id: 'pb', montant: -80, created_at: '2026-01-06T09:00:00Z' },
  ]

  function poserGroupe() {
    poser()
    faux.parTable.pieces = [DECEMBRE_A, DECEMBRE_B]
    faux.parTable.lignes_bancaires = [VIREMENT_DE_JANVIER]
    faux.parTable.reglements_groupes = PARTS
  }

  it("compte les deux factures dans l'exercice du virement, et ne les dit pas comptées à leur date de facture", async () => {
    poserGroupe()
    const en2025 = monter(2025)
    const titre2025 = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    // 2025 ne garde que ses deux échéances de cotisation.
    within(titre2025.parentElement!).getByText(/Déficit de 600 € : case 5QE/)
    expect(screen.queryAllByText(/Pièces comptées à leur date de facture/)).toHaveLength(0)
    en2025.unmount()

    monter(2026)
    const titre2026 = await screen.findByText(/Report sur la déclaration des revenus 2026/)
    within(titre2026.parentElement!).getByText(/Déficit de 200 € : case 5QE/)
  })

  it('refuse de remplir le formulaire quand les parts sont lues en partie', async () => {
    poserGroupe()
    faux.muetApresParTable = { reglements_groupes: 1 }
    monter(2026)

    await screen.findByText(/n'a pas pu être lue en entier/)
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
  })
})

describe('ClotureTab — le refus de remplir une 2035 sur une lecture partielle', () => {
  it('bloque le formulaire quand ce sont les COTISATIONS qui manquent, pas les pièces', async () => {
    // Les pièces sont lues en entier : un garde-fou qui ne regarde qu'elles laisse donc passer,
    // et la 2035 part avec une cotisation de moins — plausible, fausse, et signée.
    poser({ cotisations_declarees: 1 })
    monter()

    await screen.findByText(/n'a pas pu être lue en entier/)
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
  })

  it('laisse remplir le formulaire quand les cinq collections sont lues en entier', async () => {
    poser()
    monter()

    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/n'a pas pu être lue en entier/)).toBeNull()
  })
})

// LA DOTATION DE LA CASE CH EST CELLE DE LA RÈGLE FISCALE (ligne 26.6, étape b).
//
// Jusqu'au 01/10/2026 elle partait en entier dès l'année d'acquisition, sous une carte qui disait de reprendre
// la première annuité. Le moteur compte désormais prorata temporis depuis la mise en service
// (lib/amortissements.ts, testé à part) ; ce qui se joue ici est le CÂBLAGE — que la case CH du formulaire
// porte ce calcul, et que la carte de réserve, devenue sans objet, ne soit plus là pour dire le contraire.
describe('ClotureTab — la dotation aux amortissements de la case CH', () => {
  // La ligne d'une case du formulaire : son code, puis son montant.
  async function montantDeLaCase(code: string) {
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    const ligne = screen.getAllByText(code).map((c) => c.closest('tr')!).find((tr) => tr.querySelector('td')?.textContent === code)!
    return ligne.querySelectorAll('td')[ligne.querySelectorAll('td').length - 1].textContent
  }

  it('compte six mois pour un bien acquis le 1er juillet', async () => {
    poser({}, [immobilisation({ date_acquisition: '2025-07-01' })])
    monter()

    expect(await montantDeLaCase('CH')).toMatch(/^1\s200,00\s€$/)
    expect(screen.queryAllByText(/Première annuité d’amortissement à reprendre/)).toHaveLength(0)
  })

  it('part de la mise en service quand elle est saisie', async () => {
    poser({}, [immobilisation({ date_acquisition: '2025-01-01', date_mise_en_service: '2025-07-01' })])
    monter()

    expect(await montantDeLaCase('CH')).toMatch(/^1\s200,00\s€$/)
  })

  it('compte une annuité pleine pour un bien acquis le 1er janvier', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la dotation est proratisée » serait satisfait par un écran qui
    // raboterait aussi l'année pleine.
    poser({}, [immobilisation()])
    monter()

    expect(await montantDeLaCase('CH')).toMatch(/^2\s400,00\s€$/)
  })
})

// LA FACTURE D'UN BIEN NE DÉPEND PLUS DE SA CATÉGORIE (ligne 26.6, étape b) : la 2035 l'écarte, le bien y
// compte par sa dotation, et son acquisition s'écrit sur le compte de sa nature. « Pièces validées sans
// catégorie » dirait d'elle qu'elle ne compte nulle part, ce qui serait faux deux fois.
describe('ClotureTab — la facture d’un bien n’est pas une pièce sans catégorie', () => {
  it('ne la range pas parmi les pièces validées sans catégorie', async () => {
    poser({}, [immobilisation()])
    faux.parTable.pieces = [{ ...PIECE, categorie_id: null }]
    monter()
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryByText(/Pièces validées sans catégorie/)).toBeNull()
  })

  it('range toujours là une pièce sans catégorie qui n’est pas un bien', async () => {
    // Le garde symétrique : sans lui, le test ci-dessus serait satisfait par une carte qui ne dit plus rien.
    poser({}, [])
    faux.parTable.pieces = [{ ...PIECE, categorie_id: null }]
    monter()
    await screen.findByText(/Pièces validées sans catégorie/)
  })

  // Ni parmi les catégories à qui il manque un poste : la 2035 écarte la facture d'un bien, donc le poste de
  // sa catégorie ne décide de rien — la carte enverrait compléter un poste qui ne compte nulle part.
  it('ne réclame pas de poste pour la catégorie de la facture d’un bien', async () => {
    poser({}, [immobilisation()])
    faux.parTable.categories = [{ ...CATEGORIE, poste_2035: null }]
    monter()
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryByText('Postes manquants')).toBeNull()
  })

  it('réclame toujours le poste de la catégorie d’une pièce qui n’est pas un bien', async () => {
    poser({}, [])
    faux.parTable.categories = [{ ...CATEGORIE, poste_2035: null }]
    monter()
    await screen.findByText('Postes manquants')
  })
})

// CE QUI RESTE À SAISIR SUR LA CSG-CRDS, DIT SUR L'ÉCRAN QUI REMPLIT LE FORMULAIRE.
//
// Depuis le 22/09/2026 le moteur SORT la CSG-CRDS saisie de la ligne 25 et porte ses 6,8 points
// déductibles en case BV (ligne 14) — présentation relevée sur une 2035 réelle, BV remplie et case CC
// vide. Une cotisation ventilée n'a donc plus rien à signaler.
//
// Ce que cet écran garde, c'est le cas qu'aucun calcul ne peut rattraper : une cotisation dont
// `montant_csg_crds` n'est pas saisi reste portée en entier ligne 25. `partCsgNonDeductible` est
// juste et testée à part ; ici c'est le CÂBLAGE — que l'écran se taise quand il n'y a rien à dire, et
// parle quand la saisie manque.
describe('ClotureTab — ce qui reste à saisir sur la CSG-CRDS', () => {
  const TITRE = /Cotisations dont la CSG-CRDS n’est pas saisie/

  it('SE TAIT quand la ventilation est saisie — le moteur s’en charge', async () => {
    // Le code TEL QU'IL ÉTAIT criait ici : la carte listait « à réintégrer 290,00 € » alors que le
    // moteur retire désormais ces 290 € du résultat tout seul. Redire une chose déjà faite est la
    // mise en garde permanente que ce dépôt refuse.
    poser({}, [], [cotisation('c1', { montant_csg_crds: 970 })])
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it('PARLE quand la saisie manque, et dit qu’il ne peut pas chiffrer', async () => {
    // Le cas de toute la production aujourd'hui : `montant_csg_crds` n'est renseigné nulle part.
    // Se taire reviendrait à dire « rien à réintégrer » — la famille des résultats vides qui
    // ressemblent à une réponse, appliquée cette fois à une saisie manquante.
    poser({}, [], [cotisation('c1'), cotisation('c2')])
    monter()

    const titre = await screen.findByText(TITRE)
    within(titre.closest('.card')!).getByText(/2 — part non déductible non chiffrable/)
  })

  it('montre ce qui EST ventilé sur un exercice où il reste des cotisations sans CSG', async () => {
    // L'assiette du tableau porte sur l'exercice entier : une cotisation ventilée et une autre sans
    // saisie coexistent, et les deux chiffres doivent se lire ensemble — sinon l'opérateur ne sait
    // pas ce qui a déjà été traité.
    poser({}, [], [cotisation('c1', { montant_csg_crds: 970 }), cotisation('c2')])
    monter()

    const titre = await screen.findByText(TITRE)
    const carte = within(titre.closest('.card')!)
    carte.getByText(/^970,00\s€$/)
    carte.getByText(/^680,00\s€$/)
    carte.getByText(/1 — part non déductible non chiffrable/)
  })

  it('se tait sur un exercice sans aucune cotisation', async () => {
    poser({}, [], [])
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it('se tait quand toutes les cotisations sont ventilées à zéro de CSG', async () => {
    // LE garde symétrique, et le précédent ne suffisait PAS : un exercice sans cotisation rend
    // `null` de toute façon, donc « avertit toujours » y passait inaperçu. Un appel de retraite
    // sans ligne de CSG est un cas réel, et c'est lui qui distingue les deux.
    poser({}, [], [cotisation('c1', { montant_csg_crds: 0 })])
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })
})

describe('ClotureTab — la confirmation de clôture NOMME ses deux conséquences', () => {
  // UNE CONFIRMATION QUI N'EN NOMME QU'UNE LAISSE COCHER POUR L'UNE ET SUBIR L'AUTRE.
  //
  // La marque de clôture commandait déjà la purge du texte OCR des pièces sensibles (RGPD.md §8.3),
  // et son message le disait. Depuis le 22/09/2026 elle commande AUSSI l'arrêt des réclamations de
  // documents pour cet exercice, sur les trois écrans « ce qu'il reste à envoyer » — et c'est
  // précisément la conséquence qui fait venir cliquer ici. Le message ne la nommait pas.
  //
  // Aucun test de `src/lib` ne peut voir ça : `cloturerExercice` est juste, `resteAEnvoyer` est
  // juste, c'est la PHRASE de l'écran qui promet moins que le geste ne fait. Même garde que les
  // quatorze autres confirmations du projet (« et tous ses mouvements »).
  const DEUX_CONSEQUENCES = [/texte OCR/i, /cesse de réclamer|cesse de réclamer les documents/i]

  it('nomme la purge ET l’arrêt des réclamations', async () => {
    poser()
    const confirmations: string[] = []
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { confirmations.push(m ?? ''); return false })
    monter()

    const bouton = await screen.findByRole('button', { name: /Clôturer l’exercice/ })
    bouton.click()

    expect(confirmations).toHaveLength(1)
    for (const attendu of DEUX_CONSEQUENCES) {
      expect(attendu.test(confirmations[0]), `la confirmation doit nommer ${attendu}`).toBe(true)
    }
    // Et l'année, sans quoi « cet exercice » ne désigne rien sur un écran qui en affiche plusieurs.
    expect(confirmations[0]).toMatch(/2025/)
    vi.restoreAllMocks()
  })

  it('NE CLÔTURE PAS quand la confirmation est refusée', async () => {
    // Garde symétrique : sans lui, « la confirmation nomme les deux » serait satisfait par un bouton
    // qui ne clôture JAMAIS — et la purge cesserait de fonctionner sans qu'un test tombe.
    poser()
    vi.spyOn(window, 'confirm').mockImplementation(() => false)
    monter()

    const bouton = await screen.findByRole('button', { name: /Clôturer l’exercice/ })
    bouton.click()

    // Le libellé du bouton bascule sur « Rattraper la purge » une fois l'exercice clôturé : qu'il
    // reste inchangé prouve qu'aucune clôture n'a eu lieu.
    expect(await screen.findByRole('button', { name: /Clôturer l’exercice/ })).toBeTruthy()
    expect(screen.queryAllByText(/clôturé —/)).toHaveLength(0)
    vi.restoreAllMocks()
  })
})

// LA DOTATION D'UN BIEN SANS JUSTIFICATIF PART EN CASE CH D'UNE 2035 SIGNÉE.
// `immobilisations.piece_id` est en `ON DELETE SET NULL` : supprimer la pièce détache le bien sans
// un mot, et `calculerDeclaration2035` totalise la dotation sans regarder ce lien. La piste d'audit
// ne couvre pas les immobilisations — cet écran est le dernier qui puisse encore le dire.
describe('ClotureTab — un amortissement dont le justificatif a été supprimé', () => {
  const TITRE = /Amortissement\(s\) sans justificatif/

  it('le dit avant de laisser déposer la déclaration', async () => {
    poser({}, [immobilisation({ piece_id: null })])
    monter()

    const titre = await screen.findByText(/Amortissement\(s\) sans justificatif \(1\)/)
    const carte = within(titre.closest('.card')!)
    // La dotation RÉELLEMENT comptée cette année-là : 12 000 / 5.
    expect(carte.getByText(/2\s?400,00/)).toBeDefined()
  })

  // CADRÉ SUR L'EXERCICE, et c'est la moitié du correctif qui se raconte mal : un bien amorti
  // jusqu'en 2019 n'envoie plus rien en case CH de la 2035 de 2025. Le signaler ici serait crier au
  // loup sur le document qu'on signe — la Checklist, elle, le compte quand même, et c'est son rôle.
  it("ne signale pas un bien entièrement amorti avant l'exercice affiché", async () => {
    poser({}, [immobilisation({ piece_id: null, date_acquisition: '2015-01-01', duree_annees: 3 })])
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « l'écran prévient » serait satisfait par un écran qui prévient
  // TOUJOURS, y compris sur un registre parfaitement rattaché.
  // Elle s'appuie sur le DÉFAUT de la fabrique, comme celle d'ImmobilisationsTab : c'est ce qui rend
  // la correction du `piece_id` infidèle gardée plutôt que seulement faite.
  it('se tait sur une immobilisation qui désigne bien sa pièce', async () => {
    poser({}, [immobilisation()])
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })
})

// LE CADRE 8 DU 2035-B, ET OÙ LE REPORTER. Depuis les revenus 2025 la 2035 porte le revenu brut
// social (DC ou DD), base de l'Urssaf pour les cotisations et la CSG-CRDS, et la déclaration de
// revenus le reprend dans son volet social. `cases2035.test.ts` garde le CALCUL ; ici c'est ce que
// l'écran en fait — l'afficher, dire où le reporter, et l'envoyer au formulaire — et qu'il n'en
// dise rien sur un exercice dont le formulaire ne porte pas ce cadre.
describe('ClotureTab — le revenu brut social du cadre 8', () => {
  const CATEGORIE_RECETTES = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations',
    ordre: 2, compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const RECETTE = {
    ...PIECE, id: 'p2', nom_fichier: 'releve-activite.pdf', type_piece: 'vente', date_piece: '2025-05-02',
    montant_ttc: 5000.4, tiers: 'CPAM', categorie_id: 'cat-recettes',
  }

  // 5 000,40 de recettes, 120,60 d'achats, 600 de cotisations (deux échéances de 300) : bénéfice
  // 4 279,80 au centime, revenu brut social 4 879,80. Les centimes sont choisis pour que le formulaire
  // DIFFÈRE du tableau : il imprime 5 000 et 121, donc un bénéfice de 4 279 et non 4 280.
  function poserUnBenefice() {
    poser()
    faux.parTable.categories = [CATEGORIE, CATEGORIE_RECETTES]
    faux.parTable.pieces = [{ ...PIECE, montant_ttc: 120.6 }, RECETTE]
  }

  it('affiche DD et dit où reporter le bénéfice et le revenu brut social, à l’euro du formulaire', async () => {
    poserUnBenefice()
    monter()

    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    // Le tableau garde ses centimes, comme toutes les cases de l'écran…
    const ligneDD = screen.getByText('DD').closest('tr')!
    expect(within(ligneDD).getByText(/^4\s879,80\s€$/)).toBeDefined()

    // … le report donne ce que la liasse portera, donc ce que le cabinet retrouvera prérempli.
    const report = within(titre.parentElement!)
    report.getByText(/Bénéfice de 4\s279 € : case 5QC/)
    report.getByText(/Revenu brut social de 4\s879 € \(case DD\) : rubrique DSDE/)
    // Et ce qu'il ne faut PAS faire : l'Urssaf retranche elle-même ses 26 %.
    report.getByText(/abattement de 26 % : ne pas le retrancher/)
    expect(report.queryAllByText(/5QE|DSDG/)).toHaveLength(0)
  })

  it('dit un revenu brut social négatif en DC, et le déficit en 5QE', async () => {
    // Le jeu par défaut n'a pas de recette : 720 de charges, dont 600 de cotisations. Déficit fiscal
    // 720, revenu brut social −120 — les cotisations reviennent dans l'assiette sociale.
    poser()
    monter()

    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    const report = within(titre.parentElement!)
    report.getByText(/Déficit de 720 € : case 5QE/)
    report.getByText(/Revenu brut social négatif de 120 € \(case DC\) : rubrique DSDG/)
    expect(report.queryAllByText(/5QC|DSDE/)).toHaveLength(0)
  })

  it('envoie le cadre 8 au formulaire, recalculé sur les cases arrondies de l’exercice', async () => {
    poserUnBenefice()
    faux.remplies = []
    // jsdom n'a ni `createObjectURL` ni navigation : le téléchargement lui-même n'est pas en cause.
    URL.createObjectURL = () => 'blob:formulaire'
    URL.revokeObjectURL = () => {}
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    monter()

    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    await act(async () => { bouton.click() })

    expect(faux.remplies).toHaveLength(1)
    // Les mêmes 4 879 que le report : ce que l'écran annonce est ce que le PDF porte.
    expect(faux.remplies[0].get('DD')).toBe(4879)
    expect(faux.remplies[0].get('DC')).toBe(0)
    expect(clic).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('ne montre ni le cadre 8 ni le report sur un exercice antérieur aux revenus 2025', async () => {
    poser({}, [], [cotisation('c1', { echeance: '2024-03-05' })])
    faux.parTable.pieces = [{ ...PIECE, date_piece: '2024-03-10' }]
    monter(2024)

    // Le formulaire de l'exercice est bien rendu — sans quoi l'absence ne prouverait rien.
    await screen.findByText('Exercice 2024')
    expect(screen.getByText('CR')).toBeDefined()
    for (const code of ['DE', 'DB', 'DC', 'DD']) expect(screen.queryAllByText(code), code).toHaveLength(0)
    expect(screen.queryAllByText(/Report sur la déclaration des revenus/)).toHaveLength(0)
  })
})

// UN DOSSIER EXONÉRÉ DÉCLARE SES DÉPENSES TVA COMPRISE (voir lib/montantRetenu.ts). Ce que ce test
// garde, et qu'aucun test de `src/lib` ne peut garder : que l'onglet passe bien SON statut au calcul
// de la 2035 — c'est-à-dire ce qui part sur le formulaire signé.
describe('ClotureTab — le statut TVA du dossier décide du montant déclaré', () => {
  it.each([
    [false, 120],
    [true, 100],
  ])('assujetti : %s — la case Achats porte %s €', async (assujetti, attendu) => {
    poser()
    faux.parTable.pieces = [{ ...PIECE, montant_ht: 100, montant_tva: 20, montant_ttc: 120 }]
    faux.remplies = []
    URL.createObjectURL = () => 'blob:formulaire'
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    monter(2025, assujetti)

    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    await act(async () => { bouton.click() })
    expect(faux.remplies[0].get('BA')).toBe(attendu)
    vi.restoreAllMocks()
  })

  // Une pièce ÉCARTÉE de la déclaration s'affiche pour le montant qui y manquera : TVA comprise pour
  // un dossier exonéré. Au hors taxes, l'écran sous-estimerait ce que la déclaration perd.
  it('une pièce écartée faute de poste s’affiche TVA comprise pour un dossier exonéré', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, { ...CATEGORIE, id: 'cat-sans-poste', code: 'autre', libelle: 'Autre', poste_2035: null }]
    faux.parTable.pieces = [
      PIECE,
      { ...PIECE, id: 'p2', tiers: 'SANS POSTE', categorie_id: 'cat-sans-poste', montant_ht: 100, montant_tva: 20, montant_ttc: 120 },
    ]
    monter(2025, false)
    const titre = await screen.findByText(/Pièces validées absentes du récapitulatif \(1\)/)
    const ligne = within(titre.closest('.card')!).getByText('SANS POSTE').closest('tr')!
    expect(within(ligne).getByText(/^120,00\s€$/)).toBeTruthy()
  })
})

// EN ENGAGEMENT (BIC, IS), la 2035 n'a pas d'objet : elle déclare des bénéfices non commerciaux, tenus
// en trésorerie. L'écran le dit, et ne garde que la clôture de l'exercice, qui ne dépend pas d'elle.
describe('ClotureTab — un dossier tenu en engagement', () => {
  function monterEngagement() {
    return render(
      <AnneeProvider defaut={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={ENGAGEMENT} />
      </AnneeProvider>,
    )
  }

  it('dit que la 2035 n’est pas produite, et n’offre ni formulaire ni volet social', async () => {
    poser()
    monterEngagement()

    await screen.findByText('La 2035 n’est pas produite pour ce dossier')
    expect(screen.getByText(/ses livrables sont le FEC et la balance des comptes/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Remplir le formulaire officiel/ })).toBeNull()
    expect(screen.queryByText(/Report sur la déclaration des revenus/)).toBeNull()
    expect(screen.queryByText(/Volet social/)).toBeNull()
  })

  it('garde la clôture de l’exercice, qui ne dépend pas de la déclaration', async () => {
    poser()
    monterEngagement()
    const carte = (await screen.findByText('Exercice 2025')).closest('.card')!
    expect(within(carte as HTMLElement).getByRole('button', { name: /Clôturer l’exercice/ })).toBeTruthy()
  })

  it('produit la 2035 en trésorerie — le garde symétrique', async () => {
    poser()
    monter(2025)
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryByText('La 2035 n’est pas produite pour ce dossier')).toBeNull()
  })

  // LA CHECKLIST ENVOIE ICI COMPLÉTER UN POSTE MANQUANT, dans les deux modèles : le poste regroupe
  // encore la situation intermédiaire et l'estimation d'un dossier en engagement, qui écartent une
  // pièce sans poste. Masquée avec le reste de la 2035, la carte laissait ce renvoi sur un écran vide.
  it('montre les postes manquants et les enregistre', async () => {
    poser()
    faux.parTable.categories = [{ ...CATEGORIE, poste_2035: null }]
    monterEngagement()

    const carte = (await screen.findByText('Postes manquants')).closest('.card') as HTMLElement
    expect(within(carte).getByText(/Ce dossier ne produit pas de 2035, mais le poste regroupe encore/)).toBeTruthy()
    fireEvent.change(within(carte).getByPlaceholderText(/ex\. Achats/), { target: { value: 'Achats' } })
    await act(async () => { within(carte).getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.misesAJour).toEqual([{ table: 'categories', valeurs: { poste_2035: 'Achats' } }])
  })

  it('garde, en trésorerie, l’explication de la 2035 sur la même carte', async () => {
    poser()
    faux.parTable.categories = [{ ...CATEGORIE, poste_2035: null }]
    monter(2025)
    const carte = (await screen.findByText('Postes manquants')).closest('.card') as HTMLElement
    expect(within(carte).getByText(/n'ont pas encore de poste 2035 associé — leurs montants ne sont pas comptés dans le récapitulatif/)).toBeTruthy()
    expect(within(carte).queryByText(/Ce dossier ne produit pas de 2035/)).toBeNull()
  })

  it('propose à la clôture l’exercice de la FACTURE, pas celui du paiement', async () => {
    // Facturée en décembre 2025, payée en janvier 2026 : en engagement la pièce appartient à 2025, et
    // l'exercice 2026 n'a rien à clôturer.
    poser({}, [], [])
    faux.parTable.pieces = [{ ...PIECE, date_piece: '2025-12-20' }]
    faux.parTable.lignes_bancaires = [{
      id: 'l1', dossier_id: 'dossier-de-test', date: '2026-01-05', libelle: 'PRLV FOURNISSEUR', montant: -120,
      statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
      source_fichier: null, libelle_brut: null, created_at: '2026-01-05T09:00:00Z',
    }]
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={ENGAGEMENT} />
      </AnneeProvider>,
    )
    await screen.findByText('Exercice 2025')
    expect(screen.queryByText('Exercice 2026')).toBeNull()
  })

  it('se tait quand chaque catégorie utilisée a son poste — le garde symétrique', async () => {
    poser()
    monterEngagement()
    await screen.findByText('Exercice 2025')
    expect(screen.queryByText('Postes manquants')).toBeNull()
  })
})

// LIGNE 26.6 : les encaissements de l'Assurance maladie d'un infirmier n'ont pas de bordereau — il ne
// le transmet pas — et arrivent par virement. Affectés à une catégorie de recettes, ils comptent dans
// la 2035 à la date du mouvement. Ce que ce bloc garde et qu'aucun test de `src/lib` ne peut voir :
// que l'écran LISE les mouvements affectés (sa lecture ne prenait que ceux d'une pièce), les passe au
// moteur, propose leur exercice, et DISE ceux qu'il ne peut pas compter.
describe('ClotureTab — les mouvements du relevé affectés sans justificatif', () => {
  const RECETTES = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-cpam', dossier_id: 'dossier-de-test', date: '2025-06-10', libelle: 'VIR CPAM', montant: 5000,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: 'cat-recettes', taux_tva: null, prelevement_personnel: false,
      source_fichier: null, libelle_brut: null, created_at: '2025-06-11T09:00:00Z', ...o,
    }
  }

  it('compte un encaissement affecté dans les recettes de la 2035', async () => {
    // 5 000 € encaissés, 120 € d'achat, 600 € de cotisations : 4 280 € de bénéfice. Sans le
    // mouvement, le même dossier déclarait un déficit de 720 €.
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement()]
    monter(2025)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Bénéfice de 4\s280 € : case 5QC/)
  })

  // LES RECETTES DU RELEVÉ D'UN DOSSIER ASSUJETTI PORTENT LEUR TAUX (lib/tvaDuReleve.ts) : la 2035 compte le
  // hors taxe, la TVA collectée n'étant pas une recette. Ce qui se joue ici est le CÂBLAGE : que l'écran
  // passe le statut du dossier aux parts du relevé — et c'est le statut ACTUEL qui décide.
  it('sur un dossier assujetti, compte un encaissement taxé au hors taxe — sa TVA n’est pas une recette', async () => {
    // 6 000 € encaissés à 20 % : 5 000 € de recettes, 1 000 € de TVA collectée.
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement({ montant: 6000, taux_tva: 20 })]
    monter(2025, true)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Bénéfice de 4\s280 € : case 5QC/)
  })

  it('un dossier qui a cessé d’être assujetti compte la recette entière : le taux gardé ne s’applique plus', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement({ montant: 6000, taux_tva: 20 })]
    monter(2025, false)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Bénéfice de 5\s280 € : case 5QC/)
  })

  it('propose l’exercice d’un encaissement quand toutes les années sont affichées', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement({ date: '2026-02-10' })]
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={TRESORERIE} />
      </AnneeProvider>,
    )
    await screen.findByText(/Report sur la déclaration des revenus 2026/)
  })

  it('dit le mouvement que sa catégorie sans poste 2035 laisse hors de la déclaration', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, { ...RECETTES, poste_2035: null }]
    faux.parTable.lignes_bancaires = [mouvement()]
    monter(2025)
    const titre = await screen.findByText(/Mouvements affectés absents du récapitulatif \(1\)/)
    const carte = within(titre.closest('.card')!)
    carte.getByText('VIR CPAM')
    carte.getByText('catégorie sans poste 2035')
    // Et la catégorie rejoint les postes manquants, où l'on renseigne le poste.
    await screen.findByText('Postes manquants')
  })

  it('se tait quand le mouvement est compté — le garde symétrique', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement()]
    monter(2025)
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(/Mouvements affectés absents du récapitulatif/)).toHaveLength(0)
  })
})

// UN MOUVEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts) compte dans la 2035 par ses parts,
// chacune dans le poste de sa catégorie, la part personnelle dans aucun. Ce que ce bloc garde et qu'aucun
// test de `src/lib` ne peut voir : que l'écran LISE les parts — elles vivent dans leur propre table — et
// les passe au moteur, qu'une lecture partielle des parts bloque le formulaire, et que la liste des
// mouvements absents dise le montant de la PART, pas du mouvement entier.
describe('ClotureTab — les mouvements ventilés sur plusieurs comptes', () => {
  const RECETTES = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const FRAIS = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-v', dossier_id: 'dossier-de-test', date: '2025-06-10', libelle: 'REMISE CB', montant: 4950,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      ventilee: true, source_fichier: null, libelle_brut: null, created_at: '2025-06-11T09:00:00Z', ...o,
    }
  }
  function part(id: string, categorieId: string | null, montant: number) {
    return {
      id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-v', categorie_id: categorieId,
      part_personnelle: categorieId === null, montant, created_at: '2025-06-11T09:00:00Z',
    }
  }

  it('compte la recette brute et la commission d’une remise, chacune dans son poste', async () => {
    // 5 000 € de recettes, 120 € d'achat, 50 € de commission, 600 € de cotisations : 4 230 € de bénéfice.
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES, FRAIS]
    faux.parTable.lignes_bancaires = [mouvement()]
    faux.parTable.ventilations_bancaires = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-frais', -50)]
    monter(2025)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Bénéfice de 4\s230 € : case 5QC/)
  })

  it('ne compte jamais la part personnelle', async () => {
    // 120 € de facture et 84 € de la part professionnelle d'un paiement de 120 €, 600 € de cotisations :
    // 804 € de déficit. Comptée, la part personnelle de 36 € en ferait 840.
    poser()
    faux.parTable.lignes_bancaires = [mouvement({ libelle: 'PRLV OPERATEUR', montant: -120 })]
    faux.parTable.ventilations_bancaires = [part('v1', 'cat-achats', -84), part('v2', null, -36)]
    monter(2025)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Déficit de 804 € : case 5QE/)
  })

  it('refuse le formulaire sur des parts lues en partie', async () => {
    poser({ ventilations_bancaires: 1 })
    faux.parTable.categories = [CATEGORIE, RECETTES, FRAIS]
    faux.parTable.lignes_bancaires = [mouvement()]
    faux.parTable.ventilations_bancaires = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-frais', -50)]
    monter(2025)
    expect(await screen.findByText(/mouvements du relevé et leurs ventilations/)).toBeTruthy()
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
  })

  it('dit la part qu’une catégorie sans poste laisse hors de la déclaration, à son montant', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, { ...FRAIS, poste_2035: null }]
    faux.parTable.lignes_bancaires = [mouvement({ libelle: 'PRLV OPERATEUR', montant: -120 })]
    faux.parTable.ventilations_bancaires = [part('v1', 'cat-achats', -84), part('v2', 'cat-frais', -36)]
    monter(2025)
    const titre = await screen.findByText(/Mouvements affectés absents du récapitulatif \(1\)/)
    const ligne = within(titre.closest('.card')!).getByText('PRLV OPERATEUR').closest('tr')!
    // La part de 36 €, jamais le mouvement entier : 120 € manqueraient à la déclaration.
    expect(ligne.textContent).toMatch(/-36,00/)
    expect(ligne.textContent).not.toMatch(/120,00/)
    // Et la catégorie rejoint les postes manquants, où l'on renseigne le poste.
    await screen.findByText('Postes manquants')
  })
})

// UNE ÉCHÉANCE D'EMPRUNT RAPPROCHÉE COMPTE DANS LA 2035 PAR SES INTÉRÊTS ET SON ASSURANCE, JAMAIS PAR SON
// CAPITAL (lib/echeanceEmprunt.ts). Ce que ce bloc garde et qu'aucun test de `src/lib` ne peut voir : que
// l'écran passe le découpage gardé sur les mouvements au moteur, et DISE les échéances de l'exercice que
// rien ne paie — dont les intérêts manquent à la déclaration signée.
describe('ClotureTab — les échéances d’emprunt', () => {
  // 12 000 € à 3,6 % sur 24 mois depuis le 5 janvier 2025 : onze échéances tombent en 2025 (5 février au
  // 5 décembre), la douzième le 5 janvier 2026.
  const EMPRUNT: Emprunt = {
    id: 'emp-1', dossier_id: 'dossier-de-test', nom: 'Prêt matériel', organisme_preteur: 'Banque du Midi',
    capital_initial: 12000, taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
  }
  const ECHEANCIER = genererEcheancier(EMPRUNT)
  function echeanceRapprochee(numero: number, o: Record<string, unknown> = {}) {
    const e = ECHEANCIER[numero - 1]
    return {
      id: `l-ech-${numero}`, dossier_id: 'dossier-de-test', date: e.date, libelle: 'PRLV ECHEANCE PRET', montant: -540,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      source_fichier: null, libelle_brut: null, created_at: `${e.date}T09:00:00Z`,
      emprunt_id: 'emp-1', emprunt_echeance: numero, emprunt_interets: e.interets, emprunt_assurance: 21.03, ...o,
    }
  }

  it('compte les intérêts et l’assurance d’une échéance rapprochée, jamais le capital', async () => {
    // Le jeu par défaut déclare 720 € de dépenses. L'échéance 2 ajoute 34,55 € d'intérêts (35 au
    // formulaire) et 21,03 € d'assurance (21) : 776 € — et non les 540 € du prélèvement.
    poser()
    faux.parTable.emprunts = [EMPRUNT]
    faux.parTable.lignes_bancaires = [echeanceRapprochee(2)]
    monter(2025)
    const titre = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(titre.parentElement!).getByText(/Déficit de 776 € : case 5QE/)
  })

  it('dit les échéances de l’exercice qu’aucun mouvement ne paie, et les intérêts qui manquent', async () => {
    poser()
    faux.parTable.emprunts = [EMPRUNT]
    faux.parTable.lignes_bancaires = [echeanceRapprochee(2)]
    monter(2025)
    const titre = await screen.findByText('Échéances d’emprunt non rapprochées (10)')
    const carte = titre.closest('.card') as HTMLElement
    const manquants = [1, 3, 4, 5, 6, 7, 8, 9, 10, 11].reduce((s, n) => s + ECHEANCIER[n - 1].interets, 0)
    const attendu = (Math.round(manquants * 100) / 100).toFixed(2).replace('.', ',')
    expect(carte.textContent).toContain(`${attendu}`)
    const numeros = within(carte).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)
    expect(numeros).toEqual(['n° 1', 'n° 3', 'n° 4', 'n° 5', 'n° 6', 'n° 7', 'n° 8', 'n° 9', 'n° 10', 'n° 11'])
  })

  // JUSQU'À AUJOURD'HUI POUR L'EXERCICE EN COURS : une échéance à venir n'est pas en retard. Horloge feinte
  // sur `Date` seule — les minuteurs dont `findByText` dépend restent vrais —, au 20 juin 2025 : les
  // échéances 1, 3, 4 et 5 sont passées sans paiement, celles de juillet à décembre pas encore dues.
  it('ne réclame pas les échéances de l’exercice en cours qui ne sont pas encore dues', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2025, 5, 20, 12, 0, 0))
    try {
      poser()
      faux.parTable.emprunts = [EMPRUNT]
      faux.parTable.lignes_bancaires = [echeanceRapprochee(2)]
      monter(2025)
      const titre = await screen.findByText('Échéances d’emprunt non rapprochées (4)')
      const carte = titre.closest('.card') as HTMLElement
      const numeros = within(carte).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2].textContent)
      expect(numeros).toEqual(['n° 1', 'n° 3', 'n° 4', 'n° 5'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('se tait quand toutes les échéances de l’exercice sont rapprochées — le garde symétrique', async () => {
    poser()
    faux.parTable.emprunts = [EMPRUNT]
    faux.parTable.lignes_bancaires = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => echeanceRapprochee(n))
    monter(2025)
    await screen.findByText(/Report sur la déclaration des revenus 2025/)
    expect(screen.queryAllByText(/Échéances d’emprunt non rapprochées/)).toHaveLength(0)
  })

  it('dit une lecture partielle des emprunts, sans bloquer le formulaire — la 2035 ne les lit pas', async () => {
    poser({ emprunts: 0 })
    faux.parTable.emprunts = [EMPRUNT]
    monter(2025)
    expect(await screen.findByText(/Les emprunts n'ont pas pu être lus en entier/)).toBeTruthy()
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })
})

// LE BARÈME COUVRE DÉJÀ L'AMORTISSEMENT DU VÉHICULE (notice de la 2035, tableau des immobilisations ; voir
// lib/forfaitKilometrique.ts) : un matériel de transport du registre amorti l'année où le barème est retenu est
// déduit deux fois, par sa dotation en CH et par le forfait en BJ. Clôture le dit, sans rien corriger.
describe('ClotureTab — l’amortissement d’un véhicule déduit avec le barème', () => {
  const TITRE = /Amortissement d’un véhicule déduit avec le barème/
  const TRANSPORT = {
    id: 'n-transport', dossier_id: null, libelle: 'Matériel de transport', duree_annees_defaut: 5, ordre: 4, compte_immobilisation: '218200',
  }
  const VOITURE = immobilisation({ id: 'i-voiture', libelle: 'Voiture de tournée', nature_id: 'n-transport' })
  const VEHICULE = {
    id: 'v1', dossier_id: 'dossier-de-test', annee: 2025, modele: 'Clio', type: 'voiture', puissance_fiscale: 4, bareme: 'bnc',
    motorisation: 'thermique', carburant: 'diesel', km_professionnel: 8000, inscrit_immobilisations: false,
    amortissements_a_reintegrer: null, created_at: '2025-01-05T10:00:00Z', updated_at: '2025-01-05T10:00:00Z',
  }

  it('signale la dotation d’un matériel de transport l’année où le barème est retenu', async () => {
    poser({}, [VOITURE])
    faux.parTable.natures_immobilisation = [TRANSPORT]
    faux.parTable.vehicules = [VEHICULE]
    monter()

    const titre = await screen.findByText(TITRE)
    const carte = titre.closest('.card')!
    expect(within(carte as HTMLElement).getByText('Voiture de tournée')).toBeDefined()
    expect(carte.textContent).toMatch(/2\s400,00\s€/)
  })

  it('se tait quand le barème n’est pas retenu, ou que le bien n’est pas un véhicule', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la carte signale le véhicule » serait satisfait par une carte affichée à
    // chaque dossier qui amortit quelque chose.
    poser({}, [VOITURE, immobilisation({ id: 'i-ordi', nature_id: 'n-info' })])
    faux.parTable.natures_immobilisation = [TRANSPORT, { ...TRANSPORT, id: 'n-info', libelle: 'Informatique', compte_immobilisation: '218300' }]
    faux.parTable.vehicules = [{ ...VEHICULE, km_professionnel: 0 }]
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })

  it('lit les natures du cabinet, qui n’appartiennent à aucun dossier', async () => {
    // Une lecture des seules natures du dossier les perdrait toutes : le véhicule ne serait plus reconnu.
    poser({}, [VOITURE])
    faux.parTable.natures_immobilisation = [TRANSPORT, { ...TRANSPORT, id: 'n-autre', dossier_id: 'autre-dossier', compte_immobilisation: '218300' }]
    faux.parTable.vehicules = [VEHICULE]
    monter()

    expect(await screen.findByText(TITRE)).toBeDefined()
  })

  it('dit une lecture partielle des natures', async () => {
    poser({ natures_immobilisation: 0 }, [VOITURE])
    faux.parTable.natures_immobilisation = [TRANSPORT]
    faux.parTable.vehicules = [VEHICULE]
    monter()

    expect(await screen.findByText(/Les natures d’immobilisation n'ont pas pu être lues en entier/)).toBeDefined()
    expect(screen.queryAllByText(TITRE)).toHaveLength(0)
  })
})

// LA 2035 SE RETROUVE-T-ELLE DANS LES ÉCRITURES ? (ligne 26.6, étape c — lib/concordance2035.ts). Le calcul est
// éprouvé à part, sur des écritures produites par les vrais générateurs ; ce qui se joue ici est le CÂBLAGE :
// que l'écran lise TOUT le brouillon et l'ouverture, qu'il ne conclue pas sur une lecture partielle, et que la
// carte dise, sous chaque formulaire, ce qui manque au FEC et où le corriger.
describe('ClotureTab — la concordance de la 2035 avec les écritures', () => {
  const ECRITURE = {
    id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-10', compte: '606100',
    libelle: 'FOURNISSEUR', montant: 120, sens: 'debit', statut: 'proposee', created_at: '2025-03-11T09:00:00Z',
    immobilisation_id: null, vehicule_id: null,
  }
  const CONCORDE = /La 2035 se retrouve dans les écritures de l’exercice/
  const carte = async () => within((await screen.findByText(/Concordance avec les écritures — 2025/)).closest('.card') as HTMLElement)

  function poserSansCotisation() {
    poser({}, [], [])
    faux.parTable.ecritures_brouillon = [ECRITURE]
    faux.parTable.a_nouveaux = []
  }

  it('dit que la 2035 se retrouve dans les écritures quand le brouillon la porte', async () => {
    poserSansCotisation()
    monter()
    const c = await carte()
    c.getByText(CONCORDE)
    expect(c.queryAllByText(/ne se retrouve/)).toHaveLength(0)
  })

  it('nomme la source qui manque au brouillon, et l’onglet où l’écrire', async () => {
    poserSansCotisation()
    faux.parTable.ecritures_brouillon = []
    monter()
    const c = await carte()
    c.getByText(/1 source de la 2035 ne se retrouve pas dans les écritures de l’exercice/)
    c.getByText('1 sans écriture')
    c.getByText('FOURNISSEUR')
    c.getByText(/aucune écriture ne la porte : à écrire/)
    c.getByText('Écritures')
    expect(c.queryAllByText(CONCORDE)).toHaveLength(0)
  })

  it('lit TOUT le brouillon : une écriture d’un autre exercice dit pourquoi elle manque à celui-ci', async () => {
    poserSansCotisation()
    faux.parTable.ecritures_brouillon = [{ ...ECRITURE, date: '2024-12-30' }]
    monter()
    const c = await carte()
    c.getByText(/Son écriture est datée de 2024, la 2035 la compte cet exercice : à régénérer/)
  })

  it('dit pourquoi la 2035 ne compte pas une écriture : sa pièce n’est pas validée', async () => {
    // Le câblage du contexte : seules les pièces VALIDÉES que l'écran a lues font foi.
    poserSansCotisation()
    faux.parTable.ecritures_brouillon = [ECRITURE, { ...ECRITURE, id: 'e2', piece_id: 'p-attente', libelle: 'EN ATTENTE' }]
    monter()
    const c = await carte()
    c.getByText('1 pièce non validée')
    c.getByText(/Écriture d’une pièce qui n’est pas validée/)
    c.getByText('Justificatifs')
  })

  it('dit pourquoi la 2035 ne compte pas une écriture : c’est la facture d’un bien du registre', async () => {
    // La 2035 compte le bien par sa dotation ; sa facture passée en charge est la charge de trop.
    poserSansCotisation()
    faux.parTable.immobilisations = [immobilisation({ nature_id: 'n1' })]
    monter()
    const c = await carte()
    c.getByText(/1 facture d’un bien du registre/)
    c.getByText(/Écriture en charge de la facture d’un bien du registre/)
  })

  it('ne conclut pas sur une lecture partielle des écritures, et laisse remplir le formulaire', async () => {
    // La 2035 ne dépend pas des écritures : leur lecture partielle suspend la concordance, pas la déclaration.
    poserSansCotisation()
    faux.muetApresParTable = { ecritures_brouillon: 0 }
    monter()
    const c = await carte()
    c.getByText(/La concordance ne peut pas conclure/)
    expect(c.queryAllByText(CONCORDE)).toHaveLength(0)
    expect(c.queryAllByText(/ne se retrouve/)).toHaveLength(0)
    const bouton = await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })

  it('ne conclut pas sur une lecture partielle de l’ouverture', async () => {
    poserSansCotisation()
    faux.parTable.a_nouveaux = [{ id: 'an', date: '2026-01-01' }]
    faux.muetApresParTable = { a_nouveaux: 0 }
    monter()
    const c = await carte()
    c.getByText(/La concordance ne peut pas conclure/)
  })

  it('ne conclut pas non plus quand une entrée de la déclaration est lue en partie', async () => {
    poserSansCotisation()
    faux.muetApresParTable = { pieces: 0 }
    monter()
    const c = await carte()
    c.getByText(/La concordance ne peut pas conclure/)
  })

  it('ne compare rien d’un exercice antérieur à l’ouverture d’un dossier repris', async () => {
    poserSansCotisation()
    faux.parTable.ecritures_brouillon = []
    faux.parTable.a_nouveaux = [{ id: 'an', date: '2026-01-01' }]
    monter()
    const c = await carte()
    c.getByText(/Exercice antérieur à l'ouverture du dossier \(01\/01\/2026\)/)
    expect(c.queryAllByText(/ne se retrouve/)).toHaveLength(0)
  })

  it('dit la CSG déductible sans en faire un écart', async () => {
    // 3 000 € prélevés, dont 970 € de CSG-CRDS au 108000 : 2 030 € au 646000, et 680 € déductibles en BV.
    poser({}, [], [cotisation('c1', { montant_verse: null, montant_appele: 3000, montant_csg_crds: 970 })])
    faux.parTable.lignes_bancaires = [{
      id: 'l-c', dossier_id: 'dossier-de-test', date: '2025-03-07', libelle: 'PRLV URSSAF', montant: -3000, statut: 'rapprochee',
      piece_id: null, cotisation_id: 'c1', categorie_id: null, taux_tva: null, prelevement_personnel: false,
      source_fichier: null, libelle_brut: null, created_at: '2025-03-08T09:00:00Z',
    }]
    const cotis = (o: Record<string, unknown>) => ({ ...ECRITURE, piece_id: null, ligne_bancaire_id: 'l-c', date: '2025-03-07', libelle: 'PRLV URSSAF', ...o })
    faux.parTable.ecritures_brouillon = [
      ECRITURE,
      cotis({ id: 'e2', compte: '646000', montant: 2030 }),
      cotis({ id: 'e3', compte: '108000', montant: 970 }),
      cotis({ id: 'e4', compte: '512000', montant: 3000, sens: 'credit' }),
    ]
    faux.parTable.a_nouveaux = []
    monter()
    const c = await carte()
    c.getByText(CONCORDE)
    c.getByText(/La CSG déductible \(680,00\s€, case BV\) n’a pas d’écriture, et ce n’est pas un écart/)
  })

  it('ne s’affiche pas pour un dossier tenu en engagement, qui ne produit pas de 2035', async () => {
    poserSansCotisation()
    render(
      <AnneeProvider defaut={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modele={ENGAGEMENT} />
      </AnneeProvider>,
    )
    await screen.findByText(/La 2035 n’est pas produite pour ce dossier/)
    expect(screen.queryAllByText(/Concordance avec les écritures/)).toHaveLength(0)
  })
})

// UNE CASE NÉGATIVE NE SE DÉPOSE PAS (lib/cases2035.ts) : un poste que ses remboursements font passer sous zéro
// garde son signe — le moteur le retournait en dépense —, et quand il emporte sa case, Clôture le dit.
describe('ClotureTab — une case négative', () => {
  const FRAIS = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 7,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  const mouvement = (o: Record<string, unknown>) => ({
    id: 'l-geste', dossier_id: 'dossier-de-test', date: '2025-06-10', libelle: 'GESTE COMMERCIAL', montant: 3, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'cat-frais', taux_tva: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-06-11T09:00:00Z', ...o,
  })

  it('la dit, avec ses postes, et ne compte plus le remboursement en dépense', async () => {
    // 3 € remboursés, aucun frais payé dans l'exercice : la case BN vaut −3 €, et le résultat gagne 3 €.
    poser({}, [], [])
    faux.parTable.categories = [CATEGORIE, FRAIS]
    faux.parTable.lignes_bancaires = [mouvement({})]
    monter()
    const titre = await screen.findByText(/Case négative \(1\)/)
    // La case et son poste portent ici le même nom : la ligne se lit cellule par cellule.
    const ligne = within(titre.closest('.card') as HTMLElement).getByText('BN').closest('tr') as HTMLElement
    const cellules = [...ligne.querySelectorAll('td')].map((td) => td.textContent?.replace(/\s/g, ' '))
    expect(cellules).toEqual(['2025', 'BNFrais financiers', 'Frais financiers', expect.stringMatching(/^[−-]3,00 €$/)])
    // 120 € d'achat, 3 € de remboursement : un déficit de 117 €, pas de 123 €.
    const report = await screen.findByText(/Report sur la déclaration des revenus 2025/)
    within(report.parentElement!).getByText(/Déficit de 117 € : case 5QE/)
  })

  it('se tait quand la case reste positive — le garde symétrique', async () => {
    poser({}, [], [])
    faux.parTable.categories = [CATEGORIE, FRAIS]
    faux.parTable.lignes_bancaires = [mouvement({ id: 'l-frais', montant: -8.5 }), mouvement({})]
    monter()
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(/Case négative/)).toHaveLength(0)
  })
})

// VALIDER UN EXERCICE (ligne 26.6, étape d). Ce que la carte garde, et qu'aucun test de `src/lib` ne voit : que
// l'écran LISE ce dont les préalables dépendent, réserve le geste au chef, nomme ce qu'on perd, n'appelle la base
// qu'une fois, envoie la numérotation et la 2035 qu'il affiche — et qu'un exercice validé montre la 2035 qui a été
// validée, pas un calcul d'aujourd'hui.
describe('ClotureTab — valider l’exercice', () => {
  const PIECE_EUR = { ...PIECE, devise: 'EUR', taux_change: null }
  const PAIEMENT = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, ventilee: false, reglement_groupe: false, source_fichier: 'releve.pdf', libelle_brut: null,
    created_at: '2025-03-13T09:00:00Z',
  }
  const ECRITURE = {
    id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null, date: '2025-03-12', compte: '606100',
    libelle: 'FOURNISSEUR', montant: 120, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
    ...NON_VALIDEE, created_at: '2025-03-13T09:00:00Z',
  }
  const BANQUE = { ...ECRITURE, id: 'e2', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }
  const VALIDE = {
    dossier_id: 'dossier-de-test', annee: 2025, valide_le: '2026-01-15T10:00:00Z', valide_par: 'chef', mode_comptable: 'tresorerie',
    nb_lignes: 2, nb_ecritures: 1, total_debit: 120, total_credit: 120, empreinte_precedente: null, empreinte: 'a'.repeat(64),
  }
  const INSTANTANE = {
    version: 1, annee: 2025, cases: { BA: 999 }, formulaire: { BA: 999 }, totalRecettes: 0, totalDepenses: 999, resultat: -999,
    postes: [{ poste: 'Achats', nature: 'depense', montant: 999, nbPieces: 1, nbMouvements: 0 }],
    entete: { nom: 'Nom validé', activite: 'Activité validée', siret: '98765432109876' },
  }

  // Un exercice tenu : la pièce payée, son écriture au brouillon, rien en suspens.
  function poserTenu() {
    poser({}, [], [])
    faux.parTable.pieces = [PIECE_EUR]
    faux.parTable.lignes_bancaires = [PAIEMENT]
    faux.parTable.ecritures_brouillon = [ECRITURE, BANQUE]
    faux.parTable.exercices_valides = []
    faux.estChef = true
    faux.appels = []
    faux.reponses = {}
    faux.remplies = []
    faux.entetes = []
    faux.apresValidation = null
  }
  const confirmer = (reponse: boolean) => {
    const messages: string[] = []
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { messages.push(m ?? ''); return reponse })
    return messages
  }
  const monterAvec = (onNavigate = vi.fn()) => {
    render(
      <AnneeProvider defaut={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} onNavigate={onNavigate} />
      </AnneeProvider>,
    )
    return onNavigate
  }
  const carte = async () => within((await screen.findByRole('heading', { name: 'Valider l’exercice 2025' })).closest('.card') as HTMLElement)
  // Ce que la base fait d'une validation acceptée : elle garde l'exercice, avec la 2035 reçue.
  const accepter = () => {
    faux.reponses.valider_exercice = { data: { annee: 2025, lignes: 2, ecritures: 1 }, error: null }
  }

  it('dit ce qui empêche de valider, et mène à l’écran où le lever', async () => {
    poserTenu()
    faux.parTable.ecritures_brouillon = []
    const onNavigate = monterAvec()
    const c = await carte()
    c.getByText('Avant de valider')
    c.getByText(/pièce\(s\) validée\(s\) de l'exercice sans écriture/)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(within(c.getByText(/sans écriture : générer/).closest('li') as HTMLElement).getByRole('button', { name: 'Écritures' }))
    })
    expect(onNavigate).toHaveBeenCalledWith('ecritures')
  })

  it('valide un exercice tenu : la numérotation du FEC et la 2035 affichée partent à la base, et l’exercice se relit validé', async () => {
    poserTenu()
    accepter()
    confirmer(true)
    faux.apresValidation = VALIDE
    monterAvec()
    const c = await carte()
    c.getByText(/Rien n.empêche de valider cet exercice/)
    c.getByText(/1 écriture\(s\) et 2 ligne\(s\) seront validées \(achats : 1\)/)
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })

    expect(faux.appels.map((a) => a.nom)).toEqual(['valider_exercice'])
    const params = faux.appels[0].params as {
      p_dossier_id: string; p_annee: number; p_lignes: { id: string; journal: string; numero: number; piece_ref: string }[]
      p_a_nouveaux: unknown[]; p_declaration: { resultat: number; formulaire: Record<string, number>; entete: unknown } | null
    }
    expect([params.p_dossier_id, params.p_annee]).toEqual(['dossier-de-test', 2025])
    expect(params.p_lignes.map((l) => [l.id, l.journal, l.numero, l.piece_ref])).toEqual([['e1', 'AC', 1, 'facture.pdf'], ['e2', 'AC', 1, 'facture.pdf']])
    expect(params.p_a_nouveaux).toEqual([])
    expect(params.p_declaration?.resultat).toBe(-120)
    expect(params.p_declaration?.formulaire.BA).toBe(120)
    expect(params.p_declaration?.entete).toEqual({ nom: 'Dossier de test', activite: 'Infirmier', siret: '12345678901234' })
    // Relu, l'exercice est validé, sa 2035 est celle qui a été envoyée — et un calcul d'aujourd'hui la retrouve :
    // aucun écart n'est dit (le garde symétrique de la 2035 qui diffère, plus bas).
    await screen.findByText(/^Exercice 2025 validé/)
    screen.getByText(/2035 validée le 15\/01\/2026 : elle est relue telle qu'elle a été validée/)
    expect(screen.queryAllByText(/Recalculée aujourd'hui, elle diffère/)).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Valider l’exercice 2025' })).toHaveLength(0)
  })

  it('nomme ce qu’on perd avant de valider, et n’appelle rien sur un refus', async () => {
    poserTenu()
    accepter()
    const messages = confirmer(false)
    monterAvec()
    const c = await carte()
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(faux.appels).toEqual([])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/DÉFINITIVE : elle ne se défait pas/)
    expect(messages[0]).toMatch(/Ses 1 écriture\(s\) \(2 ligne\(s\)\) deviennent intangibles/)
    expect(messages[0]).toMatch(/figé avec elles : les pièces/)
    expect(messages[0]).toMatch(/La 2035 de 2025 est gardée telle qu'elle est aujourd'hui \(résultat de -120,00\s€\)/)
    expect(messages[0]).toMatch(/se corrigera sur l'exercice suivant/)
  })

  it('n’appelle la base qu’une fois sur trois clics rapprochés', async () => {
    poserTenu()
    accepter()
    confirmer(true)
    monterAvec()
    const c = await carte()
    const bouton = c.getByRole('button', { name: 'Valider l’exercice 2025' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels.filter((a) => a.nom === 'valider_exercice')).toHaveLength(1)
  })

  it('dit le refus de la base, et laisse réessayer', async () => {
    poserTenu()
    faux.reponses.valider_exercice = { data: null, error: { message: "L'exercice 2025 porte des mouvements bancaires à traiter : ils se traitent avant la validation." } }
    confirmer(true)
    monterAvec()
    const c = await carte()
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    c.getByText(/porte des mouvements bancaires à traiter/)
    accepter()
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(faux.appels.filter((a) => a.nom === 'valider_exercice')).toHaveLength(2)
  })

  it('ne propose le geste qu’au chef du cabinet', async () => {
    poserTenu()
    faux.estChef = false
    monterAvec()
    const c = await carte()
    c.getByText('Seul le chef du cabinet valide un exercice.')
    expect(c.queryAllByRole('button', { name: 'Valider l’exercice 2025' })).toHaveLength(0)
  })

  it('suspend la validation sur une lecture partielle, en le disant', async () => {
    poserTenu()
    faux.muetApresParTable = { pieces: 0 }
    monterAvec()
    const c = await carte()
    c.getByText(/La lecture du dossier est restée partielle/)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('montre la 2035 validée, pas un calcul d’aujourd’hui, et la remplit telle quelle', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [{ ...VALIDE, declaration: INSTANTANE }]
    monterAvec()
    await screen.findByText(/2035 validée le 15\/01\/2026 : elle est relue telle qu'elle a été validée/)
    screen.getByText(/Recalculée aujourd'hui, elle diffère sur les cases .*BA/)
    const ligne = screen.getByText('BA').closest('tr') as HTMLElement
    within(ligne).getByText(/^999,00\s€$/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remplir le formulaire officiel/ })) })
    expect(faux.remplies.at(-1)?.get('BA')).toBe(999)
    expect(faux.entetes.at(-1)).toEqual(INSTANTANE.entete)
    // Et la carte dit l'exercice validé, sans plus proposer de le valider.
    screen.getByText(/Validé le 15\/01\/2026 — 1 écriture\(s\), 2 ligne\(s\)/)
    screen.getByText(/premier exercice validé du dossier/)
    expect(screen.queryAllByRole('button', { name: 'Valider l’exercice 2025' })).toHaveLength(0)
  })

  it('ne montre pas une 2035 validée illisible à la place de la validée', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [{ ...VALIDE, declaration: { version: 9 } }]
    monterAvec()
    await screen.findByText(/La 2035 validée de 2025 n'a pas pu être relue/)
    expect(screen.queryAllByRole('button', { name: /Remplir le formulaire officiel/ })).toHaveLength(0)
  })

  it('vérifie l’empreinte d’un exercice validé, et dit une empreinte qui ne correspond plus', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [{ ...VALIDE, declaration: INSTANTANE }]
    faux.reponses.verifier_exercice_valide = { data: true, error: null }
    monterAvec()
    // Cherché HORS de l'`act` : dedans, React retient l'affichage jusqu'à sa sortie.
    const verifier = await screen.findByRole('button', { name: 'Vérifier l’empreinte' })
    await act(async () => { fireEvent.click(verifier) })
    screen.getByText(/Empreinte vérifiée/)
    expect(faux.appels.at(-1)).toEqual({ nom: 'verifier_exercice_valide', params: { p_dossier_id: 'dossier-de-test', p_annee: 2025 } })
    faux.reponses.verifier_exercice_valide = { data: false, error: null }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Vérifier l’empreinte' })) })
    screen.getByText(/L'empreinte ne correspond plus/)
    expect(screen.queryAllByText(/Empreinte vérifiée/)).toHaveLength(0)
  })

  it('en engagement, valide sans 2035 — la base la refuserait', async () => {
    poserTenu()
    faux.parTable.ecritures_brouillon = [
      { ...ECRITURE, id: 'f1', date: '2025-03-10' },
      { ...ECRITURE, id: 'f2', date: '2025-03-10', compte: '401000', sens: 'credit' },
      { ...ECRITURE, id: 'r1', compte: '401000', ligne_bancaire_id: 'l1' },
      { ...ECRITURE, id: 'r2', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' },
    ]
    accepter()
    confirmer(true)
    render(
      <AnneeProvider defaut={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={false} modele={ENGAGEMENT} />
      </AnneeProvider>,
    )
    const c = await carte()
    c.getByText(/Rien n.empêche de valider cet exercice/)
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    const params = faux.appels[0].params as { p_lignes: { id: string; journal: string }[]; p_declaration: unknown }
    expect(params.p_declaration).toBeNull()
    expect(params.p_lignes.map((l) => [l.id, l.journal])).toEqual([['f1', 'AC'], ['f2', 'AC'], ['r1', 'BQ'], ['r2', 'BQ']])
  })

  // Ce que la base garde est le FORMULAIRE, à l'euro, comme l'administration le reçoit — et les cases au centime à côté.
  it('envoie la 2035 du formulaire, à l’euro, et ses cases au centime', async () => {
    poserTenu()
    faux.parTable.pieces = [{ ...PIECE_EUR, montant_ttc: 120.6 }]
    faux.parTable.lignes_bancaires = [{ ...PAIEMENT, montant: -120.6 }]
    faux.parTable.ecritures_brouillon = [{ ...ECRITURE, montant: 120.6 }, { ...BANQUE, montant: 120.6 }]
    accepter()
    confirmer(true)
    monterAvec()
    const c = await carte()
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    const params = faux.appels[0].params as { p_declaration: { cases: Record<string, number>; formulaire: Record<string, number> } }
    expect(params.p_declaration.cases.BA).toBe(120.6)
    expect(params.p_declaration.formulaire.BA).toBe(121)
  })

  // La concordance au centime est la décision du cabinet : une écriture qui ne retrouve pas la 2035 refuse la
  // validation — et c'est la 2035 AFFICHÉE qui est comparée.
  it('refuse un exercice dont les écritures ne retrouvent pas la 2035', async () => {
    poserTenu()
    faux.parTable.ecritures_brouillon = [{ ...ECRITURE, montant: 100 }, { ...BANQUE, montant: 100 }]
    monterAvec()
    const c = await carte()
    c.getByText(/écart\(s\) entre la 2035 et les écritures/)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // La 2035 ne lit que les mouvements rapprochés ; la validation lit tout le relevé — un mouvement à traiter de
  // l'exercice la refuse.
  it('dit les mouvements à traiter de l’exercice, que la 2035 ne lit pas', async () => {
    poserTenu()
    faux.parTable.lignes_bancaires = [PAIEMENT, { ...PAIEMENT, id: 'l2', statut: 'non_rapprochee', piece_id: null, date: '2025-06-01', montant: -40 }]
    monterAvec()
    const c = await carte()
    c.getByText(/L'exercice 2025 porte des mouvements bancaires à traiter/)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // Chacune des lectures dont la validation dépend, et que la 2035 ne lit pas toutes : une seule partielle suspend
  // la validation.
  it.each([
    ['exercices_valides', [{ ...VALIDE, annee: 2023 }]],
    ['ecritures_brouillon', null],
    ['natures_immobilisation', [{ id: 'n1', dossier_id: null, libelle: 'Matériel', duree_annees_defaut: 5, ordre: 1, compte_immobilisation: '218300' }]],
    ['emprunts', [{
      id: 'emp-x', dossier_id: 'dossier-de-test', nom: 'Prêt', organisme_preteur: 'Banque', capital_initial: 1000, taux_annuel: 1,
      date_debut: '2025-01-05', duree_mois: 12, created_at: '2025-01-05T10:00:00Z',
    }]],
  ])('suspend la validation sur une lecture partielle de %s', async (table, lignes) => {
    poserTenu()
    if (lignes) faux.parTable[table] = lignes
    faux.muetApresParTable = { [table]: 0 }
    monterAvec()
    const c = await carte()
    c.getByText(/La lecture du dossier est restée partielle/)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // Les deux contrôles de la Checklist que la validation lit en plus : illisibles, ils ne se taisent pas.
  it.each([
    ['controles_releves_bancaires', "Le contrôle des relevés bancaires n'a pas pu être lu : réessayer avant la validation."],
    ['piece_textes_ocr', "Les doublons de contenu n'ont pas pu être vérifiés : réessayer avant la validation."],
  ])('ne tait pas un contrôle qu’elle n’a pas pu lire (%s)', async (table, message) => {
    poserTenu()
    faux.parTable[table] = [{ id: 'x1', dossier_id: 'dossier-de-test', coherent: false, piece_id: 'p1', document_id: null, texte_md5: 'a' }]
    faux.muetApresParTable = { [table]: 0 }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    monterAvec()
    const c = await carte()
    c.getByText(message)
    expect((c.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })

  // L'exercice de l'ouverture d'un dossier repris se valide avec ses à-nouveaux : la base fige leurs libellés.
  it('valide l’exercice de l’ouverture avec ses à-nouveaux', async () => {
    poserTenu()
    const an = (id: string, compte: string, libelle: string, sens: 'debit' | 'credit') => ({
      id, dossier_id: 'dossier-de-test', date: '2025-01-01', compte, compte_origine: compte, libelle, sens, montant: 1000,
      source_nom: 'balance.csv', source_empreinte: 'b'.repeat(64), ...A_NOUVEAU_NON_VALIDE, created_at: '2025-02-01T00:00:00Z',
    })
    faux.parTable.a_nouveaux = [an('an1', '512000', 'Banque', 'debit'), an('an2', '101300', 'Capital', 'credit')]
    accepter()
    confirmer(true)
    monterAvec()
    const c = await carte()
    c.getByText(/, avec 2 à-nouveau\(x\)\./)
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    const params = faux.appels[0].params as { p_a_nouveaux: { id: string; ecriture_lib: string }[] }
    // Dans l'ordre du FEC, qui range l'écriture d'ouverture par compte.
    expect(params.p_a_nouveaux.map((a) => a.id)).toEqual(['an2', 'an1'])
  })

  // L'exercice que la validation réclame d'abord peut ne rien porter — ici l'année vide qui suit le dernier exercice
  // validé : l'en-tête ne le propose pas, la carte y mène.
  const VALIDE_2023 = { ...VALIDE, annee: 2023, declaration: { ...INSTANTANE, annee: 2023 } }

  it('mène à l’exercice qui se valide d’abord, même quand rien ne le porte', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [VALIDE_2023]
    monterAvec()
    const c = await carte()
    const ordre = c.getByText("L'exercice 2024 n'est pas validé : les exercices se valident dans l'ordre.").closest('li') as HTMLElement
    // Un seul renvoi : vers l'exercice — le préalable se lit ici, il ne mène à aucun autre onglet.
    expect(within(ordre).getAllByRole('button').map((b) => b.textContent)).toEqual(['Exercice 2024'])
    await act(async () => { fireEvent.click(within(ordre).getByRole('button', { name: 'Exercice 2024' })) })
    const c2024 = within((await screen.findByRole('heading', { name: 'Valider l’exercice 2024' })).closest('.card') as HTMLElement)
    c2024.getByText(/Rien n.empêche de valider cet exercice/)
    c2024.getByText("Aucune écriture dans cet exercice : la validation le fige tel qu'il est.")
  })

  it('en engagement aussi, mène à l’exercice qui se valide d’abord', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [{ ...VALIDE_2023, mode_comptable: 'engagement', declaration: null }]
    render(
      <AnneeProvider defaut={2025}>
        <ClotureTab dossierId="dossier-de-test" assujettiTva={false} modele={ENGAGEMENT} />
      </AnneeProvider>,
    )
    const c = await carte()
    await act(async () => { fireEvent.click(c.getByRole('button', { name: 'Exercice 2024' })) })
    await screen.findByRole('heading', { name: 'Valider l’exercice 2024' })
  })

  it('sur tous les exercices, montre ceux qui sont validés et le prochain à valider', async () => {
    poserTenu()
    faux.parTable.exercices_valides = [VALIDE_2023]
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} />
      </AnneeProvider>,
    )
    await screen.findByText(/^Exercice 2023 validé/)
    screen.getByRole('heading', { name: 'Valider l’exercice 2024' })
    screen.getByRole('heading', { name: 'Valider l’exercice 2025' })
  })

  // Le garde symétrique : sans exercice validé, le prochain à valider est le premier qui porte quelque chose — aucune
  // année vide n'est ajoutée.
  it('sans exercice validé, n’ajoute aucun exercice vide', async () => {
    poserTenu()
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={false} modele={TRESORERIE} />
      </AnneeProvider>,
    )
    await screen.findByRole('heading', { name: 'Valider l’exercice 2025' })
    expect(screen.queryAllByRole('heading', { name: /^Valider l’exercice (2023|2024)$/ })).toHaveLength(0)
  })
})
