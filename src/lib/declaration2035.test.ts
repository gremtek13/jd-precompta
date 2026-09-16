import { describe, expect, it } from 'vitest'
import {
  calculerDeclaration2035, dotationPourAnnee,
  POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_INDEMNITES_KM,
} from './declaration2035'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece, VehiculeDossier } from './types'

const categories = [
  { id: 'c-achats', poste_2035: 'Achats' },
  { id: 'c-loyer', poste_2035: 'Loyers et charges locatives' },
  { id: 'c-recettes', poste_2035: 'Recettes' },
  { id: 'c-sans-poste', poste_2035: null },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10',
    montant_ht: 100, montant_ttc: 120, categorie_id: 'c-achats', ...o,
  }) as Piece

const calcul = (o: {
  pieces?: Piece[]; immos?: Immobilisation[]; cotis?: CotisationDeclaree[]; annee?: number
  vehicules?: VehiculeDossier[]
}) => calculerDeclaration2035(
  o.annee ?? 2025, o.pieces ?? [], categories, o.immos ?? [], o.cotis ?? [], o.vehicules ?? [],
)

const vehicule = (o: Partial<VehiculeDossier>): VehiculeDossier =>
  ({
    id: 'v', annee: 2025, type: 'voiture', puissance_fiscale: 6, motorisation: 'thermique',
    km_professionnel: 4000, ...o,
  }) as VehiculeDossier

describe('calculerDeclaration2035 — périmètre', () => {
  it('ne retient que les pièces validées', () => {
    // Une pièce « à valider » n'est pas encore relue par le cabinet : la faire entrer dans une
    // déclaration fiscale reviendrait à déclarer ce que l'OCR a cru lire.
    const d = calcul({ pieces: [piece({ id: 'a', statut: 'a_valider' }), piece({ id: 'b' })] })
    expect(d.depenses[0].nbPieces).toBe(1)
    expect(d.totalDepenses).toBe(100)
  })

  it('ne retient que l’exercice demandé', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', date_piece: '2024-12-31' }), piece({ id: 'b', date_piece: '2025-01-01' })],
    })
    expect(d.totalDepenses).toBe(100)
    // Une pièce d'un autre exercice n'est pas une anomalie : elle ne doit pas être signalée.
    expect(d.exclusions.sansDate).toHaveLength(0)
    expect(d.exclusions.sansPoste).toHaveLength(0)
  })

  it('préfère le montant HT au TTC', () => {
    // Le 2035 se déclare hors taxe quand la TVA est récupérable. Prendre le TTC gonflerait la charge
    // du montant de la TVA, qui est déjà suivie à part.
    const d = calcul({ pieces: [piece({ montant_ht: 100, montant_ttc: 120 })] })
    expect(d.totalDepenses).toBe(100)
  })

  it('retombe sur le TTC quand le HT est absent', () => {
    const d = calcul({ pieces: [piece({ montant_ht: null, montant_ttc: 120 })] })
    expect(d.totalDepenses).toBe(120)
  })
})

describe('calculerDeclaration2035 — ce qui est écarté est dit', () => {
  it('remonte une pièce dont la catégorie n’a pas de poste 2035', () => {
    // Le défaut le plus grave que ce moteur corrige : l'ancien calcul l'écartait par un `continue`
    // muet. Une pièce validée, datée, chiffrée, mais absente du total sans que rien ne l'indique.
    const orpheline = piece({ id: 'orpheline', categorie_id: 'c-sans-poste' })
    const d = calcul({ pieces: [piece({ id: 'ok' }), orpheline] })
    expect(d.totalDepenses).toBe(100)
    expect(d.exclusions.sansPoste.map((p) => p.id)).toEqual(['orpheline'])
  })

  it('remonte une pièce sans catégorie du tout', () => {
    const d = calcul({ pieces: [piece({ id: 'nue', categorie_id: null })] })
    expect(d.exclusions.sansPoste.map((p) => p.id)).toEqual(['nue'])
  })

  it('remonte une pièce sans date, sans la confondre avec un autre exercice', () => {
    const d = calcul({ pieces: [piece({ id: 'sansdate', date_piece: null })] })
    expect(d.exclusions.sansDate.map((p) => p.id)).toEqual(['sansdate'])
    expect(d.totalDepenses).toBe(0)
  })

  it('remonte une pièce sans montant lisible', () => {
    const d = calcul({ pieces: [piece({ id: 'vide', montant_ht: null, montant_ttc: null })] })
    expect(d.exclusions.sansMontant.map((p) => p.id)).toEqual(['vide'])
  })
})

