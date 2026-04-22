from __future__ import annotations

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from models import Product

SEED_PRODUCTS = [
  {
    "product_id": "img1",
    "product_name": "商品 1",
    "subtitle": "基础外套模板，适合展示单品与混搭效果。",
    "items": [
      {
        "sku_id": "img1-sku-1",
        "color": "浅灰｜简约中性",
        "size": "M",
        "image_path": "item_img/img1/7f28648602e57b0c.png",
      },
      {
        "sku_id": "img1-sku-2",
        "color": "深黑｜通勤百搭",
        "size": "L",
        "image_path": "item_img/img1/b847a0e60c0b0ef4.png",
      },
    ],
  },
  {
    "product_id": "img2",
    "product_name": "商品 2",
    "subtitle": "内搭模板，支持不同颜色与细节展示。",
    "items": [
      {
        "sku_id": "img2-sku-1",
        "color": "奶白｜柔和自然",
        "size": "M",
        "image_path": "item_img/img2/00832ee3e8b8223a.jpg",
      },
      {
        "sku_id": "img2-sku-2",
        "color": "雾蓝｜清爽轻盈",
        "size": "L",
        "image_path": "item_img/img2/00832ee3e8f66488.jpg",
      },
    ],
  },
  {
    "product_id": "img3",
    "product_name": "商品 3",
    "subtitle": "裤装模板，突出轮廓和面料层次。",
    "items": [
      {
        "sku_id": "img3-sku-1",
        "color": "深蓝｜修身直筒",
        "size": "30",
        "image_path": "item_img/img3/00832ee3e8101fdd.jpg",
      },
      {
        "sku_id": "img3-sku-2",
        "color": "卡其｜宽松休闲",
        "size": "32",
        "image_path": "item_img/img3/00832ee3e89a1a0e.jpg",
      },
    ],
  },
  {
    "product_id": "img4",
    "product_name": "商品 4",
    "subtitle": "鞋类模板，可用于展示细节与价格信息。",
    "items": [
      {
        "sku_id": "img4-sku-1",
        "color": "米白｜轻便百搭",
        "size": "39",
        "image_path": "item_img/img4/0960f10c749ef7bc.jpg",
      },
      {
        "sku_id": "img4-sku-2",
        "color": "棕黑｜耐看经典",
        "size": "40",
        "image_path": "item_img/img4/b8097dd8589456a2.jpg",
      },
    ],
  },
]


def seed_catalog(session: Session) -> None:
  existing_count = session.scalar(select(func.count()).select_from(Product)) or 0
  if existing_count > 0:
    return

  for product_data in SEED_PRODUCTS:
    for sku_data in product_data["items"]:
      session.add(
        Product(
          product_id=product_data["product_id"],
          product_name=product_data["product_name"],
          subtitle=product_data["subtitle"],
          sku_id=sku_data["sku_id"],
          color=sku_data["color"],
          size=sku_data["size"],
          image_path=sku_data["image_path"],
        )
      )

  session.commit()