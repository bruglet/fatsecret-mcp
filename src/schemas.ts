import { z } from 'zod';
import * as pub from './generated/public-api.zod.js';
import * as profile from './generated/profile-api.zod.js';

// ── Reusable field overrides ──

const DateField = z.string().optional().describe('Calendar date in YYYY-MM-DD format; omit to use today.');
const RequiredDateField = z.string().describe('Calendar date in YYYY-MM-DD format.');
const MealField = z.enum(['breakfast', 'lunch', 'dinner', 'other']).describe('Diary meal bucket: breakfast, lunch, dinner, or other.');

// ── Public API – Foods ──

export const SearchFoodsInputSchema = pub.get__foods_search_v5.parameters.shape.query
  .omit({ format: true })
  .extend({
    search_expression: z.string().describe('Food name or phrase to search for, such as "chicken breast".'),
    include_sub_categories: z.boolean().optional().describe('Whether to include each food\'s subcategory names.'),
    flag_default_serving: z.boolean().optional().describe('Whether to mark the suggested or most common serving with is_default=1.'),
    include_food_attributes: z.boolean().optional().describe('Whether to include available allergen and dietary-preference data; requires the separate Premier attributes offering.'),
    include_food_images: z.boolean().optional().describe('Whether to include food image URLs; requires the separate Premier images offering.'),
    max_results: z.number().optional().describe('Maximum results per page, from 1 to 50; defaults to 20.'),
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
    page_number: z.number().optional().describe('Zero-based result page; use the page_number returned by a prior search to continue.'),
    food_type: z.string().optional().describe('Food type filter: "generic", "brand", or "none" for no filter; defaults to "none".'),
  });

export const GetFoodInputSchema = pub.get__food_v5.parameters.shape.query
  .omit({ format: true })
  .extend({
    food_id: z.number().int().describe('Food ID returned by search_foods, find_food_by_barcode, a food-list tool, or create_food.'),
    include_sub_categories: z.boolean().optional().describe('Whether to include the food\'s subcategory names; Premier only.'),
    include_food_images: z.boolean().optional().describe('Whether to include food image URLs; requires the separate Premier images offering.'),
    include_food_attributes: z.boolean().optional().describe('Whether to include available allergen and dietary-preference data; requires the separate Premier attributes offering.'),
    flag_default_serving: z.boolean().optional().describe('Whether to mark the suggested or most common serving with is_default=1.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    page_number: z.number().optional().describe('Compatibility pagination field; normally omit for a single-food lookup.'),
  });

export const FindFoodByBarcodeInputSchema = pub.get__food_barcode_findById_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    barcode: z.string().describe('Exactly 13 GTIN-13 digits. Left-pad UPC-A or EAN-8 values with zeros; convert UPC-E to UPC-A first.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    include_sub_categories: z.boolean().optional().describe('Whether to include the matched food\'s subcategory names.'),
    include_food_images: z.boolean().optional().describe('Whether to include food image URLs; requires the separate Premier images offering.'),
    include_food_attributes: z.boolean().optional().describe('Whether to include available allergen and dietary-preference data; requires the separate Premier attributes offering.'),
    flag_default_serving: z.boolean().optional().describe('Whether to mark the suggested or most common serving with is_default=1.'),
  });

export const AutocompleteFoodsInputSchema = pub.get__food_autocomplete_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    expression: z.string().describe('Incomplete food search text, such as "chic", for which suggestions are needed.'),
    max_results: z.number().optional().describe('Maximum suggestions to return, from 1 to 10; defaults to 4.'),
    region: z.string().optional().describe('Country or region code; this endpoint is documented to work only for the default region/language combination.'),
    language: z.string().optional().describe('Language code; this endpoint is documented to work only for the default region/language combination.'),
  });

// ── Public API – Recipes ──

