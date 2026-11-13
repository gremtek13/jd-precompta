import { describe, expect, it } from 'vitest'
import {
  AUCUN_POINT_DE_L_INVENTAIRE, INVENTAIRE_DES_CONTROLES_SANS_OBJET, attenduDeLInventaire, carteDeLInventaire,
  cibleDesPrealablesDeLInventaire, compteEcritParLInventaire, compteProuveParLInventaire, contratsDuDossierPermanent,
  declarationDeLExercice, etatDeLaCarteDeLInventaire, exercicesEnMots, inventaireDeLaRevision, inventaireDesControles,
  inventairePourLaValidation, pointsDeLInventaire, premierExerciceDuDossier, propositionsDuDossierPermanent, travauxDeLInventaire,
  type ContratDuDossierPermanent, type EntreesDeLaCarteDeLInventaire, type InventaireDesControles, type OperationDesControles,
} from './inventaireDesControles'
import { ciblePrecedente, lignesCommandees, type DeclarationDeLaValidation, type ProvisionDeLaValidation } from './inventaireDeLaValidation'
import type { EcritureBrouillon } from './types'

// L'INVENTAIRE DANS LES CONTRÔLES DU CABINET (ligne 35, INV6 ; lib/inventaireDesControles.ts) : ce que le bilan, la Vue
// d'ensemble, la Clôture et la révision en disent. Le module est PUR ; les montants sont ceux qu'un cabinet aurait saisis,
// fictifs. Les juges d'une régularisation (`regularisationAJour`, `extourneEntiere`) sont éprouvés par
// inventaireDeLaValidation.test.ts ; ici, ce que ce module en tire.

type Lu = Extract<InventaireDesControles, { etat: 'lu' }>
type Ligne = Pick<EcritureBrouillon, 'date' | 'compte' | 'sens' | 'montant' | 'operation_inventaire_id'>

const op = (o: Partial<OperationDesControles> = {}): OperationDesControles => ({
  id: 'o1', exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486000', montant_centimes: 12000,
  tva_centimes: 0, objet: 'Assurance fictive', provision_id: null, reprise: false, piece_citee_id: null, ...o,
})
const declaration = (exercice: number, retire_le: string | null = null): DeclarationDeLaValidation =>
  ({ id: `d${exercice}${retire_le ?? ''}`, exercice, retire_le })
const lu = (o: Partial<Omit<Lu, 'etat'>> = {}): Lu => ({ etat: 'lu', operations: [], declarations: [], provisions: [], ...o })

/** Les lignes qu'une régularisation commande, telles que la composition les écrit au brouillon : à jour par construction. */
function lignesDe(o: OperationDesControles, inv: Lu, seulement?: 'constatation' | 'extourne'): Ligne[] {
  const cible = ciblePrecedente(o, inv.operations, inv.provisions)
  return (lignesCommandees(o, cible) ?? [])
    .filter((l) => seulement === undefined || (seulement === 'constatation' ? l.date.endsWith('-12-31') : l.date.endsWith('-01-01')))
    .map((l) => ({ date: l.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, operation_inventaire_id: o.id }))
}

describe('l’inventaire reçu par les contrôles : sans objet en trésorerie, lu sinon', () => {
  it('lu, un dossier en engagement le garde ; en trésorerie, il est sans objet quoi qu’on ait lu', () => {
    const inv = lu({ operations: [op()] })
    expect(inventaireDesControles(inv, 'engagement')).toBe(inv)
    expect(inventaireDesControles(inv, 'tresorerie')).toEqual(INVENTAIRE_DES_CONTROLES_SANS_OBJET)
    expect(inventaireDesControles({ etat: 'sans_objet' }, 'engagement')).toEqual({ etat: 'sans_objet' })
    expect(inventairePourLaValidation(inv)).toBe(inv)
    expect(inventairePourLaValidation({ etat: 'sans_objet' })).toEqual({ etat: 'sans_objet' })
  })

  it('la déclaration en vigueur : celle de l’exercice, jamais une retirée', () => {
    const inv = lu({ declarations: [declaration(2024), declaration(2025, '2026-02-01T10:00:00Z')] })
    expect(declarationDeLExercice(inv, 2024)?.id).toBe('d2024')
    expect(declarationDeLExercice(inv, 2025)).toBeNull()
  })

  it('la révision : sans objet en trésorerie, nul en engagement sur la lecture de l’inventaire en partie', () => {
    const inv = lu()
    expect(inventaireDeLaRevision(inv, null, 'engagement')).toBe(inv)
    expect(inventaireDeLaRevision(inv, 'coupée', 'engagement')).toBeNull()
    expect(inventaireDeLaRevision(inv, 'coupée', 'tresorerie')).toEqual({ etat: 'sans_objet' })
    expect(inventaireDeLaRevision({ etat: 'sans_objet' }, null, 'engagement')).toEqual({ etat: 'sans_objet' })
  })
})

