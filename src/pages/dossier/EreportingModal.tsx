import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { telechargerTexte } from '../../lib/fec'
import { messageErreur } from '../../lib/messageErreur'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import type { DossierEreporting } from '../../lib/ereporting'
import { argumentsDeLaDeclaration, refusDeclaration } from '../../lib/declarationsEreporting'
import {
  CONSEQUENCE_D_UNE_LECTURE_PARTIELLE, NOMS_DES_OBJETS, OBJETS_DE_LA_FENETRE, confirmationDeLaDeclaration,
  confirmationDuRegime, confirmationDuRetraitDuRegime, contexteDeLaDeclaration, csvDuDetail, ecarteesEnMots, etatDuRegime,
  lecturesManquantes, ligneAFaire, lignesDeLEreporting, motsDeLaCause, motsDeLaDifference, nomFichierDuDetail, offreDeDeclaration,
  phraseDeCeQueLaDeclarationGarde, phraseDesFrequences, phraseDuContenu, saisieDeLaDeclaration, sourcesDuRefus,
  tableauDuContenu, type LigneDePeriode, type TonDeLigne,
} from '../../lib/ereportingEcran'
import { lireLEreporting, type LectureDeLEreporting } from '../../lib/ereportingLecture'
import { DEBUT_EREPORTING_PME, type ObjetEreporting } from '../../lib/periodesEreporting'
import {
  ARTICLES_D_EXONERATION, PERIODICITES, argumentsDeLaConfirmation, argumentsDuRetraitDuRegime, frequencesDuRegime,
  libelleDuRegime, refusConfirmationRegime, refusRetraitRegime, regimeProposeDuDossier, regimesActifs,
  type SaisieRegime,
} from '../../lib/regimesEreporting'
import { EXONERATIONS, STATUTS_TVA } from '../../lib/statutTva'
import type { PeriodiciteTva, RegimeEreporting, StatutTva } from '../../lib/types'

// LA FENÊTRE DE L'E-REPORTING (ligne 28.5, étape e5c, phase C) : le régime que le dossier a déclaré à sa plateforme et son
// histoire, les périodes à déclarer — objet par objet : achats à un fournisseur établi hors de France, ventes à des
// particuliers, paiements de ces ventes —, ce que l'application calcule pour chacune (lib/ereporting.ts, étape e4), ce que
// le cabinet a déclaré (lib/declarationsEreporting.ts, étape e5b1) et si cela doit se rectifier.
//
// RIEN NE PART D'ICI VERS UNE PLATEFORME NI VERS L'ADMINISTRATION : le cabinet dépose la période sur la plateforme agréée du
// dossier, hors de l'application, puis INSCRIT ici ce qu'il a déclaré — la base en garde le contenu calculé, figé, avec son
// empreinte. Quatre gestes écrivent, par trois fonctions de la base seulement : confirmer un régime
// (`confirmer_regime_ereporting`), le retirer (`retirer_regime_ereporting`), déclarer une période, initiale ou
// rectificative (`declarer_ereporting_hors_application`). Écarter une pièce candidate et la reprendre se font sur la fiche
// de la pièce (FicheHorsDeFrance), là où les signaux d'e3 la désignent.
//
// TOUT SE LIT EN ENTIER, ET RIEN NE S'AFFIRME NI NE S'OFFRE SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE (règle « lecture
// → formulaire → écriture ») : un contenu bâti sur une partie des factures a l'air d'un contenu juste, un régime lu en
// partie ne dit pas celui de la période, et une déclaration que l'on ne verrait pas se déclarerait deux fois. Les refus
// des fonctions sont dits AVANT le clic, par les modules d'en dessous, dans leur ordre et sous leurs mots ; la base reste
// juge, et un refus qu'elle oppose quand même se dit à son tour.
//
// UN SEUL VERROU `useRef` pour les trois gestes, posé avant le `try` et relâché dans le `finally` APRÈS la relecture : un
// clic pendant qu'elle court partirait d'un état que l'écran n'a pas encore vu. La relecture a lieu aussi sur un refus : la
// base a peut-être vu ce que l'écran n'avait pas lu.

interface Props {
  dossierId: string
  /** Le dossier tel qu'il est aujourd'hui : son statut de TVA (onglet TVA), son SIRET, son numéro de TVA attribué. */
  dossier: DossierEreporting
  /** Ouvre d'emblée la confirmation d'un régime (depuis la carte, quand le régime est à reconfirmer). */
  confirmerDEmblee?: boolean
  onClose: () => void
  /** Un régime a été confirmé ou retiré : la carte relit le sien. */
  onUpdated: () => void
}

