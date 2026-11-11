import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { formatMoney } from '../../lib/format'
import { LIBELLE_NOTES_DEVIS, LIBELLE_NOTES_DEVIS_CLIENT } from '../../lib/droitsAcces'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { livraisonOuverte, sirenOuvert, versEntreprise, type SaisieMentions } from '../../lib/mentionsFacture'
import {
  DEVIS_CITENT_UN_CONTACT, ligneDevisVide, lignesDeLaSaisie, refusDeLaSaisieDevis, totauxDeLaSaisie, type CibleDevis, type EmissionAJuger,
  type LigneDevisSaisie, type SaisieDevis,
} from '../../lib/devis'
import { lireLesContacts, type LectureDesContacts } from '../../lib/contactsLecture'
import {
  ceQueLeChoixDeContactRemplace, choixDeContact, clientEnSaisie, confirmationDuChoixDeContact, contactDeLaProvenance,
  mentionsAvecLeClient,
} from '../../lib/contactsFacture'
import { messageErreur } from '../../lib/messageErreur'
import type { ArticleExoneration, Contact, StatutTva } from '../../lib/types'
import ContactChoixModal from './ContactChoixModal'
import ConfirmationArticle from './ConfirmationArticle'

// LE FORMULAIRE D'UN BROUILLON DE DEVIS (espace client, étape P6a1) : le client et ses mentions, la date, la validité proposée
// à un mois (modifiable), l'exécution prévue, les lignes, les conditions, les mentions légales et les notes. Il ne fait que
// SAISIR : la vue (DevisVue.tsx) tient le verrou, la confirmation de l'émission et l'écriture, par `enregistrer_devis` seule.
//
// Le formulaire d'une facture (FactureFormModal.tsx) tient ses lignes dans son propre corps, mêlées aux articles, à leur
// provenance et à la mention de TVA : elles ne se séparent pas proprement, et ce formulaire tient les siennes — des textes, lus
// en nombres par `lignesDeLaSaisie`.
//
// LES REFUS SE DISENT AVANT LE CLIC, sur la saisie TELLE QU'ELLE PART (`refusDeLaSaisieDevis`, dans l'ordre de la base et sous
// ses mots, puis les mentions) : « Enregistrer le brouillon » grisé sous le refus du brouillon, « Émettre » sous celui de
// l'émission — qui en ajoute trois (pas daté de l'avenir, un total positif, l'émetteur nommé).
//
// « CHOISIR UN CLIENT » (sous `DEVIS_CITENT_UN_CONTACT`, comme le formulaire d'une facture, lib/contactsFacture.ts) : les
// contacts lus EN ENTIER à l'ouverture ; le choix remplit le client ENTIER — un champ que le contact n'a pas est vidé —, et son
// e-mail, que le devis porte ; un client déjà saisi qui diffère ne se remplace qu'après une confirmation qui nomme ce qui part.
// Le devis garde sa COPIE du client, et le contact en provenance (`contact_id`) ; la base refuse un contact d'un autre dossier
// (16 bis), dit ici avant le clic sur la liste lue — et, sans elle, une saisie qui nomme un contact ne part pas.

type Props = {
  espace: EspaceVentes
  dossierId: string
  statutTva: StatutTva | null
  // Pour « Choisir un client » : la règle des soins écarte des contacts (ContactChoixModal).
  articleExoneration: ArticleExoneration | null
  // Le devis visé : un neuf, ou le brouillon tel que la liste l'a lu.
  cible: CibleDevis
  // La saisie de départ, hors ses lignes, et ses lignes (lib/devis.ts, `saisieDuDevis`, `lignesSaisiesDuDevis`).
  depart: Omit<SaisieDevis, 'lignes'>
  lignesDeDepart: LigneDevisSaisie[]
  aujourdHui: string
  // L'émetteur que la base lira dans le dossier, et qui émet (lib/devis.ts, `EmissionAJuger`).
  emission: EmissionAJuger
  occupe: boolean
  erreur: string | null
  onClose: () => void
  // Les contacts lus en entier partent avec la saisie : la vue rejuge la provenance sur eux (null : pas lus).
  onEnregistrer: (saisie: SaisieDevis, emettre: boolean, contactsDuDossier: readonly Contact[] | null) => void
}

type LectureContacts = { lu: LectureDesContacts } | { echec: string }
type Remplacement = { contact: Contact; remplace: string[] }

