import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import FactureAssuranceMaladie from './FactureAssuranceMaladie'
import { CONSIGNE_DU_FACTURE_AU_CABINET, phraseApresLImportDuFacture } from '../lib/factureAssuranceMaladieVue'
import type { FactureLu } from '../lib/factureAssuranceMaladieLecture'
import { REFUS_DE_L_IMPORT_DU_FACTURE } from '../lib/importDuFactureAssuranceMaladie'
import type { BordereauLu, LectureDuBordereau } from '../lib/bordereauDeTeletransmission'
import type { FactureAssuranceMaladie as Total, ImportFacturesAssuranceMaladie } from '../lib/types'

// L'écran du facturé à l'assurance maladie (BOR4) : drapeau baissé, rien n'est monté ni lu ; la règle d'offre de NOE4 ; rien
// avant le retour ; une lecture partielle n'offre aucun geste ; les bordereaux — FICTIFS, des numéros de lot faits de 9, des
// caisses « VILLE FICTIVE » — lus dans le navigateur (la lecture de BOR1 remplacée ici), l'aperçu en agrégats, jamais un numéro
// de lot ; le régime « à choisir » ; un fichier refusé retient l'envoi ; la confirmation nomme ce qui part ; un envoi pour deux
// clics ; l'échec de la base dit ; le retrait confirmé ; la consigne au cabinet seul ; le client sans « Banque ».

const faux = vi.hoisted(() => ({
  drapeau: true,
  lecture: null as FactureLu | null,
  lectures: 0,
  bordereaux: {} as Record<string, LectureDuBordereau>,
  ouverts: [] as string[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  reponse: { data: {}, error: null } as { data: unknown; error: unknown },
  retenir: [] as (() => void)[],
}))

vi.mock('../lib/importDuFactureAssuranceMaladie', async (original) => ({
  ...await original<typeof import('../lib/importDuFactureAssuranceMaladie')>(),
  get FACTURES_ASSURANCE_MALADIE_PREVUES() { return faux.drapeau },
}))
vi.mock('../lib/factureAssuranceMaladieLecture', () => ({
  lireLeFactureAssuranceMaladie: () => { faux.lectures++; return faux.lecture ? Promise.resolve(faux.lecture) : new Promise(() => {}) },
}))
vi.mock('../lib/bordereauDeTeletransmissionLecture', () => ({
  lireLeBordereauDeTeletransmission: (f: File) => {
    faux.ouverts.push(f.name)
    return Promise.resolve(faux.bordereaux[f.name] ?? { etat: 'refuse', raison: 'le titre est absent' })
  },
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (nom: string, args: Record<string, unknown>) => {
      faux.appels.push({ nom, args })
      const reponse = faux.reponse
      return new Promise((r) => { faux.retenir.push(() => r(reponse)) })
    },
  },
}))

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-20T10:00:00Z')) })
afterAll(() => { vi.useRealTimers() })
afterEach(() => {
  faux.drapeau = true; faux.lecture = null; faux.lectures = 0; faux.bordereaux = {}; faux.ouverts = []; faux.appels = []
  faux.reponse = { data: {}, error: null }; faux.retenir = []
})

const lue = <T,>(lignes: T[], complete = true) => ({ lignes, complete, motif: complete ? null : 'lecture interrompue' })
const lus = (imports: ImportFacturesAssuranceMaladie[] = [], totaux: Total[] = [], complete = true): FactureLu =>
  ({ dossierId: 'd1', etat: 'lus', imports: lue(imports), totaux: lue(totaux, complete) })

