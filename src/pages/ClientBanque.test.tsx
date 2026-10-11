import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientBanque from './ClientBanque'
import { motsDuCabinet } from '../lib/espaceVentes'
import type { MouvementDuClient, PieceDuClient } from '../lib/banqueClient'
import type { ControleReleveBancaire, JustificatifPropose, PrecisionMouvement, ReglementGroupe } from '../lib/types'

// « MA BANQUE » (espace client, étape P9) : l'écran du client qui porte la case « Banque ». Ce que ces cas gardent :
//  1. « Chargement… » d'abord, rien d'offert ; la case « Banque » relue à la BASE : absente ou illisible, rien n'est montré ;
//  2. le relevé lu en entier : les mouvements de la période, l'état de chacun, le résumé, le solde LU, les mois couverts,
//     la recherche commune et ses « N sur M » ;
//  3. chaque lecture partielle, table par table, et ce qu'elle tait ;
//  4. les refus dits avant le clic (pièce déjà envoyée, précision vide ou trop longue) ;
//  5. les trois gestes par les trois fonctions seules — et le dépôt suivi de la proposition —, sous UN verrou relâché après
//     la relecture : deux puis trois clics dans le même `act`, aucun autre geste pendant l'écriture ;
//  6. le garde des mots du client (`motsDuCabinet`) sur tout ce qui s'affiche.
// Le faux client APPLIQUE les filtres (src/test/filtresPostgrest.ts). Données FICTIVES.

const MOI = 'u-client'

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Une table dont la lecture s'arrête après N lignes, son compte annoncé entier : une lecture partielle.
  muetApres: {} as Record<string, number>,
  droits: { cabinet: false, membre: true, ventes: false, banque: true } as unknown,
  refusDroits: null as string | null,
  retenirLectures: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
  refusRpc: null as string | null,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  lectures: [] as string[],
  ecritures: [] as string[],
  dossierActifId: 'd1' as string | null,
  depot: null as unknown,
  depots: [] as string[],
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ dossierActifId: faux.dossierActifId, session: { user: { id: 'u-client' }, access_token: 'jeton-fictif' } }),
}))

vi.mock('../lib/depot', () => ({
  deposerFichier: async (_dossierId: string, fichier: File) => { faux.depots.push(fichier.name); return faux.depot },
}))

