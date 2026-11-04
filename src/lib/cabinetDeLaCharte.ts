import type { Role, SocieteClient } from '../context/AuthContext'

// QUEL CABINET HABILLE L'ÉCRAN (ligne 23.21, 04/11/2026). Un compte du cabinet prend la charte de son cabinet. Un client
// peut avoir des dossiers chez deux cabinets : sa charte suit la société AFFICHÉE, jamais le cabinet d'un premier dossier
// lu sans ordre — sinon l'autre société s'affichait sous la charte d'un cabinet qui ne la tient pas. Une société absente
// de la liste lue (liste en échec, société quittée) ne désigne aucun cabinet : la charte de l'application reste.

export interface QuiEstConnecte {
  role: Role
  monCabinetId: string | null
  mesSocietes: readonly SocieteClient[]
  dossierActifId: string | null
}

export function cabinetDeLaCharte({ role, monCabinetId, mesSocietes, dossierActifId }: QuiEstConnecte): string | null {
  if (role === 'cabinet') return monCabinetId
  if (role !== 'client' || dossierActifId === null) return null
  return mesSocietes.find((s) => s.id === dossierActifId)?.cabinetId ?? null
}
