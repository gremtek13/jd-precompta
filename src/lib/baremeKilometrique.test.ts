import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { fichiersDuSchema } from '../test/schema'
import {
  BAREMES,
  baremeDeLAnnee,
  carburantApplicable,
  completerModificationVehicule,
  exercicesProposables,
  indemniteKilometrique,
  indemniteKilometriqueCentimes,
  motifNonCalcule,
  totalIndemnitesKilometriques,
} from './baremeKilometrique'
import type { BaremeAnnuel, TypeVehicule, Vehicule } from './baremeKilometrique'

// Barème d'essai, volontairement inventé et clairement faux : ces tests vérifient la MÉCANIQUE du
// calcul, pas les chiffres officiels. Les figer sur de vraies valeurs les rendrait caducs au
// prochain millésime alors que la mécanique, elle, ne change pas.
const bareme: BaremeAnnuel = {
  annee: 2025,
  source: 'barème d’essai — ne correspond à aucune publication',
  lignes: [
    {
      type: 'voiture',
      puissanceMin: 0,
      puissanceMax: 3,
      electrique: false,
      tranches: [
        // Volontairement DISCONTINU aux deux bornes : un barème continu rend l'inclusion de la
        // borne indécidable, et un test posé dessus ne prouverait rien.
        { jusqua: 5000, coefficient: 0.5, forfait: 0 },
        { jusqua: 20_000, coefficient: 0.3, forfait: 100 },
        { jusqua: null, coefficient: 0.35, forfait: 0 },
      ],
    },
    {
      type: 'voiture',
      puissanceMin: 4,
      puissanceMax: 4,
      electrique: false,
      tranches: [{ jusqua: null, coefficient: 0.6, forfait: 0 }],
    },
    {
      type: 'cyclomoteur',
      puissanceMin: 0,
      puissanceMax: 0,
      electrique: false,
      tranches: [{ jusqua: null, coefficient: 0.2, forfait: 0 }],
    },
  ],
}

const vehicule = (o: Partial<Vehicule>): Vehicule =>
  ({ type: 'voiture', puissanceFiscale: 3, kmProfessionnel: 1000, electrique: false, ...o })

