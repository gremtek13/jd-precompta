// La liste des dossiers de la barre latérale (voir components/BarreDossiers.tsx) — un seul endroit
// qui la lit, et un signal pour la faire relire quand elle change ailleurs.
//
// Elle ne se relit PAS à chaque navigation : changer d'écran dans un dossier ne change pas la liste
// des dossiers, et une relecture par clic ferait travailler la base pour rien. Elle se relit dans les
// seuls cas où elle a pu changer sous les yeux de l'opérateur, décidés par Layout (paramètre
// `relecture`) : le retour au tableau de bord — où aboutissent la suppression d'un dossier et ses
// autres parcours — et un dossier ouvert que la liste ne connaît pas encore. La CRÉATION reste sur le
// tableau de bord, donc n'y « revient » pas : elle prévient par `signalerMajDossiers()`, même bus
// d'événements que la charte graphique (voir lib/branding.ts, signalerMajBranding).
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'

export interface DossierDeBarre { id: string; nom: string }

export interface ListeDossiers {
  dossiers: DossierDeBarre[]
  // Ce qui a manqué quand la lecture n'est pas complète (voir lib/lectureComplete.ts), null sinon.
  // Une liste plus courte ne doit jamais se présenter comme la liste entière : un dossier qui manque
  // ici n'existe plus pour qui navigue par la barre.
  motif: string | null
  chargement: boolean
}

const EVENEMENT_MAJ = 'jd-precompta:dossiers-modifies'

export function signalerMajDossiers() {
  window.dispatchEvent(new Event(EVENEMENT_MAJ))
}

export function useListeDossiers(actif: boolean, relecture: number): ListeDossiers {
  const [etat, setEtat] = useState<ListeDossiers>({ dossiers: [], motif: null, chargement: true })
  const [signal, setSignal] = useState(0)

  useEffect(() => {
    function surSignal() { setSignal((s) => s + 1) }
    window.addEventListener(EVENEMENT_MAJ, surSignal)
    return () => window.removeEventListener(EVENEMENT_MAJ, surSignal)
  }, [])

  useEffect(() => {
    if (!actif) return
    // Une lecture plus lente écrit en DERNIER : sans ce drapeau, une relecture partie plus tôt et
    // revenue plus tard remplacerait la liste fraîche par l'ancienne — la course déjà corrigée sur
    // l'aperçu d'un pack (voir PacksTab).
    let annule = false
    lireTout<DossierDeBarre>((debut, fin) =>
      // Mêmes dossiers que le tableau de bord (non archivés), et tri TOTAL : `nom` n'est unique que
      // par hasard, sans `id` deux tranches pourraient se recouvrir ou sauter une ligne.
      supabase.from('dossiers').select('id, nom', { count: 'exact' })
        .eq('archive', false).order('nom').order('id').range(debut, fin),
    ).then((lecture) => {
      if (annule) return
      setEtat({ dossiers: lecture.lignes, motif: lecture.complete ? null : lecture.motif, chargement: false })
    })
    return () => { annule = true }
  }, [actif, relecture, signal])

  return etat
}