export const SearchRecipesInputSchema = pub.get__recipes_search_v3.parameters.shape.query
  .omit({ format: true })
  .extend({
    page_number: z.number().optional().describe('Zero-based result page; use the page_number returned by a prior search to continue.'),
    max_results: z.number().optional().describe('Maximum results per page, from 1 to 50; defaults to 20.'),
    search_expression: z.string().optional().describe('Recipe name or ingredient phrase to search for; omit when filtering without text.'),
    recipe_types: z.string().optional().describe('Comma-separated recipe type names returned by get_recipe_types.'),
    recipe_types_matchall: z.boolean().optional().describe('For multiple recipe_types, require all types when true or any type when false; defaults to false.'),
    must_have_images: z.boolean().optional().describe('Whether to return only recipes that have at least one image.'),
    'calories.from': z.number().optional().describe('Minimum calories per recipe serving.'),
    'calories.to': z.number().optional().describe('Maximum calories per recipe serving.'),
    'carb_percentage.from': z.number().optional().describe('Minimum percentage of calories from carbohydrate.'),
    'carb_percentage.to': z.number().optional().describe('Maximum percentage of calories from carbohydrate.'),
    'protein_percentage.from': z.number().optional().describe('Minimum percentage of calories from protein.'),
    'protein_percentage.to': z.number().optional().describe('Maximum percentage of calories from protein.'),
    'fat_percentage.from': z.number().optional().describe('Minimum percentage of calories from fat.'),
    'fat_percentage.to': z.number().optional().describe('Maximum percentage of calories from fat.'),
    'prep_time.from': z.number().optional().describe('Minimum combined preparation and cooking time in minutes.'),
    'prep_time.to': z.number().optional().describe('Maximum combined preparation and cooking time in minutes.'),
    sort_by: z.string().optional().describe('Sort order: newest, oldest, caloriesPerServingAscending, or caloriesPerServingDescending; defaults to newest.'),
  });

export const GetRecipeInputSchema = pub.get__recipe_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    recipe_id: z.number().int().describe('Recipe ID returned by search_recipes or get_favorite_recipes.'),
    page_number: z.number().optional().describe('Compatibility pagination field; normally omit for a single-recipe lookup.'),
    max_results: z.number().optional().describe('Compatibility result-limit field; normally omit for a single-recipe lookup.'),
  });

// ── Public API – Reference Data ──

export const GetFoodCategoriesInputSchema = pub.get__foodCategories_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
  });

export const GetFoodSubCategoriesInputSchema = pub.get__foodSubCategories_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    food_category_id: z.number().int().describe('Food category ID returned by get_food_categories.'),
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
  });

export const GetBrandsInputSchema = pub.get__brands_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    starts_with: z.string().optional().describe('First character of brand names to return; use "*" for numeric names or omit for currently popular brands.'),
    brand_type: z.string().optional().describe('Brand category: "manufacturer", "restaurant", or "supermarket"; defaults to "manufacturer".'),
    language: z.string().optional().describe('Language code such as "en" or "fr"; ignored unless region is also set.'),
    region: z.string().optional().describe('Country or region code such as "US" or "FR"; defaults to US.'),
  });

export const GetRecipeTypesInputSchema = z.object({});

// ── Profile API – Food Diary ──

export const GetFoodEntriesInputSchema = profile.get__foodEntries_v2.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({
    food_entry_id: z.number().optional().describe('Food diary entry ID returned by get_food_entries; when set, returns that entry instead of the date\'s entries.'),
    date: DateField.describe('Calendar date in YYYY-MM-DD format; required unless food_entry_id is set.'),
  });

export const GetFoodEntriesMonthInputSchema = profile.get__foodEntries_month_v2.parameters.shape.query
  .omit({ format: true, method: true, date: true })
  .extend({ date: DateField.describe('Any date in the target month, in YYYY-MM-DD format; omit for the current month.') });

export const CreateFoodEntryInputSchema = profile.post__foodEntries_v1.parameters.shape.query
  .omit({ format: true, date: true, meal: true })
  .extend({
    food_id: z.number().int().describe('Food ID returned by search_foods, find_food_by_barcode, get_food, or create_food.'),
    food_entry_name: z.string().describe('User-visible diary label, usually the food_name returned by a food lookup.'),
    serving_id: z.number().int().describe('Serving ID returned by get_food or a food-list tool; derived serving ID 0 cannot be logged.'),
    number_of_units: z.number().describe('Quantity of the selected serving, such as 0.5, 1, or 2.'),
    meal: MealField,
    date: DateField,
  });

export const EditFoodEntryInputSchema = profile.put__foodEntries_v1.parameters.shape.query
  .omit({ format: true, meal: true })
  .extend({
    food_entry_id: z.number().int().describe('Food diary entry ID returned by get_food_entries.'),
    food_entry_name: z.string().optional().describe('Replacement user-visible label; omit to keep the current label.'),
    serving_id: z.number().optional().describe('Replacement serving ID returned by get_food; omit to keep the current serving.'),
    number_of_units: z.number().optional().describe('Replacement quantity of the selected serving; omit to keep the current quantity.'),
    meal: MealField.optional(),
  });

export const DeleteFoodEntryInputSchema = profile.delete__foodEntries_v1.parameters.shape.query
  .omit({ format: true })
  .extend({ food_entry_id: z.number().int().describe('Food diary entry ID returned by get_food_entries.') });