describe('calculerDeclaration2035 — totaux et résultat', () => {
  it('sépare recettes et dépenses, et calcule le résultat', () => {
    const d = calcul({
      pieces: [
        piece({ id: 'v', type_piece: 'vente', categorie_id: 'c-recettes', montant_ht: 1000 }),
        piece({ id: 'a', montant_ht: 300 }),
        piece({ id: 'l', categorie_id: 'c-loyer', montant_ht: 200 }),
      ],
    })
    expect(d.totalRecettes).toBe(1000)
    expect(d.totalDepenses).toBe(500)
    expect(d.resultat).toBe(500)
  })

  it('rend un résultat négatif en cas de déficit', () => {
    // Bénéfice et déficit ne vont pas dans la même case du formulaire : le moteur doit rendre le
    // signe, pas une valeur absolue que le consommateur devrait réinterpréter.
    const d = calcul({ pieces: [piece({ id: 'a', montant_ht: 800 })] })
    expect(d.resultat).toBe(-800)
  })

  it('rend des montants toujours positifs, le sens étant porté par `nature`', () => {
    const d = calcul({ pieces: [piece({ id: 'a', montant_ht: 300 })] })
    expect(d.depenses[0].montant).toBe(300)
    expect(d.depenses[0].nature).toBe('depense')
  })

  it('soustrait un avoir du poste plutôt que d’en faire une recette', () => {
    // Un montant négatif (avoir, remboursement fournisseur) diminue la charge ; en faire une recette
    // gonflerait à la fois les produits et les charges.
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 300 }), piece({ id: 'avoir', montant_ht: -100 })],
    })
    expect(d.totalDepenses).toBe(200)
    expect(d.totalRecettes).toBe(0)
  })

  it('cumule plusieurs pièces sur un même poste et les compte', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 100 }), piece({ id: 'b', montant_ht: 50 })],
    })
    expect(d.depenses).toHaveLength(1)
    expect(d.depenses[0].montant).toBe(150)
    expect(d.depenses[0].nbPieces).toBe(2)
  })

  it('classe les postes du plus gros au plus petit', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 100 }), piece({ id: 'l', categorie_id: 'c-loyer', montant_ht: 900 })],
    })
    expect(d.depenses.map((l) => l.poste)).toEqual(['Loyers et charges locatives', 'Achats'])
  })
})

