# Omada NOC Dashboard & MCP Bridge

A containerized, full-stack network observability and management platform that interfaces with a live, **physical TP-Link Omada SDN Hardware Controller appliance** (`192.168.100.2`) and exposes real-time network state directly to Large Language Models (LLMs) via the **Model Context Protocol (MCP)**.

Built with **Next.js 16 (App Router)**, **React 19**, **Tailwind CSS v4**, **PostgreSQL**, **TypeScript 5**, **@modelcontextprotocol/sdk**, and containerized using **Podman** / **Docker**.

---

## 🔑 Default Initial Credentials (Generic)

Upon initial database startup, the PostgreSQL persistence layer automatically boots and seeds the root administrator account:

| Field | Default Value | Description |
| :--- | :--- | :--- |
| **Email** | `admin@omadanoc.com` | Primary administrator login |
| **Username** | `admin` | Administrator username |
| **Default Password** | `AdminPass123!` | Initial password (change upon first login) |
| **Role** | `ADMIN` | Superuser privileges (User Management & Audits) |

---

## 🌐 Architecture & Topology

- **Physical Network Device:** Physical TP-Link Omada SDN Hardware Controller Appliance on LAN at `192.168.100.2` managing 14 physical devices (9 EAP Access Points, 4 JetStream Switches, 1 Multi-WAN Gateway, and 70+ client devices).
- **Application Platform:** `noc_dash` full-stack Next.js 16 / React 19 web application & 5-Tool MCP stdio server bridge.
- **Database Layer:** PostgreSQL instance managing `users`, `user_profiles`, `user_device_tags`, and `user_logins`.
- **Production Runtime:** Containerized in **Podman** / **Docker** (rootless container runtime) communicating over the network with the physical hardware controller.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Next.js UI / Profile Widget
    participant Auth as Auth & RBAC Engine (lib/auth)
    participant DB as PostgreSQL Database
    participant API as Telemetry API / MCP Bridge
    participant Omada as Physical Omada Controller (192.168.100.2)

    Note over UI,DB: Phase 1: Authentication & Inactivity Tracking
    UI->>Auth: POST /api/auth/login (admin@omadanoc.com)
    Auth->>DB: Verify bcrypt password & log attempt to `user_logins`
    DB-->>Auth: User record & Role (ADMIN / USER)
    Auth-->>UI: HTTP-Only Secure JWT Cookie (15-min inactivity window)

    Note over UI,Omada: Phase 2: Scoped Telemetry & Device Tagging
    UI->>API: GET /api/telemetry (with session cookie)
    API->>DB: Query user's assigned MAC tags (`user_device_tags`)
    DB-->>API: List of tagged MACs (or empty)
    API->>Omada: GET /{omadacId}/api/v2/sites/{siteId}/clients?filters.active=true
    Omada-->>API: 70+ Active client devices telemetry payload
    API-->>UI: Filtered telemetry (Tagged devices only; or full view if untagged/admin)
