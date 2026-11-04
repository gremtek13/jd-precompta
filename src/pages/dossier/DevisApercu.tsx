import { formatMoney, formaterPrixUnitaire } from '../../lib/format'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import { tauxImprime } from '../../lib/mentionsFigeesVue'
import type { ApercuDuDevis } from '../../lib/devis'

// L'APERÇU IMPRIMABLE D'UN DEVIS (espace client, étape P6b ; modèle : FactureApercu.tsx, qui fait foi pour la forme imprimée).
// Ce qui s'imprime, et dans quel ordre, se décide dans lib/devis.ts (`ceQueLeDevisImprime`) ; l'écran ne fait que le poser.
// « Imprimer » ouvre la boîte d'impression du navigateur (« Enregistrer en PDF »), comme pour une facture : seule la carte
// `.facture-imprimable` reste sur le papier (index.css, bloc d'impression), sans sa rangée de boutons ni l'avis de l'écran.
//
// SA MISE EN PAGE N'EST JAMAIS EN LIGNE là où l'impression la défait (le voile, la carte, la rangée des boutons, l'avis :
// index.css). Un style en ligne l'emporte sur toute règle de feuille, `@media print` comprise (DevisApercu.test.tsx le garde).
//
// Le document est le même dans les deux espaces : il part à l'acheteur, il ne tutoie personne. Seuls l'avis et les boutons,
// que le papier ne porte pas, passent par `pourLEspace`. Aucun logo : le devis n'en fige aucun (lib/devis.ts).
type Props = {
  espace: EspaceVentes
  apercu: ApercuDuDevis
  // Ce que l'écran dit du devis et que le papier ne porte pas (`avisDeLApercuDuDevis`) ; nul : rien à dire.
  avis: string | null
  onClose: () => void
}

export default function DevisApercu({ espace, apercu, avis, onClose }: Props) {
  const dire = (texte: string) => pourLEspace(espace, texte)
  if (apercu.etat === 'illisible') {
    return (
      <div className="facture-apercu-voile">
        <div className="card facture-imprimable" role="dialog" aria-label="Aperçu du devis">
          <div className="facture-imprimable-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Fermer</button>
          </div>
          <p className="error-text">{dire(`Ce devis ne peut pas s’imprimer : ${apercu.motif}.`)}</p>
        </div>
      </div>
    )
  }
  const i = apercu.impression
  return (
    <div className="facture-apercu-voile">
      <div className="card facture-imprimable" role="dialog" aria-label="Aperçu du devis">
        <div className="facture-imprimable-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Fermer</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
        </div>
        {avis && (
          <div className="facture-imprimable-avis" role="note">
            <p>{dire(avis)}</p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <strong>{i.emetteur.nom}</strong>
            {i.emetteur.adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{i.emetteur.adresse}</div>}
            {i.emetteur.siret && <div className="muted">SIRET {i.emetteur.siret}</div>}
            {i.numeroTva && <div className="muted">N° TVA intracommunautaire {i.numeroTva}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0 }}>{i.titre}</h2>
            {i.dates.map((t) => <div key={t} className="muted">{t}</div>)}
          </div>
        </div>

        {i.mentionBrouillon && <p className="devis-brouillon-imprime"><strong>{i.mentionBrouillon}</strong></p>}

        <div style={{ marginBottom: 20 }}>
          <span className="muted" style={{ display: 'block', marginBottom: 2 }}>Devis établi pour</span>
          <strong>{i.client.nom}</strong>
          {i.client.adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{i.client.adresse}</div>}
          {i.client.siret && <div className="muted">SIRET {i.client.siret}</div>}
        </div>

        {i.objet && (
          <p style={{ marginTop: 0, marginBottom: 16, whiteSpace: 'pre-line' }}><span className="muted">Objet : </span>{i.objet}</p>
        )}

        {i.mentions.length > 0 && (
          <div className="muted" style={{ marginBottom: 20 }}>
            {i.mentions.map((m) => <div key={m.libelle}>{m.libelle} : {m.texte}</div>)}
          </div>
        )}

        {/* Le tableau de la facture, sous les mêmes classes : une fiche par ligne sous 520 pixels, ses colonnes sur le papier. */}
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite">
            <thead>
              <tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>TVA</th><th>Total HT</th><th>Total TTC</th></tr>
            </thead>
            <tbody>
              {i.lignes.map((l, n) => (
                <tr key={n}>
                  <td>{l.designation}</td>
                  <td data-libelle="Qté">{l.quantite}</td>
                  <td data-libelle="PU HT">{formaterPrixUnitaire(l.prixUnitaireHt)}</td>
                  <td data-libelle="TVA">{tauxImprime(l.tauxTva)}</td>
                  <td data-libelle="Total HT">{formatMoney(l.montantHt)}</td>
                  <td data-libelle="Total TTC">{formatMoney(l.montantTtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div style={{ minWidth: 220 }} aria-label="Totaux du devis">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total HT</span><span>{formatMoney(i.totaux.ht)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total TVA</span><span>{formatMoney(i.totaux.tva)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Total TTC</span><span>{formatMoney(i.totaux.ttc)}</span></div>
          </div>
        </div>

        {i.conditions && <p className="muted" style={{ marginTop: 20, whiteSpace: 'pre-line' }}>{i.conditions}</p>}
        {i.mentionsLegales && (
          <p className="muted" style={{ marginTop: 20, whiteSpace: 'pre-line', fontSize: '0.8rem' }}>{i.mentionsLegales}</p>
        )}

        <div className="devis-bon-pour-accord">{i.bonPourAccord}</div>
      </div>
    </div>
  )
}
