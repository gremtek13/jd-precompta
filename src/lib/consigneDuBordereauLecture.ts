import { useEffect, useState } from 'react'
import { lireLeCodeNafDuDossier } from './codeNafDuDossierLecture'
import { importsDesLecturesDExistence, ligneDuBordereau } from './consigneDuBordereau'
import { unImportDuFactureLu } from './factureAssuranceMaladieLecture'
import { unImportDesPaiementsLu } from './paiementsAssuranceMaladieLecture'

// CE QUE « MES PIÈCES » LIT POUR LA LIGNE DU BORDEREAU (BOR6TQ1-Q1 (A) ; la règle : lib/consigneDuBordereau.ts). Trois lectures
// de la société AFFICHÉE, dans la même vague : le code NAF du dossier (la lecture de « Ma banque », que la policy du dossier
// ouvre au client), et l'existence d'un import des paiements et du facturé, une ligne chacune. Aucune ne rejette ; chacune se
// garde avec le dossier lu — la coque remonte l'écran à chaque changement de société (`<Outlet key>`), et une réponse arrivée
// pour une autre ne s'écrit pas. Rien n'est lu sans dossier.

/** La ligne à montrer pour ce dossier, ou nulle : tant que rien n'est revenu, nulle. */
export function useLigneDuBordereau(dossierId: string | null): string | null {
  const [lu, setLu] = useState<{ dossierId: string; ligne: string | null } | null>(null)
  useEffect(() => {
    if (!dossierId) return
    let annule = false
    void Promise.all([lireLeCodeNafDuDossier(dossierId), unImportDesPaiementsLu(dossierId), unImportDuFactureLu(dossierId)])
      .then(([codeNaf, paiements, facture]) => {
        if (!annule) setLu({ dossierId, ligne: ligneDuBordereau(codeNaf, importsDesLecturesDExistence(paiements, facture)) })
      })
    return () => { annule = true }
  }, [dossierId])
  return dossierId !== null && lu !== null && lu.dossierId === dossierId ? lu.ligne : null
}
