import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EcrituresLibresSection from './EcrituresLibresSection'
import type { LectureDesEcrituresLibres } from '../../lib/ecrituresLibresVue'
import type { EcritureLibreDeLEtat } from '../../lib/ecrituresLibresDesExports'

// LA SECTION « ÉCRITURES DE L'EXPERT-COMPTABLE » (EL5) : ce qu'aucun calcul pur ne voit — une lecture partielle n'offre AUCUN
// geste ; le refus du module se dit avant le clic et retient le bouton ; deux clics dans le même `act` ne font qu'UN appel ; la
// confirmation nomme ce qui part ; le retrait passe par sa fonction seule, contre la version lue.

const faux = vi.hoisted(() => ({
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreur: null as { message: string } | null,
  tables: [] as string[],
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.rpcs.push({ nom, args })
      return new Promise((r) => setTimeout(() => r({ data: 'e-neuve', error: faux.erreur }), 0))
    },
    from: (table: string) => { faux.tables.push(table); throw new Error('aucune lecture ici') },
  },
}))

const ECRITURE: EcritureLibreDeLEtat = {
  id: 'e1', dossier_id: 'd1', exercice: 2025, numero: 1, date: '2025-06-30', libelle: 'Part privée', motif: 'Usage mixte',
  lignes: [
    { compte: '108000', sens: 'debit', centimes: 12000, poste_2035: null, compte_lib: null },
    { compte: '626200', sens: 'credit', centimes: 12000, poste_2035: 'Fournitures de bureau', compte_lib: null },
  ],
  avec_extourne: false, piece_citee_id: null, version: 4, cree_par: 'u1', cree_le: '2025-07-01T10:00:00Z', modifie_par: null, modifie_le: null,
}
const LUES: LectureDesEcrituresLibres = { dossierId: 'd1', etat: 'lues', ecritures: [ECRITURE], auteurs: new Map([['u1', 'expert@exemple.fr']]), motifDesAuteurs: null }

const relire = vi.fn(async () => {})
function monter(lecture: LectureDesEcrituresLibres | null, o: { ouverture: string | null | undefined } = { ouverture: null }) {
  const { ouverture } = o
  return render(
    <EcrituresLibresSection dossierId="d1" annee={2025} mode="tresorerie" lecture={lecture} frontiere={null} ouverture={ouverture}
      categories={[]} pieces={[]} relecture={false} relire={relire} />,
  )
}

function saisir(libelle: string, ligne: number, champ: 'Compte' | 'Montant', valeur: string) {
  const fieldset = screen.getByRole('group', { name: `Ligne ${ligne}` })
  const input = Array.from(fieldset.querySelectorAll('label')).find((l) => l.textContent?.startsWith(champ))?.querySelector('input')
  if (!input) throw new Error(`${libelle} : champ ${champ} introuvable`)
  fireEvent.change(input, { target: { value: valeur } })
}

function remplirUneEcritureEquilibree() {
  fireEvent.click(screen.getByText('Nouvelle écriture libre'))
  fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Reclassement' } })
  fireEvent.change(screen.getByLabelText(/^Motif/), { target: { value: 'Mauvais compte' } })
  saisir('débit', 1, 'Compte', '6262')
  saisir('débit', 1, 'Montant', '50')
  saisir('crédit', 2, 'Compte', '6061')
  saisir('crédit', 2, 'Montant', '50')
}

