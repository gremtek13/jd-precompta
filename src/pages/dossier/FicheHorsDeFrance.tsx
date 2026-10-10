import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { texteOcrExploitable } from '../../lib/texteOcr'
import { lireMontantSaisi, montantPourSaisie } from '../../lib/encaissementsAffichage'
import { DEBUT_EREPORTING_PME } from '../../lib/periodesEreporting'
import {
  CODES_TVA_HORS_DE_FRANCE, NATURES_ACHAT, PAYS_ISO_3166, TYPES_DE_PIECE_DECRITS, argumentsDeLaFiche, argumentsDuRetrait,
  montantDansSaDevise, refusFicheHorsDeFrance, refusRetraitFiche, type CleRefusFiche, type ContexteFiche,
  type SaisieFiche,
} from '../../lib/piecesHorsDeFrance'
import {
  ficheEnMots, nomDuPays, prefixeAttendu, propositionsDeLaFiche, saisieDeLaFiche, schemaDuPays, signauxHorsDeFrance,
  ventilationDe, versionsDeLaPiece, type LectureFichesHorsDeFrance, type Proposition,
} from '../../lib/propositionsHorsDeFrance'
import type { CodeTvaHorsDeFrance, NatureAchatHorsDeFrance, Piece, PieceHorsDeFrance, PieceHorsDeFranceTaux } from '../../lib/types'

// LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UNE PIÈCE D'ACHAT, dans la fiche de la pièce (ligne 28.5, e-reporting,
// étape e3 ; la base : e2, lib/piecesHorsDeFrance.ts). Tout assujetti établi en France — exonéré et franchisé compris —
// déclarera ses achats à un fournisseur qui n'y est pas établi (CGI, art. 290, I-3°) ; la fiche porte ce que la pièce ne
// dit pas. Cette section la MONTRE (la version courante, ses versions précédentes), en fait SAISIR une nouvelle version,
// et la RETIRE.
//
// CE QU'ELLE NE FAIT JAMAIS :
// - rien sur une lecture pas encore revenue ou partielle : les fiches du dossier lui viennent de l'onglet (lues EN ENTIER,
//   lib/piecesHorsDeFranceLecture.ts), le gel aussi (`piecesFigees`) ; l'une ou l'autre lue en partie, elle ne montre ni
//   n'offre rien, et le dit ;
// - rien d'écrit sans un clic, et rien qu'à travers les deux fonctions de la base ; ce qu'elles refuseraient se dit AVANT
//   le clic, par le module, dans leur ordre et sous leurs mots — la base reste juge, et un refus qu'elle oppose quand
//   même se dit à son tour (`messageErreur`) ;
// - aucune proposition appliquée seule : chacune dit d'où elle vient, et un clic la reprend (lib/propositionsHorsDeFrance.ts) ;
// - aucune question tranchée à la place du cabinet : les hypothèses d'e2 restent les siennes, et la saisie les rappelle.
//
// Le verrou d'écriture est un `useRef` posé avant le `try` et relâché APRÈS la relecture : la nouvelle version paraît, ou
// la base a vu ce que l'écran n'avait pas lu (une autre version, une écriture validée).

export interface DonneesHorsDeFrance {
  /** Les fiches et la ventilation du dossier ; null avant leur première lecture. */
  lecture: LectureFichesHorsDeFrance | null
  /** Relit les fiches du dossier (l'onglet qui les a lues) : rendue quand la lecture est revenue. */
  relire: () => Promise<void>
  /** L'exercice qui fige la pièce (`piecesFigees`), nul si rien ne la fige. */
  anneeFigeante: number | null
  /** Non nul quand les écritures validées ou les biens n'ont pas été lus en entier : on ne sait pas si la pièce est figée. */
  gelIncomplet: string | null
  /** Les pièces du dossier, pour reprendre la fiche d'un même fournisseur ; null quand leur liste est lue en partie. */
  pieces: readonly Pick<Piece, 'id' | 'tiers' | 'date_piece'>[] | null
}

interface Props {
  dossierId: string
  /** La pièce TELLE QU'ENREGISTRÉE : c'est à elle que la base compare la fiche. */
  piece: Piece
  /** La fiche de la pièce porte une saisie non enregistrée de son type, de sa TVA, de son TTC ou de sa devise. */
  pieceModifiee: boolean
  donnees: DonneesHorsDeFrance
  /** L'écran appelant SAIT que la pièce n'a pas de texte lu : rien à relire, rien à en proposer. */
  sansTexteLu: boolean
  /** Rapporte si une saisie de fiche est en cours et non enregistrée (la garde du volet). Fonction STABLE. */
  onModifiee?: (modifiee: boolean) => void
}

