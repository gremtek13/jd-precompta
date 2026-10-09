// Captures de la vraie application (faux Supabase, données fictives) — la vérification visuelle à
// rejouer après toute modification de src/index.css ou de la coque (Layout, barre latérale).
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application sur 127.0.0.1:5199
//   npm i --no-save playwright-core@1.56.1                   # hors package.json : outil, pas dépendance
//   node outils/captures/vitrine.mjs [filtre]                # images dans outils/captures/sorties/
//
// PIÈGE, payé une fois : ne pas donner au navigateur le mandataire de l'environnement (HTTPS_PROXY).
// Il y enverrait AUSSI le serveur local, et la capture montrerait la page d'erreur du relais au lieu
// de l'application. Toute requête externe est donc coupée — et NOMMÉE dans le compte rendu : depuis
// que les polices sont servies par l'application (25/09/2026), il n'y en a aucune, et « Manrope
// chargée » le prouve à chaque vue. Les polices passaient avant par curl, venant de Google.
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:5199/'
const SORTIE = new URL('./sorties/', import.meta.url).pathname
mkdirSync(SORTIE, { recursive: true })

// Le Chromium préinstallé de l'environnement, quelle que soit sa révision.
const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)

// Le Chromium du banc se présente comme « HeadlessChrome », que la barre latérale ne reconnaît pas
// (voir lib/installation.ts) : sans une signature ordinaire, les captures ne montreraient pas l'entrée
// « Installer l'application » qu'un utilisateur d'Edge ou de Chrome voit dans le menu du compte.
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

