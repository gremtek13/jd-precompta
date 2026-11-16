import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// QUI A OUVERT UN ACCÈS (P1TQ2-Q1), `OUVERTURES_ATTESTEES_PREVUES` levé par le mock — l'état d'après la migration préparée
// `auteur_des_ouvertures_d_acces` : la trace, les adresses des accès retirés et les attestations lues ensemble, rien avant
// leur retour ; une arrivée attestée dite « Le cabinet », suivie de l'adresse du compte quand la session la lit dans l'équipe,
// « Le cabinet » seul sinon ; une arrivée sans attestation lue reste « Sans session » ; une lecture partielle dite à part.
// L'état d'aujourd'hui (le drapeau baissé : aucune lecture, « Sans session ») reste joué par AccesTab.trace.test.tsx.
const lectures = vi.hoisted(() => ({
  ouvertures: null as null | ((d: string) => Promise<unknown>),
  appels: 0,
}))
vi.mock('../../lib/traceDesDroits', () => ({
  TRACE_DES_DROITS_PREVUE: true, ACCES_DANS_LA_TRACE_PREVU: true, ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE: true,
}))
vi.mock('../../lib/ouverturesAttestees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ouverturesAttestees')>()), OUVERTURES_ATTESTEES_PREVUES: true,
}))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({
    dossierId, motif: null,
    lignes: [
      { id: 't-a', accesId: 'm1', clientId: 'u-m1', droit: 'acces', coche: true, geste: 'creation', auteurId: null, instant: '2026-11-16T09:00:00Z' },
      { id: 't-b', accesId: 'm2', clientId: 'u-m2', droit: 'acces', coche: true, geste: 'creation', auteurId: null, instant: '2026-11-16T08:00:00Z' },
      { id: 't-c', accesId: 'm3', clientId: 'u-m3', droit: 'acces', coche: true, geste: 'creation', auteurId: null, instant: '2026-11-16T07:00:00Z' },
    ],
  }),
  lireLesAdressesDesAccesRetires: async (dossierId: string) => ({ dossierId, motif: null, parAcces: new Map() }),
  lireLesOuverturesAttestees: (dossierId: string) => { lectures.appels += 1; return lectures.ouvertures!(dossierId) },
}))

const proprietes = {
  dossierId: 'd1',
  acces: [{ id: 'm1', email: 'un@client.example' }, { id: 'm2', email: 'deux@client.example' }, { id: 'm3', email: 'trois@client.example' }],
  listeLue: true, accesDuDossier: { etat: 'lus' as const, comptes: ['u-m1', 'u-m2', 'u-m3'] }, lectureNo: 1,
}
const parAcces = (adresse: string) => {
  const resume = screen.getByText(new RegExp(`Droits changés — ${adresse.replace('.', '\\.')}`))
  return within(resume.closest('details') as HTMLElement)
}

describe('« Droits changés », l’auteur attesté d’une ouverture d’accès', () => {
  it('nomme le compte attesté par l’adresse que la session lit, « Le cabinet » sinon, et laisse « Sans session » l’arrivée non attestée', async () => {
    lectures.ouvertures = async (dossierId) => ({
      dossierId, motif: null,
      parTrace: new Map([['t-a', 'u-chef'], ['t-b', 'u-collegue']]),
      // La session (un chef) lit son équipe ; le collègue est parti de l'équipe : sa ligne ne revient pas.
      equipe: new Map([['u-chef', 'chef@cabinet.example']]),
    })
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    await screen.findByText(/Droits changés — un@client\.example/)
    expect(parAcces('un@client.example').getByText('chef@cabinet.example')).toBeTruthy()
    expect(parAcces('un@client.example').getByText('Le cabinet').getAttribute('title')).toMatch(/^Ouvert depuis l’application/)
    expect(parAcces('deux@client.example').getByText('Le cabinet')).toBeTruthy()
    expect(parAcces('deux@client.example').queryByText(/@cabinet\.example/)).toBeNull()
    expect(parAcces('trois@client.example').getByText('Sans session')).toBeTruthy()
    // Aucun identifiant ne s'affiche, et l'onglet dit qui lit l'adresse.
    expect(document.body.textContent).not.toMatch(/u-chef|u-collegue|t-a/)
    expect(screen.getByText(/le chef du cabinet, et le compte qui l’a ouvert, y lisent aussi l’adresse de ce compte/)).toBeTruthy()
    expect(lectures.appels).toBe(1)
  })

  it('rien avant le retour des attestations : la trace revenue seule reste « Chargement… »', async () => {
    lectures.ouvertures = () => new Promise(() => {})
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('Chargement de la trace des droits…')).toBeTruthy()
    expect(screen.queryByText('Sans session')).toBeNull()
  })

  it('lues en partie : le bandeau le dit, et une arrivée sans attestation lue reste « Sans session »', async () => {
    lectures.ouvertures = async (dossierId) => ({ dossierId, motif: 'la lecture a échoué', parTrace: new Map(), equipe: new Map() })
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    await screen.findByText(/Droits changés — un@client\.example/)
    expect(screen.getByText(/Les auteurs des ouvertures d’accès/)).toBeTruthy()
    expect(parAcces('un@client.example').getByText('Sans session')).toBeTruthy()
  })
})
