import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Le démontage automatique de Testing Library ne s'installe QUE si `afterEach` est global. Ce dépôt
// importe ses fonctions de test explicitement (`globals` reste à false, pour que le compilateur
// vérifie ce qui est utilisé) : sans cette ligne, chaque test laisserait son arbre monté dans le
// document, et le test suivant trouverait deux boutons « Ajouter » au lieu d'un.
afterEach(cleanup)
