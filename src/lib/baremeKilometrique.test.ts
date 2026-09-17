import { describe, expect, it } from 'vitest'
import {
  BAREMES,
  baremeDeLAnnee,
  carburantApplicable,
  completerModificationVehicule,
  exercicesProposables,
  indemniteKilometrique,
  totalIndemnitesKilometriques,
} from './baremeKilometrique'
import type { BaremeAnnuel, Vehicule } from './baremeKilometrique'

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
