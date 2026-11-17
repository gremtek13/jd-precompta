import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// LE CODE NAF D'UN DOSSIER, LU POUR « MA BANQUE » (NOE4-Q1 (C)) : la section des paiements de l'assurance maladie ne s'offre
// que sur un code de santé (lib/sectionAssuranceMaladie.ts). Côté cabinet, la page du dossier le lit avec la ligne entière ;
// côté client, cette lecture d'une colonne, que la policy `dossiers_select` lui ouvre déjà (la ligne entière de son dossier).
// Elle ne rejette jamais : une erreur, ou une ligne que la base ne rend pas, laissent le code NON LU (`undefined`), et la
// section ne s'offre pas — le client n'en apprend rien (NOE4-Q1 : rien ne se dit côté client).

/** `string | null` : la colonne lue (nulle quand le dossier n'a pas de code) ; `undefined` : pas lue. */
export async function lireLeCodeNafDuDossier(dossierId: string): Promise<string | null | undefined> {
  try {
    const { data, error } = await supabase.from('dossiers').select('code_naf').eq('id', dossierId).maybeSingle()
    if (error || !data) return undefined
    return typeof data.code_naf === 'string' ? data.code_naf : null
  } catch {
    return undefined
  }
}

/** La lecture, gardée avec le dossier lu ; `actif` faux (le drapeau de la section baissé), rien ne se lit. */
export function useCodeNafDuDossier(dossierId: string | null, actif: boolean): string | null | undefined {
  const [lu, setLu] = useState<{ dossierId: string; codeNaf: string | null | undefined } | null>(null)
  useEffect(() => {
    if (!actif || !dossierId) return
    let annule = false
    void lireLeCodeNafDuDossier(dossierId).then((codeNaf) => { if (!annule) setLu({ dossierId, codeNaf }) })
    return () => { annule = true }
  }, [dossierId, actif])
  return actif && lu !== null && lu.dossierId === dossierId ? lu.codeNaf : undefined
}
