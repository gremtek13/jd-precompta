import { useEffect, useMemo, useState } from 'react'
import { EntetePanneau } from '../../components/PanneauDroit'
import BarreRecherche from '../../components/BarreRecherche'
import { IconRevision } from '../../components/icons'
import { formatDate, formatMoney } from '../../lib/format'
import { correspondALaRecherche } from '../../lib/recherche'
import {
  LONGUEUR_MAX_TEXTE, LONGUEUR_MAX_TITRE, NATURES_DU_DOSSIER_PERMANENT, argumentsDeConsigner, etatDeLaCitation, refusDeConsigner,
  type CitationPermanente, type ContexteDuDossierPermanent, type EntreeDuDossierPermanent, type SaisieDuDossierPermanent,
} from '../../lib/dossierPermanent'
import { EXPLICATION_DE_LA_CITATION, PASTILLE_DE_LA_CITATION, libelleDeLaNature } from '../../lib/dossierPermanentEcran'
import type { DocumentPourRevision } from '../../lib/revisionPreuves'
import type { NatureDossierPermanent, Piece } from '../../lib/types'

// LE PANNEAU D'UNE ENTRÉE DU DOSSIER PERMANENT (ligne 41, étape R7, phase C), dans le volet de droite : « Consigner une
// entrée » ou « Nouvelle version » d'une entrée courante. La fiche ne lit ni n'écrit rien : l'onglet Révision lui donne ce
// qu'il a lu EN ENTIER (les entrées, les pièces et les documents du dossier) et écrit par `consigner_au_dossier_permanent`
// SEULE, sous son verrou.
//
// LE REFUS SE DIT AVANT LE CLIC : le bouton passe ce qu'il enverrait au module (`refusDeConsigner`, confronté au texte de la
// fonction et rejoué sur son essai) ; refusé, il est grisé, et le refus se lit sous les mots de la base. La base reste juge :
// un refus qu'elle oppose quand même se dit à son tour.
//
// UNE ENTRÉE NE SE MODIFIE PAS : une nouvelle version la REMPLACE, l'historique reste, et la version remplacée est RETENUE à
// l'ouverture du panneau — si une autre a été consignée ou la version retirée depuis, le module le dit avant le clic
// (refus 8), au lieu que la saisie remplace sans le voir une version jamais lue. Une nouvelle version part de la courante
// (nature, titre, texte, citation, validité) : le cabinet corrige ce qui a changé, et le reste est repris tel quel.
//
// TROIS GARDE-FOUS DE CE PRÉREMPLISSAGE (décision du cabinet du 12/10/2026, R7C-Q2) : « Enregistrer la nouvelle version » reste
// grisé tant que rien ne diffère de la version courante (une version identique ne remplacerait rien) ; le volet MONTRE l'état de la
// citation reprise, et dit qu'une citation choisie ici verra son empreinte relevée à l'enregistrement ; et si la citation reprise est
// « changée » ou « disparue », il dit AVANT le clic que la nouvelle version citera le fichier tel qu'il est aujourd'hui — l'entrée
// paraîtra alors en règle, et seul l'historique gardera la trace du changement —, puis l'enregistrement demande une confirmation.
// Ce dernier cas suffit à dégriser le bouton (R7C2-Q1, le même jour) : citer de nouveau le fichier changé est en soi un changement.

export interface PropsFicheDossierPermanent {
  dossierId: string
  // L'entrée dont on écrit une nouvelle version, ou rien pour une entrée nouvelle.
  entree: EntreeDuDossierPermanent | null
  contexte: ContexteDuDossierPermanent
  // Ce qu'on peut citer : les pièces et les documents du dossier, lus en entier.
  // `storage_hash` : de quoi dire l'état de la citation reprise (l'empreinte du jour contre celle qu'elle a relevée).
  pieces: readonly Pick<Piece, 'id' | 'nom_fichier' | 'tiers' | 'date_piece' | 'montant_ttc' | 'storage_hash'>[]
  documents: readonly Pick<DocumentPourRevision, 'id' | 'nom_fichier' | 'storage_hash'>[]
  occupe: boolean
  erreur: string | null
  // Rend vrai quand la base a écrit ; refusée, la saisie reste pour se corriger.
  onConsigner: (saisie: SaisieDuDossierPermanent, remplaceId: string | null) => Promise<boolean>
  // Rapporte si une saisie attend : la garde du volet le consulte. Doit être une fonction STABLE.
  onModifiee: (modifiee: boolean) => void
  onFermer: () => void
}

