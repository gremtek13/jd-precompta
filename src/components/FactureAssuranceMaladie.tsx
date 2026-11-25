import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../lib/format'
import { pourLEspace, type EspaceVentes } from '../lib/espaceVentes'
import { lireLeBordereauDeTeletransmission } from '../lib/bordereauDeTeletransmissionLecture'
import { factureDesBordereaux, type FactureDesBordereaux } from '../lib/factureAssuranceMaladie'
import { FACTURES_ASSURANCE_MALADIE_PREVUES, corpsDeLImportDuFacture } from '../lib/importDuFactureAssuranceMaladie'
import {
  CONSIGNE_DU_FACTURE_AU_CABINET, LIBELLES_DES_PARTS_DU_FACTURE, PRESENTATION_DU_FACTURE_AU_CABINET,
  PRESENTATION_DU_FACTURE_AU_CLIENT, REGIMES_OFFERTS, SANS_LA_CASE_BANQUE_DU_FACTURE, VIDE_DU_FACTURE_DIT,
  aideDuChoixDesRegimes, boutonDImportDit, choixRetenus, cleDeLOrganisme, confirmationDeLImportDuFacture,
  confirmationDuRetraitDuFacture, facturesDites, fichierLuDit, fichiersDeLEnvoi, montantDit, organismeAChoisirDit,
  organismeDuFactureDit, organismesAChoisir, partsDeLImport, periodeDesLotsDite, phraseApresLImportDuFacture,
  refusAvantLEnvoiDuFacture, refusDeLaTailleDuBordereau, refusDesFichiers, refusDuFactureDit, resumeDit, totauxDeLApercu,
  type FichierDeLEnvoi, type TotalDuFactureDit,
} from '../lib/factureAssuranceMaladieVue'
import { lireLeFactureAssuranceMaladie, type FactureLu } from '../lib/factureAssuranceMaladieLecture'
import { importsDeLaLecture, sectionAssuranceMaladie } from '../lib/sectionAssuranceMaladie'
import BandeauLecturePartielle from './BandeauLecturePartielle'
import type { FactureAssuranceMaladie as TotalEnBase, ImportFacturesAssuranceMaladie } from '../lib/types'

// LE FACTURÉ À L'ASSURANCE MALADIE, À L'ÉCRAN (conception 59, lot BOR4 ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md,
// § 5.4, § 13.5 et § 15). Une section des deux espaces, à côté des paiements (NOE4) : l'onglet Banque du cabinet, « Ma banque »
// du praticien sous « Banque » (BOR-Q8 (A)). Elle ne se monte que sous `FACTURES_ASSURANCE_MALADIE_PREVUES` levé, et sous la
// règle d'offre de NOE4 (lib/sectionAssuranceMaladie.ts : un code NAF de santé ou de la liste fermée, ou un import du
// facturé déjà lu) ; l'écran qui la monte la garde sous le module « assurance_maladie » du cabinet.
//
// LES BORDEREAUX NE PARTENT NULLE PART : chaque PDF s'ouvre ici, par pdf.js, sur ses octets (lib/bordereauDeTeletransmissionLecture.ts) ;
// BOR1 n'en rend que l'en-tête des lots et leurs totaux, BOR2 les agrégats. L'écran montre le nom du fichier choisi (à celui qui
// l'a choisi), le rang de ses bordereaux dans l'envoi, les refus et leurs raisons (un doute est un refus), puis les agrégats ;
// jamais une ligne, jamais un numéro de lot. Au clic, le corps de `importer_factures_assurance_maladie` se compose au moment de
// l'appel (`corpsDeLImportDuFacture`) et ne se garde pas : les numéros des lots y passent pour l'empreinte que la base seule
// calcule ; « lot déjà importé le … », la base seule le dit.
//
// UN VERROU (`ecritureEnCours`) pour les deux gestes, importer et retirer, relâché après la relecture. Une liste lue en partie
// n'offre aucun geste.

export default function FactureAssuranceMaladie({ espace, dossierId, codeNaf }: {
  espace: EspaceVentes
  dossierId: string
  /** `dossiers.code_naf` tel que l'écran l'a lu : `undefined` tant qu'il ne l'est pas, `null` quand le dossier n'en a pas. */
  codeNaf: string | null | undefined
}) {
  if (!FACTURES_ASSURANCE_MALADIE_PREVUES) return null
  return <SectionSelonLaRegle key={dossierId} espace={espace} dossierId={dossierId} codeNaf={codeNaf} />
}

