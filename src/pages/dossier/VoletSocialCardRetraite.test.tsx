import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import VoletSocialCard from './VoletSocialCard'
import { formatMoney } from '../../lib/format'
import { estimerRetraite, type EstimationRetraite } from '../../lib/retraiteDesLiberaux'
import { PHRASE_DE_LA_CAISSE } from '../../lib/retraiteAffichee'

// LA RETRAITE DES PROFESSIONS LIBÉRALES À L'ÉCRAN (ligne 27.1, RET-Q5). Le calcul est dans `lib/retraiteDesLiberaux.ts`, jugé
// contre le moteur de l'Urssaf, la règle d'affichage dans `lib/retraiteAffichee.ts` : ce qui se joue ici est le CÂBLAGE — la
// même entrée que l'Urssaf, le choix du cumul d'un médecin (local, sans valeur par défaut), le motif dit à la place d'un
// chiffre.
// La CIPAV offerte à l'écran sous `PROFESSIONS_CIPAV_PREVUES`, levé le 11/11/2026 : ces cas jouent l'état réel ; l'état
// d'avant (les trois caisses, « Hors CIPAV ») se rejoue par l'accesseur, baissé, dans son propre cas.
const drapeau = vi.hoisted(() => ({
  cipav: true,
  // Les deux cases d'un médecin (RET-Q2) : baissées — l'état d'avant le 15/11/2026, le choix local du cumul, que les
  // premiers cas jouent tant que son code existe ; levées — l'état servi depuis la migration — dans leurs propres cas, avec
  // les paramètres lus que ces cas posent.
  cases: false,
  debutActivite: '2010-01-01',
  parExercice: new Map<number, unknown>(),
}))
vi.mock('../../lib/voletSocialPamc', async (importer) => {
  const reel = await importer<typeof import('../../lib/voletSocialPamc')>()
  return { ...reel, get PROFESSIONS_CIPAV_PREVUES() { return drapeau.cipav } }
})
vi.mock('../../lib/parametresDesCotisations', async (importer) => {
  const reel = await importer<typeof import('../../lib/parametresDesCotisations')>()
  return { ...reel, PARAMETRES_DES_COTISATIONS_EXPORTES: true, get CASES_DU_MEDECIN_PREVUES() { return drapeau.cases } }
})
vi.mock('../../lib/parametresDesCotisationsLecture', () => ({
  lireLesParametresDesCotisations: (dossierId: string) =>
    Promise.resolve({ dossierId, etat: 'lus', debutActivite: drapeau.debutActivite, parExercice: drapeau.parExercice }),
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const lecture = { select: () => lecture, eq: () => lecture, maybeSingle: () => Promise.resolve({ data: null, error: null }) }
      return lecture
    },
  },
}))

// 80 000 € de recettes et 60 000 € de bénéfice.
const VALEURS = new Map([['AA', 80_000], ['BA', 20_000]])

const carte = (annee: number) => <VoletSocialCard dossierId="d" annee={annee} valeurs={VALEURS} blocage={null} />

async function afficher(annee = 2025) {
  const rendu = render(carte(annee))
  await act(async () => {})
  return rendu
}
const saisir = (libelle: RegExp, valeur: string) => fireEvent.change(screen.getByLabelText(libelle), { target: { value: valeur } })
const retraite = () => within(screen.getByRole('region', { name: 'Retraite' }))
const ligneDe = (libelle: RegExp) => retraite().getByText(libelle).nextElementSibling?.textContent
const enEuros = (centimes: number) => formatMoney(centimes / 100)

// La retraite que le module rend pour l'entrée que l'écran lui donne : 80 000 € de recettes, 60 000 € de revenu brut social,
// 80 000 € d'honoraires conventionnés sans dépassement, une activité ouverte en 2010.
function attendue(profession: 'auxiliaire_medical' | 'medecin_secteur_1', cumul: boolean | null): EstimationRetraite {
  const r = estimerRetraite({
    annee: 2025, profession, remplacant: false, revenuBrutSocial: 60_000, revenuProfessionnelPositif: true, recettesBrutes: 80_000,
    honorairesConventionnes: 80_000, depassements: null, parametres: { tenus: true, debutActivite: '2010-01-01', acre: null, tauxDentiste: null },
    cumulEmploiRetraite: cumul, dispenseDesDebuts: { tenue: false },
  })
  if (!r.disponible) throw new Error(r.motif)
  return r.estimation
}

