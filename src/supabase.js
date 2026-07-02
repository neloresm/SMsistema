import { createClient } from "@supabase/supabase-js";

/*
 * Conexão com o banco na nuvem (Supabase).
 * A URL e a chave "publishable" são públicas por natureza — a segurança
 * vem das políticas de acesso (RLS) criadas pelo script supabase-setup.sql.
 */
const SUPABASE_URL = "https://rtftkxbhmsfmkatlzlpe.supabase.co";
const SUPABASE_KEY = "sb_publishable_LyWU9Y0hsdLdWFCvSvGb9w_55vQ919z";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
