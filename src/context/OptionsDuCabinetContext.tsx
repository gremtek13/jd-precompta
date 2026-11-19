import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { ModulesFournis, TOUT_OUVERT_SANS_LECTURE, useModulesOuverts, type EtatDesModules } from './ModulesOuverts'
import { droitsSur, type DroitsAcces } from '../lib/droitsAcces'
import { droitsMasques, OPTIONS_DES_CABINETS_PREVUES } from '../lib/modulesDuCabinet'
import { lireLesModulesDuCabinet, lireLesModulesDuDossier, type ModulesDuCabinetLus } from '../lib/optionsDuCabinetLecture'

// LE FOURNISSEUR DES MODULES OUVERTS (conception 56, § 2.3, lot OPT3), sur le patron d'`AuthContext` : une lecture au
// changement d'IDENTIFIANT de ce qu'elle lit — le cabinet du compte du cabinet, la société affichée du client —, jamais à
// chaque retour sur l'onglet. La réponse se garde avec sa clé : une réponse pour une autre clé ne s'affiche pas, l'état repart
// en lecture. Ce que les écrans lisent : ModulesOuverts.tsx (`useModulesOuverts`).

/** La clé de ce que la coque lit : `cabinet:<id>` ou `dossier:<id>`, ou nul quand rien n'est à lire. */
export function cleDesOptions(role: 'cabinet' | 'client' | null, cabinetId: string | null, dossierId: string | null): string | null {
  if (role === 'cabinet') return cabinetId ? `cabinet:${cabinetId}` : null
  if (role === 'client') return dossierId ? `dossier:${dossierId}` : null
  return null
}

/** Ce que l'état devient d'une lecture revenue. */
function etatDeLaLecture(lu: ModulesDuCabinetLus): EtatDesModules {
  return lu.etat === 'lus' ? { etat: 'lus', ouverts: lu.ouverts } : { etat: 'illisibles', ouverts: [], motif: lu.motif }
}

const EN_LECTURE: EtatDesModules = { etat: 'lecture', ouverts: [] }

/** `prevues` : le drapeau, en propriété pour que les tests jouent ses deux états. */
export function OptionsDuCabinetProvider({ children, prevues = OPTIONS_DES_CABINETS_PREVUES }: { children: ReactNode; prevues?: boolean }) {
  const { role, monCabinetId, dossierActifId } = useAuth()
  const cle = cleDesOptions(role, monCabinetId, dossierActifId)
  const [lu, setLu] = useState<{ cle: string; etat: EtatDesModules } | null>(null)

  useEffect(() => {
    // Le drapeau baissé : aucune lecture, jamais.
    if (!prevues || cle === null) return
    let annule = false
    const separateur = cle.indexOf(':')
    const id = cle.slice(separateur + 1)
    const lecture = cle.slice(0, separateur) === 'cabinet' ? lireLesModulesDuCabinet(id, prevues) : lireLesModulesDuDossier(id, prevues)
    void lecture.then((resultat) => {
      if (!annule) setLu({ cle, etat: etatDeLaLecture(resultat) })
    })
    return () => { annule = true }
  }, [cle, prevues])

  let valeur: EtatDesModules
  if (!prevues) valeur = TOUT_OUVERT_SANS_LECTURE
  else if (cle === null) {
    // Un compte du cabinet dont le cabinet n'est pas connu ne se juge pas : fermé. Un client sans société affichée (ou une
    // session sans rôle) n'a rien à ouvrir.
    valeur = role === 'cabinet' ? { etat: 'illisibles', ouverts: [], motif: 'le cabinet du compte n’est pas connu' } : { etat: 'lus', ouverts: [] }
  } else valeur = lu !== null && lu.cle === cle ? lu.etat : EN_LECTURE

  return <ModulesFournis etat={valeur}>{children}</ModulesFournis>
}

/** Les droits de la société AFFICHÉE du client, chaque case masquée par son module (`droitsMasques`) : ce que les routes, les
 *  entrées et les tuiles lisent. Tous les modules ouverts, ce sont les droits d'hier, champ par champ. */
export function useDroitsAffiches(): DroitsAcces {
  const { droitsParDossier, dossierActifId } = useAuth()
  const { ouverts } = useModulesOuverts()
  return droitsMasques(droitsSur(droitsParDossier ?? {}, dossierActifId), ouverts)
}
