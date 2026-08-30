// Login view (login.html + login.js).
export default {
  // Shown on a school's own deployment, where the people signing in every
  // day are students, teachers and administrators. Noun phrases, so the
  // panel describes the system instead of addressing any one role.
  tagline1: "The school's management system.",
  tagline2: "Grades, attendance, schedules and records in one place.",
  // Order follows the icons in login.html: school, calendar, fact_check, event.
  feature1: "Grades by subject and term",
  feature2: "Weekly schedule",
  feature3: "Daily attendance",
  feature4: "Events and announcements",
  // The demo swaps in these (see login.js): its visitor is a director
  // evaluating the product, and the panel's job is to orient them — the
  // three portals are reachable, and nothing they touch is saved.
  demoTagline1: "You're about to enter a sample school.",
  demoTagline2:
    "Walk through the director's console, the teacher's, and the student portal.",
  demoFeature1: "Enrollment, sections and schedules",
  demoFeature2: "Gradebook and attendance by section",
  demoFeature3: "Progress reports and period close",
  demoFeature4: "Sample data — nothing you do is saved",
  welcomeTitle: "Welcome back",
  welcomeSubtitle: "Sign in to your account to continue",
  demoSubtitle: "You're signing in with the shared demo account",
  // The brand panel is hidden below the tablet breakpoint, so this notice —
  // which is not — carries the line that matters most to someone deciding
  // whether it is safe to click around.
  demoNotice: "Live demo — credentials are prefilled. Nothing you do is saved.",
  createTitle: "Create an account",
  createSubtitle: "Join SMP and access your student portal",
  fullName: "Full Name",
  fullNamePlaceholder: "María Rojas Vargas",
  emailAddress: "Email Address",
  password: "Password",
  confirmPassword: "Confirm Password",
  showPassword: "Show password",
  toggleTheme: "Toggle dark mode",
  signIn: "Sign In",
  signUp: "Sign Up",
  noAccount: "Don't have an account?",
  privacy: "Privacy policy",
  terms: "Terms of service",
  haveAccount: "Already have an account?",
  forgotPassword: "Forgot password?",
  resetLinkSent:
    "If an account exists for that email, a reset link is on its way.",
  recovery: {
    title: "Set a new password",
    subtitle: "Choose a new password for your account",
    newPassword: "New Password",
    confirmPassword: "Confirm New Password",
    submit: "Update password",
    verifying: "Checking your reset link…",
    success: "Password updated. Sign in with your new password.",
  },
  validation: {
    email: "Please enter a valid email address.",
    password: "Password must be at least 6 characters.",
    name: "Full name is required.",
    passwordsMatch: "Passwords do not match.",
  },
  error: {
    demoSignupDisabled:
      "Sign-up is disabled in the live demo — use the demo login.",
    recoveryDemoDisabled: "Password changes are disabled in the live demo.",
    linkExpired:
      "This reset link has expired or was already used. Request a new one below.",
    linkInvalid: "This reset link isn't valid. Request a new one below.",
    emailForReset:
      "Enter your email address first, then choose Forgot password?",
    samePassword: "Your new password must be different from the old one.",
    unexpected: "An unexpected error occurred. Please try again.",
    credentials: "Incorrect email or password. Please try again.",
    notConfirmed: "Your email is not confirmed. Please check your inbox.",
    exists:
      "An account with this email already exists. Try signing in instead.",
    passwordLength: "Password must be at least 6 characters long.",
    rateLimit: "Too many attempts. Please wait a moment before trying again.",
    network: "Network error. Please check your connection and try again.",
  },
};
