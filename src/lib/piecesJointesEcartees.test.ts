import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { poids, TAILLE_MAX_PIECE } from './bornesStockage'
import {
  CE_QUE_FAIT_LA_MARQUE, ceQueLeCabinetPeutFaire, libelleDuGeste, phraseDeLaLigneVue, phraseDeLaRaison, quandRecue,
  rangerLesEcarts, REFUS_DE_MARQUER, refusDeMarquerVues, SANS_LISTE_EN_COURS, SANS_LISTE_PARTIELLE, titreDuSignalement,
} from './piecesJointesEcartees'
import type { PieceJointeEcartee } from './types'

// CE QUE L'ONGLET JUSTIFICATIFS DIT D'UNE PIÈCE JOINTE ÉCARTÉE (ligne 22.7) : combien, quand, pourquoi, ce que le cabinet
// peut faire — jamais un nom —, et les refus de `marquer_pieces_jointes_vues` redits avant le clic, sous les mots de la
// migration. Le module est confronté au TEXTE de la migration et à celui de receive-email, qui écrit la table : la clé
// d'idempotence, les raisons, les messages. Données FICTIVES.

// La migration se cherche dans l'export par son NOM, jamais par sa version : préparée, elle porte une version
// provisoire, que l'application lui remplace (comme `bornes_du_stockage`, src/test/bornesStockage.ts).
const SCHEMA = new URL('../../supabase/schema/', import.meta.url)
const NOMS_DE_LA_MIGRATION = readdirSync(SCHEMA).filter((nom) => /^\d{14}_pieces_jointes_ecartees\.sql$/.test(nom))
if (NOMS_DE_LA_MIGRATION.length !== 1) {
  throw new Error(`la migration pieces_jointes_ecartees doit être UNE dans l'export : ${NOMS_DE_LA_MIGRATION.length} trouvée(s)`)
}
const MIGRATION = readFileSync(new URL(NOMS_DE_LA_MIGRATION[0], SCHEMA), 'utf8')
const RECEIVE_EMAIL = readFileSync(new URL('../../supabase/functions/receive-email/index.ts', import.meta.url), 'utf8')

const D = 'd1'
const ecart = (o: Partial<PieceJointeEcartee> = {}): PieceJointeEcartee => ({
  id: 'x1', dossier_id: D, recue_le: '2026-10-12T12:03:00+00:00', raison: 'format', octets: 4120, empreinte: 'a'.repeat(64),
  vue_le: null, vue_par: null, ...o,
})
const lue = (lignes: PieceJointeEcartee[], complete = true) => ({ lignes, complete, motif: complete ? null : '1 ligne(s) lue(s) sur 2 annoncée(s)' })

// Un test de date choisit son fuseau (CLAUDE.md) : l'heure d'un instant est celle de qui regarde.
let fuseau: string | undefined
beforeEach(() => { fuseau = process.env.TZ; process.env.TZ = 'Europe/Paris' })
afterEach(() => { process.env.TZ = fuseau })