export const CopyFoodEntriesInputSchema = profile.post__foodEntries_copy_v1.parameters.shape.query
  .omit({ format: true, from_date: true, to_date: true, meal: true })
  .extend({
    from_date: RequiredDateField.describe('Source calendar date in YYYY-MM-DD format.'),
    to_date: RequiredDateField.describe('Destination calendar date in YYYY-MM-DD format.'),
    meal: MealField.optional(),
  });

export const CopySavedMealEntriesInputSchema = profile.post__foodEntries_copy_savedMeal_v1.parameters.shape.query
  .omit({ format: true, date: true, meal: true })
  .extend({
    saved_meal_id: z.number().int().describe('Saved meal ID returned by get_saved_meals or create_saved_meal.'),
    meal: MealField,
    date: DateField,
  });

// ── Profile API – Favorites ──

export const GetFavoriteFoodsInputSchema = z.object({});

export const DeleteFavoriteFoodInputSchema = profile.post__food_favorite_v1.parameters.shape.query
  .omit({ format: true })
  .extend({
    food_id: z.number().int().describe('Food ID returned by get_favorite_foods for the favorite to remove.'),
    serving_id: z.string().optional().describe('Serving ID from get_favorite_foods when removing a serving-specific favorite; omit for the food-level favorite.'),
    number_of_units: z.string().optional().describe('Serving quantity from get_favorite_foods when removing a serving-specific favorite.'),
  });

export const GetMostEatenFoodsInputSchema = profile.get__food_mostEaten_v2.parameters.shape.query
  .omit({ format: true, meal: true })
  .extend({ meal: MealField.optional() });

export const GetRecentlyEatenFoodsInputSchema = profile.get__food_recentlyEaten_v2.parameters.shape.query
  .omit({ format: true, meal: true })
  .extend({ meal: MealField.optional() });

export const GetFavoriteRecipesInputSchema = z.object({});

export const AddFavoriteRecipeInputSchema = profile.post__recipe_favorites_v1.parameters.shape.query
  .omit({ format: true })
  .extend({ recipe_id: z.number().int().describe('Recipe ID returned by search_recipes or get_recipe.') });

export const DeleteFavoriteRecipeInputSchema = profile.delete__recipe_favorites_v1.parameters.shape.query
  .omit({ format: true })
  .extend({ recipe_id: z.number().int().describe('Recipe ID returned by get_favorite_recipes for the favorite to remove.') });

// ── Profile API – Saved Meals ──

export const GetSavedMealsInputSchema = profile.get__savedMeals_v2.parameters.shape.query
  .omit({ format: true, meal: true })
  .extend({ meal: MealField.optional().describe('Return only saved meals marked as suitable for this meal bucket.') });

export const CreateSavedMealInputSchema = profile.post__savedMeals_v1.parameters.shape.query
  .omit({ format: true })
  .extend({
    saved_meal_name: z.string().describe('User-visible name for the new saved meal.'),
    saved_meal_description: z.string().optional().describe('Optional user-visible description of the saved meal.'),
    meals: z.string().optional().describe('Comma-separated suitable meal buckets: breakfast, lunch, dinner, and/or other.'),
  });

export const EditSavedMealInputSchema = profile.put__savedMeals_v1.parameters.shape.query
  .omit({ format: true })
  .extend({
    saved_meal_id: z.number().int().describe('Saved meal ID returned by get_saved_meals or create_saved_meal.'),
    saved_meal_name: z.string().optional().describe('Replacement saved-meal name; omit to keep the current name.'),
    saved_meal_description: z.string().optional().describe('Replacement saved-meal description; omit to keep the current description.'),
    meals: z.string().optional().describe('Replacement comma-separated suitable meal buckets: breakfast, lunch, dinner, and/or other.'),
  });

export const DeleteSavedMealInputSchema = profile.delete__savedMeals_v1.parameters.shape.query
  .omit({ format: true, method: true })
  .extend({ saved_meal_id: z.number().int().describe('Saved meal ID returned by get_saved_meals or create_saved_meal.') });

export const GetSavedMealItemsInputSchema = profile.get__savedMeals_item_v2.parameters.shape.query
  .omit({ format: true })
  .extend({ saved_meal_id: z.number().int().describe('Saved meal ID returned by get_saved_meals or create_saved_meal.') });

export const AddSavedMealItemInputSchema = profile.post__savedMeals_item_v1.parameters.shape.query
  .omit({ format: true })
  .extend({
    saved_meal_id: z.number().int().describe('Saved meal ID returned by get_saved_meals or create_saved_meal.'),
    food_id: z.number().int().describe('Food ID returned by search_foods, find_food_by_barcode, get_food, or create_food.'),
    saved_meal_item_name: z.string().describe('User-visible item label, usually the food_name returned by a food lookup.'),
    serving_id: z.number().int().describe('Serving ID returned by get_food or a food-list tool.'),
    number_of_units: z.number().describe('Quantity of the selected serving, such as 0.5, 1, or 2.'),
  });

