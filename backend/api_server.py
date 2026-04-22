"""
FastAPI server for Virtual Try-On using multiple model providers.

This server provides a simple REST API endpoint for virtual try-on generation
using various image generation models:
- Nano Banana and Nano Banana Pro (Google Gemini)
"""

import os
import io
import base64
import hmac
import hashlib
import logging
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import uuid4
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from dotenv import load_dotenv
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

# Load environment variables
load_dotenv()

# Import adapters
from tryon.api.nano_banana import NanoBananaAdapter, NanoBananaProAdapter
from tryon.api.wan_xiang import WanXiangAdapter
from db import check_database_connection, get_db, initialize_database
from models import Product, User

# Create output directory for generated images
OUTPUT_DIR = Path("outputs/virtual_tryon")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

USER_IMAGE_DIR = Path.home() / "Desktop" / "ai-try-on-user-images"
USER_IMAGE_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger(__name__)

PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 390000

# Temporary development bypass.
# Set RETURN_MODEL_IMAGE_DIRECTLY=true only when you want to skip external providers.
RETURN_MODEL_IMAGE_DIRECTLY = os.getenv("RETURN_MODEL_IMAGE_DIRECTLY", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

# Supported aspect ratios for both adapters
SUPPORTED_ASPECT_RATIOS = [
    "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"
]

VIEW_DEFINITIONS = [
    ("front", "front view", "The subject faces the camera directly from the front."),
    ("back", "back view", "The subject is turned around to show the back of the outfit."),
    ("left", "left side view", "The subject is shown in a clean left-side profile."),
]

JOB_STORAGE: Dict[str, Dict[str, Any]] = {}
JOB_STORAGE_LOCK = Lock()


class AuthPayload(BaseModel):
    username: str
    password: Optional[str] = None
    account: Optional[str] = None


class UserImagePayload(BaseModel):
    username: str
    password: Optional[str] = None
    account: Optional[str] = None
    image: str
    kind: Literal["uploaded", "virtual"] = "uploaded"


def resolve_password(payload: AuthPayload | UserImagePayload) -> str:
    return (payload.password or payload.account or "").strip()


def hash_password(raw_password: str) -> str:
    salt = os.urandom(16).hex()
    derived_key = hashlib.pbkdf2_hmac(
        "sha256",
        raw_password.encode("utf-8"),
        bytes.fromhex(salt),
        PASSWORD_HASH_ITERATIONS,
    ).hex()
    return f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}${salt}${derived_key}"


def verify_password(raw_password: str, stored_password: str) -> bool:
    if not stored_password:
        return False

    parts = stored_password.split("$", 3)
    if len(parts) == 4 and parts[0] == PASSWORD_HASH_PREFIX:
        try:
            iterations = int(parts[1])
            salt = parts[2]
            expected_hash = parts[3]
        except ValueError:
            return False

        derived_key = hashlib.pbkdf2_hmac(
            "sha256",
            raw_password.encode("utf-8"),
            bytes.fromhex(salt),
            iterations,
        ).hex()
        return hmac.compare_digest(derived_key, expected_hash)

    # Backward compatibility for historical plaintext rows.
    return hmac.compare_digest(raw_password, stored_password)


def get_user_by_credentials(db: Session, username: str, password: str) -> Optional[User]:
    matched_user = db.execute(
        select(User).where(User.username == username)
    ).scalar_one_or_none()

    if not matched_user:
        return None

    if not verify_password(password, matched_user.password):
        return None

    if not matched_user.password.startswith(f"{PASSWORD_HASH_PREFIX}$"):
        matched_user.password = hash_password(password)
        db.commit()
        db.refresh(matched_user)

    return matched_user


def normalize_image_list(images: List[str]) -> List[str]:
    normalized: List[str] = []
    seen: set[str] = set()

    for image in images:
        if not isinstance(image, str):
            continue

        trimmed_image = image.strip()
        if not trimmed_image or trimmed_image in seen:
            continue

        seen.add(trimmed_image)
        normalized.append(trimmed_image)

    return normalized


def build_user_image_url(request: Request, relative_path: str) -> str:
    base_url = str(request.base_url).rstrip("/")
    normalized_path = relative_path.replace(os.sep, "/").lstrip("/")
    return f"{base_url}/user-images/{normalized_path}"


