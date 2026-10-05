-- Migration 019: Curated and discoverable recipes
-- Creates recipes and recipe_ingredients tables with versioning and curation support

CREATE TABLE IF NOT EXISTS recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Transmute Alchemist',
  servings INTEGER NOT NULL DEFAULT 1 CHECK (servings > 0),
  serving_calories_kcal INTEGER NOT NULL CHECK (serving_calories_kcal >= 0),
  serving_protein_g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (serving_protein_g >= 0),
  serving_carbs_g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (serving_carbs_g >= 0),
  serving_fat_g NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (serving_fat_g >= 0),
  serving_size_g NUMERIC(8,2) NOT NULL DEFAULT 100 CHECK (serving_size_g > 0),
  serving_size_unit TEXT NOT NULL DEFAULT 'g',
  image_url TEXT,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_curated BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(8,2) NOT NULL CHECK (amount > 0),
  unit TEXT NOT NULL DEFAULT 'g',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
CREATE INDEX IF NOT EXISTS idx_recipes_curated ON recipes(is_curated);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, sort_order);

-- Seed initial curated alchemy recipes
INSERT INTO recipes (
  id, title, description, author_name, servings,
  serving_calories_kcal, serving_protein_g, serving_carbs_g, serving_fat_g,
  serving_size_g, serving_size_unit, image_url, instructions, version, is_curated
) VALUES
(
  'a1000000-0000-4000-8000-000000000001',
  'Alchemical Greek Yogurt Berry Bowl',
  'High-protein alchemical breakfast bowl packed with slow-digesting casein, antioxidant-rich mixed berries, and wholesome rolled oats.',
  'Master Alchemist',
  1,
  350, 32.0, 42.0, 4.5,
  300, 'g',
  'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&auto=format&fit=crop&q=80',
  '["Combine non-fat Greek yogurt with raw honey or stevia in a ceramic bowl.", "Layer with fresh raspberries, blueberries, and sliced strawberries.", "Top with toasted rolled oats and chia seeds for texture and vital micronutrients."]'::jsonb,
  1,
  true
),
(
  'a1000000-0000-4000-8000-000000000002',
  'Transmuted Flame-Grilled Chicken & Jasmine Rice',
  'Clean lean fuel engineered for post-workout muscle protein synthesis and glycogen restoration.',
  'Flame Alchemist',
  1,
  520, 48.0, 58.0, 8.0,
  420, 'g',
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&auto=format&fit=crop&q=80',
  '["Season chicken breast with smoked paprika, sea salt, black pepper, and garlic powder.", "Grill over medium-high heat for 6-7 minutes per side until reaching 165°F.", "Serve over warm steamed jasmine rice with tender steamed broccoli florets and a squeeze of fresh lime."]'::jsonb,
  1,
  true
),
(
  'a1000000-0000-4000-8000-000000000003',
  'Golden Elixir Overnight Oats',
  'Nutrient-dense overnight oats infused with turmeric, cinnamon, whey protein, and golden flaxseed.',
  'Elixir Artisan',
  1,
  410, 30.0, 52.0, 9.0,
  320, 'g',
  'https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=600&auto=format&fit=crop&q=80',
  '["In a mason jar, combine rolled oats, vanilla whey isolate, and ground turmeric/cinnamon.", "Pour in unsweetened almond milk and stir until completely homogenous.", "Seal and refrigerate overnight (at least 6 hours). Stir well and serve chilled."]'::jsonb,
  1,
  true
),
(
  'a1000000-0000-4000-8000-000000000004',
  'Pan-Seared Atlantic Salmon & Sweet Potato Mash',
  'Rich in omega-3 fatty acids and complex low-glycemic carbohydrates to maximize recovery and joint mobility.',
  'Iron Scribe',
  1,
  580, 42.0, 46.0, 22.0,
  400, 'g',
  'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=600&auto=format&fit=crop&q=80',
  '["Steam or bake diced sweet potatoes until fork-tender, then mash with a touch of sea salt and nutmeg.", "Sear fresh wild salmon fillet skin-down in a hot skillet for 4 minutes until crisp, then flip for 3 minutes.", "Plate alongside roasted asparagus spears and lemon wedges."]'::jsonb,
  1,
  true
),
(
  'a1000000-0000-4000-8000-000000000005',
  'Crimson Quinoa & Tempeh Alchemy Plate',
  'Complete plant-based amino acid profile combined with roasted root vegetables and tahini glaze.',
  'Verdant Transmuter',
  1,
  460, 28.0, 54.0, 14.0,
  380, 'g',
  'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=600&auto=format&fit=crop&q=80',
  '["Simmer red quinoa in vegetable broth for 15 minutes until light and fluffy.", "Cube organic tempeh and pan-crisp with tamari and smoked paprika.", "Toss with roasted sweet peppers, massaged kale, and a light drizzle of lemon tahini dressing."]'::jsonb,
  1,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, name, amount, unit, sort_order) VALUES
('a1000000-0000-4000-8000-000000000001', 'Non-fat Greek Yogurt', 200, 'g', 1),
('a1000000-0000-4000-8000-000000000001', 'Mixed Berries (Fresh)', 60, 'g', 2),
('a1000000-0000-4000-8000-000000000001', 'Rolled Oats', 30, 'g', 3),
('a1000000-0000-4000-8000-000000000001', 'Raw Honey', 10, 'g', 4),

('a1000000-0000-4000-8000-000000000002', 'Chicken Breast (Skinless)', 200, 'g', 1),
('a1000000-0000-4000-8000-000000000002', 'Jasmine Rice (Cooked)', 150, 'g', 2),
('a1000000-0000-4000-8000-000000000002', 'Broccoli Florets', 70, 'g', 3),

('a1000000-0000-4000-8000-000000000003', 'Rolled Oats', 50, 'g', 1),
('a1000000-0000-4000-8000-000000000003', 'Vanilla Whey Protein', 25, 'g', 2),
('a1000000-0000-4000-8000-000000000003', 'Unsweetened Almond Milk', 200, 'ml', 3),
('a1000000-0000-4000-8000-000000000003', 'Ground Turmeric & Cinnamon', 5, 'g', 4),

('a1000000-0000-4000-8000-000000000004', 'Wild Salmon Fillet', 180, 'g', 1),
('a1000000-0000-4000-8000-000000000004', 'Sweet Potato (Mashed)', 160, 'g', 2),
('a1000000-0000-4000-8000-000000000004', 'Asparagus Spears', 60, 'g', 3),

('a1000000-0000-4000-8000-000000000005', 'Cooked Red Quinoa', 150, 'g', 1),
('a1000000-0000-4000-8000-000000000005', 'Organic Tempeh', 120, 'g', 2),
('a1000000-0000-4000-8000-000000000005', 'Massaged Tuscan Kale', 80, 'g', 3),
('a1000000-0000-4000-8000-000000000005', 'Tahini Glaze', 30, 'g', 4)
ON CONFLICT DO NOTHING;
