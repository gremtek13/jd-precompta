import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { montantsDuDocument, TAUX_ADMIS } from './factureCii'
import type { EncaissementFacture, EncaissementFactureTaux, MoyenEncaissement } from './types'

// CE QUE LA BASE DES ENCAISSEMENTS SUPPOSE DE L'APPLICATION (ligne 28.5, étape d1).
//
// `enregistrer_encaissement` plafonne chaque taux par le TTC que la facture électronique a TRANSMIS (BG-23) — celui
// de `montantsDuDocument`, ligne par ligne par `calculerLigne`, en virgule flottante. La base ne le lit nulle part :
// elle le REFAIT (`centimes_ligne_facture`, `montants_par_taux_facture`), en double précision. Le même calcul des deux
// côtés, en entiers à la fin, confronté à une table RELEVÉE EN BASE — la règle du dépôt pour ce que la base doit
// vérifier. Si l'application change son calcul, ce fichier tombe ; si la base change le sien, le contrôle 100 de
// `supabase/essais/encaissementsFactures.sql` tombe.

const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261008180607_encaissements_des_factures.sql', import.meta.url), 'utf8')

const ligneSeule = (quantite: number, prix: number, taux: number, avoir = false) =>
  montantsDuDocument({ type: avoir ? 'avoir' : 'facture' },
    [{ ordre: 0, designation: 'x', quantite, prix_unitaire_ht: prix, taux_tva: taux }], null).lignes[0]

describe('le HT et la TVA d’une ligne, en centimes : la base et l’application', () => {
  it('rendent les valeurs relevées en base, une à une', () => {
    // Relevé le 08/10/2026 en production (PostgreSQL 17.6) et sur la réplique (16), par
    // `centimes_ligne_facture` : une ligne à 1,005 € (1,00 € en virgule flottante, 1,01 € en `numeric`), des demis
    // exacts, un avoir, une remise à prix négatif, des quantités à quatre décimales et des prix à six, et des TVA
    // qui tombent sur un demi-centime (1 € à 5,5 %), où prendre la TVA sur le HT non arrondi, ou arrondir
    // autrement que Math.round, différerait d'un centime.
    const cas: [number, number, number, boolean, string][] = [
      [1, 1.005, 20, false, '100/20'], [3, 0.335, 5.5, false, '101/6'], [1, 0.125, 0, true, '-13/0'],
      [-2, 1.115, 20, true, '223/45'], [2.5, -4.015, 10, false, '-1004/-100'], [0.3333, 100.123456, 20, false, '3337/667'],
      [7, 12.345678, 5.5, false, '8642/475'], [1, 0.285, 20, false, '28/6'], [1, 0.094, 5.5, false, '9/0'],
      [1, 0.046, 10, false, '5/1'], [1, 0.05, 10, false, '5/1'], [1, 1, 5.5, false, '100/6'], [1, 0.15, 10, false, '15/2'],
    ]
    for (const [q, p, t, avoir, attendu] of cas) {
      const l = ligneSeule(q, p, t, avoir)
      expect(`${l.htCentimes}/${l.tvaCentimes}`, `${q} × ${p} à ${t} %${avoir ? ', avoir' : ''}`).toBe(attendu)
    }
  })

  it('rendent la même grille de 7 800 lignes que la base, à l’empreinte près', () => {
    // Tous les taux admis, deux sens, treize quantités, vingt prix, dans l'ordre des boucles ci-dessous ; la même
    // grille relevée en base le 08/10/2026 (production 17.6 et réplique 16) donne cette empreinte.
    const Q = [1, 2, 3, 0.5, 0.3333, 1.2345, 7, 12.5, -1, -2.5, 100, 0.0001, 9999.9999]
    const P = [1.005, 0.335, 0.125, 1.115, 4.015, 100.123456, 12.345678, 0.285, 0.094, 0.046, 0.05, 1, 0.15, 19.99, 0.01,
      999999.999999, -4.015, -0.125, 0.000001, 33.333333]
    const valeurs: string[] = []
    for (const avoir of [false, true]) for (const t of TAUX_ADMIS) for (const q of Q) for (const p of P) {
      const l = ligneSeule(q, p, t, avoir)
      valeurs.push(`${l.htCentimes}/${l.tvaCentimes}`)
    }
    expect(valeurs).toHaveLength(7800)
    expect(createHash('md5').update(valeurs.join(',')).digest('hex')).toBe('3e0c4e81edf847fd6d46c0d74504e022')
  })
})