def update_user_image_list(
    db: Session,
    payload: UserImagePayload,
    *,
    action: Literal["add", "remove"],
) -> Dict[str, Any]:
    username = payload.username.strip()
    password = resolve_password(payload)
    image_value = payload.image.strip()

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    if not image_value:
        raise HTTPException(status_code=400, detail="Image content is required")

    matched_user = get_user_by_credentials(db, username, password)
    if not matched_user:
        raise HTTPException(status_code=401, detail="用户名或密码不正确，请重新输入。")

    field_name = "uploaded_images" if payload.kind == "uploaded" else "virtual_images"
    current_images = normalize_image_list(list(getattr(matched_user, field_name) or []))

    if action == "add":
        next_images = normalize_image_list([image_value, *current_images])
    else:
        next_images = normalize_image_list([item for item in current_images if item != image_value])

    setattr(matched_user, field_name, next_images)
    db.commit()
    db.refresh(matched_user)

    return {
        "success": True,
        "account": matched_user.to_dict(),
        "kind": payload.kind,
        "images": next_images,
    }


async def store_user_image_from_upload(
    request: Request,
    db: Session,
    *,
    username: str,
    password: str,
    image_file: UploadFile,
    kind: Literal["uploaded", "virtual"],
) -> Dict[str, Any]:
    normalized_username = username.strip()
    normalized_password = password.strip()

    if not normalized_username or not normalized_password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    matched_user = get_user_by_credentials(db, normalized_username, normalized_password)
    if not matched_user:
        raise HTTPException(status_code=401, detail="用户名或密码不正确，请重新输入。")

    contents = await image_file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Image file is empty")

    safe_filename = Path(image_file.filename or f"image-{uuid4().hex}.png").name
    file_suffix = Path(safe_filename).suffix or ".png"
    kind_prefix = "uploaded" if kind == "uploaded" else "virtual"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    relative_path = f"{kind_prefix}/{timestamp}_{uuid4().hex}{file_suffix}"
    file_path = USER_IMAGE_DIR / relative_path
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(contents)

    image_url = build_user_image_url(request, relative_path)
    field_name = "uploaded_images" if kind == "uploaded" else "virtual_images"
    current_images = normalize_image_list(list(getattr(matched_user, field_name) or []))
    next_images = normalize_image_list([image_url, *current_images])

    setattr(matched_user, field_name, next_images)
    db.commit()
    db.refresh(matched_user)

    return {
        "success": True,
        "imageUrl": image_url,
        "savedPath": str(file_path),
        "kind": kind,
        "account": matched_user.to_dict(),
        "images": next_images,
    }


def group_catalog_products(rows: List[Product]) -> List[Dict[str, Any]]:
        grouped: Dict[str, Dict[str, Any]] = {}

        for row in rows:
            group = grouped.setdefault(
                row.product_id,
                {
                    "slug": row.product_id,
                    "productId": row.product_id,
                    "name": row.product_name,
                    "subtitle": row.subtitle,
                    "skus": [],
                },
            )

            group["skus"].append({
                "id": row.sku_id,
                "name": row.sku_id,
                "color": row.color,
                "size": row.size,
                "price": row.price,
                "image": row.image_path,
                "imagePath": row.image_path,
            })

        return list(grouped.values())


def calculate_aspect_ratio(image: Image.Image) -> str:
    """
    Calculate the aspect ratio from an image and return the closest supported ratio.
    
    Args:
        image: PIL Image object
        
    Returns:
        str: Aspect ratio string in format "W:H" (e.g., "16:9")
    """
    width, height = image.size
    ratio = width / height
    
    # Map of supported ratios to their decimal values
    ratio_map = {
        "1:1": 1.0,
        "2:3": 2/3,
        "3:2": 3/2,
        "3:4": 3/4,
        "4:3": 4/3,
        "4:5": 4/5,
        "5:4": 5/4,
        "9:16": 9/16,
        "16:9": 16/9,
        "21:9": 21/9,
    }
    
    # Find the closest matching aspect ratio
    closest_ratio = "1:1"  # Default
    min_diff = float('inf')
    
    for ratio_str, ratio_value in ratio_map.items():
        diff = abs(ratio - ratio_value)
        if diff < min_diff:
            min_diff = diff
            closest_ratio = ratio_str
    
    return closest_ratio


def get_image_dimensions(image: Image.Image) -> Tuple[int, int]:
    """
    Get image dimensions (width, height).
    
    Args:
        image: PIL Image object
        
    Returns:
        tuple: (width, height)
    """
    return image.size


def calculate_resolution(image: Image.Image) -> str:
    """
    Calculate resolution from image dimensions in "widthxheight" format.
    
    Args:
        image: PIL Image object
        
    Returns:
        str: Resolution string in format "widthxheight" (e.g., "1024x1024")
    """
    width, height = image.size
    return f"{width}x{height}"