describe('le barème officiel, tel que publié', () => {
  it('reproduit l’exemple donné par l’administration', () => {
    // « pour 4 000 kilomètres parcourus à titre professionnel avec un véhicule thermique de 6 CV,
    // vous pouvez faire état d'un montant de frais réels égal à : 4 000 km x 0,665 = 2 660 € ».
    // Un exemple publié est le meilleur test possible d'une table fiscale recopiée à la main.
    expect(indemniteKilometrique(
      { type: 'voiture', puissanceFiscale: 6, kmProfessionnel: 4000, electrique: false }, 2025,
    )).toBe(2660)
  })

  it('applique la table électrique publiée, pas une majoration recalculée', () => {
    // Les tables électriques valent les thermiques × 1,2 arrondies. Recalculer la majoration
    // donnerait des centimes d'écart avec les chiffres officiels — ce sont eux qui font foi.
    expect(indemniteKilometrique(
      { type: 'voiture', puissanceFiscale: 6, kmProfessionnel: 4000, electrique: true }, 2025,
    )).toBe(3192)
    expect(4000 * 0.665 * 1.2).toBeCloseTo(3192, 2)
  })

  it('couvre les trois tranches d’une voiture, forfait compris', () => {
    const v = (km: number) => ({ type: 'voiture' as const, puissanceFiscale: 3, kmProfessionnel: km, electrique: false })
    expect(indemniteKilometrique(v(5000), 2025)).toBe(2645)
    expect(indemniteKilometrique(v(10_000), 2025)).toBe(10_000 * 0.316 + 1065)
    expect(indemniteKilometrique(v(25_000), 2025)).toBe(9250)
  })

  it('couvre motos et cyclomoteurs, dont les tranches sont plus basses', () => {
    expect(indemniteKilometrique(
      { type: 'moto', puissanceFiscale: 4, kmProfessionnel: 3000, electrique: false }, 2025,
    )).toBe(1404)
    expect(indemniteKilometrique(
      { type: 'cyclomoteur', puissanceFiscale: 0, kmProfessionnel: 2000, electrique: false }, 2025,
    )).toBe(630)
  })

  it('utilise bien les bornes des deux-roues, pas celles des voitures', () => {
    // 4 000 km tombe dans la DEUXIÈME tranche d'une moto (3 000 / 6 000) mais dans la PREMIÈRE d'une
    // voiture (5 000 / 20 000). Un test posé sur 3 000 km ne distingue pas les deux jeux de bornes,
    // parce que le barème y est continu ; celui-ci les sépare — 1 486 € contre 1 872 €.
    expect(indemniteKilometrique(
      { type: 'moto', puissanceFiscale: 4, kmProfessionnel: 4000, electrique: false }, 2025,
    )).toBe(4000 * 0.082 + 1158)
    expect(indemniteKilometrique(
      { type: 'cyclomoteur', puissanceFiscale: 0, kmProfessionnel: 4000, electrique: false }, 2025,
    )).toBe(4000 * 0.079 + 711)
  })

  it('range la borne HAUTE dans la tranche qu’elle termine', () => {
    // Le barème est continu à la borne basse — 5 000 × 0,529 = 5 000 × 0,316 + 1 065, c'est tout
    // l'objet du forfait — donc la borne y est indécidable et ne prouve rien. Elle ne l'est pas à
    // 20 000 km : 7 385 € dans la tranche intermédiaire, 7 400 € dans la suivante.
    const v = (km: number) => ({ type: 'voiture' as const, puissanceFiscale: 3, kmProfessionnel: km, electrique: false })
    expect(indemniteKilometrique(v(20_000), 2025)).toBe(20_000 * 0.316 + 1065)
    expect(indemniteKilometrique(v(20_001), 2025)).toBe(Number((20_001 * 0.370).toFixed(2)))
  })

  it('n’est renseigné que pour les millésimes réellement saisis', () => {
    // Emprunter le barème d'une autre année est le défaut le plus coûteux ici : il produit une
    // déduction plausible et fausse. Ajouter une année reste un acte explicite, même quand les
    // valeurs ne changent pas — ce test le force.
    expect(BAREMES.map((b) => b.annee)).toEqual([2025, 2026])
    expect(BAREMES.every((b) => b.source.length > 0)).toBe(true)
    expect(indemniteKilometrique(
      { type: 'voiture', puissanceFiscale: 6, kmProfessionnel: 4000, electrique: false }, 2024,
    )).toBeNull()
  })

  it('applique à 2026 exactement la même table qu’à 2025', () => {
    // Le barème n'a pas été revalorisé. Les deux millésimes partagent la même table plutôt que d'en
    // recopier une : deux listes recopiées finiraient par diverger sur un chiffre, et personne ne
    // saurait laquelle fait foi. Ce test fige l'identité, valeur par valeur.
    expect(baremeDeLAnnee(2026)?.lignes).toEqual(baremeDeLAnnee(2025)?.lignes)

    // Et le calcul le confirme de bout en bout, sur les trois tranches d'une voiture.
    const v = (km: number) => ({ type: 'voiture' as const, puissanceFiscale: 3, kmProfessionnel: km, electrique: false })
    for (const km of [4000, 10_000, 25_000]) {
      expect(indemniteKilometrique(v(km), 2026)).toBe(indemniteKilometrique(v(km), 2025))
    }
  })

  it('dit d’où viennent les chiffres de 2026, qui ne sont pas encore publiés', () => {
    // Le millésime 2026 ne repose pas sur une publication mais sur l'absence de revalorisation. La
    // source doit le dire : dans deux ans, personne ne s'en souviendra, et la table sera à confronter
    // à la publication officielle du printemps 2027.
    expect(baremeDeLAnnee(2026)?.source).toMatch(/non revalorisé/i)
    expect(baremeDeLAnnee(2026)?.source).toMatch(/publication officielle/i)
  })
})

