/* Public sources only. Provider-listed does not mean locally tested. */
(function(root){const catalog={
  "schemaVersion": 1,
  "asOf": "2026-10-17",
  "note": "Seven provider-listed entries checked 2026-10-17, plus five historical profiles. Not exhaustive or ranked. Account access, exact deployed snapshots, prices, tools and Pack task performance remain unverified.",
  "profiles": [
    {
      "id": "gpt6astra",
      "provider": "OpenAI",
      "family": "GPT",
      "version": "GPT-6 Astra",
      "apiId": "gpt-6-astra",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Code & reasoning",
      "harness": "Responses API; optional Codex harness, exact build unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "coding",
        "vision"
      ],
      "claimIds": [
        "gpt6astra-capability",
        "codex-harness-claim"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "gpt61sol",
      "provider": "OpenAI",
      "family": "GPT",
      "version": "GPT-6.1 Sol",
      "apiId": "gpt-6.1-sol",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Code & reasoning",
      "harness": "Responses API; optional Codex harness, exact build unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "coding",
        "vision"
      ],
      "claimIds": [
        "gpt61sol-capability",
        "codex-harness-claim"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "opus55",
      "provider": "Anthropic",
      "family": "Claude",
      "version": "Claude Opus 5.5",
      "apiId": null,
      "identityNote": "Product identity confirmed; API identifier not verified.",
      "versionStatus": "provider-listed",
      "category": "Code & knowledge work",
      "harness": "Claude Code / Claude Platform; exact build and configuration unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "opus55-capability",
        "claude-code-harness-claim"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "sonnet55",
      "provider": "Anthropic",
      "family": "Claude",
      "version": "Claude Sonnet 5.5",
      "apiId": "claude-sonnet-5-5",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Code & tool use",
      "harness": "Claude Code / Claude Platform; exact build and configuration unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "sonnet55-capability",
        "claude-code-harness-claim"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "argon4",
      "provider": "Google",
      "family": "Gemini",
      "version": "Gemini 4 Argon",
      "apiId": "gemini-4-argon",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Multimodal reasoning",
      "harness": "Gemini API / Google AI Studio; exact build and tools unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "coding",
        "vision"
      ],
      "claimIds": [
        "argon4-capability"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "sunburst25",
      "provider": "OpenAI",
      "family": "GPT image",
      "version": "GPT-Image-2.5 Sunburst",
      "apiId": "gpt-image-2.5-sunburst",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Image generation",
      "harness": "Image API / Responses image tool; exact setup unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "image"
      ],
      "claimIds": [
        "sunburst25-capability"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "live1",
      "provider": "OpenAI",
      "family": "GPT voice",
      "version": "GPT-Live 1",
      "apiId": "gpt-live-1",
      "identityNote": "Official API alias; not a pinned deployment snapshot.",
      "versionStatus": "provider-listed",
      "category": "Live voice",
      "harness": "Live API with separately configured backend agent; unverified setup",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "voice": "unknown",
        "browser": "unknown",
        "execution": "unknown"
      },
      "advertised": [
        "voice"
      ],
      "claimIds": [
        "live1-capability"
      ],
      "price": null,
      "packTestDate": null
    },
    {
      "id": "gpt41",
      "provider": "OpenAI",
      "family": "GPT",
      "version": "GPT-4.1",
      "versionStatus": "historical",
      "category": "Code & instructions",
      "harness": "API; exact deployment unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "browser": "unknown",
        "execution": "unknown",
        "voice": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "gpt"
      ],
      "price": null,
      "packTestDate": null,
      "apiId": null,
      "identityNote": "Historical product label; exact deployed API snapshot unverified."
    },
    {
      "id": "claude4",
      "provider": "Anthropic",
      "family": "Claude",
      "version": "Claude Sonnet 4",
      "versionStatus": "historical",
      "category": "Code & tool use",
      "harness": "API / coding harness; configuration unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "browser": "unknown",
        "execution": "unknown",
        "voice": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "claude"
      ],
      "price": null,
      "packTestDate": null,
      "apiId": null,
      "identityNote": "Historical product label; exact deployed API snapshot unverified."
    },
    {
      "id": "gemini25",
      "provider": "Google",
      "family": "Gemini",
      "version": "Gemini 2.5 Pro Experimental",
      "versionStatus": "historical",
      "category": "Multimodal reasoning",
      "harness": "Launch-era Gemini / AI Studio; current access unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "browser": "unknown",
        "execution": "unknown",
        "voice": "unknown"
      },
      "advertised": [
        "coding",
        "vision"
      ],
      "claimIds": [
        "gemini"
      ],
      "price": null,
      "packTestDate": null,
      "apiId": null,
      "identityNote": "Historical product label; exact deployed API snapshot unverified."
    },
    {
      "id": "transcribe",
      "provider": "OpenAI",
      "family": "GPT audio",
      "version": "gpt-4o-transcribe",
      "versionStatus": "historical",
      "category": "Speech to text",
      "harness": "Audio API; current endpoint unverified",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "browser": "unknown",
        "execution": "unknown",
        "voice": "unknown"
      },
      "advertised": [
        "transcription"
      ],
      "claimIds": [
        "audio"
      ],
      "price": null,
      "packTestDate": null,
      "apiId": null,
      "identityNote": "Historical product label; exact deployed API snapshot unverified."
    },
    {
      "id": "image4o",
      "provider": "OpenAI",
      "family": "GPT image",
      "version": "GPT-4o image generation",
      "versionStatus": "version-changed",
      "category": "Image generation",
      "harness": "Launch-era ChatGPT image experience; version changed",
      "persona": "None assigned; roles are instructions, not models",
      "toolsTested": [],
      "capabilities": {
        "coding": "unknown",
        "vision": "unknown",
        "transcription": "unknown",
        "image": "unknown",
        "browser": "unknown",
        "execution": "unknown",
        "voice": "unknown"
      },
      "advertised": [
        "image"
      ],
      "claimIds": [
        "image"
      ],
      "price": null,
      "packTestDate": null,
      "apiId": null,
      "identityNote": "Historical product label; exact deployed API snapshot unverified."
    }
  ],
  "claims": [
    {
      "id": "gpt",
      "profileId": "gpt41",
      "text": "OpenAI reports coding and instruction-following improvements for GPT-4.1.",
      "evidenceIds": [
        "gpt"
      ],
      "kind": "research"
    },
    {
      "id": "claude",
      "profileId": "claude4",
      "text": "Anthropic evaluates coding and tool-use tasks under specified configurations.",
      "evidenceIds": [
        "claude"
      ],
      "kind": "research"
    },
    {
      "id": "gemini",
      "profileId": "gemini25",
      "text": "Google describes reasoning, coding and multimodal input capabilities.",
      "evidenceIds": [
        "gemini"
      ],
      "kind": "research"
    },
    {
      "id": "audio",
      "profileId": "transcribe",
      "text": "OpenAI introduces a dedicated speech-to-text model.",
      "evidenceIds": [
        "audio"
      ],
      "kind": "research"
    },
    {
      "id": "image",
      "profileId": "image4o",
      "text": "OpenAI describes image generation and iterative editing; lists limitations including precise graphing.",
      "evidenceIds": [
        "image"
      ],
      "kind": "research"
    },
    {
      "id": "errors",
      "profileId": null,
      "text": "The study finds shared errors, including across providers.",
      "evidenceIds": [
        "errors"
      ],
      "kind": "research"
    },
    {
      "id": "oversight",
      "profileId": null,
      "text": "Judges favor models similar to themselves in the studied evaluations.",
      "evidenceIds": [
        "oversight"
      ],
      "kind": "research"
    },
    {
      "id": "routing",
      "profileId": null,
      "text": "Routing can trade response quality against cost on the evaluated tasks.",
      "evidenceIds": [
        "routing"
      ],
      "kind": "research"
    },
    {
      "id": "judge",
      "profileId": null,
      "text": "Position and verbosity can affect judging; swap positions and use reference answers where appropriate.",
      "evidenceIds": [
        "judge"
      ],
      "kind": "research"
    },
    {
      "id": "debate",
      "profileId": null,
      "text": "Much of the studied debate gain is attributable to voting.",
      "evidenceIds": [
        "debate"
      ],
      "kind": "research"
    },
    {
      "id": "policy",
      "profileId": null,
      "text": "Prefer reliable residual-failure reduction within budget, rather than minimum correlation alone.",
      "evidenceIds": [
        "policy"
      ],
      "kind": "use-case"
    },
    {
      "id": "gpt6astra-capability",
      "profileId": "gpt6astra",
      "text": "OpenAI documents GPT-6 Astra for complex reasoning and coding.",
      "evidenceIds": [
        "gpt6astra-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "gpt61sol-capability",
      "profileId": "gpt61sol",
      "text": "OpenAI lists GPT-6.1 Sol for complex work with a cost/quality trade-off.",
      "evidenceIds": [
        "gpt61sol-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "opus55-capability",
      "profileId": "opus55",
      "text": "Anthropic reports agentic coding and knowledge-work capability for Opus 5.5.",
      "evidenceIds": [
        "opus55-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "sonnet55-capability",
      "profileId": "sonnet55",
      "text": "Anthropic lists Sonnet 5.5 for coding and tool-based work.",
      "evidenceIds": [
        "sonnet55-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "argon4-capability",
      "profileId": "argon4",
      "text": "Google documents complex software engineering and text, image, video, audio and PDF inputs with text output.",
      "evidenceIds": [
        "argon4-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "sunburst25-capability",
      "profileId": "sunburst25",
      "text": "OpenAI documents image generation and editing from text and image inputs.",
      "evidenceIds": [
        "sunburst25-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "live1-capability",
      "profileId": "live1",
      "text": "OpenAI documents simultaneous listening and speaking with reasoning and tool use delegated to a backend agent.",
      "evidenceIds": [
        "live1-source"
      ],
      "kind": "use-case"
    },
    {
      "id": "codex-harness-claim",
      "profileId": null,
      "text": "OpenAI describes Codex CLI as a local coding agent, with separate IDE, desktop and cloud experiences.",
      "evidenceIds": [
        "codex-harness"
      ],
      "kind": "use-case"
    },
    {
      "id": "claude-code-harness-claim",
      "profileId": null,
      "text": "Anthropic documents Claude Code as a coding harness that reads files, edits code and runs commands.",
      "evidenceIds": [
        "claude-code-harness"
      ],
      "kind": "use-case"
    }
  ],
  "evidence": [
    {
      "id": "gpt",
      "title": "GPT-4.1 launch",
      "url": "https://openai.com/index/gpt-4-1/",
      "type": "vendor claim",
      "sourceDate": "2025-04-14",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "GPT-4.1 API launch; vendor coding and instruction-following evaluations.",
      "claim": "OpenAI reports coding and instruction-following improvements for GPT-4.1.",
      "caveats": "Historical release, not current availability, pricing or a cross-provider ranking.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "claude",
      "title": "Claude 4 system card",
      "url": "https://www-cdn.anthropic.com/07b2a3f9902ee19fe39a36ca638e5ae987bc64dd.pdf",
      "type": "vendor claim",
      "sourceDate": "2025-05-22",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Claude Opus 4 and Sonnet 4; provider evaluations and configurations.",
      "claim": "Anthropic evaluates coding and tool-use tasks under specified configurations.",
      "caveats": "Historical May 2025 system card. Results depend on harness and test-time configuration.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "gemini",
      "title": "Gemini 2.5 launch",
      "url": "https://blog.google/innovation-and-ai/models-and-research/google-deepmind/gemini-model-thinking-updates-march-2025/",
      "type": "vendor claim",
      "sourceDate": "2025-03-25",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Gemini 2.5 Pro Experimental launch announcement.",
      "claim": "Google describes reasoning, coding and multimodal input capabilities.",
      "caveats": "Experimental historical version; launch claims do not verify a current deployment.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "audio",
      "title": "Next-generation audio models",
      "url": "https://openai.com/index/introducing-our-next-generation-audio-models/",
      "type": "vendor claim",
      "sourceDate": "2025-03-20",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "gpt-4o-transcribe launch; speech-to-text.",
      "claim": "OpenAI introduces a dedicated speech-to-text model.",
      "caveats": "No Pack audio tests; accents, noise and domain vocabulary need task-specific evaluation. Page later updated August 28, 2025.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "image",
      "title": "4o image generation",
      "url": "https://openai.com/index/introducing-4o-image-generation/",
      "type": "vendor claim",
      "sourceDate": "2025-03-25",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "version-changed",
      "scope": "GPT-4o image generation in the launch-era ChatGPT experience.",
      "claim": "OpenAI describes image generation and iterative editing; lists limitations including precise graphing.",
      "caveats": "The page now points to a newer image experience. Do not transfer these claims to another version.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "errors",
      "title": "Correlated Errors in Large Language Models",
      "url": "https://arxiv.org/html/2506.07962v1",
      "type": "independent benchmark",
      "sourceDate": "2025-06-09",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Historical HuggingFace/HELM multiple-choice responses and resume-job evaluation.",
      "claim": "The study finds shared errors, including across providers.",
      "caveats": "Conditional same-wrong-answer agreement is not current pairwise Pearson correlation. Suites and metrics differ.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "oversight",
      "title": "Great Models Think Alike",
      "url": "https://arxiv.org/html/2502.04313v2",
      "type": "independent benchmark",
      "sourceDate": "2025-06-12",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "CAPA model similarity, judge affinity and weak-to-strong supervision.",
      "claim": "Judges favor models similar to themselves in the studied evaluations.",
      "caveats": "Different brands do not establish independence; this is not a Pack reviewer-repair experiment.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "routing",
      "title": "RouteLLM",
      "url": "https://arxiv.org/html/2406.18665v4",
      "type": "independent benchmark",
      "sourceDate": "2025-02-23",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Learned routing with preference data; studied cost/quality trade-offs.",
      "claim": "Routing can trade response quality against cost on the evaluated tasks.",
      "caveats": "Not evidence of builder/reviewer complementarity or current prices.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "judge",
      "title": "Judging LLM-as-a-Judge",
      "url": "https://arxiv.org/html/2306.05685v4",
      "type": "independent benchmark",
      "sourceDate": "2023-12-24",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "MT-Bench and Chatbot Arena; historical judge-bias experiments.",
      "claim": "Position and verbosity can affect judging; swap positions and use reference answers where appropriate.",
      "caveats": "Self-enhancement experiment was inconclusive. Human preference and deterministic correctness are different outcomes.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "debate",
      "title": "Debate or Vote",
      "url": "https://arxiv.org/html/2508.17536v1",
      "type": "independent benchmark",
      "sourceDate": "2025-08-24",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "stale",
      "scope": "Seven NLP benchmarks; voting versus inter-agent debate.",
      "claim": "Much of the studied debate gain is attributable to voting.",
      "caveats": "Not a general proof debate fails. This is v1; a later version exists and has not been reconciled here.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "policy",
      "title": "Pack selection principle",
      "url": "https://arxiv.org/html/2502.04313v2",
      "type": "editorial inference",
      "sourceDate": "2026-10-17",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Proposed task-specific reviewer selection, informed by oversight research.",
      "claim": "Prefer reliable residual-failure reduction within budget, rather than minimum correlation alone.",
      "caveats": "A weak diverse reviewer may help less than a strong correlated reviewer. This is an untested selection policy, not a measured result.",
      "sourceDateNote": "Publication or cited version date."
    },
    {
      "id": "gpt6astra-source",
      "title": "GPT-6 Astra official source",
      "url": "https://developers.openai.com/api/docs/models/gpt-6-astra",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; check date is not a release or test date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "GPT-6 Astra provider documentation only; no local execution.",
      "claim": "OpenAI documents GPT-6 Astra for complex reasoning and coding.",
      "caveats": "API model alias; exact dated deployment and account access are unverified."
    },
    {
      "id": "gpt61sol-source",
      "title": "GPT-6.1 Sol official source",
      "url": "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; check date is not a release or test date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "GPT-6.1 Sol provider documentation only; no local execution.",
      "claim": "OpenAI lists GPT-6.1 Sol for complex work with a cost/quality trade-off.",
      "caveats": "Provider positioning, not a Pack comparison. No cost advantage is measured here."
    },
    {
      "id": "opus55-source",
      "title": "Claude Opus 5.5 official source",
      "url": "https://www.anthropic.com/claude-opus-5-5",
      "type": "vendor claim",
      "sourceDate": "2026-09-22",
      "sourceDateNote": "Publication date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Claude Opus 5.5 provider documentation only; no local execution.",
      "claim": "Anthropic reports agentic coding and knowledge-work capability for Opus 5.5.",
      "caveats": "Product identity verified; exact API identifier not verified here. Benchmark configuration and safeguard fallbacks matter."
    },
    {
      "id": "sonnet55-source",
      "title": "Claude Sonnet 5.5 official source",
      "url": "https://www.anthropic.com/claude-sonnet-5-5",
      "type": "vendor claim",
      "sourceDate": "2026-09-28",
      "sourceDateNote": "Publication date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Claude Sonnet 5.5 provider documentation only; no local execution.",
      "claim": "Anthropic lists Sonnet 5.5 for coding and tool-based work.",
      "caveats": "Effort defaults differ between Claude Code and the platform; higher effort is not uniformly better. No Pack comparison."
    },
    {
      "id": "argon4-source",
      "title": "Gemini 4 Argon official source",
      "url": "https://ai.google.dev/gemini-api/docs/models/gemini-4-argon",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; check date is not a release or test date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "Gemini 4 Argon provider documentation only; no local execution.",
      "claim": "Google documents complex software engineering and text, image, video, audio and PDF inputs with text output.",
      "caveats": "Audio generation is not supported. Endpoint documentation does not verify account access or performance on this task."
    },
    {
      "id": "sunburst25-source",
      "title": "GPT-Image-2.5 Sunburst official source",
      "url": "https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; check date is not a release or test date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "GPT-Image-2.5 Sunburst provider documentation only; no local execution.",
      "claim": "OpenAI documents image generation and editing from text and image inputs.",
      "caveats": "Quality settings and API integration affect behavior. Editing accuracy has not been tested by the Pack."
    },
    {
      "id": "live1-source",
      "title": "GPT-Live 1 official source",
      "url": "https://developers.openai.com/api/docs/models/gpt-live-1",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; check date is not a release or test date.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "GPT-Live 1 provider documentation only; no local execution.",
      "claim": "OpenAI documents simultaneous listening and speaking with reasoning and tool use delegated to a backend agent.",
      "caveats": "Voice model and backend reasoning model are different components. No Pack latency, interruption or accuracy tests."
    },
    {
      "id": "codex-harness",
      "title": "Codex CLI official repository",
      "url": "https://github.com/openai/codex",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; exact installed version not inspected.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "App/harness capability; not an underlying model identity or local permission check.",
      "claim": "OpenAI describes Codex CLI as a local coding agent, with separate IDE, desktop and cloud experiences.",
      "caveats": "No harness version, tool access or account permission was tested. Product documentation is not a Pack run."
    },
    {
      "id": "claude-code-harness",
      "title": "Claude Code overview",
      "url": "https://code.claude.com/docs/en/overview",
      "type": "vendor claim",
      "sourceDate": null,
      "sourceDateNote": "Undated living documentation; exact installed version not inspected.",
      "checkedAt": "2026-10-17",
      "testDate": null,
      "status": "verified",
      "scope": "App/harness capability; not an underlying model identity or local permission check.",
      "claim": "Anthropic documents Claude Code as a coding harness that reads files, edits code and runs commands.",
      "caveats": "No harness version, tool access or account permission was tested. Product documentation is not a Pack run."
    }
  ],
  "runs": [],
  "pairedOutcomes": [],
  "reviewedRevisions": []
};
if(typeof module==='object')module.exports=catalog;else root.PackCatalog=catalog;
})(globalThis);