interface FormulaireRegime {
  depuis: string
  statut: '' | StatutTva
  article: string
  periodicite: '' | PeriodiciteTva
  debits: boolean
  note: string
}

interface LigneOuverte {
  objet: ObjetEreporting
  debut: string
  fin: string
}

const CLASSE_TON: Record<TonDeLigne, string> = {
  ok: 'badge-ok', attention: 'badge-warning', danger: 'badge-danger', neutre: 'badge-neutral',
}

const LIBELLES_DES_PERIODICITES: Record<PeriodiciteTva, string> = { mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle' }

/** Le formulaire d'un régime, rempli depuis le statut de l'onglet TVA — SAUF le jour, que le cabinet saisit : l'application ne
 * le devine pas (hypothèse E5-Q2). */
function formulaireRegimeDuDossier(d: DossierEreporting): FormulaireRegime {
  const propose = regimeProposeDuDossier(d, null)
  return {
    depuis: '',
    statut: (propose?.statut_tva ?? '') as FormulaireRegime['statut'],
    article: propose?.article_exoneration ?? '',
    periodicite: (propose?.tva_periodicite ?? '') as FormulaireRegime['periodicite'],
    debits: propose?.tva_sur_debits ?? false,
    note: '',
  }
}

/** Ce que le formulaire envoie, tel que le module et la base le jugent : les fréquences sont celles que le régime donne. */
function saisieDuRegime(f: FormulaireRegime): SaisieRegime {
  const statut = f.statut === '' ? null : f.statut
  const redevable = statut === 'redevable'
  const periodicite = redevable && f.periodicite !== '' ? f.periodicite : null
  const frequences = statut == null ? null : frequencesDuRegime(statut, periodicite, redevable && f.debits)
  const note = f.note.trim()
  return {
    depuis: f.depuis === '' ? null : f.depuis,
    statut_tva: statut,
    article_exoneration: statut == null || statut === 'franchise' || f.article === '' ? null : f.article,
    tva_periodicite: periodicite,
    tva_sur_debits: statut == null ? null : redevable ? f.debits : false,
    frequence_transactions: frequences?.transactions ?? null,
    frequence_paiements: frequences?.paiements ?? null,
    note: note === '' ? null : note,
  }
}

// Une lecture qui LÈVE (le réseau tombe) plutôt que de rendre une erreur : la fenêtre le dit, avec la raison.
const raisonDeLecture = (err: unknown) => `L’e-reporting du dossier n’a pas pu être lu : ${messageErreur(err, 'raison inconnue')}.`

const parDepuisDecroissant = (a: RegimeEreporting, b: RegimeEreporting) =>
  a.depuis < b.depuis ? 1 : a.depuis > b.depuis ? -1 : a.cree_le < b.cree_le ? 1 : a.cree_le > b.cree_le ? -1 : a.id < b.id ? 1 : -1

export default function EreportingModal({ dossierId, dossier, confirmerDEmblee = false, onClose, onUpdated }: Props) {
  // Nul tant que la première lecture n'est pas revenue : la fenêtre ne montre alors que « Chargement… ».
  const [lu, setLu] = useState<LectureDeLEreporting | null>(null)
  const [erreurDeLecture, setErreurDeLecture] = useState<string | null>(null)
  const [objet, setObjet] = useState<ObjetEreporting>('achats')
  const [ouverte, setOuverte] = useState<LigneOuverte | null>(null)
  const [declaration, setDeclaration] = useState({ plateforme: '', note: '' })
  const [formulaireRegime, setFormulaireRegime] = useState<FormulaireRegime | null>(() =>
    confirmerDEmblee ? formulaireRegimeDuDossier(dossier) : null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // UN SEUL verrou pour les trois gestes : relâché après la relecture (voir l'en-tête).
  const verrou = useRef(false)

  // La lecture ne lève pas : une relecture ratée APRÈS une écriture ne doit pas faire dire que l'écriture a échoué.
  async function lire() {
    try {
      setLu(await lireLEreporting(dossierId))
      setErreurDeLecture(null)
    } catch (err) {
      setLu(null)
      setErreurDeLecture(raisonDeLecture(err))
    }
  }

  // La première lecture. Une fenêtre fermée avant la réponse ne l'écrit pas.
  useEffect(() => {
    let fermee = false
    lireLEreporting(dossierId).then(
      (r) => { if (!fermee) setLu(r) },
      (err) => { if (!fermee) setErreurDeLecture(raisonDeLecture(err)) },
    )
    return () => { fermee = true }
  }, [dossierId])

  const aujourdHui = aujourdHuiAParis()
  // Le dossier est recomposé à chaque rendu par l'appelant : l'objet que les calculs reçoivent est stable tant que ses
  // champs le sont.
  const { id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits } = dossier
  const dossierLu = useMemo<DossierEreporting>(
    () => ({ id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits }),
    [id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits],
  )
  const manques = lu ? lecturesManquantes(lu) : []
  const toutLu = lu !== null && manques.length === 0
  // Les lignes ne se calculent que sur des lectures TOUTES revenues entières.
  const lignes = useMemo(
    () => (lu && lecturesManquantes(lu).length === 0 ? lignesDeLEreporting(lu, dossierLu, aujourdHui) : null),
    [lu, dossierLu, aujourdHui],
  )
  // La ligne ouverte se retrouve par son IDENTITÉ sur la ligne relue : jamais sur celle qu'on a cliquée.
  const ligneOuverte = ouverte && lignes
    ? lignes[ouverte.objet].find((l) => l.periode.debut === ouverte.debut && l.periode.fin === ouverte.fin) ?? null
    : null

  async function confirmerLeRegime() {
    if (verrou.current || !toutLu || !lu || !formulaireRegime) return
    const saisie = saisieDuRegime(formulaireRegime)
    // Ce que la base refuserait a déjà grisé le bouton : un clic n'arrive ici que sur une saisie qu'elle accepterait.
    if (refusConfirmationRegime(saisie, { dossierId, regimes: lu.regimes.lignes, aujourdHui })) return
    const f = frequencesDuRegime(saisie.statut_tva as StatutTva, saisie.tva_periodicite as PeriodiciteTva | null, saisie.tva_sur_debits === true)
    if (!window.confirm(confirmationDuRegime(
      saisie,
      libelleDuRegime({ statut_tva: saisie.statut_tva as StatutTva, article_exoneration: saisie.article_exoneration as RegimeEreporting['article_exoneration'], frequence_transactions: f.transactions }),
      phraseDesFrequences({ frequence_transactions: f.transactions, frequence_paiements: f.paiements }),
    ))) return
    verrou.current = true
    setEnCours('regime')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('confirmer_regime_ereporting', argumentsDeLaConfirmation(dossierId, saisie))
      if (error) setErreur(messageErreur(error, 'Le régime n’a pas pu être confirmé.'))
      else {
        setMessage(`Régime confirmé à partir du ${formatDate(saisie.depuis)}.`)
        setFormulaireRegime(null)
      }
      // Dans tous les cas : un refus arrivé après le clic est une écriture concurrente, que la relecture montre.
      await lire()
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'Le régime n’a pas pu être confirmé.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  async function retirerLeRegime(regime: RegimeEreporting) {
    if (verrou.current || !toutLu || !lu) return
    if (refusRetraitRegime(regime)) return
    if (!window.confirm(confirmationDuRetraitDuRegime(regime, lu.declarations))) return
    verrou.current = true
    setEnCours(`retirer-${regime.id}`)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_regime_ereporting', argumentsDuRetraitDuRegime(dossierId, regime.id))
      if (error) setErreur(messageErreur(error, 'Le régime n’a pas pu être retiré.'))
      else setMessage(`Régime du ${formatDate(regime.depuis)} retiré : il reste dans l’historique, marqué retiré.`)
      await lire()
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'Le régime n’a pas pu être retiré.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  async function declarer() {
    if (verrou.current || !toutLu || !lu || !ligneOuverte) return
    const l = ligneOuverte
    const offre = offreDeDeclaration(l)
    if (offre.genre === 'aucune') return
    const saisie = saisieDeLaDeclaration(l, declaration)
    if (saisie == null || refusDeclaration(saisie, contexteDeLaDeclaration(lu, dossierId, aujourdHui))) return
    const remplace = l.active
    if (!window.confirm(confirmationDeLaDeclaration({
      objet: l.objet, periode: l.periode, plateforme: saisie.plateforme as string, contenu: l.calcul.contenu as NonNullable<typeof l.calcul.contenu>,
      remplace: offre.genre === 'rectificative' ? remplace : null,
    }))) return
    verrou.current = true
    setEnCours('declarer')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('declarer_ereporting_hors_application', argumentsDeLaDeclaration(dossierId, saisie))
      if (error) setErreur(messageErreur(error, 'La déclaration n’a pas pu être enregistrée.'))
      else {
        setMessage(`${offre.genre === 'rectificative' ? 'Rectificative' : 'Déclaration'} enregistrée : ${NOMS_DES_OBJETS[l.objet]}, ${l.periode.libelle}.`)
        setDeclaration({ plateforme: '', note: '' })
      }
      await lire()
    } catch (err) {
      setErreur(messageErreur(err, 'La déclaration n’a pas pu être enregistrée.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  function choisirLObjet(o: ObjetEreporting) {
    setObjet(o)
    setOuverte(null)
  }

  function ouvrir(l: LigneOuverte) {
    setOuverte((courante) => (courante && courante.objet === l.objet && courante.debut === l.debut && courante.fin === l.fin ? null : l))
    setDeclaration({ plateforme: '', note: '' })
    setErreur(null)
    setMessage(null)
  }

  // Les plateformes déjà nommées par une déclaration du dossier : une SUGGESTION de saisie, jamais appliquée seule.
  const plateformesConnues = lu ? [...new Set(lu.declarations.lignes.map((d) => d.plateforme))].sort() : []

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="titre-ereporting" style={{ width: 'min(900px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="titre-ereporting" style={{ marginTop: 0 }}>E-reporting du dossier</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Les achats à un fournisseur établi hors de France, les ventes à des particuliers et leurs paiements se déclarent à
          l’administration par la plateforme agréée du dossier, à partir des opérations du {formatDate(DEBUT_EREPORTING_PME)}. La
          période se dépose sur cette plateforme, hors de l’application, qui n’en transmet pas : ici, le cabinet inscrit ce qu’il
          a déclaré.
        </p>

        {erreurDeLecture ? (
          <p className="error-text">{erreurDeLecture} Rien n’est affirmé ni offert. Rouvre cette fenêtre.</p>
        ) : lu === null ? (
          <p className="muted">Chargement…</p>
        ) : manques.length > 0 ? (
          manques.map((m) => (
            <BandeauLecturePartielle key={m.quoi} quoi={m.quoi} motif={m.motif} accord={m.accord} consequence={CONSEQUENCE_D_UNE_LECTURE_PARTIELLE} />
          ))
        ) : lignes !== null && (
          <>
            <SectionRegime
              lu={lu} dossier={dossierLu} aujourdHui={aujourdHui} enCours={enCours} formulaire={formulaireRegime}
              setFormulaire={setFormulaireRegime} onConfirmer={confirmerLeRegime} onRetirer={retirerLeRegime}
            />

            <h3 style={{ marginBottom: 6 }}>Périodes et déclarations</h3>
            <div className="rangee-boutons" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
              {OBJETS_DE_LA_FENETRE.map((o) => {
                const aFaire = lignes[o].filter(ligneAFaire).length
                return (
                  <button
                    key={o} type="button" className={`btn btn-sm bouton-objet-ereporting ${objet === o ? 'btn-primary' : 'btn-outline'}`}
                    aria-pressed={objet === o} onClick={() => choisirLObjet(o)}
                  >
                    {NOMS_DES_OBJETS[o]}{aFaire > 0 ? ` · ${aFaire} à faire` : ''}
                  </button>
                )
              })}
            </div>

            {lignes[objet].length === 0 ? (
              <p className="muted">{phraseSansPeriode(objet, dossierLu, lu.regimes.lignes, aujourdHui)}</p>
            ) : (
              <div className="table-scroll tableau-adaptable">
                <table className="table-empilable-etroite" aria-label={`Périodes : ${NOMS_DES_OBJETS[objet]}`}>
                  <thead>
                    <tr><th>Période</th><th>Échéance</th><th>État</th><th /></tr>
                  </thead>
                  <tbody>
                    {lignes[objet].map((l) => {
                      const estOuverte = ouverte !== null && ouverte.objet === l.objet && ouverte.debut === l.periode.debut && ouverte.fin === l.periode.fin
                      return (
                        <tr key={`${l.periode.debut}|${l.periode.fin}`}>
                          <td data-libelle="Période">{l.periode.libelle}</td>
                          <td data-libelle="Échéance">{formatDate(l.periode.echeance)}</td>
                          <td data-libelle="État">
                            <div>
                              <span className={`badge ${CLASSE_TON[l.resume.ton]}`}>{l.resume.libelle}</span>
                              {l.resume.detail && <div className="cellule-declaration muted">{l.resume.detail}</div>}
                            </div>
                          </td>
                          <td data-libelle="Détail" className="td-actions">
                            <button
                              type="button" className="btn btn-outline btn-sm" aria-expanded={estOuverte}
                              onClick={() => ouvrir({ objet: l.objet, debut: l.periode.debut, fin: l.periode.fin })}
                            >
                              {estOuverte ? 'Fermer' : 'Détail'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {ligneOuverte && (
              <DetailDeLaLigne
                ligne={ligneOuverte} lu={lu} declaration={declaration} setDeclaration={setDeclaration}
                plateformesConnues={plateformesConnues} aujourdHui={aujourdHui} dossierId={dossierId} enCours={enCours}
                onDeclarer={declarer}
              />
            )}
          </>
        )}

        {message && <p className="muted" role="status">{message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours != null}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

/** Pourquoi un objet n'a aucune période à montrer. Dit après la lecture seulement. */
function phraseSansPeriode(objet: ObjetEreporting, dossier: DossierEreporting, regimes: readonly RegimeEreporting[], aujourdHui: string): string {
  if (aujourdHui < DEBUT_EREPORTING_PME) {
    return `Les déclarations commencent avec les opérations du ${formatDate(DEBUT_EREPORTING_PME)} (PME, micro-entreprise) : aucune période n’est encore à déclarer.`
  }
  const propose = regimeProposeDuDossier(dossier, null)
  if (regimes.every((r) => r.retire_le != null) && propose == null) {
    return 'Le statut de TVA du dossier est à préciser (onglet TVA) : sans lui, ni le rythme ni les périodes de ses déclarations ne se savent.'
  }
  if (objet === 'paiements' && (regimesActifs(regimes, dossier.id).at(-1)?.frequence_paiements ?? propose?.frequence_paiements) == null) {
    return 'Sur option pour la TVA sur les débits, le dossier n’a pas de données de paiement à déclarer.'
  }
  return 'Aucune période n’a encore commencé pour ce dossier.'
}

// ── Le régime ───────────────────────────────────────────────────────────────────────────────────────────────────────

function SectionRegime({ lu, dossier, aujourdHui, enCours, formulaire, setFormulaire, onConfirmer, onRetirer }: {
  lu: LectureDeLEreporting
  dossier: DossierEreporting
  aujourdHui: string
  enCours: string | null
  formulaire: FormulaireRegime | null
  setFormulaire: (f: FormulaireRegime | null) => void
  onConfirmer: () => void
  onRetirer: (r: RegimeEreporting) => void
}) {
  const etat = etatDuRegime(lu.regimes.lignes, dossier, aujourdHui)
  const historique = lu.regimes.lignes.filter((r) => r.dossier_id === dossier.id).sort(parDepuisDecroissant)
  const propose = regimeProposeDuDossier(dossier, null)
  const saisie = formulaire ? saisieDuRegime(formulaire) : null
  const refus = saisie ? refusConfirmationRegime(saisie, { dossierId: dossier.id, regimes: lu.regimes.lignes, aujourdHui }) : null
  const redevable = formulaire?.statut === 'redevable'
  const frequences = saisie?.statut_tva
    ? frequencesDuRegime(saisie.statut_tva as StatutTva, saisie.tva_periodicite as PeriodiciteTva | null, saisie.tva_sur_debits === true)
    : null
  const changer = (modif: Partial<FormulaireRegime>) => formulaire && setFormulaire({ ...formulaire, ...modif })

  return (
    <section aria-labelledby="titre-regime-ereporting">
      <h3 id="titre-regime-ereporting" style={{ marginBottom: 6 }}>Régime d’e-reporting</h3>
      {etat.etat === 'aucun' ? (
        <p>
          Aucun régime n’est confirmé pour ce dossier.
          {propose && (
            <> Sans régime confirmé, ses périodes se jugent sous le statut de TVA d’aujourd’hui — {libelleDuRegime({
              statut_tva: propose.statut_tva as StatutTva, article_exoneration: propose.article_exoneration as RegimeEreporting['article_exoneration'],
              frequence_transactions: propose.frequence_transactions as RegimeEreporting['frequence_transactions'],
            })} — , proposé, et ne se déclarent pas : le cabinet confirme le régime tel que le dossier l’a déclaré à sa plateforme.</>
          )}
        </p>
      ) : (
        <>
          <p>
            <strong>{libelleDuRegime(etat.regime)}</strong>, depuis le {formatDate(etat.regime.depuis)} : {phraseDesFrequences(etat.regime)}.
          </p>
          {etat.statutAPreciser && (
            <p className="muted">Le statut de TVA du dossier est à préciser (onglet TVA) : le régime confirmé n’a rien à qui se comparer.</p>
          )}
          {etat.aReconfirmer && (
            <p className="alerte-tva" style={{ margin: '0 0 10px' }}>
              Le statut de TVA du dossier (onglet TVA) n’est plus celui du régime confirmé à partir du {formatDate(etat.regime.depuis)} :
              le dossier a peut-être changé de régime. Confirmez le régime à partir du jour du changement — la date se saisit, elle n’est
              pas proposée —, ou corrigez le statut. Tant que ce n’est pas fait, les périodes concernées ne se déclarent pas.
            </p>
          )}
        </>
      )}

      {historique.length > 0 && (
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite" aria-label="Histoire des régimes d’e-reporting">
            <thead><tr><th>À partir du</th><th>Régime</th><th>Confirmé</th><th /></tr></thead>
            <tbody>
              {historique.map((r) => (
                <tr key={r.id}>
                  <td data-libelle="À partir du">{formatDate(r.depuis)}</td>
                  <td data-libelle="Régime">
                    {/* Un seul enfant : la cellule d'une fiche repliée est un `flex`, et chaque morceau de texte y serait une colonne. */}
                    <div>
                      {libelleDuRegime(r)}
                      <div className="cellule-declaration muted">{phraseDesFrequences(r)}</div>
                      {r.note && <div className="cellule-declaration note-declaration">{r.note}</div>}
                    </div>
                  </td>
                  <td data-libelle="Confirmé">
                    {r.retire_le != null
                      ? <span className="badge badge-neutral">Retiré le {formatDate(r.retire_le)}</span>
                      : <>le {formatDate(r.cree_le)}</>}
                  </td>
                  <td data-libelle="Retirer" className="td-actions">
                    {r.retire_le == null && (
                      <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => onRetirer(r)}>
                        {enCours === `retirer-${r.id}` ? 'Retrait…' : 'Retirer'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formulaire === null ? (
        <div className="rangee-boutons" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
          <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => setFormulaire(formulaireRegimeDuDossier(dossier))}>
            Confirmer un régime…
          </button>
        </div>
      ) : (
        <div className="etape-encaissement" style={{ marginTop: 10 }}>
          <h3>Confirmer un régime</h3>
          <p className="muted">
            Le régime tel que le dossier l’a déclaré à sa plateforme agréée, à partir du jour où il vaut. Le jour n’est jamais proposé :
            l’application ne sait pas quand le dossier a changé de régime. Un régime ne se modifie pas — une erreur se retire, puis un
            autre se confirme.
          </p>
          <div className="field">
            <label htmlFor="ereporting-depuis">À partir du</label>
            <input id="ereporting-depuis" type="date" value={formulaire.depuis} disabled={enCours != null} onChange={(e) => changer({ depuis: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ereporting-statut">Statut de TVA</label>
            <select id="ereporting-statut" value={formulaire.statut} disabled={enCours != null} onChange={(e) => changer({ statut: e.target.value as FormulaireRegime['statut'] })}>
              <option value="">— À choisir —</option>
              {STATUTS_TVA.map((s) => <option key={s.statut} value={s.statut}>{s.libelle}</option>)}
            </select>
          </div>
          {(formulaire.statut === 'exonere' || redevable) && (
            <div className="field">
              <label htmlFor="ereporting-article">{redevable ? 'Une partie de son activité est-elle exonérée ?' : 'Article de l’exonération'}</label>
              <select id="ereporting-article" value={formulaire.article} disabled={enCours != null} onChange={(e) => changer({ article: e.target.value })}>
                <option value="">{redevable ? 'Non — toute son activité est taxable' : 'Non précisé'}</option>
                {EXONERATIONS.filter((e) => (ARTICLES_D_EXONERATION as readonly string[]).includes(e.code)).map((e) => (
                  <option key={e.code} value={e.code}>{e.objet} ({e.reference})</option>
                ))}
              </select>
            </div>
          )}
          {redevable && (
            <>
              <div className="field">
                <label htmlFor="ereporting-periodicite">Périodicité de sa déclaration de TVA</label>
                <select id="ereporting-periodicite" value={formulaire.periodicite} disabled={enCours != null} onChange={(e) => changer({ periodicite: e.target.value as FormulaireRegime['periodicite'] })}>
                  <option value="">— À choisir —</option>
                  {PERIODICITES.map((p) => <option key={p} value={p}>{LIBELLES_DES_PERIODICITES[p]}</option>)}
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input type="checkbox" checked={formulaire.debits} disabled={enCours != null} onChange={(e) => changer({ debits: e.target.checked })} />
                  Le dossier a opté pour la TVA sur les débits
                </label>
              </div>
            </>
          )}
          {frequences && (
            <p className="muted">
              Sous ce régime, {phraseDesFrequences({ frequence_transactions: frequences.transactions, frequence_paiements: frequences.paiements })}.
            </p>
          )}
          <div className="field">
            <label htmlFor="ereporting-note-regime">Note (facultative)</label>
            <input id="ereporting-note-regime" value={formulaire.note} disabled={enCours != null} onChange={(e) => changer({ note: e.target.value })} />
          </div>
          {refus && <p className={refus.cle === 'depuis_absent' ? 'muted' : 'error-text'}>{refus.message}</p>}
          <div className="rangee-boutons">
            <button type="button" className="btn btn-outline" disabled={enCours != null} onClick={() => setFormulaire(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onConfirmer}>
              {enCours === 'regime' ? 'Confirmation…' : 'Confirmer le régime'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Le détail d'une période ─────────────────────────────────────────────────────────────────────────────────────────

function DetailDeLaLigne({ ligne, lu, declaration, setDeclaration, plateformesConnues, aujourdHui, dossierId, enCours, onDeclarer }: {
  ligne: LigneDePeriode
  lu: LectureDeLEreporting
  declaration: { plateforme: string; note: string }
  setDeclaration: (d: { plateforme: string; note: string }) => void
  plateformesConnues: string[]
  aujourdHui: string
  dossierId: string
  enCours: string | null
  onDeclarer: () => void
}) {
  const { objet, periode, calcul, active, etat, chaine } = ligne
  const offre = offreDeDeclaration(ligne)
  const saisie = offre.genre === 'aucune' ? null : saisieDeLaDeclaration(ligne, declaration)
  const refus = saisie ? refusDeclaration(saisie, contexteDeLaDeclaration(lu, dossierId, aujourdHui)) : null
  const tableau = calcul.contenu ? tableauDuContenu(objet, calcul.contenu, lu) : null
  const refusAffiches = calcul.refus.filter((r) => r.cle !== 'rien_a_declarer')
  const ecartees = ecarteesEnMots(calcul, lu)
  const refEtape = useRef<HTMLDivElement>(null)
  const cle = `${objet}|${periode.debut}|${periode.fin}`
  useEffect(() => { refEtape.current?.scrollIntoView?.({ block: 'nearest' }) }, [cle])

  return (
    <div className="etape-encaissement" style={{ marginTop: 12 }} ref={refEtape}>
      <h3>{NOMS_DES_OBJETS[objet]} — {periode.libelle}</h3>
      <p className="muted">
        Du {formatDate(periode.debut)} au {formatDate(periode.fin)}. Au plus tard le {formatDate(periode.echeance)}
        {periode.prudence ? ` (${periode.prudence})` : ''}.
      </p>
      <p>
        <span className={`badge ${CLASSE_TON[ligne.resume.ton]}`}>{ligne.resume.libelle}</span>{' '}
        {ligne.resume.detail}
      </p>

      {active && (
        <>
          <p>
            Déclarée le {formatDate(active.cree_le)} sur {active.plateforme} ({active.type_transmission === 'RE' ? 'rectificative' : 'initiale'}),{' '}
            {active.nb_operations} opération(s). Empreinte du contenu figé : <span className="nom-fichier">{active.empreinte.slice(0, 16)}…</span>
            {active.note && <> — <span className="note-declaration">{active.note}</span></>}
          </p>
          {etat && etat.etat === 'a_rectifier' && (
            <>
              <h4 style={{ margin: '8px 0 4px' }}>À rectifier</h4>
              <p className="muted" style={{ margin: '0 0 6px' }}>
                Une correction n’est jamais une opération de plus : la rectificative remplace la période ENTIÈRE.
              </p>
              <ul>
                {etat.causes.map((c) => <li key={`${c.cause}-${'pieceId' in c ? c.pieceId : c.regimeId}`}>{motsDeLaCause(c, lu)}</li>)}
                {etat.differences.map((d) => <li key={`${d.sorte}-${d.cle}`}>{motsDeLaDifference(d, objet, lu)}</li>)}
              </ul>
            </>
          )}
          {etat && etat.etat === 'indetermine' && etat.motifs.length > 0 && (
            <ul>{etat.motifs.map((m) => <li key={m}>{m}</li>)}</ul>
          )}
        </>
      )}

      {refusAffiches.length > 0 && (
        <>
          <h4 style={{ margin: '8px 0 4px' }}>Ce qui empêche, ou reste à trancher</h4>
          <ul>
            {refusAffiches.map((r, i) => {
              const sources = sourcesDuRefus(r, lu)
              return <li key={`${r.cle}-${i}`}>{r.message}{sources && <> <span className="muted">({sources})</span></>}</li>
            })}
          </ul>
        </>
      )}

      {tableau && tableau.lignes.length > 0 && (
        <>
          <h4 style={{ margin: '8px 0 4px' }}>Ce que l’application calcule aujourd’hui</h4>
          <p className="muted" style={{ margin: '0 0 6px' }}>{phraseDuContenu(objet, calcul.contenu as NonNullable<typeof calcul.contenu>)}.</p>
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable-etroite" aria-label={`Contenu : ${NOMS_DES_OBJETS[objet]}`}>
              <thead><tr>{tableau.colonnes.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {tableau.lignes.map((cellules, i) => (
                  <tr key={`${i}-${cellules.join('|')}`}>
                    {cellules.map((valeur, j) => <td key={tableau.colonnes[j]} data-libelle={tableau.colonnes[j]}>{valeur}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rangee-boutons" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
            <button
              type="button" className="btn btn-outline btn-sm"
              onClick={() => telechargerTexte(nomFichierDuDetail(objet, periode), csvDuDetail(objet, calcul.contenu as NonNullable<typeof calcul.contenu>, lu))}
            >
              Télécharger le détail (CSV)
            </button>
          </div>
        </>
      )}

      {ecartees.length > 0 && (
        <>
          <h4 style={{ margin: '8px 0 4px' }}>Ce qui n’y entre pas, ou pas en entier</h4>
          <ul>{ecartees.map((e) => <li key={e}>{e}</li>)}</ul>
        </>
      )}

      {chaine.length > 1 && (
        <>
          <h4 style={{ margin: '8px 0 4px' }}>Historique de la période</h4>
          <ul>
            {chaine.map((d) => (
              <li key={d.id}>
                {d.type_transmission === 'RE' ? 'Rectificative' : 'Initiale'} du {formatDate(d.cree_le)} sur {d.plateforme}, {d.nb_operations} opération(s)
                {d.etat === 'remplacee' ? ' — remplacée' : ' — active'}.
              </li>
            ))}
          </ul>
        </>
      )}

      {offre.genre !== 'aucune' && saisie !== null && (
        <div className="fiche-hdf-saisie">
          <h4 style={{ margin: '0 0 6px' }}>{offre.genre === 'rectificative' ? 'Déclarer la rectificative' : 'Déclarée sur la plateforme'}</h4>
          <p className="muted">
            {offre.genre === 'rectificative'
              ? 'La période entière se redépose sur la plateforme, hors de l’application ; ici, vous inscrivez que c’est fait. Elle remplace la déclaration active.'
              : 'La période se dépose sur la plateforme agréée du dossier, hors de l’application ; ici, vous inscrivez que c’est fait. Le contenu que l’application calcule aujourd’hui est gardé, figé.'}
          </p>
          <div className="field">
            <label htmlFor="ereporting-plateforme">Plateforme sur laquelle la période a été déclarée</label>
            <input
              id="ereporting-plateforme" list="ereporting-plateformes" value={declaration.plateforme} disabled={enCours != null}
              onChange={(e) => setDeclaration({ ...declaration, plateforme: e.target.value })}
            />
            <datalist id="ereporting-plateformes">{plateformesConnues.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="ereporting-note-declaration">Note (facultative)</label>
            <input
              id="ereporting-note-declaration" value={declaration.note} disabled={enCours != null}
              onChange={(e) => setDeclaration({ ...declaration, note: e.target.value })}
            />
          </div>
          {refus
            ? <p className={refus.cle === 'plateforme_absente' ? 'muted' : 'error-text'}>{refus.message}</p>
            : <p>{phraseDeCeQueLaDeclarationGarde(offre.genre, objet, periode.libelleDe, calcul.contenu as NonNullable<typeof calcul.contenu>)}</p>}
          <div className="rangee-boutons">
            <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onDeclarer}>
              {enCours === 'declarer' ? 'Enregistrement…' : offre.genre === 'rectificative' ? 'Déclarer la rectificative' : 'Déclarée sur la plateforme'}
            </button>
          </div>
        </div>
      )}
      {offre.genre === 'aucune' && offre.pourquoi && <p className="muted">{offre.pourquoi}</p>}
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
