import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { aujourdHuiAParis } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { LIBELLE_PLATEFORME_ADRESSE, LIBELLE_PLATEFORME_ADRESSE_CLIENT } from '../../lib/droitsAcces'
import { ACCES_EN_COURS, ACCES_SANS_OBJET, type AccesDuDossier } from '../../lib/auteursVentes'
import { lireLesAccesDuDossier } from '../../lib/auteursVentesLecture'
import { sirenDuDossier } from '../../lib/factureElectronique'
import { MAILLES_ADRESSE, REFUS_DECLARATION_ADRESSE, VERIFICATIONS } from '../../lib/adressesReception'
import { declarerAdresseReception } from '../../lib/adressesReceptionEcriture'
import { useAdressesReception } from '../../lib/useAdressesReception'
import {
  CE_QUE_ETABLIT, CHOIX_DE_VERIFICATION, LIEN_PORTAIL_ANNUAIRE, SAISIE_VIDE, direLaPriseEffet, direLaVerification,
  formeDeLaSaisie, formeProposee, historiqueDesVersions, jourDeLaDeclaration, libelleMaille, maillesDeLaSaisie,
  mentionParLeClient, peutDeclarer, refusDeLaSaisie, resumeDesAdresses, saisieEnvoyee, saisieTouchee, type SaisieFormulaire,
} from '../../lib/adressesReceptionVue'
import type { AdresseReception, FormeAdresseReception, VerificationAdresseReception } from '../../lib/types'

// « ADRESSE DE RÉCEPTION » (espace client, étape A6b1 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU
// CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.6 ; MEG1-Q16, A6-Q2 à A6-Q4) : l'adresse à laquelle les factures
// électroniques du dossier sont reçues — l'identifiant d'adressage de l'annuaire, sa maille, la plateforme qui reçoit, la
// prise d'effet, et ce qui l'a vérifiée. UNE fenêtre pour les deux espaces, comme celles de « Mes ventes » : au cabinet depuis
// Justificatifs, au client « Ventes » depuis « Tes plateformes ». Les mots changent (le client est tutoyé, aucun onglet du
// cabinet ne lui est nommé), les gestes sont les mêmes : la base (`declarer_adresse_reception`) les ouvre aux deux.
//
// L'ADRESSE EST DÉCLARÉE, JAMAIS LUE SUR L'ANNUAIRE : son API n'est ouverte qu'aux partenaires raccordés, son portail public
// montre l'identifiant et sa maille seulement. « Vérifier sur l'annuaire » est un LIEN, ouvert sur un clic dans une autre
// page ; l'application n'envoie rien, ne lit rien, n'appelle personne.
//
// RIEN AVANT LA LECTURE, RIEN SUR UNE LECTURE PARTIELLE : « Chargement… » tant que les adresses et le SIRET du dossier ne
// sont pas revenus ; « aucune adresse » ne se dit que d'une liste lue en entier ; lue en partie, refusée, ou en lignes qui ne
// font pas une chaîne, la fenêtre le dit et n'offre AUCUN geste.
//
// UN SEUL VERROU POUR LA DÉCLARATION (`declarationEnCours`, un `useRef` posé AVANT le `try`) : relâché dans le `finally`,
// APRÈS la relecture — un second clic pendant qu'elle court écrirait sur ce que la fenêtre montrait avant —, relue aussi sur
// un refus, pour que la fenêtre dise ce que la base a gardé. Le formulaire remplace la fenêtre dans la même fenêtre : aucune
// fenêtre superposée.
type Props = { espace: EspaceVentes; dossierId: string; onClose: () => void }

const TEXTE_ROMPUE = 'Les adresses lues ne forment pas une suite de versions (une version manque, ou plusieurs se suivent) : '
  + 'aucune n’est donc dite courante, et aucun geste n’est offert.'

// Le refus de la base sur un dossier sans SIRET, tel que son module le dit (la maille et l'identifiant se jugent avant lui).
const REFUS_SANS_SIREN = (REFUS_DECLARATION_ADRESSE.find((r) => r.cle === 'dossier_sans_siren') as { modele: string }).modele

