import { describe, expect, it } from 'vitest'
import {
  arrondirPourFormulaire,
  CASES_2035,
  CASE_PAR_CODE,
  CODES_TOTALISES_BR,
  caseDuPoste,
  doublonFraisVehicules,
  incoherencesDesCases,
  repartirEnCases,
  valeursDesCases,
} from './cases2035'
import {
  calculerDeclaration2035, POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_CSG_DEDUCTIBLE, POSTE_INDEMNITES_KM,
} from './declaration2035'
import type { Declaration2035, LigneDeclaration } from './declaration2035'
import type { Categorie, Piece, VehiculeDossier } from './types'

const ligne = (o: Partial<LigneDeclaration>): LigneDeclaration =>
  ({ poste: 'Achats', nature: 'depense', montant: 100, nbPieces: 1, ...o })

const declaration = (o: Partial<Declaration2035>): Declaration2035 => ({
  annee: 2025,
  recettes: [],
  depenses: [],
  totalRecettes: 0,
  totalDepenses: 0,
  resultat: 0,
  exclusions: { sansPoste: [], sansDate: [], sansMontant: [] },
  indemnitesKilometriques: null,
  ...o,
})

describe('table des cases — fidélité au formulaire', () => {
  it('donne exactement les quinze cases qui composent le total BR', () => {
    // La liste est dérivée du tableau (cadre dépenses, ni calculée ni « dont »). Ce test la fige :
    // si une case entre ou sort du total par accident, BR devient faux sans que rien ne le dise.
    expect([...CODES_TOTALISES_BR].sort()).toEqual(
      ['BA', 'BB', 'BC', 'BD', 'BF', 'BG', 'BH', 'BJ', 'BK', 'BM', 'BN', 'BP', 'BS', 'BV', 'JY'].sort(),
    )
  })

  it('n’attribue aucun code deux fois', () => {
    expect(CASE_PAR_CODE.size).toBe(CASES_2035.length)
  })

  it('rattache chaque case « dont » à une case qui existe vraiment', () => {
    for (const c of CASES_2035.filter((c) => c.sousCaseDe)) {
      expect(CASE_PAR_CODE.has(c.sousCaseDe!), `${c.code} → ${c.sousCaseDe}`).toBe(true)
    }
  })

  it('tient BH, BJ et BM pour des totaux groupés, pas pour les lignes en face desquelles ils sont imprimés', () => {
    // Le point sur lequel une lecture rapide du PDF se trompe : BH est aligné sur « petit outillage »
    // (ligne 19) mais couvre les lignes 17 à 22, faute de quoi les lignes 17, 18, 20, 21 et 22
    // n'auraient aucune case et ne pourraient jamais entrer dans BR (ligne 33 = total lignes 8 à 32).
    expect(CASE_PAR_CODE.get('BH')?.ligne).toBe('17 à 22')
    expect(CASE_PAR_CODE.get('BJ')?.ligne).toBe('23 et 24')
    expect(CASE_PAR_CODE.get('BM')?.ligne).toBe('26 à 30')
    for (const code of ['BH', 'BJ', 'BM']) expect(CODES_TOTALISES_BR).toContain(code)
  })

  it('place les amortissements sur le 2035-B, hors du total des dépenses', () => {
    // Ligne 41 du 2035-B, pas le cadre 3 : les compter dans BR gonflerait les dépenses du cadre 3 et
    // les ferait entrer une seconde fois par la ligne 45.
    expect(CASE_PAR_CODE.get('CH')?.formulaire).toBe('2035-B')
    expect(CODES_TOTALISES_BR).not.toContain('CH')
  })
})