describe('les montants par taux d’une facture : la base et l’application', () => {
  it('rendent ceux des factures relevées en base', () => {
    // `montants_par_taux_facture`, relevé le 08/10/2026 : les six factures de la production (des formes, aucune
    // donnée), la facture à trois taux et l'avoir de l'essai (contrôle 42d). Base, TVA et TTC en centimes, par taux.
    const releve: { lignes: [number, number, number][]; avoir?: boolean; attendu: string }[] = [
      { lignes: [[1, 500, 20]], attendu: '20:50000/10000/60000' },
      { lignes: [[1, 3, 20]], attendu: '20:300/60/360' },
      { lignes: [[1, 200, 20]], attendu: '20:20000/4000/24000' },
      { lignes: [[1, 300, 20]], attendu: '20:30000/6000/36000' },
      { lignes: [[1, 150, 20]], attendu: '20:15000/3000/18000' },
      { lignes: [[1, 400, 20]], attendu: '20:40000/8000/48000' },
      { lignes: [[1, 1000, 20], [1, 100, 5.5], [1, 50, 0]], attendu: '20:100000/20000/120000 5.5:10000/550/10550 0:5000/0/5000' },
      { lignes: [[-1, 1, 0]], avoir: true, attendu: '0:100/0/100' },
    ]
    for (const { lignes, avoir, attendu } of releve) {
      const m = montantsDuDocument({ type: avoir ? 'avoir' : 'facture' },
        lignes.map(([quantite, prix_unitaire_ht, taux_tva], ordre) => ({ ordre, designation: 'x', quantite, prix_unitaire_ht, taux_tva })), null)
      const rendu = m.groupes.map((g) => `${g.taux}:${g.baseCentimes}/${g.tvaCentimes}/${g.baseCentimes + g.tvaCentimes}`).join(' ')
      expect(rendu).toBe(attendu)
    }
  })
})

describe('ce que la migration écrit en dur', () => {
  const listeDe = (re: RegExp) => {
    const m = re.exec(MIGRATION)
    expect(m, String(re)).not.toBeNull()
    return (m as RegExpExecArray)[1]
  }

  it('les taux admis par la table et par la fonction sont ceux de l’application (règle G1.24)', () => {
    const nombres = (s: string) => s.split(',').map((x) => Number(x.trim()))
    expect(nombres(listeDe(/constraint encaissements_factures_taux_taux\s+check \(taux in \(([^)]*)\)\)/))).toEqual([...TAUX_ADMIS])
    expect(nombres(listeDe(/::numeric not in \(([^)]*)\)/))).toEqual([...TAUX_ADMIS])
  })

  it('les moyens de paiement de la table, de la fonction et du type sont les mêmes', () => {
    const moyens = (s: string) => [...s.matchAll(/'(\w+)'/g)].map((m) => m[1])
    // Exhaustif par construction : le compilateur refuse un moyen de trop ou de moins.
    const DU_TYPE: Record<MoyenEncaissement, true> = {
      virement: true, cheque: true, carte: true, prelevement: true, especes: true, effet: true, compensation: true, autre: true,
    }
    const table = moyens(listeDe(/constraint encaissements_factures_moyen\s+check \(moyen in \(([^)]*)\)\)/))
    const fonction = moyens(listeDe(/p_moyen not in \(([^)]*)\)/))
    expect(fonction).toEqual(table)
    expect(Object.keys(DU_TYPE).sort()).toEqual([...table].sort())
  })

  it('les colonnes des deux tables sont celles des types', () => {
    const colonnesDe = (table: string) => {
      const corps = listeDe(new RegExp(`create table public\\.${table} \\(\\n([\\s\\S]*?)\\n\\);`))
      return corps.split('\n')
        .map((l) => /^ {2}([a-z_]+) /.exec(l)?.[1])
        .filter((c): c is string => c != null && c !== 'constraint' && c !== 'primary')
        .sort()
    }
    // Exhaustifs par construction, comme plus haut : une colonne du type absente de la table, ou l'inverse, se voit.
    const ENCAISSEMENT: Record<keyof EncaissementFacture, true> = {
      id: true, dossier_id: true, facture_id: true, date_encaissement: true, montant: true, moyen: true,
      ligne_bancaire_id: true, annule_id: true, motif: true, cree_par: true, cree_le: true, retire_le: true, retire_par: true,
    }
    const PART: Record<keyof EncaissementFactureTaux, true> = { encaissement_id: true, dossier_id: true, taux: true, montant: true }
    expect(colonnesDe('encaissements_factures')).toEqual(Object.keys(ENCAISSEMENT).sort())
    expect(colonnesDe('encaissements_factures_taux')).toEqual(Object.keys(PART).sort())
  })
})
