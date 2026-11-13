import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Predicat } from '../test/filtresPostgrest'

// LA LECTURE ET LE RETRAIT DE LA FICHE DES COMPTES BANCAIRES (ligne 26.6, MCB6, MCB6-Q1 et MCB6-Q2). Le drapeau
// `COMPTES_BANCAIRES_PREVUS` joué dans ses deux états par un accesseur ; le faux client APPLIQUE `.eq`, `.not(…, 'is', null)`
// et la tranche, annonce un compte, et rend les erreurs qu'on lui donne. Ce que la carte reçoit : les comptes et ce que la
// base porte sous chacun, lus en entier, sinon illisibles ; les exercices validés à part, illisibles sans retenir le reste ;
// un retrait qui dit ce que la base n'a pas rendu. Données FICTIVES.

const etat = vi.hoisted(() => ({ prevue: true }))
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Le compte annoncé d'une table, plus grand que ce qu'elle rend : une lecture partielle.
  annonces: {} as Record<string, number>,
  erreurs: {} as Record<string, { message: string; code?: string }>,
  rendRien: false,
  appels: [] as string[],
  suppressions: [] as { table: string; filtres: string[] }[],
}))

vi.mock('./comptesBancaires', async (original) => {
  const reel = await original<typeof import('./comptesBancaires')>()
  return { ...reel, get COMPTES_BANCAIRES_PREVUS() { return etat.prevue } }
})

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatNot } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        faux.appels.push(table)
        const predicats: Predicat[] = []
        const filtres: string[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let suppression = false
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          delete: () => { suppression = true; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); filtres.push(`${colonne}=${String(valeur)}`); return c },
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => {
            if (suppression) faux.suppressions.push({ table, filtres })
            const erreur = faux.erreurs[table]
            if (erreur) return Promise.resolve({ data: null, error: erreur })
            const lignes = filtrer(faux.tables[table] ?? [], predicats)
            return Promise.resolve({ data: faux.rendRien ? null : lignes[0] ?? null, error: null })
          },
          then: (suite: (r: unknown) => unknown, rejet?: (e: unknown) => unknown) => {
            const erreur = faux.erreurs[table]
            if (erreur) return Promise.resolve({ data: null, error: erreur, count: null }).then(suite, rejet)
            const lignes = filtrer(faux.tables[table] ?? [], predicats)
            return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: faux.annonces[table] ?? lignes.length }).then(suite, rejet)
          },
        })
        return c
      },
    },
  }
})

import { lireLaFiche, retirerLeCompte } from './ficheDesComptesBancairesLecture'

const compte = (id: string, dossier: string, principal: boolean) => ({
  id, dossier_id: dossier, libelle: principal ? 'Compte principal' : `Compte ${id}`, principal, fin_d_identifiant: null,
  compte: principal ? null : '512100', compte_propre_depuis: principal ? null : '2026-01-01', ouvert_le: null, clos_le: null,
})

beforeEach(() => {
  etat.prevue = true
  faux.tables = {
    comptes_bancaires: [compte('cb-p', 'd1', true), compte('cb-2', 'd1', false), compte('cb-x', 'd2', true)],
    lignes_bancaires: [
      { id: 'l1', dossier_id: 'd1', compte_bancaire_id: 'cb-p', date: '2026-01-05' },
      { id: 'l2', dossier_id: 'd2', compte_bancaire_id: 'cb-2', date: '2026-01-06' },
    ],
    controles_releves_bancaires: [{ id: 'r1', dossier_id: 'd1', compte_bancaire_id: 'cb-p' }],
    ecritures_brouillon: [
      { id: 'e1', dossier_id: 'd1', ouverture_compte_bancaire_id: 'cb-2' },
      { id: 'e2', dossier_id: 'd1', ouverture_compte_bancaire_id: null },
      { id: 'e3', dossier_id: 'd2', ouverture_compte_bancaire_id: 'cb-2' },
    ],
    exercices_valides: [{ dossier_id: 'd1', annee: 2025 }, { dossier_id: 'd2', annee: 2026 }],
  }
  faux.annonces = {}
  faux.erreurs = {}
  faux.rendRien = false
  faux.appels = []
  faux.suppressions = []
})

describe('lireLaFiche', () => {
  it('drapeau baissé : illisible, et rien ne se lit (l’état d’avant)', async () => {
    etat.prevue = false
    expect((await lireLaFiche('d1')).etat).toBe('illisible')
    expect(faux.appels).toEqual([])
  })

  it('levé : les comptes du dossier, ce que la base porte sous chacun — l’ouverture éclatée comprise — et les exercices validés', async () => {
    const lu = await lireLaFiche('d1')
    if (lu.etat !== 'lue') throw new Error(lu.motif)
    expect(lu.comptes.map((c) => c.id)).toEqual(['cb-p', 'cb-2'])
    expect(lu.usages.get('cb-p')).toMatchObject({ mouvements: 1, releves: 1, ouvertures: 0 })
    // Une seule ligne d'ouverture du dossier cite cb-2 : celle de l'autre dossier et la ligne sans source ne comptent pas.
    expect(lu.usages.get('cb-2')).toMatchObject({ mouvements: 0, releves: 0, ouvertures: 1 })
    expect(lu.exercices).toEqual({ etat: 'lus', annees: [2025] })
  })

  it('les exercices validés lus en partie ou refusés : la fiche reste lue, eux seuls illisibles', async () => {
    faux.annonces.exercices_valides = 9
    const partielle = await lireLaFiche('d1')
    expect(partielle.etat === 'lue' && partielle.exercices.etat).toBe('illisibles')
    faux.annonces = {}
    faux.erreurs.exercices_valides = { message: 'permission denied for table exercices_valides' }
    const refusee = await lireLaFiche('d1')
    expect(refusee.etat === 'lue' && refusee.exercices).toEqual({ etat: 'illisibles', motif: expect.stringMatching(/permission denied/) })
  })

  it('les écritures d’ouverture éclatée lues en partie : toute la fiche est illisible, aucun geste', async () => {
    faux.annonces.ecritures_brouillon = 5
    const lu = await lireLaFiche('d1')
    expect(lu.etat === 'illisible' && lu.motif).toMatch(/^les écritures d’ouverture éclatée/)
  })
})

describe('retirerLeCompte', () => {
  it('retire par son identifiant ET son dossier, et ne dit fait que ce que la base a rendu', async () => {
    expect(await retirerLeCompte('d1', 'cb-2')).toEqual({ ok: true })
    expect(faux.suppressions).toEqual([{ table: 'comptes_bancaires', filtres: ['id=cb-2', 'dossier_id=d1'] }])
    // Un compte d'un autre dossier : rien de rendu, rien d'annoncé.
    expect(await retirerLeCompte('d1', 'cb-x')).toEqual({ ok: false, message: 'la base n’a rendu aucun compte retiré' })
    faux.rendRien = true
    expect((await retirerLeCompte('d1', 'cb-2')).ok).toBe(false)
  })

  it('le refus de la base se dit à ses mots', async () => {
    faux.erreurs.comptes_bancaires = { code: '23503', message: 'Le compte bancaire « Compte cb-2 » porte des mouvements ou des relevés : il ne se retire pas.' }
    const issue = await retirerLeCompte('d1', 'cb-2')
    expect(issue.ok === false && issue.message).toMatch(/porte des mouvements ou des relevés : il ne se retire pas/)
  })
})
