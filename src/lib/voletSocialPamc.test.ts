import { describe, expect, it } from 'vitest'
import {
  PLAFONDS_SECURITE_SOCIALE,
  arrondiUrssaf,
  estimerCotisationsUrssaf,
  PROFESSIONS_CIPAV_PREVUES,
  natureAbattement,
  professionsOffertes,
  ratioConventionne,
  recettesBrutesRetenues,
  type EntreeEstimation,
} from './voletSocialPamc'
import { CAS_REFERENCE, MOTEUR_REFERENCE } from './voletSocialPamcReference'
import { readFileSync } from 'node:fs'

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
  parametres: { tenus: false },
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

  // Les médecins (07/11/2026) : sans ce plancher, une régénération qui les perdrait laisserait leur
  // calcul sans référence. Les trois tranches de la prise en charge des allocations familiales du
  // secteur 1 (100 %, 75 %, 60 % de la cotisation) doivent chacune porter au moins un cas.
  it('porte les médecins des deux secteurs, et chaque tranche de leur prise en charge', () => {
    for (const profession of ['medecin_secteur_1', 'medecin_secteur_2'] as const) {
      expect(CAS_REFERENCE.filter((c) => c.entree.profession === profession).length).toBeGreaterThanOrEqual(30)
    }
    const parts = new Set(
      CAS_REFERENCE.filter((c) => c.attendu.priseEnChargeAllocationsFamiliales > 0).map((c) =>
        Math.round((c.attendu.priseEnChargeAllocationsFamiliales / c.attendu.allocationsFamiliales) * 100),
      ),
    )
    expect(parts).toEqual(new Set([100, 75, 60]))
    expect(CAS_REFERENCE.some((c) => c.entree.profession === 'medecin_secteur_2' && c.attendu.priseEnChargeMaladie > 0)).toBe(false)
  })

  // Les paramètres des cotisations (TNS-Q1, TNS-Q4) : l'année de la création, l'ACRE sous ses deux plafonds
  // (le tout avant 2026, le quart depuis) et sur l'année qui suit, le chirurgien-dentiste.
  it('porte l’année de la création, l’ACRE et le chirurgien-dentiste', () => {
    const creations = CAS_REFERENCE.filter((c) => c.attendu.plafondProratise < c.attendu.plafond)
    expect(creations.length).toBeGreaterThanOrEqual(30)
    expect(creations.some((c) => c.attendu.curps > 0)).toBe(false)
    const acres = CAS_REFERENCE.filter((c) => c.attendu.acreAppliquee)
    expect(acres.length).toBeGreaterThanOrEqual(30)
    expect(acres.some((c) => c.entree.parametres.debutActivite < '2026-01-01')).toBe(true)
    expect(acres.some((c) => c.entree.parametres.debutActivite >= '2026-01-01')).toBe(true)
    expect(acres.some((c) => c.entree.parametres.debutActivite.slice(0, 4) !== String(c.entree.annee))).toBe(true)
    expect(CAS_REFERENCE.some((c) => c.entree.parametres.acre === true && !c.attendu.acreAppliquee)).toBe(true)
    const dentistes = CAS_REFERENCE.filter((c) => c.entree.profession === 'chirurgien_dentiste')
    expect(dentistes.length).toBeGreaterThanOrEqual(24)
    expect(new Set(dentistes.map((c) => c.entree.parametres.tauxDentiste))).toEqual(new Set([0, 0.25, 0.35, 0.47, 0.6, 1]))
  })

  // Le drapeau baissé : l'estimation d'hier, celle d'une activité ouverte avant l'exercice et sans ACRE.
  it('sans paramètres tenus, rend l’estimation d’une activité ouverte avant l’exercice', () => {
    const davant = CAS_REFERENCE.filter(
      (c) => c.entree.profession !== 'chirurgien_dentiste' && c.entree.parametres.debutActivite === '2015-01-01',
    )
    expect(davant.length).toBeGreaterThanOrEqual(170)
    for (const { entree, attendu } of davant) {
      expect(estimerCotisationsUrssaf({ ...entree, parametres: { tenus: false } })).toEqual({ disponible: true, estimation: attendu })
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
        plafondProratise: 47_100,
        acreAppliquee: false,
        abattement: 15_600,
        assiette: 44_400,
        csgCrdsDeductible: 3_019,
        csgCrdsNonDeductible: 1_288,
        maladie: 2_535,
        priseEnChargeMaladie: 2_491,
        priseEnChargeAllocationsFamiliales: 0,
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

  it('pour un chirurgien-dentiste, tant que l’application ne tient pas le « taux dentiste »', () => {
    expect(motif({ profession: 'chirurgien_dentiste' })).toMatch(/taux dentiste.*ne tient pas encore/)
  })

  describe('les paramètres tenus, chacun dit ou réclamé', () => {
    const tenus = (p: Partial<{ debutActivite: string | null; acre: boolean | null; tauxDentiste: number | null }>) => ({
      parametres: { tenus: true as const, debutActivite: '2015-01-01', acre: null, tauxDentiste: null, ...p },
    })

    it('le taux dentiste d’un chirurgien-dentiste, à saisir tant qu’il manque', () => {
      expect(motif({ profession: 'chirurgien_dentiste', ...tenus({}) })).toMatch(/Saisissez le « taux dentiste » du relevé SNIR 2025/)
      expect(motif({ profession: 'chirurgien_dentiste', ...tenus({ tauxDentiste: 0.35 }) })).toBeNull()
      expect(motif({ profession: 'chirurgien_dentiste', ...tenus({ tauxDentiste: 0 }) })).toBeNull()
    })

    it('un taux dentiste hors de 0 à 1, ou plus fin que le centième', () => {
      for (const tauxDentiste of [-0.01, 1.01, 0.355]) {
        expect(motif({ profession: 'chirurgien_dentiste', ...tenus({ tauxDentiste }) })).toMatch(/entre 0 et 1, au centième/)
      }
    })

    it('le taux dentiste n’est demandé qu’au chirurgien-dentiste', () => {
      expect(motif(tenus({}))).toBeNull()
    })

    it('la date de début d’activité, toujours', () => {
      expect(motif(tenus({ debutActivite: null }))).toMatch(/^Saisissez la date de début d’activité du praticien/)
      expect(motif(tenus({ debutActivite: '2025-02-30' }))).toMatch(/illisible/)
      expect(motif(tenus({ debutActivite: '2026-01-01' }))).toMatch(/commence après l’exercice 2025/)
    })

    it('l’ACRE, dite seulement quand elle peut jouer : moins d’un an d’activité au 1er janvier', () => {
      expect(motif(tenus({ debutActivite: '2025-07-01' }))).toMatch(/bénéficie de l’ACRE en 2025/)
      // « Un an » vaut 365 jours, comme dans le moteur : 2024 étant bissextile, le 2 janvier 2024 est déjà à un an.
      expect(motif(tenus({ debutActivite: '2024-01-03' }))).toMatch(/bénéficie de l’ACRE en 2025/)
      expect(motif(tenus({ debutActivite: '2024-01-02' }))).toBeNull()
      expect(motif(tenus({ debutActivite: '2024-01-01' }))).toBeNull()
      expect(motif(tenus({ debutActivite: '2025-07-01', acre: false }))).toBeNull()
    })
  })

  it('estime les médecins de secteur 1 et de secteur 2', () => {
    for (const profession of ['medecin_secteur_1', 'medecin_secteur_2'] as const) {
      expect(motif({ profession })).toBeNull()
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

describe('la CIPAV (ligne 27.1, RET-Q1)', () => {
  const cipav = CAS_REFERENCE.filter((c) => c.entree.profession === 'liberal_cipav')

  it('porte une grille réelle : les deux années, la création, l’ACRE, les revenus faibles et élevés', () => {
    expect(cipav.length).toBeGreaterThanOrEqual(80)
    expect(new Set(cipav.map((c) => c.entree.annee))).toEqual(new Set([2025, 2026]))
    expect(cipav.filter((c) => c.attendu.plafondProratise < c.attendu.plafond).length).toBeGreaterThanOrEqual(10)
    expect(cipav.filter((c) => c.attendu.acreAppliquee).length).toBeGreaterThanOrEqual(10)
    expect(cipav.some((c) => c.attendu.assiette === 0)).toBe(true)
    expect(cipav.some((c) => c.attendu.assiette > 3 * c.attendu.plafond)).toBe(true)
  })

  it('n’a ni prise en charge, ni contribution de 3,25 %, ni CURPS, et aucune rubrique du SNIR', () => {
    for (const c of cipav) {
      expect(c.entree.honorairesConventionnes, c.cas).toBeNull()
      expect(c.attendu.priseEnChargeMaladie + c.attendu.priseEnChargeAllocationsFamiliales + c.attendu.contributionAdditionnelle + c.attendu.curps, c.cas).toBe(0)
    }
  })

  it('n’est jamais refusée faute des rubriques du SNIR, même saisies par erreur', () => {
    const e: EntreeEstimation = { ...infirmiere, profession: 'liberal_cipav', honorairesConventionnes: null, depassements: null }
    expect(estimerCotisationsUrssaf(e).disponible).toBe(true)
    // Des chiffres du SNIR restés d'une autre profession ne changent rien : ils sont sans objet.
    expect(estimerCotisationsUrssaf({ ...e, honorairesConventionnes: 90_000, depassements: 95_000 })).toEqual(estimerCotisationsUrssaf(e))
  })

  it('ne s’offre à l’écran que sous son drapeau, ou quand la ligne lue la porte déjà', () => {
    // Levé le 11/11/2026, la migration `professions_cipav` en production ; baissé, l'écran ne l'offrait pas.
    expect(PROFESSIONS_CIPAV_PREVUES).toBe(true)
    expect(professionsOffertes(false, '')).not.toContain('liberal_cipav')
    expect(professionsOffertes(false, '').length).toBe(5)
    expect(professionsOffertes(true, '')).toContain('liberal_cipav')
    expect(professionsOffertes(false, 'liberal_cipav')).toContain('liberal_cipav')
  })

  it('dit les mêmes professions que la contrainte de la migration (en production le 11/11/2026), au caractère près', () => {
    const migration = readFileSync('supabase/schema/20261111130000_professions_cipav.sql', 'utf8')
    const liste = /add constraint volet_social_pamc_profession_check check \(profession in \(([^)]*)\)\)/.exec(migration)
    expect(liste).not.toBeNull()
    const enBase = [...liste![1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])
    expect(enBase).toEqual(professionsOffertes(true, ''))
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