export default function AdresseReceptionModal({ espace, dossierId, onClose }: Props) {
  const client = espace === 'client'
  const dire = (texte: string) => pourLEspace(espace, texte)
  const { lu, relire } = useAdressesReception(dossierId)
  // « Par le client » : les accès du dossier, lus EN ENTIER, au cabinet seul (le client n'y reconnaît personne).
  const [accesLus, setAccesLus] = useState<{ cle: string; acces: AccesDuDossier } | null>(null)
  // Le formulaire : la version qu'il remplace, TELLE QUE LA LISTE LA MONTRAIT À SON OUVERTURE (nulle pour une première). Une
  // autre version déclarée depuis fait refuser, avant le clic, sous les mots de la base.
  const [formulaire, setFormulaire] = useState<{ remplace: AdresseReception | null } | null>(null)
  const [saisie, setSaisie] = useState<SaisieFormulaire>(SAISIE_VIDE)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const declarationEnCours = useRef(false)

  useEffect(() => {
    if (espace !== 'cabinet') return
    let annule = false
    lireLesAccesDuDossier(dossierId).then((acces) => { if (!annule) setAccesLus({ cle: dossierId, acces }) })
    return () => { annule = true }
  }, [dossierId, espace])
  const acces: AccesDuDossier = espace === 'client' ? ACCES_SANS_OBJET
    : accesLus?.cle === dossierId ? accesLus.acces : ACCES_EN_COURS

  // Le verrou de la déclaration. Posé avant le `try` : dans le `try`, le `return` du deuxième clic sortirait par le `finally`
  // et relâcherait le verrou du PREMIER, encore en cours.
  async function sousVerrou(repli: string, ecrire: () => Promise<string>): Promise<boolean> {
    if (declarationEnCours.current) return false
    declarationEnCours.current = true
    setOccupe(true)
    setErreur(null)
    setMessage(null)
    let reussi = false
    try {
      setMessage(await ecrire())
      reussi = true
    } catch (e) {
      setErreur(dire(messageErreur(e, repli)))
    } finally {
      await relire()
      declarationEnCours.current = false
      setOccupe(false)
    }
    return reussi
  }

  const titre = client ? 'Ton adresse de réception' : 'Adresse de réception'
  // Rien ne se dit avant le retour des lectures : ni adresse, ni vide, ni geste.
  if (lu === null) {
    return (
      <Habillage titre={titre}>
        <p className="muted">Chargement…</p>
        <div style={rangeeStyle}><button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button></div>
      </Habillage>
    )
  }

  const aujourdhui = aujourdHuiAParis()
  const { adresses, siret } = lu
  const resume = resumeDesAdresses(adresses, dossierId, aujourdhui)
  const versions = historiqueDesVersions(adresses.lignes, dossierId)
  const autorise = peutDeclarer(lu, dossierId)
  const siretLu = siret.lu ? siret.siret : null
  const siren = sirenDuDossier(siretLu)

  function ouvrir(remplace: AdresseReception | null) {
    setErreur(null)
    setMessage(null)
    setSaisie(SAISIE_VIDE)
    setFormulaire({ remplace })
  }

  async function declarer(remplace: AdresseReception | null) {
    // Seconde ceinture : le bouton est déjà grisé sous ce refus.
    const refus = refusDeLaSaisie(dossierId, siretLu, saisie, remplace?.id ?? null, adresses.lignes, aujourdHuiAParis())
    if (refus) {
      setErreur(refus === 'rompue' ? TEXTE_ROMPUE : dire(refus.message))
      return
    }
    const declaree = await sousVerrou('L’adresse n’a pas pu être déclarée.', async () => {
      const ecrite = await declarerAdresseReception(dossierId, saisieEnvoyee(saisie, remplace?.id ?? null))
      return `Adresse ${ecrite.identifiant} déclarée.`
    })
    if (declaree) setFormulaire(null)
  }

  // ── Le formulaire ────────────────────────────────────────────────────────────────────────────────────────────────────
  if (formulaire && autorise) {
    const { remplace } = formulaire
    const refus = refusDeLaSaisie(dossierId, siretLu, saisie, remplace?.id ?? null, adresses.lignes, aujourdhui)
    const refusDit = refus === 'rompue' ? TEXTE_ROMPUE : refus ? dire(refus.message) : null
    const touchee = saisieTouchee(SAISIE_VIDE, saisie)
    const changer = <K extends keyof SaisieFormulaire>(k: K, v: SaisieFormulaire[K]) => {
      setErreur(null)
      setSaisie({ ...saisie, [k]: v })
    }
    const possibles = maillesDeLaSaisie(saisie)
    const forme = formeDeLaSaisie(saisie)
    const choisirLaVerification = (v: VerificationAdresseReception) => {
      setErreur(null)
      // Le jour d'une vérification abandonnée est sans objet : remis à zéro dans la même écriture.
      setSaisie({ ...saisie, verification: v, verifiee_le: v === 'declaration' ? '' : saisie.verifiee_le })
    }

    return (
      <Habillage titre={titre}>
        <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>{remplace ? 'Déclarer une nouvelle adresse' : 'Déclarer l’adresse'}</h3>
        {remplace && (
          <p className="muted" style={{ marginTop: 0 }}>
            Elle remplace l’adresse courante : {remplace.identifiant} ({libelleMaille(remplace.forme)}), chez{' '}
            {remplace.plateforme}. {direLaPriseEffet(remplace.prise_effet, aujourdhui)}.
          </p>
        )}
        {siren === null ? (
          <p className="alerte-tva" role="alert">{dire(REFUS_SANS_SIREN)}</p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            {client ? 'Le SIREN de ta société est' : 'Le SIREN du dossier est'} {siren} : l’identifiant commence par lui.
          </p>
        )}

        <div className="field">
          <label htmlFor="adresse-identifiant">Identifiant d’adressage</label>
          <input
            id="adresse-identifiant" value={saisie.identifiant} autoComplete="off" spellCheck={false}
            placeholder={siren ? `ex. ${siren}` : 'ex. 123456789'} onChange={(e) => changer('identifiant', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="adresse-maille">Maille de l’adresse</label>
          <select
            id="adresse-maille" value={forme} onChange={(e) => changer('forme', e.target.value as FormeAdresseReception | '')}
          >
            <option value="">Choisir…</option>
            {MAILLES_ADRESSE.map((m) => <option key={m.forme} value={m.forme}>{m.libelle}</option>)}
          </select>
          {formeProposee(saisie) && <p className="muted" style={{ margin: '4px 0 0' }}>Proposée d’après l’identifiant : {client ? 'tu peux' : 'vous pouvez'} en changer.</p>}
          {possibles.length > 1 && saisie.forme === '' && (
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Cet identifiant s’écrit de {possibles.length} façons : {possibles.map(libelleMaille).join(' ou ')}. C’est à {client ? 'toi' : 'vous'} de choisir
              celle de l’annuaire.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="adresse-plateforme">{client ? LIBELLE_PLATEFORME_ADRESSE_CLIENT : LIBELLE_PLATEFORME_ADRESSE}</label>
          <input
            id="adresse-plateforme" value={saisie.plateforme} autoComplete="off"
            onChange={(e) => changer('plateforme', e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="adresse-prise-effet">Date de prise d’effet</label>
          <input id="adresse-prise-effet" type="date" value={saisie.prise_effet} onChange={(e) => changer('prise_effet', e.target.value)} />
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
          <legend style={{ padding: 0, marginBottom: 6 }}>Vérification</legend>
          {VERIFICATIONS.map((v) => (
            <div key={v} style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <input
                  type="radio" name="adresse-verification" value={v} checked={saisie.verification === v}
                  onChange={() => choisirLaVerification(v)}
                />
                <span>
                  <strong>{CHOIX_DE_VERIFICATION[v]}</strong>
                  <span className="muted" style={{ display: 'block', fontSize: '0.84rem' }}>{CE_QUE_ETABLIT[v]}</span>
                </span>
              </label>
            </div>
          ))}
          <div><LienAnnuaire /></div>
        </fieldset>

        {(saisie.verification === 'portail_annuaire' || saisie.verification === 'plateforme') && (
          <div className="field">
            <label htmlFor="adresse-verifiee-le">Jour de la vérification</label>
            <input
              id="adresse-verifiee-le" type="date" max={aujourdhui} value={saisie.verifiee_le}
              onChange={(e) => changer('verifiee_le', e.target.value)}
            />
          </div>
        )}

        {erreur && <p className="error-text" role="alert">{erreur}</p>}
        {refusDit && refusDit !== erreur && <p className={touchee ? 'error-text' : 'muted'}>{refusDit}</p>}

        <div style={rangeeStyle}>
          <button
            type="button" className="btn btn-outline" disabled={occupe}
            onClick={() => { setErreur(null); setFormulaire(null) }}
          >
            Annuler
          </button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || refus != null} title={refusDit ?? undefined}
            onClick={() => void declarer(remplace)}
          >
            {occupe ? 'Enregistrement…' : 'Déclarer'}
          </button>
        </div>
      </Habillage>
    )
  }

  // ── La fenêtre ───────────────────────────────────────────────────────────────────────────────────────────────────────
  return (
    <Habillage titre={titre}>
      <p className="muted" style={{ marginTop: -8 }}>
        {client
          ? 'L’adresse à laquelle ta société reçoit ses factures électroniques : son identifiant d’adressage dans l’annuaire, sa '
            + 'maille, la plateforme qui reçoit et la date de prise d’effet. Tu la déclares ici, après l’avoir vérifiée sur le portail '
            + 'public de l’annuaire ou sur ta plateforme ; ton cabinet la lit aussi, et peut la déclarer avec toi. Rien n’est envoyé '
            + 'à l’annuaire.'
          : 'L’adresse à laquelle le dossier reçoit ses factures électroniques : son identifiant d’adressage dans l’annuaire, sa '
            + 'maille, la plateforme qui reçoit et la date de prise d’effet. Elle se déclare ici, après vérification sur le portail '
            + 'public de l’annuaire ou sur la plateforme ; le client qui porte la case « Ventes » la lit en entier et peut la '
            + 'déclarer avec vous. L’application n’appelle jamais l’annuaire.'}
      </p>

      <BandeauLecturePartielle
        quoi={client ? 'Ton adresse de réception' : 'L’adresse de réception du dossier'} accord="lue"
        motif={adresses.complete ? null : (adresses.motif ?? 'lecture incomplète')} technique={!client}
        consequence="Aucun geste n’est donc offert : une lecture tronquée ne dit pas quelle adresse est la courante, ni si une seule est déclarée."
      />
      {adresses.complete && versions === 'rompue' && <p className="error-text" role="alert">{TEXTE_ROMPUE}</p>}
      {!siret.lu && (
        <p className="error-text" role="alert">
          {client ? 'Le SIRET de ta société' : 'Le SIRET du dossier'} n’a pas pu être lu ({siret.motif}) : l’adresse ne se déclare pas
          d’ici tant qu’il ne l’est pas, car elle doit commencer par son SIREN.
        </p>
      )}

      {/* Sur une lecture partielle, refusée ou rompue, ni adresse ni vide ne se disent : le bandeau les remplace. */}
      {(resume.etat === 'aucune' || resume.etat === 'courante') && (
        <>
          <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Adresse courante</h3>
          {resume.etat === 'aucune' && (
            <p>{client ? 'Tu n’as pas encore déclaré d’adresse de réception.' : 'Aucune adresse de réception n’est déclarée pour ce dossier.'}</p>
          )}
          {resume.etat === 'courante' && (
            <>
              <dl className="plateforme-resume">
                <dt>Maille</dt>
                <dd>{libelleMaille(resume.adresse.forme)}</dd>
                <dt>Identifiant</dt>
                <dd>{resume.adresse.identifiant}</dd>
                <dt>Plateforme</dt>
                <dd>{resume.adresse.plateforme}</dd>
                <dt>Prise d’effet</dt>
                <dd>{direLaPriseEffet(resume.adresse.prise_effet, aujourdhui)}</dd>
                <dt>Vérification</dt>
                <dd>{direLaVerification(resume.adresse)}</dd>
                <dt>Déclarée</dt>
                <dd>
                  le {jourDeLaDeclaration(resume.adresse)} <ParLeClient acces={acces} adresse={resume.adresse} />
                </dd>
              </dl>
              <p className="muted" style={{ marginTop: 0 }}>{CE_QUE_ETABLIT[resume.adresse.verification]}</p>
            </>
          )}
        </>
      )}

      {message && <p role="status">{message}</p>}
      {erreur && <p className="error-text" role="alert">{erreur}</p>}

      <div style={rangeeStyle}>
        {autorise && (
          <button
            type="button" className="btn btn-primary" disabled={occupe}
            onClick={() => ouvrir(resume.etat === 'courante' ? resume.adresse : null)}
          >
            {resume.etat === 'courante' ? 'Déclarer une nouvelle adresse' : 'Déclarer l’adresse'}
          </button>
        )}
        <LienAnnuaire />
        <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
      </div>
      {/* Ce que le portail établit se dit une fois : sous l'adresse courante quand c'est lui qui l'a vérifiée, ici sinon. */}
      {!(resume.etat === 'courante' && resume.adresse.verification === 'portail_annuaire') && (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.84rem' }}>
          {CE_QUE_ETABLIT.portail_annuaire}
        </p>
      )}

      {Array.isArray(versions) && versions.length > 1 && (
        <>
          <h3 style={{ margin: '16px 0 8px', fontSize: '1rem' }}>Historique</h3>
          <div className="card table-scroll" style={{ padding: 0 }}>
            <div className="tableau-adaptable">
              <table className="table-empilable table-empilable-en-carte" aria-label="Historique des adresses">
                <thead>
                  <tr><th>Version</th><th>Adresse</th><th>Plateforme</th><th>Prise d’effet</th><th>Vérification</th><th>Déclarée</th></tr>
                </thead>
                <tbody>
                  {versions.map((a, i) => (
                    <tr key={a.id}>
                      <td data-libelle="Version">{i === 0 ? 'Courante' : 'Remplacée'}</td>
                      <td data-libelle="Adresse">
                        <div>
                          <div className="nom-fichier">{a.identifiant}</div>
                          <div className="muted" style={{ fontSize: '0.78rem' }}>{libelleMaille(a.forme)}</div>
                        </div>
                      </td>
                      <td data-libelle="Plateforme">{a.plateforme}</td>
                      <td data-libelle="Prise d’effet">{direLaPriseEffet(a.prise_effet, aujourdhui)}</td>
                      <td data-libelle="Vérification">{direLaVerification(a)}</td>
                      <td data-libelle="Déclarée">
                        <div className="pastilles-empilees">
                          <span>{jourDeLaDeclaration(a)}</span>
                          <ParLeClient acces={acces} adresse={a} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Habillage>
  )
}

// LA CARTE NE PREND QUE 80 % DE LA HAUTEUR : sur téléphone, la barre de navigation du bas (`position: fixed`, au-dessus du voile)
// couvrait le bas d'une carte de 92 % — les boutons de la dernière rangée passaient dessous, vus au banc à 390 pixels.
// L'enveloppe de la fenêtre. Définie ICI, hors du rendu de la fenêtre : définie dedans, elle serait un composant NOUVEAU à chaque
// rendu, et chaque frappe démonterait les champs du formulaire (le focus se perdrait à chaque lettre).
function Habillage({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="adresse-reception-titre"
        style={{ width: 'min(720px, 95vw)', maxHeight: '80vh', overflowY: 'auto' }}>
        <h2 id="adresse-reception-titre" style={{ marginTop: 0 }}>{titre}</h2>
        {children}
      </div>
    </div>
  )
}

// La mention « par le client » d'une version : au cabinet seul, sur des accès lus en entier ; jamais « par le cabinet ».
function ParLeClient({ acces, adresse }: { acces: AccesDuDossier; adresse: AdresseReception }) {
  const mention = mentionParLeClient(acces, adresse)
  return mention ? <span className="badge badge-neutral badge-une-ligne" title={mention.titre}>{mention.libelle}</span> : null
}

// « Vérifier sur l'annuaire » : le portail PUBLIC de l'annuaire, sur un clic seulement, dans une autre page ; rien ne part
// seul. Ce que le portail montre — et ne montre pas — est dit à côté (A6-Q4, `CE_QUE_ETABLIT`).
function LienAnnuaire() {
  return (
    <a
      className="btn btn-outline" href={LIEN_PORTAIL_ANNUAIRE} target="_blank" rel="noopener noreferrer"
      title="Le portail public de l’annuaire s’ouvre dans une nouvelle page"
    >
      Vérifier sur l’annuaire
    </a>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
const rangeeStyle: CSSProperties = { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }
