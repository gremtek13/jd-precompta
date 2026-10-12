import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AjouterDocumentsModal from './AjouterDocumentsModal'

// ONZIÈME PORTEUR DU MOTIF, ET LE JUMEAU EXACT DU DÉFAUT D'ORIGINE (voir ImportDossierModal.test).
//
// Même mécanique, à un détail près qui la rend plus fine à voir : le bouton n'est pas `disabled`,
// il est RENDU SOUS CONDITION — `{peutImporter && !running && <button …>}`. `running` étant un état
// React, les deux clics du même rendu voient tous deux le bouton présent, et deux exécutions
// entrent dans `lancerImport`. Chacune repart avec SON ensemble d'empreintes
// (`chargerHashsExistants` est appelé une fois par exécution) : deux boucles parallèles aveugles
// l'une à l'autre, donc un dédoublonnage qui ne rattrape que les paires où le minutage joue en sa
// faveur — 141 lignes pour 78 fichiers sur l'import réel qui a fait naître cette famille.
//
// ET C'EST PIRE ICI QU'À L'ORIGINE : `ImportDossierModal` importe une arborescence entière, geste
// rare et délibéré ; celui-ci est le POINT D'ENTRÉE UNIQUE ouvert depuis Pièces comme depuis
// Documents, donc le geste quotidien.
//
// POURQUOI LE BALAYAGE DU 20/09/2026 NE L'A PAS VU : il cherchait `.insert(` / `functions.invoke` /
// `storage…upload` dans le CORPS du gestionnaire. Ici ces écritures vivent dans
// `importerFichierDossier` (src/lib), donc hors du corps — seconde forme de la même panne qu'a
// révélée `FactureFormModal` par la porte `.rpc(`.
const faux = vi.hoisted(() => ({
  chargerHashs: vi.fn(),
  importer: vi.fn(),
  resoudreHashs: null as null | (() => void),
  rejeterHashs: null as null | ((e: unknown) => void),
}))

// Ce que la fenêtre écarte au choix se juge par les VRAIES bornes du seau (lib/bornesStockage.ts, ligne 22.6).
vi.mock('../../lib/importFichiers', () => ({
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

async function monterAvecUnFichier() {
  faux.chargerHashs.mockClear()
  faux.importer.mockClear()
  faux.resoudreHashs = null
  faux.rejeterHashs = null
  render(
    <AjouterDocumentsModal
      dossierId="dossier-de-test"
      sousDossiers={[]}
      onClose={() => {}}
      onImported={() => {}}
    />,
  )
  // Le champ est caché dans son `<label>` et n'a pas d'id : on le désigne par son type plutôt que
  // d'en ajouter un à la production pour le seul confort du test.
  const champ = document.querySelector('input[type=file]') as HTMLInputElement
  await act(async () => {
    fireEvent.change(champ, { target: { files: [new File(['x'], 'facture.pdf', { type: 'application/pdf' })] } })
  })
  return screen.getByRole('button', { name: /Importer 1 fichier/ })
}

describe('AjouterDocumentsModal — le verrou d’import', () => {
  it("ne charge qu'un seul jeu d'empreintes quand « Importer » part deux fois de suite", async () => {
    const bouton = await monterAvecUnFichier()

    // Les deux clics dans le MÊME `act` : deux `.click()` successifs rendraient le composant entre
    // les deux, donc le second tomberait sur un bouton déjà retiré du rendu — le test resterait VERT
    // avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    // C'est le jeu d'empreintes DUPLIQUÉ qui rend le dédoublonnage inopérant : l'assertion porte
    // donc sur lui autant que sur le nombre d'imports.
    expect(faux.chargerHashs).toHaveBeenCalledTimes(1)

    await act(async () => { faux.resoudreHashs?.() })
    expect(faux.importer).toHaveBeenCalledTimes(1)
  })

  // IL FAUT TROIS CLICS pour distinguer un verrou posé AVANT le `try` d'un verrou posé dedans : si
  // la pose vivait dans le `try`, le `return` du deuxième sortirait par le `finally`, qui relâcherait
  // le verrou du PREMIER, encore en cours.
  it('un troisième clic ne relance pas un second import', async () => {
    const bouton = await monterAvecUnFichier()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.chargerHashs).toHaveBeenCalledTimes(1)
    await act(async () => { faux.resoudreHashs?.() })
    expect(faux.importer).toHaveBeenCalledTimes(1)
  })

  // LE VERROU DOIT ÊTRE RELÂCHÉ, et il n'y a qu'UN chemin où l'import se rejoue dans le même
  // montage — c'est celui de l'échec. `chargerHashsExistants` LÈVE sur une lecture tronquée ou
  // refusée (un dédoublonnage incomplet vaut moins que pas de dédoublonnage, CLAUDE.md) ; les
  // fichiers restent alors « en attente », donc `peutImporter` redevient vrai et le bouton revient.
  // Un verrou resté pris ferait de ce bouton-là un bouton qui ne fait VISIBLEMENT RIEN, sans un
  // message, au moment précis où réessayer est le geste naturel.
  //
  // (Reprendre un SECOND LOT n'est pas producible : la zone de dépôt est masquée par `done`, donc
  // ajouter d'autres fichiers demande de rouvrir la modale — ce qui remonte le composant et remet
  // le `useRef` à zéro de toute façon.)
  it('relâche le verrou quand le chargement des empreintes échoue, pour laisser réessayer', async () => {
    const bouton = await monterAvecUnFichier()
    await act(async () => { bouton.click() })
    expect(faux.chargerHashs).toHaveBeenCalledTimes(1)

    await act(async () => { faux.rejeterHashs?.(new Error('Lecture des empreintes refusée')) })
    expect(faux.importer).not.toHaveBeenCalled()

    // LA CAUSE EST NOMMÉE, ET L'ÉCRAN NE SE DÉCLARE PAS TERMINÉ. Sans `catch`, l'exception
    // s'échappait d'un gestionnaire d'`onClick` — rejet non capturé, aucun message — pendant que le
    // `finally` posait `done`, donc l'affichage de fin. Le libellé du bouton de gauche est le seul
    // signal observable de `done` : « Fermer » au lieu d'« Annuler ».
    expect(screen.getByText(/Lecture des empreintes refusée/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: /Importer 1 fichier/ }).click() })
    expect(faux.chargerHashs).toHaveBeenCalledTimes(2)
  })

  // GARDE SYMÉTRIQUE — sans lui, « on n'importe qu'une fois » serait satisfait par un écran qui
  // n'importe JAMAIS.
  it('importe bien le fichier quand on clique une seule fois', async () => {
    const bouton = await monterAvecUnFichier()
    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreHashs?.() })
    expect(faux.importer).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Importé')).toBeTruthy()
    // GARDE SYMÉTRIQUE de l'assertion ci-dessus : sans lui, « l'écran ne se déclare pas terminé »
    // serait satisfait par un écran qui ne se déclare JAMAIS terminé, et « la cause est nommée » par
    // un écran qui crie à l'erreur sur un import parfaitement réussi.
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeTruthy()
    // L'assertion porte sur la phrase que le paragraphe d'erreur porte TOUJOURS, pas sur le repli
    // de `messageErreur` : ce repli n'apparaît que si `erreur` est renseigné, donc le viser
    // laisserait passer un paragraphe affiché en permanence avec un message vide (mutation M8).
    expect(screen.queryByText(/Aucun fichier n'a été importé/)).toBeNull()
  })
})

