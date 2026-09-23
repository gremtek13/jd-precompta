import { describe, expect, it } from 'vitest'
import { categoriesSansCompte, categoriesSansPoste, detailPiecesSansDate, moisEnDoubleSurAbonnement, mouvementRapprocheSansObjet, mouvementsRapprochesSansObjet, piecesADateImpossible, piecesDeviseNonConvertie, piecesSansTva, piecesTvaImpossible, piecesValideesSansCategorie } from './controles'
import { aujourdHuiSql, ajouterJours, dateLocaleDe } from './format'
import type { Categorie, LigneBancaire, Piece } from './types'

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

describe('detailPiecesSansDate — un point ne compte pas ce que sa cible ne peut pas montrer', () => {
  it('se tait quand toutes les pièces comptées ont une date', () => {
    // La condition la plus importante du lot : ce détail doit être ABSENT le reste du temps. Une
    // mise en garde affichée en permanence cesse d'être lue, et emporte ses voisines avec elle.
    expect(detailPiecesSansDate([piece({ id: 'a' }), piece({ id: 'b' })])).toBeUndefined()
    expect(detailPiecesSansDate([])).toBeUndefined()
  })

  it('dit combien sont masquées, et par quoi les retrouver', () => {
    const avec = piece({ id: 'avec' })
    const sans = piece({ id: 'sans', date_piece: null })
    const detail = detailPiecesSansDate([avec, sans, piece({ id: 'sans2', date_piece: null })])
    expect(detail).toContain("2 d'entre elles sont sans date")
    // Les deux sorties possibles doivent être NOMMÉES : sans elles, le détail dit qu'un problème
    // existe sans dire quoi faire, ce qui est le défaut qu'il corrige.
    expect(detail).toContain('toutes les années')
    expect(detail).toContain('Sans date')
  })

  it('distingue « toutes » de « une partie » — et le singulier du pluriel', () => {
    // Dire « 1 d'entre elles » sur une liste d'une seule pièce est une phrase qui sonne faux là où
    // l'opérateur a le plus besoin d'être précis : quand il n'y a qu'une pièce à retrouver.
    expect(detailPiecesSansDate([piece({ id: 's', date_piece: null })])).toContain('Elle est sans date')
    expect(detailPiecesSansDate([
      piece({ id: 's1', date_piece: null }),
      piece({ id: 's2', date_piece: null }),
    ])).toContain('Toutes sont sans date')
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

describe('piecesADateImpossible', () => {
  // Le dépôt sert de borne. `dateLocaleDe` le lit dans le fuseau d'exécution, donc les cas se
  // construisent à partir de CETTE valeur plutôt que d'une chaîne figée : la suite tourne sous
  // quatre fuseaux, et un test qui coderait « 2026-09-16 » en dur passerait ici et tomberait là-bas.
  const depot = '2026-09-16T10:00:00Z'
  const jourDuDepot = dateLocaleDe(depot)

  it('signale le cas réel trouvé en production', () => {
    // Une pièce datée du 27/09/2028, déposée le 16/09/2026, sans tiers ni montant, confiance basse.
    // Elle part dans un exercice qui n'existe pas encore : absente de Clôture, de la 2035 et de la
    // Balance de l'année en cours, sans qu'aucun écran ne la compte comme manquante.
    const p = piece({ id: 'p-future', date_piece: '2028-09-27', created_at: depot, statut: 'a_valider' })
    expect(piecesADateImpossible([p])).toEqual([
      { piece: p, date: '2028-09-27', borne: jourDuDepot },
    ])
  })

  it('accepte une pièce datée du jour de son dépôt', () => {
    expect(piecesADateImpossible([piece({ date_piece: jourDuDepot, created_at: depot })])).toEqual([])
  })

  it('tolère un jour, et un seul', () => {
    // La marge existe pour l'écart de fuseau : à l'ouest de Paris, le jour local du dépôt peut
    // apparaître une journée plus tôt que celui où la pièce est réellement arrivée. Deux jours ne
    // s'expliquent plus par aucun fuseau — c'est la borne qui distingue une marge d'un trou.
    const lendemain = ajouterJours(jourDuDepot, 1)
    const surlendemain = ajouterJours(jourDuDepot, 2)
    expect(piecesADateImpossible([piece({ date_piece: lendemain, created_at: depot })])).toEqual([])
    expect(piecesADateImpossible([piece({ date_piece: surlendemain, created_at: depot })])).toHaveLength(1)
  })

  it('borne au DÉPÔT et non à aujourd’hui, ce qui est plus strict', () => {
    // Une pièce déposée en septembre et datée de décembre est tout aussi impossible — mais
    // « postérieure à aujourd'hui » cesserait de la voir dès décembre venu, c'est-à-dire juste avant
    // la clôture, au moment précis où elle fausse un exercice.
    expect(piecesADateImpossible([piece({ date_piece: '2026-12-31', created_at: depot })])).toHaveLength(1)
  })

  it('ne signale pas une pièce ancienne, même absurdement', () => {
    // Un ticket daté de 2012 au lieu de 2025 est probablement faux, mais rien ne le PROUVE : un
    // cabinet peut légitimement traiter une pièce ancienne. Ce contrôle ne signale que l'impossible,
    // jamais l'improbable — un contrôle qui se trompe finit par ne plus être lu.
    expect(piecesADateImpossible([piece({ date_piece: '2012-01-05', created_at: depot })])).toEqual([])
  })

  it('ignore une pièce sans date', () => {
    // Une pièce sans date est le sujet d'un autre contrôle (voir les packs) : la compter ici la
    // ferait apparaître deux fois pour deux raisons différentes.
    expect(piecesADateImpossible([piece({ date_piece: null, created_at: depot })])).toEqual([])
  })

  it('retombe sur aujourd’hui quand le dépôt n’est pas horodaté', () => {
    // La colonne est NOT NULL en base, mais le type la déclare facultative : un appelant qui
    // construit une pièce partielle (un aperçu d'import, une pièce en cours de saisie) n'a pas
    // d'horodatage. La seule borne défendable reste alors le jour même — une pièce ne peut pas être
    // datée de demain, quelle que soit la date à laquelle elle est arrivée.
    const apresDemain = ajouterJours(aujourdHuiSql(), 2)
    expect(piecesADateImpossible([piece({ date_piece: apresDemain, created_at: undefined })])).toHaveLength(1)
    expect(piecesADateImpossible([piece({ date_piece: aujourdHuiSql(), created_at: undefined })])).toEqual([])
  })

  it('rend les pièces fautives dans l’ordre reçu, et rien d’autre', () => {
    const saine = piece({ id: 'ok', date_piece: '2026-01-05', created_at: depot })
    const fautive = piece({ id: 'ko', date_piece: '2030-01-05', created_at: depot })
    expect(piecesADateImpossible([saine, fautive, saine]).map((d) => d.piece.id)).toEqual(['ko'])
  })
})


describe('moisEnDoubleSurAbonnement', () => {
  // Un abonnement mensuel : une pièce par mois, même fournisseur, même montant.
  const abonnement = (mois: string[], o: Partial<Piece> = {}) =>
    mois.map((m, i) =>
      piece({ id: `p${i}`, nom_fichier: `${m}.pdf`, tiers: 'Transmedical', montant_ttc: 38.4, date_piece: `${m}-01`, ...o }),
    )

  it('signale le mois qui en porte deux quand un mois voisin est vide', () => {
    // Le cas réel : mai.pdf daté du 01/06. Juin en compte deux, mai zéro.
    const pieces = abonnement(['2025-03', '2025-04', '2025-06', '2025-06', '2025-07'])
    const trouves = moisEnDoubleSurAbonnement(pieces)
    expect(trouves).toHaveLength(1)
    expect(trouves[0]).toMatchObject({ tiers: 'Transmedical', montant: 38.4, mois: '2025-06', moisProbable: '2025-05' })
    expect(trouves[0].pieces).toHaveLength(2)
  })

  it("ne signale RIEN quand aucun mois voisin n'est vide", () => {
    // Un fournisseur peut facturer deux fois dans le mois. Sans trou à côté, rien ne prouve une
    // erreur — et un avertissement qui se trompe souvent finit par ne plus être lu.
    expect(moisEnDoubleSurAbonnement(abonnement(['2025-03', '2025-04', '2025-05', '2025-05', '2025-06']))).toEqual([])
  })

  it('préfère le mois PRÉCÉDENT quand les deux voisins sont vides', () => {
    // Une date mal lue est presque toujours POSTÉRIEURE à la vraie — une échéance, une fin de
    // période, une date de règlement. Le mois manquant est donc plus souvent celui d'avant.
    const pieces = abonnement(['2025-01', '2025-02', '2025-05', '2025-05', '2025-08'])
    expect(moisEnDoubleSurAbonnement(pieces)[0].moisProbable).toBe('2025-04')
  })

  it("ne propose pas un mois situé hors de la série observée", () => {
    // Le doublon est sur le PREMIER mois : le mois d'avant est vide parce que l'abonnement n'avait
    // pas commencé, pas parce qu'une pièce y manque. C'est le mois suivant qui est proposé.
    const pieces = abonnement(['2025-03', '2025-03', '2025-05', '2025-06'])
    expect(moisEnDoubleSurAbonnement(pieces)[0].moisProbable).toBe('2025-04')
  })

  it("se tait quand le doublon est au bord et que le seul voisin interne est pris", () => {
    const pieces = abonnement(['2025-03', '2025-03', '2025-04', '2025-05'])
    expect(moisEnDoubleSurAbonnement(pieces)).toEqual([])
  })

  it("exige une vraie série : deux mois ne font pas un abonnement", () => {
    // Deux factures du même montant le même mois, plus une autre : c'est une coïncidence banale,
    // pas une série dont on saurait lire le trou.
    expect(moisEnDoubleSurAbonnement(abonnement(['2025-03', '2025-05', '2025-05']))).toEqual([])
  })

  it('regroupe sur la clé d\'identité, pas sur le nom exact', () => {
    // L'OCR recopie du bruit autour du nom : « Transmedical », « Transmedical / et redevient » et
    // « Transmedical / et soigner redevient » sont le même abonnement (cas réel du dossier).
    const pieces = [
      piece({ id: 'a', tiers: 'Transmedical', montant_ttc: 38.4, date_piece: '2025-03-01' }),
      piece({ id: 'b', tiers: 'Transmedical\net redevient', montant_ttc: 38.4, date_piece: '2025-04-01' }),
      piece({ id: 'c', tiers: 'Transmedical\net soigner redevient', montant_ttc: 38.4, date_piece: '2025-06-01' }),
      piece({ id: 'd', tiers: 'Transmedical', montant_ttc: 38.4, date_piece: '2025-06-15' }),
      piece({ id: 'e', tiers: 'Transmedical', montant_ttc: 38.4, date_piece: '2025-07-01' }),
    ]
    const trouves = moisEnDoubleSurAbonnement(pieces)
    expect(trouves).toHaveLength(1)
    expect(trouves[0]).toMatchObject({ mois: '2025-06', moisProbable: '2025-05' })
  })

  it('ne confond pas deux fournisseurs au même montant', () => {
    // Sans le fournisseur dans la clé, deux abonnements différents à 38,40 € formeraient une seule
    // série, et leurs mois se combleraient l'un l'autre.
    const pieces = [
      ...abonnement(['2025-03', '2025-04', '2025-06', '2025-06']),
      ...abonnement(['2025-05'], { tiers: 'Estello SARL' }),
    ]
    const trouves = moisEnDoubleSurAbonnement(pieces)
    expect(trouves).toHaveLength(1)
    expect(trouves[0].moisProbable).toBe('2025-05')
  })

  it("ignore une pièce dont aucun mot n'identifie un fournisseur", () => {
    // « CARTE BANCAIRE » ne désigne personne : regrouper dessus mélangerait des achats sans rapport.
    const pieces = abonnement(['2025-03', '2025-04', '2025-06', '2025-06', '2025-07'], { tiers: 'CARTE BANCAIRE' })
    expect(moisEnDoubleSurAbonnement(pieces)).toEqual([])
  })

  it("n'invente pas une série à partir de pièces SANS montant", () => {
    // Sans montant, rien ne dit que ces pièces sont la même échéance répétée — et la trouvaille
    // porterait un montant nul là où son type promet un nombre. Le garde sur `montant_ttc` est ce
    // qui l'empêche ; c'est la seule mutation de ce contrôle qu'aucun autre test ne tue.
    const sansMontant = abonnement(['2025-03', '2025-04', '2025-06', '2025-06', '2025-07'], { montant_ttc: null })
    expect(moisEnDoubleSurAbonnement(sansMontant)).toEqual([])
  })

  it('ignore une pièce sans date ou sans montant', () => {
    const pieces = [
      ...abonnement(['2025-03', '2025-04', '2025-06', '2025-06', '2025-07']),
      piece({ id: 'sans-date', tiers: 'Transmedical', montant_ttc: 38.4, date_piece: null }),
      piece({ id: 'sans-montant', tiers: 'Transmedical', montant_ttc: null, date_piece: '2025-05-01' }),
    ]
    // La pièce sans montant ne doit PAS combler le trou de mai : elle n'appartient à aucune série.
    expect(moisEnDoubleSurAbonnement(pieces)[0].moisProbable).toBe('2025-05')
  })

  it('franchit une fin d\'année sans se tromper de mois', () => {
    // L'arithmétique passe par un index absolu (année × 12 + mois) : décembre → janvier doit marcher.
    const pieces = abonnement(['2025-10', '2025-11', '2026-01', '2026-01', '2026-02'])
    expect(moisEnDoubleSurAbonnement(pieces)[0]).toMatchObject({ mois: '2026-01', moisProbable: '2025-12' })
  })

  it('rend une liste vide sur un abonnement sain', () => {
    expect(moisEnDoubleSurAbonnement(abonnement(['2025-03', '2025-04', '2025-05', '2025-06']))).toEqual([])
  })
})

// TYPÉ, et sans `as` : le compilateur vérifie alors chaque champ contre `LigneBancaire`, donc contre
// la table. C'est le même remède que le `piece()` de PiecesTab, où il avait sorti cinq colonnes
// manquantes qu'aucune relecture ne montrait.
const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-03-10', libelle: 'PRLV SEPA FOURNISSEUR',
  montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null,
  prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  created_at: '2026-03-10T00:00:00Z', ...o,
})

describe('mouvementsRapprochesSansObjet', () => {
  it('signale le mouvement qui se dit rapproché et ne désigne plus rien', () => {
    // L'état exact que laisse une suppression de pièce ou d'échéance : les deux clés du côté banque
    // sont en `ON DELETE SET NULL`, donc Postgres défait le lien et `statut` ne bouge pas.
    const trouves = mouvementsRapprochesSansObjet([
      ligne({ id: 'orphelin', piece_id: null, cotisation_id: null }),
    ])
    expect(trouves.map((l) => l.id)).toEqual(['orphelin'])
  })

  it('se tait sur un rapprochement qui désigne bien une pièce ou une cotisation', () => {
    expect(mouvementsRapprochesSansObjet([
      ligne({ id: 'sur-piece', piece_id: 'p1', cotisation_id: null }),
      ligne({ id: 'sur-cotisation', piece_id: null, cotisation_id: 'c1' }),
    ])).toEqual([])
  })

  it("se tait sur un mouvement non rapproché, qui n'affirme rien", () => {
    // LE CAS NORMAL, et de très loin le plus fréquent : 922 des 954 lignes en base sont dans cet
    // état. Un contrôle qui les signalerait ne serait pas bruyant, il serait inutilisable.
    expect(mouvementsRapprochesSansObjet([
      ligne({ statut: 'non_rapprochee', piece_id: null, cotisation_id: null }),
      ligne({ statut: 'ignoree', piece_id: null, cotisation_id: null }),
    ])).toEqual([])
  })

  it('signale aussi un virement personnel qui se dirait rapproché', () => {
    // DÉFENSIF, et annoncé comme tel plutôt que déguisé en cas réel : un virement personnel est
    // classé `'ignoree'` par BanqueTab, donc cette combinaison n'existe pas en base (mesuré : les 3
    // prélèvements personnels y sont tous `'ignoree'`). Le prédicat porte sur ce que la ligne
    // AFFIRME, et un virement personnel « rapproché » n'affirme pas quelque chose de plus vrai.
    expect(mouvementsRapprochesSansObjet([
      ligne({ id: 'perso', prelevement_personnel: true, piece_id: null, cotisation_id: null }),
    ]).map((l) => l.id)).toEqual(['perso'])
  })

  it('le prédicat unitaire et la version tableau disent la même chose', () => {
    // L'onglet Banque a besoin du prédicat LIGNE PAR LIGNE pour sa pastille, la Checklist du
    // tableau : deux règles séparées finiraient par diverger, et la pastille verte reviendrait
    // sous un point de Checklist qui, lui, compterait bien.
    const lignes = [
      ligne({ id: 'a', piece_id: null, cotisation_id: null }),
      ligne({ id: 'b', piece_id: 'p1' }),
      ligne({ id: 'c', statut: 'non_rapprochee', piece_id: null, cotisation_id: null }),
      ligne({ id: 'd', piece_id: null, cotisation_id: 'c1' }),
    ]
    expect(mouvementsRapprochesSansObjet(lignes)).toEqual(lignes.filter(mouvementRapprocheSansObjet))
  })
})
