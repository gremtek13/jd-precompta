import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinancementTab from './FinancementTab'
import type { Categorie, Immobilisation, Piece } from '../../lib/types'
import { ajouterMois, premierJourDuMoisCourant } from '../../lib/format'

// LE CALCUL EST DANS `lib/situationIntermediaire.ts`, TESTÉ — CE QUI SE JOUE ICI EST LA PÉRIODE.
//
// Cet état porte en tête « Période du 1er janvier au <date choisie> » et part dans un dossier
// bancaire. La ligne « Amortissements » y comptait une ANNÉE ENTIÈRE de dotation quelle que soit
// cette date : au 31 janvier, un bien de 12 000 € sur 5 ans suffisait à afficher un résultat
// négatif sur des recettes bien positives.
//
// Aucun test de `src/lib` ne garde ce que la MODALE passe comme période : le même écran appelle la
// même fonction sur une année civile complète pour préremplir le prévisionnel, donc les deux usages
// coexistent et rien n'empêche l'un de prendre les bornes de l'autre.
const faux = vi.hoisted(() => ({
  pieces: [] as unknown[],
  categories: [] as unknown[],
  immobilisations: [] as unknown[],
  ecritures: [] as unknown[],
  // Les tables dont la lecture ÉCHOUE. Un faux client qui ne sait pas refuser ne peut rien dire de
  // la famille « le vide est une affirmation » : il rend le même objet dans les deux cas.
  refusees: new Set<string>(),
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total.
  muet: {} as Record<string, number>,
}))

vi.mock('../../lib/supabase', () => {
  function chaine(table: string) {
    const c: Record<string, unknown> = {}
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    Object.assign(c, {
      select: () => c, eq: () => c, or: () => c, order: () => c,
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => Promise.resolve(faux.refusees.has(table)
        ? { data: null, error: { message: 'JWT expired' } }
        : { data: null, error: null }),
      then: (suite: (r: unknown) => unknown) => {
        const donnees = table === 'pieces' ? faux.pieces
          : table === 'categories' ? faux.categories
          : table === 'immobilisations' ? faux.immobilisations
          : table === 'ecritures_brouillon' ? faux.ecritures : []
        const muet = faux.muet[table]
        if (muet != null) {
          return Promise.resolve({ data: donnees.slice(debut, Math.min(fin + 1, muet)), error: null, count: donnees.length }).then(suite)
        }
        return Promise.resolve({ data: donnees, error: null, count: donnees.length }).then(suite)
      },
    })
    return c
  }
  return { supabase: { from: (table: string) => chaine(table) } }
})

// Typé sans `as` : le compilateur vérifie chaque champ contre la table (voir CLAUDE.md, quatre
// écrans où cette contrainte a mordu avant qu'un test n'ait tourné).
function recette(o: Partial<Piece> = {}): Piece {
  return {
    id: 'v1', dossier_id: 'd', uploaded_by: null, source: 'upload',
    storage_path: 'd/f.pdf', nom_fichier: 'f.pdf', storage_hash: null,
    date_piece: '2026-05-10', tiers: 'CPAM', montant_ht: 10000, montant_tva: null,
    montant_ttc: 10000, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: 'cat-recettes', sous_dossier_id: null,
    type_piece: 'vente', statut: 'validee', notes: null, confiance: null,
    superpdp_invoice_id: null, created_at: '2026-05-10T09:00:00Z', updated_at: '2026-05-10T09:00:00Z',
    ...o,
  }
}

const CATEGORIE: Categorie = {
  id: 'cat-recettes', dossier_id: null, code: '706', libelle: 'Recettes', ordre: 1,
  compte_comptable: '706000', poste_2035: 'Recettes',
}

function immobilisation(o: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: 'i1', dossier_id: 'd', piece_id: null, nature_id: null, libelle: 'Matériel',
    valeur: 12000, duree_annees: 5, date_acquisition: '2026-01-05', ...o,
  } as Immobilisation
}

