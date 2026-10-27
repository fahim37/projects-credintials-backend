import type { CREDENTIAL_KINDS, RESOURCE_TYPES } from "../../models/Project.js";

type Kind = (typeof CREDENTIAL_KINDS)[number];
type ResourceType = (typeof RESOURCE_TYPES)[number];

export type ResourceTemplate = {
  key: string;
  label: string;
  type: ResourceType;
  group: string;
  urlPlaceholder?: string;
  hasExpiry?: boolean;
  fields: { label: string; kind: Kind }[];
};

const f = (label: string, kind: Kind = "text") => ({ label, kind });

/**
 * Presets for the "Add resource" picker. Picking one pre-fills the credential rows;
 * users can still rename, add or remove fields afterwards.
 */
export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  // Servers & hosting
  {
    key: "vps",
    label: "VPS / Server",
    type: "VPS",
    group: "Servers & Hosting",
    urlPlaceholder: "https://hpanel.hostinger.com/vps/...",
    hasExpiry: true,
    fields: [f("VPS ID"), f("IP Address"), f("SSH Port"), f("SSH Username"), f("SSH Password", "secret"), f("Root Password", "secret"), f("SSH Private Key", "multiline")],
  },
  {
    key: "cpanel",
    label: "cPanel / Shared Hosting",
    type: "Hosting",
    group: "Servers & Hosting",
    urlPlaceholder: "https://example.com:2083",
    hasExpiry: true,
    fields: [f("Username"), f("Password", "secret"), f("FTP Host"), f("FTP Username"), f("FTP Password", "secret")],
  },
  {
    key: "vercel",
    label: "Vercel",
    type: "Hosting",
    group: "Servers & Hosting",
    urlPlaceholder: "https://vercel.com/team/project",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Team"), f("Access Token", "secret")],
  },
  {
    key: "netlify",
    label: "Netlify",
    type: "Hosting",
    group: "Servers & Hosting",
    urlPlaceholder: "https://app.netlify.com/sites/...",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Site ID")],
  },
  {
    key: "aws",
    label: "AWS",
    type: "Cloud Provider",
    group: "Servers & Hosting",
    urlPlaceholder: "https://123456789012.signin.aws.amazon.com/console",
    fields: [f("Account ID"), f("IAM Username"), f("Password", "secret"), f("Access Key ID"), f("Secret Access Key", "secret"), f("Region")],
  },
  {
    key: "digitalocean",
    label: "DigitalOcean",
    type: "Cloud Provider",
    group: "Servers & Hosting",
    urlPlaceholder: "https://cloud.digitalocean.com",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Droplet IP"), f("Root Password", "secret"), f("API Token", "secret")],
  },

  // Domains & email
  {
    key: "domain",
    label: "Domain Registrar",
    type: "Domain",
    group: "Domains & Email",
    urlPlaceholder: "https://www.namecheap.com/myaccount",
    hasExpiry: true,
    fields: [f("Domain"), f("Registrar"), f("Username"), f("Password", "secret"), f("Nameservers", "multiline")],
  },
  {
    key: "cloudflare",
    label: "Cloudflare",
    type: "Domain",
    group: "Domains & Email",
    urlPlaceholder: "https://dash.cloudflare.com",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Zone ID"), f("API Token", "secret")],
  },
  {
    key: "smtp",
    label: "SMTP / Email",
    type: "Email",
    group: "Domains & Email",
    fields: [f("SMTP Host"), f("SMTP Port"), f("Username", "email"), f("Password", "secret"), f("From Address", "email")],
  },

  // Data & storage
  {
    key: "mongodb",
    label: "MongoDB",
    type: "Database",
    group: "Data & Storage",
    urlPlaceholder: "https://cloud.mongodb.com",
    fields: [f("Connection String", "secret"), f("Database Name"), f("Username"), f("Password", "secret")],
  },
  {
    key: "sql",
    label: "MySQL / PostgreSQL",
    type: "Database",
    group: "Data & Storage",
    fields: [f("Host"), f("Port"), f("Database Name"), f("Username"), f("Password", "secret"), f("Connection String", "secret")],
  },
  {
    key: "firebase",
    label: "Firebase",
    type: "API",
    group: "Data & Storage",
    urlPlaceholder: "https://console.firebase.google.com/project/...",
    fields: [f("Project ID"), f("API Key", "secret"), f("Auth Domain"), f("Service Account JSON", "multiline")],
  },
  {
    key: "cloudinary",
    label: "Cloudinary",
    type: "Cloud Storage",
    group: "Data & Storage",
    urlPlaceholder: "https://console.cloudinary.com",
    fields: [f("Cloud Name"), f("API Key"), f("API Secret", "secret")],
  },
  {
    key: "s3",
    label: "S3 Bucket",
    type: "Cloud Storage",
    group: "Data & Storage",
    fields: [f("Bucket Name"), f("Region"), f("Access Key ID"), f("Secret Access Key", "secret")],
  },

  // Apps & stores
  {
    key: "app-store",
    label: "Apple App Store",
    type: "App Store",
    group: "App Stores",
    urlPlaceholder: "https://appstoreconnect.apple.com",
    hasExpiry: true,
    fields: [f("Apple ID", "email"), f("Password", "secret"), f("Team ID"), f("Bundle ID"), f("2FA Phone / Device")],
  },
  {
    key: "play-store",
    label: "Google Play Console",
    type: "Play Store",
    group: "App Stores",
    urlPlaceholder: "https://play.google.com/console",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Package Name"), f("Keystore Password", "secret"), f("Key Alias")],
  },

  // Code & design
  {
    key: "github",
    label: "GitHub / GitLab",
    type: "Repository",
    group: "Code & Design",
    urlPlaceholder: "https://github.com/org/repo",
    fields: [f("Username"), f("Password", "secret"), f("Access Token", "secret"), f("Deploy Key", "multiline")],
  },
  {
    key: "figma",
    label: "Figma",
    type: "Design",
    group: "Code & Design",
    urlPlaceholder: "https://www.figma.com/design/...",
    fields: [f("Account Email", "email"), f("Password", "secret")],
  },

  // Payments & APIs
  {
    key: "stripe",
    label: "Stripe",
    type: "Payment",
    group: "Payments & APIs",
    urlPlaceholder: "https://dashboard.stripe.com",
    fields: [f("Account Email", "email"), f("Password", "secret"), f("Publishable Key"), f("Secret Key", "secret"), f("Webhook Secret", "secret")],
  },
  {
    key: "api",
    label: "Third-party API",
    type: "API",
    group: "Payments & APIs",
    fields: [f("API Key", "secret"), f("API Secret", "secret"), f("Base URL", "url")],
  },

  // Generic
  {
    key: "website-admin",
    label: "Website Admin Login",
    type: "Website",
    group: "General",
    urlPlaceholder: "https://example.com/admin",
    fields: [f("Username"), f("Password", "secret")],
  },
  {
    key: "env",
    label: ".env / Environment Variables",
    type: "Other",
    group: "General",
    fields: [],
  },
  {
    key: "custom",
    label: "Custom",
    type: "Other",
    group: "General",
    fields: [f("ID"), f("Password", "secret")],
  },
];
