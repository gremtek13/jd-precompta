import { useEffect, useRef, useState, type CSSProperties } from 'react'
import BarreRecherche from '../../components/BarreRecherche'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { correspondALaRecherche } from '../../lib/recherche'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { telechargerTexte } from '../../lib/fec'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace } from '../../lib/espaceVentes'
import { ACCES_SANS_OBJET, type AccesDuDossier } from '../../lib/auteursVentes'
import { nomDansUnRefus } from '../../lib/articles'
import { saisieQuiPart, type ContactEnvoye, type SaisieContact } from '../../lib/contacts'
import { IMPORT_CONTACTS_EXPORTE, refusImportContacts } from '../../lib/contactsImport'
import {
  ficheDuContactCsv, messageDeLExportDeLaFiche, nomFichierDeLaFiche, phraseDeLExportDeLaFiche,
} from '../../lib/contactsExport'
import { lireLesContacts, type LectureDesContacts } from '../../lib/contactsLecture'
import { effacerContact, enregistrerContact, importerContacts, reprendreContact, retirerContact } from '../../lib/contactsEcriture'
import {
  LIBELLES_TYPE_CONTACT, champsDeRechercheContact, confirmationDeLEffacement, contactsAffichables, contactsAffiches, delaiAffiche,
  gestesDuContact, identifiantAffiche, infoDesSoins, mentionContactParLeClient, refusDeLaSaisieContact, signalementDesSoins,
} from '../../lib/contactsVue'
import type { ArticleExoneration, Contact } from '../../lib/types'
import ContactSaisieModal from './ContactSaisieModal'
import ContactsImportModal from './ContactsImportModal'

// « CLIENTS » (espace client, étape A4b1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE
// PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.4) : le fichier des clients du client — la liste et ses gestes (nouveau client,
// modifier, retirer, reprendre, effacer). La vue « Clients » de l'onglet Factures, à côté de « Factures », « Règlements » et
// « Articles » : au cabinet dans l'onglet, au client « Ventes » dans « Mes ventes ». Le choix d'un client dans le formulaire d'une
// facture (étape A4b2) et les clients sans activité depuis trois ans ne sont pas d'ici ; l'import d'un fichier (étape A4b3b,
// `ContactsImportModal`) s'ouvre d'ici, sous le même verrou que les quatre gestes ; « Exporter la fiche » (étape A4b3c) télécharge
// la fiche d'une ligne DÉJÀ LUE — rien ne s'écrit, aucun verrou —, grisé pendant une écriture comme les autres gestes de la ligne.
//
// QUI ÉCRIT : le cabinet ET le client « Ventes », par les mêmes fonctions de la base (MEG1-Q1) ; ce que chacune refuserait est
// dit avant le clic par le module `lib/contacts.ts`, et la base juge encore — son refus se dit sous ses mots. Le client répond
// des données de ses clients, le cabinet agit pour lui (MEG1-Q11) : un contact s'EFFACE, après une confirmation qui nomme ce
// qui part.
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : « Chargement… » tant que les contacts ne sont pas revenus ; un vide ne
// se dit que d'une liste lue en entier ; lue en partie, la liste porte son bandeau et AUCUN geste (l'unicité d'un SIRET ne se
// juge pas sur des contacts qu'on n'a pas lus). Un contact effacé est LU et ne se MONTRE jamais.
//
// UN SEUL VERROU POUR LES QUATRE GESTES ET L'IMPORT (`gesteEnCours`, un `useRef` posé AVANT le `try`) : relâché dans le `finally`, APRÈS la
// relecture de la liste — un second clic pendant qu'elle court écrirait sur ce que la liste montrait avant —, relue aussi sur
// un refus, pour que la liste dise ce que la base a gardé.
type QuiRegarde = { espace: 'cabinet'; acces: AccesDuDossier } | { espace: 'client' }

