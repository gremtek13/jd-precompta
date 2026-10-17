import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { logoDeLaVersion, logoPret, type LogoLu, type LogoPret } from '../../lib/logoDesFactures'
import { lireLeLogo } from '../../lib/logoDesFacturesLecture'
import {
  PHRASE_AUCUN_LOGO, PHRASE_LOGO_EN_LECTURE, PHRASE_LOGO_IDENTIQUE, PHRASE_LOGO_NON_LU, TITRE_DU_LOGO, ditLeLogoNonMontre, estLeLogoCourant,
  gesteDuLogo, legendeDuChoix, legendeDuLogo, phraseDuLogo, phraseSansVersion, refusDuFichierChoisi, refusDuNouveauLogo,
} from '../../lib/logoDesFacturesVue'
import { TEXTE_ROMPUE } from '../../lib/parametresFacturationVue'
import { messageErreur } from '../../lib/messageErreur'
import type { ParametresFacturation } from '../../lib/types'

// « LOGO DES FACTURES » (espace client, étape A5c2a) : un bloc de la carte « Paramètres en cours » de la vue « Paramètres »,
// sous le RIB — au cabinet et au client « Ventes ». Le formulaire « Modifier les paramètres » ne change pas (il reprend le
// logo de la version qu'il remplace). Le bloc VOIT le logo que la version courante désigne, laisse CHOISIR un fichier et le
// juge, mais n'ÉCRIT RIEN : « Poser ce logo » / « Changer le logo » et « Retirer le logo » sont des gestes de la vue, qui tient
// le verrou, dépose le fichier, écrit la version et relit.
//
// VOIR : le fichier que la version désigne est lu dans le seau (`lireLeLogo`), son SHA-256 recalculé et comparé à celui de la
// version ; l'image ne se montre qu'APRÈS cette vérification — absent, refusé, illisible ou d'une autre empreinte, le bloc le
// dit en une ligne et n'offre pas moins de gestes (on peut changer ou retirer ce logo). La lecture est gardée AVEC le dossier
// et le chemin pour lesquels elle a été faite : la réponse tardive d'un dossier quitté ou d'une version remplacée ne s'affiche
// pas. L'image est une URL d'objet créée dans un effet, RÉVOQUÉE au changement et au démontage ; elle s'affiche telle quelle,
// à une taille bornée (`.logo-facture-image`), sans recadrage ni redimensionnement.
//
// CHOISIR NE FAIT RIEN PARTIR : le fichier est jugé (`logoPret` : sa signature, la borne du seau) — le refus du format ou du
// poids se dit tout de suite —, puis, d'après `refusDuNouveauLogo`, ce que la base opposerait à la version qui le désignerait,
// avant le clic. Un fichier identique au logo en cours ne part pas : le bloc le dit.
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : le bloc n'est monté que sur une version courante lue en entier
// (ou, sans version, pour dire de renseigner d'abord les paramètres) ; une version dont la lecture n'a pas rendu les colonnes
// du logo (`logoDeLaVersion` : « non lu ») n'offre aucun geste. Clé par la version : une version neuve repart de zéro.
interface Props {
  dossierId: string
  espace: EspaceVentes
  // La version courante, lue en entier ; nulle quand le dossier n'a encore aucune version.
  courante: ParametresFacturation | null
  versions: readonly ParametresFacturation[]
  // Une écriture est en cours (la vue tient le verrou).
  occupe: boolean
  erreur: string | null
  message: string | null
  onPoser: (version: ParametresFacturation, fichier: File, pret: LogoPret) => void
  onProposerLeRetrait: (version: ParametresFacturation) => void
}

// Une lecture, gardée avec ce qu'elle a lu : le dossier, le chemin et l'empreinte désignés ; l'adresse d'objet de son image,
// quand elle est vérifiée (créée avec la réponse, révoquée par le nettoyage de l'effet qui l'a lue).
type Lecture = { cle: string; lu: LogoLu; url: string | null }
// Le fichier choisi, jugé, et l'adresse d'objet de son aperçu (révoquée quand il est remplacé, et au démontage).
type Choix = { fichier: File; pret: LogoPret; url: string }

