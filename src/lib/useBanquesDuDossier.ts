import { useCallback, useEffect, useMemo, useState } from 'react'
import { banquesDuDossier, type BanquesDuDossier } from './banqueDuMouvement'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesComptesDuDossier } from './comptesBancairesLecture'
import { memeLectureDesComptes, type LectureDesComptes } from './importParCompte'
import type { PlanComptable } from './planComptable'

// Les comptes bancaires d'un dossier, pour un écran qui compose ou juge l'écriture d'un mouvement du relevé (MCB5, seconde
// partie ; lib/banqueDuMouvement.ts). Drapeau `COMPTES_BANCAIRES_PREVUS` baissé : rien ne se lit, `sans_objet` d'emblée —
// l'écran d'hier, sans attente. Levé : `en_cours` jusqu'au premier retour (aucun geste), puis la lecture gardée AVEC le
// dossier qu'elle lit — un retour pour un dossier quitté ne sert pas au suivant.
//
// LA LECTURE DES COMPTES SUIT CELLE DU RELEVÉ (relecture adverse du 27/11/2026) : lus une seule fois au montage, les comptes
// ne connaissaient pas un compte créé ailleurs ensuite, alors que le relevé relu en rendait déjà les mouvements. L'écran
// appelle `relire()` à chaque relecture de son relevé, APRÈS l'avoir lue : un compte que porte un mouvement lu existe quand
// les comptes se relisent. Entre les deux retours, l'ancienne lecture reste (l'écran ne retombe pas « en cours ») ; un
// mouvement d'un compte qu'elle ne connaît pas s'y refuse (`banqueDuMouvement`). Une relecture qui rend les mêmes comptes
// garde l'objet d'hier : un écran dont la lecture dépend des banques ne se relit pas en boucle.
export function useComptesDuDossier(dossierId: string): { lecture: LectureDesComptes; relire: () => void } {
  const [lus, setLus] = useState<{ dossierId: string; lecture: LectureDesComptes } | null>(null)
  const [relecture, setRelecture] = useState(0)
  useEffect(() => {
    if (!COMPTES_BANCAIRES_PREVUS) return
    let annule = false
    lireLesComptesDuDossier(dossierId).then((lecture) => {
      if (annule) return
      setLus((avant) => (avant !== null && avant.dossierId === dossierId && memeLectureDesComptes(avant.lecture, lecture)
        ? avant : { dossierId, lecture }))
    })
    return () => { annule = true }
  }, [dossierId, relecture])
  const lecture = useMemo<LectureDesComptes>(() => (!COMPTES_BANCAIRES_PREVUS ? { etat: 'sans_objet' }
    : lus && lus.dossierId === dossierId ? lus.lecture : { etat: 'en_cours' }), [lus, dossierId])
  const relire = useCallback(() => setRelecture((n) => n + 1), [])
  return { lecture, relire }
}

/** Les banques d'un dossier (`banquesDuDossier`) sur la lecture de ses comptes, relue par `relire()` avec le relevé. */
export function useBanquesDuDossier(dossierId: string, plan: PlanComptable): {
  banques: BanquesDuDossier; lecture: LectureDesComptes; relireLesComptes: () => void
} {
  const { lecture, relire } = useComptesDuDossier(dossierId)
  const banques = useMemo(() => banquesDuDossier(lecture, plan), [lecture, plan])
  return { banques, lecture, relireLesComptes: relire }
}