describe('amortissements et cotisations', () => {
  const immo = (o: Partial<Immobilisation>): Immobilisation =>
    ({ id: 'i', piece_id: null, date_acquisition: '2024-06-01', valeur: 3000, duree_annees: 3, ...o }) as Immobilisation

  it('compte la dotation sur chaque année de la durée, pas seulement l’année d’achat', () => {
    expect(dotationPourAnnee(immo({}), 2024)).toBe(1000)
    expect(dotationPourAnnee(immo({}), 2025)).toBe(1000)
    expect(dotationPourAnnee(immo({}), 2026)).toBe(1000)
  })

  it('ne compte rien avant l’acquisition ni après la fin de la durée', () => {
    expect(dotationPourAnnee(immo({}), 2023)).toBe(0)
    expect(dotationPourAnnee(immo({}), 2027)).toBe(0)
  })

  it('ajoute la dotation comme dépense sur son propre poste', () => {
    const d = calcul({ immos: [immo({})] })
    expect(d.depenses.find((l) => l.poste === POSTE_AMORTISSEMENTS)?.montant).toBe(1000)
  })

  it('remplace le montant d’achat d’une pièce immobilisée par sa dotation', () => {
    // Sans ça, un ordinateur à 3 000 € serait compté intégralement en charge l'année de l'achat ET
    // amorti sur trois ans — la dépense apparaîtrait deux fois.
    const d = calcul({
      pieces: [piece({ id: 'ordi', montant_ht: 3000 })],
      immos: [immo({ piece_id: 'ordi' })],
    })
    expect(d.depenses.find((l) => l.poste === 'Achats')).toBeUndefined()
    expect(d.totalDepenses).toBe(1000)
  })

  it('retient le montant versé plutôt que l’appel quand il est connu', () => {
    const d = calcul({
      cotis: [{ echeance: '2025-05-05', montant_appele: 500, montant_verse: 480 } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(480)
  })

  it('retombe sur l’appel quand rien n’a encore été versé', () => {
    const d = calcul({
      cotis: [{ echeance: '2025-05-05', montant_appele: 500, montant_verse: null } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(500)
  })

  it('ignore une cotisation d’un autre exercice', () => {
    const d = calcul({
      cotis: [{ echeance: '2024-05-05', montant_appele: 500, montant_verse: 500 } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)).toBeUndefined()
  })
})

describe('calculerDeclaration2035 — indemnités kilométriques', () => {
  it('porte le total du cadre 7 dans un poste à lui', () => {
    // 4 000 km, 6 CV thermique : l'exemple publié par l'administration, 2 660 €.
    const d = calcul({ vehicules: [vehicule({})] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)?.montant).toBe(2660)
    expect(d.totalDepenses).toBe(2660)
  })

  it('n’emprunte pas le kilométrage d’un autre exercice', () => {
    // L'option pour le forfait se prend au 1er janvier et vaut l'année entière (notice, renvoi 12) :
    // un véhicule saisi pour 2024 n'a rien à faire dans la déclaration 2025.
    const d = calcul({ vehicules: [vehicule({ annee: 2024 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)).toBeUndefined()
    expect(d.indemnitesKilometriques).toBeNull()
  })

  it('additionne les véhicules d’un même exercice', () => {
    const d = calcul({
      vehicules: [vehicule({ id: 'a' }), vehicule({ id: 'b', puissance_fiscale: 3, km_professionnel: 1000 })],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)?.montant).toBe(2660 + 529)
  })

  it('remonte un véhicule non calculé au lieu de le faire disparaître', () => {
    // Absent du total, c'est une déduction perdue que personne ne verrait manquer — et sur le PDF,
    // rien ne distinguerait une case BJ amputée d'une case BJ juste.
    const d = calcul({ vehicules: [vehicule({}), vehicule({ id: 'b', annee: 2023 })], annee: 2023 })
    expect(d.indemnitesKilometriques?.total).toBe(0)
    expect(d.indemnitesKilometriques?.nonCalcules).toHaveLength(1)
    expect(d.indemnitesKilometriques?.nonCalcules[0].motif).toBe('barème non renseigné pour cet exercice')
  })

  it('ne crée pas de poste quand le total est nul', () => {
    // Un véhicule déclaré sans trajet professionnel est un cas réel : il ne doit pas écrire une
    // ligne à zéro dans la déclaration, mais il ne doit pas non plus être signalé comme un défaut.
    const d = calcul({ vehicules: [vehicule({ km_professionnel: 0 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)).toBeUndefined()
    expect(d.indemnitesKilometriques).toEqual({ total: 0, nonCalcules: [] })
  })

  it('range un hybride et un véhicule à hydrogène dans la table thermique', () => {
    // Seuls les 100 % électriques ont leur propre table. Confondre les deux vaut 20 % de la
    // déduction — 3 192 € au lieu de 2 660 € sur le même trajet.
    const thermique = calcul({ vehicules: [vehicule({})] }).indemnitesKilometriques?.total
    for (const motorisation of ['hybride', 'hydrogene'] as const) {
      expect(calcul({ vehicules: [vehicule({ motorisation })] }).indemnitesKilometriques?.total)
        .toBe(thermique)
    }
    expect(calcul({ vehicules: [vehicule({ motorisation: 'electrique' })] }).indemnitesKilometriques?.total)
      .toBe(3192)
  })
})