export default function DevisSaisieModal(props: Props) {
  const { espace, dossierId, statutTva, cible, aujourdHui, occupe, erreur } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [saisie, setSaisie] = useState(props.depart)
  const [lignes, setLignes] = useState(props.lignesDeDepart)
  // Les clés des lignes ajoutées : jamais celles des lignes lues (« l0 », « l1 »…).
  const prochaineCle = useRef(0)
  // « Choisir un client » : la lecture des contacts, la fenêtre du choix, la confirmation d'un remplacement.
  const [lectureContacts, setLectureContacts] = useState<LectureContacts | null>(null)
  const [choixOuvert, setChoixOuvert] = useState(false)
  const [remplacement, setRemplacement] = useState<Remplacement | null>(null)

  useEffect(() => {
    if (!DEVIS_CITENT_UN_CONTACT) return
    let annule = false
    lireLesContacts(dossierId).then(
      (lu) => { if (!annule) setLectureContacts({ lu }) },
      (e: unknown) => { if (!annule) setLectureContacts({ echec: messageErreur(e, 'les clients n’ont pas pu être lus') }) },
    )
    return () => { annule = true }
  }, [dossierId])

  // La liste ENTIÈRE, ou rien : une liste partielle ne juge pas une provenance et n'offre aucun choix.
  const contactsEntiers = lectureContacts != null && 'lu' in lectureContacts && lectureContacts.lu.complete ? lectureContacts.lu.lignes : null
  const provenance = contactDeLaProvenance(saisie.contactId ?? null, contactsEntiers)

  function appliquerChoix(contact: Contact) {
    const { client } = choixDeContact(contact, saisie.dateEmission)
    setSaisie((s) => ({
      ...s, tiersNom: client.tiersNom, tiersAdresse: client.tiersAdresse, tiersSiret: client.tiersSiret,
      tiersEmail: contact.email ?? '', mentions: mentionsAvecLeClient(s.mentions, client), contactId: contact.id,
    }))
  }

  // Un client déjà saisi ne se remplace qu'après une confirmation qui nomme ce qui part ; une saisie vide se remplit sans.
  function choisir(contact: Contact) {
    setChoixOuvert(false)
    const choix = choixDeContact(contact, saisie.dateEmission)
    const remplace = ceQueLeChoixDeContactRemplace(
      clientEnSaisie(saisie, saisie.mentions), '', { client: choix.client, echeance: null },
    )
    const email = saisie.tiersEmail.trim()
    if (email !== '' && email !== (contact.email ?? '')) remplace.push(`l’e-mail ${email}`)
    if (remplace.length > 0) { setRemplacement({ contact, remplace }); return }
    appliquerChoix(contact)
  }

  const changer = <K extends keyof Omit<SaisieDevis, 'lignes'>>(cle: K, valeur: SaisieDevis[K]) =>
    setSaisie((s) => ({ ...s, [cle]: valeur }))
  const changerMention = <K extends keyof SaisieMentions>(cle: K, valeur: SaisieMentions[K]) =>
    setSaisie((s) => ({ ...s, mentions: { ...s.mentions, [cle]: valeur } }))
  const changerLigne = (cle: string, champ: keyof Omit<LigneDevisSaisie, 'cle'>, valeur: string) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)))
  const ajouterLigne = () => {
    prochaineCle.current += 1
    setLignes((ls) => [...ls, ligneDevisVide(statutTva, `n${prochaineCle.current}`)])
  }
  const retirerLigne = (cle: string) => setLignes((ls) => ls.filter((l) => l.cle !== cle))

  // La saisie TELLE QU'ELLE PART, et ses deux refus.
  const quiPart: SaisieDevis = { ...saisie, lignes: lignesDeLaSaisie(lignes) }
  const refusBrouillon = refusDeLaSaisieDevis(dossierId, cible, quiPart, false, aujourdHui, props.emission, contactsEntiers)
  const refusEmission = refusBrouillon ?? refusDeLaSaisieDevis(dossierId, cible, quiPart, true, aujourdHui, props.emission, contactsEntiers)
  const totaux = totauxDeLaSaisie(lignes)

  const m = saisie.mentions
  const type = m.typeClient
  const identifiants = type === '' || sirenOuvert(type)
  const electronique = type !== '' && versEntreprise(type)
  const service = type === 'organisme_public'
  const client = espace === 'client'

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="devis-titre" style={{ width: 'min(860px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="devis-titre" style={{ marginTop: 0 }}>{cible.nouveau ? 'Nouveau devis' : 'Modifier le brouillon de devis'}</h2>

        <div className="field">
          <label htmlFor="devis-client">Client (nom ou raison sociale)</label>
          <input id="devis-client" value={saisie.tiersNom} onChange={(e) => changer('tiersNom', e.target.value)} />
        </div>
        {DEVIS_CITENT_UN_CONTACT && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '-4px 0 10px' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe || contactsEntiers == null} onClick={() => setChoixOuvert(true)}>
              Choisir un client
            </button>
            {lectureContacts == null && <span className="muted">Clients : Chargement…</span>}
            {lectureContacts != null && 'echec' in lectureContacts && <span className="error-text">{lectureContacts.echec}</span>}
            {lectureContacts != null && 'lu' in lectureContacts && !lectureContacts.lu.complete && (
              <span className="error-text">{dire('Les clients du dossier n’ont été lus qu’en partie : aucun choix n’est offert.')}</span>
            )}
            {provenance && <span className="muted">Client tiré du fichier : {provenance.nom}</span>}
          </div>
        )}
        <div className="field">
          <label htmlFor="devis-adresse">Adresse du client</label>
          <textarea id="devis-adresse" rows={2} value={saisie.tiersAdresse} onChange={(e) => changer('tiersAdresse', e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="devis-type">Type de client</label>
            <select id="devis-type" value={type} onChange={(e) => changerMention('typeClient', e.target.value as SaisieMentions['typeClient'])}>
              <option value="">— à préciser —</option>
              <option value="assujetti">une entreprise établie en France</option>
              <option value="organisme_public">un organisme public (Chorus Pro)</option>
              <option value="non_assujetti">un particulier, ou un autre non-assujetti</option>
              <option value="etranger">établi hors de France</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="devis-email">E-mail du client</label>
            <input id="devis-email" type="email" value={saisie.tiersEmail} onChange={(e) => changer('tiersEmail', e.target.value)} />
          </div>
        </div>
        {identifiants && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="devis-siren">SIREN du client</label>
              <input id="devis-siren" inputMode="numeric" value={m.siren} onChange={(e) => changerMention('siren', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="devis-siret">SIRET du client</label>
              <input id="devis-siret" inputMode="numeric" value={saisie.tiersSiret} onChange={(e) => changer('tiersSiret', e.target.value)} />
            </div>
          </div>
        )}
        {(electronique || service) && (
          <div className="field-row">
            {electronique && (
              <div className="field">
                <label htmlFor="devis-adresse-electronique">Adresse de facturation électronique</label>
                <input id="devis-adresse-electronique" value={m.adresseElectronique} onChange={(e) => changerMention('adresseElectronique', e.target.value)} />
              </div>
            )}
            {service && (
              <>
                <div className="field">
                  <label htmlFor="devis-code-service">Code service</label>
                  <input id="devis-code-service" value={m.codeService} onChange={(e) => changerMention('codeService', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="devis-engagement">Numéro d’engagement</label>
                  <input id="devis-engagement" value={m.numeroEngagement} onChange={(e) => changerMention('numeroEngagement', e.target.value)} />
                </div>
              </>
            )}
          </div>
        )}

        <div className="field">
          <label htmlFor="devis-objet">Objet</label>
          <input id="devis-objet" value={saisie.objet} onChange={(e) => changer('objet', e.target.value)} />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="devis-date">Date du devis</label>
            <input id="devis-date" type="date" value={saisie.dateEmission} onChange={(e) => changer('dateEmission', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="devis-validite">Valable jusqu’au</label>
            <input id="devis-validite" type="date" value={saisie.dateValidite} onChange={(e) => changer('dateValidite', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="devis-nature">Opérations</label>
            <select id="devis-nature" value={m.nature} onChange={(e) => changerMention('nature', e.target.value as SaisieMentions['nature'])}>
              <option value="">— à préciser —</option>
              <option value="services">des prestations de services</option>
              <option value="biens">des livraisons de biens</option>
              <option value="mixte">des biens et des services</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="devis-execution">Exécution prévue</label>
            <select id="devis-execution" value={m.prestation} onChange={(e) => changerMention('prestation', e.target.value as SaisieMentions['prestation'])}>
              <option value="facture">non précisée</option>
              <option value="date">un jour</option>
              <option value="periode">une période</option>
            </select>
          </div>
        </div>
        {m.prestation === 'date' && (
          <div className="field">
            <label htmlFor="devis-date-execution">Exécution prévue le</label>
            <input id="devis-date-execution" type="date" value={m.datePrestation} onChange={(e) => changerMention('datePrestation', e.target.value)} />
          </div>
        )}
        {m.prestation === 'periode' && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="devis-periode-debut">Du</label>
              <input id="devis-periode-debut" type="date" value={m.periodeDebut} onChange={(e) => changerMention('periodeDebut', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="devis-periode-fin">Au</label>
              <input id="devis-periode-fin" type="date" value={m.periodeFin} onChange={(e) => changerMention('periodeFin', e.target.value)} />
            </div>
          </div>
        )}
        {livraisonOuverte(m.nature) && (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <input type="checkbox" checked={m.livraisonAilleurs} onChange={(e) => changerMention('livraisonAilleurs', e.target.checked)} />
              Livrer ailleurs qu’à l’adresse du client
            </label>
            {m.livraisonAilleurs && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="devis-livraison-adresse">Adresse de livraison</label>
                  <input id="devis-livraison-adresse" value={m.livraisonAdresse} onChange={(e) => changerMention('livraisonAdresse', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="devis-livraison-cp">Code postal</label>
                  <input id="devis-livraison-cp" value={m.livraisonCodePostal} onChange={(e) => changerMention('livraisonCodePostal', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="devis-livraison-ville">Ville</label>
                  <input id="devis-livraison-ville" value={m.livraisonVille} onChange={(e) => changerMention('livraisonVille', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="devis-livraison-pays">Pays</label>
                  <input id="devis-livraison-pays" value={m.livraisonPays} onChange={(e) => changerMention('livraisonPays', e.target.value)} />
                </div>
              </div>
            )}
          </>
        )}

        <h3>Lignes</h3>
        <div className="tableau-adaptable">
          <table className="table-empilable" aria-label="Lignes du devis">
            <thead>
              <tr><th>Désignation</th><th>Quantité</th><th>Prix unitaire HT</th><th>TVA %</th><th></th></tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={l.cle}>
                  <td data-libelle="Désignation">
                    <input aria-label={`Désignation de la ligne ${i + 1}`} value={l.designation} onChange={(e) => changerLigne(l.cle, 'designation', e.target.value)} />
                  </td>
                  <td data-libelle="Quantité">
                    <input aria-label={`Quantité de la ligne ${i + 1}`} inputMode="decimal" value={l.quantite} onChange={(e) => changerLigne(l.cle, 'quantite', e.target.value)} style={{ width: 90 }} />
                  </td>
                  <td data-libelle="Prix unitaire HT">
                    <input aria-label={`Prix unitaire HT de la ligne ${i + 1}`} inputMode="decimal" value={l.prix} onChange={(e) => changerLigne(l.cle, 'prix', e.target.value)} style={{ width: 120 }} />
                  </td>
                  <td data-libelle="TVA %">
                    <input aria-label={`Taux de TVA de la ligne ${i + 1}`} inputMode="decimal" value={l.taux} onChange={(e) => changerLigne(l.cle, 'taux', e.target.value)} style={{ width: 70 }} />
                  </td>
                  <td className="td-actions">
                    {lignes.length > 1 && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => retirerLigne(l.cle)}>Retirer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 14px' }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={ajouterLigne}>+ Ajouter une ligne</button>
          <p style={{ margin: 0 }} aria-label="Totaux du devis">
            {formatMoney(totaux.montant_ht)} HT · {formatMoney(totaux.montant_tva)} de TVA · <strong>{formatMoney(totaux.montant_ttc)} TTC</strong>
          </p>
        </div>

        <div className="field">
          <label htmlFor="devis-conditions">Conditions (délai d’exécution, paiement, acompte demandé)</label>
          <textarea id="devis-conditions" rows={2} value={saisie.conditions} onChange={(e) => changer('conditions', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="devis-mentions">Mentions légales</label>
          <textarea id="devis-mentions" rows={2} value={saisie.mentionsLegales} onChange={(e) => changer('mentionsLegales', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="devis-notes">{client ? LIBELLE_NOTES_DEVIS_CLIENT : LIBELLE_NOTES_DEVIS}</label>
          <textarea id="devis-notes" rows={2} value={saisie.notes} onChange={(e) => changer('notes', e.target.value)} />
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : refusBrouillon ? <p className="error-text">{dire(refusBrouillon)}</p>
            : refusEmission && <p className="muted">Pour l’émettre : {dire(refusEmission)}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={props.onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-outline" disabled={occupe || refusBrouillon != null}
            onClick={() => props.onEnregistrer(quiPart, false, contactsEntiers)}
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer le brouillon'}
          </button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refusEmission != null}
            onClick={() => props.onEnregistrer(quiPart, true, contactsEntiers)}
          >
            Émettre
          </button>
        </div>
      </div>
      {choixOuvert && contactsEntiers != null && (
        <ContactChoixModal
          espace={espace} articleExoneration={props.articleExoneration} contacts={contactsEntiers} dateEmission={saisie.dateEmission}
          fichesLiees={null}
          echeanceAffichee={false}
          onChoisir={choisir} onClose={() => setChoixOuvert(false)}
        />
      )}
      {remplacement && (() => {
        const confirmation = confirmationDuChoixDeContact(espace, remplacement.contact, remplacement.remplace)
        return (
          <ConfirmationArticle
            titre={confirmation.titre} boutonLabel="Remplacer" occupe={false} refus={null} erreur={null}
            onConfirmer={() => { appliquerChoix(remplacement.contact); setRemplacement(null) }}
            onAnnuler={() => setRemplacement(null)}
          >
            <p>{confirmation.phrase}</p>
            <p className="muted">{confirmation.reste}</p>
          </ConfirmationArticle>
        )
      })()}
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
