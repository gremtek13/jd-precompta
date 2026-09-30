import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import ClotureTab from './ClotureTab'
import type { Immobilisation } from '../../lib/types'
import { genererEcheancier, type Emprunt } from '../../lib/emprunts'
import type { Predicat } from '../../test/filtresPostgrest'

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
  // Le serveur cesse de rendre cette table au-delà de la position donnée, tout en continuant
  // d'annoncer le vrai total. C'est ce qui produit une lecture incomplète (voir lectureComplete.ts).
  muetApresParTable: {} as Record<string, number>,
  // Ce que `remplir2035` a reçu : les cases telles que le PDF les porterait.
  remplies: [] as Map<string, number>[],
  // Les mises à jour envoyées, table et valeurs : l'enregistrement d'un poste manquant.
  misesAJour: [] as { table: string; valeurs: unknown }[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  return {
    supabase: {
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
          eq: () => chaine,
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
vi.mock('../../lib/remplir2035', () => ({
  remplir2035: (valeurs: Map<string, number>) => {
    faux.remplies.push(valeurs)
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
    libelle: 'Ordinateur', valeur: 12000, date_acquisition: '2025-01-01', duree_annees: 5,
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
      <ClotureTab dossierId="dossier-de-test" assujettiTva={assujettiTva} modeComptable="tresorerie" />
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
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modeComptable="tresorerie" />
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

// LA PREMIÈRE ANNUITÉ D'AMORTISSEMENT, DITE LÀ OÙ ELLE EST SIGNÉE.
//
// `dotationPourAnnee` compte la dotation en entier dès l'année d'acquisition ; l'amortissement
// fiscal se calcule prorata temporis. La simplification est assumée — mais la réserve ne vivait que
// dans un commentaire de source de l'onglet Immobilisations, renvoyant à « le bandeau », qui est le
// rappel générique « Brouillon ». Personne, en remplissant la 2035, ne pouvait l'apprendre.
//
// Ce que ce test garde et qu'aucun test de `src/lib` ne peut garder : le CÂBLAGE. `dotationsNon-
// Proratisees` est juste et testée à part ; ce qui manquait, c'est qu'un écran l'APPELLE.
describe('ClotureTab — la première annuité d’amortissement à reprendre', () => {
  it('montre l’écart, chiffré, pour un bien acquis en cours d’année', async () => {
    poser({}, [immobilisation({ date_acquisition: '2025-07-01' })])
    monter()

    const titre = await screen.findByText(/Première annuité d’amortissement à reprendre \(1\)/)
    // Borné à la carte d'avertissement : 2 400,00 € figure AUSSI dans le tableau du formulaire, au
    // poste Amortissements — c'est d'ailleurs la preuve que la dotation entière y part bien. Sans
    // ce cadrage, `findByText` échoue en « Found multiple elements », qui ne ressemble pas au
    // défaut gardé (piège déjà payé sur EcrituresTab).
    const carte = within(titre.closest('.card')!)
    carte.getByText(/prorata temporis/)
    // Les deux montants côte à côte : la réserve sans le chiffre ne dit pas ce qu'elle coûte.
    // `\s` plutôt qu'une espace : `toLocaleString('fr-FR')` sépare les milliers par une espace
    // fine insécable (U+202F), celle-là même qui fait échouer la génération de PDF (voir CLAUDE.md).
    carte.getByText(/^2\s400,00\s€$/)
    carte.getByText(/^1\s200,00\s€$/)
  })

  it('se tait quand le bien est acquis le 1er janvier', async () => {
    // Garde SYMÉTRIQUE, et il porte l'essentiel : sans lui, « l'écran avertit » serait satisfait par
    // un écran qui avertit TOUJOURS — et une mise en garde permanente cesse d'être lue.
    poser({}, [immobilisation()])
    monter()

    // Ancré sur quelque chose que ce jeu de données produit forcément, sinon un écran encore en
    // chargement rendrait le test vert pour une raison fausse.
    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(/Première annuité d’amortissement à reprendre/)).toHaveLength(0)
  })

  it('se tait quand le dossier ne porte aucune immobilisation', async () => {
    poser()
    monter()

    await screen.findByRole('button', { name: /Remplir le formulaire officiel/ })
    expect(screen.queryAllByText(/Première annuité d’amortissement à reprendre/)).toHaveLength(0)
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
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modeComptable="engagement" />
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
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modeComptable="engagement" />
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
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: 'cat-recettes', prelevement_personnel: false,
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

  it('propose l’exercice d’un encaissement quand toutes les années sont affichées', async () => {
    poser()
    faux.parTable.categories = [CATEGORIE, RECETTES]
    faux.parTable.lignes_bancaires = [mouvement({ date: '2026-02-10' })]
    render(
      <AnneeProvider defaut="toutes">
        <ClotureTab dossierId="dossier-de-test" assujettiTva={true} modeComptable="tresorerie" />
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
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, prelevement_personnel: false,
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
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, prelevement_personnel: false,
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