```

---

## 🌟 Key Capabilities

1. **Production-Grade Authentication & Authorization (RBAC):**
   - Pure-TypeScript PostgreSQL persistence layer (`users`, `user_profiles`, `user_device_tags`, `user_logins`, `ai_insights_history`) with In-Memory dev fallback.
   - Salted password hashing via `bcryptjs` (10 rounds) and signed, tamper-proof JWT sessions (`jose` HMAC-SHA256 JWS).
   - **Multi-Tier Route Protection:** Next.js 16 Edge Proxy (`proxy.ts`), SSR Server Component guards, and API authorization checks.
   - **15-Minute Inactivity Timeout:** Automated client-side interaction monitoring and server-side token expiry.

2. **User Management & Multi-Tenant Device Tagging:**
   - **Admin User Directory (`/admin/users`):** Create accounts, assign `ADMIN` or `USER` roles, reset passwords, and remove users.
   - **Device Tagging Matrix:** Attach discovered physical hardware devices (by MAC address) to specific user accounts.
   - **Dynamic Telemetry Scoping:** Users with tagged devices only see their hardware and recalculated KPIs. Untagged users and administrators enjoy full global network visibility.
   - **Paginated Login Audits:** 10 records per page tracking all login attempts, IP addresses, user-agents, and authentication outcomes.

3. **Executive PDF Reporting Engine (jsPDF):**
   - **Comprehensive Data Aggregation (`GET /api/reports/summary`):** Live telemetry aggregation including Top 5 active devices (throughput rate in Mbps), Top 5 heavy consumers (cumulative session volume in MB/GB), Top 5 active system operators, and 4-tier RF signal distribution.
   - **1-Click Vector PDF Export:** High-resolution vector PDF generated on-the-fly with zero headless browser bloat, formatted with dark/light NOC styling, structured KPI cards, and cryptographic verification metadata.
   - **Executive Reports Modal (`ReportsModal.tsx`):** Interactive modal on the dashboard for exploring real-time telemetry breakdowns and triggering PDF export.

4. **Iterative AI Insights Engine (Continuous Memory & Learning):**
   - **Stateful Diagnostic Memory (`ai_insights_history`):** Persistent audit storage enabling the AI to learn system trajectory and track state across successive runs.
   - **Comparative Trend Tracking:** Automatically compares live telemetry against prior baseline audits to classify trajectory as `INITIAL` baseline, `IMPROVED` (+delta%), `DEGRADED` (-delta%), or `STABLE` ($\pm 2\%$).
   - **Persisting & Resolved Issue Tracking:** Monitors chronic network issues across audit cycles and flags newly resolved hardware/RF anomalies.
   - **Admin AI Insights Drawer (`AiInsightsDrawer.tsx`):** Slide-over diagnostic console featuring historical health score sparkline trajectories, categorized issue tabs, and on-demand audit execution.

5. **6-Tool Model Context Protocol (MCP) Server Bridge & AI Copilot:**
   - Implements `@modelcontextprotocol/sdk` to expose 6 specialized tools (`get_network_status`, `get_active_clients`, `get_network_devices`, `get_client_detail`, `audit_network_health`, `get_audit_history`) to LLM clients (e.g., Claude Desktop, MCP Inspector, custom agents).
   - Interactive terminal AI Copilot (`npm run mcp:copilot`) for natural-language network diagnosis and optimization advice.
   - Automated question-answering agent runner (`npm run mcp:agent`) demonstrating multi-scenario JSON-RPC tool selection.

6. **Real-Time Network Telemetry Dashboard:**
   - Visualizes live connected clients (70+ devices), wired vs. Wi-Fi distribution, instantaneous aggregate bandwidth throughput, and session download/upload volume.
   - Interactive client telemetry table with selectable auto-polling intervals (5s Live, 10s, 30s, or Paused) and manual on-demand refresh.
   - Real-time client filtering (Medium: All / Wi-Fi / Ethernet, search across device name, IP, MAC, SSID) and multi-attribute sorting.

7. **Container Orchestration with Podman & Docker:**
   - Multi-stage rootless `Containerfile` and multi-service `compose.yaml` (PostgreSQL + Next.js Standalone).
   - Declarative Kubernetes deployment manifests and Kustomize declarations (`k8s/`).

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js 20+**
- **npm 10+**
- **Podman** (or Docker)
- **PostgreSQL 15+** (or running via Docker Compose)
- LAN access to the physical TP-Link Omada Hardware Controller (`192.168.100.2`)

### 2. Environment Configuration
The `.env.local` file contains the credentials for the physical controller and PostgreSQL database:

```ini
OMADA_URL=192.168.100.2
OMADA_USER=your_email@example.com
OMADA_PASS=your_controller_password
OMADA_SITE=Default
OMADA_ALLOW_INSECURE_SSL=true

# Database & Authentication Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/noc_dash
JWT_SECRET=your-super-secure-jwt-secret-key-min-32-characters
DEFAULT_ADMIN_EMAIL=admin@omadanoc.com
DEFAULT_ADMIN_PASSWORD=AdminPass123!
```

### 3. Local Development

```bash
# Install dependencies
npm install

