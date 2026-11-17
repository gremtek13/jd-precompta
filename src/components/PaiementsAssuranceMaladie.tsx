import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate } from '../lib/format'
import { pourLEspace, type EspaceVentes } from '../lib/espaceVentes'
import {
  LIBELLES_ENCODAGE, LIBELLES_SEPARATEUR, SEPARATEURS, decoderLeFichier, decouperLeFichier, separateurPropose, tableauDuFichier,
  type EncodageDuFichier, type Separateur,
} from '../lib/contactsImportFichier'
import {
  PAIEMENTS_ASSURANCE_MALADIE_PREVUS, confrontationAuxPaiementsEnBase, genresDesColonnes, importAEnvoyer, lireLesPaiements,
  refusAvantLEnvoi, refusDuReglage, type ImportAEnvoyer,
} from '../lib/paiementsAssuranceMaladie'
import {
  LIBELLES_DES_PARTS, PRESENTATION_AU_CABINET, PRESENTATION_AU_CLIENT, RAPPEL_AU_CABINET, SANS_LA_CASE_BANQUE, USAGES, VIDE_DIT,
  confirmationDeLImport, confirmationDuRetrait, ecartsDits, genreDit, montantDit, organismeDit, phraseApresLImport,
  refusDeLaTailleDesPaiements, reglageChoisi, reglageVide, rejetsDits, totalDesPaiements, type ReglageDUnePartALEcran,
  type UsageDUneColonne,
} from '../lib/paiementsAssuranceMaladieVue'
import type { PaiementsLus } from '../lib/paiementsAssuranceMaladieLecture'
import { useLesPaiementsAssuranceMaladie } from '../lib/lecturePaiementsAssuranceMaladie'
import { importsAssocies, refusDuRetraitDImportDit } from '../lib/associationsAssuranceMaladieVue'
import { sectionAssuranceMaladie } from '../lib/sectionAssuranceMaladie'
import BandeauLecturePartielle from './BandeauLecturePartielle'
import type { ImportAssuranceMaladie, PaiementAssuranceMaladie } from '../lib/types'

// LES PAIEMENTS DE L'ASSURANCE MALADIE, À L'ÉCRAN (conception 53, lot NOE4 ; docs/conceptions/53-import-noemie-et-remboursements.md).
// Une section des deux espaces : l'onglet Banque du cabinet, « Ma banque » du praticien sous « Banque » (NOE-Q1). Elle ne se
// monte que sous `PAIEMENTS_ASSURANCE_MALADIE_PREVUS` levé : avant la migration, les deux tables n'existent pas.
//
// LE FICHIER NE PART NULLE PART : il est lu dans ce navigateur, par lib/paiementsAssuranceMaladie.ts (sans sortie) ; seuls les
// AGRÉGATS de l'aperçu partent, au clic, par `importer_paiements_assurance_maladie`, tout ou rien. L'écran ne montre du fichier
// que ses en-têtes et le genre de chaque colonne, jamais une valeur ; rien n'est deviné (NOE1-Q1) : le réglage part vide.
//
// UN VERROU (`ecritureEnCours`) pour les deux gestes, importer et retirer, relâché après la relecture. Une liste lue en partie
// n'offre aucun geste : un paiement déjà en base passerait pour nouveau, et l'aperçu dirait faux.
//
// LA LECTURE PARTAGÉE (NOE5b) : l'onglet Banque tient la lecture (la fiche d'un crédit et les candidats d'une vente la lisent
// aussi) et la passe ici, avec, en `children`, l'association des paiements au relevé ; « Ma banque » ne passe rien, et la
// section lit elle-même. Sous `ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES` levé, les associations se lisent avec les paiements :
// lues en partie, aucun geste ; un import dont un paiement est associé n'offre pas « Retirer », et dit pourquoi.
//
// SUR UN CODE NAF DE SANTÉ SEULEMENT (NOE4-Q1 (C), lib/sectionAssuranceMaladie.ts) : `codeNaf`, la colonne du dossier telle
// que l'écran qui monte la section l'a lue, est obligatoire ; hors de la division 86, absent, illisible ou pas encore lu, la
// section ne se monte pas — ni ses imports, ni l'association qu'elle porte. L'onglet Informations du cabinet dit pourquoi.

export interface LecturePartagee {
  lu: PaiementsLus | null
  relire: () => Promise<void>
}

