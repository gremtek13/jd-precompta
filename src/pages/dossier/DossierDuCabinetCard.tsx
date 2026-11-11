import { useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  DOSSIER_DU_CABINET_PREVU, ceQueDitLaDesignation, confirmationDeLaDesignation, motsDuRefus, refusDeLaDesignation,
} from '../../lib/dossierDuCabinet'
import { designerLeDossierDuCabinet, type LectureDeLaDesignation } from '../../lib/dossierDuCabinetLecture'
import { signalerMajDossiers } from '../../lib/listeDossiers'

// LA CARTE « DOSSIER DU CABINET » DE L'ONGLET INFORMATIONS (ligne 47, lot LM2 ; HISTORIQUE.md, « LM1 : LE DOSSIER DU CABINET,
// EN BASE » et « LM2 »), derrière `DOSSIER_DU_CABINET_PREVU` : baissé, elle ne rend rien. Elle dit si ce dossier est celui où
// le cabinet facture ses propres honoraires (un autre, ou aucun), et offre au CHEF seul de le désigner — ou d'en retirer la
// désignation — par `designer_dossier_du_cabinet` seule. Ses refus se disent AVANT le clic, aux mots de la fonction
// (`refusDeLaDesignation`, dans son ordre) ; la confirmation nomme le dossier, celui qu'il remplace, et dit que la désignation
// devient irréversible dès une facture validée. La lecture est faite par l'onglet (qui la partage avec la zone dangereuse) :
// lue en partie ou refusée, la carte le dit et n'offre AUCUN geste ; rien ne s'affirme avant son retour. Le geste passe sous un
// verrou `useRef`, relâché après la relecture, et la liste des dossiers est prévenue (sa place à part change).

export default function DossierDuCabinetCard({ dossierId, dossierNom, lecture, onDesignationEcrite }: {
  dossierId: string
  dossierNom: string
  lecture: LectureDeLaDesignation | null
  /** Fait relire la désignation par l'onglet, après un geste, réussi ou non. */
  onDesignationEcrite: () => void
}) {
  if (!DOSSIER_DU_CABINET_PREVU) return null
  return <CarteDuDossierDuCabinet dossierId={dossierId} dossierNom={dossierNom} lecture={lecture} onDesignationEcrite={onDesignationEcrite} />
}

function CarteDuDossierDuCabinet({ dossierId, dossierNom, lecture: lu, onDesignationEcrite }: {
  dossierId: string
  dossierNom: string
  lecture: LectureDeLaDesignation | null
  onDesignationEcrite: () => void
}) {
  const { estChef } = useAuth()
  const [enCours, setEnCours] = useState(false)
  // Ce que le dernier geste a dit, gardé avec le dossier écrit : ailleurs, la carte n'en dit rien.
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  // Le verrou d'exécution, en `useRef` : `enCours` ne prend effet qu'au rendu suivant.
  const gesteEnCours = useRef(false)

  // Une lecture d'un autre dossier n'est pas la sienne.
  const lecture = lu?.dossierId === dossierId ? lu : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  const estDesigne = lecture?.etat === 'lue' && lecture.dossierActuel === dossierId
  // Le geste offert : désigner ce dossier, ou retirer sa désignation. Ses refus jugés sur ce que la base lirait.
  const refus = lecture?.etat === 'lue'
    ? refusDeLaDesignation({
      estChefDuCabinet: estChef,
      cabinetId: lecture.cabinetId,
      dossierActuel: lecture.dossierActuel,
      actuelPorteUneFactureValidee: lecture.actuelPorteUneFactureValidee,
      dossierVise: estDesigne ? null : dossierId,
      // Le cabinet du dossier visé : celui que la base a rendu pour ce dossier-ci (le seul que la carte propose).
      cabinetDuDossierVise: lecture.cabinetId,
      visePorteUnAccesClient: lecture.porteUnAccesClient,
      visePorteUneFactureEnMandataire: lecture.porteUneFactureEnMandataire,
    })
    : null

  async function agir() {
    // Posé avant le `try` : dedans, le `return` d'un second clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (gesteEnCours.current || lecture?.etat !== 'lue' || refus !== null) return
    gesteEnCours.current = true
    const dossierEcrit = dossierId
    const retrait = estDesigne
    try {
      const confirmation = confirmationDeLaDesignation({
        nom: dossierNom, retrait,
        remplace: !retrait && lecture.dossierActuel !== null ? lecture.nomDeLActuel ?? 'un autre dossier' : null,
      })
      if (!window.confirm(confirmation)) return
      setEnCours(true)
      setAvis(null)
      const issue = await designerLeDossierDuCabinet(lecture.cabinetId, retrait ? null : dossierEcrit)
      setAvis(issue.ok
        ? { dossierId: dossierEcrit, erreur: null, fait: retrait ? 'La désignation est retirée ✓' : 'Ce dossier est désormais le dossier du cabinet ✓' }
        : { dossierId: dossierEcrit, erreur: `Rien n’a changé : ${issue.message}`, fait: null })
      // Relue, quoi qu'il arrive : la désignation telle que la base la voit maintenant ; la barre latérale aussi.
      onDesignationEcrite()
      signalerMajDossiers()
    } finally {
      gesteEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }} data-testid="dossier-du-cabinet">
      <h3 style={{ marginTop: 0 }}>Dossier du cabinet</h3>
      {lecture === null && <p className="muted">Chargement…</p>}
      {lecture?.etat === 'illisible' && (
        <p className="error-text" role="alert">
          La désignation du dossier du cabinet n’a pas pu être lue — {lecture.motif}. Aucun geste n’est offert tant qu’elle ne
          l’est pas.
        </p>
      )}
      {lecture?.etat === 'lue' && (
        <>
          <p className="muted" style={{ marginTop: -8 }}>
            {ceQueDitLaDesignation({
              estLeDossierDuCabinet: estDesigne, unAutreEstDesigne: lecture.dossierActuel !== null && !estDesigne, nomDeLAutre: lecture.nomDeLActuel,
            })}
          </p>
          {estChef ? (
            <>
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button" className={estDesigne ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
                  disabled={enCours || refus !== null} onClick={() => { void agir() }}
                >
                  {enCours ? 'Enregistrement…' : estDesigne ? 'Retirer la désignation'
                    : lecture.dossierActuel !== null ? 'Désigner ce dossier à sa place' : 'Désigner ce dossier comme celui du cabinet'}
                </button>
              </div>
              {refus !== null && <p className="muted" style={{ marginBottom: 0 }}>{motsDuRefus(refus)}</p>}
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>Seul un comptable en chef désigne le dossier du cabinet.</p>
          )}
          {erreur && <p className="error-text" role="alert">{erreur}</p>}
          {fait && <p className="muted">{fait}</p>}
        </>
      )}
    </div>
  )
}
