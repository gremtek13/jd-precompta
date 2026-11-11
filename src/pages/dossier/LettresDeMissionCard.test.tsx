import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import { motsDuRefus, REFUS_DE_LA_PROPOSITION } from '../../lib/lettresDeMission'
import type { LectureDesLettres, LectureDesMissions } from '../../lib/lettresDeMissionLecture'
import type { LettreComplete, ModeleLu } from '../../lib/lettresDeMissionVue'
import LettresDeMissionCard from './LettresDeMissionCard'
import MissionsEnVigueurCard from './MissionsEnVigueurCard'

// L'ÉCRAN DES LETTRES DE MISSION (ligne 47, LM5). Les deux états du drapeau : baissé, aucune des deux cartes ne rend rien ni
// ne lit ; levé, la carte du dossier du cabinet dit ses lectures, n'offre aucun geste sur une lecture partielle, dit ses refus
// AVANT le clic aux mots du module, nomme dans chaque confirmation ce qui se fige, passe la fonction de la base seule sous un
// verrou (deux clics du même `act` : un appel) et fait relire ; la carte d'un client dit ses missions sans montant, et ne dit
// jamais « aucune » quand le dossier du cabinet ne lui est pas ouvert. Données FICTIVES.

const etat = vi.hoisted(() => ({
  leve: true,
  lecture: null as LectureDesLettres | null,
  missions: null as LectureDesMissions | null,
  appels: [] as [string, unknown[]][],
  lectures: 0,
}))

vi.mock('../../lib/lettresDeMission', async (original) => {
  const reel = await original<typeof import('../../lib/lettresDeMission')>()
  return { ...reel, get LETTRES_DE_MISSION_PREVUES() { return etat.leve } }
})
vi.mock('../../lib/lettresDeMissionLecture', () => {
  const geste = (nom: string) => async (...args: unknown[]) => { etat.appels.push([nom, args]); return { ok: true } }
  return {
    useLettresDuCabinet: (_d: string, _a: boolean, relecture: number) => { etat.lectures = relecture; return etat.lecture },
    useMissionsDuClient: () => etat.missions,
    enregistrerLeModele: geste('enregistrer_modele_de_lettre'),
    retirerLeModele: geste('retirer_modele_de_lettre'),
    enregistrerLeBrouillon: geste('enregistrer_brouillon_de_lettre'),
    proposerLaLettre: geste('proposer_lettre_de_mission'),
    enregistrerLaReponse: geste('enregistrer_reponse_a_la_lettre'),
    retirerLaLettre: geste('retirer_lettre_de_mission'),
  }
})
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const K = 'k0000000-0000-4000-8000-000000000001'
const C = 'c0000000-0000-4000-8000-000000000001'
const modele = (p: Partial<ModeleLu> = {}): ModeleLu => ({
  id: 'm1', titre: 'Modèle fictif', conditions_generales: 'Règles de l’Ordre.', missions: { tenue_comptable: 'Tenir.' },
  clauses: { sous_traitance: 'Clause.' }, remplace_id: null, cree_le: '2026-11-01T10:00:00Z', retire_le: null, ...p,
})
const lettre = (p: Partial<LettreComplete> = {}): LettreComplete => ({
  id: 'l1', remplace_id: null, dossier_client_id: C, date_effet: '2027-01-01', fin_initiale: '2027-12-31', reconduction_tacite: true,
  proposee_le: null, acceptee_le: null, refusee_le: null, retiree_le: null, fin_au: null, modele_id: 'm1', missions: ['tenue_comptable'],
  repartition: [{ tache: 'Déposer les pièces', par: 'client' }], honoraires: [{ forme: 'forfait', libelle: 'Tenue', montant_ht: 150, periodicite: 'mois' }],
  premier_exercice: 2027, preavis_mois: 3, signataire_nom: 'Signataire fictif', signataire_qualite: null, signataire_compte: null,
  modifiee_le: '2026-11-10T10:00:00.123456Z', identite_client: null, identite_cabinet: null, clauses: null, empreinte: null,
  mode_acceptation: null, document_signe_id: null, empreinte_papier: null, signee_le: null, cree_le: '2026-11-10T10:00:00Z', ...p,
})
const lue = (p: Partial<Extract<LectureDesLettres, { etat: 'lue' }>> = {}): LectureDesLettres => ({
  etat: 'lue', dossierId: K, modeles: [modele()], lettres: [lettre()], documents: [], clients: [{ id: C, nom: 'Client fictif', adresse: '1 rue fictive' }],
  identiteDuCabinet: { siret: '11111111111111', adresse: '2 rue fictive' }, ...p,
})

