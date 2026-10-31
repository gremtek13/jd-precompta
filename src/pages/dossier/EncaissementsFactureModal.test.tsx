import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EncaissementsFactureModal, { type ContrePassationImposee } from './EncaissementsFactureModal'
import { facture as factureCii } from '../../test/facturesCii'
import { LIBELLE_MOTIF_CONTRE_PASSATION, LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT, LIBELLE_NOTE_DECLARATION } from '../../lib/droitsAcces'
import { ACCES_EN_COURS, type AccesDuDossier } from '../../lib/auteursVentes'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { RATTACHEMENT_APRES_LA_FRONTIERE } from '../../lib/encaissementsFactures'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { CAISSE_JUGEE_PAR_LA_BASE } from '../../lib/caisseDesEncaissements'

import type {
  EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureSuperpdpEvent, LigneBancaire, Piece, ReglementGroupe,
  StatutFactureRecu, StatutTva, TransmissionEncaissement, TransmissionFacture,
} from '../../lib/types'

// LA FENÊTRE DES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étapes d3 et d4). Ce que ces cas gardent, et qu'aucun
// test du module d2 ne voit parce que tout vit dans le câblage : les refus de la base dits AVANT le clic et le bouton
// grisé tant qu'un refus tient ; un seul appel pour plusieurs clics, et le verrou tenu jusqu'après la relecture ; une
// erreur de la base dite, et le verrou relâché ; rien de proposé sur une lecture partielle ; le retrait, la déclaration
// hors application et la contre-passation, et leurs confirmations, qui nomment ce qu'on écrit ; la liste relue et les
// propositions recalculées après chaque geste. Le faux client APPLIQUE les filtres qui décident de ce que la fenêtre voit
// (src/test/filtresPostgrest.ts). Données FICTIVES.
const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  // Lecture partielle : la table cesse de rendre des lignes au-delà de ce rang, en annonçant le vrai total.
  muetApres: {} as Record<string, number>,
  // Lecture refusée par la base.
  refus: {} as Record<string, string>,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // L'appel à la base reste EN ATTENTE jusqu'à ce que le cas le libère.
  retenirRpc: false,
  libererRpc: null as null | (() => void),
  // Les lectures qui suivent un appel restent en attente : la relecture que le verrou doit couvrir.
  retenirLectures: false,
  libererLectures: null as null | (() => void),
  lectures: 0,
  // La connexion à la plateforme du client, telle que `plateforme-agreee` (action « statut ») la rend (étape d7).
  connexion: null as unknown,
  // Les appels à la fonction hors de cette lecture ; le relevé reste EN ATTENTE jusqu'à ce que le cas le résolve.
  appels: [] as Record<string, unknown>[],
  resoudreReleve: null as null | ((v: unknown) => void),
  lecturesConnexion: 0,
  // Les tables que la fenêtre a demandées, une entrée par requête (étape VF5b : le client ne lit pas les exercices validés).
  tablesLues: [] as string[],
}))

// LE DRAPEAU DE LA CAISSE (`CAISSE_EXPORTEE`, levé depuis le 30/10/2026) : ses deux états joués par un accesseur — levé par
// défaut, baissé dans les cas qui gardent la fenêtre d'hier (la relecture de la caisse du 31/10/2026).
const drapeauCaisse = vi.hoisted(() => ({ leve: true }))
vi.mock('../../lib/caisse', async (original) => {
  const vrai = await original<typeof import('../../lib/caisse')>()
  return { ...vrai, get CAISSE_EXPORTEE() { return drapeauCaisse.leve } }
})

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  let barriere: Promise<void> | null = null
  const executer = (nom: string, args: Record<string, unknown>) => {
    if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
    // Ce que font les quatre fonctions de la base (supabase/schema/20261008180607_encaissements_des_factures.sql et
    // 20261008221156_transmissions_des_encaissements.sql), sans leurs refus : l'écran les dit avant le clic.
    if (nom === 'declarer_encaissement_hors_application') {
      const e = faux.tables.encaissements_factures.find((x) => x.id === args.p_encaissement_id) as Record<string, unknown>
      // L'hôte que la base inscrit : celui où l'encaissement annulé a été déclaré, ou celui qui a accepté la facture.
      const hote = e.annule_id != null
        ? faux.tables.transmissions_encaissements.find((d) => d.encaissement_id === e.annule_id)?.hote
        : faux.tables.transmissions_factures.find((t) => t.facture_id === e.facture_id && t.etat !== 'echec')?.hote
      faux.tables.transmissions_encaissements.push({
        id: `t-enc-${faux.rpcs.length}`, dossier_id: args.p_dossier_id, encaissement_id: e.id, facture_id: e.facture_id,
        canal: 'manuel', hote, flux_id: null, sha256: null, etat: 'depose', detail: null, note: args.p_note, cree_par: null,
        cree_le: '2027-11-02T10:00:00Z', maj_le: '2027-11-02T10:00:00Z',
      })
    } else if (nom === 'annuler_encaissement') {
      const e = faux.tables.encaissements_factures.find((x) => x.id === args.p_encaissement_id) as Record<string, unknown>
      const id = `e-cp-${faux.rpcs.length}`
      // Le débit cité (le cinquième paramètre, étape VF2), s'il y en a un.
      faux.tables.encaissements_factures.push({
        ...e, id, date_encaissement: args.p_date, montant: -(e.montant as number), ligne_bancaire_id: args.p_ligne_bancaire_id ?? null,
        annule_id: e.id, motif: args.p_motif, cree_le: '2027-11-02T10:00:00Z', retire_le: null, retire_par: null,
      })
      for (const p of faux.tables.encaissements_factures_taux.filter((x) => x.encaissement_id === e.id)) {
        faux.tables.encaissements_factures_taux.push({ ...p, encaissement_id: id, montant: -(p.montant as number) })
      }
    } else if (nom === 'enregistrer_encaissement') {
      const id = `e-nouveau-${faux.rpcs.length}`
      faux.tables.encaissements_factures.push({
        id, dossier_id: args.p_dossier_id, facture_id: args.p_facture_id, date_encaissement: args.p_date,
        montant: args.p_montant, moyen: args.p_moyen, ligne_bancaire_id: args.p_ligne_bancaire_id, annule_id: null,
        motif: null, cree_par: null, cree_le: '2027-11-02T10:00:00Z', retire_le: null, retire_par: null,
      })
      for (const p of args.p_repartition as { taux: number; montant: number }[]) {
        faux.tables.encaissements_factures_taux.push({ encaissement_id: id, dossier_id: args.p_dossier_id, taux: p.taux, montant: p.montant })
      }
    } else {
      faux.tables.encaissements_factures = faux.tables.encaissements_factures.map((e) =>
        (e.id === args.p_encaissement_id ? { ...e, retire_le: '2027-11-02T10:05:00Z' } : e))
    }
    if (faux.retenirLectures) barriere = new Promise<void>((r) => { faux.libererLectures = r })
    return { data: {}, error: null }
  }
  return {
    supabase: {
      functions: {
        invoke: (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') {
            faux.lecturesConnexion += 1
            return (barriere ?? Promise.resolve()).then(() => ({ data: { connexion: faux.connexion }, error: null }))
          }
          faux.appels.push({ nom, ...options.body })
          return new Promise((resolve) => {
            faux.resoudreReleve = (v) => {
              if (faux.retenirLectures) barriere = new Promise<void>((r) => { faux.libererLectures = r })
              resolve(v)
            }
          })
        },
      },
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (faux.retenirRpc) return new Promise((r) => { faux.libererRpc = () => r(executer(nom, args)) })
        return Promise.resolve(executer(nom, args))
      },
      from: (table: string) => {
        const predicats: Predicat[] = []
        // La lecture des numéros qui suit un relevé (`.in('id', …)`) n'attend pas : seule la RELECTURE de la fenêtre est retenue.
        let numeros = false
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // Les colonnes demandées, et elles seules, comme PostgREST : une colonne oubliée dans un `select` manque à l'écran.
        let colonnes: string[] | null = null
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (liste: string) => {
            colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim())
            return c
          },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          in: (colonne: string, valeurs: unknown[]) => { numeros = true; predicats.push(predicatIn(colonne, valeurs)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.lectures += 1
            const reponse = () => {
              if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
              const toutes = filtrer(faux.tables[table] ?? [], predicats)
              const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
                .map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
              return { data: rendu, error: null, count: toutes.length }
            }
            return ((numeros ? null : barriere) ?? Promise.resolve()).then(reponse).then(suite)
          },
        })
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        faux.tablesLues.push(table)
        return c
      },
    },
  }
})

// La facture de l'essai de d1 : 1 000 € à 20 %, 100 € à 5,5 %, 50 € à 0 % — 1 355,50 € TTC. Des prestations de services
// à une entreprise, sans option pour les débits, émise après le 01/09/2027 : le statut « Encaissée » est DÛ.
const LIGNES_CII = [
  { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { ordre: 2, designation: 'Ouvrage', quantite: 1, prix_unitaire_ht: 100, taux_tva: 5.5 },
  { ordre: 3, designation: 'Débours', quantite: 1, prix_unitaire_ht: 50, taux_tva: 0 },
]
const facture = (o: Partial<FactureEmise> = {}): FactureEmise => factureCii(LIGNES_CII, {
  numero: 'F2027-0042', date_emission: '2027-10-01', option_debits: false, ...o,
})
const FACTURE = facture()

const mouvement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'm1', dossier_id: 'd1', date: '2027-10-15', montant: 1355.5, libelle: 'VIR SEPA CLIENT FICTIF SAS', libelle_brut: null,
  statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2027-10-16T08:00:00Z', encaissements_de_factures: false, ...o,
})

const encaissement = (o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-10-05', montant: 600, moyen: 'cheque',
  ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: '2027-10-05T09:00:00Z', retire_le: null,
  retire_par: null, compte_contrepartie: null, ...o,
})
const part = (o: Partial<EncaissementFactureTaux> = {}): EncaissementFactureTaux => ({
  encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 600, ...o,
})

// Une pièce du dossier, telle que la fenêtre la lit : ce que le pont de la ligne 28.6 reconnaît, son tiers et son fichier.
type PieceEssai = Pick<Piece, 'id' | 'dossier_id' | 'flux_hote' | 'flux_id' | 'superpdp_invoice_id' | 'identite_numero'
  | 'identite_siren_vendeur' | 'identite_date' | 'identite_nature' | 'facture_id' | 'tiers' | 'nom_fichier'>
const pieceEssai = (o: Partial<PieceEssai> = {}): PieceEssai => ({
  id: 'p1', dossier_id: 'd1', flux_hote: null, flux_id: null, superpdp_invoice_id: null, identite_numero: null,
  identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, tiers: null, nom_fichier: 'piece.pdf', ...o,
})

const onUpdated = vi.fn()

function monter(o: {
  facture?: FactureEmise; factures?: FactureEmise[]; mouvements?: LigneBancaire[]; encaissements?: EncaissementFacture[]
  parts?: EncaissementFactureTaux[]; statutTva?: StatutTva | null; transmissions?: TransmissionFacture[]
  evenements?: FactureSuperpdpEvent[]; declarations?: TransmissionEncaissement[]; statuts?: StatutFactureRecu[]
  connexion?: unknown; pieces?: PieceEssai[]; reglements?: ReglementGroupe[]
  // Les accès du dossier que l'onglet a lus (étape P4c) ; « en cours » par défaut : rien n'est dit « par le client ».
  acces?: AccesDuDossier
  // Les années des exercices validés (étape VF5b), que le cabinet seul lit ; aucune par défaut.
  exercices?: number[]
  // Le client « Ventes », avec ou sans « Banque » (étape VF5b) ; le cabinet par défaut.
  client?: { banque: boolean }
  // Les lignes d'autres factures du dossier — celles d'un avoir (étape VF5b).
  lignesEnPlus?: Record<string, unknown>[]
  // Le mouvement que la fiche d'un crédit impose (étape VF5c) ; aucun par défaut, comme l'onglet Factures.
  mouvementImpose?: string
  // La contre-passation que la fiche d'un débit impose (étape VF5d) ; aucune par défaut, comme l'onglet Factures.
  contrePassationImposee?: ContrePassationImposee
  // La caisse du dossier (la relecture du 31/10/2026), que le cabinet seul lit : ses opérations et la reprise ; aucune par
  // défaut — une caisse vide, que des espèces d'une facture source remplissent.
  operationsCaisse?: Record<string, unknown>[]
  reprise?: Record<string, unknown>[]
} = {}) {
  const f = o.facture ?? FACTURE
  // Des copies en objets nus : le faux client les modifie comme la base, et le jeu d'essai reste intact.
  const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))
  faux.tables = {
    factures_emises: nues([f, ...(o.factures ?? [])]),
    facture_lignes: [...LIGNES_CII.map((l, i) => ({ ...l, id: `l${i + 1}`, facture_id: f.id })), ...(o.lignesEnPlus ?? [])],
    transmissions_factures: nues(o.transmissions ?? []),
    facture_superpdp_events: nues(o.evenements ?? []),
    transmissions_encaissements: nues(o.declarations ?? []),
    encaissements_factures: nues(o.encaissements ?? []),
    encaissements_factures_taux: nues(o.parts ?? []),
    lignes_bancaires: nues(o.mouvements ?? [mouvement()]),
    reglements_groupes: nues(o.reglements ?? []),
    pieces: nues(o.pieces ?? []),
    statuts_factures_recus: nues(o.statuts ?? []),
    // Les exercices validés, que la fenêtre lit au cabinet depuis l'étape VF5b : aucun par défaut.
    exercices_valides: (o.exercices ?? []).map((annee) => ({ dossier_id: 'd1', annee })),
    operations_caisse: o.operationsCaisse ?? [],
    a_nouveaux: o.reprise ?? [],
  }
  faux.connexion = o.connexion === undefined ? null : o.connexion
  const qui = o.client
    ? { espace: 'client' as const, banque: o.client.banque }
    : { espace: 'cabinet' as const, acces: o.acces ?? ACCES_EN_COURS, compteCaisse: PLAN_PAR_DEFAUT.caisse }
  return render(
    <EncaissementsFactureModal {...qui}
      dossierId="d1" facture={f} statutTva={o.statutTva === undefined ? 'redevable' : o.statutTva}
      mouvementImpose={o.mouvementImpose ?? null} contrePassationImposee={o.contrePassationImposee ?? null}
      onClose={() => {}} onUpdated={onUpdated}
    />,
  )
}

const bouton = () => screen.findByRole('button', { name: 'Enregistrer l’encaissement' })
const champ = (libelle: string) => screen.getByLabelText(libelle) as HTMLInputElement
// La saisie d'un encaissement entier, sans mouvement : la date, le moyen ; le montant et la répartition sont proposés.
async function saisirSansMouvement(date = '2027-10-20', moyen = 'virement') {
  await bouton()
  fireEvent.change(champ('Date de l’encaissement'), { target: { value: date } })
  fireEvent.change(champ('Moyen de paiement'), { target: { value: moyen } })
}

beforeEach(() => {
  // Le jour à Paris que la fenêtre lit : la base refuse un encaissement daté après lui.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-02T10:00:00Z'))
  faux.muetApres = {}
  faux.refus = {}
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirRpc = false
  faux.libererRpc = null
  faux.retenirLectures = false
  faux.libererLectures = null
  faux.lectures = 0
  faux.appels = []
  faux.resoudreReleve = null
  faux.lecturesConnexion = 0
  faux.tablesLues = []
  drapeauCaisse.leve = true
  onUpdated.mockReset()

})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('EncaissementsFactureModal — ce que la fenêtre dit avant tout geste', () => {
  it('l’obligation et sa raison, le reste par taux, aucun encaissement, et pourquoi rien ne se déclare d’ici', async () => {
    monter()
    await bouton()
    screen.getByText('Due : des prestations de services, dont la TVA est due à l’encaissement.')
    // Jamais transmise par l'application : son statut ne se déclare pas d'ici, et la fenêtre dit pourquoi.
    screen.getByText(/^Aucune transmission de cette facture par l'application n'a été acceptée par une plateforme/)
    screen.getByText(/^Reste à encaisser : 1\s355,50\s€$/)
    const taux = screen.getAllByRole('row').map((r) => r.textContent)
    expect(taux).toContain('20 %1\u202f200,00\u00a0€0,00\u00a0€1\u202f200,00\u00a0€')
    expect(taux).toContain('5,5 %105,50\u00a0€0,00\u00a0€105,50\u00a0€')
    expect(taux).toContain('0 %50,00\u00a0€0,00\u00a0€50,00\u00a0€')
    screen.getByText('Aucun encaissement enregistré pour cette facture.')
    // Le montant proposé est le reste, réparti exactement ; le moyen n'est jamais proposé.
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
    expect(champ('Part à 20 %').value).toBe('1200,00')
    expect(champ('Part à 5,5 %').value).toBe('105,50')
    expect(champ('Part à 0 %').value).toBe('50,00')
    expect(champ('Moyen de paiement').value).toBe('')
  })

  it('une obligation facultative : l’échéance se dit, sans aucune alerte de retard', async () => {
    const ancienne = facture({ date_emission: '2026-09-15' })
    monter({ facture: ancienne, encaissements: [encaissement({ date_encaissement: '2026-09-20' })], parts: [part()] })
    await screen.findByText(/^Facultative : la facture est du 15\/09\/2026/)
    screen.getByText(/Paiements de septembre 2026 : à déclarer au plus tard le 10\/10\/2026\./)
    expect(screen.queryByText('Échéance dépassée')).toBeNull()
  })

  it('une obligation due : une échéance passée se dit dépassée ; une à venir, non', async () => {
    monter({
      // Un acompte de septembre, à déclarer au plus tard le 10/10/2027 ; un paiement d'octobre, le 10/11/2027.
      encaissements: [encaissement({ date_encaissement: '2027-09-20' }), encaissement({ id: 'e2', date_encaissement: '2027-10-20', montant: 100 })],
      parts: [part(), part({ encaissement_id: 'e2', montant: 100 })],
    })
    const passee = (await screen.findByText(/Paiements de septembre 2027/)).closest('tr') as HTMLElement
    within(passee).getByText('Échéance dépassée')
    const aVenir = screen.getByText(/Paiements d’octobre 2027/).closest('tr') as HTMLElement
    expect(within(aVenir).queryByText('Échéance dépassée')).toBeNull()
  })

  it('l’effet d’un avoir se dit, à l’écran seulement : la base ne le déduit pas', async () => {
    const avoir = facture({
      id: 'a1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1', montant_ht: -333.33, montant_tva: -66.67, montant_ttc: -400,
    })
    monter({ factures: [avoir] })
    await bouton()
    screen.getByText(/L’avoir A2027-0001 de cette facture en crédite 400,00\s€ : le client ne doit plus que 955,50\s€ sur ce reste/)
    screen.getByText(/la base ne déduit pas les avoirs, et un encaissement reste plafonné au total de la facture/)
    // Le reste à encaisser, lui, reste celui de la base.
    screen.getByText(/^Reste à encaisser : 1\s355,50\s€$/)
  })

  it('un chèque dit la date à retenir', async () => {
    monter()
    await bouton()
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'cheque' } })
    screen.getByText(/Date à retenir : Le jour où le chèque est remis, ou reçu s’il est envoyé par la poste/)
  })
})

