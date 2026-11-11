import { useEffect, useMemo, useState } from 'react'
import { banquesDuDossier, type BanquesDuDossier } from './banqueDuMouvement'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesComptesDuDossier } from './comptesBancairesLecture'
import type { LectureDesComptes } from './importParCompte'
import type { PlanComptable } from './planComptable'

// Les banques d'un dossier, pour un écran qui compose ou juge l'écriture d'un mouvement du relevé hors de l'onglet Banque
// (MCB5, seconde partie ; lib/banqueDuMouvement.ts). Drapeau `COMPTES_BANCAIRES_PREVUS` baissé : rien ne se lit, la banque
// du rôle d'emblée — l'écran d'hier, sans attente. Levé : `en_cours` jusqu'au retour (aucun geste), puis la lecture gardée
// AVEC le dossier qu'elle lit — un retour pour un dossier quitté ne sert pas au suivant.
export function useBanquesDuDossier(dossierId: string, plan: PlanComptable): { banques: BanquesDuDossier; lecture: LectureDesComptes } {
  const [lus, setLus] = useState<{ dossierId: string; lecture: LectureDesComptes } | null>(null)
  useEffect(() => {
    if (!COMPTES_BANCAIRES_PREVUS) return
    let annule = false
    lireLesComptesDuDossier(dossierId).then((lecture) => { if (!annule) setLus({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])
  const lecture = useMemo<LectureDesComptes>(() => (!COMPTES_BANCAIRES_PREVUS ? { etat: 'sans_objet' }
    : lus && lus.dossierId === dossierId ? lus.lecture : { etat: 'en_cours' }), [lus, dossierId])
  const banques = useMemo(() => banquesDuDossier(lecture, plan), [lecture, plan])
  return { banques, lecture }
}