interface LigneSaisie {
  code: string
  base: string
  motif_code: string
  motif_texte: string
}

interface Formulaire {
  /** La version que la saisie remplace : la courante quand le formulaire s'est ouvert. Si une autre l'a remplacée depuis,
   * la base refuse (« relire avant d'enregistrer ») — et l'écran le dit dès qu'il l'a relue. */
  remplaceId: string | null
  numero: string
  date_facture: string
  origine_numero: string
  origine_date: string
  pays: string
  identifiant: string
  nature: string
  autoliquidation: '' | 'oui' | 'non'
  operation: 'aucune' | 'livraison' | 'periode'
  date_operation: string
  periode_debut: string
  periode_fin: string
  lignes: LigneSaisie[]
}

// Les refus qui tiennent à la PIÈCE et non à la saisie (refus 3 à 6 de la fonction) : tant qu'ils valent, ouvrir une
// saisie ne mènerait qu'à eux.
const REFUS_DE_LA_PIECE: readonly CleRefusFiche[] = ['pas_un_achat', 'piece_figee', 'ttc_absent', 'tva_sur_la_piece']

// Les codes que la saisie offre : la ligne au taux normal (S) dit une TVA facturée, que l'hypothèse Q7 met de côté — la
// fonction la refuse, l'écran ne la propose pas.
const LIBELLES_DES_CODES: Record<Exclude<CodeTvaHorsDeFrance, 'S'>, string> = {
  AE: 'AE — autoliquidation',
  K: 'K — opération intracommunautaire',
  E: 'E — exonérée (avec son motif)',
  G: 'G — exportation hors de l’Union',
  O: 'O — hors du champ de la TVA',
  Z: 'Z — taux zéro',
}
const CODES_OFFERTS = CODES_TVA_HORS_DE_FRANCE.filter((c): c is Exclude<CodeTvaHorsDeFrance, 'S'> => c !== 'S')

const LIBELLES_DES_NATURES: Record<NatureAchatHorsDeFrance, string> = {
  biens: 'Des biens', services: 'Des services', mixte: 'Des biens et des services',
}

const LIGNE_VIERGE: LigneSaisie = { code: '', base: '', motif_code: '', motif_texte: '' }

// Un montant dans la devise de la pièce, aux espaces insécables (il ne se coupe pas en fin de ligne).
function montantEnDevise(montant: number, devise: string): string {
  try {
    return montant.toLocaleString('fr-FR', { style: 'currency', currency: devise })
  } catch {
    return `${montant.toFixed(2).replace('.', ',')} ${devise}`
  }
}

function formulaireVierge(remplaceId: string | null): Formulaire {
  return {
    remplaceId, numero: '', date_facture: '', origine_numero: '', origine_date: '', pays: '', identifiant: '', nature: '',
    autoliquidation: '', operation: 'aucune', date_operation: '', periode_debut: '', periode_fin: '', lignes: [{ ...LIGNE_VIERGE }],
  }
}

// Une version enregistrée, reprise dans la saisie : on corrige ce qui a changé, sans tout retaper.
function formulaireDe(fiche: PieceHorsDeFrance, lignes: readonly PieceHorsDeFranceTaux[], remplaceId: string | null): Formulaire {
  return {
    remplaceId, numero: fiche.numero, date_facture: fiche.date_facture,
    origine_numero: fiche.facture_origine_numero ?? '', origine_date: fiche.facture_origine_date ?? '',
    pays: fiche.pays, identifiant: fiche.identifiant, nature: fiche.nature, autoliquidation: fiche.autoliquidation ? 'oui' : 'non',
    operation: fiche.date_operation ? 'livraison' : fiche.periode_debut || fiche.periode_fin ? 'periode' : 'aucune',
    date_operation: fiche.date_operation ?? '', periode_debut: fiche.periode_debut ?? '', periode_fin: fiche.periode_fin ?? '',
    lignes: lignes.length === 0 ? [{ ...LIGNE_VIERGE }] : lignes.map((l) => ({
      code: l.code_tva, base: montantPourSaisie(Math.round(l.base * 100)), motif_code: l.motif_code ?? '', motif_texte: l.motif_texte ?? '',
    })),
  }
}

