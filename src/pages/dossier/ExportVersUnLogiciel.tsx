import { useMemo, useRef, useState } from 'react'
import type { NumerotationFec } from '../../lib/fec'
import {
  FORMES_DES_TIERS, justificatifsDeLExport, journauxDuFec, LONGUEUR_DES_COMPTES_MAX, LONGUEUR_DES_COMPTES_MIN,
  mettreEnFormePourAcd, nomDeLArchive, PROFILS_D_EXPORT, QUATRE_CHAMPS_DANS_L_EXPORT, REGLAGES_PROPOSES_ACD,
  type ExportMisEnForme, type PieceDesJustificatifs, type PoidsInconnu, type ProfilDExport, type QuatreChampsDansLExport,
} from '../../lib/profilsDExport'
import {
  JOURNAUX_DE_L_APPLICATION, memesReglages, phraseDeLEnregistrement, phraseDesReglagesGardes, profilDeLaSaisie,
  REGLAGES_D_EXPORT_PREVUS, refusDeLEnregistrement, RIEN_A_ENREGISTRER, SAISIE_A_SAISIR, saisieDesReglagesGardes,
  type JournalDeLApplication, type LectureDesReglagesDExport, type SaisieDesReglages,
} from '../../lib/reglagesDExport'
import { enregistrerLesReglagesDExport, lireLesReglagesDExport } from '../../lib/reglagesDExportLecture'
import { fabriquerLArchive, mesurerLesJustificatifs, type PoidsDesJustificatifs } from '../../lib/exportVersUnLogicielLecture'
import { messageErreur } from '../../lib/messageErreur'

// « EXPORTER VERS UN LOGICIEL COMPTABLE » (EXP1, demande du cabinet du 17/11/2026), à côté du FEC dans l'onglet Écritures —
// un onglet du cabinet, que l'espace client ne monte jamais — et derrière `EXPORT_VERS_UN_LOGICIEL_OFFERT`. Le fichier part
// du FEC que « Exporter FEC » télécharge (`fec`, calculé à l'ouverture) ; le profil le met en forme (lib/profilsDExport.ts)
// et l'écran dit, AVANT le clic, les comptes et les journaux tels qu'ils partiront, ce qui se refuse, combien de
// justificatifs partent et pèsent combien. L'exercice entier, comme le FEC (EXP-Q3, pour le MVP).
//
// LES RÉGLAGES GARDÉS DU DOSSIER (EXP-Q4 (A), derrière `REGLAGES_D_EXPORT_PREVUS`) : baissé, l'écran est celui d'hier — les
// réglages proposés (`REGLAGES_PROPOSES_ACD`), ressaisis à chaque export. Levé, l'ouverture LIT les réglages que le dossier
// garde pour le logiciel (lib/reglagesDExportLecture.ts), « Lecture… » tant qu'ils ne sont pas revenus ; lus, ils
// préremplissent le formulaire, et ce qui manque reste « à saisir » — aucune valeur par défaut, ni huit chiffres, ni nos codes
// de journaux — ; l'export se refuse alors en nommant ce qui manque (`profilDeLaSaisie`). « Enregistrer ces réglages » écrit
// la saisie d'un seul geste contre la version lue (`enregistrer_reglages_d_export`), son refus dit avant le clic sous les mots
// de la base (`refusDeLEnregistrement`), puis relit. Une lecture ratée ou partielle ne préremplit rien, le dit, et n'offre pas
// l'enregistrement : l'export à la main reste possible, les réglages saisis ici.
//
// Verrous `useRef` posés avant le `try`, relâchés dans le `finally` (après la relecture pour l'enregistrement) : deux clics ne
// font qu'un export, qu'un enregistrement.

type EtatDeLaLecture = { etat: 'en_cours' } | LectureDesReglagesDExport

