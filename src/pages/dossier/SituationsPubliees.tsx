import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import type { SituationIntermediaire } from '../../lib/situationIntermediaire'
import {
  composerLaSituation, confirmationDeLaPublication, contenuLu, confirmationDuRetrait, memeDateAnneePrecedente, montantDit,
  REFUS_DE_L_ECRAN, REFUS_SITUATION, situationEnCoursA, situationsEnCoursTriees, STATUT_DIT,
  type CompositionDeLaSituation, type ContenuDeLaSituation, type SituationPubliee,
} from '../../lib/situationsPubliees'
import { lireLesSituationsDuCabinet, type LectureDuCabinet } from '../../lib/situationsPublieesLecture'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ConfirmationArticle from './ConfirmationArticle'

// PUBLIER UNE SITUATION AU CLIENT (espace client, ligne 51.5, étape C4b ; derrière `SITUATIONS_PUBLIEES_EXPORTEES`). Sous la
// situation intermédiaire de l'onglet Financement, qui la calcule déjà : la même date, les mêmes moteurs. Le module compose
// le contenu (lib/situationsPubliees.ts, `composerLaSituation`), et `publier_situation` le fige ; `retirer_situation` le
// retire ; « Remplacer » est une nouvelle publication à la même date, qui cite celle en cours.
//
// RIEN NE PART SUR UNE LECTURE ABSENTE OU PARTIELLE : les situations du dossier et ses exercices validés (le statut s'en lit)
// sont lus en entier, sinon aucun geste. Les refus se disent avant le clic, sur le contenu TEL QU'IL PARTIRA ; la
// confirmation nomme la date, le statut et les totaux ; un seul verrou `useRef` pour les trois gestes, relâché après la
// relecture.

type Confirmer =
  | { genre: 'publier'; contenu: ContenuDeLaSituation; remplace: SituationPubliee | null }
  | { genre: 'retirer'; situation: SituationPubliee }

const DATE = /^\d{4}-\d{2}-\d{2}$/

// Le résultat d'une situation publiée, ou « illisible » : jamais un chiffre deviné.
const montantOuIllisible = (c: ContenuDeLaSituation | null) => (c === null ? 'illisible' : montantDit(c.resultat))

