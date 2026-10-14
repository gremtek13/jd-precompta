import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DossierTab } from '../../components/DossierParcours'
import Widget from '../../components/widgets/Widget'
import {
  ligneDEtat, phraseDeLAdresse, phraseDeLaLectureRatee, phraseSansAdresse, phrasesDeCeQuiManque, phrasesDeLAttente,
  phrasesDesPlateformes, type AttenteDeLEncart,
} from '../../lib/encartFactureElectronique'
import { useEtatFactureElectronique } from '../../lib/etatFactureElectroniqueLecture'
import { aujourdHuiAParis } from '../../lib/format'

// L'ENCART « FACTURE ÉLECTRONIQUE » (espace client, étape A6b2 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE
// GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6). UNE carte pour les deux espaces, `espace`
// OBLIGATOIRE : à l'accueil du client « Ventes » (avec « ce qui attend », d'après les ventes que l'accueil lit une fois) et
// dans la Vue d'ensemble du cabinet (sans « ce qui attend » : l'onglet Factures le dit déjà, par ses pastilles). Ce que les
// phrases disent vit dans `lib/encartFactureElectronique.ts` (pur) ; l'état, l'adresse et ce que sa source établit sont ceux
// du module de l'état et de la fenêtre de l'adresse, jamais réécrits ici.
//
// Il LIT l'état en base (`etat_facture_electronique`) et rien d'autre : aucun appel vers une plateforme, aucune écriture.
// Rien ne se dit avant le retour de la lecture ; illisible ou refusée, la carte le dit — ni « active » ni « à compléter » —,
// et sa panne ne tait que la carte. AUCUNE fenêtre ne s'ouvre d'ici : la grille `.bento` est un conteneur, un `position:
// fixed` s'y décalerait (CLAUDE.md, « Pièges de positionnement ») ; chaque ligne MÈNE à son écran, par la navigation.
//
// Sur téléphone (la grille sous 760 px de large, requête de CONTENEUR dans `index.css`), le corps se replie : la carte est une
// TUILE, son titre et l'état en une ligne, et le lien « Mes ventes » la couvre tout entière.

type Props = { dossierId: string } & (
  | { espace: 'client'; attente: AttenteDeLEncart }
  | { espace: 'cabinet'; onNavigate: (tab: DossierTab) => void }
)

export default function EncartFactureElectronique(props: Props) {
  const { dossierId, espace } = props
  const lecture = useEtatFactureElectronique(dossierId)
  // Le jour à Paris, lu au rendu : « à venir » et « reçoit depuis » se jugent à ce jour.
  const aujourdhui = aujourdHuiAParis()

  // Où mène une ligne : « Mes ventes » chez le client (« Tes plateformes » y est en tête, avec le bloc de l'adresse), l'onglet
  // Justificatifs au cabinet (la connexion de la plateforme et l'adresse y sont).
  const ligne = (cle: string, titre: string, contenu: ReactNode) => {
    const corps = (
      <>
        <span className="encart-fe-titre">{titre}</span>
        {contenu}
      </>
    )
    return espace === 'client'
      ? <Link key={cle} to="/mes-ventes" className="encart-fe-ligne">{corps}</Link>
      : <button key={cle} type="button" className="encart-fe-ligne" onClick={() => props.onNavigate('pieces')}>{corps}</button>
  }
  const texte = (phrases: string[]) => phrases.map((p) => <span key={p} className="encart-fe-texte">{p}</span>)

  let corps: ReactNode = null
  if (lecture.etat === 'lue') {
    const { lu } = lecture
    const manque = phrasesDeCeQuiManque(lu, aujourdhui)
    corps = (
      <div className="encart-fe-corps">
        {manque.length > 0 && ligne('manque', 'Ce qui manque', texte(manque))}
        {ligne(
          'adresse', 'Adresse de réception',
          lu.adresse === null
            ? texte([phraseSansAdresse(espace)])
            : (() => {
              const a = phraseDeLAdresse(lu.adresse, aujourdhui)
              return <><span className="encart-fe-texte">{a.texte}</span><span className="encart-fe-texte encart-fe-etablit">{a.etablit}</span></>
            })(),
        )}
        {ligne('plateformes', 'Plateformes', texte(phrasesDesPlateformes(lu)))}
        {props.espace === 'client' && ligne('attente', 'Ce qui t’attend', texte(phrasesDeLAttente(props.attente, lecture)))}
      </div>
    )
  } else if (lecture.etat !== 'en_cours') {
    corps = <p className="encart-fe-texte encart-fe-panne">{phraseDeLaLectureRatee(espace, lecture)}</p>
  }

  return (
    <Widget
      className={`span-12 encart-fe${espace === 'client' ? ' encart-fe-client' : ''}`}
      titre="Facture électronique"
      sousTitre={ligneDEtat(lecture, aujourdhui)}
      action={espace === 'client'
        ? <Link to="/mes-ventes" className="btn btn-outline btn-sm encart-fe-va">Mes ventes</Link>
        : <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onNavigate('pieces')}>Justificatifs</button>}
    >
      {corps}
    </Widget>
  )
}