# Start Next.js development server
npm run dev
```

> **Note on Local Storage:** When running `npm run dev` locally without a running PostgreSQL instance, the app automatically activates the **In-Memory Store Fallback** seeded with `admin@omadanoc.com` / `AdminPass123!`. When deployed in Docker/Podman compose, it seamlessly connects to the persistent PostgreSQL service.

Open [http://localhost:3000](http://localhost:3000) in your browser and sign in with `admin@omadanoc.com` / `AdminPass123!`.

### 4. Podman Without Compose

`scripts/podman-up.sh` runs Postgres and the dashboard in one rootless pod, reading `.env.local` (see `.env.dist` for every variable, including the required `JWT_SECRET`):

```bash
cp .env.dist .env.local   # then fill it in
scripts/podman-up.sh      # --build to rebuild the image, --down to stop
```

It binds to `127.0.0.1:3000` by default; set `BIND_ADDR=0.0.0.0` for LAN access.

---

## 🛡️ Role-Based Access Control (RBAC) Matrix

| Feature | `ADMIN` Role | `USER` Role (With Tagged Devices) | `USER` Role (No Tagged Devices) |
| :--- | :---: | :---: | :---: |
| **Telemetry Dashboard** | Global (All 70+ Devices) | Scoped strictly to tagged MACs | Global (Sees everything per policy) |
| **KPI Aggregate Cards** | Global Throughput & Volume | Recalculated for tagged devices only | Global Throughput & Volume |
| **Executive Reports & PDF** | ✅ Full Access | ✅ Scoped / Global Summary | ✅ Scoped / Global Summary |
| **Iterative AI Insights Drawer** | ✅ Full Access (Run & View) | ❌ Forbidden (403) | ❌ Forbidden (403) |
| **Profile Widget & Edit** | ✅ Full Access | ✅ Full Access | ✅ Full Access |
| **User Directory (`/admin/users`)** | ✅ Full Access | ❌ Forbidden (403) | ❌ Forbidden (403) |
| **Device Tagging Matrix** | ✅ Full Access | ❌ Forbidden (403) | ❌ Forbidden (403) |
| **Login Audit Log (10/page)** | ✅ Full Access | ❌ Forbidden (403) | ❌ Forbidden (403) |

---

## 🔍 Physical Controller Diagnostics (`npm run test:controller`)

Run the standalone hardware diagnostic CLI to verify connectivity against the physical controller at `192.168.100.2`:

```bash
npm run test:controller
```

---

## 🤖 Model Context Protocol (MCP) Integration & AI Tools

The MCP server connects Large Language Models (e.g. Claude Desktop, AI agents) directly to live Omada network telemetry.

### Exposed MCP Tools (6 Core Tools)

1. **`get_network_status`**: Real-time controller connectivity, client counts, and aggregate throughput.
2. **`get_active_clients`**: Client devices with medium filtering (`wireless`/`wired`) and activity/traffic sorting.
3. **`get_network_devices`**: 14 physical infrastructure devices (9 APs, 4 Switches, 1 Gateway) with CPU/memory loads.
4. **`get_client_detail`**: Single-device RF diagnostic (RSSI dBm, signal %, RF channel, negotiated PHY rates, connected AP/port).
5. **`audit_network_health`**: Automated network health scoring (0–100), critical alerts, warnings, and optimization advice.
6. **`get_audit_history`**: Historical trajectory timeline, persisting issue trends, and comparative delta diagnostics.

### Running MCP CLIs
- **Interactive AI Copilot REPL:** `npm run mcp:copilot`
- **Automated AI Agent Demo:** `npm run mcp:agent`
- **Visual Web Inspector:** `npm run mcp:inspect`

---

## 🐳 Container Deployment with Podman & Docker

In production, the `noc_dash` dashboard and PostgreSQL persistence are managed via `compose.yaml`:

```bash
# Build and start all services (PostgreSQL + Dashboard)
docker compose up -d --build
# or with Podman:
podman compose up -d --build
```

---

## 🧪 Testing & Quality Assurance

```bash
# Run all unit and integration tests
npm test

# Run tests with V8 code coverage report (>97% coverage enforced)
npm run test:coverage

