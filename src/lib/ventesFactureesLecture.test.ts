import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LigneDeFacture } from './encaissementsFactures'
import { ventesFacturees, type EncaissementVendu, type FactureVendue, type PartVendue } from './ventesFacturees'
import { lectureDuDossier, lireLesVentesFacturees, type LectureVentesFacturees } from './ventesFactureesLecture'

// LA LECTURE DES VENTES FACTURÉES (lib/ventesFactureesLecture.ts, chantier EC-Q3, étape VF3a) : quatre collections, chacune
// EN ENTIER — ou rien ne se calcule, et l'état dit pourquoi ; la pagination d'un serveur qui rend moins qu'on ne demande ;
// une ligne d'un autre dossier ; un dossier changé en cours de route. Le faux client APPLIQUE les filtres
// (src/test/filtresPostgrest.ts), la jointure de `facture_lignes` comprise, ne rend que les colonnes demandées, et peut
// plafonner chaque réponse comme PostgREST. Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Le plafond du serveur : au plus tant de lignes par réponse, quelle que soit la tranche demandée.
  plafond: Infinity,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  refus: {} as Record<string, string>,
  // Une table qui ignore le filtre du dossier (une fuite que la lecture doit voir).
  fuite: {} as Record<string, boolean>,
  // Un constructeur qui lève.
  leve: false,
  // Les réponses retenues jusqu'à ce que leur dossier soit relâché.
  retenus: {} as Record<string, Promise<void>>,
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
        let dossier: unknown = null
        const q: Record<string, unknown> = {
          select: (liste: string, options: { count?: string }) => {
            if (options?.count !== 'exact') throw new Error('une lecture de collection annonce son compte')
            // Les colonnes du premier niveau : la jointure `factures_emises!inner(…)` est rendue à part.
            colonnes = liste.replace(/[a-z_]+!inner\([^)]*\)/g, '').split(',').map((x) => x.trim()).filter(Boolean)
            faux.demandes.push(`${table}: ${liste}`)
            return q
          },
          eq: (c: string, v: unknown) => {
            if (c === 'dossier_id' || c === 'factures_emises.dossier_id') dossier = v
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
            await (faux.retenus[String(dossier)] ?? Promise.resolve())
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

const facture = (o: Partial<FactureVendue> = {}): FactureVendue => ({
  id: 'f1', dossier_id: 'd1', statut: 'validee', type: 'facture', numero: 'F2027-0001', date_emission: '2027-01-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, ...o,
})
const ligne = (o: Partial<LigneDeFacture & { id: string }> = {}) => ({
  id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o,
})
const encaissement = (o: Partial<EncaissementVendu> = {}): EncaissementVendu => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-02-01', montant: 40, moyen: 'virement',
  ligne_bancaire_id: null, annule_id: null, cree_le: '2027-02-01T10:00:00Z', retire_le: null, ...o,
})
const part = (o: Partial<PartVendue> = {}): PartVendue => ({ encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 40, ...o })

// Le jeu de d1 : une facture source, encaissée en trois fois ; et autour, ce qui ne doit pas entrer.
const ENCAISSEMENTS = ['e1', 'e2', 'e3'].map((id, i) => encaissement({ id, date_encaissement: `2027-02-0${i + 1}`, cree_le: `2027-02-0${i + 1}T10:00:00Z` }))
const PARTS = ENCAISSEMENTS.map((e) => part({ encaissement_id: e.id }))

beforeEach(() => {
  faux.plafond = Infinity
  faux.muetApres = {}
  faux.refus = {}
  faux.fuite = {}
  faux.leve = false
  faux.retenus = {}
  faux.demandes = []
  faux.tranches = 0
  faux.tables = {
    factures_emises: [
      facture(),
      facture({ id: 'f-hier', numero: 'F2026-0100', source_de_la_vente: false }),
      facture({ id: 'f-brouillon', statut: 'brouillon', numero: null, source_de_la_vente: false }),
      facture({ id: 'f-d2', dossier_id: 'd2', numero: 'F2027-0900' }),
    ],
    facture_lignes: [
      ligne(),
      ligne({ id: 'l-hier', facture_id: 'f-hier' }),
      ligne({ id: 'l-brouillon', facture_id: 'f-brouillon' }),
      ligne({ id: 'l-d2', facture_id: 'f-d2', prix_unitaire_ht: 50 }),
    ],
    encaissements_factures: [
      ...ENCAISSEMENTS,
      encaissement({ id: 'e-hier', facture_id: 'f-hier' }),
      encaissement({ id: 'e-d2', dossier_id: 'd2', facture_id: 'f-d2', montant: 60 }),
    ],
    encaissements_factures_taux: [
      ...PARTS,
      part({ encaissement_id: 'e-hier' }),
      part({ encaissement_id: 'e-d2', dossier_id: 'd2', montant: 60 }),
    ],
  }
})

const lue = (l: LectureVentesFacturees) => {
  if (l.etat !== 'lue') throw new Error(`lecture incomplète : ${l.motif}`)
  return l.ventes
}