describe('rattachement poste → case', () => {
  it('rattache les neuf catégories par défaut du produit', () => {
    const attendu: [string, string][] = [
      ['Recettes', 'AA'],
      ['Achats', 'BA'],
      ['Loyers et charges locatives', 'BF'],
      ['Honoraires ne constituant pas des rétrocessions', 'BH'],
      ["Primes d'assurance", 'BH'],
      ['Frais de déplacement', 'BJ'],
      ['Frais de réception, de représentation', 'BM'],
      ['Frais financiers', 'BN'],
      ['Divers', 'BM'],
    ]
    for (const [poste, code] of attendu) {
      expect(caseDuPoste(poste)?.code, poste).toBe(code)
    }
  })

  it('rattache aussi les postes du moteur qui ne viennent pas d’une catégorie', () => {
    expect(caseDuPoste(POSTE_AMORTISSEMENTS)?.code).toBe('CH')
    expect(caseDuPoste(POSTE_COTISATIONS)?.code).toBe('BK')
  })

  it('ignore accents, casse et ponctuation du libellé saisi', () => {
    // Le poste est un champ libre tapé par le cabinet : « frais de reception de representation » doit
    // trouver la même case que le libellé officiel, sinon le rattachement dépend du clavier.
    expect(caseDuPoste('frais de reception de representation')?.code).toBe('BM')
    expect(caseDuPoste('  PRIMES D’ASSURANCE  ')?.code).toBe('BH')
  })

  it('ne rattache aucun poste à une case « dont »', () => {
    // Une case « dont » ne s'additionne pas : un poste qui y atterrirait sortirait du total sans que
    // rien ne le signale. Cotisations syndicales (ligne 29) doit donc viser BM, pas BY.
    expect(caseDuPoste('Cotisations syndicales et professionnelles')?.code).toBe('BM')
    for (const poste of ['Cotisations syndicales et professionnelles', POSTE_COTISATIONS, 'Location de matériel et de mobilier']) {
      expect(caseDuPoste(poste)?.sousCaseDe, poste).toBeUndefined()
    }
  })

  it('laisse « Honoraires » tout court sans case', () => {
    // Recette ligne 1 chez le praticien, dépense ligne 21 chez celui qui les paie : trancher tout
    // seul reviendrait à choisir le sens d'un montant à pile ou face.
    expect(caseDuPoste('Honoraires')).toBeNull()
  })

  it('rend null sur un poste inconnu plutôt qu’une case au hasard', () => {
    expect(caseDuPoste('Poste maison inventé')).toBeNull()
  })
})

describe('répartition d’une déclaration dans les cases', () => {
  it('additionne dans une seule case les postes qui la partagent', () => {
    // Le cas concret du produit : « Honoraires ne constituant pas des rétrocessions » et
    // « Primes d'assurance » sont deux catégories mais un seul encadré du formulaire.
    const { cases } = repartirEnCases(declaration({
      depenses: [
        ligne({ poste: 'Honoraires ne constituant pas des rétrocessions', montant: 300, nbPieces: 21 }),
        ligne({ poste: "Primes d'assurance", montant: 200, nbPieces: 3 }),
      ],
    }))
    expect(cases).toHaveLength(1)
    expect(cases[0].case.code).toBe('BH')
    expect(cases[0].montant).toBe(500)
    expect(cases[0].nbPieces).toBe(24)
    expect(cases[0].postes).toHaveLength(2)
  })

  it('LA CSG DÉDUCTIBLE ATTERRIT EN BV, SÉPARÉE DE LA LIGNE 25', () => {
    // Sans ce test, retirer le rattachement `POSTE_CSG_DEDUCTIBLE → BV` laissait TOUT vert : le
    // moteur calculait bien les 680 €, et ils tombaient dans `postesSansCase` sans que rien ne le
    // vérifie — donc absents du formulaire, sur la case même que ce chantier existe pour remplir.
    const { cases, postesSansCase } = repartirEnCases(declaration({
      depenses: [
        ligne({ poste: POSTE_COTISATIONS, montant: 4030 }),
        ligne({ poste: POSTE_CSG_DEDUCTIBLE, montant: 680 }),
      ],
    }))
    expect(postesSansCase).toHaveLength(0)
    expect(cases.find((c) => c.case.code === 'BV')?.montant).toBe(680)
    // Et surtout PAS fondues dans la même case : BK et BV entrent toutes deux dans le total des
    // lignes 8 à 32, donc la CSG comptée dans les deux serait déduite deux fois.
    expect(cases.find((c) => c.case.code === 'BK')?.montant).toBe(4030)
  })

  it('remonte un poste sans case au lieu de le perdre', () => {
    const { cases, postesSansCase } = repartirEnCases(declaration({
      depenses: [ligne({ poste: 'Achats' }), ligne({ poste: 'Poste maison', montant: 42 })],
    }))
    expect(cases).toHaveLength(1)
    expect(postesSansCase).toHaveLength(1)
    expect(postesSansCase[0].raison).toBe('aucune case connue')
    expect(postesSansCase[0].ligne.montant).toBe(42)
  })

  it('refuse de mettre une dépense dans une case de recettes', () => {
    // Le rattachement se fait sur un libellé, le sens vient du type de pièce. Une dépense classée
    // « Recettes » compterait deux fois à l'envers dans le résultat.
    const { cases, postesSansCase } = repartirEnCases(declaration({
      depenses: [ligne({ poste: 'Recettes', montant: 100 })],
    }))
    expect(cases).toHaveLength(0)
    expect(postesSansCase[0].raison).toBe('case du mauvais sens')
    expect(postesSansCase[0].codeRefuse).toBe('AA')
  })

  it('rend les cases dans l’ordre du formulaire, pas dans l’ordre des montants', () => {
    const { cases } = repartirEnCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 10 })],
      depenses: [ligne({ poste: 'Frais financiers', montant: 9000 }), ligne({ poste: 'Achats', montant: 50 })],
    }))
    expect(cases.map((c) => c.case.code)).toEqual(['AA', 'BA', 'BN'])
  })
})