export default function ExportVersUnLogiciel({ dossierId, nomDuFec, fec, pieces, indisponible }: {
  dossierId: string
  /** `<SIREN>FEC<AAAAMMJJ>.txt`, comme le FEC (`nomFichierFec`). */
  nomDuFec: string
  /** Le FEC de l'exercice tel que « Exporter FEC » le télécharge, et sa numérotation ; nul s'il ne peut pas se calculer. */
  fec: () => { contenu: string; numerotation: NumerotationFec } | null
  /** Les pièces que l'onglet a lues : le chemin de leur fichier, jamais leur nom. */
  pieces: readonly PieceDesJustificatifs[]
  /** Pourquoi le FEC ne peut pas encore se calculer (une lecture partielle de l'onglet), ou nul. */
  indisponible: string | null
}) {
  const exportEnCours = useRef(false)
  const enregistrementEnCours = useRef(false)
  const lectureDemandee = useRef(0)
  const [ouvert, setOuvert] = useState(false)
  const [instantane, setInstantane] = useState<{ contenu: string; numerotation: NumerotationFec } | null>(null)
  const [profil, setProfil] = useState<ProfilDExport>('acd')
  // Le drapeau baissé : les réglages proposés, ressaisis à chaque export (l'écran d'hier).
  const [longueur, setLongueur] = useState(String(REGLAGES_PROPOSES_ACD.longueurDesComptes))
  const [journaux, setJournaux] = useState<Record<string, string>>({})
  // Le drapeau levé : la saisie des réglages du dossier, préremplie de ceux qu'il garde.
  const [lecture, setLecture] = useState<EtatDeLaLecture | null>(null)
  const [saisie, setSaisie] = useState<SaisieDesReglages>(SAISIE_A_SAISIR)
  const [enregistrement, setEnregistrement] = useState<{ enCours: boolean; fait: string | null; erreur: string | null }>(
    { enCours: false, fait: null, erreur: null })
  const [quatreChamps, setQuatreChamps] = useState<QuatreChampsDansLExport>(REGLAGES_PROPOSES_ACD.quatreChamps)
  const [sansANouveaux, setSansANouveaux] = useState(REGLAGES_PROPOSES_ACD.sansANouveaux)
  const [avecJustificatifs, setAvecJustificatifs] = useState(false)
  const [poids, setPoids] = useState<PoidsDesJustificatifs | PoidsInconnu>('a_mesurer')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState<string | null>(null)

  /** Les réglages gardés, relus ; la saisie préremplie d'eux seulement si on le demande. Une réponse dépassée n'écrit rien. */
  async function lireLesReglages(logiciel: ProfilDExport, preremplir: (lu: LectureDesReglagesDExport) => boolean) {
    const demande = ++lectureDemandee.current
    const lu = await lireLesReglagesDExport(dossierId, logiciel)
    if (demande !== lectureDemandee.current) return
    setLecture(lu)
    if (preremplir(lu)) setSaisie(lu.etat === 'lus' ? saisieDesReglagesGardes(lu.gardes) : SAISIE_A_SAISIR)
  }

  function ouvrir() {
    if (ouvert) { setOuvert(false); return }
    setErreur(null)
    setFait(null)
    const calcule = fec()
    if (calcule === null) { setErreur('Le FEC de l’exercice ne peut pas encore se calculer : rien ne peut partir.'); return }
    setInstantane(calcule)
    setAvecJustificatifs(false)
    setPoids('a_mesurer')
    setOuvert(true)
    if (REGLAGES_D_EXPORT_PREVUS) {
      setLecture({ etat: 'en_cours' })
      setSaisie(SAISIE_A_SAISIR)
      setEnregistrement({ enCours: false, fait: null, erreur: null })
      void lireLesReglages(profil, () => true)
    }
  }

  const codes = useMemo(() => instantane === null ? [] : journauxDuFec(instantane.contenu), [instantane])
  const reglagesALaMain = useMemo(() => ({
    longueurDesComptes: Number(longueur), journaux, quatreChamps, sansANouveaux, formeDesTiers: REGLAGES_PROPOSES_ACD.formeDesTiers,
  }), [longueur, journaux, quatreChamps, sansANouveaux])
  const profilGarde = useMemo(
    () => profilDeLaSaisie(saisie, codes.map((c) => c.code), { quatreChamps, sansANouveaux }),
    [saisie, codes, quatreChamps, sansANouveaux],
  )
  const misEnForme = useMemo((): ExportMisEnForme | null => {
    if (instantane === null) return null
    if (!REGLAGES_D_EXPORT_PREVUS) return mettreEnFormePourAcd(instantane.contenu, reglagesALaMain)
    if (lecture === null || lecture.etat === 'en_cours') return null
    return profilGarde.ok ? mettreEnFormePourAcd(instantane.contenu, profilGarde.reglages) : { ok: false, refus: profilGarde.aSaisir }
  }, [instantane, reglagesALaMain, lecture, profilGarde])
  const justificatifs = useMemo(
    () => instantane === null || misEnForme === null || !misEnForme.ok ? null
      : justificatifsDeLExport(dossierId, instantane.numerotation, pieces, misEnForme.numeros),
    [dossierId, instantane, misEnForme, pieces],
  )

  const lus = lecture !== null && lecture.etat === 'lus' ? lecture : null
  const refusDeLaSaisie = refusDeLEnregistrement(saisie)
  const rienAEnregistrer = lus !== null && memesReglages(saisie, lus.gardes)

  function changerLaSaisie(changement: (s: SaisieDesReglages) => SaisieDesReglages) {
    setSaisie(changement)
    setEnregistrement((e) => ({ ...e, fait: null, erreur: null }))
  }

  async function enregistrerLesReglages() {
    if (enregistrementEnCours.current || lus === null || refusDeLaSaisie !== null || rienAEnregistrer) return
    enregistrementEnCours.current = true
    const versionLue = lus.gardes?.version ?? null
    setEnregistrement({ enCours: true, fait: null, erreur: null })
    try {
      const issue = await enregistrerLesReglagesDExport(dossierId, profil, saisie, versionLue)
      setEnregistrement({ enCours: true, fait: issue.ok ? phraseDeLEnregistrement(issue.version) : null, erreur: issue.ok ? null : issue.erreur })
      // La liste relue : la saisie se recale sur ce que la base garde quand la ligne a changé — l'écriture faite, ou celle d'un
      // autre compte qui l'a précédée (la version refusée) ; un échec qui n'a rien changé garde ce qui est tapé.
      await lireLesReglages(profil, (lu) => lu.etat === 'lus' && (lu.gardes?.version ?? null) !== versionLue)
    } catch (e) {
      setEnregistrement({ enCours: true, fait: null, erreur: messageErreur(e, 'l’enregistrement a été interrompu.') })
    } finally {
      enregistrementEnCours.current = false
      setEnregistrement((e) => ({ ...e, enCours: false }))
    }
  }

  async function cocherLesJustificatifs(coche: boolean) {
    setAvecJustificatifs(coche)
    if (!coche || justificatifs === null) return
    setPoids('en_cours')
    setPoids(await mesurerLesJustificatifs(dossierId, justificatifs.aJoindre))
  }

  async function exporter() {
    if (exportEnCours.current || instantane === null || misEnForme === null || !misEnForme.ok) return
    exportEnCours.current = true
    setErreur(null)
    setFait(null)
    setEnCours(true)
    try {
      // Les écritures ont-elles bougé depuis l'aperçu ? Le fichier ne part que tel que l'écran l'a montré.
      const maintenant = fec()
      if (maintenant === null || maintenant.contenu !== instantane.contenu) {
        if (maintenant !== null) setInstantane(maintenant)
        setErreur('Les écritures ont changé depuis l’aperçu : relis-le, puis relance l’export.')
        return
      }
      if (!avecJustificatifs) {
        await telecharger(nomDuFec, misEnForme.octets, 'text/plain;charset=windows-1252')
        setFait(`Fichier téléchargé : ${misEnForme.ecritures} écriture(s), ${misEnForme.lignes} ligne(s), en Windows-1252.`)
        return
      }
      if (justificatifs === null) return
      const issue = await fabriquerLArchive(dossierId, { nom: nomDuFec, octets: misEnForme.octets }, justificatifs.aJoindre, new Date())
      if (!issue.ok) { setErreur(issue.message); return }
      await telecharger(nomDeLArchive(nomDuFec), issue.bilan.zip, 'application/zip')
      const manquants = issue.bilan.manquants.length + justificatifs.ecartes.length
      setFait(`Archive téléchargée : le fichier d’écritures et ${issue.bilan.joints} justificatif(s)`
        + (manquants > 0 ? ` — ${manquants} justificatif(s) n’y sont PAS : ${[...justificatifs.ecartes, ...issue.bilan.manquants].join(' ')}` : '.'))
    } catch (e) {
      setErreur(`Rien n’est parti : ${messageErreur(e, 'l’export a été interrompu.')}`)
    } finally {
      exportEnCours.current = false
      setEnCours(false)
    }
  }

  const enLecture = REGLAGES_D_EXPORT_PREVUS && (lecture === null || lecture.etat === 'en_cours')

  return (
    <>
      <button
        className="btn btn-outline btn-sm"
        disabled={indisponible !== null}
        title={indisponible ?? 'Le FEC de l’exercice mis en forme pour le logiciel de l’expert-comptable, avec ou sans les justificatifs.'}
        onClick={ouvrir}
        aria-expanded={ouvert}
      >
        Exporter vers un logiciel comptable
      </button>
      {erreur && <p className="error-text" role="alert" style={{ flexBasis: '100%' }}>{erreur}</p>}
      {ouvert && instantane !== null && enLecture && (
        <div className="card" style={{ flexBasis: '100%', textAlign: 'left' }} aria-label="Export vers un logiciel comptable">
          <p className="muted" role="status">Lecture des réglages que le dossier garde pour ce logiciel…</p>
        </div>
      )}
      {ouvert && instantane !== null && misEnForme !== null && (
        <div className="card" style={{ flexBasis: '100%', textAlign: 'left' }} aria-label="Export vers un logiciel comptable">
          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 12 }}>
            <label className="field">
              <span>Logiciel</span>
              <select value={profil} onChange={(e) => {
                const logiciel = e.target.value as ProfilDExport
                setProfil(logiciel)
                // Les réglages gardés sont ceux d'UN logiciel : un autre se relit, sa saisie repart de ce qu'il garde.
                if (REGLAGES_D_EXPORT_PREVUS) {
                  setLecture({ etat: 'en_cours' })
                  setSaisie(SAISIE_A_SAISIR)
                  setEnregistrement({ enCours: false, fait: null, erreur: null })
                  void lireLesReglages(logiciel, () => true)
                }
              }}>
                {PROFILS_D_EXPORT.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
              </select>
            </label>
            {REGLAGES_D_EXPORT_PREVUS ? (
              <label className="field">
                <span>Longueur des comptes ({LONGUEUR_DES_COMPTES_MIN} à {LONGUEUR_DES_COMPTES_MAX})</span>
                <input type="number" min={LONGUEUR_DES_COMPTES_MIN} max={LONGUEUR_DES_COMPTES_MAX} value={saisie.longueurDesComptes}
                  placeholder="à saisir" onChange={(e) => { const v = e.target.value; changerLaSaisie((s) => ({ ...s, longueurDesComptes: v })) }} />
              </label>
            ) : (
              <label className="field">
                <span>Longueur des comptes ({LONGUEUR_DES_COMPTES_MIN} à {LONGUEUR_DES_COMPTES_MAX})</span>
                <input type="number" min={LONGUEUR_DES_COMPTES_MIN} max={LONGUEUR_DES_COMPTES_MAX} value={longueur}
                  onChange={(e) => setLongueur(e.target.value)} />
              </label>
            )}
          </div>
          {REGLAGES_D_EXPORT_PREVUS ? (
            <>
              {lecture !== null && lecture.etat !== 'en_cours' && <p className="muted" role="note">{phraseDesReglagesGardes(lecture)}</p>}
              <p className="muted">La longueur des comptes est celle du dossier chez l’expert-comptable : le nombre de chiffres des comptes de son FEC.</p>
            </>
          ) : (
            <p className="muted">Huit caractères sont proposés, comme le FEC qu’ACD produit pour un BNC : règle-les sur ceux du dossier chez l’expert-comptable.</p>
          )}

          <fieldset>
            <legend>Les journaux (nos codes → ceux du logiciel)</legend>
            <div className="field-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              {codes.map(({ code, libelle }) => REGLAGES_D_EXPORT_PREVUS ? (
                JOURNAUX_DE_L_APPLICATION.some((j) => j.code === code) && (
                  <label key={code} className="field">
                    <span>{code} — {libelle}</span>
                    <input value={saisie.journaux[code as JournalDeLApplication]} placeholder="à saisir"
                      aria-label={`Code du journal ${code} dans le logiciel`}
                      onChange={(e) => { const v = e.target.value; changerLaSaisie((s) => ({ ...s, journaux: { ...s.journaux, [code]: v } })) }} />
                  </label>
                )
              ) : (
                <label key={code} className="field">
                  <span>{code} — {libelle}</span>
                  <input value={journaux[code] ?? code} aria-label={`Code du journal ${code} dans le logiciel`}
                    onChange={(e) => setJournaux((j) => ({ ...j, [code]: e.target.value }))} />
                </label>
              ))}
            </div>
          </fieldset>

          {REGLAGES_D_EXPORT_PREVUS && (
            <fieldset>
              <legend>Les comptes de tiers{saisie.formeDesTiers === null ? ' — à saisir' : ''}</legend>
              {FORMES_DES_TIERS.map((f) => (
                <label key={f.id} style={{ display: 'block' }}>
                  <input type="radio" name="forme-des-tiers" checked={saisie.formeDesTiers === f.id}
                    onChange={() => changerLaSaisie((s) => ({ ...s, formeDesTiers: f.id }))} /> {f.libelle}
                </label>
              ))}
            </fieldset>
          )}

          {REGLAGES_D_EXPORT_PREVUS && lus !== null && (
            <div>
              <button className="btn btn-outline btn-sm" disabled={enregistrement.enCours || refusDeLaSaisie !== null || rienAEnregistrer}
                onClick={() => { void enregistrerLesReglages() }}>
                {enregistrement.enCours ? 'Enregistrement…' : 'Enregistrer ces réglages'}
              </button>
              {refusDeLaSaisie !== null && <p className="error-text">{refusDeLaSaisie}</p>}
              {refusDeLaSaisie === null && rienAEnregistrer && <p className="muted">{RIEN_A_ENREGISTRER}</p>}
              {enregistrement.erreur && <p className="error-text" role="alert">{enregistrement.erreur}</p>}
              {enregistrement.fait && <p className="muted" role="status">{enregistrement.fait}</p>}
            </div>
          )}

          {misEnForme.ok && misEnForme.vingtDeux && (
            <fieldset>
              <legend>DateRglt, ModeRglt, NatOp et IdClient</legend>
              {QUATRE_CHAMPS_DANS_L_EXPORT.map((o) => (
                <label key={o.id} style={{ display: 'block' }}>
                  <input type="radio" name="quatre-champs" checked={quatreChamps === o.id} onChange={() => setQuatreChamps(o.id)} /> {o.libelle}
                </label>
              ))}
              <p className="muted">ModeRglt reste en toutes lettres : la table des lettres d’ACD n’est pas publiée, elle ne se devine pas.</p>
            </fieldset>
          )}

          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={sansANouveaux} onChange={(e) => setSansANouveaux(e.target.checked)} /> Sans le journal des à-nouveaux
          </label>
          <label style={{ display: 'block' }}>
            <input type="checkbox" checked={avecJustificatifs} onChange={(e) => { void cocherLesJustificatifs(e.target.checked) }} /> Avec les justificatifs (une archive ZIP)
          </label>

          <p role="note">Un fichier importé deux fois double les écritures dans le logiciel : il ne détecte pas les doublons.</p>
          <p role="note">Les à-nouveaux du fichier peuvent doubler ceux que le logiciel tient déjà : coche « Sans le journal des à-nouveaux » s’il les a.</p>

          {!misEnForme.ok ? (
            <div role="alert">
              <p className="error-text">Rien ne peut partir :</p>
              <ul>{misEnForme.refus.map((r) => <li key={r} className="error-text">{r}</li>)}</ul>
            </div>
          ) : (
            <>
              <p>{misEnForme.ecritures} écriture(s), {misEnForme.lignes} ligne(s), {misEnForme.vingtDeux ? 'vingt-deux' : 'dix-huit'} colonnes, en Windows-1252.</p>
              <div className="table-scroll">
                <table>
                  <caption>Les journaux tels qu’ils partiront</caption>
                  <thead><tr><th>Dans l’application</th><th>Dans le fichier</th><th>Libellé</th></tr></thead>
                  <tbody>{misEnForme.journaux.map((j) => <tr key={j.nous}><td>{j.nous}</td><td>{j.eux}</td><td>{j.libelle}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="table-scroll">
                <table>
                  <caption>Les comptes tels qu’ils partiront</caption>
                  <thead><tr><th>Dans l’application</th><th>Dans le fichier</th></tr></thead>
                  <tbody>{misEnForme.comptes.map((c) => <tr key={c.nous}><td>{c.nous}</td><td>{c.eux}</td></tr>)}</tbody>
                </table>
              </div>
              {avecJustificatifs && justificatifs !== null && (
                <div>
                  <p>
                    {justificatifs.aJoindre.length} justificatif(s) partent, chacun sous la référence de sa pièce ;
                    {' '}{justificatifs.ecrituresSansJustificatif} écriture(s) n’en ont pas (le relevé, la caisse, une dotation…) ;
                    {' '}{phraseDuPoids(poids)}
                  </p>
                  {justificatifs.ecartes.length > 0 && (
                    <ul>{justificatifs.ecartes.map((e) => <li key={e}>{e}</li>)}</ul>
                  )}
                </div>
              )}
            </>
          )}

          <button className="btn btn-primary btn-sm" disabled={enCours || !misEnForme.ok || (avecJustificatifs && poids === 'en_cours')} onClick={exporter}>
            {enCours ? 'Export…' : avecJustificatifs ? 'Télécharger l’archive' : 'Télécharger le fichier'}
          </button>
        </div>
      )}
      {fait && <p className="muted" role="status" style={{ flexBasis: '100%' }}>{fait}</p>}
    </>
  )
}

function phraseDuPoids(poids: PoidsDesJustificatifs | PoidsInconnu): string {
  if (poids === 'a_mesurer' || poids === 'en_cours') return 'poids en cours de mesure.'
  const mio = (poids.octets / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  return `${mio} Mio${poids.inconnus > 0 ? `, plus ${poids.inconnus} fichier(s) de taille inconnue` : ''}.`
}

// Le fichier remis au navigateur est d'abord RELU, octet par octet, contre ce que l'aperçu a mis en forme : un Blob tronqué
// ou réencodé ne part pas. C'est aussi ce qui fait de l'export un geste asynchrone, que le verrou tient jusqu'au bout.
async function telecharger(nomFichier: string, octets: Uint8Array, type: string) {
  const blob = new Blob([octets as Uint8Array<ArrayBuffer>], { type })
  const relu = new Uint8Array(await blob.arrayBuffer())
  if (relu.length !== octets.length || relu.some((o, i) => o !== octets[i])) {
    throw new RangeError('le fichier remis au navigateur ne relit pas ce que l’aperçu a mis en forme.')
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomFichier
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
