import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SourceDesVentesCard, { type ReglageRendu } from './SourceDesVentesCard'
import {
  BASCULE_PAS_ENCORE_OFFERTE, CONFIRMATION_DU_RETOUR, ETAT_PAR_SES_PIECES, LIBELLE_BASCULER, LIBELLE_REVENIR,
  MOMENT_CONSEILLE, REGLAGE_NON_ENREGISTRE, ceQueLaBasculeChange, confirmationDeLaBascule, etatIllisible, listesPartielles,
  type FactureDeLaBascule, type LectureDeLaBascule,
} from '../../lib/basculeDesVentes'
import { REFUS_SOURCE_DE_LA_VENTE } from '../../lib/sourceDeLaVente'

// LA CARTE « SOURCE DES VENTES » À L'ÉCRAN (chantier EC-Q3, étape VF8b). Ce que le module (basculeDesVentes.test.ts) ne voit
// pas : que l'écran n'offre rien avant la lecture ni sur une lecture partielle, qu'il suit le drapeau dans ses deux états, que
// le membre de l'équipe ne voit jamais le geste, que la confirmation nommant les chiffres part AVANT l'écriture, qu'une seule
// écriture part de deux clics du même rendu, qu'elle est relue, et que ce que la base rend va à la page. La lecture est
// doublée (basculeDesVentesLecture.test.ts la garde), le client aussi : une écriture `update` relue par `maybeSingle`.
// Données FICTIVES.
const faux = vi.hoisted(() => ({
  offerte: true,
  chef: true,
  // Ce que chaque lecture rend, par dossier, et la porte qui retient la prochaine.
  lectures: {} as Record<string, LectureDeLaBascule>,
  lues: [] as string[],
  porteLecture: null as Promise<void> | null,
  // La porte de la lecture d'UN dossier : deux lectures qui reviennent dans l'ordre qu'on choisit.
  portesParDossier: {} as Record<string, Promise<void> | undefined>,
  // L'écriture : ce qui part, la porte qui la retient, et la réponse de la base.
  ecritures: [] as { table: string; valeurs: Record<string, unknown>; id: unknown; colonnes: string }[],
  porteEcriture: null as Promise<void> | null,
  erreur: null as { message: string; code?: string } | null,
  aucuneLigne: false,
  leve: null as unknown,
}))

vi.mock('../../lib/basculeDesVentes', async (original) => {
  const vrai = await original<typeof import('../../lib/basculeDesVentes')>()
  return { ...vrai, get BASCULE_OFFERTE() { return faux.offerte } }
})

vi.mock('../../lib/basculeDesVentesLecture', () => ({
  lireLaBascule: async (dossierId: string) => {
    faux.lues.push(dossierId)
    await faux.porteLecture
    await faux.portesParDossier[dossierId]
    return faux.lectures[dossierId]
  },
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ estChef: faux.chef }) }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let valeurs: Record<string, unknown> = {}
      let id: unknown = null
      const c = {
        update: (v: Record<string, unknown>) => { valeurs = v; return c },
        eq: (_colonne: string, valeur: unknown) => { id = valeur; return c },
        select: (colonnes: string) => {
          faux.ecritures.push({ table, valeurs, id, colonnes })
          return c
        },
        maybeSingle: async () => {
          await faux.porteEcriture
          if (faux.leve) throw faux.leve
          if (faux.erreur) return { data: null, error: faux.erreur }
          if (faux.aucuneLigne) return { data: null, error: null }
          // La garde date la bascule elle-même ; la base rend la ligne écrite.
          return {
            data: {
              ventes_par_les_factures: valeurs.ventes_par_les_factures,
              ventes_par_les_factures_depuis: valeurs.ventes_par_les_factures ? '2026-10-26T09:15:00+00:00' : null,
            },
            error: null,
          }
        },
      }
      return c
    },
  },
}))

const facture = (o: Partial<FactureDeLaBascule> & Pick<FactureDeLaBascule, 'id'>): FactureDeLaBascule => ({
  numero: `F-${o.id}`, type: 'facture', statut: 'validee', validated_at: '2026-03-01T10:00:00+00:00',
  source_de_la_vente: false, date_emission: '2026-03-01', ...o,
})

// Deux factures validées en 2026 et une en 2025 ; trois pièces de vente à valider.
const FACTURES = [facture({ id: 'f1' }), facture({ id: 'f2', date_emission: '2026-10-01' }), facture({ id: 'f0', date_emission: '2025-05-01' })]

