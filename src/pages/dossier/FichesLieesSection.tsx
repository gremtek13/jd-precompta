import { useEffect, useState, type CSSProperties } from 'react'
import { formatDate } from '../../lib/format'
import { nomDansUnRefus } from '../../lib/articles'
import { identiteDuDossier, saisieDeLaFicheLiee, type EtatDeLaFicheLiee, type FicheLiee, confirmationDuDeliement, refusDuDeliement } from '../../lib/fichesLiees'
import { lireCeQueLesFichesLieesDemandent, type LectureDesFichesLiees } from '../../lib/fichesLieesLecture'
import {
  PHRASE_DE_L_IDENTITE_ILLISIBLE, PHRASE_DU_DOSSIER_PARTI, confirmationDeLaLiaison, dossiersARelier, fichesLieesDuDossier,
  ligneDUneFicheLiee, refusDeLaSaisieDeFicheLiee, saisieInitialeDeFicheLiee, type SaisieDeFicheLiee,
} from '../../lib/fichesLieesVue'
import type { Contact } from '../../lib/types'

// LES FICHES DE FACTURATION RELIÉES AUX DOSSIERS DES CLIENTS (ligne 47, lot LM3 ; LM-Q3 : « son dossier est la source »).
// Dans la vue « Clients » du dossier du cabinet, côté cabinet, sous `FICHES_LIEES_PREVUES` (l'appelant ne la monte pas sans) :
// une fiche se RELIE à un autre dossier du même cabinet qui n'en a pas encore (LM3-Q2 : sans l'accès à ce dossier), et ne garde
// que ce qui est propre à la facturation — l'adresse de facturation électronique, l'e-mail, le délai, les observations. Son
// identité (nom, adresse, SIRET, type) se LIT de son dossier (`identites_des_fiches_liees`), jamais recopiée ; un dossier parti
// se dit. Le lien se pose à la création et ne change plus (LM3-Q1).
//
// RIEN AVANT LA LECTURE, AUCUN GESTE SUR UNE LECTURE PARTIELLE : les contacts (lus par la vue), la désignation, les dossiers du
// cabinet et les identités, chacun en entier. Les gestes passent le verrou de la vue (`sousVerrou`, un `useRef` relâché après
// la relecture) : un seul pour les gestes des clients et ceux des fiches. Le refus du module se dit avant le clic, sur la
// saisie telle qu'elle part ; la liaison se confirme, et la confirmation NOMME le dossier et ce que la fiche garde.
interface Props {
  dossierId: string
  // Les contacts du dossier tels que la vue les a lus (retirés et effacés compris), et s'ils l'ont été en entier.
  contacts: readonly Contact[]
  complete: boolean
  occupe: boolean
  // Le refus de la base que le verrou de la vue a gardé : dit dans la fenêtre ouverte, qui recouvre la vue.
  erreur: string | null
  // Les gestes, écrits par la vue sous SON verrou (un seul pour les clients et les fiches, relâché après la relecture) ; vrai
  // quand la base a écrit. `envoi` : la saisie telle qu'elle part (`saisieDeLaFicheLiee`) ; `nom` : celui que le message dit.
  onEnregistrer: (fiche: FicheLiee | null, envoi: Record<string, string | number | null>, nom: string) => Promise<boolean>
  onBasculer: (fiche: FicheLiee, nom: string) => Promise<boolean>
  // LM3-Q1 (B) : délier une fiche ; la section a nommé avant le clic ce qui se recopie et ce que la fiche garde.
  onDelier: (fiche: FicheLiee, nom: string) => Promise<boolean>
  // Une fenêtre s'ouvre ou se ferme : la vue y laisse dire l'erreur, et efface la précédente à l'ouverture.
  onFenetre: (ouverte: boolean) => void
}

type Fenetre = { fiche: FicheLiee | null; saisie: SaisieDeFicheLiee; confirmer: boolean }

