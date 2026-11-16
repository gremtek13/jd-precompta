// Lance les outils de la démonstration sans `tsx`, qui n'est pas une dépendance : Vite, déjà installé, résout et transpile
// les modules de src/ comme Vitest le fait (la façon de outils/fec/lancer.mjs). Le premier argument choisit l'outil :
//
//     node outils/demonstration/lancer.mjs <sortie> <cabinet>                     écrit le fichier de sauvegarde
//     node outils/demonstration/lancer.mjs replique sql <sauvegarde> <uid>          le SQL d'une restauration sur une réplique
//     node outils/demonstration/lancer.mjs replique controler <sauvegarde> <relu>   les contrôles sur les lignes relues
//
// Mode d'emploi : README.md. Les modules de l'application lisent `import.meta.env` au chargement (src/lib/supabase.ts lève
// sans adresse) : on leur donne une adresse et une clé FACTICES — aucun outil d'ici n'appelle le réseau.
import { runnerImport } from 'vite'

process.env.VITE_SUPABASE_URL ??= 'http://127.0.0.1:9'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_factice'
const outil = process.argv[2] === 'replique' ? './replique.mts' : './demonstration.mts'
if (outil === './replique.mts') process.argv.splice(2, 1)
await runnerImport(new URL(outil, import.meta.url).pathname, { configFile: false, logLevel: 'error' })
