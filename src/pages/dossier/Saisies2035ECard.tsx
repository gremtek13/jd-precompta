import { useRef, useState } from 'react'
import { messageErreur } from '../../lib/messageErreur'
import {
  changementsDeLaSaisie2035E, MONTANTS_SAISIS_2035E, parametresDeLEnregistrement2035E, refusDeLaSaisie2035E,
  SAISIE_2035E_VIDE, saisie2035EDeLExercice,
} from '../../lib/saisies2035E'
import type { LectureDesSaisies2035E, Saisie2035E } from '../../lib/saisies2035E'
import { supabase } from '../../lib/supabase'

// LA CARTE « ANNEXE 2035-E — SAISIES DU CABINET » DE CLÔTURE (ligne 48), derrière `SAISIES_2035E_EXPORTEES` : ce que seul
// le cabinet sait — EN, EK, EM, ER, EU, EV en euros entiers, le cadre des mono-établissements et l'effectif. Un champ vide
// reste « à saisir », jamais zéro. La lecture d'abord (lue en entier, ou rien n'est offert), le formulaire ensuite,
// l'écriture par `enregistrer_saisies_2035e` seule, contre la saisie lue, sous un verrou relâché après la relecture ; la
// confirmation nomme chaque valeur qui change. Un exercice figé ne montre que ce qu'il porte.

const LIBELLES: Record<string, string> = {
  EN: 'EN — Plus-values de cession d’immobilisations (activité normale et courante)',
  EK: 'EK — Variation de stock (négative quand le stock monte)',
  EM: 'EM — Loyers et redevances qui se déduisent (location de six mois au plus)',
  ER: 'ER — Taxes sur le chiffre d’affaires et assimilées',
  EU: 'EU — Dotations des biens mis à disposition (location de plus de six mois, crédit-bail)',
  EV: 'EV — Moins-values de cession d’immobilisations (activité normale et courante)',
}

type Champs = Record<string, string>

function champsDe(s: Saisie2035E): Champs {
  const c: Champs = {}
  for (const m of MONTANTS_SAISIS_2035E) c[m.code] = s[m.cle] === null ? '' : String(s[m.cle])
  c.AH = s.monoEtablissement === null ? '' : s.monoEtablissement ? 'oui' : 'non'
  c.BK = s.effectif === null ? '' : String(s.effectif)
  return c
}

/** Les champs tels qu'ils partent ; `null` si un montant ne se lit pas comme un nombre entier. */
function saisieDes(champs: Champs): Saisie2035E | null {
  const entier = (t: string): number | null | undefined => {
    const v = t.replace(/[\s  ]/g, '')
    if (v === '') return null
    return /^-?\d+$/.test(v) ? Number(v) : undefined
  }
  const s: Record<string, number | boolean | null> = {}
  for (const m of MONTANTS_SAISIS_2035E) {
    const v = entier(champs[m.code] ?? '')
    if (v === undefined) return null
    s[m.cle] = v
  }
  const effectif = entier(champs.BK ?? '')
  if (effectif === undefined) return null
  return {
    ...(s as unknown as Omit<Saisie2035E, 'monoEtablissement' | 'effectif'>),
    monoEtablissement: champs.AH === 'oui' ? true : champs.AH === 'non' ? false : null,
    effectif,
  }
}

