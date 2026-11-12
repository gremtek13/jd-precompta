import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  banqueParCompte, COLONNES_DES_COMPTES_DU_CLIENT, correspondAuCompte, couvertureDUnCompte, filtreDeCompteValide, finDuNumero,
  ordreDesComptes, type ComptesDuClient, type CompteDuClient,
} from './banqueClientParCompte'
import { COLONNES_DU_MOUVEMENT, COLONNES_DU_MOUVEMENT_PAR_COMPTE, couvertureDuReleve, soldeAuReleve } from './banqueClient'
import type { LectureComplete } from './lectureComplete'

// « MA BANQUE » POUR PLUSIEURS COMPTES BANCAIRES (MCB7) : le partage de ce que le client « Banque » lit, compte par compte —
// le solde LU au dernier relevé contrôlé de chaque compte, les mois où un compte attend un relevé sans en porter (la règle
// de `couverture_du_releve`, par `compteAttenduLeMois`), le filtre des mouvements, et ce qui retient tout. Données FICTIVES.

const compte = (o: Partial<CompteDuClient>): CompteDuClient => ({
  id: 'P', libelle: 'Compte principal', principal: true, fin_d_identifiant: null, ouvert_le: null, clos_le: null, ...o,
})
const P = compte({})
const B = compte({ id: 'B', libelle: 'Livret pro', principal: false, fin_d_identifiant: '4821' })
const lus = (...comptes: CompteDuClient[]): ComptesDuClient => ({ etat: 'lus', comptes })
const entiere = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: true, motif: null })
const partielle = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: false, motif: '2 lignes sur 3' })
const mvt = (id: string, compte_bancaire_id: string | undefined, date: string) => ({ id, date, compte_bancaire_id })
const ctl = (id: string, compte_bancaire_id: string | undefined, solde_final: number, periode_fin: string) => ({
  id, compte_bancaire_id, solde_final, coherent: true, periode_fin, created_at: `${periode_fin}T08:00:00Z`,
})

describe('ce que l’écran demande d’un compte', () => {
  it('ni son compte du plan ni la date depuis laquelle il le tient, et des colonnes de la migration', () => {
    const colonnes = COLONNES_DES_COMPTES_DU_CLIENT.split(', ')
    expect(colonnes).toEqual(['id', 'libelle', 'principal', 'fin_d_identifiant', 'ouvert_le', 'clos_le'])
    expect(colonnes).not.toContain('compte')
    expect(colonnes).not.toContain('compte_propre_depuis')
    const dossier = new URL('../../supabase/schema/', import.meta.url)
    const table = readFileSync(new URL('20261112140805_comptes_bancaires.sql', dossier), 'utf8')
    const fin = readFileSync(new URL('20261112140819_fin_d_identifiant_des_comptes_bancaires.sql', dossier), 'utf8')
    for (const c of colonnes.filter((x) => x !== 'fin_d_identifiant')) expect(table).toMatch(new RegExp(`\\n  ${c} [a-z]`))
    expect(fin).toMatch(/add column fin_d_identifiant text/)
  })
  it('les colonnes d’un mouvement par compte : celles d’hier, et son compte bancaire seul en plus', () => {
    expect(COLONNES_DU_MOUVEMENT_PAR_COMPTE).toBe(`${COLONNES_DU_MOUVEMENT}, compte_bancaire_id`)
  })
  it('la fin du numéro se dit, rien de plus ; le principal d’abord, puis par nom', () => {
    expect(finDuNumero(B)).toBe('numéro se terminant par 4821')
    expect(finDuNumero(P)).toBeNull()
    const A = compte({ id: 'A', libelle: 'Autre compte', principal: false })
    expect(ordreDesComptes([B, A, P]).map((c) => c.id)).toEqual(['P', 'A', 'B'])
  })
})

