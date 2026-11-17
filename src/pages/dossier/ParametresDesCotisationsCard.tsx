import { useRef, useState } from 'react'
import { formatDate } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  CASES_DU_MEDECIN_PREVUES, EXERCICE_DE_L_EXONERATION, EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE, memesValeurs,
  parametresDeLEnregistrement, refusDeLExoneration, saisieDe, valeursLues, valeursSaisies,
  type LectureDesParametres, type SaisieDesParametres, type ValeursDesParametres,
} from '../../lib/parametresDesCotisations'
import { supabase } from '../../lib/supabase'
import type { ProfessionLiberale } from '../../lib/types'

// LES PARAMÈTRES DES COTISATIONS, SOUS LE VOLET SOCIAL (ligne 27, TNS-Q1 et TNS-Q4), derrière
// `PARAMETRES_DES_COTISATIONS_EXPORTES` : le début d'activité du dossier, l'ACRE et le taux dentiste de l'exercice, que
// l'estimation des cotisations réclame quand ils lui manquent. La lecture d'abord (lue en entier, ou rien n'est offert),
// le formulaire ensuite, l'écriture par `enregistrer_parametres_des_cotisations` seule, contre les valeurs lues, sous un
// verrou relâché après la relecture ; la confirmation nomme ce qui change ; ses refus redits avant le clic.
// L'EXONÉRATION DE 2025 EN ZONE D'INTERVENTION PRIORITAIRE (RET2-Q2), sous `EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE` (levé
// le 17/11/2026, sa migration en base) : offerte pour l'exercice 2025 d'un médecin dont le cumul est dit « oui » (ou dès qu'elle est dite),
// remise à « non dit » dans la même écriture quand le cumul cesse d'être « oui » — elle devient sans objet.

const ACRE = { oui: 'oui', non: 'non', '': 'non dite' } as const
const OUI_NON = { oui: 'oui', non: 'non', '': 'non dit' } as const

const motDuCas = (v: boolean | null | undefined) => (v == null ? 'non dit' : v ? 'oui' : 'non')

function enMots(v: ValeursDesParametres, annee: number): string[] {
  const mots = [
    `Début d’activité : ${v.debut_activite === null ? 'non saisi' : formatDate(v.debut_activite)}`,
    `ACRE ${annee} : ${v.acre === null ? 'non dite' : v.acre ? 'oui' : 'non'}`,
    `Taux dentiste ${annee} : ${v.taux_dentiste === null ? 'non saisi' : String(v.taux_dentiste).replace('.', ',')}`,
  ]
  // Les deux cases d'un médecin (RET-Q2) : nommées quand les valeurs les portent (la forme à cinq clés).
  if ('cumul_emploi_retraite' in v) {
    mots.push(`Cumul emploi-retraite ${annee} : ${motDuCas(v.cumul_emploi_retraite)}`)
    mots.push(`Dispense du complémentaire CARMF ${annee} : ${motDuCas(v.dispense_complementaire)}`)
  }
  // L'exonération de 2025 (RET2-Q2) : nommée quand les valeurs la portent (la forme à six clés).
  if ('exoneration_zone_prioritaire' in v) {
    mots.push(`Exonération de la retraite ${annee} (zone d’intervention prioritaire) : ${motDuCas(v.exoneration_zone_prioritaire)}`)
  }
  return mots
}

