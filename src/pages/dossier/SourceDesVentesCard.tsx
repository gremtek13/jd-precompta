import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { aujourdHuiAParis } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  BASCULE_OFFERTE, REGLAGE_NON_ENREGISTRE, REPLI_DU_REGLAGE, carteDeLaBascule,
  type GesteDeLaBascule, type LectureDeLaBascule,
} from '../../lib/basculeDesVentes'
import { lireLaBascule } from '../../lib/basculeDesVentesLecture'
import type { Dossier } from '../../lib/types'

// LA CARTE « SOURCE DES VENTES » DE L'ONGLET INFORMATIONS (chantier EC-Q3, étape VF8b ; HISTORIQUE.md, « VF8, LA BASCULE : LA
// CONCEPTION », § 3 (b), et « LA BASCULE DES VENTES, À L'ÉCRAN »). Elle dit si les ventes du dossier se comptent par leurs
// pièces ou par ses factures, et — au chef du cabinet seul (VF8-Q1), le drapeau `BASCULE_OFFERTE` levé — offre de basculer,
// ou de revenir aux pièces là où la base le permet. Ce qu'elle dit vient du module (lib/basculeDesVentes.ts) ; ce qu'elle lit,
// de sa lecture (lib/basculeDesVentesLecture.ts), qui ne rejette jamais. Rien ne s'offre avant le retour de la lecture, ni sur
// une lecture partielle. L'écriture pose la seule colonne du réglage : la garde de la base date la bascule elle-même.

/** Le réglage tel que la base l'a rendu après l'écriture. */
export type ReglageRendu = Pick<Dossier, 'ventes_par_les_factures' | 'ventes_par_les_factures_depuis'>

interface Props {
  dossierId: string
  /** Le réglage RENDU par la base, pour le dossier écrit : la page le fusionne dans la ligne qu'elle a lue. */
  onReglageRendu: (dossierId: string, reglage: ReglageRendu) => void
}

export default function SourceDesVentesCard({ dossierId, onReglageRendu }: Props) {
  const { estChef } = useAuth()
  const [lu, setLu] = useState<LectureDeLaBascule | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Ce que la dernière écriture a dit, avec le dossier écrit : sur un autre dossier, la carte n'en dit rien.
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  // Le verrou d'exécution de la bascule, en `useRef` : `enCours` ne prend effet qu'au rendu suivant, et deux clics du même
  // rendu écriraient deux fois.
  const basculeEnCours = useRef(false)
  // Le dossier affiché : une relecture qui revient pour un autre ne remplace pas la sienne.
  const dossierAffiche = useRef(dossierId)

  useEffect(() => {
    dossierAffiche.current = dossierId
    let annule = false
    lireLaBascule(dossierId).then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [dossierId])

  // Une lecture d'un autre dossier n'est pas la sienne : « Chargement… » jusqu'à la bonne.
  const lecture = lu?.dossierId === dossierId ? lu : null
  const carte = lecture
    ? carteDeLaBascule(lecture, { chefDuCabinet: estChef, offerte: BASCULE_OFFERTE, aujourdhui: aujourdHuiAParis() })
    : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  async function changer(geste: GesteDeLaBascule) {
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du
    // premier, encore en cours.
    if (basculeEnCours.current) return
    basculeEnCours.current = true
    const dossierEcrit = dossierId
    try {
      // La confirmation NOMME les chiffres lus : les factures validées de l'exercice qui resteront comptées par leurs pièces,
      // et les pièces de vente à valider.
      if (!window.confirm(geste.confirmation)) return
      setEnCours(true)
      setAvis(null)
      // Une seule colonne, relue avec sa date : une policy qui écarte la ligne ne lève rien, et PostgREST rend un succès sur
      // zéro ligne — sans ligne rendue, rien n'est écrit et la carte ne le prétend pas.
      const { data, error } = await supabase.from('dossiers')
        .update({ ventes_par_les_factures: geste.apres }).eq('id', dossierEcrit)
        .select('ventes_par_les_factures, ventes_par_les_factures_depuis').maybeSingle()
      if (error) setAvis({ dossierId: dossierEcrit, erreur: messageErreur(error, REPLI_DU_REGLAGE), fait: null })
      else if (!data) setAvis({ dossierId: dossierEcrit, erreur: REGLAGE_NON_ENREGISTRE, fait: null })
      else {
        onReglageRendu(dossierEcrit, data)
        setAvis({
          dossierId: dossierEcrit,
          erreur: null,
          fait: geste.apres ? 'Les ventes se comptent désormais par les factures ✓' : 'Les ventes se comptent de nouveau par leurs pièces ✓',
        })
      }
      // Relue, quoi qu'il arrive : l'état, la date que la garde a posée, et les refus, tels que la base les voit maintenant.
      const relue = await lireLaBascule(dossierEcrit)
      if (dossierAffiche.current === dossierEcrit) setLu(relue)
    } catch (e) {
      setAvis({ dossierId: dossierEcrit, erreur: messageErreur(e, REPLI_DU_REGLAGE), fait: null })
    } finally {
      basculeEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Source des ventes</h3>
      {!carte ? <p className="muted">Chargement…</p> : (
        <>
          <p style={{ marginTop: 0 }}>{carte.etat}</p>
          {carte.ceQuiChange.length > 0 && (
            <>
              <p className="muted" style={{ marginBottom: 4 }}>Ce que la bascule change :</p>
              <ul className="muted" style={{ marginTop: 0, paddingLeft: 20 }}>
                {carte.ceQuiChange.map((phrase) => <li key={phrase}>{phrase}</li>)}
              </ul>
            </>
          )}
          {carte.irreversibilite && <p className="muted">{carte.irreversibilite}</p>}
          {carte.momentConseille && <p className="muted">{carte.momentConseille}</p>}
          {carte.raison && <p className="note-info">{carte.raison}</p>}
          {erreur && <p className="error-text">{erreur}</p>}
          {carte.geste && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button" className={carte.geste.apres ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}
                disabled={enCours} onClick={() => { if (carte.geste) void changer(carte.geste) }}
              >
                {enCours ? 'Enregistrement…' : carte.geste.libelle}
              </button>
            </div>
          )}
          {fait && <p className="muted" style={{ marginBottom: 0 }}>{fait}</p>}
        </>
      )}
    </div>
  )
}
