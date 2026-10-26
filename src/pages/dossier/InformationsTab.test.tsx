import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InformationsTab from './InformationsTab'
import { CAPITAL_ILLISIBLE, IDENTITE_NON_ENREGISTREE, PHRASE_IDENTITE_LEGALE, PHRASE_IDENTITE_LEGALE_NON_LUE, RAISON_DENOMINATION_EI } from '../../lib/identiteLegaleVue'
import { LIBELLE_ADRESSE_IDENTITE, LIBELLE_DENOMINATION_IDENTITE, LIBELLE_RCS_VILLE_IDENTITE } from '../../lib/droitsAcces'
import { CATEGORIES_JURIDIQUES } from '../../lib/categoriesJuridiques'
import { REFUS_IDENTITE_LEGALE } from '../../lib/parametresFacturation'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'

// LA SUPPRESSION D'UN DOSSIER EST LE GESTE LE PLUS IRRÉVERSIBLE DE L'APPLICATION, et c'est celui
// auquel se ramène une demande d'effacement — les données de patients sont dans les FICHIERS, pas
// dans les tables (RGPD.md §4).
//
// `suppressionDossier.test.ts` garde le CALCUL : la fonction sait dire ce qu'elle n'a pas retiré.
// Aucun test de `src/lib` ne peut garder ce que ce fichier-ci garde — que l'écran le MONTRE. Le
// piège est visible dans le code : le gestionnaire naviguait vers la liste des dossiers dès que la
// suppression avait réussi, et un message posé après ce `navigate` partirait avec l'écran. C'est la
// même famille que le bilan d'un pack : un livrable incomplet le DIT, il ne se contente pas d'être
// incomplet.
const faux = vi.hoisted(() => ({
  bilan: { demandes: 0, retires: 0, echecs: [] as unknown[], inventaireIncomplet: false },
  message: '',
  navigations: [] as string[],
  // L'export produit bien son archive ; seul le LIEN de téléchargement échoue. C'est tout l'objet
  // du second bloc de tests : le bouton ne doit pas se contenter de ne rien faire.
  signError: null as { message: string } | null,
  ouvertures: [] as string[],
  // Le navigateur bloque-t-il la fenêtre surgissante ? `window.open` rend alors `null`, et c'est le
  // SEUL signal disponible. Le faux rendait `null` en toutes circonstances : le test du cas passant
  // exerçait donc, sans le dire, le chemin du blocage — un jeu d'essai infidèle ne fait pas
  // qu'affaiblir un test, il lui fait prouver autre chose.
  ouvertureBloquee: false,
  // Ce que la lecture des informations rend. `erreur` non nulle veut dire « on ne SAIT PAS ce que
  // porte le dossier » — et le formulaire, lui, a exactement la même tête que sur un dossier neuf.
  lecture: { informations: null as unknown, erreur: null as string | null },
  enregistrements: [] as unknown[],
  // Les générations d'archive, les lignes `packs` et les suppressions parties ; chacune attend sa porte quand le test la
  // pose — la fenêtre pendant laquelle un second clic arrive.
  generations: 0,
  porteGeneration: null as Promise<void> | null,
  insertionsPacks: 0,
  erreurPack: null as { message: string } | null,
  suppressions: 0,
  porteSuppression: null as Promise<void> | null,
  erreurSuppression: null as Error | null,
  // L'écriture de l'identité du dossier (`dossiers`, une seule fois pour les six colonnes) : ce qui est parti avec ses colonnes
  // relues, la porte qui la retient, la réponse de la base (une erreur, aucune ligne, ou une ligne qui n'est pas celle qu'on a
  // envoyée), et ce que la page en a reçu.
  ecritures: [] as { mise: Record<string, unknown>; colonnes: string }[],
  porteIdentite: null as Promise<void> | null,
  erreurIdentite: null as { message: string; code?: string } | null,
  aucuneLigne: false,
  reponseIdentite: null as ((mise: Record<string, unknown>) => Record<string, unknown>) | null,
  identitesRendues: [] as unknown[],
  // Ce que la carte « Source des ventes » a passé à la page (étape VF8b) : le dossier écrit et le réglage rendu.
  reglagesRendus: [] as unknown[],
}))

vi.mock('../../lib/informationsDossier', () => ({
  chargerInformationsDossier: () => Promise.resolve(faux.lecture),
  enregistrerInformationsDossier: (_id: string, saisie: unknown) => {
    faux.enregistrements.push(saisie)
    return Promise.resolve(null)
  },
}))

vi.mock('../../lib/suppressionDossier', () => ({
  supprimerDossierDefinitivement: async () => {
    faux.suppressions += 1
    await faux.porteSuppression
    if (faux.erreurSuppression) throw faux.erreurSuppression
    return faux.bilan
  },
  messageNettoyage: () => faux.message,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => (cible: string) => { faux.navigations.push(cible) },
}))

// Le contexte d'authentification décide de l'affichage du bouton : `estChef` seul importe ici, et
// monter un AuthProvider complet ferait dépendre le test d'une session Supabase.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: true }) }))

