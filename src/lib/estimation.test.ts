import { describe, expect, it } from 'vitest'
import { chargesParPostePourAnnee, ecartPct, projectionAnnuelle, totauxPourAnnee } from './estimation'
import type { CotisationDeclaree, Piece } from './types'

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', nom_fichier: 'x.pdf', statut: 'validee', type_piece: 'vente',
  date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 100,
  categorie_id: null, created_at: '2026-03-10T00:00:00Z', ...o,
} as Piece)

const cotisation = (o: Partial<CotisationDeclaree>): CotisationDeclaree =>
  ({ id: 'c', dossier_id: 'd1', echeance: '2026-02-05', montant_appele: 300, montant_verse: null, ...o } as CotisationDeclaree)

describe('totauxPourAnnee', () => {
  it('ne retient que l’année demandée', () => {
    const totaux = totauxPourAnnee(
      [piece({ id: 'a', date_piece: '2026-01-01', montant_ttc: 100 }),
       piece({ id: 'b', date_piece: '2025-12-31', montant_ttc: 900 })],
      [cotisation({ echeance: '2026-02-05', montant_appele: 300 }),
       cotisation({ echeance: '2025-02-05', montant_appele: 999 })],
      2026,
    )
    expect(totaux).toEqual({ ca: 100, cotis: 300 })
  })

  it('préfère le HT au TTC quand il est renseigné', () => {
    expect(totauxPourAnnee([piece({ montant_ht: 80, montant_ttc: 96 })], [], 2026).ca).toBe(80)
    expect(totauxPourAnnee([piece({ montant_ht: null, montant_ttc: 96 })], [], 2026).ca).toBe(96)
  })

  it('ignore une pièce sans date', () => {
    expect(totauxPourAnnee([piece({ date_piece: null })], [], 2026).ca).toBe(0)
  })

  it('retient le montant versé d’une cotisation, sinon celui appelé', () => {
    const cotis = totauxPourAnnee([], [
      cotisation({ id: 'x', montant_appele: 300, montant_verse: 280 }),
      cotisation({ id: 'y', montant_appele: 400, montant_verse: null }),
    ], 2026).cotis
    expect(cotis).toBe(680)
  })

  it('additionne sans trier : le filtrage ventes/validées est au chargement', () => {
    // Contrat implicite mais réel : `EstimationTab` et `ClientSimulation` chargent tous deux avec
    // `.eq('statut','validee').eq('type_piece','vente')`. Cette fonction ne re-filtre pas — lui
    // passer des achats les ferait entrer dans le chiffre d'affaires.
    const avecAchat = totauxPourAnnee(
      [piece({ id: 'v', montant_ttc: 100 }), piece({ id: 'a', type_piece: 'achat', montant_ttc: 70 })],
      [], 2026,
    )
    expect(avecAchat.ca).toBe(170)
  })
})

