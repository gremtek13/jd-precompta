import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COLONNES_ENCAISSEMENTS_DE_LA_CAISSE, COLONNES_FACTURES_DE_LA_CAISSE, COLONNES_MOUVEMENTS_DE_LA_CAISSE, lireLaCaisseDuDossier,
  lireLaRepriseDeLaCaisse,
} from './caisseDuDossierLecture'
import type { LectureDeLaCaisse } from './caisseLecture'
import type { OperationCaisse } from './types'

// CE QUE L'ONGLET CAISSE LIT D'UN DOSSIER (ligne 26.6, étape C4 ; lib/caisseDuDossierLecture.ts). Ce que ces cas gardent : le
// drapeau baissé, AUCUN appel au réseau, une caisse absente ; levé, chaque collection EN ENTIER (la table, le filtre de SON
// dossier, le compte annoncé, un tri total), les factures et les encaissements d'un dossier basculé SEULEMENT, le tout ou rien
// (une collection manque, et la caisse n'est pas rejouée — son motif la nomme), une ligne d'un autre dossier refusée, un
// résultat qui porte l'identifiant du dossier lu, et qu'elle ne REJETTE jamais. Des jeux FICTIFS.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  // Les tables dont le serveur ignorerait le cadrage par dossier : de quoi lui faire rendre la ligne d'un autre.
  sansCadrage: [] as string[],
  leve: false,
  requetes: [] as { table: string; colonnes: string; filtres: [string, unknown][]; ordres: string[]; options: unknown }[],
  caisse: null as null | LectureDeLaCaisse,
}))

vi.mock('./caisseLecture', () => ({ lireLaCaisse: async () => faux.caisse }))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        const requete = { table, colonnes: '', filtres: [] as [string, unknown][], ordres: [] as string[], options: undefined as unknown }
        faux.requetes.push(requete)
        const predicats: ReturnType<typeof predicatEq>[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (colonnes: string, options: unknown) => { requete.colonnes = colonnes; requete.options = options; return c },
          eq: (colonne: string, valeur: unknown) => {
            requete.filtres.push([colonne, valeur])
            if (!(colonne === 'dossier_id' && faux.sansCadrage.includes(table))) predicats.push(predicatEq(colonne, valeur))
            return c
          },
          not: (colonne: string, operateur: string, valeur: unknown) => { requete.filtres.push([`not ${colonne}`, valeur]); predicats.push(predicatNot(colonne, operateur, valeur)); return c },
          or: (expression: string) => { requete.filtres.push(['or', expression]); predicats.push(predicatOr(expression)); return c },
          order: (colonne: string) => { requete.ordres.push(colonne); return c },
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.leve) return Promise.reject(new Error('réseau coupé')).then(suite, echec)
            if (faux.refus[table]) return Promise.resolve({ data: null, error: { message: faux.refus[table] }, count: null }).then(suite, echec)
            const toutes = filtrer(faux.parTable[table] ?? [], predicats)
            return Promise.resolve({
              data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity)), error: null, count: toutes.length,
            }).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

const D = 'dossier-1'

function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}

const tables = () => faux.requetes.map((r) => r.table)

