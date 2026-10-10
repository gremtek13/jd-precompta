import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CotisationsTab from './CotisationsTab'
import type { ModeleComptable } from '../../lib/engagement'
import { aNouveau, cotisation, ecriture, ecritureJuste, faux, ligne, reinitialiser } from '../../test/cotisationsPaiementPersonnel'
import { AvecExercicesValides } from '../../test/exercicesValides'

// L'ÉCHÉANCE PAYÉE DEPUIS LE COMPTE PERSONNEL, À L'ÉCRAN (ligne 26.6, phase C).
//
// Le module (lib/cotisationPersonnelle.ts) dit le refus, la confirmation et l'écriture ; la base les vérifie
// (`enregistrer_paiement_personnel_cotisation`). Ce qu'aucun test du module ne voit, et que ce fichier garde : que la
// colonne « Paiement » offre le geste sur la seule échéance que rien ne paie, que la fenêtre ne propose jamais la date et
// dit le refus avant le clic, que l'appel part UNE fois sous le verrou du brouillon, relâché après la relecture, et que le
// reste de l'onglet — le figé, le versé, la mise à jour par un avis, la suppression, la recherche — sait qu'une échéance
// se paie aussi ainsi. Le retrait du paiement, offert depuis que sa fonction est en base (`RETRAIT_EXPORTE`), a son
// propre fichier : CotisationsTabRetraitPaiement.test.tsx.
vi.mock('../../lib/supabase', async () => ({ supabase: (await import('../../test/cotisationsPaiementPersonnel')).supabaseFaux() }))
vi.mock('../../lib/extraction', async () => (await import('../../test/cotisationsPaiementPersonnel')).extractionFausse())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }

const monter = (modele: ModeleComptable = TRESORERIE, valides: readonly number[] = []) => render(
  <AvecExercicesValides annees={valides}><CotisationsTab dossierId="dossier-de-test" modele={modele} /></AvecExercicesValides>,
)