const nonBascule = (o: Partial<LectureDeLaBascule> = {}): LectureDeLaBascule => ({
  dossierId: 'd1', reglage: { etat: 'non_bascule' }, depuis: null,
  listes: { etat: 'lues', factures: FACTURES, acces: [{ droit_ventes: false }], piecesDeVenteAValider: 3 }, ...o,
})
const bascule = (o: Partial<LectureDeLaBascule> = {}): LectureDeLaBascule =>
  nonBascule({ reglage: { etat: 'bascule' }, depuis: '2026-10-26T09:15:00+00:00', ...o })

const CONFIRMATION = confirmationDeLaBascule(2, 2026, 3)
let rendus: [string, ReglageRendu][] = []
let confirmations: string[] = []
let reponseConfirm = true

function monter(dossierId = 'd1') {
  return render(<SourceDesVentesCard dossierId={dossierId} onReglageRendu={(id, r) => { rendus.push([id, r]) }} />)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T10:00:00Z'))
  faux.offerte = true
  faux.chef = true
  faux.lectures = { d1: nonBascule() }
  faux.lues = []
  faux.porteLecture = null
  faux.portesParDossier = {}
  faux.ecritures = []
  faux.porteEcriture = null
  faux.erreur = null
  faux.aucuneLigne = false
  faux.leve = null
  rendus = []
  confirmations = []
  reponseConfirm = true
  vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { confirmations.push(m ?? ''); return reponseConfirm })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('avant la lecture, et quand elle ne permet rien', () => {
  it('rien ne s’offre avant le retour de la lecture : « Chargement… », ni état ni bouton', async () => {
    let ouvrir: () => void = () => {}
    faux.porteLecture = new Promise((r) => { ouvrir = r })
    monter()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(ETAT_PAR_SES_PIECES)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findByRole('button', { name: LIBELLE_BASCULER })).toBeTruthy()
  })

  it('une lecture partielle : l’état, la raison, et aucun geste ni chiffre', async () => {
    faux.lectures.d1 = nonBascule({ listes: { etat: 'partielles', motif: 'les accès : refus' } })
    monter()
    expect(await screen.findByText(listesPartielles('les accès : refus'))).toBeTruthy()
    expect(screen.getByText(ETAT_PAR_SES_PIECES)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(MOMENT_CONSEILLE)).toBeNull()
  })

  it('un réglage illisible : l’état le dit, aucun geste', async () => {
    faux.lectures.d1 = nonBascule({ reglage: { etat: 'illisible', motif: 'lecture refusée' } })
    monter()
    expect(await screen.findByText(etatIllisible('lecture refusée'))).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('le drapeau BASCULE_OFFERTE, dans ses deux états', () => {
  it('baissé : l’état et pourquoi, sans geste — pour un dossier qui n’a pas basculé comme pour un basculé', async () => {
    faux.offerte = false
    faux.lectures = { d1: nonBascule(), d2: bascule({ dossierId: 'd2' }) }
    monter()
    expect(await screen.findByText(BASCULE_PAS_ENCORE_OFFERTE)).toBeTruthy()
    expect(screen.getByText(ETAT_PAR_SES_PIECES)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(MOMENT_CONSEILLE)).toBeNull()
    monter('d2')
    expect(await screen.findByText('Les factures de ce dossier sont la source de leurs ventes depuis le 26/10/2026.')).toBeTruthy()
    expect(screen.getAllByText(BASCULE_PAS_ENCORE_OFFERTE)).toHaveLength(2)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('levé, au chef : ce qui change, chiffres compris, le moment conseillé, et le geste', async () => {
    monter()
    expect(await screen.findByRole('button', { name: LIBELLE_BASCULER })).toBeTruthy()
    for (const phrase of ceQueLaBasculeChange(2, 2026, 3)) expect(screen.getByText(phrase)).toBeTruthy()
    expect(screen.getByText(MOMENT_CONSEILLE)).toBeTruthy()
    expect(screen.queryByText(BASCULE_PAS_ENCORE_OFFERTE)).toBeNull()
  })
})

describe('le membre de l’équipe (VF8-Q1)', () => {
  it('voit l’état, ce qui change et la raison, jamais le geste', async () => {
    faux.chef = false
    monter()
    expect(await screen.findByText(REFUS_SOURCE_DE_LA_VENTE.find((r) => r.cle === 'reglage_reserve_au_chef')!.modele)).toBeTruthy()
    expect(screen.getByText(ceQueLaBasculeChange(2, 2026, 3)[1])).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('ni sur un dossier basculé', async () => {
    faux.chef = false
    faux.lectures.d1 = bascule()
    monter()
    expect(await screen.findByText(REFUS_SOURCE_DE_LA_VENTE.find((r) => r.cle === 'reglage_reserve_au_chef')!.modele)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('la bascule', () => {
  it('confirme en NOMMANT les chiffres lus, écrit la seule colonne du dossier, passe ce que la base rend, puis relit', async () => {
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    faux.lectures.d1 = bascule()
    await act(async () => { fireEvent.click(bouton) })
    expect(confirmations).toEqual([CONFIRMATION])
    expect(CONFIRMATION).toContain('2 factures validées en 2026')
    expect(CONFIRMATION).toContain('3 pièces de vente à valider')
    expect(faux.ecritures).toEqual([{
      table: 'dossiers', valeurs: { ventes_par_les_factures: true }, id: 'd1',
      colonnes: 'ventes_par_les_factures, ventes_par_les_factures_depuis',
    }])
    expect(rendus).toEqual([['d1', { ventes_par_les_factures: true, ventes_par_les_factures_depuis: '2026-10-26T09:15:00+00:00' }]])
    expect(faux.lues).toEqual(['d1', 'd1'])
    expect(await screen.findByText('Les factures de ce dossier sont la source de leurs ventes depuis le 26/10/2026.')).toBeTruthy()
    expect(screen.getByText('Les ventes se comptent désormais par les factures ✓')).toBeTruthy()
    expect(screen.getByRole('button', { name: LIBELLE_REVENIR })).toBeTruthy()
  })

  it('confirmation refusée : rien ne part, et le geste reste offert', async () => {
    reponseConfirm = false
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => { fireEvent.click(bouton) })
    expect(confirmations).toHaveLength(1)
    expect(faux.ecritures).toEqual([])
    reponseConfirm = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LIBELLE_BASCULER })) })
    expect(faux.ecritures).toHaveLength(1)
  })

  it('deux clics dans le même rendu : une seule confirmation, une seule écriture ; le verrou se relâche après la relecture', async () => {
    let ouvrir: () => void = () => {}
    faux.porteEcriture = new Promise((r) => { ouvrir = r })
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(confirmations).toHaveLength(1)
    expect(faux.ecritures).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Enregistrement…' })).toHaveProperty('disabled', true)
    await act(async () => { ouvrir() })
    expect(faux.lues).toEqual(['d1', 'd1'])
    faux.porteEcriture = null
    const encore = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => { fireEvent.click(encore) })
    expect(faux.ecritures).toHaveLength(2)
  })

  it('un refus de la base se dit par son message, rien ne va à la page, l’état est relu et le verrou relâché', async () => {
    faux.erreur = { message: "Seul le chef du cabinet change la source des ventes d'un dossier.", code: '42501' }
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => { fireEvent.click(bouton) })
    expect(screen.getByText("Seul le chef du cabinet change la source des ventes d'un dossier.")).toBeTruthy()
    expect(rendus).toEqual([])
    expect(faux.lues).toEqual(['d1', 'd1'])
    faux.erreur = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LIBELLE_BASCULER })) })
    expect(faux.ecritures).toHaveLength(2)
  })

  it('aucune ligne rendue : rien n’est écrit, la carte le dit et ne passe rien à la page', async () => {
    faux.aucuneLigne = true
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => { fireEvent.click(bouton) })
    expect(screen.getByText(REGLAGE_NON_ENREGISTRE)).toBeTruthy()
    expect(rendus).toEqual([])
    expect(screen.queryByText(/✓/)).toBeNull()
  })

  it('une requête qui lève se dit, et relâche le verrou', async () => {
    faux.leve = new Error('Failed to fetch')
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    await act(async () => { fireEvent.click(bouton) })
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
    faux.leve = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LIBELLE_BASCULER })) })
    expect(faux.ecritures).toHaveLength(2)
  })
})

