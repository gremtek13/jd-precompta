import { useState, type CSSProperties } from 'react'
import { DELAI_CONTACT_MAX_JOURS, TYPES_CLIENT_CONTACT, type ContactPourSiret } from '../../lib/contacts'
import {
  LIBELLE_ADRESSE_CONTACT, LIBELLE_ADRESSE_CONTACT_CLIENT, LIBELLE_NOM_CONTACT, LIBELLE_NOM_CONTACT_CLIENT,
  LIBELLE_OBSERVATIONS_CONTACT, LIBELLE_OBSERVATIONS_CONTACT_CLIENT,
} from '../../lib/droitsAcces'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { sirenOuvert, versEntreprise } from '../../lib/mentionsFacture'
import {
  LIBELLES_TYPE_CONTACT, refusDeLaSaisieContact, saisieContactTouchee, saisieInitialeContact,
} from '../../lib/contactsVue'
import type { SaisieContact } from '../../lib/contacts'
import type { ArticleExoneration, Contact, TypeClient } from '../../lib/types'

// LA SAISIE D'UN CONTACT (espace client, étape A4b1) : « Nouveau client » et « Modifier ». TOUS les champs partent ensemble par
// `enregistrer_contact` (la saisie d'une modification part du contact LU, celle d'un contact neuf est vide, son type « à
// préciser »). La fenêtre ne juge RIEN : le module (`lib/contacts.ts`, par `refusDeLaSaisieContact`) dit le premier refus que
// la base opposerait, dans son ordre et sous ses mots, avant le clic ; le bouton se grise sous ce refus. L'écriture, son verrou
// et la relecture sont ceux de la vue qui l'ouvre (un seul verrou pour les quatre gestes) : ici, ni appel ni état d'écriture.
//
// AUCUNE VALIDATION NATIVE DU NAVIGATEUR : ni `required`, ni `pattern`, ni `type="email"` ou `type="number"` — la fenêtre n'est
// pas un `<form>`, et un champ qui s'opposerait à l'envoi (le pas de 0,01 de l'écran d'une facture a déjà bloqué un prix) dirait
// le refus avec SES mots plutôt que ceux de la base. Le module les dit seul.
//
// UN CHAMP QUE LE TYPE N'OUVRE PAS NE S'AFFICHE PAS — SIREN et SIRET hors de France, l'adresse de facturation électronique pour
// qui n'est ni une entreprise ni un organisme public, le code service pour qui n'est pas un organisme public — et part à nul
// (`saisieQuiPart`) : la saisie garde ce qu'on y avait tapé, que le changement de type n'efface pas d'un geste de souris.
//
// LES TROIS TEXTES LIBRES, nom, adresse et observations, disent au-dessus du champ qui les lit : au cabinet, le client qui
// porte « Ventes » ; au client, son cabinet aussi (CLAUDE.md, « Un texte libre que le cabinet saisit dans une table qu'un droit
// du client ouvre le dit dans son libellé »). Les identifiants et l'e-mail n'en portent pas : ce sont des formes, pas du texte.
interface Props {
  dossierId: string
  espace: EspaceVentes
  articleExoneration: ArticleExoneration | null
  // Le contact modifié, tel que la liste l'a lu ; nul pour un contact neuf.
  contact: Contact | null
  // Une saisie de départ pour un contact NEUF (étape A4b2 : « Enregistrer ce client » la tire du client de la facture) ; sans elle,
  // le contact neuf part de la saisie vide. Elle compte comme le point de départ : rien n'est « touché » tant qu'on n'y change
  // rien, et le refus qu'elle porte déjà (l'adresse que la facture laisse facultative) se dit sans alerte.
  saisieDeDepart?: SaisieContact
  // La liste LUE EN ENTIER : l'unicité d'un SIRET s'y juge. La vue n'ouvre rien sur une lecture partielle.
  contacts: readonly ContactPourSiret[]
  // Une écriture est en cours (la vue tient le verrou) ; l'erreur qu'elle a rendue, sous les mots de la base.
  occupe: boolean
  erreur: string | null
  onEnregistrer: (saisie: SaisieContact) => void
  onClose: () => void
}