function bordereau(o: Partial<BordereauLu> = {}): BordereauLu {
  return {
    lot: 999999001, creeLe: '2026-10-05', securise: false, organisme: { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
    nombreDeFactures: 3, totaux: { totalCentimes: 6540, caisseCentimes: 4580, mutuelleCentimes: 1960, assureCentimes: 0 },
    ...o,
  }
}
const AUTRE = { code: '996', libelle: 'CAISSE FICTIVE' }

function fichier(nom: string): File {
  return new File([new Uint8Array([37, 80, 68, 70]) as Uint8Array<ArrayBuffer>], nom, { type: 'application/pdf' })
}

const fenetre = () => screen.getByRole('dialog')
const lisible = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ')

async function ouvrirEtChoisir(...noms: string[]) {
  fireEvent.click(await screen.findByRole('button', { name: 'Importer des bordereaux de télétransmission' }))
  const entree = within(fenetre()).getByLabelText(/^Bordereaux en PDF/) as HTMLInputElement
  Object.defineProperty(entree, 'files', { value: noms.map(fichier), configurable: true })
  await act(async () => { fireEvent.change(entree) })
}

const IMPORT: ImportFacturesAssuranceMaladie = {
  id: 'i1', dossier_id: 'd1', premier_lot_le: '2026-10-05', dernier_lot_le: '2026-10-05', nombre_de_lots: 1,
  nombre_de_factures: 3, importe_par: 'u1', importe_le: '2026-11-19T09:00:00Z',
}
const TOTAL: Total = {
  id: 't1', dossier_id: 'd1', import_id: 'i1', date_creation_lot: '2026-10-05', part: 'obligatoire', regime: 1, caisse: 999,
  organisme_complementaire: null, montant_centimes: 4580, nombre_de_lots: 1, nombre_de_factures: 3,
}

describe('le facturé à l’assurance maladie, à l’écran', () => {
  it('drapeau baissé : rien n’est monté, rien n’est lu', () => {
    faux.drapeau = false
    const { container } = render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    expect(container.innerHTML).toBe('')
    expect(faux.lectures).toBe(0)
  })

  it('la règle de NOE4 : hors d’un code de santé sans import, rien ; un import du facturé lu, la section reste offerte', async () => {
    faux.lecture = lus()
    for (const espace of ['client', 'cabinet'] as const) {
      for (const codeNaf of ['69.20Z', null, undefined]) {
        const { container, unmount } = render(<FactureAssuranceMaladie espace={espace} dossierId="d1" codeNaf={codeNaf} />)
        await act(async () => {})
        expect(container.innerHTML, `${espace} ${String(codeNaf)}`).toBe('')
        unmount()
      }
    }
    faux.lecture = lus([IMPORT], [TOTAL])
    render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="69.20Z" />)
    expect(await screen.findByRole('button', { name: 'Importer des bordereaux de télétransmission' })).toBeTruthy()
  })

  it('rien avant le retour ; une lecture partielle n’offre aucun geste ; un client sans « Banque » n’a rien', async () => {
    const premier = render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    premier.unmount()
    faux.lecture = lus([IMPORT], [TOTAL], false)
    const deuxieme = render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByText(/Les totaux de tes bordereaux importés/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    deuxieme.unmount()
    faux.lecture = { dossierId: 'd1', etat: 'sans_banque' }
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByText(/Ton accès ne porte plus « Banque »/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('la consigne de BOR3-RGPD (B) se dit au cabinet seul', async () => {
    faux.lecture = lus()
    const cabinet = render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    expect(await screen.findByText(CONSIGNE_DU_FACTURE_AU_CABINET)).toBeTruthy()
    cabinet.unmount()
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await screen.findByRole('button', { name: 'Importer des bordereaux de télétransmission' })
    expect(screen.queryByText(CONSIGNE_DU_FACTURE_AU_CABINET)).toBeNull()
  })

  it('les fichiers lus dans le navigateur, sous le rang de leurs bordereaux ; le régime à choisir ; l’aperçu sans numéro de lot', async () => {
    faux.lecture = lus()
    faux.bordereaux = {
      'lots-octobre.pdf': { etat: 'lu', bordereaux: [bordereau(), bordereau({ lot: 999999002, organisme: AUTRE })] },
      'lot-novembre.pdf': { etat: 'lu', bordereaux: [bordereau({ lot: 999999003, creeLe: '2026-11-02' })] },
    }
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('lots-octobre.pdf', 'lot-novembre.pdf')
    expect(faux.ouverts).toEqual(['lots-octobre.pdf', 'lot-novembre.pdf'])
    const f = within(fenetre())
    expect(lisible(fenetre().textContent)).toContain('lots-octobre.pdf — 2 bordereaux (1 à 2 de l’envoi).')
    expect(lisible(fenetre().textContent)).toContain('lot-novembre.pdf — 1 bordereau (le bordereau 3 de l’envoi).')
    expect(f.getByText('L’aperçu attend le régime de 1 organisme.')).toBeTruthy()
    expect((f.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(f.getByLabelText('Régime de 996 - CAISSE FICTIVE'), { target: { value: '2' } })
    const apercu = f.getByRole('table', { name: 'Aperçu du facturé' })
    expect(lisible(apercu.textContent)).toContain('MSA (régime 02), caisse 996')
    expect(lisible(apercu.textContent)).toContain('organisme complémentaire non dit')
    expect(within(apercu).getAllByRole('row')).toHaveLength(6)
    expect((f.getByRole('button', { name: 'Importer 3 lots' }) as HTMLButtonElement).disabled).toBe(false)
    expect(document.body.textContent).not.toMatch(/99999900/)
    expect(faux.appels).toEqual([])
  })

  it('un fichier refusé retient tout l’envoi, et sa raison se dit ; retiré de l’envoi, le reste peut partir', async () => {
    faux.lecture = lus()
    faux.bordereaux = {
      'bon.pdf': { etat: 'lu', bordereaux: [bordereau()] },
      'douteux.pdf': { etat: 'refuse', raison: 'bordereau 1, page 1, ligne 9 : les sommes ne tombent pas' },
    }
    render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('bon.pdf', 'douteux.pdf')
    const f = within(fenetre())
    expect(lisible(fenetre().textContent)).toContain('douteux.pdf — refusé : bordereau 1, page 1, ligne 9 : les sommes ne tombent pas.')
    expect(f.getByText(/Un fichier de l’envoi est refusé : rien ne peut partir tant qu’il y est\. Le retirer/)).toBeTruthy()
    expect(f.queryByRole('table', { name: 'Aperçu du facturé' })).toBeNull()
    expect((f.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
    const ligne = f.getByText('douteux.pdf').closest('li') as HTMLElement
    fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer de l’envoi' }))
    expect(f.getByRole('table', { name: 'Aperçu du facturé' })).toBeTruthy()
    expect((f.getByRole('button', { name: 'Importer 1 lot' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('un doute de BOR2 (le même lot deux fois) se dit avant le clic, et rien ne peut partir', async () => {
    faux.lecture = lus()
    faux.bordereaux = {
      'a.pdf': { etat: 'lu', bordereaux: [bordereau()] },
      'b.pdf': { etat: 'lu', bordereaux: [bordereau()] },
    }
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('a.pdf', 'b.pdf')
    expect(within(fenetre()).getByText(/^Bordereaux 1 et 2 de l’envoi : le même lot deux fois\. Rien ne peut partir/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('le refus de la base, redit, se dit avant le clic sur l’envoi tel qu’il partira : rien ne part', async () => {
    faux.lecture = lus()
    faux.bordereaux = { 'gros-lot.pdf': { etat: 'lu', bordereaux: [bordereau({ nombreDeFactures: 10_001 })] } }
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('gros-lot.pdf')
    expect(within(fenetre()).getByText(REFUS_DE_L_IMPORT_DU_FACTURE.lot)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Importer' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('la confirmation nomme ce qui part ; un envoi pour deux clics, tel qu’il part ; puis la phrase d’après et la relecture', async () => {
    faux.lecture = lus()
    faux.bordereaux = { 'lot.pdf': { etat: 'lu', bordereaux: [bordereau()] } }
    render(<FactureAssuranceMaladie espace="client" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('lot.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Importer 1 lot' }))
    const confirmation = lisible(within(fenetre()).getByRole('status').textContent)
    expect(confirmation).toMatch(/^2 totaux du facturé partent en base — 1 lot créé le 05\/10\/2026/)
    expect(confirmation).toContain('restent dans tes fichiers, sur ton ordinateur')
    const confirmer = screen.getByRole('button', { name: 'Confirmer l’import' })
    act(() => { fireEvent.click(confirmer); fireEvent.click(confirmer) })
    expect(faux.appels).toEqual([{
      nom: 'importer_factures_assurance_maladie',
      args: {
        p_dossier_id: 'd1',
        p_import: {
          version: 1,
          lots: [{ numero: 999999001, cree_le: '2026-10-05', caisse: 999, nombre_de_factures: 3 }],
          agregats: [
            { date_creation_lot: '2026-10-05', part: 'obligatoire', regime: 1, caisse: 999, organisme_complementaire: null, montant_centimes: 4580, nombre_de_lots: 1, nombre_de_factures: 3 },
            { date_creation_lot: '2026-10-05', part: 'complementaire', regime: null, caisse: null, organisme_complementaire: null, montant_centimes: 1960, nombre_de_lots: 1, nombre_de_factures: 3 },
          ],
        },
      },
    }])
    const avant = faux.lectures
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(await screen.findByText(phraseApresLImportDuFacture('client'))).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faux.lectures).toBe(avant + 1)
  })

  it('le refus de la base se dit dans la fenêtre, et le verrou se relâche', async () => {
    faux.lecture = lus()
    faux.bordereaux = { 'lot.pdf': { etat: 'lu', bordereaux: [bordereau()] } }
    faux.reponse = { data: null, error: { message: 'Le bordereau 1 de l’envoi a déjà été importé le 19/11/2026 : un lot ne s’importe pas deux fois.' } }
    render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    await ouvrirEtChoisir('lot.pdf')
    fireEvent.click(screen.getByRole('button', { name: 'Importer 1 lot' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’import' }))
    await act(async () => { faux.retenir.forEach((r) => r()) })
    expect(within(fenetre()).getByText(/a déjà été importé le 19\/11\/2026/)).toBeTruthy()
    const confirmer = screen.getByRole('button', { name: 'Confirmer l’import' }) as HTMLButtonElement
    expect(confirmer.disabled).toBe(false)
    act(() => { fireEvent.click(confirmer) })
    expect(faux.appels).toHaveLength(2)
  })

  it('le retrait : la confirmation nomme ce qui part, puis un appel pour deux clics', async () => {
    faux.lecture = lus([IMPORT], [TOTAL, { ...TOTAL, id: 't2', part: 'complementaire', regime: null, caisse: null, montant_centimes: 1960 }])
    render(<FactureAssuranceMaladie espace="cabinet" dossierId="d1" codeNaf="86.90D" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer' }))
    expect(lisible(screen.getByRole('alert').textContent)).toContain('Retirer l’import des lots créés le 05/10/2026 : 1 lot, environ 3 factures, '
      + '45,80 € de part obligatoire et 19,60 € de part complémentaire partent avec lui')
    const retirer = screen.getByRole('button', { name: 'Retirer cet import' })
    act(() => { fireEvent.click(retirer); fireEvent.click(retirer) })
    expect(faux.appels).toEqual([{ nom: 'retirer_import_factures_assurance_maladie', args: { p_import_id: 'i1' } }])
  })
})
