import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { anneeDe, aujourdHuiSql, formatDate, formatMoney } from '../../lib/format'
import {
  calculerCa3,
  comparerDeclarations,
  creditReporte,
  declarationPrecedente,
  dernierePeriodeClose,
  libellePeriode,
  LIGNES_CA3,
  periodesDeLAnnee,
  type DonneesTva,
  type LigneAffichee,
  type MotifNonPlacee,
} from '../../lib/declarationTva'
import type { DeclarationTva, LigneBancaire, PeriodiciteTva, Piece } from '../../lib/types'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import BrouillonBanner from '../../components/BrouillonBanner'

// LA DÉCLARATION DE TVA (CA3), PRÉPARÉE CASE PAR CASE — ligne 28 de la feuille de route, étape 1.
//
// Le calcul vit dans lib/declarationTva.ts ; cet écran en montre le résultat, dit ce qu'il a écarté,
// et enregistre ce qui a été déposé. La transmission elle-même (un partenaire EDI) est l'étape 2 : en
// attendant, les cases se reportent à la main dans l'espace professionnel.
//
// C'est AUSSI ici que les déclarations déposées s'enregistrent et se comparent — plus dans Écritures,
// dont le brouillon date la TVA à la pièce et ne porte rien pour un bien immobilisé : il criait à
// l'écart sur des déclarations justes. Une déclaration se compare au calcul de SA période, avec la
// même règle que celle qui l'a préparée.

interface Props {
  dossierId: string
  assujettiTva: boolean
  periodicite: PeriodiciteTva
  surDebits: boolean
  onRegimeUpdated: (modification: { tva_periodicite?: PeriodiciteTva; tva_sur_debits?: boolean }) => void
}

const LIBELLE_NON_PLACEE: Record<MotifNonPlacee, string> = {
  non_rapprochee: 'aucun paiement rapproché',
  sans_date: 'sans date',
}

const CADRES: { cadre: LigneAffichee['cadre']; titre: string }[] = [
  { cadre: 'operations', titre: 'Montant des opérations réalisées (cadre A)' },
  { cadre: 'brute', titre: 'TVA brute' },
  { cadre: 'deductible', titre: 'TVA déductible' },
  { cadre: 'solde', titre: 'TVA due ou crédit' },
]
// Les totaux se montrent toujours, même nuls ; le reste seulement quand il porte un montant : une
// liste de zéros à recopier cache les deux ou trois cases qui comptent.
const TOUJOURS_AFFICHEES = new Set(['16', '23', '28', '32'])

const nomPiece = (p: Piece) => p.tiers ?? p.nom_fichier
const pourcentage = (part: number) => `${Math.round(part * 100)} %`

interface Lu {
  pieces: Piece[]
  lignesBancaires: LigneBancaire[]
  pieceIdsImmobilisees: ReadonlySet<string>
  declarations: DeclarationTva[]
  // Le motif de chaque lecture restée incomplète, nul quand elle est entière.
  lectures: { pieces: string | null; lignes: string | null; immobilisations: string | null; declarations: string | null }
}