// Les cartes voisines font leurs propres lectures et n'ont rien à voir avec ce qu'on garde.
// La carte Véhicules écrit le forfait kilométrique face au compte du dirigeant que désigne le modèle du dossier
// (lib/forfaitKilometrique.ts) : doublée pour montrer le modèle qu'elle REÇOIT.
vi.mock('./VehiculesCard', () => ({
  default: ({ modele }: { modele: { mode: string; compteNotesDeFrais: string } }) => (
    <p>Véhicules — {modele.mode} — {modele.compteNotesDeFrais}</p>
  ),
}))
vi.mock('./SauvegardeCard', () => ({ default: () => null }))
// La carte « Source des ventes » (étape VF8b) lit et écrit seule, et a ses propres tests (SourceDesVentesCard.test.tsx) :
// doublée pour montrer ce que l'onglet lui PASSE — son dossier, et le chemin du réglage rendu jusqu'à la page.
vi.mock('./SourceDesVentesCard', () => ({
  default: ({ dossierId, onReglageRendu }: {
    dossierId: string
    onReglageRendu: (id: string, r: { ventes_par_les_factures: boolean; ventes_par_les_factures_depuis: string | null }) => void
  }) => (
    <button
      type="button"
      onClick={() => onReglageRendu(dossierId, { ventes_par_les_factures: true, ventes_par_les_factures_depuis: '2026-10-26T09:00:00+00:00' })}
    >
      Source des ventes — {dossierId}
    </button>
  ),
}))
vi.mock('./BalanceCard', () => ({ default: () => null }))
vi.mock('../../lib/packGenerator', () => ({
  generatePack: async () => {
    faux.generations += 1
    await faux.porteGeneration
    return {
      nbPieces: 4, storagePathZip: 'd1/p/pack.zip', storagePathExcel: 'd1/p/recap.xlsx',
      totalTtc: 1200, manquantes: [],
    }
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      let mise: Record<string, unknown> | null = null
      let colonnes = ''
      Object.assign(chaine, {
        select: (lues?: string) => { colonnes = lues ?? ''; return chaine },
        eq: () => chaine,
        // La base rend la ligne qu'elle a écrite, limitée aux colonnes demandées ; sans `update`, rien à rendre.
        maybeSingle: async () => {
          if (mise === null) return { data: null, error: null }
          faux.ecritures.push({ mise, colonnes })
          await faux.porteIdentite
          if (faux.erreurIdentite) return { data: null, error: faux.erreurIdentite }
          if (faux.aucuneLigne) return { data: null, error: null }
          const ecrite = faux.reponseIdentite ? faux.reponseIdentite(mise) : mise
          const demandees = colonnes.split(',').map((c) => c.trim())
          return { data: Object.fromEntries(demandees.map((c) => [c, ecrite[c] ?? null])), error: null }
        },
        update: (valeurs: Record<string, unknown>) => { mise = valeurs; return chaine },
        // La ligne `packs` de l'export : rien d'autre ne s'insère depuis cet onglet.
        insert: () => {
          faux.insertionsPacks += 1
          return Promise.resolve({ error: faux.erreurPack })
        },
      })
      return chaine
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve(
          faux.signError
            ? { data: null, error: faux.signError }
            : { data: { signedUrl: 'https://exemple/pack.zip' }, error: null },
        ),
      }),
    },
  },
}))

/**
 * Ouvre la confirmation et tape le nom du dossier, comme le fait un opérateur.
 *
 * `ConfirmationSuppression` n'active son bouton que si la saisie vaut EXACTEMENT le nom — on passe
 * donc par le vrai champ (`#confirmation-nom`) plutôt que d'appeler le gestionnaire à la main : c'est
 * cette garde-là qui rend la suppression difficile à déclencher par distraction, et un test qui la
 * contourne ne décrirait plus le geste réel.
 */
async function supprimer(nom: string) {
  const ouvrir = screen.getByRole('button', { name: /Supprimer ce dossier définitivement/ })
  await act(async () => { ouvrir.click() })
  const champ = screen.getByLabelText(/pour confirmer/)
  await act(async () => { fireEvent.change(champ, { target: { value: nom } }) })
  const confirmer = screen.getByRole('button', { name: /^Supprimer définitivement$/ })
  await act(async () => { confirmer.click() })
}

function monter(
  modele: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT },
  identite: Partial<ComponentProps<typeof InformationsTab>> = {},
) {
  return render(
    <InformationsTab
      dossierId="d1"
      dossierNom="Cabinet Martin"
      dossierSiret={null}
      dossierAdresse={null}
      dossierDenomination={null}
      dossierRcsVille={null}
      dossierFormeJuridique={null}
      dossierCapital={null}
      modele={modele}
      onIdentiteUpdated={(rendue) => { faux.identitesRendues.push(rendue) }}
      onReglageUpdated={(id, reglage) => { faux.reglagesRendus.push([id, reglage]) }}
      {...identite}
    />,
  )
}

