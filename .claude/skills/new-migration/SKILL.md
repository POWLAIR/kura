---
name: new-migration
description: Crée une migration Postgres Supabase pour Kura (table, fonction RPC, politique RLS). À utiliser pour tout changement de schéma.
---

# Nouvelle migration

1. `pnpm db:new <nom_en_snake_case>` crée `supabase/migrations/<timestamp>_<nom>.sql`. Ne jamais modifier une migration déjà mergée : en créer une nouvelle.
2. Toute table utilisateur :
   - colonne `user_id uuid not null default auth.uid() references auth.users on delete cascade` ;
   - `alter table … enable row level security;`
   - politiques `select/insert/update/delete` filtrées par `(select auth.uid()) = user_id` ;
   - index sur `user_id`.
3. `food_ref` est partagé : lecture pour `authenticated`, écriture réservée au `service_role`.
4. Identifiants externes (EAN, id Health Connect, clé d'idempotence) : contrainte `unique` pour des imports idempotents.
5. Fonctions métier transactionnelles (`cook_recipe`…) : `language plpgsql`, `security invoker`, `set search_path = ''`, noms qualifiés (`public.meal`).
6. Ajoute un test pgTAP dans `supabase/tests/` qui vérifie au moins la RLS (un autre utilisateur ne voit rien).
7. `pnpm db:reset`, `pnpm exec supabase test db`, puis `pnpm db:types` et commite le fichier de types régénéré.