vi.mock('../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../test/filtresPostgrest')
  const attendreLecture = () => (faux.retenirLectures ? new Promise<void>((r) => { faux.lecturesEnAttente.push(r) }) : Promise.resolve())
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (nom === 'droits_sur_le_dossier') {
          return attendreLecture().then(() => (faux.refusDroits
            ? { data: null, error: { message: faux.refusDroits } }
            : { data: faux.droits, error: null }))
        }
        faux.rpcs.push({ nom, args })
        const repondre = () => (faux.refusRpc ? { data: null, error: { message: faux.refusRpc, code: '22023' } } : { data: { id: 'neuf' }, error: null })
        if (faux.retenirRpc) return new Promise((r) => { faux.rpcEnAttente.push(() => r(repondre())) })
        return Promise.resolve(repondre())
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue : ${table}`)
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let colonnes: string[] | null = null
        const c: Record<string, unknown> = {}
        const ecrire = (op: string) => () => { faux.ecritures.push(`${table} ${op}`); return c }
        Object.assign(c, {
          select: (liste?: string) => { colonnes = !liste || liste === '*' ? null : liste.split(',').map((x) => x.trim()); return c },
          eq: (col: string, v: unknown) => { predicats.push(predicatEq(col, v)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          insert: ecrire('insert'), update: ecrire('update'), delete: ecrire('delete'), upsert: ecrire('upsert'),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => attendreLecture().then(() => {
            faux.lectures.push(table)
            const toutes = filtrer(faux.tables[table], predicats)
            const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
              .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
            return { data: rendu, error: null, count: toutes.length }
          }).then(suite, echec),
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ─────────────────────────────────────────────────────────────────────────────────────────────────
const mouvement = (o: Partial<MouvementDuClient>): MouvementDuClient => ({
  id: 'l0', dossier_id: 'd1', date: '2026-09-15', libelle: 'PRLV FICTIF', montant: -10, statut: 'non_rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
  declaration_tva_id: null, prelevement_personnel: false, created_at: '2026-09-20T08:00:00Z', ...o,
})
const piece = (o: Partial<PieceDuClient>): PieceDuClient => ({ id: 'p0', dossier_id: 'd1', nom_fichier: 'piece.pdf', created_at: '2026-09-01T08:00:00Z', ...o })
const proposition = (o: Partial<JustificatifPropose>): JustificatifPropose => ({
  id: 'j0', dossier_id: 'd1', ligne_bancaire_id: 'l2', piece_id: 'p1', auteur_id: MOI, origine: 'client',
  created_at: '2026-09-11T08:00:00Z', retire_le: null, retire_par: null, ...o,
})
const precision = (o: Partial<PrecisionMouvement>): PrecisionMouvement => ({
  id: 'q0', dossier_id: 'd1', ligne_bancaire_id: 'l6', auteur_id: 'u-cabinet', origine: 'cabinet', texte: 'Quel est ce prélèvement ?',
  created_at: '2026-07-10T08:00:00Z', ...o,
})
const part = (o: Partial<ReglementGroupe>): ReglementGroupe => ({
  id: 'r0', dossier_id: 'd1', ligne_bancaire_id: 'l8', piece_id: 'p1', montant: 100, created_at: '2026-09-21T08:00:00Z', ...o,
})
const controle = (o: Partial<ControleReleveBancaire>): ControleReleveBancaire => ({
  id: 'c0', dossier_id: 'd1', source_fichier: null, solde_initial: 0, solde_final: 5432.1, somme_mouvements: 5432.1, ecart: 0,
  coherent: true, periode_debut: '2026-08-01', periode_fin: '2026-08-31', created_at: '2026-09-02T08:00:00Z', ...o,
})
const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))

function poser() {
  faux.tables = {
    lignes_bancaires: nues([
      mouvement({ id: 'l1', date: '2026-09-15', libelle: 'PRLV FICTIF TELECOM', montant: -39.99 }),
      mouvement({ id: 'l2', date: '2026-09-10', libelle: 'CB FICTIVE PAPETERIE', montant: -27.35 }),
      mouvement({ id: 'l3', date: '2026-08-20', libelle: 'VIR FICTIF ASSURANCE MALADIE', montant: 1850.4, statut: 'rapprochee', categorie_id: 'c9' }),
      mouvement({ id: 'l4', date: '2026-08-06', libelle: 'PRLV FICTIF ENERGIE', montant: -84.2, statut: 'rapprochee', piece_id: 'p3' }),
      mouvement({ id: 'l5', date: '2026-07-25', libelle: 'VIR FICTIF COMPTE PERSO', montant: -1200, statut: 'ignoree', prelevement_personnel: true }),
      mouvement({ id: 'l6', date: '2026-07-02', libelle: 'FRAIS FICTIFS', montant: -8.5 }),
      mouvement({ id: 'l7', date: '2025-12-30', libelle: 'PRLV FICTIF ANCIEN', montant: -10, statut: 'ignoree' }),
      mouvement({ id: 'l8', date: '2026-09-20', libelle: 'VIR FICTIF GROUPE', montant: -372, statut: 'rapprochee', reglement_groupe: true }),
      mouvement({ id: 'lx', dossier_id: 'd2', date: '2026-09-30', libelle: 'AUTRE SOCIETE FICTIVE', montant: -1 }),
    ]),
    justificatifs_proposes: nues([
      proposition({ id: 'j1' }),
      proposition({ id: 'j2', piece_id: 'p2', auteur_id: 'u-cabinet', origine: 'cabinet', created_at: '2026-09-12T08:00:00Z' }),
      proposition({ id: 'j0', ligne_bancaire_id: 'l1', piece_id: 'p2', retire_le: '2026-09-16T08:00:00Z', retire_par: MOI }),
    ]),
    precisions_mouvements: nues([precision({ id: 'q1' })]),
    reglements_groupes: nues([part({ id: 'r1' }), part({ id: 'r2', piece_id: 'p2' })]),
    pieces: nues([
      piece({ id: 'p1', nom_fichier: 'facture-papeterie.pdf' }),
      piece({ id: 'p2', nom_fichier: 'facture-materiel.pdf' }),
      piece({ id: 'p3', nom_fichier: 'facture-energie.pdf' }),
      piece({ id: 'p9', dossier_id: 'd2', nom_fichier: 'autre-societe.pdf' }),
    ]),
    controles_releves_bancaires: nues([
      controle({ id: 'c1' }),
      controle({ id: 'c2', periode_fin: '2026-09-30', solde_final: 9999, coherent: false }),
    ]),
  }
}

beforeEach(() => {
  poser()
  Object.assign(faux, {
    muetApres: {}, droits: { cabinet: false, membre: true, ventes: false, banque: true }, refusDroits: null,
    retenirLectures: false, lecturesEnAttente: [], retenirRpc: false, rpcEnAttente: [], refusRpc: null, rpcs: [],
    lectures: [], ecritures: [], dossierActifId: 'd1', depot: null, depots: [],
  })
})
afterEach(() => { expect(faux.ecritures, 'aucune écriture directe d’une table').toEqual([]) })

async function monter() {
  render(<MemoryRouter><ClientBanque /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Ma banque' })
  await act(async () => {})
}
const texte = () => (document.body.textContent ?? '').replace(/[  ]/g, ' ')
const ligne = (libelle: string) => screen.getByText(libelle).closest('tr') as HTMLElement
async function ouvrir(libelle: string) {
  await act(async () => { fireEvent.click(within(ligne(libelle)).getByRole('button', { name: 'Ouvrir' })) })
}
const boutons = (nom: string) => screen.queryAllByRole('button', { name: nom })
const libelles = () => [...document.querySelectorAll('tbody tr td[data-libelle="Libellé"]')].map((t) => t.textContent)

describe('avant la lecture, et la case « Banque » vue par la base', () => {
  it('« Chargement… », rien d’autre, tant que rien n’est revenu', async () => {
    faux.retenirLectures = true
    render(<MemoryRouter><ClientBanque /></MemoryRouter>)
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(document.querySelectorAll('table, button, select, textarea, input')).toHaveLength(0)
    expect(texte()).not.toMatch(/aucun|solde/i)
    await act(async () => { faux.lecturesEnAttente.splice(0).forEach((r) => r()) })
    await act(async () => {})
    expect(await screen.findByText('PRLV FICTIF TELECOM')).toBeTruthy()
  })

  it('sans la case, selon la base : rien n’est montré, et l’écran dit pourquoi', async () => {
    faux.droits = { cabinet: false, membre: true, ventes: true, banque: false }
    await monter()
    expect(screen.getByText(/Ton accès ne porte plus « Banque » sur cette société/)).toBeTruthy()
    expect(document.querySelectorAll('table, button, select')).toHaveLength(0)
    expect(texte()).not.toContain('PRLV FICTIF')
    expect(motsDuCabinet(texte())).toEqual([])
  })

  it('des droits illisibles ferment l’écran, avec le motif', async () => {
    faux.refusDroits = 'refus fictif'
    await monter()
    expect(screen.getByText(/Ta banque ne s’affiche pas : ton accès à ta banque n’a pas pu être vérifié \(refus fictif\)/)).toBeTruthy()
    expect(document.querySelectorAll('table, button')).toHaveLength(0)
  })

  it('sans société affichée : rien n’est demandé', async () => {
    faux.dossierActifId = null
    render(<MemoryRouter><ClientBanque /></MemoryRouter>)
    await act(async () => {})
    expect(screen.getByText(/Aucune société ne t’est encore rattachée/)).toBeTruthy()
    expect(faux.lectures).toEqual([])
  })
})

describe('le relevé lu en entier', () => {
  it('les mouvements de l’année la plus récente, l’état de chacun, le solde LU et les mois couverts', async () => {
    await monter()
    // Les lectures du dossier affiché, et elles seules.
    expect(new Set(faux.lectures)).toEqual(new Set(['lignes_bancaires', 'justificatifs_proposes', 'precisions_mouvements',
      'reglements_groupes', 'pieces', 'controles_releves_bancaires']))
    expect(libelles()).toEqual(['PRLV FICTIF TELECOM', 'CB FICTIVE PAPETERIE', 'VIR FICTIF ASSURANCE MALADIE',
      'PRLV FICTIF ENERGIE', 'VIR FICTIF COMPTE PERSO', 'FRAIS FICTIFS', 'VIR FICTIF GROUPE'])
    const etat = (libelle: string) => within(ligne(libelle)).getByText((_, e) => e?.matches('td[data-libelle="État"]') ?? false).textContent
    expect(etat('PRLV FICTIF TELECOM')).toBe('Sans justificatif')
    expect(etat('CB FICTIVE PAPETERIE')).toBe('Justificatif envoyé')
    expect(etat('VIR FICTIF ASSURANCE MALADIE')).toBe('Justifié par le relevé')
    expect(etat('PRLV FICTIF ENERGIE')).toBe('Justifié par une pièce')
    expect(etat('VIR FICTIF COMPTE PERSO')).toBe('Justifié par le relevé')
    expect(etat('FRAIS FICTIFS')).toBe('Demandé par ton cabinet')
    expect(texte()).toContain('Sur 2026, 2 mouvement(s) sans justificatif, dont 1 demandé(s) par ton cabinet. 1 justificatif(s) envoyé(s) attendent ton cabinet.')
    // Le solde du dernier relevé COHÉRENT, jamais celui d'un relevé incohérent plus récent, jamais une somme.
    expect(texte()).toContain('Solde au relevé du 31/08/2026 : 5 432,10 €')
    expect(texte()).not.toContain('9 999')
    expect(texte()).toContain('Ton relevé va de décembre 2025 à septembre 2026, dernier mouvement le 20/09/2026.')
    expect(texte()).toContain('Mois sans aucun mouvement dans ton relevé : janvier 2026, février 2026')
    // Le montant d'un mouvement, en euros, sans jamais la catégorie.
    expect(within(ligne('PRLV FICTIF TELECOM')).getByText((_, e) => e?.matches('td[data-libelle="Montant"]') ?? false).textContent?.replace(/[  ]/g, ' ')).toBe('-39,99 €')
    expect(texte()).not.toMatch(/catégorie|c9|compte 6/i)
    expect(motsDuCabinet(texte())).toEqual([])
  })

  it('la période, l’état et la recherche : « N sur M » après les filtres, avant la recherche', async () => {
    await monter()
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: 'toutes' } })
    expect(libelles()).toContain('PRLV FICTIF ANCIEN')
    expect(texte()).toContain('Sur tout ton relevé, 2 mouvement(s)')
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '2025' } })
    expect(libelles()).toEqual(['PRLV FICTIF ANCIEN'])
    expect(texte()).toContain('Sur 2025, aucun mouvement n’attend de pièce de ta part.')
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Afficher'), { target: { value: 'attend' } })
    expect(libelles()).toEqual(['PRLV FICTIF TELECOM', 'FRAIS FICTIFS'])
    fireEvent.change(screen.getByLabelText('Rechercher un mouvement…'), { target: { value: 'telecom' } })
    expect(libelles()).toEqual(['PRLV FICTIF TELECOM'])
    expect(screen.getByText('1 sur 2')).toBeTruthy()
    // La recherche ne change pas le résumé : il compte la période.
    expect(texte()).toContain('Sur 2026, 2 mouvement(s) sans justificatif')
    fireEvent.change(screen.getByLabelText('Rechercher un mouvement…'), { target: { value: 'introuvable' } })
    expect(texte()).toContain('Aucun mouvement ne correspond à « introuvable ».')
  })

  it('le détail d’un mouvement : ses pièces, ses envois, son fil — et pas de bouton pour retirer l’envoi d’un autre', async () => {
    await monter()
    await ouvrir('VIR FICTIF GROUPE')
    expect(texte()).toContain('Pièce(s) : facture-papeterie.pdf, facture-materiel.pdf.')
    await ouvrir('CB FICTIVE PAPETERIE')
    expect(texte()).toContain('facture-papeterie.pdf — Toi, le 11/09/2026')
    expect(texte()).toContain('facture-materiel.pdf — Ton cabinet, le 12/09/2026')
    expect(boutons('Retirer')).toHaveLength(1)
    await ouvrir('FRAIS FICTIFS')
    expect(texte()).toContain('Ton cabinet, le 10/07/2026 : Quel est ce prélèvement ?')
    expect(motsDuCabinet(texte())).toEqual([])
    // Le garde des mots n'est pas aveugle sur ce texte : une phrase du cabinet plantée y serait vue.
    expect(motsDuCabinet(`${texte()} Vérifiez la pièce.`).length).toBeGreaterThan(0)
  })

  it('un mouvement classé ou écarté n’offre pas d’envoyer une pièce ; il garde son fil', async () => {
    await monter()
    await ouvrir('PRLV FICTIF ENERGIE')
    expect(screen.queryByText('Envoyer une pièce pour ce mouvement')).toBeNull()
    expect(screen.getByLabelText('Ta précision')).toBeTruthy()
  })
})

describe('les lectures partielles, table par table', () => {
  it('les mouvements : ni tableau, ni résumé, ni couverture — le bandeau le dit', async () => {
    faux.muetApres = { lignes_bancaires: 2 }
    await monter()
    expect(document.querySelector('table')).toBeNull()
    expect(texte()).toContain("Tes mouvements n'ont pas pu être affichés en entier.")
    expect(texte()).not.toMatch(/Ton relevé va de|Sur 2026/)
    // Le solde, lu au relevé contrôlé, ne dépend pas des mouvements.
    expect(texte()).toContain('Solde au relevé du 31/08/2026')
  })

  it.each(['justificatifs_proposes', 'precisions_mouvements'])('%s : ni état, ni geste, ni résumé', async (table) => {
    faux.muetApres = { [table]: 0 }
    await monter()
    expect(texte()).toContain("Tes justificatifs envoyés et tes précisions n'ont pas pu être affichés en entier.")
    expect(texte()).not.toMatch(/Sans justificatif|Justificatif envoyé|Sur 2026/)
    expect((screen.getByLabelText('Afficher') as HTMLSelectElement).disabled).toBe(true)
    await ouvrir('PRLV FICTIF TELECOM')
    expect(texte()).toContain('L’état de ce mouvement ne s’affiche pas tant que tes envois n’ont pas été lus en entier.')
    expect(screen.queryByLabelText('Ta précision')).toBeNull()
    expect(screen.queryByText('Envoyer une pièce pour ce mouvement')).toBeNull()
  })

  it('les pièces : pas de choix d’une pièce déjà déposée, le dépôt reste offert', async () => {
    faux.muetApres = { pieces: 1 }
    await monter()
    expect(texte()).toContain("Tes pièces n'ont pas pu être affichées en entier.")
    await ouvrir('PRLV FICTIF TELECOM')
    expect(screen.queryByLabelText('Une pièce déjà déposée')).toBeNull()
    expect(texte()).toContain('Choisir une pièce déjà déposée ne t’est pas proposé')
    expect(screen.getByText('Déposer une nouvelle pièce')).toBeTruthy()
  })

  it('les parts des virements groupés : leurs pièces se taisent, l’état reste', async () => {
    faux.muetApres = { reglements_groupes: 1 }
    await monter()
    await ouvrir('VIR FICTIF GROUPE')
    expect(texte()).toContain('Justifié par une pièce. Ton cabinet a rapproché ce mouvement de sa pièce : il n’attend rien de toi. Les pièces de ce virement ne s’affichent pas.')
    expect(texte()).not.toContain('facture-papeterie.pdf, ')
  })

  it('les relevés contrôlés : le solde se tait', async () => {
    faux.muetApres = { controles_releves_bancaires: 1 }
    await monter()
    expect(texte()).toContain('Le solde ne s’affiche pas : tes relevés contrôlés n’ont pas pu être lus en entier.')
    expect(texte()).not.toContain('5 432,10')
  })
})

describe('les refus, dits avant le clic', () => {
  it('une pièce déjà envoyée pour ce mouvement ne se choisit pas ; une pièce d’une autre société n’est pas offerte', async () => {
    await monter()
    await ouvrir('CB FICTIVE PAPETERIE')
    const choix = screen.getByLabelText('Une pièce déjà déposée') as HTMLSelectElement
    const options = [...choix.options].map((o) => [o.value, o.disabled, o.textContent])
    expect(options.map((o) => o[0])).toEqual(['', 'p1', 'p2', 'p3'])
    expect(options.find((o) => o[0] === 'p1')?.[1]).toBe(true)
    expect(options.find((o) => o[0] === 'p1')?.[2]).toContain('(déjà envoyée pour ce mouvement)')
    expect(options.find((o) => o[0] === 'p3')?.[1]).toBe(false)
    const envoyer = screen.getByRole('button', { name: 'Envoyer cette pièce' }) as HTMLButtonElement
    expect(envoyer.disabled).toBe(true)
    fireEvent.change(choix, { target: { value: 'p1' } })
    expect(screen.getByText('Cette pièce est déjà proposée pour ce mouvement.')).toBeTruthy()
    expect(envoyer.disabled).toBe(true)
    fireEvent.click(envoyer)
    expect(faux.rpcs).toEqual([])
  })

  it('une précision vide ou faite de blancs ne part pas ; trop longue, elle le dit', async () => {
    await monter()
    await ouvrir('FRAIS FICTIFS')
    const envoyer = screen.getByRole('button', { name: 'Envoyer la précision' }) as HTMLButtonElement
    expect(envoyer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: ' \n\t ' } })
    expect(envoyer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: 'a'.repeat(2001) } })
    expect(screen.getByText('Une précision tient en 2 000 caractères au plus.')).toBeTruthy()
    expect(envoyer.disabled).toBe(true)
    // Une émoticône compte pour un caractère, comme en base.
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: '😀'.repeat(1500) } })
    expect(envoyer.disabled).toBe(false)
    expect(texte()).toContain('1500 / 2 000 caractères')
  })
})

describe('les gestes, par les trois fonctions et sous un verrou', () => {
  it('envoyer une pièce déjà déposée : proposer_justificatif, puis la relecture', async () => {
    await monter()
    await ouvrir('PRLV FICTIF TELECOM')
    fireEvent.change(screen.getByLabelText('Une pièce déjà déposée'), { target: { value: 'p3' } })
    faux.lectures = []
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer cette pièce' })) })
    expect(faux.rpcs).toEqual([{ nom: 'proposer_justificatif', args: { p_dossier_id: 'd1', p_ligne_bancaire_id: 'l1', p_piece_id: 'p3' } }])
    expect(faux.lectures).toContain('justificatifs_proposes')
    expect(screen.getByRole('status').textContent).toBe('Ta pièce est envoyée : ton cabinet la voit à côté de ce mouvement.')
  })

  it('deux, puis trois clics dans le même act : une seule proposition, et rien d’autre n’est offert pendant l’écriture', async () => {
    await monter()
    await ouvrir('PRLV FICTIF TELECOM')
    fireEvent.change(screen.getByLabelText('Une pièce déjà déposée'), { target: { value: 'p3' } })
    faux.retenirRpc = true
    const envoyer = screen.getByRole('button', { name: 'Envoyer cette pièce' })
    await act(async () => { fireEvent.click(envoyer); fireEvent.click(envoyer) })
    expect(faux.rpcs).toHaveLength(1)
    await act(async () => { fireEvent.click(envoyer); fireEvent.click(envoyer); fireEvent.click(envoyer) })
    expect(faux.rpcs).toHaveLength(1)
    // Pendant l'écriture, aucun geste : ni une précision, ni un dépôt.
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: 'Un abonnement.' } })
    expect((screen.getByRole('button', { name: 'Envoyer la précision' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).disabled).toBe(true)
    // Relâché après la relecture : le geste revient.
    faux.retenirRpc = false
    await act(async () => { faux.rpcEnAttente.splice(0).forEach((r) => r()) })
    await act(async () => {})
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('le verrou tient jusqu’à la FIN de la relecture', async () => {
    await monter()
    await ouvrir('FRAIS FICTIFS')
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: 'Des frais de tenue de compte.' } })
    faux.retenirLectures = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer la précision' })) })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['ecrire_precision_mouvement'])
    // La relecture est partie, et n'est pas revenue : le geste reste fermé, la saisie aussi.
    expect(faux.lecturesEnAttente.length).toBeGreaterThan(0)
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Envoyer la précision' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer la précision' })) })
    expect(faux.rpcs).toHaveLength(1)
    faux.retenirLectures = false
    await act(async () => { faux.lecturesEnAttente.splice(0).forEach((r) => r()) })
    await act(async () => {})
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).value).toBe('')
  })

  it('une précision part TELLE QUELLE, et la zone ne se vide que si elle est écrite', async () => {
    await monter()
    await ouvrir('FRAIS FICTIFS')
    const saisie = '  Frais de tenue\nde compte.  '
    fireEvent.change(screen.getByLabelText('Ta précision'), { target: { value: saisie } })
    faux.refusRpc = 'Accès refusé à ce dossier.'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer la précision' })) })
    expect(faux.rpcs).toEqual([{ nom: 'ecrire_precision_mouvement', args: { p_dossier_id: 'd1', p_ligne_bancaire_id: 'l6', p_texte: saisie } }])
    expect(screen.getByRole('status').textContent).toBe('Ta précision n’a pas été envoyée : Accès refusé à ce dossier.')
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).value).toBe(saisie)
    faux.refusRpc = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Envoyer la précision' })) })
    expect((screen.getByLabelText('Ta précision') as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByRole('status').textContent).toBe('Ta précision est envoyée à ton cabinet.')
  })

  it('retirer sa proposition : retirer_proposition ; un refus de la base se dit', async () => {
    await monter()
    await ouvrir('CB FICTIVE PAPETERIE')
    faux.refusRpc = 'Cette proposition est déjà retirée, depuis le 12/09/2026.'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retirer' })) })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_proposition', args: { p_dossier_id: 'd1', p_proposition_id: 'j1' } }])
    expect(screen.getByRole('status').textContent).toBe('Ta proposition n’a pas été retirée : Cette proposition est déjà retirée, depuis le 12/09/2026.')
  })

  it('déposer puis envoyer : la pièce créée est proposée ; un document ou un doublon ne l’est pas, et l’écran le dit', async () => {
    await monter()
    await ouvrir('PRLV FICTIF TELECOM')
    const champ = () => document.querySelector('input[type="file"]') as HTMLInputElement
    const fichier = new File(['%PDF-1.4 fictif'], 'recu-fictif.pdf', { type: 'application/pdf' })

    faux.depot = { statut: 'ok', cible: { type: 'piece', id: 'p-neuve' } }
    await act(async () => { fireEvent.change(champ(), { target: { files: [fichier] } }) })
    expect(faux.depots).toEqual(['recu-fictif.pdf'])
    expect(faux.rpcs).toEqual([{ nom: 'proposer_justificatif', args: { p_dossier_id: 'd1', p_ligne_bancaire_id: 'l1', p_piece_id: 'p-neuve' } }])
    expect(screen.getByRole('status').textContent).toBe('Ta pièce est déposée et envoyée : ton cabinet la voit à côté de ce mouvement.')

    faux.depot = { statut: 'ok', cible: { type: 'document', id: 'doc-neuf' } }
    await act(async () => { fireEvent.change(champ(), { target: { files: [fichier] } }) })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toContain('reconnu comme un document')

    faux.depot = { statut: 'doublon' }
    await act(async () => { fireEvent.change(champ(), { target: { files: [fichier] } }) })
    expect(faux.rpcs).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe('Ce fichier est déjà dans ton dossier : choisis-le dans la liste des pièces déjà déposées.')

    faux.depot = { statut: 'ok', cible: { type: 'piece', id: 'p-autre' } }
    faux.refusRpc = 'L\'exercice 2025 est validé : un justificatif ne s\'y propose plus.'
    await act(async () => { fireEvent.change(champ(), { target: { files: [fichier] } }) })
    expect(screen.getByRole('status').textContent).toBe('Ta pièce est déposée dans ton dossier, mais elle n’a pas été envoyée pour ce mouvement : '
      + 'L\'exercice 2025 est validé : un justificatif ne s\'y propose plus.')
    expect(motsDuCabinet(texte())).toEqual([])
  })

  it('deux dépôts dans le même act : un seul part', async () => {
    await monter()
    await ouvrir('PRLV FICTIF TELECOM')
    faux.depot = { statut: 'ok', cible: { type: 'piece', id: 'p-neuve' } }
    const champ = document.querySelector('input[type="file"]') as HTMLInputElement
    const fichier = new File(['x'], 'recu.pdf', { type: 'application/pdf' })
    await act(async () => {
      fireEvent.change(champ, { target: { files: [fichier] } })
      fireEvent.change(champ, { target: { files: [fichier] } })
      fireEvent.change(champ, { target: { files: [fichier] } })
    })
    expect(faux.depots).toHaveLength(1)
    expect(faux.rpcs).toHaveLength(1)
  })
})
