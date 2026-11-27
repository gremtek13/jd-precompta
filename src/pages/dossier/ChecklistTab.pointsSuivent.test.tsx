import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChecklistTab from './ChecklistTab'
import { ExercicesValidesProvider } from '../../context/ExercicesValidesContext'
import type { LectureDeLaChecklist } from '../../lib/checklistLecture'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { InformationsDossier, Piece } from '../../lib/types'
import { SANS_FACTURE_SOURCE } from '../../test/ventesFacturees'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// LES POINTS DE LA VUE D'ENSEMBLE SUIVENT LEURS DONNÉES, ET SEULEMENT ELLES (le banc de charge, 27/11/2026 ;
// pages/dossier/ChecklistTab.tsx). `pointsDeLaChecklist` se calcule dans un `useMemo` : un rendu sans donnée neuve ne le relance
// pas, et une relecture qui change une donnée le relance — l'écran la suit, jamais une valeur d'avant. Le câblage des points
// est gardé par ChecklistTab.test.tsx ; ici, la lecture du dossier est posée par le cas, les cartes qui lisent à part sont
// doublées, et le calcul des points est compté. Données FICTIVES.

const D = 'dossier-de-test'

const etat = vi.hoisted(() => ({ lecture: null as unknown, lectures: 0, calculs: 0, majs: [] as unknown[] }))