// LES BORNES DU SEAU DES PIÈCES (ligne 22.6). Ce que le seau refuserait est écarté AU CHOIX, avant tout envoi, et le
// bilan le dit sans nom de fichier : combien, et pourquoi — le format, ou le poids de chacun face à la borne. Jusqu'ici un
// lot dont rien n'était retenu ne disait RIEN : la ligne du bilan ne s'affichait qu'avec au moins un fichier retenu.
describe('AjouterDocumentsModal — les bornes du seau', () => {
  const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])

  async function choisir(fichiers: File[]) {
    faux.importer.mockClear()
    render(<AjouterDocumentsModal dossierId="dossier-de-test" sousDossiers={[]} onClose={() => {}} onImported={() => {}} />)
    const champ = document.querySelector('input[type=file]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: fichiers } }) })
  }

  it('écarte au choix ce que le seau refuserait, compte chaque raison, et n’importe que le reste', async () => {
    const lourd = new File(['%PDF-1.7'], 'scan.pdf', { type: 'application/pdf' })
    Object.defineProperty(lourd, 'size', { value: 25 * 1024 * 1024 })
    await choisir([new File([HEIC], 'photo.heic'), lourd, new File(['%PDF-1.7'], 'facture.pdf', { type: 'application/pdf' })])

    const bilan = [...document.querySelectorAll('p.muted')].map((p) => p.textContent).find((t) => t?.startsWith('1 fichier(s)'))
    expect(bilan).toBe('1 fichier(s) — 2 ignoré(s) : 1 au format non pris en charge ; 1 au-delà de 20\u00a0Mo (25\u00a0Mo)')
    expect(screen.queryByText('photo.heic')).toBeNull()
    expect(screen.queryByText('scan.pdf')).toBeNull()
    expect(screen.getByText('facture.pdf')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importer 1 fichier(s)' })).toBeTruthy()
  })

  it('un lot dont rien n’est retenu le dit, au lieu de se taire', async () => {
    await choisir([new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })])
    expect(screen.getByText(/Aucun fichier retenu/).textContent).toBe('Aucun fichier retenu — 1 ignoré(s) : 1 au format non pris en charge.')
    expect(screen.queryByRole('button', { name: /Importer/ })).toBeNull()
  })

  it('la zone de dépôt dit la borne avant le choix, et le champ ne propose que les formats du seau', async () => {
    render(<AjouterDocumentsModal dossierId="dossier-de-test" sousDossiers={[]} onClose={() => {}} onImported={() => {}} />)
    expect(document.querySelector('.dropzone')?.textContent).toContain('(PDF, JPG, PNG, CSV — 20\u00a0Mo au plus par fichier)')
    expect(document.querySelector('input[type=file]')?.getAttribute('accept')).toBe('.pdf,.jpg,.jpeg,.png,.csv')
  })
})