interface Formulaire {
  nature: NatureDossierPermanent | ''
  titre: string
  texte: string
  citation: CitationPermanente | null
  valableDu: string
  valableJusquAu: string
}

const MEME_CITATION = (a: CitationPermanente | null, b: CitationPermanente | null) =>
  a === null || b === null ? a === b : 'pieceId' in a && 'pieceId' in b ? a.pieceId === b.pieceId
    : 'documentId' in a && 'documentId' in b && a.documentId === b.documentId

function formulaireDepart(entree: EntreeDuDossierPermanent | null): Formulaire {
  if (entree === null) return { nature: '', titre: '', texte: '', citation: null, valableDu: '', valableJusquAu: '' }
  const v = entree.courante
  return {
    nature: v.nature, titre: v.titre, texte: v.texte ?? '',
    citation: v.piece_id !== null ? { pieceId: v.piece_id } : v.document_id !== null ? { documentId: v.document_id } : null,
    valableDu: v.valable_du ?? '', valableJusquAu: v.valable_jusqu_au ?? '',
  }
}

const caracteres = (t: string) => [...t].length

const RIEN_N_A_CHANGE = 'Rien n’a changé depuis la version courante : une nouvelle version identique ne remplacerait rien.'

// Ce que le cabinet lit AVANT le clic quand le fichier cité n'est plus celui que la version courante a cité (empreinte changée
// ou disparue) : la base relèvera l'empreinte du fichier d'AUJOURD'HUI.
function avertissementDeLaCitation(etat: 'changee' | 'disparue'): string {
  return etat === 'changee'
    ? 'Cette nouvelle version citera le fichier tel qu’il est aujourd’hui : son empreinte sera relevée de nouveau, l’entrée paraîtra intacte, et seul l’historique gardera la trace du changement.'
    : 'Cette nouvelle version citera le fichier tel qu’il est aujourd’hui : son empreinte sera relevée de nouveau (le fichier n’en porte plus, l’entrée paraîtra sans empreinte), et seul l’historique gardera la trace de sa disparition.'
}

