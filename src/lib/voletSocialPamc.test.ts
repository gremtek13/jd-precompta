import { describe, expect, it } from 'vitest'
import {
  PLAFONDS_SECURITE_SOCIALE,
  arrondiUrssaf,
  estimerCotisationsUrssaf,
  natureAbattement,
  ratioConventionne,
  recettesBrutesRetenues,
  type EntreeEstimation,
} from './voletSocialPamc'
import { CAS_REFERENCE, MOTEUR_REFERENCE } from './voletSocialPamcReference'

// Une infirmière à 60 000 € de revenu brut social en 2025, tout conventionné : le cas que le moteur
// de l'Urssaf chiffre à 4 646 € (voir voletSocialPamcReference.ts).
const infirmiere: EntreeEstimation = {
  annee: 2025,
  profession: 'auxiliaire_medical',
  remplacant: false,
  revenuBrutSocial: 60_000,
  revenuProfessionnelPositif: true,
  recettesBrutes: 80_000,
  honorairesConventionnes: 80_000,
  depassements: 0,
}

describe('les cotisations Urssaf, contre le moteur de l’Urssaf', () => {
  // Sans ce plancher, une grille vidée par une régénération ratée passerait tous les cas à vide.
  it('porte une grille réelle, sur les deux années', () => {
    expect(MOTEUR_REFERENCE).toMatch(/^modele-ti \d/)
    expect(CAS_REFERENCE.length).toBeGreaterThanOrEqual(60)
    expect(new Set(CAS_REFERENCE.map((c) => c.entree.annee))).toEqual(new Set([2025, 2026]))
    for (const annee of [2025, 2026]) {
      expect(CAS_REFERENCE.find((c) => c.entree.annee === annee)?.attendu.plafond).toBe(PLAFONDS_SECURITE_SOCIALE[annee])
    }
  })

  it.each(CAS_REFERENCE.map((c) => [c.cas, c] as const))('%s', (_nom, { entree, attendu }) => {
    const resultat = estimerCotisationsUrssaf(entree)
    expect(resultat).toEqual({ disponible: true, estimation: attendu })
  })

  it('chiffre l’infirmière à 60 000 € comme le moteur, poste par poste', () => {
    const resultat = estimerCotisationsUrssaf(infirmiere)
    expect(resultat).toEqual({
      disponible: true,
      estimation: {
        plafond: 47_100,
        abattement: 15_600,
        assiette: 44_400,
        csgCrdsDeductible: 3_019,
        csgCrdsNonDeductible: 1_288,
        maladie: 2_535,
        priseEnChargeMaladie: 2_491,
        contributionAdditionnelle: 0,
        indemnitesJournalieres: 133,
        allocationsFamiliales: 0,
        curps: 44,
        formationProfessionnelle: 118,
        total: 4_646,
      },
    })
  })
})

describe('ce que l’estimation refuse, et dit', () => {
  const motif = (e: Partial<EntreeEstimation>) => {
    const r = estimerCotisationsUrssaf({ ...infirmiere, ...e })
    return r.disponible ? null : r.motif
  }

  it('avant la nouvelle assiette', () => {
    expect(motif({ annee: 2024 })).toMatch(/depuis les revenus 2025/)
  })

  it('une année dont le plafond n’est pas saisi — jamais celui d’une autre', () => {
    expect(motif({ annee: 2027 })).toMatch(/plafond de la sécurité sociale 2027/)
  })

  it('sans profession choisie', () => {
    expect(motif({ profession: null })).toMatch(/Choisissez la profession/)
  })

  it('pour les médecins et les chirurgiens-dentistes, dont les règles diffèrent', () => {
    for (const profession of ['medecin_secteur_1', 'medecin_secteur_2', 'chirurgien_dentiste'] as const) {
      expect(motif({ profession })).toMatch(/auxiliaires médicaux et les sages-femmes seulement/)
    }
  })

  it('sans les honoraires du SNIR, dont dépend la prise en charge', () => {
    expect(motif({ honorairesConventionnes: null })).toMatch(/honoraires du relevé SNIR/)
  })

  it('des honoraires conventionnés supérieurs aux recettes totales', () => {
    expect(motif({ honorairesConventionnes: 80_001 })).toMatch(/dépassent les recettes totales/)
  })

  it('des dépassements supérieurs aux honoraires conventionnés', () => {
    expect(motif({ depassements: 80_001, honorairesConventionnes: 80_000 })).toMatch(/dépassements \(DSAW\)/)
  })

  it('des dépassements non saisis valent aucun dépassement', () => {
    expect(estimerCotisationsUrssaf({ ...infirmiere, depassements: null })).toEqual(estimerCotisationsUrssaf(infirmiere))
  })
})