describe('le barème n’est jamais deviné', () => {
  it('refuse de calculer pour une année dont le barème manque', () => {
    // Retomber sur l'année précédente produirait une déduction fausse sans que rien ne le signale.
    expect(indemniteKilometrique(vehicule({}), 2024, [bareme])).toBeNull()
    expect(indemniteKilometrique(vehicule({}), 2025, [])).toBeNull()
  })

  it('rend null, jamais zéro, quand le calcul est impossible', () => {
    // Zéro se déclarerait ; null demande une saisie. La nuance décide de ce qui part au fisc.
    expect(indemniteKilometrique(vehicule({ puissanceFiscale: 9 }), 2025, [bareme])).toBeNull()
    expect(indemniteKilometrique(vehicule({ type: 'moto' }), 2025, [bareme])).toBeNull()
  })

  it('trouve le barème de l’année demandée et d’aucune autre', () => {
    expect(baremeDeLAnnee(2025, [bareme])?.annee).toBe(2025)
    expect(baremeDeLAnnee(2026, [bareme])).toBeNull()
  })
})

describe('indemniteKilometrique — la mécanique du barème', () => {
  it('applique la tranche choisie au kilométrage TOTAL, sans cumul progressif', () => {
    // Un barème kilométrique n'est pas un barème par tranches cumulées comme l'impôt : la tranche
    // sert à choisir une formule, qui porte ensuite sur tout le kilométrage. Le forfait de la
    // tranche intermédiaire n'existe que pour rattraper l'écart au point de bascule.
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 10_000 }), 2025, [bareme]))
      .toBe(10_000 * 0.3 + 100)
  })

  it('choisit la première tranche dont la borne couvre le kilométrage', () => {
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 4000 }), 2025, [bareme])).toBe(2000)
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 25_000 }), 2025, [bareme])).toBe(8750)
  })

  it('range la borne exacte dans la tranche qu’elle termine', () => {
    // 5 000 km appartient à la tranche « jusqu'à 5 000 », pas à la suivante.
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 5000 }), 2025, [bareme])).toBe(2500)
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 5001 }), 2025, [bareme]))
      .toBeCloseTo(5001 * 0.3 + 100, 2)
  })

  it('ne confond pas la table thermique et la table électrique', () => {
    // Les deux existent côte à côte pour la même puissance : choisir la mauvaise majore ou minore
    // la déduction de 20 %.
    expect(indemniteKilometrique(vehicule({ electrique: true }), 2025, [bareme])).toBeNull()
  })

  it('choisit la ligne sur le type ET la puissance', () => {
    expect(indemniteKilometrique(vehicule({ puissanceFiscale: 4 }), 2025, [bareme])).toBe(600)
    expect(indemniteKilometrique(vehicule({ type: 'cyclomoteur', puissanceFiscale: 0 }), 2025, [bareme]))
      .toBe(200)
  })

  it('accepte un kilométrage nul et refuse un kilométrage négatif', () => {
    // Zéro est un cas réel : véhicule déclaré, aucun trajet professionnel cette année.
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: 0 }), 2025, [bareme])).toBe(0)
    expect(indemniteKilometrique(vehicule({ kmProfessionnel: -10 }), 2025, [bareme])).toBeNull()
  })
})

describe('totalIndemnitesKilometriques — le report ligne 23', () => {
  it('additionne les véhicules calculables', () => {
    const { total, nonCalcules } = totalIndemnitesKilometriques(
      [vehicule({ kmProfessionnel: 1000 }), vehicule({ puissanceFiscale: 4, kmProfessionnel: 2000 })],
      2025, [bareme],
    )
    expect(total).toBe(500 + 1200)
    expect(nonCalcules).toEqual([])
  })

  it('remonte les véhicules non calculés au lieu de les faire disparaître du total', () => {
    // Un véhicule absent du total est une déduction perdue que personne ne verra manquer.
    const { total, nonCalcules } = totalIndemnitesKilometriques(
      [vehicule({ kmProfessionnel: 1000 }), vehicule({ puissanceFiscale: 9 })],
      2025, [bareme],
    )
    expect(total).toBe(500)
    expect(nonCalcules).toHaveLength(1)
    expect(nonCalcules[0].motif).toBe('puissance hors barème')
  })

  it('distingue « barème absent » de « puissance hors barème »', () => {
    // Les deux appellent une action différente : saisir le barème, ou corriger la fiche véhicule.
    const { nonCalcules } = totalIndemnitesKilometriques([vehicule({})], 2024, [bareme])
    expect(nonCalcules[0].motif).toBe('barème non renseigné pour cet exercice')
  })

  it('rend un total nul et rien à signaler sans véhicule', () => {
    expect(totalIndemnitesKilometriques([], 2025, [bareme])).toEqual({ total: 0, nonCalcules: [] })
  })
})

