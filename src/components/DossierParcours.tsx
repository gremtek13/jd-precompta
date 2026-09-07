import { useEffect, useRef, useState } from 'react'
import { ICONES_PARCOURS, IconChecklist, IconDocuments, IconEcritures, IconInformations, type IconComponent } from './icons'

export type DossierTab =
  | 'checklist'
  | 'documents'
  | 'pieces'
  | 'banque'
  | 'ecritures'
  | 'immobilisations'
  | 'cotisations'
  | 'cloture'
  | 'estimation'
  | 'packs'
  | 'informations'
  | 'virements'
  | 'acces'

interface Enfant { id: DossierTab; label: string }

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
// "terminé" avant la clôture (voir l'ancien commentaire sur ETAPES, qui le disait déjà).
interface Groupe {
  id: string
  label: string
  icone: IconComponent
  cible?: DossierTab
  enfants?: Enfant[]
}

const GROUPES: Groupe[] = [
  { id: 'checklist', label: "Vue d'ensemble", icone: IconChecklist, cible: 'checklist' },
  {
    id: 'documents-groupe', label: 'Documents', icone: IconDocuments,
    enfants: [
      { id: 'pieces', label: 'Pièces' },
      { id: 'documents', label: 'Documents' },
    ],
  },
  { id: 'banque', label: 'Banque', icone: ICONES_PARCOURS.banque, cible: 'banque' },
  {
    id: 'comptabilite', label: 'Comptabilité', icone: IconEcritures,
    enfants: [
      { id: 'ecritures', label: 'Écritures' },
      { id: 'immobilisations', label: 'Immobilisations' },
      { id: 'cotisations', label: 'Cotisations' },
      { id: 'cloture', label: 'Clôture' },
      { id: 'estimation', label: 'Estimation' },
    ],
  },
  {
    id: 'cabinet', label: 'Cabinet', icone: IconInformations,
    enfants: [
      { id: 'informations', label: 'Informations du dossier' },
      { id: 'acces', label: 'Accès client' },
      { id: 'virements', label: 'Virements' },
      { id: 'packs', label: 'Packs' },
    ],
  },
]

export default function DossierParcours({ tab, onChange }: { tab: DossierTab; onChange: (t: DossierTab) => void }) {
  const [ouvert, setOuvert] = useState<string | null>(null)
  const racineRef = useRef<HTMLDivElement>(null)

  // Ferme le menu déroulant ouvert au clic ailleurs sur la page — comportement attendu d'un menu,
  // sinon il resterait ouvert indéfiniment tant qu'on ne re-clique pas sur le même bouton.
  useEffect(() => {
    function surClicExterieur(e: MouseEvent) {
      if (racineRef.current && !racineRef.current.contains(e.target as Node)) setOuvert(null)
    }
    document.addEventListener('mousedown', surClicExterieur)
    return () => document.removeEventListener('mousedown', surClicExterieur)
  }, [])

  function estGroupeActif(groupe: Groupe): boolean {
    if (groupe.cible) return groupe.cible === tab
    return groupe.enfants?.some((e) => e.id === tab) ?? false
  }

  function cliquerGroupe(groupe: Groupe) {
    if (groupe.cible) {
      onChange(groupe.cible)
      setOuvert(null)
    } else {
      setOuvert((courant) => (courant === groupe.id ? null : groupe.id))
    }
  }

  return (
    <div className="nav-groupes" ref={racineRef}>
      {GROUPES.map((groupe) => {
        const Icone = groupe.icone
        const actif = estGroupeActif(groupe)
        return (
          <div className="nav-groupe" key={groupe.id}>
            <button
              type="button"
              className={`nav-groupe-bouton ${actif ? 'active' : ''}`}
              onClick={() => cliquerGroupe(groupe)}
              aria-expanded={groupe.enfants ? ouvert === groupe.id : undefined}
            >
              <Icone width={17} height={17} />
              {groupe.label}
              {groupe.enfants && <span className="nav-chevron">{ouvert === groupe.id ? '▲' : '▼'}</span>}
            </button>
            {groupe.enfants && ouvert === groupe.id && (
              <div className="nav-menu">
                {groupe.enfants.map((enfant) => {
                  const IconeEnfant = ICONES_PARCOURS[enfant.id]
                  return (
                    <button
                      key={enfant.id}
                      type="button"
                      className={`nav-menu-item ${enfant.id === tab ? 'active' : ''}`}
                      onClick={() => { onChange(enfant.id); setOuvert(null) }}
                    >
                      <IconeEnfant width={16} height={16} />
                      {enfant.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
