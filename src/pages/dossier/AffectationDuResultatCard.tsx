import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { DestinationDAffectation, OrganeDeLaDecision, OrigineDAffectation } from '../../lib/affectationDuResultat'
import {
  LIBELLES_DES_ORGANES, ORIGINES_OFFERTES, SAISIE_VIERGE, confirmationDeLEnregistrement, confirmationDuRetrait, decisionEnVigueur,
  destinationsAdmises, eurosTapes, jugerLaSaisie, libelleDeLOrigine, libelleDeLaDestination, parametresDeLEnregistrement,
  propositionDeLAffectation, refusDuRetrait, resultatDeLExercice, saisieDeLaDecision,
  type DecisionLue, type LueDeLAffectation, type LectureDeLAffectation, type SaisieDeLaCarte,
} from '../../lib/affectationEcran'
import { lireLAffectation } from '../../lib/affectationLecture'
import { telechargerUnPdf } from '../../lib/apercu'
import { poids, preparerProcesVerbal } from '../../lib/bornesStockage'
import { echeancesDeLApprobation } from '../../lib/echeancesFiscales'
import { empreinteSha256 } from '../../lib/logoDesFactures'
import {
  chiffresDuDocument, confirmationDuDepot, nomDuFichierDuDocument, pdfDuProcesVerbal, refusDeJoindre, titreDuDocument,
} from '../../lib/procesVerbalDAffectation'
import { joindreLeProcesVerbal } from '../../lib/procesVerbalEcriture'
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
// la carte n'écrit aucun texte libre. Depuis AFF5, sous le même drapeau : le document de la décision en vigueur (procès-verbal,
// acte unanime ou décision de l'associé unique), tiré des seules valeurs que la base a figées avec elle et téléchargé ; le
// document SIGNÉ joint par `joindre_document_affectation` seule (`lib/procesVerbalEcriture.ts`), son type, sa taille et son
// empreinte jugés au choix du fichier, les refus de la base dits avant le clic, sous le même verrou que les deux autres
// gestes ; les rappels de l'approbation (six mois, greffe, neuf mois) au jour de Paris. Le bilan (AFF6) vient après.

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
  // Un seul verrou pour les trois gestes d'écriture : enregistrer ou remplacer, retirer, joindre le document signé.
  const ecritureEnCours = useRef(false)
  // Le tirage du PDF n'écrit rien ; son verrou évite seulement deux téléchargements d'un double clic.
  const telechargementEnCours = useRef(false)
  // Le document signé choisi, jugé et son empreinte calculée AVANT le clic ; un choix plus lent n'écrit pas le dernier.
  const [fichier, setFichier] = useState<{ corps: File; nom: string; poids: string; empreinte: string } | null>(null)
  const [refusDuFichier, setRefusDuFichier] = useState<string | null>(null)
  const choix = useRef(0)

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

  async function choisirLeDocument(f: File | null) {
    const numero = ++choix.current
    setFichier(null)
    setRefusDuFichier(null)
    if (f === null) return
    try {
      const pret = await preparerProcesVerbal(f)
      if (numero !== choix.current) return
      if ('refus' in pret) { setRefusDuFichier(`Ce document n’est pas pris : ${pret.refus.message}.`); return }
      const empreinte = await empreinteSha256(pret.corps)
      if (numero === choix.current) setFichier({ corps: f, nom: f.name, poids: poids(pret.taille), empreinte })
    } catch (e) {
      if (numero === choix.current) setRefusDuFichier(messageErreur(e, 'Le fichier n’a pas pu être lu.'))
    }
  }

  async function telecharger() {
    if (telechargementEnCours.current || enVigueur === null) return
    telechargementEnCours.current = true
    setErreur(null)
    try {
      const octets = await pdfDuProcesVerbal({ annee, identite: lue.identite, decision: enVigueur })
      const issue = telechargerUnPdf(octets, nomDuFichierDuDocument(annee, enVigueur))
      if (!issue.ok) setErreur(issue.message)
    } catch (e) {
      setErreur(messageErreur(e, 'Le document n’a pas pu être préparé.'))
    } finally {
      telechargementEnCours.current = false
    }
  }

  async function joindre() {
    if (ecritureEnCours.current || enVigueur === null || refusDuDocument !== null || fichier === null) return
    if (!window.confirm(confirmationDuDepot(annee, enVigueur, fichier))) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await joindreLeProcesVerbal(dossierId, enVigueur.id, fichier.corps, fichier.empreinte)
      if (issue.ok) setFichier(null)
      else setErreur(issue.message)
      await onRelire()
    } catch (e) {
      setErreur(messageErreur(e, 'Le document n’a pas pu être joint à la décision.'))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  const refusDuDocument = enVigueur ? refusDeJoindre(lue, enVigueur) : null
  const rappels = echeancesDeLApprobation(annee, enVigueur === null ? null : {
    dateDecision: enVigueur.dateDecision, comptesApprouves: enVigueur.comptesApprouves,
    dividendesCentimes: chiffresDuDocument(enVigueur).dividendes, dateMiseEnPaiement: enVigueur.dateMiseEnPaiement,
  }, aujourdHui)
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

      {enVigueur && (
        <div style={{ marginTop: 16 }}>
          <strong>{titreDuDocument(enVigueur.organe)}</strong>
          <p className="muted" style={{ marginTop: 4 }}>
            Un projet tiré des comptes figés avec la version {enVigueur.version} : le lieu, les associés, les votes et les signatures
            restent à compléter. La régularité de la décision relève des associés et de leurs statuts.
          </p>
          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => void telecharger()}>Télécharger le procès-verbal</button>
          </div>
          {enVigueur.document ? (
            <p className="muted">Document signé joint — empreinte SHA-256 <span className="nom-fichier">{enVigueur.document.empreinte}</span>.</p>
          ) : refusDuDocument ? (
            <p className="muted">{refusDuDocument}</p>
          ) : (
            <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <div className="field">
                <label htmlFor={id('document')}>Document signé (PDF)</label>
                <input id={id('document')} type="file" accept="application/pdf" disabled={enCours}
                  onChange={(e) => void choisirLeDocument(e.target.files?.[0] ?? null)} />
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => void joindre()} disabled={enCours || fichier === null}>
                {enCours ? 'Dépôt…' : 'Joindre le document signé'}
              </button>
            </div>
          )}
          {refusDuFichier && <p className="muted">{refusDuFichier}</p>}
          {fichier && !enVigueur.document && (
            <p className="muted">
              <span className="nom-fichier">{fichier.nom}</span> ({fichier.poids}), empreinte SHA-256 <span className="nom-fichier">{fichier.empreinte}</span>.
            </p>
          )}
        </div>
      )}

      {rappels.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <strong>Le calendrier de l’approbation</strong>
          <ul style={{ marginTop: 4 }}>
            {rappels.map((r) => (
              <li key={r.id}>
                {formatDate(r.date)} — {r.libelle} : {r.etat === 'tenu' ? 'tenu' : r.etat === 'passe' ? 'date passée' : 'à venir'}. <span className="muted">{r.dit}</span>
              </li>
            ))}
          </ul>
        </div>
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
