import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModulesDuCabinetLus } from '../lib/optionsDuCabinetLecture'

// LE FOURNISSEUR DES MODULES OUVERTS (conception 56, OPT3) : le drapeau baissé, tout ouvert et AUCUNE lecture (rien ne change à
// l'écran ni dans les requêtes) ; levé, « lecture » d'abord, puis la réponse gardée avec sa clé, et le côté fermé sur un échec.

const auth = { role: 'cabinet' as 'cabinet' | 'client' | null, monCabinetId: 'c1' as string | null, dossierActifId: null as string | null }
vi.mock('./AuthContext', () => ({ useAuth: () => ({ ...auth, droitsParDossier: {} }) }))

const lectures: string[] = []
const enAttente: ((lu: ModulesDuCabinetLus) => void)[] = []
vi.mock('../lib/optionsDuCabinetLecture', () => ({
  lireLesModulesDuCabinet: (id: string) => { lectures.push(`cabinet:${id}`); return new Promise((r) => enAttente.push(r)) },
  lireLesModulesDuDossier: (id: string) => { lectures.push(`dossier:${id}`); return new Promise((r) => enAttente.push(r)) },
}))

const { OptionsDuCabinetProvider, cleDesOptions } = await import('./OptionsDuCabinetContext')
const { useModulesOuverts } = await import('./ModulesOuverts')
const { TOUS_LES_MODULES } = await import('../lib/modulesDuCabinet')

function Sonde() {
  const m = useModulesOuverts()
  return <p data-testid="sonde">{m.etat}:{m.ouverts.join(',')}</p>
}
const sonde = () => screen.getByTestId('sonde').textContent

beforeEach(() => {
  lectures.length = 0
  enAttente.length = 0
  Object.assign(auth, { role: 'cabinet', monCabinetId: 'c1', dossierActifId: null })
})
afterEach(cleanup)

describe('le drapeau baissé', () => {
  it('tout ouvert, aucune lecture, au montage comme au changement de cabinet ou de société', () => {
    const { rerender } = render(<OptionsDuCabinetProvider><Sonde /></OptionsDuCabinetProvider>)
    expect(sonde()).toBe(`lus:${TOUS_LES_MODULES.join(',')}`)
    Object.assign(auth, { role: 'client', monCabinetId: null, dossierActifId: 'd1' })
    rerender(<OptionsDuCabinetProvider><Sonde /></OptionsDuCabinetProvider>)
    expect(sonde()).toBe(`lus:${TOUS_LES_MODULES.join(',')}`)
    expect(lectures).toEqual([])
  })

  it('sans fournisseur, un écran lit tout ouvert (les écrans d’hier, rendus seuls par leurs tests)', () => {
    render(<Sonde />)
    expect(sonde()).toBe(`lus:${TOUS_LES_MODULES.join(',')}`)
  })
})

describe('le drapeau levé', () => {
  it('cabinet : « lecture » d’abord, rien d’ouvert ; puis les modules lus', async () => {
    render(<OptionsDuCabinetProvider prevues><Sonde /></OptionsDuCabinetProvider>)
    expect(sonde()).toBe('lecture:')
    expect(lectures).toEqual(['cabinet:c1'])
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'c1', ouverts: ['tenue'] }) })
    expect(sonde()).toBe('lus:tenue')
  })

  it('illisible : le côté fermé, le socle seul', async () => {
    render(<OptionsDuCabinetProvider prevues><Sonde /></OptionsDuCabinetProvider>)
    await act(async () => { enAttente[0]({ etat: 'illisibles', cle: 'c1', motif: 'refusé' }) })
    expect(sonde()).toBe('illisibles:')
  })

  it('client : la société affichée ; une réponse de la société quittée ne s’affiche pas', async () => {
    Object.assign(auth, { role: 'client', monCabinetId: null, dossierActifId: 'd1' })
    const { rerender } = render(<OptionsDuCabinetProvider prevues><Sonde /></OptionsDuCabinetProvider>)
    Object.assign(auth, { dossierActifId: 'd2' })
    rerender(<OptionsDuCabinetProvider prevues><Sonde /></OptionsDuCabinetProvider>)
    expect(lectures).toEqual(['dossier:d1', 'dossier:d2'])
    await act(async () => { enAttente[0]({ etat: 'lus', cle: 'd1', ouverts: TOUS_LES_MODULES }) })
    expect(sonde()).toBe('lecture:')
    await act(async () => { enAttente[1]({ etat: 'lus', cle: 'd2', ouverts: ['facturation'] }) })
    expect(sonde()).toBe('lus:facturation')
  })

  it('un compte du cabinet sans cabinet connu : fermé, sans lecture', () => {
    Object.assign(auth, { monCabinetId: null })
    render(<OptionsDuCabinetProvider prevues><Sonde /></OptionsDuCabinetProvider>)
    expect(sonde()).toBe('illisibles:')
    expect(lectures).toEqual([])
  })

  it('la clé : le cabinet du compte, ou la société affichée du client', () => {
    expect(cleDesOptions('cabinet', 'c1', 'd1')).toBe('cabinet:c1')
    expect(cleDesOptions('client', 'c1', 'd1')).toBe('dossier:d1')
    expect(cleDesOptions('client', null, null)).toBeNull()
    expect(cleDesOptions(null, 'c1', 'd1')).toBeNull()
  })
})