beforeEach(() => {
  faux.bilan = { demandes: 0, retires: 0, echecs: [], inventaireIncomplet: false }
  faux.message = ''
  faux.navigations = []
  faux.signError = null
  faux.ouvertures = []
  faux.ouvertureBloquee = false
  faux.lecture = { informations: null, erreur: null }
  faux.enregistrements = []
  faux.generations = 0
  faux.porteGeneration = null
  faux.insertionsPacks = 0
  faux.erreurPack = null
  faux.suppressions = 0
  faux.porteSuppression = null
  faux.erreurSuppression = null
  faux.ecritures = []
  faux.porteIdentite = null
  faux.erreurIdentite = null
  faux.aucuneLigne = false
  faux.reponseIdentite = null
  faux.identitesRendues = []
  window.open = ((url: string) => {
    faux.ouvertures.push(url)
    return faux.ouvertureBloquee ? null : { opener: window as unknown } as Window
  }) as typeof window.open
})

describe('suppression d’un dossier : ce qui reste dans le stockage se dit', () => {
  it('retient l’écran et montre le reste quand le nettoyage n’est pas propre', async () => {
    faux.message = "Le dossier est supprimé, mais 3 fichiers n'ont pas pu être retirés du stockage."
    monter()
    await act(async () => {})
    await supprimer('Cabinet Martin')

    expect(screen.getByText(/3 fichiers n'ont pas pu être retirés/)).toBeTruthy()
    // LE CŒUR DU TEST : naviguer tout de suite emporterait le message avec l'écran, et c'est la
    // seule occasion de le lire — plus aucun écran ne peut retrouver ces fichiers ensuite.
    expect(faux.navigations).toEqual([])
  })

  it('laisse repartir vers la liste une fois le message acquitté', async () => {
    faux.message = "Le dossier est supprimé, mais 3 fichiers n'ont pas pu être retirés du stockage."
    monter()
    await act(async () => {})
    await supprimer('Cabinet Martin')

    const acquitter = screen.getByRole('button', { name: /J'ai compris/ })
    await act(async () => { acquitter.click() })
    expect(faux.navigations).toEqual(['/dossiers'])
  })

  it('ne dit rien et repart quand tout a été retiré', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « l'écran ne navigue pas » serait satisfait par un écran qui
    // ne navigue JAMAIS, c'est-à-dire un dossier supprimé dont on ne sort plus.
    faux.message = ''
    monter()
    await act(async () => {})
    await supprimer('Cabinet Martin')

    expect(faux.navigations).toEqual(['/dossiers'])
    expect(screen.queryAllByText(/restés dans le stockage/)).toHaveLength(0)
  })
})

describe('export avant suppression : un bouton ne fait jamais rien en silence', () => {
  async function exporter() {
    const bouton = screen.getByRole('button', { name: /Exporter/ })
    await act(async () => { bouton.click() })
  }

  it('ouvre l’archive quand le lien se crée', async () => {
    monter()
    await act(async () => {})
    await exporter()
    expect(faux.ouvertures).toEqual(['https://exemple/pack.zip'])
    // Garde SYMÉTRIQUE : sans lui, « l'écran dit quand ça échoue » serait satisfait par un écran
    // qui se plaint TOUJOURS, y compris sur l'archive qui vient de s'ouvrir.
    expect(screen.queryAllByText(/n'a pas pu être ouverte/)).toHaveLength(0)
  })

  it('DIT que le navigateur a bloqué la fenêtre, au lieu de ne rien faire', async () => {
    // Le lien EXISTE, l'archive EXISTE : seul l'onglet n'est pas parti. Sans ce message, l'écran
    // est rigoureusement identique à un bouton cassé — et l'opérateur est sur le point de
    // supprimer le dossier. `window.open` appelé après un `await` sort de la fenêtre d'activation
    // transitoire du navigateur, donc ce cas n'a rien de théorique.
    faux.ouvertureBloquee = true
    monter()
    await act(async () => {})
    await exporter()

    expect(faux.ouvertures).toEqual(['https://exemple/pack.zip'])
    expect(screen.getByText(/bloquée par le navigateur/)).toBeTruthy()
    expect(screen.getByText(/onglet Packs/)).toBeTruthy()
  })

  it('DIT que le lien a échoué, et où reprendre l’archive', async () => {
    // Le défaut d'origine : `const { data: signed } = …` sans erreur, puis `if (signed)`. Rien ne
    // s'ouvrait, rien ne s'affichait, et l'opérateur — qui est sur le point de supprimer le dossier —
    // en concluait que l'export n'avait rien produit.
    faux.signError = { message: 'objet introuvable' }
    monter()
    await act(async () => {})
    await exporter()

    expect(faux.ouvertures).toEqual([])
    // Le message vient désormais du point unique (lib/apercu.ts), mais il doit toujours dire les
    // trois mêmes choses — l'archive EXISTE, la raison, et où la reprendre.
    expect(screen.getByText(/L'archive est bien générée et enregistrée/)).toBeTruthy()
    expect(screen.getByText(/n'a pas pu être créé/)).toBeTruthy()
    // La RAISON, et la sortie : sans « onglet Packs », le message dit seulement qu'on a perdu.
    expect(screen.getByText(/objet introuvable/)).toBeTruthy()
    expect(screen.getByText(/onglet Packs/)).toBeTruthy()
  })
})

describe('informations du client : on n’écrase jamais ce qu’on n’a pas su lire', () => {
  // `informationsDossier.test.ts` garde le CALCUL — la lecture sait dire qu'elle a échoué. Ce qui
  // suit garde le CÂBLAGE, et aucun test de `src/lib` ne le peut : la fonction est juste, c'est
  // l'écran qui décidait d'enregistrer par-dessus. Le piège est visible dans le code : l'upsert
  // porte TOUS les champs, et le formulaire non rempli est identique à un formulaire non LU.

  // Deux boutons « Enregistrer » cohabitent sur cet écran (identité, puis informations) : on
  // s'ancre donc sur le formulaire qui porte le champ Véhicule, pas sur un rang dans le document.
  function formulaireInformations() {
    const champ = screen.getByLabelText('Véhicule')
    const form = champ.closest('form')
    if (!form) throw new Error('formulaire des informations introuvable')
    return within(form)
  }

  it('REFUSE d’enregistrer et DIT pourquoi quand la lecture a échoué', async () => {
    faux.lecture = { informations: null, erreur: 'JWT expired' }
    monter()
    await act(async () => {})

    expect(screen.getByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/enregistrer maintenant les écraserait/)).toBeTruthy()

    const bouton = formulaireInformations().getByRole('button', { name: /^Enregistrer$/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.enregistrements).toEqual([])

    // À SAVOIR POUR LA PROCHAINE MUTATION : retirer la seconde ceinture du gestionnaire
    // (`if (erreurChargement) return`) laisse ces huit tests VERTS, et c'est juste — un bouton
    // grisé n'appelle pas son gestionnaire, et la soumission implicite par « Entrée » ne trouve
    // pas de bouton par défaut actif. Elle est gardée pour le jour où un autre chemin mènera à ce
    // gestionnaire, pas parce qu'un clic l'atteint : la dire mordante serait faux. Même arbitrage
    // que la seconde ceinture de ClotureTab.
  })

  it('laisse enregistrer un dossier qui n’a simplement jamais rien rempli', async () => {
    // Le garde SYMÉTRIQUE, et il porte tout : sans lui, « l'écran refuse d'écraser » serait
    // satisfait par un écran qui refuse TOUJOURS — donc par un formulaire qu'on ne peut plus
    // remplir, sur le cas le plus courant de tous.
    faux.lecture = { informations: null, erreur: null }
    monter()
    await act(async () => {})

    expect(screen.queryAllByText(/enregistrer maintenant les écraserait/)).toHaveLength(0)
    const bouton = formulaireInformations().getByRole('button', { name: /^Enregistrer$/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
    await act(async () => { bouton.click() })
    expect(faux.enregistrements).toHaveLength(1)
  })

  it('préremplit le formulaire avec ce que le dossier porte', async () => {
    // Troisième garde : « le formulaire est vide » ne doit pas être vrai TOUT LE TEMPS, sinon le
    // premier test passerait pour une raison fausse et l'écran aurait perdu sa fonction.
    faux.lecture = {
      informations: {
        id: 'i1', dossier_id: 'd1', vehicule_type: 'personnel_ik', vehicule_libelle: 'Peugeot 308',
        jours_travailles_an: 218, tickets_restaurant: true,
        justificatif_tickets_restaurant_recu: false, cheques_vacances: false,
        justificatif_cheques_vacances_recu: false, notes: 'Local partagé',
        updated_at: '2026-09-20T10:00:00Z',
      },
      erreur: null,
    }
    monter()
    await act(async () => {})

    expect((screen.getByLabelText('Véhicule') as HTMLSelectElement).value).toBe('personnel_ik')
    expect((screen.getByLabelText(/Jours travaillés/) as HTMLInputElement).value).toBe('218')
    expect((screen.getByLabelText(/Autres informations/) as HTMLTextAreaElement).value).toBe('Local partagé')
  })
})

describe('la carte « Source des ventes » (étape VF8b)', () => {
  it('se monte avec le dossier de l’onglet, et le réglage qu’elle rend va à la page, avec le dossier écrit', async () => {
    faux.reglagesRendus = []
    monter()
    const carte = await screen.findByRole('button', { name: 'Source des ventes — d1' })
    await act(async () => { carte.click() })
    expect(faux.reglagesRendus).toEqual([
      ['d1', { ventes_par_les_factures: true, ventes_par_les_factures_depuis: '2026-10-26T09:00:00+00:00' }],
    ])
  })
})

describe('la carte Véhicules reçoit le modèle comptable du dossier', () => {
  it('lui passe celui de l’onglet, dont dépend le compte que son forfait crédite', async () => {
    monter({ mode: 'engagement', compteNotesDeFrais: '467000', plan: PLAN_PAR_DEFAUT })
    expect(await screen.findByText('Véhicules — engagement — 467000')).toBeTruthy()
  })
})

// L'EXPORT ET LA SUPPRESSION NE SE PROTÉGEAIENT QUE PAR UN ÉTAT (09/10/2026). `disabled={exportEnCours}` et
// `enCours={suppressionEnCours}` ne prennent effet qu'au rendu suivant : deux clics du même rendu produisaient deux
// archives et deux lignes `packs` ; et deux suppressions du même dossier couraient l'une contre l'autre dans le stockage —
// la seconde, qui ne trouve plus les fichiers que la première vient de retirer, compte `retires < demandes` et
// affirme qu'ils sont restés (« préviens l'administrateur »), sur un dossier proprement supprimé. Le cas à TROIS clics est
// le seul à distinguer un verrou posé dans le `try`.
function retenir(porte: 'porteGeneration' | 'porteSuppression' | 'porteIdentite'): () => Promise<void> {
  let ouvrir = () => {}
  faux[porte] = new Promise<void>((resolve) => { ouvrir = resolve })
  return async () => {
    faux[porte] = null
    await act(async () => { ouvrir() })
  }
}

describe('le verrou de l’export avant suppression', () => {
  async function boutonDExport() {
    monter()
    await act(async () => {})
    return screen.getByRole('button', { name: /Exporter avant suppression/ }) as HTMLButtonElement
  }

  it('ne produit qu’une archive quand le bouton part deux fois dans le même rendu', async () => {
    const bouton = await boutonDExport()
    const liberer = retenir('porteGeneration')

    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.generations).toBe(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Export…')
    await liberer()
    expect(faux.insertionsPacks).toBe(1)
    expect(faux.ouvertures).toEqual(['https://exemple/pack.zip'])
  })

  it('trois clics dans le même rendu n’en produisent qu’une', async () => {
    const bouton = await boutonDExport()
    const liberer = retenir('porteGeneration')

    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.generations).toBe(1)
    await liberer()
  })

  it('relâche le verrou sur un refus de la base, pour laisser réessayer', async () => {
    faux.erreurPack = { message: 'permission denied' }
    const bouton = await boutonDExport()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    await act(async () => { bouton.click() })

    expect(faux.generations).toBe(2)
  })
})

describe('le verrou de la suppression définitive', () => {
  // Le nom tapé comme le fait un opérateur : c'est cette garde-là qui active le bouton (voir `supprimer`, plus haut).
  async function boutonDeConfirmation() {
    monter()
    await act(async () => {})
    await act(async () => { screen.getByRole('button', { name: /Supprimer ce dossier définitivement/ }).click() })
    await act(async () => { fireEvent.change(screen.getByLabelText(/pour confirmer/), { target: { value: 'Cabinet Martin' } }) })
    return screen.getByRole('button', { name: /^Supprimer définitivement$/ }) as HTMLButtonElement
  }

  it('ne supprime qu’une fois quand la confirmation part deux fois dans le même rendu', async () => {
    const bouton = await boutonDeConfirmation()
    const liberer = retenir('porteSuppression')

    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.suppressions).toBe(1)
    expect(bouton.disabled).toBe(true)
    expect(bouton.textContent).toBe('Suppression…')
    await liberer()
    expect(faux.navigations).toEqual(['/dossiers'])
  })

  it('trois clics dans le même rendu ne suppriment qu’une fois', async () => {
    const bouton = await boutonDeConfirmation()
    const liberer = retenir('porteSuppression')

    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.suppressions).toBe(1)
    await liberer()
  })

  it('relâche le verrou sur un refus, et le dit', async () => {
    faux.erreurSuppression = new Error('permission denied')
    const bouton = await boutonDeConfirmation()

    await act(async () => { bouton.click() })
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toBe(2)
    expect(faux.navigations).toEqual([])
  })
})

// L'IDENTITÉ DU DOSSIER, EN UNE ÉCRITURE (espace client, étape A5b2). La carte « Identité du dossier » écrit le SIRET, l'adresse
// et les quatre colonnes d'identité légale d'un seul tenant, relit la ligne que la base rend, et ne s'offre pas d'écrire une
// colonne que la lecture du dossier n'a pas portée. Le module (`lib/identiteLegaleVue.ts`) garde ce que la carte DIT ; ce qui
// suit garde le câblage : la ligne rendue, le verrou, le refus avant le clic, la colonne absente.
describe('l’identité du dossier : six colonnes, une écriture', () => {
  const SAS = '5710'
  const LIGNE_COMPLETE: Partial<ComponentProps<typeof InformationsTab>> = {
    dossierSiret: '12345678901234', dossierAdresse: '1 rue des Essais, 69000 Lyon', dossierDenomination: 'Société Fictive',
    dossierRcsVille: 'Lyon', dossierFormeJuridique: SAS, dossierCapital: 150000,
  }

  const formulaire = () => {
    const form = screen.getByLabelText('SIRET').closest('form')
    if (!form) throw new Error('formulaire de l’identité introuvable')
    return form
  }
  const bouton = () => within(formulaire()).getByRole('button', { name: /^Enregistrer$|^Enregistrement…$/ }) as HTMLButtonElement
  const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement
  const saisir = (libelle: string | RegExp, valeur: string) => { fireEvent.change(champ(libelle), { target: { value: valeur } }) }
  const choisirForme = (code: string) => { fireEvent.change(champ('Forme juridique'), { target: { value: code } }) }

  async function montee(identite: Partial<ComponentProps<typeof InformationsTab>> = LIGNE_COMPLETE) {
    monter(undefined, identite)
    await act(async () => {})
  }

  it('préremplit le formulaire avec ce que le dossier porte, le capital au centime', async () => {
    await montee()
    expect(champ('SIRET').value).toBe('12345678901234')
    expect(champ(LIBELLE_ADRESSE_IDENTITE).value).toBe('1 rue des Essais, 69000 Lyon')
    expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('Société Fictive')
    expect(champ(LIBELLE_RCS_VILLE_IDENTITE).value).toBe('Lyon')
    expect(champ('Forme juridique').value).toBe(SAS)
    expect(champ(/^Capital social/).value).toBe('150000,00')
  })

  it('garde le contrôle inverse : un dossier neuf offre les quatre champs vides, la forme « Non renseignée »', async () => {
    await montee({})
    expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('')
    expect(champ('Forme juridique').value).toBe('')
    expect(champ(/^Capital social/).value).toBe('')
    expect(screen.getByText(PHRASE_IDENTITE_LEGALE)).toBeTruthy()
    // La phrase des quatre champs ne redit pas le SIRET et l'adresse : la phrase qui la précède le dit, une fois.
    expect(screen.getAllByText(/repris automatiquement sur chaque nouvelle facture émise/)).toHaveLength(1)
    expect(bouton().disabled).toBe(false)
  })

  it('dit, dans les libellés, que le client du dossier lit l’adresse, la dénomination et la ville du greffe', async () => {
    await montee()
    expect(screen.getByText(LIBELLE_ADRESSE_IDENTITE)).toBeTruthy()
    expect(screen.getByText(LIBELLE_DENOMINATION_IDENTITE)).toBeTruthy()
    expect(screen.getByText(LIBELLE_RCS_VILLE_IDENTITE)).toBeTruthy()
    expect(LIBELLE_ADRESSE_IDENTITE).toContain('le client du dossier')
  })

  it('offre la forme sous son code et son libellé de l’INSEE : « Non renseignée », puis les 260 catégories dans l’ordre', async () => {
    await montee({})
    const options = Array.from((champ('Forme juridique') as unknown as HTMLSelectElement).options)
    expect(options).toHaveLength(261)
    expect(options[0].textContent).toBe('Non renseignée')
    expect(options.slice(1).map((o) => o.value)).toEqual(CATEGORIES_JURIDIQUES.map((c) => c.code))
    expect(options[2].textContent).toBe('1000 — Entrepreneur individuel')
  })

  it('écrit les six colonnes EN UNE FOIS, telles qu’elles partent : blancs retirés, vide nul, capital en nombre', async () => {
    await montee({})
    saisir('SIRET', ' 12345678901234 ')
    saisir(LIBELLE_ADRESSE_IDENTITE, '  1 rue des Essais  ')
    saisir(LIBELLE_DENOMINATION_IDENTITE, '  Société Fictive ')
    saisir(LIBELLE_RCS_VILLE_IDENTITE, '   ')
    choisirForme(SAS)
    saisir(/^Capital social/, '1 500,50')
    await act(async () => { bouton().click() })

    expect(faux.ecritures).toEqual([{
      mise: {
        siret: '12345678901234', adresse: '1 rue des Essais', denomination_imprimee: 'Société Fictive', rcs_ville: null,
        forme_juridique: SAS, capital: 1500.5,
      },
      colonnes: 'siret, adresse, denomination_imprimee, rcs_ville, forme_juridique, capital',
    }])
    expect(screen.getByText('Enregistré ✓')).toBeTruthy()
  })

  it('passe à la page les six valeurs TELLES QUE LA BASE LES A RENDUES, et le formulaire repart de la ligne rendue', async () => {
    await montee({})
    // La base garde autre chose que ce qu'on lui a envoyé (une normalisation, un déclencheur) : c'est ce qu'elle rend qui fait foi.
    faux.reponseIdentite = (mise) => ({ ...mise, denomination_imprimee: 'RENDUE PAR LA BASE', capital: 1500.5 })
    saisir(LIBELLE_DENOMINATION_IDENTITE, 'Tapée')
    choisirForme(SAS)
    await act(async () => { bouton().click() })

    expect(faux.identitesRendues).toEqual([{
      siret: null, adresse: null, denomination_imprimee: 'RENDUE PAR LA BASE', rcs_ville: null, forme_juridique: SAS, capital: 1500.5,
    }])
    expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('RENDUE PAR LA BASE')
    expect(champ(/^Capital social/).value).toBe('1500,50')
  })

  it('retire « Enregistré ✓ » dès qu’on retouche un champ : il ne parle que de ce qui a été écrit', async () => {
    await montee({})
    await act(async () => { bouton().click() })
    expect(screen.getByText('Enregistré ✓')).toBeTruthy()
    saisir(LIBELLE_RCS_VILLE_IDENTITE, 'Lyon')
    expect(screen.queryByText('Enregistré ✓')).toBeNull()
  })

  it('AUCUNE ligne rendue : rien n’est écrit, la carte le dit, sans « Enregistré ✓», et ne passe rien à la page', async () => {
    await montee({})
    faux.aucuneLigne = true
    saisir(LIBELLE_DENOMINATION_IDENTITE, 'Société Fictive')
    await act(async () => { bouton().click() })

    expect(faux.ecritures).toHaveLength(1)
    expect(screen.getByText(IDENTITE_NON_ENREGISTREE)).toBeTruthy()
    expect(screen.queryByText('Enregistré ✓')).toBeNull()
    expect(faux.identitesRendues).toEqual([])
    // Le formulaire garde la saisie : rien n'a été relu.
    expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('Société Fictive')
  })

  it.each(REFUS_IDENTITE_LEGALE.map((r) => [r.contrainte, r.message]))('le refus de la base « %s » se dit sous les mots du module', async (contrainte, message) => {
    await montee({})
    faux.erreurIdentite = { code: '23514', message: `new row for relation "dossiers" violates check constraint "${contrainte}"` }
    saisir(LIBELLE_DENOMINATION_IDENTITE, 'Société Fictive')
    await act(async () => { bouton().click() })

    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByText(/violates check constraint/)).toBeNull()
    expect(screen.queryByText('Enregistré ✓')).toBeNull()
    expect(faux.identitesRendues).toEqual([])
  })

  it('toute autre erreur de la base se dit par son message', async () => {
    await montee({})
    faux.erreurIdentite = { code: '23505', message: 'duplicate key value violates unique constraint "dossiers_siret_key"' }
    await act(async () => { bouton().click() })
    expect(screen.getByText(/duplicate key value violates unique constraint/)).toBeTruthy()
    expect(faux.identitesRendues).toEqual([])
  })

  it('« Enregistrer » est grisé sous un refus dit avant le clic, et ne part pas', async () => {
    await montee({})
    choisirForme(SAS)
    saisir(/^Capital social/, '12,345')
    expect(screen.getByText(CAPITAL_ILLISIBLE)).toBeTruthy()
    expect(bouton().disabled).toBe(true)
    await act(async () => { bouton().click() })
    expect(faux.ecritures).toEqual([])

    // Le refus d'une contrainte, redit par le module : une dénomination trop longue.
    saisir(/^Capital social/, '1500')
    expect(screen.queryByText(CAPITAL_ILLISIBLE)).toBeNull()
    expect(bouton().disabled).toBe(false)
    saisir(LIBELLE_DENOMINATION_IDENTITE, 'x'.repeat(201))
    expect(screen.getByText(/deux cents caractères au plus/)).toBeTruthy()
    expect(bouton().disabled).toBe(true)
    await act(async () => { bouton().click() })
    expect(faux.ecritures).toEqual([])
  })

  it('refuse un capital à zéro, avant le clic', async () => {
    await montee({})
    choisirForme(SAS)
    saisir(/^Capital social/, '0')
    expect(screen.getByText(/strictement positif/)).toBeTruthy()
    expect(bouton().disabled).toBe(true)
  })

  it('un code de forme que la nomenclature ne connaît pas se dit tel quel, et retient l’enregistrement', async () => {
    await montee({ ...LIGNE_COMPLETE, dossierFormeJuridique: '9999' })
    const select = champ('Forme juridique') as unknown as HTMLSelectElement
    expect(select.value).toBe('9999')
    expect(select.options[1].textContent).toContain('9999 — code que la nomenclature de l’INSEE ne connaît pas')
    expect(bouton().disabled).toBe(true)
    choisirForme(SAS)
    expect(bouton().disabled).toBe(false)
  })

  // LE VERROU : `savingIdentite` ne prend effet qu'au rendu suivant, et deux clics du même rendu écrivaient deux fois.
  it('n’écrit qu’une fois quand le bouton part deux fois dans le même rendu', async () => {
    await montee({})
    const liberer = retenir('porteIdentite')
    const b = bouton()
    await act(async () => { b.click(); b.click() })

    expect(faux.ecritures).toHaveLength(1)
    expect(b.disabled).toBe(true)
    expect(b.textContent).toBe('Enregistrement…')
    await liberer()
    expect(faux.identitesRendues).toHaveLength(1)
  })

  it('trois clics dans le même rendu n’en font qu’une, et le verrou se relâche ensuite', async () => {
    await montee({})
    const liberer = retenir('porteIdentite')
    const b = bouton()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.ecritures).toHaveLength(1)
    await liberer()

    saisir(LIBELLE_DENOMINATION_IDENTITE, 'Autre')
    await act(async () => { bouton().click() })
    expect(faux.ecritures).toHaveLength(2)
  })

  it('relâche le verrou sur un refus de la base, pour laisser réessayer', async () => {
    await montee({})
    faux.erreurIdentite = { message: 'permission denied' }
    await act(async () => { bouton().click() })
    expect(screen.getByText(/permission denied/)).toBeTruthy()

    faux.erreurIdentite = null
    await act(async () => { bouton().click() })
    expect(faux.ecritures).toHaveLength(2)
    expect(screen.getByText('Enregistré ✓')).toBeTruthy()
  })

  describe('une colonne que la lecture du dossier n’a pas portée', () => {
    const SANS_IDENTITE_LEGALE: Partial<ComponentProps<typeof InformationsTab>> = {
      dossierSiret: '12345678901234', dossierAdresse: '1 rue des Essais',
      dossierDenomination: undefined, dossierRcsVille: undefined, dossierFormeJuridique: undefined, dossierCapital: undefined,
    }

    it('n’offre pas les quatre champs, dit pourquoi, et n’écrit que le SIRET et l’adresse', async () => {
      await montee(SANS_IDENTITE_LEGALE)
      expect(screen.queryByLabelText(LIBELLE_DENOMINATION_IDENTITE)).toBeNull()
      expect(screen.queryByLabelText(LIBELLE_RCS_VILLE_IDENTITE)).toBeNull()
      expect(screen.queryByLabelText('Forme juridique')).toBeNull()
      expect(screen.queryByLabelText(/^Capital social/)).toBeNull()
      expect(screen.getByText(PHRASE_IDENTITE_LEGALE_NON_LUE)).toBeTruthy()
      expect(screen.queryByText(PHRASE_IDENTITE_LEGALE)).toBeNull()

      saisir('SIRET', ' 99999999999999 ')
      await act(async () => { bouton().click() })
      expect(faux.ecritures).toEqual([{ mise: { siret: '99999999999999', adresse: '1 rue des Essais' }, colonnes: 'siret, adresse' }])
      // Jamais nul sur ce qu'on n'a pas lu : la clé n'est même pas dans l'écriture.
      expect(Object.keys(faux.ecritures[0].mise)).toEqual(['siret', 'adresse'])
      expect(faux.identitesRendues).toEqual([{ siret: '99999999999999', adresse: '1 rue des Essais' }])
    })

    it('une seule colonne absente suffit : rien ne s’offre', async () => {
      await montee({ ...LIGNE_COMPLETE, dossierCapital: undefined })
      expect(screen.queryByLabelText(LIBELLE_DENOMINATION_IDENTITE)).toBeNull()
      await act(async () => { bouton().click() })
      expect(Object.keys(faux.ecritures[0].mise)).toEqual(['siret', 'adresse'])
    })
  })

  describe('l’entrepreneur individuel', () => {
    it('propose « <nom> EI » avec sa raison, sans rien écrire ; le bouton remplit le champ', async () => {
      await montee({})
      expect(screen.queryByText(RAISON_DENOMINATION_EI)).toBeNull()
      choisirForme('1000')
      expect(screen.getByText(RAISON_DENOMINATION_EI)).toBeTruthy()
      expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('')

      await act(async () => { screen.getByRole('button', { name: /^Utiliser « Cabinet Martin EI »$/ }).click() })
      expect(champ(LIBELLE_DENOMINATION_IDENTITE).value).toBe('Cabinet Martin EI')
      expect(faux.ecritures).toEqual([])
      // Déjà reprise : plus de proposition.
      expect(screen.queryByText(RAISON_DENOMINATION_EI)).toBeNull()
    })

    it('ne propose rien tant que la forme n’est pas connue, ni pour une société', async () => {
      await montee({})
      expect(screen.queryByRole('button', { name: /^Utiliser « / })).toBeNull()
      choisirForme(SAS)
      expect(screen.queryByRole('button', { name: /^Utiliser « / })).toBeNull()
    })

    it('cache le capital, dit qu’il sera effacé, et l’écrit nul dans la même écriture', async () => {
      await montee(LIGNE_COMPLETE)
      expect(screen.queryByText(/capital enregistré/)).toBeNull()
      choisirForme('1000')

      expect(screen.queryByLabelText(/^Capital social/)).toBeNull()
      // `getByText` ramène l'insécable à une espace (CLAUDE.md : « UN MONTANT SE COUPAIT EN FIN DE LIGNE »).
      expect(screen.getByText(/le capital enregistré \(150 000,00 €\) sera effacé/)).toBeTruthy()
      await act(async () => { bouton().click() })

      expect(faux.ecritures).toHaveLength(1)
      expect(faux.ecritures[0].mise).toMatchObject({ forme_juridique: '1000', capital: null })
      expect(faux.identitesRendues).toEqual([expect.objectContaining({ forme_juridique: '1000', capital: null })])
      // Une fois écrit, il n'y a plus rien à effacer : la phrase n'est plus dite.
      expect(screen.queryByText(/capital enregistré/)).toBeNull()
    })

    it('un capital seulement tapé : dit qu’il ne sera pas écrit, retrouvé en revenant à une société', async () => {
      await montee({})
      choisirForme(SAS)
      saisir(/^Capital social/, '5000')
      choisirForme('1000')
      expect(screen.getByText(/capital saisi ne sera pas enregistré/)).toBeTruthy()
      await act(async () => { bouton().click() })
      expect(faux.ecritures[0].mise.capital).toBeNull()
    })

    it('un capital illisible dans le champ caché ne retient pas l’enregistrement', async () => {
      await montee({})
      choisirForme(SAS)
      saisir(/^Capital social/, 'abc')
      expect(bouton().disabled).toBe(true)
      choisirForme('1000')
      expect(bouton().disabled).toBe(false)
      choisirForme(SAS)
      expect(champ(/^Capital social/).value).toBe('abc')
    })
  })
})
