import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { etat, libererTout, reinitialiser } from '../test/clientRetenu'
import { MENTIONS_VIDES } from '../test/factures'
import type { Dossier, FactureEmise, Piece } from '../lib/types'
import type { ModeleComptable } from '../lib/engagement'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../components/PanneauDroit'
import { AnneeProvider } from '../context/AnneeContext'
import { ExercicesValidesProvider } from '../context/ExercicesValidesContext'
import Layout from '../components/Layout'
import CabinetBrandingPage from './CabinetBrandingPage'
import ClientHome from './ClientHome'
import ClientInformations from './ClientInformations'
import ClientSimulation from './ClientSimulation'
import ClientUpload from './ClientUpload'
import DossierDetail from './DossierDetail'
import DossiersList from './DossiersList'
import EquipePage from './EquipePage'
import RetourBanque from './RetourBanque'
import SuperAdminPage from './SuperAdminPage'
import AccesTab from './dossier/AccesTab'
import AssistantTab from './dossier/AssistantTab'
import BalanceCard from './dossier/BalanceCard'
import BanqueTab from './dossier/BanqueTab'
import BilanTab from './dossier/BilanTab'
import ChecklistTab from './dossier/ChecklistTab'
import ClotureTab from './dossier/ClotureTab'
import ConnexionBancaireCard from './dossier/ConnexionBancaireCard'
import CotisationsTab from './dossier/CotisationsTab'
import DocumentsTab from './dossier/DocumentsTab'
import EcrituresTab from './dossier/EcrituresTab'
import EncaissementsFactureModal from './dossier/EncaissementsFactureModal'
import EstimationTab from './dossier/EstimationTab'
import FactureApercu from './dossier/FactureApercu'
import FactureAvoirModal from './dossier/FactureAvoirModal'
import FactureFormModal from './dossier/FactureFormModal'
import FacturesTab from './dossier/FacturesTab'
import FichePiece from './dossier/FichePiece'
import FicheHorsDeFrance, { type DonneesHorsDeFrance } from './dossier/FicheHorsDeFrance'
import FinancementTab from './dossier/FinancementTab'
import ImmobilisationsTab from './dossier/ImmobilisationsTab'
import InformationsTab from './dossier/InformationsTab'
import PacksTab from './dossier/PacksTab'
import PiecesTab from './dossier/PiecesTab'
import PlateformeClientModal from './dossier/PlateformeClientModal'
import RevisionTab from './dossier/RevisionTab'
import StatistiquesTab from './dossier/StatistiquesTab'
import SuperPdpModal from './dossier/SuperPdpModal'
import SupplementsTab from './dossier/SupplementsTab'
import TransmissionFactureModal from './dossier/TransmissionFactureModal'
import TvaTab from './dossier/TvaTab'
import VehiculesCard from './dossier/VehiculesCard'
import VirementsTab from './dossier/VirementsTab'
import VoletSocialCard from './dossier/VoletSocialCard'

// LE VIDE EST UNE AFFIRMATION, ET AUCUN ÉCRAN NE LA FAIT AVANT D'AVOIR LU (CLAUDE.md, « Lectures et écritures »).
//
// `ClientUpload` réclamait au client, au premier rendu, des relevés qu'il avait envoyés ; `AccesTab` disait « Aucun accès
// client pour ce dossier. » d'un dossier qui en a un ; la Banque comptait « 0 mouvement(s) non rapproché(s) (0,00 €) »,
// les Écritures « 0 écriture proposée », le Financement « 0,00 € » de mensualités, les Packs « Aucun pack généré » — chaque
// fois parce que la liste était vide FAUTE D'AVOIR ÉTÉ LUE. Corriger un écran ne protège pas le suivant : ce garde monte
// TOUS les écrans qui lisent la base sous un faux client qui ne rend rien (src/test/clientRetenu.ts), et relève le texte.
//
//  1. AVANT toute réponse, aucun texte ne dit le vide ni un compte : ni « aucun », ni « rien », ni un « 0 » ou « 0,00 € »
//     isolé — ni un tableau sans ligne, qui se lit de même sans un mot. Un squelette, « Chargement… », un titre, une
//     explication sont permis ; une phrase fixe qui contient l'un de ces mots est une exception nommée, avec sa raison et
//     son nombre d'occurrences — et le garde exige qu'elle soit vue.
//  2. Une fois les lectures revenues vides, puis refusées, l'écran ne reste pas en « Chargement… » : l'état d'attente
//     se lève sur un succès comme sur un refus (le bandeau ou le message d'erreur prend la place).
//  3. La liste des écrans part de TOUT : chaque fichier de `src/pages` et `src/components` qui importe le client
//     Supabase, ou un module de `src/lib` qui le fait, est monté ici ou écarté avec sa raison. Un écran ajouté demain sans
//     y figurer fait échouer ce garde.
//
// Ce que ce garde ne voit pas, et que les tests de chaque écran gardent : un état lu en partie (une table revenue, l'autre
// non), une relecture, un changement d'exercice ou de période écran ouvert (VoletSocialCard, PacksTab).
//
// Et sa sœur, plus bas (« aucun geste n'écrit avant que ses listes soient lues ») : les mêmes écrans, aucune réponse
// revenue, chaque geste offert tenté — une écriture qui part alors part sans rien avoir lu.

vi.mock('../lib/supabase', async () => ({ supabase: (await import('../test/clientRetenu')).supabase }))
// pdf.js touche au navigateur dès l'import (`DOMMatrix`) : les deux modules qui le chargent sont doublés, comme dans les
// tests de la Banque et de la Clôture. Aucun n'est atteint au montage ; la lecture d'un relevé PDF l'est par le second
// garde, qui donne un fichier à chaque champ : elle rend deux opérations fictives, de quoi offrir l'import.
vi.mock('../lib/pdfText', () => ({
  extractPdfLignes: async () => [
    { texte: '01/09/2026 PRLV FICTIF -12,50', xFin: 0 },
    { texte: '02/09/2026 VIR FICTIF 100,00', xFin: 0 },
  ],
}))
vi.mock('../lib/remplir2035', () => ({
  remplir2035: () => { throw new Error('la génération de la 2035 ne doit pas être atteinte par ce garde') },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'chef@cabinet-fictif.fr' }, access_token: 'jeton-fictif' },
    role: 'cabinet', dossierIds: ['d1'], mesSocietes: [{ id: 'd1', nom: 'Dossier fictif' }],
    dossierActifId: 'd1', setDossierActifId: () => {}, isSuperAdmin: true, estChef: true,
    monCabinetId: 'cab1', loading: false, signOut: async () => {},
    // Les deux cases sur le dossier monté (espace client, étape P7) : sans « Banque », « Ma simulation » ne demanderait
    // rien une fois la couverture du relevé en base, et ce garde la tiendrait pour aveugle.
    droitsParDossier: { d1: { ventes: true, banque: true } },
  }),
}))

