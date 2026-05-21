// Copy to config.js and fill in. Safe to commit config.js (keys are public-side / friends-only board).

window.GAJ_CONFIG = {
  // Supabase — https://supabase.com → run supabase/schema.sql in SQL Editor
  supabaseUrl: "https://YOUR_PROJECT_ID.supabase.co",
  supabaseAnonKey: "YOUR_ANON_KEY_HERE",

  // Email when Jack starts "Talk to Jack" — https://www.emailjs.com (free tier)
  // Create a service + template that emails you with {{from_name}}, {{message}}, {{session_id}}
  emailjsPublicKey: "YOUR_EMAILJS_PUBLIC_KEY",
  emailjsServiceId: "YOUR_SERVICE_ID",
  emailjsTemplateId: "YOUR_TEMPLATE_ID",
  notifyEmail: "john.raymond.jr@gmail.com",
};
