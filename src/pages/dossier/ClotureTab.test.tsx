import { act, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import ClotureTab from './ClotureTab'
import type { Immobilisation } from '../../lib/types'

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
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: (faux.parTable[table] ?? [])[0] ?? null, error: null }),
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
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
}))

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
  faux.parTable = {
    categories: [CATEGORIE],
    pieces: [PIECE],
    immobilisations: immos,
    cotisations_declarees: cotis,
    vehicules: [],
    dossiers: [{ nom: 'Dossier de test', libelle_naf: 'Infirmier', siret: '12345678901234' }],
  }
}

function monter(annee = 2025) {
  return render(
    <AnneeProvider defaut={annee}>
      <ClotureTab dossierId="dossier-de-test" />
    </AnneeProvider>,
  )
}

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
