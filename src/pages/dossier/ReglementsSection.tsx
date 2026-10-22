import { useEffect, useState } from 'react'
import BarreRecherche from '../../components/BarreRecherche'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { correspondALaRecherche } from '../../lib/recherche'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { telechargerTexte } from '../../lib/fec'
import { pourLEspace } from '../../lib/espaceVentes'
import { MOYENS_ENCAISSEMENT } from '../../lib/encaissementsFactures'
import { ACCES_SANS_OBJET, PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, type AccesDuDossier } from '../../lib/auteursVentes'
import {
  AIDE_DU_FILTRE_DES_REGLEMENTS, LIBELLES_DECLARATION, SANS_FILTRE, champsDeRecherche, clientsDesReglements, csvDesReglements, filtrerReglements,
  libelleMoyen, mouvementEnMots, nomFichierDesReglements, raisonDuFiltreDesReglements, reglementsDuDossier, totauxDesReglements,
  type EtatDeclaration, type FiltresReglements, type LigneReglement,
} from '../../lib/reglements'
import { lireLesReglements, type LectureDesReglements } from '../../lib/reglementsLecture'
import type { MoyenEncaissement, StatutTva } from '../../lib/types'
import EncaissementsFactureModal from './EncaissementsFactureModal'

// « RÈGLEMENTS » (espace client, étape A3 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT :
// LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », §A.2) : tous les encaissements du dossier, une ligne par encaissement ou
// contre-passation, avec ses filtres, ses totaux par moyen et par mois, et son export. La vue « Règlements » de l'onglet
// Factures, à côté de « Factures » : au cabinet dans l'onglet, au client dans « Mes ventes ».
//
// RIEN NE S'ÉCRIT D'ICI. Chaque ligne ouvre la fenêtre « Encaissements » de SA facture, qui enregistre, retire,
// contre-passe et déclare sous ses refus et son verrou ; quand elle a écrit, la liste se relit.
//
// QUI REGARDE : le cabinet, avec les accès du dossier que l'onglet a lus une fois (« par le client », étape P4c) ; ou le
// client « Ventes », avec ou sans « Banque » — sans elle, le relevé n'est pas demandé, et le mouvement qu'un encaissement
// désigne se dit sans être nommé, sous les mots de la fenêtre.
type QuiRegarde = { espace: 'cabinet'; acces: AccesDuDossier } | { espace: 'client'; banque: boolean }

type Props = QuiRegarde & {
  dossierId: string
  // Le statut de TVA du dossier aujourd'hui : l'obligation de déclarer et son échéance en dépendent.
  statutTva: StatutTva | null
}

// La lecture, gardée AVEC ce pour quoi elle a été faite : un autre dossier, ou un autre droit « Banque », repart en
// chargement, et la réponse tardive d'une clé quittée ne s'affiche pas.
type Lecture = { cle: string; lu: LectureDesReglements } | { cle: string; echec: string }

const CLASSES_DECLARATION: Record<EtatDeclaration, string> = {
  declaree: 'badge-ok',
  a_declarer: 'badge-warning',
  en_retard: 'badge-danger',
  non_due: 'badge-neutral',
  pas_d_ici: 'badge-neutral',
}

const CONSEQUENCE_PARTIELLE = 'Aucune ligne, aucun total ni aucun export n’est donc montré : un encaissement absent fausserait '
  + 'un total, une déclaration absente ferait dire « À déclarer » d’un encaissement déclaré.'

