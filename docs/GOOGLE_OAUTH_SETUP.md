# Google OAuth 2.0 Configuration Guide for LandAlert-Nexus

This guide provides the exact configuration required to enable Google OAuth sign-in with Supabase Auth for LandAlert-Nexus.

Production Deployment URL:
`https://landalert-nexus.onrender.com`

---

## 1. Google Cloud Console Configuration

1. Log into the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your Google Cloud project (or create one for LandAlert-Nexus).
3. Navigate to **APIs & Services** > **OAuth consent screen**:
   - User Type: **External**
   - App Name: `LandAlert-Nexus`
   - User support email: Select your official administrator email.
   - Authorized domains: Add `supabase.co` and `onrender.com`.
   - Developer contact email: Enter your contact email.
   - Scopes: Request `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`.
4. Navigate to **APIs & Services** > **Credentials**:
   - Click **Create Credentials** > **OAuth client ID**.
   - Application type: **Web application**.
   - Name: `LandAlert-Nexus Production Web Client`.
   - **Authorized JavaScript origins**:
     - `https://landalert-nexus.onrender.com`
     - `http://localhost:3000` (for local development)
     - `http://localhost:5173` (for local Vite dev)
   - **Authorized redirect URIs**:
     - Enter your Supabase Auth callback URL:
       `https://<YOUR-SUPABASE-PROJECT-ID>.supabase.co/auth/v1/callback`
       *(Retrieve `<YOUR-SUPABASE-PROJECT-ID>` from your Supabase project dashboard)*
5. Click **Create** and safely copy:
   - **Client ID**
   - **Client Secret**

> [!CAUTION]
> Never commit the Google Client Secret or Supabase Service Role Key to Git. They must be stored only in your Supabase Auth Dashboard.

---

## 2. Supabase Auth Provider Configuration

1. Open your project on the [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Authentication** > **Providers** > **Google**:
   - Toggle **Enable Sign in with Google** to **ON**.
   - **Client ID**: Paste your Google OAuth Client ID.
   - **Client Secret**: Paste your Google OAuth Client Secret.
   - Callback URL (for reference): Confirm it matches `https://<YOUR-SUPABASE-PROJECT-ID>.supabase.co/auth/v1/callback`.
   - Click **Save**.
3. Go to **Authentication** > **URL Configuration**:
   - **Site URL**: `https://landalert-nexus.onrender.com`
   - **Redirect URLs** (Add all):
     - `https://landalert-nexus.onrender.com/**`
     - `http://localhost:3000/**`
     - `http://localhost:5173/**`
   - Click **Save**.

---

## 3. Application Security & Authorization Architecture

LandAlert-Nexus enforces a strict distinction between **authentication** and **authorization**:

1. **Authentication Mechanism**:
   - Google sign-in is purely an identity authentication mechanism (`provider: "google"`).
   - Any public Google account authenticates as a standard `PUBLIC_USER`.

2. **Official Government Domains**:
   - The server inspects the verified email domain:
     - Central geological/space/disaster: `@gsi.gov.in`, `@nesac.gov.in`, `@ndma.gov.in`, `@nic.in`
     - State disaster management: `@assam.gov.in`, `@mizoram.gov.in`, `@meghalaya.gov.in`, `@nagaland.gov.in`, `@manipur.gov.in`, `@tripura.gov.in`, `@arunachal.gov.in`, `@sikkim.gov.in`
   - If an account has an official domain, its status is initially set to `PENDING_OFFICIAL_VERIFICATION`.

3. **Emergency Dispatch Privileges**:
   - A government email domain alone is **never** sufficient for emergency dispatch or risk overrides.
   - Emergency dispatch operations require explicit `DISPATCHER` or `ADMIN` role assignment in `user_profiles`, validated server-side and recorded in `audit_logs`.
