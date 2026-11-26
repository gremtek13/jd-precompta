import { describe, expect, it } from 'vitest'
import type { EcritureLibreDeLEtat } from './ecrituresLibresDesExports'
import {
  COLONNES_DE_L_ETAT, colonnesDeLEtat, contenuDeLEtat, contrePassationDansLEtat, genererEtatDesEcrituresLibresCsv, lignesDeLEtat,
  type ContexteDeLEtat,
} from './etatDesEcrituresLibres'

// RA253-Q1 (A) : SOUS UNE CONTRE-PASSATION, L'ÉTAT DES ÉCRITURES LIBRES NOMME L'ÉCRITURE QU'ELLE ANNULE, d'après le LIEN que la base
// garde (`contre_passe_id`, EL7), jamais d'après le libellé ; l'écriture annulée dit qui l'annule ; un lien vers une écriture que la
// lecture ne porte pas se dit « non lue » ; rien ne change pour une écriture ordinaire ; sans le lien lu (le drapeau d'EL7 baissé),
// l'état d'hier. Jamais le libellé ni le motif de l'AUTRE écriture dans la ligne. Données FICTIVES.

const ORIGINE: EcritureLibreDeLEtat = {
  id: 'el-origine', dossier_id: 'd1', exercice: 2025, numero: 3, date: '2025-06-30', libelle: 'Part professionnelle du téléphone',
  motif: 'Usage mixte constaté.', avec_extourne: false, piece_citee_id: null, version: 1, cree_par: 'u1', cree_le: '2025-07-01T09:00:00Z',
  modifie_par: null, modifie_le: null, contre_passe_id: null,
  lignes: [
    { compte: '606100', sens: 'debit', centimes: 5000, poste_2035: 'Achats', compte_lib: null },
    { compte: '108000', sens: 'credit', centimes: 5000, poste_2035: null, compte_lib: null },
  ],
}
const CONTRE: EcritureLibreDeLEtat = {
  ...ORIGINE, id: 'el-contre', exercice: 2026, numero: 1, date: '2026-01-02', libelle: 'Contre-passation de EL2025-0003 — Part professionnelle du téléphone',
  motif: 'Le téléphone était personnel.', cree_le: '2026-01-02T09:00:00Z', contre_passe_id: ORIGINE.id,
  lignes: [
    { compte: '606100', sens: 'credit', centimes: 5000, poste_2035: 'Achats', compte_lib: null },
    { compte: '108000', sens: 'debit', centimes: 5000, poste_2035: null, compte_lib: null },
  ],
}
const ORDINAIRE: EcritureLibreDeLEtat = { ...ORIGINE, id: 'el-ordinaire', exercice: 2026, numero: 2, date: '2026-03-31', libelle: 'Reclassement' }
const contexte = (contrePassation: boolean): ContexteDeLEtat => ({ mode: 'tresorerie', auteurs: new Map(), pieces: new Map(), contrePassation })
const TOUTES = [ORIGINE, CONTRE, ORDINAIRE]

