import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FinancementTab from './FinancementTab'
import type { Categorie, CotisationDeclaree, Immobilisation, LigneBancaire, Piece } from '../../lib/types'
import type { Emprunt } from '../../lib/emprunts'
import type { Predicat } from '../../test/filtresPostgrest'
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
  aNouveaux: [] as unknown[],
  // Les mouvements rapprochés, qui datent les pièces (lib/rattachement.ts).
  paiements: [] as unknown[],
  // Les parts des mouvements ventilés sur plusieurs comptes (lib/ventilationBanque.ts).
  ventilations: [] as unknown[],
  // Les parts des virements qui règlent plusieurs pièces (lib/reglementGroupe.ts).
  reglements: [] as unknown[],
  // Les échéances de cotisation, que le relevé paie ou non (lib/cotisationRapprochee.ts).
  cotisations: [] as unknown[],
  // Les tables dont la lecture ÉCHOUE. Un faux client qui ne sait pas refuser ne peut rien dire de
  // la famille « le vide est une affirmation » : il rend le même objet dans les deux cas.
  refusees: new Set<string>(),
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total.
  muet: {} as Record<string, number>,
  // Les emprunts, et ce que l'écran en supprime ou en modifie — refusé à la demande.
  emprunts: [] as Emprunt[],
  suppressions: [] as { table: string }[],
  misesAJour: [] as { table: string; valeur: Record<string, unknown> }[],
  erreurSuppression: null as { message: string; code: string } | null,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    const c: Record<string, unknown> = {}
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    // `.not` et `.or` sont APPLIQUÉS (voir src/test/filtresPostgrest.ts) : acceptés sans effet, ils
    // laissaient ce test vert avec la lecture des mouvements rapprochés restreinte à ceux qui portent
    // une pièce — la situation, les ratios et le prévisionnel perdaient alors les recettes affectées.
    const predicats: Predicat[] = []
    let operation = 'select'
    Object.assign(c, {
      select: () => c, eq: () => c, order: () => c,
      delete: () => { operation = 'delete'; faux.suppressions.push({ table }); return c },
      update: (valeur: Record<string, unknown>) => { operation = 'update'; faux.misesAJour.push({ table, valeur }); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => Promise.resolve(faux.refusees.has(table)
        ? { data: null, error: { message: 'JWT expired' } }
        : { data: null, error: null }),
      then: (suite: (r: unknown) => unknown) => {
        if (operation === 'delete') {
          return Promise.resolve({ data: null, error: faux.erreurSuppression }).then(suite)
        }
        if (operation === 'update') return Promise.resolve({ data: null, error: null }).then(suite)
        const donnees = filtrer(table === 'pieces' ? faux.pieces
          : table === 'emprunts' ? faux.emprunts
          : table === 'categories' ? faux.categories
          : table === 'immobilisations' ? faux.immobilisations
          : table === 'ecritures_brouillon' ? faux.ecritures
          : table === 'a_nouveaux' ? faux.aNouveaux
          : table === 'lignes_bancaires' ? faux.paiements
          : table === 'ventilations_bancaires' ? faux.ventilations
          : table === 'reglements_groupes' ? faux.reglements
          : table === 'cotisations_declarees' ? faux.cotisations : [], predicats)
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

// Typé sans `as` : le compilateur confronte le jeu d'essai à la table. Le bien est en service depuis janvier
// 2025, donc amorti toute l'année 2026 — la dotation de l'exercice d'acquisition se compte prorata temporis
// depuis la mise en service (lib/amortissements.ts), et ce n'est pas ce que ces tests regardent.
function immobilisation(o: Partial<Immobilisation> = {}): Immobilisation {
  return {
    id: 'i1', dossier_id: 'd', piece_id: 'p1', nature_id: null, libelle: 'Matériel',
    valeur: 12000, duree_annees: 5, date_acquisition: '2025-01-05', date_mise_en_service: null,
    created_at: '2025-01-05T09:00:00Z', ...o,
  }
}

async function ouvrirLaSituation(au: string, assujettiTva = true, modeComptable: 'tresorerie' | 'engagement' = 'tresorerie') {
  render(<FinancementTab dossierId="d" assujettiTva={assujettiTva} modeComptable={modeComptable} />)
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
  faux.aNouveaux = []
  faux.paiements = []
  faux.ventilations = []
  faux.reglements = []
  faux.cotisations = []
  faux.emprunts = []
  faux.suppressions = []
  faux.misesAJour = []
  faux.erreurSuppression = null
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

    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)

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

  it('compte en engagement la recette facturée, encaissée ou non', async () => {
    // La même recette qu'au test suivant, facturée en mai et encaissée en septembre : au 1er septembre,
    // un dossier en engagement la compte déjà — 10 000 € ramenés à douze mois sur 241 jours en
    // 30/360, soit 14 937,76 €.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [{
      id: 'l1', dossier_id: 'd', date: '2026-09-15', libelle: 'VIR CPAM', montant: 10000, statut: 'rapprochee',
      piece_id: 'v1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: '2026-09-15T09:00:00Z',
    }]

    render(<FinancementTab dossierId="d" assujettiTva modeComptable="engagement" />)
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })

    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/14\s?937,76\s€/)
  })

  it('ne compte dans la CAF qu’une recette déjà encaissée', async () => {
    // Facturée en mai, encaissée le 15 septembre : au 1er septembre, rien n'est entré. Sans les
    // paiements, la CAF annualisée annonçait 15 000 € (10 000 × 12 / 8).
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [{
      id: 'l1', dossier_id: 'd', date: '2026-09-15', libelle: 'VIR CPAM', montant: 10000, statut: 'rapprochee',
      piece_id: 'v1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: '2026-09-15T09:00:00Z',
    }]

    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })

    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    // Sans recette encaissée, aucune CAF ne se dégage encore : l'écran dit « — », et c'est le
    // chiffre d'avant, 15 000 €, qui serait le défaut.
    expect(ligne).not.toMatch(/15\s?000,00/)
    expect(ligne).toMatch(/ramenée à 12\) : —$/)
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
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
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
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
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
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    await attendreChargement()

    const { entete } = carteDuPrevisionnel()
    expect(within(entete).getByRole('button').hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/JWT expired/)).toBeNull()
  })
})

