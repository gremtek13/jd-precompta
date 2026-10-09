import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VoletSocialCard from './VoletSocialCard'
import type { VoletSocialPamc } from '../../lib/types'

// LE CALCUL EST DANS `lib/voletSocialPamc.ts`, TESTÉ CONTRE LE MOTEUR DE L'URSSAF — CE QUI SE JOUE
// ICI EST LA SAISIE GARDÉE. Trois choses qu'aucun test du module ne peut voir : une lecture ratée ne
// doit pas laisser un formulaire vide qu'« Enregistrer » écrirait par-dessus les chiffres du SNIR
// (la famille « lecture → formulaire → écriture de tous les champs », payée trois fois ailleurs) ;
// deux clics rapprochés n'écrivent qu'une fois ; et l'écran passe au calcul les montants du
// FORMULAIRE, à l'euro, pas ceux du tableau.
const faux = vi.hoisted(() => ({
  ligne: null as unknown,
  lectureRefusee: false,
  enregistrements: [] as { valeurs: Record<string, unknown>; options: unknown }[],
  // Non nul : l'enregistrement attend qu'on le libère, pour éprouver le verrou.
  suspendu: null as null | { liberer: () => void },
  enregistrementRefuse: false,
  // La ligne de chaque exercice, quand un test en distingue plusieurs (sinon `ligne`), et une lecture retenue jusqu'à ce
  // que le test la libère : c'est ainsi qu'on regarde la carte PENDANT la lecture d'un autre exercice.
  parAnnee: {} as Record<number, unknown>,
  porte: null as Promise<void> | null,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'volet_social_pamc') throw new Error(`table inattendue : ${table}`)
      let annee: number | null = null
      const lecture = {
        select: () => lecture,
        eq: (colonne: string, valeur: unknown) => { if (colonne === 'annee') annee = Number(valeur); return lecture },
        maybeSingle: () => {
          const repondre = () => (faux.lectureRefusee
            ? { data: null, error: { message: 'JWT expired' } }
            : { data: annee !== null && annee in faux.parAnnee ? faux.parAnnee[annee] : faux.ligne, error: null })
          return faux.porte ? faux.porte.then(repondre) : Promise.resolve(repondre())
        },
      }
      return {
        ...lecture,
        upsert: (valeurs: Record<string, unknown>, options: unknown) => {
          faux.enregistrements.push({ valeurs, options })
          const suite = {
            select: () => suite,
            single: () => new Promise((resoudre) => {
              const repondre = () => resoudre(faux.enregistrementRefuse
                ? { data: null, error: { message: 'new row violates row-level security policy' } }
                : { data: { id: 'v1', ...valeurs }, error: null })
              if (faux.suspendu) faux.suspendu.liberer = repondre
              else repondre()
            }),
          }
          return suite
        },
      }
    },
  },
}))

// Une 2035 dont le formulaire porte 80 000 € de recettes (AD) et 60 000 € de bénéfice (CP), donc
// autant de revenu brut social (DD) : le cas que le moteur de l'Urssaf chiffre à 4 646 €.
const VALEURS = new Map([['AA', 80_000], ['BA', 20_000]])

function ligne(o: Partial<VoletSocialPamc> = {}): VoletSocialPamc {
  return {
    id: 'v1', dossier_id: 'd', annee: 2025, profession: null, remplacant: false,
    recettes_brutes: null, honoraires_conventionnes: null, depassements: null, recettes_structures: null,
    ...o,
  }
}

async function afficher(blocage: string | null = null) {
  render(<VoletSocialCard dossierId="d" annee={2025} valeurs={VALEURS} blocage={blocage} />)
  await act(async () => {})
}

const saisir = (libelle: RegExp, valeur: string) =>
  fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } })

beforeEach(() => {
  faux.ligne = null
  faux.lectureRefusee = false
  faux.enregistrements = []
  faux.suspendu = null
  faux.enregistrementRefuse = false
  faux.parAnnee = {}
  faux.porte = null
})

