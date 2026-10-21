import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  LIBELLE_ETAT_SOURCE, LIBELLE_GESTE, argumentsDuChoix, argumentsDuGeste, choixInchange, compteSaisi, confirmationDuChoix,
  confirmationDuGeste, refusDuChoix, type EtatSourceDeVente, type EtatsDesVentes, type SourceDeVenteEtat,
} from '../../lib/ecrituresVentesFactureesEcran'

// LES VENTES FACTURÉES, DANS L'ONGLET ÉCRITURES (ligne 28.6, chantier EC-Q3, étape VF4c1 ; le module est
// lib/ecrituresVentesFactureesEcran.ts, la lecture lib/ecrituresVentesFactureesLecture.ts). Une section côté CABINET seul,
// que l'onglet ne monte que pour un dossier qui a basculé (`ventes_par_les_factures`) : chaque source dans son état, et ses
// gestes — « Écrire », « Réécrire », « Retirer », le choix du compte de contrepartie d'une compensation —, chacun par la
// fonction SQL seule (`ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`, `choisir_compte_contrepartie`).
//
// ELLE NE LIT RIEN ELLE-MÊME : l'onglet lit les ventes facturées avec le brouillon, dans la même relecture (`relire`), et
// lui passe les états qu'il en tire — `null` tant que l'une des lectures n'est pas revenue ; un motif quand l'une a manqué ;
// `relecture` tant qu'une relecture est en cours, les états d'avant restant affichés. Dans ces trois cas, AUCUN geste : un
// état calculé sur une liste partielle, ou que la relecture va remplacer, ferait écrire ce qui l'est déjà, ou retirer ce
// qui ne l'est pas.
//
// UN VERROU `useRef` PAR SOURCE, posé avant le `try` et relâché dans le `finally`, APRÈS la relecture : relâché plus tôt,
// la source garderait son état d'avant le temps que la relecture revienne, et un second clic la réécrirait — la base la
// recomposerait, mais rien ne sert de lui faire refuser ce que l'écran sait déjà. Le refus de la base se dit AVANT le
// clic (le module le lit des fonctions de lib/ecritureVenteFacturee.ts) ; la confirmation NOMME la source et ce que le
// geste écrit, remplace ou retire.
//
// « CHANGER LE COMPTE » (VF4C1-Q1, étape VF4c3) : sur un encaissement par compensation dont le compte de contrepartie est
// déjà choisi et accepté, tant que son exercice n'est pas validé (le module le dit, `choixDuCompte.geste`). Le même contrat
// que le choix : `choisir_compte_contrepartie` seule, le refus de la saisie telle qu'elle part dit avant le clic, le même
// verrou par source, une confirmation qui nomme l'encaissement, l'ancien et le nouveau compte, et ce que devient une
// écriture déjà passée. Le champ ne s'ouvre que sur un clic : un compte accepté n'a rien à demander.
//
// PAS DE LOT (« écrire tout ce qui est à écrire ») : chaque source se confirme sur ce qu'elle écrit, nommé ligne à ligne,
// et un lot devrait soit taire ces lignes, soit les empiler dans une confirmation que personne ne lit ; une vente
// facturée en porte au plus quelques-unes (sa facture, ses encaissements, leur mouvement). À reconsidérer si un dossier en
// compte des centaines à la fois — la reprise d'un exercice, par exemple.

const BADGE: Readonly<Record<EtatSourceDeVente, string>> = {
  a_ecrire: 'badge-warning',
  a_jour: 'badge-ok',
  a_reecrire: 'badge-danger',
  a_retirer: 'badge-danger',
  validee: 'badge-neutral',
  ne_s_ecrit_pas: 'badge-warning',
}

const ORDRE_DES_COMPTES: readonly EtatSourceDeVente[] = ['a_ecrire', 'a_reecrire', 'a_retirer', 'ne_s_ecrit_pas', 'a_jour', 'validee']