export default function ParametresDesCotisationsCard({ dossierId, annee, lecture, profession, exerciceValide, onRelire }: {
  dossierId: string
  annee: number
  // Lue pour CE dossier, ou null tant qu'elle n'est pas revenue.
  lecture: LectureDesParametres | null
  profession: ProfessionLiberale | null
  // L'exercice est validé : la base refuse d'en changer l'ACRE ou le taux dentiste ; le début d'activité se corrige encore.
  exerciceValide: boolean
  // Relit les paramètres du dossier ; la carte l'attend avant de relâcher son verrou.
  onRelire: () => Promise<void>
}) {
  // Les drapeaux des cases d'un médecin (RET-Q2) et de l'exonération (RET2-Q2), passés tels que la carte les lit : la lecture,
  // les valeurs lues et les saisies prennent la même forme (trois clés, cinq ou six), que la fonction exige des deux côtés.
  const lus = lecture?.etat === 'lus' ? valeursLues(lecture, annee, CASES_DU_MEDECIN_PREVUES, EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE) : null
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
  profession: ProfessionLiberale | null
  exerciceValide: boolean
  enCours: boolean
  message: { texte: string; erreur: boolean } | null
  onChange: () => void
  onEnregistrer: (saisies: ValeursDesParametres) => void
}) {
  const [saisie, setSaisie] = useState<SaisieDesParametres>(() => saisieDe(lus))
  const sortie = valeursSaisies(saisie, CASES_DU_MEDECIN_PREVUES, EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE)
  const inchange = sortie.valeurs !== null && memesValeurs(sortie.valeurs, lus)
  const exerciceChange = sortie.valeurs !== null && (sortie.valeurs.acre !== lus.acre || sortie.valeurs.taux_dentiste !== lus.taux_dentiste
    || (sortie.valeurs.cumul_emploi_retraite ?? null) !== (lus.cumul_emploi_retraite ?? null)
    || (sortie.valeurs.dispense_complementaire ?? null) !== (lus.dispense_complementaire ?? null)
    || (sortie.valeurs.exoneration_zone_prioritaire ?? null) !== (lus.exoneration_zone_prioritaire ?? null))
  // Les refus de la base redits sur la saisie telle qu'elle part : sa forme, puis l'exonération (RET2-Q2), puis le gel.
  const refus = sortie.refus ?? (sortie.valeurs === null ? null : refusDeLExoneration(sortie.valeurs, annee)) ?? (exerciceValide && exerciceChange
    ? (CASES_DU_MEDECIN_PREVUES
      ? `L’exercice ${annee} est validé : son ACRE, son taux dentiste et les cases du médecin ne changent plus.`
      : `L’exercice ${annee} est validé : son ACRE et son taux dentiste ne changent plus.`)
    : null)
  const dentiste = profession === 'chirurgien_dentiste' || lus.taux_dentiste !== null
  // Les deux cases d'un médecin (RET-Q2), sous leur drapeau : offertes à un médecin, ou dès qu'une est dite.
  const medecin = CASES_DU_MEDECIN_PREVUES && (profession === 'medecin_secteur_1' || profession === 'medecin_secteur_2'
    || (lus.cumul_emploi_retraite ?? null) !== null || (lus.dispense_complementaire ?? null) !== null)
  // L'exonération de 2025 (RET2-Q2), sous son drapeau : pour l'exercice 2025 d'un médecin en cumul, ou dès qu'elle est dite.
  const exonerationOfferte = EXONERATION_EN_ZONE_PRIORITAIRE_PREVUE && medecin && annee === EXERCICE_DE_L_EXONERATION
    && (saisie.cumul === 'oui' || (lus.exoneration_zone_prioritaire ?? null) !== null)
  const changer = (champ: keyof SaisieDesParametres) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const valeur = e.target.value as SaisieDesParametres[typeof champ]
    // Le cumul qui cesse d'être « oui » rend l'exonération sans objet : elle repart « non dite » dans la même écriture.
    setSaisie(champ === 'cumul' && valeur !== 'oui' ? { ...saisie, cumul: valeur as SaisieDesParametres['cumul'], exoneration: '' } : { ...saisie, [champ]: valeur })
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
        {medecin && (
          <>
            <div className="field">
              <label htmlFor={`cumul-${annee}`}>Cumul emploi-retraite en {annee}</label>
              <select id={`cumul-${annee}`} value={saisie.cumul} disabled={exerciceValide} onChange={changer('cumul')}>
                {(Object.keys(OUI_NON) as (keyof typeof OUI_NON)[]).map((v) => <option key={v} value={v}>{OUI_NON[v]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`dispense-${annee}`}>Dispense du complémentaire CARMF en {annee}</label>
              <select id={`dispense-${annee}`} value={saisie.dispense} disabled={exerciceValide} onChange={changer('dispense')}>
                {(Object.keys(OUI_NON) as (keyof typeof OUI_NON)[]).map((v) => <option key={v} value={v}>{OUI_NON[v]}</option>)}
              </select>
            </div>
            {exonerationOfferte && (
              <div className="field">
                <label htmlFor={`exoneration-${annee}`}>Exonération de la retraite {annee} (zone d’intervention prioritaire)</label>
                <select id={`exoneration-${annee}`} value={saisie.exoneration} disabled={exerciceValide} onChange={changer('exoneration')}>
                  {(Object.keys(OUI_NON) as (keyof typeof OUI_NON)[]).map((v) => <option key={v} value={v}>{OUI_NON[v]}</option>)}
                </select>
              </div>
            )}
          </>
        )}
      </div>
      {medecin && (
        <p className="muted" style={{ margin: '4px 0 8px' }}>
          Un médecin en cumul emploi-retraite ne cotise plus à l’invalidité-décès de la CARMF. La CARMF dispense du
          complémentaire, ses deux premières années d’affiliation, le médecin dont l’activité a commencé avant quarante
          ans : l’application ne sait pas l’âge, dites-le.
        </p>
      )}
      {exonerationOfferte && (
        <p className="muted" style={{ margin: '4px 0 8px' }}>
          La loi de financement de la sécurité sociale pour 2025 (art. 6) exonère du régime de base, du complémentaire et
          des PCV de 2025 le médecin en cumul intégral, retraité de la CARMF au plus tard le 1er janvier 2025, qui exerce en
          zone d’intervention prioritaire, quand ses revenus 2025 sont inférieurs à 70 000 € : l’application ne sait ni la
          zone, ni la date de la retraite, ni le revenu que la caisse retient, dites-le.
        </p>
      )}
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
