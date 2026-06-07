"""
AI provider abstraction layer.

Every provider must implement the AIProvider protocol.  The worker calls
provider.generate(prompt, timeout) and expects either a string result or
one of the declared exceptions:

    GenerationError   — non-retryable content/API error
    TimeoutError      — call exceeded the timeout budget (re-raised as-is)

Any other exception propagates up and is treated as a transient failure
eligible for retry.

Providers
---------
  MockAIProvider        — local stub; no network; realistic latency + failures
  AnthropicProvider     — Anthropic Messages API (requires ANTHROPIC_API_KEY)

The active provider is selected by get_provider(), which reads PROVIDER env var.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class GenerationError(Exception):
    """Non-retryable error from the AI provider (bad request, content policy, etc.)."""


# ---------------------------------------------------------------------------
# Protocol / base class
# ---------------------------------------------------------------------------

class AIProvider(ABC):
    """
    Abstract base for all AI generation backends.

    Implementations must be safe to call concurrently from multiple
    asyncio tasks.  They must not hold any mutable state between calls.
    """

    @abstractmethod
    async def generate(self, prompt: str, timeout: float) -> str:
        """
        Generate a response for the given prompt.

        Args:
            prompt:  The user's raw prompt text.
            timeout: Hard deadline in seconds.  Implementations should
                     respect this and raise asyncio.TimeoutError if exceeded.

        Returns:
            Generated text string.

        Raises:
            asyncio.TimeoutError: Generation did not complete within timeout.
            GenerationError:      Non-retryable provider error.
            Exception:            Any other transient error (eligible for retry).
        """
        ...

    @property
    def name(self) -> str:
        return self.__class__.__name__


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

# Canned campaign-style outputs indexed by common creative prompt keywords.
_MOCK_OUTPUTS: list[str] = [
    (
        "**Campaign: 'Roots & Routes'**\n\n"
        "Concept: A nationwide storytelling initiative inviting communities to share "
        "the journeys that shaped them. Each submission becomes a tile in a living "
        "digital mosaic — part archive, part manifesto.\n\n"
        "Tagline: *Every path leads somewhere worth remembering.*\n\n"
        "Channels: Long-form video essays (YouTube), participatory pop-ups in transit "
        "hubs, a limited-run zine distributed via independent bookshops.\n\n"
        "KPI: 10,000 story submissions in 90 days; 40 % organic reach."
    ),
    (
        "**Campaign: 'Signal & Noise'**\n\n"
        "Concept: A media literacy drive disguised as an art exhibition. Visitors "
        "interact with installations that make misinformation *visible* — revealing "
        "the mechanics of viral falsehoods through direct, tactile experience.\n\n"
        "Tagline: *You can't unsee the truth.*\n\n"
        "Channels: Travelling gallery (12 cities), classroom toolkit, partnership with "
        "three national newspapers for editorial tie-ins.\n\n"
        "KPI: 500,000 unique gallery visitors; 1 M toolkit downloads."
    ),
    (
        "**Campaign: 'The Quiet Hours'**\n\n"
        "Concept: A wellness brand campaign centred on reclaiming unscheduled time. "
        "Shot entirely during the blue hour, the visuals prioritise stillness over "
        "aspiration — a deliberate counter to hustle-culture aesthetics.\n\n"
        "Tagline: *Doing less is doing something.*\n\n"
        "Channels: Print (broadsheet inserts), ambient audio spots on podcast networks, "
        "a 30-day mindfulness email series.\n\n"
        "KPI: 25 % uplift in brand consideration among 28–45 demographic."
    ),
    (
        "**Campaign: 'Open Frequency'**\n\n"
        "Concept: A music discovery platform launch built around the idea that great "
        "songs find you — not the other way around. Algorithmic curation is hidden; "
        "the experience feels serendipitous and deeply personal.\n\n"
        "Tagline: *Your next favourite song doesn't know you yet.*\n\n"
        "Channels: Spotify takeover ads, lo-fi YouTube content series, street-level "
        "QR murals that unlock exclusive tracks.\n\n"
        "KPI: 2 M new sign-ups in Q1; 65 % 30-day retention rate."
    ),
    (
        "**Campaign: 'Borrowed Light'**\n\n"
        "Concept: A sustainability initiative for an architecture firm, showcasing "
        "buildings designed to maximise natural light and minimise energy draw. Each "
        "project is documented at dawn — golden-hour footage becomes the creative core.\n\n"
        "Tagline: *Build for the sun.*\n\n"
        "Channels: Architectural digest spreads, time-lapse Instagram content, "
        "conference keynote sponsorships.\n\n"
        "KPI: 3 award submissions; RFP enquiries up 30 % YoY."
    ),
    (
        "**Campaign: 'The Long Game'**\n\n"
        "Concept: A pension provider repositions itself around intergenerational "
        "wealth — not as inheritance but as *intention*. Real families share what "
        "they are saving toward and why it matters beyond themselves.\n\n"
        "Tagline: *What you build today, they inherit tomorrow.*\n\n"
        "Channels: Documentary-style brand film (12 min), targeted display, "
        "branch activation with legacy letter writing workshops.\n\n"
        "KPI: 18 % increase in new policy sign-ups among 35–50 cohort."
    ),
    (
        "**Campaign: 'Daylight Shift'**\n\n"
        "Concept: An electric-vehicle manufacturer reframes charging anxiety by "
        "turning overnight charging into a morning ritual — waking up to a full "
        "battery as a small, dependable joy.\n\n"
        "Tagline: *Ready when you are.*\n\n"
        "Channels: Pre-roll video, connected-TV spots during morning news slots, "
        "OOH at commuter car parks.\n\n"
        "KPI: 15 % reduction in stated 'range anxiety' in brand tracker; "
        "test-drive bookings up 22 %."
    ),
    (
        "**Campaign: 'Common Ground'**\n\n"
        "Concept: A food brand celebrates the shared rituals of mealtime across "
        "cultures, spotlighting regional recipes contributed by customers. "
        "The campaign culminates in a community cookbook, printed on demand.\n\n"
        "Tagline: *Every table has a story.*\n\n"
        "Channels: UGC recipe submissions (Instagram/TikTok), micro-influencer "
        "partnerships, in-store sampling events.\n\n"
        "KPI: 50,000 recipe submissions; cookbook edition sells out in 72 hours."
    ),
]

_FAILURE_MESSAGES: list[str] = [
    "Provider returned HTTP 503: service temporarily unavailable.",
    "Connection reset by peer after 1.2 s.",
    "Rate limit exceeded: retry after 60 s.",
    "Internal provider error: inference cluster overloaded.",
    "Upstream model timeout: no tokens generated within deadline.",
]


class MockAIProvider(AIProvider):
    """
    Local stub provider for development and testing.

    Behaviour
    ---------
    * Latency:      Uniform random in [min_latency, max_latency] seconds.
    * Failure rate: Configurable; defaults to 10 %.
    * Timeout:      Respects the timeout argument via asyncio.wait_for.
    * Outputs:      Randomly selected from _MOCK_OUTPUTS; seeded for
                    reproducibility when seed is set.
    """

    def __init__(
        self,
        min_latency: float = 2.0,
        max_latency: float = 6.0,
        failure_rate: float = 0.10,
        seed: int | None = None,
    ) -> None:
        self._min_latency = min_latency
        self._max_latency = max_latency
        self._failure_rate = failure_rate
        self._rng = random.Random(seed)

    async def generate(self, prompt: str, timeout: float) -> str:
        latency = self._rng.uniform(self._min_latency, self._max_latency)
        logger.debug(
            "[MockAIProvider] Simulating %.2f s latency for prompt: %.60s…",
            latency,
            prompt,
        )

        async def _work() -> str:
            await asyncio.sleep(latency)
            if self._rng.random() < self._failure_rate:
                raise RuntimeError(self._rng.choice(_FAILURE_MESSAGES))
            return self._rng.choice(_MOCK_OUTPUTS)

        # Respect the caller-supplied timeout; raises asyncio.TimeoutError if exceeded.
        return await asyncio.wait_for(_work(), timeout=timeout)


# ---------------------------------------------------------------------------
# Anthropic provider
# ---------------------------------------------------------------------------

class AnthropicProvider(AIProvider):
    """
    Anthropic Messages API provider.

    Reads ANTHROPIC_API_KEY and AI_MODEL from the environment.
    Requires `httpx` (already in requirements.txt).
    """

    _API_URL = "https://api.anthropic.com/v1/messages"
    _API_VERSION = "2023-06-01"

    def __init__(self) -> None:
        self._api_key = os.environ["ANTHROPIC_API_KEY"]
        self._model = os.getenv("AI_MODEL", "claude-haiku-4-5-20251001")
        self._max_tokens = int(os.getenv("AI_MAX_TOKENS", "1024"))

    async def generate(self, prompt: str, timeout: float) -> str:
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("httpx is required for AnthropicProvider") from exc

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self._API_URL,
                    headers={
                        "x-api-key": self._api_key,
                        "anthropic-version": self._API_VERSION,
                        "content-type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "max_tokens": self._max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
        except httpx.TimeoutException as exc:
            raise asyncio.TimeoutError(str(exc)) from exc
        except httpx.RequestError as exc:
            raise RuntimeError(f"Network error: {exc}") from exc

        if response.status_code == 429:
            raise RuntimeError(f"Rate limited: {response.text}")
        if response.status_code in {400, 422}:
            raise GenerationError(f"Bad request ({response.status_code}): {response.text}")
        if not response.is_success:
            raise RuntimeError(f"Provider error {response.status_code}: {response.text}")

        data = response.json()
        try:
            return data["content"][0]["text"]
        except (KeyError, IndexError) as exc:
            raise RuntimeError(f"Unexpected response shape: {data}") from exc


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

_PROVIDERS: dict[str, type[AIProvider]] = {
    "mock":      MockAIProvider,
    "anthropic": AnthropicProvider,
}


def get_provider() -> AIProvider:
    """
    Instantiate and return the configured AI provider.

    Reads PROVIDER env var (default: "mock").
    Falls back to MockAIProvider if the env var names an unknown provider.
    """
    name = os.getenv("PROVIDER", "mock").lower()
    cls = _PROVIDERS.get(name)
    if cls is None:
        logger.warning("Unknown provider '%s'; falling back to MockAIProvider.", name)
        cls = MockAIProvider
    logger.info("AI provider: %s", cls.__name__)
    return cls()