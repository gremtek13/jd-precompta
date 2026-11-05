import { beforeAll, describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import {
  REFUS_ACOMPTE,
  cibleDuTtc,
  groupesDuDevis,
  lignesDeLaFinale,
  preparerAcompte,
  refusDeLaFinale,
  repartirSurLesRestes,
  restesDuDevis,
  totauxParTaux,
  type AcompteValide,
  type DemandeAcompte,
  type EntreeAcompte,
  type EtatPourAcompte,
  type LigneDuDevisPourAcompte,
  type LigneTiree,
  type ResteDuGroupe,
} from './acompteDevis'

const OUVERT: EtatPourAcompte = { accepte: true, finaleActive: false, acompteEnBrouillon: false, mode: 'tresorerie' }

const ligne = (quantite: number, prix: number, taux: number, designation = 'Prestation'): LigneDuDevisPourAcompte => ({
  designation,
  quantite,
  prix_unitaire_ht: prix,
  taux_tva: taux,
})

function entree(lignesDevis: LigneDuDevisPourAcompte[], demande: DemandeAcompte, acomptesValides: AcompteValide[] = []): EntreeAcompte {
  return { numeroDevis: 'D2026-0001', lignesDevis, acomptesValides, demande, etat: OUVERT }
}

// Préparer puis « valider » un acompte : ce que la base figera, rendu sous la forme d'un acompte validé.
function tirerEtValider(e: EntreeAcompte, numero: string, date = '2026-03-12'): AcompteValide {
  const r = preparerAcompte(e)
  if (!r.ok) throw new Error(r.refus)
  return { id: `id-${numero}`, numero, date, lignes: r.lignes }
}

const pct = (pourcentage: number): DemandeAcompte => ({ mode: 'pourcentage', pourcentage })
const ttc = (ttcCentimes: number): DemandeAcompte => ({ mode: 'ttc', ttcCentimes })

describe('un acompte, cas écrits à la main', () => {
  it('un taux : 30 % de 1 000 € HT à 20 %', () => {
    const r = preparerAcompte(entree([ligne(10, 100, 20)], pct(30)))
    expect(r).toEqual({
      ok: true,
      cibleHt: 30000,
      ttc: 36000,
      lignes: [
        { designation: 'Acompte de 30 % sur le devis D2026-0001', quantite: 1, prix_unitaire_ht: 300, taux_tva: 20, nature: null, reprise_facture_id: null },
      ],
      totaux: { montant_ht: 300, montant_tva: 60, montant_ttc: 360 },
    })
  })

  it('un pourcentage s’arrondit sur son décimal exact, le demi éloigné de zéro : 64,6 % de 2,50 € font 1,62 €', () => {
    // 2,50 × 0,646 = 1,615 exactement ; en virgule flottante, 250 × 64,6 / 100 vaut 161,4999… et l'arrondi rendrait 1,61 €.
    expect(preparerAcompte(entree([ligne(1, 2.5, 0)], pct(64.6)))).toMatchObject({ ok: true, cibleHt: 162 })
    expect(preparerAcompte(entree([ligne(1, 7.5, 0)], pct(4.6)))).toMatchObject({ ok: true, cibleHt: 35 })
  })

  it('deux taux : la cible au prorata du reste, une ligne par taux qui dit son taux', () => {
    const r = preparerAcompte(entree([ligne(1, 1000, 20), ligne(1, 500, 5.5)], pct(30)))
    if (!r.ok) throw new Error(r.refus)
    expect(r.lignes.map((l) => [l.designation, l.prix_unitaire_ht, l.taux_tva])).toEqual([
      ['Acompte de 30 % sur le devis D2026-0001 — TVA 20 %', 300, 20],
      ['Acompte de 30 % sur le devis D2026-0001 — TVA 5,5 %', 150, 5.5],
    ])
    expect(r.ttc).toBe(30000 + 6000 + 15000 + 825)
  })

  it('le groupe suit la nature quand la ligne la dit, et la désignation la nomme', () => {
    const lignes: LigneDuDevisPourAcompte[] = [
      { ...ligne(1, 100, 20), nature: 'biens' },
      { ...ligne(1, 100, 20), nature: 'services' },
    ]
    expect(groupesDuDevis(lignes).map((g) => [g.taux_tva, g.nature, g.ht])).toEqual([[20, 'biens', 10000], [20, 'services', 10000]])
    const r = preparerAcompte(entree(lignes, pct(50)))
    if (!r.ok) throw new Error(r.refus)
    expect(r.lignes.map((l) => [l.designation, l.nature])).toEqual([
      ['Acompte de 50 % sur le devis D2026-0001 — biens, TVA 20 %', 'biens'],
      ['Acompte de 50 % sur le devis D2026-0001 — services, TVA 20 %', 'services'],
    ])
  })

  it('30 % puis 40 % puis le solde : les plus forts restes, puis une finale qui reprend chaque acompte', () => {
    const devis = [ligne(1, 333.33, 20), ligne(1, 166.67, 10)]
    // 30 % de 500,00 € : 9 999,9 et 5 000,1 centimes, le centime qui manque au plus fort reste (le 20 %).
    const a1 = tirerEtValider(entree(devis, pct(30)), 'F2026-0010', '2026-02-01')
    expect(a1.lignes.map((l) => l.prix_unitaire_ht)).toEqual([100, 50])
    // 40 % : 13 333,14 et 6 666,86 centimes sur les restes, le centime au 10 %.
    const a2 = tirerEtValider(entree(devis, pct(40), [a1]), 'F2026-0011', '2026-03-15')
    expect(a2.lignes.map((l) => l.prix_unitaire_ht)).toEqual([133.33, 66.67])
    const restes = restesDuDevis(devis, [a1, a2])
    expect(restes.ok && restes.groupes.map((g) => g.reste)).toEqual([10000, 5000])
    // 31 % du devis dépasse les 30 % qui restent.
    expect(preparerAcompte(entree(devis, pct(31), [a1, a2]))).toEqual({
      ok: false,
      refus: 'L’acompte (155,00 € HT) dépasse ce qui reste à facturer du devis (150,00 € HT).',
    })

    const finale = lignesDeLaFinale(devis, [a1, a2])
    expect(finale.slice(2).map((l) => [l.designation, l.quantite, l.prix_unitaire_ht, l.reprise_facture_id])).toEqual([
      ['Reprise de l’acompte F2026-0010 du 01/02/2026', -1, 100, 'id-F2026-0010'],
      ['Reprise de l’acompte F2026-0010 du 01/02/2026', -1, 50, 'id-F2026-0010'],
      ['Reprise de l’acompte F2026-0011 du 15/03/2026', -1, 133.33, 'id-F2026-0011'],
      ['Reprise de l’acompte F2026-0011 du 15/03/2026', -1, 66.67, 'id-F2026-0011'],
    ])
    // Le solde : 100,00 € à 20 % (TVA 66,67 − 20,00 − 26,67) et 50,00 € à 10 % (16,67 − 5,00 − 6,67).
    expect(totauxParTaux(finale)).toEqual([
      { taux_tva: 20, ht: 10000, tva: 2000 },
      { taux_tva: 10, ht: 5000, tva: 500 },
    ])
    expect(refusDeLaFinale(finale)).toBeNull()
  })

  it('100 % d’un coup se refuse : le solde se facture par la finale (P5B-Q5) ; des acomptes venus d’ailleurs qui couvrent tout ne laissent rien', () => {
    const devis = [ligne(10, 100, 20)]
    expect(preparerAcompte(entree(devis, pct(100)))).toEqual({ ok: false, refus: REFUS_ACOMPTE.couvreToutLeDevis })
    expect(preparerAcompte(entree(devis, ttc(120000)))).toEqual({ ok: false, refus: REFUS_ACOMPTE.couvreToutLeDevis })
    // 99,99 % laisse 0,10 € HT et 0,02 € de TVA : accepté.
    const a = tirerEtValider(entree(devis, pct(99.99)), 'F2026-0012')
    expect(totauxParTaux(lignesDeLaFinale(devis, [a]))).toEqual([{ taux_tva: 20, ht: 10, tva: 2 }])
    const tout: AcompteValide = { id: 'x', numero: 'F2026-0019', date: '2026-01-01', lignes: [{ quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] }
    expect(preparerAcompte(entree(devis, pct(1), [tout]))).toEqual({ ok: false, refus: REFUS_ACOMPTE.sansReste })
  })

  it('un acompte qui laisserait une TVA négative à la finale se refuse (P5B-Q5) : l’arrondi par ligne du devis', () => {
    // Trois lignes de 10,02 € à 20 % : 6,00 € de TVA, la somme des arrondis de ses lignes (2,004 → 2,00). À 99,9 %,
    // l'acompte ferait 30,03 € HT et 6,01 € de TVA (6,006) : la finale porterait 0,03 € HT et −0,01 € de TVA.
    const devis = [ligne(1, 10.02, 20), ligne(1, 10.02, 20), ligne(1, 10.02, 20)]
    expect(preparerAcompte(entree(devis, pct(99.9)))).toEqual({
      ok: false,
      refus:
        'L’acompte laisserait une TVA négative à la facture finale (-0,01 € à 20 %) : la TVA du devis s’arrondit ligne par ' +
        'ligne, celle de l’acompte sur sa part. Demandez un peu moins, ou tirez la facture finale.',
    })
    // À 99,8 %, 30,00 € HT et 6,00 € de TVA : la finale garde 0,06 € HT et 0,00 € de TVA.
    const a = tirerEtValider(entree(devis, pct(99.8)), 'F2026-0013')
    const finale = lignesDeLaFinale(devis, [a])
    expect(totauxParTaux(finale)).toEqual([{ taux_tva: 20, ht: 6, tva: 0 }])
    expect(refusDeLaFinale(finale)).toBeNull()
    // Deux lignes de 10,02 € : l'acompte entier (4,01 € de TVA contre 4,00 €) se refuse d'abord parce qu'il couvre tout.
    expect(preparerAcompte(entree([ligne(1, 10.02, 20), ligne(1, 10.02, 20)], pct(100)))).toEqual({
      ok: false,
      refus: REFUS_ACOMPTE.couvreToutLeDevis,
    })
  })

  it('un TTC inaccessible : 0,03 € à 20 % donne 0,02 € HT et 0,02 € TTC, dit exact', () => {
    const devis = [ligne(1, 1, 20)]
    expect(preparerAcompte(entree(devis, ttc(3)))).toMatchObject({ ok: true, cibleHt: 2, ttc: 2 })
    expect(preparerAcompte(entree(devis, ttc(4)))).toMatchObject({ ok: true, cibleHt: 3, ttc: 4 })
    // Le TTC entier du devis le couvrirait tout (P5B-Q5) ; un centime de moins laisse 0,01 € HT à la finale.
    expect(preparerAcompte(entree(devis, ttc(120)))).toEqual({ ok: false, refus: REFUS_ACOMPTE.couvreToutLeDevis })
    expect(preparerAcompte(entree(devis, ttc(119)))).toMatchObject({ ok: true, cibleHt: 99, ttc: 119 })
    expect(preparerAcompte(entree(devis, ttc(121)))).toEqual({
      ok: false,
      refus: 'L’acompte (1,21 € TTC) dépasse ce qui reste à facturer du devis (1,20 € TTC).',
    })
    const r = preparerAcompte(entree([ligne(1, 12000, 20)], ttc(360000)))
    expect(r).toMatchObject({ ok: true, cibleHt: 300000, ttc: 360000 })
    expect(r.ok && r.lignes[0].designation).toBe('Acompte de 3 600,00 € TTC sur le devis D2026-0001')
  })

  it('les égalités des restes se départagent dans l’ordre du devis', () => {
    const g = (reste: number, taux: number): ResteDuGroupe => ({ taux_tva: taux, nature: null, ht: reste, deja: 0, reste })
    const trois = [g(100, 0), g(100, 10), g(100, 20)]
    expect(repartirSurLesRestes(trois, 1)).toEqual([1, 0, 0])
    expect(repartirSurLesRestes(trois, 2)).toEqual([1, 1, 0])
    expect(repartirSurLesRestes([g(100, 20), g(100, 10), g(100, 0)], 2)).toEqual([1, 1, 0])
    // Le plus fort reste l'emporte sur l'ordre : 7 × 1/7, 7 × 3/7, 7 × 3/7 sur une cible de 4 → 0,57 ; 1,71 ; 1,71.
    expect(repartirSurLesRestes([g(1, 0), g(3, 10), g(3, 20)], 4)).toEqual([0, 2, 2])
    expect(repartirSurLesRestes([g(1, 0), g(3, 10), g(3, 20)], 3)).toEqual([1, 1, 1])
    expect(() => repartirSurLesRestes(trois, 301)).toThrow(RangeError)
  })
})

describe('les refus avant le clic', () => {
  const devis = [ligne(1, 100, 20)]
  const refus = (e: EntreeAcompte) => {
    const r = preparerAcompte(e)
    return r.ok ? null : r.refus
  }

  it('l’état du devis et du dossier d’abord, dans cet ordre', () => {
    const tout: EtatPourAcompte = { accepte: false, finaleActive: true, acompteEnBrouillon: true, mode: 'engagement' }
    expect(refus({ ...entree(devis, pct(0)), etat: tout })).toBe(REFUS_ACOMPTE.nonAccepte)
    expect(refus({ ...entree(devis, pct(0)), etat: { ...tout, accepte: true } })).toBe(REFUS_ACOMPTE.finaleActive)
    expect(refus({ ...entree(devis, pct(0)), etat: { ...tout, accepte: true, finaleActive: false } })).toBe(REFUS_ACOMPTE.acompteEnBrouillon)
    expect(refus({ ...entree(devis, pct(0)), etat: { ...OUVERT, mode: 'engagement' } })).toBe(REFUS_ACOMPTE.engagement)
  })

  it('la saisie : un pourcentage hors de ]0, 100] ou plus fin que le centième, un montant nul, négatif ou fractionnaire', () => {
    for (const p of [0, -5, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) expect(refus(entree(devis, pct(p)))).toBe(REFUS_ACOMPTE.pourcentageHorsBornes)
    expect(refus(entree(devis, pct(33.333)))).toBe(REFUS_ACOMPTE.pourcentageTropPrecis)
    // 100 % est dans les bornes de la saisie ; il se refuse ensuite parce qu'il couvrirait tout le devis.
    expect(refus(entree(devis, pct(100)))).toBe(REFUS_ACOMPTE.couvreToutLeDevis)
    expect(refus(entree(devis, pct(14.07)))).toBeNull()
    for (const t of [0, -1, Number.NaN]) expect(refus(entree(devis, ttc(t)))).toBe(REFUS_ACOMPTE.montantNonPositif)
    expect(refus(entree(devis, ttc(10.5)))).toBe(REFUS_ACOMPTE.montantTropPrecis)
  })

  it('un pourcentage qui fait moins d’un centime, et des acomptes incohérents avec le devis', () => {
    expect(refus(entree([ligne(1, 0.4, 20)], pct(1)))).toBe(REFUS_ACOMPTE.moinsDUnCentime)
    const etranger: AcompteValide = { id: 'x', numero: 'F2026-0020', date: '2026-01-01', lignes: [{ quantite: 1, prix_unitaire_ht: 10, taux_tva: 10 }] }
    expect(refus(entree(devis, pct(10), [etranger]))).toBe('L’acompte F2026-0020 porte une ligne à 10 % que le devis n’a pas.')
    const trop: AcompteValide = { ...etranger, lignes: [{ quantite: 1, prix_unitaire_ht: 100.01, taux_tva: 20 }] }
    expect(refus(entree(devis, pct(10), [trop]))).toBe('Les acomptes validés dépassent le devis à 20 %.')
  })

  it('une finale dont un taux serait négatif, en HT puis en TVA', () => {
    const trop: AcompteValide = { id: 'x', numero: 'F2026-0021', date: '2026-01-01', lignes: [{ quantite: 1, prix_unitaire_ht: 100.01, taux_tva: 20 }] }
    expect(refusDeLaFinale(lignesDeLaFinale(devis, [trop]))).toBe(
      'La facture finale serait négative à 20 % : les acomptes repris dépassent le devis.',
    )
    // Un acompte venu d'ailleurs, de tout le HT de deux lignes de 10,02 € à 20 % : 4,01 € de TVA contre 4,00 €.
    const entier: AcompteValide = { ...trop, lignes: [{ quantite: 1, prix_unitaire_ht: 20.04, taux_tva: 20 }] }
    expect(refusDeLaFinale(lignesDeLaFinale([ligne(1, 10.02, 20), ligne(1, 10.02, 20)], [entier]))).toBe(
      'La facture finale porterait une TVA négative à 20 % : les acomptes repris en ont pris plus que le devis n’en porte.',
    )
  })
})

// LA BATTERIE : des devis tirés d'une graine fixe, et des suites d'acomptes tirés sur eux, jugés propriété par propriété.
const GRAINE = 20261105
const NOMBRE_DE_DEVIS = 3000
const TAUX = [0, 5.5, 10, 20] as const

interface CasDeLaBatterie {
  devis: LigneDuDevisPourAcompte[]
  acomptes: { demande: DemandeAcompte; avant: AcompteValide[]; resultat: ReturnType<typeof preparerAcompte> }[]
  valides: AcompteValide[]
}

// Un nombre à `decimales` décimales au plus, écrit comme l'écran l'enverrait.
function decimal(t: () => number, max: number, decimales: number): number {
  const echelle = 10 ** decimales
  return Number(((1 + entierTire(t, max * echelle)) / echelle).toFixed(decimales))
}

function tirerLaBatterie(): CasDeLaBatterie[] {
  const t = tirage(GRAINE)
  const cas: CasDeLaBatterie[] = []
  for (let n = 0; n < NOMBRE_DE_DEVIS; n++) {
    // Un tiers de petits devis (quelques euros), où la recherche du TTC se confronte à TOUS les HT possibles.
    const petit = entierTire(t, 3) === 0
    const devis = Array.from({ length: 1 + entierTire(t, 6) }, (_, i) =>
      ligne(
        petit ? decimal(t, 3, entierTire(t, 3)) : decimal(t, 50, entierTire(t, 5)),
        petit ? decimal(t, 2, 2) : decimal(t, 2000, entierTire(t, 7)),
        TAUX[entierTire(t, TAUX.length)],
        `Ligne ${i + 1}`,
      ),
    )
    const valides: AcompteValide[] = []
    const acomptes: CasDeLaBatterie['acomptes'] = []
    const nombre = 1 + entierTire(t, 4)
    for (let k = 0; k < nombre; k++) {
      const restes = restesDuDevis(devis, valides)
      if (!restes.ok) throw new Error(restes.refus)
      const resteHt = restes.groupes.reduce((s, g) => s + g.reste, 0)
      const ttcReste = resteHt + totauxParTaux(lignesDeLaFinale(devis, valides)).reduce((s, x) => s + Math.max(0, x.tva), 0)
      const demande: DemandeAcompte =
        entierTire(t, 2) === 0
          ? pct(entierTire(t, 4) === 0 ? 1 + entierTire(t, 100) : (1 + entierTire(t, 10000)) / 100)
          : ttc(1 + entierTire(t, Math.max(1, Math.round(ttcReste * 1.1))))
      const resultat = preparerAcompte(entree(devis, demande, [...valides]))
      acomptes.push({ demande, avant: [...valides], resultat })
      if (resultat.ok) valides.push({ id: `id-${n}-${k}`, numero: `F-${n}-${k}`, date: '2026-06-30', lignes: resultat.lignes })
    }
    cas.push({ devis, acomptes, valides })
  }
  return cas
}

// Le TTC d'un HT réparti, compté ici par les lignes que la fonction elle-même tire : la confrontation porte sur le choix
// du HT, pas sur la répartition, que les autres propriétés jugent.
function ttcDuHt(groupes: ResteDuGroupe[], ht: number): number {
  const parts = repartirSurLesRestes(groupes, ht)
  return groupes.reduce((s, g, i) => {
    const tva = totauxParTaux([{ quantite: 1, prix_unitaire_ht: parts[i] / 100, taux_tva: g.taux_tva }])[0].tva
    return s + parts[i] + tva
  }, 0)
}

const parTaux = (lignes: readonly LigneTiree[]) => new Map(totauxParTaux(lignes).map((x) => [x.taux_tva, x]))

// La finale que laisserait un acompte de `cible` centimes HT réparti sur les restes, recomposée ici à partir des
// lignes du devis et des parts : de quoi juger qu'un refus de TVA négative est fondé.
function tvaLaissee(devis: LigneDuDevisPourAcompte[], avant: AcompteValide[], groupes: ResteDuGroupe[], cible: number) {
  const parts = repartirSurLesRestes(groupes, cible)
  return totauxParTaux([
    ...lignesDeLaFinale(devis, avant),
    ...groupes.map((g, i) => ({ quantite: -1, prix_unitaire_ht: parts[i] / 100, taux_tva: g.taux_tva })),
  ])
}

// Les refus de P5B-Q5 à cette graine, comptés pour qu'aucun ne disparaisse sans qu'on le voie.
const COUVRE_TOUT = 41
const TVA_NEGATIVE = 20

describe(`la batterie : ${NOMBRE_DE_DEVIS} devis tirés de la graine ${GRAINE}`, () => {
  let cas: CasDeLaBatterie[] = []
  beforeAll(() => {
    cas = tirerLaBatterie()
  })

  it('tire assez de cas de chaque sorte pour juger', () => {
    const tous = cas.flatMap((c) => c.acomptes)
    expect(tous.filter((a) => a.resultat.ok && a.demande.mode === 'pourcentage').length).toBeGreaterThan(1500)
    expect(tous.filter((a) => a.resultat.ok && a.demande.mode === 'ttc').length).toBeGreaterThan(1500)
    expect(tous.filter((a) => !a.resultat.ok).length).toBeGreaterThan(300)
    expect(cas.filter((c) => new Set(c.devis.map((l) => l.taux_tva)).size >= 3).length).toBeGreaterThan(300)
  })

  it('la somme des parts est la cible, aucune part ne dépasse son reste, le cumul ne dépasse aucun groupe', () => {
    for (const c of cas) {
      for (const a of c.acomptes) {
        const restes = restesDuDevis(c.devis, a.avant)
        if (!restes.ok || !a.resultat.ok) continue
        const parts = new Map(totauxParTaux(a.resultat.lignes).map((x) => [x.taux_tva, x.ht]))
        expect([...parts.values()].reduce((s, p) => s + p, 0)).toBe(a.resultat.cibleHt)
        for (const g of restes.groupes) expect(parts.get(g.taux_tva) ?? 0).toBeLessThanOrEqual(g.reste)
      }
      const fin = restesDuDevis(c.devis, c.valides)
      expect(fin.ok).toBe(true)
    }
  })

  it('les parts suivent les plus forts restes, à égalité dans l’ordre du devis', () => {
    for (const c of cas) {
      for (const a of c.acomptes) {
        const restes = restesDuDevis(c.devis, a.avant)
        if (!restes.ok || !a.resultat.ok) continue
        const g = restes.groupes
        const total = BigInt(g.reduce((s, x) => s + x.reste, 0))
        const cible = BigInt(a.resultat.cibleHt)
        const parts = repartirSurLesRestes(g, a.resultat.cibleHt)
        const plancher = g.map((x) => (cible * BigInt(x.reste)) / total)
        const reste = g.map((x) => (cible * BigInt(x.reste)) % total)
        for (let i = 0; i < g.length; i++) {
          const plus = BigInt(parts[i]) - plancher[i]
          expect(plus === 0n || plus === 1n).toBe(true)
          for (let j = 0; j < g.length; j++) {
            // Un groupe servi d'un centime ne cède devant aucun groupe non servi : reste plus fort, ou égal et avant.
            if (plus === 1n && BigInt(parts[j]) === plancher[j]) expect(reste[i] > reste[j] || (reste[i] === reste[j] && i < j)).toBe(true)
          }
        }
      }
    }
  })

  it('un pourcentage : HT × pourcentage / 100, au centime, le demi vers le haut ; au-delà du reste, refusé', () => {
    for (const c of cas) {
      for (const a of c.acomptes) {
        if (a.demande.mode !== 'pourcentage') continue
        const restes = restesDuDevis(c.devis, a.avant)
        if (!restes.ok) continue
        const ht = BigInt(restes.groupes.reduce((s, g) => s + g.ht, 0))
        const resteHt = BigInt(restes.groupes.reduce((s, g) => s + g.reste, 0))
        const attendu = (ht * BigInt(Math.round(a.demande.pourcentage * 100)) + 5000n) / 10000n
        if (resteHt === 0n) expect(a.resultat).toEqual({ ok: false, refus: REFUS_ACOMPTE.sansReste })
        else if (attendu === 0n) expect(a.resultat).toEqual({ ok: false, refus: REFUS_ACOMPTE.moinsDUnCentime })
        else if (attendu > resteHt) expect(a.resultat.ok).toBe(false)
        else if (attendu === resteHt) expect(a.resultat).toEqual({ ok: false, refus: REFUS_ACOMPTE.couvreToutLeDevis })
        else if (!a.resultat.ok) expect(tvaLaissee(c.devis, a.avant, restes.groupes, Number(attendu)).some((x) => x.tva < 0)).toBe(true)
        else expect(BigInt(a.resultat.cibleHt)).toBe(attendu)
      }
    }
  })

  it('un TTC : le plus proche de tous les HT possibles, à égalité le plus petit HT, rendu exact', () => {
    let confrontes = 0
    for (const c of cas) {
      for (const a of c.acomptes) {
        if (a.demande.mode !== 'ttc' || !a.resultat.ok) continue
        const restes = restesDuDevis(c.devis, a.avant)
        if (!restes.ok) continue
        const g = restes.groupes
        expect(a.resultat.ttc).toBe(ttcDuHt(g, a.resultat.cibleHt))
        const total = g.reduce((s, x) => s + x.reste, 0)
        if (total > 800) continue
        confrontes++
        let meilleur = { ht: 0, ecart: Number.POSITIVE_INFINITY }
        for (let ht = 1; ht <= total; ht++) {
          const ecart = Math.abs(ttcDuHt(g, ht) - a.demande.ttcCentimes)
          if (ecart < meilleur.ecart) meilleur = { ht, ecart }
        }
        expect(a.resultat.cibleHt).toBe(meilleur.ht)
        expect(cibleDuTtc(g, a.demande.ttcCentimes).ht).toBe(meilleur.ht)
      }
    }
    expect(confrontes).toBeGreaterThan(400)
  })

  it('la finale : HT et TVA positifs ou nuls par taux, du HT laissé, les reprises l’opposé exact, finale + acomptes = devis', () => {
    for (const c of cas) {
      const finale = lignesDeLaFinale(c.devis, c.valides)
      expect(refusDeLaFinale(finale)).toBeNull()
      const devis = parTaux(lignesDeLaFinale(c.devis, []))
      const fin = parTaux(finale)
      const acomptes = parTaux(c.valides.flatMap((a) => a.lignes.map((l) => ({ ...l, nature: l.nature ?? null, designation: '', reprise_facture_id: null }))))
      const reprises = parTaux(finale.filter((l) => l.reprise_facture_id !== null))
      for (const [taux, d] of devis) {
        const f = fin.get(taux)!
        const a = acomptes.get(taux) ?? { ht: 0, tva: 0 }
        const r = reprises.get(taux) ?? { ht: 0, tva: 0 }
        expect(f.ht).toBeGreaterThanOrEqual(0)
        expect(r.tva + a.tva).toBe(0)
        expect(r.ht + a.ht).toBe(0)
        expect(f.ht + a.ht).toBe(d.ht)
        expect(f.tva + a.tva).toBe(d.tva)
        // P5B-Q5 : aucun acompte accepté ne laisse à la finale une TVA négative.
        expect(f.tva).toBeGreaterThanOrEqual(0)
      }
      // Ni un acompte qui couvre tout : la finale garde du HT.
      expect([...fin.values()].reduce((s, x) => s + x.ht, 0)).toBeGreaterThan(0)
      expect(new Set(finale.map((l) => l.taux_tva))).toEqual(new Set(devis.keys()))
    }
  })

  it('les deux refus de P5B-Q5 se rencontrent dans la batterie, et chacun y est fondé', () => {
    let couvreTout = 0
    let tvaNegative = 0
    for (const c of cas) {
      for (const a of c.acomptes) {
        if (a.resultat.ok) continue
        if (a.resultat.refus === REFUS_ACOMPTE.couvreToutLeDevis) couvreTout++
        else if (a.resultat.refus.startsWith('L’acompte laisserait une TVA négative')) tvaNegative++
      }
    }
    expect(couvreTout).toBe(COUVRE_TOUT)
    expect(tvaNegative).toBe(TVA_NEGATIVE)
  })
})
