import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { nomDansUnRefus } from '../../lib/articles'
import { TYPES_CLIENT_CONTACT, type ContactEnvoye, type ContactPourSiret } from '../../lib/contacts'
import { LIGNES_PAR_IMPORT_MAX, refusDuNombreDeLignes } from '../../lib/contactsImport'
import {
  CHAMPS_DANS_L_ORDRE, LIBELLES_DES_CHAMPS, LIBELLES_ENCODAGE, LIBELLES_SEPARATEUR, SEPARATEURS, TAILLE_FICHIER_IMPORT_MAX,
  apercuDeLImport, choisirPourLaColonne, colonnesProposees, decoderLeFichier, decouperLeFichier, etatDeLaCorrespondance,
  lignesAImporter, refusDeLaTaille, separateurPropose, tableauDuFichier, typePropose, valeurDuType, valeursDuType,
  type ChampDUnContact, type ChoixDeColonne, type EncodageDuFichier, type Separateur,
} from '../../lib/contactsImportFichier'
import { poids } from '../../lib/bornesStockage'
import { LIBELLES_TYPE_CONTACT } from '../../lib/contactsVue'
import type { ArticleExoneration, TypeClient } from '../../lib/types'

// « IMPORTER DES CLIENTS » (espace client, étape A4b3b ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU
// CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4, « L'usage » : un aperçu, ligne par ligne, avec les refus de la
// fonction redits ; rien ne s'écrit avant le clic, et tout ou rien). La fenêtre de la vue « Clients », au cabinet et au client
// « Ventes » : choisir un fichier CSV, dire comment il se lit (encodage, séparateur, en-tête), faire correspondre ses colonnes
// aux champs d'un contact, voir l'aperçu, importer.
//
// LE FICHIER NE PART NULLE PART : il est lu ici, dans le navigateur ; seules les lignes que le bouton envoie atteignent la base.
//
// LA FENÊTRE NE JUGE RIEN : la lecture du fichier et la correspondance sont celles de `lib/contactsImportFichier.ts`, les refus
// ceux de `lib/contactsImport.ts` (ceux de la base, dans son ordre et sous ses mots), contre la liste que la vue a lue EN
// ENTIER — elle ne s'ouvre pas sur une liste lue en partie. L'écriture, son verrou (`gesteEnCours`, celui des quatre gestes)
// et la relecture sont ceux de la vue : ici, ni appel ni état d'écriture.
interface Props {
  dossierId: string
  espace: EspaceVentes
  articleExoneration: ArticleExoneration | null
  // La liste LUE EN ENTIER : l'unicité d'un SIRET s'y juge. La vue n'ouvre rien sur une lecture partielle.
  contacts: readonly ContactPourSiret[]
  // Une écriture est en cours (la vue tient le verrou) ; l'erreur qu'elle a rendue, sous les mots de la base.
  occupe: boolean
  erreur: string | null
  onImporter: (lignes: ContactEnvoye[]) => void
  onClose: () => void
}

// Le fichier lu : son texte et son encodage, ou le refus à dire. `jeton` : le choix de fichier qui l'a lu — la correspondance
// est gardée AVEC lui, et un autre fichier repart des propositions.
type FichierLu = { jeton: number; taille: number; texte: string; encodage: EncodageDuFichier } | { jeton: number; refus: string }

// La correspondance choisie, gardée avec la STRUCTURE pour laquelle elle a été faite (le fichier, le séparateur, l'en-tête) :
// une autre structure a d'autres colonnes, et repart des propositions.
interface Correspondance {
  cle: string
  choix: ChoixDeColonne[]
  // Les types choisis à la main pour les valeurs de la colonne du type (celle dont l'index est gardé) ; une valeur absente
  // d'ici prend le type proposé.
  colonneDuType: number | null
  typesChoisis: Record<string, TypeClient | null>
  typeUnique: TypeClient | null
}