def map_resolution_to_pro_format(image: Image.Image) -> str:
    """
    Map image resolution to Nano Banana Pro format ("1K", "2K", or "4K").
    
    The mapping is based on the maximum dimension:
    - max_dimension <= 1500: "1K"
    - max_dimension <= 3000: "2K"
    - max_dimension > 3000: "4K"
    
    Args:
        image: PIL Image object
        
    Returns:
        str: Resolution in format "1K", "2K", or "4K"
    """
    width, height = image.size
    max_dimension = max(width, height)
    
    if max_dimension <= 1500:
        return "1K"
    elif max_dimension <= 3000:
        return "2K"
    else:
        return "4K"


def build_view_prompt(base_prompt: str, view_label: str, view_instruction: str) -> str:
    return (
        f"{base_prompt}\n\n"
        f"VIEW REQUIREMENT: Generate the {view_label} of the same person and outfit. "
        f"{view_instruction} "
        f"Keep the person identity, garment details, colors, textures, fit, and lighting consistent. "
        f"Do not add extra people, change the scene, or alter the clothing design. "
        f"The output must be a newly generated try-on image, not the original source photo unchanged."
    )


def build_garment_step_prompt(
    base_prompt: str,
    view_label: str,
    view_instruction: str,
    garment_index: int,
    total_garments: int,
) -> str:
    return (
        f"{base_prompt}\n\n"
        f"VIEW REQUIREMENT: Generate the {view_label} of the same person and outfit. "
        f"{view_instruction} "
        f"Keep the person identity, garment details, colors, textures, fit, and lighting consistent. "
        f"Do not add extra people, change the scene, or alter the clothing design. "
        f"MULTI-STEP OUTFIT REQUIREMENT: This is garment {garment_index}/{total_garments}. "
        f"The first image is the current outfit state. The second image is the NEXT garment only. "
        f"Preserve every garment already visible in the first image exactly as-is. Apply only the new garment from the second image. "
        f"If the garment image contains a person, ignore the person and extract only the clothing. "
        f"Do not remove, hide, replace, or simplify any previously applied garment. "
        f"The output must be a newly generated try-on image that clearly includes the next garment."
    )


def build_angle_prompt(custom_prompt: Optional[str], view_label: str, view_instruction: str) -> str:
    prompt_prefix = f"{custom_prompt}\n\n" if custom_prompt else ""
    return (
        f"{prompt_prefix}REFERENCE VIEW REQUIREMENT: Create the same person in a clean {view_label} reference image. "
        f"{view_instruction} Preserve identity, body shape, lighting, and composition. "
        f"Do not change the outfit yet. Do not return the original image unchanged."
    )


def convert_to_pil_image(result_image):
    if isinstance(result_image, Image.Image):
        return result_image

    if hasattr(result_image, 'image_bytes'):
        return Image.open(io.BytesIO(result_image.image_bytes))
    if hasattr(result_image, 'to_pil'):
        return result_image.to_pil()

    image_bytes = bytes(result_image)
    return Image.open(io.BytesIO(image_bytes))


def image_signature(image: Image.Image, size: Tuple[int, int] = (32, 32)) -> bytes:
    normalized = ImageOps.exif_transpose(image).convert("RGB")
    normalized = normalized.resize(size)
    return normalized.tobytes()


def images_are_identical(first: Image.Image, second: Image.Image) -> bool:
    return image_signature(first) == image_signature(second)


def get_provider_generation_context(provider: str, final_aspect_ratio: str, final_resolution: str):
    if provider == "nano-banana":
        adapter = NanoBananaAdapter()
        generation_kwargs = {"aspect_ratio": final_aspect_ratio}
    elif provider == "nano-banana-pro":
        adapter = NanoBananaProAdapter()
        generation_kwargs = {
            "resolution": final_resolution,
            "aspect_ratio": final_aspect_ratio,
        }
    elif provider == "wan-xiang":
        adapter = WanXiangAdapter()
        generation_kwargs = {
            "size": "2K",
            "watermark": False,
            "thinking_mode": True,
            "n": 1,
        }
    else:
        raise ValueError(f"Unsupported provider: {provider}")

    return adapter, generation_kwargs


def get_provider_text_generation_context(provider: str, final_aspect_ratio: str, final_resolution: str):
    if provider == "nano-banana":
        adapter = NanoBananaAdapter()
        generation_kwargs = {"aspect_ratio": final_aspect_ratio}
    elif provider == "nano-banana-pro":
        adapter = NanoBananaProAdapter()
        generation_kwargs = {
            "resolution": final_resolution,
            "aspect_ratio": final_aspect_ratio,
        }
    elif provider == "wan-xiang":
        adapter = WanXiangAdapter()
        generation_kwargs = {
            "size": final_resolution if final_resolution in ["1K", "2K", "4K"] else "2K",
            "watermark": False,
            "thinking_mode": True,
            "n": 1,
        }
    else:
        raise ValueError(f"Unsupported provider: {provider}")

    return adapter, generation_kwargs


