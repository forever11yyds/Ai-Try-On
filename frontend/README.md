# AI-try-on Frontend Module

This directory contains the standalone Next.js app for the virtual try-on UI.

## Run

```bash
./start.sh
```

The app runs on `http://localhost:3001` by default.

## Environment

- `NEXT_PUBLIC_API_URL` points to the backend, defaulting to `http://localhost:8000`
- The frontend now polls the backend job API to render results progressively as each view completes.
- The model image card now supports two modes: upload an image directly, or generate a virtual model image from text and then reuse it as the try-on input.

## Model Image Input

In the left panel, switch the model image card from `Upload Image` to `Generate by Text` when you want to create a virtual avatar instead of uploading a real person photo.

- Describe the model you want in the text box, including appearance, pose, clothing style, lighting, and background.
- Click `Generate Model Image` to create the avatar.
- The generated image is automatically loaded into the model image slot and can be used directly for virtual try-on.
- You can switch back to `Upload Image` at any time and replace the model image manually.

## Product Flow

- The local login/register page is available at `/auth`.
- Registration stays on the login view, and a successful login redirects to `/products`.
- Product data is rendered from the static image folders in `item_img/`.
- The product listing page is available at `/products`.
- Clicking a product opens `/products/[slug]`, where you can inspect all available product variants for that product.
- The floating `AI 试衣` button on the detail page routes into the existing try-on screen with the selected product and variant preloaded.
- When the try-on page receives a product in the URL, the old garment upload area is replaced by variant selection from that product.
- The try-on page now has two garment modes: single-product try-on and mix mode.
- Mix mode does not prefill garment images. Clicking the plus button opens the dedicated `/mix` selection page, where you can freely pick any items you want to combine and return to try-on with 0 or more selections.

## Structure

- `app/` - pages, layout, and global styles
- `components/` - upload widgets and base UI components
- `lib/` - shared utilities
- `package.json` - frontend dependencies and scripts
- `tsconfig.json` - TypeScript config and path aliases


