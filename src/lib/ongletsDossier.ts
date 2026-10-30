// Liste et ordre des écrans d'un dossier — la SOURCE UNIQUE des deux navigations qui les montrent :
// la barre latérale sur ordinateur (components/BarreDossiers.tsx), et la barre d'onglets du dossier
// (components/DossierParcours.tsx), fixée en bas de l'écran sur mobile et affichée en haut du dossier
// quand la barre latérale est réduite. Deux listes recopiées divergeraient au premier écran ajouté, et
// c'est l'une des deux navigations qui perdrait l'écran sans que rien ne le signale.
//
// Sans icônes ni JSX : chaque navigation habille ces groupes à sa façon (DossierParcours porte une
// icône par destination, la barre latérale n'en met pas sur les écrans du dossier). Toute nouvelle vue
// de dossier s'ajoute ici — et à TABS_VALIDES dans DossierDetail.tsx pour être routable.

import { CAISSE_EXPORTEE } from './caisse'

export type DossierTab =
  | 'checklist'
  | 'documents'
  | 'pieces'
  | 'factures'
  | 'banque'
  | 'caisse'
  | 'ecritures'
  | 'statistiques'
  | 'bilan'
  | 'revision'
  | 'tva'
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
export type IdGroupeParcours = 'checklist' | 'documents-groupe' | 'banque' | 'caisse' | 'comptabilite' | 'cabinet'

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

// LA LISTE DES ÉCRANS, SELON QUE LA CAISSE EST EN BASE (ligne 26.6, étape C4 ; `CAISSE_EXPORTEE`, lib/caisse.ts). Baissé, la
// liste est celle d'hier, au caractère près : aucun onglet neuf. Levé, un onglet « Caisse » suit Banque, destination
// directe comme elle — la saisie des espèces se fait chaque semaine, comme le relevé, et ne se cache pas derrière un menu.
// Les deux états sont une fonction plutôt qu'une constante : les tests jouent chacun, et les navigations la lisent à chaque
// rendu.
export function groupesDuParcours(caisseEnBase: boolean): GroupeParcours[] {
  const groupes = GROUPES_SANS_CAISSE
  if (!caisseEnBase) return groupes
  const apresBanque = groupes.findIndex((g) => g.id === 'banque') + 1
  return [
    ...groupes.slice(0, apresBanque),
    { id: 'caisse', label: 'Caisse', labelCourt: 'Caisse', cible: 'caisse' },
    ...groupes.slice(apresBanque),
  ]
}

/** Les écrans qu'une adresse `/dossiers/:id/:tab` peut désigner, selon que la caisse est en base : tous ceux des groupes. */
export function ongletsValides(caisseEnBase: boolean): DossierTab[] {
  return groupesDuParcours(caisseEnBase).flatMap((g) => [...(g.cible ? [g.cible] : []), ...(g.enfants ?? []).map((e) => e.id)])
}

const GROUPES_SANS_CAISSE: GroupeParcours[] = [
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
      // Le bilan de l'exercice (lib/bilan.ts), juste après la balance dont il range les soldes.
      { id: 'bilan', label: 'Bilan' },
      // La révision des soldes de bilan (ligne 41) : après le bilan dont elle justifie les comptes, avant Clôture où
      // l'exercice se valide.
      { id: 'revision', label: 'Révision' },
      { id: 'tva', label: 'TVA' },
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

export const GROUPES_PARCOURS: GroupeParcours[] = groupesDuParcours(CAISSE_EXPORTEE)

// Le libellé d'un écran du dossier, tel que les deux navigations l'affichent : un bouton qui mène à un écran
// le nomme comme la barre qu'on retrouvera en y arrivant.
export function libelleDeLOnglet(tab: DossierTab): string {
  // Les deux états du drapeau : un écran se nomme de même qu'il soit offert ou non.
  for (const groupe of groupesDuParcours(true)) {
    if (groupe.cible === tab) return groupe.label
    const enfant = groupe.enfants?.find((e) => e.id === tab)
    if (enfant) return enfant.label
  }
  return tab
}
