import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EncaissementsFactureModal from './EncaissementsFactureModal'
import { facture as factureCii } from '../../test/facturesCii'
import type {
  EncaissementFacture, EncaissementFactureTaux, FactureEmise, FactureSuperpdpEvent, LigneBancaire, StatutFactureRecu, StatutTva,
  TransmissionEncaissement, TransmissionFacture,
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
}))

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
      faux.tables.encaissements_factures.push({
        ...e, id, date_encaissement: args.p_date, montant: -(e.montant as number), ligne_bancaire_id: null,
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
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2027-10-16T08:00:00Z', ...o,
})

const encaissement = (o: Partial<EncaissementFacture> = {}): EncaissementFacture => ({
  id: 'e1', dossier_id: 'd1', facture_id: 'f1', date_encaissement: '2027-10-05', montant: 600, moyen: 'cheque',
  ligne_bancaire_id: null, annule_id: null, motif: null, cree_par: null, cree_le: '2027-10-05T09:00:00Z', retire_le: null,
  retire_par: null, ...o,
})
const part = (o: Partial<EncaissementFactureTaux> = {}): EncaissementFactureTaux => ({
  encaissement_id: 'e1', dossier_id: 'd1', taux: 20, montant: 600, ...o,
})

const onUpdated = vi.fn()

function monter(o: {
  facture?: FactureEmise; factures?: FactureEmise[]; mouvements?: LigneBancaire[]; encaissements?: EncaissementFacture[]
  parts?: EncaissementFactureTaux[]; statutTva?: StatutTva | null; transmissions?: TransmissionFacture[]
  evenements?: FactureSuperpdpEvent[]; declarations?: TransmissionEncaissement[]; statuts?: StatutFactureRecu[]
  connexion?: unknown
} = {}) {
  const f = o.facture ?? FACTURE
  // Des copies en objets nus : le faux client les modifie comme la base, et le jeu d'essai reste intact.
  const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))
  faux.tables = {
    factures_emises: nues([f, ...(o.factures ?? [])]),
    facture_lignes: LIGNES_CII.map((l, i) => ({ ...l, id: `l${i + 1}`, facture_id: f.id })),
    transmissions_factures: nues(o.transmissions ?? []),
    facture_superpdp_events: nues(o.evenements ?? []),
    transmissions_encaissements: nues(o.declarations ?? []),
    encaissements_factures: nues(o.encaissements ?? []),
    encaissements_factures_taux: nues(o.parts ?? []),
    lignes_bancaires: nues(o.mouvements ?? [mouvement()]),
    reglements_groupes: [],
    pieces: [],
    statuts_factures_recus: nues(o.statuts ?? []),
  }
  faux.connexion = o.connexion === undefined ? null : o.connexion
  return render(
    <EncaissementsFactureModal
      dossierId="d1" facture={f} statutTva={o.statutTva === undefined ? 'redevable' : o.statutTva}
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
  const note = () => champ('Note (facultative) : qui l’a saisi, quand, sous quelle référence')
  const champsASaisir = () => [...document.querySelectorAll('.etape-encaissement tbody tr')].map((r) => r.textContent)

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
  const motif = () => champ('Motif d’annulation, que la plateforme portera')
  const saisir = (date: string, texte: string) => {
    fireEvent.change(champ('Date du décaissement'), { target: { value: date } })
    fireEvent.change(motif(), { target: { value: texte } })
  }

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