describe('cohérence de la fiche véhicule', () => {
  it('remet la puissance fiscale à zéro en basculant sur un cyclomoteur', () => {
    // Le défaut réel : une voiture de 6 CV passée en cyclomoteur gardait sa puissance. La ligne
    // « cyclomoteur » du barème ne couvrant que la puissance 0, l'indemnité repartait en « puissance
    // hors barème » — un calcul qui échoue alors que rien à l'écran ne paraît faux, le champ étant
    // grisé.
    expect(completerModificationVehicule({ type: 'cyclomoteur' }))
      .toEqual({ type: 'cyclomoteur', puissance_fiscale: 0 })
  })

  it('laisse la puissance fiscale tranquille sur une voiture ou une moto', () => {
    expect(completerModificationVehicule({ type: 'voiture' })).toEqual({ type: 'voiture' })
    expect(completerModificationVehicule({ type: 'moto' })).toEqual({ type: 'moto' })
  })

  it('efface le carburant d’un véhicule électrique ou à hydrogène', () => {
    // Aucun des carburants du formulaire (gazole, sans plomb, GPL) ne s'applique. Laisser la valeur
    // précédente ferait porter au 2035-B un carburant que le véhicule ne consomme pas.
    for (const motorisation of ['electrique', 'hydrogene'] as const) {
      expect(completerModificationVehicule({ motorisation })).toEqual({ motorisation, carburant: null })
    }
  })

  it('garde le carburant d’un thermique ou d’un hybride', () => {
    // Un hybride consomme bien du carburant — l'effacer lui retirerait une information juste.
    for (const motorisation of ['thermique', 'hybride'] as const) {
      expect(completerModificationVehicule({ motorisation })).toEqual({ motorisation })
    }
  })

  it('efface aussi le carburant quand la motorisation est vidée', () => {
    // « — » remet la motorisation à null : on ne sait plus ce que le véhicule consomme, et un
    // carburant hérité de la saisie précédente serait une affirmation que plus rien ne soutient.
    expect(completerModificationVehicule({ motorisation: null })).toEqual({ motorisation: null })
  })

  it('ne touche pas aux champs qu’on ne modifie pas', () => {
    // La règle complète une modification, elle n'en invente pas : modifier le seul kilométrage ne
    // doit rien remettre à zéro au passage.
    expect(completerModificationVehicule({ km_professionnel: 12_000 })).toEqual({ km_professionnel: 12_000 })
    expect(completerModificationVehicule({ modele: 'Zoe' })).toEqual({ modele: 'Zoe' })
  })

  it('dit quand le carburant n’a pas de sens', () => {
    expect(carburantApplicable('electrique')).toBe(false)
    expect(carburantApplicable('hydrogene')).toBe(false)
    expect(carburantApplicable('thermique')).toBe(true)
    expect(carburantApplicable('hybride')).toBe(true)
    // Motorisation pas encore renseignée : la question reste ouverte, on ne grise pas.
    expect(carburantApplicable(null)).toBe(true)
  })
})

describe('exercicesProposables — ne plus choisir l’exercice à la place du cabinet', () => {
  it('propose les millésimes du barème quand rien n’est encore saisi', () => {
    expect(exercicesProposables([], [bareme])).toEqual([2025])
  })

  it('propose aussi un exercice qui porte déjà des véhicules sans barème', () => {
    // Des kilomètres saisis avant que le barème n'arrive doivent rester atteignables : sans cela,
    // les données deviendraient invisibles depuis l'écran et personne ne saurait qu'elles existent.
    expect(exercicesProposables([2023], [bareme])).toEqual([2025, 2023])
  })

  it('ne propose pas deux fois le même exercice', () => {
    expect(exercicesProposables([2025, 2025], [bareme])).toEqual([2025])
  })

  it('range du plus récent au plus ancien', () => {
    // L'exercice en cours de clôture est le plus probable : il doit tomber sous le pouce en premier.
    expect(exercicesProposables([2021, 2024, 2019], [bareme])).toEqual([2025, 2024, 2021, 2019])
  })

  it('propose les millésimes réellement saisis, pas une plage devinée', () => {
    // Sur les vrais barèmes : 2025 et 2026 sont ouverts, 2027 ne l'est pas — la liste ne doit pas
    // inventer d'année « en cours » que le calcul refuserait ensuite.
    expect(exercicesProposables([])).toEqual([2026, 2025])
  })
})