describe('les comptes que l’inventaire écrit, et ceux que sa preuve justifie', () => {
  it('écrit : les rôles hors dotations et reprises, les charges à payer, les produits à recevoir, le 4088 ; jamais le 4084', () => {
    for (const c of ['486000', '487000', '408100', '418000', '445860', '445870', '151000', '491000', '428200', '438600', '448200', '408800']) {
      expect(compteEcritParLInventaire(c), c).toBe(true)
    }
    for (const c of ['408400', '681500', '781700', '310000', '291000', '467000', '401000']) expect(compteEcritParLInventaire(c), c).toBe(false)
  })

  it('prouvé : 486, 487, 408 (hors 4084), 418, 151, 491 — pas une charge à payer rattachée, ni la TVA d’attente', () => {
    for (const c of ['486000', '487000', '408100', '418000', '151100', '491000']) expect(compteProuveParLInventaire(c), c).toBe(true)
    for (const c of ['408400', '428200', '445860', '681500']) expect(compteProuveParLInventaire(c), c).toBe(false)
  })
})

describe('ce que l’inventaire attend d’un compte au 31 décembre', () => {
  it('une charge constatée d’avance à jour : son débit du 31/12, aucune à recomposer', () => {
    const o = op()
    const inv = lu({ operations: [o] })
    const a = attenduDeLInventaire('486000', 2025, inv, lignesDe(o, inv))
    expect(a).toMatchObject({ attenduCentimes: 12000, aRecomposer: 0, provisions: [] })
    expect(a.regularisations.map((r) => r.id)).toEqual(['o1'])
  })

  it('sans ses écritures : rien d’attendu au solde, une à recomposer ; un produit constaté d’avance au crédit', () => {
    const inv = lu({ operations: [op()] })
    expect(attenduDeLInventaire('486000', 2025, inv, [])).toMatchObject({ attenduCentimes: 0, aRecomposer: 1 })
    const pca = op({ id: 'o2', nature: 'pca', compte_resultat: '706000', compte_regularisation: '487000', montant_centimes: 5000 })
    const avecPca = lu({ operations: [pca] })
    expect(attenduDeLInventaire('487000', 2025, avecPca, lignesDe(pca, avecPca)).attenduCentimes).toBe(-5000)
  })

  it('l’extourne du 1er janvier, celle de l’an dernier et une régularisation reprise ne comptent pas au 31/12 de l’exercice', () => {
    const avant = op({ id: 'o0', exercice: 2024 })
    const reprise = op({ id: 'o9', exercice: 2024, reprise: true })
    const inv = lu({ operations: [avant, reprise] })
    const brouillon = [...lignesDe(avant, inv), ...lignesDe(reprise, inv)]
    expect(attenduDeLInventaire('486000', 2025, inv, brouillon)).toMatchObject({ attenduCentimes: 0, regularisations: [] })
  })

  it('un compte de provision : la cible en vigueur de chaque provision, au crédit — la dernière évaluation, sinon sa part reprise', () => {
    const provisions: ProvisionDeLaValidation[] = [
      { id: 'p1', compte_provision: '151000', reprise_centimes: 50000 },
      { id: 'p2', compte_provision: '151000', reprise_centimes: 7000 },
    ]
    const evaluation = op({ id: 'e1', nature: 'provision', provision_id: 'p1', compte_resultat: '681500', compte_regularisation: '151000', montant_centimes: 80000 })
    const plusTard = op({ id: 'e2', exercice: 2026, nature: 'provision', provision_id: 'p1', compte_resultat: '681500', compte_regularisation: '151000', montant_centimes: 1 })
    const inv = lu({ operations: [evaluation, plusTard], provisions })
    const a = attenduDeLInventaire('151000', 2025, inv, lignesDe(evaluation, inv))
    expect(a.attenduCentimes).toBe(-87000)
    expect(a.provisions).toEqual([
      { provisionId: 'p1', cibleCentimes: 80000, operationId: 'e1' },
      { provisionId: 'p2', cibleCentimes: 7000, operationId: null },
    ])
    expect(a.aRecomposer).toBe(0)
    expect(attenduDeLInventaire('151000', 2025, inv, []).aRecomposer).toBe(1)
  })
})