describe('EncaissementsFactureModal — les refus de la base, dits avant le clic', () => {
  it('dans l’ordre de la base : la date, puis le moyen ; le bouton reste grisé tant qu’un refus tient', async () => {
    monter()
    const b = await bouton()
    screen.getByText('La date de l\'encaissement est à renseigner.')
    expect(b).toHaveProperty('disabled', true)

    fireEvent.change(champ('Date de l’encaissement'), { target: { value: '2027-11-03' } })
    screen.getByText('Un encaissement ne se date pas dans l\'avenir : nous sommes le 02/11/2027.')
    expect(b).toHaveProperty('disabled', true)

    fireEvent.change(champ('Date de l’encaissement'), { target: { value: '2027-10-20' } })
    screen.getByText('Le moyen de paiement est inconnu.')
    expect(b).toHaveProperty('disabled', true)

    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    expect(screen.queryByText(/Le moyen de paiement/)).toBeNull()
    expect(b).toHaveProperty('disabled', false)
    // Un clic grisé n'appelle rien : le bouton est aussi gardé dans le geste.
    expect(faux.rpcs).toEqual([])
  })

  it('la répartition est corrigible, et sa somme se juge', async () => {
    monter()
    await saisirSansMouvement()
    fireEvent.change(champ('Part à 0 %'), { target: { value: '40,00' } })
    screen.getByText('La répartition (1345,50 €) ne fait pas le montant encaissé (1355,50 €).')
    expect(await bouton()).toHaveProperty('disabled', true)
  })

  it('un montant changé repropose la répartition au prorata des restes', async () => {
    monter()
    await saisirSansMouvement()
    fireEvent.change(champ('Montant encaissé (€)'), { target: { value: '500' } })
    // La répartition que l'essai de d1 a enregistrée pour 500 € (entrée d2).
    expect([champ('Part à 20 %').value, champ('Part à 5,5 %').value, champ('Part à 0 %').value]).toEqual(['442,64', '38,92', '18,44'])
    fireEvent.change(champ('Montant encaissé (€)'), { target: { value: '1400' } })
    screen.getByText('L\'encaissement dépasserait le total de la facture : il reste 1355,50 € à encaisser.')
  })
})

describe('EncaissementsFactureModal — les propositions', () => {
  it('un crédit du relevé qui fait le reste se propose, avec son explication, et remplit la saisie', async () => {
    monter()
    await bouton()
    const select = champ('Mouvement du relevé (facultatif)') as unknown as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Aucun mouvement', '15/10/2027 · VIR SEPA CLIENT FICTIF SAS · 1\u202f355,50\u00a0€',
    ])
    fireEvent.change(select, { target: { value: 'm1' } })
    screen.getByText(/Crédit du relevé\. Le crédit fait exactement ce qui reste à encaisser\. Le libellé du mouvement cite le client\./)
    expect(champ('Date de l’encaissement').value).toBe('2027-10-15')
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
    // Le moyen reste à choisir : la base le refuse tant qu'il manque.
    screen.getByText('Le moyen de paiement est inconnu.')
  })

  it('l’écart de frais se dit dans la proposition', async () => {
    monter({ mouvements: [mouvement({ montant: 1350.5 })] })
    await bouton()
    const select = champ('Mouvement du relevé (facultatif)') as unknown as HTMLSelectElement
    expect(select.options[1].textContent).toMatch(/1\s350,50\s€ \(écart -5,00\s€\)$/)
    fireEvent.change(select, { target: { value: 'm1' } })
    screen.getByText(/5,00\s€ d’écart, sous le seuil des frais bancaires \(2 % du montant, 5 € au plus\)/)
    // La facture s'encaisse en entier.
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
  })

  it('aucune proposition se dit, et la saisie sans mouvement reste ouverte', async () => {
    monter({ mouvements: [mouvement({ montant: 42 })] })
    await bouton()
    screen.getByText(/Aucun mouvement ne se propose/)
  })
})