// ═══ Le calcul en entiers, et sa parité avec la base ═══════════════════════════════════════════════
//
// L'écriture du forfait kilométrique est VÉRIFIÉE en base : `ecrire_forfait_kilometrique` refait le calcul
// (`indemnite_kilometrique_centimes`) et refuse une écriture qui ne vaut pas son indemnité au centime. Un
// centime d'écart entre les deux calculs, c'est une écriture juste refusée en production — d'où trois
// gardes : la table SQL comparée ligne à ligne à celle-ci, deux empreintes relevées en base sur 15 552 cas,
// et l'arrondi que le calcul en flottants manquait.

describe('indemniteKilometriqueCentimes — le calcul en entiers, au centime', () => {
  it('arrondit le demi-centime vers le haut, là où le calcul en flottants le perdait', () => {
    // 45 km à 0,529 € font 23,805 € exactement. En flottants, 45 × 0,529 vaut 23,8049999… et `toFixed(2)`
    // rend 23,80 ; la base, qui calcule en entiers, rend 23,81 — et aurait refusé l'écriture de 23,80.
    const v: Vehicule = { type: 'voiture', puissanceFiscale: 3, kmProfessionnel: 45, electrique: false }
    expect(Number((45 * 0.529).toFixed(2))).toBe(23.8)
    expect(indemniteKilometriqueCentimes(v, 2025)).toBe(2381n)
    expect(indemniteKilometrique(v, 2025)).toBe(23.81)
  })

  it('rend les valeurs relevées en base', () => {
    // `indemnite_kilometrique_centimes` interrogée le 03/10/2026 sur ces véhicules.
    const cas: [Vehicule, number, bigint | null][] = [
      [{ type: 'voiture', puissanceFiscale: 5, kmProfessionnel: 12_000, electrique: false }, 2025, 567_900n],
      [{ type: 'voiture', puissanceFiscale: 5, kmProfessionnel: 20_000, electrique: true }, 2026, 1_023_400n],
      [{ type: 'moto', puissanceFiscale: 1, kmProfessionnel: 3001, electrique: false }, 2025, 118_810n],
      [{ type: 'cyclomoteur', puissanceFiscale: 0, kmProfessionnel: 6001, electrique: true }, 2026, 142_824n],
      [{ type: 'voiture', puissanceFiscale: 100, kmProfessionnel: 1000, electrique: false }, 2025, null],
      [{ type: 'moto', puissanceFiscale: 0, kmProfessionnel: 1000, electrique: false }, 2025, null],
      [{ type: 'voiture', puissanceFiscale: 5, kmProfessionnel: 1000, electrique: false }, 2024, null],
    ]
    for (const [v, annee, attendu] of cas) {
      expect(indemniteKilometriqueCentimes(v, annee), `${v.type} ${v.puissanceFiscale} CV ${v.kmProfessionnel} km ${annee}`).toBe(attendu)
    }
  })

  it('ne calcule rien sur un kilométrage qui n’est pas un nombre entier de kilomètres', () => {
    // La colonne est entière en base ; un champ de formulaire peut un instant porter 12,5. Rendre null —
    // et le dire — plutôt que de lever au milieu d'un rendu.
    const v = (km: number): Vehicule => ({ type: 'voiture', puissanceFiscale: 5, kmProfessionnel: km, electrique: false })
    expect(indemniteKilometriqueCentimes(v(12.5), 2025)).toBeNull()
    expect(indemniteKilometriqueCentimes(v(Number.NaN), 2025)).toBeNull()
    expect(motifNonCalcule(v(12.5), 2025)).toBe('kilométrage invalide')
    expect(motifNonCalcule(v(-1), 2025)).toBe('kilométrage invalide')
    expect(motifNonCalcule(v(1000), 2024)).toBe('barème non renseigné pour cet exercice')
    expect(motifNonCalcule({ ...v(1000), puissanceFiscale: 100 }, 2025)).toBe('puissance hors barème')
  })

  it('additionne les véhicules en centimes', () => {
    // Trois indemnités à demi-centime : 23,81 € chacune, 71,43 € ensemble. Additionner des flottants
    // arrondis ferait dériver le total de la somme des écritures.
    const v: Vehicule = { type: 'voiture', puissanceFiscale: 3, kmProfessionnel: 45, electrique: false }
    expect(totalIndemnitesKilometriques([v, v, v], 2025).total).toBe(71.43)
  })
})