beforeEach(() => {
  reinitialiser()
  // Le jour de la base, à Paris : la date d'un paiement ne peut pas le dépasser.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const GESTE = 'Payée depuis le compte personnel…'

// Le geste de la PREMIÈRE échéance affichée (la plus récente d'abord).
async function ouvrirLaFenetre() {
  const [bouton] = await screen.findAllByRole('button', { name: GESTE })
  await act(async () => { bouton.click() })
  return screen.getByRole('dialog')
}

async function saisirLaDate(date: string) {
  await act(async () => { fireEvent.change(screen.getByLabelText('Date du paiement'), { target: { value: date } }) })
}

const declarer = () => screen.getByRole('button', { name: /^Déclarer le paiement$|^Déclaration…$/ })

describe('CotisationsTab — le geste « Payée depuis le compte personnel »', () => {
  it('est offert sur l’échéance que rien ne paie, pas sur celle qu’un mouvement paie', async () => {
    faux.cotisations = [cotisation({ id: 'cot-1' }), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    faux.lignes = [ligne({ cotisation_id: 'cot-2', date: '2026-04-06' })]
    monter()

    await screen.findByText('Prélevée le 06/04/2026')
    const gestes = screen.getAllByRole('button', { name: GESTE })
    expect(gestes).toHaveLength(1)
    expect(gestes[0].closest('tr')!.textContent).toContain('05/03/2026')
  })

  it('n’est pas offert sur une échéance figée par un exercice validé', async () => {
    faux.cotisations = [cotisation({ echeance: '2025-12-05' }), cotisation({ id: 'cot-2', echeance: '2026-01-05' })]
    monter(TRESORERIE, [2025])

    const gestes = await screen.findAllByRole('button', { name: GESTE })
    expect(gestes).toHaveLength(1)
    expect(gestes[0].closest('tr')!.textContent).toContain('05/01/2026')
  })

  it('n’est pas offert sur une lecture partielle du relevé, du brouillon ou de l’ouverture — et le bandeau le dit', async () => {
    for (const table of ['lignes_bancaires', 'ecritures_brouillon', 'a_nouveaux']) {
      faux.cotisations = [cotisation()]
      faux.lignes = [ligne({ id: 'autre', cotisation_id: 'cot-9' })]
      faux.ecritures = [ecriture({ id: 'autre', cotisation_id: null, ligne_bancaire_id: 'autre' })]
      faux.aNouveaux = [aNouveau()]
      faux.muetApres = { [table]: 0 }
      const { unmount } = monter()
      await screen.findByRole('button', { name: 'Retirer' })
      expect(screen.queryByRole('button', { name: GESTE }), table).toBeNull()
      if (table === 'a_nouveaux') expect(screen.getByText(/L’ouverture du dossier n'a pas pu être lue en entier/)).toBeTruthy()
      unmount()
    }
    // Le garde symétrique : tout lu, le geste est là.
    faux.muetApres = {}
    monter()
    expect(await screen.findByRole('button', { name: GESTE })).toBeTruthy()
  })

  it('la date n’est jamais proposée : vide, elle est à renseigner, et rien ne part', async () => {
    faux.cotisations = [cotisation()]
    monter()
    const fenetre = await ouvrirLaFenetre()

    expect(within(fenetre).getByText(/Échéance du 05\/03\/2026 : 1\s000,00\s€ appelés, dont 300,00\s€ de CSG-CRDS\./)).toBeTruthy()
    expect((screen.getByLabelText('Date du paiement') as HTMLInputElement).value).toBe('')
    expect(within(fenetre).getByText('La date du paiement depuis le compte personnel est à renseigner.')).toBeTruthy()
    expect(declarer().hasAttribute('disabled')).toBe(true)
    await act(async () => { declarer().click() })
    expect(faux.rpcs).toEqual([])
  })

  it('dit le refus du module avant le clic : une date dans l’avenir, d’un exercice validé, d’avant l’ouverture', async () => {
    faux.cotisations = [cotisation({ echeance: '2026-01-05' })]
    // La plus ancienne date porte le plus grand identifiant : un tri sur l'identifiant seul la mettrait en second.
    faux.aNouveaux = [aNouveau({ id: 'an-1', date: '2026-02-01' }), aNouveau({ id: 'an-2', date: '2025-06-01' })]
    monter(TRESORERIE, [2024])
    await ouvrirLaFenetre()

    await saisirLaDate('2026-10-10')
    expect(screen.getByText('Un paiement ne se date pas dans l\'avenir : nous sommes le 09/10/2026.')).toBeTruthy()
    expect(declarer().hasAttribute('disabled')).toBe(true)

    await saisirLaDate('2024-12-30')
    expect(screen.getByText('L\'exercice 2024 est validé : un paiement ne s\'y déclare plus.')).toBeTruthy()
    expect(declarer().hasAttribute('disabled')).toBe(true)

    // L'ouverture est la PLUS ANCIENNE date des à-nouveaux (01/06/2025), pas la première rangée de la table.
    await saisirLaDate('2025-05-31')
    expect(screen.getByText('Ce paiement précède l\'ouverture du dossier, le 01/06/2025 : il est dans les comptes repris.')).toBeTruthy()
    expect(declarer().hasAttribute('disabled')).toBe(true)
    await act(async () => { declarer().click() })
    expect(faux.rpcs).toEqual([])

    await saisirLaDate('2025-06-01')
    expect(declarer().hasAttribute('disabled')).toBe(false)
  })

  it('confirme en nommant les comptes et l’exercice, déclare par la base, et dit l’échéance payée', async () => {
    faux.cotisations = [cotisation()]
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')

    expect(screen.getByText(/^Déclarer l'échéance du 05\/03\/2026 \(1\s000,00\s€\) payée depuis le compte personnel de l'exploitant, le 10\/03\/2026\. Le brouillon reçoit 700,00\s€ au débit du 646000, face au 108000, à cette date\. L'échéance compte ce jour-là dans la 2035 de 2026\./)).toBeTruthy()
    await act(async () => { declarer().click() })

    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_paiement_personnel_cotisation',
      args: {
        p_dossier_id: 'dossier-de-test', p_cotisation_id: 'cot-1', p_date_paiement: '2026-03-10',
        p_ecritures: [
          { compte: '646000', sens: 'debit', montant: 700, libelle: 'Cotisation, échéance du 05/03/2026, payée depuis le compte personnel' },
          { compte: '108000', sens: 'credit', montant: 700, libelle: 'Cotisation, échéance du 05/03/2026, payée depuis le compte personnel' },
        ],
      },
    }])
    await screen.findByText('Payée depuis le compte personnel le 10/03/2026')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Écrite')).toBeTruthy()
    expect(screen.queryByRole('button', { name: GESTE })).toBeNull()
  })

  it('en engagement, l’écriture se passe face au compte choisi pour le dirigeant', async () => {
    faux.cotisations = [cotisation()]
    monter({ mode: 'engagement', compteNotesDeFrais: '467000' })
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')

    expect(screen.getByText(/Le brouillon reçoit 1\s000,00\s€ au débit du 646000, face au 467000, à cette date\. L'échéance compte ce jour-là dans l'exercice 2026\./)).toBeTruthy()
    await act(async () => { declarer().click() })
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      expect.objectContaining({ compte: '646000', sens: 'debit', montant: 1000 }),
      expect.objectContaining({ compte: '467000', sens: 'credit', montant: 1000 }),
    ])
  })

  it('deux clics dans le même rendu ne déclarent qu’une fois', async () => {
    faux.cotisations = [cotisation()]
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')

    const bouton = declarer()
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('trois clics ne déclarent qu’une fois, et le verrou tient pendant la relecture', async () => {
    faux.cotisations = [
      cotisation(), cotisation({ id: 'cot-2', echeance: '2026-04-05' }),
      // Prélevée, sans écriture : « Écrire cette échéance » reste visible pendant la relecture.
      cotisation({ id: 'cot-3', echeance: '2026-02-05' }),
    ]
    faux.lignes = [ligne({ id: 'l-3', cotisation_id: 'cot-3', date: '2026-02-06' })]
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')

    faux.retenirLectures = true
    const bouton = declarer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    await waitFor(() => expect(faux.relacher).not.toBeNull())
    expect(faux.rpcs).toHaveLength(1)
    // La relecture n'est pas revenue : les gestes du brouillon restent grisés — « Écrire » partirait de listes d'avant.
    expect(screen.getByText('Chargement…')).toBeTruthy()
    const ecrire = screen.getByRole('button', { name: 'Écriture…' })
    expect(ecrire.hasAttribute('disabled')).toBe(true)
    await act(async () => { ecrire.click() })
    expect(faux.rpcs).toHaveLength(1)

    faux.retenirLectures = false
    await act(async () => { faux.relacher?.(); faux.retenue = null })
    await screen.findByText('Payée depuis le compte personnel le 10/03/2026')
    // Relâché après la relecture : l'autre échéance se déclare de nouveau.
    expect((await screen.findByRole('button', { name: GESTE })).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Écrire cette échéance' }).hasAttribute('disabled')).toBe(false)
  })

  it('le verrou est celui du brouillon : pendant la déclaration, « Retirer » et l’autre geste attendent', async () => {
    faux.cotisations = [cotisation(), cotisation({ id: 'cot-2', echeance: '2026-04-05' })]
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')

    faux.retenirRpc = true
    await act(async () => { declarer().click() })
    expect(screen.getByRole('button', { name: 'Déclaration…' }).hasAttribute('disabled')).toBe(true)
    const retirer = screen.getAllByRole('button', { name: 'Retirer' })
    expect(retirer.every((b) => b.hasAttribute('disabled'))).toBe(true)
    expect(screen.getAllByRole('button', { name: GESTE }).every((b) => b.hasAttribute('disabled'))).toBe(true)
    await act(async () => { retirer[1].click() })
    expect(confirmation).not.toHaveBeenCalled()

    await act(async () => { faux.relacherRpc?.() })
    await screen.findByText('Payée depuis le compte personnel le 10/03/2026')
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['enregistrer_paiement_personnel_cotisation'])
  })

  it('dit le refus de la base dans la fenêtre, sans la fermer', async () => {
    faux.cotisations = [cotisation()]
    faux.erreurRpc = 'Cette échéance est déjà payée depuis le compte personnel, le 09/03/2026 : retire d\'abord ce paiement.'
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')
    await act(async () => { declarer().click() })

    const fenetre = await screen.findByRole('dialog')
    expect(within(fenetre).getByText(/^Le paiement n’a pas pu être déclaré : Cette échéance est déjà payée depuis le compte personnel/)).toBeTruthy()
  })

  // UNE LISTE PAS ENCORE REVENUE NE COMMANDE PAS D'ÉCRITURE : une relecture partie fenêtre ouverte (une échéance saisie à
  // côté) peut changer ce que la fenêtre dit — la déclaration attend son retour, et le dit.
  it('attend la relecture qui court, le dit, puis se déclare', async () => {
    faux.cotisations = [cotisation()]
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Échéance'), { target: { value: '2026-06-05' } })
      fireEvent.change(screen.getByLabelText('Montant appelé'), { target: { value: '420' } })
    })
    faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    await act(async () => { screen.getByRole('button', { name: 'Ajouter' }).click() })

    expect(screen.getByText('Les échéances du dossier sont en cours de lecture : la déclaration attend leur retour.')).toBeTruthy()
    expect(declarer().hasAttribute('disabled')).toBe(true)
    await act(async () => { declarer().click() })
    expect(faux.rpcs).toEqual([])

    await act(async () => { faux.retenue = null; faux.relacher!() })
    await waitFor(() => expect(declarer().hasAttribute('disabled')).toBe(false))
    await act(async () => { declarer().click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['enregistrer_paiement_personnel_cotisation'])
  })

  it('« Annuler » ferme la fenêtre sans rien écrire', async () => {
    faux.cotisations = [cotisation()]
    monter()
    await ouvrirLaFenetre()
    await saisirLaDate('2026-03-10')
    await act(async () => { screen.getByRole('button', { name: 'Annuler' }).click() })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faux.rpcs).toEqual([])
  })
})

describe('CotisationsTab — l’échéance payée depuis le compte personnel', () => {
  it('« Écrite » quand son écriture suit le paiement, « À reprendre » sinon, la raison en titre et en clair', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05', paiement_personnel_le: '2026-04-10' }),
    ]
    faux.ecritures = ecritureJuste()
    monter()

    await screen.findByText('Payée depuis le compte personnel le 10/04/2026')
    expect(screen.getByText('Payée depuis le compte personnel le 10/03/2026').closest('tr')!.textContent).toContain('Écrite')
    const badge = screen.getByText('À reprendre')
    expect(badge.getAttribute('title')).toBe(
      "Son écriture manque ou ne suit plus l'échéance : retire le paiement, puis déclare-le de nouveau.",
    )
    expect(badge.closest('tr')!.textContent).toContain('05/04/2026')
    expect(screen.queryByRole('button', { name: GESTE })).toBeNull()
  })

  it('ne dit rien de son écriture sur un brouillon lu en partie', async () => {
    // L'écriture existe ; lue en partie, elle manque, et le paiement PARAÎTRAIT à reprendre.
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.ecritures = ecritureJuste()
    faux.muetApres.ecritures_brouillon = 0
    monter()

    await screen.findByText('Payée depuis le compte personnel le 10/03/2026')
    expect(screen.queryByText('À reprendre')).toBeNull()
    expect(screen.queryByText('Écrite')).toBeNull()
  })

  // La raison d'une écriture à reprendre conseille de retirer le paiement : le geste est là, sur la même ligne.
  it('offre de retirer le paiement, écrit ou à reprendre, depuis que sa fonction est en base', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05', paiement_personnel_le: '2026-04-10' }),
    ]
    faux.ecritures = ecritureJuste()
    monter()

    await screen.findByText('Écrite')
    expect(within(screen.getByText('Écrite').closest('tr')!).getByRole('button', { name: 'Retirer ce paiement' })).toBeTruthy()
    expect(within(screen.getByText('À reprendre').closest('tr')!).getByRole('button', { name: 'Retirer ce paiement' })).toBeTruthy()
  })

  it('se fige à la date de son paiement, pas à son échéance', async () => {
    faux.cotisations = [
      // Échéance de décembre payée en janvier : son exercice est le suivant, ouvert.
      cotisation({ id: 'cot-1', echeance: '2025-12-20', paiement_personnel_le: '2026-01-05' }),
      // Échéance de janvier payée en décembre : figée par l'exercice 2025.
      cotisation({ id: 'cot-2', echeance: '2026-01-10', paiement_personnel_le: '2025-12-30' }),
    ]
    monter(TRESORERIE, [2025])

    const ligneDe = async (texte: string) => (await screen.findByText(texte)).closest('tr')!
    expect((await ligneDe('Payée depuis le compte personnel le 05/01/2026')).querySelector('.td-boutons button')?.textContent).toBe('Retirer')
    const figee = await ligneDe('Payée depuis le compte personnel le 30/12/2025')
    expect(figee.querySelector('.td-boutons button')).toBeNull()
    expect(figee.textContent).toContain('Figée')
    // Figée sans écriture : dit en clair, sans badge qui appellerait un geste refusé.
    const sans = within(figee).getByTitle('L\'exercice 2025 est validé : aucune écriture ne s’y passe plus.')
    expect(sans.textContent).toBe('Sans écriture')
    expect(sans.className).not.toContain('badge')
  })

  it('est versée : son montant, dit « compte personnel », compté dans le total — sauf si ses montants ne s’écrivent pas', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', montant_appele: 1000, montant_csg_crds: 300, paiement_personnel_le: '2026-03-10' }),
      // La CSG-CRDS dépasse le montant : le paiement ne peut pas s'écrire, et rien n'est dit versé.
      cotisation({ id: 'cot-2', echeance: '2026-04-05', montant_appele: 200, montant_csg_crds: 300, paiement_personnel_le: '2026-04-10' }),
    ]
    faux.ecritures = ecritureJuste()
    monter()

    await screen.findByText('(compte personnel)')
    expect(screen.getAllByText('(compte personnel)')).toHaveLength(1)
    const valeur = (libelle: string) => screen.getByText(libelle).parentElement?.querySelector('strong')?.textContent
    expect(valeur('Total versé')).toMatch(/^1\s000,00\s€$/)
    expect(valeur('Reste à verser')).toMatch(/^200,00\s€$/)
    expect(screen.getByText('La CSG-CRDS de cette échéance (300,00 €) dépasse son montant (200,00 €).')).toBeTruthy()
  })

  it('la recherche la trouve par la date de son paiement', async () => {
    faux.cotisations = [
      cotisation({ id: 'cot-1', paiement_personnel_le: '2026-03-10' }),
      cotisation({ id: 'cot-2', echeance: '2026-04-05' }),
    ]
    monter()

    await screen.findByText('Payée depuis le compte personnel le 10/03/2026')
    const champ = screen.getByRole('searchbox', { name: 'Rechercher une échéance, un montant…' })
    await act(async () => { fireEvent.change(champ, { target: { value: '10/03/2026' } }) })
    expect(screen.getByText('Payée depuis le compte personnel le 10/03/2026')).toBeTruthy()
    expect(screen.queryByText('05/04/2026')).toBeNull()
  })

  it('la supprimer : la confirmation nomme le paiement et l’écriture qui partent avec elle', async () => {
    faux.cotisations = [cotisation({ paiement_personnel_le: '2026-03-10' })]
    faux.ecritures = ecritureJuste()
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return true })
    monter()

    await screen.findByText('Écrite')
    await act(async () => { screen.getByRole('button', { name: 'Retirer' }).click() })
    expect(message).toBe(
      'Retirer cette échéance ?\n\nAucun mouvement bancaire ne la paie. Son paiement du 10/03/2026 depuis le compte personnel part avec elle, '
      + 'et son écriture est retirée du brouillon.',
    )
    expect(faux.rpcs).toEqual([{ nom: 'supprimer_echeance_cotisation', args: { p_cotisation_id: 'cot-1' } }])
    await screen.findByText("Aucune échéance enregistrée pour l'instant.")
  })

  // LA DATE QUI FIGE EST CELLE DU PAIEMENT (relecture croisée du 09/10/2026, constats A et B) : `garder_cotisation_valide`
  // date une échéance par `coalesce(mouvement, paiement_personnel_le, echeance)`.
  it('A — échéance de décembre 2025 payée de la poche le 10/01/2026, 2025 validé : ouverte, payée, rien à verser', async () => {
    faux.cotisations = [cotisation({ echeance: '2025-12-20', paiement_personnel_le: '2026-01-10' })]
    faux.ecritures = ecritureJuste('2026-01-10')
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })
    monter(TRESORERIE, [2025])

    const ligneA = (await screen.findByText('Payée depuis le compte personnel le 10/01/2026')).closest('tr')!
    expect(ligneA.textContent).not.toContain('Figée')
    expect(within(ligneA).getByText('Écrite')).toBeTruthy()
    const valeur = (libelle: string) => screen.getByText(libelle).parentElement?.querySelector('strong')?.textContent
    expect(valeur('Total versé')).toMatch(/^1\s000,00\s€$/)
    expect(valeur('Reste à verser')).toMatch(/^0,00\s€$/)
    // « Retirer » est offert, et sa confirmation nomme le paiement qui part avec elle.
    await act(async () => { within(ligneA).getByRole('button', { name: 'Retirer' }).click() })
    expect(message).toContain('Son paiement du 10/01/2026 depuis le compte personnel part avec elle, et son écriture est retirée du brouillon.')
  })

  it('B — échéance de janvier 2026 payée d’avance le 20/12/2025, 2025 validé : figée, ni « Retirer » ni geste', async () => {
    faux.cotisations = [cotisation({ echeance: '2026-01-15', paiement_personnel_le: '2025-12-20' })]
    faux.ecritures = ecritureJuste('2025-12-20')
    monter(TRESORERIE, [2025])

    const ligneB = (await screen.findByText('Payée depuis le compte personnel le 20/12/2025')).closest('tr')!
    expect(within(ligneB).getByTitle('L\'exercice 2025 est validé : cette échéance ne se supprime plus.').textContent).toBe('Figée')
    expect(within(ligneB).queryByRole('button')).toBeNull()
  })

  it('un avis qui la confirme ne change pas ses montants, et l’alerte le dit', async () => {
    faux.cotisations = [cotisation({ echeance: '2026-05-05', previsionnel: true, paiement_personnel_le: '2026-05-06' })]
    faux.echeancesLues = [{ date: '2026-05-05', montant: 1100, previsionnel: false }]
    monter()
    await screen.findByText('Payée depuis le compte personnel le 06/05/2026')
    const champ = document.querySelector('input[type=file][accept=".pdf,.jpg,.jpeg,.png"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [new File(['%PDF'], 'avis.pdf', { type: 'application/pdf' })] } }) })

    const bouton = await screen.findByRole('button', { name: 'Créer ces 1 échéance(s)' })
    // Dit avant le clic, dans le tableau des échéances lues.
    expect(screen.getByTitle('Ses montants ne changent plus tant que ce paiement tient : elle ne sera pas mise à jour.').textContent)
      .toBe('Payée depuis le compte personnel')
    let alerte = ''
    vi.spyOn(window, 'alert').mockImplementation((m?: string) => { alerte = m ?? '' })
    await act(async () => { bouton.click() })

    expect(faux.misesAJour.filter((m) => m.table === 'cotisations_declarees')).toEqual([])
    expect(alerte).toBe(
      '0 échéance(s) prise(s) en compte, 1 payée(s) depuis le compte personnel (ignorée(s)) : ses montants ne changent plus tant que ce paiement tient.',
    )
  })

  // CONSTAT C : l'échéancier insère les nouvelles, PUIS met à jour les prévisionnelles une à une. Un refus au milieu laissait
  // l'insertion en base et la liste d'avant à l'écran : un second clic réinsérait l'échéance, comptée deux fois en 2035.
  it('un échec après l’insertion relit la liste : un second clic ne réinsère rien', async () => {
    faux.cotisations = [cotisation({ id: 'cot-p', echeance: '2026-05-05', montant_appele: 400, previsionnel: true })]
    faux.echeancesLues = [
      { date: '2026-05-05', montant: 420, previsionnel: false },
      { date: '2026-06-05', montant: 420, previsionnel: false },
    ]
    faux.erreurMiseAJour = 'Refus de la base.'
    monter()
    await screen.findByText('05/05/2026')
    const champ = document.querySelector('input[type=file][accept=".pdf,.jpg,.jpeg,.png"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [new File(['%PDF'], 'avis.pdf', { type: 'application/pdf' })] } }) })
    const bouton = await screen.findByRole('button', { name: 'Créer ces 2 échéance(s)' })
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    await act(async () => { bouton.click() })
    await screen.findByText('Refus de la base.')
    // La relecture a rendu l'échéance du 05/06, insérée avant le refus : au tableau du dossier, en plus de celui de l'avis.
    await waitFor(() => expect(screen.getAllByText('05/06/2026')).toHaveLength(2))
    faux.erreurMiseAJour = null
    await waitFor(() => expect(screen.getByRole('button', { name: 'Créer ces 2 échéance(s)' }).hasAttribute('disabled')).toBe(false))
    await act(async () => { screen.getByRole('button', { name: 'Créer ces 2 échéance(s)' }).click() })

    const inserees = faux.insertions.filter((i) => i.table === 'cotisations_declarees')
      .flatMap((i) => i.valeur as { echeance: string }[]).filter((v) => v.echeance === '2026-06-05')
    expect(inserees).toHaveLength(1)
    expect(faux.cotisations.filter((c) => c.echeance === '2026-06-05')).toHaveLength(1)
  })
})