describe('les points de la Vue d’ensemble', () => {
  const base = { brouillon: [] as Ligne[], anneesValidees: [] as number[], anneeCourante: 2026, premierExercice: 2024 as number | null }

  it('sans objet, aucun point', () => {
    expect(pointsDeLInventaire({ ...base, inventaire: { etat: 'sans_objet' } })).toBe(AUCUN_POINT_DE_L_INVENTAIRE)
  })

  it('à déclarer : chaque exercice clos et non validé sans déclaration en vigueur, depuis le premier ou après le dernier validé', () => {
    expect(pointsDeLInventaire({ ...base, inventaire: lu() }).aDeclarer).toEqual([2024, 2025])
    expect(pointsDeLInventaire({ ...base, inventaire: lu({ declarations: [declaration(2024)] }) }).aDeclarer).toEqual([2025])
    expect(pointsDeLInventaire({ ...base, inventaire: lu({ declarations: [declaration(2025, '2026-02-01T00:00:00Z')] }) }).aDeclarer)
      .toEqual([2024, 2025])
    expect(pointsDeLInventaire({ ...base, anneesValidees: [2024], inventaire: lu() }).aDeclarer).toEqual([2025])
    expect(pointsDeLInventaire({ ...base, premierExercice: null, inventaire: lu() }).aDeclarer).toEqual([])
    // L'exercice en cours n'est pas clos : rien ne s'y déclare encore.
    expect(pointsDeLInventaire({ ...base, premierExercice: 2026, inventaire: lu() }).aDeclarer).toEqual([])
  })

  it('à recomposer : une régularisation d’un exercice que rien ne fige, dont les écritures ne sont plus à jour', () => {
    const o = op()
    const inv = lu({ operations: [o] })
    expect(pointsDeLInventaire({ ...base, inventaire: inv }).aRecomposer).toEqual([{ exercice: 2025, id: 'o1' }])
    expect(pointsDeLInventaire({ ...base, inventaire: inv, brouillon: lignesDe(o, inv) }).aRecomposer).toEqual([])
    expect(pointsDeLInventaire({ ...base, inventaire: inv, anneesValidees: [2025] }).aRecomposer).toEqual([])
    // Une régularisation reprise s'écrit au 1er janvier de l'exercice que la balance ouvre : figée avec lui seulement.
    const reprise = lu({ operations: [op({ id: 'r1', exercice: 2024, reprise: true })] })
    expect(pointsDeLInventaire({ ...base, inventaire: reprise, anneesValidees: [2024] }).aRecomposer).toEqual([{ exercice: 2024, id: 'r1' }])
    expect(pointsDeLInventaire({ ...base, inventaire: reprise, anneesValidees: [2024, 2025] }).aRecomposer).toEqual([])
  })

  it('extournes à reprendre : constatée dans un exercice validé, sans son extourne entière au 1er janvier d’un suivant non validé', () => {
    const o = op({ exercice: 2024 })
    const inv = lu({ operations: [o] })
    const sansExtourne = lignesDe(o, inv, 'constatation')
    expect(pointsDeLInventaire({ ...base, inventaire: inv, anneesValidees: [2024], brouillon: sansExtourne }).extournesAReprendre)
      .toEqual([{ exercice: 2024, id: 'o1' }])
    expect(pointsDeLInventaire({ ...base, inventaire: inv, anneesValidees: [2024], brouillon: lignesDe(o, inv) }).extournesAReprendre).toEqual([])
    expect(pointsDeLInventaire({ ...base, inventaire: inv, anneesValidees: [2024, 2025], brouillon: sansExtourne }).extournesAReprendre).toEqual([])
    expect(pointsDeLInventaire({ ...base, inventaire: inv, brouillon: sansExtourne }).extournesAReprendre).toEqual([])
  })
})