describe('lireLesVentesFacturees', () => {
  it('lit les quatre collections du dossier, réduites à leurs colonnes, et calcule sur elles seules', async () => {
    const l = await lireLesVentesFacturees('d1')
    expect(l.dossierId).toBe('d1')
    const v = lue(l)
    expect(v).toEqual(ventesFacturees({
      dossierId: 'd1', factures: [facture()],
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
      encaissements: ENCAISSEMENTS, parts: PARTS,
    }))
    expect([...v.sources]).toEqual(['f1'])
    expect(v.parts.map((p) => [p.encaissementId, p.tvaCentimes])).toEqual([['e1', 667], ['e2', 666], ['e3', 667]])
    expect(faux.demandes).toEqual([
      'factures_emises: id, dossier_id, statut, type, numero, date_emission, tiers_nom, facture_origine_id, source_de_la_vente, nature_operation, option_debits, date_prestation',
      'facture_lignes: id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva, factures_emises!inner(dossier_id, source_de_la_vente)',
      'encaissements_factures: id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, cree_le, retire_le',
      'encaissements_factures_taux: encaissement_id, dossier_id, taux, montant',
    ])
  })

  it('pagine : un serveur qui rend une ligne par réponse rend le même calcul, en plus de tranches', async () => {
    const entiere = lue(await lireLesVentesFacturees('d1'))
    const tranchesEntieres = faux.tranches
    faux.tranches = 0
    faux.plafond = 1
    expect(lue(await lireLesVentesFacturees('d1'))).toEqual(entiere)
    expect(faux.tranches).toBeGreaterThan(tranchesEntieres)
  })

  it('une lecture partielle, de n’importe laquelle des quatre, et RIEN ne se calcule : l’état dit laquelle', async () => {
    const noms: Record<string, string> = {
      factures_emises: 'les factures sources', facture_lignes: 'leurs lignes',
      encaissements_factures: 'les encaissements', encaissements_factures_taux: 'leurs parts par taux',
    }
    for (const [table, nom] of Object.entries(noms)) {
      faux.muetApres = { [table]: 0 }
      const l = await lireLesVentesFacturees('d1')
      expect(l, table).toEqual({ dossierId: 'd1', etat: 'incomplete', motif: expect.stringContaining(nom) })
      expect(l.etat === 'incomplete' && l.motif, table).toMatch(/0 ligne\(s\) lue\(s\) sur \d annoncée\(s\)/)
    }
    // Les encaissements lus à moitié : le calcul d'une facture « à moitié payée » n'a jamais lieu.
    faux.muetApres = { encaissements_factures: 2 }
    expect((await lireLesVentesFacturees('d1')).etat).toBe('incomplete')
  })

  it('une lecture refusée, de n’importe laquelle des quatre, rend l’état incomplet avec le refus', async () => {
    for (const table of ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']) {
      faux.refus = { [table]: 'permission refusée' }
      const l = await lireLesVentesFacturees('d1')
      expect(l.etat, table).toBe('incomplete')
      expect(l.etat === 'incomplete' && l.motif, table).toContain('permission refusée')
    }
  })

  it('une ligne d’un autre dossier, rendue par une lecture qui fuit, rend l’état incomplet — jamais un calcul', async () => {
    for (const table of ['factures_emises', 'facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']) {
      faux.fuite = { [table]: true }
      const l = await lireLesVentesFacturees('d1')
      expect(l, table).toEqual({ dossierId: 'd1', etat: 'incomplete', motif: expect.stringContaining("n'est pas de ce dossier") })
    }
  })

  it('un client qui lève ne fait pas rejeter la lecture : l’état le dit', async () => {
    faux.leve = true
    await expect(lireLesVentesFacturees('d1')).resolves.toEqual({ dossierId: 'd1', etat: 'incomplete', motif: 'client indisponible' })
  })

  it('un autre dossier lit ses ventes à lui', async () => {
    const v = lue(await lireLesVentesFacturees('d2'))
    expect(v.dossierId).toBe('d2')
    expect(v.parts.map((p) => [p.factureId, p.ttcCentimes])).toEqual([['f-d2', 6000]])
  })
})

describe('lectureDuDossier — un dossier changé en cours de route', () => {
  it('la réponse tardive d’un dossier quitté ne vaut jamais pour le dossier ouvert', async () => {
    let relacherD1!: () => void
    faux.retenus = { d1: new Promise<void>((r) => { relacherD1 = r }) }
    // Ce qu'un écran retiendrait : la DERNIÈRE réponse arrivée.
    let derniere: LectureVentesFacturees | null = null
    const enD1 = lireLesVentesFacturees('d1').then((l) => { derniere = l; return l })
    // Le cabinet ouvre d2 avant que d1 ne réponde.
    const reponseD2 = await lireLesVentesFacturees('d2').then((l) => { derniere = l; return l })
    expect(lectureDuDossier(derniere, 'd2')).toBe(reponseD2)
    // d1 répond enfin, après d2 : elle est la dernière arrivée, et ne vaut pas pour d2.
    relacherD1()
    const reponseD1 = await enD1
    expect(derniere).toBe(reponseD1)
    expect(lectureDuDossier(derniere, 'd2')).toBeNull()
    expect(lectureDuDossier(reponseD2, 'd2')).toBe(reponseD2)
    expect(lectureDuDossier(reponseD1, 'd1')).toBe(reponseD1)
    expect(lue(reponseD1).dossierId).toBe('d1')
    expect(lue(reponseD2).dossierId).toBe('d2')
  })

  it('rien de revenu : en cours', () => {
    expect(lectureDuDossier(null, 'd1')).toBeNull()
  })
})
