import { useState } from 'react'
import { formatDate, formatMoney } from '../../lib/format'
import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_FOURNISSEURS,
  COMPTE_FOURNISSEURS_IMMOBILISATIONS, libelleCompteTenu,
} from '../../lib/comptes'
import {
  estDivers, MOTIFS_LETTRAGE_MANUEL, type EtatLettrageManuel, type EtatPieceDuTiers, type LettrageProposé, type PieceDuTiers,
  type SoldeDeTiers,
} from '../../lib/lettrage'

// LES COMPTES DE TIERS À UNE DATE — ligne 32 de la feuille de route (lib/lettrage.ts, `comptesDeTiers`).
//
// Ce que le lettrage laisse ouvert, fournisseur par fournisseur et client par client, et depuis quand : la balance
// âgée. Une facture et les règlements qui la soldent sont lettrés — ils reçoivent le même code dans le FEC — et ne
// figurent plus ici : ce lettrage se déduit du rapprochement bancaire.
//
// CE QUI SE SOLDE ENTRE PIÈCES, sans mouvement bancaire — une facture et son avoir —, se lettre ICI À LA MAIN (seconde
// brique) : le cabinet coche les pièces d'un même tiers et « Lettrer ensemble » les apparie (`lettrer_pieces`). Les
// lettrages évidents sont proposés, jamais faits sans clic, et chaque lettrage fait à la main se défait. Rien du
// brouillon ne bouge : le lettrage n'est qu'un appariement, que le FEC porte.
//
// La carte ne vaut qu'en engagement : en trésorerie la charge est face à la banque, et il n'y a pas de compte de
// tiers à suivre. C'est l'onglet qui décide de la montrer.

// Ce que dit un montant positif, compte par compte : les montants se lisent dans le sens normal du compte
// (`sensNormal`), créditeur pour ce qu'on doit, débiteur pour ce qu'on attend.
const SENS_POSITIF: Readonly<Record<string, string>> = {
  [COMPTE_FOURNISSEURS]: 'reste à payer',
  [COMPTE_FOURNISSEURS_IMMOBILISATIONS]: 'reste à payer',
  [COMPTE_CLIENTS]: 'reste à encaisser',
  [COMPTE_COURANT_ASSOCIE]: 'dû au dirigeant',
  [COMPTE_AUTRES_DEBITEURS_CREDITEURS]: 'dû au dirigeant',
}

const LIBELLES_ETATS: Readonly<Record<EtatPieceDuTiers, string>> = {
  ouverte: 'Sans règlement',
  payee_en_partie: 'Réglée en partie',
  payee_en_trop: 'Réglée en trop',
  // Un acompte versé avant la facture, ou une facture datée après l'arrêté.
  reglement_sans_facture: 'Règlement sans facture à cette date',
}

const TRANCHES = ['30 jours au plus', '31 à 60 jours', '61 à 90 jours', 'Plus de 90 jours'] as const

const nombre = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const

// Ce que l'onglet confie à la carte pour le lettrage fait à la main. Les calculs vivent dans lib/lettrage.ts ; l'écriture
// et son verrou, dans l'onglet.
export interface LettrageALaMain {
  // Non nul quand le lettrage ne s'offre pas — une vue arrêtée à une autre date qu'aujourd'hui, des pièces lues en
  // partie — et la phrase qui le dit : ni case à cocher, ni proposition.
  suspendu: string | null
  etats: readonly EtatLettrageManuel[]
  propositions: readonly LettrageProposé[]
  // Le nom de fichier de chaque pièce : une proposition et un lettrage fait à la main désignent des pièces qui ne
  // figurent pas forcément parmi les pièces ouvertes.
  nomDesPieces: ReadonlyMap<string, string>
  // Ce que la base refuserait, dit avant le clic (`refusLettrageManuel`).
  refus: (compte: string, pieceIds: readonly string[]) => string | null
  // Un lettrage ou un retrait en cours : tout geste attend.
  occupe: boolean
  erreur: string | null
  // Rend vrai quand le lettrage est enregistré et la vue relue : la carte oublie alors les pièces cochées.
  onLettrer: (compte: string, pieceIds: string[]) => Promise<boolean>
  onDefaire: (etat: EtatLettrageManuel) => void
}

interface Selection {
  compte: string
  pieceIds: string[]
}

