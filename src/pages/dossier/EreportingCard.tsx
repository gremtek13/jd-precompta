import { useCallback, useEffect, useMemo, useState } from 'react'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import type { DossierEreporting } from '../../lib/ereporting'
import { etatDuRegime, obligationsDeLaCarte, phraseDesFrequences } from '../../lib/ereportingEcran'
import { DEBUT_EREPORTING_PME, type EtatObligation } from '../../lib/periodesEreporting'
import { libelleDuRegime } from '../../lib/regimesEreporting'
import { lireRegimes } from '../../lib/regimesEreportingLecture'
import type { LectureComplete } from '../../lib/lectureComplete'
import type { RegimeEreporting } from '../../lib/types'
import EreportingModal from './EreportingModal'

// LA CARTE « E-REPORTING » DE L'ONGLET TVA (ligne 28.5, étape e5c, phase C), pour TOUS les statuts : un dossier exonéré ou en
// franchise y est tenu de ses achats à un fournisseur établi hors de France comme un redevable (lib/periodesEreporting.ts,
// étape e1). Elle dit ce que le dossier doit déclarer, sous son statut d'aujourd'hui, le régime d'e-reporting que le
// cabinet a confirmé — ou qu'il n'a pas confirmé, ou qui n'est plus celui de l'onglet — et ouvre la fenêtre, où se
// confirment les régimes, se lisent les périodes et s'inscrivent les déclarations.
//
// Elle ne lit que les régimes (une table, par `lireTout`) : les périodes et leurs sources se lisent à l'ouverture de la
// fenêtre, sur un clic. Rien d'affirmé du régime tant que sa lecture n'est pas revenue entière.

const LIBELLE_ETAT: Record<EtatObligation, string> = {
  due: 'Due', en_partie: 'Due en partie', le_cas_echeant: 'Le cas échéant', non_due: 'Non due', a_preciser: 'À préciser',
}
const CLASSE_ETAT: Record<EtatObligation, string> = {
  due: 'badge-ok', en_partie: 'badge-ok', le_cas_echeant: 'badge-neutral', non_due: 'badge-neutral', a_preciser: 'badge-warning',
}

interface Props {
  dossierId: string
  /** Le dossier tel qu'il est aujourd'hui : son statut de TVA (onglet TVA), son SIRET, son numéro de TVA attribué. */
  dossier: DossierEreporting
  /** Le statut de TVA vient d'être changé dans cet onglet : le régime se confirme à partir du jour du changement. */
  statutChange?: boolean
}

export default function EreportingCard({ dossierId, dossier, statutChange = false }: Props) {
  // Les régimes, AVEC le dossier pour lequel ils ont été lus : nuls tant que la première lecture n'est pas revenue, et pour un
  // autre dossier que celui d'aujourd'hui (la page ne se remonte pas toujours d'un dossier à l'autre).
  const [lecture, setLecture] = useState<{ dossierId: string; regimes: LectureComplete<RegimeEreporting> } | null>(null)
  const regimes = lecture !== null && lecture.dossierId === dossierId ? lecture.regimes : null
  const [fenetre, setFenetre] = useState<'fermee' | 'ouverte' | 'confirmer'>('fermee')

  const relire = useCallback(async () => {
    setLecture({ dossierId, regimes: await lireRegimes(dossierId) })
  }, [dossierId])

  // Une lecture plus lente que le changement de dossier n'écrit pas : le drapeau d'annulation.
  useEffect(() => {
    let annule = false
    lireRegimes(dossierId).then((r) => { if (!annule) setLecture({ dossierId, regimes: r }) })
    return () => { annule = true }
  }, [dossierId])

  const { id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits } = dossier
  const dossierLu = useMemo<DossierEreporting>(
    () => ({ id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits }),
    [id, siret, statut_tva, article_exoneration, numero_tva_attribue, tva_periodicite, tva_sur_debits],
  )
  const obligations = obligationsDeLaCarte(dossierLu)
  const etat = regimes !== null && regimes.complete ? etatDuRegime(regimes.lignes, dossierLu, aujourdHuiAParis()) : null

  return (
    <>
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>E-reporting</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Ce que le dossier déclare à l’administration en plus de ses factures électroniques : ses achats à un fournisseur établi
        hors de France, ses ventes à des particuliers et leurs paiements. À partir des opérations du {formatDate(DEBUT_EREPORTING_PME)}
        {' '}(PME, micro-entreprise).
      </p>
      <ul className="obligations-fe">
        {obligations.map((o) => (
          <li key={o.objet}>
            <span className={`badge ${CLASSE_ETAT[o.etat]}`}>{LIBELLE_ETAT[o.etat]}</span>
            <div>
              <strong>{o.nom}</strong>
              {o.frequence && <p className="muted" style={{ margin: '2px 0 0' }}>Déclaration {o.frequence}.</p>}
            </div>
          </li>
        ))}
      </ul>

      {regimes === null ? (
        <p className="muted">Chargement…</p>
      ) : !regimes.complete ? (
        <BandeauLecturePartielle
          quoi="Les régimes d’e-reporting confirmés" accord="lus" motif={regimes.motif ?? 'lecture incomplète'}
          consequence="Le régime du dossier ne se dit pas, et aucun ne se confirme ni ne se retire d’ici. Rouvre l’onglet."
        />
      ) : etat === null ? null : etat.etat === 'aucun' ? (
        <p>
          <strong>Régime d’e-reporting :</strong> aucun n’est confirmé. Le cabinet le confirme, tel que le dossier l’a déclaré à sa
          plateforme agréée : tant qu’il ne l’est pas, aucune période ne se déclare.
        </p>
      ) : (
        <>
          <p>
            <strong>Régime d’e-reporting :</strong> {libelleDuRegime(etat.regime)}, confirmé à partir du {formatDate(etat.regime.depuis)} —{' '}
            {phraseDesFrequences(etat.regime)}.
          </p>
          {etat.aReconfirmer && (
            <p className="alerte-tva" style={{ margin: '0 0 10px' }}>
              {statutChange && 'Le statut de TVA vient d’être changé. '}
              Le statut de TVA du dossier n’est plus celui du régime confirmé : le régime d’e-reporting est à reconfirmer à partir du
              jour du changement, que le cabinet saisit. Tant que ce n’est pas fait, les périodes concernées ne se déclarent pas.
            </p>
          )}
        </>
      )}

      <div className="rangee-boutons" style={{ justifyContent: 'flex-start', marginTop: 10 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setFenetre('ouverte')}>
          Régime, périodes et déclarations
        </button>
        {etat !== null && (etat.etat === 'aucun' || etat.aReconfirmer) && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setFenetre('confirmer')}>
            Confirmer le régime…
          </button>
        )}
      </div>
    </div>
    {/* Hors de la carte : une fenêtre superposée ne vit pas dans une carte (CLAUDE.md, pièges de positionnement). */}
    {fenetre !== 'fermee' && (
      <EreportingModal
        dossierId={dossierId} dossier={dossierLu} confirmerDEmblee={fenetre === 'confirmer'}
        onClose={() => setFenetre('fermee')} onUpdated={() => { void relire() }}
      />
    )}
    </>
  )
}
