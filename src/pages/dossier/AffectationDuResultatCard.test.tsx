import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/ecrans'
import type { ComptesDeLAffectation } from '../../lib/affectationDuResultat'
import type { DecisionLue, LectureDeLAffectation, LueDeLAffectation } from '../../lib/affectationEcran'
import { modeleDeTest } from '../../test/modeles'

// LA CARTE « APPROBATION ET AFFECTATION DU RÉSULTAT » (ligne 45, AFF4) : ce qu'aucun calcul pur ne voit — le « Chargement… »
// avant la lecture, l'absence de tout geste sur une lecture incomplète ou un exercice non validé, le refus du module dit AVANT
// le clic, le câblage des deux fonctions de la base, la confirmation qui nomme ce qui change, le verrou (deux clics dans le même
// `act` n'écrivent qu'une fois), relâché APRÈS la relecture, et le refus de la base dit sous ses mots. Données FICTIVES : une SARL
// au capital de 10 000 €, réserve légale existante 800 €, bénéfice 2026 de 30 000 €, décision du 15/05/2027.

const rpc = vi.fn()
const lire = vi.fn<(dossierId: string, annee: number) => Promise<LectureDeLAffectation>>()
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('../../lib/affectationLecture', () => ({ lireLAffectation: (d: string, a: number) => lire(d, a) }))
// Le document (AFF5) : le dépôt, le tirage du PDF et le téléchargement simulés ; le jugement du fichier aussi (le type lu à la
// signature, l'empreinte), que procesVerbalEcriture.test.ts éprouve contre les vrais octets.
const joindre = vi.fn()
const telecharger = vi.fn()
const pdf = vi.fn()
vi.mock('../../lib/procesVerbalEcriture', () => ({ joindreLeProcesVerbal: (...a: unknown[]) => joindre(...a) }))
vi.mock('../../lib/apercu', () => ({ telechargerUnPdf: (...a: unknown[]) => telecharger(...a) }))
vi.mock('../../lib/procesVerbalDAffectation', async (original) => ({
  ...(await original<typeof import('../../lib/procesVerbalDAffectation')>()),
  pdfDuProcesVerbal: (...a: unknown[]) => pdf(...a),
}))
vi.mock('../../lib/bornesStockage', async (original) => ({
  ...(await original<typeof import('../../lib/bornesStockage')>()),
  preparerProcesVerbal: async (f: File) => (f.name.endsWith('.pdf')
    ? { corps: f, type: 'application/pdf', taille: 2048 }
    : { refus: { raison: 'format', taille: 4, message: 'format non pris en charge (un procès-verbal signé se dépose en PDF)' } }),
}))
vi.mock('../../lib/logoDesFactures', () => ({ empreinteSha256: async () => 'e'.repeat(64) }))

import AffectationDuResultatCard from './AffectationDuResultatCard'
import { FIGEE_DE_TEST, IDENTITE_DE_TEST } from '../../test/affectation'

const COMPTES: ComptesDeLAffectation = {
  resultat_benefice: '120000', resultat_perte: '129000', reserve_legale: '106100', reserves_statutaires: '106300',
  autres_reserves: '106800', report_a_nouveau_crediteur: '110000', report_a_nouveau_debiteur: '119000', dividendes_a_payer: '457000',
}
const lue = (l: Partial<LueDeLAffectation> = {}): LueDeLAffectation => ({
  dossierId: 'd1', annee: 2026, etat: 'lue', formeJuridique: '5499', capitalCentimes: 1_000_000, identite: IDENTITE_DE_TEST, comptes: COMPTES, anneesValidees: [2026],
  brouillon: [{ date: '2026-06-30', compte: '706000', sens: 'credit', montant: 30_000, statut: 'validee', affectationId: null }],
  reportes: [
    { date: '2027-01-01', compte: '101000', sens: 'credit', montant: 10_000 }, { date: '2027-01-01', compte: '106100', sens: 'credit', montant: 800 },
  ],
  aNouveaux: [], decisions: [], ...l,
})
const enVigueur = (d: Partial<DecisionLue> = {}): DecisionLue => ({
  id: 'a1', version: 3, etat: 'en_vigueur', organe: 'assemblee', nombreDAssocies: 'plusieurs', dateDecision: '2027-05-15', comptesApprouves: true,
  dateMiseEnPaiement: null, reservesStatutairesDistribuables: true, finLe: null, figee: FIGEE_DE_TEST, document: null,
  lignes: [{ origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 }, { origine: 'benefice', destination: 'report_crediteur', centimes: 2_980_000 }],
  ...d,
})
const PROPOSEE = (id = 'a1') => [
  { date: '2027-05-15', compte: '120000', sens: 'debit' as const, montant: 30_000, statut: 'proposee', affectationId: id },
]