describe('valeurs des cases — l’addition du formulaire', () => {
  it('calcule AD, AG et BR à partir des cases alimentées', () => {
    const { valeurs } = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 10_000 })],
      depenses: [ligne({ poste: 'Achats', montant: 1000 }), ligne({ poste: 'Loyers et charges locatives', montant: 500 })],
    }))
    expect(valeurs.get('AD')).toBe(10_000)
    expect(valeurs.get('AG')).toBe(10_000)
    expect(valeurs.get('BR')).toBe(1500)
  })

  it('déduit les débours et les rétrocessions du montant net des recettes', () => {
    const { valeurs } = valeursDesCases(declaration({
      recettes: [
        ligne({ poste: 'Recettes', nature: 'recette', montant: 10_000 }),
        ligne({ poste: 'Débours', nature: 'recette', montant: 400 }),
        ligne({ poste: 'Honoraires rétrocédés', nature: 'recette', montant: 600 }),
      ],
    }))
    expect(valeurs.get('AA')).toBe(10_000)
    expect(valeurs.get('AD')).toBe(9000)
    expect(valeurs.get('AG')).toBe(9000)
  })

  it('remplit l’excédent ou l’insuffisance, jamais les deux', () => {
    const benefice = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 10_000 })],
      depenses: [ligne({ poste: 'Achats', montant: 4000 })],
    })).valeurs
    expect(benefice.get('CA')).toBe(6000)
    expect(benefice.get('CF')).toBe(0)

    const deficit = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 1000 })],
      depenses: [ligne({ poste: 'Achats', montant: 4000 })],
    })).valeurs
    expect(deficit.get('CA')).toBe(0)
    expect(deficit.get('CF')).toBe(3000)
  })

  it('fait descendre les amortissements dans le résultat par la ligne 45, pas par BR', () => {
    const { valeurs } = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 10_000 })],
      depenses: [ligne({ poste: 'Achats', montant: 1000 }), ligne({ poste: POSTE_AMORTISSEMENTS, montant: 2000 })],
    }))
    expect(valeurs.get('BR')).toBe(1000)
    expect(valeurs.get('CH')).toBe(2000)
    expect(valeurs.get('CA')).toBe(9000)
    expect(valeurs.get('CN')).toBe(2000)
    expect(valeurs.get('CP')).toBe(7000)
    expect(valeurs.get('CR')).toBe(0)
  })

  it('remplit le déficit quand les charges dépassent les recettes', () => {
    const { valeurs } = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 1000 })],
      depenses: [ligne({ poste: 'Achats', montant: 1200 }), ligne({ poste: POSTE_AMORTISSEMENTS, montant: 500 })],
    }))
    expect(valeurs.get('CF')).toBe(200)
    expect(valeurs.get('CN')).toBe(700)
    expect(valeurs.get('CP')).toBe(0)
    expect(valeurs.get('CR')).toBe(700)
  })

  it('met un zéro dans toutes les cases, y compris celles qu’aucun poste n’alimente', () => {
    // Le PDF a besoin d'une valeur par case : un trou laisserait une case blanche là où le
    // formulaire attend un chiffre.
    const { valeurs } = valeursDesCases(declaration({}))
    for (const c of CASES_2035) expect(valeurs.get(c.code), c.code).toBe(0)
  })
})