describe('les rubriques', () => {
  it('reprend la ligne 4 de la 2035-A tant que le cabinet n’a rien saisi, et le dit', () => {
    expect(recettesBrutesRetenues(null, 71_234)).toEqual({ montant: 71_234, proposees: true })
    expect(recettesBrutesRetenues({ recettes_brutes: null }, 71_234)).toEqual({ montant: 71_234, proposees: true })
  })

  it('garde ce que le cabinet a saisi, zéro compris', () => {
    expect(recettesBrutesRetenues({ recettes_brutes: 75_000 }, 71_234)).toEqual({ montant: 75_000, proposees: false })
    expect(recettesBrutesRetenues({ recettes_brutes: 0 }, 71_234)).toEqual({ montant: 0, proposees: false })
  })

  it('calcule le ratio au centième', () => {
    expect(ratioConventionne(69_000, 71_234)).toEqual({ ratio: 0.97, motif: null })
    expect(ratioConventionne(71_234, 71_234)).toEqual({ ratio: 1, motif: null })
    expect(ratioConventionne(0, 71_234)).toEqual({ ratio: 0, motif: null })
  })

  it('ne rend pas de ratio sans honoraires, sans recettes, ou au-dessus de 1', () => {
    expect(ratioConventionne(null, 71_234).motif).toMatch(/honoraires du relevé SNIR/)
    expect(ratioConventionne(1_000, 0).motif).toMatch(/recettes totales \(DSCS\) sont nulles/)
    expect(ratioConventionne(71_235, 71_234).motif).toMatch(/rétrocédé/)
  })
})

describe('l’abattement dit ce qu’il est', () => {
  const nature = (revenuBrutSocial: number) => {
    const r = estimerCotisationsUrssaf({ ...infirmiere, revenuBrutSocial })
    if (!r.disponible) throw new Error(r.motif)
    return natureAbattement(r.estimation)
  }

  it('26 % du revenu entre les deux bornes', () => {
    expect(nature(60_000)).toBe('taux')
  })

  it('le plancher sur un revenu faible ou nul', () => {
    // 26 % de 2 000 € font 520 €, sous le plancher de 829 € (1,76 % de 47 100 €).
    expect(nature(2_000)).toBe('plancher')
    expect(nature(0)).toBe('plancher')
  })

  it('le plafond au-delà', () => {
    // 26 % de 300 000 € font 78 000 €, au-dessus du plafond de 61 230 € (130 % de 47 100 €).
    expect(nature(300_000)).toBe('plafond')
  })
})

describe('l’arrondi du moteur de l’Urssaf', () => {
  it('fait tomber un demi-euro binaire du bon côté', () => {
    // 1,005 s'écrit 1,00499999… en binaire : sans l'EPSILON, 100,5 centimes deviendraient 100.
    expect(arrondiUrssaf(1.005, 2)).toBe(1.01)
    expect(arrondiUrssaf(235.5)).toBe(236)
    expect(arrondiUrssaf(5.713_38, 2)).toBe(5.71)
  })
})