/** La lecture du facturé, gardée avec le dossier qu'elle a lu ; la dernière demande seule écrit. */
function useLeFacture(dossierId: string, espace: EspaceVentes): { lu: FactureLu | null; relire: () => Promise<void> } {
  const [lecture, setLecture] = useState<{ cle: string; lu: FactureLu } | null>(null)
  const derniere = useRef(0)
  const relire = useCallback(async () => {
    const jeton = ++derniere.current
    const lu = await lireLeFactureAssuranceMaladie(dossierId, espace)
    if (jeton === derniere.current) setLecture({ cle: `${dossierId}|${espace}`, lu })
  }, [dossierId, espace])
  useEffect(() => {
    const jetons = derniere
    void relire()
    return () => { jetons.current++ }
  }, [relire])
  const lu = lecture !== null && lecture.cle === `${dossierId}|${espace}` && lecture.lu.dossierId === dossierId ? lecture.lu : null
  return { lu, relire }
}

/** La règle de lib/sectionAssuranceMaladie.ts, sur le code et sur les imports du facturé lus : hors d'elle, rien ne se montre. */
function SectionSelonLaRegle({ espace, dossierId, codeNaf }: { espace: EspaceVentes; dossierId: string; codeNaf: string | null | undefined }) {
  const lecture = useLeFacture(dossierId, espace)
  if (!sectionAssuranceMaladie(codeNaf, importsDeLaLecture(lecture.lu, dossierId)).offerte) return null
  return <Section espace={espace} dossierId={dossierId} lu={lecture.lu} relire={lecture.relire} />
}