// Ce que la saisie envoie : les blancs de bord retirés, un champ vide pour « non renseigné » ; le type se lit au signe de
// la pièce et le schéma au pays (la base refuse toute autre combinaison) ; sans TVA facturée, taux et TVA sont nuls.
function saisieDu(f: Formulaire, typeDocument: '380' | '381'): SaisieFiche {
  const texte = (v: string) => (v.trim() === '' ? null : v.trim())
  const pays = texte(f.pays)
  return {
    numero: texte(f.numero), date_facture: texte(f.date_facture), type_document: typeDocument,
    facture_origine_numero: typeDocument === '381' ? texte(f.origine_numero) : null,
    facture_origine_date: typeDocument === '381' ? texte(f.origine_date) : null,
    pays, schema_identifiant: schemaDuPays(pays), identifiant: texte(f.identifiant), nature: texte(f.nature),
    autoliquidation: f.autoliquidation === '' ? null : f.autoliquidation === 'oui',
    date_operation: f.operation === 'livraison' ? texte(f.date_operation) : null,
    periode_debut: f.operation === 'periode' ? texte(f.periode_debut) : null,
    periode_fin: f.operation === 'periode' ? texte(f.periode_fin) : null,
    taux: f.lignes.map((l) => {
      const motifCode = l.code === 'Z' ? null : texte(l.motif_code)
      const motifTexte = l.code === 'Z' ? null : texte(l.motif_texte)
      return {
        code: l.code, taux: 0, base: lireMontantSaisi(l.base) ?? Number.NaN, tva: 0,
        ...(motifCode !== null ? { motif_code: motifCode } : {}),
        ...(motifTexte !== null ? { motif_texte: motifTexte } : {}),
      }
    }),
  }
}

// Une proposition déjà reprise ne se propose plus.
function dejaReprise(p: Proposition, f: Formulaire): boolean {
  switch (p.champ) {
    case 'numero': return f.numero.trim() === p.valeur
    case 'date_facture': return f.date_facture === p.valeur
    case 'pays': return f.pays === p.valeur
    case 'identifiant': return f.identifiant.trim() === p.valeur
    case 'nature': return f.nature === p.valeur
    case 'autoliquidation': return f.autoliquidation === (p.valeur ? 'oui' : 'non')
    case 'ventilation': return f.lignes.length === 1 && f.lignes[0].code === (p.valeur.code ?? '')
      && lireMontantSaisi(f.lignes[0].base) === p.valeur.centimes / 100
  }
}

const LIBELLES_DES_CHAMPS: Record<Proposition['champ'], string> = {
  numero: 'Numéro de la facture', date_facture: 'Date de la facture', pays: 'Pays du fournisseur', identifiant: 'Identifiant',
  nature: 'Nature', autoliquidation: 'Autoliquidation', ventilation: 'Ventilation',
}

function valeurProposee(p: Proposition, devise: string): string {
  switch (p.champ) {
    case 'date_facture': return formatDate(p.valeur)
    case 'pays': return `${nomDuPays(p.valeur)} (${p.valeur})`
    case 'nature': return LIBELLES_DES_NATURES[p.valeur]
    case 'autoliquidation': return p.valeur ? 'oui' : 'non'
    case 'ventilation': return `une ligne ${p.valeur.code ? `${p.valeur.code} ` : ''}de ${montantEnDevise(p.valeur.centimes / 100, devise)}`
    default: return p.valeur
  }
}

type TexteLu = { etat: 'attente' } | { etat: 'lu'; texte: string | null } | { etat: 'illisible'; message: string }

