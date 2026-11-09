import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RestaurationCard from './RestaurationCard'
import type { EcartRestauration, ResultatRestauration, SauvegardeDossier } from '../lib/sauvegardeDonnees'
import { EXPLICATION_REDEPOSE, explicationDuDepotEchoue } from '../lib/sauvegardeLogos'
import {
  HORS_PERIMETRE_DES_SECRETS, LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL, RestaurationInterrompue, type DossierPartiel,
} from '../lib/restaurationInterrompue'

// LA CARTE DE LA RESTAURATION ET LES LOGOS DES FACTURES (étape A5c2b). Ce qu'aucun calcul pur ne voit : AVANT le clic, la
// carte dit ce que la sauvegarde porte des logos ; APRÈS, le bilan de chaque logo — redéposé, ou non et pourquoi —, que la
// relecture soit juste ou non ; un nouveau fichier choisi efface le bilan d'avant. La lecture du fichier, la restauration
// et la relecture sont simulées : leurs modules ont leurs propres tests.

const D = 'a5c00000-0000-4000-8000-0000000000d1'
const CA = `${D}/logos/${'a'.repeat(64)}.png`
const CB = `${D}/logos/${'b'.repeat(64)}.png`

const faux = vi.hoisted(() => ({
  sauvegarde: null as unknown,
  resultat: null as unknown,
  ecarts: [] as unknown[],
  restaurations: 0,
  // RESTAU-Q2 : ce que la restauration lève, et les retraits demandés (le second, s'il y en a un, resterait en attente).
  erreur: null as unknown,
  retraits: [] as unknown[],
  retraitRefuse: null as unknown,
  liberer: null as null | (() => void),
}))

vi.mock('../lib/sauvegardeFichier', () => ({ lireSauvegarde: async () => faux.sauvegarde }))
vi.mock('../lib/sauvegardeDonnees', () => ({
  restaurerSauvegarde: async () => {
    faux.restaurations += 1
    if (faux.erreur) throw faux.erreur
    return faux.resultat
  },
  verifierRestauration: async () => faux.ecarts,
  retirerDossierPartiel: (partiel: unknown) => {
    faux.retraits.push(partiel)
    return new Promise<void>((resoudre, rejeter) => {
      faux.liberer = () => (faux.retraitRefuse ? rejeter(faux.retraitRefuse) : resoudre())
    })
  },
}))

function sauvegarde(): SauvegardeDossier {
  const fichier = (chemin: string, empreinte: string) => ({ seau: 'ventes' as const, chemin, empreinte, type: 'image/png' as const, octets: 70, base64: 'AA==' })
  return {
    manifeste: {
      version: 2, dossierId: D, dossierNom: 'Atelier fictif', cabinetId: 'c1', faiteLe: '2026-10-17T10:00:00.000Z',
      lignesParTable: { dossiers: 1, parametres_facturation: 2 }, comptes: { obligatoires: [], facultatifs: [] },
      referencesExternes: [], liensPerdus: [], horsPerimetre: [],
      logos: { inclus: [{ chemin: CA, empreinte: 'a'.repeat(64), type: 'image/png', octets: 70 }], manquants: [] },
    },
    contenu: {
      dossiers: [{ id: D }],
      parametres_facturation: [
        { id: 'v1', dossier_id: D, logo_chemin: CA, logo_sha256: 'a'.repeat(64) },
        { id: 'v2', dossier_id: D, logo_chemin: CB, logo_sha256: 'b'.repeat(64), remplace_id: 'v1' },
      ],
    },
    fichiers: [fichier(CA, 'a'.repeat(64))],
  }
}

function resultat(logos: ResultatRestauration['logos']): ResultatRestauration {
  return { lignesParTable: { dossiers: 1, parametres_facturation: 2 }, partageesConservees: 0, liensReposes: 0, logos }
}

beforeEach(() => {
  faux.sauvegarde = sauvegarde()
  faux.resultat = resultat([
    { chemin: CA, empreinte: 'a'.repeat(64), issue: 'redepose', explication: EXPLICATION_REDEPOSE },
    { chemin: CB, empreinte: 'b'.repeat(64), issue: 'non_redepose', explication: explicationDuDepotEchoue('permission refusée') },
  ])
  faux.ecarts = []
  faux.restaurations = 0
  faux.erreur = null
  faux.retraits = []
  faux.retraitRefuse = null
  faux.liberer = null
})

