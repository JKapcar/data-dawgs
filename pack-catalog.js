/* Public research only. Historical versions are deliberate; never infer current availability. */
(function(root){const catalog={
  "schemaVersion": 1,
  "asOf": "2026-10-17",
  "note": "Small historical starter catalog. Current frontier versions, prices, local tools and Pack task performance are unverified. No Pack tests have run.",
  "profiles": [
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
        "execution": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "gpt"
      ],
      "price": null,
      "packTestDate": null
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
        "execution": "unknown"
      },
      "advertised": [
        "coding"
      ],
      "claimIds": [
        "claude"
      ],
      "price": null,
      "packTestDate": null
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
        "execution": "unknown"
      },
      "advertised": [
        "coding",
        "vision"
      ],
      "claimIds": [
        "gemini"
      ],
      "price": null,
      "packTestDate": null
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
        "execution": "unknown"
      },
      "advertised": [
        "transcription"
      ],
      "claimIds": [
        "audio"
      ],
      "price": null,
      "packTestDate": null
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
        "execution": "unknown"
      },
      "advertised": [
        "image"
      ],
      "claimIds": [
        "image"
      ],
      "price": null,
      "packTestDate": null
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
      "caveats": "Historical release, not current availability, pricing or a cross-provider ranking."
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
      "caveats": "Historical May 2025 system card. Results depend on harness and test-time configuration."
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
      "caveats": "Experimental historical version; launch claims do not verify a current deployment."
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
      "caveats": "No Pack audio tests; accents, noise and domain vocabulary need task-specific evaluation. Page later updated August 28, 2025."
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
      "caveats": "The page now points to a newer image experience. Do not transfer these claims to another version."
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
      "caveats": "Conditional same-wrong-answer agreement is not current pairwise Pearson correlation. Suites and metrics differ."
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
      "caveats": "Different brands do not establish independence; this is not a Pack reviewer-repair experiment."
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
      "caveats": "Not evidence of builder/reviewer complementarity or current prices."
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
      "caveats": "Self-enhancement experiment was inconclusive. Human preference and deterministic correctness are different outcomes."
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
      "caveats": "Not a general proof debate fails. This is v1; a later version exists and has not been reconciled here."
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
      "caveats": "A weak diverse reviewer may help less than a strong correlated reviewer. This is an untested selection policy, not a measured result."
    }
  ],
  "runs": [],
  "pairedOutcomes": [],
  "reviewedRevisions": []
};
if(typeof module==='object')module.exports=catalog;else root.PackCatalog=catalog;
})(globalThis);
