import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { NumerotationFec } from '../../lib/fec'
import {
  FORMES_DES_TIERS, justificatifsDeLExport, journauxDuFec, LONGUEUR_DES_COMPTES_MAX, LONGUEUR_DES_COMPTES_MIN,
  mettreEnFormePourAcd, nomDeLArchive, PROFILS_D_EXPORT, QUATRE_CHAMPS_DANS_L_EXPORT, REGLAGES_PROPOSES_ACD,
  type ExportMisEnForme, type PieceDesJustificatifs, type PoidsInconnu, type ProfilDExport, type QuatreChampsDansLExport,
} from '../../lib/profilsDExport'
import {
  JOURNAUX_DE_L_APPLICATION, memesReglages, phraseDeLEnregistrement, phraseDesReglagesGardes, profilDeLaSaisie,
  REGLAGES_D_EXPORT_PREVUS, phraseDeRienAEnregistrer, refusDeLEnregistrement, SAISIE_A_SAISIR, saisieDesReglagesGardes,
  type JournalDeLApplication, type LectureDesReglagesDExport, type SaisieDesReglages,
} from '../../lib/reglagesDExport'
import { enregistrerLesReglagesDExport, lireLesReglagesDExport } from '../../lib/reglagesDExportLecture'
import {
  fabriquerLArchive, fabriquerLArchiveNommee, mesurerLesJustificatifs, type PoidsDesJustificatifs,
} from '../../lib/exportVersUnLogicielLecture'
import {
  ENCODAGES_QUADRA, FINS_D_ENREGISTREMENT_QUADRA, justificatifsDeLExportQuadra, LONGUEUR_DES_COMPTES_QUADRA_MAX,
  LONGUEUR_DES_COMPTES_QUADRA_MIN, mettreEnFormePourQuadra, nomDuFichierQuadra, nomDuJustificatifQuadra, PROFIL_QUADRA,
  PROFIL_QUADRA_OFFERT, type EncodageQuadra, type FinDEnregistrementQuadra,
} from '../../lib/profilQuadra'
import {
  ENCODAGES_TRA, FINS_D_ENREGISTREMENT_TRA, JOURNAL_TRA_A_SAISIR, LONGUEUR_DES_COMPTES_TRA_MAX, LONGUEUR_DES_COMPTES_TRA_MIN,
  mettreEnFormePourTra, NATURES_A_CONTREPARTIE, NATURES_DE_JOURNAL_TRA, nomDeLArchiveTra, nomDuFichierTra, nomDuJustificatifTra,
  NOUVELLES_ANALYTIQUES_TRA, NUMEROS_DE_PIECE_TRA, ORIGINES_TRA, PRODUITS_TRA, PROFIL_TRA, PROFIL_TRA_OFFERT, TYPES_DE_PIECE_TRA,
  type EncodageTra, type FinDEnregistrementTra, type JournalTra, type NouvelleAnalytiqueTra,
  type NumeroDePieceTra, type OrigineTra, type ProduitTra,
} from '../../lib/profilTra'
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
// LE PROFIL CEGID QUADRA (EXP3, lib/profilQuadra.ts), derrière `PROFIL_QUADRA_OFFERT` BAISSÉ : levé, le choix du logiciel
// l'offre, et sa section (`ExportVersQuadra`, plus bas) prend la place de celle d'ACD. Ses réglages ne se gardent pas — la
// base n'en accepte que pour ACD (`logiciels_d_export()`) — : ils se saisissent à chaque export, tous « à saisir », aucun
// préchoisi.
//
// LE PROFIL TRA (EXP4, lib/profilTra.ts), derrière `PROFIL_TRA_OFFERT` BAISSÉ, sur le modèle de Quadra : levé, le choix du
// logiciel l'offre et sa section (`ExportVersTra`, plus bas) prend la place de celle d'ACD ; ses réglages — l'en-tête, la
// description de chacun de nos journaux dans le dossier Cegid, le chemin des justificatifs — se saisissent à chaque export,
// tous « à saisir », aucun préchoisi.
//
// Verrous `useRef` posés avant le `try`, relâchés dans le `finally` (après la relecture pour l'enregistrement) : deux clics ne
// font qu'un export, qu'un enregistrement.

