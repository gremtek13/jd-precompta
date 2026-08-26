# JD Precompta — Palier 1

Application de précomptabilité pour JD Consult : collecte des pièces (factures,
reçus, notes de frais) auprès de plusieurs dossiers clients, validation, et
génération à la demande d'un pack (ZIP + Excel récapitulatif) prêt à remettre
à l'expert-comptable.

Backend : projet Supabase `jd-precompta` (région eu-west-1), séparé du projet
`jd-factu`.

## Démarrer en local

```bash
cp .env.example .env   # déjà pré-rempli avec l'URL et la clé publique du projet
npm install
npm run dev
```

## Premier compte

Le premier compte cabinet (`jeremy.darnis@gmail.com`) a été créé directement en
base et ajouté à `cabinet_admins`. Mot de passe temporaire communiqué en dehors
de ce dépôt — à changer via Dashboard Supabase → Authentication → Users dès que
possible (aucun écran "changer mon mot de passe" n'existe encore côté appli).

## Ce que fait ce Palier 1

- Dossiers clients (création, liste avec compteur de pièces à valider)
- Dépôt de pièces (upload manuel, cabinet ou client), catégorisation, validation
- Génération de pack à la demande sur une période choisie : ZIP classé par
  type de pièce + `Recap.xlsx` (détail, résumé par catégorie, pièces encore à
  valider)
- Historique des packs générés
- Accès client restreint (dépôt seul, pas de visibilité sur montants/catégories/packs)

## Pas encore fait (paliers suivants)

- Extraction automatique (OCR/LLM) des pièces
- Réception par email dédié par dossier
- Import de relevé bancaire + rapprochement
- Relances automatiques, tableau de bord multi-dossiers
