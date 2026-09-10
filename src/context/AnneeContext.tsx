import { createContext, useContext, useState, type ReactNode } from 'react'
import type { ValeurAnnee } from '../components/AnneeTabs'

interface AnneeContextValue {
  annee: ValeurAnnee
  setAnnee: (v: ValeurAnnee) => void
}

const AnneeContext = createContext<AnneeContextValue | null>(null)

// Sélection d'exercice partagée entre les onglets d'un même dossier (Pièces, Banque, Écritures,
// Statistiques, Clôture — voir DossierDetail) : un cabinet qui choisit "2024" en consultant les
// pièces ne devrait pas avoir à le resélectionner en passant à Banque. Portée par DossierDetail,
// remise à zéro à chaque changement de dossier via `key={dossierId}` posé sur ce Provider.
// `defaut` est calculé par DossierDetail une fois les années réellement disponibles connues (jamais
// "toutes" par défaut sur un dossier qui a déjà de l'historique — voir calculerAnneeParDefaut) :
// "toutes" reste un choix explicite, pas l'état initial.
export function AnneeProvider({ defaut, children }: { defaut: ValeurAnnee; children: ReactNode }) {
  const [annee, setAnnee] = useState<ValeurAnnee>(defaut)
  return <AnneeContext.Provider value={{ annee, setAnnee }}>{children}</AnneeContext.Provider>
}

export function useAnnee(): AnneeContextValue {
  const ctx = useContext(AnneeContext)
  if (!ctx) throw new Error("useAnnee() doit être utilisé à l'intérieur d'un <AnneeProvider> (voir DossierDetail).")
  return ctx
}
