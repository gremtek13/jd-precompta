import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ValidationExerciceCard from './ValidationExerciceCard'
import type { EtatDeValidation } from '../../lib/prealablesValidation'
import type { DemandeDeValidation } from '../../lib/validationExercice'
import type { ReportDesSoldes } from '../../lib/reportDesSoldes'
import { exerciceValide } from '../../test/exerciceValide'
import { formatMoney } from '../../lib/format'

// LA CARTE SEULE, sur ce que Clôture ne peut pas montrer : son verrou tenu jusqu'à la fin de la relecture, et les
// renvois de ses préalables. Le câblage dans Clôture — ce qui part à la base, l'exercice validé relu — est gardé
// par ClotureTab.test.tsx.
const faux = vi.hoisted(() => ({ appels: [] as string[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string) => {
      faux.appels.push(nom)
      return Promise.resolve({ data: { annee: 2025, ecritures: 1, lignes: 2 }, error: null })
    },
  },
}))

const DEMANDE: DemandeDeValidation = {
  p_lignes: [
    { id: 'e1', journal: 'AC', numero: 1, piece_ref: 'facture.pdf', piece_date: '2025-03-10', compte_lib: 'Achats', comp_aux_num: null, comp_aux_lib: null },
    { id: 'e2', journal: 'AC', numero: 1, piece_ref: 'facture.pdf', piece_date: '2025-03-10', compte_lib: 'Banque', comp_aux_num: null, comp_aux_lib: null },
  ],
  p_a_nouveaux: [],
  p_declaration: null,
}
const VALIDABLE: EtatDeValidation = { prealables: [], numerotation: null, report: null, validable: true }

