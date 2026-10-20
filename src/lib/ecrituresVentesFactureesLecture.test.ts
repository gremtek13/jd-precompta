import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EncaissementDesEcritures, FactureDesEcritures, MouvementDesEcritures } from './ecrituresVentesFactureesEcran'
import { lireLesSourcesDesEcrituresDeVente, type LectureSourcesDesEcrituresDeVente } from './ecrituresVentesFactureesLecture'
import type { LigneDeFacture } from './encaissementsFactures'
import type { PartVendue } from './ventesFacturees'

// LA LECTURE DES VENTES FACTURÉES QUE L'ONGLET ÉCRITURES ÉCRIT (lib/ecrituresVentesFactureesLecture.ts, chantier EC-Q3,
// étape VF4c1) : cinq collections, chacune EN ENTIER — ou rien ne se décide, et l'état dit pourquoi ; la pagination d'un
// serveur qui rend moins qu'on ne demande ; une ligne d'un autre dossier. Le faux client est celui du test de
// lib/ventesFactureesLecture.ts : il APPLIQUE les filtres (src/test/filtresPostgrest.ts), la jointure de `facture_lignes`
// comprise, ne rend que les colonnes demandées, et peut plafonner chaque réponse. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  plafond: Infinity,
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  fuite: {} as Record<string, boolean>,
  leve: false,
  demandes: [] as string[],
  tranches: 0,
}))

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  return {
    supabase: {
      from: (table: string) => {
        if (faux.leve) throw new Error('client indisponible')
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let colonnes: string[] = []
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (options?.count !== 'exact') throw new Error('une lecture de collection annonce son compte')
            colonnes = liste.replace(/[a-z_]+!inner\([^)]*\)/g, '').split(',').map((x) => x.trim()).filter(Boolean)
            faux.demandes.push(`${table}: ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => {
            if (faux.fuite[table] && (c === 'dossier_id' || c === 'factures_emises.dossier_id')) return q
            if (c.startsWith('factures_emises.')) {
              const champ = c.slice('factures_emises.'.length)
              predicats.push((l) => faux.tables.factures_emises.find((f) => f.id === l.facture_id)?.[champ] === v)
            } else {
              predicats.push(predicatEq(c, v))
            }
            return q
          },
          order: () => q,
          range: async (debut: number, fin: number) => {
            faux.tranches++
            if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes
              .slice(debut, Math.min(fin + 1, debut + faux.plafond, faux.muetApres[table] ?? Infinity))
              .map((l) => {
                const projetee: Record<string, unknown> = Object.fromEntries(colonnes.map((k) => [k, l[k]]))
                if (table === 'facture_lignes') {
                  const f = faux.tables.factures_emises.find((x) => x.id === l.facture_id)
                  projetee.factures_emises = f ? { dossier_id: f.dossier_id, source_de_la_vente: f.source_de_la_vente } : null
                }
                return projetee
              })
            return { data: rendu, error: null, count: toutes.length }
          },
        }
        return q
      },
    },
  }
})

const facture = (o: Partial<FactureDesEcritures> = {}): FactureDesEcritures => ({
  id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2027-0001', date_emission: '2027-01-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, montant_ttc: 120, ...o,
})
const ligne = (o: Partial<LigneDeFacture & { id: string }> = {}) => ({
  id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o,
})
const encaissement = (o: Partial<EncaissementDesEcritures> = {}): EncaissementDesEcritures => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-02-01', montant: 120, moyen: 'compensation',
  ligne_bancaire_id: null, annule_id: null, cree_le: '2027-02-01T10:00:00Z', retire_le: null, compte_contrepartie: '467100', ...o,
})
const part = (o: Partial<PartVendue> = {}): PartVendue => ({ encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 120, ...o })
const mouvement = (o: Partial<MouvementDesEcritures> = {}): MouvementDesEcritures => ({
  id: 'm1', dossier_id: 'd1', date: '2027-02-03', montant: 120, libelle: 'VIR FICTIF', source_fichier: 'releve.csv',
  encaissements_de_factures: false, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null,
  emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false,
  prelevement_personnel: false, ...o,
})

const TABLES = ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux', 'lignes_bancaires'] as const

beforeEach(() => {
  faux.plafond = Infinity
  faux.muetApres = {}
  faux.refus = {}
  faux.fuite = {}
  faux.leve = false
  faux.demandes = []
  faux.tranches = 0
  faux.tables = {
    factures_emises: [
      facture(),
      // Une facture d'avant la bascule, et un brouillon : lus aussi — les refus les disent « non source », « introuvable ».
      facture({ id: 'f-hier', numero: 'F2026-0100', source_de_la_vente: false }),
      facture({ id: 'f-brouillon', statut: 'brouillon', numero: null, source_de_la_vente: false }),
      facture({ id: 'f-d2', dossier_id: 'd2', numero: 'F2027-0900' }),
    ],
    facture_lignes: [ligne(), ligne({ id: 'l-hier', facture_id: 'f-hier' }), ligne({ id: 'l-d2', facture_id: 'f-d2' })],
    encaissements_factures: [
      encaissement(),
      encaissement({ id: 'e2', moyen: 'virement', ligne_bancaire_id: 'm1', compte_contrepartie: null, retire_le: '2027-02-04T10:00:00Z' }),
      encaissement({ id: 'e-d2', dossier_id: 'd2', facture_id: 'f-d2' }),
    ],
    encaissements_factures_taux: [part(), part({ encaissement_id: 'e2' }), part({ encaissement_id: 'e-d2', dossier_id: 'd2' })],
    lignes_bancaires: [mouvement(), mouvement({ id: 'm2', date: '2027-03-01', montant: -40 }), mouvement({ id: 'm-d2', dossier_id: 'd2' })],
  }
})

const lue = (l: LectureSourcesDesEcrituresDeVente) => {
  if (l.etat !== 'lue') throw new Error(`lecture incomplète : ${l.motif}`)
  return l.sources
}

describe('lireLesSourcesDesEcrituresDeVente', () => {
  it('lit les cinq collections du dossier, réduites à leurs colonnes : toutes ses factures, tout son registre, tout son relevé', async () => {
    const s = lue(await lireLesSourcesDesEcrituresDeVente('d1'))
    expect(s.dossierId).toBe('d1')
    expect(s.factures.map((f) => f.id)).toEqual(['f1', 'f-hier', 'f-brouillon'])
    expect(s.factures[0]).toEqual(facture())
    // Les lignes des seules factures sources.
    expect(s.lignes).toEqual([{ facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }])
    // Le registre entier, retirés compris, avec le compte de contrepartie.
    expect(s.encaissements.map((e) => [e.id, e.compte_contrepartie, e.retire_le])).toEqual([
      ['e1', '467100', null], ['e2', null, '2027-02-04T10:00:00Z'],
    ])
    expect(s.parts.map((p) => p.encaissement_id)).toEqual(['e1', 'e2'])
    // Tous les mouvements du dossier, avec ce qui les classe.
    expect(s.mouvements).toEqual([mouvement(), mouvement({ id: 'm2', date: '2027-03-01', montant: -40 })])
    expect(faux.demandes).toEqual([
      'factures_emises: id, dossier_id, statut, type, numero, date_emission, tiers_nom, facture_origine_id, source_de_la_vente, nature_operation, option_debits, date_prestation, montant_ttc',
      'facture_lignes: id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id, source_de_la_vente)',
      'encaissements_factures: id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, cree_le, retire_le, compte_contrepartie',
      'encaissements_factures_taux: encaissement_id, dossier_id, taux, montant',
      'lignes_bancaires: id, dossier_id, date, montant, libelle, source_fichier, encaissements_de_factures, statut, piece_id, cotisation_id, categorie_id, emprunt_id, compte_bilan, declaration_tva_id, ventilee, reglement_groupe, prelevement_personnel',
    ])
  })

  it('pagine : un serveur qui rend une ligne par réponse rend les mêmes lignes, en plus de tranches', async () => {
    const entiere = lue(await lireLesSourcesDesEcrituresDeVente('d1'))
    const tranchesEntieres = faux.tranches
    faux.tranches = 0
    faux.plafond = 1
    expect(lue(await lireLesSourcesDesEcrituresDeVente('d1'))).toEqual(entiere)
    expect(faux.tranches).toBeGreaterThan(tranchesEntieres)
  })

  it('une lecture partielle, de n’importe laquelle des cinq, et RIEN ne se rend : l’état dit laquelle', async () => {
    const noms: Record<(typeof TABLES)[number], string> = {
      factures_emises: 'les factures du dossier', facture_lignes: 'les lignes des factures sources',
      encaissements_factures: 'les encaissements', encaissements_factures_taux: 'leurs parts par taux',
      lignes_bancaires: 'les mouvements du relevé',
    }
    for (const table of TABLES) {
      faux.muetApres = { [table]: 0 }
      const l = await lireLesSourcesDesEcrituresDeVente('d1')
      expect(l, table).toEqual({ dossierId: 'd1', etat: 'incomplete', motif: expect.stringContaining(noms[table]) })
      expect(l.etat === 'incomplete' && l.motif, table).toMatch(/0 ligne\(s\) lue\(s\) sur \d annoncée\(s\)/)
    }
  })

  it('une lecture refusée, de n’importe laquelle des cinq, rend l’état incomplet avec le refus', async () => {
    for (const table of TABLES) {
      faux.refus = { [table]: 'permission refusée' }
      const l = await lireLesSourcesDesEcrituresDeVente('d1')
      expect(l.etat, table).toBe('incomplete')
      expect(l.etat === 'incomplete' && l.motif, table).toContain('permission refusée')
    }
  })

  it('une ligne d’un autre dossier, rendue par une lecture qui fuit, rend l’état incomplet', async () => {
    for (const table of TABLES) {
      faux.fuite = { [table]: true }
      const l = await lireLesSourcesDesEcrituresDeVente('d1')
      expect(l, table).toEqual({ dossierId: 'd1', etat: 'incomplete', motif: expect.stringContaining("n'est pas de ce dossier") })
    }
  })

  it('un client qui lève ne fait pas rejeter la lecture : l’état le dit', async () => {
    faux.leve = true
    await expect(lireLesSourcesDesEcrituresDeVente('d1')).resolves.toEqual({ dossierId: 'd1', etat: 'incomplete', motif: 'client indisponible' })
  })

  it('un autre dossier lit ses lignes à lui', async () => {
    const s = lue(await lireLesSourcesDesEcrituresDeVente('d2'))
    expect(s.factures.map((f) => f.id)).toEqual(['f-d2'])
    expect(s.encaissements.map((e) => e.id)).toEqual(['e-d2'])
    expect(s.mouvements.map((m) => m.id)).toEqual(['m-d2'])
  })
})