describe('la retraite dans le volet social', () => {
  it('drapeau baissé, l’écran d’avant : les trois caisses, et « Hors CIPAV »', async () => {
    drapeau.cipav = false
    try {
      await afficher()
      expect(retraite().getByText('Retraite (caisse : CARPIMKO, CARMF ou CARCDSF selon la profession)')).toBeTruthy()
      saisir(/Profession/, 'auxiliaire_medical')
      saisir(/Honoraires conventionnés/, '80000')
      expect(retraite().getByText(/Hors CIPAV/)).toBeTruthy()
    } finally {
      drapeau.cipav = true
    }
  })

  it('sans profession, nomme les trois caisses et dit pourquoi elle ne chiffre rien', async () => {
    await afficher()
    expect(retraite().getByText('Retraite (caisse : CARPIMKO, CARMF, CARCDSF ou CIPAV selon la profession)')).toBeTruthy()
    expect(retraite().getByText('Choisissez la profession pour estimer les cotisations.')).toBeTruthy()
    expect(retraite().queryByRole('table')).toBeNull()
    expect(retraite().queryByLabelText(/cumule-t-il/)).toBeNull()
    expect(retraite().getByText(PHRASE_DE_LA_CAISSE)).toBeTruthy()
  })

  it('chiffre une CARPIMKO : quatre lignes, la prise en charge de l’Assurance maladie, le total, sans rien demander', async () => {
    await afficher()
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    const e = attendue('auxiliaire_medical', null)
    expect(retraite().getByText('Retraite (caisse : CARPIMKO)')).toBeTruthy()
    expect(retraite().queryByLabelText(/cumule-t-il/)).toBeNull()
    expect(ligneDe(/^Régime de base \(CNAVPL\)$/)).toBe(enEuros(e.retraiteDeBase))
    expect(ligneDe(/^Régime complémentaire$/)).toBe(enEuros(e.retraiteComplementaire))
    expect(ligneDe(/^Invalidité-décès$/)).toBe(enEuros(e.invaliditeDeces))
    expect(e.invaliditeDeces).toBe(102_200)
    expect(ligneDe(/^Régime des praticiens conventionnés \(PCV\), moins la prise en charge/)).toBe(enEuros(e.pcv))
    expect(e.priseEnChargePcv).toBeGreaterThan(0)
    expect(retraite().getByText(/prise en charge par l’Assurance maladie \(\d/)).toBeTruthy()
    expect(ligneDe(/^Prise en charge par l’Assurance maladie, déjà déduite/)).toBe(enEuros(e.priseEnChargePcv))
    expect(ligneDe(/^Total de la retraite à la charge du praticien$/)).toBe(enEuros(e.total))
    expect(retraite().getByText(PHRASE_DE_LA_CAISSE)).toBeTruthy()
    expect(retraite().getByText(/^Hors exonération pour incapacité d’exercice, .*affiliées à la CIPAV\.$/)).toBeTruthy()
    expect(retraite().queryByText(/Hors CIPAV/)).toBeNull()
    // Les cotisations de l'Urssaf gardent leur total, que la retraite n'a pas touché.
    expect(screen.getByText('Total à la charge du praticien')).toBeTruthy()
  })

  it('un médecin ne voit aucune retraite tant qu’il n’a pas dit son cumul, puis la voit, et le cumul retire l’invalidité-décès', async () => {
    await afficher()
    saisir(/Profession/, 'medecin_secteur_1')
    saisir(/Honoraires conventionnés/, '80000')
    expect(retraite().getByText('Retraite (caisse : CARMF)')).toBeTruthy()
    const choix = retraite().getByLabelText(/cumule-t-il/) as HTMLSelectElement
    expect(choix.value).toBe('non_renseigne')
    expect(within(choix).getAllByRole('option').map((o) => o.textContent)).toEqual(['non renseigné', 'oui', 'non'])
    expect(retraite().getByText(/Dites si le médecin cumule sa retraite et son activité/)).toBeTruthy()
    expect(retraite().queryByRole('table')).toBeNull()
    expect(retraite().queryByText(/Total de la retraite/)).toBeNull()

    fireEvent.change(choix, { target: { value: 'non' } })
    const sans = attendue('medecin_secteur_1', false)
    expect(retraite().queryByText(/Dites si le médecin cumule/)).toBeNull()
    expect(ligneDe(/^Invalidité-décès$/)).toBe(enEuros(sans.invaliditeDeces))
    expect(sans.invaliditeDeces).toBeGreaterThan(0)
    expect(sans.priseEnChargeRetraiteDeBase).toBeGreaterThan(0)
    expect(ligneDe(/^Régime de base \(CNAVPL\), moins la prise en charge/)).toBe(enEuros(sans.retraiteDeBase))
    expect(ligneDe(/^Total de la retraite à la charge du praticien$/)).toBe(enEuros(sans.total))
    expect(retraite().queryByText(/Cumul emploi-retraite/)).toBeNull()

    fireEvent.change(choix, { target: { value: 'oui' } })
    const avec = attendue('medecin_secteur_1', true)
    expect(avec.invaliditeDeces).toBe(0)
    expect(ligneDe(/^Invalidité-décès$/)).toBe(enEuros(0))
    expect(ligneDe(/^Total de la retraite à la charge du praticien$/)).toBe(enEuros(avec.total))
    expect(retraite().getByText(/Cumul emploi-retraite : la CARMF n’appelle plus d’invalidité-décès/)).toBeTruthy()

    // Revenir à « non renseigné » retire de nouveau tout montant : le choix n'a jamais de valeur par défaut.
    fireEvent.change(choix, { target: { value: 'non_renseigne' } })
    expect(retraite().queryByRole('table')).toBeNull()
  })

  it('le cumul dit pour un exercice ne vaut pas pour un autre', async () => {
    const { rerender } = await afficher(2025)
    saisir(/Profession/, 'medecin_secteur_2')
    saisir(/Honoraires conventionnés/, '80000')
    fireEvent.change(retraite().getByLabelText(/cumule-t-il/), { target: { value: 'oui' } })
    expect(retraite().getByText(/Total de la retraite/)).toBeTruthy()
    rerender(carte(2026))
    await act(async () => {})
    saisir(/Profession/, 'medecin_secteur_2')
    saisir(/Honoraires conventionnés/, '80000')
    expect((retraite().getByLabelText(/cumule-t-il/) as HTMLSelectElement).value).toBe('non_renseigne')
    expect(retraite().queryByRole('table')).toBeNull()
  })

  it('un exercice sans barème dit son motif et n’affiche aucun montant, jamais zéro', async () => {
    await afficher(2027)
    saisir(/Profession/, 'auxiliaire_medical')
    saisir(/Honoraires conventionnés/, '80000')
    expect(retraite().getByText(/plafond de la sécurité sociale 2027 n'est pas encore saisi/)).toBeTruthy()
    expect(retraite().queryByRole('table')).toBeNull()
    expect(retraite().queryByText(/0,00/)).toBeNull()
    expect(retraite().getByText(PHRASE_DE_LA_CAISSE)).toBeTruthy()
  })
})

// LES DEUX CASES D'UN MÉDECIN EN BASE (RET-Q2, `CASES_DU_MEDECIN_PREVUES` levé par l'accesseur) : le choix local du cumul
// disparaît, l'estimation lit le cumul et la dispense de l'exercice, que la carte des paramètres offre.
describe('la retraite d’un médecin, ses deux cases en base', () => {
  async function avecLesCases(debutActivite: string, cases: { cumulEmploiRetraite: boolean | null; dispenseComplementaire: boolean | null }) {
    drapeau.cases = true
    drapeau.debutActivite = debutActivite
    drapeau.parExercice = new Map([[2025, { acre: false, tauxDentiste: null, medecin: cases }]])
    const rendu = await afficher()
    saisir(/Profession/, 'medecin_secteur_1')
    saisir(/Honoraires conventionnés/, '80000')
    return rendu
  }
  const remettre = () => { drapeau.cases = false; drapeau.debutActivite = '2010-01-01'; drapeau.parExercice = new Map() }

  it('plus de choix local : le cumul de l’exercice, lu, retire l’invalidité-décès', async () => {
    try {
      await avecLesCases('2010-01-01', { cumulEmploiRetraite: true, dispenseComplementaire: null })
      expect(retraite().queryByLabelText(/cumule-t-il/)).toBeNull()
      expect(screen.getByLabelText('Cumul emploi-retraite en 2025')).toBeTruthy()
      expect(ligneDe(/^Invalidité-décès$/)).toBe(enEuros(0))
      expect(retraite().getByText(/Cumul emploi-retraite : la CARMF n’appelle plus d’invalidité-décès/)).toBeTruthy()
    } finally {
      remettre()
    }
  })

  it('les deux premières années d’affiliation, la dispense non dite tait la retraite ; dite, le complémentaire n’est pas compté', async () => {
    try {
      const rendu = await avecLesCases('2024-11-15', { cumulEmploiRetraite: false, dispenseComplementaire: null })
      expect(retraite().getByText(/^Dites si la CARMF dispense le médecin du complémentaire en 2025/)).toBeTruthy()
      expect(retraite().queryByRole('table')).toBeNull()
      rendu.unmount()
    } finally {
      remettre()
    }
    try {
      await avecLesCases('2024-11-15', { cumulEmploiRetraite: false, dispenseComplementaire: true })
      expect(ligneDe(/^Régime complémentaire$/)).toBe(enEuros(0))
      expect(retraite().getByText(/^CARMF : le complémentaire n’est pas compté/)).toBeTruthy()
    } finally {
      remettre()
    }
  })
})

