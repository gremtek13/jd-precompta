// Jeu d'icônes SVG minimal et cohérent (trait unique, currentColor) pour remplacer les emoji du
// parcours et du menu — rendu identique sur toutes les plateformes et dans les deux thèmes, contrairement
// à un emoji dont l'apparence dépend du système d'exploitation.
import type { ReactElement, ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>
export type IconComponent = (p: IconProps) => ReactElement

function base(children: ReactNode, props: IconProps) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconChecklist = (p: IconProps) => base(<>
  <circle cx="12" cy="12" r="9" />
  <path d="M8 12.5l2.5 2.5L16 9.5" />
</>, p)

export const IconDocuments = (p: IconProps) => base(<>
  <path d="M4 14V5a1 1 0 0 1 1-1h9l6 6v9a1 1 0 0 1-1 1h-4" />
  <path d="M14 4v5a1 1 0 0 0 1 1h5" />
  <path d="M9 19l3-3 3 3" />
  <path d="M12 22v-6" />
</>, p)

export const IconPieces = (p: IconProps) => base(<>
  <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  <path d="M15 3v4a1 1 0 0 0 1 1h4" />
  <path d="M8.5 13h7M8.5 16.5h5" />
</>, p)

export const IconBanque = (p: IconProps) => base(<>
  <path d="M3 10l9-6 9 6" />
  <path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9" />
  <path d="M3 21h18" />
</>, p)

export const IconEcritures = (p: IconProps) => base(<>
  <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v18H6.5A2.5 2.5 0 0 1 4 18.5z" />
  <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v18h5.5a2.5 2.5 0 0 0 2.5-2.5z" />
</>, p)

export const IconImmobilisations = (p: IconProps) => base(<>
  <path d="M12 3h6a1 1 0 0 1 1 1v6l-9.5 9.5a1.5 1.5 0 0 1-2.12 0l-4.88-4.88a1.5 1.5 0 0 1 0-2.12z" />
  <circle cx="16.5" cy="7.5" r="1.4" />
</>, p)

export const IconCotisations = (p: IconProps) => base(<>
  <circle cx="9" cy="9" r="6.5" />
  <circle cx="15" cy="15" r="6.5" />
</>, p)

export const IconCloture = (p: IconProps) => base(<>
  <path d="M6 21V4" />
  <path d="M6 4h11l-3 4 3 4H6" />
</>, p)

export const IconInformations = (p: IconProps) => base(<>
  <rect x="6" y="4" width="12" height="17" rx="1.5" />
  <path d="M9 4V3.5A1.5 1.5 0 0 1 10.5 2h3A1.5 1.5 0 0 1 15 3.5V4" />
  <path d="M9 11h6M9 15h6" />
</>, p)

export const IconEstimation = (p: IconProps) => base(<>
  <path d="M4 18l5-5 4 3 7-8" />
  <path d="M15 8h5v5" />
</>, p)

export const IconVirements = (p: IconProps) => base(<>
  <path d="M4 8h13" />
  <path d="M14 4l3 4-3 4" />
  <path d="M20 16H7" />
  <path d="M10 12l-3 4 3 4" />
</>, p)

export const IconPacks = (p: IconProps) => base(<>
  <path d="M3.5 8l8.5-4.5L20.5 8 12 12.5 3.5 8z" />
  <path d="M3.5 8v9L12 21.5l8.5-4.5V8" />
  <path d="M12 12.5V21.5" />
</>, p)

export const IconAcces = (p: IconProps) => base(<>
  <circle cx="8" cy="15" r="4" />
  <path d="M11 12l8-8" />
  <path d="M16 7l2.5 2.5" />
  <path d="M13.5 9.5L16 12" />
</>, p)

export const IconSun = (p: IconProps) => base(<>
  <circle cx="12" cy="12" r="4.5" />
  <path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
</>, p)

export const IconMoon = (p: IconProps) => base(<>
  <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
</>, p)

export const IconLogout = (p: IconProps) => base(<>
  <path d="M9 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h3" />
  <path d="M14 16l4-4-4-4" />
  <path d="M18 12H9" />
</>, p)

export const ICONES_PARCOURS: Record<string, IconComponent> = {
  checklist: IconChecklist,
  documents: IconDocuments,
  pieces: IconPieces,
  banque: IconBanque,
  ecritures: IconEcritures,
  immobilisations: IconImmobilisations,
  cotisations: IconCotisations,
  cloture: IconCloture,
  informations: IconInformations,
  estimation: IconEstimation,
  virements: IconVirements,
  packs: IconPacks,
  acces: IconAcces,
}
