# Supabase Auth Email Templates

Use these templates to make Supabase confirmation/reset emails look branded for NBA Mantle.

## Files

- `confirm-signup.html` — Confirmation email body
- `reset-password.html` — Password reset email body

## Apply in Supabase

1. Open Supabase Dashboard for your project.
2. Go to **Authentication → Email Templates**.
3. For **Confirm signup**:
   - Subject (suggested): `Confirm your NBA Mantle account`
   - Paste `confirm-signup.html` into the body.
4. For **Reset password**:
   - Subject (suggested): `Reset your NBA Mantle password`
   - Paste `reset-password.html` into the body.
5. Save both templates.

## Notes

- `{{ .ConfirmationURL }}` is provided by Supabase. Keep it exactly as-is.
- Make sure your redirect URLs are configured in **Authentication → URL Configuration**.
- Google OAuth sign-ins do not use email verification templates.
