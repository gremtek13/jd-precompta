import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { libelleDeLOnglet, type DossierTab } from '../../lib/ongletsDossier'
import { LIBELLES_JOURNAUX } from '../../lib/fec'
import type { EtatDeValidation } from '../../lib/prealablesValidation'
import type { DemandeDeValidation } from '../../lib/validationExercice'
import type { ExerciceValide, JournalCode } from '../../lib/types'

// VALIDER UN EXERCICE (ligne 26.6 de la feuille de route, étape d). La base porte la procédure — refus,
// intangibilité, sources figées, empreinte chaînée — ; cette carte dit avant le clic ce qui l'empêcherait
// (lib/prealablesValidation.ts), envoie à `valider_exercice` la numérotation même du FEC et la 2035 telle
// qu'elle est (lib/validationExercice.ts), puis montre l'exercice validé et vérifie son empreinte.
//
// Une validation NE SE DÉFAIT PAS : la confirmation nomme ce qu'on perd, le geste est réservé au chef du
// cabinet (décision du 04/10/2026, la base le refuse aux autres), et son verrou est un `useRef` posé avant le
// `try` et relâché dans le `finally`, APRÈS la relecture de l'écran — relâché avant, la carte proposerait
// encore de valider un exercice qui vient de l'être. Une validation acceptée se dit par l'exercice relu validé :
// la relecture de Clôture remplace la carte le temps de relire, un message posé avant ne s'afficherait jamais.