def generate_first_image(adapter, images, prompt, generation_kwargs):
    result_images = adapter.generate_multi_image(
        images=images,
        prompt=prompt,
        **generation_kwargs,
    )

    if not result_images:
        raise ValueError("No images generated")

    return convert_to_pil_image(result_images[0])


def run_tryon_pipeline(
    model_pil: Image.Image,
    garment_pils: List[Image.Image],
    provider: str,
    prompt: str,
    final_aspect_ratio: str,
    final_resolution: str,
    model_dimensions: Dict[str, int],
    progress_callback=None,
) -> Dict[str, Any]:
    adapter, generation_kwargs = get_provider_generation_context(
        provider=provider,
        final_aspect_ratio=final_aspect_ratio,
        final_resolution=final_resolution,
    )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    response_items = []
    total_steps = len(VIEW_DEFINITIONS) * (1 + max(len(garment_pils), 1))
    completed_steps = 0

    def report_progress(current_step: str, current_view: Optional[str] = None):
        if progress_callback:
            progress = int((completed_steps / total_steps) * 100) if total_steps else 100
            progress_callback(
                progress=progress,
                current_step=current_step,
                current_view=current_view,
                images=[item.copy() for item in response_items],
            )

    for view_key, view_label, view_instruction in VIEW_DEFINITIONS:
        angle_prompt = build_angle_prompt(prompt, view_label, view_instruction)
        report_progress(f"Generating {view_label} reference", view_key)

        angle_image = None
        for attempt in range(2):
            angle_image = generate_first_image(
                adapter=adapter,
                images=[model_pil],
                prompt=angle_prompt,
                generation_kwargs=generation_kwargs,
            )

            if not images_are_identical(angle_image, model_pil):
                break

            if attempt == 0:
                angle_prompt = (
                    f"{angle_prompt}\n\n"
                    f"IMPORTANT: The image must show a clearly different {view_label} reference view, not the original front image."
                )

        if angle_image is None:
            raise ValueError(f"Unable to generate reference image for {view_key}")

        if images_are_identical(angle_image, model_pil):
            raise ValueError(f"{view_key} reference generation returned the original image unchanged")

        completed_steps += 1
        report_progress(f"Applying garments to {view_label}", view_key)

        current_tryon_image = angle_image
        if not garment_pils:
            raise ValueError(f"{view_key} try-on generation requires at least one garment image")

        for garment_index, garment_pil in enumerate(garment_pils, start=1):
            tryon_prompt = build_garment_step_prompt(
                prompt,
                view_label,
                view_instruction,
                garment_index,
                len(garment_pils),
            )
            tryon_prompt = (
                f"{tryon_prompt}\n\n"
                f"Use the first image as the current outfit state, then add only the garment in the second image. "
                f"Do not return the first image unchanged."
            )

            report_progress(f"Applying garment {garment_index}/{len(garment_pils)} to {view_label}", view_key)

            tryon_image = None
            for attempt in range(2):
                tryon_image = generate_first_image(
                    adapter=adapter,
                    images=[current_tryon_image, garment_pil],
                    prompt=tryon_prompt,
                    generation_kwargs=generation_kwargs,
                )

                if not images_are_identical(tryon_image, current_tryon_image):
                    break

                if attempt == 0:
                    tryon_prompt = (
                        f"{tryon_prompt}\n\n"
                        f"IMPORTANT: The new output must visibly add the next garment and keep all previously applied garments."
                    )

            if tryon_image is None:
                raise ValueError(f"Unable to generate try-on result for {view_key} garment {garment_index}")

            if images_are_identical(tryon_image, current_tryon_image):
                raise ValueError(f"{view_key} garment {garment_index} generation returned the previous image unchanged")

            current_tryon_image = tryon_image
            completed_steps += 1
            report_progress(f"Completed garment {garment_index}/{len(garment_pils)} for {view_label}", view_key)

        response_items.append(
            encode_and_save_image(current_tryon_image, provider, view_key, timestamp)
        )
        report_progress(f"Completed {view_label}", view_key)

    response_data: Dict[str, Any] = {
        "success": True,
        "image": response_items[0]["image"],
        "images": response_items,
        "views": [item["view"] for item in response_items],
        "provider": provider,
        "num_garments": len(garment_pils),
        "saved_path": response_items[0]["saved_path"],
        "filename": response_items[0]["filename"],
        "model_dimensions": model_dimensions,
    }

    if provider in ["nano-banana", "nano-banana-pro"]:
        response_data.update({
            "aspect_ratio": final_aspect_ratio,
            "calculated_aspect_ratio": final_aspect_ratio,
            "resolution": final_resolution,
            "calculated_resolution": final_resolution,
        })
    elif provider == "wan-xiang":
        response_data.update({
            "model": "wan2.7-image-pro",
            "size": "2K",
        })

    return response_data


