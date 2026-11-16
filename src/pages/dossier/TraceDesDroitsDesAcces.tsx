import { useEffect, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { ADRESSES_DES_ACCES_RETIRES_PREVUES } from '../../lib/adressesDesAccesRetires'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import { OUVERTURES_ATTESTEES_PREVUES } from '../../lib/ouverturesAttestees'
import { ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE, TRACE_DES_DROITS_PREVUE } from '../../lib/traceDesDroits'
import {
  lireLaTraceDuDossier, lireLesAdressesDesAccesRetires, lireLesOuverturesAttestees, type LectureDeLaTrace,
  type LectureDesAdresses, type LectureDesOuvertures,
} from '../../lib/traceDesDroitsLecture'
import {
  AUCUN_CHANGEMENT_TRACE, CE_QUE_DIT_LA_TRACE, CE_QUE_DIT_LA_TRACE_DES_ACCES, CE_QUE_DIT_L_ADRESSE_RETENUE,
  CE_QUE_DIT_L_OUVERTURE_ATTESTEE, auteurMontre, groupesDeLaTrace, nombreDeChangements, phraseDeLaTrace, quandADitLaTrace,
  type AccesNomme,
} from '../../lib/traceDesDroitsVue'

// « DROITS CHANGÉS » : LA TRACE DES CASES D'UN ACCÈS, SOUS LA LISTE DE L'ONGLET ACCÈS (étape P1-trace, ligne 51.5). Côté cabinet
// seulement : la table n'est lisible que de lui, et rien ne s'écrit d'ici. Un volet repliable par accès, les plus récents
// gestes d'abord ; ce que chaque mot dit, et ce que l'écran ne dit jamais, sont dans lib/traceDesDroitsVue.ts.
//
// Rien n'est affirmé avant le retour de la lecture (« Chargement… »), et le vide ne se dit que d'une trace lue EN ENTIER :
// lue en partie, refusée ou rompue, le bandeau le dit et aucun volet n'annonce « aucun changement ». `lectureNo` change
// à chaque relecture de la liste des accès (une case cochée, un accès créé) : la trace se relit alors, la précédente restant
// sous les yeux jusqu'à son retour.
//
// L'ADRESSE D'UN ACCÈS RETIRÉ (P1T-E2), sous `ADRESSES_DES_ACCES_RETIRES_PREVUES` : lue avec la trace, gardée avec son dossier ;
// rien ne s'affiche avant que les deux soient revenues, et une lecture partielle des adresses se dit à part — un accès parti
// garde alors « Accès retiré depuis », jamais un nom deviné.
//
// QUI A OUVERT UN ACCÈS (P1TQ2-Q1), sous `OUVERTURES_ATTESTEES_PREVUES` : les attestations du cabinet et, pour leurs seuls
// comptes, les adresses que la session de qui regarde lit dans l'équipe (lib/ouverturesAttestees.ts), lues avec la trace et
// gardées avec leur dossier ; rien ne s'affiche avant leur retour. Une arrivée attestée se dit « Le cabinet », suivie de
// l'adresse du compte quand cette session la lit ; lues en partie, le bandeau le dit, et une arrivée sans attestation lue
// reste « Sans session ».
export default function TraceDesDroitsDesAcces({ dossierId, acces, listeLue, accesDuDossier, lectureNo }: {
  dossierId: string
  /** Les accès lus aujourd'hui (leur identifiant ne sert qu'à retrouver leur trace). */
  acces: readonly AccesNomme[]
  /** La liste des accès est lue EN ENTIER : seule une telle liste peut dire un accès « retiré ». */
  listeLue: boolean
  /** Les accès jugés pour reconnaître le client (lib/auteursVentes.ts). */
  accesDuDossier: AccesDuDossier
  /** Le numéro de la dernière lecture de la liste des accès. */
  lectureNo: number
}) {
  // La lecture est gardée AVEC son dossier : une réponse pour un autre dossier ne vaut pas pour celui-ci.
  const [lecture, setLecture] = useState<LectureDeLaTrace | null>(null)
  const [lectureDesAdresses, setLectureDesAdresses] = useState<LectureDesAdresses | null>(null)
  const [lectureDesOuvertures, setLectureDesOuvertures] = useState<LectureDesOuvertures | null>(null)

  useEffect(() => {
    if (!TRACE_DES_DROITS_PREVUE) return
    // Le drapeau d'annulation se pose AVANT la première écriture : une lecture plus lente qu'une suivante n'écrit pas après elle.
    let annulee = false
    void lireLaTraceDuDossier(dossierId).then((lue) => { if (!annulee) setLecture(lue) })
    if (ADRESSES_DES_ACCES_RETIRES_PREVUES) {
      void lireLesAdressesDesAccesRetires(dossierId).then((lues) => { if (!annulee) setLectureDesAdresses(lues) })
    }
    if (OUVERTURES_ATTESTEES_PREVUES) {
      void lireLesOuverturesAttestees(dossierId).then((lues) => { if (!annulee) setLectureDesOuvertures(lues) })
    }
    return () => { annulee = true }
  }, [dossierId, lectureNo])

  if (!TRACE_DES_DROITS_PREVUE) return null

  const adressesLues = lectureDesAdresses !== null && lectureDesAdresses.dossierId === dossierId ? lectureDesAdresses : null
  const ouverturesLues = lectureDesOuvertures !== null && lectureDesOuvertures.dossierId === dossierId ? lectureDesOuvertures : null
  const lue = lecture !== null && lecture.dossierId === dossierId && (!ADRESSES_DES_ACCES_RETIRES_PREVUES || adressesLues !== null)
    && (!OUVERTURES_ATTESTEES_PREVUES || ouverturesLues !== null)
    ? lecture : null
  const groupes = lue === null ? [] : groupesDeLaTrace(lue.lignes, acces, listeLue, adressesLues?.parAcces ?? null)

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Droits changés</h3>
      {/* Ce que la carte dit de la base suit la base : l'accès lui-même tracé, sous la migration de P1T-Q2 seulement. */}
      <p className="muted" style={{ marginTop: -8 }}>{ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE ? CE_QUE_DIT_LA_TRACE_DES_ACCES : CE_QUE_DIT_LA_TRACE}</p>
      {ADRESSES_DES_ACCES_RETIRES_PREVUES && <p className="muted">{CE_QUE_DIT_L_ADRESSE_RETENUE}</p>}
      {OUVERTURES_ATTESTEES_PREVUES && <p className="muted">{CE_QUE_DIT_L_OUVERTURE_ATTESTEE}</p>}
      {lue === null ? (
        <p className="muted">Chargement de la trace des droits…</p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi="La trace des droits" accord="lue" motif={lue.motif}
            consequence="Ce qui est montré est vrai, mais ce n’est peut-être pas tout : un changement absent d’ici n’est pas prouvé inexistant. Recharge la page."
          />
          {adressesLues !== null && (
            <BandeauLecturePartielle
              quoi="Les adresses des accès retirés" accord="lues" motif={adressesLues.motif}
              consequence="Un accès retiré dont l’adresse n’a pas été lue se dit « Accès retiré depuis », sans nom. Recharge la page."
            />
          )}
          {ouverturesLues !== null && (
            <BandeauLecturePartielle
              quoi="Les auteurs des ouvertures d’accès" accord="lus" motif={ouverturesLues.motif}
              consequence="Un accès ouvert dont l’attestation n’a pas été lue se dit « Sans session », et un compte dont l’adresse n’a pas été lue, « Le cabinet ». Recharge la page."
            />
          )}
          {groupes.length === 0 && lue.motif === null && (
            <p className="muted">Aucun changement de droits tracé pour ce dossier.</p>
          )}
          {groupes.map((g, i) => (
            <details key={`${g.etat}-${i}`} style={{ marginBottom: 10 }}>
              {/* Un seul texte : l'adresse n'est pas un élément à elle, que l'écran de la liste lirait en double. */}
              <summary className="courriel">
                {`Droits changés — ${g.intitule} — ${g.lignes.length > 0
                  ? nombreDeChangements(g.lignes.length)
                  : lue.motif === null ? 'aucun changement tracé' : 'rien de lu'}`}
              </summary>
              {g.lignes.length > 0 ? (
                <div className="table-scroll tableau-adaptable">
                  <table className="table-empilable-etroite table-empilable-sans-jeu">
                    <thead><tr><th>Date et heure (Paris)</th><th>Case</th><th>Devenue</th><th>Par</th></tr></thead>
                    <tbody>
                      {g.lignes.map((l) => {
                        const phrase = phraseDeLaTrace(l)
                        const auteur = auteurMontre(accesDuDossier, l, ouverturesLues, ouverturesLues?.equipe ?? null)
                        return (
                          <tr key={l.id}>
                            <td data-libelle="Date et heure (Paris)">{quandADitLaTrace(l.instant)}</td>
                            <td data-libelle="Case">{phrase.libelle}</td>
                            <td data-libelle="Devenue">{phrase.etat}</td>
                            <td data-libelle="Par">
                              <span title={auteur.titre}>{auteur.mention}</span>
                              {auteur.adresse !== null && <> — <span className="courriel">{auteur.adresse}</span></>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : lue.motif === null ? (
                <p className="muted">{AUCUN_CHANGEMENT_TRACE}</p>
              ) : (
                <p className="muted">La trace n’a pas été lue en entier : on ne peut pas dire si cet accès a changé de droits.</p>
              )}
            </details>
          ))}
        </>
      )}
    </div>
  )
}
