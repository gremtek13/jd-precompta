import { describe, expect, it } from 'vitest'
import { partsDuReleve } from './partsDuReleve'
import { calculerSituationIntermediaire, fractionDeLAnnee, moisEcoulesDeLAnnee } from './situationIntermediaire'
import type { Categorie, CotisationDeclaree, Immobilisation, LigneBancaire, Piece } from './types'
import { paiementsDesPieces } from './rattachement'

const categorie = { id: 'c1', libelle: 'Achats', poste_2035: 'Achats', compte_comptable: '606100' } as Categorie
const recette = { id: 'c2', libelle: 'Recettes', poste_2035: 'Recettes', compte_comptable: '706000' } as Categorie

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'achat',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 100,
  categorie_id: 'c1', created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const immo = (o: Partial<Immobilisation>): Immobilisation => ({
  id: 'i', dossier_id: 'd1', piece_id: null, nature_id: null, libelle: 'Matériel',
  valeur: 3000, duree_annees: 3, date_acquisition: '2026-01-01', ...o,
} as Immobilisation)

describe('calculerSituationIntermediaire', () => {
  // L'état qu'on montre à une banque suit la règle de la 2035 (voir lib/montantRetenu.ts) : TVA
  // comprise pour un dossier exonéré, qui ne la récupère pas, hors taxes pour un assujetti.
  it('retient la TVA comprise pour un dossier exonéré, le hors taxes pour un assujetti', () => {
    const achat = piece({ id: 'a', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const exonere = calculerSituationIntermediaire([achat], [categorie], [], [], '2026-01-01', '2026-06-30', false, new Map(), 'tresorerie', [])
    const assujetti = calculerSituationIntermediaire([achat], [categorie], [], [], '2026-01-01', '2026-06-30', true, new Map(), 'tresorerie', [])
    expect(exonere.charges).toBe(120)
    expect(assujetti.charges).toBe(100)
  })

  it('ne retient que les pièces validées de la période', () => {
    const s = calculerSituationIntermediaire(
      [
        piece({ id: 'a', montant_ttc: 100 }),
        piece({ id: 'b', montant_ttc: 500, statut: 'a_valider' }),   // pas validée
        piece({ id: 'c', montant_ttc: 700, date_piece: '2025-12-31' }), // hors période
      ],
      [categorie], [], [], '2026-01-01', '2026-06-30', true, new Map(),
      'tresorerie', [],
    )
    expect(s.charges).toBe(100)
    expect(s.resultat).toBe(-100)
  })

  it('signe les ventes en positif et les achats en négatif', () => {
    const s = calculerSituationIntermediaire(
      [
        piece({ id: 'v', type_piece: 'vente', categorie_id: 'c2', montant_ttc: 900 }),
        piece({ id: 'a', montant_ttc: 300 }),
      ],
      [categorie, recette], [], [], '2026-01-01', '2026-12-31', true, new Map(),
      'tresorerie', [],
    )
    expect(s.recettes).toBe(900)
    expect(s.charges).toBe(300)
    expect(s.resultat).toBe(600)
  })

  it('compte une pièce dans la période de son PAIEMENT, sa date de facture à défaut', () => {
    // La règle de la 2035 (lib/rattachement.ts) : un état arrêté au 31 janvier ne porte pas une
    // facture de janvier réglée en février, et porte celle de décembre réglée en janvier.
    const paiement = (pieceId: string, date: string, montant: number): LigneBancaire => ({
      id: `l-${pieceId}`, dossier_id: 'd1', date, libelle: 'PRLV', montant, statut: 'rapprochee',
      piece_id: pieceId, cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null,
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
      libelle_brut: null, created_at: `${date}T09:00:00Z`,
    })
    const pieces = [
      piece({ id: 'janvier', date_piece: '2026-01-15', montant_ttc: 100 }),
      piece({ id: 'decembre', date_piece: '2025-12-20', montant_ttc: 40 }),
      piece({ id: 'sans-paiement', date_piece: '2026-01-20', montant_ttc: 7 }),
    ]
    const paiements = [paiement('janvier', '2026-02-03', -100), paiement('decembre', '2026-01-05', -40)]
    const auJanvier = calculerSituationIntermediaire(pieces, [categorie], [], [], '2026-01-01', '2026-01-31', true, paiementsDesPieces(paiements, []), 'tresorerie', [])
    expect(auJanvier.charges).toBe(47)
    const auFevrier = calculerSituationIntermediaire(pieces, [categorie], [], [], '2026-01-01', '2026-02-28', true, paiementsDesPieces(paiements, []), 'tresorerie', [])
    expect(auFevrier.charges).toBe(147)
  })

  it('ne porte que la part payée dans la période d’une pièce réglée en partie', () => {
    // 200 € facturés le 15 décembre, 80 € payés le 10 janvier : 40 % dans l'état de janvier, le reste
    // à la date de facture, donc dans l'exercice d'avant.
    const acompte: LigneBancaire = {
      id: 'l-acompte', dossier_id: 'd1', date: '2026-01-10', libelle: 'PRLV', montant: -80, statut: 'rapprochee',
      piece_id: 'partielle', cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null,
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
      libelle_brut: null, created_at: '2026-01-10T09:00:00Z',
    }
    const partielle = piece({ id: 'partielle', date_piece: '2025-12-15', montant_ttc: 200 })
    const s = calculerSituationIntermediaire([partielle], [categorie], [], [], '2026-01-01', '2026-01-31', true, paiementsDesPieces([acompte], []), 'tresorerie', [])
    expect(s.charges).toBe(80)
  })

  it('compte la dotation en entier pour une immobilisation acquise un 1er janvier', () => {
    // L'année d'acquisition était lue via `new Date(...).getFullYear()` : à l'ouest de Greenwich,
    // un 1er janvier se lisait dans l'année précédente, ce qui décalait toute la fenêtre
    // d'amortissement d'un an — dotation absente la première année, présente une année de trop.
    const lignes = (annee: number) =>
      calculerSituationIntermediaire([], [], [immo({ date_acquisition: '2026-01-01' })], [], `${annee}-01-01`, `${annee}-12-31`, true, new Map(), 'tresorerie', [])
        .totauxParPoste.find(([poste]) => poste === 'Amortissements')?.[1]

    expect(lignes(2025)).toBeUndefined()  // avant l'acquisition
    expect(lignes(2026)).toBe(-1000)      // 3000 / 3 ans
    expect(lignes(2028)).toBe(-1000)      // dernière année de la durée
    expect(lignes(2029)).toBeUndefined()  // amortissement terminé
  })

  it('retient le montant versé d’une cotisation, sinon celui appelé', () => {
    const cotisations = [
      { id: 'x', dossier_id: 'd1', echeance: '2026-02-05', montant_appele: 300, montant_verse: 280 },
      { id: 'y', dossier_id: 'd1', echeance: '2026-03-05', montant_appele: 400, montant_verse: null },
      { id: 'z', dossier_id: 'd1', echeance: '2027-01-05', montant_appele: 999, montant_verse: null }, // hors période
    ] as CotisationDeclaree[]
    const s = calculerSituationIntermediaire([], [], [], cotisations, '2026-01-01', '2026-12-31', true, new Map(), 'tresorerie', [])
    expect(s.totauxParPoste.find(([p]) => p === 'Cotisations sociales personnelles')?.[1]).toBe(-680)
  })

  // LA DOTATION SUIT LA PÉRIODE ANNONCÉE — elle comptait une année entière quelle que soit la date.
  //
  // Cet état porte en tête « Période du 1er janvier au <date> » et part dans un dossier bancaire.
  // La ligne « Amortissements » y valait douze mois de charge même sur un état arrêté en janvier.
  // Aucun des tests ci-dessus ne pouvait le voir : ils exercent tous une année civile COMPLÈTE,
  // le seul cas où l'ancienne convention et la bonne coïncident.
  describe('la dotation est rapportée à la période', () => {
    const MATERIEL = immo({ valeur: 12000, duree_annees: 5, date_acquisition: '2026-01-05' })
    const vente = (montant: number, date: string) =>
      piece({ id: 'v' + date, type_piece: 'vente', categorie_id: 'c2', montant_ttc: montant, date_piece: date })
    const dotation = (s: ReturnType<typeof calculerSituationIntermediaire>) =>
      s.totauxParPoste.find(([poste]) => poste === 'Amortissements')?.[1]

    it('n’invente plus un déficit sur un état arrêté en janvier', () => {
      // LE CAS QUI COÛTE, et il est chiffré : 800 € de recettes contre 2 400 € de dotation annuelle,
      // l'état affichait un RÉSULTAT NÉGATIF de 1 600 € — un déficit entièrement fabriqué par la
      // convention, sur le document qu'on montre à une banque pour obtenir un prêt.
      const s = calculerSituationIntermediaire(
        [vente(800, '2026-01-10')], [categorie, recette], [MATERIEL], [], '2026-01-01', '2026-01-31', true, new Map(), 'tresorerie', [])
      expect(dotation(s)).toBe(-200)        // 2 400 € × 1/12
      expect(s.resultat).toBe(600)          // et non −1 600
    })

    it('compte la moitié de la dotation sur un premier semestre', () => {
      const s = calculerSituationIntermediaire(
        [vente(10000, '2026-05-10')], [categorie, recette], [MATERIEL], [], '2026-01-01', '2026-06-30', true, new Map(), 'tresorerie', [])
      expect(dotation(s)).toBe(-1200)
      expect(s.resultat).toBe(8800)
    })

    it('ignore un bien acquis APRÈS la date de l’état', () => {
      // La comparaison ne portait que sur les ANNÉES : un matériel acheté le 15 décembre était
      // amorti en entier sur une situation arrêtée au 30 juin — pas une approximation de prorata,
      // une charge pour un bien qui n'existe pas encore à la date de l'état.
      const s = calculerSituationIntermediaire(
        [vente(10000, '2026-05-10')], [categorie, recette],
        [immo({ valeur: 12000, duree_annees: 5, date_acquisition: '2026-12-15' })], [],
        '2026-01-01', '2026-06-30', true, new Map(), 'tresorerie', [])
      expect(dotation(s)).toBeUndefined()
      expect(s.resultat).toBe(10000)
    })

    // GARDE SYMÉTRIQUE, et c'est elle qui protège le PRÉVISIONNEL : il appelle cette même fonction
    // sur une année civile complète (voir PrevisionnelModal), donc une « proratisation » qui
    // rognerait aussi l'année entière préremplirait un CA et des charges de référence faux. Sans ce
    // cas, « la dotation suit la période » serait satisfait par une fonction qui rabote toujours.
    it('laisse une année civile complète rigoureusement inchangée', () => {
      const s = calculerSituationIntermediaire(
        [vente(10000, '2026-05-10')], [categorie, recette], [MATERIEL], [], '2026-01-01', '2026-12-31', true, new Map(), 'tresorerie', [])
      expect(dotation(s)).toBe(-2400)
      expect(s.resultat).toBe(7600)
    })
  })

  // LE DIVISEUR QUI ANNUALISE LA CAF — l'écran lisait le NUMÉRO du mois courant.
  //
  // `new Date().getMonth() + 1` n'est exact que le DERNIER jour de chaque mois. Le libellé de
  // l'écran reprend ce nombre (« sur N mois écoulés cette année »), donc il affirmait aussi que neuf
  // mois s'étaient écoulés au 1er septembre.
  describe('moisEcoulesDeLAnnee', () => {
    it('compte les mois réellement écoulés, pas le numéro du mois', () => {
      expect(moisEcoulesDeLAnnee('2026-01-31')).toBeCloseTo(1, 10)
      expect(moisEcoulesDeLAnnee('2026-02-01')).toBeCloseTo(31 / 30, 10)   // et non 2
      expect(moisEcoulesDeLAnnee('2026-06-30')).toBeCloseTo(6, 10)
      expect(moisEcoulesDeLAnnee('2026-09-01')).toBeCloseTo(241 / 30, 10)  // et non 9
      expect(moisEcoulesDeLAnnee('2026-12-31')).toBeCloseTo(12, 10)
    })

    it('ne dépasse jamais douze, et vaut presque zéro au 1er janvier', () => {
      // La garde symétrique du diviseur : une année entière doit valoir exactement 12, sinon la CAF
      // d'un exercice clos serait elle aussi faussée. Et le 1er janvier ne vaut PAS un mois — c'est
      // ce que `ratiosBancaires` refuse d'annualiser.
      expect(moisEcoulesDeLAnnee('2026-12-31')).toBe(12)
      expect(moisEcoulesDeLAnnee('2026-01-01')).toBeCloseTo(1 / 30, 10)
    })
  })

  describe('fractionDeLAnnee', () => {
    it('rend les bornes attendues', () => {
      expect(fractionDeLAnnee('2026-01-01', '2026-12-31')).toBe(1)
      expect(fractionDeLAnnee('2026-01-01', '2026-06-30')).toBe(0.5)
      expect(fractionDeLAnnee('2026-01-01', '2026-01-31')).toBeCloseTo(1 / 12, 10)
      // Une période qui ne part pas du 1er janvier — aucun appelant ne le fait aujourd'hui, mais
      // la fonction ne le suppose pas.
      expect(fractionDeLAnnee('2026-04-01', '2026-06-30')).toBe(0.25)
    })

    it('rend 58/360 au 28 février, et c’est la convention 30/360, pas un défaut', () => {
      // Écrit ici pour que personne ne « corrige » ce chiffre en croyant à un bug : en 30/360, un
      // mois vaut 30 jours et février en compte 28 ou 29 réels, qui ne sont PAS ramenés à 30 (seul
      // le 31 l'est). C'est la même convention que `fractionPremiereAnnee` dans declaration2035.ts,
      // et en avoir deux différentes pour la même dotation serait pire que l'écart de 2/360.
      expect(fractionDeLAnnee('2026-01-01', '2026-02-28')).toBeCloseTo(58 / 360, 10)
      expect(fractionDeLAnnee('2026-01-01', '2026-03-31')).toBeCloseTo(90 / 360, 10)
    })
  })

  it('ne compte pas deux fois une pièce devenue immobilisation', () => {
    const s = calculerSituationIntermediaire(
      [piece({ id: 'p-immo', montant_ttc: 3000 })],
      [categorie],
      [immo({ piece_id: 'p-immo' })],
      [], '2026-01-01', '2026-12-31', true, new Map(),
      'tresorerie', [],
    )
    // La pièce sort des charges courantes ; seule la dotation annuelle reste.
    expect(s.charges).toBe(1000)
  })
})

describe('calculerSituationIntermediaire — en engagement', () => {
  it('compte une facture dans la période de sa DATE, pas de son paiement', () => {
    const facture = piece({ id: 'dec', date_piece: '2025-12-20', montant_ttc: 300 })
    const paiement = {
      id: 'l1', dossier_id: 'd1', date: '2026-01-10', libelle: 'PRLV', montant: -300, statut: 'rapprochee',
      piece_id: 'dec', cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
      created_at: '2026-01-11T00:00:00Z',
    } satisfies LigneBancaire
    const janvier = (mode: 'tresorerie' | 'engagement') =>
      calculerSituationIntermediaire([facture], [categorie], [], [], '2026-01-01', '2026-01-31', true, paiementsDesPieces([paiement], []), mode, [])
    expect(janvier('tresorerie').charges).toBe(300)
    expect(janvier('engagement').charges).toBe(0)
    expect(calculerSituationIntermediaire([facture], [categorie], [], [], '2025-01-01', '2025-12-31', true, paiementsDesPieces([paiement], []), 'engagement', []).charges).toBe(300)
  })
})

describe('calculerSituationIntermediaire — les mouvements affectés du relevé', () => {
  // Un encaissement de l'Assurance maladie sans bordereau, des frais bancaires sans facture : ils
  // entrent dans l'état à la date du MOUVEMENT, comme dans la 2035 (lib/affectationBanque.ts).
  const frais = { id: 'c3', libelle: 'Frais bancaires', poste_2035: 'Frais financiers', compte_comptable: '627000' } as Categorie
  const sansPoste = { id: 'c4', libelle: 'Divers', poste_2035: null, compte_comptable: '628000' } as Categorie
  const exploitant = { id: 'c5', libelle: 'Exploitant', poste_2035: 'Recettes', compte_comptable: '108000' } as Categorie
  const toutes = [categorie, recette, frais, sansPoste, exploitant]
  const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
    id: 'm', dossier_id: 'd1', date: '2026-01-20', libelle: 'VIR CPAM', montant: 250, statut: 'rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: 'c2', prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    libelle_brut: null, created_at: '2026-01-21T00:00:00Z', ...o,
  })
  const situation = (lignes: LigneBancaire[], fin = '2026-01-31') =>
    calculerSituationIntermediaire([], toutes, [], [], '2026-01-01', fin, true, new Map(), 'tresorerie', partsDuReleve(lignes, toutes, []))

  it('porte un encaissement affecté en recette', () => {
    const s = situation([mouvement({})])
    expect(s.recettes).toBe(250)
    expect(s.resultat).toBe(250)
    expect(s.totauxParPoste).toEqual([['Recettes', 250]])
  })

  it('laisse hors de l’état un mouvement daté après la date d’arrêt', () => {
    const cpam = [mouvement({ date: '2026-02-03' })]
    expect(situation(cpam).recettes).toBe(0)
    expect(situation(cpam, '2026-02-28').recettes).toBe(250)
  })

  // L'autre borne : un encaissement de décembre appartient à l'exercice d'avant, et le compter ici le
  // compterait deux fois — dans la situation de l'an dernier, et dans celle-ci.
  it('laisse hors de l’état un mouvement daté avant le début de la période', () => {
    const s = situation([mouvement({ id: 'dec', date: '2025-12-30', montant: 900 }), mouvement({})])
    expect(s.recettes).toBe(250)
  })

  it('porte une dépense affectée en charge, qu’un remboursement diminue', () => {
    const s = situation([
      mouvement({ id: 'f', categorie_id: 'c3', montant: -12 }),
      mouvement({ id: 'g', categorie_id: 'c3', montant: 2 }),
    ])
    expect(s.charges).toBe(10)
    expect(s.recettes).toBe(0)
  })

  it('laisse de côté un mouvement sans poste ou dont le compte n’est plus de résultat', () => {
    const s = situation([mouvement({ id: 'x', categorie_id: 'c4', montant: -30 }), mouvement({ id: 'y', categorie_id: 'c5', montant: 500 })])
    expect(s.totauxParPoste).toEqual([])
  })

  // L'état qu'on montre à une banque porte les frais financiers du prêt qu'elle a peut-être accordé :
  // les intérêts et l'assurance d'une échéance rapprochée, dans la période de son prélèvement — jamais
  // le capital, qui rembourse une dette, ni le déblocage, qui n'est pas une recette.
  it('porte les intérêts et l’assurance d’une échéance d’emprunt, pas le capital ni le déblocage', () => {
    const echeance = mouvement({
      id: 'pret', categorie_id: null, montant: -540, emprunt_id: 'emp1', emprunt_echeance: 1,
      emprunt_interets: 36, emprunt_assurance: 21.03,
    })
    const deblocage = mouvement({
      id: 'fonds', categorie_id: null, montant: 12000, emprunt_id: 'emp1', emprunt_echeance: null,
      emprunt_interets: 0, emprunt_assurance: 0,
    })
    const s = situation([echeance, deblocage])
    expect(s.charges).toBe(57.03)
    expect(s.recettes).toBe(0)
    expect(s.totauxParPoste).toEqual([["Primes d'assurance", -21.03], ['Frais financiers', -36]])
    expect(situation([{ ...echeance, date: '2026-02-05' }]).charges).toBe(0)
  })
})
