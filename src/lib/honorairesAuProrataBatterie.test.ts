import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { GRAINE_DES_PRORATA, NOMBRE_DE_PRORATA, PARTS_NOMMEES, partEcrite, partsTirees } from '../test/batterieDesProrata'
import { centimesAuProrata, periodeCivile } from './honorairesAFacturer'

// LE PRORATA DES HONORAIRES, L'APPLICATION ET LA BASE SUR LES MÊMES SIX MILLE PARTS (ligne 47, LM7-Q4 (C), 11/11/2026 ;
// migration `honoraires_factures`, PRÉPARÉE). La batterie de src/test/batterieDesProrata.ts — six mille parts tirées d'une
// graine fixe, dont les cinq que l'essai écrit en toutes lettres — a été jugée le 11/11/2026 par `honoraires_au_prorata`
// ELLE-MÊME, sur une copie de la réplique mère 17 au niveau de la production (197 migrations) munie de LM1, LM4 et de la
// migration, par supabase/essais/batterieDesProrata.mjs : chaque part sous l'écriture décimale que JSON donne à son prix,
// sa réponse recopiée dans l'ordre. La base rend EXACTEMENT ce que rend `centimesAuProrata` — aucun écart sur six mille,
// l'empreinte figée ici. Si `centimesAuProrata` change ce qu'il rend, ce test tombe ; si la base change son calcul, le
// contrôle 64 à 69 de supabase/essais/honorairesFactures.sql tombe ; dans les deux cas la batterie se rejoue par le
// script, et les empreintes se remplacent ensemble. Données FICTIVES.

const EMPREINTE_DES_PARTS = '9a71690b19283fb66da23586a96395a7'
const EMPREINTE_DE_LA_BASE = '6a10280c6c10ee51bf70c11cb0abb27c'

const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const PARTS = partsTirees(GRAINE_DES_PRORATA, NOMBRE_DE_PRORATA)
const centimes = (p: (typeof PARTS)[number]) => centimesAuProrata(p.montant_ht, p.periodicite, p.debut, p.fin)

describe('la batterie du prorata, jugée par la base', () => {
  it('tire six mille parts distinctes, celles que la base a jugées : l’empreinte de leur écriture', () => {
    expect(PARTS).toHaveLength(6000)
    const ecrites = PARTS.map(partEcrite)
    expect(new Set(ecrites).size).toBe(6000)
    expect(md5(ecrites.join('\n'))).toBe(EMPREINTE_DES_PARTS)
    expect(PARTS.slice(0, PARTS_NOMMEES.length)).toEqual(PARTS_NOMMEES)
  })

  it('couvre les formes d’une part : chaque périodicité, la période entière, un seul jour, des années bissextiles, des prix au demi-centime', () => {
    for (const p of ['mois', 'trimestre', 'annee'] as const) expect(PARTS.filter((x) => x.periodicite === p).length).toBeGreaterThan(1500)
    const entieres = PARTS.filter((x) => { const c = periodeCivile(x.periodicite, x.debut); return c.debut === x.debut && c.fin === x.fin })
    expect(entieres.length).toBeGreaterThan(800)
    expect(PARTS.filter((x) => x.debut === x.fin).length).toBeGreaterThan(800)
    expect(PARTS.some((x) => x.debut.endsWith('-02-29'))).toBe(true)
    expect(PARTS.some((x) => x.periodicite === 'annee' && x.debut.startsWith('2100-'))).toBe(true)
    // Là où l'arrondi décide : un prix × jours / jours de la période qui tombe exactement au demi-centime.
    const demis = PARTS.filter((x) => {
      const c = periodeCivile(x.periodicite, x.debut)
      const jour = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000
      const n = BigInt(jour(c.fin) - jour(c.debut) + 1)
      const b = BigInt(jour(x.fin) - jour(c.debut) + 1)
      return (2n * BigInt(Math.round(x.montant_ht * 100)) * b) % (2n * n) === n
    })
    expect(demis.length).toBeGreaterThan(20)
  })

  it('le module rend, part par part, ce que la base munie de la migration a rendu', () => {
    expect(md5(PARTS.map((p) => String(centimes(p))).join(','))).toBe(EMPREINTE_DE_LA_BASE)
  })

  it('aucune part n’est nulle, ni négative, ni plus chère que sa période ; la période entière rend son prix', () => {
    for (const p of PARTS) {
      const c = centimes(p)
      const prix = Math.round(p.montant_ht * 100)
      expect(c).not.toBeNull()
      expect(c!).toBeGreaterThanOrEqual(0)
      expect(c!).toBeLessThanOrEqual(prix)
      const civile = periodeCivile(p.periodicite, p.debut)
      if (civile.debut === p.debut && civile.fin === p.fin) expect(c).toBe(prix)
    }
  })
})