export default function SituationsPubliees({ dossierId, arreteeAu, assujettiTva, calculer }: {
  dossierId: string
  arreteeAu: string
  assujettiTva: boolean
  /** La situation intermédiaire d'une période : le même calcul que celui affiché au-dessus. */
  calculer: (debut: string, fin: string) => SituationIntermediaire
}) {
  const [lecture, setLecture] = useState<LectureDuCabinet | null>(null)
  const [avecNMoins1, setAvecNMoins1] = useState(true)
  const [confirmer, setConfirmer] = useState<Confirmer | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const gesteEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  const derniereLecture = useRef(0)

  // Une lecture plus lente écrit en dernier : seule la plus récente compte (le numéro de la dernière partie).
  async function relire() {
    const numero = ++derniereLecture.current
    const l = await lireLesSituationsDuCabinet(dossierId)
    if (numero === derniereLecture.current) setLecture(l)
  }

  useEffect(() => {
    let annule = false
    const numero = ++derniereLecture.current
    lireLesSituationsDuCabinet(dossierId).then((l) => {
      if (!annule && numero === derniereLecture.current) setLecture(l)
    })
    return () => { annule = true }
  }, [dossierId])

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const entiere = lue !== null && lue.situations.complete && lue.anneesValidees.complete
  const enCours = entiere ? situationsEnCoursTriees(lue.situations.lignes) : []
  const remplace = entiere ? situationEnCoursA(lue.situations.lignes, arreteeAu) : null

  // La composition, sur la date affichée : elle dit son refus, ou le contenu tel qu'il partira.
  let composition: CompositionDeLaSituation | null = null
  if (entiere && !assujettiTva) {
    if (!DATE.test(arreteeAu)) {
      composition = { ok: false, refus: REFUS_SITUATION.dateAbsente }
    } else {
      const annee = Number(arreteeAu.slice(0, 4))
      const finN1 = memeDateAnneePrecedente(arreteeAu)
      composition = composerLaSituation({
        arreteeAu,
        aujourdHui: aujourdHuiAParis(),
        anneesValidees: lue.anneesValidees.lignes,
        situation: calculer(`${annee}-01-01`, arreteeAu),
        tva: { assujetti: false },
        nMoins1: avecNMoins1 ? { situation: calculer(`${annee - 1}-01-01`, finN1), tva: { assujetti: false } } : null,
      })
    }
  }
  const refus = lue === null ? null
    : !entiere ? REFUS_DE_L_ECRAN.lecture
      : assujettiTva ? REFUS_DE_L_ECRAN.tvaAssujetti
        : composition !== null && !composition.ok ? composition.refus : null

  async function publier(contenu: ContenuDeLaSituation, aRemplacer: SituationPubliee | null) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('publier_situation', {
        p_dossier_id: dossierId, p_arretee_au: contenu.periode.fin, p_contenu: contenu, p_remplace_id: aRemplacer?.id ?? null,
      })
      setMessage(error
        ? { genre: 'erreur', texte: `La situation n’a pas été publiée : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: `La situation arrêtée au ${formatDate(contenu.periode.fin)} est publiée au client.` })
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  async function retirer(situation: SituationPubliee) {
    if (gesteEnCours.current) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_situation', { p_situation_id: situation.id })
      setMessage(error
        ? { genre: 'erreur', texte: `La situation n’a pas été retirée : ${messageErreur(error, 'refus de la base.')}` }
        : { genre: 'ok', texte: `La situation arrêtée au ${formatDate(situation.arretee_au)} est retirée.` })
    } finally {
      await relire()
      setConfirmer(null)
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  const fenetre = confirmer === null ? null
    : confirmer.genre === 'publier' ? confirmationDeLaPublication(confirmer.contenu, confirmer.remplace !== null)
      : confirmationDuRetrait(confirmer.situation)

  return (
    <section style={{ marginTop: 16 }} aria-labelledby="situations-publiees-titre">
      <h3 id="situations-publiees-titre" style={{ marginBottom: 4 }}>Publier au client</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Le client qui porte la case « Comptes » lit, dans « Mes comptes », la situation que tu publies : figée à la date
        choisie, « provisoire » tant que l’exercice n’est pas validé, avec la même période de l’exercice précédent si tu la
        joins.
      </p>
      {lue === null ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi="Les situations publiées" accord="lues" motif={lue.situations.motif}
            consequence="Rien ne se publie ni ne se retire : recharge la page."
          />
          <BandeauLecturePartielle
            quoi="Les exercices validés" accord="lus" motif={lue.anneesValidees.motif}
            consequence="Le statut de la situation ne se lit pas, et rien ne se publie : recharge la page."
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={avecNMoins1} disabled={occupe} onChange={(e) => setAvecNMoins1(e.target.checked)} />
            Joindre la même période de l’exercice précédent
          </label>
          {refus && <p className="error-text">{refus}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button
              type="button" className="btn btn-primary"
              disabled={occupe || refus !== null || composition === null || !composition.ok}
              title={refus ?? undefined}
              onClick={() => {
                if (composition?.ok) setConfirmer({ genre: 'publier', contenu: composition.contenu, remplace })
              }}
            >
              {remplace ? `Remplacer la situation du ${formatDate(arreteeAu)}` : 'Publier cette situation'}
            </button>
          </div>
          {message && (message.genre === 'ok'
            ? <p role="status">{message.texte}</p>
            : <p className="error-text" role="alert">{message.texte}</p>)}
          {entiere && (enCours.length === 0 ? (
            <p className="muted">Aucune situation n’est publiée au client.</p>
          ) : (
            <div className="table-scroll tableau-adaptable" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
              <table className="table-empilable">
                <thead><tr><th>Arrêtée au</th><th>Statut</th><th>Résultat</th><th></th></tr></thead>
                <tbody>
                  {enCours.map((s) => (
                    <tr key={s.id}>
                      <td data-libelle="Arrêtée au">{formatDate(s.arretee_au)}</td>
                      <td data-libelle="Statut">{s.statut ? STATUT_DIT[s.statut] : '—'}</td>
                      <td data-libelle="Résultat">{montantOuIllisible(contenuLu(s.contenu))}</td>
                      <td className="td-actions">
                        <button
                          type="button" className="btn btn-outline btn-sm" disabled={occupe}
                          onClick={() => setConfirmer({ genre: 'retirer', situation: s })}
                        >
                          Retirer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
      {confirmer && fenetre && (
        <ConfirmationArticle
          titre={fenetre.titre} boutonLabel={fenetre.bouton} occupe={occupe} refus={null} erreur={null}
          onConfirmer={() => {
            void (confirmer.genre === 'publier' ? publier(confirmer.contenu, confirmer.remplace) : retirer(confirmer.situation))
          }}
          onAnnuler={() => setConfirmer(null)}
        >
          {fenetre.paragraphes.map((p) => <p key={p}>{p}</p>)}
        </ConfirmationArticle>
      )}
    </section>
  )
}
