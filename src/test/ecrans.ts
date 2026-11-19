import { cleanup } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, vi } from 'vitest'

// Le démontage automatique de Testing Library ne s'installe QUE si `afterEach` est global. Ce dépôt
// importe ses fonctions de test explicitement (`globals` reste à false, pour que le compilateur
// vérifie ce qui est utilisé) : sans cette ligne, chaque test laisserait son arbre monté dans le
// document, et le test suivant trouverait deux boutons « Ajouter » au lieu d'un.
afterEach(cleanup)

// LES MODULES DU CABINET (OPT3, `OPTIONS_DES_CABINETS_PREVUES` levé le 19/11/2026). Dans l'application, un fournisseur enveloppe
// toujours les écrans (App.tsx, puis ModulesDuDossier.tsx dans un dossier) ; sans lui, `useModulesOuverts` tombe du côté FERMÉ.
// Un écran rendu SEUL par son test n'a pas de fournisseur : il y garde l'état d'avant le drapeau, tous les modules ouverts — ce
// que ces tests ont toujours éprouvé. Un test qui joue un module fermé le fournit (`ModulesFournis`) ; le côté fermé sans
// fournisseur se juge sur `etatSansFournisseur` (OptionsDuCabinetContext.test.tsx), et la lecture par les fournisseurs eux-mêmes
// (OptionsDuCabinetContext.test.tsx, ModulesDuDossier.test.tsx, DossierDetail.test.tsx).
vi.mock('../context/ModulesOuverts', async (original) => {
  const vrai = await original<typeof import('../context/ModulesOuverts')>()
  return { ...vrai, useModulesOuverts: () => useContext(vrai.ModulesOuvertsContext) ?? vrai.TOUT_OUVERT_SANS_LECTURE }
})