export default function Saisies2035ECard({ dossierId, annee, lecture, fige, onRelire }: {
  dossierId: string
  annee: number
  lecture: LectureDesSaisies2035E | null
  // L'exercice est validé, ou figé par la validation d'un exercice postérieur : la base refuserait toute écriture.
  fige: boolean
  // Relit les saisies du dossier ; la carte l'attend avant de relâcher son verrou.
  onRelire: () => Promise<void>
}) {
  const lue = saisie2035EDeLExercice(lecture, annee)
  const [champs, setChamps] = useState<Champs>(() => champsDe(lue ?? SAISIE_2035E_VIDE))
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const enregistrementEnCours = useRef(false)

  if (lecture === null) return <div className="card"><p className="muted">Annexe 2035-E, saisies du cabinet : chargement…</p></div>
  if (lue === null) {
    return (
      <div className="card">
        <strong>Annexe 2035-E — saisies du cabinet, {annee}</strong>
        <p className="muted">{lecture.etat === 'incompletes' ? `Lecture incomplète : ${lecture.motif}.` : ''} Rien ne s’écrit tant
          qu’elles ne sont pas lues en entier.</p>
      </div>
    )
  }

  const saisie = saisieDes(champs)
  const changements = saisie ? changementsDeLaSaisie2035E(lue, saisie) : []
  const refus = saisie === null ? 'Un montant ne se lit pas : des euros entiers, comme le formulaire les porte (« 1 200 »).'
    : refusDeLaSaisie2035E(saisie, fige, annee)

  async function enregistrer() {
    if (enregistrementEnCours.current || refus || !saisie || changements.length === 0 || lue === null) return
    if (!window.confirm(`Enregistrer les saisies de l’annexe 2035-E de l’exercice ${annee} ?\n${changements.join('\n')}`)) return
    enregistrementEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('enregistrer_saisies_2035e', parametresDeLEnregistrement2035E(dossierId, annee, lue, saisie))
      if (error) setErreur(messageErreur(error, 'L’enregistrement des saisies de l’annexe a échoué.'))
      await onRelire()
    } finally {
      enregistrementEnCours.current = false
      setEnCours(false)
    }
  }

  const changer = (code: string, valeur: string) => setChamps({ ...champs, [code]: valeur, ...(code === 'AH' && valeur !== 'oui' ? { BK: '' } : {}) })
  const dire = (code: string) => (champs[code] ?? '') === '' ? 'à saisir' : `${champs[code]} €`

  return (
    <div className="card">
      <strong>Annexe 2035-E — saisies du cabinet, {annee}</strong>
      <p className="muted">Ce que la 2035 ne porte pas et que seul le cabinet sait. Un champ vide reste « à saisir » : l’annexe
        ne le compte pas pour zéro (notice 2035-NOT-SD, p. 11-12). Une activité commencée ou cessée en cours d’année se juge
        à la main.</p>
      {MONTANTS_SAISIS_2035E.map((m) => (
        <div key={m.code} className="field">
          <label htmlFor={`annexe-${annee}-${m.code}`}>{LIBELLES[m.code]}</label>
          {fige ? <span>{dire(m.code)}</span> : (
            <input id={`annexe-${annee}-${m.code}`} inputMode="numeric" value={champs[m.code] ?? ''} placeholder="à saisir"
              onChange={(e) => changer(m.code, e.target.value)} />
          )}
        </div>
      ))}
      <div className="field">
        <label htmlFor={`annexe-${annee}-AH`}>AH — Un seul établissement au sens de la CVAE (dispense de la 1330-CVAE)</label>
        {fige ? <span>{champs.AH === '' ? 'à dire' : champs.AH}</span> : (
          <select id={`annexe-${annee}-AH`} value={champs.AH ?? ''} onChange={(e) => changer('AH', e.target.value)}>
            <option value="">à dire</option><option value="oui">oui</option><option value="non">non</option>
          </select>
        )}
      </div>
      {champs.AH === 'oui' && (
        <div className="field">
          <label htmlFor={`annexe-${annee}-BK`}>BK — Effectif au sens de la CVAE</label>
          {fige ? <span>{champs.BK === '' ? 'à saisir' : champs.BK}</span> : (
            <input id={`annexe-${annee}-BK`} inputMode="numeric" value={champs.BK ?? ''} placeholder="à saisir"
              onChange={(e) => changer('BK', e.target.value)} />
          )}
        </div>
      )}
      {fige ? <p className="muted">L’exercice {annee} est figé : ses saisies de l’annexe ne changent plus.</p> : (
        <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => void enregistrer()}
            disabled={enCours || refus !== null || changements.length === 0}>
            {enCours ? 'Enregistrement…' : 'Enregistrer les saisies de l’annexe'}
          </button>
          {refus && <span className="muted">{refus}</span>}
          {!refus && changements.length === 0 && <span className="muted">Rien n’a changé.</span>}
        </div>
      )}
      {erreur && <p className="error">{erreur}</p>}
    </div>
  )
}