def set_job_state(job_id: str, **updates):
    with JOB_STORAGE_LOCK:
        job = JOB_STORAGE.get(job_id)
        if not job:
            return

        job.update(updates)
        job["updated_at"] = datetime.now().isoformat()


def create_job_record(provider: str, num_garments: int):
    job_id = uuid4().hex
    now = datetime.now().isoformat()
    with JOB_STORAGE_LOCK:
        JOB_STORAGE[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0,
            "current_step": "Queued",
            "current_view": None,
            "provider": provider,
            "num_garments": num_garments,
            "images": [],
            "views": [],
            "created_at": now,
            "updated_at": now,
            "error": None,
        }

    return job_id


def run_tryon_job(
    job_id: str,
    model_image_bytes: bytes,
    garment_image_bytes_list: List[bytes],
    provider: str,
    prompt: Optional[str],
    resolution: Optional[str],
    aspect_ratio: Optional[str],
):
    try:
        set_job_state(job_id, status="processing", current_step="Loading images")

        model_pil = Image.open(io.BytesIO(model_image_bytes))
        garment_pils = [Image.open(io.BytesIO(item)) for item in garment_image_bytes_list]

        calculated_aspect_ratio = calculate_aspect_ratio(model_pil)
        calculated_resolution = calculate_resolution(model_pil)
        model_width, model_height = get_image_dimensions(model_pil)

        final_aspect_ratio = aspect_ratio if aspect_ratio else calculated_aspect_ratio

        if provider == "nano-banana-pro":
            if resolution and resolution in ["1K", "2K", "4K"]:
                final_resolution = resolution
            else:
                final_resolution = map_resolution_to_pro_format(model_pil)
        else:
            final_resolution = calculated_resolution

        if not prompt:
            prompt = (
                "Create a realistic virtual try-on image showing the person wearing the provided garments. "
                "CRITICAL REQUIREMENTS - Preserve all details exactly:\n"
                "1. GARMENT EXTRACTION: The garment images may contain people wearing the garments. "
                "IGNORE and EXTRACT ONLY the garment itself - do not use any person, model, or human figure "
                "from the garment images. Focus solely on the garment: its shape, design, patterns, colors, "
                "textures, and all visual details. Remove or ignore any human elements from garment images.\n"
                "2. GARMENT PRESERVATION: Keep ALL garment details completely intact - patterns, colors, textures, "
                "designs, prints, logos, text, embroidery, sequins, and any decorative elements must remain "
                "identical to the original garment images. Do not alter, fade, or modify any garment features.\n"
                "3. PERSON PRESERVATION: Keep the person's face, body shape, skin tone, hair, and physical "
                "characteristics exactly as shown in the FIRST image (model image). Only apply the extracted "
                "garments from the subsequent images to this person. Do not use any person from garment images.\n"
                "4. PARTIAL GARMENT HANDLING: If the person in the model image is wearing a full-body outfit "
                "(dress, jumpsuit, etc.) but the provided garment is only upper-body (top, shirt, blouse) or "
                "lower-body (pants, jeans, skirt), place the provided garment correctly over the corresponding "
                "body part. For the remaining uncovered body parts, generate an appropriate complementary garment "
                "that matches: (a) the person's physical characteristics and body type, (b) the person's style "
                "and personality traits visible in the model image, (c) the style, color scheme, and design "
                "aesthetic of the provided garment. The complementary garment should create a cohesive, "
                "harmonious outfit that looks natural and well-coordinated.\n"
                "5. FITTING: The extracted garments should fit naturally on the person's body from the first image, "
                "following their body contours and proportions realistically, while maintaining all original "
                "garment details from the garment images.\n"
                "6. COMPOSITION: The first image is the model/person to dress. The following images contain "
                "garments (top, bottom, accessories, etc.) - extract ONLY the garments from these images, "
                "ignoring any people shown. Combine the extracted garments to create a cohesive outfit where "
                "each garment maintains its original appearance and fits the person naturally.\n"
                "7. REALISM: The final image should look like a professional photograph of the person from the "
                "first image wearing the exact extracted garments (and complementary garments if needed), with "
                "realistic lighting, shadows, and fabric draping."
            )

        response_data = run_tryon_pipeline(
            model_pil=model_pil,
            garment_pils=garment_pils,
            provider=provider,
            prompt=prompt,
            final_aspect_ratio=final_aspect_ratio,
            final_resolution=final_resolution,
            model_dimensions={"width": model_width, "height": model_height},
            progress_callback=lambda **updates: set_job_state(job_id, **updates),
        )

        set_job_state(
            job_id,
            status="completed",
            progress=100,
            current_step="Completed",
            current_view=None,
            images=response_data.get("images", []),
            views=response_data.get("views", []),
            result=response_data,
            error=None,
        )
    except Exception as exc:
        set_job_state(
            job_id,
            status="failed",
            current_step="Failed",
            current_view=None,
            error=str(exc),
        )