export const EditSavedMealItemInputSchema = profile.put__savedMeals_item_v1.parameters.shape.query
  .omit({ format: true })
  .extend({
    saved_meal_item_id: z.number().int().describe('Saved meal item ID returned by get_saved_meal_items or add_saved_meal_item.'),
    saved_meal_item_name: z.string().optional().describe('Replacement user-visible item label; omit to keep the current label.'),
    number_of_units: z.number().optional().describe('Replacement quantity of the existing serving; omit to keep the current quantity.'),
  });

export const DeleteSavedMealItemInputSchema = profile.delete__savedMeals_item_v1.parameters.shape.query
  .omit({ format: true, method: true })
  .extend({ saved_meal_item_id: z.number().int().describe('Saved meal item ID returned by get_saved_meal_items or add_saved_meal_item.') });

// ── Profile API – Custom Food ──

export const CreateFoodInputSchema = profile.post__food_v2.parameters.shape.query
  .omit({ format: true })
  .extend({
    brand_name: z.string().describe('Brand name for the custom food, such as "Acme".'),
    food_name: z.string().describe('Food name without the brand, such as "Whole Wheat Bread".'),
    serving_size: z.string().describe('Full serving description, such as "1 slice" or "100 g".'),
    calories: z.number().describe('Calories in kcal for the stated serving.'),
    fat: z.number().describe('Total fat in grams for the stated serving.'),
    carbohydrate: z.number().describe('Total carbohydrate in grams for the stated serving.'),
    protein: z.number().describe('Protein in grams for the stated serving.'),
    serving_amount: z.string().optional().describe('Decimal standardized quantity encoded as a string; combine with serving_amount_unit.'),
    serving_amount_unit: z.string().optional().describe('Standardized serving unit: "g", "ml", or "oz"; defaults to "g".'),
    calories_from_fat: z.string().optional().describe('Calories from fat in kcal, encoded as a decimal string.'),
    saturated_fat: z.string().optional().describe('Saturated fat in grams, encoded as a decimal string.'),
    polyunsaturated_fat: z.string().optional().describe('Polyunsaturated fat in grams, encoded as a decimal string.'),
    monounsaturated_fat: z.string().optional().describe('Monounsaturated fat in grams, encoded as a decimal string.'),
    trans_fat: z.string().optional().describe('Trans fat in grams, encoded as a decimal string.'),
    cholesterol: z.string().optional().describe('Cholesterol in milligrams, encoded as a decimal string.'),
    sodium: z.string().optional().describe('Sodium in milligrams, encoded as a decimal string.'),
    potassium: z.string().optional().describe('Potassium in milligrams, encoded as a decimal string.'),
    fiber: z.string().optional().describe('Dietary fiber in grams, encoded as a decimal string.'),
    sugar: z.string().optional().describe('Total sugar in grams, encoded as a decimal string.'),
    added_sugars: z.string().optional().describe('Added sugars in grams, encoded as a decimal string.'),
    vitamin_d: z.string().optional().describe('Vitamin D in micrograms, encoded as a decimal string.'),
    vitamin_a: z.string().optional().describe('Vitamin A in micrograms, encoded as a decimal string.'),
    vitamin_c: z.string().optional().describe('Vitamin C in milligrams, encoded as a decimal string.'),
    calcium: z.string().optional().describe('Calcium in milligrams, encoded as a decimal string.'),
    iron: z.string().optional().describe('Iron in milligrams, encoded as a decimal string.'),
  });

// ── Profile API – Weight ──

export const UpdateWeightInputSchema = profile.post__weight_v1.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({
    current_weight_kg: z.number().describe('Weight to record, in kilograms regardless of weight_type.'),
    weight_type: z.string().optional().describe('Profile display unit for weight: "kg" or "lb"; defaults to "kg".'),
    height_type: z.string().optional().describe('Profile display unit for height: "cm" or "inch"; defaults to "cm".'),
    goal_weight_kg: z.number().optional().describe('Goal weight in kilograms; required with current_height_cm for the first weigh-in.'),
    comment: z.string().optional().describe('Optional note attached to this weigh-in.'),
    current_height_cm: z.number().optional().describe('Current height in centimeters; required and settable only on the first weigh-in.'),
    date: DateField,
  });

