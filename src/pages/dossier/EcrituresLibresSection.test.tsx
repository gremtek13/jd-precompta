import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EcrituresLibresSection from './EcrituresLibresSection'
import type { LectureDesEcrituresLibres } from '../../lib/ecrituresLibresVue'
import type { EcritureLibreDeLEtat } from '../../lib/ecrituresLibresDesExports'
import type { Piece } from '../../lib/types'

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

// Des pièces VALIDÉES du dossier, telles que l'onglet les lit, et une d'un autre dossier qui ne doit jamais se proposer.
const piece = (o: Partial<Piece>): Piece => ({
  id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/fictif.pdf', nom_fichier: 'fichier-fictif.pdf',
  storage_hash: null, date_piece: '2025-06-12', tiers: 'Papeterie fictive', montant_ht: 42.5, montant_tva: 0, montant_ttc: 42.5,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  vente_hors_des_factures: false, created_at: '2025-06-13T09:00:00Z', updated_at: '2025-06-13T09:00:00Z', ...o,
})
const PIECES: Piece[] = [
  piece({}),
  piece({ id: 'p2', date_piece: '2025-09-01', tiers: 'Énergie fictive', montant_ttc: 120 }),
  piece({ id: 'p9', dossier_id: 'd2', tiers: 'Autre dossier fictif' }),
]

const relire = vi.fn(async () => {})
function monter(
  lecture: LectureDesEcrituresLibres | null,
  o: { ouverture?: string | null | undefined; pieces?: Piece[]; piecesIncompletes?: string | null } = {},
) {
  const ouverture = 'ouverture' in o ? o.ouverture : null
  return render(
    <EcrituresLibresSection dossierId="d1" annee={2025} mode="tresorerie" lecture={lecture} frontiere={null} ouverture={ouverture}
      categories={[]} pieces={o.pieces ?? []} piecesIncompletes={o.piecesIncompletes ?? null} relecture={false} relire={relire} />,
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

  describe('la pièce citée, facultative (EL-Q8 (A))', () => {
    async function passer() {
      await act(async () => {
        fireEvent.click(screen.getByText('Passer l’écriture'))
        await new Promise((r) => setTimeout(r, 5))
      })
    }

    it('lues en entier : le choix ne propose que les pièces validées du dossier ; la pièce choisie part et la confirmation la nomme', async () => {
      monter(LUES, { pieces: PIECES })
      remplirUneEcritureEquilibree()
      expect(screen.getByText(/Pièce justificative/)).toBeDefined()
      fireEvent.click(screen.getByRole('button', { name: 'Choisir une pièce validée' }))
      const liste = screen.getByRole('list', { name: 'Choisir une pièce validée' })
      expect(liste.textContent).toContain('01/09/2025 — Énergie fictive')
      expect(liste.textContent).toContain('12/06/2025 — Papeterie fictive')
      expect(liste.textContent).not.toContain('Autre dossier fictif')
      expect(liste.textContent).not.toContain('fichier-fictif.pdf')
      fireEvent.click(screen.getByRole('button', { name: /01\/09\/2025 — Énergie fictive/ }))
      expect(screen.getByRole('button', { name: 'Ne rien citer' })).toBeDefined()
      await passer()
      expect(faux.rpcs).toHaveLength(1)
      expect((faux.rpcs[0].args.p_ecriture as { piece_citee_id: string | null }).piece_citee_id).toBe('p2')
      expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('Pièce citée : 01/09/2025 — Énergie fictive')
    })

    it('sans pièce choisie, l’écriture part sans pièce, et la confirmation le dit', async () => {
      monter(LUES, { pieces: PIECES })
      remplirUneEcritureEquilibree()
      await passer()
      expect((faux.rpcs[0].args.p_ecriture as { piece_citee_id: string | null }).piece_citee_id).toBeNull()
      expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain('Aucune pièce citée')
    })

    it('lues en partie : aucun choix, le motif dit, et rien n’empêche de passer l’écriture sans pièce', async () => {
      monter(LUES, { pieces: PIECES, piecesIncompletes: '3 ligne(s) lue(s) sur 9 annoncée(s)' })
      remplirUneEcritureEquilibree()
      expect(screen.getByText(/3 ligne\(s\) lue\(s\) sur 9/)).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Choisir une pièce validée' })).toBeNull()
      expect((screen.getByText('Passer l’écriture') as HTMLButtonElement).disabled).toBe(false)
      await passer()
      expect((faux.rpcs[0].args.p_ecriture as { piece_citee_id: string | null }).piece_citee_id).toBeNull()
    })

    it('la liste nomme la pièce citée ; « Modifier » la garde, « Ne rien citer » la retire de ce qui part', async () => {
      monter({ ...LUES, ecritures: [{ ...ECRITURE, piece_citee_id: 'p1' }] }, { pieces: PIECES })
      expect(screen.getByText('Pièce citée : 12/06/2025 — Papeterie fictive (42,50 € TTC · Dépense).')).toBeDefined()
      fireEvent.click(screen.getByText('Modifier'))
      fireEvent.click(screen.getByRole('button', { name: 'Ne rien citer' }))
      await act(async () => {
        fireEvent.click(screen.getByText('Remplacer l’écriture'))
        await new Promise((r) => setTimeout(r, 5))
      })
      expect((faux.rpcs[0].args.p_ecriture as { piece_citee_id: string | null }).piece_citee_id).toBeNull()
    })

    it('la pièce citée d’une écriture relue, les pièces lues en partie : elle reste citée et se dit sans être devinée', async () => {
      monter({ ...LUES, ecritures: [{ ...ECRITURE, piece_citee_id: 'p1' }] }, { pieces: PIECES, piecesIncompletes: 'lecture refusée' })
      expect(screen.getByText(/celle qui est déjà citée \(les pièces du dossier ne sont pas lues en entier\)/)).toBeDefined()
      fireEvent.click(screen.getByText('Modifier'))
      await act(async () => {
        fireEvent.click(screen.getByText('Remplacer l’écriture'))
        await new Promise((r) => setTimeout(r, 5))
      })
      expect((faux.rpcs[0].args.p_ecriture as { piece_citee_id: string | null }).piece_citee_id).toBe('p1')
    })
  })
})
