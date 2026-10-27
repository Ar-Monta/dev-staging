# 🎛️ Tenant Reserver

A high-polish, tactile physical push-button tenant allocation and reservation system built for engineering teams.

Designed to manage **3 Tenants** (`ali`, `demo`, `demo1`) across **3 Spaces** (`Stage Sekkat`, `Pre-prod Talarey`, `Beta`) in real time with hardware-inspired 3D push buttons, second-by-second countdown timers, future scheduling, mechanical sound synthesis, and server-side disk persistence.

---

## 🌟 New Features: 3 Optional Branches & Whole-Space Scope

### 🌿 3 Optional Branches
When reserving or pushing in a tenant, you are prompted for three dedicated branches (all optional):
1. **🌐 Frontend Branch** (e.g. `feature/checkout-ui`)
2. **⚙️ Backend Branch** (e.g. `feature/orders-api`)
3. **💼 CRM Branch** (e.g. `feature/crm-sync-webhook`)

- You can fill any combination (just frontend, backend + crm, all three, or leave blank).
- Each branch is rendered with a distinct, color-coded badge:
  - Cyan badge for **Frontend (`FE`)**
  - Purple badge for **Backend (`BE`)**
  - Amber badge for **CRM (`CRM`)**
- Each badge includes a **1-click copy button** (`git checkout <branch>`).

### ✏️ Editable Branches On-The-Fly
- Active branches can be **edited at any time** while a tenant is in use.
- Click the **✏️ Edit** button on the button or in the Details modal to modify the Frontend, Backend, or CRM branches.
- Changes are instantly saved to the server and broadcast in real time to all connected users without resetting countdown timers!
- You can choose to apply the branch edits to **just that tenant** or to the **Whole Space**!

### ⚡ Whole Space vs. Single Tenant Allocation
- You can reserve:
  - An **individual tenant** (`ali`, `demo`, or `demo1`) in any space, OR
  - An **entire space** (`Stage Sekkat`, `Pre-prod Talarey`, `Beta`) with all 3 tenants at once!
- Click the **⚡ Whole Space** button in any space header or select "Whole Space" in the modal.
- All 3 buttons will push in together, linked with the same user, duration, and branch configuration.
- A **Free Space** button in the space header allows popping out and releasing all 3 tenants at once!

---

## 🚀 Environments & Spaces

| Space | Display Name | Accent | Tenants |
|---|---|---|---|
| `stage_sekkat` | **Stage Sekkat** | Cyan (`#06b6d4`) | `ali`, `demo`, `demo1` |
| `preprod_talarey` | **Pre-prod Talarey** | Purple (`#a855f7`) | `ali`, `demo`, `demo1` |
| `beta` | **Beta** | Amber (`#f59e0b`) | `ali`, `demo`, `demo1` |

---

## 🕹️ Controls & Interactions

- **Popped Out (Free)**: Raised 3D depth, pulsing green LED. Click to open Claim / Reserve modal.
- **Pushed In (Occupied)**: Recessed slot depth, pulsing red/amber LED, countdown timer ticking every second, branch pills, and quick release/extend buttons.
- **Whole Space Action**: Header button to occupy or release all 3 tenants at once.
- **Edit Branches**: Pencil icon allows changing frontend, backend, and CRM branches on the fly.
- **Web Audio FX**: Procedural mechanical click sounds on push-in and pop-out with mute toggle.
### 🛡️ Strict Datetime Conflict Prevention
The system enforces strict conflict validation to ensure no overlapping reservations can ever occur:
- **Interval Overlap Formula**: Two time windows $[A_{\text{start}}, A_{\text{end}}]$ and $[B_{\text{start}}, B_{\text{end}}]$ conflict if and only if $\max(A_{\text{start}}, B_{\text{start}}) < \min(A_{\text{end}}, B_{\text{end}})$.
- **Multi-Tenant Atomic Pre-Validation**: When reserving multiple tenants at once (e.g. `['ali', 'demo']`), the server validates ALL selected tenants first. If even one tenant has a conflict, the entire request is rejected atomically with zero partial state mutation.
- **Active Occupant Protection**: You cannot schedule a reservation that overlaps with a currently active occupant's countdown window.
- **Consecutive Bookings Allowed**: Bookings that touch boundaries (e.g. 2:00 PM - 3:00 PM followed by 3:00 PM - 4:00 PM) are accepted without conflict.
- **Live Client-Side Conflict Detector**: As you type or pick start dates/times and durations in the modal:
  - Instant pre-flight checks highlight conflicting tenants in red.
  - A prominent `⚠️ Time Conflict Detected` warning banner details the exact conflict (`Tenant 'ali' conflicts with reservation by User A (02:00 PM - 03:00 PM)`).
  - The submit button is automatically disabled to prevent accidental conflict submissions.
  - A live **Schedule / Existing Bookings** view displays all booked intervals for the selected space and tenants.

---

## 🏃 Running the Application

### Local Development

```bash
npm install
npm start
```

Or run tests:
```bash
npm test
```

---

## ☁️ Deploying to Vercel

Tenant Reserver is configured for Vercel deployment via **Vercel Serverless Functions** (`api/index.js`), static asset delivery (`public/`), and a **GitHub Actions CI/CD pipeline** (`.github/workflows/vercel.yml`).

### Method 1: Instant Git Integration (Recommended & Simplest)

1. Push your repository to **GitHub**.
2. Visit [vercel.com](https://vercel.com) and log in.
3. Click **"Add New..."** > **"Project"**.
4. Import your GitHub repository (`tenant-reserver`).
5. Leave the default settings (Framework Preset: **Other**, Root Directory: `./`).
6. Click **Deploy**.
7. Vercel will build and launch your application with a live `.vercel.app` URL. Every subsequent `git push` to your repository will automatically trigger an instant deployment.

---

### Method 2: Automated Deployment via GitHub Actions CI/CD

Tenant Reserver includes a production-ready GitHub Actions workflow in [`.github/workflows/vercel.yml`](.github/workflows/vercel.yml). Whenever you push to `main` or `master` (or open a pull request), GitHub Actions runs automated tests and deploys the build to Vercel.

#### Step 1: Generate your Vercel Token
1. Go to your [Vercel Account Settings -> Tokens](https://vercel.com/account/tokens).
2. Click **Create** and name it `GITHUB_ACTIONS_VERCEL_TOKEN`.
3. Copy the generated token string.

#### Step 2: Retrieve your Vercel Project & Org IDs
Install the Vercel CLI locally (or run via npx):
```bash
npx vercel link
```
Follow the prompts to link your local project to your Vercel project. This creates a `.vercel/project.json` file containing:
- `orgId` (Organization / Team ID)
- `projectId` (Project ID)

*(Alternatively, find these in your Vercel Project Settings under "General".)*

#### Step 3: Add Secrets to your GitHub Repository
1. In your GitHub repository, navigate to **Settings** > **Secrets and variables** > **Actions**.
2. Click **New repository secret** and add the following 3 secrets:
   - `VERCEL_TOKEN`: Your Vercel token from Step 1.
   - `VERCEL_ORG_ID`: Your `orgId` from Step 2.
   - `VERCEL_PROJECT_ID`: Your `projectId` from Step 2.

#### Step 4: Push to Deploy!
```bash
git add .
git commit -m "feat: setup vercel serverless deployment and github actions ci/cd"
git push origin main
```
GitHub Actions will run unit tests, verify syntax, pull environment configurations, build project artifacts, and deploy your live production site on Vercel.


Open your browser at:
```
http://localhost:3000
```