export default function ValidationExerciceCard({
  dossierId, annee, valide, etat, demande, estChef, onValide, onNavigate, onChoisirExercice,
}: {
  dossierId: string
  annee: number
  // L'exercice tel que la base le garde, quand il est validé.
  valide: ExerciceValide | null
  // Les préalables, quand il ne l'est pas — nuls pendant le chargement.
  etat: EtatDeValidation | null
  // Ce que `valider_exercice` recevra : nul tant qu'un préalable bloque.
  demande: DemandeDeValidation | null
  estChef: boolean
  // Relit l'écran après la validation.
  onValide: () => Promise<void>
  onNavigate?: (tab: DossierTab) => void
  // Mène à l'exercice qu'un préalable d'ordre réclame d'abord (`PrealableDeValidation.exercice`).
  onChoisirExercice?: (annee: number) => void
}) {
  const validationEnCours = useRef(false)
  const verificationEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [verification, setVerification] = useState<'intacte' | 'alteree' | null>(null)

  async function valider() {
    if (validationEnCours.current || !demande || !etat?.validable || !estChef) return
    validationEnCours.current = true
    setErreur(null)
    try {
      if (!window.confirm(confirmation(annee, demande))) return
      setEnCours(true)
      const { error } = await supabase.rpc('valider_exercice', {
        p_dossier_id: dossierId,
        p_annee: annee,
        p_lignes: demande.p_lignes,
        p_a_nouveaux: demande.p_a_nouveaux,
        p_declaration: demande.p_declaration,
      })
      if (error) {
        setErreur(messageErreur(error, `L'exercice ${annee} n'a pas pu être validé.`))
        return
      }
      await onValide()
    } finally {
      validationEnCours.current = false
      setEnCours(false)
    }
  }

  async function verifier() {
    if (verificationEnCours.current) return
    verificationEnCours.current = true
    setErreur(null)
    setVerification(null)
    try {
      const { data, error } = await supabase.rpc('verifier_exercice_valide', { p_dossier_id: dossierId, p_annee: annee })
      if (error) {
        setErreur(messageErreur(error, "L'empreinte n'a pas pu être vérifiée."))
        return
      }
      setVerification(data === true ? 'intacte' : 'alteree')
    } finally {
      verificationEnCours.current = false
    }
  }

  if (valide) {
    return (
      <div className="card validation-exercice" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          Exercice {annee} validé <span className="badge badge-ok">validé</span>
        </h3>
        <p style={{ marginTop: 0 }}>
          Validé le {formatDate(valide.valide_le)} — {valide.nb_ecritures} écriture(s), {valide.nb_lignes} ligne(s),
          {' '}{formatMoney(valide.total_debit)} au débit comme au crédit.
        </p>
        <p className="muted">
          Ses écritures ne se modifient plus, et ce qui les a produites est figé avec elles : pièces, mouvements
          bancaires, biens, lignes du cadre 7, échéances de cotisation de l'exercice. Une erreur trouvée désormais se
          corrige sur l'exercice suivant. Le FEC de l'exercice se relit depuis ses écritures validées, dans
          l'onglet Écritures.
        </p>
        <p className="muted" style={{ marginBottom: 8 }}>
          Empreinte <span style={{ fontFamily: 'monospace' }}>{valide.empreinte.slice(0, 16)}…</span>
          {valide.empreinte_precedente ? ` — chaînée à celle de l'exercice ${annee - 1}.` : ' — premier exercice validé du dossier.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={verifier}>Vérifier l’empreinte</button>
          {onNavigate && <button className="btn btn-outline btn-sm" onClick={() => onNavigate('ecritures')}>Écritures</button>}
        </div>
        {verification === 'intacte' && (
          <p className="muted" style={{ marginBottom: 0 }}>
            Empreinte vérifiée : les écritures de l'exercice sont celles qui ont été validées.
          </p>
        )}
        {verification === 'alteree' && (
          <p className="error-text" style={{ marginBottom: 0 }}>
            L'empreinte ne correspond plus : une écriture validée de cet exercice a été modifiée hors de
            l'application. À signaler sans attendre — la validation ne garantit plus ce que dit le FEC.
          </p>
        )}
        {erreur && <p className="error-text">{erreur}</p>}
      </div>
    )
  }

  if (!etat) return null
  const bloquants = etat.prealables.filter((p) => p.bloquant)
  const avertissements = etat.prealables.filter((p) => !p.bloquant)
  return (
    <div className="card validation-exercice" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Valider l’exercice {annee}</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        La validation rend les écritures de l'exercice définitives : elles ne se modifient plus, et ce qui les a
        produites est figé avec elles. Elle ne se défait pas — une erreur trouvée ensuite se corrige sur l'exercice
        suivant. Elle ne clôture pas l'exercice : « Clôturer » reste un geste à part.
      </p>
      {bloquants.length > 0 ? (
        <>
          <p style={{ marginBottom: 4 }}><strong>Avant de valider</strong></p>
          <ListePrealables prealables={bloquants} onNavigate={onNavigate} onChoisirExercice={onChoisirExercice} />
        </>
      ) : (
        <p>Rien n'empêche de valider cet exercice.</p>
      )}
      {avertissements.length > 0 && (
        <>
          <p style={{ marginBottom: 4 }}><strong>À lire avant de valider</strong></p>
          <ListePrealables prealables={avertissements} onNavigate={onNavigate} onChoisirExercice={onChoisirExercice} />
        </>
      )}
      {etat.validable && demande && (
        <p className="muted">{resume(demande)}</p>
      )}
      {estChef ? (
        <button
          className="btn btn-primary"
          disabled={!etat.validable || !demande || enCours}
          onClick={valider}
          title={etat.validable ? undefined : 'Un préalable empêche encore de valider cet exercice.'}
        >
          {enCours ? 'Validation…' : `Valider l’exercice ${annee}`}
        </button>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>Seul le chef du cabinet valide un exercice.</p>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
    </div>
  )
}

function ListePrealables({ prealables, onNavigate, onChoisirExercice }: {
  prealables: EtatDeValidation['prealables']
  onNavigate?: (tab: DossierTab) => void
  onChoisirExercice?: (annee: number) => void
}) {
  return (
    <ul style={{ marginTop: 0, paddingLeft: 20 }}>
      {prealables.map((p) => (
        <li key={p.id} style={{ marginBottom: 6 }}>
          {p.nb !== null && <strong>{p.nb} </strong>}
          {p.message}
          {p.detail && <span className="muted"> {p.detail}</span>}
          {p.exercice !== undefined && onChoisirExercice && (
            <>
              {' '}
              <button className="btn btn-outline btn-sm" onClick={() => onChoisirExercice(p.exercice!)}>Exercice {p.exercice}</button>
            </>
          )}
          {p.cible !== 'cloture' && onNavigate && (
            <>
              {' '}
              <button className="btn btn-outline btn-sm" onClick={() => onNavigate(p.cible)}>{libelleDeLOnglet(p.cible)}</button>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

// Une écriture du FEC est un couple journal-numéro : ses lignes le partagent.
function nombreDEcritures(demande: DemandeDeValidation): number {
  return new Set(demande.p_lignes.map((l) => `${l.journal}|${l.numero}`)).size
}

function resume(demande: DemandeDeValidation): string {
  const parJournal = new Map<JournalCode, Set<number>>()
  for (const l of demande.p_lignes) parJournal.set(l.journal, (parJournal.get(l.journal) ?? new Set()).add(l.numero))
  const journaux = [...parJournal].sort(([a], [b]) => a.localeCompare(b))
    .map(([j, numeros]) => `${LIBELLES_JOURNAUX[j].toLowerCase()} : ${numeros.size}`)
  const ecritures = nombreDEcritures(demande)
  return ecritures === 0
    ? "Aucune écriture dans cet exercice : la validation le fige tel qu'il est."
    : `${ecritures} écriture(s) et ${demande.p_lignes.length} ligne(s) seront validées${journaux.length > 0 ? ` (${journaux.join(', ')})` : ''}`
      + `${demande.p_a_nouveaux.length > 0 ? `, avec ${demande.p_a_nouveaux.length} à-nouveau(x)` : ''}.`
}

// LA CONFIRMATION NOMME CE QU'ON PERD, comme toutes celles du projet — « Êtes-vous sûr ? » se ferme d'un clic
// aussi distrait que le premier, et celle-ci précède le geste le plus définitif de l'application.
function confirmation(annee: number, demande: DemandeDeValidation): string {
  const ecritures = nombreDEcritures(demande)
  return [
    `Valider l'exercice ${annee} ? La validation est DÉFINITIVE : elle ne se défait pas.`,
    '',
    `1. Ses ${ecritures} écriture(s) (${demande.p_lignes.length} ligne(s)) deviennent intangibles : elles ne se modifient ni ne se suppriment plus, et aucune écriture ne pourra plus être passée jusqu'au 31/12/${annee}.`,
    '',
    "2. Ce qui les a produites est figé avec elles : les pièces qu'elles comptabilisent, les mouvements bancaires, les parts ventilées ou réglées en groupe, les biens, les lignes du cadre 7 et les échéances de cotisation de l'exercice, et les à-nouveaux.",
    ...(demande.p_declaration
      ? ['', `3. La 2035 de ${annee} est gardée telle qu'elle est aujourd'hui (résultat de ${formatMoney(demande.p_declaration.resultat)}) : elle ne se recalculera plus.`]
      : []),
    '',
    "Une erreur découverte ensuite se corrigera sur l'exercice suivant, jamais dans celui-ci.",
  ].join('\n')
}
