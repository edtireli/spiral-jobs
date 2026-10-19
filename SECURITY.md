# Security and privacy

No system is bulletproof. This app limits what its components can reach and records what actually happened.

## Local workspace

The dashboard binds to loopback, checks Host and Origin, requires a per-process CSRF token for mutations, and applies a restrictive content security policy. Do not forward its port or place it behind a public tunnel. Your Mac needs no inbound ports for optional link analytics.

The local workspace contains your CV, answers, browser recordings, documents and application history. Recordings can include sensitive information from employer pages. Protect your macOS account and disk, and share recordings only after reviewing them. The release builder uses an explicit source allowlist and an empty default profile.

Local inference does not make the entire workflow offline: collecting jobs, visiting websites, submitting applications, signing into Gmail, downloading models and the optional tracker use the internet. Employer websites and email are untrusted input. Models may still make mistakes; validation reduces risk but cannot guarantee factual or navigational accuracy.

Approval is tied to the documents and form revision. A changed attachment invalidates approval. History reserves an attempt before candidate information is exposed. After a final click, absent a receipt, the result stays uncertain. Restarting does not replay an application. Enabling Auto apply is an explicit decision to let the workflow submit without separate per-step approval.

## Gmail

Gmail uses its own persistent browser profile, separate from employer pages. The application does not implement sending, deletion or a general inbox reader. Searches are scoped to the current application's company, recipient, provider and recent start time. Sender, date and code ambiguity checks must pass. A code is filled directly in the observed verification form; it is never a model input. Gmail's UI is not a stable API, so extraction can fail and require manual completion.

The saved Google session grants browser access to that account. Disconnect disables this app's email checks and closes its window but does not revoke Google's saved session; sign out in the dedicated window to revoke that session. Application browser video does not record the Gmail window, and code inputs are visually masked before entry.

## Hosted links

The optional Cloudflare Worker only redirects registered random IDs to one configured GitHub destination. It has no connection to the local dashboard, filesystem, Ollama or Gmail. It cannot proxy arbitrary URLs. Admin requests require a random secret, stored locally and as a Worker secret, never in the public repo or link.

Clicks record time, IP address and a bounded user-agent for up to 30 days; no cookies. The employer-to-token mapping remains on your Mac. The PDF footer identifies tracked links as visit analytics, and the service exposes `/privacy`. Do not use visit logs as proof of a named person's activity: security scanners, proxies and forwarded links also create visits. Check applicable privacy obligations before enabling analytics.

Worker quotas and attacks can affect availability. Logging failures do not turn the redirect into a Mac connection. A Worker may temporarily omit visits because of quotas, eventual consistency or delivery failures. Keep credentials private and rotate the Worker secret if exposed.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Do not post private CVs, browser sessions, access keys or application recordings in public issues.
