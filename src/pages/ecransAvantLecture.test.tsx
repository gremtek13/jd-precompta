import { act, cleanup, render } from '@testing-library/react'
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
import FinancementTab from './dossier/FinancementTab'
import ImmobilisationsTab from './dossier/ImmobilisationsTab'
import InformationsTab from './dossier/InformationsTab'
import PacksTab from './dossier/PacksTab'
import PiecesTab from './dossier/PiecesTab'
import PlateformeClientModal from './dossier/PlateformeClientModal'
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

vi.mock('../lib/supabase', async () => ({ supabase: (await import('../test/clientRetenu')).supabase }))
// pdf.js touche au navigateur dès l'import (`DOMMatrix`) : les deux modules qui le chargent sont doublés, comme dans les
// tests de la Banque et de la Clôture. Aucun n'est atteint au montage.
vi.mock('../lib/pdfText', () => ({
  extractPdfLignes: () => { throw new Error('la lecture d’un relevé ne doit pas être atteinte par ce garde') },
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
    created_at: '2026-09-10T09:00:00Z', updated_at: '2026-09-10T09:00:00Z', ...o,
  }
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000' }
const rien = () => {}

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
  { nom: 'ChecklistTab', fichier: 'pages/dossier/ChecklistTab.tsx', rendre: () => (
    <Dossier1><ChecklistTab dossierId="d1" assujettiTva={false} periodiciteTva="trimestrielle" statutTva={null} modele={TRESORERIE} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'ClotureTab', fichier: 'pages/dossier/ClotureTab.tsx', rendre: () => (
    <Dossier1><ClotureTab dossierId="d1" assujettiTva={false} periodiciteTva="trimestrielle" modele={TRESORERIE} onNavigate={rien} /></Dossier1>
  ) },
  { nom: 'ConnexionBancaireCard', fichier: 'pages/dossier/ConnexionBancaireCard.tsx', rendre: () => (
    <Dossier1><ConnexionBancaireCard dossierId="d1" lignes={[]} regles={[]} suspension={null} frontiere={null} onImported={rien} /></Dossier1>
  ) },
  { nom: 'CotisationsTab', fichier: 'pages/dossier/CotisationsTab.tsx', rendre: () => <Dossier1><CotisationsTab dossierId="d1" modeComptable="tresorerie" /></Dossier1> },
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
      />
    </Dossier1>
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
  'pages/Login.tsx': 'se connecte à la soumission du formulaire, ne lit rien avant',
  'pages/RestaurationCard.tsx': 'lit le fichier choisi et écrit sur un clic',
  'pages/dossier/SauvegardeCard.tsx': 'lit le dossier entier sur le clic « Télécharger la sauvegarde »',
  'pages/dossier/AjouterDocumentsModal.tsx': 'lit et dépose sur un dépôt de fichiers',
  'pages/dossier/ImportDossierModal.tsx': 'lit et dépose sur le choix d’un dossier de fichiers',
  'pages/dossier/CategoriserTiersModal.tsx': 'reçoit pièces, catégories et règles de PiecesTab ; écrit sur un clic',
  'pages/dossier/FicheMouvement.tsx': 'reçoit le relevé de BanqueTab ; n’ouvre un justificatif que sur un clic',
  'components/EnvoyerEmailModal.tsx': 'n’appelle la fonction d’envoi que sur un clic',
  'components/FilCommentaires.tsx': 'reçoit le fil de l’écran qui l’ouvre ; n’écrit qu’à l’envoi',
  'context/AuthContext.tsx': 'pas un écran : tant qu’il lit la session, App ne montre que « Chargement… »',
}

// LES PHRASES FIXES qui contiennent un mot du vide sans rien affirmer d'une liste : une explication, une consigne. Chacune
// avec son écran, sa raison et son nombre d'occurrences — un nombre qui change dit que l'écran a changé.
const PHRASES_FIXES: { ecran: string; texte: string; fois: number; raison: string }[] = [
  { ecran: 'ClientHome', texte: 'Trois étapes, rien à trier de ton côté.', fois: 1, raison: 'le mode d’emploi de l’accueil' },
  {
    ecran: 'AccesTab', fois: 1, raison: 'ce que l’accès permet, pas qui l’a',
    texte: 'Le client pourra uniquement déposer des pièces sur ce dossier — aucun accès aux montants, catégories ou packs.',
  },
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
