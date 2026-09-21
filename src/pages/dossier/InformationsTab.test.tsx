import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InformationsTab from './InformationsTab'

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
}))

vi.mock('../../lib/informationsDossier', () => ({
  chargerInformationsDossier: () => Promise.resolve(faux.lecture),
  enregistrerInformationsDossier: (_id: string, saisie: unknown) => {
    faux.enregistrements.push(saisie)
    return Promise.resolve(null)
  },
}))

vi.mock('../../lib/suppressionDossier', () => ({
  supprimerDossierDefinitivement: () => Promise.resolve(faux.bilan),
  messageNettoyage: () => faux.message,
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => (cible: string) => { faux.navigations.push(cible) },
}))

// Le contexte d'authentification décide de l'affichage du bouton : `estChef` seul importe ici, et
// monter un AuthProvider complet ferait dépendre le test d'une session Supabase.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: true }) }))

// Les cartes voisines font leurs propres lectures et n'ont rien à voir avec ce qu'on garde.
vi.mock('./VehiculesCard', () => ({ default: () => null }))
vi.mock('./SauvegardeCard', () => ({ default: () => null }))
vi.mock('./BalanceCard', () => ({ default: () => null }))
vi.mock('../../lib/packGenerator', () => ({
  generatePack: () => Promise.resolve({
    nbPieces: 4, storagePathZip: 'd1/p/pack.zip', storagePathExcel: 'd1/p/recap.xlsx',
    totalTtc: 1200, manquantes: [],
  }),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        update: () => chaine,
        insert: () => Promise.resolve({ error: null }),
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

function monter() {
  return render(
    <InformationsTab
      dossierId="d1"
      dossierNom="Cabinet Martin"
      dossierSiret={null}
      dossierAdresse={null}
      onIdentiteUpdated={() => {}}
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
