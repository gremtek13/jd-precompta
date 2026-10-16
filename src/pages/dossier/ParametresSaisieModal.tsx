import { useState, type CSSProperties } from 'react'
import { DELAI_MAX_JOURS, MOYENS_PROPOSABLES, type SaisieParametresFacturation } from '../../lib/parametresFacturation'
import {
  LIBELLE_ESCOMPTE_PARAMETRES, LIBELLE_ESCOMPTE_PARAMETRES_CLIENT, LIBELLE_MENTIONS_PARAMETRES, LIBELLE_MENTIONS_PARAMETRES_CLIENT,
  LIBELLE_PENALITES_PARAMETRES, LIBELLE_PENALITES_PARAMETRES_CLIENT, LIBELLE_PIED_DE_PAGE_PARAMETRES,
  LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT, LIBELLE_TITULAIRE_PARAMETRES, LIBELLE_TITULAIRE_PARAMETRES_CLIENT,
} from '../../lib/droitsAcces'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import {
  TEXTE_ROMPUE, ceQueDeviendraLeRib, libelleDuMoyen, phraseDesPropositions, refusDeLaSaisieParametres, rienNeChange,
} from '../../lib/parametresFacturationVue'
import type { MoyenEncaissement, ParametresFacturation } from '../../lib/types'

// LA SAISIE DES PARAMÈTRES DE FACTURATION (espace client, étape A5b1) : « Renseigner les paramètres » (une première version)
// et « Modifier les paramètres » (une version NOUVELLE, qui remplace la courante). TOUS les champs partent ensemble par
// `enregistrer_parametres_facturation`, la saisie TELLE QU'ELLE PART (`saisieQuiPart`) : la saisie d'une modification part de
// la courante, celle d'une première des mentions proposées (MEG1-Q13), dites comme des propositions — rien n'est écrit avant
// « Enregistrer ». La version remplacée est celle que la vue a RETENUE à l'ouverture : une autre saisie passée depuis fait
// refuser, avant le clic, sous les mots de la base.
//
// LA FENÊTRE NE JUGE RIEN : le module dit le premier refus que la base opposerait, dans son ordre et sous ses mots, et ce que
// deviendra le RIB (`etatDuRibEnregistre`) ; « Enregistrer » se grise sous un refus et tant que rien ne diffère. L'écriture,
// son verrou et la relecture sont ceux de la vue qui l'ouvre : ici, ni appel ni état d'écriture.
//
// AUCUNE VALIDATION NATIVE DU NAVIGATEUR : ni `required`, ni `pattern`, ni `type="number"` — la fenêtre n'est pas un `<form>`,
// et un champ qui s'opposerait à l'envoi dirait le refus avec SES mots plutôt que ceux de la base.
//
// LES CINQ TEXTES LIBRES — escompte, pénalités, mentions, pied de page, titulaire du compte — disent au-dessus du champ qui les
// lit : au cabinet, le client qui porte « Ventes » ; au client, son cabinet aussi.
interface Props {
  dossierId: string
  espace: EspaceVentes
  // La version que la saisie remplace, retenue à l'ouverture ; nulle pour une première.
  remplace: ParametresFacturation | null
  // La saisie de départ : la courante, ou les propositions.
  depart: SaisieParametresFacturation
  // Les versions LUES EN ENTIER : la courante s'y juge. La vue n'ouvre rien sur une lecture partielle.
  versions: readonly ParametresFacturation[]
  // Une écriture est en cours (la vue tient le verrou) ; l'erreur qu'elle a rendue, sous les mots de la base.
  occupe: boolean
  erreur: string | null
  onEnregistrer: (saisie: SaisieParametresFacturation) => void
  onClose: () => void
}