describe('les mots et les repères', () => {
  it('les exercices en mots', () => {
    expect(exercicesEnMots([])).toBe('')
    expect(exercicesEnMots([2025])).toBe('2025')
    expect(exercicesEnMots([2025, 2024])).toBe('2024 et 2025')
    expect(exercicesEnMots([2025, 2023, 2024, 2024])).toBe('2023, 2024 et 2025')
  })

  it('le premier exercice : la reprise d’abord, sinon la première écriture, sinon nul', () => {
    expect(premierExerciceDuDossier([{ date: '2024-01-01' }], [{ date: '2023-05-01' }])).toBe(2024)
    expect(premierExerciceDuDossier([], [{ date: '2025-03-01' }, { date: '2024-12-31' }])).toBe(2024)
    expect(premierExerciceDuDossier([], [])).toBeNull()
  })

  it('les préalables mènent à l’onglet Inventaire offert, sinon aux écritures', () => {
    expect(cibleDesPrealablesDeLInventaire(true)).toBe('inventaire')
    expect(cibleDesPrealablesDeLInventaire(false)).toBe('ecritures')
  })

  it('les travaux du programme : aucun l’inventaire non offert ; la séparation des exercices et les provisions sinon', () => {
    expect(travauxDeLInventaire('depenses', false)).toEqual([])
    expect(travauxDeLInventaire('depenses', true).map((t) => t.code)).toEqual(['depenses-separation-exercices'])
    expect(travauxDeLInventaire('recettes', true).map((t) => t.code)).toEqual(['recettes-separation-exercices'])
    expect(travauxDeLInventaire('tiers', true).map((t) => t.code)).toEqual(['tiers-provisions'])
    expect(travauxDeLInventaire('tresorerie', true)).toEqual([])
  })
})

describe('la carte de la Clôture', () => {
  it('sans objet, aucune carte', () => {
    expect(carteDeLInventaire({ etat: 'sans_objet' }, 2025, [], true)).toBeNull()
  })

  it('aucune régularisation, l’exercice clos, rien de déclaré : la validation l’attend, la carte appelle un geste', () => {
    expect(carteDeLInventaire(lu(), 2025, [], true)).toEqual({
      titre: 'Inventaire 2025',
      phrase: 'Aucune régularisation saisie. L’inventaire n’est pas déclaré : la validation l’attend, même sans aucune régularisation.',
      aFaire: true,
    })
  })

  it('l’exercice pas encore clos : rien n’est à faire, la déclaration viendra après le 31 décembre', () => {
    const carte = carteDeLInventaire(lu(), 2026, [], false)
    expect(carte).toMatchObject({ aFaire: false })
    expect(carte?.phrase).toContain('L’exercice n’est pas clos')
  })

  it('déclaré, ses régularisations à jour : rien à faire ; une seule à recomposer suffit à l’appeler', () => {
    const a = op()
    const b = op({ id: 'o2', objet: 'Abonnement fictif' })
    const inv = lu({ operations: [a, b], declarations: [declaration(2025)] })
    const aJour = [...lignesDe(a, inv), ...lignesDe(b, inv)]
    expect(carteDeLInventaire(inv, 2025, aJour, true)).toEqual({
      titre: 'Inventaire 2025', phrase: '2 régularisations saisies. L’inventaire est déclaré fait.', aFaire: false,
    })
    const carte = carteDeLInventaire(inv, 2025, lignesDe(a, inv), true)
    expect(carte?.aFaire).toBe(true)
    expect(carte?.phrase).toContain('2 régularisations saisies ; 1 dont les écritures ne sont plus à jour')
  })

  it('une régularisation reprise d’une balance ne se compte pas comme une saisie de l’exercice', () => {
    expect(carteDeLInventaire(lu({ operations: [op({ reprise: true })] }), 2025, [], true)?.phrase).toMatch(/^Aucune régularisation saisie\./)
  })

  describe('jugée sur ce que l’écran a lu', () => {
    const entrees = (o: Partial<EntreesDeLaCarteDeLInventaire> = {}): EntreesDeLaCarteDeLInventaire => ({
      exporte: true, mode: 'engagement', lecture: lu(), brouillonEnCours: false, brouillonIncomplet: null, brouillon: [],
      exercice: 2025, anneeCourante: 2026, ...o,
    })

    it('le drapeau baissé ou en trésorerie, aucune carte, quoi qu’on ait lu', () => {
      expect(etatDeLaCarteDeLInventaire(entrees({ exporte: false }))).toEqual({ etat: 'sans_objet' })
      expect(etatDeLaCarteDeLInventaire(entrees({ mode: 'tresorerie' }))).toEqual({ etat: 'sans_objet' })
      expect(etatDeLaCarteDeLInventaire(entrees({ exporte: false, lecture: null }))).toEqual({ etat: 'sans_objet' })
      expect(etatDeLaCarteDeLInventaire(entrees({ lecture: { etat: 'sans_objet' } }))).toEqual({ etat: 'sans_objet' })
    })

    it('rien d’affirmé avant lecture ; lu en partie, le motif seul', () => {
      expect(etatDeLaCarteDeLInventaire(entrees({ lecture: null }))).toEqual({ etat: 'chargement' })
      expect(etatDeLaCarteDeLInventaire(entrees({ brouillonEnCours: true }))).toEqual({ etat: 'chargement' })
      expect(etatDeLaCarteDeLInventaire(entrees({ lecture: { etat: 'incomplete', motif: 'coupée' } })))
        .toEqual({ etat: 'partielle', motif: 'l’inventaire du dossier : coupée' })
      expect(etatDeLaCarteDeLInventaire(entrees({ brouillonIncomplet: 'tronqué' })))
        .toEqual({ etat: 'partielle', motif: 'les écritures du dossier : tronqué' })
    })

    it('lu en entier : la carte de l’exercice, close quand l’année en cours le dépasse', () => {
      expect(etatDeLaCarteDeLInventaire(entrees())).toMatchObject({ etat: 'prete', carte: { aFaire: true } })
      expect(etatDeLaCarteDeLInventaire(entrees({ anneeCourante: 2025 }))).toMatchObject({ etat: 'prete', carte: { aFaire: false } })
    })
  })
})

