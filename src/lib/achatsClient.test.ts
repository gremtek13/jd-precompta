import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACHATS_DU_CLIENT_PREVUS, echeanceLueSurLaFacture, etatDeLEcheance, MAX_PIECES_VUES_PAR_APPEL, MOYENS_DECLARES,
  REFUS_DES_ACHATS, refusDeLaDeclaration, refusDeLEcheance, TABLES_DES_ACHATS_DU_CLIENT,
} from './achatsClient'

// LES ACHATS DU CLIENT (étape B4) : le module redit ce que la migration préparée refuse, sous les mêmes mots, et l'essai le
// joue. Les mots se cherchent dans le texte SQL (l'apostrophe doublée), jamais l'inverse : une phrase du module qui ne
// serait plus celle de la base se verrait ici.

const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_achats_du_client\.sql$/.test(n))!, 'utf8')
const RETOUR = readFileSync(dossier + 'retour/' + readdirSync(dossier + 'retour').find((n) => /^\d{14}_retour_achats_du_client\.sql$/.test(n))!, 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/achatsClient.sql', import.meta.url), 'utf8')
const enSql = (texte: string) => texte.replace(/'/g, "''")

describe('le module et la migration', () => {
  it('chaque refus est dans la migration, mot pour mot, et l’essai le joue', () => {
    for (const [cle, mots] of Object.entries(REFUS_DES_ACHATS)) {
      expect(MIGRATION, cle).toContain(`'${enSql(mots)}'`)
      expect(ESSAI, cle).toContain(`'${enSql(mots)}'`)
    }
  })

  it('les moyens sont la liste de la contrainte, et le plafond des vues celui de marquer_vues', () => {
    const liste = /constraint paiements_declares_moyen check \(moyen in \(([^)]*)\)\)/i.exec(MIGRATION)![1]
    expect(liste.split(',').map((m) => m.trim().replace(/'/g, ''))).toEqual([...MOYENS_DECLARES])
    expect(MIGRATION).toContain(`coalesce(cardinality(p_pieces), 0) > ${MAX_PIECES_VUES_PAR_APPEL}`)
  })

  it('les tables sont celles que la migration crée, et que son retour retire', () => {
    expect([...MIGRATION.matchAll(/^create table public\.([a-z_]+)/gim)].map((m) => m[1])).toEqual([...TABLES_DES_ACHATS_DU_CLIENT])
    for (const table of TABLES_DES_ACHATS_DU_CLIENT) expect(RETOUR).toContain(`drop table public.${table};`)
  })

  it('le drapeau est baissé tant que la migration n’est que préparée', () => {
    expect(ACHATS_DU_CLIENT_PREVUS).toBe(false)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b/i)
    expect(MIGRATION).not.toMatch(/\r|\\/)
  })
})

describe('refusDeLaDeclaration', () => {
  const ok = { date: '2026-11-01', moyen: 'virement', montant: 120.5 }
  it('une saisie juste passe, 0,10 € compris', () => {
    expect(refusDeLaDeclaration(ok, '2026-11-11')).toBeNull()
    expect(refusDeLaDeclaration({ ...ok, montant: 0.1 }, '2026-11-11')).toBeNull()
    expect(refusDeLaDeclaration({ ...ok, date: '2026-11-11' }, '2026-11-11')).toBeNull()
  })
  it('la date d’abord : absente, impossible, d’avant 2000, à venir au jour de Paris', () => {
    for (const date of [null, '2026-02-30', '1999-12-31', '2026-11-12', '01/11/2026']) {
      expect(refusDeLaDeclaration({ date, moyen: 'bitcoin', montant: 0 }, '2026-11-11'), String(date)).toBe(REFUS_DES_ACHATS.datePaiement)
    }
  })
  it('puis le moyen, puis le montant — jamais arrondi', () => {
    expect(refusDeLaDeclaration({ ...ok, moyen: 'bon d’achat', montant: 0 }, '2026-11-11')).toBe(REFUS_DES_ACHATS.moyenPaiement)
    expect(refusDeLaDeclaration({ ...ok, moyen: null }, '2026-11-11')).toBe(REFUS_DES_ACHATS.moyenPaiement)
    for (const montant of [0, -1, 10.005, Number.NaN, Infinity, 1e13, 1e-7, null]) {
      expect(refusDeLaDeclaration({ ...ok, montant }, '2026-11-11'), String(montant)).toBe(REFUS_DES_ACHATS.montantPaiement)
    }
  })
})

describe('refusDeLEcheance et l’échéance lue sur la facture', () => {
  const deposee = { type_piece: 'achat', source: 'upload', date_echeance: null, echeance_fixee_par: null }
  const recue = { type_piece: 'achat', source: 'plateforme', date_echeance: '2026-12-31', echeance_fixee_par: null }
  it('dans l’ordre de la fonction : la nature, les bornes, la version lue, l’échéance lue par la facture', () => {
    expect(refusDeLEcheance({ ...deposee, type_piece: 'vente' }, '1999-01-01', 'x', false)).toBe(REFUS_DES_ACHATS.echeanceHorsAchat)
    expect(refusDeLEcheance(deposee, '1999-12-31', 'x', false)).toBe(REFUS_DES_ACHATS.echeanceHorsBornes)
    expect(refusDeLEcheance(deposee, '2026-12-15', '2026-12-01', false)).toBe(REFUS_DES_ACHATS.echeanceChangee)
    expect(refusDeLEcheance(recue, '2027-01-31', '2026-12-31', false)).toBe(REFUS_DES_ACHATS.echeanceLue)
    expect(refusDeLEcheance(recue, '2027-01-31', '2026-12-31', true)).toBeNull()
    expect(refusDeLEcheance(deposee, null, null, false)).toBeNull()
  })
  it('lue sur la facture : non nulle, venue d’une facture électronique, sans auteur', () => {
    expect(echeanceLueSurLaFacture(recue)).toBe(true)
    expect(echeanceLueSurLaFacture({ ...recue, source: 'superpdp' })).toBe(true)
    expect(echeanceLueSurLaFacture({ ...recue, echeance_fixee_par: 'u' })).toBe(false)
    expect(echeanceLueSurLaFacture({ ...recue, source: 'upload' })).toBe(false)
    expect(echeanceLueSurLaFacture({ ...recue, date_echeance: null })).toBe(false)
  })
})

describe('etatDeLEcheance', () => {
  it('au jour de Paris donné ; une valeur illisible est « sans », jamais « à venir »', () => {
    expect(etatDeLEcheance(null, '2026-11-11')).toBe('sans')
    expect(etatDeLEcheance('2026-02-30', '2026-11-11')).toBe('sans')
    expect(etatDeLEcheance('2026-11-10', '2026-11-11')).toBe('en_retard')
    expect(etatDeLEcheance('2026-11-11', '2026-11-11')).toBe('aujourd_hui')
    expect(etatDeLEcheance('2026-11-12', '2026-11-11')).toBe('a_venir')
  })
})