// jsdom n'a pas `matchMedia`, que la coque lit (thème, largeur).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (requete: string) => ({
    matches: false, media: requete, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  }),
})

// Typés sans `as` : le compilateur confronte chaque champ à la table.
function dossier(o: Partial<Dossier> = {}): Dossier {
  return {
    id: 'd1', nom: 'Dossier fictif', cabinet_id: 'cab1', siret: '12345678901234', contact_nom: null, contact_email: null,
    notes: null, archive: false, created_at: '2026-01-05T09:00:00Z', code_email: 'abc123', assujetti_tva: true,
    statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false, tva_periodicite: 'trimestrielle',
    tva_sur_debits: false, mode_comptable: 'tresorerie', compte_notes_de_frais: '108000', code_naf: null, libelle_naf: null,
    adresse: null, ...o,
  }
}

function facture(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee', type: 'facture',
    facture_origine_id: null, date_emission: '2026-03-10', date_echeance: null,
    tiers_nom: 'CLINIQUE FICTIVE', tiers_adresse: null, tiers_siret: null,
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, mentions_legales: null, notes: null,
    emetteur_nom: 'Cabinet fictif', emetteur_siret: '12345678901234', emetteur_adresse: null,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: null, created_at: '2026-03-10T09:00:00Z', validated_at: '2026-03-10T09:05:00Z', ...MENTIONS_VIDES, ...o,
  }
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload',
    storage_path: 'd1/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2026-09-01', tiers: 'FOURNISSEUR FICTIF', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2026-09-10T09:00:00Z', updated_at: '2026-09-10T09:00:00Z', ...o,
  }
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000' }
const rien = () => {}
// La fiche « hors de France » d'une pièce reçoit les fiches du dossier de l'onglet des pièces (monté ici, qui les lit) :
// montée seule, elle les reçoit lues — un dossier sans fiche. Elle lit elle-même le texte de la pièce, que ce garde retient.
const FICHES_RECUES: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
}

// Ce qu'un onglet reçoit de la page du dossier : le volet de droite, les exercices validés, l'exercice choisi.
function Dossier1({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <FournisseurPanneauDroit>
        <ExercicesValidesProvider exercices={[]} relire={async () => {}}>
          <AnneeProvider defaut={2026}>{children}</AnneeProvider>
        </ExercicesValidesProvider>
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>
    </MemoryRouter>
  )
}

interface Ecran {
  nom: string
  // Le fichier de l'écran, relatif à `src` : c'est par lui que la liste se confronte au dépôt.
  fichier: string
  rendre: () => ReactNode
}