describe('l’état nomme la contre-passation d’après le lien (RA253-Q1 (A))', () => {
  it('sous la contre-passation : l’écriture qu’elle annule, sa référence et sa date ; sous l’annulée : celle qui l’annule', () => {
    expect(contrePassationDansLEtat(CONTRE, TOUTES)).toBe('Contre-passe EL2025-0003 du 30/06/2025')
    expect(contrePassationDansLEtat(ORIGINE, TOUTES)).toBe('Contre-passée par EL2026-0001 du 02/01/2026')
    expect(lignesDeLEtat(TOUTES, 2026, contexte(true)).map((l) => [l.reference, l.contrePassation])).toEqual([
      ['EL2026-0001', 'Contre-passe EL2025-0003 du 30/06/2025'], ['EL2026-0001', 'Contre-passe EL2025-0003 du 30/06/2025'],
      ['EL2026-0002', ''], ['EL2026-0002', ''],
    ])
    expect(lignesDeLEtat(TOUTES, 2025, contexte(true)).map((l) => l.contrePassation))
      .toEqual(['Contre-passée par EL2026-0001 du 02/01/2026', 'Contre-passée par EL2026-0001 du 02/01/2026'])
  })

  it('le libellé changé par le cabinet : la ligne nomme quand même, par le lien ; un libellé qui en nomme une autre ne trompe pas', () => {
    const renommee = { ...CONTRE, libelle: 'Annulation du forfait de téléphone' }
    expect(contrePassationDansLEtat(renommee, [ORIGINE, renommee])).toBe('Contre-passe EL2025-0003 du 30/06/2025')
    // Une écriture ordinaire dont le libellé cite une autre écriture n'est pas une contre-passation.
    const trompeuse = { ...ORDINAIRE, libelle: 'Contre-passation de EL2025-0003' }
    expect(contrePassationDansLEtat(trompeuse, [ORIGINE, trompeuse])).toBe('')
    expect(contrePassationDansLEtat(ORIGINE, [ORIGINE, trompeuse])).toBe('')
  })

  it('l’écriture annulée absente de la lecture : « non lue », jamais devinée ni tue', () => {
    expect(contrePassationDansLEtat(CONTRE, [CONTRE])).toBe('Contre-passe une écriture non lue')
    expect(lignesDeLEtat([CONTRE], 2026, contexte(true))[0].contrePassation).toBe('Contre-passe une écriture non lue')
  })

  it('une contre-passation contre-passée à son tour dit les deux', () => {
    const recontre = { ...CONTRE, id: 'el-re', numero: 5, date: '2026-04-01', contre_passe_id: CONTRE.id }
    expect(contrePassationDansLEtat(CONTRE, [ORIGINE, CONTRE, recontre]))
      .toBe('Contre-passe EL2025-0003 du 30/06/2025 ; Contre-passée par EL2026-0005 du 01/04/2026')
  })

  it('jamais le libellé ni le motif de l’autre écriture dans la ligne', () => {
    const [ligneContre] = lignesDeLEtat(TOUTES, 2026, contexte(true))
    expect(ligneContre.contrePassation).not.toContain(ORIGINE.libelle)
    expect(ligneContre.contrePassation).not.toContain(ORIGINE.motif)
    const [ligneOrigine] = lignesDeLEtat(TOUTES, 2025, contexte(true))
    expect(ligneOrigine.contrePassation).not.toContain(CONTRE.motif)
    expect(ligneOrigine.contrePassation).not.toContain('téléphone')
  })

  it('une écriture ordinaire : rien ne change, ses lignes sont celles d’hier hormis la cellule vide', () => {
    const avec = lignesDeLEtat([ORDINAIRE], 2026, contexte(true))
    const sans = lignesDeLEtat([ORDINAIRE], 2026, contexte(false))
    expect(avec).toEqual(sans)
    expect(avec.every((l) => l.contrePassation === '')).toBe(true)
    expect(contenuDeLEtat(avec, 2026)).toEqual(contenuDeLEtat(sans, 2026))
  })
})

describe('le CSV et le PDF, selon que la lecture porte le lien', () => {
  it('le lien lu : la colonne « Contre-passation » après l’extourne, chaque cellule par champCsv', () => {
    expect(colonnesDeLEtat(true)).toEqual([...COLONNES_DE_L_ETAT.slice(0, 10), 'Contre-passation', ...COLONNES_DE_L_ETAT.slice(10)])
    const rangs = genererEtatDesEcrituresLibresCsv(lignesDeLEtat(TOUTES, 2026, contexte(true)), true).slice(1).split('\r\n')
    expect(rangs[0].split(';')[10]).toBe('Contre-passation')
    expect(rangs[1].split(';')[10]).toBe('Contre-passe EL2025-0003 du 30/06/2025')
    expect(rangs[3].split(';')[10]).toBe('')
    expect(rangs.every((r) => r.split(';').length === 16)).toBe(true)
    // Deux mentions à la suite : le point-virgule se protège.
    const recontre = { ...CONTRE, id: 'el-re', numero: 5, date: '2026-04-01', contre_passe_id: CONTRE.id }
    const csv = genererEtatDesEcrituresLibresCsv(lignesDeLEtat([ORIGINE, CONTRE, recontre], 2026, contexte(true)), true)
    expect(csv).toContain(';non;"Contre-passe EL2025-0003 du 30/06/2025 ; Contre-passée par EL2026-0005 du 01/04/2026";1;')
  })

  it('le lien non lu (le drapeau d’EL7 baissé) : les colonnes et les cellules d’hier, aucune mention', () => {
    const lignes = lignesDeLEtat(TOUTES, 2026, contexte(false))
    expect(lignes.every((l) => l.contrePassation === '')).toBe(true)
    const csv = genererEtatDesEcrituresLibresCsv(lignes, false)
    expect(csv.slice(1).split('\r\n')[0]).toBe(COLONNES_DE_L_ETAT.join(';'))
    expect(csv).not.toContain('Contre-passe ')
    expect(contenuDeLEtat(lignes, 2026).some((b) => b.texte.startsWith('Contre-passe'))).toBe(false)
  })

  it('le PDF : la mention sous le libellé de la contre-passation, après l’extourne, avant le motif', () => {
    const blocs = contenuDeLEtat(lignesDeLEtat(TOUTES, 2026, contexte(true)), 2026)
    const textes = blocs.map((b) => b.texte)
    const rang = textes.indexOf('Contre-passe EL2025-0003 du 30/06/2025.')
    expect(rang).toBeGreaterThan(0)
    expect(textes[rang + 1]).toBe('Motif : Le téléphone était personnel.')
    expect(textes.filter((t) => t.startsWith('Contre-pass'))).toHaveLength(1)
    expect(contenuDeLEtat(lignesDeLEtat(TOUTES, 2025, contexte(true)), 2025).map((b) => b.texte))
      .toContain('Contre-passée par EL2026-0001 du 02/01/2026.')
  })
})
