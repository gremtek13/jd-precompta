import { useRef, useState } from 'react'
import { formatDate } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  memesValeurs, parametresDeLEnregistrement, saisieDe, valeursLues, valeursSaisies,
  type LectureDesParametres, type SaisieDesParametres, type ValeursDesParametres,
} from '../../lib/parametresDesCotisations'
import { supabase } from '../../lib/supabase'
import type { ProfessionPamc } from '../../lib/types'

// LES PARAMÈTRES DES COTISATIONS, SOUS LE VOLET SOCIAL (ligne 27, TNS-Q1 et TNS-Q4), derrière
// `PARAMETRES_DES_COTISATIONS_EXPORTES` : le début d'activité du dossier, l'ACRE et le taux dentiste de l'exercice, que
// l'estimation des cotisations réclame quand ils lui manquent. La lecture d'abord (lue en entier, ou rien n'est offert),
// le formulaire ensuite, l'écriture par `enregistrer_parametres_des_cotisations` seule, contre les valeurs lues, sous un
// verrou relâché après la relecture ; la confirmation nomme ce qui change ; ses refus redits avant le clic.

const ACRE = { oui: 'oui', non: 'non', '': 'non dite' } as const

function enMots(v: ValeursDesParametres, annee: number): string[] {
  return [
    `Début d’activité : ${v.debut_activite === null ? 'non saisi' : formatDate(v.debut_activite)}`,
    `ACRE ${annee} : ${v.acre === null ? 'non dite' : v.acre ? 'oui' : 'non'}`,
    `Taux dentiste ${annee} : ${v.taux_dentiste === null ? 'non saisi' : String(v.taux_dentiste).replace('.', ',')}`,
  ]
}

export default function ParametresDesCotisationsCard({ dossierId, annee, lecture, profession, exerciceValide, onRelire }: {
  dossierId: string
  annee: number
  // Lue pour CE dossier, ou null tant qu'elle n'est pas revenue.
  lecture: LectureDesParametres | null
  profession: ProfessionPamc | null
  // L'exercice est validé : la base refuse d'en changer l'ACRE ou le taux dentiste ; le début d'activité se corrige encore.
  exerciceValide: boolean
  // Relit les paramètres du dossier ; la carte l'attend avant de relâcher son verrou.
  onRelire: () => Promise<void>
}) {
  const lus = lecture?.etat === 'lus' ? valeursLues(lecture, annee) : null
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState<{ cle: string; texte: string; erreur: boolean } | null>(null)
  const enregistrementEnCours = useRef(false)

  if (lecture === null) return <p className="muted" style={{ marginTop: 10 }}>Paramètres des cotisations : chargement…</p>
  if (lus === null) {
    return (
      <p className="error-text" style={{ marginTop: 10 }}>
        Les paramètres des cotisations n’ont pas été lus en entier{lecture.etat === 'incomplets' ? ` (${lecture.motif})` : ''} :
        rien ne s’écrit, et l’estimation se tait.
      </p>
    )
  }

  const cle = `${dossierId}:${annee}`
  const valeursDuDossier = lus

  async function enregistrer(saisies: ValeursDesParametres) {
    if (enregistrementEnCours.current) return
    const avant = enMots(valeursDuDossier, annee)
    const apres = enMots(saisies, annee)
    const phrase = avant.map((a, i) => (a === apres[i] ? null : `${a} → ${apres[i].split(' : ')[1]}`)).filter((l) => l !== null).join('\n')
    if (!window.confirm(`Enregistrer les paramètres des cotisations ?\n${phrase}`)) return
    enregistrementEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('enregistrer_parametres_des_cotisations', parametresDeLEnregistrement(dossierId, annee, valeursDuDossier, saisies))
      setMessage(error
        ? { cle, texte: messageErreur(error, 'L’enregistrement des paramètres des cotisations a échoué.'), erreur: true }
        : { cle, texte: 'Enregistré.', erreur: false })
      await onRelire()
    } catch (e) {
      setMessage({ cle, texte: messageErreur(e, 'L’enregistrement des paramètres des cotisations a échoué.'), erreur: true })
    } finally {
      enregistrementEnCours.current = false
      setEnCours(false)
    }
  }

  // Une relecture, ou un autre exercice : le formulaire repart de ce que la base porte (sa clé change avec les valeurs lues).
  return (
    <Formulaire key={`${cle}:${JSON.stringify(lus)}`} annee={annee} lus={lus} profession={profession} exerciceValide={exerciceValide}
      enCours={enCours} message={message !== null && message.cle === cle ? message : null}
      onChange={() => setMessage(null)} onEnregistrer={(v) => void enregistrer(v)} />
  )
}