async function ouvrirLaSituation(au: string) {
  render(<FinancementTab dossierId="d" />)
  const titre = await screen.findByRole('heading', { name: 'Situation intermédiaire', level: 3 })
  await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
  // La date par défaut est « aujourd'hui » : on la fixe, sinon le test dirait autre chose chaque mois.
  await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: au } }) })
  return screen.getByRole('heading', { name: 'Situation intermédiaire', level: 2 }).closest('.card') as HTMLElement
}

// Le montant lu sur la LIGNE du poste, pas n'importe où dans la modale : les tuiles « Charges » et
// « Résultat » portent les mêmes chiffres, donc une recherche globale trouve plusieurs éléments et
// ne dit pas lequel elle a vu.
function totalDuPoste(modale: HTMLElement, poste: string): string | null {
  const cellule = within(modale).queryAllByRole('cell', { name: poste })[0]
  return cellule ? (cellule.nextElementSibling?.textContent ?? null) : null
}

// Combien de fois une phrase apparaît dans le TEXTE rendu — et non dans combien d'éléments. La
// différence décide : deux mises en garde recollées dans un même paragraphe restent un seul nœud.
function occurrences(racine: HTMLElement, phrase: string): number {
  return (racine.textContent ?? '').split(phrase).length - 1
}

afterEach(() => {
  vi.useRealTimers()
  // Le faux client est partagé par tout le fichier : une table laissée en refus contaminerait les
  // tests suivants, et le symptôme (un écran qui ne charge pas) ne ressemble à aucun des défauts
  // gardés ici.
  faux.refusees = new Set()
  faux.muet = {}
})

describe('FinancementTab — situation intermédiaire', () => {
  it('rapporte la dotation à la période de l’état, pas à l’année', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation()]

    const modale = await ouvrirLaSituation('2026-06-30')

    // 12 000 € / 5 ans = 2 400 € par an, donc 1 200 € sur un premier semestre — et non 2 400.
    expect(totalDuPoste(modale, 'Amortissements')).toMatch(/^-1\s?200,00\s€$/)
    // Résultat 10 000 − 1 200, et non 10 000 − 2 400.
    expect(within(modale).getByText(/^8\s?800,00\s€$/)).toBeTruthy()
  })

  it('part du 1er janvier de l’exercice, pas plus tôt', async () => {
    // L'autre borne de la période. Trouvé par mutation : faire démarrer l'état un an plus tôt
    // laissait les cas ci-dessus entièrement verts, faute d'une pièce de l'année précédente dans le
    // jeu d'essai. Une période qui déborde sur l'exercice d'avant gonfle les recettes d'un état
    // qu'une banque lit comme « depuis le 1er janvier ».
    faux.pieces = [recette(), recette({ id: 'v-2025', date_piece: '2025-11-10', montant_ttc: 4000, montant_ht: 4000 })]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []

    const modale = await ouvrirLaSituation('2026-06-30')

    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^10\s?000,00\s€$/)
  })

  it('n’amortit pas un bien acquis après la date de l’état', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation({ date_acquisition: '2026-12-15' })]

    const modale = await ouvrirLaSituation('2026-06-30')

    expect(totalDuPoste(modale, 'Amortissements')).toBeNull()
    expect(within(modale).getAllByText(/^10\s?000,00\s€$/).length).toBeGreaterThan(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la dotation est plus petite » serait satisfait par un écran qui
  // n'affiche jamais d'amortissement du tout.
  it('affiche bien la dotation entière sur une année civile complète', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = [immobilisation()]

    const modale = await ouvrirLaSituation('2026-12-31')

    expect(totalDuPoste(modale, 'Amortissements')).toMatch(/^-2\s?400,00\s€$/)
  })

  // LE DIVISEUR QUI ANNUALISE LA CAF, et l'étiquette qui l'annonce.
  //
  // L'écran lisait `new Date().getMonth() + 1` — le NUMÉRO du mois courant — et l'écrivait tel quel
  // sous les ratios : « sur 9 mois écoulés cette année » un 1er septembre, quand huit le sont. Le
  // nombre n'est exact que le DERNIER jour de chaque mois, et il DIVISE la CAF : au 1er février, la
  // valeur annoncée valait la moitié de la juste, sur un chiffre montré à une banque.
  //
  // Le temps est FIXÉ ici : lu sur l'horloge, ce test dirait autre chose chaque jour — et serait
  // juste par hasard le 30 du mois, c'est-à-dire précisément le jour où l'ancien calcul l'était.
  it('annonce les mois réellement écoulés, pas le numéro du mois', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026, midi (heure locale)
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []

    render(<FinancementTab dossierId="d" />)

    // Le libellé est coupé en plusieurs nœuds par le `<strong>` du montant : on lit le texte du
    // paragraphe entier plutôt qu'un nœud, sinon le test échoue pour une raison qui n'est pas la
    // sienne.
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })

    // Le libellé est coupé en plusieurs nœuds par le `<strong>` du montant : on lit le texte du
    // paragraphe entier plutôt qu'un nœud, sinon le test échoue pour une raison qui n'est pas la
    // sienne.
    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/sur 8,0 mois écoulés cette année/)
    expect(ligne).not.toMatch(/sur 9,0/)
  })
})


