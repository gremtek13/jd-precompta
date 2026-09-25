// Les polices qu'un cabinet peut choisir pour sa charte, servies par l'application elle-même.
//
// Jusqu'au 25/09/2026 elles venaient de Google Fonts, comme les deux polices par défaut (voir
// `main.tsx`) : chaque ouverture de l'application envoyait l'adresse IP de l'utilisateur — clients
// compris — à un destinataire que RGPD.md ne nommait pas, par un appel réseau externe fait au
// chargement, ce que la règle du projet interdit. Les fichiers viennent désormais des paquets
// @fontsource (licence OFL) : Vite ne copie dans le build que ceux qu'on importe, et un chargeur
// dynamique ne télécharge une police que pour le cabinet qui l'a choisie.
//
// La liste est FERMÉE : le choix se fait dans une liste (CabinetBrandingPage), et le compilateur
// exige un chargeur par nom — `Record<PoliceCabinet, …>` ne compile pas s'il en manque un.

export const POLICES_CABINET = [
  { nom: 'Roboto', libelle: 'Roboto' },
  { nom: 'Lato', libelle: 'Lato' },
  { nom: 'Source Sans 3', libelle: 'Source Sans 3' },
  { nom: 'Nunito Sans', libelle: 'Nunito Sans' },
  { nom: 'Work Sans', libelle: 'Work Sans' },
  { nom: 'IBM Plex Sans', libelle: 'IBM Plex Sans' },
  { nom: 'Merriweather', libelle: 'Merriweather (empattements)' },
] as const

export type PoliceCabinet = (typeof POLICES_CABINET)[number]['nom']

// Les graisses que Google servait pour ces polices : 400, 600, 700 et 800, quand la police les a.
// Lato n'a ni 600 ni 800, IBM Plex Sans pas de 800 : le navigateur prend alors la plus proche,
// exactement comme avant.
const CHARGEURS: Record<PoliceCabinet, () => Promise<unknown>> = {
  Roboto: () => Promise.all([
    import('@fontsource/roboto/400.css'),
    import('@fontsource/roboto/600.css'),
    import('@fontsource/roboto/700.css'),
    import('@fontsource/roboto/800.css'),
  ]),
  Lato: () => Promise.all([
    import('@fontsource/lato/400.css'),
    import('@fontsource/lato/700.css'),
  ]),
  'Source Sans 3': () => Promise.all([
    import('@fontsource/source-sans-3/400.css'),
    import('@fontsource/source-sans-3/600.css'),
    import('@fontsource/source-sans-3/700.css'),
    import('@fontsource/source-sans-3/800.css'),
  ]),
  'Nunito Sans': () => Promise.all([
    import('@fontsource/nunito-sans/400.css'),
    import('@fontsource/nunito-sans/600.css'),
    import('@fontsource/nunito-sans/700.css'),
    import('@fontsource/nunito-sans/800.css'),
  ]),
  'Work Sans': () => Promise.all([
    import('@fontsource/work-sans/400.css'),
    import('@fontsource/work-sans/600.css'),
    import('@fontsource/work-sans/700.css'),
    import('@fontsource/work-sans/800.css'),
  ]),
  'IBM Plex Sans': () => Promise.all([
    import('@fontsource/ibm-plex-sans/400.css'),
    import('@fontsource/ibm-plex-sans/600.css'),
    import('@fontsource/ibm-plex-sans/700.css'),
  ]),
  Merriweather: () => Promise.all([
    import('@fontsource/merriweather/400.css'),
    import('@fontsource/merriweather/600.css'),
    import('@fontsource/merriweather/700.css'),
    import('@fontsource/merriweather/800.css'),
  ]),
}

export function estPoliceCabinet(nom: string): nom is PoliceCabinet {
  return POLICES_CABINET.some((p) => p.nom === nom)
}

/**
 * Charge la police d'un cabinet. Rend `false` sans rien charger pour un nom hors de la liste : le
 * navigateur garde alors la police par défaut, comme il le faisait quand Google ne connaissait pas
 * le nom demandé.
 */
export async function chargerPoliceCabinet(nom: string): Promise<boolean> {
  if (!estPoliceCabinet(nom)) return false
  await CHARGEURS[nom]()
  return true
}
