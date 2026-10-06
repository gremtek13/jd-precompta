import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnexionBancaireCard from './ConnexionBancaireCard'
import type { CompteVu, ConnexionVue, MouvementRecupere, Recuperation } from '../../lib/connexionBancaire'
import type { LigneBancaire, RegleBancaireIgnoree } from '../../lib/types'

// LA CARTE DE CONNEXION BANCAIRE (onglet Banque, ligne 24). Ce qu'aucun test de `src/lib` ne peut voir :
//   - ce qui PART chez le prestataire, et quand — un seul appel à l'ouverture (`statut`, qui ne quitte pas
//     le serveur de l'application), tout le reste sur un clic ;
//   - ce qui s'ÉCRIT dans le relevé : seulement sur « Importer », après l'aperçu, avec le statut que les
//     règles « toujours ignorer » décident, et jamais deux fois — ni par trois clics, ni par un lot qu'une
//     lecture incomplète aurait nourri ;
//   - ce qui se DIT : une lecture refusée n'est pas « aucune banque connectée », et « Retirer quand même »
//     n'est offert que lorsque la banque n'a pas pu être prévenue.
// Le faux serveur répond PAR ACTION, et une réponse peut rester EN ATTENTE : c'est la fenêtre pendant
// laquelle un second clic arrive.

type Reponse = { data: unknown; error: unknown }

const faux = vi.hoisted(() => ({
  invocations: [] as Record<string, unknown>[],
  reponses: {} as Record<string, (() => Reponse) | 'attente'>,
  enAttente: [] as { action: string; resoudre: (v: Reponse) => void }[],
  upserts: [] as { lot: Record<string, unknown>[]; options: Record<string, unknown>; colonnes: string }[],
  // Les identifiants que la base porte DÉJÀ : l'upsert les laisse tels quels, comme `ON CONFLICT DO
  // NOTHING`, et ne les rend pas.
  dejaEnBase: new Set<string>(),
  erreurUpsert: null as string | null,
  upsertEnAttente: false,
  resoudreUpsert: null as null | (() => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (nom: string, options: { body: Record<string, unknown> }) => {
        // Bruyant : une fonction ou une action que le test n'a pas prévue doit se nommer, plutôt que de
        // rendre une réponse vide et de faire échouer l'écran loin de la cause.
        if (nom !== 'banque-connexion') throw new Error(`Fonction non attendue : ${nom}`)
        faux.invocations.push(options.body)
        const action = String(options.body.action)
        const reponse = faux.reponses[action]
        if (reponse === undefined) throw new Error(`Action non programmée dans ce test : ${action}`)
        if (reponse === 'attente') return new Promise((resolve) => { faux.enAttente.push({ action, resoudre: resolve }) })
        return Promise.resolve(reponse())
      },
    },
    from: (table: string) => {
      if (table !== 'lignes_bancaires') throw new Error(`Table non attendue : ${table}`)
      return {
        upsert: (lot: Record<string, unknown>[], options: Record<string, unknown>) => ({
          select: (colonnes: string) => {
            faux.upserts.push({ lot, options, colonnes })
            const repondre = () => {
              if (faux.erreurUpsert) return { data: null, error: { message: faux.erreurUpsert } }
              const ecrits = lot.filter((l) => !faux.dejaEnBase.has(String(l.id_externe)))
              for (const l of ecrits) faux.dejaEnBase.add(String(l.id_externe))
              return { data: ecrits.map((l) => ({ id_externe: l.id_externe })), error: null }
            }
            if (faux.upsertEnAttente) return new Promise((resolve) => { faux.resoudreUpsert = () => resolve(repondre()) })
            return Promise.resolve(repondre())
          },
        }),
      }
    },
  },
}))

const ok = (data: unknown) => (): Reponse => ({ data, error: null })
// Une réponse NEUVE à chaque appel : le corps d'une `Response` ne se lit qu'une fois.
const refus = (corps: Record<string, unknown>, status = 409) => (): Reponse =>
  ({ data: null, error: { context: new Response(JSON.stringify(corps), { status }) } })