export default function FichesLieesSection({ dossierId, contacts, complete, occupe, erreur, onEnregistrer, onBasculer, onDelier, onFenetre }: Props) {
  // Gardée AVEC le dossier et la liste de contacts pour lesquels elle a été faite : une relecture des contacts relit les identités.
  const [lecture, setLecture] = useState<{ cle: string; contacts: readonly Contact[]; lu: LectureDesFichesLiees } | null>(null)
  const [fenetre, setFenetre] = useState<Fenetre | null>(null)
  // La fiche dont le déliement se confirme (LM3-Q1 (B)), ou nulle.
  const [aDelier, setADelier] = useState<FicheLiee | null>(null)
  // Ouvrir ou fermer la fenêtre le dit à la vue ; une saisie qui change la garde ouverte (`setFenetre` seul).
  function basculerFenetre(f: Fenetre | null) {
    setFenetre(f)
    onFenetre(f != null)
  }

  useEffect(() => {
    let annule = false
    void lireCeQueLesFichesLieesDemandent(dossierId).then((lu) => { if (!annule) setLecture({ cle: dossierId, contacts, lu }) })
    return () => { annule = true }
  }, [dossierId, contacts])

  const courante = lecture != null && lecture.cle === dossierId && lecture.contacts === contacts ? lecture.lu : null
  if (courante?.etat === 'horsDuDossierDuCabinet') return null

  const titre = <h3 id="fiches-liees-titre">Clients du cabinet reliés à leur dossier</h3>
  if (courante == null) {
    return <section aria-labelledby="fiches-liees-titre" style={{ marginTop: 18 }}>{titre}<p className="muted">Chargement…</p></section>
  }
  if (courante.etat === 'illisible') {
    return (
      <section aria-labelledby="fiches-liees-titre" style={{ marginTop: 18 }}>
        {titre}
        <p className="error-text" role="alert">
          Les fiches reliées ne s’affichent pas : {courante.motif}. Aucun geste n’est offert ; rouvre cette vue pour les relire.
        </p>
      </section>
    )
  }

  const { dossiers, identites, dossierDuCabinetId } = courante
  const fiches = fichesLieesDuDossier(contacts)
  // Les fiches que la base compte, retirées ET effacées comprises (une effacée n'a plus de lien : elle ne compte plus).
  const lignesDuDossier = contacts.map((c) => ({ id: c.id, dossier_client_id: c.dossier_client_id ?? null, retire_le: c.retire_le }))
  const libres = dossiersARelier(dossiers, dossierDuCabinetId, fiches)
  const etat = (ficheReecrite: FicheLiee | null): EtatDeLaFicheLiee => ({
    estDossierDuCabinet: true, dossierDuCabinetId, dossiersDuCabinet: dossiers.map((d) => d.id), fiches: lignesDuDossier,
    ficheReecrite: ficheReecrite == null ? null : { id: ficheReecrite.id, dossier_client_id: ficheReecrite.dossier_client_id },
  })
  const nomDuDossier = (id: string) => dossiers.find((d) => d.id === id)?.nom ?? null

  // L'identité qui juge la saisie : lue de son dossier (une fiche neuve : le dossier choisi ; une fiche réécrite : la lecture).
  function identiteDeLaSaisie(f: Fenetre): { typeClient: 'assujetti' | 'non_assujetti'; siren: string | null; nom: string } | null {
    if (f.fiche == null) {
      const d = dossiers.find((x) => x.id === f.saisie.dossierClientId)
      if (d == null) return null
      const i = identiteDuDossier(d)
      return { typeClient: i.typeClient, siren: i.tiersSiren, nom: i.tiersNom }
    }
    const ligne = ligneDUneFicheLiee(f.fiche, identites)
    const lue = identites.find((i) => i.contact_id === f.fiche?.id)
    if (ligne.etat !== 'lue' || lue == null || lue.type_client == null) return null
    return { typeClient: lue.type_client, siren: lue.tiers_siren, nom: ligne.nom }
  }

  async function enregistrer(f: Fenetre) {
    const refus = refusDeLaSaisieDeFicheLiee(etat(f.fiche), f.saisie, identiteDeLaSaisie(f), f.fiche)
    if (refus != null) return
    const nom = identiteDeLaSaisie(f)?.nom ?? nomDuDossier(f.saisie.dossierClientId) ?? 'ce client'
    if (await onEnregistrer(f.fiche, saisieDeLaFicheLiee(f.saisie), nom)) basculerFenetre(null)
  }

  return (
    <section aria-labelledby="fiches-liees-titre" style={{ marginTop: 18 }}>
      {titre}
      <p className="muted" style={{ marginTop: 0 }}>
        Les clients du cabinet dont le dossier est tenu ici : leur nom, leur adresse, leur SIRET et leur type se lisent de leur
        dossier, à chaque facture d’honoraires, jamais recopiés. La fiche ne garde que ce qui est propre à la facturation :
        l’adresse de facturation électronique, l’e-mail, le délai de paiement et les observations.
      </p>
      {complete && (
        libres.length > 0
          ? (
            <button
              type="button" className="btn btn-primary btn-sm" disabled={occupe} style={{ marginBottom: 12 }}
              onClick={() => basculerFenetre({ fiche: null, saisie: saisieInitialeDeFicheLiee(null), confirmer: false })}
            >
              Relier un dossier client
            </button>
          )
          : <p className="muted">Chaque dossier du cabinet que vous lisez a déjà sa fiche : aucun dossier à relier.</p>
      )}
      {fiches.length === 0
        ? <p className="muted">Aucun dossier client n’est encore relié.</p>
        : (
          <ul aria-label="Fiches reliées" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fiches.map((fiche) => {
              const ligne = ligneDUneFicheLiee(fiche, identites)
              const nom = ligne.etat === 'lue' ? ligne.nom : (nomDuDossier(fiche.dossier_client_id) ?? 'Dossier non lu')
              return (
                <li key={fiche.id} className="card" style={{ padding: 12 }}>
                  <div className="nom-fichier"><strong>{nom}</strong></div>
                  {ligne.etat === 'lue' && <div className="muted" style={{ fontSize: '0.82rem' }}>{ligne.detail}</div>}
                  {ligne.etat === 'dossierParti' && <p className="note-info" role="note" style={{ margin: '4px 0' }}>{PHRASE_DU_DOSSIER_PARTI}</p>}
                  {ligne.etat === 'illisible' && <p className="error-text" style={{ margin: '4px 0' }}>{PHRASE_DE_L_IDENTITE_ILLISIBLE}</p>}
                  {fiche.email && <div className="courriel" style={{ fontSize: '0.82rem' }}>{fiche.email}</div>}
                  {fiche.retire_le != null && <span className="badge badge-neutral">Retirée le {formatDate(fiche.retire_le)}</span>}
                  {complete && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      <button
                        type="button" className="btn btn-outline btn-sm"
                        disabled={occupe || ligne.etat !== 'lue' || fiche.retire_le != null}
                        title={fiche.retire_le != null ? 'Une fiche retirée se reprend avant de se modifier.' : undefined}
                        onClick={() => basculerFenetre({ fiche, saisie: saisieInitialeDeFicheLiee(fiche), confirmer: false })}
                      >
                        Modifier
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => { void onBasculer(fiche, nom) }}>
                        {fiche.retire_le == null ? 'Retirer' : 'Reprendre'}
                      </button>
                      <button
                        type="button" className="btn btn-outline btn-sm" disabled={occupe || ligne.etat !== 'lue'}
                        onClick={() => setADelier(aDelier?.id === fiche.id ? null : fiche)}
                      >
                        Délier
                      </button>
                    </div>
                  )}
                  {complete && aDelier?.id === fiche.id && (() => {
                    const identite = identites.find((i) => i.contact_id === fiche.id && i.dossier_client_id === fiche.dossier_client_id) ?? null
                    const refus = refusDuDeliement({ fiche, identite, contacts })
                    const confirmation = identite != null && refus == null ? confirmationDuDeliement(identite, fiche) : null
                    return (
                      <div className="note-info" role="note" style={{ marginTop: 8 }}>
                        {refus != null && <p className="error-text" style={{ margin: 0 }}>{refus}</p>}
                        {confirmation != null && (
                          <>
                            <p style={{ marginTop: 0 }}><strong>{confirmation.titre}</strong></p>
                            <p style={{ margin: '4px 0' }}>Se recopient dans la fiche, à ce jour :</p>
                            <ul>{confirmation.recopie.map((r) => <li key={r}>{r}</li>)}</ul>
                            {confirmation.garde.length > 0 && (
                              <><p style={{ margin: '4px 0' }}>Elle garde :</p><ul>{confirmation.garde.map((g) => <li key={g}>{g}</li>)}</ul></>
                            )}
                            <p>{confirmation.regle}</p>
                          </>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button" className="btn btn-primary btn-sm" disabled={occupe || refus != null}
                            onClick={() => { void onDelier(fiche, nom).then((fait) => { if (fait) setADelier(null) }) }}
                          >
                            Délier la fiche
                          </button>
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => setADelier(null)}>Annuler</button>
                        </div>
                      </div>
                    )
                  })()}
                </li>
              )
            })}
          </ul>
        )}

      {fenetre && complete && (() => {
        const identite = identiteDeLaSaisie(fenetre)
        const refus = refusDeLaSaisieDeFicheLiee(etat(fenetre.fiche), fenetre.saisie, identite, fenetre.fiche)
        const maj = (patch: Partial<SaisieDeFicheLiee>) => setFenetre({ ...fenetre, saisie: { ...fenetre.saisie, ...patch }, confirmer: false })
        const nomChoisi = nomDuDossier(fenetre.saisie.dossierClientId)
        const confirmation = fenetre.fiche == null && nomChoisi != null ? confirmationDeLaLiaison(nomChoisi, fenetre.saisie) : null
        return (
          <div style={overlayStyle}>
            <div className="card" role="dialog" aria-modal="true" aria-labelledby="fiche-liee-titre" style={{ width: 'min(560px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
              <h2 id="fiche-liee-titre" style={{ marginTop: 0 }}>
                {fenetre.fiche == null ? 'Relier un dossier client' : `Modifier la fiche de « ${nomDansUnRefus(identite?.nom ?? '')} »`}
              </h2>
              {fenetre.fiche == null && (
                <div className="field">
                  <label htmlFor="fiche-liee-dossier">Dossier du client</label>
                  <select id="fiche-liee-dossier" value={fenetre.saisie.dossierClientId} onChange={(e) => maj({ dossierClientId: e.target.value })}>
                    <option value="">Choisir…</option>
                    {libres.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
                  </select>
                </div>
              )}
              {identite != null && (
                <p className="muted" role="note">
                  Lu de son dossier : {identite.nom} — {identite.typeClient === 'assujetti' ? `entreprise établie en France (SIREN ${identite.siren ?? '—'})` : 'particulier ou autre non-assujetti (sans SIRET)'}.
                </p>
              )}
              {identite?.typeClient === 'assujetti' && (
                <div className="field">
                  <label htmlFor="fiche-liee-adresse">Adresse de facturation électronique (facultative)</label>
                  <input id="fiche-liee-adresse" value={fenetre.saisie.adresseElectronique} onChange={(e) => maj({ adresseElectronique: e.target.value })} />
                </div>
              )}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="fiche-liee-email">E-mail de facturation (facultatif)</label>
                  <input id="fiche-liee-email" value={fenetre.saisie.email} onChange={(e) => maj({ email: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="fiche-liee-delai">Délai de paiement, en jours (facultatif)</label>
                  <input id="fiche-liee-delai" inputMode="numeric" value={fenetre.saisie.delai} onChange={(e) => maj({ delai: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="fiche-liee-observations">Observations (facultatives)</label>
                <textarea id="fiche-liee-observations" rows={3} value={fenetre.saisie.observations} onChange={(e) => maj({ observations: e.target.value })} />
              </div>
              {refus != null && <p className="error-text" role="alert">{refus}</p>}
              {refus == null && erreur != null && <p className="error-text" role="alert">{erreur}</p>}
              {fenetre.confirmer && confirmation != null && refus == null && (
                <div className="note-info" role="note">
                  <p style={{ marginTop: 0 }}><strong>{confirmation.titre}</strong></p>
                  <p>La fiche garde :</p>
                  <ul>{confirmation.garde.map((g) => <li key={g}>{g}</li>)}</ul>
                  <p style={{ marginBottom: 0 }}>{confirmation.regle}</p>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-outline" disabled={occupe} onClick={() => basculerFenetre(null)}>Annuler</button>
                {fenetre.fiche == null && !fenetre.confirmer
                  ? (
                    <button type="button" className="btn btn-primary" disabled={occupe || refus != null} onClick={() => setFenetre({ ...fenetre, confirmer: true })}>
                      Relier…
                    </button>
                  )
                  : (
                    <button type="button" className="btn btn-primary" disabled={occupe || refus != null} onClick={() => enregistrer(fenetre)}>
                      {fenetre.fiche == null ? 'Relier ce dossier' : 'Enregistrer'}
                    </button>
                  )}
              </div>
            </div>
          </div>
        )
      })()}
    </section>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