const pluriel = (n: number, mot: string, marque = 's') => `${n} ${mot}${n > 1 ? marque : ''}`
const NON_RECONNUE = 'non_reconnue'
// La borne d'un import, chiffres groupés (« 1 000 ») : le texte la lit dans le module, jamais recopiée.
const MAX_DIT = new Intl.NumberFormat('fr-FR').format(LIGNES_PAR_IMPORT_MAX)
// Un texte du fichier se coupe ENTRE ses mots ; un mot plus long que sa case seulement s'y coupe aussi. `overflow-wrap: anywhere`
// (`.nom-fichier`) réduirait la colonne à sa plus petite lettre, et chaque mot s'y couperait dès que la sélection voisine est large.
const MOT_ENTIER: CSSProperties = { overflowWrap: 'break-word' }

export default function ContactsImportModal({ dossierId, espace, articleExoneration, contacts, occupe, erreur, onImporter, onClose }: Props) {
  const client = espace === 'client'
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [fichier, setFichier] = useState<FichierLu | null>(null)
  const [lectureEnCours, setLectureEnCours] = useState(false)
  const [separateur, setSeparateur] = useState<Separateur>(';')
  const [enTete, setEnTete] = useState(true)
  const [correspondance, setCorrespondance] = useState<Correspondance | null>(null)
  // Le dernier choix de fichier : la lecture d'un fichier remplacé depuis ne s'inscrit pas.
  const dernierChoix = useRef(0)

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    // Remis à vide pour qu'on puisse reprendre le MÊME fichier corrigé.
    e.target.value = ''
    const jeton = ++dernierChoix.current
    setFichier(null)
    setCorrespondance(null)
    if (!f) return
    // La borne d'abord, sur la taille que le navigateur donne : rien n'est lu au-delà.
    const refus = refusDeLaTaille(f.size, espace)
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
      setFichier({ jeton, taille: octets.byteLength, texte: lu.texte, encodage: lu.encodage })
      setSeparateur(separateurPropose(lu.texte))
      setEnTete(true)
    } catch (err) {
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
  const cle = fichier ? `${fichier.jeton}|${separateur}|${enTete}` : ''
  const proposes = useMemo(() => (tableau ? colonnesProposees(tableau.colonnes) : []), [tableau])
  const courante: Correspondance | null = tableau == null ? null
    : correspondance?.cle === cle ? correspondance
      : { cle, choix: proposes, colonneDuType: null, typesChoisis: {}, typeUnique: null }

  const etat = tableau && courante ? etatDeLaCorrespondance(tableau.colonnes, { choix: courante.choix, valeursDuType: {}, typeUnique: courante.typeUnique }) : null
  const colonneDuType = etat?.colonneDuType ?? null
  const valeurs = tableau && colonneDuType != null ? valeursDuType(tableau.lignes, colonneDuType) : []
  // Les types choisis à la main ne valent que pour la colonne où ils l'ont été.
  const typesChoisis = courante && courante.colonneDuType === colonneDuType ? courante.typesChoisis : {}
  const typeDe = (v: string): TypeClient | null => (Object.hasOwn(typesChoisis, v) ? typesChoisis[v] : typePropose(v))

  // Le nombre de lignes d'abord (aucune, ou plus de mille) : le refus du module passe avant la correspondance et l'aperçu.
  const refusDuNombre = tableau ? refusDuNombreDeLignes(tableau.lignes.length) : null
  const pret = tableau != null && courante != null && etat != null && refusDuNombre == null
    && etat.aChoisir.length === 0 && !etat.typeAChoisir
  // Recalculés à chaque rendu : la fenêtre n'a aucun champ de texte, un rendu suit un choix, jamais une frappe.
  const lignes = pret && tableau && courante
    ? lignesAImporter(tableau, {
      choix: courante.choix, valeursDuType: Object.fromEntries(valeurs.map((v) => [v, typeDe(v)])), typeUnique: courante.typeUnique,
    })
    : null
  const apercu = lignes ? apercuDeLImport(dossierId, articleExoneration, lignes, contacts) : null

  function changer(c: Partial<Correspondance>) {
    if (!courante) return
    setCorrespondance({ ...courante, colonneDuType, typesChoisis, ...c, cle })
  }

  function choisirChamp(index: number, valeur: string) {
    if (!courante) return
    const v: ChoixDeColonne = valeur === '' ? null : (valeur as ChampDUnContact | 'ne_pas_importer')
    changer({ choix: choisirPourLaColonne(courante.choix, index, v) })
  }

  const importables = apercu && apercu.refusDuFichier == null && apercu.refusees === 0 ? apercu.lignes.length : 0

  return (
    <div style={overlayStyle}>
      <div
        className="card" role="dialog" aria-modal="true" aria-labelledby="contacts-import-titre"
        style={{ width: 'min(860px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <h2 id="contacts-import-titre" style={{ marginTop: 0 }}>Importer des clients</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {client
            ? `Un fichier CSV — celui de ton ancien logiciel, ou un tableau enregistré en CSV —, lu ici, dans ton navigateur : il ne part `
              + `nulle part. Tu fais correspondre ses colonnes aux champs d’un client, tu vois ce que chaque ligne donnerait, puis tu `
              + `importes : ${MAX_DIT} lignes au plus, d’un seul tenant — si une ligne est refusée, rien ne s’importe. `
              + 'Un client déjà rangé n’est jamais modifié.'
            : `Un fichier CSV — celui de l’ancien logiciel du client, ou un tableau enregistré en CSV —, lu ici, dans le navigateur : il ne `
              + `part nulle part. Ses colonnes se font correspondre aux champs d’un contact, l’aperçu dit ce que chaque ligne donnerait, `
              + `puis l’import se fait : ${MAX_DIT} lignes au plus, d’un seul tenant — si une ligne est refusée, rien ne `
              + 's’importe. Un contact déjà rangé n’est jamais modifié. Le client qui porte la case « Ventes » lit ce que l’import range.'}
        </p>

        <div className="field">
          <label htmlFor="contacts-import-fichier">{`Fichier CSV (${poids(TAILLE_FICHIER_IMPORT_MAX)} au plus)`}</label>
          <input
            id="contacts-import-fichier" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={choisir}
            disabled={occupe || lectureEnCours}
          />
        </div>

        {lectureEnCours && <p className="muted">Lecture du fichier…</p>}
        {fichier && 'refus' in fichier && <p className="error-text" role="alert">{fichier.refus}</p>}

        {fichier && 'texte' in fichier && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {`Lu : ${poids(fichier.taille)}, encodage ${LIBELLES_ENCODAGE[fichier.encodage]}.`}
            </p>
            <div className="field-row">
              <div className="field">
                <label htmlFor="contacts-import-separateur">
                  {`Séparateur des colonnes (proposé d’après la première ligne : ${LIBELLES_SEPARATEUR[separateurPropose(fichier.texte)]})`}
                </label>
                <select
                  id="contacts-import-separateur" value={separateur} disabled={occupe}
                  onChange={(e) => setSeparateur(e.target.value as Separateur)}
                >
                  {SEPARATEURS.map((s) => <option key={s} value={s}>{LIBELLES_SEPARATEUR[s]}</option>)}
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={enTete} disabled={occupe} onChange={(e) => setEnTete(e.target.checked)} />
                  La première ligne est un en-tête (les noms des colonnes)
                </label>
              </div>
            </div>

            {decoupe && 'refus' in decoupe && <p className="error-text" role="alert">{decoupe.refus}</p>}

            {tableau && decoupe && 'enregistrements' in decoupe && (
              <>
                <p style={{ marginTop: 0 }}>
                  {`${pluriel(tableau.lignes.length, 'ligne')} de clients${enTete ? ', l’en-tête ôté' : ''}`}
                  {decoupe.vides > 0 ? ` ; ${pluriel(decoupe.vides, 'ligne')} blanche${decoupe.vides > 1 ? 's' : ''}, ignorée${decoupe.vides > 1 ? 's' : ''}.` : '.'}
                </p>

                {refusDuNombre ? (
                  <p className="error-text" role="alert">{dire(refusDuNombre.message)}</p>
                ) : courante && etat && (
                  <>
                    <h3 style={{ marginBottom: 6 }}>Les colonnes</h3>
                    <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                      {client
                        ? 'Chaque colonne va à un champ d’un client, ou, si tu le choisis, n’est pas importée. Un champ ne sert qu’une fois : '
                          + 'le choisir pour une colonne le retire à celle qui l’avait. Un champ « proposé » l’est d’après le nom de la colonne ; '
                          + 'tu peux le changer.'
                        : 'Chaque colonne va à un champ d’un contact, ou, explicitement, n’est pas importée. Un champ ne sert qu’une fois : '
                          + 'le choisir pour une colonne le retire à celle qui l’avait. Un champ « proposé » l’est d’après le nom de la colonne, '
                          + 'et se change.'}
                    </p>
                    <div className="tableau-adaptable">
                      <table className="table-empilable-etroite" aria-label="Colonnes du fichier">
                        <thead><tr><th>Colonne</th><th>Première valeur</th><th>Champ</th></tr></thead>
                        <tbody>
                          {tableau.colonnes.map((nom, i) => {
                            const exemple = tableau.lignes.map((l) => l.cellules[i] ?? '').find((v) => v.trim() !== '')
                            const choix = courante.choix[i]
                            const propose = choix != null && choix === proposes[i]
                            return (
                              <tr key={i}>
                                <td data-libelle="Colonne"><span style={MOT_ENTIER}>{nom}</span></td>
                                <td data-libelle="Première valeur">
                                  {exemple === undefined ? <span className="muted">vide</span> : <span style={MOT_ENTIER}>{nomDansUnRefus(exemple)}</span>}
                                </td>
                                <td data-libelle="Champ">
                                    <select
                                      aria-label={`Champ de la colonne « ${nom} »`} value={choix ?? ''} disabled={occupe}
                                      onChange={(e) => choisirChamp(i, e.target.value)}
                                    >
                                      <option value="">À choisir…</option>
                                      {CHAMPS_DANS_L_ORDRE.map((c) => <option key={c} value={c}>{LIBELLES_DES_CHAMPS[c]}</option>)}
                                      <option value="ne_pas_importer">Ne pas importer</option>
                                    </select>
                                  {propose && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>proposé</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <h3 style={{ marginBottom: 6 }}>Le type de chaque client</h3>
                    {colonneDuType == null ? (
                      <div className="field">
                        <label htmlFor="contacts-import-type-unique">
                          {client
                            ? 'Aucune colonne ne donne le type : choisis-en un pour tout le fichier'
                            : 'Aucune colonne ne donne le type : en choisir un pour tout le fichier'}
                        </label>
                        <select
                          id="contacts-import-type-unique" value={courante.typeUnique ?? ''} disabled={occupe}
                          onChange={(e) => changer({ typeUnique: e.target.value === '' ? null : (e.target.value as TypeClient) })}
                        >
                          <option value="">À choisir…</option>
                          {TYPES_CLIENT_CONTACT.map((t) => <option key={t} value={t}>{LIBELLES_TYPE_CONTACT[t]}</option>)}
                        </select>
                      </div>
                    ) : (
                      <>
                        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
                          {`La colonne « ${tableau.colonnes[colonneDuType]} » donne le type. Chacune de ses valeurs va à l’un des quatre types de la `
                            + 'facture ; une valeur « non reconnue » refuse sa ligne.'}
                        </p>
                        <div className="tableau-adaptable">
                          <table className="table-empilable-etroite" aria-label="Valeurs du type">
                            <thead><tr><th>Valeur</th><th>Lignes</th><th>Type</th></tr></thead>
                            <tbody>
                              {valeurs.map((v) => {
                                const type = typeDe(v)
                                const propose = !Object.hasOwn(typesChoisis, v) && type != null
                                const nombre = tableau.lignes.filter((l) => valeurDuType(l.cellules[colonneDuType]) === v).length
                                return (
                                  <tr key={v}>
                                    <td data-libelle="Valeur">{v === '' ? <span className="muted">(vide)</span> : <span style={MOT_ENTIER}>{nomDansUnRefus(v)}</span>}</td>
                                    <td data-libelle="Lignes">{nombre}</td>
                                    <td data-libelle="Type">
                                        <select
                                          aria-label={`Type de la valeur « ${v === '' ? '(vide)' : v} »`} value={type ?? NON_RECONNUE} disabled={occupe}
                                          onChange={(e) => changer({
                                            typesChoisis: { ...typesChoisis, [v]: e.target.value === NON_RECONNUE ? null : (e.target.value as TypeClient) },
                                          })}
                                        >
                                          <option value={NON_RECONNUE}>Non reconnue (refuse sa ligne)</option>
                                          {TYPES_CLIENT_CONTACT.map((t) => <option key={t} value={t}>{LIBELLES_TYPE_CONTACT[t]}</option>)}
                                        </select>
                                      {propose && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>proposé</span>}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    <h3 style={{ marginBottom: 6 }}>L’aperçu</h3>
                    {!apercu ? (
                      <p className="muted" style={{ marginTop: 0 }}>
                        {'L’aperçu attend : '
                          + [
                            etat.aChoisir.length > 0
                              ? `${etat.aChoisir.length > 1 ? 'les colonnes' : 'la colonne'} ${etat.aChoisir.map((n) => `« ${n} »`).join(', ')} à choisir`
                              : null,
                            etat.typeAChoisir ? 'le type à choisir' : null,
                          ].filter(Boolean).join(' ; ') + '.'}
                      </p>
                    ) : (
                      <>
                        <p style={{ marginTop: 0 }}>
                          {`${pluriel(apercu.lignes.length, 'ligne')}, ${pluriel(apercu.refusees, 'refusée')}. `}
                          {etat.nonImportees.length > 0
                            ? `Non ${etat.nonImportees.length > 1 ? 'importées' : 'importée'} : ${etat.nonImportees.map((n) => `« ${n} »`).join(', ')}.`
                            : 'Toutes les colonnes sont importées.'}
                        </p>
                        {apercu.refusees > 0 ? (
                          <div role="alert">
                            <p className="error-text" style={{ marginBottom: 6 }}>
                              {client
                                ? 'Rien ne s’importe tant qu’une ligne est refusée : l’import range tout, ou rien. Corrige le fichier ou la '
                                  + 'correspondance, puis reprends-le.'
                                : 'Rien ne s’importe tant qu’une ligne est refusée : l’import range tout, ou rien. Corriger le fichier ou la '
                                  + 'correspondance, puis le reprendre.'}
                            </p>
                            <ul style={{ marginTop: 0 }}>
                              {apercu.lignes.filter((l) => l.refus).map(({ ligne, refus }) => (
                                <li key={ligne.numero}>
                                  {dire((refus as { message: string }).message)}
                                  {` (ligne ${ligne.ligneDuFichier} du fichier`}
                                  {ligne.typeNonReconnu != null
                                    ? `, type « ${ligne.typeNonReconnu === '' ? '(vide)' : nomDansUnRefus(ligne.typeNonReconnu)} » non reconnu)`
                                    : ')'}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <p role="status">
                            {`Prêt : ${pluriel(importables, 'client')} ${importables > 1 ? 's’ajouteront' : 's’ajoutera'} ${client ? 'à tes clients' : 'au fichier des clients du dossier'}, d’un seul tenant. `
                              + (client
                                ? 'Un import ne se défait pas : un client importé se retire ou s’efface ensuite, un par un.'
                                : 'Un import ne se défait pas : un contact importé se retire ou s’efface ensuite, un par un.')}
                          </p>
                        )}
                        <div className="tableau-adaptable" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                          <table className="table-empilable-etroite" aria-label="Aperçu de l’import">
                            <thead>
                              <tr><th>Ligne</th><th>Nom</th><th>Type</th><th>SIREN / SIRET</th><th>État</th></tr>
                            </thead>
                            <tbody>
                              {apercu.lignes.map(({ ligne, refus }) => (
                                <tr key={ligne.numero}>
                                  <td data-libelle="Ligne" title={`Ligne ${ligne.ligneDuFichier} du fichier`}>{ligne.numero}</td>
                                  <td data-libelle="Nom"><span style={MOT_ENTIER}>{ligne.envoyee.nom === '' ? '—' : nomDansUnRefus(ligne.envoyee.nom)}</span></td>
                                  <td data-libelle="Type">{ligne.envoyee.type_client ? LIBELLES_TYPE_CONTACT[ligne.envoyee.type_client] : '—'}</td>
                                  <td data-libelle="SIREN / SIRET">{ligne.envoyee.siret ?? ligne.envoyee.siren ?? '—'}</td>
                                  <td data-libelle="État">{refus ? <span className="badge badge-danger">Refusée</span> : <span className="badge badge-neutral">Prête</span>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {erreur && <p className="error-text" role="alert">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || importables === 0 || lignes == null}
            onClick={() => { if (lignes) onImporter(lignes.map((l) => l.envoyee)) }}
          >
            {occupe ? 'Import…' : importables > 0 ? `Importer ${pluriel(importables, 'client')}` : 'Importer'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
