// LES MODULES TIERS SONT BORNÉS, PAS TYPÉS — et c'est un arbitrage écrit plutôt que subi.
//
// Forme retenue : la déclaration de module ABRÉGÉE (sans corps), qui rend `any` tout ce qu'on en
// importe, y compris en position de TYPE (`Anthropic.MessageParam`). Un `export = any` ne le fait
// pas : il casse les imports nommés et les espaces de noms, et rend 14 erreurs qui ne disent rien
// du code.
//
// Pourquoi ne pas installer les vrais SDK : ils ne sont pas dans `package.json` (mesuré — seul
// `@supabase/supabase-js` l'est), et les faire entrer pour type-vérifier alourdirait chaque
// `npm ci` de la CI. Ce qu'on veut attraper ici vit dans NOTRE code.
//
// ET `@supabase/supabase-js` EST BORNÉ AUSSI, ce qui surprend puisqu'il EST installé. Essayé avec
// ses vrais types : sans type `Database` généré, `.from('cabinets').select(...)` rend des lignes de
// type `never`, donc « `limite_ia_alerte_usd` n'existe pas sur `never` » — 15 erreurs sur du code
// juste. Le typage réel ne vaut donc qu'avec un schéma généré tenu à jour, ce qui est un autre
// chantier ; le brancher à moitié produirait du BRUIT, et un avertissement qui se trompe finit par
// ne plus être lu.
declare module 'npm:@supabase/supabase-js@2'
declare module 'jsr:@supabase/supabase-js@2'
declare module 'npm:@anthropic-ai/bedrock-sdk@0.33.4'
declare module 'npm:@anthropic-ai/sdk@0.124.0'
declare module 'npm:resend@6'
declare module 'npm:@aws-sdk/client-textract@3'
declare module 'npm:@aws-sdk/client-s3@3'

// Importé pour son EFFET DE BORD par `taux-change-bce` (les types du runtime Edge). Sans cette
// ligne, `tsc -p tsconfig.edge.json` rend un TS2882 qui n'apprend rien sur le code.
declare module 'jsr:@supabase/functions-js/edge-runtime.d.ts'