beforeEach(() => {
  faux.rpcs = []
  faux.erreur = null
  faux.tables = []
  relire.mockClear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('EcrituresLibresSection (EL5)', () => {
  it('pas encore revenue : « Chargement… », aucun geste', () => {
    monter(null)
    expect(screen.getByText('Chargement…')).toBeDefined()
    expect(screen.queryByText('Nouvelle écriture libre')).toBeNull()
  })

  it('lue en partie : le motif, et AUCUN geste — ni saisie, ni retrait, ni état', () => {
    monter({ dossierId: 'd1', etat: 'illisibles', motif: 'lecture interrompue après 500 ligne(s)' })
    expect(screen.getByText(/lecture interrompue après 500/)).toBeDefined()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('une lecture d’un autre dossier ne se montre pas', () => {
    monter({ ...LUES, dossierId: 'd2' })
    expect(screen.queryByText('Part privée')).toBeNull()
  })

  it('l’absence (le drapeau baissé) : rien ne se monte', () => {
    const { container } = monter({ dossierId: 'd1', etat: 'absentes' })
    expect(container.innerHTML).toBe('')
  })

  it('la liste de l’exercice : sa référence, ses lignes, son effet sur la 2035, son auteur', () => {
    monter(LUES)
    expect(screen.getByText('EL2025-0001')).toBeDefined()
    expect(screen.getByText(/2035 : Fournitures de bureau/)).toBeDefined()
    expect(screen.getByText(/expert@exemple\.fr/)).toBeDefined()
  })

  it('le refus se dit avant le clic et retient le bouton ; l’équilibre se lit', () => {
    monter(LUES)
    fireEvent.click(screen.getByText('Nouvelle écriture libre'))
    saisir('banque', 1, 'Compte', '512')
    saisir('banque', 1, 'Montant', '10')
    expect(screen.getByText(/Le 512 est le compte du relevé/)).toBeDefined()
    expect(screen.getByText(/écart de/)).toBeDefined()
    expect((screen.getByText('Passer l’écriture') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Passer l’écriture'))
    expect(faux.rpcs).toHaveLength(0)
  })

  it('sans à-nouveaux lus en entier, aucune saisie ne s’ouvre', () => {
    monter(LUES, { ouverture: undefined })
    expect((screen.getByText('Nouvelle écriture libre') as HTMLButtonElement).disabled).toBe(true)
  })

  it('deux clics dans le même act : UN appel, par la fonction seule, la confirmation qui nomme les lignes', async () => {
    monter(LUES)
    remplirUneEcritureEquilibree()
    const bouton = screen.getByText('Passer l’écriture')
    expect((bouton as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].nom).toBe('enregistrer_ecriture_libre')
    expect(faux.rpcs[0].args).toMatchObject({ p_dossier_id: 'd1', p_version_lue: null })
    expect((faux.rpcs[0].args.p_ecritures as unknown[]).length).toBe(1)
    const confirmation = vi.mocked(window.confirm).mock.calls[0][0] as string
    expect(confirmation).toContain('626200')
    expect(confirmation).toContain('606100')
    expect(confirmation).toContain('Total : débit')
    expect(relire).toHaveBeenCalledTimes(1)
    expect(faux.tables).toEqual([])
  })

  it('une confirmation refusée n’écrit rien', () => {
    vi.mocked(window.confirm).mockReturnValue(false)
    monter(LUES)
    remplirUneEcritureEquilibree()
    fireEvent.click(screen.getByText('Passer l’écriture'))
    expect(faux.rpcs).toHaveLength(0)
  })

  it('le refus de la base se dit', async () => {
    faux.erreur = { message: 'Accès refusé à ce dossier.' }
    monter(LUES)
    remplirUneEcritureEquilibree()
    await act(async () => {
      fireEvent.click(screen.getByText('Passer l’écriture'))
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(screen.getByText(/Accès refusé à ce dossier/)).toBeDefined()
  })

  it('le retrait : sa fonction seule, contre la version lue, un seul appel pour deux clics', async () => {
    monter(LUES)
    const bouton = screen.getByText('Retirer')
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_ecriture_libre', args: { p_id: 'e1', p_version_lue: 4 } }])
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('EL2025-0001')
  })

  it('« Modifier » remplit le formulaire et retient la version lue', async () => {
    monter(LUES)
    fireEvent.click(screen.getByText('Modifier'))
    expect(screen.getByText('Remplacer la version 4')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByText('Remplacer l’écriture'))
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(faux.rpcs[0].args).toMatchObject({ p_version_lue: 4 })
    expect((faux.rpcs[0].args.p_ecriture as { id: string }).id).toBe('e1')
  })
})
