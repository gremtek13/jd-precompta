// Liste et ordre des écrans d'un dossier — la SOURCE UNIQUE des deux navigations qui les montrent :
// la barre latérale sur ordinateur (components/BarreDossiers.tsx), et la barre d'onglets du dossier
// (components/DossierParcours.tsx), fixée en bas de l'écran sur mobile et affichée en haut du dossier
// quand la barre latérale est réduite. Deux listes recopiées divergeraient au premier écran ajouté, et
// c'est l'une des deux navigations qui perdrait l'écran sans que rien ne le signale.
//
// Sans icônes ni JSX : chaque navigation habille ces groupes à sa façon (DossierParcours porte une
// icône par destination, la barre latérale n'en met pas sur les écrans du dossier). Toute nouvelle vue
// de dossier s'ajoute ici — et à TABS_VALIDES dans DossierDetail.tsx pour être routable.

export type DossierTab =
  | 'checklist'
  | 'documents'
  | 'pieces'
  | 'factures'
  | 'banque'
  | 'ecritures'
  | 'statistiques'
  | 'immobilisations'
  | 'cotisations'
  | 'cloture'
  | 'estimation'
  | 'financement'
  | 'supplements'
  | 'packs'
  | 'informations'
  | 'virements'
  | 'acces'

export interface EnfantParcours { id: DossierTab; label: string }

// Identifiants fermés plutôt qu'une chaîne libre : DossierParcours associe une icône à chacun, et un
// groupe ajouté sans la sienne doit échouer à la compilation plutôt que s'afficher sans icône.
export type IdGroupeParcours = 'checklist' | 'documents-groupe' | 'banque' | 'comptabilite' | 'cabinet'

// Un groupe est soit une destination directe (cible renseignée, clic = navigation immédiate), soit un
// regroupement qui déroule ses enfants au clic. Remplace l'ancienne liste à plat de 13 destinations
// (8 "étapes" reliées par des traits + 5 "outils" séparés) — le doute constaté ("je me perds dans les
// onglets", voir audit ergonomie) venait moins du nombre réel de fonctions que du fait qu'elles étaient
// toutes visibles en même temps, sans hiérarchie. Ici, 5 boutons au premier niveau seulement ; les
// fonctions moins fréquentes (immobilisations, cotisations, clôture, estimation, réglages du cabinet)
// restent à un clic de plus plutôt que de saturer la barre.
//
// L'ancien visuel "étapes reliées par un trait" a été abandonné : il suggérait une progression
// séquentielle (comme un tunnel de commande) alors que ce n'en est pas une — les pièces et le
// rapprochement bancaire continuent d'arriver toute l'année, aucun onglet n'est jamais vraiment
// "terminé" avant la clôture.
export interface GroupeParcours {
  id: IdGroupeParcours
  label: string
  // Libellé court réservé à la barre de navigation mobile — en bas d'écran façon appli native
  // (navigation principale accessible au pouce), 5 colonnes étroites ne laissent la place que pour
  // un mot, jamais "Vue d'ensemble" ou "Comptabilité" en entier.
  labelCourt: string
  cible?: DossierTab
  enfants?: EnfantParcours[]
}

export const GROUPES_PARCOURS: GroupeParcours[] = [
  { id: 'checklist', label: "Vue d'ensemble", labelCourt: 'Vue', cible: 'checklist' },
  {
    id: 'documents-groupe', label: 'Documents', labelCourt: 'Docs',
    // Libellés distingués suite à un audit comparatif (confusion "Pièces" vs "Documents" relevée) :
    // Justificatifs (factures/reçus d'achat ou de vente à ventiler comptablement), Documents
    // administratifs (archive sans ventilation — relevés, attestations...), Factures émises (la
    // facturation du dossier lui-même, jamais confondue avec les pièces reçues des tiers).
    enfants: [
      { id: 'pieces', label: 'Justificatifs' },
      { id: 'documents', label: 'Documents administratifs' },
      { id: 'factures', label: 'Factures émises' },
    ],
  },
  { id: 'banque', label: 'Banque', labelCourt: 'Banque', cible: 'banque' },
  {
    id: 'comptabilite', label: 'Comptabilité', labelCourt: 'Compta',
    enfants: [
      { id: 'ecritures', label: 'Écritures' },
      { id: 'statistiques', label: 'Balance des comptes' },
      { id: 'immobilisations', label: 'Immobilisations' },
      { id: 'cotisations', label: 'Cotisations' },
      { id: 'cloture', label: 'Clôture' },
      { id: 'estimation', label: 'Estimation' },
      { id: 'financement', label: 'Financement' },
      { id: 'supplements', label: 'Suppléments' },
    ],
  },
  {
    id: 'cabinet', label: 'Cabinet', labelCourt: 'Cabinet',
    enfants: [
      { id: 'informations', label: 'Informations du dossier' },
      { id: 'acces', label: 'Accès client' },
      { id: 'virements', label: 'Virements' },
      { id: 'packs', label: 'Packs' },
    ],
  },
]
