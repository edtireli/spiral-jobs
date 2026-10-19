# spiral jobs

[![CI](https://github.com/edtireli/spiral-jobs/actions/workflows/ci.yml/badge.svg)](https://github.com/edtireli/spiral-jobs/actions/workflows/ci.yml)
[![version](https://img.shields.io/github/v/release/edtireli/spiral-jobs)](https://github.com/edtireli/spiral-jobs/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-white?color=111)](LICENSE)

**Your experience. Local models. Applications you can follow.**

A small macOS workspace for finding Denmark roles, preparing English documents from your actual CV, and navigating application websites with a local vision model. Watch the browser, inspect the model's decisions, and keep a recording of each attempt.

[Download for Mac](https://github.com/edtireli/spiral-jobs/releases/latest) · [Interactive demo](https://edtireli.github.io/spiral-jobs/) · [Watch the video](https://edtireli.github.io/spiral-jobs/demo.mp4)

[![Fictional, scripted walkthrough of Spiral Jobs](docs/poster.png)](https://edtireli.github.io/spiral-jobs/)

*The demonstration is a scripted simulation with fictional people and employers. It illustrates the workflow; it is not footage of an autonomous application or a model performance benchmark.*

## What it does

- **Find:** collect relevant Denmark roles from configured Greenhouse, Lever and Ashby boards when you click Find jobs, or add a listing yourself.
- **Read:** scroll through listings and retain screenshots and text beyond the first viewport.
- **Prepare:** use the CV as evidence, make small profile changes, and write a short application letter when required. Compile editable LaTeX into PDFs.
- **Navigate:** use screenshots plus observed page controls to plan clicks, fill fields, attach the right PDFs and advance through forms.
- **Review:** see live browser images, expandable model output where the chosen model emits it, action explanations, artifacts and screen recordings.
- **Submit:** use separate filling and submission approvals, or explicitly enable Auto apply and start a run. Stop is always available. Job collection alone never submits.
- **Remember:** maintain one application per employer. Record position, location, postcode, address and deadline when listed. A submission without a receipt stays **uncertain** and blocks another attempt.

Optional Gmail access looks only for verification messages relevant to the active application, in a separate signed-in browser profile. Optional tracked project links show visits privately in the app. Neither feature is required.

## Start on a Mac

The downloadable build is for **Apple Silicon, macOS 14+**. It includes Node, Chromium, Ollama and Tectonic; model weights are downloaded separately. The current release is experimental and ad-hoc signed, **not Apple notarized**. macOS may ask you to allow the app in Privacy & Security; review the source and release checksum first. Do not disable Gatekeeper system-wide.

1. Download the release ZIP, extract it, and move **Spiral Jobs.app** into Applications.
2. Open the app. In **Profile**, paste your real CV text and contact details. Optionally select your existing standalone LaTeX CV.
3. In **Settings → Get a model**, download a vision-capable Ollama model, or select models you already have. Choose a planning model and a navigation model; they can be the same.
4. Click **Find jobs**, choose a role, and prepare the application. Review documents and answers before your first live run.

The app starts its local server and Ollama when needed, discovers a free local port, and reconnects to its own workspace. Data is stored in `~/Library/Application Support/Spiral Jobs/data`. Nothing in a fresh installation is prefilled with the author's personal information.

### Bring your models

The current backend uses the **local Ollama HTTP API**. Both model roles currently require vision support, because planning also reads listing screenshots. Select any compatible local model; there is no account or cloud inference requirement. A smaller model generally uses less memory; evaluate its decisions on your target sites before enabling automatic submission.

- [Ollama model library](https://ollama.com/library)
- [Hugging Face GGUF models through Ollama](https://huggingface.co/docs/hub/en/ollama)
- An existing `OLLAMA_MODELS` directory, including an external disk, is discovered at launch. Downloaded models keep their own licenses.

There is no native MLX adapter in this release. An additional inference backend belongs behind `lib/runtime.mjs` and the model request functions in `lib/model.mjs` and `lib/navigator.mjs`; it must preserve evidence validation and observed-control checks.

## Boundaries that matter

This is a working prototype, not a promise of universal website automation. Some sites require human sign-in, consent or CAPTCHA completion. The app pauses when facts cannot be supported. It can describe transferable skills; it must not fabricate employers, qualifications, dates or experience. A model's explanation is not proof that an answer is correct.

Form filling and file uploads send personal data to the employer before the final submit button on some websites. Approve that exposure deliberately. Auto apply is an explicit opt-in and can submit applications without another prompt. Uncertain or partially exposed attempts must be checked with the employer before considering a retry.

Gmail integration is experimental: it needs a separate Google Chrome sign-in and supports verification codes from recognized application providers. Google may require manual sign-in, and Gmail UI changes can break extraction. Codes are not sent to a model or included in the action log. No mail-sending API is implemented.

## Architecture

```mermaid
flowchart LR
  Boards[Employer boards] --> Read[Listing text and screenshots]
  CV[Confirmed CV facts] --> Plan[Local planning model]
  Read --> Plan
  Plan --> Docs[LaTeX and PDFs]
  Docs --> Browser[Controlled application browser]
  Vision[Local vision model] <--> Browser
  Browser --> Evidence[Receipt or unresolved outcome]
  Browser --> Record[Video and action log]
  Evidence --> History[Local SQLite history]
```

| Component | Responsibility |
| --- | --- |
| `lib/sources.mjs` | Job board adapters and Denmark filtering |
| `lib/model.mjs`, `lib/answer-evidence.mjs` | Drafts, factual grounding and answer verification |
| `lib/navigator.mjs`, `lib/navigator.mjs` | Observations, constrained actions, live progress |
| `lib/documents.mjs`, `templates/` | Minimal CV edits, LaTeX layouts and PDF rendering |
| `lib/store.mjs`, `lib/autonomy.mjs` | Durable history, duplicate protection and automatic runs |
| `lib/mail.mjs`, `lib/email-verification.mjs` | Isolated Gmail verification and pending form handling |
| `tracking/` | Optional hosted redirect and private visit log |
| `desktop/` | Native Mac shell, local service lifecycle and release builder |

## Develop

Use Node 24+, Python 3, [Ollama](https://ollama.com/) and [Tectonic](https://tectonic-typesetting.github.io/).

```sh
npm ci
npx playwright install chromium
npm start
```

Open the local origin printed by the server. It binds only to `127.0.0.1`. The source checkout stores private data in ignored `data/`.

```sh
npm test
npm run audit:privacy
npm run demo
```

Tests exercise controlled local fixtures, approval boundaries, evidence checks, changed attachments, one-shot submission, uncertain outcomes, form navigation, scrolling state, email verification and tracking. They do not submit real applications or evaluate model accuracy across live sites. The CI badge reports the actual workflow state.

Build instructions: [desktop/BUILD.md](desktop/BUILD.md). Optional free hosted tracking: [tracking/README.md](tracking/README.md). Security and privacy: [SECURITY.md](SECURITY.md).

## Design and license

White on black, quiet typography and a moving interference field, following the visual language of [SpiralChat](https://github.com/edtireli/spiralChat). The default PDF theme echoes that style; choose Classic for a printable version.

MIT for this project. Bundled runtimes retain their original licenses and notices. Model weights are not included.