describe('projectionAnnuelle', () => {
  // Un échéancier créé d'avance pour toute l'année, comme le fait « Créer l'échéancier » depuis un
  // appel de cotisation : douze échéances de 100 €, le 5 de chaque mois.
  const echeancier = Array.from({ length: 12 }, (_, i) =>
    cotisation({ id: `e${i}`, echeance: `2026-${String(i + 1).padStart(2, '0')}-05`, montant_appele: 100 }))

  it('divise par les mois ÉCOULÉS, pas par le numéro du mois', () => {
    // Le 1er février, un mois et un jour sont écoulés (31/30 en 30/360). Le numéro du mois en
    // comptait deux, et annonçait une projection de moitié.
    const p = projectionAnnuelle([piece({ date_piece: '2026-01-15', montant_ttc: 1000 })], [], '2026-02-01')
    expect(p.moisEcoules).toBeCloseTo(31 / 30, 10)
    expect(p.caProjete).toBeCloseTo((1000 * 12 * 30) / 31, 6)
  })

  it('« à date » ne compte pas une échéance à venir, et ne projette que l’échu', () => {
    // Le 20 mars : trois échéances échues (janvier, février, mars) sur les douze créées. L'écran
    // affichait les douze comme « appelées à date », puis les multipliait par 12/3.
    const p = projectionAnnuelle(
      [piece({ id: 'passee', date_piece: '2026-03-02', montant_ttc: 600 }),
       piece({ id: 'future', date_piece: '2026-11-30', montant_ttc: 9000 })],
      echeancier, '2026-03-20',
    )
    expect(p.cotis).toBe(300)
    expect(p.ca).toBe(600)
    const mois = (2 * 30 + 20) / 30
    expect(p.moisEcoules).toBeCloseTo(mois, 10)
    expect(p.cotisationsProjetees).toBeCloseTo((300 * 12) / mois, 6)
  })

  it('compte l’échéance du jour : elle est appelée', () => {
    expect(projectionAnnuelle([], echeancier, '2026-03-05').cotis).toBe(300)
    expect(projectionAnnuelle([], echeancier, '2026-03-04').cotis).toBe(200)
  })

  it('tient l’année et les mois d’UNE date : le 5 janvier ne projette pas l’année d’avant', () => {
    // Le défaut d'appariement : l'année figée au chargement, le mois relu au rendu. Au passage d'une
    // année, l'écran ramenait l'année ENTIÈRE qui venait de finir à douze fois sa valeur.
    const p = projectionAnnuelle(
      [piece({ date_piece: '2026-12-10', montant_ttc: 50000 })], echeancier, '2027-01-05',
    )
    expect(p.annee).toBe(2027)
    expect(p.ca).toBe(0)
    expect(p.cotis).toBe(0)
  })

  it('n’annualise pas moins d’un mois, mais rend ce qui est déjà là', () => {
    // Le 20 janvier, dix-neuf jours ramenés à douze mois font un chiffre qui bouge d'un facteur deux
    // à chaque pièce saisie. Même plancher que la CAF des ratios bancaires.
    const p = projectionAnnuelle([piece({ date_piece: '2026-01-10', montant_ttc: 800 })], echeancier, '2026-01-20')
    expect(p.caProjete).toBeNull()
    expect(p.cotisationsProjetees).toBeNull()
    expect(p.ca).toBe(800)
    expect(p.cotis).toBe(100)
  })

  it('le 31 décembre, la projection est l’année elle-même', () => {
    // Le garde symétrique : douze mois écoulés, rien à ramener — sans lui, « rapporter aux mois
    // écoulés » serait satisfait par une fonction qui déforme toujours.
    const p = projectionAnnuelle([piece({ date_piece: '2026-06-01', montant_ttc: 1234 })], echeancier, '2026-12-31')
    expect(p.moisEcoules).toBe(12)
    expect(p.caProjete).toBeCloseTo(1234, 10)
    expect(p.cotisationsProjetees).toBeCloseTo(1200, 10)
  })
})

describe('ecartPct', () => {
  it('formate l’écart avec son signe', () => {
    expect(ecartPct(120, 100)).toBe('+20 %')
    expect(ecartPct(80, 100)).toBe('-20 %')
    expect(ecartPct(100, 100)).toBe('+0 %')
  })

  it('rend un tiret faute de base de comparaison', () => {
    // Zéro comme absence : sans cela, la division rendrait Infinity.
    expect(ecartPct(120, null)).toBe('—')
    expect(ecartPct(120, 0)).toBe('—')
  })

  it('arrondit à l’entier', () => {
    expect(ecartPct(133, 100)).toBe('+33 %')
    expect(ecartPct(100.4, 100)).toBe('+0 %')
  })
})

