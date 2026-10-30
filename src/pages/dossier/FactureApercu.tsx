import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import { calculerLigne } from '../../lib/factures'
import { mentionsImprimees, numeroTvaImprime, type DossierCii } from '../../lib/factureCii'
import { formatDate, formatMoney, formaterPrixUnitaire } from '../../lib/format'
import type { FactureEmise, FactureLigne } from '../../lib/types'
import { MENTIONS_FIGEES_EXPORTEES } from '../../lib/mentionsFigees'
import { FACTURE_D_AVANT, LOGO_EN_LECTURE, ceQueLaFactureImprime, logoNonImprime, uniteImprimee } from '../../lib/mentionsFigeesVue'
import { lireLeLogo } from '../../lib/logoDesFacturesLecture'
import type { LogoLu } from '../../lib/logoDesFactures'

// Un taux se lit « 5,5 % » sur une facture française — virgule décimale — et ne se coupe pas de son « % » : l'espace est
// insécable, sans quoi « 0 % » passait sur deux lignes dans une colonne étroite. Même écriture que `refusTauxPositif`.
const tauxLisible = (taux: number) => `${String(taux).replace('.', ',')}\u00a0%`

// Aperçu imprimable d'une facture validée — pas de génération PDF côté serveur pour l'instant (voir
// discussion sur la transmission via une plateforme agréée, pas encore branchée) : la boîte de
// dialogue d'impression du navigateur ("Enregistrer en PDF") suffit à obtenir un fichier envoyable en
// attendant. Seul .facture-imprimable reste à l'impression (voir index.css) : tout le reste de l'appli
// (menu, boutons, autres onglets) en est retiré, et la facture se pagine comme un document.
//
// SA MISE EN PAGE N'EST JAMAIS EN LIGNE (voile, carte, rangée de boutons : index.css, avant le bloc d'impression). Un style en
// ligne l'emporte sur toute règle de feuille, `@media print` comprise : le `display: flex` de la rangée des boutons les
// faisait imprimer sur chaque facture, et ceux du voile et de la carte la faisaient imprimer tronquée (FactureApercu.test.tsx).
//
// Le dossier tel que la page l'a lu : son statut de TVA décide du numéro imprimé sous l'émetteur d'une facture d'AVANT, qui ne
// le fige pas (la facture électronique le prend de même).
//
// UNE FACTURE QUI A FIGÉ SES MENTIONS (étape A7b ; `mentions_figees` vrai, lib/mentionsFigeesVue.ts) n'imprime que SES
// colonnes : le nom légal et l'identité, le numéro de TVA que la base a écrit — jamais recalculé —, les conditions de paiement,
// le RIB confirmé, les mentions complémentaires et le pied de page, le logo vérifié à son empreinte figée, le numéro
// d'engagement pour tout acheteur, l'unité et la référence de chaque ligne. Rien n'y est relu du dossier : `dossier` ne sert
// plus qu'à une facture d'avant, qui s'imprime comme hier, et dont l'écran — jamais le papier — dit qu'elle n'a pas figé ses
// mentions (`.facture-imprimable-avis`, que l'impression retire). Le mandataire ne s'imprime pas (P4).
export default function FactureApercu({ facture, dossier, onClose }: { facture: FactureEmise; dossier: DossierCii; onClose: () => void }) {
  const [lignes, setLignes] = useState<FactureLigne[] | null>(null)
  // Numéro de la facture corrigée, affiché uniquement pour un avoir (voir facture_origine_id) — une
  // requête à part plutôt qu'une jointure : FacturesTab connaît déjà cette info pour ses propres
  // lignes de tableau (elle a toute la liste en mémoire), mais l'aperçu peut aussi être ouvert seul.
  const [numeroOrigine, setNumeroOrigine] = useState<string | null>(null)
  const [lignesIllisibles, setLignesIllisibles] = useState<string | null>(null)
  // Les mentions de la facture électronique (ligne 28.5, étape c4) : celles qu'elle porte, et seulement elles — une
  // facture d'avant les a nulles, et rien ne s'y imprime à leur place.
  const figee = MENTIONS_FIGEES_EXPORTEES ? ceQueLaFactureImprime(facture) : null
  const dAvant = MENTIONS_FIGEES_EXPORTEES && figee === null
  const mentions = figee ? figee.mentions : mentionsImprimees(facture)
  const numeroTva = figee ? figee.numeroTva : numeroTvaImprime(facture, dossier)

  // LE LOGO FIGÉ, relu dans le seau des ventes et montré seulement APRÈS que son empreinte recalculée a été trouvée égale à
  // celle que la facture a figée (lib/logoDesFacturesLecture.ts). L'image est une URL d'objet créée avec la réponse et
  // révoquée au nettoyage ; une réponse arrivée pour un autre logo ne s'inscrit pas.
  const logoChemin = figee?.logo?.chemin ?? null
  const logoEmpreinte = figee?.logo?.empreinte ?? null
  const [logoLu, setLogoLu] = useState<{ cle: string; lu: LogoLu; url: string | null } | null>(null)
  useEffect(() => {
    if (logoChemin === null || logoEmpreinte === null) return
    let annule = false
    let url: string | null = null
    lireLeLogo({ chemin: logoChemin, empreinte: logoEmpreinte }).then((lu) => {
      if (annule) return
      url = lu.etat === 'verifie' ? URL.createObjectURL(lu.corps) : null
      setLogoLu({ cle: `${logoChemin}|${logoEmpreinte}`, lu, url })
    })
    return () => {
      annule = true
      if (url !== null) URL.revokeObjectURL(url)
      setLogoLu(null)
    }
  }, [logoChemin, logoEmpreinte])
  const logoCourant = logoLu?.cle === `${logoChemin}|${logoEmpreinte}` ? logoLu : null
  const avisLogo = logoChemin === null ? null : logoCourant === null ? LOGO_EN_LECTURE : logoNonImprime(logoCourant.lu)
  // L'unité ne prend une colonne que sur une facture figée dont une ligne en porte une.
  const avecUnite = figee !== null && (lignes ?? []).some((l) => l.unite != null)
  const colonnes = avecUnite ? 7 : 6

  // CET APERÇU EST LE DOCUMENT QU'ON IMPRIME ET QU'ON ENVOIE (voir .facture-imprimable).
  // `data ?? []` sur une lecture refusée y produisait un tableau de lignes VIDE sous des totaux
  // bien présents — une facture qui se contredit elle-même, sur le seul document légal que cet
  // écran produise. On dit qu'on n'a pas lu, plutôt que d'imprimer un vide qui ressemble à zéro.
  useEffect(() => {
    supabase.from('facture_lignes').select('*').eq('facture_id', facture.id).order('ordre')
      .then(({ data, error }) => {
        if (error) {
          setLignesIllisibles(messageErreur(error, "Les lignes n'ont pas pu être lues."))
          return
        }
        setLignesIllisibles(null)
        setLignes((data ?? []) as FactureLigne[])
      })
  }, [facture.id])

  // Le numéro de la facture corrigée : sur un avoir, c'est une référence qui part au client. Une
  // lecture refusée le faisait simplement disparaître de l'aperçu, donc de l'impression.
  useEffect(() => {
    if (!facture.facture_origine_id) { setNumeroOrigine(null); return }
    supabase.from('factures_emises').select('numero').eq('id', facture.facture_origine_id).maybeSingle()
      .then(({ data, error }) => setNumeroOrigine(error ? '— non lu' : (data?.numero ?? null)))
  }, [facture.facture_origine_id])

  return (
    <div className="facture-apercu-voile">
      <div className="card facture-imprimable">
        <div className="facture-imprimable-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Fermer</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
        </div>
        {(dAvant || avisLogo) && (
          <div className="facture-imprimable-avis" role="note">
            {dAvant && <p>{FACTURE_D_AVANT}</p>}
            {avisLogo && <p>{avisLogo}</p>}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
          {/* L'émetteur prend la place qui reste, et sa ligne la plus longue (une autre mention de l'identité) passe à la ligne
              plutôt que de pousser le numéro de la facture sous lui. */}
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            {logoCourant?.url && <img className="facture-logo" src={logoCourant.url} alt="Logo" />}
            <strong>{figee ? figee.nom : facture.emetteur_nom}</strong>
            {facture.emetteur_adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{facture.emetteur_adresse}</div>}
            {facture.emetteur_siret && <div className="muted">SIRET {facture.emetteur_siret}</div>}
            {figee?.identite.map((t) => <div key={t} className="muted" style={{ whiteSpace: 'pre-line' }}>{t}</div>)}
            {numeroTva && <div className="muted">N° TVA intracommunautaire {numeroTva}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0 }}>{facture.type === 'avoir' ? 'AVOIR' : 'FACTURE'} {facture.numero}</h2>
            {facture.type === 'avoir' && (
              <div className="muted">En référence à la facture {numeroOrigine ?? '…'}</div>
            )}
            <div className="muted">Émise le {formatDate(facture.date_emission)}</div>
            {facture.date_echeance && <div className="muted">Échéance le {formatDate(facture.date_echeance)}</div>}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span className="muted" style={{ display: 'block', marginBottom: 2 }}>Facturé à</span>
          <strong>{facture.tiers_nom}</strong>
          {facture.tiers_adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{facture.tiers_adresse}</div>}
          {facture.tiers_siret && <div className="muted">SIRET {facture.tiers_siret}</div>}
        </div>

        {mentions.length > 0 && (
          <div className="muted" style={{ marginBottom: 20 }}>
            {mentions.map((m) => <div key={m.libelle}>{m.libelle} : {m.texte}</div>)}
          </div>
        )}

        {/* Sur téléphone, six colonnes dans 316 pixels coupaient les mots en leur milieu (« DÉSIG / NATIO / N », une désignation à
            une syllabe par ligne) : sous 520 pixels d'enveloppe, chaque ligne devient une fiche, la désignation en tête, sans
            libellé. Pas `table-empilable`, dont le seuil de 860 pixels replierait aussi la facture IMPRIMÉE : l'enveloppe d'une
            page A4 mesure de 650 à 680 pixels, et le document qu'on envoie aurait perdu ses colonnes. Au-dessus de 520 pixels —
            l'impression comprise — le tableau garde ses colonnes, dont la désignation prend la place que les chiffres laissent
            (`table-layout: auto`, voir index.css). */}
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite">
            <thead>
              <tr>
                <th>Désignation</th><th>Qté</th>{avecUnite && <th>Unité</th>}<th>PU HT</th><th>TVA</th><th>Total HT</th><th>Total TTC</th>
              </tr>
            </thead>
            <tbody>
              {lignesIllisibles ? (
                <tr><td colSpan={colonnes} className="error-text">{lignesIllisibles}</td></tr>
              ) : lignes === null ? (
                <tr><td colSpan={colonnes} className="muted">Chargement…</td></tr>
              ) : (
                lignes.map((l) => {
                  const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
                  return (
                    <tr key={l.id}>
                      <td>
                        {l.designation}
                        {figee && l.reference && <div className="muted">Réf. {l.reference}</div>}
                      </td>
                      <td data-libelle="Qté">{l.quantite}</td>
                      {avecUnite && <td data-libelle="Unité">{uniteImprimee(l)}</td>}
                      {/* Un prix unitaire n'est jamais arrondi en silence (jusqu'à six décimales, BT-146) ; un MONTANT reste au centime. */}
                      <td data-libelle="PU HT">{formaterPrixUnitaire(l.prix_unitaire_ht)}</td>
                      <td data-libelle="TVA">{tauxLisible(l.taux_tva)}</td>
                      <td data-libelle="Total HT">{formatMoney(c.montant_ht)}</td>
                      <td data-libelle="Total TTC">{formatMoney(c.montant_ttc)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total HT</span><span>{formatMoney(facture.montant_ht)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total TVA</span><span>{formatMoney(facture.montant_tva)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Total TTC</span><span>{formatMoney(facture.montant_ttc)}</span></div>
          </div>
        </div>

        {figee && figee.conditions.length > 0 && (
          <div className="muted" style={{ marginTop: 20 }}>
            {figee.conditions.map((c) => <div key={c}>{c}</div>)}
          </div>
        )}
        {figee?.rib && (
          <div style={{ marginTop: 12 }}>
            <span className="muted" style={{ display: 'block' }}>Coordonnées bancaires</span>
            <div>IBAN {figee.rib.iban}</div>
            {figee.rib.bic && <div>BIC {figee.rib.bic}</div>}
            {figee.rib.titulaire && <div>Titulaire du compte : {figee.rib.titulaire}</div>}
          </div>
        )}

        {facture.mentions_legales && (
          <p className="muted" style={{ marginTop: 24, whiteSpace: 'pre-line', fontSize: '0.8rem' }}>{facture.mentions_legales}</p>
        )}
        {figee?.complementaires && (
          <p className="muted" style={{ marginTop: 12, whiteSpace: 'pre-line', fontSize: '0.8rem' }}>{figee.complementaires}</p>
        )}
        {figee?.piedDePage && (
          <p className="muted" style={{ marginTop: 16, whiteSpace: 'pre-line', fontSize: '0.75rem', textAlign: 'center' }}>{figee.piedDePage}</p>
        )}
      </div>
    </div>
  )
}
