import { act, fireEvent, render, screen } from '@testing-library/react'
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
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'volet_social_pamc') throw new Error(`table inattendue : ${table}`)
      const lecture = {
        select: () => lecture,
        eq: () => lecture,
        maybeSingle: () => Promise.resolve(faux.lectureRefusee
          ? { data: null, error: { message: 'JWT expired' } }
          : { data: faux.ligne, error: null }),
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
    expect(curps.textContent).toMatch(/0 €$/)
  })

  it('un revenu faible prend l’abattement minimal, et ne le dit pas « de 26 % »', async () => {
    // 10 000 € de recettes, 9 000 € de dépenses : 1 000 € de revenu brut social, dont 26 % (260 €)
    // passent sous le plancher de 829 € — l'assiette tombe à 171 €.
    render(<VoletSocialCard dossierId="d" annee={2025} valeurs={new Map([['AA', 10_000], ['BA', 9_000]])} blocage={null} />)
    await act(async () => {})
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '10000')
    const assiette = screen.getByText(/^Assiette/).closest('tr')!
    expect(assiette.textContent).toMatch(/l'abattement minimal, 1,76 % du plafond de la sécurité sociale \(829 €\)/)
    expect(assiette.textContent).not.toMatch(/26 %/)
    expect(assiette.textContent).toMatch(/171 €$/)
  })

  it('suspend la proposition et l’estimation sur une déclaration lue en partie', async () => {
    faux.ligne = ligne({ profession: 'auxiliaire_medical', honoraires_conventionnes: 80_000 })
    await afficher('pièces : lecture interrompue')
    expect(screen.getByText(/sont suspendues/)).toBeTruthy()
    expect(screen.queryByText('Total à la charge du praticien')).toBeNull()
    expect(screen.queryByText('proposées : ligne 4 de la 2035-A')).toBeNull()
  })
})
