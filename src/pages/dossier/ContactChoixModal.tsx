import { useState, type CSSProperties } from 'react'
import BarreRecherche from '../../components/BarreRecherche'
import { nomDansUnRefus } from '../../lib/articles'
import {
  contactsAChoisir, contactsEnCours, detailDUnContact, introDuChoixDeClient, ligneDesClientsEcartes,
} from '../../lib/contactsFacture'
import type { EspaceVentes } from '../../lib/espaceVentes'
import type { ArticleExoneration, Contact } from '../../lib/types'

// « CHOISIR UN CLIENT » (espace client, étape A4b2) : la liste des clients EN COURS du dossier, avec la recherche de l'application
// (nom, SIREN, SIRET), dans l'ordre de la vue « Clients ». Elle ne lit rien : le formulaire de facture la lui donne, LUE EN ENTIER,
// et ne l'ouvre ni avant la lecture ni sur une lecture partielle. Un client retiré ou effacé ne s'y propose jamais ; dans un dossier
// de soins, ceux que la règle des soins refuse (rangés avant son passage aux soins) ne s'y proposent pas non plus, et une ligne
// le dit. Le choix n'écrit rien : le formulaire décide s'il faut d'abord confirmer.
interface Props {
  espace: EspaceVentes
  articleExoneration: ArticleExoneration | null
  // La liste du dossier lue en entier, retirés et effacés compris : le module n'en garde que les clients en cours.
  contacts: readonly Contact[]
  // La date d'émission du formulaire : chaque client dit l'échéance que son délai donnerait.
  dateEmission: string
  onChoisir: (contact: Contact) => void
  onClose: () => void
}

export default function ContactChoixModal({ espace, articleExoneration, contacts, dateEmission, onChoisir, onClose }: Props) {
  const [recherche, setRecherche] = useState('')
  const { offerts: proposes, ecartesParLesSoins } = contactsAChoisir(contacts, articleExoneration, '')
  const { offerts: affiches } = contactsAChoisir(contacts, articleExoneration, recherche)
  const aucunEnCours = contactsEnCours(contacts).length === 0

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="contact-choix-titre" style={{ width: 'min(560px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="contact-choix-titre" style={{ marginTop: 0 }}>Choisir un client</h2>
        <p className="muted" style={{ marginTop: 0 }}>{introDuChoixDeClient(espace)}</p>
        {ecartesParLesSoins.length > 0 && (
          <p className="note-info" role="note">{ligneDesClientsEcartes(espace, ecartesParLesSoins.length)}</p>
        )}
        <div style={{ marginBottom: 12 }}>
          <BarreRecherche
            valeur={recherche}
            onChange={setRecherche}
            placeholder="Rechercher un nom, un SIREN, un SIRET…"
            affiches={affiches.length}
            total={proposes.length}
          />
        </div>
        {affiches.length === 0 ? (
          <p className="muted">
            {recherche.trim() ? `Aucun client ne correspond à « ${recherche.trim()} ».` : aucunEnCours ? 'Aucun client en cours.' : 'Aucun client à proposer.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '52vh', overflowY: 'auto' }}>
            {affiches.map((c) => (
              <li key={c.id}>
                <button type="button" className="btn btn-outline" style={choixStyle} onClick={() => onChoisir(c)}>
                  <span style={{ display: 'block' }}><strong>{nomDansUnRefus(c.nom)}</strong></span>
                  {detailDUnContact(c, dateEmission) !== '' && (
                    <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{detailDUnContact(c, dateEmission)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </div>
  )
}

// `.btn` est une rangée centrée : le nom et ses détails s'y rangeraient côte à côte. Un bloc, aligné à gauche, les empile.
const choixStyle: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', height: 'auto' }

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, padding: 20,
}