def encode_and_save_image(image: Image.Image, provider: str, view_key: str, timestamp: str, prefix: str = "tryon"):
    if image.mode != 'RGB':
        image = image.convert('RGB')

    filename = f"{prefix}_{provider}_{view_key}_{timestamp}.png"
    filepath = OUTPUT_DIR / filename

    img_buffer = io.BytesIO()
    image.save(img_buffer, 'PNG')
    img_buffer.seek(0)
    img_base64 = base64.b64encode(img_buffer.read()).decode('utf-8')

    image.save(str(filepath), 'PNG')

    return {
        "view": view_key,
        "image": f"data:image/png;base64,{img_base64}",
        "saved_path": str(filepath),
        "filename": filename,
        "model_dimensions": {
            "width": image.width,
            "height": image.height,
        },
    }

app = FastAPI(
    title="AI-try-on Virtual Try-On API",
    description="Virtual try-on API using multiple model providers (Nano Banana, Nano Banana Pro, WanXiang)",
    version="1.0.0"
)

app.mount("/user-images", StaticFiles(directory=str(USER_IMAGE_DIR)), name="user-images")

# CORS middleware to allow requests from Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_database() -> None:
    initialized = initialize_database()
    if initialized:
        logger.info("MySQL database initialized and seeded successfully")
    else:
        logger.warning("MySQL database was not initialized; backend will continue with fallbacks")


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "message": "AI-try-on Virtual Try-On API",
        "version": "1.0.0",
        "endpoints": {
            "POST /api/v1/virtual-tryon": "Generate virtual try-on image"
        },
        "providers": [
            "nano-banana",
            "nano-banana-pro",
            "wan-xiang"
        ]
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/health/db")
async def health_db():
    """MySQL health check endpoint."""
    connected = check_database_connection()
    return {
        "status": "healthy" if connected else "degraded",
        "database": {
            "connected": connected,
        },
    }


@app.get("/api/v1/catalog/products")
async def list_catalog_products(db: Session = Depends(get_db)):
    products = db.execute(
        select(Product)
        .order_by(Product.id.asc())
    ).scalars().all()

    return {
        "success": True,
        "items": group_catalog_products(products),
    }


@app.get("/api/v1/catalog/products/{slug}")
async def get_catalog_product(slug: str, db: Session = Depends(get_db)):
    product = db.execute(
        select(Product)
        .where(Product.product_id == slug)
        .order_by(Product.id.asc())
    ).scalars().all()

    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    return {
        "success": True,
        "item": group_catalog_products(product)[0],
    }


@app.post("/api/v1/auth/register")
async def register_account(payload: AuthPayload, db: Session = Depends(get_db)):
    username = payload.username.strip()
    password = resolve_password(payload)

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    existing_account = db.execute(
        select(User).where(User.username == username)
    ).scalar_one_or_none()
    if existing_account:
        raise HTTPException(status_code=409, detail="这个用户已经注册过了，请直接登录。")

    new_user = User(username=username, password=hash_password(password))
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "success": True,
        "account": {
            "username": new_user.username,
            "account": password,
            "createdAt": new_user.created_at.isoformat() if new_user.created_at else "",
        },
    }


@app.post("/api/v1/auth/login")
async def login_account(payload: AuthPayload, db: Session = Depends(get_db)):
    username = payload.username.strip()
    password = resolve_password(payload)

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password are required")

    matched_user = get_user_by_credentials(db, username, password)

    if not matched_user:
        raise HTTPException(status_code=401, detail="用户名或密码不正确，请重新输入。")

    return {
        "success": True,
        "account": {
            "username": matched_user.username,
            "account": password,
            "createdAt": matched_user.created_at.isoformat() if matched_user.created_at else "",
        },
    }


@app.get("/api/v1/users/me")
async def get_current_user(username: str, password: str, db: Session = Depends(get_db)):
    matched_user = get_user_by_credentials(db, username.strip(), password.strip())

    if not matched_user:
        raise HTTPException(status_code=401, detail="用户名或密码不正确，请重新输入。")

    return {
        "success": True,
        "account": matched_user.to_dict(),
    }


@app.post("/api/v1/users/images")
async def add_user_image(payload: UserImagePayload, db: Session = Depends(get_db)):
    return update_user_image_list(db, payload, action="add")