function Formulaire({ annee, lus, profession, exerciceValide, enCours, message, onChange, onEnregistrer }: {
  annee: number
  lus: ValeursDesParametres
  profession: ProfessionPamc | null
  exerciceValide: boolean
  enCours: boolean
  message: { texte: string; erreur: boolean } | null
  onChange: () => void
  onEnregistrer: (saisies: ValeursDesParametres) => void
}) {
  const [saisie, setSaisie] = useState<SaisieDesParametres>(() => saisieDe(lus))
  const sortie = valeursSaisies(saisie)
  const inchange = sortie.valeurs !== null && memesValeurs(sortie.valeurs, lus)
  const exerciceChange = sortie.valeurs !== null && (sortie.valeurs.acre !== lus.acre || sortie.valeurs.taux_dentiste !== lus.taux_dentiste)
  const refus = sortie.refus ?? (exerciceValide && exerciceChange
    ? `L’exercice ${annee} est validé : son ACRE et son taux dentiste ne changent plus.` : null)
  const dentiste = profession === 'chirurgien_dentiste' || lus.taux_dentiste !== null
  const changer = (champ: keyof SaisieDesParametres) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaisie({ ...saisie, [champ]: e.target.value })
    onChange()
  }

  return (
    <div style={{ marginTop: 12 }}>
      <strong>Paramètres des cotisations</strong>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        L’estimation les demande : l’année où l’activité commence, le plafond se proratise et la CURPS n’est pas due ;
        l’ACRE joue l’année de la création et la suivante ; un chirurgien-dentiste a sa prise en charge sur le « taux
        dentiste » de son relevé SNIR. Le client n’en lit rien.
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`debut-activite-${annee}`}>Début d’activité</label>
          <input id={`debut-activite-${annee}`} type="date" value={saisie.debutActivite} onChange={changer('debutActivite')} />
        </div>
        <div className="field">
          <label htmlFor={`acre-${annee}`}>ACRE en {annee}</label>
          <select id={`acre-${annee}`} value={saisie.acre} disabled={exerciceValide} onChange={changer('acre')}>
            {(Object.keys(ACRE) as (keyof typeof ACRE)[]).map((v) => <option key={v} value={v}>{ACRE[v]}</option>)}
          </select>
        </div>
        {dentiste && (
          <div className="field">
            <label htmlFor={`taux-dentiste-${annee}`}>Taux dentiste {annee} (relevé SNIR)</label>
            <input id={`taux-dentiste-${annee}`} inputMode="decimal" value={saisie.tauxDentiste} disabled={exerciceValide}
              placeholder="0,35" onChange={changer('tauxDentiste')} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" disabled={enCours || refus !== null || inchange}
          onClick={() => { if (sortie.valeurs !== null && refus === null && !inchange) onEnregistrer(sortie.valeurs) }}>
          {enCours ? 'Enregistrement…' : 'Enregistrer les paramètres'}
        </button>
        {refus && <span className="error-text">{refus}</span>}
        {message && <span className={message.erreur ? 'error-text' : 'muted'}>{message.texte}</span>}
      </div>
    </div>
  )
}
