import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GRAINE_DES_LIGNES, LIGNES_NOMMEES, NOMBRE_DE_LIGNES, ligneEcrite, lignesTirees, type LigneTiree } from '../test/batterieDesLignes'
import { calculerLigne } from './montantsFacture'

// LE HT ET LA TVA D'UNE LIGNE, L'APPLICATION ET LA BASE SUR LES MÊMES DIX MILLE LIGNES (correction de la facture,
// 31/10/2026 ; migration `facture_dates_centimes_mention_tva`, PRÉPARÉE dans supabase/preparees/). La batterie de
// src/test/batterieDesLignes.ts — dix mille lignes tirées d'une graine fixe, dont les trois que la relecture a trouvées —
// a été jugée le 31/10/2026 par `centimes_ligne_facture` ELLE-MÊME, sur la réplique (PostgreSQL 16, la production à 164
// migrations), par supabase/essais/batterieDesLignes.mjs : chaque ligne sous l'écriture décimale que JSON lui donne,
// sa réponse recopiée dans l'ordre. Avec la migration, la base rend EXACTEMENT ce que rend `calculerLigne` — aucun écart
// sur dix mille, l'empreinte figée ici ; sans elle, la base rend le calcul d'hier, la virgule flottante du navigateur
// recopiée au bit près — l'empreinte que rend aussi l'ancien calcul, recopié ci-dessous —, qui s'écarte du décimal exact
// sur 59 lignes (57 de leur HT, 2 de leur seule TVA). Si `calculerLigne` change ce qu'il rend, ce test tombe ; si la
// base change son calcul, le contrôle 100 de supabase/essais/encaissementsFactures.sql et encaissementsBase.test.ts
// tombent ; dans les deux cas la batterie se rejoue par le script, et les empreintes se remplacent ensemble. Données
// FICTIVES.

const EMPREINTE_DES_LIGNES = 'dce9123572ca00a9e18cc5769964f832'
const EMPREINTE_DE_LA_BASE = 'b9a68f0239801b51b5b2249db515780b'
const EMPREINTE_DE_LA_BASE_AVANT = '11ca805699cec58e016e71bc9c2dc486'

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const centimes = (x: number) => Math.round(x * 100)
const enCentimes = (l: LigneTiree) => {
  const c = calculerLigne(l.quantite, l.prix, l.taux)
  return `${centimes(c.montant_ht)}/${centimes(c.montant_tva)}`
}

// LE CALCUL D'HIER, recopié du bloc `montantsFacture` d'avant la correction (et de `centimes_ligne_facture`, qui le
// recopiait en double précision) : le HT au centime en virgule flottante, le demi éloigné de zéro sur la valeur binaire.
function auCentime(x: number): number {
  const c = Math.round(Math.abs(x) * 100) / 100
  return c === 0 ? 0 : x < 0 ? -c : c
}
const enCentimesHier = (l: LigneTiree) => {
  const ht = auCentime(l.quantite * l.prix)
  const tva = auCentime(ht * (l.taux / 100))
  return `${centimes(ht)}/${centimes(tva)}`
}

const LIGNES = lignesTirees(GRAINE_DES_LIGNES, NOMBRE_DE_LIGNES)