describe('pourquoi, quand, combien — sans nom', () => {
  it('le format, avec son poids ; la taille face à la borne de 20 Mo, à l’octet quand une décimale les confondrait', () => {
    expect(phraseDeLaRaison({ raison: 'format', octets: 4120 })).toBe('format non pris en charge (4\u00a0Ko)')
    expect(phraseDeLaRaison({ raison: 'format', octets: 830 })).toBe('format non pris en charge (830\u00a0octets)')
    expect(phraseDeLaRaison({ raison: 'taille', octets: 26_214_400 })).toBe('au-delà des 20\u00a0Mo qu’une pièce peut peser (25\u00a0Mo)')
    expect(phraseDeLaRaison({ raison: 'taille', octets: 27_000_000 })).toBe('au-delà des 20\u00a0Mo qu’une pièce peut peser (25,7\u00a0Mo)')
    // 20 Mio et un octet se liraient « 20 Mo » : tout se dit alors à l'octet (espace fine insécable entre les milliers).
    // Le poids et son unité se tiennent par une espace insécable (bornesStockage.ts : une coupure n'y passe pas).
    expect(phraseDeLaRaison({ raison: 'taille', octets: TAILLE_MAX_PIECE + 1 }))
      .toBe('au-delà des 20\u202f971\u202f520\u00a0octets qu’une pièce peut peser (20\u202f971\u202f521\u00a0octets)')
    expect(poids(TAILLE_MAX_PIECE)).toBe('20\u00a0Mo')
  })

  it('quand : le jour et l’heure de qui regarde ; une valeur illisible se rend telle quelle', () => {
    expect(quandRecue('2026-10-12T12:03:00+00:00')).toBe('le 12/10/2026 à 14 h 03')
    expect(quandRecue('2026-12-31T23:30:00+00:00')).toBe('le 01/01/2027 à 0 h 30')
    process.env.TZ = 'America/New_York'
    expect(quandRecue('2026-10-12T12:03:00+00:00')).toBe('le 12/10/2026 à 8 h 03')
    expect(quandRecue('pas une date')).toBe('pas une date')
  })

  it('combien, et ce que le cabinet peut faire : les formats, la borne, l’adresse de collecte ou « Mes pièces »', () => {
    expect(titreDuSignalement(1)).toBe('1 pièce jointe reçue par e-mail n’a pas été déposée')
    expect(titreDuSignalement(3)).toBe('3 pièces jointes reçues par e-mail n’ont pas été déposées')
    expect(ceQueLeCabinetPeutFaire(1)).toBe('Le client croit l’avoir envoyée : demande-lui de la renvoyer en PDF, JPEG, PNG ou CSV, et sous 20\u00a0Mo — à l’adresse de collecte du dossier ou dans « Mes pièces ».')
    expect(ceQueLeCabinetPeutFaire(2)).toMatch(/^Le client croit les avoir envoyées : demande-lui de les renvoyer en PDF, JPEG, PNG ou CSV, et sous 20\u00a0Mo chacune/)
    expect(libelleDuGeste(1)).toBe('Marquer comme vue')
    expect(libelleDuGeste(2)).toBe('Marquer comme vues')
    expect(CE_QUE_FAIT_LA_MARQUE).toMatch(/pour personne du cabinet/)
    expect(phraseDeLaLigneVue(ecart({ vue_le: '2026-10-13T07:00:00+00:00', vue_par: 'u1' })))
      .toBe('le 12/10/2026 à 14 h 03 — format non pris en charge (4\u00a0Ko) ; vue le 13/10/2026')
  })

  it('range : celles du dossier, non vues d’abord, chacune des plus récentes aux plus anciennes, l’identifiant départageant', () => {
    const lignes = [
      ecart({ id: 'b', recue_le: '2026-10-12T12:03:00+00:00' }),
      ecart({ id: 'a', recue_le: '2026-10-12T12:03:00+00:00' }),
      ecart({ id: 'recente', recue_le: '2026-10-13T06:00:00+00:00' }),
      ecart({ id: 'vue-ancienne', recue_le: '2026-09-01T08:00:00+00:00', vue_le: '2026-09-02T08:00:00+00:00', vue_par: 'u1' }),
      ecart({ id: 'vue-recente', recue_le: '2026-10-01T08:00:00+00:00', vue_le: '2026-10-02T08:00:00+00:00', vue_par: 'u1' }),
      ecart({ id: 'autre-dossier', dossier_id: 'd2', recue_le: '2026-10-13T09:00:00+00:00' }),
    ]
    const { aSignaler, dejaVues } = rangerLesEcarts(D, lignes)
    expect(aSignaler.map((e) => e.id)).toEqual(['recente', 'a', 'b'])
    expect(dejaVues.map((e) => e.id)).toEqual(['vue-recente', 'vue-ancienne'])
    // L'heure d'un instant compte, pas son libellé : la même minute écrite en deux fuseaux est une seule.
    const memes = rangerLesEcarts(D, [ecart({ id: 'z', recue_le: '2026-10-12T14:03:00+02:00' }), ecart({ id: 'y', recue_le: '2026-10-12T12:04:00+00:00' })])
    expect(memes.aSignaler.map((e) => e.id)).toEqual(['y', 'z'])
  })
})

