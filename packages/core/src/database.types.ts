
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "body_measure": {
                  Row: {
                    "created_at": string,"external_id": string | null,"id": number,"idempotency_key": string | null,"measured_at": string,"source": Database["public"]['Enums']["entry_source"],"user_id": string,"weight_kg": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: never,"idempotency_key"?: string | null,"measured_at": string,"source"?: Database["public"]['Enums']["entry_source"],"user_id"?: string,"weight_kg": number
                  }
                  Update: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: never,"idempotency_key"?: string | null,"measured_at"?: string,"source"?: Database["public"]['Enums']["entry_source"],"user_id"?: string,"weight_kg"?: number
                  }
                  Relationships: [
                    
                  ]
                },"companion_event": {
                  Row: {
                    "created_at": string,"data": NonNullable<Json>,"id": number,"occurred_at": string,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"data"?: NonNullable<Json>,"id"?: never,"occurred_at"?: string,"type": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"data"?: NonNullable<Json>,"id"?: never,"occurred_at"?: string,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"food_ref": {
                  Row: {
                    "carbs_g": number | null,"code": string,"created_at": string,"energy_kcal": number | null,"fat_g": number | null,"fiber_g": number | null,"id": number,"micronutrients": NonNullable<Json>,"name": string,"nutrient_details": NonNullable<Json>,"piece_weight_g": number | null,"protein_g": number | null,"salt_g": number | null,"saturated_fat_g": number | null,"source": Database["public"]['Enums']["food_source"],"sugars_g": number | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "carbs_g"?: number | null,"code": string,"created_at"?: string,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"id"?: never,"micronutrients"?: NonNullable<Json>,"name": string,"nutrient_details"?: NonNullable<Json>,"piece_weight_g"?: number | null,"protein_g"?: number | null,"salt_g"?: number | null,"saturated_fat_g"?: number | null,"source": Database["public"]['Enums']["food_source"],"sugars_g"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "carbs_g"?: number | null,"code"?: string,"created_at"?: string,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"id"?: never,"micronutrients"?: NonNullable<Json>,"name"?: string,"nutrient_details"?: NonNullable<Json>,"piece_weight_g"?: number | null,"protein_g"?: number | null,"salt_g"?: number | null,"saturated_fat_g"?: number | null,"source"?: Database["public"]['Enums']["food_source"],"sugars_g"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inventory_item": {
                  Row: {
                    "category": Database["public"]['Enums']["inventory_category"],"created_at": string,"expires_on": string | null,"food_ref_id": number | null,"id": number,"level": Database["public"]['Enums']["stock_level"] | null,"location": Database["public"]['Enums']["inventory_location"],"name": string,"quantity": number | null,"restock_level": Database["public"]['Enums']["stock_level"] | null,"restock_threshold": number | null,"unit": Database["public"]['Enums']["quantity_unit"] | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["inventory_category"],"created_at"?: string,"expires_on"?: string | null,"food_ref_id"?: number | null,"id"?: never,"level"?: Database["public"]['Enums']["stock_level"] | null,"location": Database["public"]['Enums']["inventory_location"],"name": string,"quantity"?: number | null,"restock_level"?: Database["public"]['Enums']["stock_level"] | null,"restock_threshold"?: number | null,"unit"?: Database["public"]['Enums']["quantity_unit"] | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["inventory_category"],"created_at"?: string,"expires_on"?: string | null,"food_ref_id"?: number | null,"id"?: never,"level"?: Database["public"]['Enums']["stock_level"] | null,"location"?: Database["public"]['Enums']["inventory_location"],"name"?: string,"quantity"?: number | null,"restock_level"?: Database["public"]['Enums']["stock_level"] | null,"restock_threshold"?: number | null,"unit"?: Database["public"]['Enums']["quantity_unit"] | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_item_food_ref_id_fkey"
      columns: ["food_ref_id"]
isOneToOne: false
      referencedRelation: "food_ref"
      referencedColumns: ["id"]
    }
                  ]
                },"meal": {
                  Row: {
                    "created_at": string,"eaten_at": string,"id": number,"idempotency_key": string | null,"label": string,"nutrition_totals": NonNullable<Json>,"partial_values": boolean,"recipe_id": number | null,"servings": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"eaten_at"?: string,"id"?: never,"idempotency_key"?: string | null,"label": string,"nutrition_totals"?: NonNullable<Json>,"partial_values"?: boolean,"recipe_id"?: number | null,"servings"?: number | null,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"eaten_at"?: string,"id"?: never,"idempotency_key"?: string | null,"label"?: string,"nutrition_totals"?: NonNullable<Json>,"partial_values"?: boolean,"recipe_id"?: number | null,"servings"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meal_recipe_id_user_id_fkey"
      columns: ["recipe_id","user_id"]
isOneToOne: false
      referencedRelation: "recipe"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"meal_item": {
                  Row: {
                    "created_at": string,"food_ref_id": number,"id": number,"meal_id": number,"quantity_g": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"food_ref_id": number,"id"?: never,"meal_id": number,"quantity_g"?: number | null,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"food_ref_id"?: number,"id"?: never,"meal_id"?: number,"quantity_g"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "meal_item_food_ref_id_fkey"
      columns: ["food_ref_id"]
isOneToOne: false
      referencedRelation: "food_ref"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "meal_item_meal_id_user_id_fkey"
      columns: ["meal_id","user_id"]
isOneToOne: false
      referencedRelation: "meal"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"recipe": {
                  Row: {
                    "created_at": string,"id": number,"is_favorite": boolean,"origin": Database["public"]['Enums']["recipe_origin"],"servings": number,"steps": NonNullable<Json>,"title": string,"total_minutes": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"is_favorite"?: boolean,"origin": Database["public"]['Enums']["recipe_origin"],"servings"?: number,"steps"?: NonNullable<Json>,"title": string,"total_minutes"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"is_favorite"?: boolean,"origin"?: Database["public"]['Enums']["recipe_origin"],"servings"?: number,"steps"?: NonNullable<Json>,"title"?: string,"total_minutes"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"recipe_ingredient": {
                  Row: {
                    "created_at": string,"food_ref_id": number | null,"id": number,"inventory_item_id": number | null,"quantity": number | null,"recipe_id": number,"unit": Database["public"]['Enums']["quantity_unit"] | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"food_ref_id"?: number | null,"id"?: never,"inventory_item_id"?: number | null,"quantity"?: number | null,"recipe_id": number,"unit"?: Database["public"]['Enums']["quantity_unit"] | null,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"food_ref_id"?: number | null,"id"?: never,"inventory_item_id"?: number | null,"quantity"?: number | null,"recipe_id"?: number,"unit"?: Database["public"]['Enums']["quantity_unit"] | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recipe_ingredient_food_ref_id_fkey"
      columns: ["food_ref_id"]
isOneToOne: false
      referencedRelation: "food_ref"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "recipe_ingredient_inventory_item_id_user_id_fkey"
      columns: ["inventory_item_id","user_id"]
isOneToOne: false
      referencedRelation: "inventory_item"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "recipe_ingredient_recipe_id_user_id_fkey"
      columns: ["recipe_id","user_id"]
isOneToOne: false
      referencedRelation: "recipe"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"stock_movement": {
                  Row: {
                    "created_at": string,"delta": number,"id": number,"inventory_item_id": number,"meal_id": number | null,"reason": Database["public"]['Enums']["stock_movement_reason"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delta": number,"id"?: never,"inventory_item_id": number,"meal_id"?: number | null,"reason": Database["public"]['Enums']["stock_movement_reason"],"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"delta"?: number,"id"?: never,"inventory_item_id"?: number,"meal_id"?: number | null,"reason"?: Database["public"]['Enums']["stock_movement_reason"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_movement_inventory_item_id_user_id_fkey"
      columns: ["inventory_item_id","user_id"]
isOneToOne: false
      referencedRelation: "inventory_item"
      referencedColumns: ["id","user_id"]
    },{
      foreignKeyName: "stock_movement_meal_id_user_id_fkey"
      columns: ["meal_id","user_id"]
isOneToOne: false
      referencedRelation: "meal"
      referencedColumns: ["id","user_id"]
    }
                  ]
                },"workout": {
                  Row: {
                    "created_at": string,"duration_min": number,"external_id": string | null,"id": number,"idempotency_key": string | null,"notes": string | null,"perceived_intensity": number | null,"source": Database["public"]['Enums']["entry_source"],"started_at": string,"type": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_min": number,"external_id"?: string | null,"id"?: never,"idempotency_key"?: string | null,"notes"?: string | null,"perceived_intensity"?: number | null,"source"?: Database["public"]['Enums']["entry_source"],"started_at": string,"type": string,"user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"duration_min"?: number,"external_id"?: string | null,"id"?: never,"idempotency_key"?: string | null,"notes"?: string | null,"perceived_intensity"?: number | null,"source"?: Database["public"]['Enums']["entry_source"],"started_at"?: string,"type"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            "entry_source": "manuel"|"health_connect","food_source": "ciqual"|"off","inventory_category": "epices"|"feculents"|"sauces"|"frais"|"fait_maison","inventory_location": "placard"|"frigo"|"congelateur","quantity_unit": "g"|"ml"|"piece","recipe_origin": "generee"|"manuelle","stock_level": "plein"|"moitie"|"presque_vide","stock_movement_reason": "achat"|"cuisine"|"manuel"|"perime"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "entry_source": ["manuel", "health_connect"],"food_source": ["ciqual", "off"],"inventory_category": ["epices", "feculents", "sauces", "frais", "fait_maison"],"inventory_location": ["placard", "frigo", "congelateur"],"quantity_unit": ["g", "ml", "piece"],"recipe_origin": ["generee", "manuelle"],"stock_level": ["plein", "moitie", "presque_vide"],"stock_movement_reason": ["achat", "cuisine", "manuel", "perime"]
          }
        }
} as const