describe('le barème est le même en base et ici', () => {
  // La table que `bareme_kilometrique()` sert en base, lue dans la DERNIÈRE migration qui la définit : une
  // migration qui la remplace l'emporte sur les précédentes, comme en base.
  function baremeEnBase(): Map<number, string[]> {
    const definitions = fichiersDuSchema()
      .filter((f) => /create (or replace )?function public\.bareme_kilometrique\(\)/.test(f.texte))
    expect(definitions.length, 'aucune migration ne définit bareme_kilometrique()').toBeGreaterThan(0)
    const texte = definitions[definitions.length - 1].texte
    const debut = texte.indexOf('-- ── DÉBUT BARÈME ──')
    const fin = texte.indexOf('-- ── FIN BARÈME ──')
    expect(debut, 'bornes du barème introuvables').toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    const parAnnee = new Map<number, string[]>()
    const ligne = /\(array\[([\d, ]+)\], '(\w+)', (\d+), (\d+), (true|false), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\)/g
    let lues = 0
    for (const m of texte.slice(debut, fin).matchAll(ligne)) {
      lues++
      const [, annees, ...reste] = m
      for (const annee of annees.split(',').map((a) => Number(a.trim()))) {
        parAnnee.set(annee, [...(parAnnee.get(annee) ?? []), reste.join('|')])
      }
    }
    // Chaque ligne du bloc doit être lue : une ligne d'une autre forme, sautée, ferait passer une table
    // amputée pour la bonne.
    const lignesDuBloc = texte.slice(debut, fin).split('\n').filter((l) => l.trim().startsWith('(array['))
    expect(lues).toBe(lignesDuBloc.length)
    return parAnnee
  }

  // La même table, mise en forme comme la ligne SQL : type, puissances, électrique, puis les trois tranches
  // en millièmes d'euro par kilomètre et en euros.
  function baremeIci(): Map<number, string[]> {
    return new Map(BAREMES.map((b) => [b.annee, b.lignes.map((l) => {
      const [t1, t2, t3] = l.tranches
      return [l.type, l.puissanceMin, l.puissanceMax, l.electrique, t1.jusqua, Math.round(t1.coefficient * 1000), t1.forfait,
        t2.jusqua, Math.round(t2.coefficient * 1000), t2.forfait, Math.round(t3.coefficient * 1000), t3.forfait].join('|')
    })]))
  }

  it('a la forme que la table SQL sait porter', () => {
    for (const b of BAREMES) {
      for (const l of b.lignes) {
        const nom = `${b.annee} ${l.type} ${l.puissanceMin}-${l.puissanceMax}${l.electrique ? ' électrique' : ''}`
        // Trois tranches, les deux premières bornées, la dernière non.
        expect(l.tranches.map((t) => t.jusqua === null), nom).toEqual([false, false, true])
        for (const t of l.tranches) {
          // Un coefficient au millième près et un forfait en euros entiers : le calcul en entiers n'est
          // exact qu'à cette condition, ici comme en base.
          expect(Math.abs(t.coefficient * 1000 - Math.round(t.coefficient * 1000)), nom).toBeLessThan(1e-9)
          expect(Number.isInteger(t.forfait), nom).toBe(true)
        }
      }
    }
  })

  it('ne fait jamais correspondre deux lignes au même véhicule', () => {
    // En base, deux lignes qui se chevauchent rendraient l'une ou l'autre au hasard du plan de la requête.
    for (const b of BAREMES) {
      for (const type of ['voiture', 'moto', 'cyclomoteur'] as const) {
        for (const electrique of [false, true]) {
          for (let p = 0; p <= 120; p++) {
            const lignes = b.lignes.filter((l) => l.type === type && l.electrique === electrique && p >= l.puissanceMin && p <= l.puissanceMax)
            expect(lignes.length, `${b.annee} ${type} ${p} CV`).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('porte les mêmes années et les mêmes lignes que la base', () => {
    const base = baremeEnBase()
    const ici = baremeIci()
    expect([...base.keys()].sort()).toEqual([...ici.keys()].sort())
    for (const [annee, lignes] of ici) expect(base.get(annee), `barème ${annee}`).toEqual(lignes)
  })

  // Le calcul de la base relevé sur deux grilles, et leur empreinte : `indemnite_kilometrique_centimes`
  // interrogée le 03/10/2026, chaque valeur en centimes ou « null », jointes par des virgules dans l'ordre
  // des boucles ci-dessous.
  const empreinte = (valeurs: (bigint | null)[]) =>
    createHash('md5').update(valeurs.map((v) => (v === null ? 'null' : v.toString())).join(',')).digest('hex')
  const ANNEES = [2024, 2025, 2026, 2027]

  it('rend le calcul de la base sur toutes les lignes, autour de chaque borne et sur chaque reste', () => {
    // Une puissance par ligne du barème ; les kilométrages de 0 à 40 (chaque reste d'une division par
    // dix, donc chaque façon de tomber sur un demi-centime), autour des quatre bornes, et quelques autres.
    const lignes: [TypeVehicule, number, boolean][] = [
      ['voiture', 3, false], ['voiture', 4, false], ['voiture', 5, false], ['voiture', 6, false], ['voiture', 7, false],
      ['voiture', 3, true], ['voiture', 4, true], ['voiture', 5, true], ['voiture', 6, true], ['voiture', 7, true],
      ['moto', 1, false], ['moto', 3, false], ['moto', 6, false], ['moto', 1, true], ['moto', 3, true], ['moto', 6, true],
      ['cyclomoteur', 0, false], ['cyclomoteur', 0, true],
    ]
    const autour = (borne: number) => Array.from({ length: 21 }, (_, k) => borne - 10 + k)
    const kms = [...new Set([...Array.from({ length: 41 }, (_, k) => k), ...autour(3000), ...autour(5000), ...autour(6000),
      ...autour(20_000), 1234, 7777, 12_345, 25_000, 33_333, 99_999])].sort((a, b) => a - b)
    const valeurs: (bigint | null)[] = []
    for (const annee of ANNEES) {
      for (const [type, puissanceFiscale, electrique] of lignes) {
        for (const kmProfessionnel of kms) {
          valeurs.push(indemniteKilometriqueCentimes({ type, puissanceFiscale, electrique, kmProfessionnel }, annee))
        }
      }
    }
    expect(valeurs).toHaveLength(9432)
    expect(valeurs.filter((v) => v !== null)).toHaveLength(4716)
    expect(empreinte(valeurs)).toBe('bdea448eb4631716e6bb1282e6c1410d')
  })

  it('choisit la même ligne que la base pour chaque type, chaque motorisation et chaque puissance', () => {
    const puissances = [...Array.from({ length: 13 }, (_, k) => k), 99, 100]
    const kms = [0, 1, 45, 2999, 3000, 3001, 4999, 5000, 5001, 5999, 6000, 6001, 12_345, 19_999, 20_000, 20_001, 35_000]
    const valeurs: (bigint | null)[] = []
    for (const annee of ANNEES) {
      for (const type of ['voiture', 'moto', 'cyclomoteur'] as const) {
        for (const electrique of [false, true]) {
          for (const puissanceFiscale of puissances) {
            for (const kmProfessionnel of kms) {
              valeurs.push(indemniteKilometriqueCentimes({ type, puissanceFiscale, electrique, kmProfessionnel }, annee))
            }
          }
        }
      }
    }
    expect(valeurs).toHaveLength(6120)
    expect(valeurs.filter((v) => v !== null)).toHaveLength(1904)
    expect(empreinte(valeurs)).toBe('68dabf7d77edaf698ad8ba7b5730a51b')
  })
})
