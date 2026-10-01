import { Fragment, useState } from 'react'
import { natureDuCompte, sensInhabituel } from '../../lib/affectationBanque'
import { LIBELLES_COMPTES } from '../../lib/comptes'
import { formatMoney } from '../../lib/format'
import { horsTaxeEtTva, libelleTaux, TAUX_TVA_RELEVE, tauxRequis } from '../../lib/tvaDuReleve'
import type { Categorie, LigneBancaire, VentilationBancaire } from '../../lib/types'
import { montantSaisi, montantSigne, refusVentilation, resteAVentiler, type PartSaisie } from '../../lib/ventilationBanque'

// La ventilation d'un mouvement sur plusieurs comptes (lib/ventilationBanque.ts), dans la fiche d'un
// mouvement. Une ligne par part : le compte — une catégorie de charge ou de produit, ou le compte du
// dirigeant pour la part personnelle — et le montant, saisi DANS LE SENS DU MOUVEMENT : un paiement de
// 120 € se ventile en 84 et 36, et un montant négatif va en sens inverse — la commission retenue sur une
// remise de carte bancaire. Le reste à ventiler se lit à chaque frappe.
//
// Rien ne part avant le clic, et ce que la base refuserait est dit avant lui (`refusVentilation`). Tant
// qu'une part n'a ni compte ni montant, on le demande sans crier à l'erreur : un formulaire qui s'ouvre
// en rouge sur deux lignes vides dit une faute que personne n'a faite.
//
// UNE PART DE RECETTE D'UN DOSSIER ASSUJETTI DEMANDE SON TAUX (lib/tvaDuReleve.ts), sous sa ligne : le
// relevé ne le dit pas, et rien ne le devine. Demandé comme le compte et le montant, sans crier non plus.

// La cible « compte du dirigeant » dans la liste d'une part : ni une catégorie, ni rien.
const DIRIGEANT = 'dirigeant'

// `taux` : '' tant qu'il n'est pas choisi, sinon le taux en texte (« 5.5 », « 0 » pour exonérée).
interface LignePart { cle: number; cible: string; montant: string; taux: string }

