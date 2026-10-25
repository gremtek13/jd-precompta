import { formatDate, formatMoney } from '../lib/format'
import type { FraisSansPoste } from '../lib/declaration2035'

// LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS QUE NULLE LIGNE NE PORTE (ligne 28.65 ; lib/declaration2035.ts, `FraisSansPoste`) :
// une ligne discrète, comme les ventes écartées, seulement quand il y en a — les mots de la carte de Clôture. Un vrai trou
// dans les charges : la ligne dit pourquoi, et où le combler. Écrite une fois pour les écrans qui comptent ces frais comme
// la 2035 : la situation intermédiaire, ses ratios et le préremplissage du prévisionnel (Financement), le détail par poste
// de l'Estimation (VF8g). `quoi` nomme ce qui ne les compte pas.
export default function FraisSansPosteNonComptes({ frais, quoi }: { frais: readonly FraisSansPoste[]; quoi: string }) {
  if (frais.length === 0) return null
  return (
    <p className="muted" style={{ marginBottom: 0 }}>
      Frais d’encaissements que {quoi} ne compte pas ({frais.length}) :{' '}
      {frais.map(({ frais: f }) => `${formatDate(f.date)} « ${f.libelle} », ${formatMoney(f.centimes / 100)}`).join(' ; ')}
      {' '}— retenus par la banque sur des mouvements que leurs encaissements de factures classent, ils vont sous le poste de
      la catégorie « Frais bancaires » du dossier
      {frais.some((f) => f.categorie === null)
        ? ', que le dossier n’a pas : aucune catégorie de code « frais_bancaires ».'
        : ', qui n’a pas de poste 2035 (Clôture, carte « Postes manquants »).'}
    </p>
  )
}
