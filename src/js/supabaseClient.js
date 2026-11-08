import { createClient } from "@supabase/supabase-js";
import { assertExpectedRef } from "./projectRef.ts";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail fast on misconfiguration: a missing URL/key otherwise yields a client
// that throws opaque errors on the first request, leaving the app silently
// broken. Throwing here surfaces the real cause immediately.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables: set VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_ANON_KEY in your .env file (see .env.example).",
  );
}

// Optional, and worth setting on every real deployment: refuse to start if
// this build is aimed at a different project than it was built for. Demo mode
// stops writes but not reads, so a demo build pointed at a school project
// would publish that school's records. See projectRef.ts.
assertExpectedRef(supabaseUrl, import.meta.env.VITE_EXPECTED_PROJECT_REF);

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
