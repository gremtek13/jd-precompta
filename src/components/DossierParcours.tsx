import { useEffect, useRef, useState } from 'react'
import { ICONES_PARCOURS, IconChecklist, IconDocuments, IconEcritures, IconInformations, type IconComponent } from './icons'
import { GROUPES_PARCOURS, type DossierTab, type GroupeParcours, type IdGroupeParcours } from '../lib/ongletsDossier'

export type { DossierTab } from '../lib/ongletsDossier'

// La liste des écrans vit dans lib/ongletsDossier.ts, partagée avec la barre latérale ; ce composant
// n'en garde que l'habillage — une icône par destination de premier niveau. Un `Record` sur les
// identifiants fermés : un groupe ajouté sans son icône ne compile pas.
const ICONES_GROUPES: Record<IdGroupeParcours, IconComponent> = {
  checklist: IconChecklist,
  'documents-groupe': IconDocuments,
  banque: ICONES_PARCOURS.banque,
  comptabilite: IconEcritures,
  cabinet: IconInformations,
}

// Barre d'onglets du dossier : fixée en bas de l'écran sur mobile, et en haut du dossier sur
// ordinateur quand la barre latérale est RÉDUITE — déployée, c'est elle qui montre les écrans du
// dossier ouvert, et cette barre-ci se masque (voir index.css, .nav-groupes).
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

  function estGroupeActif(groupe: GroupeParcours): boolean {
    if (groupe.cible) return groupe.cible === tab
    return groupe.enfants?.some((e) => e.id === tab) ?? false
  }

  function cliquerGroupe(groupe: GroupeParcours) {
    if (groupe.cible) {
      onChange(groupe.cible)
      setOuvert(null)
    } else {
      setOuvert((courant) => (courant === groupe.id ? null : groupe.id))
    }
  }

  return (
    <div className="nav-groupes" ref={racineRef}>
      {GROUPES_PARCOURS.map((groupe) => {
        const Icone = ICONES_GROUPES[groupe.id]
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
              <span className="nav-label-full">{groupe.label}</span>
              <span className="nav-label-court">{groupe.labelCourt}</span>
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
