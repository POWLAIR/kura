-- Détail des glucides et des lipides, eau, alcool, cholestérol (issue #2).
-- Séparé de micronutrients, réservé aux vitamines et minéraux.
-- Clés définies dans packages/core/src/nutrients.ts ; clé absente = « non renseignée ».

alter table public.food_ref
  add column nutrient_details jsonb not null default '{}'::jsonb;

comment on column public.food_ref.nutrient_details is
  'Détail des glucides et lipides, eau, alcool, cholestérol pour 100 g, clés stables (ex. starch_g).';