export default function VentesFactureesEcritures({ etats, motifIncomplet, relecture, relire, lettrageDesFactures }: {
  /** Les états des sources, tirés de lectures toutes revenues EN ENTIER ; `null` tant que l'une ne l'est pas. */
  etats: EtatsDesVentes | null
  /** Pourquoi une lecture a manqué (les ventes facturées ou le brouillon) ; nul sinon. */
  motifIncomplet: string | null
  /** Une relecture de l'onglet est en cours : les états affichés sont ceux d'avant, et aucun geste ne part. */
  relecture: boolean
  /** La relecture de l'onglet : le brouillon et les ventes facturées ensemble. */
  relire: () => Promise<void>
  /**
   * Ce que le lettrage du compte de tiers dit de chaque facture, par identifiant (étape VF4c2 ; lib/lettrage.ts,
   * `lettragesDesFactures`, `phraseDuLettrage`) : lettrée, ou pourquoi elle ne l'est pas. Vide en trésorerie. Sans valeur
   * par défaut : oubliée, une facture que le FEC laisse sans lettrage ne dirait pas pourquoi.
   */
  lettrageDesFactures: ReadonlyMap<string, string>
}) {
  // Un verrou par source : deux sources différentes peuvent s'écrire ensemble, la même jamais.
  const gestesEnCours = useRef<Set<string>>(new Set())
  const [enCours, setEnCours] = useState<ReadonlySet<string>>(new Set())
  const [erreur, setErreur] = useState<string | null>(null)
  const [saisies, setSaisies] = useState<Readonly<Record<string, string>>>({})
  // Les sources dont le champ « Changer le compte » est ouvert.
  const [changements, setChangements] = useState<ReadonlySet<string>>(new Set())
  const ouvrirLeChangement = (cle: string, ouvert: boolean) => setChangements((avant) => {
    const apres = new Set(avant)
    if (ouvert) apres.add(cle)
    else apres.delete(cle)
    return apres
  })

  const lus = etats?.etat === 'lus' ? etats : null
  const gestesPermis = lus !== null && motifIncomplet === null && !relecture

  // Le relâchement, dans le `finally` de chaque geste ; la POSE est écrite dans chacun, avant son premier `await`.
  function relacher(cle: string) {
    gestesEnCours.current.delete(cle)
    setEnCours(new Set(gestesEnCours.current))
  }

  async function agir(s: SourceDeVenteEtat) {
    if (!lus || !gestesPermis || s.geste == null || s.refus != null || gestesEnCours.current.has(s.cle)) return
    if (!window.confirm(confirmationDuGeste(s))) return
    // Posé AVANT le `try`, et avant tout `await` : un second clic du même rendu trouve le verrou.
    gestesEnCours.current.add(s.cle)
    setEnCours(new Set(gestesEnCours.current))
    setErreur(null)
    try {
      const { fonction, args } = argumentsDuGeste(s, lus.contexte)
      const { error } = await supabase.rpc(fonction, args)
      if (error) throw error
      // Relu AVANT de relâcher le verrou : jusque-là, la source porte encore son état d'avant.
      await relire()
    } catch (e) {
      setErreur(messageErreur(e, `${s.geste === 'retirer' ? 'Le retrait' : 'L’écriture'} de ${s.nom} n’a pas pu se faire.`))
    } finally {
      relacher(s.cle)
    }
  }

  async function choisirLeCompte(s: SourceDeVenteEtat) {
    const choix = s.choixDuCompte
    if (!lus || !gestesPermis || !choix || gestesEnCours.current.has(s.cle)) return
    const saisie = saisies[s.cle] ?? ''
    // Le refus se lit sur la saisie TELLE QU'ELLE PART (`compteSaisi`) : c'est elle que la fonction reçoit.
    if (refusDuChoix(choix.encaissementId, saisie, lus.contexte) || choixInchange(choix, saisie)) return
    if (!window.confirm(confirmationDuChoix(s, compteSaisi(saisie) as string))) return
    gestesEnCours.current.add(s.cle)
    setEnCours(new Set(gestesEnCours.current))
    setErreur(null)
    try {
      const { error } = await supabase.rpc('choisir_compte_contrepartie', argumentsDuChoix(lus.contexte, choix.encaissementId, saisie))
      if (error) throw error
      await relire()
      setSaisies((avant) => Object.fromEntries(Object.entries(avant).filter(([cle]) => cle !== s.cle)))
      ouvrirLeChangement(s.cle, false)
    } catch (e) {
      setErreur(messageErreur(e, `Le compte de contrepartie de ${s.nom} n’a pas pu être ${choix.geste === 'changer' ? 'changé' : 'choisi'}.`))
    } finally {
      relacher(s.cle)
    }
  }

  const compte = (etat: EtatSourceDeVente) => lus?.sources.filter((s) => s.etat === etat).length ?? 0

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        Ventes facturées
        {ORDRE_DES_COMPTES.filter((e) => compte(e) > 0 && e !== 'a_jour' && e !== 'validee').map((e) => (
          <span key={e} className={`badge ${BADGE[e]}`}>{compte(e)} {LIBELLE_ETAT_SOURCE[e]}</span>
        ))}
      </h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Les factures de ce dossier sont la source de leurs ventes : chaque facture, avoir, encaissement, et chaque mouvement
        que des encaissements classent, s’écrit ici sur un clic, par la fonction qui vérifie l’écriture avant de l’écrire.
        Une écriture à jour va au FEC, sous la pièce de sa source, et à la piste d’audit ; une écriture à réécrire ou à
        retirer reste hors du FEC tant qu’elle n’est pas reprise.
      </p>

      {motifIncomplet !== null ? (
        <p className="error-text" style={{ marginBottom: 0 }}>
          Les ventes facturées ou le brouillon n’ont pas pu être lus en entier ({motifIncomplet}). Aucune écriture d’une vente
          facturée ne s’écrit ni ne se retire d’ici : un état calculé sur une lecture partielle ferait écrire ce qui l’est
          déjà. Recharge la page.
        </p>
      ) : etats === null ? (
        <p className="muted" style={{ marginBottom: 0 }}>Chargement…</p>
      ) : etats.etat === 'incoherent' ? (
        <p className="error-text" style={{ marginBottom: 0 }}>
          Les lectures ne se tiennent pas entre elles ({etats.motif}). Aucune écriture d’une vente facturée ne s’écrit ni ne
          se retire d’ici. Recharge la page.
        </p>
      ) : etats.sources.length === 0 ? (
        <p className="muted" style={{ marginBottom: 0 }}>Aucune vente facturée n’a d’écriture à passer, à reprendre ou à dire.</p>
      ) : (
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite table-empilable-sans-jeu">
            <thead><tr><th>Source</th><th>Date</th><th>Montant</th><th>État</th><th></th></tr></thead>
            <tbody>
              {etats.sources.map((s) => {
                const occupee = enCours.has(s.cle)
                const choix = s.choixDuCompte
                const saisie = saisies[s.cle] ?? ''
                const refusChoix = choix && lus ? refusDuChoix(choix.encaissementId, saisie, lus.contexte) : null
                const inchange = choix !== null && choixInchange(choix, saisie)
                // Un compte à choisir ou refusé montre son champ ; un compte accepté, sur le clic « Changer le compte ».
                const champOuvert = choix !== null && (choix.geste === 'choisir' || changements.has(s.cle))
                return (
                  <tr key={s.cle}>
                    <td data-libelle="Source">{s.nom.charAt(0).toUpperCase() + s.nom.slice(1)}</td>
                    <td data-libelle="Date">{formatDate(s.date)}</td>
                    <td data-libelle="Montant">{formatMoney(s.montant)}</td>
                    <td data-libelle="État">
                      <div>
                        <span className={`badge ${BADGE[s.etat]}`}>{LIBELLE_ETAT_SOURCE[s.etat]}</span>
                        <p className="muted" style={{ margin: '4px 0 0' }}>{s.detail}</p>
                        {s.source.genre === 'facture' && lettrageDesFactures.has(s.source.factureId) && (
                          <p className="muted" style={{ margin: '4px 0 0' }}>{lettrageDesFactures.get(s.source.factureId)}</p>
                        )}
                      </div>
                    </td>
                    <td className="td-boutons">
                      <div>
                        {s.geste != null && (
                          <button
                            type="button"
                            className={`btn btn-sm ${s.geste === 'retirer' ? 'btn-danger' : 'btn-outline'}`}
                            disabled={!gestesPermis || occupee || s.refus !== null}
                            title={s.refus ?? undefined}
                            onClick={() => agir(s)}
                          >
                            {occupee ? 'En cours…' : LIBELLE_GESTE[s.geste]}
                          </button>
                        )}
                        {s.refus !== null && <p className="muted" style={{ margin: '4px 0 0' }}>{s.refus}</p>}
                        {choix && choix.geste === 'changer' && !champOuvert && (
                          <div style={{ marginTop: s.geste != null ? 8 : 0 }}>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={!gestesPermis || occupee}
                              onClick={() => ouvrirLeChangement(s.cle, true)}
                            >
                              Changer le compte
                            </button>
                            <p className="muted" style={{ margin: '4px 0 0' }}>Compte de contrepartie : {choix.actuel}.</p>
                          </div>
                        )}
                        {choix && champOuvert && (
                          <div className="field-row aligne-bas" style={{ marginTop: s.geste != null ? 8 : 0 }}>
                            <div className="field">
                              <label htmlFor={`compte-${s.cle}`}>
                                {choix.geste === 'changer'
                                  ? `Nouveau compte de contrepartie (aujourd’hui ${choix.actuel})`
                                  : choix.actuel ? `Compte de contrepartie (aujourd’hui ${choix.actuel}, refusé)` : 'Compte de contrepartie'}
                              </label>
                              <input
                                id={`compte-${s.cle}`}
                                inputMode="numeric"
                                placeholder="ex. 467100"
                                value={saisie}
                                disabled={!gestesPermis || occupee}
                                onChange={(e) => setSaisies((avant) => ({ ...avant, [s.cle]: e.target.value }))}
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              disabled={!gestesPermis || occupee || refusChoix !== null || inchange}
                              title={refusChoix?.message}
                              onClick={() => choisirLeCompte(s)}
                            >
                              Choisir ce compte
                            </button>
                            {choix.geste === 'changer' && (
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                disabled={occupee}
                                onClick={() => ouvrirLeChangement(s.cle, false)}
                              >
                                Annuler
                              </button>
                            )}
                          </div>
                        )}
                        {/* Le refus de la saisie telle qu'elle part, dit avant le clic ; « à choisir » se voit au champ vide. */}
                        {champOuvert && refusChoix && refusChoix.cle !== 'compte_absent' && (
                          <p className="muted" style={{ margin: '4px 0 0' }}>{refusChoix.message}</p>
                        )}
                        {champOuvert && !refusChoix && inchange && (
                          <p className="muted" style={{ margin: '4px 0 0' }}>C’est le compte qu’il porte déjà.</p>
                        )}
                        {champOuvert && !refusChoix && !inchange && (
                          <p className="muted" style={{ margin: '4px 0 0' }}>
                            {choix.apresLeChoix === 'a_reecrire'
                              ? `Une fois ${choix.geste === 'changer' ? 'changé' : 'choisi'}, ses écritures proposées seront « à réécrire ».`
                              : `Une fois ${choix.geste === 'changer' ? 'changé' : 'choisi'}, il sera « à écrire ».`}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {erreur && <p className="error-text" style={{ marginBottom: 0 }}>{erreur}</p>}
    </div>
  )
}
