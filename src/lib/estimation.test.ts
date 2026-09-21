import { describe, expect, it } from 'vitest'
import { chargesParPostePourAnnee, ecartPct, totauxPourAnnee } from './estimation'
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
