import { useRef, useState } from 'react'
import { casesDu2035 } from '../../lib/cases2035'
import { formatMoney } from '../../lib/format'
import { montantPourSaisie } from '../../lib/encaissementsAffichage'
import { messageErreur } from '../../lib/messageErreur'
import {
  CASES_SAISIES_2035, caseSaisissableEn, centimesDeLaSaisie, changementsDesSaisies, parametresDeLEnregistrement,
  refusDesSaisies, saisiesDeLExercice, valeurLue,
} from '../../lib/saisies2035'
import type { CodeSaisie2035, LectureDesSaisies2035, Saisie2035, ValeurSaisie } from '../../lib/saisies2035'
import { supabase } from '../../lib/supabase'

// LA CARTE « SAISIES DU CABINET » DE CLÔTURE (étapes 2035S3 à S5), derrière `SAISIES_2035_EXPORTEES` : les cases de la 2035
// que la comptabilité ne donne pas — CC, CL et ses douze « dont », DE, le reste de DB —, un champ par case, chacun sous la
// phrase de la notice. La lecture d'abord (lue en entier, ou rien n'est offert), le formulaire ensuite, l'écriture par
// `enregistrer_saisies_2035` seule, contre les valeurs lues, sous un verrou relâché après la relecture ; la confirmation
// nomme chaque case qui change. Un exercice validé, ou que sa validation fige, ne montre que ce qu'il porte.

const LIBELLES = new Map(casesDu2035(true).map((c) => [c.code, `${c.code} — ${c.libelle} (ligne ${c.ligne})`]))

interface Champ { montant: string; note: string }

function champsDe(lues: readonly Saisie2035[]): Record<string, Champ> {
  return Object.fromEntries(CASES_SAISIES_2035.map((c) => {
    const v = valeurLue(lues, c.code)
    return [c.code, { montant: v.centimes === 0 ? '' : montantPourSaisie(v.centimes), note: v.noteAnnexe ?? '' }]
  }))
}

const enMots = (v: ValeurSaisie) => `${formatMoney(v.centimes / 100)}${v.noteAnnexe ? ` (« ${v.noteAnnexe} »)` : ''}`

export default function SaisiesDuCabinet2035Card({ dossierId, annee, lecture, fige, onRelire }: {
  dossierId: string
  annee: number
  lecture: LectureDesSaisies2035 | null
  // L'exercice est validé, ou figé par la validation d'un exercice postérieur : la base refuserait toute écriture.
  fige: boolean
  // Relit les saisies du dossier ; la carte l'attend avant de relâcher son verrou.
  onRelire: () => Promise<void>
}) {
  const lues = saisiesDeLExercice(lecture, annee)
  const [champs, setChamps] = useState<Record<string, Champ>>(() => champsDe(lues ?? []))
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const enregistrementEnCours = useRef(false)

  if (lecture === null) return <div className="card"><p className="muted">Saisies du cabinet : chargement…</p></div>
  if (lues === null) {
    return (
      <div className="card">
        <strong>Saisies du cabinet — {annee}</strong>
        <p className="muted">{lecture.etat === 'incompletes' ? `Lecture incomplète : ${lecture.motif}.` : ''} Rien ne s’écrit tant
          qu’elles ne sont pas lues en entier, et la 2035 ne se valide ni ne s’imprime.</p>
      </div>
    )
  }

  const visibles = CASES_SAISIES_2035.filter((c) => caseSaisissableEn(c.code, annee))
  const saisies = new Map<CodeSaisie2035, ValeurSaisie>()
  let illisible: string | null = null
  for (const c of visibles) {
    const centimes = centimesDeLaSaisie(champs[c.code]?.montant ?? '')
    if (centimes === null) { illisible = illisible ?? c.code; continue }
    const note = c.noteAnnexe ? (champs[c.code]?.note ?? '').trim() : ''
    saisies.set(c.code, { centimes, noteAnnexe: note === '' ? null : note })
  }
  const changements = changementsDesSaisies(lues, saisies)
  const refus = illisible ? `Le montant de ${illisible} ne se lit pas : des euros, au centime au plus (« 1 200,50 »).`
    : refusDesSaisies(annee, fige, changements)

  async function enregistrer() {
    if (enregistrementEnCours.current || refus || changements.length === 0) return
    const phrase = changements.map((c) => `${c.code} : ${enMots(c.avant)} → ${enMots(c.apres)}`).join('\n')
    if (!window.confirm(`Enregistrer les saisies de la 2035 de l’exercice ${annee} ?\n${phrase}`)) return
    enregistrementEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('enregistrer_saisies_2035', parametresDeLEnregistrement(dossierId, annee, changements))
      if (error) setErreur(messageErreur(error, 'L’enregistrement des saisies a échoué.'))
      await onRelire()
    } finally {
      enregistrementEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card">
      <strong>Saisies du cabinet — {annee}</strong>
      <p className="muted">Les cases que la comptabilité ne donne pas : un arbitrage du cabinet, que le client ne lit pas. CC et
        CL entrent au résultat, leurs « dont » et DE et DB au revenu brut social (notice 2035-NOT-SD, renvois 17, 21, 24 à 26).</p>
      {visibles.map((c) => (
        <div key={c.code} className="field">
          <label htmlFor={`saisie-${annee}-${c.code}`}>{LIBELLES.get(c.code) ?? c.code}</label>
          <p className="muted" style={{ margin: '2px 0 4px' }}>{c.phrase} Notice, renvoi {c.renvoi}.</p>
          {fige ? <span>{enMots(valeurLue(lues, c.code))}</span> : (
            <input id={`saisie-${annee}-${c.code}`} inputMode="decimal" value={champs[c.code]?.montant ?? ''}
              onChange={(e) => setChamps({ ...champs, [c.code]: { ...champs[c.code], montant: e.target.value } })} />
          )}
          {c.noteAnnexe && !fige && (
            <textarea aria-label={`Note annexe de ${c.code}`} value={champs[c.code]?.note ?? ''} rows={2} maxLength={2000}
              onChange={(e) => setChamps({ ...champs, [c.code]: { ...champs[c.code], note: e.target.value } })} />
          )}
        </div>
      ))}
      {fige ? <p className="muted">L’exercice {annee} est figé : ses saisies ne changent plus.</p> : (
        <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void enregistrer()}
            disabled={enCours || refus !== null || changements.length === 0}>
            {enCours ? 'Enregistrement…' : 'Enregistrer les saisies'}
          </button>
          {refus && <span className="muted">{refus}</span>}
          {!refus && changements.length === 0 && <span className="muted">Rien n’a changé.</span>}
        </div>
      )}
      {erreur && <p className="error">{erreur}</p>}
    </div>
  )
}