type Props = QuiRegarde & {
  dossierId: string
  // L'article d'exonération du dossier, que la règle des soins lit (MEG1-Q10, A4-Q1) : celui que l'onglet reçoit déjà.
  articleExoneration: ArticleExoneration | null
}

// La lecture, gardée AVEC le dossier pour lequel elle a été faite : un autre dossier repart en chargement, et la réponse
// tardive d'un dossier quitté ne s'affiche pas.
type Lecture = { cle: string; lu: LectureDesContacts } | { cle: string; echec: string }

const CONSEQUENCE_PARTIELLE = 'Aucun geste n’est donc offert : une liste tronquée dirait « libre » un SIRET déjà pris, '
  + 'et « aucun client » d’un fichier qui en a.'

export default function ContactsVue(props: Props) {
  const { dossierId, articleExoneration, espace } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const acces = props.espace === 'cabinet' ? props.acces : ACCES_SANS_OBJET
  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [recherche, setRecherche] = useState('')
  const [avecLesRetires, setAvecLesRetires] = useState(false)
  // La saisie ouverte : un contact neuf (`contact` nul) ou celui qu'on modifie, tel que la liste l'a lu.
  const [fenetre, setFenetre] = useState<{ contact: Contact | null } | null>(null)
  // L'effacement proposé : le contact tel que la liste l'a lu, que la confirmation nomme.
  const [aEffacer, setAEffacer] = useState<Contact | null>(null)
  // La fenêtre « Importer des clients » est ouverte.
  const [importOuvert, setImportOuvert] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const gesteEnCours = useRef(false)
  // Le dossier que la vue affiche, pour qu'une relecture lancée sous un dossier quitté depuis ne s'inscrive pas.
  const dossierAffiche = useRef(dossierId)

  // La première lecture, et celle d'un autre dossier : une réponse arrivée après un changement de dossier ne s'inscrit pas
  // (`annule`), si bien que la plus lente n'écrit jamais en dernier.
  useEffect(() => {
    let annule = false
    dossierAffiche.current = dossierId
    lireLesContacts(dossierId).then(
      (lu) => { if (!annule) setLecture({ cle: dossierId, lu }) },
      (e: unknown) => { if (!annule) setLecture({ cle: dossierId, echec: messageErreur(e, 'les clients n’ont pas pu être lus') }) },
    )
    return () => { annule = true }
  }, [dossierId])

  // La relecture d'après une écriture : les gestes sont sous verrou, deux relectures ne se croisent donc pas.
  async function relire() {
    try {
      const lu = await lireLesContacts(dossierId)
      if (dossierAffiche.current === dossierId) setLecture({ cle: dossierId, lu })
    } catch (e) {
      if (dossierAffiche.current === dossierId) {
        setLecture({ cle: dossierId, echec: messageErreur(e, 'les clients n’ont pas pu être lus') })
      }
    }
  }

  // Le verrou des quatre gestes. Posé avant le `try` : dans le `try`, le `return` du deuxième clic sortirait par le `finally`
  // et relâcherait le verrou du PREMIER, encore en cours.
  async function sousVerrou(repli: string, ecrire: () => Promise<string>): Promise<boolean> {
    if (gesteEnCours.current) return false
    gesteEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setMessage(null)
    let reussi = false
    try {
      setMessage(await ecrire())
      reussi = true
    } catch (e) {
      // Le refus de la base se lit sous ses mots, réécrits pour le client quand ils parlent du « dossier ».
      setErreur(dire(messageErreur(e, repli)))
    } finally {
      await relire()
      gesteEnCours.current = false
      setOccupe(false)
    }
    return reussi
  }

  const courante = lecture?.cle === dossierId ? lecture : null
  if (courante == null) return <p className="muted">Chargement…</p>
  if ('echec' in courante) {
    return (
      <p className="error-text">
        {espace === 'client' ? 'Tes clients ne s’affichent pas' : 'Les clients ne s’affichent pas'} : {courante.echec}. Rouvre cette vue
        pour les relire.
      </p>
    )
  }

  const { lignes: contacts, complete, motif } = courante.lu
  // Aucun geste ne part d'une liste lue en partie.
  const peutEcrire = complete
  const avantRecherche = contactsAffiches(contacts, avecLesRetires)
  const affiches = avantRecherche.filter((c) => correspondALaRecherche(champsDeRechercheContact(c), recherche))
  const info = infoDesSoins(espace, articleExoneration)

  async function enregistrer(saisie: SaisieContact, contact: Contact | null) {
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisieContact(dossierId, articleExoneration, contact ? { nouveau: false, contact } : { nouveau: true }, saisie, contacts)
    if (refus) {
      setErreur(dire(refus.message))
      return
    }
    const ouvert = await sousVerrou('Le client n’a pas pu être enregistré.', async () => {
      const ecrit = await enregistrerContact(dossierId, contact?.id ?? null, saisieQuiPart(saisie))
      return `Client « ${nomDansUnRefus(ecrit.nom)} » enregistré.`
    })
    if (ouvert) setFenetre(null)
  }

  async function basculer(contact: Contact) {
    const { basculer: geste } = gestesDuContact(dossierId, articleExoneration, contact, contacts)
    if (geste.refus) {
      setErreur(dire(geste.refus.message))
      return
    }
    if (geste.geste === 'retirer') {
      await sousVerrou('Le client n’a pas pu être retiré.', async () => {
        await retirerContact(dossierId, contact.id)
        return `Client « ${nomDansUnRefus(contact.nom)} » retiré.`
      })
    } else {
      await sousVerrou('Le client n’a pas pu être repris.', async () => {
        await reprendreContact(dossierId, contact.id)
        return `Client « ${nomDansUnRefus(contact.nom)} » repris.`
      })
    }
  }

  async function effacer(contact: Contact) {
    const { effacer: refus } = gestesDuContact(dossierId, articleExoneration, contact, contacts)
    if (refus) {
      setErreur(dire(refus.message))
      return
    }
    // Le nom est celui d'AVANT l'effacement : la ligne rendue ne porte plus que « Contact effacé le … ».
    const efface = await sousVerrou('Le client n’a pas pu être effacé.', async () => {
      await effacerContact(dossierId, contact.id)
      return `Client « ${nomDansUnRefus(contact.nom)} » effacé.`
    })
    if (efface) setAEffacer(null)
  }

  async function importer(envoyees: ContactEnvoye[]) {
    // Seconde ceinture : le bouton n'est offert que sur un aperçu sans aucun refus.
    const refus = refusImportContacts(dossierId, articleExoneration, envoyees, contacts)
    if (refus) {
      setErreur(dire(refus.message))
      return
    }
    const fait = await sousVerrou('L’import n’a pas pu se faire.', async () => {
      const ids = await importerContacts(dossierId, envoyees)
      return ids.length > 1 ? `${ids.length} clients importés.` : `${ids.length} client importé.`
    })
    if (fait) setImportOuvert(false)
  }

  function ouvrirLImport() {
    setErreur(null)
    setMessage(null)
    setImportOuvert(true)
  }

  // Rien ne s'écrit : le fichier se compose ici, depuis la ligne que la liste a lue, et ne part nulle part — ni verrou, ni base.
  function exporterLaFiche(contact: Contact) {
    const nomDuFichier = nomFichierDeLaFiche(contact.nom, aujourdHuiAParis())
    telechargerTexte(nomDuFichier, ficheDuContactCsv(contact))
    setErreur(null)
    setMessage(messageDeLExportDeLaFiche(nomDansUnRefus(contact.nom), nomDuFichier))
  }

  function ouvrir(contact: Contact | null) {
    setErreur(null)
    setMessage(null)
    setFenetre({ contact })
  }

  function proposerLEffacement(contact: Contact) {
    setErreur(null)
    setMessage(null)
    setAEffacer(contact)
  }

  const confirmation = aEffacer ? confirmationDeLEffacement(espace, aEffacer) : null

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {espace === 'client'
          ? 'Le fichier de tes clients : nom, type, adresse, SIREN et SIRET, adresse de facturation électronique, e-mail, délai de '
            + 'paiement et observations. Ton cabinet le lit aussi, et le tient avec toi. Un client se modifie, se retire et se reprend ; '
            + 'tu peux aussi l’effacer : ses données partent, et tes factures gardent leur copie.'
          : 'Le fichier des clients du dossier — ceux à qui son client facture : nom, type, adresse, SIREN et SIRET, adresse de '
            + 'facturation électronique, e-mail, délai de paiement et observations. Le client qui porte la case « Ventes » le lit en '
            + 'entier et le tient avec vous ; « par le client » marque celui qu’il a créé, modifié ou retiré en dernier. Un client se '
            + 'modifie, se retire et se reprend ; il peut aussi s’effacer : ses données partent, et les factures gardent leur copie.'}
      </p>

      {info && <p className="muted" style={{ marginTop: 0 }}>{info}</p>}

      <BandeauLecturePartielle
        quoi={espace === 'client' ? 'Tes clients' : dire('Les clients du dossier')} accord="lus" motif={complete ? null : (motif ?? 'lecture incomplète')}
        consequence={CONSEQUENCE_PARTIELLE} technique={espace === 'cabinet'}
      />

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un nom, un SIREN, un SIRET…"
          affiches={affiches.length}
          total={avantRecherche.length}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={avecLesRetires} onChange={(e) => setAvecLesRetires(e.target.checked)} />
          Retirés
        </label>
        {peutEcrire && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {IMPORT_CONTACTS_EXPORTE && (
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={ouvrirLImport}>
                Importer des clients
              </button>
            )}
            <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => ouvrir(null)}>
              + Nouveau client
            </button>
          </div>
        )}
      </div>
      <p className="muted" style={{ margin: '-8px 0 14px', fontSize: '0.82rem' }}>
        Sans « Retirés », les clients retirés ne se montrent pas ; ils gardent leur SIRET.
      </p>

      {peutEcrire && (
        <p id="contacts-export-phrase" className="muted" style={{ margin: '-8px 0 14px', fontSize: '0.82rem' }}>
          {phraseDeLExportDeLaFiche(espace)}
        </p>
      )}

      {!fenetre && !aEffacer && !importOuvert && erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p role="status">{message}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {affiches.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun client ne correspond à « ${recherche.trim()} ».`
              : !complete ? 'La liste des clients n’a pas pu être lue en entier.'
                // Un contact effacé ne compte pas : sa ligne ne se montre jamais, retirés ou non.
                : contactsAffichables(contacts).length === 0
                  ? (espace === 'client' ? 'Tu n’as encore aucun client.' : 'Aucun client n’est enregistré pour ce dossier.')
                  : 'Aucun client n’est en cours : les clients retirés se montrent avec « Retirés ».'}
          </div>
        ) : (
          // Six colonnes, dont une commande : repliées en fiches sous 860 pixels d'enveloppe, comme les listes voisines.
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte" aria-label="Clients">
              <thead>
                <tr>
                  <th>Nom</th><th>Type</th><th>SIREN / SIRET</th><th>E-mail</th><th>Délai</th>
                  {peutEcrire && <th></th>}
                </tr>
              </thead>
              <tbody>
                {affiches.map((c) => {
                  const gestes = gestesDuContact(dossierId, articleExoneration, c, contacts)
                  const parLeClient = mentionContactParLeClient(acces, c)
                  const identifiant = identifiantAffiche(c)
                  const delai = delaiAffiche(c)
                  return (
                    <tr key={c.id}>
                      {/* Un SEUL enfant : en fiche (téléphone), les enfants d'une cellule se rangent côte à côte de son libellé. */}
                      <td data-libelle="Nom">
                        <div>
                          <div className="nom-fichier">{c.nom}</div>
                          {(c.retire_le != null || parLeClient) && (
                            <div className="pastilles-empilees" style={{ marginTop: 4 }}>
                              {c.retire_le != null && <span className="badge badge-neutral">Retiré le {formatDate(c.retire_le)}</span>}
                              {parLeClient && (
                                <span className="badge badge-neutral badge-une-ligne" title={parLeClient.titre}>{parLeClient.libelle}</span>
                              )}
                            </div>
                          )}
                          {/* A4-Q4 : un contact rangé avant le passage aux soins se dit tel, et l'effacement est proposé — jamais fait. */}
                          {gestes.soins && <div className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>{signalementDesSoins(espace)}</div>}
                        </div>
                      </td>
                      <td data-libelle="Type">{c.type_client ? LIBELLES_TYPE_CONTACT[c.type_client] : '—'}</td>
                      <td data-libelle="SIREN / SIRET">
                        {identifiant ? <span title={identifiant.nom}>{identifiant.valeur}</span> : '—'}
                      </td>
                      <td data-libelle="E-mail">{c.email ? <span className="nom-fichier">{c.email}</span> : '—'}</td>
                      <td data-libelle="Délai">{delai ?? '—'}</td>
                      {peutEcrire && (
                        <td className="td-actions">
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe || gestes.modifier != null}
                            title={gestes.modifier ? dire(gestes.modifier.message) : undefined} onClick={() => ouvrir(c)}
                          >
                            Modifier
                          </button>
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe} aria-describedby="contacts-export-phrase"
                            onClick={() => exporterLaFiche(c)}
                          >
                            Exporter la fiche
                          </button>
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe || gestes.basculer.refus != null}
                            title={gestes.basculer.refus ? dire(gestes.basculer.refus.message) : undefined} onClick={() => basculer(c)}
                          >
                            {gestes.basculer.geste === 'retirer' ? 'Retirer' : 'Reprendre'}
                          </button>
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={occupe || gestes.effacer != null}
                            title={gestes.effacer ? dire(gestes.effacer.message) : undefined} onClick={() => proposerLEffacement(c)}
                          >
                            Effacer
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fenetre && peutEcrire && (
        <ContactSaisieModal
          dossierId={dossierId}
          espace={espace}
          articleExoneration={articleExoneration}
          contact={fenetre.contact}
          contacts={contacts}
          occupe={occupe}
          erreur={erreur}
          onEnregistrer={(saisie) => enregistrer(saisie, fenetre.contact)}
          onClose={() => setFenetre(null)}
        />
      )}

      {importOuvert && peutEcrire && IMPORT_CONTACTS_EXPORTE && (
        <ContactsImportModal
          dossierId={dossierId}
          espace={espace}
          articleExoneration={articleExoneration}
          contacts={contacts}
          occupe={occupe}
          erreur={erreur}
          onImporter={importer}
          onClose={() => setImportOuvert(false)}
        />
      )}

      {aEffacer && confirmation && peutEcrire && (
        <div style={overlayStyle}>
          <div className="card" role="alertdialog" aria-modal="true" aria-labelledby="contact-effacement-titre" style={{ width: 'min(520px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
            <h2 id="contact-effacement-titre" style={{ marginTop: 0 }}>{confirmation.titre}</h2>
            <p>{confirmation.chapeau}</p>
            <ul>
              {confirmation.partent.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <p>{confirmation.reste}</p>
            {erreur && <p className="error-text" role="alert">{erreur}</p>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => setAEffacer(null)} disabled={occupe}>Annuler</button>
              <button type="button" className="btn btn-danger" onClick={() => effacer(aEffacer)} disabled={occupe}>
                {occupe ? 'Effacement…' : 'Effacer le client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