// LA JUMELLE OU UNE AUTRE PIÈCE (ligne 28.6, phase C) : un mouvement qui paie la pièce jumelle de la facture paie la même
// vente ; un mouvement qui paie une autre pièce, que rien ne relie à la facture, paie peut-être son PDF. Le pont
// (lib/ventesJumelles.ts) en décide ; la fenêtre le dit, et n'en refuse rien de plus. Données FICTIVES.
describe('EncaissementsFactureModal — la pièce que le mouvement paie déjà', () => {
  const AVEC_SUPERPDP = facture({ superpdp_invoice_id: 4242 })
  const jumelle = pieceEssai({ id: 'p-jumelle', superpdp_invoice_id: 4242, tiers: 'CLIENT FICTIF SAS', nom_fichier: 'super-pdp-0042.txt' })
  const pdf = pieceEssai({ id: 'p-pdf', tiers: 'CLIENT PDF', nom_fichier: 'vente-0042.pdf' })
  const proposition = () => screen.getByText(/^(Paiement de la pièce jumelle|Crédit du relevé)/)
  async function choisir() {
    await bouton()
    fireEvent.change(champ('Mouvement du relevé (facultatif)'), { target: { value: 'm1' } })
  }

  it('la pièce jumelle : la même vente, attendu', async () => {
    monter({
      facture: AVEC_SUPERPDP, pieces: [jumelle, pdf],
      mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p-jumelle' })],
    })
    await choisir()
    expect(proposition().textContent).toBe('Paiement de la pièce jumelle — la même vente, reçue comme pièce. Le crédit fait '
      + 'exactement ce qui reste à encaisser. Le libellé du mouvement cite le client. Ce mouvement paie la pièce jumelle de '
      + 'cette facture (CLIENT FICTIF SAS) : c’est la même vente.')
    // Rien n'est refusé de plus : l'enregistrement reste ouvert au moyen près.
    screen.getByText('Le moyen de paiement est inconnu.')
  })

  // LA DÉSIGNATION (étape VF1b) : la fenêtre lit la colonne `facture_id` des pièces. Le faux client ne rend que les colonnes
  // demandées : sans elle, le PDF que le cabinet a désigné exemplaire de la facture paraîtrait « une autre pièce, que rien ne
  // relie à la facture », et le crédit qui le paie ne serait pas reconnu comme la même vente.
  it('le PDF désigné exemplaire de la facture est sa pièce : la même vente, attendu — et la pièce d’une autre facture, non', async () => {
    const designe = pieceEssai({ id: 'p-designe', tiers: 'CLIENT PDF', nom_fichier: 'vente-0042.pdf', facture_id: 'f1' })
    monter({ facture: AVEC_SUPERPDP, pieces: [designe, pdf], mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p-designe' })] })
    await choisir()
    expect(proposition().textContent).toContain('Ce mouvement paie la pièce jumelle de cette facture (CLIENT PDF) : c’est la même vente.')
    expect(screen.queryByText(/que rien ne relie à cette facture/)).toBeNull()
  })

  it('une pièce désignée exemplaire d’une AUTRE facture n’est pas celle-ci', async () => {
    const autre = pieceEssai({ id: 'p-autre-facture', tiers: 'CLIENT PDF', nom_fichier: 'vente-0099.pdf', facture_id: 'f-autre' })
    monter({ facture: AVEC_SUPERPDP, pieces: [autre], mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p-autre-facture' })] })
    await choisir()
    expect(screen.queryByText(/paie la pièce jumelle/)).toBeNull()
  })

  it('une autre pièce, que rien ne relie à la facture : peut-être son PDF, qui la compterait deux fois', async () => {
    monter({ facture: AVEC_SUPERPDP, pieces: [jumelle, pdf], mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p-pdf' })] })
    await choisir()
    expect(proposition().textContent).toBe('Crédit du relevé. Le crédit fait exactement ce qui reste à encaisser. Le libellé '
      + 'du mouvement cite le client. Ce mouvement paie déjà une autre pièce, que rien ne relie à cette facture (CLIENT PDF) : '
      + 'si c’est le PDF de cette vente, elle compte deux fois — ne gardez qu’une pièce par facture.')
    expect(screen.queryByText(/paie la pièce jumelle/)).toBeNull()
    screen.getByText('Le moyen de paiement est inconnu.')
  })

  it('un virement groupé qui paie la jumelle et deux autres pièces : les deux se disent, chacune à sa place', async () => {
    const autre = pieceEssai({ id: 'p-autre', tiers: null, nom_fichier: 'autre-vente.pdf' })
    monter({
      facture: AVEC_SUPERPDP, pieces: [jumelle, pdf, autre],
      mouvements: [mouvement({ statut: 'rapprochee', reglement_groupe: true, montant: 1555.5 })],
      reglements: [
        { id: 'r1', dossier_id: 'd1', ligne_bancaire_id: 'm1', piece_id: 'p-jumelle', montant: 1355.5, created_at: '2027-10-16T08:00:00Z' },
        { id: 'r2', dossier_id: 'd1', ligne_bancaire_id: 'm1', piece_id: 'p-pdf', montant: 100, created_at: '2027-10-16T08:00:00Z' },
        { id: 'r3', dossier_id: 'd1', ligne_bancaire_id: 'm1', piece_id: 'p-autre', montant: 100, created_at: '2027-10-16T08:00:00Z' },
      ],
    })
    await choisir()
    expect(proposition().textContent).toContain('Ce mouvement paie la pièce jumelle de cette facture (CLIENT FICTIF SAS) : '
      + 'c’est la même vente. Ce mouvement paie aussi d’autres pièces, que rien ne relie à cette facture (autre-vente.pdf, '
      + 'CLIENT PDF) : si c’est le PDF de cette vente, elle compte deux fois — ne gardez qu’une pièce par facture.')
  })

  it('sans pièce payée, rien de plus n’est dit', async () => {
    monter({ facture: AVEC_SUPERPDP, pieces: [jumelle, pdf] })
    await choisir()
    expect(proposition().textContent).toBe('Crédit du relevé. Le crédit fait exactement ce qui reste à encaisser. Le libellé '
      + 'du mouvement cite le client.')
  })
})

describe('EncaissementsFactureModal — un seul enregistrement', () => {
  // LES TROIS CLICS DANS LE MÊME `act` : deux suffisent à voir un verrou absent, il en faut trois pour voir un verrou posé
  // dans le `try`, que le `finally` du deuxième relâcherait pendant que le premier court (CLAUDE.md).
  it('trois clics, un seul appel : le dossier en premier, la répartition dans l’ordre de la saisie', async () => {
    monter()
    await bouton()
    fireEvent.change(champ('Mouvement du relevé (facultatif)'), { target: { value: 'm1' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    faux.retenirRpc = true
    const b = await bouton()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].nom).toBe('enregistrer_encaissement')
    expect(Object.keys(faux.rpcs[0].args)[0]).toBe('p_dossier_id')
    expect(faux.rpcs[0].args).toEqual({
      p_dossier_id: 'd1', p_facture_id: 'f1', p_date: '2027-10-15', p_montant: 1355.5, p_moyen: 'virement', p_ligne_bancaire_id: 'm1',
      p_repartition: [{ taux: 20, montant: 1200 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }],
    })
    await act(async () => { faux.libererRpc?.() })
  })

  it('le verrou tient jusqu’après la relecture, puis la liste relue et les propositions recalculées se montrent', async () => {
    monter()
    await bouton()
    fireEvent.change(champ('Mouvement du relevé (facultatif)'), { target: { value: 'm1' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    faux.retenirLectures = true
    await act(async () => { (screen.getByRole('button', { name: 'Enregistrer l’encaissement' })).click() })
    // La relecture court : le bouton le dit, il est grisé, et un clic n'appelle rien.
    const enCours = screen.getByRole('button', { name: 'Enregistrement…' })
    expect(enCours).toHaveProperty('disabled', true)
    await act(async () => { enCours.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(onUpdated).not.toHaveBeenCalled()

    await act(async () => { faux.libererLectures?.() })
    expect(screen.getByRole('status').textContent).toMatch(/^Encaissement enregistré : 1\s355,50\s€ le 15\/10\/2027\.$/)
    expect(onUpdated).toHaveBeenCalledTimes(1)
    // La facture est soldée : plus de formulaire, et l'encaissement relu est dans la liste.
    screen.getByText('La facture est entièrement encaissée : il n’y a plus rien à enregistrer.')
    const ligne = screen.getByText('15/10/2027 · VIR SEPA CLIENT FICTIF SAS').closest('tr') as HTMLElement
    within(ligne).getByText('Virement')
    within(ligne).getByText(/^20 % : 1\s200,00\s€ · 5,5 % : 105,50\s€ · 0 % : 50,00\s€$/)
    within(ligne).getByText('Enregistré')
  })

  it('un paiement partiel relu laisse un formulaire neuf, et le mouvement pris ne se propose plus', async () => {
    monter({ mouvements: [mouvement(), mouvement({ id: 'm2', montant: 600, date: '2027-10-20', libelle: 'VIR PARTIEL' })] })
    await bouton()
    fireEvent.change(champ('Montant encaissé (€)'), { target: { value: '600' } })
    fireEvent.change(champ('Date de l’encaissement'), { target: { value: '2027-10-20' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer l’encaissement' }).click() })
    await screen.findByText(/^Reste à encaisser : 755,50\s€$/)
    // Le formulaire repart du nouveau reste ; m1 (1 355,50 €) ne fait plus le reste, m2 non plus : aucun ne se propose.
    expect(champ('Montant encaissé (€)').value).toBe('755,50')
    expect(champ('Moyen de paiement').value).toBe('')
    screen.getByText(/Aucun mouvement ne se propose/)
  })

  it('une part laissée vide ne part pas : un taux soldé ne reçoit rien', async () => {
    monter({ encaissements: [encaissement({ montant: 1200 })], parts: [part({ montant: 1200 })] })
    await saisirSansMouvement()
    // Le 20 % est soldé : il ne reste que 155,50 €, à 5,5 % et à 0 %.
    expect(champ('Montant encaissé (€)').value).toBe('155,50')
    expect(champ('Part à 20 %').value).toBe('')
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer l’encaissement' }).click() })
    expect(faux.rpcs[0].args.p_repartition).toEqual([{ taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }])
  })

  it('une erreur de la base se dit, la saisie reste, et le verrou est relâché', async () => {
    monter()
    await saisirSansMouvement()
    faux.erreurRpc = 'L\'encaissement dépasserait le total de la facture : il reste 0,00 € à encaisser.'
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer l’encaissement' }).click() })
    await screen.findByText(faux.erreurRpc)
    expect(champ('Moyen de paiement').value).toBe('virement')
    // Relâché : un nouveau clic repart.
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer l’encaissement' }).click() })
    expect(faux.rpcs).toHaveLength(2)
  })
})

describe('EncaissementsFactureModal — une lecture partielle n’offre aucun formulaire', () => {
  it('des encaissements lus en partie : le bandeau le dit, et rien n’est proposé', async () => {
    faux.muetApres = { encaissements_factures: 1 }
    monter({ encaissements: [encaissement(), encaissement({ id: 'e2', montant: 100 })], parts: [part()] })
    await screen.findByText(/Les encaissements du dossier n'ont pas pu être lus en entier \(1 ligne\(s\) lue\(s\) sur 2 annoncée\(s\)\)/)
    screen.getByText(/Rien n’est proposé/)
    expect(screen.queryByRole('button', { name: 'Enregistrer l’encaissement' })).toBeNull()
    expect(screen.queryByText(/Reste à encaisser/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
  })

  it('des mouvements refusés : de même — une proposition sur une liste incomplète serait fausse', async () => {
    faux.refus = { lignes_bancaires: 'JWT expired' }
    monter()
    await screen.findByText(/Les mouvements du relevé n'ont pas pu être lus en entier .*JWT expired/)
    expect(screen.queryByRole('button', { name: 'Enregistrer l’encaissement' })).toBeNull()
  })
})

describe('EncaissementsFactureModal — le retrait d’un encaissement jamais déclaré', () => {
  const avecUnEncaissement = () => monter({ encaissements: [encaissement()], parts: [part()] })

  it('la confirmation nomme ce qui est retiré ; refusée, rien ne part', async () => {
    avecUnEncaissement()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const retirer = await screen.findByRole('button', { name: 'Retirer' })
    await act(async () => { retirer.click() })
    expect(confirmation).toHaveBeenCalledTimes(1)
    const texte = confirmation.mock.calls[0][0] as string
    expect(texte).toMatch(/^Retirer l’encaissement du 05\/10\/2027 de 600,00\s€ sur la facture F2027-0042 \(Client Fictif SAS\) \?/)
    expect(texte).toContain('Il reste au registre, marqué retiré')
    expect(faux.rpcs).toEqual([])
  })

  it('confirmé : un seul appel pour trois clics, puis la liste relue le dit retiré', async () => {
    avecUnEncaissement()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const retirer = await screen.findByRole('button', { name: 'Retirer' })
    await act(async () => { retirer.click(); retirer.click(); retirer.click() })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_encaissement', args: { p_dossier_id: 'd1', p_encaissement_id: 'e1' } }])
    await screen.findByText(/^Retiré le 02\/11\/2027$/)
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull()
    screen.getByText(/^Reste à encaisser : 1\s355,50\s€$/)
    expect(onUpdated).toHaveBeenCalledTimes(1)
  })

  it('un encaissement annulé par une contre-passation dit pourquoi il ne se retire pas', async () => {
    monter({
      encaissements: [encaissement(), encaissement({ id: 'e9', montant: -600, annule_id: 'e1', motif: 'Erreur de facture' })],
      parts: [part(), part({ encaissement_id: 'e9', montant: -600 })],
    })
    await screen.findByText('Cet encaissement est annulé par une contre-passation : retirez d\'abord celle-ci.')
    screen.getByText('Annulation')
  })
})

// ── LA DÉCLARATION HORS APPLICATION ET LA CONTRE-PASSATION (ligne 28.5, étape d4) ──────────────────────────────────────
//
// La facture a été acceptée par la plateforme du client : son statut « Encaissée » se déclare là, hors de l'application,
// et la fenêtre inscrit que c'est fait. Les refus des deux fonctions sont ceux du module (encaissementsFactures.ts), dits
// sous les mots de la base ; ce qui se garde ici est leur câblage.
const HOTE = 'flux.plateforme-demo.fr'
const acceptee = (o: Partial<TransmissionFacture> = {}): TransmissionFacture => ({
  id: 't1', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: HOTE, flux_id: 'FLUX-1', sha256: 'a'.repeat(64),
  etat: 'accepte', detail: null, cree_le: '2027-10-02T08:00:00Z', maj_le: '2027-10-02T08:05:00Z', ...o,
})
const declaration = (o: Partial<TransmissionEncaissement> = {}): TransmissionEncaissement => ({
  id: 'te1', dossier_id: 'd1', encaissement_id: 'e1', facture_id: 'f1', canal: 'manuel', hote: HOTE, flux_id: null, sha256: null,
  etat: 'depose', detail: null, note: null, cree_par: null, cree_le: '2027-10-06T08:00:00Z', maj_le: '2027-10-06T08:00:00Z', ...o,
})
const ligneDe = async (texte: string | RegExp) => (await screen.findByText(texte)).closest('tr') as HTMLElement

// Un chèque de 600 € du 05/10/2027, DÉCLARÉ avec une note (e1) ; un virement de 300 € du 20/10/2027, à déclarer (e2).
function monterDeclarations(o: Parameters<typeof monter>[0] = {}) {
  return monter({
    transmissions: [acceptee()],
    encaissements: [encaissement(), encaissement({ id: 'e2', date_encaissement: '2027-10-20', montant: 300, moyen: 'virement' })],
    parts: [
      part({ montant: 500 }), part({ taux: 0, montant: 100 }),
      part({ encaissement_id: 'e2', montant: 250 }), part({ encaissement_id: 'e2', taux: 0, montant: 50 }),
    ],
    declarations: [declaration({ note: 'Saisi par Mme Fictive le 06/10/2027, référence PLAT-001' })],
    ...o,
  })
}

// Le chèque déclaré (e1), et sa contre-passation du 25/10/2027, pas encore déclarée (e9).
const AVEC_CONTRE_PASSATION: Parameters<typeof monter>[0] = {
  encaissements: [
    encaissement(),
    encaissement({ id: 'e9', date_encaissement: '2027-10-25', montant: -600, annule_id: 'e1', motif: 'Chèque revenu impayé' }),
  ],
  parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 }), part({ encaissement_id: 'e9', montant: -500 }),
    part({ encaissement_id: 'e9', taux: 0, montant: -100 })],
}

describe('EncaissementsFactureModal — ce que la colonne « Déclaration » dit', () => {
  it('déclaré : où, quand, la note — et « Contre-passer » à la place de « Retirer » ; à déclarer : où, et avant quand', async () => {
    monterDeclarations()
    const declare = within(await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027'))
    screen.getByText(/^Il se déclare hors de l’application, sur flux\.plateforme-demo\.fr — la plateforme qui a accepté la facture/)
    declare.getByText('Note : Saisi par Mme Fictive le 06/10/2027, référence PLAT-001')
    declare.getByRole('button', { name: 'Contre-passer' })
    expect(declare.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect(declare.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
    declare.getByText('Un encaissement déclaré ne se retire pas : il se contre-passe, et l\'annulation se déclare à son tour.')
    // Déclaré, il n'a plus d'échéance.
    expect(declare.queryByText(/à déclarer au plus tard/)).toBeNull()

    const aDeclarer = within(await ligneDe('À déclarer sur flux.plateforme-demo.fr'))
    aDeclarer.getByText('Paiements d’octobre 2027 : à déclarer au plus tard le 10/11/2027.')
    aDeclarer.getByRole('button', { name: 'Retirer' })
    aDeclarer.getByRole('button', { name: 'Déclaré sur la plateforme' })
    expect(aDeclarer.queryByRole('button', { name: 'Contre-passer' })).toBeNull()
    // Pas déclaré, il se retire : la contre-passation n'est pas son affaire, et rien n'en dit le refus.
    expect(aDeclarer.queryByText(/n'est pas déclaré : il se retire, sans contre-passation/)).toBeNull()
  })

  // Le rang 21 (étape VF5h2, VF5H-Q2) : l'encaissement déclaré d'une facture qui n'est pas source, que compte un virement
  // mixte classé, ne se contre-passe ni sans débit ni avec — « Contre-passer » mènerait à un refus certain, après la date et
  // le motif : son motif se dit à la place, comme celui de « Retirer ».
  it('déclaré, sur un virement mixte classé : ni « Contre-passer » ni « Retirer », le motif de la base à leur place', async () => {
    const DECLARE_SUR_M1 = { encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 })] }
    monterDeclarations({ ...DECLARE_SUR_M1, mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })] })
    const mixte = within(await ligneDe('Le mouvement de l\'encaissement contre-passé est classé par ses encaissements : le cabinet retire d\'abord ce classement.'))
    expect(mixte.queryByRole('button', { name: 'Contre-passer' })).toBeNull()
    expect(mixte.queryByRole('button', { name: 'Retirer' })).toBeNull()
    expect(mixte.queryByText(/il se contre-passe/)).toBeNull()
    expect(mixte.queryByText('La date de la contre-passation est à renseigner.')).toBeNull()
    // Classé autrement — rapproché de la pièce de la facture —, il se contre-passe comme hier.
    cleanup()
    monterDeclarations({ ...DECLARE_SUR_M1, mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p1' })] })
    const hier = within(await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027'))
    hier.getByRole('button', { name: 'Contre-passer' })
    hier.getByText('Un encaissement déclaré ne se retire pas : il se contre-passe, et l\'annulation se déclare à son tour.')
  })

  // Une ligne qu'aucune base ne porterait — une déclaration de e2 rangée sous un autre dossier — sert de témoin : la
  // lecture est celle du dossier, et e2 reste à déclarer.
  it('ne lit que les déclarations du dossier', async () => {
    monterDeclarations({ declarations: [declaration(), declaration({ id: 'te-temoin', dossier_id: 'autre', encaissement_id: 'e2' })] })
    within(await ligneDe('À déclarer sur flux.plateforme-demo.fr')).getByRole('button', { name: 'Déclaré sur la plateforme' })
  })

  it('une obligation due en retard le dit ; un encaissement déclaré, non', async () => {
    monterDeclarations({
      encaissements: [encaissement({ date_encaissement: '2027-09-20' }), encaissement({ id: 'e2', date_encaissement: '2027-09-25', montant: 300 })],
    })
    const enRetard = within(await ligneDe('À déclarer sur flux.plateforme-demo.fr'))
    enRetard.getByText('Échéance dépassée')
    expect(screen.getAllByText('Échéance dépassée')).toHaveLength(1)
  })

  it('jamais acceptée par une plateforme : la colonne dit pourquoi, et rien ne s’offre', async () => {
    monter({ encaissements: [encaissement()], parts: [part()] })
    const l = within(await ligneDe('05/10/2027'))
    expect(l.getAllByText(/^Aucune transmission de cette facture par l'application n'a été acceptée/)).toHaveLength(1)
    expect(l.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
    // Le statut reste dû : l'échéance se dit encore.
    l.getByText(/Paiements d’octobre 2027/)
  })

  it('une facture rejetée : aucun statut ne la suit, et aucune échéance ne se dit', async () => {
    monter({ transmissions: [acceptee({ etat: 'rejete' })], encaissements: [encaissement()], parts: [part()] })
    const l = within(await ligneDe('05/10/2027'))
    l.getByText('Cette facture a été rejetée ou refusée : elle s\'annule par un avoir interne, et aucun statut « Encaissée » ne la suit.')
    expect(l.queryByText(/à déclarer au plus tard/)).toBeNull()
    expect(l.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
  })

  it('sans objet, à préciser, facture mixte : rien ne s’offre, et la fenêtre dit pourquoi ; facultative : il s’offre', async () => {
    const cas: [Parameters<typeof monter>[0], RegExp | null][] = [
      [{ facture: facture({ type_client: 'non_assujetti' }) }, /^Aucun encaissement de cette facture ne se déclare\.$/],
      [{ statutTva: null }, /^Rien ne se déclare d’ici : précisez d’abord le statut de TVA du dossier\.$/],
      [{ facture: facture({ option_debits: null }) }, /^Rien ne se déclare d’ici tant que l’obligation est à préciser\.$/],
      [{ facture: facture({ nature_operation: 'mixte' }) }, /^Rien ne se déclare d’ici pour une facture mixte/],
      [{ facture: facture({ date_emission: '2026-09-15' }), encaissements: [encaissement({ date_encaissement: '2026-09-20' })] }, null],
    ]
    for (const [o, texte] of cas) {
      const { unmount } = monter({ transmissions: [acceptee()], encaissements: [encaissement()], parts: [part()], ...o })
      const l = within(await ligneDe(/^Enregistré$/))
      if (texte) {
        screen.getByText(texte)
        l.getByText('Ne se déclare pas d’ici : voir le statut « Encaissée » ci-dessus.')
        expect(l.queryByRole('button', { name: 'Déclaré sur la plateforme' }), String(texte)).toBeNull()
      } else {
        l.getByRole('button', { name: 'Déclaré sur la plateforme' })
        // Facultative : aucune alerte de retard, l'échéance fût-elle passée.
        l.getByText(/à déclarer au plus tard le 10\/10\/2026/)
        expect(l.queryByText('Échéance dépassée')).toBeNull()
      }
      unmount()
    }
  })

  it('une contre-passation dit ce qu’elle annule et son motif ; l’encaissement annulé se dit contre-passé', async () => {
    monterDeclarations(AVEC_CONTRE_PASSATION)
    const cp = within(await ligneDe(/^Annule l’encaissement du 05\/10\/2027 de 600,00\s€/))
    cp.getByText(/motif : « Chèque revenu impayé »/)
    cp.getByText('À déclarer sur flux.plateforme-demo.fr')
    cp.getByText('Annulation')
    cp.getByRole('button', { name: 'Déclaré sur la plateforme' })
    // Pas encore déclarée, une contre-passation se retire encore ; rien ne dit qu'elle ne se contre-passe pas.
    cp.getByRole('button', { name: 'Retirer' })
    expect(cp.queryByText(/Une annulation ne se contre-passe pas/)).toBeNull()
    const annule = within(await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027'))
    annule.getByText('Contre-passé')
    annule.getByText('Cet encaissement est déjà annulé par une contre-passation.')
    expect(annule.queryByRole('button', { name: 'Contre-passer' })).toBeNull()
  })
})

describe('EncaissementsFactureModal — « Déclaré sur la plateforme »', () => {
  const ouvrir = async () => {
    const l = await ligneDe('À déclarer sur flux.plateforme-demo.fr')
    fireEvent.click(within(l).getByRole('button', { name: 'Déclaré sur la plateforme' }))
  }
  const inscrire = () => screen.getByRole('button', { name: 'Inscrire la déclaration' })
  const note = () => champ(LIBELLE_NOTE_DECLARATION)
  const champsASaisir = () => [...document.querySelectorAll('.etape-encaissement tbody tr')].map((r) => r.textContent)

  // LA NOTE SE DIT LUE PAR LE CLIENT « VENTES » (espace client, étape P2) : la migration ventes_du_client lui ouvre les
  // déclarations de ses encaissements, note comprise ; le libellé le dit au-dessus du champ (accord du 10/10/2026).
  it('le libellé de la note dit que le client qui porte la case « Ventes » la lit, au-dessus du champ', async () => {
    monterDeclarations()
    await ouvrir()
    const champNote = note()
    expect(champNote.id).toBe('declaration-note')
    const libelle = document.querySelector('label[for="declaration-note"]') as HTMLLabelElement
    expect(libelle.textContent).toBe(LIBELLE_NOTE_DECLARATION)
    expect(libelle.compareDocumentPosition(champNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryAllByLabelText(/interne/i)).toEqual([])
  })

  it('dit ce qu’il faut saisir sur la plateforme, champ par champ, et que les statuts ne sont pas encore lus', async () => {
    monterDeclarations()
    await ouvrir()
    expect(champsASaisir()).toEqual([
      `Plateforme${HOTE}`, 'Numéro de la factureF2027-0042', 'Date de paiement20/10/2027',
      'Montant encaissé TTC, en euros300,00 €', 'Dont, au taux de 20 %250,00 €', 'Dont, au taux de 0 %50,00 €',
    ])
    // Aucune plateforme reliée au dossier : les statuts n'ont pas été lus, et rien ne les relève d'ici.
    screen.getByText('Les statuts de flux.plateforme-demo.fr n’ont pas encore été lus : lisez-les avant de déclarer — un refus '
      + 'de l’acheteur annule la facture, et aucun statut « Encaissée » ne la suit. Aucune plateforme n’est reliée au dossier '
      + 'pour les lire : reliez-la dans l’onglet Justificatifs (« Plateforme du client »).')
    expect(screen.queryByRole('button', { name: 'Lire les statuts de la plateforme' })).toBeNull()
    expect(inscrire()).toHaveProperty('disabled', false)
    // « Annuler » referme l'étape sans rien écrire.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('button', { name: 'Inscrire la déclaration' })).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('chez Super PDP, le refus de l’acheteur est lu : la fenêtre ne dit rien des statuts de la plateforme du client', async () => {
    // Acceptée chez Super PDP : seul le canal distingue ce cas de celui de la plateforme du client.
    monterDeclarations({
      transmissions: [acceptee({ canal: 'superpdp', hote: 'api.superpdp.tech' })],
      declarations: [declaration({ hote: 'api.superpdp.tech' })],
    })
    const l = await ligneDe('À déclarer sur api.superpdp.tech')
    fireEvent.click(within(l).getByRole('button', { name: 'Déclaré sur la plateforme' }))
    expect(champsASaisir()[0]).toBe('Plateformeapi.superpdp.tech')
    expect(document.querySelector('.verification-declaration')).toBeNull()
  })

  it('une contre-passation : des montants négatifs, et le motif d’annulation en commentaire', async () => {
    monterDeclarations(AVEC_CONTRE_PASSATION)
    await ouvrir()
    expect(champsASaisir()).toEqual([
      `Plateforme${HOTE}`, 'Numéro de la factureF2027-0042', 'Date du décaissement25/10/2027',
      'Montant décaissé TTC, en euros (négatif)-600,00 €', 'Dont, au taux de 20 %-500,00 €', 'Dont, au taux de 0 %-100,00 €',
      'Commentaire : le motif d’annulationChèque revenu impayé',
    ])
    screen.getByText(/ses montants se saisissent en négatif, et son motif d’annulation en commentaire du statut/)
    // Elle suit l'encaissement qu'elle annule : la vérification de la facture ne la regarde pas.
    expect(document.querySelector('.verification-declaration')).toBeNull()

    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { inscrire().click() })
    expect(confirmation.mock.calls[0][0]).toMatch(new RegExp(
      '^Vous déclarez avoir saisi sur flux\\.plateforme-demo\\.fr le statut « Encaissée » de la facture F2027-0042 \\(Client Fictif SAS\\) : '
      + '-600,00\\s€ décaissés le 25/10/2027, dont -500,00\\s€ à 20 % et -100,00\\s€ à 0 %, avec le motif d’annulation « Chèque revenu impayé »\\. '
      + 'Cette mention ne s’efface pas\\.',
    ))
    expect(faux.rpcs).toEqual([])
  })

  it('la note se mesure comme la base : plus de 2 000 caractères est refusé avant le clic, un emoji compte un caractère', async () => {
    monterDeclarations()
    await ouvrir()
    fireEvent.change(note(), { target: { value: 'a'.repeat(2001) } })
    screen.getByText('La note de la déclaration dépasse 2 000 caractères.')
    expect(inscrire()).toHaveProperty('disabled', true)
    // 2 000 caractères, dont un emoji : 2 001 unités UTF-16, et pourtant admis.
    fireEvent.change(note(), { target: { value: `${'a'.repeat(1999)}🙂` } })
    expect(screen.queryByText(/La note de la déclaration dépasse/)).toBeNull()
    expect(inscrire()).toHaveProperty('disabled', false)
  })

  it('la confirmation nomme ce qui est déclaré et le dit irréversible ; refusée, rien ne part', async () => {
    monterDeclarations()
    await ouvrir()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { inscrire().click() })
    const texte = confirmation.mock.calls[0][0] as string
    expect(texte).toMatch(new RegExp(
      '^Vous déclarez avoir saisi sur flux\\.plateforme-demo\\.fr le statut « Encaissée » de la facture F2027-0042 \\(Client Fictif SAS\\) : '
      + '300,00\\s€ encaissés le 20/10/2027, dont 250,00\\s€ à 20 % et 50,00\\s€ à 0 %\\. Cette mention ne s’efface pas\\.',
    ))
    expect(texte).toContain('une déclaration inscrite ici ne se retire plus, et une erreur ne se corrige que par une contre-passation')
    expect(faux.rpcs).toEqual([])
    // L'étape reste ouverte : rien n'a été inscrit.
    inscrire()
  })

  it('une note faite d’espaces part nulle', async () => {
    monterDeclarations()
    await ouvrir()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(note(), { target: { value: '   ' } })
    await act(async () => { inscrire().click() })
    expect(faux.rpcs).toEqual([{ nom: 'declarer_encaissement_hors_application', args: { p_dossier_id: 'd1', p_encaissement_id: 'e2', p_note: null } }])
  })

  // LES TROIS CLICS DANS LE MÊME `act` : il en faut trois pour voir un verrou posé dans le `try` (voir plus haut).
  it('trois clics, un seul appel ; le verrou tient jusqu’après la relecture, puis la ligne relue se dit déclarée', async () => {
    monterDeclarations()
    await ouvrir()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(note(), { target: { value: 'Saisi par le client' } })
    faux.retenirLectures = true
    const b = inscrire()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'declarer_encaissement_hors_application', args: { p_dossier_id: 'd1', p_encaissement_id: 'e2', p_note: 'Saisi par le client' },
    }])
    expect(Object.keys(faux.rpcs[0].args)[0]).toBe('p_dossier_id')
    // La relecture court : rien ne se rouvre, rien ne se ferme, rien ne repart.
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveProperty('disabled', true)
    for (const bouton of screen.getAllByRole('button', { name: /^(Retirer|Contre-passer)$/ })) expect(bouton).toHaveProperty('disabled', true)
    expect(onUpdated).not.toHaveBeenCalled()

    await act(async () => { faux.libererLectures?.() })
    expect(screen.getByRole('status').textContent)
      .toMatch(/^Déclaration inscrite : l’encaissement du 20\/10\/2027 \(300,00\s€\) est déclaré sur flux\.plateforme-demo\.fr\.$/)
    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Inscrire la déclaration' })).toBeNull()
    const l = within(await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 02/11/2027'))
    l.getByText('Note : Saisi par le client')
    l.getByRole('button', { name: 'Contre-passer' })
    expect(l.queryByRole('button', { name: 'Retirer' })).toBeNull()
  })

  it('une erreur de la base se dit, l’étape reste avec sa note, et le verrou est relâché', async () => {
    monterDeclarations()
    await ouvrir()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.change(note(), { target: { value: 'Réf. 42' } })
    faux.erreurRpc = 'Cet encaissement est déjà déclaré : une déclaration ne se fait qu\'une fois.'
    await act(async () => { inscrire().click() })
    await screen.findByText(faux.erreurRpc)
    expect(note().value).toBe('Réf. 42')
    await act(async () => { inscrire().click() })
    expect(faux.rpcs).toHaveLength(2)
  })
})

describe('EncaissementsFactureModal — « Contre-passer » un encaissement déclaré', () => {
  const ouvrir = async () => {
    const l = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
    fireEvent.click(within(l).getByRole('button', { name: 'Contre-passer' }))
  }
  const enregistrerCp = () => screen.getByRole('button', { name: 'Enregistrer la contre-passation' })
  const motif = () => champ(LIBELLE_MOTIF_CONTRE_PASSATION)
  const saisir = (date: string, texte: string) => {
    fireEvent.change(champ('Date du décaissement'), { target: { value: date } })
    fireEvent.change(motif(), { target: { value: texte } })
  }

  // LE MOTIF SE DIT LU PAR LE CLIENT « VENTES » (espace client, étape P2) : la migration ventes_du_client lui ouvre ses
  // encaissements, motif compris ; le libellé le dit au-dessus du champ, condition du cabinet à son accord du 10/10/2026.
  it('le libellé du motif dit que le client qui porte la case « Ventes » le lit, au-dessus du champ', async () => {
    monterDeclarations()
    await ouvrir()
    const champMotif = motif()
    expect(champMotif.id).toBe('contre-passation-motif')
    const libelle = document.querySelector('label[for="contre-passation-motif"]') as HTMLLabelElement
    expect(libelle.textContent).toBe(LIBELLE_MOTIF_CONTRE_PASSATION)
    expect(libelle.compareDocumentPosition(champMotif) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryAllByLabelText(/interne/i)).toEqual([])
  })

  it('les refus de la base dans son ordre, la date jamais proposée ; le bouton grisé tant qu’un refus tient', async () => {
    monterDeclarations()
    await ouvrir()
    expect(champ('Date du décaissement').value).toBe('')
    screen.getByText(/^Le jour où l’encaissement est défait — le chèque revenu impayé, la somme rendue — ou, pour une déclaration faite/)
    const etapes: [string, string, string | null][] = [
      ['', 'Chèque revenu impayé', 'La date de la contre-passation est à renseigner.'],
      ['2027-10-04', '', 'Une contre-passation ne se date pas avant l\'encaissement qu\'elle annule, du 05/10/2027.'],
      ['2027-11-03', '', 'Une contre-passation ne se date pas dans l\'avenir : nous sommes le 02/11/2027.'],
      ['2027-11-01', '   ', 'Le motif de la contre-passation est à renseigner.'],
      ['2027-11-01', 'x'.repeat(2001), 'Le motif de la contre-passation dépasse 2 000 caractères.'],
      ['2027-11-02', 'Chèque revenu impayé', null],
    ]
    for (const [date, texte, refus] of etapes) {
      saisir(date, texte)
      if (refus) screen.getByText(refus)
      expect(enregistrerCp(), `${date} ${texte.slice(0, 5)}`).toHaveProperty('disabled', refus != null)
    }
    expect(screen.queryByText(/^(La date de la|Une contre-passation ne|Le motif de la)/)).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('la confirmation nomme ce qui sera écrit et ce qui suit ; refusée, rien ne part', async () => {
    monterDeclarations()
    await ouvrir()
    saisir('2027-11-01', 'Chèque revenu impayé')
    screen.getByText(/^Sera écrit : -600,00\s€, dont -500,00\s€ à 20 % et -100,00\s€ à 0 %, du même moyen de paiement\s+\(Chèque\)\.$/)
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { enregistrerCp().click() })
    const texte = confirmation.mock.calls[0][0] as string
    expect(texte).toMatch(/^Contre-passer l’encaissement du 05\/10\/2027 de 600,00\s€ sur la facture F2027-0042 \(Client Fictif SAS\) \?/)
    expect(texte).toMatch(/Sera écrite au registre une contre-passation datée du 01\/11\/2027 : -600,00\s€, dont -500,00\s€ à 20 % et -100,00\s€ à 0 %, du même moyen de paiement \(Chèque\), motif « Chèque revenu impayé »\./)
    expect(texte).toContain('Elle se déclare ensuite à son tour sur flux.plateforme-demo.fr ; puis le bon encaissement s’enregistre : l’annulation libère le reste de la facture et le mouvement.')
    expect(faux.rpcs).toEqual([])
  })

  it('trois clics, un seul appel ; relue, la contre-passation est à déclarer et le reste revient', async () => {
    monterDeclarations()
    await screen.findByText(/^Reste à encaisser : 455,50\s€$/)
    await ouvrir()
    saisir('2027-11-01', 'Chèque revenu impayé')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirLectures = true
    const b = enregistrerCp()
    await act(async () => { b.click(); b.click(); b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: 'd1', p_encaissement_id: 'e1', p_date: '2027-11-01', p_motif: 'Chèque revenu impayé' },
    }])
    expect(Object.keys(faux.rpcs[0].args)[0]).toBe('p_dossier_id')
    // L'étape se referme dès la réponse ; la relecture court encore : rien ne se ferme, rien ne repart.
    expect(screen.getByRole('button', { name: 'Fermer' })).toHaveProperty('disabled', true)
    for (const bouton of screen.getAllByRole('button', { name: /^(Retirer|Déclaré sur la plateforme)$/ })) {
      expect(bouton).toHaveProperty('disabled', true)
    }
    expect(onUpdated).not.toHaveBeenCalled()

    await act(async () => { faux.libererLectures?.() })
    expect(screen.getByRole('status').textContent)
      .toMatch(/^Contre-passation enregistrée : -600,00\s€ le 01\/11\/2027\. Elle se déclare à son tour sur flux\.plateforme-demo\.fr\.$/)
    expect(onUpdated).toHaveBeenCalledTimes(1)
    screen.getByText(/^Reste à encaisser : 1\s055,50\s€$/)
    const cp = within(await ligneDe(/^Annule l’encaissement du 05\/10\/2027/))
    cp.getByRole('button', { name: 'Déclaré sur la plateforme' })
    within(await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')).getByText('Contre-passé')
  })

  it('une erreur de la base se dit, la saisie reste, et le verrou est relâché', async () => {
    monterDeclarations()
    await ouvrir()
    saisir('2027-11-01', 'Chèque revenu impayé')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.erreurRpc = 'Cet encaissement est déjà annulé par une contre-passation.'
    await act(async () => { enregistrerCp().click() })
    await screen.findByText(faux.erreurRpc)
    expect(motif().value).toBe('Chèque revenu impayé')
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs).toHaveLength(2)
  })
})

describe('EncaissementsFactureModal — des déclarations lues en partie n’offrent aucun formulaire', () => {
  const cas: [string, () => void][] = [
    ['tronquées', () => { faux.muetApres = { transmissions_encaissements: 1 } }],
    ['refusées', () => { faux.refus = { transmissions_encaissements: 'JWT expired' } }],
  ]
  for (const [nom, poser] of cas) {
    it(`des déclarations ${nom} : le bandeau dit sa conséquence, et ni enregistrer, ni retirer, ni déclarer, ni contre-passer`, async () => {
      poser()
      monterDeclarations({ declarations: [declaration(), declaration({ id: 'te2', encaissement_id: 'e2' })] })
      await screen.findByText(/^Les déclarations des encaissements n'ont pas pu être lues en entier/)
      screen.getByText(/un encaissement déclaré qu’on ne verrait pas se retirerait, ou se déclarerait une seconde fois/)
      for (const bouton of ['Enregistrer l’encaissement', 'Retirer', 'Déclaré sur la plateforme', 'Contre-passer']) {
        expect(screen.queryByRole('button', { name: bouton }), bouton).toBeNull()
      }
      expect(screen.queryByText(/Reste à encaisser/)).toBeNull()
    })
  }
})

// ── LES STATUTS LUS SUR LA PLATEFORME DU CLIENT (ligne 28.5, étape d7) ─────────────────────────────────────────────────
//
// La fenêtre lit les statuts de SA facture, les montre (le refus en tête), et en tire les refus de la base : un 210 ou un
// 213 lu refuse l'enregistrement d'un encaissement (refus 5) et sa déclaration (refus 6). La phrase « Vérifiez d'abord… »
// devient ce qui est SU — lus jusqu'au bout et quand, ou pas encore —, avec le bouton qui relève, sous le verrou de la
// fenêtre.
const statutLu = (o: Partial<StatutFactureRecu> = {}): StatutFactureRecu => ({
  id: 's1', dossier_id: 'd1', facture_id: 'f1', hote: HOTE, flux_id: `flux-${o.id ?? 's1'}`, code: '205', message_id: null,
  emis_le: '20271015101500', createur_role: 'BY', date_statut: '2027-10-15', motifs: null, commentaire: null, montants: [],
  lu_par: null, lu_le: '2027-10-16T09:00:00Z', ...o,
})
const CONNEXION = {
  nom: 'Plateforme Démo', url_flux: `https://${HOTE}`, url_jeton: `https://${HOTE}/jeton`, hote: HOTE, client_id: 'cabinet',
  organisation_id: null, portee: null, recherche_depuis: null, derniere_recuperation: null, cycle_vie_depuis: null,
  cycle_vie_lu_le: null, created_at: '2027-10-01T08:00:00Z', version: 'v1',
}
const LUE = { ...CONNEXION, cycle_vie_depuis: '2027-11-01T08:00:00Z', cycle_vie_lu_le: '2027-11-01T09:00:00Z' }

describe('EncaissementsFactureModal — les statuts lus sur la plateforme du client', () => {
  const ouvrir = async () => {
    const l = await ligneDe('À déclarer sur flux.plateforme-demo.fr')
    fireEvent.click(within(l).getByRole('button', { name: 'Déclaré sur la plateforme' }))
  }
  const releverBouton = () => screen.getByRole('button', { name: 'Lire les statuts de la plateforme' })

  it('lit ceux de SA facture et les montre, le refus en tête ; un refus lu refuse l’encaissement et la déclaration', async () => {
    monterDeclarations({
      connexion: LUE,
      statuts: [
        statutLu({ id: 's1', code: '205' }),
        statutLu({
          id: 's2', code: '211', lu_le: '2027-10-20T09:00:00Z', date_statut: null, emis_le: '20271019143000',
          montants: [{ code: 'MPA', montant: '300.00', devise: 'EUR', taux: null, date: '2027-10-19' }],
        }),
        statutLu({
          id: 's3', code: '210', lu_le: '2027-10-18T09:00:00Z', motifs: 'REF_PRIX : prix non conforme',
          commentaire: 'Tarif de septembre attendu.',
        }),
        // Le refus d'une AUTRE facture n'est pas lu : la lecture est filtrée sur la sienne.
        statutLu({ id: 's4', facture_id: 'f-autre', code: '213' }),
      ],
    })
    await screen.findByText('Statuts lus sur la plateforme du client')
    const fiches = [...document.querySelectorAll('.statuts-lus li')].map((li) => li.textContent)
    expect(fiches).toEqual([
      'Refusée du 15/10/2027, posé par l’acheteur — elle s’annule par un avoir interne, qui ne se transmet pas, puis une '
        + 'nouvelle facture (spécifications externes de la DGFiP, § 3.6.4).Motifs : REF_PRIX : prix non conformeCommentaire : '
        + 'Tarif de septembre attendu.Lu sur flux.plateforme-demo.fr le 18/10/2027',
      'Paiement transmis horodaté le 19/10/2027 à 14:30:00 (heure de la plateforme), posé par l’acheteur — l’acheteur dit '
        + 'avoir payé ; ce n’est pas un encaissement, qui s’enregistre ici.Montants, tels qu’écrits : payé 300.00 EUR le '
        + '19/10/2027Lu sur flux.plateforme-demo.fr le 20/10/2027',
      'Approuvée du 15/10/2027, posé par l’acheteurLu sur flux.plateforme-demo.fr le 16/10/2027',
    ])
    expect(document.querySelector('.statuts-lus li')?.className).toBe('releve-annulation')
    // Refus 5 : aucun encaissement ne suit une facture annulée — sous les mots de la base.
    screen.getByText('Cette facture a été rejetée ou refusée : elle s\'annule par un avoir interne, et aucun encaissement ne la suit.')
    expect(screen.queryByRole('button', { name: 'Enregistrer l’encaissement' })).toBeNull()
    // Refus 6 : sa déclaration non plus ; la colonne le dit, et rien ne s'offre.
    expect(screen.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
    expect(screen.getAllByText('Cette facture a été rejetée ou refusée : elle s\'annule par un avoir interne, et aucun statut « Encaissée » ne la suit.').length)
      .toBeGreaterThan(0)
    // La contre-passation de l'encaissement déclaré et le retrait de l'autre restent possibles : la base les accepte.
    within(await ligneDe(/^Déclaré à la main sur flux\.plateforme-demo\.fr/)).getByRole('button', { name: 'Contre-passer' })
    within(await ligneDe('20/10/2027')).getByRole('button', { name: 'Retirer' })
  })

  it('lus jusqu’au bout, sans refus : la date du dernier relevé, et le bouton qui relève', async () => {
    monterDeclarations({ connexion: LUE, statuts: [statutLu({ code: '205' })] })
    await ouvrir()
    screen.getByText('Statuts lus sur flux.plateforme-demo.fr le 01/11/2027 : aucun refus de l’acheteur. Un refus posé depuis '
      + 'n’est connu qu’en relisant les statuts.')
    expect(releverBouton()).toHaveProperty('disabled', false)
    // L'ouverture n'a rien relevé : seule la connexion a été lue, en base.
    expect(faux.appels).toEqual([])
    expect(faux.lecturesConnexion).toBe(1)
  })

  it('pas encore lus : l’invitation à les lire, et le bouton ; sur une autre plateforme que celle reliée, sans bouton', async () => {
    const { unmount } = monterDeclarations({ connexion: CONNEXION })
    await ouvrir()
    screen.getByText('Les statuts de flux.plateforme-demo.fr n’ont pas encore été lus : lisez-les avant de déclarer — un refus '
      + 'de l’acheteur annule la facture, et aucun statut « Encaissée » ne la suit.')
    releverBouton()
    unmount()

    monterDeclarations({ connexion: { ...LUE, hote: 'api.autre-plateforme.fr' } })
    await ouvrir()
    screen.getByText(/^Les statuts de flux\.plateforme-demo\.fr n’ont pas encore été lus .* La plateforme reliée au dossier est aujourd’hui api\.autre-plateforme\.fr/)
    expect(screen.queryByRole('button', { name: 'Lire les statuts de la plateforme' })).toBeNull()
  })

  it('trois clics, un seul relevé, sous le verrou de la fenêtre ; relus, un refus éteint la déclaration', async () => {
    monterDeclarations({ connexion: CONNEXION })
    await ouvrir()
    const bouton = releverBouton()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appels).toEqual([{ nom: 'plateforme-agreee', action: 'relever', dossierId: 'd1', depuisLeDebut: false }])
    // Le verrou est celui de la fenêtre : l'inscription attend aussi.
    expect(screen.getByRole('button', { name: 'Lecture des statuts…' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Inscrire la déclaration' })).toHaveProperty('disabled', true)

    // La plateforme a rendu le refus de l'acheteur : la base l'a gardé.
    faux.tables.statuts_factures_recus.push({ ...statutLu({ id: 's9', code: '210' }) })
    faux.connexion = LUE
    faux.retenirLectures = true
    const lecturesAvant = faux.lectures
    await act(async () => {
      faux.resoudreReleve?.({
        data: {
          hote: HOTE, version: 'v1', depuis: null, en_attente: 0, en_erreur: 0, reportes: 0, complete: true, motif: null,
          ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
          issues: [{ flux: 'L1', issue: 'garde', facture_id: 'f1', code: '210', avertissements: [] }],
          cycle_vie_depuis: '2027-11-01T08:00:00Z', cycle_vie_lu_le: '2027-11-01T09:00:00Z', erreur_reprise: null,
        },
        error: null,
      })
    })
    // La relecture court : rien ne repart.
    expect(faux.lectures).toBeGreaterThan(lecturesAvant)
    const pris = screen.getByRole('button', { name: 'Lecture des statuts…' })
    expect(pris).toHaveProperty('disabled', true)
    await act(async () => { pris.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { faux.libererLectures?.() })

    // Le bilan, avec le numéro de la facture lu en base ; la phrase se tait, le refus 6 le dit, rien ne s'inscrit.
    screen.getByRole('heading', { name: 'Statuts lus sur flux.plateforme-demo.fr le 01/11/2027' })
    expect((screen.getByText('F2027-0042', { selector: 'strong' }).closest('li') as HTMLElement).textContent)
      .toMatch(/^F2027-0042 : Refusée — elle s’annule par un avoir interne/)
    expect(document.querySelector('.verification-declaration')).toBeNull()
    expect(screen.getByRole('button', { name: 'Inscrire la déclaration' })).toHaveProperty('disabled', true)
    expect(onUpdated).toHaveBeenCalled()
    expect(faux.rpcs).toEqual([])
  })

  it('un relevé refusé se dit, et le verrou se relâche', async () => {
    monterDeclarations({ connexion: CONNEXION })
    await ouvrir()
    await act(async () => { releverBouton().click() })
    const corps = JSON.stringify({ error: 'La plateforme n’a pas répondu à temps (recherche des statuts). Réessayez dans un instant.' })
    await act(async () => { faux.resoudreReleve?.({ data: null, error: { context: new Response(corps, { status: 504 }) } }) })
    screen.getByText('La plateforme n’a pas répondu à temps (recherche des statuts). Réessayez dans un instant.')
    expect(releverBouton()).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Inscrire la déclaration' })).toHaveProperty('disabled', false)
  })

  it('des statuts lus en partie : le bandeau dit sa conséquence, et rien n’est proposé', async () => {
    faux.muetApres = { statuts_factures_recus: 1 }
    monterDeclarations({ connexion: LUE, statuts: [statutLu({ code: '205' }), statutLu({ id: 's2', code: '210' })] })
    await screen.findByText(/^Les statuts lus sur la plateforme du client n'ont pas pu être lus en entier/)
    screen.getByText(/un refus de l’acheteur qu’on ne verrait pas laisserait proposer l’encaissement ou la déclaration d’une facture refusée/)
    for (const nom of ['Enregistrer l’encaissement', 'Retirer', 'Déclaré sur la plateforme', 'Contre-passer', 'Lire les statuts de la plateforme']) {
      expect(screen.queryByRole('button', { name: nom }), nom).toBeNull()
    }
  })

  it('ne lit que les statuts de SA facture : ceux d’une autre ne comptent pas, pas même dans la lecture', async () => {
    // La table cesse de rendre après une ligne : filtrée sur la facture, la lecture n'en a qu'une à rendre, et est complète.
    faux.muetApres = { statuts_factures_recus: 1 }
    monterDeclarations({ connexion: LUE, statuts: [statutLu({ id: 's0', facture_id: 'f-autre', code: '213' }), statutLu({ code: '205' })] })
    await ouvrir()
    expect(screen.queryByText(/^Les statuts lus sur la plateforme du client n'ont pas pu être lus en entier/)).toBeNull()
    expect(document.querySelectorAll('.statuts-lus li')).toHaveLength(1)
    screen.getByText(/^Statuts lus sur flux\.plateforme-demo\.fr le 01\/11\/2027 : aucun refus de l’acheteur/)
  })
})

// ── « PAR LE CLIENT » (espace client, étape P4c) ───────────────────────────────────────────────────────────────────────
//
// Le cabinet reconnaît, parmi les accès du dossier que l'onglet a lus, le compte qui a enregistré un encaissement, l'a
// contre-passé ou l'a déclaré. Seuls les comptes d'un accès, sur une liste lue en entier, sont reconnus ; un auteur nul ou
// un accès retiré n'est personne, et rien ne dit « par le cabinet ». Le client, lui, ne lit aucun accès : rien ne s'y dit.
describe('EncaissementsFactureModal — « par le client »', () => {
  const LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
  const MENTION = 'par le client'

  it('dit « par le client » d’un encaissement et d’une contre-passation du client, avec ce que chacun est', async () => {
    monterDeclarations({
      acces: LUS,
      encaissements: [
        encaissement({ cree_par: 'u-client' }),
        encaissement({ id: 'e2', date_encaissement: '2027-10-20', montant: 300, moyen: 'virement', cree_par: 'u-cabinet' }),
        encaissement({ id: 'e9', date_encaissement: '2027-10-25', montant: -600, annule_id: 'e1', motif: 'Chèque revenu impayé', cree_par: 'u-client' }),
      ],
      parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 }), part({ encaissement_id: 'e2', montant: 250 }),
        part({ encaissement_id: 'e2', taux: 0, montant: 50 }), part({ encaissement_id: 'e9', montant: -500 }),
        part({ encaissement_id: 'e9', taux: 0, montant: -100 })],
      declarations: [declaration({ cree_par: 'u-cabinet' })],
    })
    await screen.findByText('Annulation')
    expect(screen.getAllByText(MENTION)).toHaveLength(2)
    // Chaque mention sur SA ligne, sous son titre : l'encaissement du 05/10, la contre-passation du 25/10.
    const mentionDe = async (date: string) => within((await screen.findByText(date)).closest('tr') as HTMLElement).getByText(MENTION)
    expect((await mentionDe('05/10/2027')).getAttribute('title')).toBe('Encaissement enregistré par le client')
    expect((await mentionDe('25/10/2027')).getAttribute('title')).toBe('Contre-passation enregistrée par le client')
    // Celui du cabinet (e2) n'en porte pas, ni la déclaration du cabinet.
    const e2 = (await screen.findByText('20/10/2027')).closest('tr') as HTMLElement
    expect(within(e2).queryByText(MENTION)).toBeNull()
    expect(screen.queryByText(/par le cabinet/i)).toBeNull()
  })

  it('dit « par le client » d’une déclaration inscrite par le client, sur sa ligne seulement', async () => {
    monterDeclarations({ acces: LUS, declarations: [declaration({ cree_par: 'u-client' })] })
    const declaree = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
    const mention = within(declaree).getByText(MENTION)
    expect(mention.getAttribute('title')).toBe('Déclaration inscrite par le client')
    expect(screen.getAllByText(MENTION)).toHaveLength(1)
  })

  it('une déclaration d’un accès retiré, ou sans auteur, n’est attribuée à personne', async () => {
    for (const cree_par of ['u-ancien', null]) {
      monterDeclarations({ acces: LUS, declarations: [declaration({ cree_par })], encaissements: [encaissement({ cree_par })] })
      await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
      expect(screen.queryByText(MENTION)).toBeNull()
      cleanup()
    }
  })

  it('aucune mention tant que les accès ne sont pas lus en entier : en cours, partiels', async () => {
    for (const acces of [ACCES_EN_COURS, { etat: 'incomplets', motif: 'coupée' } satisfies AccesDuDossier]) {
      monterDeclarations({
        acces, encaissements: [encaissement({ cree_par: 'u-client' })], parts: [part()],
        declarations: [declaration({ cree_par: 'u-client' })],
      })
      await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
      expect(screen.queryByText(MENTION)).toBeNull()
      cleanup()
    }
  })

  it('dans l’espace du client, rien ne se dit, même de ce que le client a fait', async () => {
    faux.tables = {
      factures_emises: [{ ...FACTURE }],
      facture_lignes: LIGNES_CII.map((l, i) => ({ ...l, id: `l${i + 1}`, facture_id: FACTURE.id })),
      transmissions_factures: [{ ...acceptee() }],
      facture_superpdp_events: [],
      transmissions_encaissements: [{ ...declaration({ cree_par: 'u-client' }) }],
      encaissements_factures: [{ ...encaissement({ cree_par: 'u-client' }) }],
      encaissements_factures_taux: [{ ...part() }],
      lignes_bancaires: [],
      reglements_groupes: [],
      pieces: [],
      statuts_factures_recus: [],
    }
    faux.connexion = null
    render(
      <EncaissementsFactureModal espace="client" banque
        dossierId="d1" facture={FACTURE} statutTva="redevable" mouvementImpose={null} contrePassationImposee={null} onClose={() => {}} onUpdated={onUpdated}
      />,
    )
    await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
    expect(screen.queryByText(MENTION)).toBeNull()
  })
})

// ── UNE FACTURE SOURCE DE SA VENTE (ligne 28.65, chantier EC-Q3, étape VF5b) ─────────────────────────────────────────────
//
// La fenêtre juge par les fonctions de la vente du module : le reste NET des avoirs validés, la frontière d'un exercice validé
// (au cabinet ; le client ne la lit pas, et la base la juge), le mouvement libre seul proposé, le retrait d'un encaissement dont
// le mouvement est classé, la contre-passation qui cite son débit — le cinquième paramètre —, et le geste qui rendrait ce débit
// inclassable, dit sans être refusé. Ce que ces cas gardent : chaque refus neuf dit AVANT le clic, le câblage, le verrou.
const SOURCE = facture({ source_de_la_vente: true })
// Son avoir validé : 100 € HT à 20 %, 120 € TTC crédités.
const AVOIR = facture({
  id: 'a1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1', montant_ht: -100, montant_tva: -20, montant_ttc: -120,
  source_de_la_vente: true,
})
const LIGNE_AVOIR = { id: 'la1', facture_id: 'a1', ordre: 1, designation: 'Remise', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20 }
const NON_SOURCE = facture({ id: 'f2', numero: 'F2027-0043' })

describe('EncaissementsFactureModal — une facture source de sa vente : ce qui se dit avant le clic (étape VF5b)', () => {
  it('le reste est net de l’avoir validé, comme la base le plafonne ; le formulaire le propose', async () => {
    monter({ facture: SOURCE, factures: [AVOIR], lignesEnPlus: [LIGNE_AVOIR] })
    await bouton()
    screen.getByText(/^Reste à encaisser : 1\s235,50\s€$/)
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toContain('TTC net des avoirs')
    expect(champ('Montant encaissé (€)').value).toBe('1235,50')
    expect(champ('Part à 20 %').value).toBe('1080,00')
    screen.getByText(/la facture est\s+source de sa vente, et la base plafonne ses encaissements au total net de ses avoirs validés/)
    expect(screen.queryByText(/la base ne déduit pas les avoirs/)).toBeNull()
    // Les lignes de l'avoir sont lues avec celles de la facture, dans la même lecture.
    expect(faux.tablesLues.filter((t) => t === 'facture_lignes')).toHaveLength(1)
  })

  it('au cabinet, la frontière d’un exercice validé se dit avant le clic, sous les mots de la base', async () => {
    monter({ facture: SOURCE, exercices: [2027] })
    await saisirSansMouvement()
    screen.getByText('L\'exercice 2027 est validé : un encaissement de cette facture ne s\'y date plus.')
    expect(await bouton()).toHaveProperty('disabled', true)
    expect(faux.tablesLues).toContain('exercices_valides')
    expect(screen.queryByText(/ne se lisent pas d’ici/)).toBeNull()
  })

  it('… et une facture qui n’est pas source, la même date : rien de neuf, comme hier', async () => {
    monter({ exercices: [2027] })
    await saisirSansMouvement()
    expect(screen.queryByText(/est validé/)).toBeNull()
    expect(await bouton()).toHaveProperty('disabled', false)
  })

  it('le chèque d’un exercice validé, sans mouvement : il se rattache encore au crédit qui le paie (étape VF7a)', async () => {
    // Le chèque du 05/10/2027, l'exercice 2027 validé : sa ligne le dit, au cabinet.
    monter({ facture: SOURCE, exercices: [2027], encaissements: [encaissement()], parts: [part()] })
    const l = await ligneDe(RATTACHEMENT_APRES_LA_FRONTIERE)
    expect(within(l).getByText(RATTACHEMENT_APRES_LA_FRONTIERE)).toBeTruthy()
    // Par un autre moyen, il ne se rattache plus : rien n'est dit. Ni d'un exercice qui n'est pas validé.
    for (const o of [{ encaissements: [encaissement({ moyen: 'autre' })] }, { exercices: [] as number[] }]) {
      cleanup()
      monter({ facture: SOURCE, exercices: [2027], encaissements: [encaissement()], parts: [part()], ...o })
      await bouton()
      expect(screen.queryByText(RATTACHEMENT_APRES_LA_FRONTIERE)).toBeNull()
    }
  })

  it('seul un mouvement LIBRE se propose ; la pièce jumelle ne propose plus son paiement', async () => {
    monter({
      facture: SOURCE, factures: [AVOIR], lignesEnPlus: [LIGNE_AVOIR],
      transmissions: [{ ...transmissionJumelle() }],
      pieces: [pieceEssai({ id: 'pj', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' })],
      mouvements: [
        mouvement({ id: 'm1', montant: 1235.5 }),
        mouvement({ id: 'm2', montant: 1235.5, statut: 'rapprochee', categorie_id: 'k1' }),
        mouvement({ id: 'mj', montant: 1235.5, statut: 'rapprochee', piece_id: 'pj' }),
      ],
    })
    await bouton()
    const choix = champ('Mouvement du relevé (facultatif)') as unknown as HTMLSelectElement
    expect([...choix.options].map((o) => o.value)).toEqual(['', 'm1'])
  })

  it('le retrait d’un encaissement dont le mouvement est classé : refusé avant le clic, aucun bouton', async () => {
    monter({
      facture: SOURCE, encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part()],
      mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })],
    })
    const l = await ligneDe('Le mouvement dont dépend cet encaissement est classé : le cabinet retire d\'abord ce classement.')
    expect(within(l).queryByRole('button', { name: 'Retirer' })).toBeNull()
    // Le même encaissement d'une facture qui n'est pas source : depuis l'étape VF5h2 (VF5H-Q2, migration
    // registre_virement_mixte), sur un mouvement classé PAR SES ENCAISSEMENTS — un virement mixte —, le rang 8, sous ses mots,
    // aucun bouton ; sur un mouvement classé autrement — rapproché de la pièce de la facture —, il se retire comme hier.
    cleanup()
    monter({ encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part()], mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })] })
    const mixte = await ligneDe('Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d\'abord ce classement.')
    expect(within(mixte).queryByRole('button', { name: 'Retirer' })).toBeNull()
    cleanup()
    monter({ encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part()], mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p1' })] })
    await screen.findByRole('button', { name: 'Retirer' })
  })
})

// La pièce jumelle de l'essai : reconnue par le flux qui l'a transmise.
function transmissionJumelle(): TransmissionFacture {
  return {
    id: 'tj', dossier_id: 'd1', facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-9', sha256: 'b'.repeat(64),
    etat: 'accepte', detail: null, cree_le: '2027-10-02T08:00:00Z', maj_le: '2027-10-02T08:05:00Z',
  }
}

describe('EncaissementsFactureModal — la contre-passation d’une facture source cite son débit (étape VF5b)', () => {
  // Le chèque de 600 € du 05/10/2027, déclaré, revenu impayé ; les débits du relevé.
  const DEBITS = [
    mouvement({ id: 'm1', montant: 1355.5 }),
    mouvement({ id: 'loin', montant: -550, date: '2027-10-27', libelle: 'PRLV FICTIF' }),
    mouvement({ id: 'juste', montant: -600, date: '2027-10-28', libelle: 'CHQ IMPAYE 0001' }),
    mouvement({ id: 'presque', montant: -599, date: '2027-10-29', libelle: 'CHQ IMPAYE 0002' }),
    mouvement({ id: 'classe', montant: -600, date: '2027-10-30', libelle: 'CHQ CLASSE', statut: 'rapprochee', piece_id: 'p9' }),
  ]
  const monterSource = (o: Parameters<typeof monter>[0] = {}) => monterDeclarations({ facture: SOURCE, mouvements: DEBITS, ...o })
  const ouvrir = async () => {
    const l = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
    fireEvent.click(within(l).getByRole('button', { name: 'Contre-passer' }))
  }
  const debit = () => screen.getByLabelText('Débit qui défait l’encaissement (facultatif)') as HTMLSelectElement
  const enregistrerCp = () => screen.getByRole('button', { name: 'Enregistrer la contre-passation' })
  const saisir = () => {
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-11-01' } })
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
  }

  it('les débits LIBRES du dossier, le plus proche du montant d’abord ; aucun n’est choisi d’office', async () => {
    monterSource()
    await ouvrir()
    expect([...debit().options].map((o) => o.value)).toEqual(['', 'juste', 'presque', 'loin'])
    expect(debit().value).toBe('')
  })

  it('un débit trop petit : refusé avant le clic ; un débit de quelques frais trop petit : admis, et dit inclassable', async () => {
    monterSource()
    await ouvrir()
    saisir()
    fireEvent.change(debit(), { target: { value: 'loin' } })
    screen.getByText('Ce mouvement de 550,00 € justifierait 600,00 € de contre-passations : l\'écart dépasse ce que des frais bancaires expliquent.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)

    fireEvent.change(debit(), { target: { value: 'presque' } })
    screen.getByText('Ce mouvement ne pourra pas se classer par ses encaissements : « Les contre-passations que ce mouvement justifie '
      + 'font 600,00 € pour un débit de 599,00 € : elles le dépassent. » La base admet ce geste ; c’est le classement du mouvement, '
      + 'ensuite, qu’elle refusera.')
    expect(enregistrerCp()).toHaveProperty('disabled', false)

    fireEvent.change(debit(), { target: { value: 'juste' } })
    expect(screen.queryByText(/ne pourra pas se classer/)).toBeNull()
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    expect(faux.rpcs).toEqual([])
  })

  it.each([2, 3])('%i clics : un seul appel, avec le débit en cinquième paramètre, nommé par la confirmation', async (clics) => {
    monterSource()
    await ouvrir()
    saisir()
    fireEvent.change(debit(), { target: { value: 'juste' } })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirLectures = true
    const b = enregistrerCp()
    await act(async () => { for (let i = 0; i < clics; i++) b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: 'd1', p_encaissement_id: 'e1', p_date: '2027-11-01', p_motif: 'Chèque revenu impayé', p_ligne_bancaire_id: 'juste' },
    }])
    expect(confirmation.mock.calls[0][0]).toContain('Elle cite le débit qui défait l’encaissement : 28/10/2027 · CHQ IMPAYE 0001, -600,00')
    await act(async () => { faux.libererLectures?.() })
    expect(onUpdated).toHaveBeenCalledTimes(1)
    // Relue, la contre-passation cite son débit.
    await screen.findByText('28/10/2027 · CHQ IMPAYE 0001')
  })

  it('sans débit choisi, l’appel est celui d’hier : quatre paramètres', async () => {
    monterSource()
    await ouvrir()
    saisir()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { enregistrerCp().click() })
    expect(Object.keys(faux.rpcs[0].args)).toEqual(['p_dossier_id', 'p_encaissement_id', 'p_date', 'p_motif'])
  })

  it('sans débit, l’encaissement dont le crédit est classé par ses encaissements : refusé avant le clic ; le débit cité, admis', async () => {
    monterSource({
      encaissements: [encaissement({ ligne_bancaire_id: 'mc' })], parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 })],
      // Le crédit n'est classé QUE par sa colonne `encaissements_de_factures` : la lecture doit la demander.
      mouvements: [...DEBITS, mouvement({ id: 'mc', montant: 600, statut: 'rapprochee', encaissements_de_factures: true })],
    })
    await ouvrir()
    saisir()
    screen.getByText('Le mouvement de l\'encaissement contre-passé est classé par ses encaissements : la contre-passation cite le '
      + 'débit qui défait l\'encaissement, ou le cabinet retire d\'abord ce classement.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    fireEvent.change(debit(), { target: { value: 'juste' } })
    expect(screen.queryByText(/contre-passé est classé/)).toBeNull()
    expect(enregistrerCp()).toHaveProperty('disabled', false)
  })

  it('une facture qui n’est pas source n’offre aucun débit : la base le refuserait', async () => {

    monterDeclarations({ mouvements: DEBITS })
    await ouvrir()
    expect(screen.queryByLabelText('Débit qui défait l’encaissement (facultatif)')).toBeNull()
  })

  it('le client « Ventes » avec « Banque » choisit un débit ; sans « Banque », aucun, et le relevé n’est pas lu', async () => {
    monterSource({ client: { banque: true } })
    await ouvrir()
    expect([...debit().options].map((o) => o.value)).toEqual(['', 'juste', 'presque', 'loin'])
    cleanup()
    faux.tablesLues = []
    monterSource({ client: { banque: false } })
    await ouvrir()
    await screen.findByRole('button', { name: 'Enregistrer la contre-passation' })
    expect(screen.queryByLabelText('Débit qui défait l’encaissement (facultatif)')).toBeNull()
    expect(faux.tablesLues).not.toContain('lignes_bancaires')
  })

  // La case « Banque » retirée pendant que la fenêtre est ouverte (migration contre_passation_banque) : la fenêtre relit
  // sans le relevé, mais l'étape garde le débit choisi — le module le refuse avant le clic, sous les mots de la base (le
  // rang 2), et non comme un mouvement d'un autre dossier ; rien ne part.
  it('« Banque » retirée pendant la saisie : le débit retenu se refuse avant le clic, sous les mots de la base', async () => {
    const { rerender } = monterSource({ client: { banque: true } })
    await ouvrir()
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-11-01' } })
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT), { target: { value: 'Chèque revenu impayé' } })
    fireEvent.change(debit(), { target: { value: 'juste' } })
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    rerender(
      <EncaissementsFactureModal espace="client" banque={false}
        dossierId="d1" facture={SOURCE} statutTva="redevable" mouvementImpose={null} contrePassationImposee={null} onClose={() => {}} onUpdated={onUpdated}
      />,
    )
    await screen.findByText('Le mouvement bancaire d\'un encaissement ne se désigne qu\'avec le droit « Banque » sur ce dossier : '
      + 'sans lui, l\'encaissement s\'enregistre sans mouvement.')
    expect(screen.queryByLabelText('Débit qui défait l’encaissement (facultatif)')).toBeNull()
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs).toEqual([])
  })
})

describe('EncaissementsFactureModal — une facture source, dans l’espace du client (étape VF5b)', () => {
  it('les exercices validés ne se lisent pas : la fenêtre le dit, et c’est la base qui juge la frontière, sous ses mots', async () => {
    monter({ facture: SOURCE, client: { banque: true } })
    await saisirSansMouvement('2026-12-15')
    expect(faux.tablesLues).not.toContain('exercices_valides')
    screen.getByText(/^Les exercices que ton cabinet a validés ne se lisent pas d’ici/)
    // Aucun refus avant le clic : le module ne tient pas les exercices pour vides, il saute la frontière.
    const b = await bouton()
    expect(b).toHaveProperty('disabled', false)
    faux.erreurRpc = 'L\'exercice 2026 est validé : un encaissement de cette facture ne s\'y date plus.'
    await act(async () => { b.click() })
    await screen.findByText(faux.erreurRpc)
    // Le verrou est relâché : un nouveau clic repart.
    await act(async () => { b.click() })
    expect(faux.rpcs).toHaveLength(2)
  })

  it('le refus d’un retrait se dit au client sous ses mots : son cabinet retire le classement', async () => {
    monter({
      facture: SOURCE, client: { banque: true }, encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part()],
      mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })],
    })
    await screen.findByText('Le mouvement dont dépend cet encaissement est classé : ton cabinet retire d\'abord ce classement.')
    expect(screen.queryByText(/le cabinet retire/)).toBeNull()
  })

  it('… et ce que lit le client ne porte aucun mot du cabinet', async () => {
    const { container } = monter({
      facture: SOURCE, factures: [AVOIR], lignesEnPlus: [LIGNE_AVOIR], client: { banque: true },
      encaissements: [encaissement({ ligne_bancaire_id: 'm1' })], parts: [part()],
      mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })],
    })
    await bouton()
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
  })

  it('une facture qui n’est pas source : rien de neuf pour le client non plus', async () => {
    monter({ facture: NON_SOURCE, client: { banque: true } })
    await bouton()
    expect(screen.queryByText(/ne se lisent pas d’ici/)).toBeNull()
  })
})

describe('EncaissementsFactureModal — les lectures neuves lues en partie n’offrent aucun geste (étape VF5b)', () => {
  it.each([
    ['les exercices validés refusés', { refus: { exercices_valides: 'permission denied' } }, 'Les exercices validés du dossier'],
    ['les factures du dossier lues en partie', { muetApres: { factures_emises: 1 } }, 'Les factures du dossier'],
    ['les lignes de l’avoir lues en partie', { muetApres: { facture_lignes: 3 } }, 'Les lignes de la facture et de ses avoirs'],
  ] as const)('%s : le bandeau, ni reste ni formulaire, aucun bouton que « Fermer »', async (_nom, panne, quoi) => {
    if ('refus' in panne) faux.refus = { ...panne.refus }
    if ('muetApres' in panne) faux.muetApres = { ...panne.muetApres }
    monter({ facture: SOURCE, factures: [AVOIR], lignesEnPlus: [LIGNE_AVOIR], encaissements: [encaissement()], parts: [part()] })
    await screen.findByText(new RegExp(`^${quoi} n`))
    expect(screen.queryByText(/Reste à encaisser/)).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
  })
})

// ── LE VIREMENT MIXTE (chantier EC-Q3, étape VF5h) ─────────────────────────────────────────────────────────────────────
//
// Le crédit m1, de 1 955,50 €, porte déjà 600 € de la facture source F2027-0042 ; la fenêtre de F2027-0043, qui n'est pas
// source, y enregistre son reste. Le classement compte alors cet encaissement, et exige l'exemplaire unique et validé de sa
// facture : la fenêtre lit les pièces désignées avec le relevé, et le dit avant le clic, sans rien refuser.
describe('EncaissementsFactureModal — le virement mixte : l’exemplaire de la facture d’avant (étape VF5h)', () => {
  const RESERVE = encaissement({ id: 'es', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })
  const EXEMPLAIRE_F2 = { ...pieceEssai({ id: 'p2', facture_id: 'f2' }), statut: 'validee', type_piece: 'vente' }
  const ouvrir = async (pieces: PieceEssai[]) => {
    monter({
      facture: NON_SOURCE, factures: [SOURCE], encaissements: [RESERVE], parts: [part({ encaissement_id: 'es' })],
      mouvements: [mouvement({ id: 'm1', montant: 1955.5 })], pieces, mouvementImpose: 'm1',
    })
    await bouton()
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
  }

  it('son exemplaire désigné : les deux encaissements feront le crédit, rien ne se dit', async () => {
    await ouvrir([EXEMPLAIRE_F2])
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
    expect(screen.queryByText(/ne pourra pas se classer/)).toBeNull()
    expect(await bouton()).toHaveProperty('disabled', false)
  })

  it('sans lui : le rang 7 du classement, sous les mots de la base — et le geste reste offert', async () => {
    await ouvrir([])
    screen.getByText(/^Ce mouvement ne pourra pas se classer par ses encaissements : « Désignez d'abord l'exemplaire de la facture F2027-0043 : /)
    expect(await bouton()).toHaveProperty('disabled', false)
    expect(faux.rpcs).toEqual([])
  })
})

describe('EncaissementsFactureModal — un mouvement IMPOSÉ par la fiche d’un crédit (étape VF5c)', () => {
  const choixDuMouvement = () => screen.queryByLabelText('Mouvement du relevé (facultatif)')

  it('le mouvement ne se choisit pas : il est dit, la saisie part de sa date et du reste, et l’appel le cite', async () => {
    monter({
      facture: SOURCE, mouvementImpose: 'm1',
      mouvements: [mouvement({ id: 'm1', date: '2027-10-15', montant: 1355.5 }), mouvement({ id: 'm2', montant: 1355.5 })],
    })
    await bouton()
    expect(choixDuMouvement()).toBeNull()
    screen.getByText(/^15\/10\/2027 · VIR SEPA CLIENT FICTIF SAS · 1\s355,50\s€$/)
    screen.getByText(/^Imposé par la fiche du mouvement, dans l’onglet Banque/)
    expect(champ('Date de l’encaissement').value).toBe('2027-10-15')
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
    // Le moyen n'est jamais proposé.
    expect(champ('Moyen de paiement').value).toBe('')
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0]).toMatchObject({
      nom: 'enregistrer_encaissement',
      args: { p_facture_id: 'f1', p_date: '2027-10-15', p_montant: 1355.5, p_moyen: 'virement', p_ligne_bancaire_id: 'm1' },
    })
  })

  it.each([
    ['un crédit plus petit de quelques frais : le reste entier', 1353, '1355,50'],
    ['une remise de chèques, plus grande que la facture : le reste', 2000, '1355,50'],
    ['un crédit qui ne paie qu’une part : ce crédit', 500, '500,00'],
  ] as const)('%s', async (_nom, credit, attendu) => {
    monter({ facture: SOURCE, mouvementImpose: 'm1', mouvements: [mouvement({ id: 'm1', montant: credit })] })
    await bouton()
    expect(champ('Montant encaissé (€)').value).toBe(attendu)
  })

  it('ce que les encaissements d’autres factures sources font déjà du crédit est déduit', async () => {
    const autre = facture({ id: 'f2', numero: 'F2027-0043', source_de_la_vente: true })
    monter({
      facture: SOURCE, factures: [autre], mouvementImpose: 'm1', mouvements: [mouvement({ id: 'm1', montant: 1900 })],
      encaissements: [encaissement({ id: 'e2', facture_id: 'f2', montant: 600, ligne_bancaire_id: 'm1' })],
      parts: [part({ encaissement_id: 'e2' })],
    })
    await bouton()
    expect(champ('Montant encaissé (€)').value).toBe('1300,00')
  })

  it('un mouvement imposé que la base refuserait : le refus avant le clic, le bouton grisé, rien ne part', async () => {
    monter({
      facture: SOURCE, mouvementImpose: 'm1',
      mouvements: [mouvement({ id: 'm1', statut: 'rapprochee', categorie_id: 'k1' })],
    })
    await bouton()
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    screen.getByText(/^Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement/)
    expect(await bouton()).toHaveProperty('disabled', true)
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs).toEqual([])
  })

  it('un mouvement imposé que la fenêtre n’a pas lu reste imposé : la saisie le cite, et la base dit son refus', async () => {
    monter({ facture: SOURCE, mouvementImpose: 'm-inconnu', mouvements: [mouvement({ id: 'm1' })] })
    await bouton()
    screen.getByText('Mouvement introuvable parmi ceux du relevé lus ici.')
    fireEvent.change(champ('Date de l’encaissement'), { target: { value: '2027-10-20' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    screen.getByText('Ce mouvement n\'est pas un mouvement de ce dossier.')
    expect(await bouton()).toHaveProperty('disabled', true)
  })

  it('après l’enregistrement, la saisie relue repart du même mouvement imposé', async () => {
    monter({ facture: SOURCE, mouvementImpose: 'm1', mouvements: [mouvement({ id: 'm1', montant: 2000 })] })
    await bouton()
    fireEvent.change(champ('Montant encaissé (€)'), { target: { value: '1000' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'cheque' } })
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs).toHaveLength(1)
    // 2 000 € de crédit, 1 000 € déjà portés : 1 000 € à faire, et 355,50 € de reste à la facture.
    await screen.findByText(/^Encaissement enregistré/)
    expect(champ('Montant encaissé (€)').value).toBe('355,50')
    expect(choixDuMouvement()).toBeNull()
    expect(onUpdated).toHaveBeenCalled()
  })
})

describe('EncaissementsFactureModal — une contre-passation IMPOSÉE par la fiche d’un débit (étape VF5d)', () => {
  // Le chèque de 600 € du 05/10/2027, déclaré (e1), revenu impayé le 28/10/2027 : la fiche de ce débit ouvre la fenêtre
  // sur sa contre-passation, ce débit imposé. Un autre débit libre, pour que le choix d'hier ait de quoi s'offrir.
  const DEBITS = [
    mouvement({ id: 'm1', montant: 1355.5 }),
    mouvement({ id: 'juste', montant: -600, date: '2027-10-28', libelle: 'CHQ IMPAYE 0001' }),
    mouvement({ id: 'presque', montant: -599, date: '2027-10-29', libelle: 'CHQ IMPAYE 0002' }),
  ]
  const IMPOSEE: ContrePassationImposee = { encaissementId: 'e1', ligneBancaireId: 'juste' }
  const monterImposee = (o: Parameters<typeof monter>[0] = {}) =>
    monterDeclarations({ facture: SOURCE, mouvements: DEBITS, contrePassationImposee: IMPOSEE, ...o })
  const enregistrerCp = () => screen.getByRole('button', { name: 'Enregistrer la contre-passation' })
  const etape = () => screen.findByRole('heading', { name: /^Contre-passer l’encaissement du 05\/10\/2027/ })
  const choixDuDebit = () => screen.queryByLabelText('Débit qui défait l’encaissement (facultatif)')

  it('l’étape s’ouvre d’elle-même : le débit se dit sans se choisir, sa date est proposée ; le motif reste à saisir', async () => {
    monterImposee()
    await etape()
    expect(choixDuDebit()).toBeNull()
    screen.getByText(/^28\/10\/2027 · CHQ IMPAYE 0001 · -600,00\s€$/)
    screen.getByText(/^Imposé par la fiche du débit, dans l’onglet Banque/)
    expect(champ('Date du décaissement').value).toBe('2027-10-28')
    expect(champ(LIBELLE_MOTIF_CONTRE_PASSATION).value).toBe('')
    screen.getByText('Le motif de la contre-passation est à renseigner.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    expect(faux.rpcs).toEqual([])
  })

  it('la date se corrige dans les bornes de la base : avant l’encaissement ou dans l’avenir, refusée avant le clic', async () => {
    monterImposee()
    await etape()
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-10-04' } })
    screen.getByText('Une contre-passation ne se date pas avant l\'encaissement qu\'elle annule, du 05/10/2027.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-11-03' } })
    screen.getByText('Une contre-passation ne se date pas dans l\'avenir : nous sommes le 02/11/2027.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-10-30' } })
    expect(enregistrerCp()).toHaveProperty('disabled', false)
  })

  it.each([2, 3])('%i clics : un seul appel, ce débit en cinquième paramètre et la date corrigée, nommés par la confirmation', async (clics) => {
    monterImposee()
    await etape()
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-10-30' } })
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirLectures = true
    const b = enregistrerCp()
    await act(async () => { for (let i = 0; i < clics; i++) b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: 'd1', p_encaissement_id: 'e1', p_date: '2027-10-30', p_motif: 'Chèque revenu impayé', p_ligne_bancaire_id: 'juste' },
    }])
    expect(confirmation).toHaveBeenCalledTimes(1)
    expect(confirmation.mock.calls[0][0]).toContain('Elle cite le débit qui défait l’encaissement : 28/10/2027 · CHQ IMPAYE 0001, -600,00')
    await act(async () => { faux.libererLectures?.() })
    expect(onUpdated).toHaveBeenCalledTimes(1)
    // Relue : l'étape ne se rouvre pas d'elle-même.
    await screen.findByText(/^Contre-passation enregistrée/)
    expect(screen.queryByRole('heading', { name: /^Contre-passer l’encaissement/ })).toBeNull()
  })

  it('une confirmation refusée : rien ne part', async () => {
    monterImposee()
    await etape()
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs).toEqual([])
  })

  it('« Annuler », puis « Contre-passer » sur sa ligne : l’étape revient, le débit toujours imposé, sa date reproposée', async () => {
    monterImposee()
    await etape()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('heading', { name: /^Contre-passer l’encaissement/ })).toBeNull()
    const l = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
    fireEvent.click(within(l).getByRole('button', { name: 'Contre-passer' }))
    await etape()
    expect(choixDuDebit()).toBeNull()
    expect(champ('Date du décaissement').value).toBe('2027-10-28')
  })

  it('un autre encaissement de la facture se contre-passe comme hier : le débit se choisit, la date n’est pas proposée', async () => {
    monterImposee({ declarations: [declaration(), declaration({ id: 'te2', encaissement_id: 'e2', cree_le: '2027-10-21T08:00:00Z' })] })
    await etape()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    const l = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 21/10/2027')
    fireEvent.click(within(l).getByRole('button', { name: 'Contre-passer' }))
    await screen.findByRole('heading', { name: /^Contre-passer l’encaissement du 20\/10\/2027/ })
    expect(choixDuDebit()).not.toBeNull()
    expect(champ('Date du décaissement').value).toBe('')
  })

  it('un débit que la fenêtre n’a pas lu reste imposé : sa date ne se propose pas, et la base dit son refus avant le clic', async () => {
    monterImposee({ contrePassationImposee: { encaissementId: 'e1', ligneBancaireId: 'inconnu' } })
    await etape()
    screen.getByText('Mouvement introuvable parmi ceux du relevé lus ici.')
    expect(champ('Date du décaissement').value).toBe('')
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-10-30' } })
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    screen.getByText('Ce mouvement n\'est pas un mouvement de ce dossier.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
  })

  it('des déclarations lues en partie : le bandeau, aucune étape, aucun bouton que « Fermer »', async () => {
    faux.muetApres = { transmissions_encaissements: 0 }
    monterImposee()
    await screen.findByText(/^Les déclarations des encaissements n/)
    expect(screen.queryByRole('heading', { name: /^Contre-passer l’encaissement/ })).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Fermer'])
  })
})