type EtatDeLaLecture = { etat: 'en_cours' } | LectureDesReglagesDExport

/** Les profils dont la base ne garde pas les réglages (`logiciels_d_export()` ne rend qu'`acd`) : rien ne se lit ni ne s'enregistre pour eux. */
type ProfilAPart = typeof PROFIL_QUADRA.id | typeof PROFIL_TRA.id
function estAPart(p: ProfilDExport | ProfilAPart): p is ProfilAPart {
  return p === PROFIL_QUADRA.id || p === PROFIL_TRA.id
}

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
  const [profil, setProfil] = useState<ProfilDExport | ProfilAPart>('acd')
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
    if (REGLAGES_D_EXPORT_PREVUS && !estAPart(profil)) {
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
    // Quadra et le TRA n'ont pas de réglages gardés (la base ne connaît qu'ACD) : rien ne s'enregistre pour eux.
    if (enregistrementEnCours.current || lus === null || refusDeLaSaisie !== null || rienAEnregistrer || estAPart(profil)) return
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

  const enLecture = REGLAGES_D_EXPORT_PREVUS && !estAPart(profil) && (lecture === null || lecture.etat === 'en_cours')

  const choixDuLogiciel = (
    <label className="field">
      <span>Logiciel</span>
      <select value={profil} onChange={(e) => {
        if (e.target.value === PROFIL_QUADRA.id) { setProfil(PROFIL_QUADRA.id); return }
        if (e.target.value === PROFIL_TRA.id) { setProfil(PROFIL_TRA.id); return }
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
        {PROFIL_QUADRA_OFFERT && <option value={PROFIL_QUADRA.id}>{PROFIL_QUADRA.libelle}</option>}
        {PROFIL_TRA_OFFERT && <option value={PROFIL_TRA.id}>{PROFIL_TRA.libelle}</option>}
      </select>
    </label>
  )

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
        <div className="card carte-export-logiciel" aria-label="Export vers un logiciel comptable">
          <p className="muted" role="status">Lecture des réglages que le dossier garde pour ce logiciel…</p>
        </div>
      )}
      {ouvert && instantane !== null && profil === PROFIL_QUADRA.id && (
        <ExportVersQuadra dossierId={dossierId} nomDuFec={nomDuFec} instantane={instantane} fec={fec} pieces={pieces}
          choixDuLogiciel={choixDuLogiciel} />
      )}
      {ouvert && instantane !== null && profil === PROFIL_TRA.id && (
        <ExportVersTra dossierId={dossierId} nomDuFec={nomDuFec} instantane={instantane} fec={fec} pieces={pieces}
          choixDuLogiciel={choixDuLogiciel} />
      )}
      {ouvert && instantane !== null && !estAPart(profil) && misEnForme !== null && (
        <div className="card carte-export-logiciel" aria-label="Export vers un logiciel comptable">
          <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 12 }}>
            {choixDuLogiciel}
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
            <div className="enregistrement-des-reglages">
              <button className="btn btn-outline btn-sm" disabled={enregistrement.enCours || refusDeLaSaisie !== null || rienAEnregistrer}
                onClick={() => { void enregistrerLesReglages() }}>
                {enregistrement.enCours ? 'Enregistrement…' : 'Enregistrer ces réglages'}
              </button>
              {refusDeLaSaisie !== null && <p className="error-text">{refusDeLaSaisie}</p>}
              {/* Juste après un enregistrement réussi, « Réglages enregistrés » suffit (EXPQ4E-Q1). */}
              {refusDeLaSaisie === null && rienAEnregistrer && !enregistrement.fait && lus !== null
                && <p className="muted">{phraseDeRienAEnregistrer(lus.gardes)}</p>}
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

// LA SECTION DU PROFIL QUADRA (EXP3). Chaque réglage part « à saisir » — ni encodage, ni fin d'enregistrement, ni longueur,
// ni code de journal préchoisi : la fiche de Cegid ne les fixe pas (lib/profilQuadra.ts) — et l'export se refuse en nommant
// ce qui manque. L'aperçu dit avant le clic ce que la largeur fixe coupe et ce que l'enregistrement `M` ne porte pas. Avec
// les justificatifs, leur nom s'écrit dans le fichier une fois leur type lu : l'archive les télécharge, puis compose.
function ExportVersQuadra({ dossierId, nomDuFec, instantane, fec, pieces, choixDuLogiciel }: {
  dossierId: string
  nomDuFec: string
  instantane: { contenu: string; numerotation: NumerotationFec }
  fec: () => { contenu: string; numerotation: NumerotationFec } | null
  pieces: readonly PieceDesJustificatifs[]
  choixDuLogiciel: ReactNode
}) {
  const exportQuadraEnCours = useRef(false)
  const [encodage, setEncodage] = useState<EncodageQuadra | null>(null)
  const [finDEnregistrement, setFinDEnregistrement] = useState<FinDEnregistrementQuadra | null>(null)
  const [longueur, setLongueur] = useState('')
  const [journaux, setJournaux] = useState<Record<string, string>>({})
  const [sansANouveaux, setSansANouveaux] = useState(false)
  const [avecJustificatifs, setAvecJustificatifs] = useState(false)
  const [poids, setPoids] = useState<PoidsDesJustificatifs | PoidsInconnu>('a_mesurer')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState<string | null>(null)

  const codes = useMemo(() => journauxDuFec(instantane.contenu), [instantane])
  const reglages = useMemo(() => {
    const t = longueur.trim()
    return {
      encodage, finDEnregistrement, journaux, sansANouveaux,
      longueurDesComptes: t === '' ? null : /^[0-9]{1,2}$/.test(t) ? Number(t) : Number.NaN,
    }
  }, [encodage, finDEnregistrement, journaux, sansANouveaux, longueur])
  const misEnForme = useMemo(() => mettreEnFormePourQuadra(instantane.contenu, reglages), [instantane, reglages])
  const justificatifs = useMemo(
    () => misEnForme.ok ? justificatifsDeLExportQuadra(dossierId, instantane.numerotation, pieces, misEnForme.numeros) : null,
    [dossierId, instantane, misEnForme, pieces],
  )
  const nomDuFichier = nomDuFichierQuadra(nomDuFec)

  async function cocherLesJustificatifs(coche: boolean) {
    setAvecJustificatifs(coche)
    if (!coche || justificatifs === null) return
    setPoids('en_cours')
    setPoids(await mesurerLesJustificatifs(dossierId, justificatifs.aJoindre))
  }

  async function exporter() {
    if (exportQuadraEnCours.current || !misEnForme.ok) return
    exportQuadraEnCours.current = true
    setErreur(null)
    setFait(null)
    setEnCours(true)
    try {
      // Les écritures ont-elles bougé depuis l'aperçu ? Le fichier ne part que tel que l'écran l'a montré.
      const maintenant = fec()
      if (maintenant === null || maintenant.contenu !== instantane.contenu) {
        setErreur('Les écritures ont changé depuis l’aperçu : referme puis rouvre l’export, et relance-le.')
        return
      }
      if (!avecJustificatifs) {
        await telecharger(nomDuFichier, misEnForme.octets, 'text/plain')
        setFait(`Fichier téléchargé : ${misEnForme.ecritures} écriture(s), ${misEnForme.lignes} ligne(s).`)
        return
      }
      if (justificatifs === null) return
      const issue = await fabriquerLArchiveNommee(dossierId, justificatifs.aJoindre, nomDuJustificatifQuadra, (noms) => {
        const avecNoms = mettreEnFormePourQuadra(instantane.contenu, reglages, noms)
        return avecNoms.ok ? { ok: true, nom: nomDuFichier, octets: avecNoms.octets } : { ok: false, message: avecNoms.refus.join(' ') }
      }, new Date(), 'son nom ne tient pas en huit caractères et une extension de trois.')
      if (!issue.ok) { setErreur(issue.message); return }
      await telecharger(nomDeLArchive(nomDuFichier), issue.bilan.zip, 'application/zip')
      const manquants = [...justificatifs.ecartes, ...issue.bilan.manquants]
      setFait(`Archive téléchargée : le fichier d’écritures et ${issue.bilan.joints} justificatif(s), chacun nommé dans le fichier`
        + (manquants.length > 0 ? ` — ${manquants.length} justificatif(s) n’y sont PAS : ${manquants.join(' ')}` : '.'))
    } catch (e) {
      setErreur(`Rien n’est parti : ${messageErreur(e, 'l’export a été interrompu.')}`)
    } finally {
      exportQuadraEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card carte-export-logiciel" aria-label="Export vers un logiciel comptable">
      <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 12 }}>
        {choixDuLogiciel}
        <label className="field">
          <span>Longueur des comptes ({LONGUEUR_DES_COMPTES_QUADRA_MIN} à {LONGUEUR_DES_COMPTES_QUADRA_MAX})</span>
          <input type="number" min={LONGUEUR_DES_COMPTES_QUADRA_MIN} max={LONGUEUR_DES_COMPTES_QUADRA_MAX} value={longueur}
            placeholder="à saisir" onChange={(e) => setLongueur(e.target.value)} />
        </label>
      </div>
      <p className="muted">Ces réglages ne se gardent pas : la base ne garde de réglages que pour ACD. Rien n’est préchoisi — la fiche de Cegid ne fixe ni l’encodage, ni la fin d’enregistrement.</p>

      <fieldset>
        <legend>L’encodage{encodage === null ? ' — à saisir' : ''}</legend>
        {ENCODAGES_QUADRA.map((o) => (
          <label key={o.id} style={{ display: 'block' }}>
            <input type="radio" name="encodage-quadra" checked={encodage === o.id} onChange={() => setEncodage(o.id)} /> {o.libelle}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>La fin d’enregistrement{finDEnregistrement === null ? ' — à saisir' : ''}</legend>
        {FINS_D_ENREGISTREMENT_QUADRA.map((o) => (
          <label key={o.id} style={{ display: 'block' }}>
            <input type="radio" name="fin-quadra" checked={finDEnregistrement === o.id} onChange={() => setFinDEnregistrement(o.id)} /> {o.libelle}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Les journaux (nos codes → ceux du dossier Quadra, une ou deux lettres ou chiffres)</legend>
        <div className="field-row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {codes.filter((c) => !(sansANouveaux && c.code === 'AN')).map(({ code, libelle }) => (
            <label key={code} className="field">
              <span>{code} — {libelle}</span>
              <input value={journaux[code] ?? ''} placeholder="à saisir" aria-label={`Code du journal ${code} dans le dossier Quadra`}
                onChange={(e) => { const v = e.target.value; setJournaux((j) => ({ ...j, [code]: v })) }} />
            </label>
          ))}
        </div>
      </fieldset>

      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={sansANouveaux} onChange={(e) => setSansANouveaux(e.target.checked)} /> Sans le journal des à-nouveaux
      </label>
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={avecJustificatifs} onChange={(e) => { void cocherLesJustificatifs(e.target.checked) }} /> Avec les justificatifs (une archive ZIP)
      </label>

      <p role="note">Un fichier importé deux fois double les écritures dans le logiciel.</p>
      <p role="note">Les comptes auxiliaires, le lettrage, DateRglt, ModeRglt, NatOp et IdClient n’ont pas de place dans l’enregistrement d’écriture de Quadra : ils ne partent pas.</p>

      {!misEnForme.ok ? (
        <div role="alert">
          <p className="error-text">Rien ne peut partir :</p>
          <ul>{misEnForme.refus.map((r) => <li key={r} className="error-text">{r}</li>)}</ul>
        </div>
      ) : (
        <>
          <p>{misEnForme.ecritures} écriture(s), {misEnForme.lignes} ligne(s), à largeur fixe, en {encodage === 'ascii' ? 'ASCII strict' : 'Windows-1252'}.</p>
          <ul>
            <li>{misEnForme.libellesCoupes} libellé(s) coupé(s) à trente caractères, {misEnForme.piecesCoupees} numéro(s) de pièce à vingt.</li>
            <li>{misEnForme.auxiliairesNonRepris} ligne(s) perdent leur compte auxiliaire et restent sur leur compte collectif ; {misEnForme.lettragesNonRepris} ligne(s) lettrée(s) partent sans leur lettrage.</li>
          </ul>
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
                {justificatifs.aJoindre.length} justificatif(s) partent à côté du fichier, chacun sous l’empreinte courte de sa pièce,
                {' '}son nom écrit dans le fichier une fois son type lu ;
                {' '}{justificatifs.ecrituresSansJustificatif} écriture(s) n’en ont pas ; {phraseDuPoids(poids)}
              </p>
              {justificatifs.ecartes.length > 0 && <ul>{justificatifs.ecartes.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
        </>
      )}

      <button className="btn btn-primary btn-sm" disabled={enCours || !misEnForme.ok || (avecJustificatifs && poids === 'en_cours')} onClick={exporter}>
        {enCours ? 'Export…' : avecJustificatifs ? 'Télécharger l’archive' : 'Télécharger le fichier'}
      </button>
      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {fait && <p className="muted" role="status">{fait}</p>}
    </div>
  )
}

// LA SECTION DU PROFIL TRA (EXP4). Chaque réglage part « à saisir » — ni encodage, ni fin d'enregistrement, ni longueur, ni
// produit, ni origine, ni analytique, ni numéro de pièce, ni rien de nos journaux dans le dossier Cegid : la description de
// Cegid ne les fixe pas (lib/profilTra.ts) — et l'export se refuse en nommant ce qui manque. L'aperçu dit avant le clic ce que
// la largeur fixe coupe et ce que l'enregistrement d'écriture ne porte pas. Avec les justificatifs, leur chemin se demande, et
// leur nom s'écrit dans le fichier une fois leur type lu : l'archive les télécharge, puis compose.
function ExportVersTra({ dossierId, nomDuFec, instantane, fec, pieces, choixDuLogiciel }: {
  dossierId: string
  nomDuFec: string
  instantane: { contenu: string; numerotation: NumerotationFec }
  fec: () => { contenu: string; numerotation: NumerotationFec } | null
  pieces: readonly PieceDesJustificatifs[]
  choixDuLogiciel: ReactNode
}) {
  const exportTraEnCours = useRef(false)
  const [encodage, setEncodage] = useState<EncodageTra | null>(null)
  const [finDEnregistrement, setFinDEnregistrement] = useState<FinDEnregistrementTra | null>(null)
  const [longueur, setLongueur] = useState('')
  const [produit, setProduit] = useState<ProduitTra | null>(null)
  const [origine, setOrigine] = useState<OrigineTra | null>(null)
  const [nouvelleAnalytique, setNouvelleAnalytique] = useState<NouvelleAnalytiqueTra | null>(null)
  const [numeroDePiece, setNumeroDePiece] = useState<NumeroDePieceTra | null>(null)
  const [journaux, setJournaux] = useState<Record<string, JournalTra>>({})
  const [sansANouveaux, setSansANouveaux] = useState(false)
  const [modeDuChemin, setModeDuChemin] = useState<'nom_seul' | 'dossier' | null>(null)
  const [dossierDesJustificatifs, setDossierDesJustificatifs] = useState('')
  const [avecJustificatifs, setAvecJustificatifs] = useState(false)
  const [poids, setPoids] = useState<PoidsDesJustificatifs | PoidsInconnu>('a_mesurer')
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [fait, setFait] = useState<string | null>(null)

  const codes = useMemo(() => journauxDuFec(instantane.contenu), [instantane])
  const reglages = useMemo(() => {
    const t = longueur.trim()
    return {
      encodage, finDEnregistrement, produit, origine, nouvelleAnalytique, numeroDePiece, journaux, sansANouveaux,
      longueurDesComptes: t === '' ? null : /^[0-9]{1,2}$/.test(t) ? Number(t) : Number.NaN,
      cheminDesJustificatifs: modeDuChemin === null ? null
        : modeDuChemin === 'nom_seul' ? { mode: 'nom_seul' as const } : { mode: 'dossier' as const, dossier: dossierDesJustificatifs },
    }
  }, [encodage, finDEnregistrement, produit, origine, nouvelleAnalytique, numeroDePiece, journaux, sansANouveaux, longueur, modeDuChemin,
    dossierDesJustificatifs])
  const misEnForme = useMemo(() => mettreEnFormePourTra(instantane.contenu, reglages, { avecJustificatifs }), [instantane, reglages, avecJustificatifs])
  // Les justificatifs du profil commun : chaque pièce citée, une fois, sous sa référence neutre.
  const justificatifs = useMemo(
    () => misEnForme.ok ? justificatifsDeLExport(dossierId, instantane.numerotation, pieces, misEnForme.numeros) : null,
    [dossierId, instantane, misEnForme, pieces],
  )
  const nomDuFichier = nomDuFichierTra(nomDuFec)

  function changerLeJournal(code: string, changement: Partial<JournalTra>) {
    setJournaux((j) => ({ ...j, [code]: { ...(j[code] ?? JOURNAL_TRA_A_SAISIR), ...changement } }))
  }

  async function cocherLesJustificatifs(coche: boolean) {
    setAvecJustificatifs(coche)
    if (!coche) return
    // Le poids se mesure sur les justificatifs que l'aperçu sans eux désigne déjà : le chemin à saisir ne les change pas.
    const sansEux = mettreEnFormePourTra(instantane.contenu, reglages, { avecJustificatifs: false })
    if (!sansEux.ok) return
    setPoids('en_cours')
    setPoids(await mesurerLesJustificatifs(dossierId, justificatifsDeLExport(dossierId, instantane.numerotation, pieces, sansEux.numeros).aJoindre))
  }

  async function exporter() {
    if (exportTraEnCours.current || !misEnForme.ok) return
    exportTraEnCours.current = true
    setErreur(null)
    setFait(null)
    setEnCours(true)
    try {
      // Les écritures ont-elles bougé depuis l'aperçu ? Le fichier ne part que tel que l'écran l'a montré.
      const maintenant = fec()
      if (maintenant === null || maintenant.contenu !== instantane.contenu) {
        setErreur('Les écritures ont changé depuis l’aperçu : referme puis rouvre l’export, et relance-le.')
        return
      }
      if (!avecJustificatifs) {
        await telecharger(nomDuFichier, misEnForme.octets, 'text/plain')
        setFait(`Fichier téléchargé : ${misEnForme.ecritures} écriture(s), ${misEnForme.lignes} ligne(s).`)
        return
      }
      if (justificatifs === null) return
      const issue = await fabriquerLArchiveNommee(dossierId, justificatifs.aJoindre, nomDuJustificatifTra, (noms) => {
        const avecNoms = mettreEnFormePourTra(instantane.contenu, reglages, { avecJustificatifs: true, joints: noms })
        return avecNoms.ok ? { ok: true, nom: nomDuFichier, octets: avecNoms.octets } : { ok: false, message: avecNoms.refus.join(' ') }
      }, new Date(), 'son nom ne se compose pas de la référence de sa pièce et d’une extension de trois caractères.')
      if (!issue.ok) { setErreur(issue.message); return }
      await telecharger(nomDeLArchiveTra(nomDuFec), issue.bilan.zip, 'application/zip')
      const manquants = [...justificatifs.ecartes, ...issue.bilan.manquants]
      setFait(`Archive téléchargée : le fichier d’écritures et ${issue.bilan.joints} justificatif(s), chacun nommé dans le fichier`
        + (manquants.length > 0 ? ` — ${manquants.length} justificatif(s) n’y sont PAS : ${manquants.join(' ')}` : '.'))
    } catch (e) {
      setErreur(`Rien n’est parti : ${messageErreur(e, 'l’export a été interrompu.')}`)
    } finally {
      exportTraEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card carte-export-logiciel" aria-label="Export vers un logiciel comptable">
      <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 12 }}>
        {choixDuLogiciel}
        <label className="field">
          <span>Longueur des comptes ({LONGUEUR_DES_COMPTES_TRA_MIN} à {LONGUEUR_DES_COMPTES_TRA_MAX})</span>
          <input type="number" min={LONGUEUR_DES_COMPTES_TRA_MIN} max={LONGUEUR_DES_COMPTES_TRA_MAX} value={longueur}
            placeholder="à saisir" onChange={(e) => setLongueur(e.target.value)} />
        </label>
        <label className="field">
          <span>Produit qui génère le fichier</span>
          <select aria-label="Produit qui génère le fichier" value={produit ?? ''}
            onChange={(e) => setProduit(PRODUITS_TRA.find((o) => o.id === e.target.value)?.id ?? null)}>
            <option value="">à saisir</option>
            {PRODUITS_TRA.map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Origine du fichier</span>
          <select aria-label="Origine du fichier" value={origine ?? ''}
            onChange={(e) => setOrigine(ORIGINES_TRA.find((o) => o.id === e.target.value)?.id ?? null)}>
            <option value="">à saisir</option>
            {ORIGINES_TRA.map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Gestion de l’analytique du dossier</span>
          <select aria-label="Gestion de l’analytique du dossier" value={nouvelleAnalytique ?? ''}
            onChange={(e) => setNouvelleAnalytique(NOUVELLES_ANALYTIQUES_TRA.find((o) => o.id === e.target.value)?.id ?? null)}>
            <option value="">à saisir</option>
            {NOUVELLES_ANALYTIQUES_TRA.map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
          </select>
        </label>
      </div>
      <p className="muted">Ces réglages ne se gardent pas : la base ne garde de réglages que pour ACD. Rien n’est préchoisi — la description du fichier TRA de Cegid ne fixe ni l’encodage, ni la fin d’enregistrement, ni ce que l’application est pour le logiciel.</p>

      <fieldset>
        <legend>L’encodage{encodage === null ? ' — à saisir' : ''}</legend>
        {ENCODAGES_TRA.map((o) => (
          <label key={o.id} style={{ display: 'block' }}>
            <input type="radio" name="encodage-tra" checked={encodage === o.id} onChange={() => setEncodage(o.id)} /> {o.libelle}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>La fin d’enregistrement{finDEnregistrement === null ? ' — à saisir' : ''}</legend>
        {FINS_D_ENREGISTREMENT_TRA.map((o) => (
          <label key={o.id} style={{ display: 'block' }}>
            <input type="radio" name="fin-tra" checked={finDEnregistrement === o.id} onChange={() => setFinDEnregistrement(o.id)} /> {o.libelle}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Le numéro de pièce des écritures{numeroDePiece === null ? ' — à saisir' : ''}</legend>
        {NUMEROS_DE_PIECE_TRA.map((o) => (
          <label key={o.id} style={{ display: 'block' }}>
            <input type="radio" name="numero-de-piece-tra" checked={numeroDePiece === o.id} onChange={() => setNumeroDePiece(o.id)} /> {o.libelle}
          </label>
        ))}
      </fieldset>
      {codes.filter((c) => !(sansANouveaux && c.code === 'AN')).map(({ code, libelle }) => {
        const j = journaux[code] ?? JOURNAL_TRA_A_SAISIR
        return (
          <fieldset key={code}>
            <legend>Le journal {code} — {libelle}, dans le dossier Cegid</legend>
            <div className="field-row" style={{ flexWrap: 'wrap', gap: 12 }}>
              <label className="field">
                <span>Code (une à trois lettres ou chiffres)</span>
                <input value={j.code} placeholder="à saisir" aria-label={`Code du journal ${code} dans le dossier Cegid`}
                  onChange={(e) => changerLeJournal(code, { code: e.target.value })} />
              </label>
              <label className="field">
                <span>Libellé</span>
                <input value={j.libelle} placeholder="à saisir" aria-label={`Libellé du journal ${code} dans le dossier Cegid`}
                  onChange={(e) => changerLeJournal(code, { libelle: e.target.value })} />
              </label>
              <label className="field">
                <span>Nature</span>
                <select value={j.nature ?? ''} aria-label={`Nature du journal ${code} dans le dossier Cegid`}
                  onChange={(e) => changerLeJournal(code, { nature: NATURES_DE_JOURNAL_TRA.find((o) => o.id === e.target.value)?.id ?? null })}>
                  <option value="">à saisir</option>
                  {NATURES_DE_JOURNAL_TRA.map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Nature du mouvement de ses écritures</span>
                <select value={j.typeDePiece ?? ''} aria-label={`Nature du mouvement des écritures du journal ${code}`}
                  onChange={(e) => changerLeJournal(code, { typeDePiece: TYPES_DE_PIECE_TRA.find((o) => o.id === e.target.value)?.id ?? null })}>
                  <option value="">à saisir</option>
                  {TYPES_DE_PIECE_TRA.map((o) => <option key={o.id} value={o.id}>{o.libelle}</option>)}
                </select>
              </label>
              {j.nature !== null && NATURES_A_CONTREPARTIE.includes(j.nature) && (
                <label className="field">
                  <span>Compte de contrepartie automatique</span>
                  <input value={j.contrepartie} placeholder="à saisir" aria-label={`Compte de contrepartie du journal ${code}`}
                    onChange={(e) => changerLeJournal(code, { contrepartie: e.target.value })} />
                </label>
              )}
            </div>
          </fieldset>
        )
      })}

      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={sansANouveaux} onChange={(e) => setSansANouveaux(e.target.checked)} /> Sans le journal des à-nouveaux
      </label>
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={avecJustificatifs} onChange={(e) => { void cocherLesJustificatifs(e.target.checked) }} /> Avec les justificatifs (une archive ZIP)
      </label>
      {avecJustificatifs && (
        <fieldset>
          <legend>Le chemin des justificatifs dans le fichier{modeDuChemin === null ? ' — à saisir' : ''}</legend>
          <label style={{ display: 'block' }}>
            <input type="radio" name="chemin-tra" checked={modeDuChemin === 'nom_seul'} onChange={() => setModeDuChemin('nom_seul')} /> Le nom du fichier seul
          </label>
          <label style={{ display: 'block' }}>
            <input type="radio" name="chemin-tra" checked={modeDuChemin === 'dossier'} onChange={() => setModeDuChemin('dossier')} /> Un dossier, puis le nom du fichier
          </label>
          {modeDuChemin === 'dossier' && (
            <label className="field">
              <span>Le dossier où l’archive sera décompressée, terminé par son séparateur</span>
              <input value={dossierDesJustificatifs} placeholder="à saisir" aria-label="Dossier des justificatifs"
                onChange={(e) => setDossierDesJustificatifs(e.target.value)} />
            </label>
          )}
        </fieldset>
      )}

      <p role="note">Un fichier importé deux fois double les écritures dans le logiciel.</p>
      <p role="note">Les comptes auxiliaires, le lettrage, DateRglt, ModeRglt, NatOp et IdClient n’ont pas de place dans l’écriture du fichier TRA : ils ne partent pas.</p>

      {!misEnForme.ok ? (
        <div role="alert">
          <p className="error-text">Rien ne peut partir :</p>
          <ul>{misEnForme.refus.map((r) => <li key={r} className="error-text">{r}</li>)}</ul>
        </div>
      ) : (
        <>
          <p>{misEnForme.ecritures} écriture(s), {misEnForme.lignes} ligne(s), à largeur fixe, en {encodage === 'ascii' ? 'ASCII strict' : 'Windows-1252'}.</p>
          <ul>
            <li>{misEnForme.libellesCoupes} libellé(s) coupé(s) à trente-cinq caractères, {misEnForme.piecesCoupees} pièce(s) aussi.</li>
            <li>{misEnForme.auxiliairesNonRepris} ligne(s) perdent leur compte auxiliaire et restent sur leur compte collectif ; {misEnForme.lettragesNonRepris} ligne(s) lettrée(s) partent sans leur lettrage.</li>
          </ul>
          <div className="table-scroll">
            <table>
              <caption>Les journaux tels qu’ils partiront</caption>
              <thead><tr><th>Dans l’application</th><th>Dans le fichier</th><th>Libellé</th><th>Nature</th><th>Mouvement</th></tr></thead>
              <tbody>{misEnForme.journaux.map((j) => <tr key={j.nous}><td>{j.nous}</td><td>{j.eux}</td><td>{j.libelle}</td><td>{j.nature}</td><td>{j.typeDePiece}</td></tr>)}</tbody>
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
                {justificatifs.aJoindre.length} justificatif(s) partent à côté du fichier, chacun sous la référence de sa pièce,
                {' '}son chemin écrit dans le fichier une fois son type lu ;
                {' '}{justificatifs.ecrituresSansJustificatif} écriture(s) n’en ont pas ; {phraseDuPoids(poids)}
              </p>
              {justificatifs.ecartes.length > 0 && <ul>{justificatifs.ecartes.map((e) => <li key={e}>{e}</li>)}</ul>}
            </div>
          )}
        </>
      )}

      <button className="btn btn-primary btn-sm" disabled={enCours || !misEnForme.ok || (avecJustificatifs && poids === 'en_cours')} onClick={exporter}>
        {enCours ? 'Export…' : avecJustificatifs ? 'Télécharger l’archive' : 'Télécharger le fichier'}
      </button>
      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {fait && <p className="muted" role="status">{fait}</p>}
    </div>
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