function Section({ espace, dossierId, lu, relire }: {
  espace: EspaceVentes; dossierId: string; lu: FactureLu | null; relire: () => Promise<void>
}) {
  const client = espace === 'client'
  const [fenetre, setFenetre] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [apres, setApres] = useState<string | null>(null)
  const [aRetirer, setARetirer] = useState<string | null>(null)
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const entier = lu?.etat === 'lus' && lu.imports.complete && lu.totaux.complete ? lu : null

  async function importer(facture: Extract<FactureDesBordereaux, { etat: 'pret' }>) {
    if (ecritureEnCours.current || !entier) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    setApres(null)
    try {
      // Le corps se compose ICI, au moment de l'appel, et ne se garde nulle part : il porte les numéros des lots.
      const { error } = await supabase.rpc('importer_factures_assurance_maladie', {
        p_dossier_id: dossierId, p_import: corpsDeLImportDuFacture(facture),
      })
      if (error) {
        setErreur(pourLEspace(espace, messageErreur(error, 'L’import n’a pas pu se faire.')))
        return
      }
      setFenetre(false)
      setApres(phraseApresLImportDuFacture(espace))
      await relire()
    } catch (e) {
      setErreur(pourLEspace(espace, messageErreur(e, 'L’import n’a pas pu se faire.')))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function retirer(importId: string) {
    if (ecritureEnCours.current || !entier) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    setApres(null)
    try {
      const { error } = await supabase.rpc('retirer_import_factures_assurance_maladie', { p_import_id: importId })
      if (error) {
        setErreur(pourLEspace(espace, messageErreur(error, 'Le retrait n’a pas pu se faire.')))
        return
      }
      setARetirer(null)
      await relire()
    } catch (e) {
      setErreur(pourLEspace(espace, messageErreur(e, 'Le retrait n’a pas pu se faire.')))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <section className="card" aria-labelledby="facture-am-titre" style={{ marginBottom: 20 }}>
      <h3 id="facture-am-titre" style={{ marginTop: 0 }}>Facturé à l’assurance maladie</h3>
      <p className="muted" style={{ marginTop: 0 }}>{client ? PRESENTATION_DU_FACTURE_AU_CLIENT : PRESENTATION_DU_FACTURE_AU_CABINET}</p>
      {!client && <p className="muted" style={{ marginTop: 0 }}>{CONSIGNE_DU_FACTURE_AU_CABINET}</p>}

      {lu === null ? (
        <p className="muted">Chargement…</p>
      ) : lu.etat === 'echec' ? (
        <p className="error-text">
          {client
            ? `Tes bordereaux importés ne s’affichent pas : ${lu.motif}. Rien ne t’est proposé. Recharge la page.`
            : `Les bordereaux importés ne s’affichent pas : ${lu.motif}. Aucun import n’est offert.`}
        </p>
      ) : lu.etat === 'sans_banque' ? (
        <p className="muted">{SANS_LA_CASE_BANQUE_DU_FACTURE}</p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi={client ? 'Tes imports de bordereaux' : 'Les imports de bordereaux'} accord="lus" motif={lu.imports.motif} technique={false}
            consequence={client
              ? 'Ils ne s’affichent pas, et rien ne t’est proposé : un import déjà fait passerait pour absent. Recharge la page.'
              : 'Ils ne s’affichent pas, et aucun geste n’est offert : un import déjà fait passerait pour absent.'}
          />
          <BandeauLecturePartielle
            quoi={client ? 'Les totaux de tes bordereaux importés' : 'Les totaux des bordereaux importés'} accord="lus"
            motif={lu.totaux.motif} technique={false}
            consequence={client
              ? 'Ils ne s’affichent pas, et rien ne t’est proposé : un retrait ne dirait pas ce qui part. Recharge la page.'
              : 'Ils ne s’affichent pas, et aucun geste n’est offert : un retrait ne dirait pas ce qui part.'}
          />
          {apres && <p role="status">{apres}</p>}
          {erreur && !fenetre && <p className="error-text" role="alert">{erreur}</p>}
          {entier && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" className="btn btn-primary" disabled={enCours} onClick={() => { setErreur(null); setApres(null); setFenetre(true) }}>
                  Importer des bordereaux de télétransmission
                </button>
              </div>
              <ListeDesImports
                espace={espace} imports={entier.imports.lignes} totaux={entier.totaux.lignes} enCours={enCours}
                aRetirer={aRetirer} onDemanderRetrait={setARetirer} onRetirer={(id) => { void retirer(id) }}
              />
            </>
          )}
        </>
      )}

      {fenetre && entier && createPortal(
        <FenetreDImport
          espace={espace} occupe={enCours} erreur={erreur}
          onImporter={(f) => { void importer(f) }} onClose={() => { setErreur(null); setFenetre(false) }}
        />,
        document.body,
      )}
    </section>
  )
}

function ListeDesImports({ espace, imports, totaux, enCours, aRetirer, onDemanderRetrait, onRetirer }: {
  espace: EspaceVentes
  imports: readonly ImportFacturesAssuranceMaladie[]
  totaux: readonly TotalEnBase[]
  enCours: boolean
  aRetirer: string | null
  onDemanderRetrait: (id: string | null) => void
  onRetirer: (id: string) => void
}) {
  if (imports.length === 0) return <p className="muted" style={{ margin: 0 }}>{VIDE_DU_FACTURE_DIT[espace]}</p>
  const recents = [...imports].reverse()
  const enConfirmation = recents.find((i) => i.id === aRetirer) ?? null
  return (
    <>
      <h4 style={{ marginBottom: 6 }}>Les imports de bordereaux</h4>
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable-etroite" aria-label="Imports des bordereaux de télétransmission">
          <thead>
            <tr><th>Importé le</th><th>Lots créés</th><th>Lots</th><th>Factures (ordre de grandeur)</th><th>Part obligatoire</th><th>Part complémentaire</th><th></th></tr>
          </thead>
          <tbody>
            {recents.map((i) => {
              const parts = partsDeLImport(i.id, totaux)
              return (
                <tr key={i.id}>
                  <td data-libelle="Importé le">{formatDate(i.importe_le)}</td>
                  <td data-libelle="Lots créés">{periodeDesLotsDite(i)}</td>
                  <td data-libelle="Lots">{i.nombre_de_lots}</td>
                  <td data-libelle="Factures (ordre de grandeur)">{facturesDites(i.nombre_de_factures)}</td>
                  <td data-libelle="Part obligatoire">{montantDit(parts.obligatoire)}</td>
                  <td data-libelle="Part complémentaire">{montantDit(parts.complementaire)}</td>
                  <td data-libelle="">
                    <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => onDemanderRetrait(i.id)}>
                      Retirer
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {enConfirmation && (
        <div role="alert" style={{ marginTop: 10 }}>
          <p style={{ marginTop: 0 }}>{confirmationDuRetraitDuFacture(enConfirmation, totaux, espace)}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" disabled={enCours} onClick={() => onDemanderRetrait(null)}>Garder</button>
            <button type="button" className="btn btn-danger" disabled={enCours} onClick={() => onRetirer(enConfirmation.id)}>
              {enCours ? 'Retrait…' : 'Retirer cet import'}
            </button>
          </div>
        </div>
      )}
      <h4 style={{ marginBottom: 6 }}>Le facturé importé</h4>
      <TableauDesTotaux totaux={totaux} libelle="Facturé importé" />
    </>
  )
}

function TableauDesTotaux({ totaux, libelle }: { totaux: readonly TotalDuFactureDit[]; libelle: string }) {
  return (
    <div className="table-scroll tableau-adaptable">
      <table className="table-empilable-etroite" aria-label={libelle}>
        <thead>
          <tr><th>Lots créés le</th><th>Organisme</th><th>Part</th><th>Facturé</th><th>Lots</th><th>Factures (ordre de grandeur)</th></tr>
        </thead>
        <tbody>
          {totaux.map((t, i) => (
            <tr key={`${t.date_creation_lot}|${t.part}|${t.regime}|${t.caisse}|${t.organisme_complementaire}|${i}`}>
              <td data-libelle="Lots créés le">{formatDate(t.date_creation_lot)}</td>
              <td data-libelle="Organisme">{organismeDuFactureDit(t)}</td>
              <td data-libelle="Part">{LIBELLES_DES_PARTS_DU_FACTURE[t.part]}</td>
              <td data-libelle="Facturé">{montantDit(t.montant_centimes)}</td>
              <td data-libelle="Lots">{t.nombre_de_lots}</td>
              <td data-libelle="Factures (ordre de grandeur)">{facturesDites(t.nombre_de_factures)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── La fenêtre d'import ────────────────────────────────────────────────────────────────────────────────────────────────
// L'envoi lu, gardé avec le choix qui l'a lu (`jeton`) : la lecture d'un choix remplacé depuis ne s'inscrit pas. Les régimes
// choisis se gardent avec le même jeton : un autre envoi repart sans choix.
interface EnvoiLu { jeton: number; fichiers: FichierDeLEnvoi[] }
interface ChoixRetenus { jeton: number; regimes: ReadonlyMap<string, number> }

function FenetreDImport({ espace, occupe, erreur, onImporter, onClose }: {
  espace: EspaceVentes
  occupe: boolean
  erreur: string | null
  onImporter: (facture: Extract<FactureDesBordereaux, { etat: 'pret' }>) => void
  onClose: () => void
}) {
  const client = espace === 'client'
  const [envoi, setEnvoi] = useState<EnvoiLu | null>(null)
  const [lectureEnCours, setLectureEnCours] = useState(false)
  const [choix, setChoix] = useState<ChoixRetenus | null>(null)
  const [aConfirmer, setAConfirmer] = useState(false)
  const dernierChoix = useRef(0)

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const choisis = Array.from(e.target.files ?? [])
    e.target.value = ''
    const jeton = ++dernierChoix.current
    setEnvoi(null)
    setChoix(null)
    setAConfirmer(false)
    if (choisis.length === 0) return
    setLectureEnCours(true)
    try {
      const fichiers: FichierDeLEnvoi[] = []
      for (const [cle, f] of choisis.entries()) {
        const trop = refusDeLaTailleDuBordereau(f.size, espace)
        // Chaque fichier s'ouvre ici, sur ses octets ; la lecture ne rejette jamais et ne rend que l'en-tête et les totaux.
        const lecture = trop ? { etat: 'refuse' as const, raison: trop } : await lireLeBordereauDeTeletransmission(f)
        if (dernierChoix.current !== jeton) return
        fichiers.push({ cle, nom: f.name, lecture })
      }
      setEnvoi({ jeton, fichiers })
    } finally {
      if (dernierChoix.current === jeton) setLectureEnCours(false)
    }
  }

  function retirerDeLEnvoi(cle: number) {
    if (!envoi) return
    setAConfirmer(false)
    setEnvoi({ jeton: envoi.jeton, fichiers: envoi.fichiers.filter((f) => f.cle !== cle) })
  }

  function choisirLeRegime(cle: string, valeur: string) {
    if (!envoi) return
    setAConfirmer(false)
    const regimes = new Map(choix?.jeton === envoi.jeton ? choix.regimes : [])
    if (valeur === '') regimes.delete(cle)
    else regimes.set(cle, Number(valeur))
    setChoix({ jeton: envoi.jeton, regimes })
  }

  // L'envoi TEL QU'IL PARTIRA, recalculé à chaque rendu : les fichiers, les régimes, les agrégats, puis le refus de la base.
  const { dits, bordereaux } = fichiersDeLEnvoi(envoi?.fichiers ?? [])
  const unRefuse = dits.some((f) => f.etat === 'refuse')
  const organismes = unRefuse ? [] : organismesAChoisir(bordereaux)
  const regimes = choix !== null && choix.jeton === envoi?.jeton ? choix.regimes : new Map<string, number>()
  const jour = aujourdHuiAParis()
  const facture = !unRefuse && bordereaux.length > 0
    ? factureDesBordereaux(bordereaux, { aujourdHui: jour, regimesChoisis: choixRetenus(organismes, regimes) })
    : null
  const refusDeLaBase = facture?.etat === 'pret' ? refusAvantLEnvoiDuFacture(facture, jour) : null
  const pret = facture?.etat === 'pret' && refusDeLaBase === null ? facture : null

  return (
    <div style={overlayStyle}>
      <div
        className="card" role="dialog" aria-modal="true" aria-labelledby="facture-am-import-titre"
        style={{ width: 'min(860px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <h2 id="facture-am-import-titre" style={{ marginTop: 0 }}>Importer des bordereaux de télétransmission</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {client
            ? 'Tes bordereaux sont lus ici, dans ton navigateur : ils ne partent nulle part. Seuls les chiffres de l’aperçu partiront, au clic.'
            : 'Les bordereaux sont lus ici, dans ce navigateur : ils ne partent nulle part. Seuls les chiffres de l’aperçu partiront, au clic.'}
        </p>

        <div className="field">
          <label htmlFor="facture-am-fichiers">Bordereaux en PDF (un ou plusieurs, 20 Mo au plus chacun)</label>
          <input
            id="facture-am-fichiers" type="file" multiple accept=".pdf,application/pdf" onChange={(e) => { void choisir(e) }}
            disabled={occupe || lectureEnCours}
          />
        </div>

        {lectureEnCours && <p className="muted">Lecture des bordereaux…</p>}

        {dits.length > 0 && (
          <>
            <h3 style={{ marginBottom: 6 }}>Les fichiers de l’envoi</h3>
            <ul style={{ paddingLeft: 18, marginTop: 0 }}>
              {dits.map((f) => (
                <li key={f.cle} style={{ marginBottom: 4 }}>
                  <span className="nom-fichier">{f.nom}</span>
                  {f.etat === 'lu'
                    ? <span>{` — ${fichierLuDit(f)}.`}</span>
                    : <span className="error-text">{` — refusé : ${f.raison}.`}</span>}
                  {' '}
                  <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => retirerDeLEnvoi(f.cle)}>
                    Retirer de l’envoi
                  </button>
                </li>
              ))}
            </ul>
            {unRefuse && <p className="error-text" role="alert">{refusDesFichiers(espace)}</p>}
          </>
        )}

        {organismes.length > 0 && (
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 10 }}>
            <legend>Les régimes à choisir</legend>
            <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>{aideDuChoixDesRegimes(espace)}</p>
            <div className="field-row">
              {organismes.map((o) => {
                const cle = cleDeLOrganisme(o)
                return (
                  <div className="field" key={cle}>
                    <label htmlFor={`facture-am-regime-${cle}`}>{`Régime de ${organismeAChoisirDit(o)}`}</label>
                    <select
                      id={`facture-am-regime-${cle}`} value={regimes.get(cle) ?? ''} disabled={occupe}
                      onChange={(e) => choisirLeRegime(cle, e.target.value)}
                    >
                      <option value="">À choisir…</option>
                      {REGIMES_OFFERTS.map((r) => <option key={r.code} value={r.code}>{r.libelle}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </fieldset>
        )}

        {facture && (
          <>
            <h3 style={{ marginBottom: 6 }}>L’aperçu</h3>
            {facture.etat === 'refuse' ? (
              <p className="error-text" role="alert">{refusDuFactureDit(facture.raison, espace)}</p>
            ) : (
              <>
                <p style={{ margin: '6px 0' }}>{resumeDit(facture.resume)}</p>
                {facture.etat === 'regimes_a_choisir' ? (
                  <p className="muted" style={{ marginTop: 0 }}>
                    {`L’aperçu attend le régime de ${facture.organismes.length} organisme${facture.organismes.length > 1 ? 's' : ''}.`}
                  </p>
                ) : (
                  <>
                    <TableauDesTotaux totaux={totauxDeLApercu(facture.agregats)} libelle="Aperçu du facturé" />
                    {refusDeLaBase && <p className="error-text" role="alert">{pourLEspace(espace, refusDeLaBase)}</p>}
                  </>
                )}
              </>
            )}
          </>
        )}

        {aConfirmer && pret && (
          <p role="status" style={{ marginBottom: 0 }}>{confirmationDeLImportDuFacture(pret.resume, pret.agregats.length, espace)}</p>
        )}
        {erreur && <p className="error-text" role="alert">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          {aConfirmer && pret ? (
            <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onImporter(pret)}>
              {occupe ? 'Import…' : 'Confirmer l’import'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={occupe || lectureEnCours || !pret} onClick={() => setAConfirmer(true)}>
              {pret ? boutonDImportDit(pret.resume.nombreDeLots) : 'Importer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
