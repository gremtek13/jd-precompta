import { act, fireEvent, render, screen } from '@testing-library/react'
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
  window.open = ((url: string) => { faux.ouvertures.push(url); return null }) as typeof window.open
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
    expect(screen.getByText(/lien de téléchargement n'a pas pu être créé/)).toBeTruthy()
    // La RAISON, et la sortie : sans « onglet Packs », le message dit seulement qu'on a perdu.
    expect(screen.getByText(/objet introuvable/)).toBeTruthy()
    expect(screen.getByText(/onglet Packs/)).toBeTruthy()
  })
})