const filtre = process.argv[2] ?? ''
const VUES = [
  { nom: 'pc-dossier-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-dossier-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false },
  { nom: 'pc-reduite-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: true },
  { nom: 'pc-tableau-clair', chemin: '#/dossiers', l: 1280, h: 800, theme: 'light', reduite: false },
  { nom: 'mobile-dossier-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false },
  { nom: 'mobile-tableau-clair', chemin: '#/dossiers', l: 390, h: 844, theme: 'light', reduite: false },
  // Panneau de droite ouvert (l'assistant) : large, étroit (le volet passe PAR-DESSUS), sombre, mobile.
  { nom: 'pc-assistant-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-1280', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-assistant-1024', chemin: '#/dossiers/d1/pieces', l: 1024, h: 768, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'mobile-assistant-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, clic: "Ouvrir l'assistant" },
  // La fiche d'une pièce dans le panneau de droite : ouverte par un clic sur sa ligne.
  { nom: 'pc-fiche-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-1280', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-fiche-1024', chemin: '#/dossiers/d1/pieces', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  { nom: 'mobile-fiche-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'Pharma Distrib Sud' },
  // « Proposer une catégorie » : la fiche de la seule pièce sans catégorie (LogiSoins, ouverte par sa DATE : la cellule du fournisseur porte aussi le lien « texte lu », que le clic déplierait), le bouton, puis
  // la proposition et son extrait — long, pour éprouver le passage à la ligne dans le volet.
  { nom: 'pc-proposer-bouton', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, cellule: '18/08/2026' },
  { nom: 'pc-proposition-clair', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, cellule: '18/08/2026', apres: 'Proposer une catégorie' },
  { nom: 'pc-proposition-sombre', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'dark', reduite: false, cellule: '18/08/2026', apres: 'Proposer une catégorie' },
  { nom: 'pc-proposition-1024', chemin: '#/dossiers/d1/pieces', l: 1024, h: 768, theme: 'light', reduite: false, cellule: '18/08/2026', apres: 'Proposer une catégorie' },
  { nom: 'mobile-proposition-clair', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, cellule: '18/08/2026', apres: 'Proposer une catégorie' },
  // Le rapprochement d'un mouvement dans le panneau de droite : une pièce proposée (Papeterie Moderne,
  // validée), puis un mouvement déjà rapproché — ouvert après être passé sur « Tous ».
  { nom: 'pc-mouvement-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-sombre', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'dark', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-1280', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  { nom: 'pc-mouvement-rapproche', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'PRLV ENERGIE SERVICES' },
  { nom: 'mobile-mouvement-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'CB PAPETERIE MODERNE' },
  // L'affectation d'un mouvement sans justificatif (ligne 26.6) : un virement de l'Assurance maladie
  // qu'aucune pièce n'explique, où le volet propose une catégorie ; puis un mouvement déjà affecté,
  // ouvert après être passé sur « Tous ».
  { nom: 'pc-affecter-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'VIR CPAM TIERS PAYANT' },
  { nom: 'pc-affecter-sombre', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, cellule: 'VIR CPAM TIERS PAYANT' },
  { nom: 'pc-affecte-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR CPAM REMBOURSEMENTS AOUT' },
  { nom: 'mobile-affecter-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'VIR CPAM TIERS PAYANT' },
  // Les règles d'affectation : la carte des affectations proposées (deux catégories, un mouvement écarté
  // parce que sa facture attend), puis la fiche d'un acompte dont la facture est au dossier — l'avertissement
  // avant d'affecter —, la case « Retenir » cochée.
  { nom: 'pc-regles-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Affectations proposées par vos règles' },
  { nom: 'pc-regles-sombre', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Affectations proposées par vos règles' },
  { nom: 'pc-regles-assistant', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'Affectations proposées par vos règles' },
  { nom: 'mobile-regles-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Affectations proposées par vos règles' },
  { nom: 'pc-retenir-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', cocher: 'Retenir' },
  { nom: 'pc-retenir-1024', chemin: '#/dossiers/d1/banque', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', cocher: 'Retenir' },
  { nom: 'mobile-retenir-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', cocher: 'Retenir' },
  // Le menu du compte (apparence, installation, thème, déconnexion), ouvert tel quel, puis avec la
  // consigne d'installation dépliée (le navigateur n'a pas encore annoncé d'invite) : déployé, sombre,
  // réduit — où le menu s'ouvre au-dessus de l'avatar seul — et le menu « … » du téléphone.
  { nom: 'pc-compte-clair', chemin: '#/dossiers', l: 1440, h: 900, theme: 'light', reduite: false, compte: true },
  { nom: 'pc-installer-clair', chemin: '#/dossiers', l: 1440, h: 900, theme: 'light', reduite: false, compte: true, clic: "Installer l'application" },
  { nom: 'pc-installer-sombre', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'dark', reduite: false, compte: true, clic: "Installer l'application" },
  { nom: 'pc-installer-reduite', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: true, compte: true, clic: "Installer l'application" },
  { nom: 'mobile-menu-clair', chemin: '#/dossiers', l: 390, h: 844, theme: 'light', reduite: false, clic: "Plus d'options" },
  // Clôture : le bas du formulaire de l'exercice — le cadre 8 et le report vers la déclaration de
  // revenus, amenés à l'écran (`vers`) puisqu'ils vivent sous le tableau des cases.
  { nom: 'pc-cloture-clair', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Report sur la déclaration des revenus' },
  { nom: 'pc-cloture-sombre', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Report sur la déclaration des revenus' },
  { nom: 'mobile-cloture-clair', chemin: '#/dossiers/d1/cloture', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Report sur la déclaration des revenus' },
  // Le volet social d'un praticien conventionné, sous le report : ses rubriques, puis l'estimation
  // des cotisations Urssaf (une infirmière de la base fictive, exercice 2026).
  { nom: 'pc-volet-clair', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Volet social 2026' },
  { nom: 'pc-volet-sombre', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Total à la charge du praticien' },
  { nom: 'pc-volet-assistant', chemin: '#/dossiers/d1/cloture', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'Volet social 2026' },
  { nom: 'mobile-volet-clair', chemin: '#/dossiers/d1/cloture', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Total à la charge du praticien' },
  // La CA3 préparée case par case, sur le seul dossier assujetti du banc (d7) : le régime, la
  // déclaration de la dernière période close, puis l'historique des déclarations déposées.
  { nom: 'pc-tva-clair', chemin: '#/dossiers/d7/tva', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-tva-sombre', chemin: '#/dossiers/d7/tva', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'TVA nette due' },
  { nom: 'pc-tva-assistant', chemin: '#/dossiers/d7/tva', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'TVA nette due' },
  { nom: 'pc-tva-historique', chemin: '#/dossiers/d7/tva', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Déclarations déposées' },
  { nom: 'mobile-tva-clair', chemin: '#/dossiers/d7/tva', l: 390, h: 844, theme: 'light', reduite: false, vers: 'TVA nette due' },
  // La TVA LIQUIDÉE (lib/liquidationTva.ts) — l'écriture que l'enregistrement écrira est au bas de « pc-tva-historique » :
  // la fiche du prélèvement rapproché de la déclaration du deuxième trimestre, celle du complément qui propose la même
  // déclaration, et le journal qui porte la liquidation et le paiement.
  { nom: 'pc-tva-paiement', chemin: '#/dossiers/d7/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'PRLV SEPA DGFIP TVA 2T2026' },
  { nom: 'pc-tva-complement', chemin: '#/dossiers/d7/banque', l: 1280, h: 800, theme: 'dark', reduite: false, cellule: 'PRLV SEPA DGFIP COMPLEMENT TVA' },
  { nom: 'mobile-tva-complement', chemin: '#/dossiers/d7/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV SEPA DGFIP COMPLEMENT TVA' },
  { nom: 'pc-tva-journal', chemin: '#/dossiers/d7/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'CA3 2e trimestre 2026' },
  // Les virements personnels (lib/virementPersonnel.ts) : l'onglet, qui montre celui qu'il reste à
  // écrire, et la fiche d'un virement personnel dans Banque, ouverte sous « Ignorés ».
  { nom: 'pc-virements-clair', chemin: '#/dossiers/d1/virements', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-virements-sombre', chemin: '#/dossiers/d1/virements', l: 1440, h: 900, theme: 'dark', reduite: false },
  { nom: 'mobile-virements-clair', chemin: '#/dossiers/d1/virements', l: 390, h: 844, theme: 'light', reduite: false },
  { nom: 'pc-virement-fiche', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Ignorés', cellule: 'VIR COMPTE PERSO SEPTEMBRE' },
  // Les échéances d'emprunt (lib/echeanceEmprunt.ts) : la fiche d'une échéance à rapprocher, avec
  // l'échéance proposée et son découpage ; celle de l'échéance déjà rapprochée, ouverte par sa date
  // sous « Tous » (les deux portent le même libellé) ; et l'emprunt dans Financement.
  { nom: 'pc-emprunt-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'PRLV ECHEANCE PRET VEHICULE' },
  { nom: 'pc-emprunt-sombre', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, cellule: 'PRLV ECHEANCE PRET VEHICULE' },
  { nom: 'pc-emprunt-1024', chemin: '#/dossiers/d1/banque', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'PRLV ECHEANCE PRET VEHICULE' },
  { nom: 'pc-emprunt-rapproche', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: '28/08/2026' },
  { nom: 'mobile-emprunt-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV ECHEANCE PRET VEHICULE' },
  { nom: 'pc-emprunt-financement', chemin: '#/dossiers/d1/financement', l: 1440, h: 900, theme: 'light', reduite: false },
  // La ventilation d'un mouvement sur plusieurs comptes (lib/ventilationBanque.ts) : le formulaire déplié
  // sur un mouvement à traiter, deux lignes vides ; puis un forfait mobile en partie personnel et une
  // remise de carte avec sa commission, ouverts sous « Tous ».
  { nom: 'pc-ventiler-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Ventiler sur plusieurs comptes' },
  { nom: 'pc-ventiler-1280', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Ventiler sur plusieurs comptes' },
  { nom: 'mobile-ventiler-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Ventiler sur plusieurs comptes' },
  { nom: 'pc-ventile-mobile', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'PRLV SEPA FORFAIT MOBILE' },
  { nom: 'pc-ventile-remise', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Tous', cellule: 'REMISE CB SEPTEMBRE', apres: 'Modifier la ventilation' },
  // Un virement qui règle plusieurs pièces (lib/reglementGroupe.ts) : le formulaire déplié sur un mouvement
  // à traiter, deux lignes vides ; puis le virement groupé du banc — deux factures et l'avoir déduit —,
  // ouvert sous « Tous », et son formulaire de modification, prérempli de ses parts.
  { nom: 'pc-regler-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Régler plusieurs pièces' },
  { nom: 'pc-regler-1024', chemin: '#/dossiers/d1/banque', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Régler plusieurs pièces' },
  { nom: 'mobile-regler-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Régler plusieurs pièces' },
  { nom: 'pc-groupe-clair', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR SEPA MEDICAL EQUIPEMENT PRO' },
  { nom: 'pc-groupe-sombre', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Tous', cellule: 'VIR SEPA MEDICAL EQUIPEMENT PRO' },
  { nom: 'pc-groupe-modifier', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR SEPA MEDICAL EQUIPEMENT PRO', apres: 'Modifier le règlement' },
  { nom: 'mobile-groupe-clair', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR SEPA MEDICAL EQUIPEMENT PRO' },
  // Un mouvement écrit sur un compte de bilan (lib/compteDeBilan.ts) : le choix sur un mouvement à traiter, « Autre
  // compte de bilan… » déplié ; le virement vers le livret au 580000, ouvert sous « Tous » ; le doublon ignoré, sous
  // « Ignorés » ; et la Checklist, qui compte ce doublon parmi les mouvements absents du FEC.
  { nom: 'pc-bilan-choix', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Autre compte de bilan', vers: 'Sur un compte de bilan' },
  { nom: 'pc-bilan-choix-1024', chemin: '#/dossiers/d1/banque', l: 1024, h: 768, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Autre compte de bilan', vers: 'Sur un compte de bilan' },
  { nom: 'mobile-bilan-choix', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'PRLV SEPA GARAGE DU CENTRE', apres: 'Autre compte de bilan', vers: 'Sur un compte de bilan' },
  { nom: 'pc-bilan-ecrit', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR VERS LIVRET PRO' },
  { nom: 'pc-bilan-ecrit-sombre', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Tous', cellule: 'DEPOT DE GARANTIE BAIL CABINET' },
  { nom: 'mobile-bilan-ecrit', chemin: '#/dossiers/d1/banque', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR VERS LIVRET PRO' },
  { nom: 'pc-bilan-ignore', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Ignorés', cellule: 'VIR CPAM TIERS PAYANT' },
  { nom: 'pc-bilan-checklist', chemin: '#/dossiers/d1/checklist', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'absent(s) du FEC' },
  // Les recettes du relevé d'un dossier assujetti (lib/tvaDuReleve.ts) : un acompte affecté à 20 %, des
  // honoraires affectés avant l'assujettissement, sans taux — l'avertissement et le choix du taux —, une
  // remise ventilée dont la part de recette porte son taux ; puis la déclaration qui les compte ou les écarte,
  // et le point de la Checklist.
  { nom: 'pc-recette-taxee', chemin: '#/dossiers/d7/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR ATELIER RIVIERE ACOMPTE MISSION' },
  { nom: 'pc-recette-sans-taux', chemin: '#/dossiers/d7/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR CABINET NOEL HONORAIRES' },
  { nom: 'pc-recette-sans-taux-sombre', chemin: '#/dossiers/d7/banque', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Tous', cellule: 'VIR CABINET NOEL HONORAIRES' },
  { nom: 'mobile-recette-sans-taux', chemin: '#/dossiers/d7/banque', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Tous', cellule: 'VIR CABINET NOEL HONORAIRES' },
  { nom: 'pc-recette-ventilee', chemin: '#/dossiers/d7/banque', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Tous', cellule: 'REMISE CB SEPTEMBRE CONSEIL', apres: 'Modifier la ventilation' },
  { nom: 'pc-recette-tva', chemin: '#/dossiers/d7/tva', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-recette-checklist', chemin: '#/dossiers/d7/checklist', l: 1440, h: 900, theme: 'light', reduite: false },
  // Les dotations aux amortissements (lib/amortissements.ts) : le registre du cabinet infirmier — un fauteuil
  // de soins repris au 1er janvier 2026, dont l'amortissement antérieur est dans les à-nouveaux et la dotation
  // 2026 à écrire, et un ordinateur de 2026 dont la dotation est écrite —, le tableau d'amortissement déplié,
  // la modification d'un bien, les natures et leurs comptes ; puis l'ordinateur du dossier d7, sans nature,
  // dont la dotation ne se compose pas, et la Checklist de la société en engagement, qui réclame la dotation
  // 2025 de son écran de studio.
  { nom: 'pc-immobilisations-clair', chemin: '#/dossiers/d1/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-immobilisations-sombre', chemin: '#/dossiers/d1/immobilisations', l: 1280, h: 800, theme: 'dark', reduite: false },
  { nom: 'pc-immobilisations-tableau', chemin: '#/dossiers/d1/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false, apres: '^Tableau$', vers: 'Amortissement cumulé' },
  { nom: 'pc-immobilisations-modifier', chemin: '#/dossiers/d1/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false, apres: '^Modifier$', vers: 'L’amortissement part de la mise en service' },
  { nom: 'pc-immobilisations-natures', chemin: '#/dossiers/d1/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Natures et comptes' },
  { nom: 'pc-immobilisations-1024', chemin: '#/dossiers/d1/immobilisations', l: 1024, h: 768, theme: 'light', reduite: false, apres: '^Tableau$', vers: 'Amortissement cumulé' },
  { nom: 'mobile-immobilisations-clair', chemin: '#/dossiers/d1/immobilisations', l: 390, h: 844, theme: 'light', reduite: false },
  { nom: 'pc-immobilisations-sans-nature', chemin: '#/dossiers/d7/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-immobilisations-checklist', chemin: '#/dossiers/d8/checklist', l: 1440, h: 900, theme: 'light', reduite: false },
  // L'acquisition d'un bien (lib/ecritures.ts) : l'ordinateur du cabinet sur le compte de sa nature, au TTC — le
  // dossier est exonéré — et sans écriture pour le fauteuil repris ; puis l'écran de studio de la société en
  // engagement, sa TVA au 445620 et sa dette au 404000.
  { nom: 'pc-acquisition-ecritures', chemin: '#/dossiers/d1/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Informatique Pro' },
  { nom: 'pc-acquisition-engagement', chemin: '#/dossiers/d8/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Studio Lumière' },
  { nom: 'mobile-acquisition-ecritures', chemin: '#/dossiers/d1/ecritures', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Informatique Pro' },
  // Le forfait kilométrique (lib/forfaitKilometrique.ts) : le cadre 7 du cabinet infirmier, chaque ligne avec l'état de
  // son forfait — écrit, à réécrire, à écrire — et « Écrire les N » ; le point de la Checklist qui réclame celui du
  // scooter ; et la Clôture, qui dit que le barème couvre déjà l'amortissement du scooter immobilisé.
  { nom: 'pc-forfait-clair', chemin: '#/dossiers/d1/informations', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Véhicules et barème kilométrique' },
  { nom: 'pc-forfait-sombre', chemin: '#/dossiers/d1/informations', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Véhicules et barème kilométrique' },
  { nom: 'pc-forfait-assistant', chemin: '#/dossiers/d1/informations', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'Véhicules et barème kilométrique' },
  { nom: 'pc-forfait-1024', chemin: '#/dossiers/d1/informations', l: 1024, h: 768, theme: 'light', reduite: false, vers: 'Véhicules et barème kilométrique' },
  { nom: 'mobile-forfait-clair', chemin: '#/dossiers/d1/informations', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Véhicules et barème kilométrique' },
  { nom: 'pc-forfait-checklist', chemin: '#/dossiers/d1/checklist', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'forfait(s) kilométrique(s)' },
  { nom: 'pc-forfait-cloture', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Amortissement d’un véhicule déduit avec le barème' },
  // La concordance de la 2035 avec les écritures (lib/concordance2035.ts), sous le formulaire de l'exercice : le
  // cabinet infirmier, dont le brouillon est en retard — des factures que rien n'écrit, une dotation, deux forfaits,
  // une échéance prélevée sans écriture et un rapprochement qui ne s'écrit pas — ; le dossier assujetti, dont le
  // bien sans nature n'a pas de dotation écrite ; et un exercice antérieur à l'ouverture, qui ne compare rien.
  { nom: 'pc-concordance-clair', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Concordance avec les écritures' },
  { nom: 'pc-concordance-ecarts', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, deplier: 'Voir les écarts', vers: 'Voir les écarts', enTete: true },
  { nom: 'pc-concordance-sombre', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, deplier: 'Voir les écarts', vers: 'Voir les écarts', enTete: true },
  { nom: 'pc-concordance-assistant', chemin: '#/dossiers/d1/cloture', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', deplier: 'Voir les écarts', vers: 'Voir les écarts', enTete: true },
  { nom: 'pc-concordance-1024', chemin: '#/dossiers/d1/cloture', l: 1024, h: 768, theme: 'light', reduite: false, deplier: 'Voir les écarts', vers: 'Voir les écarts', enTete: true },
  { nom: 'mobile-concordance-clair', chemin: '#/dossiers/d1/cloture', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Concordance avec les écritures' },
  { nom: 'mobile-concordance-ecarts', chemin: '#/dossiers/d1/cloture', l: 390, h: 844, theme: 'light', reduite: false, deplier: 'Voir les écarts', vers: 'Voir les écarts', enTete: true },
  { nom: 'pc-concordance-assujetti', chemin: '#/dossiers/d7/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Concordance avec les écritures' },
  { nom: 'pc-concordance-ouverture', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2021', vers: 'Concordance avec les écritures' },
  // La validation d'un exercice (lib/prealablesValidation.ts, lib/validationExercice.ts) : la kinésithérapeute, dont 2025
  // est validé — la carte de l'exercice validé, son empreinte vérifiée, puis ce que la validation fige dans chaque écran —
  // et 2026 en cours ; l'ostéopathe, dont 2025 est validable ; la société en engagement, que sa dotation 2025 manquante
  // empêche de valider.
  { nom: 'pc-valide-clair', chemin: '#/dossiers/d9/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Exercice 2025 validé' },
  { nom: 'pc-valide-sombre', chemin: '#/dossiers/d9/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, exercice: '2025', vers: 'Exercice 2025 validé' },
  { nom: 'pc-valide-formulaire', chemin: '#/dossiers/d9/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: '2035 validée le' },
  { nom: 'pc-valide-empreinte', chemin: '#/dossiers/d9/cloture', l: 1280, h: 800, theme: 'light', reduite: false, exercice: '2025', apres: 'Vérifier l’empreinte', vers: 'Empreinte vérifiée' },
  { nom: 'pc-valide-assistant', chemin: '#/dossiers/d9/cloture', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', exercice: '2025', vers: 'Exercice 2025 validé' },
  { nom: 'pc-valide-1024', chemin: '#/dossiers/d9/cloture', l: 1024, h: 768, theme: 'light', reduite: false, exercice: '2025', vers: 'Exercice 2025 validé' },
  { nom: 'mobile-valide-clair', chemin: '#/dossiers/d9/cloture', l: 390, h: 844, theme: 'light', reduite: false, exercice: '2025', vers: 'Exercice 2025 validé' },
  { nom: 'pc-valide-en-cours', chemin: '#/dossiers/d9/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Valider l’exercice 2026' },
  { nom: 'pc-validable-clair', chemin: '#/dossiers/d10/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Valider l’exercice 2025' },
  { nom: 'pc-validable-sombre', chemin: '#/dossiers/d10/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, exercice: '2025', vers: 'Valider l’exercice 2025' },
  { nom: 'mobile-validable-clair', chemin: '#/dossiers/d10/cloture', l: 390, h: 844, theme: 'light', reduite: false, exercice: '2025', vers: 'Valider l’exercice 2025' },
  { nom: 'pc-validation-bloquee', chemin: '#/dossiers/d8/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Valider l’exercice 2025' },
  { nom: 'pc-validation-checklist', chemin: '#/dossiers/d1/cloture', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Valider l’exercice 2026' },
  { nom: 'pc-fige-ecritures', chemin: '#/dossiers/d9/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025' },
  { nom: 'pc-fige-ecritures-sombre', chemin: '#/dossiers/d9/ecritures', l: 1280, h: 800, theme: 'dark', reduite: false, exercice: '2025' },
  { nom: 'pc-fige-banque', chemin: '#/dossiers/d9/banque', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', clic: 'Tous', cellule: 'VIR CPAM REMBOURSEMENTS JUIN' },
  { nom: 'pc-fige-piece', chemin: '#/dossiers/d9/pieces', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', cellule: 'Assurance Pro Santé' },
  { nom: 'mobile-fige-piece', chemin: '#/dossiers/d9/pieces', l: 390, h: 844, theme: 'light', reduite: false, exercice: '2025', cellule: 'Assurance Pro Santé' },
  { nom: 'pc-fige-immobilisations', chemin: '#/dossiers/d9/immobilisations', l: 1440, h: 900, theme: 'light', reduite: false, apres: '^Tableau$', vers: 'Amortissement cumulé' },
  { nom: 'pc-fige-vehicules', chemin: '#/dossiers/d9/informations', l: 1440, h: 900, theme: 'light', reduite: false, apres: '^2025 ·', vers: 'Véhicules et barème kilométrique' },
  { nom: 'pc-fige-cotisations', chemin: '#/dossiers/d9/cotisations', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-fige-virements', chemin: '#/dossiers/d9/virements', l: 1440, h: 900, theme: 'light', reduite: false },
  // LES VOLETS À LA LARGEUR CHOISIE (lib/largeurVolets.ts) : une barre étroite et une fiche de pièce élargie, une barre
  // large qui borne le volet, le volet superposé élargi à 1 200 pixels, et le bord qu'on survole pour le saisir.
  { nom: 'pc-volets-fiche-large', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, largeurs: { barre: 200, panneau: 760 }, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-volets-barre-large', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'light', reduite: false, largeurs: { barre: 420 }, clic: 'Assistant' },
  { nom: 'pc-volets-barre-large-sombre', chemin: '#/dossiers/d1/banque', l: 1440, h: 900, theme: 'dark', reduite: false, largeurs: { barre: 420 }, clic: 'Assistant' },
  { nom: 'pc-volets-1200', chemin: '#/dossiers/d1/pieces', l: 1200, h: 800, theme: 'light', reduite: false, largeurs: { panneau: 600 }, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-volets-survol', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Assistant', survol: 'Largeur du panneau de droite' },
  // À 1 280 pixels, le volet élargi jusqu'à sa borne (le panneau central à 560), et la barre au plus large.
  { nom: 'pc-volets-1280-fiche', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'light', reduite: false, largeurs: { panneau: 760 }, cellule: 'Pharma Distrib Sud' },
  { nom: 'pc-volets-1280-barre', chemin: '#/dossiers/d1/banque', l: 1280, h: 800, theme: 'light', reduite: false, largeurs: { barre: 420 }, clic: 'Assistant' },
  // LA GRILLE DES TABLEAUX DE BORD SUIT SA PLACE : quatre tuiles qui remplissent leur case, puis deux par rangée quand
  // le volet de droite est ouvert — une tuile y passait sous sa voisine — et au plus étroit du panneau central.
  { nom: 'pc-vue-1440', chemin: '#/dossiers/d1/checklist', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-vue-1280-assistant', chemin: '#/dossiers/d1/checklist', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-vue-1280-etroit', chemin: '#/dossiers/d1/checklist', l: 1280, h: 800, theme: 'dark', reduite: false, largeurs: { panneau: 760 }, clic: 'Assistant' },
  { nom: 'pc-tableau-barre-large', chemin: '#/dossiers', l: 1280, h: 800, theme: 'light', reduite: false, largeurs: { barre: 420 } },
  // LES COMPTES DE TIERS (lib/lettrage.ts), sous la Balance des comptes de la société en engagement : l'achat qui attend
  // son règlement, la vente encaissée en partie, l'écran de studio dû au fournisseur d'immobilisations — arrêtés à
  // aujourd'hui, puis au 31 décembre 2025. Et le code de lettrage dans le journal d'Écritures.
  { nom: 'pc-tiers-clair', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Comptes de tiers au', enTete: true },
  { nom: 'pc-tiers-sombre', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Comptes de tiers au', enTete: true },
  { nom: 'pc-tiers-assistant', chemin: '#/dossiers/d8/statistiques', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'Comptes de tiers au', enTete: true },
  { nom: 'pc-tiers-2025', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Comptes de tiers au', enTete: true },
  { nom: 'mobile-tiers-clair', chemin: '#/dossiers/d8/statistiques', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Comptes de tiers au', enTete: true },
  { nom: 'pc-journal-lettrage', chemin: '#/dossiers/d8/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, exercice: 'Toutes', vers: 'lettrage A' },
  // LE LETTRAGE FAIT À LA MAIN (ligne 32, seconde brique) : la proposition d'un avoir qui solde le reste d'une facture,
  // les pièces d'un lettrage qui ne se solde plus, la liste des lettrages faits à la main — l'un tient, l'autre non —,
  // puis deux pièces cochées et la barre qui les lettre ensemble.
  { nom: 'pc-lettrage-clair', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Lettrages proposés', enTete: true },
  { nom: 'pc-lettrage-sombre', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'dark', reduite: false, vers: 'Lettrages proposés', enTete: true },
  { nom: 'pc-lettrage-assistant', chemin: '#/dossiers/d8/statistiques', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', vers: 'Lettrages proposés', enTete: true },
  { nom: 'pc-lettrages-faits', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Lettrages faits à la main', enTete: true },
  {
    nom: 'pc-lettrage-coche', chemin: '#/dossiers/d8/statistiques', l: 1440, h: 900, theme: 'light', reduite: false,
    cocher: ['Cocher corsaire-facture-0828', 'Cocher corsaire-avoir-0920'], vers: '411000 — Clients', enTete: true,
  },
  { nom: 'mobile-lettrage-clair', chemin: '#/dossiers/d8/statistiques', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Lettrages proposés', enTete: true },
  { nom: 'mobile-lettrages-faits', chemin: '#/dossiers/d8/statistiques', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Lettrages faits à la main', enTete: true },
  // Le REPORT DES SOLDES (ligne 34) : l'ouverture que la validation de l'ostéopathe écrira sur 2026, montrée avant le
  // clic — ses soldes dépliés —, celle que la validation de la kinésithérapeute a écrite, et ce que 2026 en dit : ouvert
  // par ses soldes reportés chez l'une, en attente de la validation de 2025 chez l'autre.
  { nom: 'pc-report-apercu', chemin: '#/dossiers/d10/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'L’ouverture de l’exercice 2026' },
  { nom: 'pc-report-apercu-sombre', chemin: '#/dossiers/d10/cloture', l: 1440, h: 900, theme: 'dark', reduite: false, exercice: '2025', vers: 'L’ouverture de l’exercice 2026' },
  { nom: 'pc-report-soldes', chemin: '#/dossiers/d10/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', deplier: 'Voir les soldes reportés', vers: 'L’ouverture de l’exercice 2026', enTete: true },
  { nom: 'pc-report-soldes-assistant', chemin: '#/dossiers/d10/cloture', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', exercice: '2025', deplier: 'Voir les soldes reportés', vers: 'L’ouverture de l’exercice 2026', enTete: true },
  { nom: 'mobile-report-soldes', chemin: '#/dossiers/d10/cloture', l: 390, h: 844, theme: 'light', reduite: false, exercice: '2025', deplier: 'Voir les soldes reportés', vers: 'L’ouverture de l’exercice 2026', enTete: true },
  { nom: 'pc-report-ecrit', chemin: '#/dossiers/d9/cloture', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2025', vers: 'Sa validation a écrit l’ouverture' },
  { nom: 'pc-report-ecritures', chemin: '#/dossiers/d9/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2026', vers: 'Exercice ouvert par' },
  { nom: 'pc-report-balance', chemin: '#/dossiers/d9/statistiques', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2026', vers: 'soldes reportés de l’exercice 2025', enTete: true },
  { nom: 'mobile-report-balance', chemin: '#/dossiers/d9/statistiques', l: 390, h: 844, theme: 'light', reduite: false, exercice: '2026', vers: 'soldes reportés de l’exercice 2025', enTete: true },
  { nom: 'pc-report-attente', chemin: '#/dossiers/d10/ecritures', l: 1440, h: 900, theme: 'light', reduite: false, exercice: '2026', vers: 'pas encore d’ouverture' },
  { nom: 'pc-report-attente-balance', chemin: '#/dossiers/d10/statistiques', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant', exercice: '2026', vers: 'pas encore d’ouverture', enTete: true },
  // LE STATUT DE TVA DU DOSSIER (ligne 28.5, étape a) : la carte de l'onglet TVA et ce que le dossier doit à la facturation
  // électronique — le cabinet infirmier exonéré (art. 261, 4, 1°), Marc Petit en franchise en base, un dossier dont le
  // statut est à préciser, la carte d'un redevable qu'on change —, et le badge de l'en-tête.
  { nom: 'pc-statut-exonere', chemin: '#/dossiers/d1/tva', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-statut-exonere-sombre', chemin: '#/dossiers/d1/tva', l: 1440, h: 900, theme: 'dark', reduite: false },
  { nom: 'pc-statut-franchise', chemin: '#/dossiers/d3/tva', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-statut-a-preciser', chemin: '#/dossiers/d2/tva', l: 1440, h: 900, theme: 'light', reduite: false },
  { nom: 'pc-statut-assistant', chemin: '#/dossiers/d1/tva', l: 1280, h: 800, theme: 'light', reduite: false, clic: 'Assistant' },
  { nom: 'pc-statut-changer', chemin: '#/dossiers/d7/tva', l: 1440, h: 900, theme: 'light', reduite: false, apres: '^Changer le statut$' },
  { nom: 'pc-statut-checklist', chemin: '#/dossiers/d2/checklist', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'Statut de TVA à préciser' },
  { nom: 'mobile-statut-exonere', chemin: '#/dossiers/d1/tva', l: 390, h: 844, theme: 'light', reduite: false },
  { nom: 'mobile-statut-obligations', chemin: '#/dossiers/d1/tva', l: 390, h: 844, theme: 'light', reduite: false, vers: 'Facturation électronique', enTete: true },
  { nom: 'mobile-statut-a-preciser', chemin: '#/dossiers/d2/tva', l: 390, h: 844, theme: 'light', reduite: false },
  // La plateforme du client (ligne 28.5, étape b) : la fenêtre après une recherche — le plan d'import, un nom de
  // fichier long, l'avertissement de double import —, le formulaire qui relie celle d'un dossier, et la fiche d'une
  // facture reçue, qui montre sa version lisible et garde l'original à portée d'un lien.
  { nom: 'pc-plateforme-recherche', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Plateforme du client', apres: '^Chercher les nouvelles factures$' },
  { nom: 'pc-plateforme-recherche-sombre', chemin: '#/dossiers/d1/pieces', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Plateforme du client', apres: '^Chercher les nouvelles factures$' },
  { nom: 'pc-plateforme-relier', chemin: '#/dossiers/d2/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Plateforme du client', apres: '^Relier la plateforme du client$' },
  { nom: 'pc-plateforme-fiche', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, cellule: 'Laboratoire Biosanté Provence' },
  { nom: 'mobile-plateforme-recherche', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Plateforme du client', apres: '^Chercher les nouvelles factures$' },
  { nom: 'mobile-plateforme-relier', chemin: '#/dossiers/d2/pieces', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Plateforme du client', apres: '^Relier la plateforme du client$' },
  { nom: 'mobile-plateforme-fiche', chemin: '#/dossiers/d1/pieces', l: 390, h: 844, theme: 'light', reduite: false, cellule: 'Laboratoire Biosanté Provence' },
  // Le cycle de vie des factures émises (ligne 28.5, étape d7) : l'onglet Factures de l'atelier après « Lire les statuts de
  // la plateforme » — le bilan, les pastilles « Cycle de vie · … », l'« Avoir interne » de F2026-0009 refusée —, ses
  // encaissements (ses statuts, le refus en tête, l'enregistrement refusé), la déclaration d'un chèque de F2026-0008 (« Statuts
  // lus sur … : aucun refus de l'acheteur », et ses trois statuts), puis « Relire les statuts depuis le début » du cabinet
  // infirmier, confirmation acceptée.
  { nom: 'pc-factures-statuts', chemin: '#/dossiers/d7/factures', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Lire les statuts de la plateforme' },
  { nom: 'pc-factures-statuts-sombre', chemin: '#/dossiers/d7/factures', l: 1280, h: 800, theme: 'dark', reduite: false, clic: 'Lire les statuts de la plateforme' },
  { nom: 'mobile-factures-statuts', chemin: '#/dossiers/d7/factures', l: 390, h: 844, theme: 'light', reduite: false, clic: 'Lire les statuts de la plateforme' },
  { nom: 'pc-factures-pastilles', chemin: '#/dossiers/d7/factures', l: 1440, h: 900, theme: 'light', reduite: false, vers: 'F2026-0009' },
  { nom: 'pc-refusee-encaissements', chemin: '#/dossiers/d7/factures', l: 1440, h: 900, theme: 'light', reduite: false, ligne: ['F2026-0009', 'Encaissements'] },
  { nom: 'mobile-refusee-encaissements', chemin: '#/dossiers/d7/factures', l: 390, h: 844, theme: 'light', reduite: false, ligne: ['F2026-0009', 'Encaissements'] },
  { nom: 'pc-refusee-transmettre', chemin: '#/dossiers/d7/factures', l: 1440, h: 900, theme: 'light', reduite: false, ligne: ['F2026-0009', 'Transmettre'] },
  { nom: 'pc-declarer-statuts-lus', chemin: '#/dossiers/d7/factures', l: 1440, h: 900, theme: 'light', reduite: false, ligne: ['F2026-0008', 'Encaissements'], apres: '^Déclaré sur la plateforme$', rang: 'last', vers: 'Statuts lus sur flux.plateforme-beta.example le' },
  { nom: 'pc-relire-statuts', chemin: '#/dossiers/d1/pieces', l: 1440, h: 900, theme: 'light', reduite: false, clic: 'Plateforme du client', apres: '^Relire les statuts depuis le début$', accepter: true, vers: 'Statuts lus sur flux.plateforme-alpha.example' },
  // La coque du CLIENT (09/10/2026), rendue par `client: true` (le compte du cabinet infirmier, rattaché par une adhésion : voir
  // `banc-client` dans fauxSupabase.ts). Sa navigation paraît dans la barre latérale sur ordinateur, à l'accueil comme sur ses
  // autres écrans, déployée ou réduite à ses icônes ; sur téléphone elle reste cachée à l'accueil, où ses tuiles en tiennent
  // lieu, et paraît en barre du bas sur « Mes pièces ».
  { nom: 'pc-client-accueil', chemin: '#/accueil', l: 1440, h: 900, theme: 'light', reduite: false, client: true },
  { nom: 'pc-client-accueil-reduite', chemin: '#/accueil', l: 1440, h: 900, theme: 'light', reduite: true, client: true },
  { nom: 'pc-client-accueil-1024', chemin: '#/accueil', l: 1024, h: 768, theme: 'light', reduite: false, client: true },
  { nom: 'pc-client-pieces', chemin: '#/mes-pieces', l: 1440, h: 900, theme: 'light', reduite: false, client: true },
  { nom: 'mobile-client-accueil', chemin: '#/accueil', l: 390, h: 844, theme: 'light', reduite: false, client: true },
  { nom: 'mobile-client-pieces', chemin: '#/mes-pieces', l: 390, h: 844, theme: 'light', reduite: false, client: true },
].filter((v) => v.nom.includes(filtre))

const navigateur = await chromium.launch({ executablePath: executable })
for (const v of VUES) {
  const contexte = await navigateur.newContext({ viewport: { width: v.l, height: v.h }, userAgent: CHROME })
  // Les largeurs choisies des deux volets (lib/largeurVolets.ts), quand la vue les montre : retenues comme le
  // navigateur les retient.
  await contexte.addInitScript(({ theme, reduite, largeurs, client }) => {
    localStorage.setItem('jd-precompta-theme', theme)
    if (client) localStorage.setItem('banc-client', '1')
    localStorage.setItem('jd-precompta-barre-reduite', reduite ? '1' : '0')
    if (largeurs?.barre) localStorage.setItem('jd-precompta-largeur-barre', String(largeurs.barre))
    if (largeurs?.panneau) localStorage.setItem('jd-precompta-largeur-panneau', String(largeurs.panneau))
  }, { theme: v.theme, reduite: v.reduite, largeurs: v.largeurs ?? null, client: v.client ?? false })
  const externes = []
  await contexte.route(/^https?:\/\//, (route) => {
    const url = route.request().url()
    if (url.startsWith(BASE)) return route.continue()
    externes.push(url.slice(0, 80))
    return route.abort()
  })
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 160)) })
  await page.goto(BASE + v.chemin, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  // Le menu du compte, en bas de la barre : son bouton porte l'adresse de la personne connectée.
  if (v.compte) {
    await page.getByRole('button', { name: /^Compte de / }).click()
    await page.waitForTimeout(300)
  }
  // Un exercice choisi dans le sélecteur de l'en-tête du dossier : ses boutons sont des onglets.
  if (v.exercice) {
    await page.getByRole('tab', { name: v.exercice, exact: true }).first().click()
    await page.waitForTimeout(600)
  }
  if (v.clic) {
    await page.getByRole('button', { name: v.clic, exact: true }).click()
    await page.waitForTimeout(600)
  }
  // Une ligne de liste, désignée par le texte d'une de ses cellules.
  if (v.cellule) {
    await page.getByRole('cell', { name: v.cellule }).first().click()
    await page.waitForTimeout(600)
  }
  // Une case du contenu qui vient de s'ouvrir, désignée par une partie de son libellé — ou plusieurs, dans l'ordre.
  for (const libelle of [v.cocher ?? []].flat()) {
    await page.getByRole('checkbox', { name: new RegExp(libelle) }).first().check()
    await page.waitForTimeout(400)
  }
  // Un bouton d'une ligne de tableau, la ligne désignée par un texte qu'elle porte (le numéro d'une facture).
  if (v.ligne) {
    await page.locator('tr', { hasText: v.ligne[0] }).getByRole('button', { name: v.ligne[1], exact: true }).click()
    await page.waitForTimeout(900)
  }
  // Une confirmation du navigateur (« Relire depuis le début ? ») acceptée, comme on l'accepterait à la main.
  if (v.accepter) page.once('dialog', (d) => d.accept())
  // Un bouton du contenu qui vient de s'ouvrir (la fiche, le panneau), désigné par une partie de son nom — le premier, ou
  // le dernier quand la vue le dit (`rang`).
  if (v.apres) {
    await page.getByRole('button', { name: new RegExp(v.apres) })[v.rang === 'last' ? 'last' : 'first']().click()
    await page.waitForTimeout(600)
  }
  // Un bloc replié (`<details>`), déplié par le texte de son résumé.
  if (v.deplier) {
    await page.getByText(v.deplier).first().click()
    await page.waitForTimeout(300)
  }
  // Un texte à amener à l'écran avant la capture, pour montrer le bas d'un long onglet.
  // `enTete` le pose en HAUT de l'écran plutôt qu'au plus près : ce qui le suit — un tableau déplié — se voit.
  if (v.vers) {
    const cible = page.getByText(v.vers).first()
    if (v.enTete) await cible.evaluate((e) => e.scrollIntoView({ block: 'start' }))
    else await cible.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
  }
  // Un élément survolé au moment de la capture, désigné par son nom accessible : le bord d'un volet qu'on va saisir.
  if (v.survol) {
    await page.getByRole('separator', { name: v.survol }).hover()
    await page.waitForTimeout(300)
  }
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${SORTIE}${v.nom}.png` })
  const police = await page.evaluate(() => (document.fonts.check('16px Manrope') ? 'Manrope chargée' : 'Manrope ABSENTE'))
  console.log(v.nom, '—', police, '—', erreurs.length ? erreurs.slice(0, 3) : 'sans erreur',
    '—', externes.length ? `requêtes externes coupées : ${externes.slice(0, 3).join(', ')}` : 'aucune requête externe')
  await contexte.close()
}
await navigateur.close()