describe('les refus de « Marquer comme vue », dits avant le clic', () => {
  it('rien ne se marque avant la lecture, ni sur une lecture partielle', () => {
    expect(refusDeMarquerVues({ dossierId: D, lecture: null, ids: ['x1'] })).toBe(SANS_LISTE_EN_COURS)
    expect(refusDeMarquerVues({ dossierId: D, lecture: lue([ecart()], false), ids: ['x1'] })).toBe(SANS_LISTE_PARTIELLE)
  })

  it('rang 2, aucune désignée ; rang 3, une pièce jointe d’un autre dossier ou inconnue ; sinon rien', () => {
    const lecture = lue([ecart(), ecart({ id: 'x2' }), ecart({ id: 'ailleurs', dossier_id: 'd2' })])
    expect(refusDeMarquerVues({ dossierId: D, lecture, ids: [] })).toBe(REFUS_DE_MARQUER.aucune)
    expect(refusDeMarquerVues({ dossierId: D, lecture, ids: ['x1', 'ailleurs'] })).toBe(REFUS_DE_MARQUER.autreDossier)
    expect(refusDeMarquerVues({ dossierId: D, lecture, ids: ['x1', 'inconnue'] })).toBe(REFUS_DE_MARQUER.autreDossier)
    expect(refusDeMarquerVues({ dossierId: D, lecture, ids: ['x1', 'x2'] })).toBeNull()
  })

  it('les mots sont ceux de la fonction de la migration, dans son ordre', () => {
    const corps = MIGRATION.slice(MIGRATION.indexOf('create function public.marquer_pieces_jointes_vues'))
    const enSql = (t: string) => `'${t.replace(/'/g, "''")}'`
    const positions = [REFUS_DE_MARQUER.acces, REFUS_DE_MARQUER.aucune, REFUS_DE_MARQUER.autreDossier].map((t) => corps.indexOf(enSql(t)))
    expect(positions[0]).toBeGreaterThan(0)
    expect(positions[1]).toBeGreaterThan(positions[0])
    expect(positions[2]).toBeGreaterThan(positions[1])
  })
})

describe('la table, la fonction qui l’écrit et l’écran disent la même chose', () => {
  it('la clé d’idempotence de la migration est celle que vise l’écriture de receive-email', () => {
    expect(MIGRATION).toMatch(/constraint pieces_jointes_ecartees_une_fois unique \(dossier_id, empreinte\)/)
    expect(RECEIVE_EMAIL).toContain('{ onConflict: "dossier_id,empreinte", ignoreDuplicates: true }')
    expect(RECEIVE_EMAIL).toContain('.from("pieces_jointes_ecartees")')
  })

  it('les deux raisons, et rien d’autre, des deux côtés', () => {
    expect(MIGRATION).toMatch(/check \(raison in \('format', 'taille'\)\)/)
    const raisons = [...RECEIVE_EMAIL.matchAll(/noterLaPieceJointeEcartee\(supabase, dossier\.id, email_id, fichier\.id, "(\w+)", bytes\.byteLength\)/g)].map((m) => m[1])
    expect(raisons).toEqual(['format', 'taille'])
    for (const r of raisons) expect(phraseDeLaRaison({ raison: r as PieceJointeEcartee['raison'], octets: TAILLE_MAX_PIECE + 1024 })).not.toBe('')
  })

  it('aucune colonne pour un nom, une extension, un expéditeur ou un objet', () => {
    const table = MIGRATION.slice(MIGRATION.indexOf('create table public.pieces_jointes_ecartees'), MIGRATION.indexOf('-- ══ La garde'))
    expect(table).not.toMatch(/\b(nom|fichier|filename|extension|expediteur|objet|subject|sujet)\b/)
    const colonnes = [...table.matchAll(/^ {2}([a-z_]+) (?:uuid|timestamptz|text|bigint)/gm)].map((m) => m[1])
    expect(colonnes).toEqual(['id', 'dossier_id', 'recue_le', 'raison', 'octets', 'empreinte', 'vue_le', 'vue_par'])
  })
})