describe('la batterie des lignes, jugée par la base', () => {
  it('tire dix mille lignes distinctes, celles que la base a jugées : l’empreinte de leur écriture décimale', () => {
    expect(LIGNES).toHaveLength(10000)
    const ecrites = LIGNES.map(ligneEcrite)
    expect(new Set(ecrites).size).toBe(10000)
    expect(md5(ecrites.join('\n'))).toBe(EMPREINTE_DES_LIGNES)
    // Les trois lignes de la relecture et leurs avoirs, en tête.
    expect(LIGNES.slice(0, 3)).toEqual(LIGNES_NOMMEES)
    expect(LIGNES.slice(3, 6)).toEqual(LIGNES_NOMMEES.map((l) => ({ ...l, quantite: -l.quantite })))
  })

  it('couvre les formes qu’une ligne prend : des avoirs, des remises, chaque taux, des HT exactement au demi-centime', () => {
    expect(LIGNES.filter((l) => l.quantite < 0).length).toBeGreaterThan(1500)
    expect(LIGNES.filter((l) => l.prix < 0).length).toBeGreaterThan(700)
    expect(new Set(LIGNES.map((l) => l.taux)).size).toBe(15)
    // Un HT au demi-centime exact : là où l'arrondi décide, et où la virgule flottante se trompait.
    const demis = LIGNES.filter((l) => {
      const [q, p] = [String(Math.abs(l.quantite)), String(Math.abs(l.prix))]
      const decimales = (s: string) => (s.split('.')[1] ?? '').length
      const produit = BigInt(q.replace('.', '')) * BigInt(p.replace('.', ''))
      // Le produit compte decimales(q) + decimales(p) décimales : au-delà de deux, ce qui passe le centime décide.
      const audela = decimales(q) + decimales(p) - 2
      if (audela < 1) return false
      const echelle = 10n ** BigInt(audela)
      return 2n * (produit % echelle) === echelle
    })
    expect(demis.length).toBeGreaterThan(400)
  })

  it('le module rend, ligne par ligne, ce que la base munie de la migration a rendu', () => {
    expect(md5(LIGNES.map(enCentimes).join(','))).toBe(EMPREINTE_DE_LA_BASE)
  })

  it('sans la migration, la base rendait le calcul d’hier, qui s’écartait du décimal exact sur 59 lignes', () => {
    const hier = LIGNES.map(enCentimesHier)
    expect(md5(hier.join(','))).toBe(EMPREINTE_DE_LA_BASE_AVANT)
    const neuf = LIGNES.map(enCentimes)
    const ecarts = neuf.map((x, i) => (x === hier[i] ? null : i)).filter((i): i is number => i !== null)
    expect(ecarts).toHaveLength(59)
    // D'un centime au plus, sur le HT ou sur la TVA, et toujours vers zéro : la valeur binaire tombait sous le demi.
    for (const i of ecarts) {
      const [htN, tvaN] = neuf[i].split('/').map(Number)
      const [htH, tvaH] = hier[i].split('/').map(Number)
      expect(Math.abs(htN - htH), ligneEcrite(LIGNES[i])).toBeLessThanOrEqual(1)
      expect(Math.abs(htN), ligneEcrite(LIGNES[i])).toBeGreaterThanOrEqual(Math.abs(htH))
      expect(Math.abs(tvaN - tvaH), ligneEcrite(LIGNES[i])).toBeLessThanOrEqual(1)
    }
  })

  it('les trois lignes de la relecture : 16,03 €, 1,01 € et 0,23 € HT — 16,02 €, 1,00 € et 0,22 € hier', () => {
    expect(LIGNES_NOMMEES.map(enCentimes)).toEqual(['1603/321', '101/20', '23/5'])
    expect(LIGNES_NOMMEES.map(enCentimesHier)).toEqual(['1602/320', '100/20', '22/4'])
  })
})

describe('le calcul neuf, sur toute la batterie', () => {
  it('le signe : un avoir et une remise valent l’opposé exact de la ligne, le demi éloigné de zéro dans les deux sens', () => {
    for (const l of LIGNES) {
      const c = calculerLigne(l.quantite, l.prix, l.taux)
      for (const oppose of [calculerLigne(-l.quantite, l.prix, l.taux), calculerLigne(l.quantite, -l.prix, l.taux)]) {
        expect(centimes(oppose.montant_ht) + centimes(c.montant_ht), ligneEcrite(l)).toBe(0)
        expect(centimes(oppose.montant_tva) + centimes(c.montant_tva), ligneEcrite(l)).toBe(0)
      }
    }
  })

  it('le TTC est la somme du HT et de la TVA, au centime, et chaque montant est un nombre de centimes entier', () => {
    for (const l of LIGNES) {
      const c = calculerLigne(l.quantite, l.prix, l.taux)
      for (const x of [c.montant_ht, c.montant_tva, c.montant_ttc]) expect(Number.isInteger(Math.round(x * 100)) && Math.abs(x * 100 - Math.round(x * 100)) < 1e-6).toBe(true)
      expect(centimes(c.montant_ttc)).toBe(centimes(c.montant_ht) + centimes(c.montant_tva))
    }
  })

  it('une valeur qui n’est pas un nombre fini ne fait pas un montant', () => {
    for (const [q, p, t] of [[Number.NaN, 1, 20], [1, Number.POSITIVE_INFINITY, 20], [1, 1, Number.NaN], [Number.NEGATIVE_INFINITY, 1, 0]]) {
      const c = calculerLigne(q, p, t)
      expect([c.montant_ht, c.montant_tva, c.montant_ttc].every(Number.isNaN)).toBe(true)
    }
  })

  it('une écriture exponentielle se lit comme son décimal : 1e-7 × 10⁷ et 1e21 × 1e-21 valent 1,00 €', () => {
    // `String` écrit ces nombres « 1e-7 » et « 1e+21 », comme JSON les envoie : leur décimal exact fait le produit.
    expect(calculerLigne(1e-7, 1e7, 20)).toEqual({ montant_ht: 1, montant_tva: 0.2, montant_ttc: 1.2 })
    expect(calculerLigne(1e21, 1e-21, 20)).toEqual({ montant_ht: 1, montant_tva: 0.2, montant_ttc: 1.2 })
    expect(calculerLigne(1, 1.5e-7, 20).montant_ht).toBe(0)
    expect(calculerLigne(1, 5e-3, 20).montant_ht).toBe(0.01)
  })
})