// TYPÉS, et sans `as` : le compilateur confronte chaque champ à ce que la fonction rend.
function compte(o: Partial<CompteVu> = {}): CompteVu {
  return { empreinte: 'emp-courant', nom: 'Compte courant', devise: 'EUR', iban_fin: '0042', mouvements_lisibles: true, ...o }
}
function connexion(o: Partial<ConnexionVue> = {}): ConnexionVue {
  return {
    banque_nom: 'Mock ASPSP', banque_pays: 'FI', type_acces: 'personal', environnement: 'SANDBOX', etat: 'active',
    valide_jusqu_au: '2027-03-01T00:00:00+00:00', derniere_recuperation: null, created_at: '2026-09-30T08:00:00+00:00',
    compte_empreinte: 'emp-courant', comptes: [compte()], ...o,
  }
}
function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2026-09-01', montant: -10,
    libelle: 'PRLV SEPA FICTIF', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    created_at: '2026-09-01T09:00:00Z', ...o,
  }
}
function mouvement(o: Partial<MouvementRecupere> = {}): MouvementRecupere {
  return { id_externe: 'eb:r:1', date: '2026-09-10', libelle: 'PRLV SEPA FOURNISSEUR FICTIF', montant: -42.5, ...o }
}
function recuperation(o: Partial<Recuperation> = {}): Recuperation {
  return {
    du: '2026-09-05', au: '2026-09-30', complete: true, motif: null, mouvements: [mouvement()],
    ecartes: { non_comptabilises: 0, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 },
    banque_nom: 'Mock ASPSP', environnement: 'SANDBOX', compte: { nom: 'Compte courant', iban_fin: '0042' }, avertissement: null, ...o,
  }
}
const regle = (motif: string): RegleBancaireIgnoree =>
  ({ id: `regle-${motif}`, dossier_id: 'dossier-de-test', motif, created_at: '2026-09-01T09:00:00Z' })

// L'état que rend `statut` : une variable, pour que la RELECTURE après une action montre l'état d'après.
let etat: { configuree: boolean; connexion: ConnexionVue | null }
let confirme: boolean
const confirmations: string[] = []
const assign = vi.fn()