// LA PÉRIODE D'UNE PIÈCE EST CELLE DE SON PAIEMENT (lib/rattachement.ts), comme dans la 2035 dont cet
// état est la version « à ce jour ». Le calcul est testé à part ; ici c'est le CÂBLAGE — que l'écran
// lise les paiements et les passe aux trois usages de la situation.
describe('FinancementTab — une recette compte à son encaissement', () => {
  const ENCAISSEE_EN_JUILLET = {
    id: 'l1', dossier_id: 'd', date: '2026-07-02', libelle: 'VIR CPAM', montant: 10000, statut: 'rapprochee',
    piece_id: 'v1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
    created_at: '2026-07-03T09:00:00Z',
  }

  it('ne porte pas au 30 juin une recette facturée en mai et encaissée en juillet', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [ENCAISSEE_EN_JUILLET]

    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Recettes')).toBeNull()
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-07-31' } }) })
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^10\s?000,00\s€$/)
  })

  it('la porte à sa date de facture quand aucun encaissement n’est rapproché', async () => {
    // Le garde symétrique : sans lui, « suit l'encaissement » serait satisfait par un écran qui
    // écarte toute recette non rapprochée.
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []

    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^10\s?000,00\s€$/)
  })

  // EN ENGAGEMENT (lib/engagement.ts), la recette compte à la date de sa FACTURE : l'écran doit passer
  // le modèle du dossier à la situation, sans quoi une société à l'IS aurait un état daté à l'encaissement.
  it('en engagement, porte au 30 juin la recette facturée en mai, encaissée ou non', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [ENCAISSEE_EN_JUILLET]

    const auJuin = await ouvrirLaSituation('2026-06-30', true, 'engagement')
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^10\s?000,00\s€$/)
  })

  it('dit la lecture partielle quand les PAIEMENTS sont lus en partie', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [ENCAISSEE_EN_JUILLET]
    faux.muet = { lignes_bancaires: 0 }
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)

    expect(await screen.findByText(/n'ont pas pu être lu/)).toBeTruthy()
  })
})

// UN VIREMENT QUI RÈGLE PLUSIEURS RECETTES (ligne 26) : chacune compte à la date du virement, comme un
// encaissement rapproché seul. Le virement ne porte aucune pièce — elles sont dans ses parts, que l'écran doit
// lire : sans elles, les deux recettes retomberaient sur leur date de facture, avant l'état arrêté au 30 juin.
describe('FinancementTab — des recettes encaissées par un virement groupé', () => {
  const VIREMENT_DE_JUILLET = {
    id: 'g', dossier_id: 'd', date: '2026-07-02', libelle: 'VIR CPAM', montant: 15000, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, reglement_groupe: true, prelevement_personnel: false, source_fichier: null,
    libelle_brut: null, created_at: '2026-07-03T09:00:00Z',
  }
  const PARTS = [
    { id: 'g1', dossier_id: 'd', ligne_bancaire_id: 'g', piece_id: 'v1', montant: 10000, created_at: '2026-07-03T09:00:00Z' },
    { id: 'g2', dossier_id: 'd', ligne_bancaire_id: 'g', piece_id: 'v2', montant: 5000, created_at: '2026-07-03T09:00:00Z' },
  ]

  it('ne les porte pas au 30 juin, et les porte au 31 juillet', async () => {
    faux.pieces = [recette(), recette({ id: 'v2', montant_ht: 5000, montant_ttc: 5000 })]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [VIREMENT_DE_JUILLET]
    faux.reglements = PARTS

    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Recettes')).toBeNull()
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: '2026-07-31' } }) })
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^15\s?000,00\s€$/)
  })

  it('dit la lecture partielle quand les parts sont lues en partie', async () => {
    faux.pieces = [recette()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [VIREMENT_DE_JUILLET]
    faux.reglements = PARTS
    faux.muet = { reglements_groupes: 1 }
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)

    expect(await screen.findByText(/n'ont pas pu être lu/)).toBeTruthy()
  })
})