describe('une case « dont » ne peut pas dépasser sa porteuse', () => {
  it('signale BW supérieure à BG', () => {
    // Notice 2035-NOT-SD, note (9) : BG porte le total des locations « y compris ces redevances »,
    // BW en isole la part « redevances de collaboration ». BW > BG est donc contradictoire.
    const [i] = incoherencesDesCases(new Map([['BW', 850], ['BG', 0]]))
    expect(i.porteuse.code).toBe('BG')
    expect(i.sousCases.map((c) => c.code)).toEqual(['BW'])
    expect(i.totalSousCases).toBe(850)
    expect(i.montantPorteuse).toBe(0)
  })

  it('additionne les sous-cases d’une même porteuse avant de comparer', () => {
    // BT, BZ et BU sont trois parts disjointes de BK : chacune passe seule, leur somme non.
    expect(incoherencesDesCases(new Map([['BT', 5000], ['BZ', 4000], ['BU', 3000], ['BK', 12_000]]))).toEqual([])
    const [i] = incoherencesDesCases(new Map([['BT', 5000], ['BZ', 4000], ['BU', 3000], ['BK', 11_000]]))
    expect(i.porteuse.code).toBe('BK')
    expect(i.totalSousCases).toBe(12_000)
  })

  it('accepte une sous-case égale à sa porteuse', () => {
    // Un praticien dont toute la location est une redevance de collaboration : BW = BG, c'est valide.
    expect(incoherencesDesCases(new Map([['BW', 850], ['BG', 850]]))).toEqual([])
  })

  it('ne dit rien quand aucune sous-case n’est renseignée', () => {
    // Le cas normal : le moteur ne remplit jamais une case « dont ». Une porteuse seule est valide.
    expect(incoherencesDesCases(new Map([['BG', 9000], ['BK', 14_800]]))).toEqual([])
    expect(incoherencesDesCases(new Map())).toEqual([])
  })

  it('ne se déclenche pas sur un écart d’arrondi', () => {
    expect(incoherencesDesCases(new Map([['BW', 850.004], ['BG', 850]]))).toEqual([])
  })
})

describe('arrondi à l’euro — le formulaire doit s’additionner', () => {
  it('recalcule les totaux à partir des cases arrondies', () => {
    // Trois cases à 0,50 € : arrondies indépendamment elles font 1 + 1 + 1 = 3, alors que la somme
    // exacte arrondie ferait 2. Le formulaire imprimé doit tomber juste colonne par colonne, donc
    // c'est bien 3 qu'on attend — un contrôleur qui additionne la colonne doit retrouver le total.
    const valeurs = new Map<string, number>([['BA', 0.5], ['BF', 0.5], ['BN', 0.5]])
    const arrondies = arrondirPourFormulaire(valeurs)
    expect(arrondies.get('BA')).toBe(1)
    expect(arrondies.get('BR')).toBe(3)
  })

  it('ne laisse aucun centime dans une case', () => {
    const { valeurs } = valeursDesCases(declaration({
      recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 10_000.49 })],
      depenses: [ligne({ poste: 'Achats', montant: 1234.56 })],
    }))
    const arrondies = arrondirPourFormulaire(valeurs)
    for (const [code, montant] of arrondies) expect(Number.isInteger(montant), `${code} = ${montant}`).toBe(true)
    expect(arrondies.get('AA')).toBe(10_000)
    expect(arrondies.get('BA')).toBe(1235)
    expect(arrondies.get('CA')).toBe(8765)
  })
})

describe('bout en bout depuis les pièces', () => {
  it('conduit des pièces validées jusqu’aux cases du formulaire', () => {
    // Le vrai chemin : pièce → catégorie → poste → case. Le tester d'un bout à l'autre attrape les
    // ruptures de contrat entre le moteur et ce rattachement, qu'aucun des deux ne verrait seul.
    const categories = [
      { id: 'c-hono', poste_2035: 'Honoraires ne constituant pas des rétrocessions' },
      { id: 'c-assur', poste_2035: "Primes d'assurance" },
      { id: 'c-vente', poste_2035: 'Recettes' },
    ] as Categorie[]
    const piece = (o: Partial<Piece>): Piece =>
      ({ statut: 'validee', type_piece: 'achat', date_piece: '2025-06-15', montant_ht: 100, montant_ttc: 120, ...o }) as Piece

    const d = calculerDeclaration2035(2025, [
      piece({ id: 'a', categorie_id: 'c-hono', montant_ht: 800 }),
      piece({ id: 'b', categorie_id: 'c-assur', montant_ht: 200 }),
      piece({ id: 'c', categorie_id: 'c-vente', type_piece: 'vente', montant_ht: 5000 }),
    ], categories, [], [], [])

    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(postesSansCase).toEqual([])
    expect(valeurs.get('AA')).toBe(5000)
    expect(valeurs.get('BH')).toBe(1000)
    expect(valeurs.get('BR')).toBe(1000)
    expect(valeurs.get('CP')).toBe(4000)
  })
})

