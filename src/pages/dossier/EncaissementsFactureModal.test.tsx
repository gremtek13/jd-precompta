import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EncaissementsFactureModal from './EncaissementsFactureModal'
import { facture as factureCii } from '../../test/facturesCii'
import type { EncaissementFacture, EncaissementFactureTaux, FactureEmise, LigneBancaire, StatutTva } from '../../lib/types'

// LA FENÊTRE DES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étape d3). Ce que ces cas gardent, et qu'aucun test du
// module d2 ne voit parce que tout vit dans le câblage : les refus de la base dits AVANT le clic et le bouton grisé
// tant qu'un refus tient ; un seul enregistrement pour plusieurs clics, et le verrou tenu jusqu'après la relecture ; une
// erreur de la base dite, et le verrou relâché ; rien de proposé sur une lecture partielle ; le retrait et sa
// confirmation, qui nomme ce qu'on retire ; la liste relue et les propositions recalculées après chaque geste. Le faux
// client APPLIQUE les filtres qui décident de ce que la fenêtre voit (src/test/filtresPostgrest.ts). Données FICTIVES.
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
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  let barriere: Promise<void> | null = null
  const executer = (nom: string, args: Record<string, unknown>) => {
    if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
    // Ce que font les deux fonctions de la base (supabase/schema/20261008180607_encaissements_des_factures.sql).
    if (nom === 'enregistrer_encaissement') {
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
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (faux.retenirRpc) return new Promise((r) => { faux.libererRpc = () => r(executer(nom, args)) })
        return Promise.resolve(executer(nom, args))
      },
      from: (table: string) => {
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown) => {
            faux.lectures += 1
            const reponse = () => {
              if (faux.refus[table]) return { data: null, error: { message: faux.refus[table] }, count: null }
              const toutes = filtrer(faux.tables[table] ?? [], predicats)
              const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
              return { data: rendu, error: null, count: toutes.length }
            }
            return (barriere ?? Promise.resolve()).then(reponse).then(suite)
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
  parts?: EncaissementFactureTaux[]; statutTva?: StatutTva | null
} = {}) {
  const f = o.facture ?? FACTURE
  // Des copies en objets nus : le faux client les modifie comme la base, et le jeu d'essai reste intact.
  const nues = (lignes: readonly object[]): Record<string, unknown>[] => lignes.map((l) => Object.fromEntries(Object.entries(l)))
  faux.tables = {
    factures_emises: nues([f, ...(o.factures ?? [])]),
    facture_lignes: LIGNES_CII.map((l, i) => ({ ...l, id: `l${i + 1}`, facture_id: f.id })),
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: nues(o.encaissements ?? []),
    encaissements_factures_taux: nues(o.parts ?? []),
    lignes_bancaires: nues(o.mouvements ?? [mouvement()]),
    reglements_groupes: [],
    pieces: [],
  }
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
  onUpdated.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('EncaissementsFactureModal — ce que la fenêtre dit avant tout geste', () => {
  it('l’obligation et sa raison, le reste par taux, aucun encaissement, et rien qui se déclare d’ici', async () => {
    monter()
    await bouton()
    screen.getByText('Due : des prestations de services, dont la TVA est due à l’encaissement.')
    screen.getByText(/rien ne se déclare d’ici/)
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
