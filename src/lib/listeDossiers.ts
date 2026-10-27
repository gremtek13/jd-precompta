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
//
// ELLE NE MONTRE QUE LES DOSSIERS QUE LE CABINET OUVRE AU COMPTE (23Q2Q2Q1-Q1, voir lib/dossiersOuverts.ts) : la base
// rend aussi ceux où il a un accès client, que l'espace du cabinet n'ouvre pas. Ce qui n'a pas pu être vérifié manque, et
// le motif le dit, comme une lecture incomplète.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { garderLesDossiersOuverts, lireLesAccesDuCompte } from './dossiersOuvertsLecture'

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

/**
 * `userId` : le compte connecté, côté cabinet ; nul, rien ne se lit (un client n'a pas de liste des dossiers). La liste se
 * garde AVEC le compte pour lequel elle a été lue : un autre compte repart en chargement, jamais sur la liste du précédent.
 */
export function useListeDossiers(userId: string | null, relecture: number): ListeDossiers {
  const [etat, setEtat] = useState<ListeDossiers & { pour: string | null }>({ dossiers: [], motif: null, chargement: true, pour: null })
  const [signal, setSignal] = useState(0)

  useEffect(() => {
    function surSignal() { setSignal((s) => s + 1) }
    window.addEventListener(EVENEMENT_MAJ, surSignal)
    return () => window.removeEventListener(EVENEMENT_MAJ, surSignal)
  }, [])

  useEffect(() => {
    if (!userId) return
    // Une lecture plus lente écrit en DERNIER : sans ce drapeau, une relecture partie plus tôt et
    // revenue plus tard remplacerait la liste fraîche par l'ancienne — la course déjà corrigée sur
    // l'aperçu d'un pack (voir PacksTab).
    let annule = false
    Promise.all([
      lireTout<DossierDeBarre>((debut, fin) =>
        // Mêmes dossiers que le tableau de bord (non archivés), et tri TOTAL : `nom` n'est unique que
        // par hasard, sans `id` deux tranches pourraient se recouvrir ou sauter une ligne.
        supabase.from('dossiers').select('id, nom', { count: 'exact' })
          .eq('archive', false).order('nom').order('id').range(debut, fin),
      ),
      lireLesAccesDuCompte(userId),
    ]).then(async ([lecture, acces]) => {
      const ouverts = await garderLesDossiersOuverts(lecture.lignes, acces)
      if (annule) return
      const motifs = [lecture.complete ? null : lecture.motif, ouverts.motif].filter((m): m is string => m !== null)
      setEtat({ dossiers: ouverts.dossiers, motif: motifs.length > 0 ? motifs.join(' ; ') : null, chargement: false, pour: userId })
    })
    return () => { annule = true }
  }, [userId, relecture, signal])

  if (etat.pour !== userId) return { dossiers: [], motif: null, chargement: true }
  return { dossiers: etat.dossiers, motif: etat.motif, chargement: etat.chargement }
}