// LE PRÉREMPLISSAGE N'ÉCRIT RIEN LUI-MÊME — mais ce qu'il pose part tel quel au premier « Enregistrer »,
// sur le document qu'on montre à une banque, et la fenêtre recouvre le bandeau qui dirait que la
// lecture est incomplète. Sur une lecture partielle, il se suspend.
describe('FinancementTab — préremplir le prévisionnel', () => {
  const ANNEE_REFERENCE = new Date().getFullYear() - 1

  async function ouvrirLePrevisionnel(modeComptable: 'tresorerie' | 'engagement' = 'tresorerie') {
    render(<FinancementTab dossierId="d" assujettiTva modeComptable={modeComptable} />)
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

  it('préremplit sans la recette encaissée l’année suivante', async () => {
    // La même règle que la 2035 : la recette de septembre encaissée en janvier suivant n'appartient
    // pas au chiffre d'affaires de l'année de référence.
    poser()
    faux.paiements = [{
      id: 'l2', dossier_id: 'd', date: `${ANNEE_REFERENCE + 1}-01-05`, libelle: 'VIR', montant: 5000, statut: 'rapprochee',
      piece_id: 'v2', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: `${ANNEE_REFERENCE + 1}-01-05T09:00:00Z`,
    }]
    const bouton = await ouvrirLePrevisionnel()
    await act(async () => { bouton.click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('10000')
  })

  it('préremplit en engagement les recettes facturées dans l’année, encaissées ou non', async () => {
    poser()
    faux.paiements = [{
      id: 'l2', dossier_id: 'd', date: `${ANNEE_REFERENCE + 1}-01-05`, libelle: 'VIR', montant: 5000, statut: 'rapprochee',
      piece_id: 'v2', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: `${ANNEE_REFERENCE + 1}-01-05T09:00:00Z`,
    }]
    const bouton = await ouvrirLePrevisionnel('engagement')
    await act(async () => { bouton.click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('15000')
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

// L'OUVERTURE D'UN DOSSIER REPRIS (ligne 29, décision du cabinet du 26/09/2026). Le calcul est dans
// `lib/planTresorerie.ts` et `lib/aNouveaux.ts`, testés ; ce qui se joue ici est le CÂBLAGE — que les
// trois chiffres de trésorerie de l'écran partent du solde repris, et qu'une écriture antérieure à
// l'ouverture n'y soit pas comptée une seconde fois.
describe('FinancementTab — un dossier ouvert par des à-nouveaux', () => {
  const ouverture = [
    { id: 'an-1', dossier_id: 'd', date: '2026-01-01', compte: '512000', compte_origine: '51210000', libelle: 'Banque Populaire', sens: 'debit', montant: 4000, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64), created_at: '2026-09-26T10:00:00Z' },
    { id: 'an-2', dossier_id: 'd', date: '2026-01-01', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit', montant: 4000, source_nom: 'balance-2025.csv', source_empreinte: 'a'.repeat(64), created_at: '2026-09-26T10:00:00Z' },
  ]
  // Décembre est déjà dans les 4 000 € repris : l'ajouter le compterait deux fois.
  const mouvements = [
    { date: '2025-12-15', sens: 'debit', montant: 700 },
    { date: '2026-02-10', sens: 'debit', montant: 1000 },
    { date: '2026-03-05', sens: 'credit', montant: 250 },
  ]

  function montantDe(carte: HTMLElement): string {
    return carte.querySelector('strong')?.textContent ?? ''
  }

  it('part du solde repris pour la trésorerie actuelle, sans l’écriture antérieure', async () => {
    faux.aNouveaux = ouverture
    faux.ecritures = mouvements
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    const tuile = (await screen.findByText('Trésorerie actuelle (banque)')).closest('.card') as HTMLElement
    await waitFor(() => expect(montantDe(tuile)).toMatch(/^4\s?750,00\s€$/))
    expect(within(tuile).getByText('Depuis l’ouverture du 01/01/2026 (à-nouveaux).')).toBeTruthy()
  })

  // GARDE SYMÉTRIQUE : sans elle, « l'écran part du solde repris » serait satisfait par un écran qui
  // ajoute toujours quelque chose, ou qui annonce une ouverture qui n'existe pas.
  it('cumule tout l’historique quand rien n’ouvre le dossier, et ne parle pas d’ouverture', async () => {
    faux.ecritures = mouvements
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    const tuile = (await screen.findByText('Trésorerie actuelle (banque)')).closest('.card') as HTMLElement
    await waitFor(() => expect(montantDe(tuile)).toMatch(/^1\s?450,00\s€$/))
    expect(within(tuile).queryAllByText(/Depuis l’ouverture/)).toHaveLength(0)
  })

  async function situationAu(date: string) {
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: 'Situation intermédiaire', level: 3 })
    // Attendre la fin du chargement : la modale reçoit l'ouverture à l'ouverture, pas après.
    await waitFor(() => expect(screen.queryAllByText('—')).toHaveLength(0))
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    await act(async () => { fireEvent.change(screen.getByLabelText('À la date du'), { target: { value: date } }) })
    const modale = screen.getByRole('heading', { name: 'Situation intermédiaire', level: 2 }).closest('.card') as HTMLElement
    const carte = within(modale).getByText('Trésorerie à cette date').closest('.card') as HTMLElement
    return { modale, tresorerie: montantDe(carte) }
  }

  it('part du solde repris pour la trésorerie à une date de la situation intermédiaire', async () => {
    faux.aNouveaux = ouverture
    faux.ecritures = mouvements
    const { modale, tresorerie } = await situationAu('2026-02-28')
    expect(tresorerie).toMatch(/^5\s?000,00\s€$/)
    expect(within(modale).queryAllByText(/rien de comptabilisé/)).toHaveLength(0)
  })

  it('tient le solde repris pour un vrai solde, même sans aucune écriture', async () => {
    // La banque soldée à la reprise est un zéro CONNU ; ici elle ne l'est pas, et le chiffre suffit.
    faux.aNouveaux = ouverture
    faux.ecritures = []
    const { modale, tresorerie } = await situationAu('2026-06-30')
    expect(tresorerie).toMatch(/^4\s?000,00\s€$/)
    expect(within(modale).queryAllByText(/rien de comptabilisé/)).toHaveLength(0)
  })

  it('dit qu’avant l’ouverture, aucun solde de départ n’est connu', async () => {
    faux.aNouveaux = ouverture
    faux.ecritures = mouvements
    const { modale, tresorerie } = await situationAu('2025-12-31')
    expect(tresorerie).toMatch(/^700,00\s€$/)
    expect(within(modale).getByText(/précède l'ouverture du dossier \(01\/01\/2026\)/)).toBeTruthy()
  })

  it('dit que la trésorerie part d’une ouverture incomplète quand elle est lue à moitié', async () => {
    faux.aNouveaux = ouverture
    faux.ecritures = mouvements
    faux.muet = { a_nouveaux: 1 }
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    expect(await screen.findByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)).toBeTruthy()
    // Le bandeau général se tait : ce n'est pas lui qui a manqué, et c'est lui qui suspend le
    // préremplissage du prévisionnel, qui ne lit pas l'ouverture.
    expect(screen.queryAllByText(/Les données du dossier bancaire/)).toHaveLength(0)
  })
})

// UN DOSSIER EXONÉRÉ COMPTE TVA COMPRISE (voir lib/montantRetenu.ts), sur les trois fenêtres qui
// appellent la situation intermédiaire — chacune par son propre appel, donc chacune gardée ici :
// l'état qu'on montre à une banque, la CAF qui fait la capacité de remboursement, et le
// préremplissage du prévisionnel.
describe('FinancementTab — un dossier exonéré compte TVA comprise', () => {
  const recetteAvecTva = (o: Partial<Piece> = {}) =>
    recette({ montant_ht: 10000, montant_tva: 2000, montant_ttc: 12000, ...o })

  it('la situation intermédiaire porte les recettes TTC', async () => {
    faux.pieces = [recetteAvecTva()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    const modale = await ouvrirLaSituation('2026-06-30', false)
    expect(totalDuPoste(modale, 'Recettes')).toMatch(/^12\s?000,00\s€$/)
  })

  it('la CAF des ratios bancaires part des recettes TTC', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026 : 8 mois écoulés
    faux.pieces = [recetteAvecTva()]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    // 12 000 € ramenés à douze mois sur 241 jours en 30/360 (8,03 mois) : 17 925,31 € — et non
    // 14 937,76 €, le même calcul sur le hors taxes.
    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/17\s?925,31\s€/)
  })

  it('le prévisionnel se préremplit des recettes TTC', async () => {
    const annee = new Date().getFullYear() - 1
    faux.pieces = [recetteAvecTva({ date_piece: `${annee}-03-10` })]
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.ecritures = []
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const tuile = screen.getByText('Trésorerie actuelle (banque)').parentElement as HTMLElement
    await waitFor(() => expect(tuile.querySelector('strong')?.textContent).not.toBe('—'))
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    await act(async () => { within(titre.parentElement as HTMLElement).getByRole('button').click() })
    await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('12000')
  })
})

// LIGNE 26.6 : un encaissement de l'Assurance maladie sans bordereau, affecté à une catégorie de
// recettes, entre dans l'état qu'on montre à une banque à la date du mouvement. Ce qui se joue ici
// est le CÂBLAGE : que l'écran lise les mouvements affectés — sa lecture ne prenait que ceux d'une
// pièce — et les passe à la situation intermédiaire.
describe('FinancementTab — les mouvements affectés sans justificatif', () => {
  const ENCAISSEMENT_AFFECTE = {
    id: 'l-cpam', dossier_id: 'd', date: '2026-05-12', libelle: 'VIR CPAM', montant: 4000, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'cat-recettes', taux_tva: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2026-05-13T09:00:00Z',
  }

  it('porte au 30 juin un encaissement affecté de mai', async () => {
    faux.pieces = []
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [ENCAISSEMENT_AFFECTE]
    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^4\s?000,00\s€$/)
  })

  it('sur un dossier assujetti, porte un encaissement taxé au hors taxe — et entier sur un dossier qui ne l’est plus', async () => {
    faux.pieces = []
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [{ ...ENCAISSEMENT_AFFECTE, montant: 4800, taux_tva: 20 }]
    const assujetti = await ouvrirLaSituation('2026-06-30', true)
    expect(totalDuPoste(assujetti, 'Recettes')).toMatch(/^4\s?000,00\s€$/)
    cleanup()
    const exonere = await ouvrirLaSituation('2026-06-30', false)
    expect(totalDuPoste(exonere, 'Recettes')).toMatch(/^4\s?800,00\s€$/)
  })

  it('ne le porte pas à un état arrêté avant lui', async () => {
    faux.pieces = []
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [ENCAISSEMENT_AFFECTE]
    const auAvril = await ouvrirLaSituation('2026-04-30')
    expect(totalDuPoste(auAvril, 'Recettes')).toBeNull()
  })

  // Les deux autres appels de la même situation, chacun avec son propre câblage : la CAF que les ratios
  // annualisent, et le chiffre d'affaires de référence que le prévisionnel reprend. Un seul oubli
  // suffisait à montrer à une banque un cabinet d'infirmier sans recettes.
  it('compte l’encaissement affecté dans la CAF des ratios bancaires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026 : 241 jours en 30/360
    faux.pieces = []
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.paiements = [{ ...ENCAISSEMENT_AFFECTE, montant: 10000 }]
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    // 10 000 € ramenés à douze mois : 14 937,76 €, comme la même recette portée par une pièce.
    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/14\s?937,76\s€/)
  })

  it('préremplit le prévisionnel des encaissements affectés de l’année de référence', async () => {
    const annee = new Date().getFullYear() - 1
    faux.pieces = []
    faux.categories = [CATEGORIE]
    faux.immobilisations = []
    faux.ecritures = []
    faux.paiements = [{ ...ENCAISSEMENT_AFFECTE, date: `${annee}-03-10`, montant: 12000 }]
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const tuile = screen.getByText('Trésorerie actuelle (banque)').parentElement as HTMLElement
    await waitFor(() => expect(tuile.querySelector('strong')?.textContent).not.toBe('—'))
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    await act(async () => { within(titre.parentElement as HTMLElement).getByRole('button').click() })
    await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('12000')
  })
})

// UNE ÉCHÉANCE D'EMPRUNT RAPPROCHÉE (lib/echeanceEmprunt.ts), VUE DEPUIS L'EMPRUNT. Ce que le module ne peut
// pas voir : que l'échéancier dise quand chaque échéance a été payée, qu'un emprunt rapproché ne se
// supprime pas sans qu'on sache pourquoi, que sa durée ne descende pas sous une échéance payée — et que
// le déblocage, compté dans le solde, n'entre pas dans la moyenne des encaissements qu'on montre à une
// banque.
describe('FinancementTab — les emprunts et le relevé', () => {
  const EMPRUNT: Emprunt = {
    id: 'emp-1', dossier_id: 'd', nom: 'Prêt matériel', organisme_preteur: 'Banque du Midi',
    capital_initial: 12000, taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
  }
  function mouvement(o: Partial<LigneBancaire>): LigneBancaire {
    return {
      id: 'l', dossier_id: 'd', date: '2025-03-06', libelle: 'PRLV ECHEANCE PRET', libelle_brut: null, montant: -540,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      source_fichier: null, emprunt_id: 'emp-1', emprunt_echeance: 2, emprunt_interets: 34.55, emprunt_assurance: 21.03,
      ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2025-03-06T09:00:00Z', ...o,
    }
  }
  const ECHEANCE_2 = mouvement({ id: 'l-ech-2' })
  const DEBLOCAGE = mouvement({
    id: 'l-deb', date: '2025-01-07', libelle: 'VIR DEBLOCAGE PRET', montant: 12000,
    emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0,
  })

  function preparer() {
    faux.pieces = []
    faux.categories = []
    faux.immobilisations = []
    faux.ecritures = []
    faux.emprunts = [EMPRUNT]
  }
  async function rendreEtAttendre() {
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    return screen.findByText('Prêt matériel')
  }
  const ligneDeLEmprunt = async () => (await rendreEtAttendre()).closest('tr') as HTMLElement

  it('l’échéancier dit quand chaque échéance rapprochée a été payée, et le déblocage', async () => {
    preparer()
    faux.paiements = [ECHEANCE_2, DEBLOCAGE]
    const ligne = await ligneDeLEmprunt()
    // Le taux s'écrit à la virgule, dans la liste comme dans l'échéancier : « 3.6 % » s'affichait.
    expect(within(ligne).getByText('3,6 %')).toBeTruthy()
    await act(async () => { within(ligne).getByRole('button', { name: 'Échéancier' }).click() })
    const modale = screen.getByRole('heading', { name: 'Échéancier — Prêt matériel' }).closest('.card') as HTMLElement
    expect(within(modale).getByText(/sur 24 mois à 3,6 %,/)).toBeTruthy()
    const lignes = within(modale).getAllByRole('row')
    // L'en-tête, puis l'échéance 1 (non payée) et la 2 (payée le 6 mars).
    expect(within(lignes[1]).getAllByRole('cell').at(-1)?.textContent).toBe('—')
    expect(within(lignes[2]).getAllByRole('cell').at(-1)?.textContent).toBe('06/03/2025')
    expect(within(modale).getByText(/Fonds reçus le 07\/01\/2025\./)).toBeTruthy()
    expect(within(modale).getByText(/1 échéance rapprochée d’un mouvement du relevé : la 2035 en compte le découpage validé/)).toBeTruthy()
  })

  it('l’échéancier dit qu’aucune échéance n’est rapprochée, et que la 2035 n’en compte rien', async () => {
    preparer()
    const ligne = await ligneDeLEmprunt()
    await act(async () => { within(ligne).getByRole('button', { name: 'Échéancier' }).click() })
    expect(screen.getByText(/Aucune échéance n’est encore rapprochée d’un mouvement du relevé \(Banque\) : leurs intérêts ne comptent pas dans la 2035/)).toBeTruthy()
  })

  it('refuse de supprimer un emprunt rapproché, et le dit AVANT de demander', async () => {
    preparer()
    faux.paiements = [ECHEANCE_2, DEBLOCAGE]
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const confirmation = vi.spyOn(window, 'confirm').mockImplementation(() => true)
    const ligne = await ligneDeLEmprunt()
    await act(async () => { within(ligne).getByRole('button', { name: 'Supprimer' }).click() })
    expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/« Prêt matériel » a 2 mouvements du relevé rapprochés.*annule d’abord ces rapprochements dans Banque/))
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.suppressions).toEqual([])
  })

  it('supprime un emprunt que rien ne rapproche, après confirmation', async () => {
    preparer()
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const ligne = await ligneDeLEmprunt()
    await act(async () => { within(ligne).getByRole('button', { name: 'Supprimer' }).click() })
    expect(faux.suppressions).toEqual([{ table: 'emprunts' }])
    expect(alerte).not.toHaveBeenCalled()
  })

  it('dit le refus de la base, au lieu de recharger en silence', async () => {
    preparer()
    faux.erreurSuppression = { message: 'violates foreign key constraint', code: '23503' }
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const ligne = await ligneDeLEmprunt()
    await act(async () => { within(ligne).getByRole('button', { name: 'Supprimer' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/n’a pas été supprimé : des mouvements du relevé y sont rapprochés/)))
  })

  it('refuse une durée plus courte qu’une échéance rapprochée, et dit que le découpage validé ne change pas', async () => {
    preparer()
    faux.paiements = [ECHEANCE_2]
    const ligne = await ligneDeLEmprunt()
    await act(async () => { within(ligne).getByRole('button', { name: 'Modifier' }).click() })
    expect(screen.getByText(/1 mouvement du relevé est rapproché de cet emprunt : son découpage validé ne change pas/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Durée (mois)'), { target: { value: '1' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(screen.getByText(/L’échéance n° 2 de cet emprunt est rapprochée d’un mouvement du relevé : la durée ne peut pas descendre en dessous de 2 mois/)).toBeTruthy()
    expect(faux.misesAJour).toEqual([])
    // La borne est incluse : deux mois, l'échéance 2 existe encore.
    fireEvent.change(screen.getByLabelText('Durée (mois)'), { target: { value: '2' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.misesAJour).toHaveLength(1)
  })

  // LE SOLDE COMPTE LE DÉBLOCAGE, LA MOYENNE NON : 12 000 € reçus dans la fenêtre y ajouteraient 2 000 €
  // d'« activité » par mois, projetés sur tout le plan et dans le taux d'endettement.
  function ecrituresDuPlan(avecDeblocage: boolean) {
    const mois = (d: number) => ajouterMois(premierJourDuMoisCourant(), -d).slice(0, 7)
    const rythme = [1, 2, 3, 4, 5, 6].map((d) => ({ date: `${mois(d)}-15`, sens: 'debit', montant: 600, ligne_bancaire_id: null }))
    return avecDeblocage
      ? [...rythme, { date: `${mois(2)}-20`, sens: 'debit', montant: 12000, ligne_bancaire_id: 'l-deb' }]
      : rythme
  }
  async function ouvrirLePlan(carte: string) {
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: carte, level: 3 })
    await waitFor(() => expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.querySelector('strong')?.textContent).not.toBe('—'))
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    return screen.getByRole('heading', { name: carte, level: 2 }).closest('.card') as HTMLElement
  }

  it('le plan de trésorerie écarte le déblocage de la moyenne, pas du solde', async () => {
    preparer()
    faux.ecritures = ecrituresDuPlan(true)
    faux.paiements = [DEBLOCAGE]
    const modale = await ouvrirLePlan('Plan de trésorerie')
    // Ancré sur « complets : » : « 2 600,00 € » CONTIENT « 600,00 € », et l'assertion laissait passer la
    // moyenne qui compte le déblocage — trouvé par mutation.
    expect(modale.textContent).toMatch(/complets : 600,00\s€ d'encaissements/)
    expect(within(modale).getByText(/Les fonds reçus d’un emprunt n’entrent pas dans cette moyenne/)).toBeTruthy()
    // Le solde, lui, les compte : 6 × 600 + 12 000.
    expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.textContent).toMatch(/15\s?600,00\s€/)
  })

  it('un encaissement qui n’est pas un déblocage reste dans la moyenne, et rien n’est dit', async () => {
    preparer()
    faux.ecritures = ecrituresDuPlan(true)
    faux.paiements = []
    const modale = await ouvrirLePlan('Plan de trésorerie')
    expect(modale.textContent).toMatch(/complets : 2\s?600,00\s€ d'encaissements/)
    expect(within(modale).queryByText(/fonds reçus d’un emprunt/i)).toBeNull()
    expect(within(modale).queryByText(/compte de bilan/)).toBeNull()
  })

  // UN MOUVEMENT ÉCRIT SUR UN COMPTE DE BILAN (ligne 26.7, lib/compteDeBilan.ts) : rapatriée de l'épargne, la somme
  // flatterait le taux d'endettement. Le solde la compte, la moyenne non — comme un déblocage, et dit à part.
  const RAPATRIEMENT = mouvement({
    id: 'l-deb', date: '2025-01-07', libelle: 'VIR DEPUIS LIVRET A', montant: 12000,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, compte_bilan: '580000',
  })

  it('le plan de trésorerie écarte un mouvement écrit sur un compte de bilan de la moyenne, pas du solde', async () => {
    preparer()
    faux.ecritures = ecrituresDuPlan(true)
    faux.paiements = [RAPATRIEMENT]
    const modale = await ouvrirLePlan('Plan de trésorerie')
    expect(modale.textContent).toMatch(/complets : 600,00\s€ d'encaissements/)
    expect(within(modale).getByText(/Ni un mouvement écrit sur un compte de bilan — un virement vers l’épargne ou depuis elle/)).toBeTruthy()
    // Pas un déblocage : la phrase des emprunts ne s'y ajoute pas.
    expect(within(modale).queryByText(/fonds reçus d’un emprunt/i)).toBeNull()
    expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.textContent).toMatch(/15\s?600,00\s€/)
  })

  it('le taux d’endettement ne compte pas un mouvement écrit sur un compte de bilan, et le dit', async () => {
    preparer()
    faux.ecritures = ecrituresDuPlan(true)
    faux.paiements = [RAPATRIEMENT]
    const modale = await ouvrirLePlan('Dettes & ratios bancaires')
    expect(within(modale).getByText(/Ni un mouvement écrit sur un compte de bilan — un virement depuis l’épargne/)).toBeTruthy()
    expect(modale.textContent).toMatch(/86,5\s%/)
  })

  // LA SITUATION INTERMÉDIAIRE COMPTE LES INTÉRÊTS ET L'ASSURANCE d'une échéance rapprochée, à sa date,
  // par les parts du relevé que l'écran lui passe — et jamais son capital. Trouvé par mutation : la
  // situation privée des échéances laissait tout ce fichier vert.
  it('la situation intermédiaire porte les intérêts et l’assurance d’une échéance rapprochée, pas son capital', async () => {
    preparer()
    faux.paiements = [ECHEANCE_2]
    const modale = await ouvrirLaSituation('2025-06-30', false)
    expect(totalDuPoste(modale, 'Frais financiers')).toMatch(/^-34,55\s€$/)
    expect(totalDuPoste(modale, "Primes d'assurance")).toMatch(/^-21,03\s€$/)
    expect(modale.textContent).not.toMatch(/484,42/)
  })

  // LE PAIEMENT D'UN BIEN IMMOBILISÉ, écrit au 512 depuis que l'acquisition s'écrit (ligne 26.6, étape b) :
  // le solde le compte, la moyenne des décaissements non — un investissement ne se répète pas chaque mois.
  function ecrituresAvecAcquisition() {
    const mois = (d: number) => ajouterMois(premierJourDuMoisCourant(), -d).slice(0, 7)
    const rythme = [1, 2, 3, 4, 5, 6].map((d) => ({ date: `${mois(d)}-15`, sens: 'credit', montant: 600, ligne_bancaire_id: null, piece_id: null }))
    return [...rythme, { date: `${mois(3)}-20`, sens: 'credit', montant: 12000, ligne_bancaire_id: 'l-bien', piece_id: 'p1' }]
  }

  it('le plan de trésorerie écarte le paiement d’un bien immobilisé de la moyenne, pas du solde', async () => {
    preparer()
    faux.ecritures = ecrituresAvecAcquisition()
    faux.immobilisations = [immobilisation()]
    const modale = await ouvrirLePlan('Plan de trésorerie')
    expect(modale.textContent).toMatch(/d'encaissements, 600,00\s€ de décaissements/)
    expect(within(modale).getByText(/Le paiement d’un bien immobilisé non plus/)).toBeTruthy()
    // Le solde, lui, le compte : − (6 × 600 + 12 000).
    expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.textContent).toMatch(/-15\s?600,00\s€/)
  })

  it('un décaissement qui ne paie pas un bien reste dans la moyenne, et rien n’est dit', async () => {
    // Le garde symétrique : la même écriture, sans bien au registre, est un décaissement ordinaire.
    preparer()
    faux.ecritures = ecrituresAvecAcquisition()
    const modale = await ouvrirLePlan('Plan de trésorerie')
    expect(modale.textContent).toMatch(/d'encaissements, 2\s?600,00\s€ de décaissements/)
    expect(within(modale).queryByText(/bien immobilisé non plus/)).toBeNull()
  })

  it('le taux d’endettement ne compte pas le déblocage non plus, et le dit', async () => {
    preparer()
    faux.ecritures = ecrituresDuPlan(true)
    faux.paiements = [DEBLOCAGE]
    const modale = await ouvrirLePlan('Dettes & ratios bancaires')
    expect(within(modale).getByText(/Les fonds reçus d’un emprunt n’y comptent pas/)).toBeTruthy()
    // 518,97 € de mensualité sur 600 € d'encaissements, et non sur 2 600 € — écrit à la française.
    expect(modale.textContent).toMatch(/86,5\s%/)
  })
})

// UN MOUVEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts) entre dans l'état qu'on montre à
// une banque par ses parts, à la date du mouvement : la recette brute d'une remise en recettes, sa
// commission en frais, et la part personnelle nulle part. Ce qui se joue ici est le CÂBLAGE : les parts
// vivent dans leur propre table, l'écran les lit une fois et les passe aux trois fenêtres qui les
// comptent — la situation intermédiaire, les ratios et le prévisionnel.
describe('FinancementTab — les mouvements ventilés sur plusieurs comptes', () => {
  const FRAIS: Categorie = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  function mouvement(o: Partial<LigneBancaire> = {}) {
    return {
      id: 'l-v', dossier_id: 'd', date: '2026-05-12', libelle: 'REMISE CB', montant: 4950, statut: 'rapprochee',
      piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, ventilee: true, id_externe: null,
      source_fichier: null, libelle_brut: null, created_at: '2026-05-13T09:00:00Z', ...o,
    }
  }
  function part(id: string, categorieId: string | null, montant: number) {
    return {
      id, dossier_id: 'd', ligne_bancaire_id: 'l-v', categorie_id: categorieId,
      part_personnelle: categorieId === null, montant, created_at: '2026-05-13T09:00:00Z',
    }
  }
  function poser() {
    faux.pieces = []
    faux.categories = [CATEGORIE, FRAIS]
    faux.immobilisations = []
    faux.ecritures = []
  }

  it('porte au 30 juin la recette brute d’une remise et sa commission, chacune dans son poste', async () => {
    poser()
    faux.paiements = [mouvement()]
    faux.ventilations = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-frais', -50)]
    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Recettes')).toMatch(/^5\s?000,00\s€$/)
    expect(totalDuPoste(auJuin, 'Frais financiers')).toMatch(/^-50,00\s€$/)
  })

  it('ne porte jamais la part personnelle', async () => {
    poser()
    faux.paiements = [mouvement({ libelle: 'PRLV OPERATEUR', montant: -120 })]
    faux.ventilations = [part('v1', 'cat-frais', -84), part('v2', null, -36)]
    const auJuin = await ouvrirLaSituation('2026-06-30')
    expect(totalDuPoste(auJuin, 'Frais financiers')).toMatch(/^-84,00\s€$/)
  })

  it('compte la part de recettes dans la CAF des ratios, pas l’apport personnel qui l’accompagne', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026 : 241 jours en 30/360
    poser()
    // 10 500 € reçus : 10 000 € d'honoraires et 500 € d'apport de l'exploitant sur le même virement.
    faux.paiements = [mouvement({ montant: 10500 })]
    faux.ventilations = [part('v1', 'cat-recettes', 10000), part('v2', null, 500)]
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: 'Dettes & ratios bancaires', level: 3 })
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    // 10 000 € ramenés à douze mois : 14 937,76 €. Comptée, la part personnelle en ferait 15 684,65.
    const ligne = (await screen.findByText(/CAF annuelle estimée/)).textContent ?? ''
    expect(ligne).toMatch(/14\s?937,76\s€/)
  })

  it('préremplit le prévisionnel de la part de recettes de l’année de référence', async () => {
    const annee = new Date().getFullYear() - 1
    poser()
    faux.paiements = [mouvement({ date: `${annee}-03-10`, montant: 11940 })]
    faux.ventilations = [part('v1', 'cat-recettes', 12000), part('v2', 'cat-frais', -60)]
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const tuile = screen.getByText('Trésorerie actuelle (banque)').parentElement as HTMLElement
    await waitFor(() => expect(tuile.querySelector('strong')?.textContent).not.toBe('—'))
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    await act(async () => { within(titre.parentElement as HTMLElement).getByRole('button').click() })
    await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
    expect((screen.getByLabelText('CA de référence (€)') as HTMLInputElement).value).toBe('12000')
  })

  it('dit la lecture partielle quand les parts sont lues en partie', async () => {
    poser()
    faux.paiements = [mouvement()]
    faux.ventilations = [part('v1', 'cat-recettes', 5000), part('v2', 'cat-frais', -50)]
    faux.muet = { ventilations_bancaires: 1 }
    render(<FinancementTab dossierId="d" assujettiTva modeComptable="tresorerie" />)
    expect(await screen.findByText(/Les données du dossier bancaire/)).toBeTruthy()
  })
})

// UNE ÉCHÉANCE QUE LE RELEVÉ PAIE N'EST PLUS UNE DETTE (lib/cotisationRapprochee.ts). Avant, seul un
// versement saisi la retirait des « cotisations sociales dues » et des échéances à venir : une cotisation
// prélevée restait due sur l'état qu'on montre à une banque. Et la situation intermédiaire la compte à la
// date et au montant du prélèvement, comme la 2035. Ce qui se joue ici est le CÂBLAGE : l'écran calcule
// deux listes — les échéances datées, celles qui restent à payer — et les passe à trois fenêtres, ce
// qu'aucun test de `src/lib` ne voit.
describe('FinancementTab — une échéance de cotisation payée par le relevé', () => {
  function echeance(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
    return {
      id: 'c-due', dossier_id: 'd', echeance: '2026-11-05', montant_appele: 300, montant_verse: null,
      montant_csg_crds: null, previsionnel: false, created_at: '2026-01-02T09:00:00Z', ...o,
    }
  }
  function prelevement(o: Partial<LigneBancaire> = {}): LigneBancaire {
    return {
      id: 'l-passee', dossier_id: 'd', date: '2026-08-20', libelle: 'PRLV URSSAF', montant: -500, statut: 'rapprochee',
      piece_id: null, cotisation_id: 'c-passee', categorie_id: null, taux_tva: null, emprunt_id: null,
      emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      id_externe: null, created_at: '2026-08-21T09:00:00Z', ...o,
    }
  }
  // Une échéance passée, prélevée à sa date ; une à venir, payée d'avance ; une à venir que rien ne paie.
  const ECHEANCES = [
    echeance({ id: 'c-passee', echeance: '2026-08-20', montant_appele: 500 }),
    echeance({ id: 'c-avance', echeance: '2026-10-05', montant_appele: 400 }),
    echeance(),
  ]
  const PRELEVEMENTS = [
    prelevement(),
    prelevement({ id: 'l-avance', date: '2026-08-28', montant: -400, cotisation_id: 'c-avance' }),
  ]
  function poser(paiements: LigneBancaire[]) {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 8, 1, 12, 0, 0))   // 1er septembre 2026, midi (heure locale)
    faux.pieces = []
    faux.categories = []
    faux.immobilisations = []
    faux.ecritures = []
    faux.cotisations = ECHEANCES
    faux.paiements = paiements
  }
  async function ouvrirLaCarte(carte: string) {
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    const titre = await screen.findByRole('heading', { name: carte, level: 3 })
    await waitFor(() => expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.querySelector('strong')?.textContent).not.toBe('—'))
    await act(async () => { within(titre.closest('div')!).getByRole('button', { name: 'Générer' }).click() })
    return screen.getByRole('heading', { name: carte, level: 2 }).closest('.card') as HTMLElement
  }
  function cotisationsDues(modale: HTMLElement): string {
    return (within(modale).getByText('Cotisations sociales dues').parentElement?.querySelector('strong')?.textContent ?? '')
      .replace(/\s/g, ' ')
  }
  // Les montants des lignes « Cotisation sociale » d'une liste d'échéances, dans l'ordre des dates.
  function echeancesDeCotisation(modale: HTMLElement): string[] {
    return within(modale).queryAllByRole('row')
      .filter((r) => r.textContent?.includes('Cotisation sociale'))
      .map((r) => (r.lastElementChild?.textContent ?? '').replace(/\s/g, ' '))
  }

  it('ne compte plus dans les cotisations dues ni dans les échéances à venir ce que le relevé paie', async () => {
    poser(PRELEVEMENTS)
    const modale = await ouvrirLaCarte('Dettes & ratios bancaires')
    expect(cotisationsDues(modale)).toBe('300,00 €')
    expect(echeancesDeCotisation(modale)).toEqual(['300,00 €'])
  })

  it('compte en revanche ce que rien ne paie', async () => {
    // GARDE SYMÉTRIQUE : sans lui, « une échéance payée n'est plus due » serait satisfait par un écran qui
    // ne compte plus aucune cotisation.
    poser([])
    const modale = await ouvrirLaCarte('Dettes & ratios bancaires')
    expect(cotisationsDues(modale)).toBe('1 200,00 €')
    expect(echeancesDeCotisation(modale)).toEqual(['400,00 €', '300,00 €'])
  })

  it('un encaissement rapproché d’un appel ne le paie pas', async () => {
    // Le rapprochement qui ne s'écrit pas : un encaissement ne paie pas un appel de cotisation, donc
    // l'échéance reste due — sans quoi un rapprochement fait à l'envers effacerait une dette.
    poser([prelevement({ montant: 500 })])
    const modale = await ouvrirLaCarte('Dettes & ratios bancaires')
    expect(cotisationsDues(modale)).toBe('1 200,00 €')
  })

  it('le plan de trésorerie ne liste plus l’échéance payée d’avance', async () => {
    poser(PRELEVEMENTS)
    const modale = await ouvrirLaCarte('Plan de trésorerie')
    expect(echeancesDeCotisation(modale)).toEqual(['300,00 €'])
    cleanup()
    poser([])
    const sansPaiement = await ouvrirLaCarte('Plan de trésorerie')
    expect(echeancesDeCotisation(sansPaiement)).toEqual(['400,00 €', '300,00 €'])
  })

  it('la situation intermédiaire la compte à la date et au montant du prélèvement', async () => {
    // Appelée 500 € pour le 20 juin, prélevée 480 € le 3 juillet : rien au 30 juin, 480 € au 31 juillet.
    poser([prelevement({ id: 'l-juillet', date: '2026-07-03', montant: -480, cotisation_id: 'c-juin' })])
    faux.cotisations = [echeance({ id: 'c-juin', echeance: '2026-06-20', montant_appele: 500 })]
    const auJuin = await ouvrirLaSituation('2026-06-30', false)
    expect(totalDuPoste(auJuin, 'Cotisations sociales personnelles')).toBeNull()
    cleanup()
    const auJuillet = await ouvrirLaSituation('2026-07-31', false)
    expect(totalDuPoste(auJuillet, 'Cotisations sociales personnelles')).toMatch(/^-480,00\s€$/)
  })

  it('la situation intermédiaire la compte à son échéance quand rien ne la paie', async () => {
    poser([])
    faux.cotisations = [echeance({ id: 'c-juin', echeance: '2026-06-20', montant_appele: 500 })]
    const auJuin = await ouvrirLaSituation('2026-06-30', false)
    expect(totalDuPoste(auJuin, 'Cotisations sociales personnelles')).toMatch(/^-500,00\s€$/)
  })

  // Les deux autres calculs de l'écran qui comptent les cotisations, chacun par son propre câblage : la CAF
  // que les ratios annualisent, et les charges de référence que le prévisionnel reprend.
  it('la CAF des ratios compte l’échéance payée d’avance, au montant du prélèvement', async () => {
    // 10 000 € encaissés ; l'échéance du 5 octobre prélevée le 28 août : 9 600 € au 1er septembre, ramenés à
    // douze mois sur 241 jours (30/360) — 14 340,25 €. Comptée à son échéance, elle ne serait pas encore là.
    poser([
      prelevement({ id: 'l-cpam', date: '2026-05-12', libelle: 'VIR CPAM', montant: 10000, cotisation_id: null, categorie_id: 'cat-recettes' }),
      prelevement({ id: 'l-avance', date: '2026-08-28', montant: -400, cotisation_id: 'c-avance' }),
    ])
    faux.categories = [CATEGORIE]
    faux.cotisations = [echeance({ id: 'c-avance', echeance: '2026-10-05', montant_appele: 400 })]
    const modale = await ouvrirLaCarte('Dettes & ratios bancaires')
    const ligne = (within(modale).getByText(/CAF annuelle estimée/).textContent ?? '').replace(/\s/g, ' ')
    expect(ligne).toContain('14 340,25 €')
  })

  it('le prévisionnel se précharge des cotisations prélevées dans l’année de référence', async () => {
    // Année de référence 2025 : juin prélevé 198 € au lieu de 200 ; décembre prélevé en janvier 2026, donc hors
    // de l'année. Les charges de référence sont les 198 € que la 2035 de 2025 porte.
    poser([
      prelevement({ id: 'l-juin', date: '2025-06-09', montant: -198, cotisation_id: 'c-juin' }),
      prelevement({ id: 'l-dec', date: '2026-01-06', montant: -300, cotisation_id: 'c-dec' }),
    ])
    faux.cotisations = [
      echeance({ id: 'c-juin', echeance: '2025-06-05', montant_appele: 200 }),
      echeance({ id: 'c-dec', echeance: '2025-12-05', montant_appele: 300 }),
    ]
    render(<FinancementTab dossierId="d" assujettiTva={false} modeComptable="tresorerie" />)
    await waitFor(() => expect(screen.getByText('Trésorerie actuelle (banque)').parentElement?.querySelector('strong')?.textContent).not.toBe('—'))
    const titre = screen.getByRole('heading', { name: 'Prévisionnel à 3 ans', level: 3 })
    await act(async () => { within(titre.parentElement as HTMLElement).getByRole('button').click() })
    await act(async () => { screen.getByRole('button', { name: 'Précharger depuis cette année' }).click() })
    expect((screen.getByLabelText('Charges de référence (€)') as HTMLInputElement).value).toBe('198')
  })
})