// ── L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ (chantier EC-Q3, étape VF5d2 ; migration impaye_non_declare) ────────────────
//
// Le chèque de 600 € du 05/10/2027 (e1), JAMAIS déclaré, d'une facture SOURCE acceptée par une plateforme, revenu impayé
// le 28/10/2027 : il se retire, comme hier, ou se contre-passe en citant ce débit — obligatoire ici —, et ni lui ni sa
// contre-passation ne se déclarent. Ce que ces cas gardent : l'offre de « Contre-passer » et ses conditions, le débit
// obligatoire dit avant le clic, le refus de la base tant qu'il manque, l'appel, la confirmation, et la paire relue, qui ne
// dit ni « à déclarer » ni échéance.
describe('EncaissementsFactureModal — l’impayé d’un encaissement jamais déclaré (étape VF5d2)', () => {
  const DEBITS = [
    mouvement({ id: 'm1', montant: 1355.5 }),
    mouvement({ id: 'loin', montant: -550, date: '2027-10-27', libelle: 'PRLV FICTIF' }),
    mouvement({ id: 'juste', montant: -600, date: '2027-10-28', libelle: 'CHQ IMPAYE 0001' }),
    mouvement({ id: 'presque', montant: -599, date: '2027-10-29', libelle: 'CHQ IMPAYE 0002' }),
    mouvement({ id: 'classe', montant: -600, date: '2027-10-30', libelle: 'CHQ CLASSE', statut: 'rapprochee', piece_id: 'p9' }),
  ]
  const monterImpaye = (o: Parameters<typeof monter>[0] = {}) => monter({
    facture: SOURCE, transmissions: [acceptee()], mouvements: DEBITS,
    encaissements: [encaissement()], parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 })], ...o,
  })
  // La contre-passation de e1 déjà enregistrée, citant le débit, et jamais déclarée : la paire.
  const PAIRE: Parameters<typeof monter>[0] = {
    encaissements: [
      encaissement(),
      encaissement({
        id: 'e9', date_encaissement: '2027-10-28', montant: -600, annule_id: 'e1', motif: 'Chèque revenu impayé', ligne_bancaire_id: 'juste',
      }),
    ],
    parts: [part({ montant: 500 }), part({ taux: 0, montant: 100 }), part({ encaissement_id: 'e9', montant: -500 }),
      part({ encaissement_id: 'e9', taux: 0, montant: -100 })],
  }
  const ligneE1 = () => ligneDe('À déclarer sur flux.plateforme-demo.fr')
  const ligneCp = () => ligneDe(/^Annule l’encaissement du 05\/10\/2027 de 600,00\s€/)
  const debit = () => screen.getByLabelText('Débit qui défait l’encaissement (obligatoire)') as HTMLSelectElement
  const enregistrerCp = () => screen.getByRole('button', { name: 'Enregistrer la contre-passation' })
  const etape = () => screen.findByRole('heading', { name: /^Contre-passer l’encaissement du 05\/10\/2027/ })
  const ouvrir = async () => {
    fireEvent.click(within(await ligneE1()).getByRole('button', { name: 'Contre-passer' }))
    await etape()
  }
  const saisir = (libelleMotif = LIBELLE_MOTIF_CONTRE_PASSATION) => {
    fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-11-01' } })
    fireEvent.change(champ(libelleMotif), { target: { value: 'Chèque revenu impayé' } })
  }
  const NON_DECLARE = 'Cet encaissement n\'est pas déclaré : il se retire, sans contre-passation.'
  // La cellule des gestes d'une ligne, en entier : ses boutons, et ce qu'elle dit à côté — rien de plus.
  const gestes = (ligne: HTMLElement) => [...ligne.querySelectorAll('td')].at(-1)?.textContent
  const PAIRE_DITE = 'Contre-passé avant d’être déclaré : ni l’encaissement ni sa contre-passation ne se déclarent.'
  const DECLAREE_AILLEURS = 'S’il l’a été sur la plateforme sans être inscrit ici, « Déclaré sur la plateforme » l’inscrit : sa '
    + 'contre-passation se déclare alors à son tour.'

  it('« Contre-passer » s’offre à côté de « Retirer », sans qu’aucun refus ne se dise sur la ligne', async () => {
    monterImpaye()
    const ligne = await ligneE1()
    expect(gestes(ligne)).toBe('RetirerDéclaré sur la plateformeContre-passer')
    // Rien ne l'a encore défait : toujours à déclarer, avec son échéance.
    within(ligne).getByText('Paiements d’octobre 2027 : à déclarer au plus tard le 10/11/2027.')
  })

  it('l’étape dit le débit obligatoire avant le clic ; tant qu’il manque, le refus de la base, et rien ne part', async () => {
    monterImpaye()
    await ouvrir()
    screen.getByText(/^Cet encaissement n’a jamais été déclaré : il se retire — ou, quand la banque l’a défait/)
    screen.getByText(/Ni lui ni sa contre-passation ne se déclarent\.$/)
    expect(screen.queryByText(/qui se déclare à\s+son tour/)).toBeNull()
    expect([...debit().options].map((o) => o.value)).toEqual(['', 'juste', 'presque', 'loin'])
    expect(debit().options[0].textContent).toBe('Choisir le débit…')
    expect(debit().value).toBe('')
    screen.getByText(/obligatoire ici, l’encaissement n’ayant jamais été déclaré\./)
    saisir()
    screen.getByText(NON_DECLARE)
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    // Un débit trop petit : le refus du rang 19, comme pour un encaissement déclaré.
    fireEvent.change(debit(), { target: { value: 'loin' } })
    screen.getByText('Ce mouvement de 550,00 € justifierait 600,00 € de contre-passations : l\'écart dépasse ce que des frais bancaires expliquent.')
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    fireEvent.change(debit(), { target: { value: 'juste' } })
    expect(screen.queryByText(NON_DECLARE)).toBeNull()
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    // Revenu à « Choisir le débit… » : le refus revient, et le clic ne fait rien partir.
    fireEvent.change(debit(), { target: { value: '' } })
    screen.getByText(NON_DECLARE)
    expect(enregistrerCp()).toHaveProperty('disabled', true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs).toEqual([])
  })

  it.each([2, 3])('%i clics : un seul appel, le débit cité ; relue, la paire ne dit ni « à déclarer » ni échéance', async (clics) => {
    monterImpaye()
    await ouvrir()
    saisir()
    fireEvent.change(debit(), { target: { value: 'juste' } })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirLectures = true
    const b = enregistrerCp()
    await act(async () => { for (let i = 0; i < clics; i++) b.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: 'd1', p_encaissement_id: 'e1', p_date: '2027-11-01', p_motif: 'Chèque revenu impayé', p_ligne_bancaire_id: 'juste' },
    }])
    expect(confirmation).toHaveBeenCalledTimes(1)
    const texte = confirmation.mock.calls[0][0] as string
    expect(texte).toContain('Elle cite le débit qui défait l’encaissement : 28/10/2027 · CHQ IMPAYE 0001, -600,00')
    expect(texte).toContain('L’encaissement n’a jamais été déclaré : ni lui ni sa contre-passation ne se déclarent.')
    expect(texte).not.toMatch(/se déclare ensuite|sur —/)
    await act(async () => { faux.libererLectures?.() })
    expect(onUpdated).toHaveBeenCalledTimes(1)
    await screen.findByText(/^Contre-passation enregistrée : .* le 01\/11\/2027\. Elle ne se déclare pas : l’encaissement qu’elle annule ne l’a jamais été\.$/)
    expect(screen.queryByRole('heading', { name: /^Contre-passer l’encaissement/ })).toBeNull()
    // La paire relue : ni « à déclarer », ni échéance, de l'un ni de l'autre ; la contre-passation cite son débit.
    expect(screen.getAllByText(PAIRE_DITE)).toHaveLength(2)
    expect(screen.queryByText(/^À déclarer sur/)).toBeNull()
    expect(screen.queryByText(/à déclarer au plus tard/)).toBeNull()
    within(await ligneCp()).getByText('28/10/2027 · CHQ IMPAYE 0001')
  })

  it('la paire : l’encaissement garde « Déclaré sur la plateforme », dit à quoi il sert ; la contre-passation, rien', async () => {
    monterImpaye(PAIRE)
    const e1 = within(await ligneDe(DECLAREE_AILLEURS))
    e1.getByText(PAIRE_DITE)
    e1.getByText('Contre-passé')
    e1.getByRole('button', { name: 'Déclaré sur la plateforme' })
    expect(e1.queryByRole('button', { name: 'Contre-passer' })).toBeNull()
    expect(e1.queryByRole('button', { name: 'Retirer' })).toBeNull()
    const cp = within(await ligneCp())
    cp.getByText(PAIRE_DITE)
    cp.getByText('Annulation')
    expect(cp.queryByText(DECLAREE_AILLEURS)).toBeNull()
    expect(cp.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
    // Jamais déclarée, la contre-passation se retire encore.
    cp.getByRole('button', { name: 'Retirer' })
    expect(screen.getAllByRole('button', { name: 'Déclaré sur la plateforme' })).toHaveLength(1)
    expect(screen.queryByText(/à déclarer au plus tard/)).toBeNull()
  })

  it('la paire d’une facture qu’aucune plateforme n’a acceptée, ou d’une vente à un particulier : la paire dite, rien de plus', async () => {
    for (const o of [{ transmissions: [] }, { facture: facture({ source_de_la_vente: true, type_client: 'non_assujetti' }) }]) {
      const { unmount } = monterImpaye({ ...PAIRE, ...o })
      expect(await screen.findAllByText(PAIRE_DITE)).toHaveLength(2)
      expect(screen.queryByText(DECLAREE_AILLEURS)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Déclaré sur la plateforme' })).toBeNull()
      expect(screen.queryByText(/à déclarer au plus tard|Échéance dépassée/)).toBeNull()
      unmount()
    }
  })

  it('l’encaissement de la paire inscrit déclaré : la paire tombe, et sa contre-passation est à déclarer, avec son échéance', async () => {
    monterImpaye(PAIRE)
    fireEvent.click(within(await ligneDe(DECLAREE_AILLEURS)).getByRole('button', { name: 'Déclaré sur la plateforme' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { screen.getByRole('button', { name: 'Inscrire la déclaration' }).click() })
    expect(faux.rpcs.map((r) => [r.nom, r.args.p_encaissement_id])).toEqual([['declarer_encaissement_hors_application', 'e1']])
    await screen.findByText(/^Déclaré à la main sur flux\.plateforme-demo\.fr le 02\/11\/2027/)
    const cp = within(await ligneCp())
    cp.getByText('À déclarer sur flux.plateforme-demo.fr')
    cp.getByRole('button', { name: 'Déclaré sur la plateforme' })
    cp.getByText('Paiements d’octobre 2027 : à déclarer au plus tard le 10/11/2027.')
    expect(screen.queryByText(PAIRE_DITE)).toBeNull()
  })

  it('imposée par la fiche du débit : l’étape s’ouvre, le débit dit sans se choisir, et l’appel le cite', async () => {
    monterImpaye({ contrePassationImposee: { encaissementId: 'e1', ligneBancaireId: 'juste' } })
    await etape()
    screen.getByText(/^Cet encaissement n’a jamais été déclaré : il se retire/)
    expect(screen.queryByLabelText(/^Débit qui défait l’encaissement \(/)).toBeNull()
    screen.getByText(/^28\/10\/2027 · CHQ IMPAYE 0001 · -600,00\s€$/)
    expect(champ('Date du décaissement').value).toBe('2027-10-28')
    expect(screen.queryByText(NON_DECLARE)).toBeNull()
    fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Chèque revenu impayé' } })
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs).toEqual([{
      nom: 'annuler_encaissement',
      args: { p_dossier_id: 'd1', p_encaissement_id: 'e1', p_date: '2027-10-28', p_motif: 'Chèque revenu impayé', p_ligne_bancaire_id: 'juste' },
    }])
    expect(confirmation.mock.calls[0][0]).toContain('ni lui ni sa contre-passation ne se déclarent')
  })

  it('aucun débit libre au relevé : « Retirer » seul, et rien ne dit pourquoi « Contre-passer » manque', async () => {
    monterImpaye({ mouvements: [DEBITS[0], DEBITS[4]] })
    expect(gestes(await ligneE1())).toBe('RetirerDéclaré sur la plateforme')
  })

  it('une facture qui n’est pas source : « Retirer » seul, comme hier, des débits libres fussent-ils au relevé', async () => {
    monterImpaye({ facture: FACTURE })
    expect(gestes(await ligneE1())).toBe('RetirerDéclaré sur la plateforme')
  })

  it('le client « Ventes » : avec « Banque », il contre-passe sous ses mots ; sans lui, « Retirer » seul', async () => {
    const { container } = monterImpaye({ client: { banque: true } })
    await ouvrir()
    saisir(LIBELLE_MOTIF_CONTRE_PASSATION_CLIENT)
    fireEvent.change(debit(), { target: { value: 'juste' } })
    expect(enregistrerCp()).toHaveProperty('disabled', false)
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { enregistrerCp().click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['juste'])
    expect(await screen.findAllByText(PAIRE_DITE)).toHaveLength(2)
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
    cleanup()
    faux.tablesLues = []
    monterImpaye({ client: { banque: false } })
    expect(gestes(await ligneE1())).toBe('RetirerDéclaré sur la plateforme')
    expect(faux.tablesLues).not.toContain('lignes_bancaires')
  })
})

// ── LA CAISSE, ÉTAPE C6 : UN ENCAISSEMENT EN ESPÈCES NE CITE AUCUN CRÉDIT ────────────────────────────────────────────────
//
// La migration `especes_sans_mouvement` (en base) fait refuser par la garde des encaissements des espèces qui citent un
// crédit ; un resserrement vient en dernier : la fenêtre cesse d'offrir le geste AVANT que la base ne le refuse. Ce que ces
// cas gardent, et que le module (especesSansMouvement.test.ts) ne voit pas : le câblage — les espèces absentes des moyens
// d'un crédit imposé, le choix du mouvement remplacé par la phrase quand les espèces sont choisies, le mouvement choisi qui
// tombe dans la même saisie, l'appel qui part sans mouvement, dans les deux espaces —, et la ligne d'un encaissement en
// espèces figé, qui ne se dit plus « rattachable au crédit qui le paie ». Données FICTIVES.
describe('EncaissementsFactureModal — des espèces ne citent aucun crédit (la caisse, étape C6)', () => {
  const choixDuMouvement = () => screen.queryByLabelText('Mouvement du relevé (facultatif)') as HTMLSelectElement | null
  const moyens = () => [...(champ('Moyen de paiement') as unknown as HTMLSelectElement).options].map((o) => o.value)
  const PHRASE_CABINET = /^Des espèces ne citent aucun mouvement du relevé : l’encaissement s’enregistre sans mouvement, le jour où elles sont reçues\. Leur dépôt en banque se classe à part, depuis la fiche du crédit dans l’onglet Banque\.$/
  const PHRASE_CLIENT = /^Des espèces ne citent aucun mouvement du relevé : l’encaissement s’enregistre sans mouvement, le jour où tu les reçois\. Leur dépôt en banque, ton cabinet le classe à part\.$/

  it('au cabinet : le crédit choisi tombe quand les espèces sont choisies, la phrase le dit, et l’appel part sans mouvement', async () => {
    monter()
    await bouton()
    // Le crédit qui fait le reste se propose et se choisit, comme hier.
    fireEvent.change(choixDuMouvement() as HTMLSelectElement, { target: { value: 'm1' } })
    expect(champ('Date de l’encaissement').value).toBe('2027-10-15')
    expect(moyens()).toContain('especes')
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'especes' } })
    // Le choix du mouvement cède la place à la phrase ; la date et le montant de la saisie restent ceux qu'elle portait.
    expect(choixDuMouvement()).toBeNull()
    screen.getByText(PHRASE_CABINET)
    screen.getByText('Date à retenir : Le jour où les espèces sont reçues.')
    expect(champ('Montant encaissé (€)').value).toBe('1355,50')
    const enregistrer = await bouton()
    expect(enregistrer).toHaveProperty('disabled', false)
    await act(async () => { enregistrer.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0]).toMatchObject({
      nom: 'enregistrer_encaissement', args: { p_moyen: 'especes', p_ligne_bancaire_id: null, p_date: '2027-10-15' },
    })
  })

  it('… et un autre moyen ensuite rouvre le choix, sans mouvement : celui qui est tombé ne revient pas seul', async () => {
    monter()
    await bouton()
    fireEvent.change(choixDuMouvement() as HTMLSelectElement, { target: { value: 'm1' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'especes' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'cheque' } })
    expect(choixDuMouvement()?.value).toBe('')
    expect(screen.queryByText(PHRASE_CABINET)).toBeNull()
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs[0]).toMatchObject({ args: { p_moyen: 'cheque', p_ligne_bancaire_id: null } })
  })

  it('sur un crédit IMPOSÉ par la fiche d’un mouvement : les espèces ne s’offrent pas, et la phrase dit pourquoi', async () => {
    monter({ facture: SOURCE, mouvementImpose: 'm1', mouvements: [mouvement({ id: 'm1', montant: 1355.5 })] })
    await bouton()
    expect(moyens()).toEqual(['', 'virement', 'cheque', 'carte', 'prelevement', 'effet', 'compensation', 'autre'])
    screen.getByText(/hors les espèces, qui ne citent aucun crédit : leur encaissement s’enregistre sans mouvement, depuis l’onglet Factures\.$/)
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'cheque' } })
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs[0]).toMatchObject({ args: { p_moyen: 'cheque', p_ligne_bancaire_id: 'm1' } })
  })

  it('… sans crédit imposé, l’onglet Factures les offre toutes, dans l’ordre de la base', async () => {
    monter()
    await bouton()
    expect(moyens()).toEqual(['', 'virement', 'cheque', 'carte', 'prelevement', 'especes', 'effet', 'compensation', 'autre'])
  })

  it('le client « Ventes » avec « Banque » : la phrase à son adresse, sans mot du cabinet ; l’appel part sans mouvement', async () => {
    const { container } = monter({ client: { banque: true } })
    await bouton()
    fireEvent.change(choixDuMouvement() as HTMLSelectElement, { target: { value: 'm1' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'especes' } })
    expect(choixDuMouvement()).toBeNull()
    screen.getByText(PHRASE_CLIENT)
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
    await act(async () => { (await bouton()).click() })
    expect(faux.rpcs[0]).toMatchObject({ args: { p_moyen: 'especes', p_ligne_bancaire_id: null } })
  })

  it('sans « Banque », la phrase d’hier : aucun mouvement ne se lit, les espèces non plus n’en citent', async () => {
    monter({ client: { banque: false } })
    await bouton()
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'especes' } })
    screen.getByText(/^Ton accès ne porte pas « Banque » sur cette société/)
    expect(screen.queryByText(PHRASE_CLIENT)).toBeNull()
  })

  it('un encaissement en espèces d’un exercice validé ne se dit pas « rattachable au crédit qui le paie » ; le chèque, si', async () => {
    monter({ facture: SOURCE, exercices: [2027], encaissements: [encaissement({ moyen: 'especes' })], parts: [part()] })
    await bouton()
    expect(screen.queryByText(RATTACHEMENT_APRES_LA_FRONTIERE)).toBeNull()
    cleanup()
    monter({ facture: SOURCE, exercices: [2027], encaissements: [encaissement({ moyen: 'cheque' })], parts: [part()] })
    await ligneDe(RATTACHEMENT_APRES_LA_FRONTIERE)
  })
})

