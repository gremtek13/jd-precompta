import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ImportDossierModal from './ImportDossierModal'

// L'écran où le défaut a RÉELLEMENT eu lieu : deux clics rapprochés sur « Importer » faisaient
// entrer deux exécutions dans lancerImport(), chacune repartant avec SON ensemble d'empreintes
// (chargerHashsExistants est appelé une fois par exécution) — deux boucles parallèles aveugles
// l'une à l'autre. Constaté sur un import réel : 141 lignes pour 78 fichiers.
//
// Le test porte donc sur le nombre d'appels à chargerHashsExistants autant que sur celui des
// imports : c'est ce jeu d'empreintes dupliqué qui rendait le dédoublonnage inopérant.
const faux = vi.hoisted(() => ({
  chargerHashs: vi.fn(),
  importer: vi.fn(),
  resoudreHashs: null as null | (() => void),
  rejeterHashs: null as null | ((e: unknown) => void),
}))

vi.mock('../../lib/importFichiers', () => ({
  estFichierSupporte: () => Promise.resolve(true),
  chargerHashsExistants: (...args: unknown[]) => {
    faux.chargerHashs(...args)
    // Laissée en attente : c'est la fenêtre réelle pendant laquelle le second clic arrive.
    return new Promise((resoudre, rejeter) => {
      faux.resoudreHashs = () => resoudre(new Set<string>())
      faux.rejeterHashs = rejeter
    })
  },
  importerFichierDossier: (...args: unknown[]) => {
    faux.importer(...args)
    return Promise.resolve({ statut: 'ok', message: 'Importé' })
  },
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'utilisateur-de-test' } } }) } },
}))

describe('ImportDossierModal', () => {
  it("n'importe qu'une fois quand « Importer » est cliqué deux fois de suite", async () => {
    render(
      <ImportDossierModal
        dossierId="dossier-de-test"
        sousDossiers={[]}
        onClose={() => {}}
        onImported={() => {}}
      />,
    )

    const champ = document.getElementById('dossier') as HTMLInputElement
    await act(async () => {
      fireEvent.change(champ, { target: { files: [new File(['x'], 'facture.pdf', { type: 'application/pdf' })] } })
    })

    // Les deux clics dans le MÊME `act` : deux `fireEvent.click` de suite rendraient le composant
    // entre les deux, donc le second tomberait sur un bouton déjà `disabled={running}` — le test
    // resterait vert avec le défaut réinstallé (voir VehiculesCard.test.tsx).
    const bouton = screen.getByRole('button', { name: /Importer 1 fichier/ })
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.chargerHashs).toHaveBeenCalledTimes(1)
    expect(faux.importer).not.toHaveBeenCalled()

    await act(async () => { faux.resoudreHashs?.() })
    expect(faux.importer).toHaveBeenCalledTimes(1)
  })
})

// UN IMPORT QUI ÉCHOUE AVANT LA BOUCLE ANNONÇAIT « 0 EN ERREUR ».
//
// `chargerHashsExistants` LÈVE délibérément quand les empreintes ne peuvent pas se dire complètes
// (lib/importFichiers). Ce `try` n'avait aucun `catch` : l'exception s'échappait d'un gestionnaire
// d'`onClick`, que personne n'attend — rejet non capturé, aucun message — et le `finally` posait
// quand même `done`. Or le résumé ne s'affiche QUE si `done` : l'écran écrivait alors
// « 0 importé(s), 0 déjà importé(s), 0 en erreur », c'est-à-dire une bonne nouvelle fabriquée
// (CLAUDE.md, « le vide est une AFFIRMATION ») au moment précis où tout avait échoué.
describe('ImportDossierModal — un échec avant la boucle', () => {
  it("nomme la cause et n'annonce pas « 0 en erreur »", async () => {
    render(
      <ImportDossierModal
        dossierId="dossier-de-test"
        sousDossiers={[]}
        onClose={() => {}}
        onImported={() => {}}
      />,
    )
    const champ = document.getElementById('dossier') as HTMLInputElement
    await act(async () => {
      fireEvent.change(champ, { target: { files: [new File(['x'], 'facture.pdf', { type: 'application/pdf' })] } })
    })
    await act(async () => { screen.getByRole('button', { name: /Importer 1 fichier/ }).click() })
    await act(async () => { faux.rejeterHashs?.(new Error('Empreintes illisibles')) })

    expect(screen.getByText(/Empreintes illisibles/)).toBeTruthy()
    expect(screen.queryByText(/0 en erreur/)).toBeNull()
    // `done` n'est observable que par le libellé du bouton de gauche.
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy()
    // Le verrou est relâché : le bouton d'import est toujours là et repart.
    await act(async () => { screen.getByRole('button', { name: /Importer 1 fichier/ }).click() })
    expect(faux.chargerHashs).toHaveBeenCalledTimes(2)
  })

  // GARDE SYMÉTRIQUE — sans lui, « pas de 0 en erreur » serait satisfait par un écran qui n'affiche
  // jamais son résumé, et « la cause est nommée » par un écran qui crie toujours à l'erreur.
  it('affiche bien son résumé quand l’import aboutit', async () => {
    faux.chargerHashs.mockClear()
    render(
      <ImportDossierModal
        dossierId="dossier-de-test"
        sousDossiers={[]}
        onClose={() => {}}
        onImported={() => {}}
      />,
    )
    const champ = document.getElementById('dossier') as HTMLInputElement
    await act(async () => {
      fireEvent.change(champ, { target: { files: [new File(['x'], 'facture.pdf', { type: 'application/pdf' })] } })
    })
    await act(async () => { screen.getByRole('button', { name: /Importer 1 fichier/ }).click() })
    await act(async () => { faux.resoudreHashs?.() })

    expect(screen.getByText(/1 importé\(s\), 0 déjà importé\(s\), 0 en erreur/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy()
  })
})