const ECRANS: Ecran[] = [
  { nom: 'Layout', fichier: 'components/Layout.tsx', rendre: () => (
    <MemoryRouter initialEntries={['/dossiers']}>
      <Routes><Route element={<Layout />}><Route path="/dossiers" element={<p>contenu</p>} /></Route></Routes>
    </MemoryRouter>
  ) },
  { nom: 'ClientHome', fichier: 'pages/ClientHome.tsx', rendre: () => <MemoryRouter><ClientHome /></MemoryRouter> },
  { nom: 'ClientUpload', fichier: 'pages/ClientUpload.tsx', rendre: () => <MemoryRouter><ClientUpload /></MemoryRouter> },
  { nom: 'ClientInformations', fichier: 'pages/ClientInformations.tsx', rendre: () => <MemoryRouter><ClientInformations /></MemoryRouter> },
  { nom: 'ClientSimulation', fichier: 'pages/ClientSimulation.tsx', rendre: () => <MemoryRouter><ClientSimulation /></MemoryRouter> },
  { nom: 'DossiersList', fichier: 'pages/DossiersList.tsx', rendre: () => <Dossier1><DossiersList /></Dossier1> },
  { nom: 'DossierDetail', fichier: 'pages/DossierDetail.tsx', rendre: () => (
    <MemoryRouter initialEntries={['/dossiers/d1/checklist']}>
      <FournisseurPanneauDroit>
        <Routes><Route path="/dossiers/:id/:tab" element={<DossierDetail />} /></Routes>
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>
    </MemoryRouter>
  ) },
  { nom: 'SuperAdminPage', fichier: 'pages/SuperAdminPage.tsx', rendre: () => <MemoryRouter><SuperAdminPage /></MemoryRouter> },
  { nom: 'EquipePage', fichier: 'pages/EquipePage.tsx', rendre: () => <MemoryRouter><EquipePage /></MemoryRouter> },
  { nom: 'CabinetBrandingPage', fichier: 'pages/CabinetBrandingPage.tsx', rendre: () => <MemoryRouter><CabinetBrandingPage /></MemoryRouter> },
  { nom: 'RetourBanque', fichier: 'pages/RetourBanque.tsx', rendre: () => (
    <MemoryRouter initialEntries={['/retour-banque?code=code-fictif&state=etat-fictif']}><RetourBanque /></MemoryRouter>
  ) },
  { nom: 'AccesTab', fichier: 'pages/dossier/AccesTab.tsx', rendre: () => <Dossier1><AccesTab dossierId="d1" dossierNom="Dossier fictif" codeEmail="abc123" /></Dossier1> },
  { nom: 'AssistantTab', fichier: 'pages/dossier/AssistantTab.tsx', rendre: () => <Dossier1><AssistantTab dossierId="d1" dossierNom="Dossier fictif" onFermer={rien} /></Dossier1> },
  { nom: 'BalanceCard', fichier: 'pages/dossier/BalanceCard.tsx', rendre: () => <Dossier1><BalanceCard dossierId="d1" /></Dossier1> },
  { nom: 'BanqueTab', fichier: 'pages/dossier/BanqueTab.tsx', rendre: () => <Dossier1><BanqueTab dossierId="d1" modele={TRESORERIE} assujettiTva={false} /></Dossier1> },
  { nom: 'BilanTab (trésorerie)', fichier: 'pages/dossier/BilanTab.tsx', rendre: () => (
    <Dossier1><BilanTab dossierId="d1" modele={TRESORERIE} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'BilanTab (engagement)', fichier: 'pages/dossier/BilanTab.tsx', rendre: () => (
    <Dossier1><BilanTab dossierId="d1" modele={{ mode: 'engagement', compteNotesDeFrais: '455000' }} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'ChecklistTab', fichier: 'pages/dossier/ChecklistTab.tsx', rendre: () => (
    <Dossier1><ChecklistTab dossierId="d1" assujettiTva={false} periodiciteTva="trimestrielle" statutTva={null} modele={TRESORERIE} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'ClotureTab', fichier: 'pages/dossier/ClotureTab.tsx', rendre: () => (
    <Dossier1><ClotureTab dossierId="d1" assujettiTva={false} periodiciteTva="trimestrielle" modele={TRESORERIE} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'ConnexionBancaireCard', fichier: 'pages/dossier/ConnexionBancaireCard.tsx', rendre: () => (
    <Dossier1><ConnexionBancaireCard dossierId="d1" lignes={[]} regles={[]} suspension={null} lectureEnCours={false} frontiere={null} onImported={rien} /></Dossier1>
  ) },
  { nom: 'CotisationsTab', fichier: 'pages/dossier/CotisationsTab.tsx', rendre: () => <Dossier1><CotisationsTab dossierId="d1" modele={{ mode: 'tresorerie', compteNotesDeFrais: '455000' }} /></Dossier1> },
  { nom: 'DocumentsTab', fichier: 'pages/dossier/DocumentsTab.tsx', rendre: () => <Dossier1><DocumentsTab dossierId="d1" /></Dossier1> },
  { nom: 'EcrituresTab', fichier: 'pages/dossier/EcrituresTab.tsx', rendre: () => (
    <Dossier1><EcrituresTab dossierId="d1" dossierNom="Dossier fictif" dossierSiret={null} assujettiTva={false} modele={TRESORERIE} onModeleUpdated={rien} /></Dossier1>
  ) },
  { nom: 'EncaissementsFactureModal', fichier: 'pages/dossier/EncaissementsFactureModal.tsx', rendre: () => (
    <Dossier1><EncaissementsFactureModal dossierId="d1" facture={facture()} statutTva="redevable" onClose={rien} onUpdated={rien} /></Dossier1>
  ) },
  { nom: 'EstimationTab', fichier: 'pages/dossier/EstimationTab.tsx', rendre: () => <Dossier1><EstimationTab dossierId="d1" assujettiTva={false} modeComptable="tresorerie" /></Dossier1> },
  { nom: 'FactureApercu', fichier: 'pages/dossier/FactureApercu.tsx', rendre: () => (
    <Dossier1><FactureApercu facture={facture()} dossier={{ statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }} onClose={rien} /></Dossier1>
  ) },
  { nom: 'FactureAvoirModal', fichier: 'pages/dossier/FactureAvoirModal.tsx', rendre: () => (
    <Dossier1><FactureAvoirModal dossierId="d1" factureOrigine={facture()} credite={null} onClose={rien} onCreated={rien} /></Dossier1>
  ) },
  { nom: 'FactureFormModal', fichier: 'pages/dossier/FactureFormModal.tsx', rendre: () => (
    <Dossier1>
      <FactureFormModal
        dossierId="d1" dossierNom="Dossier fictif" dossierSiret={null} dossierAdresse={null} statutTva="redevable"
        articleExoneration={null} numeroTvaAttribue={false} tvaSurDebits={false} facture={facture({ statut: 'brouillon', numero: null })}
        onAdresseUpdated={rien} onClose={rien} onSaved={rien}
      />
    </Dossier1>
  ) },
  { nom: 'FacturesTab', fichier: 'pages/dossier/FacturesTab.tsx', rendre: () => (
    <Dossier1>
      <FacturesTab
        dossierId="d1" dossierNom="Dossier fictif" dossierSiret={null} dossierAdresse={null} statutTva="redevable"
        articleExoneration={null} numeroTvaAttribue={false} tvaSurDebits={false} onAdresseUpdated={rien}
      />
    </Dossier1>
  ) },
  { nom: 'FichePiece', fichier: 'pages/dossier/FichePiece.tsx', rendre: () => (
    <Dossier1>
      <FichePiece
        dossierId="d1" categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
        piece={piece()} commentaires={[]} onClose={rien} onSaved={rien} onCommentaireAjoute={rien} onCommentaireSupprime={rien}
        horsDeFrance={FICHES_RECUES}
      />
    </Dossier1>
  ) },
  { nom: 'FicheHorsDeFrance', fichier: 'pages/dossier/FicheHorsDeFrance.tsx', rendre: () => (
    <Dossier1><FicheHorsDeFrance dossierId="d1" piece={piece()} pieceModifiee={false} donnees={FICHES_RECUES} sansTexteLu={false} /></Dossier1>
  ) },
  { nom: 'FinancementTab', fichier: 'pages/dossier/FinancementTab.tsx', rendre: () => <Dossier1><FinancementTab dossierId="d1" assujettiTva={false} modeComptable="tresorerie" /></Dossier1> },
  { nom: 'ImmobilisationsTab', fichier: 'pages/dossier/ImmobilisationsTab.tsx', rendre: () => <Dossier1><ImmobilisationsTab dossierId="d1" assujettiTva={false} /></Dossier1> },
  { nom: 'InformationsTab', fichier: 'pages/dossier/InformationsTab.tsx', rendre: () => (
    <Dossier1><InformationsTab dossierId="d1" dossierNom="Dossier fictif" dossierSiret={null} dossierAdresse={null} modele={TRESORERIE} onIdentiteUpdated={rien} /></Dossier1>
  ) },
  { nom: 'PacksTab', fichier: 'pages/dossier/PacksTab.tsx', rendre: () => <Dossier1><PacksTab dossierId="d1" dossierNom="Dossier fictif" /></Dossier1> },
  { nom: 'PiecesTab', fichier: 'pages/dossier/PiecesTab.tsx', rendre: () => <Dossier1><PiecesTab dossierId="d1" /></Dossier1> },
  { nom: 'PlateformeClientModal', fichier: 'pages/dossier/PlateformeClientModal.tsx', rendre: () => (
    <Dossier1><PlateformeClientModal dossierId="d1" dossierSiret="12345678901234" onClose={rien} onImported={rien} /></Dossier1>
  ) },
  { nom: 'RevisionTab', fichier: 'pages/dossier/RevisionTab.tsx', rendre: () => (
    <Dossier1>
      <RevisionTab dossierId="d1" modele={TRESORERIE} assujettiTva={false} periodiciteTva="trimestrielle" statutTva={null} onNavigate={rien} />
    </Dossier1>
  ) },
  { nom: 'StatistiquesTab (trésorerie)', fichier: 'pages/dossier/StatistiquesTab.tsx', rendre: () => (
    <Dossier1><StatistiquesTab dossierId="d1" onNavigate={rien} modeComptable="tresorerie" /></Dossier1>
  ) },
  { nom: 'StatistiquesTab (engagement)', fichier: 'pages/dossier/StatistiquesTab.tsx', rendre: () => (
    <Dossier1><StatistiquesTab dossierId="d1" onNavigate={rien} modeComptable="engagement" /></Dossier1>
  ) },
  { nom: 'SuperPdpModal', fichier: 'pages/dossier/SuperPdpModal.tsx', rendre: () => <Dossier1><SuperPdpModal dossierId="d1" onClose={rien} onImported={rien} /></Dossier1> },
  { nom: 'SupplementsTab', fichier: 'pages/dossier/SupplementsTab.tsx', rendre: () => <Dossier1><SupplementsTab dossierId="d1" /></Dossier1> },
  { nom: 'TransmissionFactureModal', fichier: 'pages/dossier/TransmissionFactureModal.tsx', rendre: () => (
    <Dossier1><TransmissionFactureModal dossierId="d1" facture={facture()} statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false} onClose={rien} onUpdated={rien} /></Dossier1>
  ) },
  { nom: 'TvaTab', fichier: 'pages/dossier/TvaTab.tsx', rendre: () => (
    <Dossier1>
      <TvaTab
        dossierId="d1" assujettiTva statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false} siret={null}
        onStatutUpdated={rien} periodicite="trimestrielle" surDebits={false} onRegimeUpdated={rien}
      />
    </Dossier1>
  ) },
  { nom: 'VehiculesCard', fichier: 'pages/dossier/VehiculesCard.tsx', rendre: () => <Dossier1><VehiculesCard dossierId="d1" modele={TRESORERIE} /></Dossier1> },
  { nom: 'VirementsTab', fichier: 'pages/dossier/VirementsTab.tsx', rendre: () => <Dossier1><VirementsTab dossierId="d1" modele={TRESORERIE} /></Dossier1> },
  { nom: 'VoletSocialCard', fichier: 'pages/dossier/VoletSocialCard.tsx', rendre: () => (
    <Dossier1><VoletSocialCard dossierId="d1" annee={2025} valeurs={new Map()} blocage={null} /></Dossier1>
  ) },
]

// Les fichiers qui parlent à la base sans RIEN lire au montage : ils lisent ou écrivent sur un geste, ou reçoivent leurs
// données de l'écran qui les ouvre (et qui, lui, est monté ici). Chacun avec sa raison.
const SANS_LECTURE_AU_MONTAGE: Record<string, string> = {
  'components/BarreDossiers.tsx': 'reçoit la liste des dossiers de la coque (Layout, montée ici) et son état de chargement',
  'pages/dossier/StatutTvaCard.tsx': 'reçoit le statut de TVA du dossier ; n’écrit que sur « Enregistrer »',
  'pages/dossier/ValidationExerciceCard.tsx': 'reçoit les préalables de la Clôture (montée ici) ; ne valide que sur un clic',
  'pages/Login.tsx': 'se connecte, ou demande un lien « Mot de passe oublié », à la soumission du formulaire ; ne lit rien avant',
  'pages/NouveauMotDePasse.tsx': 'ne lit rien ; change le mot de passe à la soumission du formulaire',
  'pages/RestaurationCard.tsx': 'lit le fichier choisi et écrit sur un clic',
  'pages/dossier/SauvegardeCard.tsx': 'lit le dossier entier sur le clic « Télécharger la sauvegarde »',
  'pages/dossier/AjouterDocumentsModal.tsx': 'lit et dépose sur un dépôt de fichiers',
  'pages/dossier/ImportDossierModal.tsx': 'lit et dépose sur le choix d’un dossier de fichiers',
  'pages/dossier/CategoriserTiersModal.tsx': 'reçoit pièces, catégories et règles de PiecesTab ; écrit sur un clic',
  'pages/dossier/FicheMouvement.tsx': 'reçoit le relevé de BanqueTab ; n’ouvre un justificatif que sur un clic',
  'components/EnvoyerEmailModal.tsx': 'n’appelle la fonction d’envoi que sur un clic',
  'components/FilCommentaires.tsx': 'reçoit le fil de l’écran qui l’ouvre ; n’écrit qu’à l’envoi',
  'pages/dossier/BilanReleveStatuts.tsx': 'reçoit le relevé des statuts que l’écran qui l’offre a lancé sur un clic (FacturesTab, EncaissementsFactureModal, PlateformeClientModal, montés ici)',
  'context/AuthContext.tsx': 'pas un écran : tant qu’il lit la session, App ne montre que « Chargement… »',
}

// LES PHRASES FIXES qui contiennent un mot du vide sans rien affirmer d'une liste : une explication, une consigne. Chacune
// avec son écran, sa raison et son nombre d'occurrences — un nombre qui change dit que l'écran a changé.
const PHRASES_FIXES: { ecran: string; texte: string; fois: number; raison: string }[] = [
  { ecran: 'ClientHome', texte: 'Trois étapes, rien à trier de ton côté.', fois: 1, raison: 'le mode d’emploi de l’accueil' },
  {
    ecran: 'EncaissementsFactureModal', fois: 1, raison: 'ce que la fenêtre fait, pas ce qu’elle a lu',
    texte: 'TTC. Un encaissement s’enregistre ici, au registre du dossier ; rien ne part vers une plateforme ni vers l’administration.',
  },
  {
    ecran: 'PlateformeClientModal', fois: 1, raison: 'la règle de l’import, pas un résultat',
    texte: 'Les factures que le client reçoit et émet par sa plateforme agréée arrivent ici, chacune en pièce « à valider » : rien n’est validé ni catégorisé sans vous.',
  },
  {
    ecran: 'SuperPdpModal', fois: 1, raison: 'la règle de l’import, pas un résultat',
    texte: "Récupère automatiquement les factures de ce dossier via Super PDP (plateforme agréée DGFiP) : reçues (achats) comme émises (ventes). Chaque facture importée arrive en Pièces avec le statut « à valider », comme un import classique — rien n'est jamais validé automatiquement.",
  },
  {
    ecran: 'TvaTab', fois: 1, raison: 'ce que le statut de TVA (une propriété du dossier, reçue) implique',
    texte: 'Ses factures portent la TVA : aucune mention d’exonération n’y est proposée.',
  },
  {
    ecran: 'StatistiquesTab (engagement)', fois: 1, raison: 'le mode d’emploi des comptes de tiers',
    texte: 'Le lettrage se déduit du rapprochement bancaire : la facture et ses règlements portent le même code dans le FEC (EcritureLet). Ce qui se solde entre pièces sans mouvement — une facture et son avoir — se lettre à la main : coche les pièces d’un même tiers qui se soldent ensemble, puis « Lettrer ensemble ». Aucune écriture n’est modifiée, et un lettrage fait à la main se défait. La vue lit tout le brouillon d’écritures, exercices précédents et à-nouveaux compris : une pièce dont l’écriture n’est pas encore générée n’y est pas. La balance d’un exercice, au-dessus, compte ses propres écritures et son ouverture — la balance reprise, ou les soldes reportés de l’exercice précédent, écrits à sa validation — : tant que l’exercice précédent n’est pas validé, un compte de tiers peut donc y porter un autre solde. Un montant se lit du côté du compte : ce qui reste à payer à un fournisseur, à encaisser d’un client, ce qui est dû au dirigeant ; un montant négatif dit l’inverse, un avoir à recevoir ou un trop-payé à rendre.',
  },
]

// Ce qui affirme le vide ou un compte : « aucun », « rien », ou un zéro isolé (« 0 », « 0 pièce », « 0,00 € »).
const AFFIRMATION = /\b(aucun|aucune|rien)\b|(^|[^\d,.])0(\s|$|,00)/i

// Le texte rendu, un morceau par nœud de texte, hors des choix d'une liste déroulante (« — Aucun — » est un choix, pas
// une affirmation).
function morceaux(): string[] {
  const resultat: string[] = []
  const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    if (n.parentElement?.closest('option')) continue
    const texte = (n.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (texte) resultat.push(texte)
  }
  return resultat
}

// Ce qui dit qu'on attend encore : le texte « Chargement… » ou une zone `aria-busy`.
function attendEncore(): boolean {
  return morceaux().includes('Chargement…') || document.querySelector('[aria-busy="true"]') !== null
}

async function laisserPasser(tours = 6) {
  for (let i = 0; i < tours; i++) {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
  }
}

async function monter(ecran: Ecran) {
  // Les écrans journalisent leurs refus ; ce garde les provoque, il n'a pas à les lire.
  const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<>{ecran.rendre()}</>)
  await laisserPasser()
  journal.mockRestore()
}

// Les modules de `src/lib` qui parlent à la base, directement ou par un autre module de `src/lib`.
function modulesQuiLisent(racine: string): Set<string> {
  const dossierLib = join(racine, 'lib')
  const imports = new Map<string, string[]>()
  for (const fichier of readdirSync(dossierLib)) {
    if (!/\.tsx?$/.test(fichier) || /\.test\.tsx?$/.test(fichier)) continue
    const texte = readFileSync(join(dossierLib, fichier), 'utf8')
    imports.set(fichier.replace(/\.tsx?$/, ''), [...texte.matchAll(/from '\.\/([A-Za-z0-9]+)'/g)].map((m) => m[1]))
  }
  const lisent = new Set(['supabase'])
  for (let change = true; change;) {
    change = false
    for (const [module, cibles] of imports) {
      if (!lisent.has(module) && cibles.some((c) => lisent.has(c))) { lisent.add(module); change = true }
    }
  }
  return lisent
}

// Les fichiers d'écran et de composant qui importent l'un de ces modules.
function fichiersQuiLisent(racine: string): string[] {
  const lisent = modulesQuiLisent(racine)
  const resultat: string[] = []
  for (const dossierEcrans of ['pages', 'pages/dossier', 'components', 'components/widgets', 'context']) {
    for (const fichier of readdirSync(join(racine, dossierEcrans))) {
      if (!fichier.endsWith('.tsx') || fichier.endsWith('.test.tsx')) continue
      const chemin = join(racine, dossierEcrans, fichier)
      const texte = readFileSync(chemin, 'utf8')
      const modules = [...texte.matchAll(/from '(?:\.\.\/)+lib\/([A-Za-z0-9]+)'/g)].map((m) => m[1])
      if (modules.some((m) => lisent.has(m))) resultat.push(relative(racine, chemin))
    }
  }
  return resultat.sort()
}

const SRC = join(process.cwd(), 'src')

beforeAll(() => {
  // Une date fixe : l'accueil du client et la Checklist comptent les mois écoulés.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
})
afterEach(() => { cleanup() })
afterAll(() => { vi.useRealTimers() })

describe('aucun écran n’affirme le vide avant d’avoir lu', () => {
  it('la liste des écrans part de tous les fichiers qui lisent la base', () => {
    const lisent = fichiersQuiLisent(SRC)
    // Plancher : un scanner qui ne trouverait rien serait aveugle, pas rassurant.
    expect(lisent.length).toBeGreaterThanOrEqual(45)
    const couverts = new Set([...ECRANS.map((e) => e.fichier), ...Object.keys(SANS_LECTURE_AU_MONTAGE)])
    expect(lisent.filter((f) => !couverts.has(f))).toEqual([])
    // Et rien d'inventé : chaque entrée des deux listes désigne un fichier qui lit vraiment.
    expect([...couverts].filter((f) => !lisent.includes(f))).toEqual([])
  })

  for (const ecran of ECRANS) {
    it(`${ecran.nom} : rien ne s’affirme avant les lectures, et l’attente se lève sur un succès comme sur un refus`, async () => {
      // 1. Toutes les lectures retenues.
      reinitialiser('retenir')
      etat.lignesUniques = { dossiers: dossier() }
      await monter(ecran)
      const avant = morceaux()
      expect(etat.demandes.size, 'un écran qui ne demande rien n’a rien prouvé').toBeGreaterThan(0)
      // Et il a rendu quelque chose : du texte, ou ses squelettes (la Checklist n'a que cela avant ses lectures).
      expect(avant.length > 0 || document.querySelector('.skeleton') !== null, 'un écran vide n’a rien prouvé').toBe(true)

      const phrases = PHRASES_FIXES.filter((p) => p.ecran === ecran.nom)
      const affirmations = avant.filter((t) => AFFIRMATION.test(t) && !phrases.some((p) => p.texte === t))
      expect(affirmations, 'affirmé avant toute lecture').toEqual([])
      for (const p of phrases) expect(avant.filter((t) => t === p.texte), p.raison).toHaveLength(p.fois)
      // Un tableau sans ligne se lit comme une liste vide, même sans un mot : avant toute lecture, il n'en paraît aucun.
      const tableauxVides = [...document.querySelectorAll('table')]
        .filter((table) => table.querySelectorAll('tbody tr').length === 0)
        .map((table) => table.getAttribute('aria-label') ?? table.querySelector('thead')?.textContent ?? '(sans titre)')
      expect(tableauxVides, 'un tableau vide avant toute lecture').toEqual([])

      // 2. Les lectures reviennent vides : l'attente se lève.
      await act(async () => { libererTout('vide') })
      await laisserPasser()
      expect(attendEncore(), 'encore en attente après des lectures revenues').toBe(false)
      cleanup()

      // 3. Les lectures sont refusées : l'attente se lève aussi — sur le refus, pas sur un « Chargement… » éternel.
      reinitialiser('refus')
      await monter(ecran)
      expect(attendEncore(), 'encore en attente après des lectures refusées').toBe(false)
    })
  }
})

// UNE LISTE PAS ENCORE REVENUE NE COMMANDE AUCUNE ÉCRITURE (CLAUDE.md, « Lectures et écritures »). La sœur de la lecture
// partielle : pendant la première lecture d'un écran, ses listes sont vides FAUTE D'AVOIR ÉTÉ LUES, et un geste qui écrit
// en s'appuyant sur elles — un dédoublonnage, une règle appliquée — écrit un doublon en base. L'import d'un relevé
// (Banque) et la création d'un échéancier (Cotisations) le faisaient.
//
// Chaque écran est monté sous le faux client, AUCUNE réponse ne revient — ni celles du montage, ni celles qu'un geste
// demande —, puis chaque geste offert est tenté, en profondeur : un fichier donné à chaque champ, chaque liste
// déroulante changée, chaque case cochée, chaque formulaire rempli et soumis, chaque bouton cliqué, et ce que chacun fait
// paraître aussitôt. Une écriture qui PART alors part sans rien avoir lu : elle doit figurer ci-dessous, avec la raison
// pour laquelle elle ne dépend d'aucune liste. Une écriture qu'un geste fait après sa PROPRE lecture (l'empreinte d'un
// fichier avant son dépôt) ne part pas ici — et c'est juste : sa lecture se fait au moment du clic.
//
// Ce que ce garde ne voit pas, et que les tests des écrans gardent : un geste qui n'est offert qu'à partir d'une ligne
// lue ou d'une réponse d'un service (la carte de connexion bancaire, l'échéancier lu sur un avis d'appel), un geste qui
// lit lui-même puis s'appuie AUSSI sur une liste du montage, et la fenêtre d'une relecture.
const ECRITURES_SANS_LISTE: { ecran: string; geste: string; ecritures: string[]; raison: string }[] = [
  { ecran: 'DossiersList', geste: 'form « Nom du client', ecritures: ['dossiers insert'], raison: 'un dossier neuf, saisi en entier ; rien ne se dédoublonne' },
  { ecran: 'SuperAdminPage', geste: 'form « Nom du cabinet', ecritures: ['fonction:create-cabinet'], raison: 'un cabinet neuf, saisi en entier' },
  { ecran: 'EquipePage', geste: 'form « Email', ecritures: ['fonction:create-team-member'], raison: 'la fonction reprend un compte existant' },
  {
    ecran: 'AccesTab', geste: 'form « Email du client', ecritures: ['fonction:create-client-access'],
    raison: 'la fonction reprend un compte existant, et la base refuse un second accès (unique (user_id, dossier_id))',
  },
  {
    ecran: 'CotisationsTab', geste: 'form « Échéance', ecritures: ['cotisations_declarees insert'],
    raison: 'une échéance saisie à la main ne se dédoublonne pas : seul l’exercice validé la refuse, et il vient de la page du dossier',
  },
  { ecran: 'FinancementTab', geste: 'form « Nom', ecritures: ['emprunts insert'], raison: 'un emprunt neuf, saisi en entier' },
  { ecran: 'ImmobilisationsTab', geste: 'form « Ajouter une nature', ecritures: ['natures_immobilisation insert'], raison: 'une nature neuve, saisie en entier' },
  { ecran: 'PiecesTab', geste: 'button « + Sous-dossier', ecritures: ['sous_dossiers insert'], raison: 'un sous-dossier neuf, nommé à l’invite' },
  { ecran: 'SupplementsTab', geste: 'form « Type', ecritures: ['supplements insert'], raison: 'une prestation neuve, saisie en entier' },
  { ecran: 'SupplementsTab', geste: 'form « Nom de l\'associé', ecritures: ['comptes_courants_associes insert'], raison: 'un compte courant neuf, saisi en entier' },
  { ecran: 'TvaTab', geste: 'select « Trimestrielle', ecritures: ['dossiers update'], raison: 'la seule périodicité choisie, une propriété du dossier reçue de la page' },
  { ecran: 'TvaTab', geste: 'select « À l’encaissement', ecritures: ['dossiers update'], raison: 'la seule exigibilité choisie, une propriété du dossier reçue de la page' },
  {
    ecran: 'TvaTab', geste: 'button « Enregistrer', ecritures: ['dossiers update'],
    raison: 'le statut de TVA saisi dans sa carte (StatutTvaCard), une propriété du dossier reçue de la page',
  },
  { ecran: 'VehiculesCard', geste: 'button « + Ajouter un véhicule', ecritures: ['vehicules insert'], raison: 'une ligne vierge de l’exercice affiché ; un dossier a autant de véhicules qu’il veut' },
]

// Les écritures du MONTAGE, avant toute lecture : la page de retour de la banque finalise l'accord que l'adresse désigne.
const ECRITURES_AU_MONTAGE: Record<string, { ecritures: string[]; raison: string }> = {
  RetourBanque: {
    ecritures: ['fonction:banque-connexion (finaliser)'],
    raison: 'l’accord que désignent le code et l’état de l’adresse, rendus par la banque ; aucune liste n’y entre',
  },
}

// Les gestes qui LÈVENT sous jsdom, avec leur raison : ce qu'ils auraient fait après n'est pas vu.
const GESTES_QUI_LEVENT: Record<string, { geste: string; raison: string }> = {
  FichePiece: {
    geste: 'input[.pdf,.jpg,.jpeg,.png]',
    raison: 'remplacer le fichier d’une pièce lit le PDF fictif par pdf.js, que jsdom ne porte pas ; le fichier ne part qu’à « Enregistrer »',
  },
}

// Mesurés le 09/10/2026 : 126 gestes tentés sur tous les écrans, et 26 écrans qui en offrent avant leurs lectures. Un peu
// de marge : un bouton retiré ne doit pas faire tomber le garde ; une exploration qui s'arrête au premier geste, si.
const PLANCHER_GESTES = 120
const PLANCHER_ECRANS = 24

// Les actions des Edge Functions qui LISENT : l'état d'une connexion, demandé à l'ouverture d'une carte. Le faux client
// note toute fonction appelée ; celles-ci n'écrivent rien.
const LECTURES_PAR_FONCTION = new Set([
  'fonction:banque-connexion (statut)', 'fonction:plateforme-agreee (statut)', 'fonction:superpdp-credentials (status)',
])

// Les fonctions SQL qui LISENT, appelées au montage : la couverture du relevé (l'Accueil et « Mes pièces » du client) et
// les droits de l'appelant (« Ma simulation »), espace client, étape P7. Le faux client note tout `rpc` comme une écriture
// possible ; celles-ci n'écrivent rien.
const LECTURES_PAR_RPC = new Set(['rpc:couverture_du_releve', 'rpc:droits_sur_le_dossier'])

// Ce qui referme ce qu'un geste a ouvert : tenté en dernier, sinon le formulaire disparaît avant d'être soumis.
const REFERMER = /^(Annuler|Fermer.*|×|Réduire.*)$/

function nomDuGeste(el: Element): string {
  const texte = (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const accepte = el.getAttribute('accept')
  return `${el.tagName.toLowerCase()}${accepte ? `[${accepte}]` : ''} « ${texte} »`
}

function fichierPour(champ: HTMLInputElement): File {
  const accepte = (champ.getAttribute('accept') ?? '').toLowerCase()
  if (accepte.includes('csv')) {
    return new File(['Date;Libellé;Montant\n01/09/2026;PRLV FICTIF;-12,50\n02/09/2026;VIR FICTIF;100,00\n'], 'releve.csv', { type: 'text/csv' })
  }
  if (accepte.includes('json')) return new File(['{}'], 'sauvegarde.json', { type: 'application/json' })
  return new File(['%PDF-1.4 fictif'], 'document.pdf', { type: 'application/pdf' })
}

function remplirLesChamps() {
  for (const champ of document.querySelectorAll<HTMLInputElement>('input')) {
    if (champ.disabled || champ.value || ['file', 'checkbox', 'radio', 'hidden', 'color'].includes(champ.type)) continue
    const valeur = { number: '100', date: '2026-09-15', email: 'contact@exemple-fictif.fr', month: '2026-09' }[champ.type] ?? 'Valeur fictive'
    fireEvent.change(champ, { target: { value: valeur } })
  }
  for (const zone of document.querySelectorAll<HTMLTextAreaElement>('textarea')) {
    if (!zone.disabled && !zone.value) fireEvent.change(zone, { target: { value: 'Texte fictif' } })
  }
}

// Les gestes offerts, dans l'ordre où un opérateur les ferait : un fichier, un formulaire, un bouton, une case, un choix —
// et ce qui referme en dernier. Les choix après les boutons : changer d'abord la colonne d'un aperçu de relevé le rendait
// illisible, et l'import n'avait plus rien à écrire.
function gestesOfferts(): Element[] {
  const boutons = [...document.querySelectorAll('button:not([disabled])')]
  return [
    ...document.querySelectorAll('input[type="file"]:not([disabled])'),
    ...document.querySelectorAll('form'),
    ...boutons.filter((b) => !REFERMER.test((b.textContent ?? '').trim())),
    ...document.querySelectorAll('input[type="checkbox"]:not([disabled])'),
    ...document.querySelectorAll('select:not([disabled])'),
    ...boutons.filter((b) => REFERMER.test((b.textContent ?? '').trim())),
  ]
}

// En PROFONDEUR : ce que le dernier geste a fait paraître passe avant le reste — l'aperçu d'un fichier et son bouton
// d'import, avant l'onglet voisin qui le ferait disparaître.
function prochainGeste(tentes: WeakSet<Element>, avant: ReadonlySet<Element>): Element | null {
  const offerts = gestesOfferts().filter((el) => !tentes.has(el))
  return offerts.find((el) => !avant.has(el)) ?? offerts[0] ?? null
}

async function tenter(el: Element) {
  if (el instanceof HTMLInputElement && el.type === 'file') fireEvent.change(el, { target: { files: [fichierPour(el)] } })
  else if (el instanceof HTMLSelectElement) {
    const choix = [...el.options].find((o) => o.value && !o.disabled && o.value !== el.value)
    if (choix) fireEvent.change(el, { target: { value: choix.value } })
  } else if (el instanceof HTMLFormElement) fireEvent.submit(el)
  else fireEvent.click(el)
  // Ce que le geste fait paraître (un aperçu lu dans le fichier, un formulaire) paraît avant le geste suivant.
  await laisserPasser(4)
}

// Les écritures parties pendant que rien n'était lu, geste par geste : `geste → écriture, écriture`.
async function ecrituresAvantLecture(ecran: Ecran): Promise<{ montage: string[]; gestes: string[]; leves: string[]; tentes: number; vus: Set<string> }> {
  reinitialiser('retenir')
  etat.lignesUniques = { dossiers: dossier() }
  const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
  render(<>{ecran.rendre()}</>)
  await laisserPasser()
  const ecritures = (depuis: number) => etat.ecritures.slice(depuis).filter((e) => !LECTURES_PAR_FONCTION.has(e) && !LECTURES_PAR_RPC.has(e))
  const montage = ecritures(0)
  const gestes: string[] = []
  const leves: string[] = []
  const tentes = new WeakSet<Element>()
  // Tous les boutons parus, grisés compris : c'est par eux que le plancher sait jusqu'où l'exploration est allée.
  const vus = new Set<string>()
  let nombre = 0
  // Un plafond : un écran qui ferait paraître sans fin de nouveaux gestes ne bloque pas la suite, il échoue.
  // Un même geste, rendu de nouveau (une liste qui se redessine), n'est tenté que trois fois.
  const parNom = new Map<string, number>()
  let presents: ReadonlySet<Element> = new Set(gestesOfferts())
  for (let el = prochainGeste(tentes, presents); el && nombre < 200; el = prochainGeste(tentes, presents)) {
    presents = new Set(gestesOfferts())
    tentes.add(el)
    const nom = nomDuGeste(el)
    const fois = (parNom.get(nom) ?? 0) + 1
    parNom.set(nom, fois)
    if (fois > 3) continue
    nombre++
    remplirLesChamps()
    const avant = etat.ecritures.length
    try {
      await tenter(el)
    } catch (e) {
      // Un geste qui lève sous jsdom (un fichier fictif qu'une bibliothèque ne sait pas lire) : nommé, jamais sauté.
      leves.push(`${nom} → ${String(e).slice(0, 60)}`)
    }
    for (const b of document.querySelectorAll('button')) vus.add(nomDuGeste(b))
    const parties = ecritures(avant)
    if (parties.length > 0) gestes.push(`${nom} → ${parties.join(', ')}`)
  }
  journal.mockRestore()
  expect(nombre, 'un écran qui fait paraître sans fin de nouveaux gestes').toBeLessThan(200)
  return { montage, gestes, leves, tentes: nombre, vus }
}

describe('aucun geste n’écrit avant que ses listes soient lues', () => {
  beforeAll(() => {
    // Les invites répondent oui, le motif d'une règle est fourni : sans quoi le geste s'arrêterait avant d'écrire.
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
    vi.spyOn(window, 'prompt').mockImplementation(() => 'motif fictif')
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    vi.spyOn(window, 'open').mockImplementation(() => null)
    // jsdom n'a pas de presse-papiers, que « Copier » (l'adresse de dépôt d'AccesTab) atteint.
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
  })
  afterAll(() => { vi.restoreAllMocks() })

  const bilan = { tentes: 0, ecransTentes: 0, vusDeLaBanque: new Set<string>() }

  it('chaque écriture admise désigne un écran monté ici', () => {
    const noms = new Set(ECRANS.map((e) => e.nom))
    expect(ECRITURES_SANS_LISTE.filter((x) => !noms.has(x.ecran))).toEqual([])
  })

  for (const ecran of ECRANS) {
    it(`${ecran.nom} : rien ne s’écrit avant les lectures, sauf ce qui ne dépend d’aucune liste`, async () => {
      const { montage, gestes, leves, tentes, vus } = await ecrituresAvantLecture(ecran)
      bilan.tentes += tentes
      if (tentes > 0) bilan.ecransTentes++
      if (ecran.nom === 'BanqueTab') bilan.vusDeLaBanque = vus
      expect(montage, `une écriture au montage, avant toute lecture${ECRITURES_AU_MONTAGE[ecran.nom] ? ` (${ECRITURES_AU_MONTAGE[ecran.nom].raison})` : ''}`)
        .toEqual(ECRITURES_AU_MONTAGE[ecran.nom]?.ecritures ?? [])
      const leve = GESTES_QUI_LEVENT[ecran.nom]
      expect(leves.map((l) => l.split(' «')[0]), leve ? leve.raison : 'un geste qui lève n’a rien prouvé').toEqual(leve ? [leve.geste] : [])
      const admises = ECRITURES_SANS_LISTE.filter((x) => x.ecran === ecran.nom)
      // Chaque écriture partie est admise, et chaque admise est vue UNE fois : une phrase qui ne correspond plus à rien
      // dit que l'écran a changé, et un geste nouveau qui écrit sans lire se nomme ici.
      const nonAdmises = gestes.filter((g) => !admises.some((a) => g.startsWith(a.geste) && g.endsWith(`→ ${a.ecritures.join(', ')}`)))
      // En une chaîne : le message d'échec nomme alors le geste et ce qu'il a écrit, au lieu d'un « Array(1) ».
      expect(nonAdmises.join('\n'), 'une écriture partie avant toute lecture').toBe('')
      for (const a of admises) {
        expect(gestes.filter((g) => g.startsWith(a.geste)), `${a.geste} (${a.raison})`).toHaveLength(1)
      }
    })
  }

  // PLANCHER : un garde qui ne tenterait rien serait aveugle, pas rassurant. Beaucoup d'écrans n'offrent RIEN avant leurs
  // lectures (un squelette, « Chargement… ») : c'est leur protection, et le plancher se compte sur l'ensemble. Et il doit
  // atteindre le geste qui écrivait un doublon : l'aperçu d'un relevé CSV, et son bouton d'import, grisé.
  it('le garde a tenté assez de gestes, et atteint l’import d’un relevé', () => {
    expect(bilan.tentes).toBeGreaterThanOrEqual(PLANCHER_GESTES)
    expect(bilan.ecransTentes).toBeGreaterThanOrEqual(PLANCHER_ECRANS)
    expect([...bilan.vusDeLaBanque].some((n) => /^button « Importer 2 ligne\(s\)/.test(n))).toBe(true)
  })
})