describe('R7 : les contrats du dossier permanent que l’inventaire ne reprend pas', () => {
  const contrat = (o: Partial<ContratDuDossierPermanent> = {}): ContratDuDossierPermanent => ({
    id: 'c1', nature: 'contrat', titre: 'Assurance fictive', valable_du: '2024-01-01', valable_jusqu_au: null, ...o,
  })

  it('sans objet, rien ; le dossier permanent pas lu en entier, nul', () => {
    expect(propositionsDuDossierPermanent([contrat()], { etat: 'sans_objet' }, 2025)).toEqual([])
    expect(propositionsDuDossierPermanent(null, lu(), 2025)).toBeNull()
  })

  it('en vigueur pour l’exercice et sans régularisation de l’exercice sous son titre', () => {
    const contrats = [
      contrat(),
      contrat({ id: 'c2', nature: 'bail', titre: 'Bail fictif' }),
      contrat({ id: 'c3', titre: 'Échu', valable_du: '2020-01-01', valable_jusqu_au: '2024-12-31' }),
      contrat({ id: 'c4', titre: 'À venir', valable_du: '2026-01-01' }),
      contrat({ id: 'c5', titre: 'Sans bornes', valable_du: null }),
    ]
    const inv = lu({ operations: [op({ objet: 'Assurance fictive' }), op({ id: 'o2', exercice: 2024, objet: 'Bail fictif' })] })
    expect(propositionsDuDossierPermanent(contrats, inv, 2025)?.map((p) => p.contrat.id)).toEqual(['c2', 'c5'])
  })

  it('l’objet proposé : sans saut de ligne, deux cents caractères au plus ; un titre vide ne propose rien', () => {
    const long = 'x'.repeat(250)
    const [a, b] = propositionsDuDossierPermanent([contrat({ titre: ' Bail\r\nfictif ' }), contrat({ id: 'c2', titre: long })], lu(), 2025) ?? []
    expect(a.objet).toBe('Bail fictif')
    expect(b.objet).toHaveLength(200)
    expect(propositionsDuDossierPermanent([contrat({ titre: '\n' })], lu(), 2025)).toEqual([])
  })

  it('les contrats du dossier permanent : la version courante des baux et des contrats non retirés', () => {
    const entree = (id: string, nature: string, retiree = false) => ({
      courante: { id, nature, titre: id, valable_du: null, valable_jusqu_au: null }, retiree,
    })
    expect(contratsDuDossierPermanent([entree('a', 'bail'), entree('b', 'contrat'), entree('c', 'contrat', true), entree('d', 'statuts'),
      entree('e', 'contrat_emprunt')]).map((c) => c.id)).toEqual(['a', 'b'])
  })
})