export default function FicheDossierPermanent(p: PropsFicheDossierPermanent) {
  const { entree } = p
  const [depart] = useState(() => formulaireDepart(entree))
  const [f, setF] = useState<Formulaire>(depart)
  // La version que la saisie remplacera, RETENUE à l'ouverture : l'écran ne la change pas sous les yeux du cabinet.
  const [remplaceId] = useState<string | null>(() => entree?.courante.id ?? null)
  const [recherche, setRecherche] = useState('')

  const modifiee = f.nature !== depart.nature || f.titre !== depart.titre || f.texte !== depart.texte
    || !MEME_CITATION(f.citation, depart.citation) || f.valableDu !== depart.valableDu || f.valableJusquAu !== depart.valableJusquAu
  const { onModifiee } = p
  useEffect(() => { onModifiee(modifiee) }, [modifiee, onModifiee])

  const saisie: SaisieDuDossierPermanent = {
    nature: f.nature === '' ? null : f.nature, titre: f.titre, texte: f.texte, citation: f.citation,
    valableDu: f.valableDu === '' ? null : f.valableDu, valableJusquAu: f.valableJusquAu === '' ? null : f.valableJusquAu,
  }
  const arguments_ = argumentsDeConsigner(p.dossierId, saisie, remplaceId)
  const refus = refusDeConsigner(arguments_, p.contexte)
  // Une date qui n'existe pas (le 31 février) ne part pas : la fonction ne la lirait pas comme une date. L'écran le dit au lieu
  // d'envoyer une entrée sans la borne que le cabinet croyait poser.
  const dateDebutIllisible = saisie.valableDu !== null && arguments_.p_valable_du === null
  const dateFinIllisible = saisie.valableJusquAu !== null && arguments_.p_valable_jusqu_au === null
  const dateIllisible = dateDebutIllisible || dateFinIllisible
  const message = refus?.message ?? (dateIllisible ? 'Une date de validité n’existe pas dans le calendrier : elle ne partirait pas.' : null)
  const libelle = entree === null ? 'Consigner l’entrée' : 'Enregistrer la nouvelle version'

  // Ce qu'on peut citer, montré quand on cherche : la recherche dit combien elle en trouve sur combien.
  const citables = useMemo(() => [
    ...p.pieces.map((x) => ({
      cle: `p-${x.id}`, source: { pieceId: x.id } as CitationPermanente, nom: x.nom_fichier,
      texte: [x.nom_fichier, x.tiers ?? '', x.date_piece === null ? '' : formatDate(x.date_piece), x.montant_ttc === null ? '' : formatMoney(x.montant_ttc)],
    })),
    ...p.documents.map((x) => ({ cle: `d-${x.id}`, source: { documentId: x.id } as CitationPermanente, nom: x.nom_fichier, texte: [x.nom_fichier] })),
  ], [p.pieces, p.documents])
  const piecesParId = useMemo(() => new Map(p.pieces.map((x) => [x.id.toLowerCase(), x])), [p.pieces])
  const documentsParId = useMemo(() => new Map(p.documents.map((x) => [x.id.toLowerCase(), x])), [p.documents])
  // L'état de la citation REPRISE de la version courante, tant que la saisie la garde telle quelle : retirée ou remplacée dans le
  // volet, ce n'est plus elle qu'on enregistrerait.
  const etatDeLaCitationReprise = entree !== null && f.citation !== null && MEME_CITATION(f.citation, depart.citation)
    ? etatDeLaCitation(entree.courante, piecesParId, documentsParId)
    : null
  const citationChoisieIci = f.citation !== null && !MEME_CITATION(f.citation, depart.citation)
  const citationAAvertir = etatDeLaCitationReprise === 'changee' || etatDeLaCitationReprise === 'disparue' ? etatDeLaCitationReprise : null
  // Une nouvelle version dont rien ne diffère de la courante ne remplace rien ; « Consigner l'entrée » d'une entrée nouvelle n'est
  // pas concerné. Le refus du module, plus grave, se dit d'abord. Une citation reprise dont le fichier a changé ou n'a plus
  // d'empreinte fait exception (décision du cabinet du 12/10/2026, R7C2-Q1) : la citer de nouveau relève l'empreinte du fichier
  // d'aujourd'hui, et c'est un changement — que l'enregistrement fait confirmer.
  const rienNaChange = entree !== null && !modifiee && citationAAvertir === null
  const messageAffiche = message ?? (rienNaChange ? RIEN_N_A_CHANGE : null)
  const trouvees = recherche.trim() === '' ? [] : citables.filter((x) => correspondALaRecherche(x.texte, recherche))
  const nomDeLaCitation = f.citation === null ? null
    : citables.find((x) => MEME_CITATION(x.source, f.citation))?.nom
      ?? ('pieceId' in f.citation ? 'pièce introuvable dans ce dossier' : 'document introuvable dans ce dossier')

  async function consigner() {
    // Le changement du fichier cité s'est dit avant le clic ; l'enregistrement le redit, car il efface la trace de la version
    // courante (comme « Retirer », qui confirme aussi).
    if (citationAAvertir !== null && !window.confirm(
      `Enregistrer cette nouvelle version de « ${p.entree?.courante.titre ?? ''} » ?\n\n${avertissementDeLaCitation(citationAAvertir)}`,
    )) return
    if (await p.onConsigner(saisie, remplaceId)) p.onFermer()
  }

  return (
    <div className="fiche-mouvement">
      <EntetePanneau
        icone={<IconRevision width={18} height={18} />}
        titre={entree === null ? 'Consigner une entrée' : 'Nouvelle version'}
        sousTitre={entree === null ? 'Dossier permanent' : `Dossier permanent · ${libelleDeLaNature(entree.courante.nature)}`}
        onFermer={p.onFermer}
      />
      <div className="fiche-mouvement-corps">
        <section className="fiche-mouvement-section">
          <p className="fiche-mouvement-note">
            {entree === null
              ? 'Une entrée dit ce que le cabinet sait durablement du dossier et de sa mission. Elle ne se modifie pas : une nouvelle version la remplacera, et l’historique reste.'
              : `Cette version remplacera celle du ${formatDate(entree.courante.cree_le)} : celle-ci reste dans l’historique. La saisie part de la version courante : ce qui n’est pas modifié — dates de validité comprises — est repris tel quel.`}
          </p>
          <div className="field">
            <label htmlFor="permanent-nature">Nature</label>
            <select
              id="permanent-nature" value={f.nature} disabled={p.occupe}
              onChange={(e) => setF({ ...f, nature: e.target.value as NatureDossierPermanent | '' })}
            >
              <option value="">— choisir —</option>
              {NATURES_DU_DOSSIER_PERMANENT.map((n) => <option key={n} value={n}>{libelleDeLaNature(n)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="permanent-titre">Titre</label>
            <input id="permanent-titre" type="text" value={f.titre} disabled={p.occupe} onChange={(e) => setF({ ...f, titre: e.target.value })} />
            <p className="fiche-mouvement-note">{`${caracteres(f.titre)} / ${LONGUEUR_MAX_TITRE} caractères`}</p>
          </div>
          <div className="field">
            <label htmlFor="permanent-texte">Texte (facultatif si une pièce ou un document est cité)</label>
            <textarea id="permanent-texte" rows={6} value={f.texte} disabled={p.occupe} onChange={(e) => setF({ ...f, texte: e.target.value })} />
            <p className="fiche-mouvement-note">
              {`${caracteres(f.texte)} / ${LONGUEUR_MAX_TEXTE.toLocaleString('fr-FR')} caractères. `}
              Aucune donnée de patient : une entrée se lit dans le dossier de travail du cabinet.
            </p>
          </div>
        </section>

        <section className="fiche-mouvement-section">
          <h3>Pièce ou document cité</h3>
          <p className="fiche-mouvement-note">
            Facultatif. L’empreinte du fichier est relevée à l’enregistrement : l’écran dira si le fichier a changé depuis. Une pièce
            ou un document cité ne se supprime plus, sauf avec son dossier.
          </p>
          {etatDeLaCitationReprise !== null && (
            <p className="fiche-mouvement-note">
              <strong>Citation reprise de la version courante : </strong>
              <span className={`badge ${PASTILLE_DE_LA_CITATION[etatDeLaCitationReprise].classe}`}>{PASTILLE_DE_LA_CITATION[etatDeLaCitationReprise].mot}</span>
              {' '}
              {EXPLICATION_DE_LA_CITATION[etatDeLaCitationReprise]}
            </p>
          )}
          {citationAAvertir !== null && <p className="error-text" style={{ margin: 0 }}>{avertissementDeLaCitation(citationAAvertir)}</p>}
          {citationChoisieIci && (
            <p className="fiche-mouvement-note">Citation choisie ici : l’empreinte du fichier sera relevée à l’enregistrement.</p>
          )}
          {f.citation !== null && (
            <div className="fiche-mouvement-choix">
              <span className="nom-fichier" style={{ flex: 1, minWidth: 0 }}>{nomDeLaCitation}</span>
              <button type="button" className="btn btn-outline btn-sm" disabled={p.occupe} onClick={() => setF({ ...f, citation: null })}>
                Retirer la citation
              </button>
            </div>
          )}
          {f.citation === null && (
            <div className="field">
              <label>Citer une pièce ou un document du dossier</label>
              <BarreRecherche
                valeur={recherche}
                onChange={setRecherche}
                placeholder="Chercher un justificatif, un document…"
                affiches={trouvees.length}
                total={citables.length}
              />
              {trouvees.slice(0, 8).map((x) => (
                <div key={x.cle} className="fiche-mouvement-choix">
                  <span className="nom-fichier" style={{ flex: 1, minWidth: 0 }}>{x.nom}</span>
                  <button
                    type="button" className="btn btn-outline btn-sm" disabled={p.occupe} aria-label={`Citer ${x.nom}`}
                    onClick={() => { setF({ ...f, citation: x.source }); setRecherche('') }}
                  >
                    Citer
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="fiche-mouvement-section">
          <h3>Validité</h3>
          <p className="fiche-mouvement-note">
            Facultative : sans date, l’entrée vaut depuis toujours et sans terme. Les bornes sont comprises, de 1900 à 2100.
          </p>
          <div className="field-row">
            <div className="field">
              <label htmlFor="permanent-du">Valable du</label>
              <input id="permanent-du" type="date" value={f.valableDu} disabled={p.occupe} onChange={(e) => setF({ ...f, valableDu: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="permanent-jusqu">Valable jusqu’au</label>
              <input id="permanent-jusqu" type="date" value={f.valableJusquAu} disabled={p.occupe} onChange={(e) => setF({ ...f, valableJusquAu: e.target.value })} />
            </div>
          </div>
        </section>

        {messageAffiche && <p className="fiche-mouvement-note"><strong>{`« ${libelle} » : `}</strong>{messageAffiche}</p>}
        {p.erreur && <p className="error-text" style={{ margin: 0 }}>{p.erreur}</p>}
      </div>
      <div className="fiche-mouvement-pied">
        <div className="fiche-mouvement-boutons">
          <button
            type="button" className="btn btn-primary btn-sm" disabled={p.occupe || messageAffiche !== null} title={messageAffiche ?? undefined}
            onClick={() => { void consigner() }}
          >
            {libelle}
          </button>
        </div>
      </div>
    </div>
  )
}
