"""
WanXiang (DashScope Wan 2.7) API adapter.

This adapter uses Alibaba Cloud DashScope Wan 2.7 image generation/editing
to provide a domestic alternative to the Google Gemini-based adapters.
It supports multi-image composition, which fits the virtual try-on flow.
"""

import base64
import io
import os
from typing import List, Optional, Union

from PIL import Image

try:
    import dashscope
    from dashscope.aigc.image_generation import ImageGeneration
    from dashscope.api_entities.dashscope_response import Message
    DASHSCOPE_AVAILABLE = True
except ImportError:
    dashscope = None
    ImageGeneration = None
    Message = None
    DASHSCOPE_AVAILABLE = False


class WanXiangAdapter:
    """
    Adapter for WanXiang 2.7 image generation.

    The adapter currently uses wan2.7-image-pro because it supports the most
    capable image editing and multi-image reference workflows.
    """

    MODEL_NAME = "wan2.7-image-pro"

    def __init__(self, api_key: Optional[str] = None):
        if not DASHSCOPE_AVAILABLE:
            raise ImportError(
                "DashScope SDK is required for WanXiang. "
                "Install it with: pip install dashscope"
            )

        self.api_key = api_key or os.getenv("DASHSCOPE_API_KEY")
        if not self.api_key:
            raise ValueError(
                "DashScope API key is required. Set DASHSCOPE_API_KEY environment variable "
                "or pass api_key parameter."
            )

        # Beijing region endpoint, matching the documented default.
        dashscope.base_http_api_url = os.getenv(
            "DASHSCOPE_BASE_URL",
            "https://dashscope.aliyuncs.com/api/v1"
        )

    def _prepare_image_input(self, image_input: Union[str, io.BytesIO, Image.Image]) -> Image.Image:
        if isinstance(image_input, Image.Image):
            return image_input

        if hasattr(image_input, "read"):
            image_input.seek(0)
            return Image.open(image_input)

        if isinstance(image_input, str):
            if image_input.startswith(("http://", "https://")):
                import requests

                response = requests.get(image_input, timeout=60)
                response.raise_for_status()
                return Image.open(io.BytesIO(response.content))

            if len(image_input) > 100 and not os.path.exists(image_input):
                try:
                    image_bytes = base64.b64decode(image_input)
                    return Image.open(io.BytesIO(image_bytes))
                except Exception:
                    pass

            return Image.open(image_input)

        raise ValueError(
            "Invalid image input: must be a file path, URL, PIL Image, file-like object, or base64 string"
        )

    def _image_to_data_url(self, image: Image.Image) -> str:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return f"data:image/png;base64,{encoded}"

    def _content_to_pil_images(self, response) -> List[Image.Image]:
        images: List[Image.Image] = []

        output = getattr(response, "output", None)
        if output is None:
            raise ValueError("WanXiang response did not include output")

        choices = getattr(output, "choices", None) or []
        for choice in choices:
            message = choice.get("message") if isinstance(choice, dict) else getattr(choice, "message", None)
            if not message:
                continue

            content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
            if not content:
                continue

            for item in content:
                image_url = item.get("image") if isinstance(item, dict) else getattr(item, "image", None)
                if not image_url:
                    continue

                import requests

                image_response = requests.get(image_url, timeout=120)
                image_response.raise_for_status()
                images.append(Image.open(io.BytesIO(image_response.content)))

        if not images:
            raise ValueError("No images generated in WanXiang response")

        return images

    def generate_text_to_image(
        self,
        prompt: str,
        size: str = "2K",
        watermark: bool = False,
        thinking_mode: bool = True,
        n: int = 1,
        **kwargs,
    ) -> List[Image.Image]:
        if size not in ["1K", "2K", "4K"]:
            raise ValueError("Invalid size. Must be one of: '1K', '2K', '4K'")

        if n < 1:
            raise ValueError("n must be at least 1")

        message = Message(role="user", content=[{"text": prompt}])

        parameters = {
            "size": size,
            "n": n,
            "watermark": watermark,
            "thinking_mode": thinking_mode,
        }
        parameters.update(kwargs)

        response = ImageGeneration.call(
            model=self.MODEL_NAME,
            api_key=self.api_key,
            messages=[message],
            **parameters,
        )

        if getattr(response, "status_code", None) not in (200, None):
            raise ValueError(
                f"WanXiang request failed: status_code={getattr(response, 'status_code', 'unknown')}, "
                f"message={getattr(response, 'message', 'unknown')}"
            )

        return self._content_to_pil_images(response)

    def generate_multi_image(
        self,
        images: List[Union[str, io.BytesIO, Image.Image]],
        prompt: str,
        size: str = "2K",
        watermark: bool = False,
        thinking_mode: bool = True,
        n: int = 1,
        **kwargs,
    ) -> List[Image.Image]:
        if size not in ["1K", "2K", "4K"]:
            raise ValueError("Invalid size. Must be one of: '1K', '2K', '4K'")

        if n < 1:
            raise ValueError("n must be at least 1")

        prepared_images = [self._prepare_image_input(image) for image in images]
        contents = [{"text": prompt}] + [{"image": self._image_to_data_url(image)} for image in prepared_images]

        message = Message(role="user", content=contents)

        parameters = {
            "size": size,
            "n": n,
            "watermark": watermark,
            "thinking_mode": thinking_mode,
        }
        parameters.update(kwargs)

        response = ImageGeneration.call(
            model=self.MODEL_NAME,
            api_key=self.api_key,
            messages=[message],
            **parameters,
        )

        if getattr(response, "status_code", None) not in (200, None):
            raise ValueError(
                f"WanXiang request failed: status_code={getattr(response, 'status_code', 'unknown')}, "
                f"message={getattr(response, 'message', 'unknown')}"
            )

        return self._content_to_pil_images(response)