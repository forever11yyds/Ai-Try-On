from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class User(Base):
  __tablename__ = "users"

  username: Mapped[str] = mapped_column(String(120), primary_key=True)
  password: Mapped[str] = mapped_column(String(255), nullable=False)
  uploaded_images: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
  virtual_images: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

  def to_dict(self) -> dict[str, object]:
    return {
      "username": self.username,
      "uploadedImages": self.uploaded_images or [],
      "virtualImages": self.virtual_images or [],
      "createdAt": self.created_at.isoformat() if self.created_at else "",
    }


class Product(Base):
  __tablename__ = "products"

  id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
  product_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
  product_name: Mapped[str] = mapped_column(String(160), nullable=False)
  subtitle: Mapped[str] = mapped_column(String(255), nullable=False, default="")
  sku_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
  color: Mapped[str] = mapped_column(String(255), nullable=False)
  size: Mapped[str] = mapped_column(String(80), nullable=False)
  price: Mapped[float] = mapped_column(Float, nullable=False, default=0)
  image_path: Mapped[str] = mapped_column(String(255), nullable=False)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

  def to_dict(self) -> dict[str, object]:
    return {
      "id": str(self.id),
      "productId": self.product_id,
      "productName": self.product_name,
      "subtitle": self.subtitle,
      "skuId": self.sku_id,
      "color": self.color,
      "size": self.size,
      "price": self.price,
      "imagePath": self.image_path,
      "image": self.image_path,
      "createdAt": self.created_at.isoformat() if self.created_at else "",
    }