export default function PaiementsAssuranceMaladie({ espace, dossierId, codeNaf, partagee, children }: {
  espace: EspaceVentes
  dossierId: string
  /** `dossiers.code_naf` tel que l'écran l'a lu : `undefined` tant qu'il ne l'est pas, `null` quand le dossier n'en a pas. */
  codeNaf: string | null | undefined
  /** La lecture que l'écran qui monte la section tient déjà ; absente, la section lit elle-même. */
  partagee?: LecturePartagee
  /** Ce qui se montre sous les imports, sur des lectures entières (l'association, côté cabinet). */
  children?: ReactNode
}) {
  if (!PAIEMENTS_ASSURANCE_MALADIE_PREVUS) return null
  if (!sectionAssuranceMaladie(codeNaf).offerte) return null
  if (partagee) return <Section key={dossierId} espace={espace} dossierId={dossierId} lecture={partagee}>{children}</Section>
  return <SectionAutonome key={dossierId} espace={espace} dossierId={dossierId} />
}

function SectionAutonome({ espace, dossierId }: { espace: EspaceVentes; dossierId: string }) {
  const lecture = useLesPaiementsAssuranceMaladie(dossierId, espace)
  return <Section espace={espace} dossierId={dossierId} lecture={lecture} />
}

function Section({ espace, dossierId, lecture, children }: {
  espace: EspaceVentes; dossierId: string; lecture: LecturePartagee; children?: ReactNode
}) {
  const client = espace === 'client'
  const [fenetre, setFenetre] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [apres, setApres] = useState<string | null>(null)
  const [aRetirer, setARetirer] = useState<string | null>(null)
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const relire = lecture.relire
  const lu = lecture.lu?.dossierId === dossierId ? lecture.lu : null
  const entier = lu?.etat === 'lus' && lu.imports.complete && lu.paiements.complete
    && (lu.associations === null || lu.associations.complete) ? lu : null
  // Les imports dont un paiement est associé à un crédit : leur retrait se refuse, et se dit avant le clic.
  const associes = entier ? importsAssocies(entier.paiements.lignes, entier.associations) : null

  async function importer(imp: ImportAEnvoyer) {
    if (ecritureEnCours.current || !entier) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    setApres(null)
    try {
      const { error } = await supabase.rpc('importer_paiements_assurance_maladie', { p_dossier_id: dossierId, p_import: imp })
      if (error) {
        setErreur(pourLEspace(espace, messageErreur(error, 'L’import n’a pas pu se faire.')))
        return
      }
      setFenetre(false)
      setApres(phraseApresLImport(espace))
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
      const { error } = await supabase.rpc('retirer_import_assurance_maladie', { p_import_id: importId })
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
    <section className="card" aria-labelledby="paiements-am-titre" style={{ marginBottom: 20 }}>
      <h3 id="paiements-am-titre" style={{ marginTop: 0 }}>Paiements de l’assurance maladie</h3>
      <p className="muted" style={{ marginTop: 0 }}>{client ? PRESENTATION_AU_CLIENT : PRESENTATION_AU_CABINET}</p>
      {!client && <p className="muted" style={{ marginTop: 0 }}>{RAPPEL_AU_CABINET}</p>}

      {lu === null ? (
        <p className="muted">Chargement…</p>
      ) : lu.etat === 'echec' ? (
        <p className="error-text">
          {client
            ? `Tes paiements de l’assurance maladie ne s’affichent pas : ${lu.motif}. Rien ne t’est proposé. Recharge la page.`
            : `Les paiements de l’assurance maladie ne s’affichent pas : ${lu.motif}. Aucun import n’est offert.`}
        </p>
      ) : lu.etat === 'sans_banque' ? (
        <p className="muted">{SANS_LA_CASE_BANQUE}</p>
      ) : (
        <>
          <BandeauLecturePartielle
            quoi={client ? 'Tes imports' : 'Les imports'} accord="lus" motif={lu.imports.motif} technique={false}
            consequence={client
              ? 'Ils ne s’affichent pas, et rien ne t’est proposé : un import déjà fait passerait pour absent. Recharge la page.'
              : 'Ils ne s’affichent pas, et aucun geste n’est offert : un import déjà fait passerait pour absent.'}
          />
          <BandeauLecturePartielle
            quoi={client ? 'Tes paiements importés' : 'Les paiements importés'} accord="lus" motif={lu.paiements.motif} technique={false}
            consequence={client
              ? 'Ils ne s’affichent pas, et rien ne t’est proposé : un paiement déjà importé passerait pour nouveau. Recharge la page.'
              : 'Ils ne s’affichent pas, et aucun geste n’est offert : un paiement déjà importé passerait pour nouveau.'}
          />
          {lu.associations && (
            <BandeauLecturePartielle
              quoi={client ? 'Les associations de tes paiements à ton relevé' : 'Les associations des paiements au relevé'} accord="lues"
              motif={lu.associations.motif} technique={false}
              consequence={client
                ? 'Rien ne t’est proposé : un import associé paraîtrait libre. Recharge la page.'
                : 'Aucun geste n’est offert : un import associé paraîtrait libre, un paiement associé se proposerait de nouveau.'}
            />
          )}
          {apres && <p role="status">{apres}</p>}
          {erreur && !fenetre && <p className="error-text" role="alert">{erreur}</p>}
          {entier && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <button type="button" className="btn btn-primary" disabled={enCours} onClick={() => { setErreur(null); setApres(null); setFenetre(true) }}>
                  Importer un fichier de paiements
                </button>
              </div>
              <ListeDesImports
                espace={espace} imports={entier.imports.lignes} paiements={entier.paiements.lignes} enCours={enCours}
                associes={associes ?? new Set()}
                aRetirer={aRetirer} onDemanderRetrait={setARetirer} onRetirer={(id) => { void retirer(id) }}
              />
              {children}
            </>
          )}
        </>
      )}

      {fenetre && entier && createPortal(
        <FenetreDImport
          espace={espace} enBase={entier.paiements.lignes} occupe={enCours} erreur={erreur}
          onImporter={(imp) => { void importer(imp) }} onClose={() => { setErreur(null); setFenetre(false) }}
        />,
        document.body,
      )}
    </section>
  )
}