beforeEach(() => {
  faux.invocations = []
  faux.enAttente = []
  faux.upserts = []
  faux.dejaEnBase = new Set()
  faux.erreurUpsert = null
  faux.upsertEnAttente = false
  faux.resoudreUpsert = null
  etat = { configuree: true, connexion: null }
  faux.reponses = { statut: () => ({ data: etat, error: null }) }
  confirme = true
  confirmations.length = 0
  assign.mockReset()
  vi.stubGlobal('confirm', (message: string) => { confirmations.push(message); return confirme })
  // jsdom ne navigue pas, et `location.assign` n'y est pas redéfinissable : la page entière est doublée.
  vi.stubGlobal('location', { ...window.location, assign })
  // Seule l'HORLOGE est feinte : feindre aussi les minuteurs gèlerait `findBy…` (CLAUDE.md).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function monter(o: { lignes?: LigneBancaire[]; regles?: RegleBancaireIgnoree[]; suspension?: string | null; frontiere?: string | null } = {}) {
  const onImported = vi.fn()
  render(
    <ConnexionBancaireCard
      dossierId="dossier-de-test"
      lignes={o.lignes ?? []}
      regles={o.regles ?? []}
      suspension={o.suspension ?? null}
      frontiere={o.frontiere ?? null}
      onImported={onImported}
    />,
  )
  return { onImported }
}

const actions = () => faux.invocations.map((c) => c.action)
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement

async function recupererAvec(r: Recuperation) {
  faux.reponses.mouvements = ok(r)
  const recuperer = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
  await act(async () => { recuperer.click() })
}

describe('ce qui part chez le prestataire', () => {
  it('à l’ouverture, un seul appel — le statut, qui ne quitte pas le serveur de l’application', async () => {
    monter()
    await screen.findByRole('button', { name: 'Connecter une banque' })
    expect(faux.invocations).toEqual([{ action: 'statut', dossierId: 'dossier-de-test' }])
  })

  it('la liste des banques ne part que sur le clic, puis la demande part vers la banque choisie', async () => {
    faux.reponses.banques = ok({
      environnement: 'SANDBOX',
      banques: [
        { nom: 'Mock ASPSP', pays: 'FI', types_acces: ['business', 'personal'], accord_jours: 180 },
        { nom: 'Autre Banque', pays: 'FI', types_acces: ['personal'], accord_jours: 90 },
      ],
    })
    faux.reponses.demarrer = ok({ url: 'https://banque.exemple/accord', environnement: 'SANDBOX' })
    monter()
    const connecter = await screen.findByRole('button', { name: 'Connecter une banque' })
    expect(screen.queryByText('Bac à sable')).toBeNull()
    await act(async () => { connecter.click() })
    expect(actions()).toEqual(['statut', 'banques'])
    expect(screen.getByText('Bac à sable')).toBeTruthy()

    // L'espace professionnel d'abord, quand la banque l'offre ; le particulier se choisit.
    const espace = screen.getByLabelText('Espace de connexion') as HTMLSelectElement
    expect(espace.value).toBe('business')
    fireEvent.change(espace, { target: { value: 'personal' } })
    await act(async () => { bouton('Aller sur le site de la banque').click() })
    expect(faux.invocations.at(-1)).toEqual({
      action: 'demarrer', dossierId: 'dossier-de-test', banque: { nom: 'Mock ASPSP', pays: 'FI' }, type_acces: 'personal',
    })
    expect(assign).toHaveBeenCalledWith('https://banque.exemple/accord')
    // Le navigateur s'en va : plus rien ne part d'ici.
    expect(bouton('Aller sur le site de la banque').disabled).toBe(true)
  })

  it('une demande refusée le dit, relit la connexion, et ne quitte pas l’application', async () => {
    faux.reponses.banques = ok({ environnement: 'SANDBOX', banques: [{ nom: 'Mock ASPSP', pays: 'FI', types_acces: ['personal'], accord_jours: 180 }] })
    faux.reponses.demarrer = refus({ error: "Une connexion vient d'être lancée pour ce dossier : recharge la page." })
    monter()
    const cible = await screen.findByRole('button', { name: 'Connecter une banque' })
    await act(async () => { cible.click() })
    // Un seul espace : dit, pas demandé.
    expect(screen.queryByLabelText('Espace de connexion')).toBeNull()
    expect(screen.getByText(/Connexion par l'espace particulier de la banque/)).toBeTruthy()
    await act(async () => { bouton('Aller sur le site de la banque').click() })
    expect(screen.getByText("Une connexion vient d'être lancée pour ce dossier : recharge la page.")).toBeTruthy()
    expect(actions()).toEqual(['statut', 'banques', 'demarrer', 'statut'])
    expect(assign).not.toHaveBeenCalled()
  })
})

describe('ce qui se dit de la connexion', () => {
  it('une lecture refusée ne dit pas qu’aucune banque n’est connectée, et se réessaie', async () => {
    faux.reponses.statut = refus({ error: "La connexion bancaire de ce dossier n'a pas pu être lue (panne)." }, 503)
    monter()
    await screen.findByText("La connexion bancaire de ce dossier n'a pas pu être lue (panne).")
    expect(screen.queryByRole('button', { name: 'Connecter une banque' })).toBeNull()
    expect(screen.queryByText(/Récupère les mouvements du compte/)).toBeNull()

    faux.reponses.statut = () => ({ data: etat, error: null })
    await act(async () => { bouton('Réessayer').click() })
    expect(bouton('Connecter une banque')).toBeTruthy()
  })

  it('non configurée, elle dit quoi poser, et n’offre rien', async () => {
    etat = { configuree: false, connexion: null }
    monter()
    await screen.findByText(/ENABLE_BANKING_CLE_PRIVEE/)
    expect(screen.queryByRole('button', { name: 'Connecter une banque' })).toBeNull()
  })

  it('une connexion active sans compte choisi propose ses comptes — seulement ceux qu’on peut suivre', async () => {
    etat.connexion = connexion({
      compte_empreinte: null,
      comptes: [
        compte(),
        compte({ empreinte: 'emp-usd', nom: 'Compte dollars', devise: 'USD', iban_fin: '0077' }),
        compte({ empreinte: 'emp-bloque', nom: 'Compte fermé', mouvements_lisibles: false, iban_fin: '0099' }),
      ],
    })
    faux.reponses.choisir_compte = ok({ ok: true })
    monter()
    const choisirCompte = await screen.findAllByRole('button', { name: 'Choisir ce compte' })
    expect(choisirCompte).toHaveLength(1)
    expect(screen.getByText(/tenu en USD, et le relevé l'est en euros/)).toBeTruthy()
    expect(screen.getByText(/la banque ne rend pas ses mouvements/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Récupérer les mouvements' })).toBeNull()

    // La relecture rend l'état d'après : le compte est retenu, la récupération s'ouvre.
    etat = { configuree: true, connexion: connexion() }
    await act(async () => { choisirCompte[0].click() })
    expect(faux.invocations.find((c) => c.action === 'choisir_compte')).toEqual({
      action: 'choisir_compte', dossierId: 'dossier-de-test', empreinte: 'emp-courant',
    })
    expect(bouton('Récupérer les mouvements')).toBeTruthy()
  })

  it('le verrou tient jusqu’à ce que la connexion soit relue', async () => {
    etat.connexion = connexion({ compte_empreinte: null })
    faux.reponses.choisir_compte = ok({ ok: true })
    monter()
    const choisirCompte = await screen.findByRole('button', { name: 'Choisir ce compte' })
    faux.reponses.statut = 'attente'
    await act(async () => { choisirCompte.click() })
    // Le compte est retenu en base, mais l'écran montre encore l'état d'avant : rien ne doit partir.
    expect(bouton('Choisir ce compte').disabled).toBe(true)
    expect(bouton('Retirer la connexion').disabled).toBe(true)
    etat = { configuree: true, connexion: connexion() }
    await act(async () => { faux.enAttente.find((a) => a.action === 'statut')!.resoudre({ data: etat, error: null }) })
    expect(bouton('Récupérer les mouvements').disabled).toBe(false)
  })

  it('un accord expiré ne se récupère plus : il se renouvelle, sur la même banque', async () => {
    etat.connexion = connexion({ valide_jusqu_au: '2026-09-29T00:00:00+00:00' })
    faux.reponses.demarrer = ok({ url: 'https://banque.exemple/renouveler', environnement: 'SANDBOX' })
    monter()
    await screen.findByText(/L'accord de la banque a expiré/)
    expect(bouton('Récupérer les mouvements').disabled).toBe(true)
    await act(async () => { bouton("Renouveler l'accord").click() })
    expect(faux.invocations.at(-1)).toEqual({ action: 'demarrer', dossierId: 'dossier-de-test', renouveler: true })
    expect(assign).toHaveBeenCalledWith('https://banque.exemple/renouveler')
  })

  it('un accord qui expire sous quinze jours invite à le renouveler — pas avant', async () => {
    etat.connexion = connexion({ valide_jusqu_au: '2026-10-10T12:00:00+00:00' })
    monter()
    await screen.findByText(/L'accord expire dans 10 jours/)
    expect(bouton("Renouveler l'accord")).toBeTruthy()
    expect(bouton('Récupérer les mouvements').disabled).toBe(false)
  })

  it('un accord lointain ne dit rien de son expiration', async () => {
    etat.connexion = connexion()
    monter()
    await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    expect(screen.queryByRole('button', { name: "Renouveler l'accord" })).toBeNull()
    expect(screen.queryByText(/L'accord expire dans/)).toBeNull()
  })

  it('une demande restée en attente se reprend, sur la même banque et le même espace', async () => {
    etat.connexion = connexion({ etat: 'en_attente', valide_jusqu_au: null, compte_empreinte: null, comptes: [] })
    faux.reponses.demarrer = ok({ url: 'https://banque.exemple/reprise', environnement: 'SANDBOX' })
    faux.reponses.retirer = ok({ ok: true })
    monter()
    await screen.findByText(/n'a pas été menée à son terme/)
    await act(async () => { bouton('Reprendre').click() })
    expect(faux.invocations.at(-1)).toEqual({
      action: 'demarrer', dossierId: 'dossier-de-test', banque: { nom: 'Mock ASPSP', pays: 'FI' }, type_acces: 'personal',
    })
    expect(assign).toHaveBeenCalledWith('https://banque.exemple/reprise')
  })
})

// LA PÉRIODE APRÈS UNE PREMIÈRE LECTURE. Mesuré sur le bac à sable de BBVA le 30/09/2026 : la lecture qui
// suit l'accord a rendu 272 jours (relevé arrêté au 31/12/2025), la même a été refusée vingt-cinq secondes
// plus tard (422, « Wrong transactions period requested »). Sans nouvel accord, une banque ne rend que les
// 90 derniers jours ; proposer la période voulue ferait refuser chaque récupération.
describe('la période, après une première lecture sous l’accord en cours', () => {
  const releveArreteFin2025 = () => [ligne({ id: 'l-2025', date: '2025-12-31', id_externe: null })]

  it('se borne aux 90 derniers jours, le dit, et offre de renouveler l’accord pour remonter plus loin', async () => {
    etat.connexion = connexion({ derniere_recuperation: '2026-09-30T09:47:58+00:00' })
    faux.reponses.demarrer = ok({ url: 'https://banque.exemple/renouveler', environnement: 'SANDBOX' })
    monter({ lignes: releveArreteFin2025() })
    await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-07-03')
    expect(screen.getByText(/la période commence le 03\/07\/2026 au lieu du 01\/01\/2026/)).toBeTruthy()
    await act(async () => { bouton("Renouveler l'accord").click() })
    expect(faux.invocations.at(-1)).toEqual({ action: 'demarrer', dossierId: 'dossier-de-test', renouveler: true })
    expect(assign).toHaveBeenCalledWith('https://banque.exemple/renouveler')
  })

  // Le garde symétrique : sans lui, « se borne » serait satisfait par une carte qui borne TOUJOURS — et la
  // lecture qui suit l'accord, la seule qui puisse combler un trou du relevé, n'irait plus le combler.
  it('la lecture qui suit l’accord garde toute la période voulue, sans rien dire', async () => {
    etat.connexion = connexion()
    monter({ lignes: releveArreteFin2025() })
    await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-01-01')
    expect(screen.queryByText(/ne rend plus que les 90 derniers jours/)).toBeNull()
    expect(screen.queryByRole('button', { name: "Renouveler l'accord" })).toBeNull()
  })

  it('une lecture complète faite ici borne la suivante sans rechargement — et la note se tait devant l’aperçu', async () => {
    etat.connexion = connexion()
    monter({ lignes: releveArreteFin2025() })
    await recupererAvec(recuperation({ du: '2026-01-01', mouvements: [mouvement({ date: '2026-02-02' })] }))
    expect(faux.invocations.at(-1)).toEqual({ action: 'mouvements', dossierId: 'dossier-de-test', du: '2026-01-01', au: '2026-09-30' })
    expect(screen.getByText('1 à importer')).toBeTruthy()
    // Juste après une lecture réussie, « la banque ne rend plus que 90 jours » contredirait l'aperçu.
    expect(screen.queryByText(/ne rend plus que les 90 derniers jours/)).toBeNull()
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-07-03')
    await recupererAvec(recuperation({ du: '2026-07-03' }))
    expect(faux.invocations.at(-1)).toEqual({ action: 'mouvements', dossierId: 'dossier-de-test', du: '2026-07-03', au: '2026-09-30' })
  })

  it('une lecture INCOMPLÈTE ne borne rien : la suivante peut encore demander toute la période', async () => {
    etat.connexion = connexion()
    monter({ lignes: releveArreteFin2025() })
    await recupererAvec(recuperation({ du: '2026-01-01', complete: false, motif: 'plus de 200 pages : réduis la période demandée' }))
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-01-01')
  })

  it('une période refusée par la banque se dit avec la phrase de la fonction, et offre le renouvellement', async () => {
    etat.connexion = connexion()
    faux.reponses.mouvements = refus({
      error: 'La banque refuse cette période : sans nouvel accord, elle ne rend que les 90 derniers jours.', periode_refusee: true,
    }, 422)
    monter({ lignes: releveArreteFin2025() })
    const recuperer = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    await act(async () => { recuperer.click() })
    expect(screen.getByText(/La banque refuse cette période/)).toBeTruthy()
    expect(bouton("Renouveler l'accord")).toBeTruthy()

    // Ramenée dans les 90 jours, la période passe : la phrase et le bouton partent avec le refus.
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-07-03' } })
    await recupererAvec(recuperation({ du: '2026-07-03' }))
    expect(screen.queryByText(/La banque refuse cette période/)).toBeNull()
    expect(screen.queryByRole('button', { name: "Renouveler l'accord" })).toBeNull()
  })

  it('un autre refus n’offre pas le renouvellement', async () => {
    etat.connexion = connexion()
    faux.reponses.mouvements = refus({ error: "Le prestataire bancaire n'a pas répondu à temps. Réessaie dans un instant." }, 504)
    monter()
    const recuperer = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    await act(async () => { recuperer.click() })
    expect(screen.getByText(/n'a pas répondu à temps/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Renouveler l'accord" })).toBeNull()
  })

  it('un accord qui expire garde UN seul bouton de renouvellement, en tête de la carte', async () => {
    etat.connexion = connexion({ valide_jusqu_au: '2026-10-10T12:00:00+00:00', derniere_recuperation: '2026-09-30T09:47:58+00:00' })
    monter({ lignes: releveArreteFin2025() })
    await screen.findByText(/L'accord expire dans 10 jours/)
    expect(screen.getByText(/ne rend plus que les 90 derniers jours/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: "Renouveler l'accord" })).toHaveLength(1)
  })
})

describe('abandonner et retirer', () => {
  it('abandonner une demande en attente se confirme, et ne force rien', async () => {
    etat.connexion = connexion({ etat: 'en_attente', valide_jusqu_au: null, compte_empreinte: null, comptes: [] })
    faux.reponses.retirer = ok({ ok: true })
    monter()
    await screen.findByText(/n'a pas été menée à son terme/)
    etat = { configuree: true, connexion: null }
    await act(async () => { bouton('Abandonner').click() })
    expect(confirmations[0]).toMatch(/Abandonner la demande de connexion à Mock ASPSP/)
    expect(faux.invocations.at(-2)).toEqual({ action: 'retirer', dossierId: 'dossier-de-test', forcer: false })
    expect(bouton('Connecter une banque')).toBeTruthy()
  })

  it('une confirmation refusée n’appelle rien', async () => {
    etat.connexion = connexion()
    faux.reponses.retirer = ok({ ok: true })
    confirme = false
    monter()
    const cible = await screen.findByRole('button', { name: 'Retirer la connexion' })
    await act(async () => { cible.click() })
    expect(confirmations[0]).toMatch(/L'accord est refermé chez la banque/)
    expect(actions()).toEqual(['statut'])
  })

  it('« Retirer quand même » n’est offert que lorsque la banque n’a pas pu être prévenue', async () => {
    etat.connexion = connexion()
    faux.reponses.retirer = refus({
      error: "La banque n'a pas pu être prévenue du retrait : l'accord reste ouvert chez elle.", fermeture_impossible: true,
    }, 502)
    monter()
    const cible = await screen.findByRole('button', { name: 'Retirer la connexion' })
    await act(async () => { cible.click() })
    expect(screen.getByText(/La banque n'a pas pu être prévenue du retrait/)).toBeTruthy()

    faux.reponses.retirer = ok({ ok: true })
    etat = { configuree: true, connexion: null }
    await act(async () => { bouton('Retirer quand même').click() })
    expect(confirmations[1]).toMatch(/La banque n'a pas pu être prévenue : l'accord restera ouvert chez elle jusqu'au/)
    expect(faux.invocations.filter((c) => c.action === 'retirer')).toEqual([
      { action: 'retirer', dossierId: 'dossier-de-test', forcer: false },
      { action: 'retirer', dossierId: 'dossier-de-test', forcer: true },
    ])
    expect(bouton('Connecter une banque')).toBeTruthy()
  })

  it('un retrait refusé par la base ne se force pas', async () => {
    etat.connexion = connexion()
    faux.reponses.retirer = refus({ error: "La connexion n'a pas pu être retirée (refus)." }, 500)
    monter()
    const cible = await screen.findByRole('button', { name: 'Retirer la connexion' })
    await act(async () => { cible.click() })
    expect(screen.getByText("La connexion n'a pas pu être retirée (refus).")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer quand même' })).toBeNull()
  })
})

describe('récupérer, puis importer', () => {
  const lignesDuReleve = () => [
    ligne({ id: 'l-recupere', date: '2026-09-05', montant: -10, id_externe: 'eb:r:ancien' }),
    ligne({ id: 'l-fichier', date: '2026-09-08', montant: -20, id_externe: null }),
  ]
  const quatreMouvements = () => recuperation({
    mouvements: [
      mouvement({ id_externe: 'eb:r:ancien', date: '2026-09-05', montant: -10 }),
      mouvement({ id_externe: 'eb:r:fichier', date: '2026-09-08', montant: -20 }),
      mouvement({ id_externe: 'eb:r:assurance', date: '2026-09-12', montant: -42.5, libelle: 'PRLV SEPA ASSURANCE FICTIVE' }),
      mouvement({ id_externe: 'eb:r:client', date: '2026-09-15', montant: 100, libelle: 'VIR RECU CLIENT FICTIF' }),
    ],
  })

  it('reprend au dernier mouvement récupéré, montre ce qui entrerait, et n’écrit rien sans le clic', async () => {
    etat.connexion = connexion()
    monter({ lignes: lignesDuReleve() })
    await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-09-05')
    expect((screen.getByLabelText('Au') as HTMLInputElement).value).toBe('2026-09-30')

    await recupererAvec(quatreMouvements())
    expect(faux.invocations.at(-1)).toEqual({ action: 'mouvements', dossierId: 'dossier-de-test', du: '2026-09-05', au: '2026-09-30' })
    expect(screen.getByText('2 à importer')).toBeTruthy()
    const apercu = screen.getByText('2 à importer').parentElement!.textContent!
    expect(apercu).toContain('1 déjà importé(s)')
    expect(apercu).toContain('1 déjà dans un relevé importé en fichier')
    expect(screen.getByText('PRLV SEPA ASSURANCE FICTIVE')).toBeTruthy()
    expect(screen.queryByText('PRLV SEPA FOURNISSEUR FICTIF')).toBeNull()
    expect(faux.upserts).toEqual([])
  })

  it('une période choisie à la main est celle qui part', async () => {
    etat.connexion = connexion()
    monter()
    await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-08-31' } })
    await recupererAvec(recuperation({ du: '2026-08-01', au: '2026-08-31' }))
    expect(faux.invocations.at(-1)).toEqual({ action: 'mouvements', dossierId: 'dossier-de-test', du: '2026-08-01', au: '2026-08-31' })
  })

  it('importe ce qui manque, avec le statut des règles et la banque d’origine, puis relit le relevé', async () => {
    etat.connexion = connexion()
    const { onImported } = monter({ lignes: lignesDuReleve(), regles: [regle('assurance fictive')] })
    await recupererAvec(quatreMouvements())
    await act(async () => { bouton('Importer les 2 mouvement(s)').click() })

    expect(confirmations[0]).toMatch(/BAC À SABLE/)
    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0].options).toEqual({ onConflict: 'dossier_id,id_externe', ignoreDuplicates: true })
    expect(faux.upserts[0].colonnes).toBe('id_externe')
    expect(faux.upserts[0].lot).toEqual([
      {
        dossier_id: 'dossier-de-test', date: '2026-09-12', libelle: 'PRLV SEPA ASSURANCE FICTIVE', montant: -42.5,
        statut: 'ignoree', source_fichier: 'Connexion bancaire — Mock ASPSP', id_externe: 'eb:r:assurance',
      },
      {
        dossier_id: 'dossier-de-test', date: '2026-09-15', libelle: 'VIR RECU CLIENT FICTIF', montant: 100,
        statut: 'non_rapprochee', source_fichier: 'Connexion bancaire — Mock ASPSP', id_externe: 'eb:r:client',
      },
    ])
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/2 mouvement\(s\) importé\(s\) dans le relevé.* dont 1 ignoré\(s\) par une règle/)).toBeTruthy()
    // L'aperçu s'en va : il décrivait un relevé qui n'est plus le même.
    expect(screen.queryByRole('button', { name: /^Importer les/ })).toBeNull()
  })

  // LIGNE 26.6 (d) : un mouvement daté d'un exercice validé ne s'importe plus — la base refuserait le lot entier
  // (`garder_mouvement_valide`). Il n'est pas envoyé, et l'aperçu le dit : la banque le connaît, le relevé de
  // l'exercice validé non.
  it('n’envoie pas un mouvement daté d’un exercice validé, et le dit', async () => {
    etat.connexion = connexion()
    const { onImported } = monter({ frontiere: '2026-09-10' })
    await recupererAvec(recuperation({
      mouvements: [
        mouvement({ id_externe: 'eb:r:fige', date: '2026-09-10', montant: -15, libelle: 'PRLV FIGE FICTIF' }),
        mouvement({ id_externe: 'eb:r:ouvert', date: '2026-09-11', montant: -42.5, libelle: 'PRLV OUVERT FICTIF' }),
      ],
    }))
    expect(screen.getByText('1 à importer')).toBeTruthy()
    expect(screen.getByText(/Un mouvement daté d’un exercice validé, au plus tard le 10\/09\/2026, ne s’importe pas/)).toBeTruthy()
    expect(screen.queryByText('PRLV FIGE FICTIF')).toBeNull()
    await act(async () => { bouton('Importer les 1 mouvement(s)').click() })
    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0].lot.map((l) => l.id_externe)).toEqual(['eb:r:ouvert'])
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('plusieurs mouvements d’un exercice validé se disent au pluriel', async () => {
    etat.connexion = connexion()
    monter({ frontiere: '2026-09-10' })
    await recupererAvec(recuperation({
      mouvements: [
        mouvement({ id_externe: 'eb:r:fige1', date: '2026-09-09', montant: -15 }),
        mouvement({ id_externe: 'eb:r:fige2', date: '2026-09-10', montant: -16 }),
      ],
    }))
    expect(screen.getByText('0 à importer')).toBeTruthy()
    expect(screen.getByText(/2 mouvements datés d’un exercice validé, au plus tard le 10\/09\/2026, ne s’importent pas — un exercice validé ne reçoit plus de mouvement\. Le relevé de cet exercice ne les porte pas/)).toBeTruthy()
  })

  // Le garde symétrique : sans exercice validé, le même mouvement s'importe, et rien n'est dit.
  it('sans exercice validé, importe tout et ne dit rien', async () => {
    etat.connexion = connexion()
    monter()
    await recupererAvec(recuperation({
      mouvements: [mouvement({ id_externe: 'eb:r:fige', date: '2026-09-10', montant: -15 }), mouvement({ id_externe: 'eb:r:ouvert', date: '2026-09-11' })],
    }))
    expect(screen.getByText('2 à importer')).toBeTruthy()
    expect(screen.queryByText(/exercice validé/)).toBeNull()
  })

  it('un mouvement déjà importé entre-temps n’est pas annoncé comme importé', async () => {
    etat.connexion = connexion()
    faux.dejaEnBase.add('eb:r:assurance')
    monter({ lignes: lignesDuReleve() })
    await recupererAvec(quatreMouvements())
    await act(async () => { bouton('Importer les 2 mouvement(s)').click() })
    expect(screen.getByText(/1 mouvement\(s\) importé\(s\) dans le relevé.*1 déjà importé\(s\) entre-temps/)).toBeTruthy()
  })

  it('trois clics sur « Importer » n’écrivent qu’une fois', async () => {
    etat.connexion = connexion()
    faux.upsertEnAttente = true
    monter()
    await recupererAvec(recuperation())
    const importer = bouton('Importer les 1 mouvement(s)')
    await act(async () => { importer.click(); importer.click(); importer.click() })
    expect(faux.upserts).toHaveLength(1)
    await act(async () => { faux.resoudreUpsert!() })
    expect(faux.upserts).toHaveLength(1)
  })

  it('trois clics sur « Récupérer » ne partent qu’une fois', async () => {
    etat.connexion = connexion()
    faux.reponses.mouvements = 'attente'
    monter()
    const recuperer = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    await act(async () => { recuperer.click(); recuperer.click(); recuperer.click() })
    expect(actions().filter((a) => a === 'mouvements')).toHaveLength(1)
  })

  it('en production, l’import ne pose pas la question du bac à sable', async () => {
    etat.connexion = connexion({ environnement: 'PRODUCTION' })
    monter()
    await recupererAvec(recuperation({ environnement: 'PRODUCTION' }))
    expect(screen.queryByText('Bac à sable')).toBeNull()
    await act(async () => { bouton('Importer les 1 mouvement(s)').click() })
    expect(confirmations).toEqual([])
    expect(faux.upserts).toHaveLength(1)
  })

  it('refuser la question du bac à sable n’écrit rien', async () => {
    etat.connexion = connexion()
    confirme = false
    const { onImported } = monter()
    await recupererAvec(recuperation())
    await act(async () => { bouton('Importer les 1 mouvement(s)').click() })
    expect(faux.upserts).toEqual([])
    expect(onImported).not.toHaveBeenCalled()
  })

  it('une récupération incomplète n’importe rien, et dit pourquoi', async () => {
    etat.connexion = connexion()
    monter()
    await recupererAvec(recuperation({ complete: false, motif: 'la banque a rendu 200 pages sans finir' }))
    expect(screen.getByText(/Lecture incomplète : la banque a rendu 200 pages sans finir/)).toBeTruthy()
    const importer = bouton('Importer les 1 mouvement(s)')
    expect(importer.disabled).toBe(true)
    await act(async () => { importer.click() })
    expect(faux.upserts).toEqual([])
  })

  it('une lecture partielle de l’onglet suspend l’import', async () => {
    etat.connexion = connexion()
    monter({ suspension: 'la lecture du relevé a été interrompue' })
    await recupererAvec(recuperation())
    expect(screen.getByText(/Import suspendu : une lecture de l'onglet est incomplète \(la lecture du relevé a été interrompue\)/)).toBeTruthy()
    expect(bouton('Importer les 1 mouvement(s)').disabled).toBe(true)
  })

  it('une lecture complète n’est pas suspendue — le garde symétrique', async () => {
    etat.connexion = connexion()
    monter()
    await recupererAvec(recuperation())
    expect(screen.queryByText(/Import suspendu/)).toBeNull()
    expect(screen.queryByText(/Lecture incomplète/)).toBeNull()
    expect(bouton('Importer les 1 mouvement(s)').disabled).toBe(false)
  })

  it('un lot refusé dit où l’import s’est arrêté, et fait relire le relevé', async () => {
    etat.connexion = connexion()
    faux.erreurUpsert = 'new row violates row-level security policy'
    const { onImported } = monter()
    await recupererAvec(recuperation())
    await act(async () => { bouton('Importer les 1 mouvement(s)').click() })
    expect(screen.getByText(/L'import s'est arrêté après 0 mouvement\(s\) \(new row violates row-level security policy\)/)).toBeTruthy()
    expect(onImported).toHaveBeenCalledTimes(1)
  })

  it('ce qui a été écarté se dit', async () => {
    etat.connexion = connexion()
    monter()
    await recupererAvec(recuperation({ ecartes: { non_comptabilises: 2, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 } }))
    expect(screen.getByText(/Écartés : 2 pas encore comptabilisés par la banque/)).toBeTruthy()
  })

  it('un refus de la récupération se dit, sans aperçu', async () => {
    etat.connexion = connexion()
    faux.reponses.mouvements = refus({ error: "L'accord de la banque a expiré : renouvelle-le pour récupérer les mouvements.", accord_expire: true })
    monter()
    const cible = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    await act(async () => { cible.click() })
    await waitFor(() => expect(screen.getByText(/L'accord de la banque a expiré/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /^Importer les/ })).toBeNull()
  })
})
