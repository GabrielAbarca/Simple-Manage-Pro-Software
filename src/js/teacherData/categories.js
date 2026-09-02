// ── Grade categories (item 8) + MEP component templates ─────────
import { supabase } from "../supabaseClient.js";

export async function fetchCategories(cstId) {
  const { data, error } = await supabase
    .from("grade_categories")
    .select("id, name, weight")
    .eq("class_subject_teacher_id", cstId)
    .order("name");
  if (error) throw error;
  return data;
}

export async function insertCategory(payload) {
  const { error } = await supabase.from("grade_categories").insert(payload);
  if (error) throw error;
}

export async function updateCategory(id, payload) {
  const { error } = await supabase
    .from("grade_categories")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id) {
  // assignments.category_id is ON DELETE SET NULL — assignments survive and
  // fall back to flat weighting.
  const { error } = await supabase
    .from("grade_categories")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ── MEP component templates (admin-owned; teacher instantiates) ──
export async function fetchComponentTemplates() {
  const { data, error } = await supabase
    .from("grade_component_templates")
    .select("id, name, subject_id, is_default")
    .order("name");
  if (error) throw error;
  return data;
}

export async function fetchTemplateItems(templateId) {
  const { data, error } = await supabase
    .from("grade_component_template_items")
    .select("name, weight, item_order")
    .eq("template_id", templateId)
    .order("item_order");
  if (error) throw error;
  return data;
}