// DEUX ÉCRIVAINS, DEUX CONVENTIONS DE SIGNE, DANS LA MÊME COLONNE.
//
// Le bouton « Calculer le détail par poste » multipliait chaque dépense par −1 et écrivait donc des
// montants NÉGATIFS dans `references_postes_annuels` ; le formulaire juste au-dessus y écrit ce que
// le cabinet tape, et un loyer se saisit « 12000 ». Les deux lignes s'affichent dans le MÊME
// tableau, sous un titre qui dit « autres charges », l'une à 12 000,00 € et l'autre à −8 450,00 €,
// sans que rien n'explique la différence.
//
// La convention du projet est écrite ailleurs — `cases2035.ts` : « `montant` reste positif, le signe
// est porté par la nature », et `totauxPourAnnee` ci-dessus rend un `ca` et des `cotis` positifs.
// C'est donc le calcul qui rentre dans le rang.
//
// LATENT : `references_postes_annuels` est VIDE dans toute la base, la fonctionnalité n'ayant jamais
// été exercée. Ce qui la rend digne d'être corrigée est qu'une fois deux lignes écrites par les deux
// chemins, rien ne dirait laquelle suit quelle convention.
describe('chargesParPostePourAnnee', () => {
  const cat = (id: string, poste: string | null) => ({ id, poste_2035: poste })
  const CATEGORIES = [cat('c-loyer', 'Loyer'), cat('c-hono', 'Honoraires'), cat('c-sans', null)]
  const achat = (o: Partial<Piece>): Piece =>
    ({
      id: 'p1', type_piece: 'achat', statut: 'validee', date_piece: '2025-03-01',
      categorie_id: 'c-loyer', montant_ht: 100, montant_ttc: 120, ...o,
    }) as Piece

  it('rend des montants POSITIFS, comme la saisie manuelle', () => {
    const totaux = chargesParPostePourAnnee([achat({})], CATEGORIES, new Set(), 2025)
    expect(totaux.get('Loyer')).toBe(100)
  })

  it('laisse un avoir DIMINUER le poste, plutôt que de prendre la valeur absolue', () => {
    // Même règle que `declaration2035` : on additionne le montant tel quel. Une valeur absolue
    // ferait d'un remboursement une charge de plus.
    const totaux = chargesParPostePourAnnee(
      [achat({ id: 'a' }), achat({ id: 'b', montant_ht: -30 })], CATEGORIES, new Set(), 2025)
    expect(totaux.get('Loyer')).toBe(70)
  })

  it('écarte les recettes, que la carte « autres charges » ne doit pas contenir', () => {
    // Le commentaire d'origine le disait déjà — « ici on ne veut que les postes de charge issus des
    // catégories » — et le code ne le faisait pas : une vente entrait, positive, indiscernable
    // d'une charge une fois écrite en base. Le chiffre d'affaires a son champ dans
    // `references_annuelles`.
    const totaux = chargesParPostePourAnnee(
      [achat({ id: 'v', type_piece: 'vente', categorie_id: 'c-hono', montant_ht: 4500 })],
      CATEGORIES, new Set(), 2025)
    expect(totaux.has('Honoraires')).toBe(false)
    expect(totaux.size).toBe(0)
  })

  it('écarte une pièce immobilisée', () => {
    // Sinon une dépense capitalisée serait comptée une fois en charge courante ET une fois en
    // amortissement.
    const totaux = chargesParPostePourAnnee([achat({ id: 'i' })], CATEGORIES, new Set(['i']), 2025)
    expect(totaux.size).toBe(0)
  })

  it('écarte une pièce d’un autre exercice, et une sans poste', () => {
    const totaux = chargesParPostePourAnnee(
      [achat({ id: 'a', date_piece: '2024-12-31' }), achat({ id: 'b', categorie_id: 'c-sans' })],
      CATEGORIES, new Set(), 2025)
    expect(totaux.size).toBe(0)
  })

  it('retombe sur le TTC quand le HT n’est pas lu, comme le moteur de la 2035', () => {
    const totaux = chargesParPostePourAnnee(
      [achat({ montant_ht: null, montant_ttc: 120 })], CATEGORIES, new Set(), 2025)
    expect(totaux.get('Loyer')).toBe(120)
  })

  // GARDE SYMÉTRIQUE : sans elle, « rend des montants positifs » et « écarte les recettes » seraient
  // satisfaits par une fonction qui ne rend JAMAIS rien — et le bouton afficherait pour toujours
  // « Aucune pièce avec un poste 2035 renseigné pour cette année ».
  it('cumule bien plusieurs postes d’un même exercice', () => {
    const totaux = chargesParPostePourAnnee(
      [
        achat({ id: 'a', montant_ht: 100 }),
        achat({ id: 'b', montant_ht: 250, date_piece: '2025-07-04' }),
        achat({ id: 'c', categorie_id: 'c-hono', montant_ht: 80 }),
      ],
      CATEGORIES, new Set(), 2025)
    expect([...totaux].sort()).toEqual([['Honoraires', 80], ['Loyer', 350]])
  })
})