const rendre = () => render(<AffectationDuResultatCard dossierId="d1" annee={2026} modele={modeleDeTest('engagement')} />)
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom })
const libelle = (nom: string | RegExp) => screen.getByLabelText(nom)
const attendre = async () => { await waitFor(() => expect(screen.queryByText('Chargement…')).toBeNull()) }

async function remplirLaDecision() {
  fireEvent.change(libelle('Date de la décision'), { target: { value: '2027-05-15' } })
  fireEvent.change(libelle('Réserves statutaires, selon les statuts'), { target: { value: 'distribuables' } })
  await act(async () => { fireEvent.click(bouton('Reprendre la proposition')) })
}

beforeEach(() => {
  rpc.mockReset()
  lire.mockReset()
  joindre.mockReset()
  telecharger.mockReset().mockReturnValue({ ok: true })
  pdf.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-11-12T10:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('la carte de l’affectation du résultat', () => {
  it('avant la lecture, « Chargement… » : ni affirmation, ni champ, ni bouton', () => {
    lire.mockReturnValue(new Promise(() => {}))
    rendre()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(lire).toHaveBeenCalledWith('d1', 2026)
  })

  it('une lecture incomplète se dit avec son motif, sans aucun champ ni geste', async () => {
    lire.mockResolvedValue({ dossierId: 'd1', annee: 2026, etat: 'incomplete', motif: 'le brouillon des écritures : lecture partielle' })
    rendre()
    await attendre()
    expect(screen.getByText(/Lecture incomplète : le brouillon des écritures : lecture partielle/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('une lecture d’un autre exercice ou d’un autre dossier ne se montre pas : « Chargement… » jusqu’à la bonne', async () => {
    lire.mockResolvedValue(lue({ annee: 2025 }))
    rendre()
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('un exercice non validé dit pourquoi il ne s’affecte pas encore, sans aucun geste', async () => {
    lire.mockResolvedValue(lue({ anneesValidees: [2025] }))
    rendre()
    await attendre()
    expect(screen.getByText(/L’exercice 2026 n’est pas validé : son résultat n’est pas figé, il ne s’affecte pas encore\./)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('montre le résultat lu et la proposition du module ; aucune décision n’est écrite sans le clic', async () => {
    lire.mockResolvedValue(lue())
    rendre()
    await attendre()
    expect(screen.getByText(/L’exercice 2026 se solde par un bénéfice de 30[\s  ]000,00/)).toBeTruthy()
    expect(screen.getByText(/Réserve légale minimale : 200,00/)).toBeTruthy()
    expect(screen.getByText(/calculée au 01\/01\/2027, jamais une décision/)).toBeTruthy()
    expect(screen.getByText(/Plafond des dividendes/)).toBeTruthy()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('dit le refus du module avant le clic, sur la saisie telle qu’elle part : sans date, sans statuts, puis une réserve légale trop basse', async () => {
    lire.mockResolvedValue(lue())
    rendre()
    await attendre()
    expect(screen.getByText('Une date n’est pas une date du calendrier (JJ/MM/AAAA).')).toBeTruthy()
    expect(bouton('Enregistrer la décision')).toHaveProperty('disabled', true)
    fireEvent.change(libelle('Date de la décision'), { target: { value: '2027-05-15' } })
    expect(screen.getByText(/Ce que disent les statuts des réserves statutaires/)).toBeTruthy()
    fireEvent.change(libelle('Réserves statutaires, selon les statuts'), { target: { value: 'distribuables' } })
    fireEvent.click(bouton('Ajouter une ligne'))
    fireEvent.change(libelle('Origine de la ligne 1'), { target: { value: 'benefice' } })
    fireEvent.change(libelle('Destination de la ligne 1'), { target: { value: 'report_crediteur' } })
    fireEvent.change(libelle('Montant de la ligne 1 (€)'), { target: { value: '12,345' } })
    expect(screen.getByText('Un montant n’est pas un nombre entier de centimes, ou une ligne d’affectation n’est pas positive : rien ne se juge.')).toBeTruthy()
    fireEvent.change(libelle('Montant de la ligne 1 (€)'), { target: { value: '29 999' } })
    expect(screen.getByText(/Le bénéfice de 30[\s  ]000,00[\s  ]€ s’affecte en entier/)).toBeTruthy()
    expect(screen.getByText(/La réserve légale doit recevoir au moins 200,00/)).toBeTruthy()
    expect(bouton('Enregistrer la décision')).toHaveProperty('disabled', true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('un couple que le module n’admet pas ne s’offre pas : la destination suit l’origine', async () => {
    lire.mockResolvedValue(lue())
    rendre()
    await attendre()
    fireEvent.click(bouton('Ajouter une ligne'))
    fireEvent.change(libelle('Origine de la ligne 1'), { target: { value: 'autres_reserves' } })
    expect((libelle('Destination de la ligne 1') as HTMLSelectElement).value).toBe('dividendes')
    expect(Array.from((libelle('Destination de la ligne 1') as HTMLSelectElement).options).map((o) => o.value)).toEqual(['dividendes'])
  })

  it('enregistre la décision : la confirmation la nomme, la fonction reçoit la saisie telle qu’elle part, une fois sous deux clics, la lecture est refaite', async () => {
    lire.mockResolvedValue(lue())
    rpc.mockResolvedValue({ data: 'id', error: null })
    rendre()
    await attendre()
    await remplirLaDecision()
    const b = bouton('Enregistrer la décision')
    expect(b).toHaveProperty('disabled', false)
    await act(async () => {
      fireEvent.click(b)
      fireEvent.click(b)
    })
    await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(
      /Enregistrer la décision du 15\/05\/2027 sur l’exercice 2026 \?[\s\S]*Le bénéfice → la réserve légale : 200,00[\s\S]*Écriture au journal OD, datée du 15\/05\/2027, dans l’exercice 2027[\s\S]*Débit 120000 : 30[\s  ]000,00[\s\S]*Crédit 110000/))
    expect(rpc).toHaveBeenCalledWith('enregistrer_affectation', expect.objectContaining({
      p_dossier_id: 'd1', p_exercice: 2026, p_version_lue: null,
      p_decision: {
        organe: 'assemblee', nombre_d_associes: 'plusieurs', date_decision: '2027-05-15', comptes_approuves: true,
        date_mise_en_paiement: null, reserves_statutaires_distribuables: true,
      },
      p_lignes: [
        { origine: 'benefice', destination: 'reserve_legale', centimes: 20_000 },
        { origine: 'benefice', destination: 'report_crediteur', centimes: 2_980_000 },
      ],
    }))
    const ecriture = rpc.mock.calls[0][1].p_ecriture
    expect(ecriture.lignes).toEqual([
      { compte: '120000', sens: 'debit', centimes: 3_000_000 }, { compte: '106100', sens: 'credit', centimes: 20_000 },
      { compte: '110000', sens: 'credit', centimes: 2_980_000 },
    ])
  })

  it('le geste reste tenu pendant la relecture (le bouton aussi), et se rend quand elle est revenue', async () => {
    let finDeLaRelecture: (l: LectureDeLAffectation) => void = () => {}
    lire.mockResolvedValueOnce(lue()).mockImplementationOnce(() => new Promise((r) => { finDeLaRelecture = r }))
    rpc.mockResolvedValue({ data: 'id', error: null })
    rendre()
    await attendre()
    await remplirLaDecision()
    await act(async () => { fireEvent.click(bouton('Enregistrer la décision')) })
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    // La relecture n'est pas revenue : le bouton est tenu (le verrou, et l'état qui le désactive), et un clic de plus n'écrit rien.
    await act(async () => { fireEvent.click(bouton(/Enregistrement…/)) })
    expect(rpc).toHaveBeenCalledTimes(1)
    await act(async () => { finDeLaRelecture(lue({ decisions: [enVigueur({ version: 1 })], brouillon: [...lue().brouillon, ...PROPOSEE()] })) })
    await waitFor(() => expect(screen.getByText(/Décision en vigueur : version 1, du 15\/05\/2027/)).toBeTruthy())
  })

  it('une confirmation refusée n’écrit rien', async () => {
    lire.mockResolvedValue(lue())
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendre()
    await remplirLaDecision()
    await act(async () => { fireEvent.click(bouton('Enregistrer la décision')) })
    expect(rpc).not.toHaveBeenCalled()
    expect(lire).toHaveBeenCalledTimes(1)
  })

  it('le refus de la base se dit sous ses mots, la lecture est refaite, et un appel qui lève se dit aussi', async () => {
    lire.mockResolvedValue(lue())
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.' } })
    rendre()
    await attendre()
    await remplirLaDecision()
    await act(async () => { fireEvent.click(bouton('Enregistrer la décision')) })
    await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/a changé depuis sa lecture/)).toBeTruthy()
    rpc.mockRejectedValueOnce(new Error('réseau coupé'))
    await act(async () => { fireEvent.click(bouton('Enregistrer la décision')) })
    await waitFor(() => expect(screen.getByText(/réseau coupé/)).toBeTruthy())
    expect(bouton('Enregistrer la décision')).toHaveProperty('disabled', false)
  })

  it('une décision en vigueur se remplace, contre sa version lue, et la confirmation nomme la version remplacée', async () => {
    lire.mockResolvedValue(lue({ decisions: [enVigueur()], brouillon: [...lue().brouillon, ...PROPOSEE()] }))
    rpc.mockResolvedValue({ data: 'id2', error: null })
    rendre()
    await attendre()
    expect(screen.getByText(/Décision en vigueur : version 3, du 15\/05\/2027 \(Assemblée générale, comptes approuvés\)/)).toBeTruthy()
    // Rien n'a changé : le remplacement n'est pas offert.
    expect(bouton('Remplacer la décision')).toHaveProperty('disabled', true)
    expect(screen.getByText('Rien n’a changé.')).toBeTruthy()
    fireEvent.change(libelle('Mise en paiement des dividendes'), { target: { value: '2027-06-15' } })
    expect(screen.getByText(/La décision ne distribue aucun dividende : elle ne porte pas de date de mise en paiement\./)).toBeTruthy()
    fireEvent.change(libelle('Mise en paiement des dividendes'), { target: { value: '' } })
    fireEvent.change(libelle('Date de la décision'), { target: { value: '2027-05-20' } })
    await act(async () => { fireEvent.click(bouton('Remplacer la décision')) })
    await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Remplacer la décision du 20\/05\/2027 sur l’exercice 2026 \?[\s\S]*Remplace la version 3 \(décision du 15\/05\/2027\)/))
    expect(rpc).toHaveBeenCalledWith('enregistrer_affectation', expect.objectContaining({ p_version_lue: 3 }))
  })

  it('retire une décision : la confirmation la nomme, la fonction reçoit sa version lue, une fois sous deux clics', async () => {
    lire.mockResolvedValue(lue({ decisions: [enVigueur()], brouillon: [...lue().brouillon, ...PROPOSEE()] }))
    rpc.mockResolvedValue({ data: 2, error: null })
    rendre()
    await attendre()
    const b = bouton('Retirer la décision')
    await act(async () => {
      fireEvent.click(b)
      fireEvent.click(b)
    })
    await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('retirer_affectation', { p_dossier_id: 'd1', p_affectation_id: 'a1', p_version_lue: 3 })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Retirer la décision du 15\/05\/2027 \(version 3\) de l’exercice 2026 \?[\s\S]*Son écriture du 15\/05\/2027/))
  })

  it('le refus du retrait se dit sous ses mots', async () => {
    lire.mockResolvedValue(lue({ decisions: [enVigueur()], brouillon: [...lue().brouillon, ...PROPOSEE()] }))
    rpc.mockResolvedValue({ data: null, error: { message: 'Cette décision a changé depuis sa lecture : relire l’affectation avant de l’enregistrer.' } })
    rendre()
    await attendre()
    await act(async () => { fireEvent.click(bouton('Retirer la décision')) })
    await waitFor(() => expect(screen.getByText(/a changé depuis sa lecture/)).toBeTruthy())
    expect(lire).toHaveBeenCalledTimes(2)
  })

  it('une décision figée avec son exercice se montre sans aucun champ ni geste, et le dit', async () => {
    lire.mockResolvedValue(lue({ anneesValidees: [2026, 2027], decisions: [enVigueur()], brouillon: [...lue().brouillon, ...PROPOSEE()] }))
    rendre()
    await attendre()
    expect(screen.getByText(/L’exercice qui contient le 15\/05\/2027 est validé : une écriture n’y entre plus\. La décision et son écriture sont figées/)).toBeTruthy()
    expect(screen.getByText(/Décision en vigueur : version 3/)).toBeTruthy()
    // Le seul geste : télécharger le document de la décision (AFF5), qui n'écrit rien.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Télécharger le procès-verbal'])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('une ligne de l’écriture qui n’est plus proposée retient aussi le remplacement et le retrait', async () => {
    lire.mockResolvedValue(lue({ decisions: [enVigueur()], brouillon: [...lue().brouillon, { ...PROPOSEE()[0], statut: 'validee' }] }))
    rendre()
    await attendre()
    expect(screen.queryByRole('button', { name: 'Retirer la décision' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remplacer la décision' })).toBeNull()
  })

  it('les versions remplacées ou retirées restent lisibles', async () => {
    lire.mockResolvedValue(lue({ decisions: [
      enVigueur({ id: 'a0', version: 1, etat: 'remplacee', dateDecision: '2027-04-01', finLe: '2027-05-16' }),
      enVigueur({ id: 'a1', version: 2, etat: 'retiree', dateDecision: '2027-05-01', finLe: '2027-05-20' }),
    ] }))
    rendre()
    await attendre()
    expect(screen.getByText(/Versions précédentes, lisibles : version 1 du 01\/04\/2027 \(remplacée le 16\/05\/2027\), version 2 du 01\/05\/2027 \(retirée le 20\/05\/2027\)/)).toBeTruthy()
    // Retirée, l'exercice reçoit une décision nouvelle : le formulaire est offert, sans « Retirer ».
    expect(bouton('Enregistrer la décision')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retirer la décision' })).toBeNull()
  })

  it('un dossier hors du champ n’a aucune proposition, et le refus du module dit pourquoi', async () => {
    lire.mockResolvedValue(lue({ formeJuridique: '1000' }))
    rendre()
    await attendre()
    expect(screen.getByText(/Aucune proposition pour ce dossier/)).toBeTruthy()
    expect(screen.getByText(/Une entreprise individuelle n’affecte pas son résultat/)).toBeTruthy()
    expect(bouton('Enregistrer la décision')).toHaveProperty('disabled', true)
  })

  it('des comptes non approuvés se saisissent sans ligne, et la fonction reçoit une écriture nulle', async () => {
    lire.mockResolvedValue(lue())
    rpc.mockResolvedValue({ data: 'id', error: null })
    rendre()
    await attendre()
    fireEvent.change(libelle('Date de la décision'), { target: { value: '2027-05-15' } })
    fireEvent.change(libelle('Réserves statutaires, selon les statuts'), { target: { value: 'indisponibles' } })
    fireEvent.change(libelle('Comptes'), { target: { value: 'non' } })
    expect(screen.queryByText('Répartition')).toBeNull()
    await act(async () => { fireEvent.click(bouton('Enregistrer la décision')) })
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('comptes non approuvés : aucune affectation, aucune écriture'))
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_lignes: [], p_ecriture: null, p_decision: { comptes_approuves: false, reserves_statutaires_distribuables: false } })
  })

  describe('le document de la décision (AFF5)', () => {
    const decisionSansDocument = () => lue({ anneesValidees: [2026], decisions: [enVigueur()], brouillon: [...lue().brouillon, ...PROPOSEE()] })
    const choisir = async (nom: string) => {
      await act(async () => { fireEvent.change(libelle('Document signé (PDF)'), { target: { files: [new File(['%PDF'], nom)] } }) })
    }

    it('télécharge le document tiré des valeurs figées de la version en vigueur, sous son nom', async () => {
      lire.mockResolvedValue(decisionSansDocument())
      rendre()
      await attendre()
      expect(screen.getByText('Procès-verbal de l’assemblée générale ordinaire')).toBeTruthy()
      await act(async () => { fireEvent.click(bouton('Télécharger le procès-verbal')); fireEvent.click(bouton('Télécharger le procès-verbal')) })
      await waitFor(() => expect(telecharger).toHaveBeenCalledTimes(1))
      expect(pdf).toHaveBeenCalledTimes(1)
      expect(pdf.mock.calls[0][0]).toMatchObject({ annee: 2026, identite: { denomination: 'Société Fictive' }, decision: { id: 'a1', version: 3 } })
      expect(telecharger.mock.calls[0][1]).toBe('proces-verbal-affectation-2026-version-3.pdf')
    })

    it('le refus du fichier se dit au choix, avant le clic, et le bouton reste fermé', async () => {
      lire.mockResolvedValue(decisionSansDocument())
      rendre()
      await attendre()
      expect((bouton('Joindre le document signé') as HTMLButtonElement).disabled).toBe(true)
      await choisir('scan.png')
      expect(await screen.findByText('Ce document n’est pas pris : format non pris en charge (un procès-verbal signé se dépose en PDF).')).toBeTruthy()
      expect((bouton('Joindre le document signé') as HTMLButtonElement).disabled).toBe(true)
    })

    it('joint le document signé : la confirmation nomme le fichier et son empreinte, une fois sous deux clics, la lecture refaite', async () => {
      lire.mockResolvedValue(decisionSansDocument())
      let rendreLaMain: (v: { ok: true }) => void = () => {}
      joindre.mockReturnValue(new Promise((r) => { rendreLaMain = r }))
      rendre()
      await attendre()
      await choisir('pv-signe.pdf')
      await screen.findByText('pv-signe.pdf')
      await act(async () => { fireEvent.click(bouton('Joindre le document signé')); fireEvent.click(bouton('Joindre le document signé')) })
      expect(joindre).toHaveBeenCalledTimes(1)
      expect(joindre.mock.calls[0].slice(0, 2)).toEqual(['d1', 'a1'])
      expect(joindre.mock.calls[0][3]).toBe('e'.repeat(64))
      expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/« pv-signe\.pdf » \(2\sKo, empreinte SHA-256 e{64}\) comme document signé de la décision version 3/))
      await act(async () => { rendreLaMain({ ok: true }) })
      await waitFor(() => expect(lire).toHaveBeenCalledTimes(2))
    })

    it('le refus du dépôt se dit sous ses mots', async () => {
      lire.mockResolvedValue(decisionSansDocument())
      joindre.mockResolvedValue({ ok: false, message: 'Un autre fichier est déjà au chemin de cette décision (son empreinte diffère) : rien n’est joint.' })
      rendre()
      await attendre()
      await choisir('pv.pdf')
      await screen.findByText('pv.pdf')
      await act(async () => { fireEvent.click(bouton('Joindre le document signé')) })
      expect(await screen.findByText('Un autre fichier est déjà au chemin de cette décision (son empreinte diffère) : rien n’est joint.')).toBeTruthy()
    })

    it('un document déjà joint, ou un exercice de la décision validé : dit, aucun dépôt offert', async () => {
      lire.mockResolvedValue(lue({ decisions: [enVigueur({ document: { chemin: 'd1/affectations/a1.pdf', empreinte: 'c'.repeat(64) } })], brouillon: [...lue().brouillon, ...PROPOSEE()] }))
      rendre()
      await attendre()
      expect(screen.getByText('c'.repeat(64))).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Joindre le document signé' })).toBeNull()
      cleanup()
      lire.mockResolvedValue(lue({ anneesValidees: [2026, 2027], decisions: [enVigueur()] }))
      rendre()
      await attendre()
      expect(screen.getAllByText('L’exercice qui contient le 15/05/2027 est validé : une écriture n’y entre plus.').length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Joindre le document signé' })).toBeNull()
      expect(screen.queryByLabelText('Document signé (PDF)')).toBeNull()
    })

    it('une lecture incomplète n’offre ni le téléchargement ni le dépôt', async () => {
      lire.mockResolvedValue({ dossierId: 'd1', annee: 2026, etat: 'incomplete', motif: 'les décisions : ce qu’une version a figé ne se croit pas' })
      rendre()
      await attendre()
      expect(screen.queryByRole('button', { name: 'Télécharger le procès-verbal' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Joindre le document signé' })).toBeNull()
    })

    it('le calendrier de l’approbation, au jour de Paris : sans décision au 12/11/2027, le délai de six mois est passé', async () => {
      lire.mockResolvedValue(lue())
      rendre()
      await attendre()
      expect(screen.getByText('Le calendrier de l’approbation')).toBeTruthy()
      expect(screen.getByText('Délai passé sans décision enregistrée (une prorogation judiciaire a pu être demandée).')).toBeTruthy()
    })
  })
})
