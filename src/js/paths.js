/**
 * The login page. Every "send them to sign in" redirect uses this, so moving
 * the page is a one-line change. Pure on purpose: no imports, so tests and
 * modules that avoid the Supabase client can still use it.
 */
export const LOGIN_PATH = "/";