export default function ContactSaisieModal({ dossierId, espace, articleExoneration, contact, saisieDeDepart, contacts, occupe, erreur, onEnregistrer, onClose }: Props) {
  const [depart] = useState(() => saisieDeDepart ?? saisieInitialeContact(contact))
  const [saisie, setSaisie] = useState<SaisieContact>(depart)
  const changer = <K extends keyof SaisieContact>(k: K, v: SaisieContact[K]) => setSaisie({ ...saisie, [k]: v })

  const refus = refusDeLaSaisieContact(dossierId, articleExoneration, contact ? { nouveau: false, contact } : { nouveau: true }, saisie, contacts)
  const message = refus ? pourLEspace(espace, refus.message) : null
  // Un refus dit dès l'ouverture d'un contact neuf, c'est « le nom est à renseigner » avant d'avoir tapé un mot : discret tant
  // que rien n'a bougé, d'alerte ensuite.
  const touchee = saisieContactTouchee(depart, saisie)
  const client = espace === 'client'
  // Sans type choisi, rien n'est encore fermé : SIREN et SIRET s'ouvrent (comme `saisieQuiPart`), le reste attend le type.
  const type = saisie.typeClient
  const identifiants = type === '' || sirenOuvert(type)
  const electronique = type !== '' && versEntreprise(type)
  const service = type === 'organisme_public'

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="contact-titre" style={{ width: 'min(620px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="contact-titre" style={{ marginTop: 0 }}>{contact ? 'Modifier le client' : 'Nouveau client'}</h2>

        <div className="field">
          <label htmlFor="contact-nom">{client ? LIBELLE_NOM_CONTACT_CLIENT : LIBELLE_NOM_CONTACT}</label>
          <input id="contact-nom" value={saisie.nom} onChange={(e) => changer('nom', e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="contact-type">Type</label>
          <select id="contact-type" value={saisie.typeClient} onChange={(e) => changer('typeClient', e.target.value as TypeClient | '')}>
            <option value="">À préciser</option>
            {TYPES_CLIENT_CONTACT.map((t) => <option key={t} value={t}>{LIBELLES_TYPE_CONTACT[t]}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="contact-adresse">{client ? LIBELLE_ADRESSE_CONTACT_CLIENT : LIBELLE_ADRESSE_CONTACT}</label>
          <textarea id="contact-adresse" rows={2} value={saisie.adresse} onChange={(e) => changer('adresse', e.target.value)} />
        </div>

        {identifiants && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="contact-siren">SIREN</label>
              <input id="contact-siren" inputMode="numeric" placeholder="neuf chiffres" value={saisie.siren} onChange={(e) => changer('siren', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="contact-siret">SIRET</label>
              <input id="contact-siret" inputMode="numeric" placeholder="quatorze chiffres" value={saisie.siret} onChange={(e) => changer('siret', e.target.value)} />
            </div>
          </div>
        )}

        {(electronique || service) && (
          <div className="field-row">
            {electronique && (
              <div className="field">
                <label htmlFor="contact-adresse-electronique">Adresse de facturation électronique</label>
                <input
                  id="contact-adresse-electronique" autoComplete="off" value={saisie.adresseElectronique}
                  onChange={(e) => changer('adresseElectronique', e.target.value)}
                />
              </div>
            )}
            {service && (
              <div className="field">
                <label htmlFor="contact-code-service">Code service</label>
                <input id="contact-code-service" autoComplete="off" value={saisie.codeService} onChange={(e) => changer('codeService', e.target.value)} />
              </div>
            )}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="contact-email">E-mail</label>
            <input id="contact-email" inputMode="email" autoComplete="off" value={saisie.email} onChange={(e) => changer('email', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="contact-delai">{`Délai de paiement (jours, de 0 à ${DELAI_CONTACT_MAX_JOURS})`}</label>
            <input id="contact-delai" inputMode="numeric" placeholder="ex. 30" value={saisie.delai} onChange={(e) => changer('delai', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="contact-observations">{client ? LIBELLE_OBSERVATIONS_CONTACT_CLIENT : LIBELLE_OBSERVATIONS_CONTACT}</label>
          <textarea id="contact-observations" rows={3} value={saisie.observations} onChange={(e) => changer('observations', e.target.value)} />
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : message && <p className={touchee ? 'error-text' : 'muted'}>{message}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refus != null} title={message ?? undefined}
            onClick={() => onEnregistrer(saisie)}
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer'}
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