beforeEach(() => {
  faux.leve = false
  faux.muetApres = {}
  faux.refus = {}
  faux.sansCadrage = []
  faux.requetes = []
  faux.caisse = { dossierId: D, enBase: true, lignes: [operation({ id: 'o1' })], complete: true, motif: null }
  faux.parTable = {
    categories: [
      { id: 'k1', dossier_id: D, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' },
      { id: 'k2', dossier_id: null, code: 'divers', libelle: 'Divers', ordre: 2, compte_comptable: '708000', poste_2035: 'Recettes' },
      { id: 'k3', dossier_id: 'autre', code: 'autre', libelle: 'Autre dossier', ordre: 3, compte_comptable: '706100', poste_2035: 'Recettes' },
    ],
    a_nouveaux: [{ id: 'a1', dossier_id: D, date: '2026-01-01', compte: '530000', compte_origine: '530', libelle: 'Caisse', sens: 'debit', montant: 50, source_nom: 'b', source_empreinte: 'x', created_at: '2026-01-01T00:00:00Z' }],
    lignes_bancaires: [
      { id: 'm1', dossier_id: D, date: '2026-03-05', montant: 120, libelle: 'VERSEMENT ESPECES', compte_bilan: '530000', statut: 'rapprochee' },
      { id: 'm2', dossier_id: D, date: '2026-03-06', montant: -30, libelle: 'PRLV FICTIF', compte_bilan: null, statut: 'non_rapprochee' },
      { id: 'm3', dossier_id: 'autre', date: '2026-03-07', montant: 10, libelle: 'AUTRE', compte_bilan: '530000', statut: 'rapprochee' },
    ],
    factures_emises: [
      { id: 'f1', dossier_id: D, numero: 'F-2026-0012', source_de_la_vente: true, statut: 'validee' },
      { id: 'f2', dossier_id: D, numero: 'F-2026-0013', source_de_la_vente: false, statut: 'validee' },
    ],
    encaissements_factures: [
      { id: 'e1', dossier_id: D, facture_id: 'f1', date_encaissement: '2026-03-10', montant: 30, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null, motif: 'ne part pas' },
    ],
  }
})

describe('le drapeau baissé : la caisse absente, sans un appel au réseau', () => {
  it('rien n’est lu, et la caisse est dite absente — avec l’identifiant du dossier', async () => {
    faux.caisse = { dossierId: D, enBase: false, lignes: [], complete: false, motif: 'pas en base' }
    expect(await lireLaCaisseDuDossier(D, true)).toEqual({ dossierId: D, etat: 'absente' })
    expect(await lireLaRepriseDeLaCaisse(D, false)).toBeNull()
    expect(faux.requetes).toEqual([])
  })
})

describe('le drapeau levé : la caisse lue en entier', () => {
  it('rend ses opérations, la reprise, les mouvements classés, les catégories du dossier et communes — sous son dossier', async () => {
    const lecture = await lireLaCaisseDuDossier(D, false)
    expect(lecture.etat).toBe('lue')
    if (lecture.etat !== 'lue') return
    expect(lecture.dossierId).toBe(D)
    expect(lecture.donnees.operations.map((o) => o.id)).toEqual(['o1'])
    expect(lecture.donnees.ouvertures.map((a) => a.id)).toEqual(['a1'])
    // Les mouvements classés sur un compte de bilan seulement : le relevé libre n'a rien à faire dans la caisse.
    expect(lecture.donnees.mouvements).toEqual([{ id: 'm1', date: '2026-03-05', montant: 120, libelle: 'VERSEMENT ESPECES', compte_bilan: '530000' }])
    // Les catégories du dossier et celles du cabinet (`dossier_id` nul), pas celles d'un autre dossier.
    expect(lecture.donnees.categories.map((c) => c.id)).toEqual(['k1', 'k2'])
    expect(lecture.donnees.especes).toEqual({ etat: 'sans_objet' })
  })

  it('un dossier qui n’a pas basculé ne lit ni factures ni encaissements : aucune facture n’y est source', async () => {
    await lireLaCaisseDuDossier(D, false)
    expect(tables()).toEqual(['categories', 'a_nouveaux', 'lignes_bancaires'])
  })

  it('un dossier basculé lit ses factures SOURCES et le registre de leurs encaissements, réduits aux colonnes de la caisse', async () => {
    const lecture = await lireLaCaisseDuDossier(D, true)
    expect(tables()).toEqual(['categories', 'a_nouveaux', 'lignes_bancaires', 'factures_emises', 'encaissements_factures'])
    expect(lecture.etat).toBe('lue')
    if (lecture.etat !== 'lue') return
    expect(lecture.donnees.especes).toEqual({
      etat: 'lues',
      factures: [{ id: 'f1', numero: 'F-2026-0012', source_de_la_vente: true }],
      encaissements: [{ id: 'e1', facture_id: 'f1', date_encaissement: '2026-03-10', montant: 30, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null }],
    })
    const requete = (t: string) => faux.requetes.find((r) => r.table === t)!
    expect(requete('factures_emises').colonnes).toBe(COLONNES_FACTURES_DE_LA_CAISSE)
    expect(requete('encaissements_factures').colonnes).toBe(COLONNES_ENCAISSEMENTS_DE_LA_CAISSE)
    expect(requete('lignes_bancaires').colonnes).toBe(COLONNES_MOUVEMENTS_DE_LA_CAISSE)
    expect(requete('factures_emises').filtres).toContainEqual(['source_de_la_vente', true])
  })

  it('chaque lecture est cadrée sur SON dossier, compte exact annoncé, tri total terminé par la clé primaire', async () => {
    await lireLaCaisseDuDossier(D, true)
    for (const r of faux.requetes) {
      if (r.table !== 'categories') expect(r.filtres, r.table).toContainEqual(['dossier_id', D])
      expect(r.options, r.table).toEqual({ count: 'exact' })
      expect(r.ordres.at(-1), `${r.table} : l'identifiant ferme le tri`).toBe('id')
    }
    expect(faux.requetes.find((r) => r.table === 'categories')!.filtres).toContainEqual(['or', `dossier_id.eq.${D},dossier_id.is.null`])
  })
})

describe('le tout ou rien', () => {
  it('une caisse lue en partie : rien d’autre n’est lu, et le motif la nomme', async () => {
    faux.caisse = { dossierId: D, enBase: true, lignes: [], complete: false, motif: '500 lignes lues sur 900' }
    expect(await lireLaCaisseDuDossier(D, false)).toEqual({ dossierId: D, etat: 'incomplete', motif: 'les opérations de la caisse : 500 lignes lues sur 900' })
    expect(faux.requetes).toEqual([])
  })

  it('une caisse d’un autre dossier, ou une opération d’un autre dossier, est refusée', async () => {
    faux.caisse = { dossierId: 'autre', enBase: true, lignes: [], complete: true, motif: null }
    expect((await lireLaCaisseDuDossier(D, false)).etat).toBe('incomplete')
    faux.caisse = { dossierId: D, enBase: true, lignes: [operation({ id: 'o9', dossier_id: 'autre' })], complete: true, motif: null }
    const lecture = await lireLaCaisseDuDossier(D, false)
    expect(lecture).toMatchObject({ etat: 'incomplete', motif: 'les opérations de la caisse : une ligne rendue n’est pas de ce dossier' })
  })

  for (const [table, nom] of [
    ['categories', 'les catégories'], ['a_nouveaux', 'la reprise (à-nouveaux)'], ['lignes_bancaires', 'les mouvements classés sur un compte de bilan'],
    ['factures_emises', 'les factures sources'], ['encaissements_factures', 'les encaissements des factures'],
  ] as const) {
    it(`${nom} lues en partie : la caisse n’est pas rejouée, et le motif nomme la collection`, async () => {
      faux.muetApres = { [table]: 0 }
      const lecture = await lireLaCaisseDuDossier(D, true)
      expect(lecture.etat).toBe('incomplete')
      if (lecture.etat === 'incomplete') expect(lecture.motif.startsWith(`${nom} : `), lecture.motif).toBe(true)
    })

    it(`${nom} refusées : de même, avec le refus du serveur`, async () => {
      faux.refus = { [table]: 'permission denied' }
      const lecture = await lireLaCaisseDuDossier(D, true)
      expect(lecture.etat).toBe('incomplete')
      if (lecture.etat === 'incomplete') expect(lecture.motif).toContain(nom)
    })
  }

  for (const [table, nom] of [
    ['a_nouveaux', 'la reprise (à-nouveaux)'], ['lignes_bancaires', 'les mouvements classés sur un compte de bilan'],
    ['factures_emises', 'les factures sources'], ['encaissements_factures', 'les encaissements des factures'],
  ] as const) {
    it(`${nom} : la ligne d’un autre dossier que le serveur rendrait est refusée, jamais mêlée à la caisse`, async () => {
      faux.sansCadrage = [table]
      faux.parTable[table] = [...faux.parTable[table], { ...faux.parTable[table][0], id: 'etrangere', dossier_id: 'autre', compte_bilan: '530000', source_de_la_vente: true }]
      const lecture = await lireLaCaisseDuDossier(D, true)
      expect(lecture).toEqual({ dossierId: D, etat: 'incomplete', motif: `${nom} : une ligne rendue n'est pas de ce dossier` })
    })
  }

  it('la reprise lue pour Banque refuse de même la ligne d’un autre dossier', async () => {
    faux.sansCadrage = ['a_nouveaux']
    faux.parTable.a_nouveaux = [...faux.parTable.a_nouveaux, { ...faux.parTable.a_nouveaux[0], id: 'etrangere', dossier_id: 'autre' }]
    expect(await lireLaRepriseDeLaCaisse(D, true)).toMatchObject({ complete: false, motif: 'une ligne rendue n’est pas de ce dossier' })
  })

  it('ne rejette jamais : un réseau coupé tombe du côté signalé, avec le message', async () => {
    faux.leve = true
    const lecture = await lireLaCaisseDuDossier(D, false)
    expect(lecture).toMatchObject({ dossierId: D, etat: 'incomplete' })
    if (lecture.etat === 'incomplete') expect(lecture.motif).toContain('réseau coupé')
  })
})

describe('la reprise pour l’onglet Banque', () => {
  it('la caisse en base : les à-nouveaux du dossier, lus en entier, avec son identifiant', async () => {
    const reprise = await lireLaRepriseDeLaCaisse(D, true)
    expect(reprise).toMatchObject({ dossierId: D, complete: true, motif: null })
    expect(reprise!.lignes.map((a) => a.id)).toEqual(['a1'])
    expect(faux.requetes.map((r) => r.table)).toEqual(['a_nouveaux'])
  })

  it('lue en partie, refusée ou rompue : incomplète, jamais une liste vide qui laisserait croire à une caisse sans ouverture', async () => {
    faux.muetApres = { a_nouveaux: 0 }
    expect(await lireLaRepriseDeLaCaisse(D, true)).toMatchObject({ dossierId: D, lignes: [], complete: false })
    faux.muetApres = {}
    faux.leve = true
    const rompue = await lireLaRepriseDeLaCaisse(D, true)
    expect(rompue).toMatchObject({ dossierId: D, lignes: [], complete: false })
    expect(rompue!.motif).toContain('réseau coupé')
  })
})