describe('le partage des comptes', () => {
  const mouvements = entiere([mvt('m1', 'P', '2026-01-05'), mvt('m2', 'B', '2026-02-06')])
  const controles = entiere([ctl('k1', 'P', 1500, '2026-01-31'), ctl('k2', 'B', 9000, '2026-02-28')])
  it('drapeau baissé : l’écran d’hier', () => {
    expect(banqueParCompte({ etat: 'sans_objet' }, mouvements, controles)).toEqual({ etat: 'un' })
  })
  it('un seul compte : l’écran d’hier, son nom tu', () => {
    expect(banqueParCompte(lus(P), entiere([mvt('m1', 'P', '2026-01-05')]), entiere([ctl('k1', 'P', 1, '2026-01-31')]))).toEqual({ etat: 'un' })
    expect(banqueParCompte(lus(), entiere([]), entiere([]))).toEqual({ etat: 'un' })
  })
  it('les comptes illisibles, une ligne d’un compte non rendu ou sans compte : retenue', () => {
    expect(banqueParCompte({ etat: 'illisible', motif: 'x' }, mouvements, controles).etat).toBe('retenue')
    expect(banqueParCompte(lus(P), mouvements, controles).etat).toBe('retenue')
    expect(banqueParCompte(lus(), mouvements, entiere([])).etat).toBe('retenue')
    expect(banqueParCompte(lus(P, B), entiere([mvt('m3', undefined, '2026-01-05')]), entiere([])).etat).toBe('retenue')
    expect(banqueParCompte(lus(P, B), entiere([]), entiere([ctl('k3', 'Z', 1, '2026-01-31')])).etat).toBe('retenue')
  })
  it('dès deux : le solde LU de chaque compte, au dernier relevé contrôlé de CE compte', () => {
    const r = banqueParCompte(lus(B, P), mouvements, controles)
    if (r.etat !== 'comptes') throw new Error(r.etat)
    expect(r.comptes.map((e) => [e.compte.id, e.solde])).toEqual([
      ['P', { etat: 'lu', solde: 1500, au: '2026-01-31' }],
      ['B', { etat: 'lu', solde: 9000, au: '2026-02-28' }],
    ])
    // Le solde du dossier, d'hier, aurait dit celui du livret seul : le relevé le plus récent, tous comptes mêlés.
    expect(soldeAuReleve(controles)).toEqual({ etat: 'lu', solde: 9000, au: '2026-02-28' })
  })
  it('un compte sans relevé contrôlé le dit ; des relevés lus en partie taisent chaque solde', () => {
    const r = banqueParCompte(lus(P, B), mouvements, entiere([ctl('k1', 'P', 1500, '2026-01-31')]))
    if (r.etat !== 'comptes') throw new Error(r.etat)
    expect(r.comptes[1].solde).toEqual({ etat: 'aucun_releve' })
    const p = banqueParCompte(lus(P, B), mouvements, partielle([ctl('k1', 'P', 1500, '2026-01-31')]))
    if (p.etat !== 'comptes') throw new Error(p.etat)
    expect(p.comptes.map((e) => e.solde.etat)).toEqual(['muet', 'muet'])
  })
  it('des mouvements lus en partie taisent les mois de chaque compte', () => {
    const r = banqueParCompte(lus(P, B), partielle(mouvements.lignes), controles)
    if (r.etat !== 'comptes') throw new Error(r.etat)
    expect(r.comptes.map((e) => e.couverture)).toEqual([{ etat: 'muet' }, { etat: 'muet' }])
  })
})

describe('les mois d’un compte (la règle de couverture_du_releve)', () => {
  const dossier = [1, 2, 3, 4].map((m) => mvt(`p${m}`, 'P', `2026-0${m}-05`)).concat([mvt('b2', 'B', '2026-02-06'), mvt('b4', 'B', '2026-04-06')])
  const duCompte = (id: string) => dossier.filter((l) => l.compte_bancaire_id === id)
  it('le trou d’un compte n’est pas couvert par l’autre', () => {
    expect(couvertureDUnCompte(P, duCompte('P'), dossier).moisSansMouvement).toEqual([])
    expect(couvertureDUnCompte(B, duCompte('B'), dossier)).toEqual({
      etat: 'lue', premierMouvement: '2026-02-06', dernierMouvement: '2026-04-06', moisSansMouvement: ['2026-03'],
    })
    // Hier, tous comptes mêlés : aucun mois sans mouvement.
    expect(couvertureDuReleve(entiere(dossier))).toMatchObject({ moisSansMouvement: [] })
  })
  it('un autre compte attend depuis son ouverture ; le principal sans date, depuis le premier mois du dossier', () => {
    expect(couvertureDUnCompte({ ...B, ouvert_le: '2026-01-10' }, duCompte('B'), dossier).moisSansMouvement).toEqual(['2026-01', '2026-03'])
    const sansP2 = dossier.filter((l) => l.id !== 'p1')
    expect(couvertureDUnCompte(P, sansP2.filter((l) => l.compte_bancaire_id === 'P'), [...sansP2, mvt('b1', 'B', '2026-01-07')]).moisSansMouvement)
      .toEqual(['2026-01'])
  })
  it('jusqu’à sa clôture ; un compte sans date ni mouvement n’attend rien', () => {
    const clos = { ...B, clos_le: '2026-02-20' }
    expect(couvertureDUnCompte(clos, duCompte('B').slice(0, 1), dossier).moisSansMouvement).toEqual([])
    expect(couvertureDUnCompte(B, [], dossier)).toEqual({ etat: 'lue', premierMouvement: null, dernierMouvement: null, moisSansMouvement: [] })
  })
  it('le dernier mois du dossier compte aussi : le relevé d’un compte qui n’est pas encore arrivé', () => {
    const r = couvertureDUnCompte(B, duCompte('B').slice(0, 1), dossier)
    expect(r.moisSansMouvement).toEqual(['2026-03', '2026-04'])
  })
  it('un relevé du dossier vide : aucun mois', () => {
    expect(couvertureDUnCompte(P, [], []).moisSansMouvement).toEqual([])
  })
  it('à cheval sur deux années', () => {
    const lignes = [mvt('a', 'P', '2025-11-03'), mvt('b', 'P', '2026-02-03')]
    expect(couvertureDUnCompte(P, lignes, lignes).moisSansMouvement).toEqual(['2025-12', '2026-01'])
  })
})

describe('le filtre par compte', () => {
  const banque = banqueParCompte(lus(P, B), entiere([mvt('m1', 'P', '2026-01-05')]), entiere([]))
  it('un compte que la lecture rend, sinon tous', () => {
    expect(filtreDeCompteValide('B', banque)).toBe('B')
    expect(filtreDeCompteValide('Z', banque)).toBe('tous')
    expect(filtreDeCompteValide('B', { etat: 'un' })).toBe('tous')
  })
  it('un mouvement passe le filtre de son compte', () => {
    expect(correspondAuCompte({ compte_bancaire_id: 'B' }, 'B')).toBe(true)
    expect(correspondAuCompte({ compte_bancaire_id: 'P' }, 'B')).toBe(false)
    expect(correspondAuCompte({ compte_bancaire_id: 'P' }, 'tous')).toBe(true)
  })
})