// Lues par tranches (voir lib/lectureComplete.ts) : une déclaration bâtie sur une partie des pièces ou
// des paiements a exactement l'air d'une déclaration juste.
async function lireDonnees(dossierId: string): Promise<Lu> {
  const [lecturePieces, lectureLignes, lectureImmobilisations, lectureDeclarations] = await Promise.all([
    lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<LigneBancaire>((debut, fin) =>
      supabase.from('lignes_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).not('piece_id', 'is', null).order('id').range(debut, fin),
    ),
    lireTout<{ piece_id: string | null; id: string }>((debut, fin) =>
      supabase.from('immobilisations').select('piece_id, id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<DeclarationTva>((debut, fin) =>
      supabase.from('declarations_tva').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('periode_debut', { ascending: false }).order('id').range(debut, fin),
    ),
  ])
  return {
    pieces: lecturePieces.lignes,
    lignesBancaires: lectureLignes.lignes,
    pieceIdsImmobilisees: new Set(lectureImmobilisations.lignes.map((i) => i.piece_id).filter((id): id is string => !!id)),
    declarations: lectureDeclarations.lignes,
    lectures: {
      pieces: lecturePieces.motif,
      lignes: lectureLignes.motif,
      immobilisations: lectureImmobilisations.motif,
      declarations: lectureDeclarations.motif,
    },
  }
}

export default function TvaTab({ dossierId, assujettiTva, periodicite, surDebits, onRegimeUpdated }: Props) {
  // Nul tant que la première lecture n'est pas revenue : l'écran montre alors ses squelettes.
  const [lu, setLu] = useState<Lu | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurRegime, setErreurRegime] = useState<string | null>(null)
  // La période choisie, AVEC la périodicité pour laquelle elle l'a été : passer de trimestrielle à
  // mensuelle ramène à la dernière période close de la nouvelle périodicité au lieu de garder un
  // indice qui désignerait un tout autre intervalle.
  const [choix, setChoix] = useState<{ periodicite: PeriodiciteTva; annee: number; index: number } | null>(null)
  // Saisies propres à une période (crédit reporté, montant déposé), clées par son début : changer de
  // période repart de ce que le calcul propose pour elle.
  const [saisieCredit, setSaisieCredit] = useState<Record<string, string>>({})
  const [saisieMontant, setSaisieMontant] = useState<Record<string, string>>({})
  const [dateDepot, setDateDepot] = useState(aujourdHuiSql())
  const [enregistrementEnCours, setEnregistrementEnCours] = useState(false)
  // Verrou d'exécution : un `useRef`, jamais un état React — deux clics du même rendu enregistreraient
  // deux fois la même déclaration (voir CLAUDE.md, « un verrou d'exécution »).
  const enregistrement = useRef(false)

  useEffect(() => {
    if (!assujettiTva) return
    let annule = false
    lireDonnees(dossierId).then((donnees) => { if (!annule) setLu(donnees) })
    return () => { annule = true }
  }, [dossierId, assujettiTva])

  // Après une écriture : l'écran garde ses chiffres pendant la relecture, puis les remplace.
  async function recharger() {
    setLu(await lireDonnees(dossierId))
  }

  async function changerRegime(modification: { tva_periodicite?: PeriodiciteTva; tva_sur_debits?: boolean }) {
    const avant = { tva_periodicite: periodicite, tva_sur_debits: surDebits }
    setErreurRegime(null)
    onRegimeUpdated(modification) // optimiste, annulé si l'enregistrement échoue
    const { error } = await supabase.from('dossiers').update(modification).eq('id', dossierId)
    if (error) {
      onRegimeUpdated(avant)
      setErreurRegime(messageErreur(error, "Le régime de TVA n'a pas pu être enregistré."))
    }
  }

  if (!assujettiTva) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Pas de déclaration de TVA</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          Ce dossier n'est pas assujetti à la TVA (badge « TVA » de l'en-tête) : il n'a pas de déclaration
          à déposer. Un dossier en franchise en base se classe lui aussi « exonéré ».
        </p>
      </div>
    )
  }

  const loading = lu === null
  const pieces = lu?.pieces ?? []
  const lignesBancaires = lu?.lignesBancaires ?? []
  const declarations = lu?.declarations ?? []
  const lectures = lu?.lectures ?? { pieces: null, lignes: null, immobilisations: null, declarations: null }
  const periodeParDefaut = dernierePeriodeClose(aujourdHuiSql(), periodicite)
  const selection = choix && choix.periodicite === periodicite
    ? choix
    : {
        periodicite,
        annee: anneeDe(periodeParDefaut.debut),
        index: periodesDeLAnnee(anneeDe(periodeParDefaut.debut), periodicite).findIndex((p) => p.debut === periodeParDefaut.debut),
      }
  const periodes = periodesDeLAnnee(selection.annee, periodicite)
  const periode = periodes[selection.index]
  const anneesProposees = [...new Set([
    selection.annee,
    anneeDe(aujourdHuiSql()),
    ...pieces.map((p) => p.date_piece).filter((d): d is string => !!d).map(anneeDe),
    ...lignesBancaires.map((l) => anneeDe(l.date)),
  ])].sort((a, b) => b - a)

  const donnees: DonneesTva = { pieces, lignesBancaires, pieceIdsImmobilisees: lu?.pieceIdsImmobilisees ?? new Set() }
  const precedente = declarationPrecedente(declarations, periode.debut)
  const creditPropose = precedente ? creditReporte(precedente) : 0
  const creditTexte = saisieCredit[periode.debut] ?? String(creditPropose)
  const creditLu = Number(creditTexte.replace(',', '.'))
  const creditValide = creditTexte.trim() !== '' && Number.isFinite(creditLu) && creditLu >= 0
  const ca3 = calculerCa3(donnees, periode, surDebits, creditValide ? creditLu : 0)
  const montantTexte = saisieMontant[periode.debut] ?? String(ca3.netPeriode)
  const montantLu = Number(montantTexte.replace(',', '.'))
  const montantValide = montantTexte.trim() !== '' && Number.isFinite(montantLu)
  const dejaDeposees = declarations.filter((d) => d.periode_debut === periode.debut && d.periode_fin === periode.fin)
  const comparees = comparerDeclarations(declarations, donnees, surDebits)

  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE : le montant proposé vient d'un calcul qui ne
  // voit qu'une partie des pièces, et le crédit proposé d'un historique qui peut en manquer une.
  const lectureIncomplete = lectures.pieces ?? lectures.lignes ?? lectures.immobilisations ?? lectures.declarations

  async function enregistrer() {
    if (enregistrement.current || lectureIncomplete || !montantValide || !creditValide) return
    enregistrement.current = true
    setEnregistrementEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.from('declarations_tva').insert({
        dossier_id: dossierId,
        periode_debut: periode.debut,
        periode_fin: periode.fin,
        tva_declaree: montantLu,
        credit_anterieur: ca3.cases.l22,
        date_declaration: dateDepot || null,
      })
      if (error) throw error
      // Le montant saisi pour cette période a servi : la prochaine visite repart du calcul.
      setSaisieMontant((s) => {
        const copie = { ...s }
        delete copie[periode.debut]
        return copie
      })
      // Le verrou tient jusqu'à la relecture : relâché avant, un second clic enregistrerait la même
      // déclaration une seconde fois, la mention « déjà déposée » n'étant pas encore revenue.
      await recharger()
    } catch (err) {
      setErreur(messageErreur(err, "La déclaration n'a pas pu être enregistrée."))
    } finally {
      enregistrement.current = false
      setEnregistrementEnCours(false)
    }
  }

  async function retirer(d: DeclarationTva) {
    const libelle = libellePeriode(d.periode_debut, d.periode_fin)
    if (!window.confirm(
      `Retirer la déclaration du ${libelle} ? Son montant et sa date de dépôt ne seront plus enregistrés, `
      + 'et le crédit qu’elle reporte ne sera plus proposé sur la déclaration suivante.',
    )) return
    setErreur(null)
    const { error } = await supabase.from('declarations_tva').delete().eq('id', d.id)
    if (error) {
      setErreur(messageErreur(error, "La déclaration n'a pas pu être retirée."))
      return
    }
    await recharger()
  }

  const lignesAffichees = (cadre: LigneAffichee['cadre']) =>
    LIGNES_CA3.filter((l) => l.cadre === cadre && (TOUJOURS_AFFICHEES.has(l.ligne) || ca3.cases[l.montant] !== 0))

  return (
    <>
      <BrouillonBanner />

      <BandeauLecturePartielle
        quoi="Les justificatifs"
        accord="lus"
        motif={lectures.pieces}
        consequence="La déclaration ci-dessous porte sur une partie d’entre eux : ne la déposez pas en l’état."
      />
      <BandeauLecturePartielle
        quoi="Les paiements rapprochés"
        accord="lus"
        motif={lectures.lignes}
        consequence="Une pièce dont le paiement n’a pas été lu ne compte dans aucune période."
      />
      <BandeauLecturePartielle
        quoi="Les immobilisations"
        motif={lectures.immobilisations}
        consequence="La TVA d’un bien immobilisé peut figurer en ligne 20 au lieu de 19."
      />
      <BandeauLecturePartielle
        quoi="Les déclarations déposées"
        motif={lectures.declarations}
        consequence="Le crédit à reporter proposé et l’historique ci-dessous peuvent en manquer une."
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Régime de TVA</h3>
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="tva-periodicite">Déclaration CA3</label>
            <select
              id="tva-periodicite"
              value={periodicite}
              onChange={(e) => changerRegime({ tva_periodicite: e.target.value as PeriodiciteTva })}
            >
              <option value="trimestrielle">Trimestrielle</option>
              <option value="mensuelle">Mensuelle</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tva-exigibilite">TVA des recettes due</label>
            <select
              id="tva-exigibilite"
              value={surDebits ? 'debits' : 'encaissements'}
              onChange={(e) => changerRegime({ tva_sur_debits: e.target.value === 'debits' })}
            >
              <option value="encaissements">À l’encaissement (prestations de services)</option>
              <option value="debits">Sur les débits (option)</option>
            </select>
          </div>
        </div>
        {erreurRegime && <p className="error-text">{erreurRegime}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>
          Une recette compte à la date de son encaissement, c’est-à-dire du mouvement bancaire rapproché
          — ou à la date de sa facture sur option pour les débits. Un achat compte à la date de son
          paiement ; une note de frais, payée hors du compte professionnel, à sa date. À partir du
          1er janvier 2027 le régime simplifié disparaît : la CA3 devient trimestrielle, mensuelle sur
          demande.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="tva-annee">Année</label>
            <select
              id="tva-annee"
              value={selection.annee}
              onChange={(e) => setChoix({ periodicite, annee: Number(e.target.value), index: Math.min(selection.index, periodes.length - 1) })}
            >
              {anneesProposees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tva-periode">Période</label>
            <select
              id="tva-periode"
              value={selection.index}
              onChange={(e) => setChoix({ periodicite, annee: selection.annee, index: Number(e.target.value) })}
            >
              {periodes.map((p, i) => <option key={p.debut} value={i}>{p.libelle}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ marginTop: 16 }}>
            <div className="skeleton skeleton-ligne" style={{ width: '60%' }} />
            <div className="skeleton skeleton-ligne" style={{ width: '40%' }} />
            <div className="skeleton skeleton-ligne" style={{ width: '50%' }} />
          </div>
        ) : (
          <>
            <h3 style={{ marginBottom: 4 }}>CA3 — {periode.libelle}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Du {formatDate(periode.debut)} au {formatDate(periode.fin)}. Montants en euros, arrondis ligne
              par ligne à l’euro le plus proche, comme l’exige la notice.
            </p>

            {dejaDeposees.map((d) => (
              <p key={d.id} className="muted">
                <span className="badge badge-neutral">déjà déposée</span>{' '}
                Une déclaration est enregistrée pour cette période
                {d.date_declaration ? `, déposée le ${formatDate(d.date_declaration)}` : ''} : TVA nette
                de {formatMoney(d.tva_declaree)}.
              </p>
            ))}

            {ca3.neant ? (
              <p><strong>Déclaration « néant »</strong> : aucune case à remplir (cochez la case néant, 0010).</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Ligne</th><th>Libellé</th><th>Code</th><th>Base hors taxe</th><th>Montant</th></tr>
                  </thead>
                  <tbody>
                    {CADRES.map(({ cadre, titre }) => {
                      const lignes = lignesAffichees(cadre)
                      if (lignes.length === 0) return null
                      return [
                        <tr key={`titre-${cadre}`}><td colSpan={5}><strong>{titre}</strong></td></tr>,
                        ...lignes.map((l) => (
                          <tr key={l.ligne}>
                            <td>{l.ligne}</td>
                            <td>{l.libelle}</td>
                            <td className="muted">{l.code}</td>
                            <td>{l.base ? formatMoney(ca3.cases[l.base]) : ''}</td>
                            <td><strong>{formatMoney(ca3.cases[l.montant])}</strong></td>
                          </tr>
                        )),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="field-row aligne-bas" style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="tva-credit">Crédit reporté de la déclaration précédente (ligne 22)</label>
                <input
                  id="tva-credit"
                  inputMode="numeric"
                  value={creditTexte}
                  onChange={(e) => setSaisieCredit((s) => ({ ...s, [periode.debut]: e.target.value }))}
                  style={{ width: 140 }}
                />
              </div>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {precedente
                ? `Repris de la déclaration du ${libellePeriode(precedente.periode_debut, precedente.periode_fin)}, sa ligne 27.`
                : 'Aucune déclaration enregistrée pour la période précédente : si elle reportait un crédit (sa ligne 27), saisissez-le ici.'}
            </p>
            {!creditValide && <p className="error-text">Le crédit reporté doit être un montant positif ou nul.</p>}

            {ca3.ecartees.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="error-text" style={{ marginBottom: 6 }}>
                  {ca3.ecartees.length} pièce(s) de la période ne sont pas dans les cases ci-dessus : on ne sait pas
                  les y placer sans deviner. Corrigez-les dans Justificatifs, ou reportez-les à la main.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Pièce</th><th>HT</th><th>TVA</th><th>Pourquoi</th></tr></thead>
                    <tbody>
                      {ca3.ecartees.map((e) => (
                        <tr key={e.piece.id}>
                          <td>{formatDate(e.piece.date_piece)}</td>
                          <td>{nomPiece(e.piece)}{e.part < 1 ? ` (part payée : ${pourcentage(e.part)})` : ''}</td>
                          <td>{formatMoney(e.piece.montant_ht)}</td>
                          <td>{formatMoney(e.piece.montant_tva)}</td>
                          <td>{e.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ca3.aValider.length > 0 && (
              <p className="error-text">
                {ca3.aValider.length} pièce(s) encore à valider tombent dans cette période et ne sont pas
                comptées : {ca3.aValider.map(nomPiece).join(', ')}. Validez-les avant de déposer.
              </p>
            )}

            {ca3.cases.E2 > 0 && (
              <p className="muted" style={{ color: 'var(--color-danger)' }}>
                Une partie des recettes n’est pas taxée (ligne E2). Si elle relève d’une activité exonérée,
                la TVA des dépenses communes n’est déductible qu’en partie (coefficient de déduction), ce
                que ce calcul n’applique pas.
              </p>
            )}

            {ca3.achatsEnDeviseSansTva.length > 0 && (
              <p className="muted" style={{ color: 'var(--color-danger)' }}>
                {ca3.achatsEnDeviseSansTva.length} achat(s) en devise sans TVA sont payés dans la période
                ({ca3.achatsEnDeviseSansTva.map(nomPiece).join(', ')}). S’il s’agit de services achetés à un
                fournisseur établi hors de France, la TVA est à autoliquider (ligne A3), ce que ce calcul ne
                fait pas.
              </p>
            )}

            {ca3.nonPlacees.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>
                  {ca3.nonPlacees.length} pièce(s) ne sont rattachées à aucun paiement : elles ne comptent dans
                  aucune déclaration tant qu’on ne les rapproche pas
                </summary>
                <p className="muted">
                  Une recette encaissée en espèces, ou réglée avec d’autres par un seul virement, n’est
                  rattachée à aucun mouvement : elle se reporte à la main. Un achat payé hors du compte
                  professionnel se classe en note de frais, qui compte à sa date.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Pièce</th><th>TTC</th><th>TVA</th><th>Pourquoi</th></tr></thead>
                    <tbody>
                      {ca3.nonPlacees.map(({ piece, motif }) => (
                        <tr key={piece.id}>
                          <td>{formatDate(piece.date_piece)}</td>
                          <td>{nomPiece(piece)}</td>
                          <td>{formatMoney(piece.montant_ttc)}</td>
                          <td>{formatMoney(piece.montant_tva)}</td>
                          <td>{LIBELLE_NON_PLACEE[motif]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {ca3.retenues.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>Les {ca3.retenues.length} pièce(s) retenues, ligne par ligne</summary>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Ligne</th><th>Date</th><th>Pièce</th><th>Part</th><th>HT</th><th>TVA</th></tr></thead>
                    <tbody>
                      {ca3.retenues.map((r) => (
                        <tr key={r.piece.id}>
                          <td>{r.ligne}</td>
                          <td>{formatDate(r.piece.date_piece)}</td>
                          <td>{nomPiece(r.piece)}</td>
                          <td>{pourcentage(r.part)}</td>
                          <td>{formatMoney(r.piece.montant_ht)}</td>
                          <td>{formatMoney(r.piece.montant_tva)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <details style={{ marginTop: 12 }}>
              <summary>Ce que ce calcul ne fait pas</summary>
              <ul className="muted">
                <li>L’autoliquidation : services achetés à un fournisseur établi hors de France (lignes A3, B2 et B4).</li>
                <li>Le coefficient de déduction d’une activité en partie exonérée.</li>
                <li>
                  Les exclusions du droit à déduction : véhicule de tourisme et son entretien, part du carburant
                  qui n’est pas déductible, cadeaux au-delà de 73 € TTC, logement.
                </li>
                <li>Les taux particuliers : 2,1 %, la Corse (le 10 % d’un dossier corse est porté ici en 9B).</li>
                <li>Le remboursement d’un crédit (ligne 26, formulaire 3519) : tout le crédit est reporté.</li>
                <li>Les taxes assimilées (ligne 29, annexe 3310-A).</li>
                <li>La régularisation d’une période déjà déposée (lignes 5B et 2C).</li>
                <li>
                  Les factures émises dans l’application : une recette n’est comptée que si son justificatif est
                  dans Justificatifs, comme pour la 2035.
                </li>
                <li>La dernière CA12 (régime simplifié, exercice 2026), à déposer au plus tard le 4 mai 2027.</li>
              </ul>
            </details>

            <h3 style={{ marginTop: 24 }}>Enregistrer la déclaration déposée</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Une fois la CA3 déposée, enregistrez-la : c’est ce qui propose son crédit à la déclaration
              suivante, et ce qui permet de voir, plus tard, qu’une pièce de la période a changé depuis.
              La TVA nette de la période est la ligne 16 moins les lignes 19 à 21, sans le crédit reporté.
            </p>
            <div className="field-row aligne-bas">
              <div className="field">
                <label htmlFor="tva-montant">TVA nette de la période déposée</label>
                <input
                  id="tva-montant"
                  inputMode="decimal"
                  value={montantTexte}
                  onChange={(e) => setSaisieMontant((s) => ({ ...s, [periode.debut]: e.target.value }))}
                  style={{ width: 140 }}
                />
              </div>
              <div className="field">
                <label htmlFor="tva-date-depot">Déposée le</label>
                <input id="tva-date-depot" type="date" value={dateDepot} onChange={(e) => setDateDepot(e.target.value)} />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={enregistrer}
                disabled={enregistrementEnCours || !!lectureIncomplete || !montantValide || !creditValide}
              >
                {enregistrementEnCours ? 'Enregistrement…' : 'Enregistrer comme déposée'}
              </button>
            </div>
            {lectureIncomplete && (
              <p className="error-text">
                Enregistrement suspendu : une lecture est incomplète, donc le montant et le crédit proposés
                peuvent être faux. Rechargez la page.
              </p>
            )}
            {erreur && <p className="error-text">{erreur}</p>}
          </>
        )}
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        <h3 style={{ margin: 16 }}>Déclarations déposées</h3>
        {!loading && declarations.length === 0 ? (
          <div className="empty-state">
            {lectures.declarations ? 'Les déclarations déposées n’ont pas pu être lues.' : 'Aucune déclaration enregistrée pour ce dossier.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Période</th><th>Déposée le</th><th>Crédit reçu</th><th>TVA nette déposée</th><th>Recalculée aujourd’hui</th><th>Écart</th><th></th></tr>
            </thead>
            <tbody>
              {comparees.map(({ declaration: d, recalcul, ecart, enEcart }) => (
                <tr key={d.id}>
                  <td>{libellePeriode(d.periode_debut, d.periode_fin)}</td>
                  <td>{d.date_declaration ? formatDate(d.date_declaration) : '—'}</td>
                  <td>{formatMoney(d.credit_anterieur)}</td>
                  <td>{formatMoney(d.tva_declaree)}</td>
                  <td>{formatMoney(recalcul)}</td>
                  <td>
                    {enEcart
                      ? <span className="badge badge-danger" title="Une pièce de la période a changé depuis le dépôt : à régulariser sur une déclaration suivante (ligne 5B si le calcul a augmenté, 2C s'il a baissé).">{formatMoney(ecart)}</span>
                      : <span className="badge badge-ok">aucun</span>}
                  </td>
                  <td><button className="btn btn-danger btn-sm" onClick={() => retirer(d)}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