vi.mock('../../lib/checklistLecture', () => ({
  lireLaChecklist: () => { etat.lectures++; return Promise.resolve(etat.lecture) },
}))
vi.mock('../../lib/pointsDeLaChecklist', async (original) => {
  const vrai = await original<typeof import('../../lib/pointsDeLaChecklist')>()
  return {
    ...vrai,
    pointsDeLaChecklist: (...args: Parameters<typeof vrai.pointsDeLaChecklist>) => { etat.calculs++; return vrai.pointsDeLaChecklist(...args) },
  }
})
// Les cartes qui font leur propre lecture : hors de ce que ce test garde.
vi.mock('./EncartFactureElectronique', () => ({ default: () => null }))
vi.mock('./CarteEspaceClient', () => ({ default: () => null }))
vi.mock('./AlerteHausseDuChiffreDAffaires', () => ({ default: () => null }))
vi.mock('../../components/AvisChangementDeRib', () => ({ default: () => null }))
vi.mock('../../lib/changementDeRibLecture', () => ({ useDernierChangementDeRib: () => null }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ update: (valeur: unknown) => ({ eq: () => { etat.majs.push(valeur); return Promise.resolve({ error: null }) } }) }),
  },
}))
afterEach(() => { cleanup(); etat.lecture = null; etat.lectures = 0; etat.calculs = 0; etat.majs = [] })

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/p.pdf`, nom_fichier: 'p.pdf', storage_hash: 'e',
    date_piece: '2026-03-02', tiers: 'Fournisseur fictif', montant_ht: null, montant_tva: null, montant_ttc: 40, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, created_at: '2026-03-02T09:00:00Z', updated_at: '2026-03-02T09:00:00Z', ...o,
  }
}

const INFO: InformationsDossier = {
  id: 'i1', dossier_id: D, vehicule_type: 'aucun', vehicule_libelle: null, jours_travailles_an: null, tickets_restaurant: true,
  justificatif_tickets_restaurant_recu: false, cheques_vacances: false, justificatif_cheques_vacances_recu: false, notes: null,
  updated_at: '2026-01-01T10:00:00Z',
}

function lecture(o: Partial<LectureDeLaChecklist>): LectureDeLaChecklist {
  return {
    notesDeFrais: { etat: 'sans_objet' }, bordereauxDeposes: null,
    piecesValidees: [], piecesAValider: [], cotisations: [], lignes: [], relevesIncoherents: [], controlesReleves: [],
    comptesBancaires: { etat: 'sans_objet' }, doublonsTexte: [], immobilisations: [], natures: [], categories: [], ecritures: [],
    emprunts: [], ventilations: [], ventilationsPartielles: false, reglements: [], reglementsPartiels: false, paiementsPartiels: false,
    lettragesManuels: [], vehicules: [], declarationsTva: [], declarationsPartielles: false, facturesEmises: [], transmissions: [],
    jumellesPartielles: false, info: INFO, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
    aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null, ventesFacturees: null, facturesSources: SANS_FACTURE_SOURCE,
    caisse: { dossierId: D, enBase: false, lignes: [], complete: false, motif: null }, entreesDeLaCaisseIncompletes: null,
    entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' }, assuranceMaladie: null,
    lectureIncomplete: null, piecesIncompletes: null, inventaireIncomplet: null, clotureInconnue: null, soldesReportesIncomplets: null,
    ventesIncompletes: null, ...o,
  }
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }
// Un contexte qui ne change pas d'un rendu à l'autre, comme celui de la page du dossier (DossierDetail) : ce sont les seules
// données de l'onglet qui décident de ses calculs.
const AUCUN_EXERCICE_VALIDE = [] as const
const relire = async () => {}

function arbre(statutTva: 'exonere' | null = 'exonere') {
  return (
    <ExercicesValidesProvider exercices={AUCUN_EXERCICE_VALIDE} relire={relire}>
      <ChecklistTab
        dossierId={D} assujettiTva={false} periodiciteTva="trimestrielle" statutTva={statutTva} modele={TRESORERIE}
        ventesParLesFactures={false} codeNaf="86.90D" onNavigate={() => {}}
      />
    </ExercicesValidesProvider>
  )
}

const SANS_CATEGORIE = /pièce\(s\) validée\(s\) sans catégorie/

describe('ChecklistTab — les points suivent leurs données, et seulement elles', () => {
  it('un rendu sans donnée neuve ne recalcule pas les points ; la relecture qui range la pièce les recalcule, et l’écran la suit', async () => {
    etat.lecture = lecture({ piecesValidees: [piece({ id: 'p1' })] })
    const { rerender } = render(arbre())
    expect(await screen.findByText(SANS_CATEGORIE)).toBeTruthy()
    const apresLaLecture = etat.calculs
    expect(apresLaLecture).toBeGreaterThan(0)

    // La page du dossier qui se redessine, les mêmes réglages et la même lecture : aucun calcul de plus.
    rerender(arbre())
    rerender(arbre())
    expect(screen.getByText(SANS_CATEGORIE)).toBeTruthy()
    expect(etat.calculs).toBe(apresLaLecture)

    // Une relecture — celle qui suit la coche d'un justificatif — rend la pièce rangée dans une catégorie : le point part.
    etat.lecture = lecture({
      piecesValidees: [piece({ id: 'p1', categorie_id: 'c1' })], info: { ...INFO, justificatif_tickets_restaurant_recu: true },
      categories: [{ id: 'c1', dossier_id: D, code: 'fournitures', libelle: 'Fournitures', ordre: 1, compte_comptable: '606400', poste_2035: 'Fournitures, travaux et services extérieurs' }],
    })
    const coche = screen.getByTitle('Cliquer pour marquer comme reçu/non reçu')
    await act(async () => { coche.click() })
    expect(etat.majs).toEqual([{ justificatif_tickets_restaurant_recu: true }])
    await waitFor(() => expect(screen.queryByText(SANS_CATEGORIE)).toBeNull())
    expect(etat.lectures).toBe(2)
    expect(etat.calculs).toBeGreaterThan(apresLaLecture)
  })

  // Un réglage du dossier qui change sans relecture (le statut de TVA, posé dans l'onglet TVA) : les points le suivent au rendu
  // même — une dépendance oubliée du calcul laisserait l'écran sur l'ancien statut.
  it('un réglage du dossier qui change recalcule les points, sans relecture', async () => {
    etat.lecture = lecture({})
    const { rerender } = render(arbre('exonere'))
    await screen.findByText(/Paramétrage/)
    expect(screen.queryByText(/Statut de TVA à préciser/)).toBeNull()
    rerender(arbre(null))
    expect(screen.getByText(/Statut de TVA à préciser/)).toBeTruthy()
    expect(etat.lectures).toBe(1)
  })
})
