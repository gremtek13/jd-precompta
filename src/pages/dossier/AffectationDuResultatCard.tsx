import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DestinationDAffectation, OrganeDeLaDecision, OrigineDAffectation } from '../../lib/affectationDuResultat'
import {
  LIBELLES_DES_ORGANES, ORIGINES_OFFERTES, SAISIE_VIERGE, confirmationDeLEnregistrement, confirmationDuRetrait, decisionEnVigueur,
  destinationsAdmises, eurosTapes, jugerLaSaisie, libelleDeLOrigine, libelleDeLaDestination, parametresDeLEnregistrement,
  propositionDeLAffectation, refusDuRetrait, resultatDeLExercice, saisieDeLaDecision,
  type DecisionLue, type LueDeLAffectation, type LectureDeLAffectation, type SaisieDeLaCarte,
} from '../../lib/affectationEcran'
import { lireLAffectation } from '../../lib/affectationLecture'
import type { ModeleComptable } from '../../lib/engagement'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { supabase } from '../../lib/supabase'

// LA CARTE « APPROBATION ET AFFECTATION DU RÉSULTAT » DE CLÔTURE (ligne 45, lot AFF4 ; conception § 5.8), derrière
// `AFFECTATION_EXPORTEE` (baissé : elle ne se monte pas). Pour un dossier en engagement : le résultat lu de l'exercice VALIDÉ,
// la proposition du module (réserve légale minimale, bénéfice distribuable, plafond des dividendes — jamais une décision),
// la saisie de la décision telle qu'elle a été votée, les refus du module dits AVANT le clic sur la saisie telle qu'elle part,
// le remplacement d'une décision et son retrait. La lecture d'abord, EN ENTIER (`lireLAffectation`), ou rien n'est offert ;
// l'écriture par `enregistrer_affectation` et `retirer_affectation` seules, contre la version lue, sous un verrou relâché
// APRÈS la relecture ; la confirmation nomme l'exercice, la répartition, l'écriture et la version remplacée. Rien côté client :
// la carte n'écrit aucun texte libre. Le document (AFF5), le calendrier et le bilan (AFF6) viennent après.

export default function AffectationDuResultatCard({ dossierId, annee, modele }: {
  dossierId: string
  /** L'exercice AFFECTÉ, celui que l'onglet Clôture montre (`useAnnee()`). */
  annee: number
  modele: ModeleComptable
}) {
  const [lue, setLue] = useState<LectureDeLAffectation | null>(null)
  // Une lecture plus lente n'écrit pas la dernière : seule la plus récente pose son résultat.
  const sequence = useRef(0)
  const relire = useCallback(async () => {
    const numero = ++sequence.current
    const lecture = await lireLAffectation(dossierId, annee)
    if (numero === sequence.current) setLue(lecture)
  }, [dossierId, annee])
  useEffect(() => {
    // Quitter l'exercice ou le dossier périme toute lecture en vol : le compteur monte, la lecture revenue ne pose rien.
    const compteur = sequence
    void relire()
    return () => { compteur.current++ }
  }, [relire])

  const lecture = lue !== null && lue.dossierId === dossierId && lue.annee === annee ? lue : null
  const titre = <strong>Approbation et affectation du résultat {annee}</strong>

  if (lecture === null) return <div className="card" style={{ marginBottom: 20 }}>{titre}<p className="muted">Chargement…</p></div>
  if (lecture.etat === 'incomplete') {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        {titre}
        <p className="muted">Lecture incomplète : {lecture.motif}. Rien ne s’écrit tant que l’affectation n’est pas lue en entier.</p>
      </div>
    )
  }
  if (!lecture.anneesValidees.includes(annee)) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        {titre}
        <p className="muted">L’exercice {annee} n’est pas validé : son résultat n’est pas figé, il ne s’affecte pas encore.</p>
      </div>
    )
  }
  const enVigueur = decisionEnVigueur(lecture)
  return (
    <FormulaireDeLAffectation
      key={`${enVigueur?.id ?? 'aucune'}:${lecture.decisions.length}`}
      lue={lecture} modele={modele} dossierId={dossierId} annee={annee} onRelire={relire} titre={titre} />
  )
}

const MONTANT_DE_LA_LIGNE = (annee: number, i: number) => `affectation-${annee}-ligne-${i}-montant`

