import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VoletSocialCard from './VoletSocialCard'
import { formatMoney } from '../../lib/format'
import { estimerRetraite } from '../../lib/retraiteDesLiberaux'
import { estimerCotisationsUrssaf, type EntreeEstimation } from '../../lib/voletSocialPamc'
import { PHRASE_DE_L_URSSAF_POUR_LA_CIPAV } from '../../lib/retraiteAffichee'

// LA CIPAV À L'ÉCRAN (ligne 27.1, RET-Q1). Le calcul est jugé contre le moteur de l'Urssaf (voletSocialPamc.test.ts,
// retraiteDesLiberaux.test.ts) ; ici, le CÂBLAGE : le choix offert sous son drapeau seulement, les rubriques du SNIR tues
// et écrites nulles à l'enregistrement (dit avant le clic), la retraite « recouvrée par l'Urssaf », le total appelé.
const drapeau = vi.hoisted(() => ({ cipav: true }))
vi.mock('../../lib/voletSocialPamc', async (importer) => {
  const reel = await importer<typeof import('../../lib/voletSocialPamc')>()
  return {
    ...reel,
    get PROFESSIONS_CIPAV_PREVUES() {
      return drapeau.cipav
    },
  }
})
vi.mock('../../lib/parametresDesCotisations', async (importer) => {
  const reel = await importer<typeof import('../../lib/parametresDesCotisations')>()
  return { ...reel, PARAMETRES_DES_COTISATIONS_EXPORTES: true }
})
vi.mock('../../lib/parametresDesCotisationsLecture', () => ({
  lireLesParametresDesCotisations: (dossierId: string) =>
    Promise.resolve({ dossierId, etat: 'lus', debutActivite: '2010-01-01', parExercice: new Map() }),
}))
const base = vi.hoisted(() => ({ ligne: null as Record<string, unknown> | null, ecrit: [] as Record<string, unknown>[] }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const lecture = {
        select: () => lecture,
        eq: () => lecture,
        maybeSingle: () => Promise.resolve({ data: base.ligne, error: null }),
        upsert: (valeurs: Record<string, unknown>) => {
          base.ecrit.push(valeurs)
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'l', ...valeurs }, error: null }) }) }
        },
      }
      return lecture
    },
  },
}))

// 80 000 € de recettes et 60 000 € de bénéfice, en 2026.
const VALEURS = new Map([['AA', 80_000], ['BA', 20_000]])

async function afficher() {
  render(<VoletSocialCard dossierId="d" annee={2026} valeurs={VALEURS} blocage={null} />)
  await act(async () => {})
}
const choisir = (valeur: string) => fireEvent.change(screen.getByLabelText(/Profession/), { target: { value: valeur } })
const retraite = () => within(screen.getByRole('region', { name: 'Retraite' }))
const ligneDe = (libelle: RegExp) => retraite().getByText(libelle).nextElementSibling?.textContent
const enEuros = (centimes: number) => formatMoney(centimes / 100)

// Ce que les modules rendent pour l'entrée que l'écran leur donne.
const ENTREE: EntreeEstimation = {
  annee: 2026, profession: 'liberal_cipav', remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true,
  recettesBrutes: 80_000, honorairesConventionnes: null, depassements: null,
  parametres: { tenus: true, debutActivite: '2010-01-01', acre: null, tauxDentiste: null },
}

beforeEach(() => {
  drapeau.cipav = true
  base.ligne = null
  base.ecrit = []
})

describe('la CIPAV dans le volet social', () => {
  it('drapeau baissé, ne s’offre pas, et la retraite la dit hors du champ', async () => {
    drapeau.cipav = false
    await afficher()
    const options = within(screen.getByLabelText(/Profession/)).getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(options).not.toContain('liberal_cipav')
    expect(retraite().getByText('Retraite (caisse : CARPIMKO, CARMF ou CARCDSF selon la profession)')).toBeTruthy()
  })

  it('drapeau levé : tait le SNIR, le remplaçant, la prise en charge et la CURPS, et chiffre la retraite appelée par l’Urssaf', async () => {
    await afficher()
    expect(retraite().getByText('Retraite (caisse : CARPIMKO, CARMF, CARCDSF ou CIPAV selon la profession)')).toBeTruthy()
    choisir('liberal_cipav')
    expect(screen.getByText('Volet social 2026 — profession libérale relevant de la CIPAV')).toBeTruthy()
    expect(screen.getByText(/^CIPAV : architecte, /)).toBeTruthy()
    expect(screen.queryByLabelText(/Honoraires conventionnés/)).toBeNull()
    expect(screen.queryByLabelText(/Remplaçant exclusif/)).toBeNull()
    expect(screen.queryByText('DSAV')).toBeNull()
    expect(screen.queryByText(/CURPS \(unions/)).toBeNull()
    expect(screen.queryByText(/Contribution de 3,25 %/)).toBeNull()

    const u = estimerCotisationsUrssaf(ENTREE)
    const r = estimerRetraite({ ...ENTREE, cumulEmploiRetraite: null })
    if (!u.disponible || !r.disponible) throw new Error('estimation attendue')
    expect(screen.getByText('Total hors retraite').nextElementSibling?.textContent).toMatch(/^7 055 €$/)
    expect(retraite().getByText('Retraite (CIPAV, recouvrée par l’Urssaf)')).toBeTruthy()
    expect(ligneDe(/^Régime de base \(CNAVPL\)$/)).toBe(enEuros(r.estimation.retraiteDeBase))
    expect(ligneDe(/^Régime complémentaire$/)).toBe(enEuros(r.estimation.retraiteComplementaire))
    expect(ligneDe(/^Invalidité-décès$/)).toBe(enEuros(r.estimation.invaliditeDeces))
    expect(retraite().queryByText(/PCV/)).toBeNull()
    expect(ligneDe(/^Total de la retraite, appelé par l’Urssaf$/)).toBe(enEuros(r.estimation.total))
    // 7 055 € hors retraite et 9 812 € de retraite : ce que le moteur de l'Urssaf appelle en tout pour ce cas.
    expect(retraite().getByText(/Avec les cotisations ci-dessus, l’Urssaf appelle 16\s867\s€ sur les revenus 2026\./)).toBeTruthy()
    expect(retraite().getByText(/^CIPAV : à partir de l’année de ses 68 ans/)).toBeTruthy()
    expect(retraite().getByText(PHRASE_DE_L_URSSAF_POUR_LA_CIPAV)).toBeTruthy()
    expect(retraite().queryByText(/Hors CIPAV/)).toBeNull()
  })

  it('le dit avant le clic, puis écrit nulles les rubriques du SNIR et la case du remplaçant', async () => {
    base.ligne = {
      id: 'l', dossier_id: 'd', annee: 2026, profession: 'auxiliaire_medical', remplacant: true,
      recettes_brutes: 80_000, honoraires_conventionnes: 70_000, depassements: 0, recettes_structures: null,
    }
    await afficher()
    expect(screen.queryByText(/Enregistrer videra/)).toBeNull()
    choisir('liberal_cipav')
    expect(screen.getByText(/Enregistrer videra les chiffres du relevé SNIR et la case « remplaçant »/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    })
    expect(base.ecrit).toEqual([{
      dossier_id: 'd', annee: 2026, profession: 'liberal_cipav', remplacant: false,
      recettes_brutes: null, honoraires_conventionnes: null, depassements: null, recettes_structures: null,
    }])
    expect(screen.getByText('Enregistré.')).toBeTruthy()
    expect(screen.queryByText(/Enregistrer videra/)).toBeNull()
  })
})
