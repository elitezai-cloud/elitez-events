import json
import logging
import os

logger = logging.getLogger(__name__)


class LLMConfigError(RuntimeError):
    """Raised when the LLM provider is misconfigured (e.g. missing API key).
    Callers can catch this specifically to surface an actionable 503."""


def _model_provider() -> str:
    return (os.environ.get("MODEL_PROVIDER") or "gemini").strip().lower()


def _is_non_gemini_enabled() -> bool:
    return _model_provider() in {"non_gemini", "non-gemini", "manual", "disabled", "off"}


def is_non_gemini_enabled() -> bool:
    return _is_non_gemini_enabled()


def _get_model():
    if _is_non_gemini_enabled():
        return None

    import google.generativeai as genai

    # Accept both naming conventions: GEMINI_API_KEY (code default) and
    # MODEL_API_KEY (env.example / Railway convention)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise LLMConfigError(
            "LLM provider not configured — set GEMINI_API_KEY or MODEL_API_KEY"
        )
    genai.configure(api_key=api_key)
    model_name = (
        os.environ.get("GEMINI_MODEL")
        or os.environ.get("MODEL_NAME")
        or "gemini-1.5-flash"
    )
    logger.debug("Using Gemini model: %s", model_name)
    return genai.GenerativeModel(model_name)


def _fallback_extract(tender_text: str, filename: str) -> dict:
    raw_text = (tender_text or "").strip()
    content_preview = raw_text[:4000] if raw_text else f"[No text extracted from {filename}. Please enter requirements manually.]"
    return {
        "sections": [
            {
                "section_id": "manual_requirements",
                "name": "Manual Requirements",
                "fields": [
                    {
                        "field_label": "Document content (completion mode)",
                        "content": content_preview,
                        "confidence": 0.34,
                        "missing_field_severity": "optional",
                        "source_refs": [
                            {
                                "document": filename,
                                "page": None,
                                "excerpt": content_preview[:300],
                                "confidence": 0.34,
                            }
                        ],
                    }
                ],
            }
        ]
    }


def _fallback_concepts(proposal_title: str, requirements_summary: str) -> list:
    title = (proposal_title or "Untitled proposal").strip()
    return [
        {
            "name": f"{title} foundation" if len(title.split()) <= 3 else "Foundational concept",
            "fit_score": 0.64,
            "tags": ["manual-mode", "non-gemini"],
            "rationale": "Offline completion path generated a conservative baseline concept for this proposal. Adjust details in concept review before approval.",
            "kb_references": ["Non-Gemini completion mode"],
        },
        {
            "name": "Balanced production plan",
            "fit_score": 0.58,
            "tags": ["offline", "manual-mode"],
            "rationale": "Fallback concept with pragmatic scope and broad applicability. Good starting point for manual refinement.",
            "kb_references": ["Non-Gemini completion mode"],
        },
        {
            "name": "High-impact variant",
            "fit_score": 0.54,
            "tags": ["fallback", "non-gemini"],
            "rationale": f"Second-pass variant for {title}, generated from brief context: {requirements_summary or 'no structured requirements yet'}.",
            "kb_references": ["Non-Gemini completion mode"],
        },
    ]


def extract_tender_requirements(tender_text: str, filename: str) -> dict:
    """Call Gemini to extract structured requirements from tender text.
    Returns the sections dict or raises on unrecoverable error."""
    if _is_non_gemini_enabled():
        return _fallback_extract(tender_text, filename)

    prompt = f"""You are an event-production requirements analyst. Extract structured requirements from the tender document text below.

Return JSON matching this schema exactly:
{{
  "sections": [
    {{
      "section_id": "<snake_case_category>",
      "name": "<human-readable category name>",
      "fields": [
        {{
          "field_label": "<field name>",
          "content": "<extracted value or null if not found>",
          "confidence": <0.0-1.0>,
          "missing_field_severity": "required" or "optional",
          "source_refs": [
            {{
              "document": "<filename>",
              "page": <page_number or null>,
              "excerpt": "<verbatim quote from source>",
              "confidence": <0.0-1.0>
            }}
          ]
        }}
      ]
    }}
  ]
}}

Tender document text:
---
{tender_text or f"[No text extracted from {filename}]"}
---

Return only valid JSON. Do not wrap in markdown code fences."""

    model = _get_model()
    response = model.generate_content(prompt)
    text = response.text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(text)