@app.post("/api/v1/users/images/upload")
async def upload_user_image(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    kind: Literal["uploaded", "virtual"] = Form(default="uploaded"),
    image_file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    return await store_user_image_from_upload(
        request,
        db,
        username=username,
        password=password,
        image_file=image_file,
        kind=kind,
    )


@app.delete("/api/v1/users/images")
async def remove_user_image(payload: UserImagePayload, db: Session = Depends(get_db)):
    return update_user_image_list(db, payload, action="remove")


@app.post("/api/v1/virtual-tryon/model-image")
async def generate_model_image_from_prompt(
    prompt: str = Form(..., description="Text prompt describing the model/person image"),
    provider: str = Form(default="wan-xiang", description="Provider: 'nano-banana', 'nano-banana-pro', or 'wan-xiang'"),
    resolution: Optional[str] = Form(default="2K", description="Resolution for text-to-image generation"),
    aspect_ratio: Optional[str] = Form(default="3:4", description="Optional aspect ratio (e.g., '3:4')"),
):
    valid_providers = ["nano-banana", "nano-banana-pro", "wan-xiang"]
    if provider not in valid_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider '{provider}'. Must be one of: {', '.join(valid_providers)}"
        )

    if not prompt or not prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")

    final_aspect_ratio = aspect_ratio or "3:4"
    final_resolution = resolution or "2K"

    adapter, generation_kwargs = get_provider_text_generation_context(
        provider=provider,
        final_aspect_ratio=final_aspect_ratio,
        final_resolution=final_resolution,
    )

    if provider == "wan-xiang":
        images = adapter.generate_text_to_image(prompt=prompt.strip(), **generation_kwargs)
    elif provider == "nano-banana-pro":
        images = adapter.generate_text_to_image(prompt=prompt.strip(), **generation_kwargs)
    else:
        images = adapter.generate_text_to_image(prompt=prompt.strip(), **generation_kwargs)

    if not images:
        raise HTTPException(status_code=500, detail="No model image generated")

    model_image = convert_to_pil_image(images[0])
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    saved_item = encode_and_save_image(model_image, provider, "avatar", timestamp, prefix="model")

    return JSONResponse({
        "success": True,
        "image": saved_item["image"],
        "provider": provider,
        "prompt": prompt,
        "saved_path": saved_item["saved_path"],
        "filename": saved_item["filename"],
        "image_dimensions": {
            "width": model_image.width,
            "height": model_image.height,
        },
        "aspect_ratio": final_aspect_ratio,
        "resolution": final_resolution,
    })


@app.post("/api/v1/virtual-tryon/jobs")
async def create_virtual_tryon_job(
    background_tasks: BackgroundTasks,
    model_image: UploadFile = File(..., description="Model/person image"),
    garment_images: List[UploadFile] = File(..., description="Garment images"),
    provider: str = Form(default="wan-xiang", description="Provider: 'nano-banana', 'nano-banana-pro', or 'wan-xiang'"),
    prompt: Optional[str] = Form(default=None, description="Optional custom prompt"),
    resolution: Optional[str] = Form(default="1K", description="Resolution for nano-banana-pro: '1K', '2K', or '4K'"),
    aspect_ratio: Optional[str] = Form(default=None, description="Optional aspect ratio (e.g., '16:9')")
):
    valid_providers = ["nano-banana", "nano-banana-pro", "wan-xiang"]
    if provider not in valid_providers:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider '{provider}'. Must be one of: {', '.join(valid_providers)}"
        )

    if not model_image:
        raise HTTPException(status_code=400, detail="Model image is required")

    if not garment_images or len(garment_images) == 0:
        raise HTTPException(status_code=400, detail="At least one garment image is required")

    model_image_bytes = await model_image.read()
    garment_image_bytes_list = [await garment_file.read() for garment_file in garment_images]

    job_id = create_job_record(provider=provider, num_garments=len(garment_images))
    background_tasks.add_task(
        run_tryon_job,
        job_id,
        model_image_bytes,
        garment_image_bytes_list,
        provider,
        prompt,
        resolution,
        aspect_ratio,
    )

    return JSONResponse({
        "success": True,
        "job_id": job_id,
        "status": "queued",
        "provider": provider,
        "num_garments": len(garment_images),
    })