export const GetWeightMonthInputSchema = profile.get__weight_month_v2.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({ date: DateField.describe('Any date in the target month, in YYYY-MM-DD format; omit for the current month.') });

// ── Profile API – Exercise ──

export const GetExercisesInputSchema = z.object({});

export const EditExerciseEntriesInputSchema = profile.put__exerciseEntries_v1.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({
    shift_to_id: z.number().int().describe('Destination exercise ID returned by get_exercises; use 0 for a custom "Other" exercise.'),
    shift_from_id: z.number().int().describe('Source exercise ID returned by get_exercises; use 0 for a custom "Other" exercise.'),
    minutes: z.number().int().describe('Whole number of minutes to move from the source exercise to the destination.'),
    shift_to_name: z.string().optional().describe('Destination custom exercise name; required only when shift_to_id is 0.'),
    shift_from_name: z.string().optional().describe('Source custom exercise name; required only when shift_from_id is 0.'),
    kcal: z.number().optional().describe('Total kcal burned by the destination custom exercise; required only when shift_to_id is 0.'),
    date: DateField,
  });

export const GetExerciseEntriesMonthInputSchema = profile.get__exerciseEntries_month_v2.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({ date: DateField.describe('Any date in the target month, in YYYY-MM-DD format; omit for the current month.') });

export const SaveExerciseTemplateInputSchema = profile.post__exerciseEntries_day_v1.parameters.shape.query
  .omit({ format: true, date: true })
  .extend({
    days: z.number().int().describe('Weekday bitmask from 0 to 128, with Sunday as bit 1 and Saturday as bit 7; for example Tuesday plus Thursday is 20.'),
    date: DateField,
  });

// ── Profile ──

export const GetProfileInputSchema = z.object({});

// ── OAuth Flow ──

export const SetupCredentialsInputSchema = z.object({
  client_id: z.string().describe('FatSecret Client ID from platform.fatsecret.com → My Account → API Keys.'),
  client_secret: z.string().describe('OAuth 2.0 Client Secret from the FatSecret API Keys page.'),
  consumer_secret: z.string().describe('OAuth 1.0 Consumer Secret from the FatSecret API Keys page; this is different from the Client Secret.'),
});

export const StartAuthInputSchema = z.object({});

export const CompleteAuthInputSchema = z.object({
  verifier: z.string().describe('OAuth verifier code shown after the user opens the authorization_url returned by start_auth and approves access.'),
});

export const CheckAuthStatusInputSchema = z.object({});

// ── Tool outputs ──

// FatSecret serializes numeric response values as strings in JSON responses.
const ApiValueSchema = z.union([z.string(), z.number()]);
const ApiBooleanSchema = z.union([z.string(), z.number(), z.boolean()]);

const FatSecretErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiValueSchema,
        message: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

function fatSecretOutput<T extends z.ZodTypeAny>(dataSchema: T): z.ZodTypeAny {
  return z.object({
    data: z.union([dataSchema, FatSecretErrorSchema, z.null()]),
  });
}

const ValueSchema = z.object({ value: ApiValueSchema }).passthrough();

const SuccessDataSchema = z
  .object({
    success: ValueSchema,
  })
  .passthrough();

const ImageSchema = z
  .object({
    image_url: z.string(),
    image_type: ApiValueSchema,
  })
  .passthrough();

const AttributeSchema = z
  .object({
    id: ApiValueSchema,
    name: z.string(),
    value: ApiValueSchema,
  })
  .passthrough();

const ServingSchema = z
  .object({
    serving_id: ApiValueSchema,
    serving_description: z.string(),
    serving_url: z.string().optional(),
    metric_serving_amount: ApiValueSchema.optional(),
    metric_serving_unit: z.string().optional(),
    number_of_units: ApiValueSchema.optional(),
    measurement_description: z.string().optional(),
    calories: ApiValueSchema,
    carbohydrate: ApiValueSchema,
    protein: ApiValueSchema,
    fat: ApiValueSchema,
    saturated_fat: ApiValueSchema.optional(),
    polyunsaturated_fat: ApiValueSchema.optional(),
    monounsaturated_fat: ApiValueSchema.optional(),
    trans_fat: ApiValueSchema.optional(),
    cholesterol: ApiValueSchema.optional(),
    sodium: ApiValueSchema.optional(),
    potassium: ApiValueSchema.optional(),
    fiber: ApiValueSchema.optional(),
    sugar: ApiValueSchema.optional(),
    added_sugars: ApiValueSchema.optional(),
    vitamin_a: ApiValueSchema.optional(),
    vitamin_c: ApiValueSchema.optional(),
    vitamin_d: ApiValueSchema.optional(),
    calcium: ApiValueSchema.optional(),
    iron: ApiValueSchema.optional(),
    is_default: ApiBooleanSchema.optional(),
  })
  .passthrough();