export default function ReglementsSection(props: Props) {
  const { dossierId, statutTva, espace } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const gereLaBanque = props.espace === 'cabinet' || props.banque
  const acces = props.espace === 'cabinet' ? props.acces : ACCES_SANS_OBJET
  const cle = `${dossierId}:${gereLaBanque ? 'banque' : 'sans-banque'}`
  const [lecture, setLecture] = useState<Lecture | null>(null)
  // Relire après une écriture de la fenêtre : la liste montre ce qu'elle a lu jusqu'à ce que la relecture revienne.
  const [version, setVersion] = useState(0)
  const [filtres, setFiltres] = useState<FiltresReglements>(SANS_FILTRE)
  const [recherche, setRecherche] = useState('')
  // L'IDENTIFIANT de la facture ouverte : la fenêtre relit tout elle-même, sur la facture que la liste a relue en dernier.
  const [ouverte, setOuverte] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    lireLesReglements(dossierId, gereLaBanque).then(
      (lu) => { if (!annule) setLecture({ cle, lu }) },
      (erreur: unknown) => { if (!annule) setLecture({ cle, echec: messageErreur(erreur, 'les règlements n’ont pas pu être lus') }) },
    )
    return () => { annule = true }
  }, [dossierId, gereLaBanque, cle, version])

  const courante = lecture?.cle === cle ? lecture : null
  if (courante == null) return <p className="muted">Chargement…</p>
  if ('echec' in courante) {
    return <p className="error-text">Les règlements ne s’affichent pas : {courante.echec}. Rouvre cette vue pour les relire.</p>
  }

  // Le jour à Paris, lu au rendu : une déclaration en retard l'est au jour de la base, pas à celui de la lecture.
  const aujourdHui = aujourdHuiAParis()
  const reglements = reglementsDuDossier({
    dossierId, ventes: courante.lu.ventes, mouvements: courante.lu.mouvements, statutTva, aujourdHui, acces,
  })
  if (reglements.etat === 'partiels') {
    return (
      <BandeauLecturePartielle
        quoi={dire(reglements.quoi)} accord={reglements.accord} motif={reglements.motif} consequence={CONSEQUENCE_PARTIELLE}
        technique={espace === 'cabinet'}
      />
    )
  }

  const toutes = reglements.lignes
  const raisonDuFiltre = raisonDuFiltreDesReglements(acces)
  // Les lignes que les filtres retiennent : les totaux et l'export portent sur ELLES. La recherche ne filtre que l'affichage.
  const filtrees = filtrerReglements(toutes, filtres, acces)
  const affichees = filtrees.filter((l) => correspondALaRecherche(champsDeRecherche(l, espace), recherche))
  const totaux = totauxDesReglements(filtrees)
  const factureOuverte = ouverte ? courante.lu.ventes.factures.find((f) => f.id === ouverte) ?? null : null
  const changer = <K extends keyof FiltresReglements>(k: K, v: FiltresReglements[K]) => setFiltres({ ...filtres, [k]: v })

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {espace === 'client'
          ? 'Tous les encaissements de tes factures, contre-passations et retirés compris, tels que le registre les garde. '
            + 'Une ligne ouvre la fenêtre « Encaissements » de sa facture, où tu enregistres, retires, contre-passes ou déclares : '
            + 'cette liste n’écrit rien.'
          : 'Tous les encaissements du dossier, contre-passations et retirés compris, tels que le registre les garde. Une ligne '
            + 'ouvre la fenêtre « Encaissements » de sa facture, où vous enregistrez, retirez, contre-passez ou déclarez : cette '
            + 'liste n’écrit rien.'}
        {!gereLaBanque && ' Ton accès ne porte pas « Banque » : le mouvement du relevé qu’un encaissement désigne se dit sans être nommé.'}
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="reglements-du">Du</label>
          <input id="reglements-du" type="date" value={filtres.du ?? ''} onChange={(e) => changer('du', e.target.value || null)} />
        </div>
        <div className="field">
          <label htmlFor="reglements-au">Au</label>
          <input id="reglements-au" type="date" value={filtres.au ?? ''} onChange={(e) => changer('au', e.target.value || null)} />
        </div>
        <div className="field">
          <label htmlFor="reglements-moyen">Moyen</label>
          <select
            id="reglements-moyen" value={filtres.moyen ?? ''}
            onChange={(e) => changer('moyen', (e.target.value || null) as MoyenEncaissement | null)}
          >
            <option value="">Tous</option>
            {MOYENS_ENCAISSEMENT.map((m) => <option key={m.moyen} value={m.moyen}>{m.libelle}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reglements-client">Client</label>
          <select id="reglements-client" value={filtres.client ?? ''} onChange={(e) => changer('client', e.target.value || null)}>
            <option value="">Tous</option>
            {clientsDesReglements(toutes).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reglements-etat">État</label>
          <select
            id="reglements-etat" value={filtres.etat ?? ''}
            onChange={(e) => changer('etat', (e.target.value || null) as FiltresReglements['etat'])}
          >
            <option value="">Tous</option>
            <option value="actif">Actifs</option>
            <option value="retire">Retirés</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="reglements-declaration">Déclaration</label>
          <select
            id="reglements-declaration" value={filtres.declaration ?? ''}
            onChange={(e) => changer('declaration', (e.target.value || null) as EtatDeclaration | null)}
          >
            <option value="">Toutes</option>
            {(Object.keys(LIBELLES_DECLARATION) as EtatDeclaration[]).map((d) => (
              <option key={d} value={d}>{LIBELLES_DECLARATION[d]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Le cabinet seul : « Enregistrés par le client » (étape P4c). Grisée avec sa raison tant que les accès ne sont pas lus
          en entier ; cochée sur des accès qui cessent de l'être, elle ne filtre plus. */}
      {espace === 'cabinet' && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox" checked={filtres.parLeClient && raisonDuFiltre == null} disabled={raisonDuFiltre != null}
              aria-describedby="aide-reglements-client" onChange={(e) => changer('parLeClient', e.target.checked)}
            />
            Enregistrés par le client
          </label>
          <p id="aide-reglements-client" className="muted" style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>
            {raisonDuFiltre ?? AIDE_DU_FILTRE_DES_REGLEMENTS}
          </p>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un numéro, un client, un montant…"
          affiches={affichees.length}
          total={filtrees.length}
        />
      </div>

      {filtrees.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Total : {formatMoney(totaux.centimes / 100)}</strong>{' '}
            <span className="muted">
              — {totaux.nombre} {totaux.nombre > 1 ? 'règlements' : 'règlement'}
              {totaux.retires > 0 && `, sans ${totaux.retires > 1 ? `les ${totaux.retires} retirés` : 'le retiré'}`}
              {' '}(une contre-passation vient en moins ; la recherche ne change pas ce total).
            </span>
          </p>
          {totaux.parMoyen.length > 0 && (
            <div className="field-row">
              <div className="field">
                <div className="table-scroll tableau-adaptable">
                  <table className="table-empilable-etroite" aria-label="Totaux par moyen">
                    <thead><tr><th>Moyen</th><th>Règlements</th><th>Total</th></tr></thead>
                    <tbody>
                      {totaux.parMoyen.map((t) => (
                        <tr key={t.moyen}>
                          <td data-libelle="Moyen">{t.libelle}</td>
                          <td data-libelle="Règlements">{t.nombre}</td>
                          <td data-libelle="Total">{formatMoney(t.centimes / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="field">
                <div className="table-scroll tableau-adaptable">
                  <table className="table-empilable-etroite" aria-label="Totaux par mois">
                    <thead><tr><th>Mois</th><th>Règlements</th><th>Total</th></tr></thead>
                    <tbody>
                      {totaux.parMois.map((t) => (
                        <tr key={t.mois}>
                          <td data-libelle="Mois">{t.libelle}</td>
                          <td data-libelle="Règlements">{t.nombre}</td>
                          <td data-libelle="Total">{formatMoney(t.centimes / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginBottom: 14 }}>
        {/* L'export porte sur les lignes que les FILTRES retiennent, jamais sur celles de la recherche. */}
        <button
          type="button" className="btn btn-outline btn-sm" disabled={filtrees.length === 0}
          onClick={() => telechargerTexte(nomFichierDesReglements(aujourdHui), csvDesReglements(filtrees, espace))}
        >
          Exporter (CSV)
        </button>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {affichees.length === 0 ? (
          <div className="empty-state">
            {toutes.length === 0
              ? (espace === 'client' ? 'Aucun encaissement n’est enregistré pour tes factures.' : 'Aucun encaissement n’est enregistré pour ce dossier.')
              : filtrees.length === 0 ? 'Aucun règlement ne correspond à ces filtres.'
                : `Aucun règlement ne correspond à « ${recherche.trim()} ».`}
          </div>
        ) : (
          // Neuf colonnes, dont une commande : repliées en fiches sous 860 pixels d'enveloppe, comme la liste des factures.
          <div className="tableau-adaptable">
            <table className="table-empilable table-empilable-en-carte" aria-label="Règlements">
              <thead>
                <tr>
                  <th>Date</th><th>Facture</th><th>Client</th><th>Moyen</th><th>Montant</th><th>Mouvement</th><th>Déclaration</th>
                  <th>État</th><th></th>
                </tr>
              </thead>
              <tbody>
                {affichees.map((l) => (
                  <LigneDuReglement key={l.id} l={l} espace={espace} onOuvrir={() => setOuverte(l.factureId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {factureOuverte && (
        <EncaissementsFactureModal
          key={factureOuverte.id}
          {...(props.espace === 'cabinet' ? { espace: 'cabinet' as const, acces } : { espace: 'client' as const, banque: props.banque })}
          dossierId={dossierId}
          facture={factureOuverte}
          mouvementImpose={null}
          statutTva={statutTva}
          onClose={() => setOuverte(null)}
          onUpdated={() => setVersion((v) => v + 1)}
        />
      )}
    </>
  )
}

function LigneDuReglement({ l, espace, onOuvrir }: { l: LigneReglement; espace: 'cabinet' | 'client'; onOuvrir: () => void }) {
  return (
    <tr className="clickable" onClick={onOuvrir}>
      <td data-libelle="Date">{formatDate(l.date)}</td>
      <td data-libelle="Facture">{l.numero ?? '—'}</td>
      <td data-libelle="Client">{l.client}</td>
      <td data-libelle="Moyen">{libelleMoyen(l.moyen)}</td>
      <td data-libelle="Montant">{formatMoney(l.centimes / 100)}</td>
      {/* Pas de coupure « n'importe où » : la phrase de l'accès se couperait au milieu d'un mot (banc, 1 280 px). */}
      <td data-libelle="Mouvement">{mouvementEnMots(l.mouvement)}</td>
      <td data-libelle="Déclaration">
        {l.declaration == null ? '—' : (
          <div>
            <span className={`badge badge-une-ligne ${CLASSES_DECLARATION[l.declaration.etat]}`}>{LIBELLES_DECLARATION[l.declaration.etat]}</span>
            {l.declaration.detail && (
              <div className="muted" style={{ fontSize: '0.78rem' }}>{pourLEspace(espace, l.declaration.detail)}</div>
            )}
          </div>
        )}
      </td>
      <td data-libelle="État">
        <div className="pastilles-empilees">
          {l.etat === 'retire'
            ? <span className="badge badge-neutral">Retiré le {formatDate(l.retireLe)}</span>
            : l.contrePassation
              ? <span className="badge badge-warning">Annulation</span>
              : l.contrePasse
                ? <span className="badge badge-neutral">Contre-passé</span>
                : <span className="badge badge-ok">Enregistré</span>}
          {l.parLeClient && (
            <span
              className="badge badge-neutral badge-une-ligne"
              title={l.contrePassation ? TITRES_PAR_LE_CLIENT.contrePassation : TITRES_PAR_LE_CLIENT.encaissement}
            >{PAR_LE_CLIENT}</span>
          )}
        </div>
      </td>
      <td className="td-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-outline btn-sm" onClick={onOuvrir}>Encaissements</button>
      </td>
    </tr>
  )
}