function FormulaireDeLAffectation({ lue, modele, dossierId, annee, onRelire, titre }: {
  lue: LueDeLAffectation
  modele: ModeleComptable
  dossierId: string
  annee: number
  onRelire: () => Promise<void>
  titre: ReactNode
}) {
  const enVigueur = decisionEnVigueur(lue)
  const [saisie, setSaisie] = useState<SaisieDeLaCarte>(() => (enVigueur ? saisieDeLaDecision(enVigueur) : SAISIE_VIERGE))
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Un seul verrou pour les deux gestes d'écriture : enregistrer ou remplacer, retirer.
  const ecritureEnCours = useRef(false)

  const aujourdHui = aujourdHuiAParis()
  const j = jugerLaSaisie(lue, modele, saisie, aujourdHui)
  const { proposition, auJour } = propositionDeLAffectation(lue, modele, saisie, aujourdHui)
  const resultat = resultatDeLExercice(lue.brouillon, annee)
  const refusDuRetraitEnVigueur = enVigueur ? refusDuRetrait(lue, enVigueur) : null
  const figee = enVigueur !== null && refusDuRetraitEnVigueur !== null
  const inchangee = enVigueur !== null && JSON.stringify(saisie) === JSON.stringify(saisieDeLaDecision(enVigueur))
  const refus = [...(j.refusDeLaCarte ? [j.refusDeLaCarte] : []), ...j.jugement.refus.map((r) => r.message)]
  const precedentes = lue.decisions.filter((d) => d.etat !== 'en_vigueur')

  const change = (suite: Partial<SaisieDeLaCarte>) => setSaisie({ ...saisie, ...suite })
  const changeLigne = (i: number, suite: Partial<SaisieDeLaCarte['lignes'][number]>) =>
    change({ lignes: saisie.lignes.map((l, k) => {
      if (k !== i) return l
      const suivante = { ...l, ...suite }
      // Un couple que le module n'admet pas ne s'offre pas : la destination suit l'origine.
      const admises = destinationsAdmises(suivante.origine)
      return admises.includes(suivante.destination) ? suivante : { ...suivante, destination: admises[0] }
    }) })

  async function enregistrer() {
    if (ecritureEnCours.current || !j.enregistrable || inchangee) return
    if (!window.confirm(confirmationDeLEnregistrement(annee, j, enVigueur))) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('enregistrer_affectation',
        parametresDeLEnregistrement(dossierId, annee, enVigueur?.version ?? null, j))
      if (error) setErreur(messageErreur(error, 'L’enregistrement de la décision a échoué.'))
      await onRelire()
    } catch (e) {
      setErreur(messageErreur(e, 'L’enregistrement de la décision a échoué.'))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function retirer() {
    if (ecritureEnCours.current || enVigueur === null || refusDuRetraitEnVigueur !== null) return
    if (!window.confirm(confirmationDuRetrait(annee, enVigueur))) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('retirer_affectation',
        { p_dossier_id: dossierId, p_affectation_id: enVigueur.id, p_version_lue: enVigueur.version })
      if (error) setErreur(messageErreur(error, 'Le retrait de la décision a échoué.'))
      await onRelire()
    } catch (e) {
      setErreur(messageErreur(e, 'Le retrait de la décision a échoué.'))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  const id = (nom: string) => `affectation-${annee}-${nom}`
  const nature = resultat > 0 ? 'bénéfice' : resultat < 0 ? 'perte' : null

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {titre}
      <p className="muted">
        {nature ? `L’exercice ${annee} se solde par ${nature === 'bénéfice' ? 'un bénéfice' : 'une perte'} de ${formatMoney(Math.abs(resultat) / 100)}.`
          : `Le résultat de l’exercice ${annee} est nul.`}{' '}
        La décision est celle des associés : l’application propose, le cabinet saisit ce qui a été voté, et l’écriture se date de la décision.
      </p>

      {enVigueur && (
        <p>
          Décision en vigueur : version {enVigueur.version}, du {formatDate(enVigueur.dateDecision)} ({LIBELLES_DES_ORGANES[enVigueur.organe]},{' '}
          {enVigueur.comptesApprouves ? 'comptes approuvés' : 'comptes non approuvés'}).
        </p>
      )}
      {figee && <p className="muted">{refusDuRetraitEnVigueur} La décision et son écriture sont figées avec l’exercice.</p>}

      {proposition ? (
        <div>
          <p style={{ marginBottom: 4 }}><strong>Proposition</strong> <span className="muted">(calculée au {formatDate(auJour)}, jamais une décision)</span></p>
          <ul style={{ marginTop: 0 }}>
            <li>Réserve légale minimale : {formatMoney(proposition.reserveLegaleMinimale / 100)}</li>
            <li>Bénéfice distribuable : {formatMoney(proposition.beneficeDistribuable / 100)}</li>
            <li>Plafond des dividendes : {formatMoney(proposition.plafondDesDividendes / 100)}</li>
            {proposition.lignes.map((l, i) => (
              <li key={i}>{libelleDeLOrigine(l.origine)} → {libelleDeLaDestination(l.destination).toLowerCase()} : {formatMoney(l.centimes / 100)}</li>
            ))}
          </ul>
          {!figee && (
            <button className="btn btn-outline btn-sm" disabled={enCours}
              onClick={() => change({ lignes: proposition.lignes.map((l) => ({ origine: l.origine, destination: l.destination, montant: eurosTapes(l.centimes) })) })}>
              Reprendre la proposition
            </button>
          )}
        </div>
      ) : (
        <p className="muted">Aucune proposition pour ce dossier : le refus ci-dessous dit pourquoi.</p>
      )}

      {!figee && (
        <>
          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <div className="field">
              <label htmlFor={id('organe')}>Décision prise par</label>
              <select id={id('organe')} value={saisie.organe} onChange={(e) => change({ organe: e.target.value as OrganeDeLaDecision })}>
                {(Object.keys(LIBELLES_DES_ORGANES) as OrganeDeLaDecision[]).map((o) => <option key={o} value={o}>{LIBELLES_DES_ORGANES[o]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={id('associes')}>Associés</label>
              <select id={id('associes')} value={saisie.nombreDAssocies} onChange={(e) => change({ nombreDAssocies: e.target.value as 'un' | 'plusieurs' })}>
                <option value="plusieurs">Plusieurs associés</option>
                <option value="un">Un associé unique</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={id('approbation')}>Comptes</label>
              <select id={id('approbation')} value={saisie.comptesApprouves ? 'oui' : 'non'}
                onChange={(e) => change({ comptesApprouves: e.target.value === 'oui' })}>
                <option value="oui">Approuvés</option>
                <option value="non">Non approuvés (aucune affectation)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={id('date')}>Date de la décision</label>
              <input id={id('date')} type="date" value={saisie.dateDecision} onChange={(e) => change({ dateDecision: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={id('paiement')}>Mise en paiement des dividendes</label>
              <input id={id('paiement')} type="date" value={saisie.dateMiseEnPaiement} onChange={(e) => change({ dateMiseEnPaiement: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={id('statuts')}>Réserves statutaires, selon les statuts</label>
              <select id={id('statuts')} value={saisie.statuts}
                onChange={(e) => change({ statuts: e.target.value as SaisieDeLaCarte['statuts'] })}>
                <option value="">À choisir</option>
                <option value="distribuables">Distribuables</option>
                <option value="indisponibles">Non distribuables</option>
              </select>
            </div>
          </div>

          {saisie.comptesApprouves && (
            <div style={{ marginTop: 12 }}>
              <strong>Répartition</strong>
              {saisie.lignes.map((l, i) => (
                <div key={i} className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="field">
                    <label htmlFor={`affectation-${annee}-ligne-${i}-origine`}>Origine de la ligne {i + 1}</label>
                    <select id={`affectation-${annee}-ligne-${i}-origine`} value={l.origine}
                      onChange={(e) => changeLigne(i, { origine: e.target.value as OrigineDAffectation })}>
                      {ORIGINES_OFFERTES.map((o) => <option key={o} value={o}>{libelleDeLOrigine(o)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`affectation-${annee}-ligne-${i}-destination`}>Destination de la ligne {i + 1}</label>
                    <select id={`affectation-${annee}-ligne-${i}-destination`} value={l.destination}
                      onChange={(e) => changeLigne(i, { destination: e.target.value as DestinationDAffectation })}>
                      {destinationsAdmises(l.origine).map((d) => <option key={d} value={d}>{libelleDeLaDestination(d)}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={MONTANT_DE_LA_LIGNE(annee, i)}>Montant de la ligne {i + 1} (€)</label>
                    <input id={MONTANT_DE_LA_LIGNE(annee, i)} inputMode="decimal" value={l.montant} onChange={(e) => changeLigne(i, { montant: e.target.value })} />
                  </div>
                  <button className="btn btn-outline btn-sm" disabled={enCours}
                    onClick={() => change({ lignes: saisie.lignes.filter((_, k) => k !== i) })}>
                    Retirer la ligne {i + 1}
                  </button>
                </div>
              ))}
              <button className="btn btn-outline btn-sm" disabled={enCours}
                onClick={() => change({ lignes: [...saisie.lignes, { origine: resultat < 0 ? 'perte' : 'benefice', destination: resultat < 0 ? 'report_debiteur' : 'report_crediteur', montant: '' }] })}>
                Ajouter une ligne
              </button>
            </div>
          )}

          {j.jugement.calcul && (
            <p className="muted" style={{ marginTop: 12 }}>
              Capitaux propres après affectation : {formatMoney(j.jugement.calcul.capitauxPropresApres / 100)} (avant : {formatMoney(j.jugement.calcul.capitauxPropresAvant / 100)}).
            </p>
          )}
          {j.jugement.avertissements.map((a) => <p key={a.code} className="muted">À noter : {a.message}</p>)}
          {refus.map((r) => <p key={r} className="muted">{r}</p>)}
          {!refus.length && inchangee && <p className="muted">Rien n’a changé.</p>}

          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void enregistrer()}
              disabled={enCours || !j.enregistrable || inchangee}>
              {enCours ? 'Enregistrement…' : enVigueur ? 'Remplacer la décision' : 'Enregistrer la décision'}
            </button>
            {enVigueur && (
              <button className="btn btn-outline btn-sm" onClick={() => void retirer()} disabled={enCours}>
                Retirer la décision
              </button>
            )}
          </div>
        </>
      )}

      {precedentes.length > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          Versions précédentes, lisibles : {precedentes.map((d: DecisionLue) =>
            `version ${d.version} du ${formatDate(d.dateDecision)} (${d.etat === 'retiree' ? 'retirée' : 'remplacée'}${d.finLe ? ` le ${formatDate(d.finLe)}` : ''})`).join(', ')}.
        </p>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
    </div>
  )
}