@app.get("/api/v1/virtual-tryon/jobs/{job_id}")
async def get_virtual_tryon_job(job_id: str):
    with JOB_STORAGE_LOCK:
        job = JOB_STORAGE.get(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return JSONResponse(job)


@app.post("/api/v1/virtual-tryon")
async def virtual_tryon(
    model_image: UploadFile = File(..., description="Model/person image"),
    garment_images: List[UploadFile] = File(..., description="Garment images"),
    provider: str = Form(default="nano-banana", description="Provider: 'nano-banana', 'nano-banana-pro', or 'wan-xiang'"),
    prompt: Optional[str] = Form(default=None, description="Optional custom prompt"),
    resolution: Optional[str] = Form(default="1K", description="Resolution for nano-banana-pro: '1K', '2K', or '4K'"),
    aspect_ratio: Optional[str] = Form(default=None, description="Optional aspect ratio (e.g., '16:9')")
):
    """
    Generate virtual try-on image from model image and garment images.
    
    Uses multi-image composition feature of various models to combine
    the model image with multiple garment images.
    
    Supported providers:
    - nano-banana: Google Gemini Nano Banana (basic)
    - nano-banana-pro: Google Gemini Nano Banana Pro (supports resolution)
    - wan-xiang: Alibaba Cloud WanXiang 2.7 (multi-image reference)
    
    Args:
        model_image: Single model/person image
        garment_images: List of garment images (top, jeans, scarf, hat, etc.)
        provider: Model provider ('nano-banana', 'nano-banana-pro', or 'wan-xiang')
        prompt: Optional custom prompt for generation
        resolution: Resolution for nano-banana-pro ('1K', '2K', or '4K')
        aspect_ratio: Optional aspect ratio (for Nano Banana models)
        
    Returns:
        JSON response with base64-encoded result image
    """
    try:
        # Validate provider
        valid_providers = ["nano-banana", "nano-banana-pro", "wan-xiang"]
        if provider not in valid_providers:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid provider '{provider}'. Must be one of: {', '.join(valid_providers)}"
            )
    
        # Validate inputs
        if not model_image:
            raise HTTPException(status_code=400, detail="Model image is required")
    
        if not garment_images or len(garment_images) == 0:
            raise HTTPException(status_code=400, detail="At least one garment image is required")
    
        # Read model image
        model_image_bytes = await model_image.read()
        model_pil = Image.open(io.BytesIO(model_image_bytes))

        if RETURN_MODEL_IMAGE_DIRECTLY:
            # Temporary bypass: return the uploaded model image in all four view slots.
            if model_pil.mode != 'RGB':
                model_pil = model_pil.convert('RGB')

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            generated_view_images = [
                {
                    "view": view_key,
                    "view_label": view_label,
                    "image": model_pil.copy(),
                }
                for view_key, view_label, _ in VIEW_DEFINITIONS
            ]

            response_items = [
                encode_and_save_image(item["image"], provider, item["view"], timestamp)
                for item in generated_view_images
            ]

            return JSONResponse({
                "success": True,
                "image": response_items[0]["image"],
                "images": response_items,
                "views": [item["view"] for item in response_items],
                "provider": provider,
                "mode": "direct_model_image",
                "num_garments": len(garment_images),
                "saved_path": response_items[0]["saved_path"],
                "filename": response_items[0]["filename"],
                "model_dimensions": {
                    "width": model_pil.width,
                    "height": model_pil.height,
                },
            })
    
        # Calculate aspect ratio and resolution from model image
        calculated_aspect_ratio = calculate_aspect_ratio(model_pil)
        calculated_resolution = calculate_resolution(model_pil)
        model_width, model_height = get_image_dimensions(model_pil)
    
        # Use calculated aspect ratio if not provided, otherwise use the provided one
        final_aspect_ratio = aspect_ratio if aspect_ratio else calculated_aspect_ratio
    
        # Map resolution to appropriate format based on provider
        # For nano-banana-pro, use "1K", "2K", or "4K" format
        # For nano-banana, resolution is not used (only aspect ratio)
        if provider == "nano-banana-pro":
            # Use provided resolution if valid, otherwise map from image dimensions
            if resolution and resolution in ["1K", "2K", "4K"]:
                final_resolution = resolution
            else:
                final_resolution = map_resolution_to_pro_format(model_pil)
        else:
            # For nano-banana, resolution is not used, but keep calculated for reference
            final_resolution = calculated_resolution
    
        garment_pils = []
        for garment_file in garment_images:
            garment_bytes = await garment_file.read()
            garment_pil = Image.open(io.BytesIO(garment_bytes))
            garment_pils.append(garment_pil)

        response_data = run_tryon_pipeline(
            model_pil=model_pil,
            garment_pils=garment_pils,
            provider=provider,
            prompt=prompt,
            final_aspect_ratio=final_aspect_ratio,
            final_resolution=final_resolution,
            model_dimensions={"width": model_width, "height": model_height},
        )

        return JSONResponse(response_data)
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import traceback
        error_details = f"Error generating try-on: {str(e)}\n{traceback.format_exc()}"
        print(error_details)  # Log to console
        raise HTTPException(status_code=500, detail=f"Error generating try-on: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