// CE QU'AUCUN TEST DE `src/lib` NE PEUT VOIR : le plan de trésorerie lit `ecritures_brouillon`, pas
// les relevés importés. Mesuré le 22/09/2026 — les quatre dossiers de la base portent 0 écriture
// bancaire pour 954 lignes de relevé importées, donc TOUT dossier ouvrant cet écran aujourd'hui lit
// une projection plate à zéro. Le module a raison de rendre 0 ; ce qui manquait est que l'écran
// distingue ce zéro-là d'un zéro observé.
describe('FinancementTab — ce sur quoi la projection repose', () => {
  function ecritureBanque(mois: string, montant: number) {
    return { date: `${mois}-15`, sens: 'debit', montant }
  }
  // Les six mois complets qui précèdent le mois en cours — ceux que la moyenne regarde.
  function sixMoisServis() {
    return [1, 2, 3, 4, 5, 6].map((d) => ecritureBanque(ajouterMois(premierJourDuMoisCourant(), -d).slice(0, 7), 600))
  }

  async function ouvrir(carte: string) {
    render(<FinancementTab dossierId="d" />)
    const titre = await screen.findByRole('heading', { name: carte, level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    return screen.getByRole('heading', { name: carte, level: 2 }).closest('.card') as HTMLElement
  }

  it('dit que la moyenne ne repose sur rien quand aucune écriture bancaire n’a été lue', async () => {
    faux.ecritures = []
    const modale = await ouvrir('Plan de trésorerie')
    // La cause est actionnable, et c'est le piège du dossier réel : le relevé est importé, mais les
    // écritures ne sont pas générées — l'écran lit les secondes.
    expect(within(modale).getByText(/rien de comptabilisé/)).toBeTruthy()
    // ET DITE UNE SEULE FOIS. Un historique vide implique une fenêtre vide, donc les deux réserves se
    // déclenchent ensemble et pour la même cause : les afficher toutes deux répéterait la même phrase
    // en rouge sous elle-même, et une mise en garde qu'on répète cesse d'être lue.
    //
    // ON COMPTE LES OCCURRENCES DANS LE TEXTE, PAS LES ÉLÉMENTS : `queryAllByText` compte des NŒUDS,
    // donc concaténer les deux réserves dans un seul paragraphe lui rendait encore « 1 ». La mutation
    // qui les recolle a survécu à cette assertion-là — c'est elle qui a exigé cette forme.
    expect(occurrences(modale, 'écritures générées')).toBe(1)
  })

  it('se tait quand les six mois demandés sont servis', async () => {
    // GARDE SYMÉTRIQUE : sans lui, « l'écran prévient » serait satisfait par un écran qui prévient
    // TOUJOURS, et la mise en garde cesserait d'être lue.
    faux.ecritures = sixMoisServis()
    const modale = await ouvrir('Plan de trésorerie')
    expect(within(modale).queryAllByText(/ne repose sur rien/)).toHaveLength(0)
    expect(within(modale).queryAllByText(/de ces 6 mois/)).toHaveLength(0)
  })

  it('annonce une assiette plus courte que l’étiquette quand l’historique est partiel', async () => {
    faux.ecritures = sixMoisServis().slice(0, 2)
    const modale = await ouvrir('Plan de trésorerie')
    expect(within(modale).getByText(/2 de ces 6 mois/)).toBeTruthy()
    expect(within(modale).getByText(/sous-estimée/)).toBeTruthy()
  })

  it('dit que la trésorerie de la situation intermédiaire n’est pas « zéro à la banque »', async () => {
    // TROISIÈME consommateur de la même source, et celui qu'il aurait été le plus facile d'oublier :
    // « Trésorerie à cette date : 0,00 € » est arithmétiquement juste, donc muet.
    faux.ecritures = []
    const modale = await ouvrir('Situation intermédiaire')
    expect(within(modale).getByText(/rien de comptabilisé/)).toBeTruthy()
  })

  it('se tait sur la trésorerie dès qu’une écriture bancaire existe', async () => {
    faux.ecritures = sixMoisServis()
    const modale = await ouvrir('Situation intermédiaire')
    expect(within(modale).queryAllByText(/rien de comptabilisé/)).toHaveLength(0)
  })

  it('dit POURQUOI le taux d’endettement est à « — »', async () => {
    // Ce ratio est le premier qu'une banque regarde, et son « — » ne distinguait pas « pas encore
    // d'historique » de « le rythme est nul ».
    faux.ecritures = []
    const modale = await ouvrir('Dettes & ratios bancaires')
    expect(within(modale).getByText(/ne repose sur rien/)).toBeTruthy()
  })

  it('laisse le taux d’endettement sans réserve quand la moyenne est servie', async () => {
    faux.ecritures = sixMoisServis()
    const modale = await ouvrir('Dettes & ratios bancaires')
    expect(within(modale).queryAllByText(/ne repose sur rien/)).toHaveLength(0)
  })
})

// UNE LECTURE REFUSÉE N'EST PAS « AUCUN PRÉVISIONNEL » (22/09/2026).
//
// QUATRIÈME COPIE DE « LECTURE → FORMULAIRE → UPSERT DE TOUS LES CHAMPS », et elle est arrivée par
// la porte que le scanner ne regardait pas : `lecturesVerifiees.test.ts` part de `await supabase`,
// or une entrée de `Promise.all` s'écrit sans `await`. Les trois premières copies
// (InformationsTab, ClientInformations, CabinetBrandingPage) ont été corrigées le 21/09/2026 par ce
// scanner même ; celle-ci a survécu un jour de plus, à six lignes d'une lecture qu'il voyait.
//
// Ce que ça coûtait : `previsionnel` nul est EXACTEMENT l'écran d'un dossier qui n'a jamais rien
// enregistré — bouton « Générer », pas de ligne « Dernière hypothèse enregistrée ». Le premier
// enregistrement écrase alors les deux taux ET `note_hypotheses`, du texte libre que personne ne
// relit, donc que personne ne verrait partir. Sur le document qu'un cabinet montre à une banque.
//
// Le module `lib/previsionnel.ts` est juste et le reste : ce qui se joue ici est le CÂBLAGE, qu'aucun
// test de `src/lib` ne peut voir.
describe('FinancementTab — le prévisionnel ne s’enregistre pas sur une lecture refusée', () => {
  // ON ATTEND QUE LE CHARGEMENT AIT ATTERRI, PAS QU'UN TITRE SOIT LÀ.
  //
  // Les titres de cet écran sont rendus dès le PREMIER rendu, avant que `load()` n'ait résolu son
  // `Promise.all` : s'y ancrer rend un test qui passe ou échoue selon l'ordonnancement des
  // microtâches — le mien a échoué une fois sur trois exécutions de `test:fuseaux`, ce qui est la
  // pire forme (assez rare pour passer pour du bruit de CI). La tuile « Trésorerie actuelle » affiche
  // « — » tant que `loading` est vrai : c'est le seul signal de fin de chargement que l'écran donne.
  async function attendreChargement() {
    const tuile = screen.getByText('Trésorerie actuelle (banque)').parentElement as HTMLElement
    await waitFor(() => expect(tuile.querySelector('strong')?.textContent).not.toBe('—'))
  }

  function carteDuPrevisionnel() {
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    return { titre, entete: titre.parentElement as HTMLElement }
  }

  it('dit qu’on n’a pas lu, et ferme le formulaire', async () => {
    faux.refusees = new Set(['previsionnels_bancaires'])
    render(<FinancementTab dossierId="d" />)
    await attendreChargement()

    const { entete } = carteDuPrevisionnel()
    expect(screen.getByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/ce n'est pas « aucun prévisionnel »/i)).toBeTruthy()
    expect(within(entete).getByRole('button').hasAttribute('disabled')).toBe(true)
  })

  // LE GARDE SYMÉTRIQUE : sans lui, « le bouton est fermé » serait satisfait par un bouton toujours
  // fermé — et aucun des tests de situation intermédiaire ci-dessus ne le remarquerait, ils passent
  // par le bouton de l'AUTRE carte.
  it('mais laisse générer quand la lecture a réussi', async () => {
    faux.refusees = new Set()
    render(<FinancementTab dossierId="d" />)
    await attendreChargement()

    const { entete } = carteDuPrevisionnel()
    expect(within(entete).getByRole('button').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/JWT expired/)).toBeNull()
  })
})

// LE PRÉREMPLISSAGE N'ÉCRIT RIEN LUI-MÊME — mais ce qu'il pose part tel quel au premier « Enregistrer »,
// sur le document qu'on montre à une banque, et la fenêtre recouvre le bandeau qui dirait que la
// lecture est incomplète. Sur une lecture partielle, il se suspend.
describe('FinancementTab — préremplir le prévisionnel', () => {
  const ANNEE_REFERENCE = new Date().getFullYear() - 1

  async function ouvrirLePrevisionnel() {
    render(<FinancementTab dossierId="d" />)
    const tuile = screen.getByText('Trésorerie actuelle (banque)').parentElement as HTMLElement
    await waitFor(() => expect(tuile.querySelector('strong')?.textContent).not.toBe('—'))
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    await act(async () => { within(titre.parentElement as HTMLElement).getByRole('button').click() })
    return screen.getByRole('button', { name: 'Précharger depuis cette année' })
  }

  function poser() {
    faux.pieces = [
      recette({ id: 'v1', date_piece: `${ANNEE_REFERENCE}-03-10` }),
      recette({ id: 'v2', date_piece: `${ANNEE_REFERENCE}-09-10`, montant_ht: 5000, montant_ttc: 5000 }),
    ]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.ecritures = []
  }

  it('se suspend sur des pièces lues à moitié', async () => {
    poser()
    faux.muet = { pieces: 1 }
    const bouton = await ouvrirLePrevisionnel()

    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Préremplissage suspendu/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('0')
  })

  it('préremplit, sur une lecture complète, les recettes de l’année entière', async () => {
    // Le garde symétrique : sans lui, « se suspend » serait satisfait par un bouton toujours fermé.
    poser()
    const bouton = await ouvrirLePrevisionnel()

    expect(screen.queryByText(/Préremplissage suspendu/)).toBeNull()
    await act(async () => { bouton.click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('15000')
  })
})
