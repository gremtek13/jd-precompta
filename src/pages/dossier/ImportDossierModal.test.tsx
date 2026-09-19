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
}))

vi.mock('../../lib/importFichiers', () => ({
  estFichierSupporte: () => Promise.resolve(true),
  chargerHashsExistants: (...args: unknown[]) => {
    faux.chargerHashs(...args)
    // Laissée en attente : c'est la fenêtre réelle pendant laquelle le second clic arrive.
    return new Promise((resoudre) => {
      faux.resoudreHashs = () => resoudre(new Set<string>())
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
