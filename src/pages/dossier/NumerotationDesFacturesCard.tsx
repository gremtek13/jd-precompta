import { useEffect, useRef, useState } from 'react'
import { useAnnee } from '../../context/AnneeContext'
import { useAuth } from '../../context/AuthContext'
import { CARTE_DE_LA_NUMEROTATION_OFFERTE, NUMEROTATION_CONTINUE_PREVUE, numeroDuModele } from '../../lib/numerotationContinue'
import {
  EMPLACEMENTS, carteDesSeries, confirmationDeLaFin, confirmationDeLaPose, confirmationDesTrous, jugerLaFin, jugerLaPose,
  jugerLesTrous, titreDEmplacement, type SerieAffichee,
} from '../../lib/numerotationContinueCarte'
import {
  confirmerLaFin, leverLesTrous, lireLaNumerotation, poserLeModele, type Issue, type LectureDeLaNumerotation,
} from '../../lib/numerotationContinueLecture'

// LA CARTE « NUMÉROTATION DES FACTURES » DE L'ONGLET INFORMATIONS (ligne 51.5, étape A9b ; HISTORIQUE.md, « A9A : LA
// NUMÉROTATION QUI CONTINUE, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) » et « A9B : LA CARTE DE LA NUMÉROTATION, DERRIÈRE SON DRAPEAU »),
// derrière `CARTE_DE_LA_NUMEROTATION_OFFERTE` (la décision du cabinet) et `NUMEROTATION_CONTINUE_PREVUE` (la migration d'A9a,
// en base depuis le 10/11/2026) : l'un baissé, elle ne rend rien et ne lit rien.
// Elle dit, pour chaque série — les factures et les avoirs, du client et du cabinet mandataire —, le modèle en vigueur et un
// exemple de numéro, la fin confirmée de la suite reprise, les trous nommés et ceux qui ont été levés, avec leur motif ; et
// offre au chef du cabinet seul (A9A-Q2) de poser un modèle, de confirmer la fin d'une suite reprise (A9A-Q3) et de lever des
// trous. Ce qu'elle dit vient de lib/numerotationContinueCarte.ts, ce qu'elle lit de lib/numerotationContinueLecture.ts (qui ne
// rejette jamais) ; lue en partie, refusée ou rompue, elle le dit et n'offre AUCUN geste ; rien ne s'affirme avant le retour de
// la lecture. Chaque refus du module se dit avant le clic, sur la saisie telle qu'elle part ; chaque confirmation nomme ce qui
// se fige ; chaque geste passe la fonction SQL seule, sous un verrou relâché après la relecture. L'exercice est celui de
// l'en-tête (`useAnnee`) : la série d'un compteur annuel est celle de son année.

export default function NumerotationDesFacturesCard({ dossierId }: { dossierId: string }) {
  if (!NUMEROTATION_CONTINUE_PREVUE || !CARTE_DE_LA_NUMEROTATION_OFFERTE) return null
  return <CarteDeLaNumerotation dossierId={dossierId} />
}

const RIEN_NE_PART_REFUSE = 'Rien n’est écrit tant que la saisie est refusée.'