describe('le volet social d’un praticien conventionné', () => {
  it('une lecture refusée n’offre aucun formulaire à enregistrer par-dessus', async () => {
    faux.lectureRefusee = true
    await afficher()
    expect(screen.getByText(/n'ont pas pu être lus \(JWT expired\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    expect(screen.queryByLabelText(/Honoraires conventionnés/)).toBeNull()
  })

  it('sans saisie, propose la ligne 4 de la 2035-A et ne chiffre rien sans profession', async () => {
    await afficher()
    expect(screen.getByText('proposées : ligne 4 de la 2035-A')).toBeTruthy()
    expect(screen.getByText('80 000 €')).toBeTruthy()
    expect(screen.getByText('Choisissez la profession pour estimer les cotisations.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('chiffre une infirmière conventionnée comme le moteur de l’Urssaf', async () => {
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    expect(screen.getByText('1,00')).toBeTruthy()
    expect(screen.getByText('44 400 €')).toBeTruthy()
    expect(screen.getByText('4 307 €')).toBeTruthy()
    expect(screen.getByText('4 646 €')).toBeTruthy()
  })

  // UN MONTANT NE SE COUPE PAS EN FIN DE LIGNE. `formaterMontant`, fait pour le PDF de la 2035 (pdf-lib n'écrit que du WinAnsi),
  // sépare les milliers par des espaces ORDINAIRES : « 60 000 » restait au bout d'une ligne et « € » passait à la suivante. L'écran
  // écrit comme `formatMoney` — espace fine insécable entre les milliers, insécable avant l'euro —, mais à l'euro, comme le
  // formulaire. `getByText` ramène toute espace, insécable comprise, à une espace ordinaire : seul `textContent` voit la
  // différence, et c'est lui que ce test lit.
  it('écrit chaque montant avec des espaces insécables, pour qu’aucun ne se coupe en fin de ligne', async () => {
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    const cellules = (repere: string | RegExp) =>
      within(screen.getByText(repere).closest('tr')!).getAllByRole('cell').map((c) => c.textContent)
    expect(cellules('DSCS').at(-1)).toBe('80\u202f000\u00a0€')
    expect(cellules('DSAV').at(-1)).toBe('80\u202f000\u00a0€')
    expect(cellules(/^Assiette/)).toEqual([
      'Assiette : revenu brut social 60\u202f000\u00a0€, moins l\'abattement de 26 % (15\u202f600\u00a0€)',
      '44\u202f400\u00a0€',
    ])
    expect(cellules('Total à la charge du praticien').at(-1)).toBe('4\u202f646\u00a0€')
    // Et aucun montant de la carte n'a gardé une espace ordinaire, entre ses milliers ou avant l'euro.
    const texte = document.body.textContent ?? ''
    expect(texte).not.toMatch(/ €/)
    expect(texte).not.toMatch(/\d \d{3}(?!\d)/)
  })

  it('sépare chaque millier par une insécable, pas le premier seulement', async () => {
    // Deux séparateurs : une substitution qui n'en changerait qu'un laisserait « 1 234 567 » se couper au milieu.
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={new Map([['AA', 1_234_567], ['BA', 0]])} blocage={null} />)
    await act(async () => {})
    expect(within(screen.getByText('DSCS').closest('tr')!).getAllByRole('cell').at(-1)!.textContent).toBe('1\u202f234\u202f567\u00a0€')
  })

  it('ne rend pas de ratio quand les honoraires dépassent les recettes, et dit pourquoi', async () => {
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '90000')
    expect(screen.getAllByText(/dépassent les recettes totales/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Total à la charge du praticien')).toBeNull()
  })

  it('enregistre la saisie une seule fois, même sur trois clics rapprochés', async () => {
    faux.suspendu = { liberer: () => {} }
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    const bouton = screen.getByRole('button', { name: 'Enregistrer' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.enregistrements).toHaveLength(1)
    expect(faux.enregistrements[0]).toEqual({
      valeurs: {
        dossier_id: 'd', annee: 2025, profession: 'auxiliaire_medical', remplacant: false,
        recettes_brutes: null, honoraires_conventionnes: 80_000, depassements: null, recettes_structures: null,
      },
      options: { onConflict: 'dossier_id,annee' },
    })
    await act(async () => { faux.suspendu!.liberer() })
    expect(screen.getByText('Enregistré.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un enregistrement refusé le dit, et laisse réessayer', async () => {
    faux.enregistrementRefuse = true
    await afficher()
    saisir(/Honoraires conventionnés/, '80000')
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(screen.getByText('new row violates row-level security policy')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(faux.enregistrements).toHaveLength(2)
  })

  it('reprend ce qui est enregistré, sans rien à réenregistrer', async () => {
    faux.ligne = ligne({ profession: 'sage_femme', honoraires_conventionnes: 80_000, recettes_brutes: 80_000 })
    await afficher()
    expect((screen.getByLabelText(/Honoraires conventionnés/) as HTMLInputElement).value).toBe('80000')
    expect(screen.getByText('saisies')).toBeTruthy()
    expect(screen.getByText('4 646 €')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refuse un montant négatif', async () => {
    await afficher()
    saisir(/Dépassements/, '-5')
    expect(screen.getByText('Un montant ne peut pas être négatif.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('calcule sur les montants du formulaire, à l’euro, pas sur ceux du tableau', async () => {
    // Au centime, le revenu brut social vaut 59 999,80 € ; le formulaire, qui arrondit chaque case
    // AVANT de totaliser, porte 80 000 − 20 001 = 59 999 €. C'est ce second chiffre que
    // l'administration préremplit, donc celui dont l'Urssaf partira.
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={new Map([['AA', 80_000.4], ['BA', 20_000.6]])} blocage={null} />)
    await act(async () => {})
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    expect(screen.getByText(/revenu brut social 59 999 €/)).toBeTruthy()
  })

  it('pas de CURPS sans bénéfice, même quand le revenu brut social est positif', async () => {
    // Déficit de 5 000 € (CR), mais 10 000 € de charges sociales personnelles (BK) que l'assiette ne
    // déduit pas : revenu brut social de 5 000 €, assiette de 3 700 €. Sans revenu professionnel,
    // la CURPS n'est pas due — sinon 4 €.
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={new Map([['AA', 50_000], ['BA', 45_000], ['BK', 10_000]])} blocage={null} />)
    await act(async () => {})
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '50000')
    expect(screen.getByText('3 700 €')).toBeTruthy()
    const curps = screen.getByText(/^CURPS/).closest('tr')!
    expect(curps.textContent).toMatch(/0\u00a0€$/)
  })

  it('un revenu faible prend l’abattement minimal, et ne le dit pas « de 26 % »', async () => {
    // 10 000 € de recettes, 9 000 € de dépenses : 1 000 € de revenu brut social, dont 26 % (260 €)
    // passent sous le plancher de 829 € — l'assiette tombe à 171 €.
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={new Map([['AA', 10_000], ['BA', 9_000]])} blocage={null} />)
    await act(async () => {})
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '10000')
    const assiette = screen.getByText(/^Assiette/).closest('tr')!
    expect(assiette.textContent).toMatch(/l'abattement minimal, 1,76 % du plafond de la sécurité sociale \(829\u00a0€\)/)
    expect(assiette.textContent).not.toMatch(/26 %/)
    expect(assiette.textContent).toMatch(/171\u00a0€$/)
  })

  it('rappelle au remplaçant ce que porte DSAV, et seulement à lui', async () => {
    await afficher()
    const note = /DSAV porte les rétrocessions reçues/
    expect(screen.queryByText(note)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Remplaçant exclusif/))
    expect(screen.getByText(note).textContent).toMatch(/DSAW vaut zéro/)
  })

  it('dit que la prise en charge des structures de soins n’est pas estimée, quand il y en a', async () => {
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    const reserve = /structures de soins n’est pas estimée/
    // Le garde symétrique : sans recettes en structures, pas de réserve de plus.
    expect(screen.getByText('Total à la charge du praticien')).toBeTruthy()
    expect(screen.queryByText(reserve)).toBeNull()
    saisir(/Recettes en structures de soins/, '0')
    expect(screen.queryByText(reserve)).toBeNull()
    saisir(/Recettes en structures de soins/, '12000')
    expect(screen.getByText(reserve)).toBeTruthy()
  })

  it('suspend la proposition et l’estimation sur une déclaration lue en partie', async () => {
    faux.ligne = ligne({ profession: 'auxiliaire_medical', honoraires_conventionnes: 80_000 })
    await afficher('pièces : lecture interrompue')
    expect(screen.getByText(/sont suspendues/)).toBeTruthy()
    expect(screen.queryByText('Total à la charge du praticien')).toBeNull()
    expect(screen.queryByText('proposées : ligne 4 de la 2035-A')).toBeNull()
  })
})

// UN AUTRE EXERCICE EST UNE AUTRE LIGNE. La carte reste montée quand l'exercice change dans l'en-tête (l'onglet Clôture la
// garde pour 2025 comme pour 2026) : elle montrait sous « Volet social 2026 » les chiffres de 2025 jusqu'au retour de la
// lecture, et « Enregistrer » les écrivait sur 2026 — un upsert de tous les champs, par-dessus ce qui y est peut-être.
describe('le volet social, quand l’exercice change', () => {
  it('ne montre ni le formulaire ni le message de l’exercice d’avant pendant la lecture du nouveau', async () => {
    faux.parAnnee = {
      2025: ligne({ annee: 2025, recettes_brutes: 61_000 }),
      2026: ligne({ id: 'v2', annee: 2026, recettes_brutes: 73_000 }),
    }
    const { rerender } = render(<VoletSocialCard dossierId="d" annee={2025} valeurs={VALEURS} blocage={null} />)
    expect((await screen.findByLabelText(/Recettes brutes totales/) as HTMLInputElement).value).toBe('61000')
    saisir(/Profession/, 'auxiliaire_medical')
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
    expect(screen.getByText('Enregistré.')).toBeTruthy()

    let liberer = () => {}
    faux.porte = new Promise<void>((resolve) => { liberer = resolve })
    rerender(<VoletSocialCard dossierId="d" annee={2026} valeurs={VALEURS} blocage={null} />)
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })

    expect(screen.getByText('Volet social 2026 — praticien ou auxiliaire médical conventionné')).toBeTruthy()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByLabelText(/Recettes brutes totales/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
    expect(screen.queryAllByText('Enregistré.')).toHaveLength(0)

    faux.porte = null
    await act(async () => { liberer() })
    expect((await screen.findByLabelText(/Recettes brutes totales/) as HTMLInputElement).value).toBe('73000')
    // « Enregistré. » disait l'enregistrement de 2025 : il ne revient pas sous le formulaire de 2026.
    expect(screen.queryAllByText('Enregistré.')).toHaveLength(0)
    expect(faux.enregistrements).toHaveLength(1)
  })
})