function ListeDesImports({ espace, imports, paiements, enCours, associes, aRetirer, onDemanderRetrait, onRetirer }: {
  espace: EspaceVentes
  imports: readonly ImportAssuranceMaladie[]
  paiements: readonly PaiementAssuranceMaladie[]
  enCours: boolean
  /** Les imports dont un paiement est associé à un crédit du relevé : « Retirer » s'y refuse, avant le clic. */
  associes: ReadonlySet<string>
  aRetirer: string | null
  onDemanderRetrait: (id: string | null) => void
  onRetirer: (id: string) => void
}) {
  if (imports.length === 0) return <p className="muted" style={{ margin: 0 }}>{VIDE_DIT[espace]}</p>
  const recents = [...imports].reverse()
  const enConfirmation = recents.find((i) => i.id === aRetirer && !associes.has(i.id)) ?? null
  return (
    <>
      <h4 style={{ marginBottom: 6 }}>Les imports</h4>
      <div className="tableau-adaptable">
        <table className="table-empilable-etroite" aria-label="Imports des paiements de l’assurance maladie">
          <thead><tr><th>Importé le</th><th>Journées</th><th>Paiements</th><th>Total</th><th>Rejets</th><th></th></tr></thead>
          <tbody>
            {recents.map((i) => {
              const siens = paiements.filter((p) => p.import_id === i.id)
              return (
                <tr key={i.id}>
                  <td data-libelle="Importé le">{formatDate(i.importe_le)}</td>
                  <td data-libelle="Journées">{`du ${formatDate(i.periode_du)} au ${formatDate(i.periode_au)}`}</td>
                  <td data-libelle="Paiements">{siens.length}</td>
                  <td data-libelle="Total">{montantDit(totalDesPaiements(siens))}</td>
                  <td data-libelle="Rejets">{rejetsDits({ nombre: i.nombre_de_rejets, montant_centimes: i.montant_rejete_centimes })}</td>
                  <td data-libelle="">
                    {associes.has(i.id) ? (
                      <span className="muted" style={{ fontSize: '0.85rem' }}>{refusDuRetraitDImportDit(espace)}</span>
                    ) : (
                      <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => onDemanderRetrait(i.id)}>
                        Retirer
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {enConfirmation && (
        <div role="alert" style={{ marginTop: 10 }}>
          <p style={{ marginTop: 0 }}>{confirmationDuRetrait(enConfirmation, paiements, espace)}</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" disabled={enCours} onClick={() => onDemanderRetrait(null)}>Garder</button>
            <button type="button" className="btn btn-danger" disabled={enCours} onClick={() => onRetirer(enConfirmation.id)}>
              {enCours ? 'Retrait…' : 'Retirer cet import'}
            </button>
          </div>
        </div>
      )}
      <h4 style={{ marginBottom: 6 }}>Les paiements importés</h4>
      <TableauDesPaiements paiements={paiements} libelle="Paiements importés" />
    </>
  )
}

function TableauDesPaiements({ paiements, libelle }: {
  paiements: readonly Pick<PaiementAssuranceMaladie, 'date_journee_comptable' | 'regime' | 'caisse' | 'part' | 'montant_centimes' | 'regularisations_centimes' | 'nombre_de_factures'>[]
  libelle: string
}) {
  return (
    <div className="tableau-adaptable">
      <table className="table-empilable-etroite" aria-label={libelle}>
        <thead>
          <tr><th>Journée comptable</th><th>Organisme</th><th>Part</th><th>Net payé</th><th>Régularisations</th><th>Factures</th></tr>
        </thead>
        <tbody>
          {paiements.map((p) => (
            <tr key={`${p.date_journee_comptable}|${p.regime}|${p.caisse}|${p.part}`}>
              <td data-libelle="Journée comptable">{formatDate(p.date_journee_comptable)}</td>
              <td data-libelle="Organisme">{organismeDit(p.regime, p.caisse)}</td>
              <td data-libelle="Part">{LIBELLES_DES_PARTS[p.part]}</td>
              <td data-libelle="Net payé">{montantDit(p.montant_centimes)}</td>
              <td data-libelle="Régularisations">{p.regularisations_centimes === 0 ? '—' : montantDit(p.regularisations_centimes)}</td>
              <td data-libelle="Factures">{p.nombre_de_factures}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── La fenêtre d'import ────────────────────────────────────────────────────────────────────────────────────────────────
// Le fichier lu, gardé avec le choix qui l'a lu (`jeton`) : la lecture d'un fichier remplacé depuis ne s'inscrit pas.
type FichierLu = { jeton: number; texte: string; encodage: EncodageDuFichier } | { jeton: number; refus: string }

// Le réglage, gardé avec la STRUCTURE pour laquelle il a été fait : un autre fichier, un autre séparateur ou l'en-tête changé
// ont d'autres colonnes, et le réglage repart vide.
interface ReglageRetenu { cle: string; parts: ReglageDUnePartALEcran[] }

function FenetreDImport({ espace, enBase, occupe, erreur, onImporter, onClose }: {
  espace: EspaceVentes
  enBase: readonly PaiementAssuranceMaladie[]
  occupe: boolean
  erreur: string | null
  onImporter: (imp: ImportAEnvoyer) => void
  onClose: () => void
}) {
  const client = espace === 'client'
  const [fichier, setFichier] = useState<FichierLu | null>(null)
  const [lectureEnCours, setLectureEnCours] = useState(false)
  const [separateur, setSeparateur] = useState<Separateur>(';')
  const [enTete, setEnTete] = useState(true)
  const [reglage, setReglage] = useState<ReglageRetenu | null>(null)
  const [aConfirmer, setAConfirmer] = useState(false)
  const dernierChoix = useRef(0)

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    const jeton = ++dernierChoix.current
    setFichier(null)
    setReglage(null)
    setAConfirmer(false)
    if (!f) return
    const refus = refusDeLaTailleDesPaiements(f.size, espace)
    if (refus) {
      setFichier({ jeton, refus })
      return
    }
    setLectureEnCours(true)
    try {
      const octets = new Uint8Array(await f.arrayBuffer())
      if (dernierChoix.current !== jeton) return
      const lu = decoderLeFichier(octets, espace)
      if ('refus' in lu) {
        setFichier({ jeton, refus: lu.refus })
        return
      }
      setFichier({ jeton, texte: lu.texte, encodage: lu.encodage })
      setSeparateur(separateurPropose(lu.texte))
      setEnTete(true)
    } catch (err) {
      // Jamais la valeur d'une cellule : le message d'une lecture ratée ne porte que la raison.
      if (dernierChoix.current === jeton) setFichier({ jeton, refus: messageErreur(err, 'Ce fichier n’a pas pu être lu.') })
    } finally {
      if (dernierChoix.current === jeton) setLectureEnCours(false)
    }
  }

  const texte = fichier && 'texte' in fichier ? fichier.texte : null
  const decoupe = useMemo(() => (texte == null ? null : decouperLeFichier(texte, separateur, espace)), [texte, separateur, espace])
  const tableau = useMemo(
    () => (decoupe && 'enregistrements' in decoupe ? tableauDuFichier(decoupe.enregistrements, enTete) : null),
    [decoupe, enTete],
  )
  const genres = useMemo(() => (tableau ? genresDesColonnes(tableau.lignes, tableau.colonnes.length) : []), [tableau])
  const cle = fichier ? `${fichier.jeton}|${separateur}|${enTete}` : ''
  const parts = reglage?.cle === cle ? reglage.parts : reglageVide()

  function changer(index: number, change: Partial<ReglageDUnePartALEcran>) {
    setAConfirmer(false)
    setReglage({ cle, parts: parts.map((p, i) => (i === index ? { ...p, ...change } : p)) })
  }
  function choisirColonne(index: number, usage: UsageDUneColonne, valeur: string) {
    const p = parts[index]
    changer(index, { colonnes: { ...p.colonnes, [usage]: valeur === '' ? null : Number(valeur) } })
  }

  // La saisie TELLE QU'ELLE PART : le réglage, puis la lecture, puis l'import et ses refus, recalculés à chaque rendu.
  const choisi = tableau ? reglageChoisi(parts, espace) : null
  const refusReglage = tableau && choisi?.reglage ? refusDuReglage(choisi.reglage, tableau.colonnes.length) : null
  const lecture = tableau && choisi?.reglage && !refusReglage ? lireLesPaiements(tableau.lignes, choisi.reglage) : null
  const imp = lecture ? importAEnvoyer(lecture) : null
  const refus = imp ? refusAvantLEnvoi(imp, aujourdHuiAParis(), enBase) : null
  const dejaImportes = imp ? confrontationAuxPaiementsEnBase(imp, enBase).dejaImportes : 0
  const pret = imp !== null && refus === null

  return (
    <div style={overlayStyle}>
      <div
        className="card" role="dialog" aria-modal="true" aria-labelledby="paiements-am-import-titre"
        style={{ width: 'min(860px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <h2 id="paiements-am-import-titre" style={{ marginTop: 0 }}>Importer des paiements de l’assurance maladie</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {client
            ? 'Ton fichier est lu ici, dans ton navigateur : il ne part nulle part. Seuls les chiffres de l’aperçu partiront, au clic.'
            : 'Le fichier est lu ici, dans ce navigateur : il ne part nulle part. Seuls les chiffres de l’aperçu partiront, au clic.'}
        </p>

        <div className="field">
          <label htmlFor="paiements-am-fichier">Fichier CSV (10 Mo au plus)</label>
          <input
            id="paiements-am-fichier" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choisir}
            disabled={occupe || lectureEnCours}
          />
        </div>

        {lectureEnCours && <p className="muted">Lecture du fichier…</p>}
        {fichier && 'refus' in fichier && <p className="error-text" role="alert">{fichier.refus}</p>}

        {fichier && 'texte' in fichier && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>{`Encodage : ${LIBELLES_ENCODAGE[fichier.encodage]}.`}</p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="paiements-am-separateur">Séparateur des colonnes</label>
                <select
                  id="paiements-am-separateur" value={separateur} disabled={occupe}
                  onChange={(e) => { setAConfirmer(false); setSeparateur(e.target.value as Separateur) }}
                >
                  {SEPARATEURS.map((s) => <option key={s} value={s}>{LIBELLES_SEPARATEUR[s]}</option>)}
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={enTete} disabled={occupe} onChange={(e) => { setAConfirmer(false); setEnTete(e.target.checked) }} />
                  La première ligne est un en-tête (les noms des colonnes)
                </label>
              </div>
            </div>

            {decoupe && 'refus' in decoupe && <p className="error-text" role="alert">{decoupe.refus}</p>}

            {tableau && (
              <>
                <h3 style={{ marginBottom: 6 }}>Les colonnes du fichier</h3>
                <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                  {`${tableau.lignes.length} ligne${tableau.lignes.length > 1 ? 's' : ''}${enTete ? ', l’en-tête ôté' : ''}. `
                    + 'Chaque colonne se montre par son nom et son genre, jamais par ses valeurs.'}
                </p>
                <div className="tableau-adaptable">
                  <table className="table-empilable-etroite" aria-label="Colonnes du fichier">
                    <thead><tr><th>Colonne</th><th>Genre</th></tr></thead>
                    <tbody>
                      {tableau.colonnes.map((nom, i) => (
                        <tr key={i}>
                          <td data-libelle="Colonne">{nom}</td>
                          <td data-libelle="Genre">{genreDit(genres[i])}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 style={{ marginBottom: 6 }}>Le réglage des colonnes</h3>
                <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                  {client
                    ? 'Une ligne du fichier est une facture. Pour chaque part que ton fichier porte, choisis sa colonne de journée comptable et de montant, et, si ton fichier les a, celles du statut et de l’organisme. Rien n’est choisi pour toi.'
                    : 'Une ligne du fichier est une facture. Pour chaque part que le fichier porte, choisir sa colonne de journée comptable et de montant, et, si le fichier les a, celles du statut et de l’organisme. Rien n’est choisi d’avance.'}
                </p>
                {parts.map((p, index) => (
                  <fieldset key={p.part} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', marginBottom: 10 }}>
                    <legend>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={p.retenue} disabled={occupe} onChange={(e) => changer(index, { retenue: e.target.checked })} />
                        {LIBELLES_DES_PARTS[p.part]}
                      </label>
                    </legend>
                    {p.retenue && (
                      <div className="field-row">
                        {USAGES.map((u) => (
                          <div className="field" key={u.usage}>
                            <label htmlFor={`paiements-am-${p.part}-${u.usage}`}>{u.libelle}</label>
                            <select
                              id={`paiements-am-${p.part}-${u.usage}`} value={p.colonnes[u.usage] ?? ''} disabled={occupe}
                              onChange={(e) => choisirColonne(index, u.usage, e.target.value)}
                            >
                              <option value="">{u.obligatoire ? 'À choisir…' : 'Aucune'}</option>
                              {tableau.colonnes.map((nom, i) => <option key={i} value={i}>{nom}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </fieldset>
                ))}

                <h3 style={{ marginBottom: 6 }}>L’aperçu</h3>
                {choisi?.manque ? (
                  <p className="muted" style={{ marginTop: 0 }}>{`L’aperçu attend : ${choisi.manque}`}</p>
                ) : refusReglage ? (
                  <p className="error-text" role="alert">{refusReglage}</p>
                ) : lecture && (
                  <>
                    {ecartsDits(lecture).map((phrase) => <p key={phrase} className="muted" style={{ margin: '0 0 4px' }}>{phrase}</p>)}
                    {imp === null ? (
                      <p className="error-text" role="alert">
                        {client
                          ? 'Aucun paiement ne se lit dans ce fichier avec ce réglage : rien ne peut partir. Vérifie les colonnes choisies.'
                          : 'Aucun paiement ne se lit dans ce fichier avec ce réglage : rien ne peut partir. Vérifier les colonnes choisies.'}
                      </p>
                    ) : (
                      <>
                        <p style={{ margin: '6px 0' }}>
                          {`${imp.paiements.length} paiement${imp.paiements.length > 1 ? 's' : ''}, ${montantDit(totalDesPaiements(imp.paiements))} `
                            + `au total ; ${rejetsDits(imp.rejets)}.`}
                        </p>
                        <TableauDesPaiements paiements={imp.paiements} libelle="Aperçu des paiements" />
                        {refus && <p className="error-text" role="alert">{pourLEspace(espace, refus)}</p>}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {aConfirmer && imp && pret && (
          <p role="status" style={{ marginBottom: 0 }}>{confirmationDeLImport(imp, dejaImportes, espace)}</p>
        )}
        {erreur && <p className="error-text" role="alert">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          {aConfirmer && imp && pret ? (
            <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => onImporter(imp)}>
              {occupe ? 'Import…' : 'Confirmer l’import'}
            </button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={occupe || !pret} onClick={() => setAConfirmer(true)}>
              {imp && pret ? `Importer ${imp.paiements.length - dejaImportes} paiement${imp.paiements.length - dejaImportes > 1 ? 's' : ''}` : 'Importer'}
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