const FoodSchema = z
  .object({
    food_id: ApiValueSchema,
    food_name: z.string(),
    food_type: z.string(),
    food_url: z.string(),
    food_description: z.string().optional(),
    brand_name: z.string().optional(),
    food_sub_categories: z
      .object({
        food_sub_category: z.array(z.string()),
      })
      .passthrough()
      .optional(),
    food_images: z
      .object({
        food_image: z.array(ImageSchema),
      })
      .passthrough()
      .optional(),
    food_attributes: z
      .object({
        allergens: z
          .object({ allergen: z.array(AttributeSchema) })
          .passthrough()
          .optional(),
        preferences: z
          .object({ preference: z.array(AttributeSchema) })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    servings: z
      .object({
        serving: z.array(ServingSchema),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const FoodsDataSchema = z
  .object({
    foods: z.object({ food: z.array(FoodSchema).optional() }).passthrough(),
  })
  .passthrough();

const FoodsSearchDataSchema = z
  .object({
    foods_search: z
      .object({
        max_results: ApiValueSchema,
        total_results: ApiValueSchema,
        page_number: ApiValueSchema,
        results: z.object({ food: z.array(FoodSchema).optional() }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const FoodDataSchema = z.object({ food: FoodSchema }).passthrough();

const RecipeSchema = z
  .object({
    recipe_id: ApiValueSchema,
    recipe_name: z.string(),
    recipe_url: z.string().optional(),
    recipe_description: z.string().optional(),
    recipe_image: z.string().optional(),
    number_of_servings: ApiValueSchema.optional(),
    grams_per_portion: ApiValueSchema.optional(),
    preparation_time_min: ApiValueSchema.optional(),
    cooking_time_min: ApiValueSchema.optional(),
    rating: ApiValueSchema.optional(),
    recipe_types: z
      .object({ recipe_type: z.array(z.string()) })
      .passthrough()
      .optional(),
    recipe_categories: z
      .object({
        recipe_category: z.array(
          z
            .object({
              recipe_category_name: z.string(),
              recipe_category_url: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    recipe_images: z
      .object({ recipe_image: z.array(z.string()) })
      .passthrough()
      .optional(),
    ingredients: z
      .object({
        ingredient: z.array(
          z
            .object({
              food_id: ApiValueSchema,
              food_name: z.string(),
              serving_id: ApiValueSchema,
              ingredient_description: z.string(),
              ingredient_url: z.string(),
              number_of_units: ApiValueSchema,
              measurement_description: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    directions: z
      .object({
        direction: z.array(
          z
            .object({
              direction_number: ApiValueSchema,
              direction_description: z.string(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    recipe_nutrition: z
      .object({
        calories: ApiValueSchema,
        carbohydrate: ApiValueSchema,
        protein: ApiValueSchema,
        fat: ApiValueSchema,
      })
      .passthrough()
      .optional(),
    recipe_ingredients: z
      .object({ ingredient: z.array(z.string()) })
      .passthrough()
      .optional(),
    serving_sizes: z
      .object({
        serving: z.union([
          z
            .object({
              serving_size: z.string(),
              calories: ApiValueSchema,
              carbohydrate: ApiValueSchema,
              protein: ApiValueSchema,
              fat: ApiValueSchema,
            })
            .passthrough(),
          z.array(
            z
              .object({
                serving_size: z.string(),
                calories: ApiValueSchema,
                carbohydrate: ApiValueSchema,
                protein: ApiValueSchema,
                fat: ApiValueSchema,
              })
              .passthrough(),
          ),
        ]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const RecipeDataSchema = z.object({ recipe: RecipeSchema }).passthrough();

const RecipesDataSchema = z
  .object({
    recipes: z
      .object({
        max_results: ApiValueSchema.optional(),
        total_results: ApiValueSchema.optional(),
        page_number: ApiValueSchema.optional(),
        recipe: z.array(RecipeSchema).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const FoodEntrySchema = z
  .object({
    food_entry_id: ApiValueSchema,
    food_entry_description: z.string(),
    date_int: ApiValueSchema,
    meal: z.string(),
    food_id: ApiValueSchema,
    serving_id: ApiValueSchema,
    number_of_units: ApiValueSchema,
    food_entry_name: z.string(),
    calories: ApiValueSchema,
    carbohydrate: ApiValueSchema,
    protein: ApiValueSchema,
    fat: ApiValueSchema,
    saturated_fat: ApiValueSchema.optional(),
    polyunsaturated_fat: ApiValueSchema.optional(),
    monounsaturated_fat: ApiValueSchema.optional(),
    trans_fat: ApiValueSchema.optional(),
    cholesterol: ApiValueSchema.optional(),
    sodium: ApiValueSchema.optional(),
    potassium: ApiValueSchema.optional(),
    fiber: ApiValueSchema.optional(),
    sugar: ApiValueSchema.optional(),
    added_sugars: ApiValueSchema.optional(),
    vitamin_a: ApiValueSchema.optional(),
    vitamin_c: ApiValueSchema.optional(),
    vitamin_d: ApiValueSchema.optional(),
    calcium: ApiValueSchema.optional(),
    iron: ApiValueSchema.optional(),
  })
  .passthrough();

const FoodEntriesDataSchema = z
  .object({
    food_entries: z.object({ food_entry: z.array(FoodEntrySchema).optional() }).passthrough(),
  })
  .passthrough();

const NutritionDaySchema = z
  .object({
    date_int: ApiValueSchema,
    calories: ApiValueSchema,
    carbohydrate: ApiValueSchema,
    protein: ApiValueSchema,
    fat: ApiValueSchema,
  })
  .passthrough();

const MonthSchema = z
  .object({
    from_date_int: ApiValueSchema,
    to_date_int: ApiValueSchema,
    day: z.array(z.object({ date_int: ApiValueSchema }).passthrough()).optional(),
  })
  .passthrough();

const FoodEntriesMonthDataSchema = z
  .object({
    month: MonthSchema.extend({ day: z.array(NutritionDaySchema).optional() }),
  })
  .passthrough();

const SavedMealSchema = z
  .object({
    saved_meal_id: ApiValueSchema,
    saved_meal_name: z.string(),
    saved_meal_description: z.string().optional(),
    meals: z.string().optional(),
  })
  .passthrough();

const SavedMealsDataSchema = z
  .object({
    saved_meals: z.object({ saved_meal: z.array(SavedMealSchema).optional() }).passthrough(),
  })
  .passthrough();

const SavedMealItemSchema = z
  .object({
    saved_meal_item_id: ApiValueSchema,
    food_id: ApiValueSchema,
    saved_meal_item_name: z.string(),
    serving_id: ApiValueSchema,
    number_of_units: ApiValueSchema,
  })
  .passthrough();

const SavedMealItemsDataSchema = z
  .object({
    saved_meal_items: z
      .object({ saved_meal_item: z.array(SavedMealItemSchema).optional() })
      .passthrough(),
  })
  .passthrough();

const ExercisesDataSchema = z
  .object({
    exercise_types: z
      .object({
        exercise: z
          .array(
            z
              .object({
                exercise_id: ApiValueSchema,
                exercise_name: z.string(),
                exercise_description: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ProfileDataSchema = z
  .object({
    profile: z
      .object({
        weight_measure: z.string(),
        height_measure: z.string(),
        last_weight_kg: ApiValueSchema.optional(),
        last_weight_date_int: ApiValueSchema.optional(),
        last_weight_comment: z.string().optional(),
        goal_weight_kg: ApiValueSchema.optional(),
        height_cm: ApiValueSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

const idDataSchema = (name: string) =>
  z
    .object({
      [name]: ValueSchema,
    })
    .passthrough();

// Public API – Foods
export const SearchFoodsOutputSchema = fatSecretOutput(FoodsSearchDataSchema);
export const GetFoodOutputSchema = fatSecretOutput(FoodDataSchema);
export const FindFoodByBarcodeOutputSchema = fatSecretOutput(FoodDataSchema);
export const AutocompleteFoodsOutputSchema = fatSecretOutput(
  z
    .object({
      suggestions: z.object({ suggestion: z.array(z.string()).optional() }).passthrough(),
    })
    .passthrough(),
);

// Public API – Recipes
export const SearchRecipesOutputSchema = fatSecretOutput(RecipesDataSchema);
export const GetRecipeOutputSchema = fatSecretOutput(RecipeDataSchema);

// Public API – Reference Data
export const GetFoodCategoriesOutputSchema = fatSecretOutput(
  z
    .object({
      food_categories: z
        .object({
          food_category: z
            .array(
              z
                .object({
                  food_category_id: ApiValueSchema,
                  food_category_name: z.string(),
                  food_category_description: z.string().optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    })
    .passthrough(),
);
export const GetFoodSubCategoriesOutputSchema = fatSecretOutput(
  z
    .object({
      food_sub_categories: z
        .object({ food_sub_category: z.array(z.string()).optional() })
        .passthrough(),
    })
    .passthrough(),
);
export const GetBrandsOutputSchema = fatSecretOutput(
  z
    .object({
      food_brands: z.object({ food_brand: z.array(z.string()).optional() }).passthrough(),
    })
    .passthrough(),
);
export const GetRecipeTypesOutputSchema = fatSecretOutput(
  z
    .object({
      recipe_types: z.object({ recipe_types: z.array(z.string()).optional() }).passthrough(),
    })
    .passthrough(),
);

// Profile API – Food Diary
export const GetFoodEntriesOutputSchema = fatSecretOutput(FoodEntriesDataSchema);
export const GetFoodEntriesMonthOutputSchema = fatSecretOutput(FoodEntriesMonthDataSchema);
export const CreateFoodEntryOutputSchema = fatSecretOutput(FoodEntriesDataSchema);
export const EditFoodEntryOutputSchema = fatSecretOutput(SuccessDataSchema);
export const DeleteFoodEntryOutputSchema = fatSecretOutput(SuccessDataSchema);
export const CopyFoodEntriesOutputSchema = fatSecretOutput(SuccessDataSchema);
export const CopySavedMealEntriesOutputSchema = fatSecretOutput(SuccessDataSchema);

// Profile API – Favorites
export const GetFavoriteFoodsOutputSchema = fatSecretOutput(FoodsDataSchema);
export const DeleteFavoriteFoodOutputSchema = fatSecretOutput(SuccessDataSchema);
export const GetMostEatenFoodsOutputSchema = fatSecretOutput(FoodsDataSchema);
export const GetRecentlyEatenFoodsOutputSchema = fatSecretOutput(FoodsDataSchema);
export const GetFavoriteRecipesOutputSchema = fatSecretOutput(RecipesDataSchema);
export const AddFavoriteRecipeOutputSchema = fatSecretOutput(SuccessDataSchema);
export const DeleteFavoriteRecipeOutputSchema = fatSecretOutput(SuccessDataSchema);

// Profile API – Saved Meals
export const GetSavedMealsOutputSchema = fatSecretOutput(SavedMealsDataSchema);
export const CreateSavedMealOutputSchema = fatSecretOutput(idDataSchema('saved_meal_id'));
export const EditSavedMealOutputSchema = fatSecretOutput(SuccessDataSchema);
export const DeleteSavedMealOutputSchema = fatSecretOutput(SuccessDataSchema);
export const GetSavedMealItemsOutputSchema = fatSecretOutput(SavedMealItemsDataSchema);
export const AddSavedMealItemOutputSchema = fatSecretOutput(idDataSchema('saved_meal_item_id'));
export const EditSavedMealItemOutputSchema = fatSecretOutput(SuccessDataSchema);
export const DeleteSavedMealItemOutputSchema = fatSecretOutput(SuccessDataSchema);

// Profile API – Weight
export const UpdateWeightOutputSchema = fatSecretOutput(SuccessDataSchema);
export const GetWeightMonthOutputSchema = fatSecretOutput(
  z
    .object({
      month: MonthSchema.extend({
        day: z
          .array(
            z
              .object({
                date_int: ApiValueSchema,
                weight_kg: ApiValueSchema,
                weight_comment: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      }),
    })
    .passthrough(),
);

// Profile API – Exercise
export const GetExercisesOutputSchema = fatSecretOutput(ExercisesDataSchema);
export const EditExerciseEntriesOutputSchema = fatSecretOutput(SuccessDataSchema);
export const GetExerciseEntriesMonthOutputSchema = fatSecretOutput(
  z
    .object({
      month: MonthSchema.extend({
        day: z
          .array(z.object({ date_int: ApiValueSchema, calories: ApiValueSchema }).passthrough())
          .optional(),
      }),
    })
    .passthrough(),
);
export const SaveExerciseTemplateOutputSchema = fatSecretOutput(SuccessDataSchema);

// Profile
export const GetProfileOutputSchema = fatSecretOutput(ProfileDataSchema);
export const CreateFoodOutputSchema = fatSecretOutput(idDataSchema('food_id'));

// OAuth Flow
export const CheckAuthStatusOutputSchema = z.object({
  data: z.object({
    credentials_configured: z.boolean(),
    profile_authenticated: z.boolean(),
    config_path: z.string(),
    message: z.string(),
  }),
});
export const SetupCredentialsOutputSchema = z.object({
  data: z.object({ message: z.string(), config_path: z.string() }),
});
export const StartAuthOutputSchema = z.object({
  data: z.object({ message: z.string(), authorization_url: z.string() }),
});
export const CompleteAuthOutputSchema = z.object({
  data: z.object({ message: z.string(), config_path: z.string() }),
});
