import { describe, expect, it } from 'vitest'
import { CHAMPS_BNC_NON_EXPORTES, genererFec } from './fec'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import { lignesDeLaContrePassation } from './contrePassationDesEcrituresLibres'
import type { EcritureLibreDeLEtat, EcrituresLibresDesExports } from './ecrituresLibresDesExports'
import { lignesDeLEtat } from './etatDesEcrituresLibres'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import type { EcritureBrouillon } from './types'
import { modeleDeTest } from '../test/modeles'
import { NON_VALIDEE } from '../test/ecritures'
import { SANS_ECRITURE_DE_VENTE, ventesFactureesVides } from '../test/ventesFacturees'

// EL7 : LA 2035, LE FEC ET L'ÉTAT LISENT UNE CONTRE-PASSATION COMME UNE ÉCRITURE LIBRE ORDINAIRE. Aucun moteur ne lit
// `contre_passe_id` : la même écriture, avec ou sans son lien, rend la même 2035, le même FEC et le même état ; ses lignes au sens
// inverse diminuent les postes de l'exercice de la contre-passation (ses postes gardés), ou s'y déclarent hors de la 2035 ; la
// 2035 de l'exercice d'origine ne bouge pas. Données FICTIVES.

const ORIGINE: EcritureLibreDeLEtat = {
  id: 'el-origine', dossier_id: 'd1', exercice: 2025, numero: 3, date: '2025-06-30', libelle: 'Part professionnelle du téléphone',
  motif: 'Usage mixte.', avec_extourne: false, piece_citee_id: null, version: 1, cree_par: 'u1', cree_le: '2025-07-01T09:00:00Z',
  modifie_par: null, modifie_le: null,
  lignes: [
    { compte: '606100', sens: 'debit', centimes: 5000, poste_2035: 'Achats', compte_lib: null },
    { compte: '108000', sens: 'credit', centimes: 5000, poste_2035: null, compte_lib: null },
  ],
}
const contrePassation = (horsDeLa2035: boolean, avecLeLien = true): EcritureLibreDeLEtat => ({
  ...ORIGINE, id: 'el-contre', exercice: 2026, numero: 1, date: '2026-01-01', libelle: 'Contre-passation de EL2025-0003 — Part professionnelle du téléphone',
  motif: 'Le téléphone était personnel.', cree_le: '2026-01-02T09:00:00Z', lignes: lignesDeLaContrePassation(ORIGINE, horsDeLa2035),
  ...(avecLeLien ? { contre_passe_id: ORIGINE.id } : {}),
})
const lues = (ecritures: readonly EcritureLibreDeLEtat[]): EcrituresLibresDesExports => ({ etat: 'lues', ecritures, auteurs: new Map() })
const declarer = (annee: number, libres: EcrituresLibresDesExports): Declaration2035 => calculerDeclaration2035(
  annee, [], [], [], [], [], false, paiementsDesPieces([], [], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
  { etat: 'sans_bascule' }, CAISSE_ABSENTE, libres,
)
const poste = (d: Declaration2035, nom: string) => [...d.recettes, ...d.depenses].find((l) => l.poste === nom)

// Les lignes au brouillon que les deux fonctions de la base écrivent : chaque ligne de l'écriture à sa date, sous son libellé.
let rang = 0
const auBrouillon = (e: EcritureLibreDeLEtat): EcritureBrouillon[] => e.lignes.map((l) => ({
  id: `b${++rang}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, date: e.date, compte: l.compte, libelle: e.libelle,
  montant: l.centimes / 100, sens: l.sens, statut: 'proposee', created_at: e.cree_le, immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, encaissement_id: null, facture_id: null, ecriture_libre_id: e.id,
}))
const fec = (e: readonly EcritureLibreDeLEtat[]) => genererFec(e.flatMap(auBrouillon), [], [], [], modeleDeTest('tresorerie'), [], new Map(),
  SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES, lues(e))

describe('la 2035 lit une contre-passation comme une écriture libre ordinaire', () => {
  it('ses postes gardés : le poste de l’exercice de la contre-passation diminue d’autant, celui de l’origine ne bouge pas', () => {
    const C = contrePassation(false)
    expect(poste(declarer(2025, lues([ORIGINE, C])), 'Achats')).toMatchObject({ montant: 50, nbEcrituresLibres: 1 })
    expect(poste(declarer(2025, lues([ORIGINE, C])), 'Achats')).toEqual(poste(declarer(2025, lues([ORIGINE])), 'Achats'))
    expect(poste(declarer(2026, lues([ORIGINE, C])), 'Achats')).toMatchObject({ montant: -50, nbEcrituresLibres: 1 })
  })

  it('hors de la 2035 : rien ne se compte en 2026, la ligne se déclare hors de la 2035', () => {
    const d = declarer(2026, lues([ORIGINE, contrePassation(true)]))
    expect(poste(d, 'Achats')).toBeUndefined()
    expect(d.totalDepenses).toBe(0)
    expect(d.exclusions.ecrituresLibresHorsDeLa2035?.map((l) => [l.ecriture.id, l.compte, l.centimes])).toEqual([['el-contre', '606100', -5000]])
  })

  it('avec ou sans son lien, la même 2035, aux deux années : le lien n’y paraît que dans l’écriture source qu’elle cite', () => {
    // Une contribution cite l'écriture qui la porte (sa source) : le lien voyage avec elle, il ne compte nulle part.
    const sansLeLien = (d: Declaration2035) => JSON.parse(JSON.stringify(d, (cle, v) => (cle === 'contre_passe_id' ? undefined : v)))
    for (const hors of [false, true]) {
      for (const annee of [2025, 2026]) {
        expect(sansLeLien(declarer(annee, lues([ORIGINE, contrePassation(hors)]))), `${hors} ${annee}`)
          .toEqual(sansLeLien(declarer(annee, lues([ORIGINE, contrePassation(hors, false)]))))
      }
    }
  })
})

describe('le FEC et l’état la lisent de même', () => {
  it('le FEC : avec ou sans son lien, le même fichier ; la contre-passation au journal OD, sous sa pièce et son libellé', () => {
    const avec = fec([ORIGINE, contrePassation(false)])
    expect(avec).toBe(fec([ORIGINE, contrePassation(false, false)]))
    const lignes = avec.split(/\r?\n/).filter((l) => l.includes('EL2026-0001'))
    expect(lignes).toHaveLength(2)
    for (const l of lignes) {
      expect(l.split('\t')[0]).toBe('OD')
      expect(l).toContain('Contre-passation de EL2025-0003 — Part professionnelle du téléphone')
    }
    expect(avec.split(/\r?\n/).filter((l) => l.includes('EL2025-0003\t'))).toHaveLength(2)
  })

  it('l’état de l’exercice de la contre-passation : ses lignes au sens inverse, son libellé et son motif, comme toute écriture', () => {
    const contexte = { mode: 'tresorerie' as const, auteurs: new Map<string, string>(), pieces: new Map() }
    const avec = lignesDeLEtat([ORIGINE, contrePassation(false)], 2026, contexte)
    expect(avec).toEqual(lignesDeLEtat([ORIGINE, contrePassation(false, false)], 2026, contexte))
    expect(avec.map((l) => [l.reference, l.compte, l.debitCentimes, l.creditCentimes, l.effetSur2035, l.motif])).toEqual([
      ['EL2026-0001', '606100', 0, 5000, 'Achats', 'Le téléphone était personnel.'],
      ['EL2026-0001', '108000', 5000, 0, '—', 'Le téléphone était personnel.'],
    ])
    expect(lignesDeLEtat([ORIGINE, contrePassation(false)], 2025, contexte).map((l) => l.reference)).toEqual(['EL2025-0003', 'EL2025-0003'])
  })
})
