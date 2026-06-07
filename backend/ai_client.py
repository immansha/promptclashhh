"""
Thin async wrapper around whatever text-generation API is in use.
Swap out _call_api() to point at OpenAI, Anthropic, or any other provider.
"""

import asyncio
import os


_API_KEY = os.getenv("AI_API_KEY", "")
_MODEL = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")
_TIMEOUT = float(os.getenv("AI_TIMEOUT_SECONDS", "30"))


async def generate(prompt: str) -> str:
    """
    Call the generation API and return the output text.
    Raises RuntimeError on failure (caller handles retry logic).
    """
    if not _API_KEY:
        # Stub mode: simulate a short delay and return a canned response
        await asyncio.sleep(2)
        return f"[Stub output for prompt: {prompt[:60]}...]"

    try:
        import httpx  # optional dep; only needed in production

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": _API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": _MODEL,
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["content"][0]["text"]
    except Exception as exc:
        raise RuntimeError(f"AI generation failed: {exc}") from exc