export default function FicheHorsDeFrance({ dossierId, piece, pieceModifiee, donnees, sansTexteLu, onModifiee }: Props) {
  const { lecture, relire, anneeFigeante, gelIncomplet, pieces } = donnees
  const decrite = TYPES_DE_PIECE_DECRITS.includes(piece.type_piece)
  const [formulaire, setFormulaire] = useState<{ courant: Formulaire; initial: string } | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  // Le verrou des deux écritures de la fiche (enregistrer, retirer) : un seul, posé avant le `try`, relâché après la
  // relecture — deux versions envoyées du même rendu, ou un retrait parti pendant un enregistrement, seraient jugés
  // par la base sur une fiche que l'écran n'a pas relue.
  const ecritureFicheEnCours = useRef(false)
  const relectureFichesEnCours = useRef(false)

  // LE TEXTE LU SUR LE DOCUMENT (déjà stocké au dépôt), de quoi dire les signaux et proposer des champs : une ligne de
  // notre base, lue à l'ouverture d'une pièce d'achat, jamais un appel à un service. Sa lecture refusée se DIT : elle
  // ne vaut pas « le document ne porte rien ».
  const [texteLu, setTexteLu] = useState<TexteLu>({ etat: 'attente' })
  useEffect(() => {
    if (!decrite || sansTexteLu) return
    let annule = false
    void supabase.from('piece_textes_ocr').select('texte').eq('piece_id', piece.id).maybeSingle().then(({ data, error }) => {
      if (annule) return
      setTexteLu(error
        ? { etat: 'illisible', message: messageErreur(error, 'lecture refusée par la base') }
        : { etat: 'lu', texte: texteOcrExploitable(data?.texte) })
    })
    return () => { annule = true }
  }, [piece.id, decrite, sansTexteLu])
  const texte: TexteLu = sansTexteLu ? { etat: 'lu', texte: null } : texteLu
  const texteConnu = texte.etat === 'lu' ? texte.texte : null

  const modifiee = formulaire !== null && JSON.stringify(formulaire.courant) !== formulaire.initial
  useEffect(() => { onModifiee?.(modifiee) }, [modifiee, onModifiee])
  useEffect(() => () => onModifiee?.(false), [onModifiee])

  const paysOfferts = useMemo(
    () => PAYS_ISO_3166.map((code) => ({ code, nom: nomDuPays(code) })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    [],
  )

  const ttc = montantDansSaDevise(piece)
  const typeDocument: '380' | '381' = ttc != null && ttc < 0 ? '381' : '380'
  const fichesLues = lecture !== null && lecture.motif === null ? lecture : null
  const versions = fichesLues ? versionsDeLaPiece(fichesLues.fiches, piece.id) : []
  const courante = versions[0] ?? null
  const lignesCourantes = courante && fichesLues ? ventilationDe(fichesLues.taux, courante.id) : []

  // Ni une lecture pas encore revenue, ni une lecture partielle n'ouvrent rien : sur une pièce qui n'est pas un achat,
  // la section ne paraît que si la pièce a une fiche (son type a changé depuis).
  if (lecture === null) {
    return decrite ? <section className="fiche-hdf" aria-busy="true"><h3>Fournisseur établi hors de France</h3><p className="muted">Lecture des fiches « hors de France » du dossier…</p></section> : null
  }
  if (lecture.motif !== null) {
    if (!decrite) return null
    return (
      <section className="fiche-hdf">
        <h3>Fournisseur établi hors de France</h3>
        <p className="error-text">
          Les fiches « hors de France » du dossier n’ont pas pu être lues en entier ({lecture.motif}) : celle de cette pièce
          ne s’affiche pas, et ne s’enregistre ni ne se retire d’ici.
        </p>
        <div className="fiche-hdf-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => void relireLesFiches()}>Relire les fiches</button>
        </div>
      </section>
    )
  }
  if (!decrite && courante === null) return null
  // Lues EN ENTIER ici (les deux cas précédents sont sortis) : ce que les gestes ci-dessous jugent.
  const fichesLuesEnEntier = lecture
  const fichesDuDossier = lecture.fiches

  async function relireLesFiches() {
    if (relectureFichesEnCours.current) return
    relectureFichesEnCours.current = true
    try {
      await relire()
    } finally {
      relectureFichesEnCours.current = false
    }
  }

  const aujourdHui = aujourdHuiAParis()
  const contexte = (f: Formulaire): ContexteFiche => ({
    remplaceId: f.remplaceId, fiches: fichesDuDossier, anneeFigeante, aujourdHui,
  })
  // Le refus de la PIÈCE, sans rien saisir : ce qu'une saisie, quelle qu'elle soit, rencontrerait d'abord.
  const refusDeLaPiece = (() => {
    const r = refusFicheHorsDeFrance(piece, saisieDu(formulaireVierge(courante?.id ?? null), typeDocument), contexte(formulaireVierge(courante?.id ?? null)))
    return r && REFUS_DE_LA_PIECE.includes(r.cle) ? r : null
  })()
  // On ne sait pas si la pièce est figée, ou elle porte une saisie non enregistrée : la base jugerait sur autre chose
  // que ce que l'écran montre.
  const ecritureSuspendue = gelIncomplet !== null
    ? `La liste des écritures validées n’a pas pu être lue en entier (${gelIncomplet}) : faute de savoir si un exercice validé fige cette pièce, sa fiche ne s’enregistre ni ne se retire d’ici.`
    : pieceModifiee
      ? 'Enregistrez d’abord la pièce : la fiche se compare à son type et à ses montants enregistrés.'
      : null

  function ouvrir(depuis: PieceHorsDeFrance | null) {
    const f = depuis && fichesLues
      ? formulaireDe(depuis, ventilationDe(fichesLues.taux, depuis.id), courante?.id ?? null)
      : formulaireVierge(courante?.id ?? null)
    setErreur(null)
    setFormulaire({ courant: f, initial: JSON.stringify(f) })
  }

  function changer(modif: Partial<Formulaire>) {
    setFormulaire((prec) => (prec ? { ...prec, courant: { ...prec.courant, ...modif } } : prec))
  }
  function changerLigne(rang: number, modif: Partial<LigneSaisie>) {
    setFormulaire((prec) => prec ? {
      ...prec, courant: { ...prec.courant, lignes: prec.courant.lignes.map((l, i) => (i === rang ? { ...l, ...modif } : l)) },
    } : prec)
  }

  function reprendre(p: Proposition) {
    switch (p.champ) {
      case 'numero': return changer({ numero: p.valeur })
      case 'date_facture': return changer({ date_facture: p.valeur })
      case 'pays': return changer({ pays: p.valeur })
      case 'identifiant': return changer({ identifiant: p.valeur })
      case 'nature': return changer({ nature: p.valeur })
      case 'autoliquidation': return changer({ autoliquidation: p.valeur ? 'oui' : 'non' })
      case 'ventilation': return changer({ lignes: [{ ...LIGNE_VIERGE, code: p.valeur.code ?? '', base: montantPourSaisie(p.valeur.centimes) }] })
    }
  }

  const saisie = formulaire ? saisieDu(formulaire.courant, typeDocument) : null
  const refusDeLaSaisie = formulaire && saisie ? refusFicheHorsDeFrance(piece, saisie, contexte(formulaire.courant)) : null

  async function enregistrer() {
    if (!formulaire || ecritureFicheEnCours.current) return
    const envoyee = saisieDu(formulaire.courant, typeDocument)
    // Rien ne part qu'un refus dit avant le clic, ni sur une pièce dont on ne sait pas si elle est figée.
    if (ecritureSuspendue !== null || refusFicheHorsDeFrance(piece, envoyee, contexte(formulaire.courant)) !== null) return
    // Posé AVANT le `try` et avant le premier `await` : un verrou posé après ne verrouille rien.
    ecritureFicheEnCours.current = true
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc(
        'enregistrer_fiche_hors_de_france', argumentsDeLaFiche(dossierId, piece.id, formulaire.courant.remplaceId, envoyee),
      )
      if (error) setErreur(messageErreur(error, 'La fiche n’a pas pu être enregistrée.'))
      else setFormulaire(null)
      // Relue dans les deux cas, AVANT de relâcher le verrou : écrite, la version paraît ; refusée, la base a peut-être
      // vu ce que l'écran n'avait pas lu, et le refus suivant se dira avant le clic.
      await relire()
    } finally {
      ecritureFicheEnCours.current = false
      setOccupe(false)
    }
  }

  async function retirer() {
    if (!courante || ecritureFicheEnCours.current) return
    if (ecritureSuspendue !== null || refusRetraitFiche(courante, fichesDuDossier, anneeFigeante) !== null) return
    if (!window.confirm(
      `Retirer la fiche « fournisseur établi hors de France » de cette pièce — ${ficheEnMots(courante)} ?\n\n`
      + 'Elle reste dans l’historique, marquée retirée : la pièce n’est plus décrite comme un achat à un fournisseur établi '
      + 'hors de France, et ne le sera pas dans une déclaration. Une nouvelle fiche pourra la remplacer.',
    )) return
    ecritureFicheEnCours.current = true
    setOccupe(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('retirer_fiche_hors_de_france', argumentsDuRetrait(dossierId, courante.id))
      if (error) setErreur(messageErreur(error, 'La fiche n’a pas pu être retirée.'))
      else setFormulaire(null)
      await relire()
    } finally {
      ecritureFicheEnCours.current = false
      setOccupe(false)
    }
  }

  // Un Entrée dans un champ de la fiche soumettrait le formulaire de la PIÈCE qui l'entoure — et la validerait.
  function sansSoumission(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault()
  }

  const refusDuRetrait = courante ? refusRetraitFiche(courante, fichesDuDossier, anneeFigeante) : null
  // La version courante, rejugée contre la pièce telle qu'elle est AUJOURD'HUI : la base ne la revoit pas quand la pièce
  // change (son TTC, sa TVA, son type), l'écran le dit. Le gel n'est pas une incohérence : il se dit à part.
  const rejugee = courante && courante.retire_le === null
    ? refusFicheHorsDeFrance(piece, saisieDeLaFiche(courante, lignesCourantes), {
      remplaceId: courante.id, fiches: fichesDuDossier, anneeFigeante: null, aujourdHui,
    })
    : null

  const signaux = courante === null ? signauxHorsDeFrance({ piece, texte: texteConnu, lecture: fichesLuesEnEntier, pieces }) : []
  const propositions = formulaire
    ? propositionsDeLaFiche({ piece, texte: texteConnu, lecture: fichesLuesEnEntier, pieces, paysSaisi: formulaire.courant.pays || null })
      .filter((p) => !dejaReprise(p, formulaire.courant))
    : []

  const f = formulaire?.courant ?? null
  const schema = f ? schemaDuPays(f.pays || null) : null
  const prefixe = f ? prefixeAttendu(f.pays || null) : null

  return (
    <section className="fiche-hdf" onKeyDown={sansSoumission}>
      <h3>Fournisseur établi hors de France</h3>

      {courante === null && (
        <>
          <p className="muted">
            Un achat à un fournisseur établi hors de France se déclarera à l’administration, facture par facture, pour les
            factures à partir du {formatDate(DEBUT_EREPORTING_PME)} — exonéré et franchisé compris. Sa fiche porte ce que la
            pièce ne dit pas : le numéro de la facture, le pays et l’identifiant du fournisseur, la ventilation.
          </p>
          {signaux.length > 0 && (
            <ul className="fiche-hdf-signaux">
              {signaux.map((s) => <li key={`${s.genre}-${s.phrase}`}>{s.phrase}</li>)}
            </ul>
          )}
        </>
      )}

      {courante !== null && (
        <>
          <dl className="fiche-hdf-detail">
            <dt>{courante.type_document === '381' ? 'Avoir' : 'Facture'}</dt>
            <dd>
              n° {courante.numero} du {formatDate(courante.date_facture)}
              {courante.facture_origine_numero && ` — corrige la facture n° ${courante.facture_origine_numero} du ${formatDate(courante.facture_origine_date)}`}
            </dd>
            <dt>Fournisseur</dt>
            <dd>
              {nomDuPays(courante.pays)} — {courante.schema_identifiant === '0223' ? 'n° de TVA' : 'pays et nom'}{' '}
              <span className="nom-fichier">{courante.identifiant}</span>
            </dd>
            <dt>Nature</dt>
            <dd>{LIBELLES_DES_NATURES[courante.nature]}</dd>
            <dt>Autoliquidation</dt>
            <dd>{courante.autoliquidation ? 'oui, par le dossier' : 'non'}</dd>
            {(courante.date_operation || courante.periode_debut) && (
              <>
                <dt>{courante.date_operation ? 'Livraison' : 'Période'}</dt>
                <dd>
                  {courante.date_operation
                    ? `le ${formatDate(courante.date_operation)}`
                    : `du ${formatDate(courante.periode_debut)} au ${formatDate(courante.periode_fin)}`}
                </dd>
              </>
            )}
            <dt>Ventilation</dt>
            <dd>
              {lignesCourantes.map((l, i) => (
                <span key={`${l.code_tva}-${l.taux}`}>
                  {i > 0 && ' ; '}
                  {l.code_tva} · {montantEnDevise(l.base, courante.devise)}
                  {l.motif_code && ` (${l.motif_code})`}
                </span>
              ))}
            </dd>
          </dl>
          <p className="muted">
            {versions.length === 1 ? 'Enregistrée' : `Version ${versions.length}, enregistrée`} le {formatDate(courante.cree_le)}.
            {courante.retire_le !== null && ` Retirée le ${formatDate(courante.retire_le)} : la pièce n’est plus décrite comme un achat à un fournisseur établi hors de France.`}
          </p>
          {rejugee && (
            <p className="alerte-tva">
              Telle qu’enregistrée, cette fiche ne passerait plus les contrôles de la base : {rejugee.message} Corrigez la
              pièce, saisissez une nouvelle version de la fiche, ou retirez-la.
            </p>
          )}
          {versions.length > 1 && (
            <details className="fiche-hdf-versions">
              <summary>Versions précédentes ({versions.length - 1})</summary>
              <ul>
                {versions.slice(1).map((v) => (
                  <li key={v.id}>
                    Enregistrée le {formatDate(v.cree_le)} : {ficheEnMots(v)}, {v.identifiant}
                    {v.retire_le !== null && `, retirée le ${formatDate(v.retire_le)}`}.
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {refusDeLaPiece && refusDeLaPiece.cle !== rejugee?.cle && <p className="fiche-hdf-refus">{refusDeLaPiece.message}</p>}
      {ecritureSuspendue && formulaire === null && <p className="fiche-hdf-refus">{ecritureSuspendue}</p>}
      {ecritureSuspendue === null && formulaire === null && (refusDeLaPiece === null || (courante !== null && courante.retire_le === null)) && (
        <div className="fiche-hdf-actions">
          {refusDeLaPiece === null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => ouvrir(courante)}>
              {courante === null ? 'Saisir la fiche' : courante.retire_le !== null ? 'Saisir une nouvelle fiche' : 'Saisir une nouvelle version'}
            </button>
          )}
          {courante !== null && courante.retire_le === null && (refusDuRetrait ? (
            <span className="fiche-hdf-refus">{refusDuRetrait.message}</span>
          ) : (
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => void retirer()}>
              {occupe ? 'Retrait…' : 'Retirer la fiche'}
            </button>
          ))}
        </div>
      )}

      {f && formulaire && (
        <div className="fiche-hdf-saisie">
          {propositions.length > 0 && (
            <div className="fiche-hdf-propositions">
              <p><strong>Propositions</strong> — à vérifier sur le document : aucune n’est reprise sans vous.</p>
              <ul>
                {propositions.map((p) => (
                  <li key={`${p.champ}-${JSON.stringify(p.valeur)}`}>
                    <span>
                      {LIBELLES_DES_CHAMPS[p.champ]} : <strong>{valeurProposee(p, piece.devise)}</strong> — {p.source.libelle}
                      {p.source.extrait && <> : « <span className="fiche-hdf-extrait">{p.source.extrait}</span> »</>}.
                    </span>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => reprendre(p)}>Reprendre</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {texte.etat === 'illisible' && (
            <p className="muted">
              Le texte lu sur le document n’a pas pu être relu ({texte.message}) : les propositions ne viennent que de la pièce
              et du dossier.
            </p>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="hdf-numero">{typeDocument === '381' ? 'Numéro de l’avoir' : 'Numéro de la facture'}</label>
              <input id="hdf-numero" value={f.numero} maxLength={60} onChange={(e) => changer({ numero: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="hdf-date">Sa date</label>
              <input id="hdf-date" type="date" value={f.date_facture} onChange={(e) => changer({ date_facture: e.target.value })} />
            </div>
          </div>
          <p className="muted fiche-hdf-aide">
            {typeDocument === '381'
              ? 'Un avoir (381) : la pièce porte un montant négatif.'
              : 'Une facture (380) : la pièce porte un montant positif.'}
          </p>
          {typeDocument === '381' && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="hdf-origine-numero">Facture corrigée : numéro</label>
                <input id="hdf-origine-numero" value={f.origine_numero} onChange={(e) => changer({ origine_numero: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="hdf-origine-date">Sa date</label>
                <input id="hdf-origine-date" type="date" value={f.origine_date} onChange={(e) => changer({ origine_date: e.target.value })} />
              </div>
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="hdf-pays">Pays du fournisseur</label>
              <select id="hdf-pays" value={f.pays} onChange={(e) => changer({ pays: e.target.value })}>
                <option value="">— Choisir —</option>
                {paysOfferts.map((p) => <option key={p.code} value={p.code}>{p.nom} ({p.code})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hdf-identifiant">
                {schema === '0223' ? `Son numéro de TVA (commence par ${prefixe})` : schema === '0227' ? 'Code du pays et début du nom' : 'Identifiant du fournisseur'}
              </label>
              <input id="hdf-identifiant" value={f.identifiant} maxLength={40} onChange={(e) => changer({ identifiant: e.target.value })} />
            </div>
          </div>
          {schema === '0227' && (
            <p className="muted fiche-hdf-aide">
              Hors de l’Union, le fournisseur se désigne par le code de son pays suivi des seize premiers caractères de sa
              dénomination (schéma 0227).
            </p>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="hdf-nature">Nature de l’achat</label>
              <select id="hdf-nature" value={f.nature} onChange={(e) => changer({ nature: e.target.value })}>
                <option value="">— Choisir —</option>
                {NATURES_ACHAT.map((n) => <option key={n} value={n}>{LIBELLES_DES_NATURES[n]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hdf-autoliquidation">Le dossier autoliquide-t-il la TVA ?</label>
              <select
                id="hdf-autoliquidation"
                value={f.autoliquidation}
                onChange={(e) => changer({ autoliquidation: e.target.value as Formulaire['autoliquidation'] })}
              >
                <option value="">— Choisir —</option>
                <option value="oui">Oui</option>
                <option value="non">Non</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="hdf-operation">Date de l’opération (facultative)</label>
              <select id="hdf-operation" value={f.operation} onChange={(e) => changer({ operation: e.target.value as Formulaire['operation'] })}>
                <option value="aucune">— Non précisée —</option>
                <option value="livraison">Une date de livraison</option>
                <option value="periode">Une période de facturation</option>
              </select>
            </div>
            {f.operation === 'livraison' && (
              <div className="field">
                <label htmlFor="hdf-livraison">Livrée le</label>
                <input id="hdf-livraison" type="date" value={f.date_operation} onChange={(e) => changer({ date_operation: e.target.value })} />
              </div>
            )}
          </div>
          {f.operation === 'periode' && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="hdf-periode-debut">Du</label>
                <input id="hdf-periode-debut" type="date" value={f.periode_debut} onChange={(e) => changer({ periode_debut: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="hdf-periode-fin">Au</label>
                <input id="hdf-periode-fin" type="date" value={f.periode_fin} onChange={(e) => changer({ periode_fin: e.target.value })} />
              </div>
            </div>
          )}

          <p className="fiche-hdf-sous-titre">
            Ventilation, en {piece.devise} — la somme des bases fait le TTC de la pièce
            {ttc != null && <> ({montantEnDevise(Math.abs(ttc), piece.devise)})</>} ; sans TVA facturée, taux et TVA sont nuls.
          </p>
          {f.lignes.map((l, rang) => (
            <div className="fiche-hdf-ligne" key={rang}>
              <div className="field-row">
                <div className="field">
                  <label htmlFor={`hdf-code-${rang}`}>Code de TVA</label>
                  <select id={`hdf-code-${rang}`} value={l.code} onChange={(e) => changerLigne(rang, { code: e.target.value })}>
                    <option value="">— Choisir —</option>
                    {CODES_OFFERTS.map((c) => <option key={c} value={c}>{LIBELLES_DES_CODES[c]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`hdf-base-${rang}`}>Base ({piece.devise})</label>
                  <input id={`hdf-base-${rang}`} inputMode="decimal" value={l.base} onChange={(e) => changerLigne(rang, { base: e.target.value })} />
                </div>
              </div>
              {l.code !== '' && l.code !== 'Z' && (
                <div className="field-row">
                  <div className="field">
                    <label htmlFor={`hdf-motif-code-${rang}`}>Motif : code VATEX{l.code === 'E' ? '' : ' (facultatif)'}</label>
                    <input id={`hdf-motif-code-${rang}`} value={l.motif_code} onChange={(e) => changerLigne(rang, { motif_code: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`hdf-motif-texte-${rang}`}>Son libellé</label>
                    <input id={`hdf-motif-texte-${rang}`} value={l.motif_texte} onChange={(e) => changerLigne(rang, { motif_texte: e.target.value })} />
                  </div>
                </div>
              )}
              {f.lignes.length > 1 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => changer({ lignes: f.lignes.filter((_, i) => i !== rang) })}
                >
                  Enlever cette ligne
                </button>
              )}
            </div>
          ))}
          <div className="fiche-hdf-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => changer({ lignes: [...f.lignes, { ...LIGNE_VIERGE }] })}>
              Ajouter une ligne
            </button>
          </div>

          <p className="muted fiche-hdf-aide">
            Restent au jugement du cabinet, et cette fiche ne les tranche pas : un achat facturé avec une TVA — celle du
            fournisseur ou la TVA française — est mis de côté ; un fournisseur établi hors de l’Union s’écrit en
            autoliquidation (AE) ou hors du champ (O), la règle n’ayant pas pu être vérifiée ; une acquisition de biens dans
            l’Union que le dossier n’aurait pas à autoliquider reste à trancher ; et le numéro de TVA du dossier sera exigé par
            la déclaration, non par cette fiche.
          </p>

          {ecritureSuspendue ? (
            <p className="fiche-hdf-refus">{ecritureSuspendue}</p>
          ) : refusDeLaSaisie && (
            <p className="fiche-hdf-refus" role="status">{refusDeLaSaisie.message}</p>
          )}
          {refusDeLaSaisie?.cle === 'fiche_changee' && courante && (
            <div className="fiche-hdf-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => ouvrir(courante)}>
                Repartir de la version enregistrée
              </button>
            </div>
          )}
          <div className="fiche-hdf-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={occupe || ecritureSuspendue !== null || refusDeLaSaisie !== null}
              onClick={() => void enregistrer()}
            >
              {occupe ? 'Enregistrement…' : courante === null ? 'Enregistrer la fiche' : 'Enregistrer cette version'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => { setFormulaire(null); setErreur(null) }}>
              Abandonner la saisie
            </button>
          </div>
        </div>
      )}

      {erreur && <p className="error-text">{erreur}</p>}
    </section>
  )
}