export default function LogoDesFactures({ dossierId, espace, courante, versions, occupe, erreur, message, onPoser, onProposerLeRetrait }: Props) {
  const logo = courante === null ? null : logoDeLaVersion(courante)
  const designe = logo !== null && logo !== 'non lu' ? logo : null
  const chemin = designe?.chemin ?? null
  const empreinte = designe?.empreinte ?? null
  const cle = chemin === null ? null : `${dossierId}|${chemin}|${empreinte}`

  const [lecture, setLecture] = useState<Lecture | null>(null)
  const [choix, setChoix] = useState<Choix | null>(null)
  const [refusDuChoix, setRefusDuChoix] = useState<string | null>(null)
  // Le dernier fichier choisi : la réponse tardive d'un choix remplacé depuis ne s'inscrit pas.
  const choixCourant = useRef<File | null>(null)
  // L'adresse d'objet de l'aperçu en cours, pour la révoquer quand le choix change et au démontage.
  const apercuCourant = useRef<string | null>(null)

  // La lecture du fichier désigné, au montage et quand la version, le chemin ou le dossier changent. Elle ne rejette jamais ;
  // sa réponse arrivée après un changement ne s'inscrit pas. L'image du logo vérifié est une URL d'objet créée avec la réponse
  // et RÉVOQUÉE par le nettoyage de cet effet — au changement de logo comme au démontage —, qui vide aussi la lecture.
  useEffect(() => {
    if (chemin === null || empreinte === null) return
    let annule = false
    let url: string | null = null
    lireLeLogo({ chemin, empreinte }).then((lu) => {
      if (annule) return
      url = lu.etat === 'verifie' ? URL.createObjectURL(lu.corps) : null
      setLecture({ cle: `${dossierId}|${chemin}|${empreinte}`, lu, url })
    })
    return () => {
      annule = true
      if (url !== null) URL.revokeObjectURL(url)
      setLecture(null)
    }
  }, [dossierId, chemin, empreinte])

  // L'aperçu du fichier choisi ne survit pas au bloc.
  useEffect(() => () => { if (apercuCourant.current !== null) URL.revokeObjectURL(apercuCourant.current) }, [])

  function oublierLApercu() {
    if (apercuCourant.current !== null) URL.revokeObjectURL(apercuCourant.current)
    apercuCourant.current = null
  }

  async function choisir(e: ChangeEvent<HTMLInputElement>) {
    const champ = e.target
    const fichier = champ.files?.[0] ?? null
    choixCourant.current = fichier
    oublierLApercu()
    setChoix(null)
    setRefusDuChoix(null)
    if (!fichier) return
    let issue
    try {
      issue = await logoPret(dossierId, fichier)
    } catch (err) {
      if (choixCourant.current === fichier) setRefusDuChoix(`Ce fichier n’a pas pu être lu : ${messageErreur(err, 'lecture impossible')}.`)
      return
    }
    // Un choix remplacé pendant la lecture : la réponse du premier ne dit plus rien.
    if (choixCourant.current !== fichier) return
    if ('refus' in issue) {
      choixCourant.current = null
      champ.value = ''
      setRefusDuChoix(refusDuFichierChoisi(issue.refus))
      return
    }
    apercuCourant.current = URL.createObjectURL(issue.corps)
    setChoix({ fichier, pret: issue, url: apercuCourant.current })
  }

  const lectureDuLogo = lecture !== null && lecture.cle === cle ? lecture.lu : null
  const dit = lectureDuLogo ? ditLeLogoNonMontre(lectureDuLogo) : null
  const image = lectureDuLogo?.etat === 'verifie' ? lecture?.url ?? null : null

  const identique = courante !== null && choix !== null && estLeLogoCourant(courante, choix.pret)
  const refus = courante !== null && choix !== null && !identique ? refusDuNouveauLogo(dossierId, courante, versions, choix.pret) : null
  const refusDit = refus === 'rompue' ? TEXTE_ROMPUE : refus ? pourLEspace(espace, refus.message) : null
  const geste = courante === null ? 'Poser ce logo' : gesteDuLogo(courante)

  return (
    <div className="logo-facture">
      <h3 style={{ margin: '0 0 6px', fontSize: '1rem' }}>{TITRE_DU_LOGO}</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.84rem' }}>{phraseDuLogo(espace)}</p>

      {courante === null && <p style={{ margin: 0 }}>{phraseSansVersion(espace)}</p>}
      {courante !== null && logo === 'non lu' && <p className="muted" style={{ margin: 0 }}>{PHRASE_LOGO_NON_LU}</p>}

      {courante !== null && logo !== 'non lu' && (
        <>
          {designe === null && <p style={{ margin: '0 0 8px' }}>{PHRASE_AUCUN_LOGO}</p>}
          {designe !== null && lectureDuLogo === null && <p className="muted" style={{ margin: '0 0 8px' }}>{PHRASE_LOGO_EN_LECTURE}</p>}
          {designe !== null && dit && <p className="note-info">{dit}</p>}
          {image && lectureDuLogo?.etat === 'verifie' && (
            <>
              <img className="logo-facture-image" src={image} alt={TITRE_DU_LOGO} />
              <p className="logo-facture-legende">{legendeDuLogo(lectureDuLogo)}</p>
            </>
          )}

          <div style={{ marginTop: 6 }}>
            <label htmlFor="logo-facture-fichier" style={{ display: 'block', marginBottom: 4 }}>
              {designe === null ? 'Choisir un logo' : 'Choisir un autre logo'} (PNG ou JPEG, 500 Ko au plus)
            </label>
            <input
              id="logo-facture-fichier" className="logo-facture-champ" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              disabled={occupe} onChange={(e) => { void choisir(e) }}
            />
          </div>
          {refusDuChoix && <p className="error-text" role="alert">{refusDuChoix}</p>}

          {choix && (
            <div style={{ marginTop: 10 }}>
              <img className="logo-facture-image" src={choix.url} alt="Aperçu du logo choisi" />
              <p className="logo-facture-legende">{legendeDuChoix(choix.pret, geste)}</p>
              {identique && <p className="note-info">{PHRASE_LOGO_IDENTIQUE}</p>}
              {refusDit && <p className="error-text">{refusDit}</p>}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button
              type="button" className="btn btn-primary btn-sm" title={refusDit ?? undefined}
              disabled={occupe || choix === null || identique || refus !== null}
              onClick={() => { if (choix) onPoser(courante, choix.fichier, choix.pret) }}
            >
              {geste}
            </button>
            {designe !== null && (
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onProposerLeRetrait(courante)}>
                Retirer le logo
              </button>
            )}
          </div>
        </>
      )}

      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  )
}