// ── LA CAISSE, LA RELECTURE DU 31/10/2026 : DES ESPÈCES QUI ONT DÉJÀ SERVI NE SORTENT PLUS DE LA CAISSE APRÈS LE CLIC ────
//
// Retirer, ou contre-passer sans mouvement, l'encaissement en espèces d'une facture source fait sortir ses espèces de la
// caisse ; la garde de la caisse, différée à la fin de la transaction, ne le refusait qu'APRÈS le clic. Ce que ces cas
// gardent, et que le module (caisseDesEncaissements.test.ts) ne voit pas : le câblage — la caisse et la reprise lues au
// cabinet, et pas au client ; le refus dit avant le clic, le bouton grisé, aucun appel ; la caisse pas lue qui retient le
// geste ; le client qui l'apprend de la base, sans mot du cabinet ; le drapeau baissé, la fenêtre d'hier. Données FICTIVES.
describe('EncaissementsFactureModal — la caisse juge les espèces d’une facture source avant le clic', () => {
  // 600 € reçus en espèces le 05/10/2027 (e1), versés en banque le 10/10/2027 : le versement, classé sur la caisse, les a
  // fait sortir.
  const ESPECES = encaissement({ moyen: 'especes' })
  const VERSEMENT = mouvement({
    id: 'm-vrst', montant: 600, date: '2027-10-10', libelle: 'VERSEMENT ESPECES', statut: 'rapprochee', compte_bilan: PLAN_PAR_DEFAUT.caisse,
  })
  const REFUS_RETRAIT = 'Retirer cet encaissement de 600,00 € en espèces rendrait la caisse négative le 10/10/2027 (−600,00 €) : ses espèces ont déjà servi.'
  const REFUS_CP = 'Cette contre-passation de 600,00 € en espèces rendrait la caisse négative le 20/10/2027 (−600,00 €) : la caisse n\'a plus ces espèces ce jour-là.'
  const sans = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
  const retirerBouton = () => screen.findByRole('button', { name: 'Retirer' }) as Promise<HTMLButtonElement>
  const especesSource = (o: Parameters<typeof monter>[0] = {}) =>
    monter({ facture: SOURCE, encaissements: [ESPECES], parts: [part()], mouvements: [mouvement(), VERSEMENT], ...o })

  it('le retrait : le refus de la base sous ses mots, avant le clic — le bouton grisé, ni confirmation ni appel', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = especesSource()
    const b = await retirerBouton()
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && sans(el.textContent) === REFUS_RETRAIT)
    expect(b.disabled).toBe(true)
    await act(async () => { fireEvent.click(b) })
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.rpcs).toEqual([])
    // Le cabinet lit la caisse et la reprise.
    expect(faux.tablesLues).toEqual(expect.arrayContaining(['operations_caisse', 'a_nouveaux']))
    expect(sans(container.textContent)).toContain(REFUS_RETRAIT)
  })

  it('NEUTRE : des espèces qui n’ont pas servi — le retrait part, comme hier', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    especesSource({ mouvements: [mouvement()] })
    const b = await retirerBouton()
    expect(b.disabled).toBe(false)
    expect(screen.queryByText(/rendrait la caisse négative/)).toBeNull()
    await act(async () => { b.click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['retirer_encaissement'])
  })

  it('NEUTRE : une facture qui n’est pas source, ou un autre moyen — la caisse n’en compte rien, le retrait part', async () => {
    for (const o of [{ facture: FACTURE }, { encaissements: [encaissement({ moyen: 'cheque' })] }]) {
      especesSource(o)
      expect((await retirerBouton()).disabled).toBe(false)
      expect(screen.queryByText(/rendrait la caisse négative|La caisse du dossier n’est pas lue/)).toBeNull()
      cleanup()
    }
  })

  it('la reprise refusée : la caisse n’est pas lue en entier — le retrait est retenu, et la fenêtre le dit', async () => {
    faux.refus = { a_nouveaux: 'lecture refusée' }
    especesSource({ mouvements: [mouvement()] })
    const b = await retirerBouton()
    await screen.findByText(/^La caisse du dossier n’est pas lue en entier \(la reprise du dossier : .*\) : ce geste fait sortir des espèces de la caisse/)
    expect(b.disabled).toBe(true)
    // Les autres gestes restent : seul celui qui touche la caisse est retenu.
    expect(await bouton()).toHaveProperty('disabled', true)
    fireEvent.change(champ('Date de l’encaissement'), { target: { value: '2027-10-20' } })
    fireEvent.change(champ('Moyen de paiement'), { target: { value: 'virement' } })
    expect(await bouton()).toHaveProperty('disabled', false)
  })

  describe('la contre-passation sans mouvement d’un encaissement déclaré', () => {
    const declare = (o: Parameters<typeof monter>[0] = {}) => especesSource({ transmissions: [acceptee()], declarations: [declaration()], ...o })
    const ouvrir = async () => {
      const l = await ligneDe('Déclaré à la main sur flux.plateforme-demo.fr le 06/10/2027')
      fireEvent.click(within(l).getByRole('button', { name: 'Contre-passer' }))
    }
    const enregistrerCp = () => screen.getByRole('button', { name: 'Enregistrer la contre-passation' }) as HTMLButtonElement
    const saisir = () => {
      fireEvent.change(champ('Date du décaissement'), { target: { value: '2027-10-20' } })
      fireEvent.change(champ(LIBELLE_MOTIF_CONTRE_PASSATION), { target: { value: 'Espèces rendues' } })
    }

    it('le refus de la base au jour du décaissement, le bouton grisé ; citant un débit, elle ne touche plus la caisse', async () => {
      declare({ mouvements: [mouvement(), VERSEMENT, mouvement({ id: 'juste', montant: -600, date: '2027-10-28', libelle: 'CHQ IMPAYE 0001' })] })
      await ouvrir()
      saisir()
      screen.getByText((_, el) => el?.tagName === 'P' && sans(el.textContent) === REFUS_CP)
      expect(enregistrerCp().disabled).toBe(true)
      await act(async () => { fireEvent.click(enregistrerCp()) })
      expect(faux.rpcs).toEqual([])
      fireEvent.change(screen.getByLabelText('Débit qui défait l’encaissement (facultatif)'), { target: { value: 'juste' } })
      expect(screen.queryByText(/rendrait la caisse négative/)).toBeNull()
      expect(enregistrerCp().disabled).toBe(false)
    })

    it('NEUTRE : des espèces qui n’ont pas servi — la contre-passation part, comme hier', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      declare({ mouvements: [mouvement()] })
      await ouvrir()
      saisir()
      expect(screen.queryByText(/rendrait la caisse négative/)).toBeNull()
      expect(enregistrerCp().disabled).toBe(false)
      await act(async () => { enregistrerCp().click() })
      expect(faux.rpcs.map((r) => r.nom)).toEqual(['annuler_encaissement'])
    })

    it('la caisse pas lue : retenue, quelle que soit la date', async () => {
      faux.refus = { operations_caisse: 'lecture refusée' }
      declare({ mouvements: [mouvement()] })
      await ouvrir()
      saisir()
      screen.getByText(/^La caisse du dossier n’est pas lue en entier \(les opérations de la caisse : /)
      expect(enregistrerCp().disabled).toBe(true)
    })
  })

  it('le client « Ventes » ne lit pas la caisse : le geste reste offert, et la fenêtre dit que la base en jugera — sans mot du cabinet', async () => {
    const { container } = especesSource({ client: { banque: true } })
    const b = await retirerBouton()
    expect(b.disabled).toBe(false)
    screen.getByText(CAISSE_JUGEE_PAR_LA_BASE)
    expect(faux.tablesLues).not.toContain('operations_caisse')
    expect(faux.tablesLues).not.toContain('a_nouveaux')
    expect(motsDuCabinet(container.textContent ?? '')).toEqual([])
  })

  it('le drapeau baissé : la fenêtre d’hier, au cabinet comme au client — ni lecture de la caisse, ni mot d’elle', async () => {
    drapeauCaisse.leve = false
    for (const o of [{}, { client: { banque: true } }]) {
      faux.tablesLues = []
      especesSource(o)
      expect((await retirerBouton()).disabled).toBe(false)
      expect(screen.queryByText(/rendrait la caisse négative|La caisse du dossier|Ces espèces sont dans la caisse/)).toBeNull()
      expect(faux.tablesLues).not.toContain('operations_caisse')
      expect(faux.tablesLues).not.toContain('a_nouveaux')
      cleanup()
    }
  })
})
