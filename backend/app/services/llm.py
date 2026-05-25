import json
import logging
import os

logger = logging.getLogger(__name__)


def _get_model():
    import google.generativeai as genai

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-3.1-pro-preview")


def extract_tender_requirements(tender_text: str, filename: str) -> dict:
    """Call Gemini to extract structured requirements from tender text.
    Returns the sections dict or raises on unrecoverable error."""
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
    prompt = f"""You are an event production strategist at a world-class events company. Generate 3 distinct event concept proposals for the following brief.

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


def regenerate_slide(slide_title: str, current_content: str, proposal_title: str,
                     requirements_summary: str, guidance: str) -> str:
    """Call Gemini to rewrite slide content. Returns new content string."""
    prompt = f"""You are a professional event-proposal copywriter. Rewrite the slide content below based on the guidance provided.

Slide title: {slide_title}
Current content: {current_content or "(empty)"}
Proposal context: {proposal_title} — {requirements_summary or "No requirements."}
Guidance from user: {guidance or "Improve clarity and impact."}

Return only the new slide content as plain text (no JSON, no markdown). Aim for 40-80 words."""

    model = _get_model()
    response = model.generate_content(prompt)
    return response.text.strip()