async function choisir() {
  const champ = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => { fireEvent.change(champ, { target: { files: [new File(['{}'], 'sauvegarde.json', { type: 'application/json' })] } }) })
}
const restaurer = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Restaurer « Atelier fictif »/ })) })

describe('la carte de la restauration et les logos des factures', () => {
  it('avant le clic : ce que deviennent les notes des anciennes colonnes d’une sauvegarde d’avant leur suppression', async () => {
    const s = sauvegarde()
    s.contenu.pieces = [{ id: 'p1', dossier_id: D, notes: 'Gardée.' }, { id: 'p2', dossier_id: D, notes: 'Écrite après.' }]
    s.contenu.notes_internes = [
      { id: 'n1', dossier_id: D, piece_id: 'p1', document_id: null, texte: 'Gardée.', created_at: 't0', updated_at: 't0' },
      { id: 'n2', dossier_id: D, piece_id: 'p2', document_id: null, texte: 'Autre.', created_at: 't0', updated_at: 't0' },
    ]
    faux.sauvegarde = s
    render(<RestaurationCard />)
    await choisir()
    const liste = await screen.findByRole('list', { name: 'Anciennes notes de la sauvegarde' })
    expect([...liste.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '2 note(s) des anciennes colonnes des pièces et des documents : la restauration ne les écrit plus, seules les notes internes se restaurent.',
      '1 déjà dans les notes internes de la sauvegarde, au caractère près : rien ne se perd.',
      '1 perdue(s) : leur cible porte une note interne au texte différent, jamais reprise — le texte de l\'ancienne colonne ne sera pas restauré.',
    ])
  })

  it('une sauvegarde sans ancienne note n’en dit rien', async () => {
    render(<RestaurationCard />)
    await choisir()
    await screen.findByText(/^Logos des factures :/)
    expect(screen.queryByRole('list', { name: 'Anciennes notes de la sauvegarde' })).toBeNull()
  })

  it('avant le clic : ce que la sauvegarde porte des logos, et ce qu’elle ne porte pas', async () => {
    render(<RestaurationCard />)
    await choisir()
    expect(await screen.findByText(/^Logos des factures : 1 fichier porté, .* ; 1 logo désigné que la sauvegarde ne porte pas\.$/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Bilan des logos des factures' })).toBeNull()
  })

  it('après : le bilan de chaque logo, une ligne chacun, la relecture juste', async () => {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    const bilan = await screen.findByRole('list', { name: 'Bilan des logos des factures' })
    expect(within(bilan).getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      `Redéposé — ${CA} : ${EXPLICATION_REDEPOSE}`,
      `Non redéposé — ${CB} : ${explicationDuDepotEchoue('permission refusée')}`,
    ])
    expect(screen.getByText(/^Restauration vérifiée/)).toBeTruthy()
  })

  it('un fichier qui n’est pas revenu : le bilan le dit, ET la relecture dit la restauration incomplète', async () => {
    faux.ecarts = [{ table: 'ventes', motif: 'fichier_absent', identite: CB }] satisfies EcartRestauration[]
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    expect(await screen.findByRole('list', { name: 'Bilan des logos des factures' })).toBeTruthy()
    expect(screen.getByText(/^Restauration terminée mais INCOMPLÈTE : 1 écart\(s\) à la relecture\. ventes fichier_absent/)).toBeTruthy()
    expect(screen.queryByText(/^Restauration vérifiée/)).toBeNull()
  })

  it('un nouveau fichier choisi efface le bilan d’avant', async () => {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    await screen.findByRole('list', { name: 'Bilan des logos des factures' })
    await choisir()
    expect(screen.queryByRole('list', { name: 'Bilan des logos des factures' })).toBeNull()
    expect(faux.restaurations).toBe(1)
  })
})

describe('la restauration interrompue après la création du dossier (RESTAU-Q2)', () => {
  const partiel: DossierPartiel = { id: D, nom: 'Atelier fictif', lignesEcrites: { dossiers: 1, pieces: 3 }, partageesEcrites: 0 }
  const interrompue = () => new RestaurationInterrompue('Restauration interrompue sur « lignes_bancaires » : délai dépassé', partiel)
  const champDuNom = () => screen.getByLabelText('Tape « Atelier fictif » pour confirmer')
  const boutonRetirer = () => screen.getByRole('button', { name: 'Retirer définitivement' })

  async function ouvrirLaConfirmation() {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })) })
  }

  beforeEach(() => { faux.erreur = interrompue() })

  it('propose le retrait, sur une confirmation qui nomme le dossier et dit ce qui part ; la restauration attend', async () => {
    await ouvrirLaConfirmation()
    expect(screen.getByText(/^Restauration interrompue sur « lignes_bancaires »/)).toBeTruthy()
    expect(screen.getByText(/s'est arrêtée après avoir créé le dossier « Atelier fictif »/)).toBeTruthy()
    expect(screen.getByText(/supprime définitivement le dossier « Atelier fictif » \(a5c00000-.*les 4 ligne\(s\) déjà réinsérées sur 2 table\(s\)/)).toBeTruthy()
    expect(screen.getByText(/Le stockage n'est pas touché/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Restaurer « Atelier fictif »/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.retraits).toEqual([])
  })

  it('une erreur d’une autre forme ne propose aucun retrait', async () => {
    faux.erreur = Object.assign(new Error('Restauration refusée, rien n\'a été écrit :\n- Le dossier existe déjà'), { dossierPartiel: partiel })
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    expect(screen.getByText(/^Restauration refusée/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeNull()
  })

  it('confirmation refusée : rien ne part', async () => {
    await ouvrirLaConfirmation()
    // Un nom qui n'est pas le sien laisse le bouton fermé.
    await act(async () => { fireEvent.change(champDuNom(), { target: { value: 'Atelier' } }) })
    expect((boutonRetirer() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(boutonRetirer()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Annuler' })) })
    expect(screen.queryByRole('button', { name: 'Retirer définitivement' })).toBeNull()
    expect(faux.retraits).toEqual([])
    // Le dossier partiel reste désigné : le retrait reste offert.
    expect(screen.getByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeTruthy()
  })

  it('deux clics dans le même act : un seul retrait ; puis la restauration peut repartir', async () => {
    await ouvrirLaConfirmation()
    await act(async () => { fireEvent.change(champDuNom(), { target: { value: 'Atelier fictif' } }) })
    await act(async () => {
      fireEvent.click(boutonRetirer())
      fireEvent.click(boutonRetirer())
    })
    expect(faux.retraits).toEqual([partiel])
    await act(async () => { faux.liberer?.() })
    expect(screen.getByText('Dossier partiel « Atelier fictif » retiré, avec ce que la tentative avait écrit. Le stockage n\'a pas été touché. La restauration peut repartir.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeNull()
    faux.erreur = null
    await restaurer()
    expect(faux.restaurations).toBe(2)
    expect(screen.getByText(/^Restauration vérifiée/)).toBeTruthy()
  })

  it('un retrait refusé se dit dans la confirmation, et le dossier reste désigné', async () => {
    faux.retraitRefuse = new Error('Le dossier partiel n’a pas été retiré : la base n’a rendu aucune ligne supprimée.')
    await ouvrirLaConfirmation()
    await act(async () => { fireEvent.change(champDuNom(), { target: { value: 'Atelier fictif' } }) })
    await act(async () => { fireEvent.click(boutonRetirer()) })
    await act(async () => { faux.liberer?.() })
    expect(screen.getByText(/aucune ligne supprimée/)).toBeTruthy()
    expect(screen.getByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeTruthy()
  })

  it('un autre fichier choisi oublie le dossier partiel de la tentative d’avant', async () => {
    render(<RestaurationCard />)
    await choisir()
    await restaurer()
    expect(screen.getByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeTruthy()
    await choisir()
    expect(screen.queryByRole('button', { name: LIBELLE_RETRAIT_DU_DOSSIER_PARTIEL })).toBeNull()
  })
})

describe('ce que la sauvegarde ne contient pas, dit avant le clic (RESTAU-Q3)', () => {
  it('la liste du manifeste, puis ce qu’une sauvegarde d’avant taisait', async () => {
    const s = sauvegarde()
    s.manifeste.horsPerimetre = ['Les comptes utilisateurs ne sont ni lus ni restaurés.']
    faux.sauvegarde = s
    render(<RestaurationCard />)
    await choisir()
    const liste = screen.getByRole('list', { name: 'Hors périmètre de la sauvegarde' })
    expect([...liste.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Les comptes utilisateurs ne sont ni lus ni restaurés.', ...HORS_PERIMETRE_DES_SECRETS,
    ])
  })
})