export default function ComptesDeTiersCard({
  soldes, dateArrete, finExercice, lectureIncomplete, lignesDeTiers, anterieuresALOuverture, ouverture, loading, lettrage,
}: {
  soldes: readonly SoldeDeTiers[]
  // AAAA-MM-JJ : le jour au soir duquel la vue se lit.
  dateArrete: string
  // Vrai quand l'arrêté est le 31 décembre de l'exercice choisi dans l'en-tête, faux quand c'est aujourd'hui.
  finExercice: boolean
  // Non nul quand le brouillon ou les à-nouveaux n'ont pas été lus en entier : la carte ne conclut pas. Une
  // écriture non lue ferait paraître ouverte une facture réglée, ou soldé un tiers qui doit encore — et « tout est
  // soldé » sur une lecture partielle serait une bonne nouvelle fabriquée.
  lectureIncomplete: string | null
  // Le nombre de lignes, écritures et à-nouveaux, portées sur un compte de tiers jusqu'à l'arrêté : distingue
  // « tout est soldé » de « rien n'est encore écrit », que la même liste vide dirait sans lui.
  lignesDeTiers: number
  // Les lignes d'un compte de tiers antérieures à l'ouverture d'un dossier repris, quand l'arrêté la suit : leur
  // effet est déjà dans les soldes repris, et la vue les compte une seconde fois.
  anterieuresALOuverture: number
  ouverture: string | null
  loading: boolean
  lettrage: LettrageALaMain
}) {
  const parCompte = new Map<string, SoldeDeTiers[]>()
  for (const s of soldes) parCompte.set(s.compte, [...(parCompte.get(s.compte) ?? []), s])
  // Les pièces cochées, sur UN compte : un lettrage se fait sur le compte où les pièces se soldent, et cocher une pièce
  // d'un autre compte repart de celle-là.
  const [selection, setSelection] = useState<Selection>({ compte: '', pieceIds: [] })
  const basculer = (compte: string, pieceId: string) => setSelection((s) => {
    if (s.compte !== compte) return { compte, pieceIds: [pieceId] }
    return s.pieceIds.includes(pieceId)
      ? { compte, pieceIds: s.pieceIds.filter((id) => id !== pieceId) }
      : { compte, pieceIds: [...s.pieceIds, pieceId] }
  })
  async function lettrer(compte: string, pieceIds: string[]) {
    if (await lettrage.onLettrer(compte, pieceIds)) setSelection({ compte: '', pieceIds: [] })
  }
  const nomDe = (pieceId: string) => lettrage.nomDesPieces.get(pieceId) ?? 'pièce non lue'

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Comptes de tiers au {formatDate(dateArrete)}</h3>
      <p className="muted" style={{ marginTop: -8, fontSize: '0.82rem' }}>
        Ce qui reste ouvert, fournisseur par fournisseur et client par client, et depuis quand
        {finExercice ? ' — arrêté au 31 décembre de l’exercice choisi en tête du dossier' : ' — arrêté à aujourd’hui'}.
        Une facture et les règlements qui la soldent sont lettrés, et n’y figurent plus ; une facture que solde un
        avoir, sans mouvement bancaire, se lettre ici à la main.
      </p>
      <details className="muted" style={{ fontSize: '0.82rem', marginBottom: 12 }}>
        <summary>Comment lire cette vue</summary>
        <p style={{ marginBottom: 0 }}>
          Le lettrage se déduit du rapprochement bancaire : la facture et ses règlements portent le même code dans le
          FEC (EcritureLet). Ce qui se solde entre pièces sans mouvement — une facture et son avoir — se lettre à la
          main : coche les pièces d’un même tiers qui se soldent ensemble, puis « Lettrer ensemble ». Aucune écriture
          n’est modifiée, et un lettrage fait à la main se défait. La vue lit tout le brouillon d’écritures, exercices précédents et
          à-nouveaux compris : une pièce dont l’écriture n’est pas encore générée n’y est pas. La balance d’un
          exercice, au-dessus, ne compte que ses propres écritures — aucun solde n’est encore reporté d’un exercice
          sur l’autre —, si bien qu’un compte de tiers peut y porter un autre solde. Un montant se lit du côté du
          compte : ce qui reste à payer à un fournisseur, à encaisser d’un client, ce qui est dû au dirigeant ; un
          montant négatif dit l’inverse, un avoir à recevoir ou un trop-payé à rendre.
        </p>
      </details>
      {loading ? (
        <div className="skeleton skeleton-widget" style={{ height: 120 }} />
      ) : lectureIncomplete ? (
        <p className="error-text" style={{ margin: 0 }}>
          Les écritures du brouillon, les à-nouveaux ou les lettrages faits à la main n’ont pas pu être lus en entier
          ({lectureIncomplete}). Les comptes de tiers ne peuvent pas être dits : une facture réglée ou lettrée paraîtrait
          ouverte, ou un tiers soldé alors qu’il doit encore. Recharge la page.
        </p>
      ) : (
        <>
          {anterieuresALOuverture > 0 && ouverture && (
            <p className="error-text" style={{ fontSize: '0.85rem', marginTop: 0 }}>
              {`${anterieuresALOuverture} écriture${anterieuresALOuverture > 1 ? 's' : ''} sur un compte de tiers `
                + `précède${anterieuresALOuverture > 1 ? 'nt' : ''} l’ouverture du ${formatDate(ouverture)} : leur effet `
                + 'est déjà dans les soldes repris, et cette vue le compte une seconde fois. Retire-les ou redate-les '
                + 'depuis l’onglet Écritures.'}
            </p>
          )}
          {lettrage.erreur && <p className="error-text" role="alert" style={{ marginTop: 0 }}>{lettrage.erreur}</p>}
          {lettrage.suspendu === null && lettrage.propositions.length > 0 && (
            <div className="lettrages-proposes" style={{ marginBottom: 12 }}>
              <h4 style={{ margin: '0 0 6px' }}>Lettrages proposés</h4>
              <p className="muted" style={{ marginTop: 0, fontSize: '0.82rem' }}>
                Des pièces d’un même tiers qui se soldent entre elles, sans mouvement bancaire. Rien n’est lettré sans
                ton clic.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {lettrage.propositions.map((p) => (
                  <li key={`${p.compte}|${p.pieceIds.join('|')}`} style={{ marginBottom: 6 }}>
                    {`${p.libelle} (${p.compte}) : ${p.pieceIds.map(nomDe).join(' et ')} se soldent — ${formatMoney(p.montant)}`}
                    {' '}
                    <button
                      type="button" className="btn btn-outline btn-sm" disabled={lettrage.occupe}
                      onClick={() => lettrer(p.compte, p.pieceIds)}
                    >
                      Lettrer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {soldes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {lignesDeTiers === 0
                ? `Aucune facture ni aucun règlement n’est écrit sur un compte de tiers au ${formatDate(dateArrete)} — les écritures se génèrent depuis l’onglet Écritures.`
                : `Tous les comptes de tiers sont soldés au ${formatDate(dateArrete)} : chaque facture écrite l’est par ses règlements ou par un lettrage.`}
            </p>
          ) : (
            [...parCompte.entries()].map(([compte, lignes]) => (
              <SectionDuCompte
                key={compte} compte={compte} lignes={lignes} lettrage={lettrage}
                cochees={selection.compte === compte ? selection.pieceIds : []}
                onBasculer={(pieceId) => basculer(compte, pieceId)}
                onLettrer={(pieceIds) => lettrer(compte, pieceIds)}
              />
            ))
          )}
          {lettrage.suspendu !== null && soldes.some((s) => s.pieces.length > 0) && (
            <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0 }}>{lettrage.suspendu}</p>
          )}
          {lettrage.etats.length > 0 && (
            <LettragesFaitsALaMain etats={lettrage.etats} nomDe={nomDe} occupe={lettrage.occupe} onDefaire={lettrage.onDefaire} />
          )}
        </>
      )}
    </div>
  )
}

function SectionDuCompte({ compte, lignes, lettrage, cochees, onBasculer, onLettrer }: {
  compte: string
  lignes: readonly SoldeDeTiers[]
  lettrage: LettrageALaMain
  cochees: readonly string[]
  onBasculer: (pieceId: string) => void
  onLettrer: (pieceIds: string[]) => void
}) {
  // Les totaux en centimes, comme la vue : sommer des euros en virgule flottante ferait afficher un total qui
  // diffère d'un centime de la somme des lignes.
  const total = lignes.reduce((t, s) => t + Math.round(s.solde * 100), 0) / 100
  const tranches = [0, 1, 2, 3].map((i) => lignes.reduce((t, s) => t + Math.round(s.tranches[i] * 100), 0) / 100)
  const pieces = lignes.flatMap((s) => s.pieces.map((p) => ({ tiers: s, piece: p })))
  return (
    <section style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 8px' }}>
        {compte} — {libelleCompteTenu(compte) ?? compte}
        <span className="muted" style={{ fontWeight: 400 }}> · {SENS_POSITIF[compte] ?? 'solde'} {formatMoney(total)}</span>
      </h4>
      {/* Largeurs fixes : les tableaux des comptes se suivent, et leurs colonnes s'alignent d'une section à l'autre au lieu
          de suivre chacune la longueur de ses noms. */}
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '30%' }} />
            <col style={{ width: '14%' }} />
            {TRANCHES.map((t) => <col key={t} style={{ width: '14%' }} />)}
          </colgroup>
          <thead>
            <tr>
              <th>Tiers</th>
              <th style={{ textAlign: 'right' }}>Solde</th>
              {TRANCHES.map((t) => <th key={t} style={{ textAlign: 'right' }}>{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {lignes.map((s) => (
              <tr key={`${s.origine}|${s.auxiliaire ?? ''}|${s.libelle}`}>
                <td>
                  <span>
                    {s.libelle}
                    {s.auxiliaire && <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>{s.auxiliaire}</span>}
                  </span>
                </td>
                <td data-libelle="Solde" style={nombre}>{formatMoney(s.solde)}</td>
                {s.origine === 'tiers'
                  ? s.tranches.map((t, i) => (
                    <td key={TRANCHES[i]} data-libelle={TRANCHES[i]} style={nombre}>{t === 0 ? '—' : formatMoney(t)}</td>
                  ))
                  : (
                    <td colSpan={4} className="muted" style={{ fontSize: '0.82rem' }}>
                      {s.origine === 'ouverture'
                        ? 'Ancienneté inconnue : la balance reprise ne détaille pas ce solde par tiers.'
                        : 'Ancienneté non suivie : ces écritures n’ont pas de pièce.'}
                    </td>
                  )}
              </tr>
            ))}
          </tbody>
          {/* Un total sous une seule ligne la répéterait. `colSpan` sur l'intitulé : replié en fiche, la cellule disparaît
              (index.css) et le montant, qui porte « Total » en libellé, l'annonce seul. */}
          {lignes.length > 1 && (
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={1}>Total</td>
                <td data-libelle="Total" style={nombre}>{formatMoney(total)}</td>
                {tranches.map((t, i) => (
                  <td key={TRANCHES[i]} data-libelle={TRANCHES[i]} style={nombre}>{t === 0 ? '—' : formatMoney(t)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pieces.length > 0 && (
        <PiecesOuvertes pieces={pieces} cochables={lettrage.suspendu === null} occupe={lettrage.occupe} cochees={cochees} onBasculer={onBasculer} />
      )}
      {cochees.length > 0 && (
        <BarreDeLettrage compte={compte} pieces={pieces} cochees={cochees} lettrage={lettrage} onLettrer={onLettrer} />
      )}
    </section>
  )
}

// La sélection d'un compte : ce qu'elle laisse sur le compte, et ce que la base refuserait — dit avant le clic. Une
// seule pièce cochée DEMANDE la suivante sans crier à l'erreur.
function BarreDeLettrage({ compte, pieces, cochees, lettrage, onLettrer }: {
  compte: string
  pieces: readonly { tiers: SoldeDeTiers; piece: PieceDuTiers }[]
  cochees: readonly string[]
  lettrage: LettrageALaMain
  onLettrer: (pieceIds: string[]) => void
}) {
  const reste = cochees.reduce((t, id) => t + Math.round((pieces.find((p) => p.piece.pieceId === id)?.piece.reste ?? 0) * 100), 0) / 100
  const refus = cochees.length < 2 ? null : lettrage.refus(compte, cochees)
  return (
    <div className="field-row aligne-bas" style={{ marginTop: 8, alignItems: 'center' }}>
      <span>
        {`${cochees.length} pièce${cochees.length > 1 ? 's' : ''} cochée${cochees.length > 1 ? 's' : ''} — reste ${formatMoney(reste)}`}
      </span>
      <button
        type="button" className="btn btn-primary btn-sm" disabled={lettrage.occupe || cochees.length < 2 || refus !== null}
        onClick={() => onLettrer([...cochees])}
      >
        Lettrer ensemble
      </button>
      {cochees.length < 2
        ? <span className="muted" style={{ fontSize: '0.82rem' }}>Coche au moins une autre pièce du même tiers.</span>
        : refus && <span className="error-text" style={{ fontSize: '0.82rem' }}>{refus}</span>}
    </div>
  )
}

// Les lettrages faits à la main, qu'ils tiennent ou non : c'est le seul endroit d'où l'on défait un lettrage, et celui
// qui dit pourquoi un lettrage ne tient plus. Déplié quand l'un d'eux ne tient plus, ou quand ils sont peu nombreux.
function LettragesFaitsALaMain({ etats, nomDe, occupe, onDefaire }: {
  etats: readonly EtatLettrageManuel[]
  nomDe: (pieceId: string) => string
  occupe: boolean
  onDefaire: (etat: EtatLettrageManuel) => void
}) {
  const quiNeTiennentPlus = etats.filter((e) => e.motif !== null).length
  return (
    <details open={quiNeTiennentPlus > 0 || etats.length <= 10} style={{ marginTop: 16 }}>
      <summary>
        Lettrages faits à la main ({etats.length})
        {quiNeTiennentPlus > 0 && <span className="error-text">{` — ${quiNeTiennentPlus} ne ${quiNeTiennentPlus > 1 ? 'tiennent' : 'tient'} plus`}</span>}
      </summary>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {etats.map((e) => (
          <li key={e.groupe} style={{ marginBottom: 8 }}>
            <span>
              {`${e.libelle} (${e.compte}) : ${e.pieceIds.map(nomDe).join(', ') || 'aucune pièce'}`}
              {e.le && <span className="muted">{` — lettrées le ${formatDate(e.le)}`}</span>}
            </span>
            {' '}
            {e.motif === null
              ? <span className="badge badge-ok">se soldent</span>
              : (
                <span className="error-text" style={{ display: 'block', fontSize: '0.85rem' }}>
                  {MOTIFS_LETTRAGE_MANUEL[e.motif]}
                  {e.motif === 'ne_se_solde_plus' && ` Il reste ${formatMoney(e.reste)} sur le compte.`}
                  {' Ce lettrage n’est pas porté au FEC : défais-le, ou rends-lui ses pièces.'}
                </span>
              )}
            <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4 }} disabled={occupe} onClick={() => onDefaire(e)}>
              Défaire
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function PiecesOuvertes({ pieces, cochables, occupe, cochees, onBasculer }: {
  pieces: readonly { tiers: SoldeDeTiers; piece: PieceDuTiers }[]
  // Vrai quand le lettrage à la main s'offre : une colonne de cases à cocher en tête du tableau.
  cochables: boolean
  occupe: boolean
  cochees: readonly string[]
  onBasculer: (pieceId: string) => void
}) {
  return (
    <details open={pieces.length <= 10} style={{ marginTop: 8 }}>
      <summary>Pièces ouvertes ({pieces.length})</summary>
      <div className="table-scroll tableau-adaptable" style={{ marginTop: 8 }}>
        <table className="table-empilable" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {cochables && <col style={{ width: '6%' }} />}
            <col style={{ width: cochables ? '16%' : '18%' }} />
            <col style={{ width: cochables ? '13%' : '15%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead>
            <tr>
              {cochables && <th className="col-checkbox" aria-label="Lettrer" />}
              <th>Tiers</th>
              <th>Pièce</th>
              <th>Facture du</th>
              <th style={{ textAlign: 'right' }}>Facture</th>
              <th style={{ textAlign: 'right' }}>Réglé</th>
              <th style={{ textAlign: 'right' }}>Reste</th>
              <th style={{ textAlign: 'right' }}>Âge</th>
              <th>État</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map(({ tiers, piece: p }) => (
              <tr key={`${tiers.auxiliaire ?? tiers.libelle}|${p.pieceId}`}>
                {cochables && (
                  <td className="col-checkbox" data-libelle="Lettrer">
                    {/* Une pièce déjà dans un lettrage fait à la main, ou d'un tiers sans nom (compte « divers »), ne se
                        coche pas : la base refuserait la première, et rien ne dit que la seconde est du même tiers. */}
                    <input
                      type="checkbox" aria-label={`Cocher ${p.libelle}`} checked={cochees.includes(p.pieceId)}
                      disabled={occupe || p.lettrageManuel !== null || (tiers.auxiliaire !== null && estDivers(tiers.compte, tiers.auxiliaire))}
                      onChange={() => onBasculer(p.pieceId)}
                    />
                  </td>
                )}
                <td>{tiers.libelle}</td>
                <td data-libelle="Pièce">{p.libelle}</td>
                <td data-libelle="Facture du">{formatDate(p.dateFacture)}</td>
                <td data-libelle="Facture" style={nombre}>{formatMoney(p.facture)}</td>
                <td data-libelle="Réglé" style={nombre}>{formatMoney(p.regle)}</td>
                <td data-libelle="Reste" style={nombre}>{formatMoney(p.reste)}</td>
                <td data-libelle="Âge" style={nombre}>{p.age} j</td>
                <td data-libelle="État">
                  {LIBELLES_ETATS[p.etat]}
                  {p.lettrageManuel !== null && <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>dans un lettrage fait à la main</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
