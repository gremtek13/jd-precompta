import { LIBELLES_NATURE, LIBELLES_ORGANISME, NATURES, ORGANISMES, type SaisieDeLaDescription } from '../../lib/regularisationDesCotisations'

// L'organisme, l'année payée et la nature d'une échéance (ligne 27, TNS-Q2), dans l'ajout comme dans « Modifier » : les
// listes fermées de la base, le vide pour « non dit ». Monté sous `REGULARISATION_DES_COTISATIONS_EXPORTEE` seulement.
export default function ChampsDeLaDescription({ valeur, onChange, disabled, prefixe }: {
  valeur: SaisieDeLaDescription
  onChange: (valeur: SaisieDeLaDescription) => void
  disabled: boolean
  // Distingue les identifiants du formulaire d'ajout et de la fenêtre « Modifier », montés ensemble.
  prefixe: string
}) {
  const changer = (champ: keyof SaisieDeLaDescription) => (texte: string) => onChange({ ...valeur, [champ]: texte })
  return (
    <>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${prefixe}-organisme`}>Organisme</label>
          <select id={`${prefixe}-organisme`} value={valeur.organisme} disabled={disabled} onChange={(e) => changer('organisme')(e.target.value)}>
            <option value="">Non dit</option>
            {ORGANISMES.map((o) => <option key={o} value={o}>{LIBELLES_ORGANISME[o]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefixe}-annee-payee`}>Année payée</label>
          <input id={`${prefixe}-annee-payee`} inputMode="numeric" maxLength={4} value={valeur.annee} disabled={disabled}
            onChange={(e) => changer('annee')(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${prefixe}-nature`}>Nature</label>
          <select id={`${prefixe}-nature`} value={valeur.nature} disabled={disabled} onChange={(e) => changer('nature')(e.target.value)}>
            <option value="">Non dite</option>
            {NATURES.map((n) => <option key={n} value={n}>{LIBELLES_NATURE[n]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${prefixe}-part`}>Part de régularisation de l’année d’avant</label>
          <input id={`${prefixe}-part`} inputMode="decimal" value={valeur.part} disabled={disabled}
            onChange={(e) => changer('part')(e.target.value)} />
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        L’année payée est celle au titre de laquelle l’échéance est due : une provisionnelle de 2026 paie 2026, la
        régularisation de 2025 appelée en 2026 paie 2025. Un prélèvement qui paie les deux est UNE échéance, provisionnelle
        de son année : sa part de régularisation dit ce que l’appel porte de l’année d’avant — positive, un complément ;
        négative, un trop-versé que l’Urssaf a imputé sur lui. « Provisionnelle » n’est pas « prévisionnel » : l’Urssaf
        l’appelle, sur un revenu antérieur.
      </p>
    </>
  )
}