export default function FormulaireVentilation({
  ligne, categories, partsExistantes, assujettiTva, compteDirigeant, occupe, verbe, onVentiler,
}: {
  ligne: LigneBancaire
  categories: Categorie[]
  // Les parts d'une ventilation en place, pour la modifier ; vide pour une première ventilation.
  partsExistantes: readonly VentilationBancaire[]
  assujettiTva: boolean
  compteDirigeant: string
  occupe: boolean
  verbe: string
  onVentiler: (parts: PartSaisie[]) => void
}) {
  const [parts, setParts] = useState<LignePart[]>(() => partsExistantes.length > 0
    ? partsExistantes.map((p, i) => ({
        cle: i,
        cible: p.part_personnelle ? DIRIGEANT : p.categorie_id ?? '',
        montant: montantSaisi(ligne, p).toFixed(2),
        taux: p.taux_tva == null ? '' : String(p.taux_tva),
      }))
    : [{ cle: 0, cible: '', montant: '', taux: '' }, { cle: 1, cible: '', montant: '', taux: '' }])

  function modifier(cle: number, modification: Partial<LignePart>) {
    setParts((actuelles) => actuelles.map((p) => (p.cle === cle ? { ...p, ...modification } : p)))
  }
  function ajouter() {
    setParts((actuelles) => [...actuelles, { cle: Math.max(...actuelles.map((p) => p.cle)) + 1, cible: '', montant: '', taux: '' }])
  }
  function retirer(cle: number) {
    setParts((actuelles) => actuelles.filter((p) => p.cle !== cle))
  }

  // Les catégories d'un compte de résultat, dans l'ordre du sens du mouvement — comme l'affectation.
  const recettes = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'recette')
  const depenses = categories.filter((c) => natureDuCompte(c.compte_comptable) === 'depense')
  const groupes = ligne.montant >= 0
    ? [{ titre: 'Recettes', liste: recettes }, { titre: 'Dépenses', liste: depenses }]
    : [{ titre: 'Dépenses', liste: depenses }, { titre: 'Recettes', liste: recettes }]

  // Le taux n'est demandé — et n'est envoyé — que pour une part de recette d'un dossier assujetti : un taux
  // resté d'un premier choix de catégorie ne part pas avec une dépense.
  const tauxDemande = (p: LignePart) =>
    tauxRequis(assujettiTva, natureDuCompte(categories.find((c) => c.id === p.cible)?.compte_comptable))
  const saisies: PartSaisie[] = parts.map((p) => ({
    categorie_id: p.cible && p.cible !== DIRIGEANT ? p.cible : null,
    part_personnelle: p.cible === DIRIGEANT,
    montant: montantSigne(ligne, p.montant.trim() === '' ? Number.NaN : Number(p.montant)),
    taux_tva: tauxDemande(p) && p.taux !== '' ? Number(p.taux) : null,
  }))
  // Ce que le taux choisi fait de la part, dit sous elle : le hors taxe va à la catégorie, la TVA au 445710.
  const detailTva = (p: LignePart): string | null => {
    const montant = Number(p.montant)
    if (!tauxDemande(p) || p.taux === '' || Number(p.taux) === 0 || p.montant.trim() === '' || !Number.isFinite(montant)) return null
    const { ht, tva } = horsTaxeEtTva(montant, Number(p.taux))
    return `hors taxe ${formatMoney(ht)} · TVA ${formatMoney(tva)}`
  }
  const compteOuMontantManquant = parts.some((p) => p.cible === '' || p.montant.trim() === '')
  const tauxManquant = parts.some((p) => tauxDemande(p) && p.taux === '')
  const incomplete = compteOuMontantManquant || tauxManquant
  const refus = incomplete ? null : refusVentilation(ligne, saisies, categories, assujettiTva)
  const reste = resteAVentiler(ligne, parts.map((p) => Number(p.montant) || 0))

  // Une part qui DIMINUE sa catégorie — un encaissement sur une dépense, un paiement sur une recette — est
  // légitime pour un remboursement, et c'est aussi l'erreur la plus facile : la règle de l'affectation
  // (`sensInhabituel`), appliquée à chaque part selon SON signe. La commission d'une remise, négative sur
  // une dépense, n'en est pas une : c'est un paiement sur une charge, qui l'augmente.
  const aRebours = saisies.flatMap((s) => {
    const c = s.categorie_id ? categories.find((x) => x.id === s.categorie_id) ?? null : null
    const nature = c ? natureDuCompte(c.compte_comptable) : null
    return c && nature && Number.isFinite(s.montant) && s.montant !== 0 && sensInhabituel(s, nature) ? [`« ${c.libelle} »`] : []
  })
  const partPersonnelle = parts.some((p) => p.cible === DIRIGEANT)

  return (
    <>
      {/* `field` donne aux listes et aux montants le style des autres champs du volet. */}
      <div className="field fiche-mouvement-parts">
        {parts.map((p, i) => (
          <Fragment key={p.cle}>
            <div className="fiche-mouvement-part">
              <select aria-label={`Compte de la part ${i + 1}`} value={p.cible} onChange={(e) => modifier(p.cle, { cible: e.target.value })}>
                <option value="">— Choisir —</option>
                {groupes.filter((g) => g.liste.length > 0).map((g) => (
                  <optgroup key={g.titre} label={g.titre}>
                    {g.liste.map((c) => (
                      <option key={c.id} value={c.id}>{c.libelle} ({c.compte_comptable})</option>
                    ))}
                  </optgroup>
                ))}
                <optgroup label="Hors résultat">
                  <option value={DIRIGEANT}>Part personnelle — compte {compteDirigeant}</option>
                </optgroup>
              </select>
              <input
                type="number"
                step={0.01}
                aria-label={`Montant de la part ${i + 1}`}
                value={p.montant}
                onChange={(e) => modifier(p.cle, { montant: e.target.value })}
              />
              {parts.length > 2 && (
                <button type="button" className="btn btn-outline btn-sm" aria-label={`Retirer la part ${i + 1}`} onClick={() => retirer(p.cle)}>
                  Retirer
                </button>
              )}
            </div>
            {tauxDemande(p) && (
              <div className="fiche-mouvement-part-taux">
                <select aria-label={`Taux de TVA de la part ${i + 1}`} value={p.taux} onChange={(e) => modifier(p.cle, { taux: e.target.value })}>
                  <option value="">— Taux de TVA —</option>
                  {TAUX_TVA_RELEVE.map((t) => (
                    <option key={t} value={String(t)}>{t === 0 ? 'Exonérée ou non imposable' : libelleTaux(t)}</option>
                  ))}
                </select>
                {detailTva(p) && <span>{detailTva(p)}</span>}
              </div>
            )}
          </Fragment>
        ))}
      </div>
      <div className="fiche-mouvement-boutons">
        <button type="button" className="btn btn-outline btn-sm" onClick={ajouter}>Ajouter une part</button>
      </div>
      <p className="fiche-mouvement-reste">
        {reste === 0
          ? 'Les parts font le mouvement.'
          : reste > 0
            ? `Reste à ventiler : ${formatMoney(reste)}`
            : `Les parts dépassent le mouvement de ${formatMoney(-reste)}`}
      </p>
      <p className="fiche-mouvement-note">
        Montants dans le sens du mouvement ; un montant négatif va en sens inverse — la commission retenue
        sur une remise de carte, par exemple.
      </p>
      {partPersonnelle && (
        <p className="fiche-mouvement-note">
          La part personnelle s’écrit sur le compte {compteDirigeant} ({LIBELLES_COMPTES[compteDirigeant] ?? compteDirigeant}),
          face à la banque : ni charge ni recette.
        </p>
      )}
      {incomplete && (
        <p className="fiche-mouvement-note">
          {compteOuMontantManquant
            ? 'Choisis le compte et le montant de chaque part.'
            : 'Choisis le taux de TVA de chaque part de recette : le relevé ne le dit pas.'}
        </p>
      )}
      {refus && <p className="fiche-mouvement-alerte">{refus}</p>}
      {!refus && aRebours.length > 0 && (
        <p className="fiche-mouvement-alerte">
          {aRebours.length > 1
            ? `Les parts ${aRebours.join(', ')} diminuent leur catégorie au lieu de l’augmenter — un encaissement sur une dépense, ou un paiement sur une recette —, comme des remboursements. Si ce n’en sont pas, choisis des catégories de l’autre nature.`
            : `La part ${aRebours[0]} diminue sa catégorie au lieu de l’augmenter — un encaissement sur une dépense, ou un paiement sur une recette —, comme un remboursement. Si ce n’en est pas un, choisis une catégorie de l’autre nature.`}
        </p>
      )}
      <div className="fiche-mouvement-boutons">
        <button type="button" className="btn btn-outline" disabled={incomplete || !!refus || occupe} onClick={() => onVentiler(saisies)}>
          {verbe}
        </button>
      </div>
    </>
  )
}
