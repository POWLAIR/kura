-- Valeurs nutritionnelles d'une recette, par portion (issue #34). Voir docs/mcp.md.
--
-- Même calcul que meal_totals, sur les ingrédients de la recette ramenés à p_portions
-- portions : valeurs de food_ref, conversions de l'utilisateur, jamais une estimation du
-- modèle qui a proposé la recette.

-- { "values": { clé: total }, "incomplete": [clés], "partial_values": bool }.
-- partial_values : au moins un ingrédient n'est pas compté (sans référence, sans quantité,
-- sans conversion possible).
create function public.recipe_totals(p_recipe_id bigint, p_portions numeric default 1)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ingredients as (
    select
      ri.quantity * p_portions / r.servings as quantity,
      ri.unit,
      f.per_100_unit,
      c.density_g_ml,
      public.to_grams(
        ri.quantity * p_portions / r.servings,
        ri.unit,
        coalesce(c.piece_weight_g, f.piece_weight_g),
        c.density_g_ml
      ) as quantity_g,
      f.id as food_id
    from public.recipe_ingredient ri
    join public.recipe r on r.id = ri.recipe_id
    left join public.food_ref f on f.id = ri.food_ref_id
    left join public.food_conversion c on c.food_ref_id = f.id and c.user_id = ri.user_id
    where ri.recipe_id = p_recipe_id
  ),
  items as (
    select
      public.nutrition_amount(i.per_100_unit, i.quantity, i.unit, i.quantity_g, i.density_g_ml) as counted_amount,
      f.*
    from ingredients i
    left join public.food_ref f on f.id = i.food_id
  ),
  counted as (
    select * from items where counted_amount is not null
  ),
  amounts as (
    select kv.key, kv.value::numeric * c.counted_amount / 100 as amount
    from counted c
    cross join lateral jsonb_each(
      jsonb_strip_nulls(jsonb_build_object(
        'energy_kcal', c.energy_kcal,
        'protein_g', c.protein_g,
        'carbs_g', c.carbs_g,
        'sugars_g', c.sugars_g,
        'fat_g', c.fat_g,
        'saturated_fat_g', c.saturated_fat_g,
        'fiber_g', c.fiber_g,
        'salt_g', c.salt_g
      )) || c.micronutrients || c.nutrient_details
    ) as kv
  ),
  per_key as (
    select key, round(sum(amount), 3) as total, count(*) as n
    from amounts
    group by key
  )
  select jsonb_build_object(
    'values', coalesce((select jsonb_object_agg(key, total) from per_key), '{}'::jsonb),
    'incomplete', coalesce(
      (select jsonb_agg(key order by key) from per_key where n < (select count(*) from counted)),
      '[]'::jsonb
    ),
    'partial_values', exists (select 1 from items where counted_amount is null)
  );
$$;

revoke all on function public.recipe_totals(bigint, numeric) from public, anon;
grant execute on function public.recipe_totals(bigint, numeric) to authenticated;