beforeEach(() => { etat.leve = true; etat.lecture = lue(); etat.missions = null; etat.appels = []; etat.lectures = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('la carte des lettres de mission', () => {
  it('baissé : rien ; levé hors du dossier du cabinet : rien', () => {
    etat.leve = false
    expect(render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />).container.innerHTML).toBe('')
    etat.leve = true
    expect(render(<LettresDeMissionCard dossierId={C} estLeDossierDuCabinet={false} />).container.innerHTML).toBe('')
  })

  it('pas revenue : « Chargement… » ; lue en partie : le motif, aucun geste', () => {
    etat.lecture = null
    const { unmount } = render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    unmount()
    etat.lecture = { etat: 'illisible', dossierId: K, motif: 'lecture tronquée' }
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    expect(screen.getByRole('alert').textContent).toContain('lecture tronquée')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('proposer : la confirmation nomme ce qui se fige, la fonction reçoit la version lue, une seule fois, puis relit', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    const bouton = screen.getByRole('button', { name: 'Proposer' })
    await act(async () => { fireEvent.click(bouton); fireEvent.click(bouton) })
    expect(confirmer.mock.calls[0][0]).toContain('« Client fictif »')
    expect(confirmer.mock.calls[0][0]).toContain('Tenue : 150,00 € HT par mois')
    expect(etat.appels).toEqual([['proposer_lettre_de_mission', [K, 'l1', '2026-11-10T10:00:00.123456Z']]])
    expect(etat.lectures).toBe(1)
    expect(await screen.findByText('Lettre proposée : elle est figée ✓')).toBeTruthy()
  })

  it('le refus de la proposition se dit AVANT le clic, aux mots de la fonction', () => {
    etat.lecture = lue({ clients: [{ id: C, nom: 'Client fictif', adresse: null }] })
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    expect((screen.getByRole('button', { name: 'Proposer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(motsDuRefus(REFUS_DE_LA_PROPOSITION, 'adresseDuClient'))).toBeTruthy()
  })

  it('un nouveau modèle : refusé avant le clic tant qu’incomplet, puis confirmé et écrit sous verrou', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau modèle' }))
    const enregistrer = screen.getByRole('button', { name: 'Enregistrer le modèle' }) as HTMLButtonElement
    expect(enregistrer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Modèle 2027' } })
    fireEvent.change(screen.getByLabelText(/^Conditions générales/), { target: { value: 'Conditions sans le mot.' } })
    fireEvent.change(screen.getByLabelText(/^Tenue de la comptabilité/), { target: { value: 'Tenir les comptes.' } })
    expect(screen.getByText(/ne nomment pas l’Ordre/)).toBeTruthy()
    await act(async () => { fireEvent.click(enregistrer); fireEvent.click(enregistrer) })
    expect(etat.appels).toHaveLength(1)
    expect(etat.appels[0]).toEqual(['enregistrer_modele_de_lettre', [K, {
      titre: 'Modèle 2027', conditions: 'Conditions sans le mot.', missions: { tenue_comptable: 'Tenir les comptes.' }, clauses: {}, remplaceId: null,
    }]])
  })

  it('la réponse sur papier : le document et la date, la confirmation qui dit que le papier ne se supprimera plus', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const p = lettre({ proposee_le: '2026-11-10T09:00:00Z', empreinte: 'a'.repeat(64), clauses: ['sous_traitance'], identite_client: {}, identite_cabinet: {} })
    etat.lecture = lue({ lettres: [p], documents: [{ id: 'd1', nom_fichier: 'signee.pdf', storage_hash: 'b'.repeat(64), created_at: '2026-11-10T12:00:00Z' }] })
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la réponse' }))
    const enregistrer = screen.getAllByRole('button', { name: 'Enregistrer la réponse' }).at(-1) as HTMLButtonElement
    expect(enregistrer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Le papier signé/), { target: { value: 'd1' } })
    fireEvent.change(screen.getByLabelText('Signé le'), { target: { value: '2026-11-10' } })
    await act(async () => { fireEvent.click(enregistrer) })
    expect(confirmer.mock.calls[0][0]).toContain('il ne se supprimera plus')
    expect(etat.appels).toEqual([['enregistrer_reponse_a_la_lettre', [K, 'l1', 'acceptee_sur_papier', 'd1', '2026-11-10']]])
  })

  it('le PDF n’est offert que pour une lettre proposée', () => {
    render(<LettresDeMissionCard dossierId={K} estLeDossierDuCabinet />)
    expect(screen.queryByRole('button', { name: 'PDF' })).toBeNull()
  })
})

describe('les missions en vigueur, dans le dossier d’un client', () => {
  it('baissé : rien ; dans le dossier du cabinet : rien', () => {
    etat.leve = false
    expect(render(<MissionsEnVigueurCard dossierId={C} estLeDossierDuCabinet={false} />).container.innerHTML).toBe('')
    etat.leve = true
    expect(render(<MissionsEnVigueurCard dossierId={K} estLeDossierDuCabinet />).container.innerHTML).toBe('')
  })

  it('le dossier du cabinet fermé à ce compte : jamais « aucune lettre »', () => {
    etat.missions = { etat: 'fermee', dossierClientId: C }
    render(<MissionsEnVigueurCard dossierId={C} estLeDossierDuCabinet={false} />)
    expect(screen.queryByText(/Aucune lettre/)).toBeNull()
    expect(screen.getByText(/ne t’est pas ouvert/)).toBeTruthy()
  })

  it('la lecture refusée par la base (LM5-Q2) : dite refusée, à ses mots, jamais « aucune lettre »', () => {
    etat.missions = { etat: 'refusee', dossierClientId: C, motif: 'Accès refusé à ce dossier.' }
    render(<MissionsEnVigueurCard dossierId={C} estLeDossierDuCabinet={false} />)
    expect(screen.queryByText(/Aucune lettre/)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('La base a refusé la lecture des lettres de mission de ce client '
      + '(Accès refusé à ce dossier.) : ce qu’elles confient au cabinet ne se dit pas ici.')
  })

  it('lue : les missions et leurs dates, aucun montant', () => {
    etat.missions = {
      etat: 'lue', dossierClientId: C, lettres: [{ ...lettre({ proposee_le: '2026-11-10T09:00:00Z', acceptee_le: '2026-11-10T12:00:00Z', date_effet: '2026-01-01' }) }],
    }
    const { container } = render(<MissionsEnVigueurCard dossierId={C} estLeDossierDuCabinet={false} />)
    expect(container.textContent).toContain('Tenue de la comptabilité')
    expect(container.textContent).not.toContain('€')
  })
})