describe('le retour aux pièces', () => {
  it('offert au chef là où la base le permet : confirmé, écrit faux, rendu à la page', async () => {
    faux.lectures.d1 = bascule()
    monter()
    const bouton = await screen.findByRole('button', { name: LIBELLE_REVENIR })
    faux.lectures.d1 = nonBascule()
    await act(async () => { fireEvent.click(bouton) })
    expect(confirmations).toEqual([CONFIRMATION_DU_RETOUR])
    expect(faux.ecritures[0].valeurs).toEqual({ ventes_par_les_factures: false })
    expect(rendus).toEqual([['d1', { ventes_par_les_factures: false, ventes_par_les_factures_depuis: null }]])
    expect(await screen.findByText(ETAT_PAR_SES_PIECES)).toBeTruthy()
  })

  it('une facture source le refuse avant le clic, en la nommant ; un accès « Ventes » aussi', async () => {
    faux.lectures.d1 = bascule({
      listes: {
        etat: 'lues', acces: [],
        factures: [...FACTURES, facture({ id: 's1', numero: 'F2026-0042', source_de_la_vente: true })],
        piecesDeVenteAValider: 0,
      },
    })
    faux.lectures.d2 = bascule({
      dossierId: 'd2',
      listes: { etat: 'lues', acces: [{ droit_ventes: true }], factures: FACTURES, piecesDeVenteAValider: 0 },
    })
    monter()
    expect(await screen.findByText('Les factures de ce dossier sont la source de leurs ventes depuis la facture F2026-0042 : '
      + 'ce réglage ne se défait pas.')).toBeTruthy()
    monter('d2')
    expect(await screen.findByText(REFUS_SOURCE_DE_LA_VENTE.find((r) => r.cle === 'reglage_retenu_par_ventes')!.modele)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('un autre dossier', () => {
  it('la lecture d’un dossier quitté, revenue APRÈS celle du suivant, ne la remplace pas', async () => {
    let ouvrirD1: () => void = () => {}
    let ouvrirD2: () => void = () => {}
    faux.portesParDossier = { d1: new Promise((r) => { ouvrirD1 = r }), d2: new Promise((r) => { ouvrirD2 = r }) }
    faux.lectures = { d1: nonBascule(), d2: bascule({ dossierId: 'd2' }) }
    const { rerender } = monter('d1')
    rerender(<SourceDesVentesCard dossierId="d2" onReglageRendu={(id, r) => { rendus.push([id, r]) }} />)
    await act(async () => { ouvrirD2() })
    expect(await screen.findByRole('button', { name: LIBELLE_REVENIR })).toBeTruthy()
    await act(async () => { ouvrirD1() })
    expect(screen.getByRole('button', { name: LIBELLE_REVENIR })).toBeTruthy()
    expect(screen.queryByText(ETAT_PAR_SES_PIECES)).toBeNull()
  })

  it('en passant au suivant, l’état et le geste du précédent ne restent pas affichés pendant sa lecture', async () => {
    let ouvrir: () => void = () => {}
    faux.lectures = { d1: nonBascule(), d2: bascule({ dossierId: 'd2' }) }
    const { rerender } = monter('d1')
    expect(await screen.findByRole('button', { name: LIBELLE_BASCULER })).toBeTruthy()
    faux.portesParDossier = { d2: new Promise((r) => { ouvrir = r }) }
    rerender(<SourceDesVentesCard dossierId="d2" onReglageRendu={(id, r) => { rendus.push([id, r]) }} />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(ETAT_PAR_SES_PIECES)).toBeNull()
    await act(async () => { ouvrir() })
    expect(await screen.findByRole('button', { name: LIBELLE_REVENIR })).toBeTruthy()
  })

  it('une écriture partie pour un dossier quitté : sa relecture ne remplace pas celle du suivant, et le rendu nomme le sien', async () => {
    let ouvrir: () => void = () => {}
    const D2 = 'Les factures de ce dossier sont la source de leurs ventes depuis le 01/09/2026.'
    faux.lectures = { d1: nonBascule(), d2: bascule({ dossierId: 'd2', depuis: '2026-09-01T08:00:00+00:00' }) }
    const { rerender } = monter('d1')
    const bouton = await screen.findByRole('button', { name: LIBELLE_BASCULER })
    faux.porteEcriture = new Promise((r) => { ouvrir = r })
    await act(async () => { fireEvent.click(bouton) })
    rerender(<SourceDesVentesCard dossierId="d2" onReglageRendu={(id, r) => { rendus.push([id, r]) }} />)
    expect(await screen.findByText(D2)).toBeTruthy()
    // La relecture du dossier quitté rendrait l'état basculé du 26/10/2026 : elle ne s'affiche pas.
    faux.lectures.d1 = bascule()
    await act(async () => { ouvrir() })
    expect(rendus.map(([id]) => id)).toEqual(['d1'])
    expect(faux.lues).toEqual(['d1', 'd2', 'd1'])
    expect(screen.getByText(D2)).toBeTruthy()
    expect(screen.queryByText(/depuis le 26\/10\/2026/)).toBeNull()
    // Ce que l'écriture a dit appartient au dossier écrit : le suivant n'en montre rien.
    expect(screen.queryByText(/✓/)).toBeNull()
    expect(screen.getByRole('button', { name: LIBELLE_REVENIR })).toBeTruthy()
  })
})