function CarteDeLaNumerotation({ dossierId }: { dossierId: string }) {
  const { estChef } = useAuth()
  const { annee: exercice } = useAnnee()
  // Un exercice précis : « toutes » et « sans date » n'ont pas de série à lire, et la base refuse une année hors de 2000 à 2099.
  const annee = typeof exercice === 'number' && exercice >= 2000 && exercice <= 2099 ? exercice : null

  const [lu, setLu] = useState<LectureDeLaNumerotation | null>(null)
  const [choix, setChoix] = useState(0)
  // La pose d'un modèle.
  const [modele, setModele] = useState('')
  const [annuel, setAnnuel] = useState(true)
  const [depuisSaisi, setDepuisSaisi] = useState<string | null>(null)
  const [premierPose, setPremierPose] = useState('1')
  // La fin confirmée.
  const [finDernier, setFinDernier] = useState('')
  const [finMotif, setFinMotif] = useState('')
  // Les trous levés.
  const [trousPremier, setTrousPremier] = useState('')
  const [trousDernier, setTrousDernier] = useState('')
  const [trousMotif, setTrousMotif] = useState('')
  const [enCours, setEnCours] = useState(false)
  // Ce que le dernier geste a dit, avec le dossier et l'exercice écrits : ailleurs, la carte n'en dit rien.
  const [avis, setAvis] = useState<{ dossierId: string; annee: number; erreur: string | null; fait: string | null } | null>(null)
  // Le verrou d'exécution des gestes, en `useRef` : `enCours` ne prend effet qu'au rendu suivant, et deux clics du même rendu
  // écriraient deux fois.
  const gesteEnCours = useRef(false)
  // Le dossier et l'exercice affichés : une relecture qui revient pour un autre ne remplace pas la sienne.
  const affiche = useRef({ dossierId, annee })

  useEffect(() => {
    affiche.current = { dossierId, annee }
    if (annee === null) return
    let annule = false
    void lireLaNumerotation(dossierId, annee).then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [dossierId, annee])

  // Une lecture d'un autre dossier ou d'un autre exercice n'est pas la sienne : « Chargement… » jusqu'à la bonne.
  const lecture = annee !== null && lu?.dossierId === dossierId && lu.annee === annee ? lu : null
  const erreur = avis && avis.dossierId === dossierId && avis.annee === annee ? avis.erreur : null
  const fait = avis && avis.dossierId === dossierId && avis.annee === annee ? avis.fait : null

  const emplacement = EMPLACEMENTS[choix]
  const series = lecture?.etat === 'lue' ? carteDesSeries(lecture.series, lecture.paroles, lecture.annee) : null
  const serieLue = lecture?.etat === 'lue' ? lecture.series[choix] : null

  // Les refus, jugés sur la saisie TELLE QU'ELLE PART, avant tout clic.
  const pose = lecture?.etat === 'lue' && annee !== null
    ? jugerLaPose(dossierId, emplacement, { modele, annuel, depuis: depuisSaisi ?? String(annee), premier: premierPose }, lecture.modeles)
    : null
  const fin = serieLue && annee !== null ? jugerLaFin(dossierId, annee, serieLue, { dernier: finDernier, motif: finMotif }) : null
  const trous = serieLue && annee !== null
    ? jugerLesTrous(dossierId, annee, serieLue, { premier: trousPremier, dernier: trousDernier, motif: trousMotif })
    : null

  async function agir(confirmation: string, appel: () => Promise<Issue>, phraseFaite: string, apresSucces: () => void) {
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du premier,
    // encore en cours.
    if (gesteEnCours.current || annee === null) return
    gesteEnCours.current = true
    const dossierEcrit = dossierId
    const anneeEcrite = annee
    try {
      if (!window.confirm(confirmation)) return
      setEnCours(true)
      setAvis(null)
      const issue = await appel()
      if (issue.ok) {
        apresSucces()
        setAvis({ dossierId: dossierEcrit, annee: anneeEcrite, erreur: null, fait: phraseFaite })
      } else {
        setAvis({ dossierId: dossierEcrit, annee: anneeEcrite, erreur: `Rien n’a changé : ${issue.message}`, fait: null })
      }
      // Relue, quoi qu'il arrive : la série, ses trous et son refus, tels que la base les voit maintenant.
      const relue = await lireLaNumerotation(dossierEcrit, anneeEcrite)
      if (affiche.current.dossierId === dossierEcrit && affiche.current.annee === anneeEcrite) setLu(relue)
    } finally {
      gesteEnCours.current = false
      setEnCours(false)
    }
  }

  function poser() {
    if (!pose || pose.refus !== null) return
    const parametres = pose.parametres
    void agir(confirmationDeLaPose(emplacement, parametres), () => poserLeModele(parametres),
      `Le modèle « ${parametres.p_modele} » est posé pour les séries ${titreDEmplacement(emplacement).toLowerCase()} ✓`,
      () => { setModele(''); setDepuisSaisi(null); setPremierPose('1') })
  }

  function confirmerLaFinDeLaSerie() {
    if (!fin || fin.refus !== null || !serieLue) return
    const parametres = fin.parametres
    void agir(confirmationDeLaFin(serieLue, parametres), () => confirmerLaFin(parametres),
      `La fin de la suite reprise est confirmée au numéro ${numeroDuModele(serieLue.modele, parametres.p_annee, parametres.p_dernier)} ✓`,
      () => { setFinDernier(''); setFinMotif('') })
  }

  function leverLesTrousDeLaSerie() {
    if (!trous || trous.refus !== null || !serieLue) return
    const parametres = trous.parametres
    void agir(confirmationDesTrous(serieLue, parametres), () => leverLesTrous(parametres), 'Les numéros qui manquaient sont levés ✓',
      () => { setTrousPremier(''); setTrousDernier(''); setTrousMotif('') })
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }} data-testid="numerotation-des-factures">
      <h3 style={{ marginTop: 0 }}>Numérotation des factures</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Une série par émetteur : celle du client (les factures qu’il valide) et celle du cabinet mandataire (celles que le cabinet
        valide en son nom, avec une racine propre : DGFiP, annexe 7, G1.45). Les factures et les avoirs d’un même émetteur
        partagent leur compteur sous un même modèle.
      </p>
      {annee === null && <p className="muted">Choisis un exercice dans l’en-tête : la numérotation se lit pour une année.</p>}
      {annee !== null && lecture === null && <p className="muted">Chargement…</p>}
      {lecture?.etat === 'illisible' && (
        <p className="error-text" role="alert">
          La numérotation n’a pas pu être lue en entier — {lecture.motif}. Aucun geste n’est offert tant qu’elle ne l’est pas.
        </p>
      )}
      {series && (
        <>
          <p className="muted">Exercice {lecture?.annee}.</p>
          {series.map((s) => <Serie key={`${s.nature}-${s.emetteur}`} serie={s} />)}
          {erreur && <p className="error-text">{erreur}</p>}
          {fait && <p className="muted">{fait}</p>}
          {!estChef && (
            <p className="muted">Seul le chef du cabinet pose le modèle de numéro, confirme la fin d’une suite reprise ou lève des trous.</p>
          )}
          {estChef && serieLue && annee !== null && pose && fin && trous && (
            <>
              <h4>Gestes du chef du cabinet</h4>
              <div className="field">
                <label htmlFor="numerotation-serie">Série</label>
                <select id="numerotation-serie" value={choix} disabled={enCours} onChange={(e) => setChoix(Number(e.target.value))}>
                  {EMPLACEMENTS.map((e, i) => <option key={`${e.nature}-${e.emetteur}`} value={i}>{titreDEmplacement(e)}</option>)}
                </select>
              </div>

              <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
                <legend><strong>Poser un modèle</strong></legend>
                <p className="muted" style={{ marginTop: 0 }}>
                  Le texte et deux jetons : {'{AAAA}'}, l’année de la date d’émission, et {'{N:k}'}, le compteur sur k chiffres au
                  moins. Il l’emporte, pour chaque année qu’il couvre, sur le modèle posé avant.
                </p>
                <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <div className="field">
                    <label htmlFor="numerotation-modele">Modèle</label>
                    <input id="numerotation-modele" value={modele} placeholder="F{AAAA}-{N:4}" disabled={enCours}
                      onChange={(e) => setModele(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="numerotation-depuis">À partir de l’année</label>
                    <input id="numerotation-depuis" inputMode="numeric" style={{ maxWidth: 110 }} disabled={enCours}
                      value={depuisSaisi ?? String(annee)} onChange={(e) => setDepuisSaisi(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="numerotation-premier">Premier numéro</label>
                    <input id="numerotation-premier" inputMode="numeric" style={{ maxWidth: 110 }} disabled={enCours}
                      value={premierPose} onChange={(e) => setPremierPose(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>
                    <input type="checkbox" checked={annuel} disabled={enCours} onChange={(e) => setAnnuel(e.target.checked)}
                      style={{ marginRight: 6 }} />
                    Le compteur repart de 1 chaque année
                  </label>
                </div>
                {modele !== '' && pose.refus !== null && <p className="muted" role="status">{pose.refus}</p>}
                {pose.refus === null && (
                  <p className="muted">
                    Exemple : {numeroDuModele(pose.parametres.p_modele, pose.parametres.p_depuis, pose.parametres.p_premier_numero)}
                  </p>
                )}
                <button type="button" className="btn btn-primary btn-sm" disabled={enCours || pose.refus !== null} onClick={poser}>
                  {enCours ? 'Enregistrement…' : 'Poser le modèle'}
                </button>
              </fieldset>

              <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
                <legend><strong>Confirmer la fin d’une suite reprise</strong></legend>
                <p className="muted" style={{ marginTop: 0 }}>
                  Le dernier numéro que l’ancien logiciel a émis dans la série : l’application la continue après lui, une fois ses
                  trous importés ou levés. Elle se confirme tant que l’application n’y a rien validé.
                </p>
                <div className="field">
                  <label htmlFor="numerotation-fin-dernier">Compteur du dernier numéro émis</label>
                  <input id="numerotation-fin-dernier" inputMode="numeric" style={{ maxWidth: 140 }} value={finDernier} disabled={enCours}
                    onChange={(e) => setFinDernier(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="numerotation-fin-motif">Motif (ce qui fonde le geste)</label>
                  <textarea id="numerotation-fin-motif" rows={2} value={finMotif} disabled={enCours}
                    onChange={(e) => setFinMotif(e.target.value)} />
                </div>
                {fin.refus !== null && (finDernier !== '' || finMotif !== '' || serieLue.valides > 0) && (
                  <p className="muted" role="status">{fin.refus}</p>
                )}
                <button type="button" className="btn btn-outline btn-sm" disabled={enCours || fin.refus !== null}
                  onClick={confirmerLaFinDeLaSerie}>
                  {enCours ? 'Enregistrement…' : 'Confirmer la fin'}
                </button>
              </fieldset>

              <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
                <legend><strong>Lever des trous</strong></legend>
                {serieLue.trous.length === 0 ? (
                  <p className="muted" style={{ marginTop: 0 }}>Cette série n’a aucun trou à lever.</p>
                ) : (
                  <>
                    <p className="muted" style={{ marginTop: 0 }}>
                      Un numéro qui manque — « annulé » dans l’ancien logiciel, ou émis là et non repris — se lève, motif écrit.
                      Compteurs qui manquent : {serieLue.trous.map(([a, b]) => (a === b ? String(a) : `${a} à ${b}`)).join(', ')}.
                    </p>
                    <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div className="field">
                        <label htmlFor="numerotation-trous-premier">Du compteur</label>
                        <input id="numerotation-trous-premier" inputMode="numeric" style={{ maxWidth: 110 }} value={trousPremier}
                          disabled={enCours} onChange={(e) => setTrousPremier(e.target.value)} />
                      </div>
                      <div className="field">
                        <label htmlFor="numerotation-trous-dernier">Au compteur</label>
                        <input id="numerotation-trous-dernier" inputMode="numeric" style={{ maxWidth: 110 }} value={trousDernier}
                          disabled={enCours} onChange={(e) => setTrousDernier(e.target.value)} />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="numerotation-trous-motif">Motif (ce qui fonde le geste)</label>
                      <textarea id="numerotation-trous-motif" rows={2} value={trousMotif} disabled={enCours}
                        onChange={(e) => setTrousMotif(e.target.value)} />
                    </div>
                    {trous.refus !== null && (trousPremier !== '' || trousDernier !== '' || trousMotif !== '') && (
                      <p className="muted" role="status">{trous.refus}</p>
                    )}
                    <button type="button" className="btn btn-outline btn-sm" disabled={enCours || trous.refus !== null}
                      onClick={leverLesTrousDeLaSerie}>
                      {enCours ? 'Enregistrement…' : 'Lever ces trous'}
                    </button>
                  </>
                )}
              </fieldset>
              <p className="muted">{RIEN_NE_PART_REFUSE} Un modèle posé, une fin confirmée et un trou levé ne se retirent jamais.</p>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Serie({ serie }: { serie: SerieAffichee }) {
  return (
    <div style={{ marginBottom: 14, overflowWrap: 'anywhere' }} data-testid={`serie-${serie.nature}-${serie.emetteur}`}>
      <h4 style={{ margin: '8px 0 4px' }}>{serie.titre}</h4>
      <p style={{ margin: '0 0 4px' }}>
        Modèle <code>{serie.modele}</code>
        <span className="muted">
          {' '}— {serie.parDefaut ? 'celui par défaut' : `posé, à partir de ${serie.depuis}`} ; {serie.compteur}. Exemple : {serie.exemple}.
        </span>
      </p>
      {serie.reprise && <p className="muted" style={{ margin: '0 0 4px' }}>{serie.reprise}</p>}
      {serie.fin && (
        <p className="muted" style={{ margin: '0 0 4px' }}>
          Fin de la suite reprise confirmée : {serie.fin.numeros} (le {serie.fin.le}) — {serie.fin.motif}
        </p>
      )}
      {serie.trous.length > 0 && (
        <p className="muted" style={{ margin: '0 0 4px' }}>
          Trous : {serie.trous.join(', ')}{serie.trousDePlus > 0 ? ` — et ${serie.trousDePlus} de plus` : ''}.
        </p>
      )}
      {serie.leves.length > 0 && (
        <>
          <p className="muted" style={{ margin: '0 0 2px' }}>Trous levés :</p>
          <ul className="muted" style={{ margin: '0 0 4px', paddingLeft: 20 }}>
            {serie.leves.map((l) => <li key={l.id}>{l.numeros} (le {l.le}) — {l.motif}</li>)}
          </ul>
        </>
      )}
      {serie.refus && <p className="note-info" style={{ margin: '4px 0' }}>Retient la prochaine validation : {serie.refus}</p>}
      {serie.prochain && <p className="muted" style={{ margin: '0 0 4px' }}>Prochain numéro : {serie.prochain}.</p>}
    </div>
  )
}