export default function ParametresSaisieModal({ dossierId, espace, remplace, depart, versions, occupe, erreur, onEnregistrer, onClose }: Props) {
  const [saisie, setSaisie] = useState<SaisieParametresFacturation>(depart)
  const changer = <K extends keyof SaisieParametresFacturation>(k: K, v: SaisieParametresFacturation[K]) => setSaisie({ ...saisie, [k]: v })
  const client = espace === 'client'

  const refus = refusDeLaSaisieParametres(dossierId, remplace?.id ?? null, saisie, versions)
  const refusDit = refus === 'rompue' ? TEXTE_ROMPUE : refus ? pourLEspace(espace, refus.message) : null
  const inchangee = rienNeChange(remplace, saisie)
  // Ce que deviendra le RIB ne se dit que d'une saisie que la base accepterait.
  const rib = refus === null ? ceQueDeviendraLeRib(remplace, saisie, espace) : null
  const grise = occupe || refus !== null || inchangee
  const pourquoiGrise = refusDit ?? (inchangee ? (remplace ? 'Rien ne diffère de la version en cours.' : 'Rien n’est saisi.') : undefined)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="parametres-titre" style={{ width: 'min(680px, 95vw)', maxHeight: '80vh', overflowY: 'auto' }}>
        <h2 id="parametres-titre" style={{ marginTop: 0 }}>{remplace ? 'Modifier les paramètres' : 'Renseigner les paramètres'}</h2>
        {remplace === null && <p className="note-info">{phraseDesPropositions(espace)}</p>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="parametres-delai">{`Délai de paiement (jours, de 0 à ${DELAI_MAX_JOURS})`}</label>
            <input id="parametres-delai" inputMode="numeric" placeholder="ex. 30" value={saisie.delai} onChange={(e) => changer('delai', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="parametres-moyen">Moyen de paiement proposé</label>
            <select id="parametres-moyen" value={saisie.moyen} onChange={(e) => changer('moyen', e.target.value as MoyenEncaissement | '')}>
              <option value="">— Aucun —</option>
              {MOYENS_PROPOSABLES.map((m) => <option key={m} value={m}>{libelleDuMoyen(m)}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="parametres-escompte">{client ? LIBELLE_ESCOMPTE_PARAMETRES_CLIENT : LIBELLE_ESCOMPTE_PARAMETRES}</label>
          <textarea id="parametres-escompte" rows={2} value={saisie.escompte} onChange={(e) => changer('escompte', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="parametres-penalites">{client ? LIBELLE_PENALITES_PARAMETRES_CLIENT : LIBELLE_PENALITES_PARAMETRES}</label>
          <textarea id="parametres-penalites" rows={3} value={saisie.penalites} onChange={(e) => changer('penalites', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="parametres-mentions">{client ? LIBELLE_MENTIONS_PARAMETRES_CLIENT : LIBELLE_MENTIONS_PARAMETRES}</label>
          <textarea id="parametres-mentions" rows={3} value={saisie.mentions} onChange={(e) => changer('mentions', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="parametres-pied">{client ? LIBELLE_PIED_DE_PAGE_PARAMETRES_CLIENT : LIBELLE_PIED_DE_PAGE_PARAMETRES}</label>
          <textarea id="parametres-pied" rows={2} value={saisie.piedDePage} onChange={(e) => changer('piedDePage', e.target.value)} />
        </div>

        <h3 style={{ margin: '14px 0 6px', fontSize: '1rem' }}>RIB</h3>
        <div className="field">
          <label htmlFor="parametres-iban">IBAN</label>
          <input
            id="parametres-iban" autoComplete="off" spellCheck={false} placeholder="FR76 …" value={saisie.iban}
            onChange={(e) => changer('iban', e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="parametres-bic">BIC</label>
            <input id="parametres-bic" autoComplete="off" spellCheck={false} value={saisie.bic} onChange={(e) => changer('bic', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="parametres-titulaire">{client ? LIBELLE_TITULAIRE_PARAMETRES_CLIENT : LIBELLE_TITULAIRE_PARAMETRES}</label>
            <input id="parametres-titulaire" autoComplete="off" value={saisie.titulaire} onChange={(e) => changer('titulaire', e.target.value)} />
          </div>
        </div>
        {rib && <p className="note-info">{rib}</p>}

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : refusDit && <p className="error-text">{refusDit}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={occupe}>Annuler</button>
          <button type="button" className="btn btn-primary" disabled={grise} title={pourquoiGrise} onClick={() => onEnregistrer(saisie)}>
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