describe('le barème kilométrique arrive en case BJ', () => {
  const vehicule = (o: Partial<VehiculeDossier>): VehiculeDossier =>
    ({
      id: 'v', annee: 2025, type: 'voiture', puissance_fiscale: 6, motorisation: 'thermique',
      km_professionnel: 4000, ...o,
    }) as VehiculeDossier

  it('porte le « total A » du cadre 7 ligne 23, comme le dit le formulaire', () => {
    // Le bas du 2035-B : « Total A à reporter ligne 23 de l'annexe 2035 A ». Ligne 23 = BJ.
    const d = calculerDeclaration2035(2025, [], [], [], [], [vehicule({})])
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(postesSansCase).toEqual([])
    expect(valeurs.get('BJ')).toBe(2660)
    // Et il compte bien dans le total des dépenses : une case BJ remplie mais hors de BR ne
    // déduirait rien du tout.
    expect(valeurs.get('BR')).toBe(2660)
  })

  it('s’additionne aux autres frais de déplacement de la ligne 24', () => {
    // BJ est un total groupé sur deux lignes : le forfait véhicule ligne 23, le train et l'hôtel
    // ligne 24. Les deux coexistent, et la case doit porter leur somme.
    const categories = [{ id: 'c-depl', poste_2035: 'Autres frais de déplacements' }] as Categorie[]
    const piece = {
      id: 'train', statut: 'validee', type_piece: 'achat', date_piece: '2025-04-02',
      montant_ht: 340, montant_ttc: 340, categorie_id: 'c-depl',
    } as Piece
    const d = calculerDeclaration2035(2025, [piece], categories, [], [], [vehicule({})])
    expect(valeursDesCases(d).valeurs.get('BJ')).toBe(2660 + 340)
  })
})

describe('doublonFraisVehicules — le forfait et le réel ne cohabitent pas', () => {
  it('signale des frais de véhicule au réel à côté du barème', () => {
    // Les deux tombent dans BJ, donc la même dépense y est comptée deux fois — et la case n'affiche
    // qu'un total qui ne dit pas de quoi il est fait. Note (12) de la notice.
    const doublon = doublonFraisVehicules(declaration({
      depenses: [
        ligne({ poste: POSTE_INDEMNITES_KM, montant: 2660, nbPieces: 0 }),
        ligne({ poste: 'Frais de véhicules', montant: 1200, nbPieces: 7 }),
      ],
    }))
    expect(doublon?.montantIndemnites).toBe(2660)
    expect(doublon?.totalPostes).toBe(1200)
    expect(doublon?.postes.map((p) => p.poste)).toEqual(['Frais de véhicules'])
  })

  it('ne crie pas au loup sur les autres frais de déplacements', () => {
    // Train, hôtel, taxi : la ligne 24 cohabite tout à fait légitimement avec le forfait, qui ne
    // couvre que le véhicule. Un avertissement qui se trompe souvent finit par ne plus être lu.
    expect(doublonFraisVehicules(declaration({
      depenses: [
        ligne({ poste: POSTE_INDEMNITES_KM, montant: 2660 }),
        ligne({ poste: 'Autres frais de déplacements', montant: 340 }),
      ],
    }))).toBeNull()
  })

  it('ne dit rien d’un forfait nul', () => {
    // Un véhicule déclaré sans trajet professionnel ne déduit rien : il ne fait donc double emploi
    // avec rien. Signaler ce cas enverrait le cabinet chercher un doublon qui n'existe pas.
    expect(doublonFraisVehicules(declaration({
      depenses: [
        ligne({ poste: POSTE_INDEMNITES_KM, montant: 0 }),
        ligne({ poste: 'Frais de véhicules', montant: 1200 }),
      ],
    }))).toBeNull()
  })

  it('ne dit rien sans barème kilométrique', () => {
    // Des frais de véhicule au réel tout seuls, c'est le régime réel : parfaitement régulier.
    expect(doublonFraisVehicules(declaration({
      depenses: [ligne({ poste: 'Frais de véhicules', montant: 1200 })],
    }))).toBeNull()
  })

  it('reconnaît le poste malgré l’accent, le pluriel et la casse', () => {
    // Le poste est un texte libre recopié par le cabinet. Comparer brut laisserait passer le
    // doublon sur « FRAIS DE VEHICULE », qui est pourtant le même.
    for (const poste of ['FRAIS DE VEHICULE', 'frais de véhicules', 'Carburant']) {
      expect(doublonFraisVehicules(declaration({
        depenses: [ligne({ poste: POSTE_INDEMNITES_KM, montant: 2660 }), ligne({ poste, montant: 900 })],
      }))?.totalPostes).toBe(900)
    }
  })

  it('additionne plusieurs postes au réel', () => {
    expect(doublonFraisVehicules(declaration({
      depenses: [
        ligne({ poste: POSTE_INDEMNITES_KM, montant: 2660 }),
        ligne({ poste: 'Frais de véhicules', montant: 1200 }),
        ligne({ poste: 'Carburant', montant: 800.5 }),
      ],
    }))?.totalPostes).toBe(2000.5)
  })
})
