import { describe, expect, it } from 'vitest'
import { categoriesSansCompte, categoriesSansPoste, piecesDeviseNonConvertie, piecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from './controles'
import type { Categorie, Piece } from './types'

const categorie = (o: Partial<Categorie>): Categorie =>
  ({ id: 'c1', dossier_id: null, libelle: 'Achats', code: 'achats', compte_comptable: '606100',
     poste_2035: 'Achats', ...o } as Categorie)

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: 20, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null,
  categorie_id: 'c1', created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

describe('categoriesSansCompte', () => {
  it('ne signale que les catégories réellement utilisées', () => {
    // Une catégorie sans compte mais que personne n'emploie ne bloque rien : la signaler
    // encombrerait la checklist sans qu'il y ait quoi que ce soit à corriger.
    const categories = [
      categorie({ id: 'utilisee', compte_comptable: null }),
      categorie({ id: 'inutilisee', compte_comptable: null }),
      categorie({ id: 'complete', compte_comptable: '606100' }),
    ]
    const manquantes = categoriesSansCompte(categories, [piece({ categorie_id: 'utilisee' })])
    expect(manquantes.map((c) => c.id)).toEqual(['utilisee'])
  })

  it('ne signale rien quand tout est renseigné', () => {
    expect(categoriesSansCompte([categorie({})], [piece({})])).toEqual([])
  })
})

describe('categoriesSansPoste', () => {
  it('suit la même règle côté poste 2035', () => {
    const categories = [
      categorie({ id: 'sans', poste_2035: null }),
      categorie({ id: 'avec', poste_2035: 'Achats' }),
    ]
    const manquantes = categoriesSansPoste(categories, [
      piece({ id: 'a', categorie_id: 'sans' }),
      piece({ id: 'b', categorie_id: 'avec' }),
    ])
    expect(manquantes.map((c) => c.id)).toEqual(['sans'])
  })
})

describe('piecesSansTva', () => {
  it('ne signale rien sur un dossier non assujetti', () => {
    // L'absence de TVA y est la norme, pas un oubli.
    expect(piecesSansTva([piece({ montant_tva: null })], false)).toEqual([])
  })

  it('signale une pièce sans TVA sur un dossier assujetti', () => {
    const oubli = piece({ id: 'oubli', montant_tva: null })
    expect(piecesSansTva([oubli, piece({ id: 'ok', montant_tva: 20 })], true).map((p) => p.id)).toEqual(['oubli'])
  })

  it('ignore une pièce sans montant du tout', () => {
    // Rien de saisi : ce n'est pas un oubli de TVA, c'est une pièce pas encore renseignée.
    expect(piecesSansTva([piece({ montant_ttc: null, montant_tva: null })], true)).toEqual([])
  })

  it('traite une TVA à zéro comme une TVA absente', () => {
    // Conséquence du test `!p.montant_tva`. Sans effet en pratique : une facture exonérée est
    // enregistrée avec une TVA nulle, jamais à zéro — aucune pièce en base n'a de TVA à 0.
    // Documenté ici pour que le jour où ce cas apparaîtrait, le choix soit visible plutôt que subi.
    expect(piecesSansTva([piece({ id: 'exonere', montant_tva: 0 })], true).map((p) => p.id)).toEqual(['exonere'])
  })
})

describe('piecesValideesSansCategorie', () => {
  it('signale une pièce validée qui n’a pas de catégorie', () => {
    // Le cas que ni categoriesSansCompte ni categoriesSansPoste ne peuvent voir : ils partent d'une
    // catégorie, et ici il n'y en a pas. La pièce est pourtant aussi stérile — ni écriture, ni 2035.
    const orpheline = piece({ id: 'orpheline', categorie_id: null })
    expect(piecesValideesSansCategorie([orpheline, piece({ id: 'ok' })]).map((p) => p.id)).toEqual(['orpheline'])
  })

  it('ne signale pas une pièce encore à valider', () => {
    // C'est la corbeille d'arrivée : une pièce qui attend son arbitrage n'a pas à avoir de catégorie,
    // et les signaler noierait le vrai signal — un dossier réel en portait 30 face à 10 validées.
    expect(piecesValideesSansCategorie([piece({ statut: 'a_valider', categorie_id: null })])).toEqual([])
  })

  it('ne signale rien quand toutes les pièces validées sont catégorisées', () => {
    expect(piecesValideesSansCategorie([piece({}), piece({ id: 'b' })])).toEqual([])
  })

  it('reste indifférent au montant et au sens de la pièce', () => {
    // Une recette, un avoir : le contrôle porte sur l'absence de catégorie, pas sur ce qu'elle vaut.
    // Constaté en production, l'une des onze était un avoir à −214,21 €.
    const recette = piece({ id: 'recette', type_piece: 'vente', categorie_id: null })
    const avoir = piece({ id: 'avoir', montant_ttc: -214.21, categorie_id: null })
    expect(piecesValideesSansCategorie([recette, avoir]).map((p) => p.id)).toEqual(['recette', 'avoir'])
  })
})

describe('piecesTvaImpossible', () => {
  // Les montants de ce bloc sont ceux relevés en production — pas des cas d'école.
  const avecMontants = (o: Partial<Piece>) => piece({ montant_ht: 20, montant_tva: 4, montant_ttc: 24, ...o })

  it('signale une addition qui ne tombe pas juste', () => {
    // « HT 20,00 / TVA 20,60 / TTC 24,00 » : la vraie TVA est 4,00, l'extraction a lu la ligne
    // au-dessus. Confiance annoncée « haute ».
    const fausse = avecMontants({ id: 'openai', montant_tva: 20.6 })
    expect(piecesTvaImpossible([fausse])).toEqual([{ piece: fausse, motif: 'arithmetique' }])
  })

  it('signale un taux au-dessus de 20 %, même quand l’addition tombe juste', () => {
    // SwissLife : 3 243,46 + 943,89 = 4 187,35, l'addition est cohérente et le taux — 29,1 % —
    // n'existe pas. Une assurance est de surcroît exonérée : tout est faux sauf l'arithmétique.
    const assurance = avecMontants({ id: 'swisslife', montant_ht: 3243.46, montant_tva: 943.89, montant_ttc: 4187.35 })
    expect(piecesTvaImpossible([assurance])).toEqual([{ piece: assurance, motif: 'taux' }])
  })

  it('signale une TVA posée sur une base nulle', () => {
    // INPI : HT 0,00 / TVA 188,81 / TTC 188,81. L'addition tombe juste, le taux est infini.
    const inpi = avecMontants({ id: 'inpi', montant_ht: 0, montant_tva: 188.81, montant_ttc: 188.81 })
    expect(piecesTvaImpossible([inpi]).map((a) => a.motif)).toEqual(['taux'])
  })

  it('applique la même borne au TTC quand le HT n’a pas été lu', () => {
    // Sans HT, la borne « TVA ≤ 20 % du HT » s'écrit « TVA ≤ un sixième du TTC ». Sinon une pièce
    // dont le HT manque échapperait entièrement au contrôle.
    const sansHt = avecMontants({ id: 'sans-ht', montant_ht: null, montant_tva: 20, montant_ttc: 24 })
    expect(piecesTvaImpossible([sansHt]).map((a) => a.motif)).toEqual(['taux'])
    expect(piecesTvaImpossible([avecMontants({ montant_ht: null, montant_tva: 4, montant_ttc: 24 })])).toEqual([])
  })

  it('signale une TVA de sens contraire au HT', () => {
    const incoherente = avecMontants({ id: 'signe', montant_ht: 100, montant_tva: -20, montant_ttc: 80 })
    expect(piecesTvaImpossible([incoherente])).toEqual([{ piece: incoherente, motif: 'signe' }])
  })

  it('signale un avoir dont la TVA est elle aussi impossible', () => {
    // Le pendant du test suivant, et celui qui exige la valeur absolue des DEUX côtés de la
    // comparaison : sans elle, un avoir faux passe — une TVA négative n'est jamais supérieure à un
    // plafond positif. Se protéger des faux positifs sur les avoirs ne doit pas les rendre aveugles.
    const avoirFaux = avecMontants({ id: 'avoir-faux', montant_ht: -20, montant_tva: -20.6, montant_ttc: -40.6 })
    expect(piecesTvaImpossible([avoirFaux])).toEqual([{ piece: avoirFaux, motif: 'taux' }])
  })

  it('laisse tranquille un avoir entièrement négatif', () => {
    // Le piège du contrôle : comparer sans valeur absolue inverse les inégalités, et CHAQUE avoir
    // correct serait signalé. Un avoir porte ses trois montants en négatif.
    const avoir = avecMontants({ id: 'avoir', montant_ht: -178.51, montant_tva: -35.70, montant_ttc: -214.21 })
    expect(piecesTvaImpossible([avoir])).toEqual([])
  })

  it('laisse passer un taux bâtard mais possible', () => {
    // 11,96 % n'est aucun taux légal, et c'est pourtant ce que rend un ticket mêlant 10 % et 20 %.
    // Les signaler ferait crier au loup plus souvent qu'à raison : le contrôle ne retient que ce
    // qu'il peut prouver.
    const mixte = avecMontants({ montant_ht: 50.91, montant_tva: 6.09, montant_ttc: 57 })
    const taux275 = avecMontants({ montant_ht: 1200, montant_tva: 33, montant_ttc: 1233 })
    expect(piecesTvaImpossible([mixte, taux275])).toEqual([])
  })

  it('accepte le taux normal à l’euro près et tolère l’arrondi au centime', () => {
    const plein = avecMontants({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const arrondi = avecMontants({ montant_ht: 33.33, montant_tva: 6.67, montant_ttc: 40 })
    expect(piecesTvaImpossible([plein, arrondi])).toEqual([])
  })

  it('ignore une pièce sans TVA — c’est le domaine de piecesSansTva', () => {
    expect(piecesTvaImpossible([avecMontants({ montant_tva: null }), avecMontants({ montant_tva: 0 })])).toEqual([])
  })

  it('ne dépend pas du statut, et ne compte chaque pièce qu’une fois', () => {
    // Une TVA impossible l'est à tout stade, et c'est avant la validation qu'elle doit se voir :
    // après, le chiffre est figé dans l'écriture. Apple cumule les deux motifs — 399,16 + 239,52 ≠
    // 479,00 ET 60 % de taux — et ne doit apparaître qu'une fois.
    const apple = avecMontants({ id: 'apple', statut: 'a_valider', montant_ht: 399.16, montant_tva: 239.52, montant_ttc: 479 })
    expect(piecesTvaImpossible([apple])).toEqual([{ piece: apple, motif: 'arithmetique' }])
  })
})

describe('piecesDeviseNonConvertie', () => {
  it('signale une pièce en devise étrangère restée sans taux', () => {
    // Le dépôt laisse les montants en euros nuls quand la BCE n'a pas répondu, plutôt que d'y écrire
    // des dollars : sans ce contrôle, l'absence ne se verrait nulle part.
    const sansTaux = piece({ id: 'openai', devise: 'USD', montant_devise: 24, taux_change: null,
      montant_ht: null, montant_tva: null, montant_ttc: null })
    expect(piecesDeviseNonConvertie([sansTaux]).map((p) => p.id)).toEqual(['openai'])
  })

  it('laisse tranquille une pièce convertie', () => {
    const convertie = piece({ devise: 'USD', montant_devise: 24, taux_change: 1.1698,
      montant_ht: 17.10, montant_tva: 3.42, montant_ttc: 20.52 })
    expect(piecesDeviseNonConvertie([convertie])).toEqual([])
  })

  it('ne dit rien des pièces en euros, qui n’ont pas de taux par construction', () => {
    expect(piecesDeviseNonConvertie([piece({}), piece({ id: 'b', taux_change: null })])).toEqual([])
  })
})