# Production build (strict type-check, lint, and test coverage before compiling)
npm run build
```

---

## 📂 Project Structure

```text
noc_dash/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx           # Login Screen with inactivity notice
│   │   └── profile/page.tsx         # User Profile & Password Management
│   ├── admin/
│   │   └── users/page.tsx           # Admin User Management & Login Audits
│   ├── api/
│   │   ├── auth/                    # Auth endpoints (login, logout, me, profile)
│   │   ├── admin/                   # Admin endpoints (users, devices, logins, insights)
│   │   ├── reports/summary/         # Executive Report aggregation endpoint
│   │   └── telemetry/route.ts       # Scoped Telemetry JSON REST API
│   ├── components/
│   │   ├── Dashboard.tsx            # Interactive Telemetry Dashboard & Header Actions
│   │   ├── ReportsModal.tsx         # Executive Reports Modal & Vector PDF Export
│   │   ├── AiInsightsDrawer.tsx     # Continuous Memory AI Insights Slide-Over
│   │   └── ProfileWidget.tsx        # Top-Right Header Profile & Logout Menu
│   ├── globals.css                  # Tailwind CSS v4 styles
│   ├── layout.tsx                   # Root layout with inactivity listener
│   └── page.tsx                     # Server Component entrypoint
├── lib/
│   ├── ai/                          # Comparative AI diagnostic engine (insights.ts)
│   ├── auth/                        # JWT sessions, bcrypt hashing, cookies
│   ├── db/                          # PostgreSQL pool, schema, CRUD queries, in-memory store
│   ├── omada/                       # Omada API client & formatters
│   └── reports/                     # Telemetry aggregation & jsPDF vector report engine
├── mcp/
│   ├── cli.ts                       # MCP stdio executable
│   └── server.ts                    # 6-Tool MCP Server bridge
├── scripts/
│   ├── build-container.sh           # Container build automation
│   ├── run-container.sh             # Container run automation
│   ├── mcp-copilot.ts               # Interactive AI Copilot terminal chat REPL
│   ├── mcp-agent.ts                 # AI Agent question-answering runner
│   └── test-controller.ts           # Standalone controller diagnostic CLI
├── k8s/                             # Kubernetes & Kustomize manifests
├── tests/                           # Unit & Integration test suites (202 tests across 27 suites)
├── docs/
│   ├── reporting.md                 # Executive Reporting & Continuous AI Memory architecture
│   ├── authentication.md            # Auth, RBAC, DB schema & scoping spec
│   ├── PRD.md                       # Product Requirements Document
│   ├── implementationPlan.md        # Timeline and development phases
│   ├── posting.md                   # Job description and qualifications
│   └── techStack.md                 # Tech stack and job alignment details
├── compose.yaml                     # Multi-service Podman / Docker Compose
├── Containerfile                    # Multi-stage container definition
└── package.json
```

---

## 💼 GlobalNOC Alignment Matrix

| Project Component | GlobalNOC Job Requirement / Preference | Justification |
| :--- | :--- | :--- |
| **Next.js 16 + React 19 + Tailwind** | *"Provides advanced research/analysis... UX/UI design/philosophy"* & *"Visualizations to help end users understand their data"* | Delivers a high-density, accessible NOC dashboard with real-time polling, dark-mode ergonomics, and sub-second filtering. |
| **PostgreSQL & AuthN/AuthZ (RBAC)** | *"Design, development, testing of software systems... IT systems security and user access control"* | Production-grade security with salted passwords, encrypted JWT cookies, multi-tenant device tagging, and paginated login audit logs. |
| **Executive Vector PDF Reporting** | *"Prepares structured documentation and reports for management and stakeholders"* | Aggregates multi-dimensional telemetry into 1-click vector PDF reports with zero headless browser bloat. |
| **Continuous AI Memory & 6-Tool MCP** | *"Experience with programmatic use of LLMs, AI, and related systems. Integration of data sources into LLMs via MCP or similar protocols."* | Stateful continuous-learning AI diagnostic loop comparing historical audit baselines to detect improving, degraded, and persisting issues over time. |
| **Podman Containerization & K8s** | *"Experience with application containerization platforms such as docker and podman"* & *"kubernetes application deployment methods such as helm or kustomize."* | Rootless multi-stage container deployment with Compose and Kustomize declarations ready for cloud-native orchestration. |
| **TypeScript Omada Engine** | *"Network measurement, monitoring, visualization."* | Reverse-engineered physical hardware controller API handshakes (two-step auth, CSRF tokens, session cookies, dynamic site resolution for `"The Farm"`), strict type modeling, and robust error recovery. |
| **Testing Suite (> 97% Coverage)** | *"Testing, configuration, and maintenance of reliable software"* | Automated testing with 202 tests across 27 test files, strict build gates, and hardware diagnostic scripts testing live appliances on the LAN. |