describe('ValidationExerciceCard', () => {
  // Relâché avant la relecture, le verrou rendrait le bouton pendant que l'écran relit encore l'exercice : la carte
  // proposerait de valider un exercice qui vient de l'être, et la base refuserait le second clic.
  it('tient son verrou jusqu’à la fin de la relecture', async () => {
    faux.appels = []
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let relacher!: () => void
    const relecture = new Promise<void>((r) => { relacher = r })
    render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={null} etat={VALIDABLE} demande={DEMANDE} reportesEcrits={null} estChef
        onValide={() => relecture}
      />,
    )
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(faux.appels).toEqual(['valider_exercice'])
    const pendant = screen.getByRole('button', { name: 'Validation…' }) as HTMLButtonElement
    expect(pendant.disabled).toBe(true)
    await act(async () => { fireEvent.click(pendant) })
    expect(faux.appels).toEqual(['valider_exercice'])
    await act(async () => { relacher() })
    expect((screen.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(false)
  })

  // Un préalable d'ordre mène à l'exercice qui se valide d'abord ; un préalable qui se lève dans un autre onglet y
  // mène ; un préalable qui se lit ici ne mène nulle part.
  it('mène à l’exercice qu’un préalable réclame, et à l’onglet où lever les autres', () => {
    const onChoisirExercice = vi.fn()
    const onNavigate = vi.fn()
    const etat: EtatDeValidation = {
      validable: false, numerotation: null, report: null,
      prealables: [
        { id: 'ordre', nb: null, cible: 'cloture', bloquant: true, exercice: 2024, message: "L'exercice 2024 n'est pas validé." },
        { id: 'mouvements-a-traiter', nb: null, cible: 'banque', bloquant: true, message: 'Des mouvements restent à traiter.' },
        { id: 'exercice-en-cours', nb: null, cible: 'cloture', bloquant: true, message: "L'exercice n'est pas terminé." },
      ],
    }
    render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={null} etat={etat} demande={null} reportesEcrits={null} estChef onValide={async () => {}}
        onNavigate={onNavigate} onChoisirExercice={onChoisirExercice}
      />,
    )
    const boutons = (texte: RegExp) => within(screen.getByText(texte).closest('li') as HTMLElement).queryAllByRole('button').map((b) => b.textContent)
    expect(boutons(/n'est pas validé/)).toEqual(['Exercice 2024'])
    expect(boutons(/restent à traiter/)).toEqual(['Banque'])
    expect(boutons(/n'est pas terminé/)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Exercice 2024' }))
    expect(onChoisirExercice).toHaveBeenCalledWith(2024)
    fireEvent.click(screen.getByRole('button', { name: 'Banque' }))
    expect(onNavigate).toHaveBeenCalledWith('banque')
    expect((screen.getByRole('button', { name: 'Valider l’exercice 2025' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// LE REPORT DES SOLDES (ligne 34) : la validation écrit l'ouverture de l'exercice suivant dans le même clic. La carte la
// montre avant — c'est ce qui se figera —, la confirmation la nomme, et un exercice validé dit celle qu'il a écrite. Le
// calcul est dans lib/reportDesSoldes.ts ; ce qui se joue ici est ce que la carte en dit.
describe('ValidationExerciceCard — l’ouverture de l’exercice suivant', () => {
  function report(o: Partial<ReportDesSoldes> = {}): ReportDesSoldes {
    return {
      exercice: 2025, date: '2026-01-01', source: 'Exercice 2025 validé', individuel: true, resultat: 2760,
      soldes: [
        { compte: '101000', libelle: 'Capital individuel', sens: 'credit', montant: 3360 },
        { compte: '218300', libelle: 'Matériel de bureau et informatique', sens: 'debit', montant: 1200 },
        { compte: '281830', libelle: 'Amortissements du matériel de bureau', sens: 'credit', montant: 640 },
        { compte: '512000', libelle: 'Banque', sens: 'debit', montant: 2800 },
      ],
      horsClasses: [], ecartCentimes: 0, totalDebit: 4000, totalCredit: 4000, ...o,
    }
  }
  function monter(r: ReportDesSoldes | null, validable = true) {
    const etat: EtatDeValidation = { prealables: [], numerotation: null, report: r, validable }
    return render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={null} etat={etat} demande={validable ? DEMANDE : null} reportesEcrits={null} estChef
        onValide={async () => {}}
      />,
    )
  }

  it('montre ce que la validation écrira, et ce que deviennent le compte de l’exploitant et le résultat', () => {
    monter(report())

    expect(screen.getByText('L’ouverture de l’exercice 2026')).toBeTruthy()
    // La bibliothèque compare au texte normalisé (blancs réduits à une espace) : l'attendu l'est aussi.
    expect(screen.getByText((
      `La validation l’écrit dans le même geste : 4 soldes reportés au 01/01/2026, ${formatMoney(4000)} au débit comme au crédit. `
        + `Entreprise individuelle : le compte de l’exploitant (108) et le bénéfice de l’exercice (${formatMoney(2760)}) passent au `
        + 'capital individuel (101000), comme le prévoit le plan comptable (art. 941-10) : l’exercice 2026 repart d’un compte '
        + 'de l’exploitant vide.').replace(/\s+/g, ' '),
    )).toBeTruthy()
    const lignes = [...document.querySelectorAll('.apercu-report tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))
    expect(lignes).toEqual([
      ['101000', 'Capital individuel', '—', formatMoney(3360)],
      ['218300', 'Matériel de bureau et informatique', formatMoney(1200), '—'],
      ['281830', 'Amortissements du matériel de bureau', '—', formatMoney(640)],
      ['512000', 'Banque', formatMoney(2800), '—'],
    ])
  })

  it('dit la perte d’une entreprise individuelle, au capital individuel aussi', () => {
    monter(report({ resultat: -500 }))
    expect(screen.getByText(/le compte de l’exploitant \(108\) et la perte de l’exercice \(500,00\s€\) passent au capital individuel/)).toBeTruthy()
  })

  it('n’invente pas de résultat quand il est nul', () => {
    monter(report({ resultat: 0 }))
    expect(screen.getByText(/Entreprise individuelle : le compte de l’exploitant \(108\) passe au capital individuel/)).toBeTruthy()
    expect(screen.queryAllByText(/bénéfice|perte/)).toHaveLength(0)
  })

  it('laisse le résultat d’une société en attente d’affectation, en 120000 ou en 129000', () => {
    const { unmount } = monter(report({ individuel: false, resultat: 2760 }))
    expect(screen.getByText(/Le bénéfice de l’exercice \(2\s760,00\s€\) est reporté en 120000, en attente d’affectation : l’affecter reste un geste du cabinet\./)).toBeTruthy()
    expect(screen.queryAllByText(/capital individuel \(101000\), comme/)).toHaveLength(0)
    unmount()
    monter(report({ individuel: false, resultat: -800 }))
    expect(screen.getByText(/La perte de l’exercice \(800,00\s€\) est reportée en 129000/)).toBeTruthy()
  })

  it('dit qu’un exercice dont tous les comptes sont soldés n’écrira pas d’ouverture', () => {
    monter(report({ soldes: [], resultat: 0, totalDebit: 0, totalCredit: 0 }))
    expect(screen.getByText('Tous les comptes de bilan sont soldés au 31/12/2025 : l’exercice 2026 s’ouvrira sans soldes reportés.')).toBeTruthy()
    expect(screen.queryAllByText('Voir les soldes reportés')).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : tant qu'un préalable bloque, rien ne s'écrira — l'aperçu d'une ouverture qui ne viendra pas ferait
  // croire le contraire.
  it('ne montre rien tant qu’un préalable empêche de valider', () => {
    monter(report(), false)
    expect(screen.queryAllByText('L’ouverture de l’exercice 2026')).toHaveLength(0)
  })

  it('nomme l’ouverture dans la confirmation', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter(report())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(confirmer.mock.calls[0][0]).toContain(
      "3. L'ouverture de l'exercice 2026 s'écrit dans le même geste, et ne se modifiera pas : 4 solde(s) reporté(s) au 01/01/2026, "
        + "le compte de l'exploitant et le résultat passant au capital individuel (101000).",
    )
    confirmer.mockRestore()
  })

  it('nomme dans la confirmation le résultat d’une société, et l’ouverture vide', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { unmount } = monter(report({ individuel: false, resultat: -800 }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(confirmer.mock.calls[0][0]).toContain("au 01/01/2026, le résultat en attente d'affectation en 129000.")
    unmount()
    monter(report({ soldes: [], resultat: 0, totalDebit: 0, totalCredit: 0 }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider l’exercice 2025' })) })
    expect(confirmer.mock.calls[1][0]).toContain("3. Tous les comptes de bilan étant soldés, l'exercice 2026 s'ouvrira sans soldes reportés.")
    confirmer.mockRestore()
  })

  it('dit, sur un exercice validé, l’ouverture que sa validation a écrite', () => {
    const { unmount } = render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={exerciceValide(2025)} etat={null} demande={null} reportesEcrits={4} estChef
        onValide={async () => {}}
      />,
    )
    expect(screen.getByText('Sa validation a écrit l’ouverture de l’exercice 2026 : 4 soldes reportés au 01/01/2026, qui ouvrent son FEC (journal AN) et sa balance.')).toBeTruthy()
    unmount()
    const { unmount: demonter } = render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={exerciceValide(2025)} etat={null} demande={null} reportesEcrits={0} estChef
        onValide={async () => {}}
      />,
    )
    expect(screen.getByText('Tous ses comptes de bilan étaient soldés au 31/12/2025 : l’exercice 2026 s’ouvre sans soldes reportés.')).toBeTruthy()
    demonter()
    // Lus en partie, les soldes reportés ne se comptent pas : la carte se tait plutôt que de dire un compte faux.
    render(
      <ValidationExerciceCard
        dossierId="d1" annee={2025} valide={exerciceValide(2025)} etat={null} demande={null} reportesEcrits={null} estChef
        onValide={async () => {}}
      />,
    )
    expect(screen.getByText(/Validé le/)).toBeTruthy()
    expect(screen.queryAllByText(/soldes reportés|ouverture de l’exercice 2026/)).toHaveLength(0)
  })
})