def generate_concepts(proposal_title: str, requirements_summary: str) -> list:
    """Call Gemini to generate 3 concept proposals.
    Returns list of concept dicts or raises on unrecoverable error."""
    if _is_non_gemini_enabled():
        return _fallback_concepts(proposal_title, requirements_summary)

    prompt = f"""You are an event production strategist at a world-class events company. Generate 3 concept proposals for the following brief.

Proposal brief:
Title: {proposal_title}
Requirements summary: {requirements_summary or "No requirements available yet."}

For each concept return a JSON object in this array:
[
  {{
    "name": "<concept name, 2-4 words>",
    "fit_score": <0.0-1.0, how well this concept fits the brief>,
    "tags": ["<tag1>", "<tag2>"],
    "rationale": "<2-3 sentence rationale explaining fit and trade-offs>",
    "kb_references": ["<similar past event reference>"]
  }}
]

Return only the JSON array. Do not wrap in markdown code fences."""

    model = _get_model()
    response = model.generate_content(prompt)
    text = response.text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(text)


def regenerate_concept(concept_name: str, proposal_title: str, requirements_summary: str) -> dict:
    """Call Gemini to regenerate a single concept. Returns a concept dict or raises on error."""
    if _is_non_gemini_enabled():
        return {
            "name": f"Refined {concept_name}",
            "fit_score": 0.62,
            "tags": ["manual-mode", "refined"],
            "rationale": (
                f"{concept_name} refreshed in non-Gemini completion mode based on "
                f"{proposal_title or 'the current proposal'} with manual-edit ready outputs. "
                "Replace before sending to client."
            ),
            "kb_references": ["Non-Gemini completion mode"],
        }

    prompt = f"""You are an event production strategist at a world-class events company. Regenerate the event concept proposal below for the following brief.

Proposal brief:
Title: {proposal_title}
Requirements summary: {requirements_summary or "No requirements available yet."}
Concept to refresh: {concept_name}

Return a single JSON object:
{{
  "name": "<concept name, 2-4 words>",
  "fit_score": <0.0-1.0, how well this concept fits the brief>,
  "tags": ["<tag1>", "<tag2>"],
  "rationale": "<2-3 sentence rationale explaining fit and trade-offs>",
  "kb_references": ["<similar past event reference>"]
}}

Return only the JSON object. Do not wrap in markdown code fences."""

    model = _get_model()
    response = model.generate_content(prompt)
    text = response.text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(text)


def regenerate_slide(slide_title: str, current_content: str, proposal_title: str,
                     requirements_summary: str, guidance: str) -> str:
    """Call Gemini to rewrite slide content. Returns new content string."""
    if _is_non_gemini_enabled():
        sanitized_guidance = (guidance or "General quality improvements.").strip() or "General quality improvements."
        existing = (current_content or "").strip()
        if not existing:
            existing = "Drafting in non-Gemini completion mode."
        return (
            f"{existing}\n\nGuidance applied: {sanitized_guidance}."
            "\n\nUpdate wording manually before final delivery."
        )

    prompt = f"""You are a professional event-proposal copywriter. Rewrite the slide content below based on the guidance provided.

Slide title: {slide_title}
Current content: {current_content or "(empty)"}
Proposal context: {proposal_title} — {requirements_summary or "No requirements."}
Guidance from user: {guidance or "Improve clarity and impact."}

Return only the new slide content as plain text (no JSON, no markdown). Aim for 40-80 words."""

    model = _get_model()
    response = model.generate_content(prompt)
    return response.text.strip()
